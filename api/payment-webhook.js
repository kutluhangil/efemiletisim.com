/* =========================================
   efemiletisim.com – POST /api/payment-webhook
   =========================================
   iyzico asenkron webhook — X-IYZ-SIGNATURE-V3 doğrulaması.
   İmza formülü: HMAC-SHA256(key=secretKey,
     data = secretKey + iyziEventType + paymentId + paymentConversationId + status)
   Kaynak: https://docs.iyzico.com/en/advanced/webhook
   ⚠️ Bu formül, iyzico'nun canlı dokümantasyonundan okunarak yazıldı ama
   gerçek bir sandbox webhook olayıyla uçtan uca DOĞRULANMADI (bu ortamda
   iyzico sandbox hesabı yok). Production'a geçmeden önce iyzico Merchant
   Panel'den bir test webhook olayı tetikleyip imzanın burada geçtiğini
   doğrulayın — geçmezse önce docs.iyzico.com/en/advanced/webhook'u tekrar
   kontrol edin.

   İşlevi: callback (api/payment-callback.js) ağ hatası vb. yüzden hiç
   tetiklenmezse, ödeme aslında başarılı olduğu halde siparişin hiç
   yazılmadığı durumu yakalayan bir reconciliation güvencesidir.
   ========================================= */

const crypto = require('crypto');
const { getFirebaseAdmin } = require('./_lib/firebaseAdmin');
const { createOrderRecord } = require('./_lib/orders');

function verifySignature(body, headerSignature) {
  const secretKey = process.env.IYZICO_SECRET_KEY;
  if (!secretKey || !headerSignature) return false;

  const { iyziEventType, paymentId, paymentConversationId, status } = body;
  const data = `${secretKey}${iyziEventType || ''}${paymentId || ''}${paymentConversationId || ''}${status || ''}`;
  const expected = crypto.createHmac('sha256', secretKey).update(data).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(headerSignature), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const body = req.body || {};
  const signature = req.headers['x-iyz-signature-v3'];

  if (!verifySignature(body, signature)) {
    console.error('[payment-webhook] geçersiz imza, olay reddedildi', { paymentConversationId: body.paymentConversationId });
    res.status(401).json({ error: 'Geçersiz imza.' });
    return;
  }

  try {
    const { paymentConversationId, paymentId, status } = body;
    if (!paymentConversationId) {
      res.status(200).json({ ok: true }); // ilgimizi ilgilendirmeyen olay tipi olabilir
      return;
    }

    const admin = getFirebaseAdmin();
    const attemptRef = admin.firestore().collection('paymentAttempts').doc(paymentConversationId);
    const snap = await attemptRef.get();

    if (!snap.exists) {
      res.status(200).json({ ok: true });
      return;
    }

    const attempt = snap.data();

    // Sipariş zaten callback tarafından yazılmış — idempotent, tekrar yazma.
    if (attempt.status === 'consumed') {
      res.status(200).json({ ok: true, alreadyProcessed: true });
      return;
    }

    if (status === 'SUCCESS' && attempt.status === 'pending') {
      const order = await createOrderRecord({
        items:         attempt.items,
        total:         attempt.total,
        address:       attempt.address,
        invoice:       attempt.invoice,
        delivery:      attempt.delivery,
        paymentMethod: 'kart',
        paymentId:     paymentId,
        userId:        attempt.userId
      });
      await attemptRef.update({ status: 'consumed', orderId: order.id, consumedBy: 'webhook' });
      console.log(`[payment-webhook] callback kaçırılmış ödeme kurtarıldı: ${order.id}`);
    } else if (status === 'FAILURE') {
      await attemptRef.update({ status: 'failed', errorMessage: 'Webhook: FAILURE' });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[payment-webhook] beklenmeyen hata:', err);
    // 200 dönülür — iyzico 5xx'te retry fırtınası başlatabilir, hata zaten loglandı.
    res.status(200).json({ ok: false });
  }
};
