/* =========================================
   efemiletisim.com – POST /api/payment-callback
   =========================================
   iyzico 3DS bank sayfası ödeme sonrası bu URL'e POST eder. Bu istek
   3DS iframe'i İÇİNDEN gelir, bu yüzden yanıt HTML'i üst pencereyi
   (window.top) yönlendirir — fetch/JSON değil, tarayıcı navigasyonu.

   Callback'te gelen HİÇBİR sepet/adres/tutar bilgisine güvenilmez;
   tüm sipariş verisi api/create-payment.js'in Firestore'a yazdığı
   paymentAttempts/{conversationId} taslağından okunur.
   ========================================= */

const { getFirebaseAdmin } = require('./_lib/firebaseAdmin');
const { createOrderRecord } = require('./_lib/orders');
const { iyzicoRequest } = require('./_lib/iyzico');

function redirectPage(siteUrl, path) {
  const target = `${siteUrl}${path}`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <script>window.top.location.href = ${JSON.stringify(target)};</script>
    <p>Yönlendiriliyor... Otomatik yönlenmezse <a href="${target}">buraya tıklayın</a>.</p>
  </body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
  const body    = req.body || {};
  const { conversationId, paymentId, mdStatus, status } = body;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!conversationId) {
    res.status(400).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=missing_conversation'));
    return;
  }

  try {
    const admin   = getFirebaseAdmin();
    const db      = admin.firestore();
    const attemptRef = db.collection('paymentAttempts').doc(conversationId);
    const attemptSnap = await attemptRef.get();

    if (!attemptSnap.exists) {
      res.status(400).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=unknown_attempt'));
      return;
    }

    const attempt = attemptSnap.data();

    // İdempotency: aynı callback iki kez gelirse (ağ retry, kullanıcı geri tuşu)
    // ödemeyi tekrar finalize etmeye çalışmadan önceki sonucu göster.
    if (attempt.status === 'consumed') {
      res.status(200).send(redirectPage(siteUrl, `/odeme.html?order=${attempt.orderId}`));
      return;
    }
    if (attempt.status === 'failed') {
      res.status(200).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=already_failed'));
      return;
    }

    // 3DS banka tarafında reddedildi/iptal edildi (mdStatus 1 dışında bir şey
    // başarıyı ifade etmez; iyzico dokümantasyonu bu kontrolü zorunlu tutar).
    if (status === 'failure' || (mdStatus && mdStatus !== '1')) {
      await attemptRef.update({ status: 'failed', errorMessage: `3DS doğrulama başarısız (mdStatus: ${mdStatus})` });
      res.status(200).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=3ds_declined'));
      return;
    }

    const result = await iyzicoRequest('threedsPayment', 'create', {
      locale: 'tr',
      conversationId,
      paymentId
    });

    if (result.status !== 'success') {
      await attemptRef.update({ status: 'failed', errorMessage: result.errorMessage || 'Ödeme onaylanamadı' });
      res.status(200).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=' + encodeURIComponent(result.errorMessage || 'declined')));
      return;
    }

    const order = await createOrderRecord({
      items:         attempt.items,
      total:         attempt.total,
      address:       attempt.address,
      invoice:       attempt.invoice,
      delivery:      attempt.delivery,
      paymentMethod: 'kart',
      paymentId:     result.paymentId,
      userId:        attempt.userId
    });

    await attemptRef.update({ status: 'consumed', orderId: order.id });

    res.status(200).send(redirectPage(siteUrl, `/odeme.html?order=${order.id}`));
  } catch (err) {
    console.error('[payment-callback] beklenmeyen hata:', err);
    res.status(200).send(redirectPage(siteUrl, '/odeme.html?payment=failed&reason=server_error'));
  }
};
