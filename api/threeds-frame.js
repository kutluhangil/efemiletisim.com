/* =========================================
   efemiletisim.com – GET /api/threeds-frame?conversationId=...
   =========================================
   iyzico'nun döndürdüğü banka 3DS sayfasını ödeme sayfasındaki iframe'e
   sunar. Bu sayfa bankanın kendi script/stil/domain'lerini kullanır —
   site genelindeki kısıtlı CSP (vercel.json → `/(.*)`) burada UYGULANMAZ:
   aşağıdaki res.setHeader çağrıları bu response için vercel.json'daki
   değerleri ezer (Vercel Functions'ta doğrulanmış davranış — function'ın
   kendi header'ı platform header'ından önceliklidir).
   ========================================= */

const { getFirebaseAdmin } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const conversationId = req.query.conversationId;
  if (!conversationId) {
    res.status(400).send('conversationId eksik.');
    return;
  }

  try {
    const admin = getFirebaseAdmin();
    const snap  = await admin.firestore().collection('paymentAttempts').doc(String(conversationId)).get();

    if (!snap.exists || !snap.data().htmlContent) {
      res.status(404).send('Ödeme oturumu bulunamadı veya süresi doldu.');
      return;
    }

    // Bankanın sayfası kendi kaynaklarını (script/img/style, farklı domainler)
    // yükleyebilmeli — bu response için CSP'yi sadece frame-ancestors'a indir.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(snap.data().htmlContent);
  } catch (err) {
    console.error('[threeds-frame] beklenmeyen hata:', err);
    res.status(500).send('Ödeme doğrulama sayfası yüklenemedi.');
  }
};
