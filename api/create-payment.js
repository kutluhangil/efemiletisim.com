/* =========================================
   efemiletisim.com – POST /api/create-payment
   =========================================
   Kredi kartı ödemesi — iyzico 3D Secure Initialize.
   Kart numarası/CVV bu fonksiyondan iyzico'ya iletilir, hiçbir yerde
   loglanmaz veya saklanmaz. Sipariş, callback'te 3DS onayı ALINDIKTAN
   SONRA yazılır (bkz. api/payment-callback.js) — bu yüzden burada henüz
   Firestore'a sipariş yazılmaz, sadece "payment attempt" taslağı tutulur.
   ========================================= */

const crypto = require('crypto');
const { computeServerOrder, PricingError } = require('./_lib/pricing');
const { resolveUserId } = require('./_lib/orders');
const { getFirebaseAdmin } = require('./_lib/firebaseAdmin');
const { Iyzipay, iyzicoRequest } = require('./_lib/iyzico');

function siteUrl(req) {
  return process.env.SITE_URL || `https://${req.headers.host}`;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || '85.34.78.112';
}

function splitExpiry(expiry) {
  const [mm, yy] = String(expiry || '').split('/');
  if (!mm || !yy || mm.length !== 2 || yy.length !== 2) return null;
  return { expireMonth: mm, expireYear: `20${yy}` };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = req.body || {};
    const { items, address, invoice, delivery, card, couponCode, idToken } = body;

    if (!address || !address.ad || !address.soyad || !address.telefon || !address.email) {
      res.status(400).json({ error: 'Teslimat/iletişim bilgileri eksik.' });
      return;
    }
    if (!card || !card.number || !card.name || !card.expiry || !card.cvc) {
      res.status(400).json({ error: 'Kart bilgileri eksik.' });
      return;
    }
    const expiry = splitExpiry(card.expiry);
    if (!expiry) {
      res.status(400).json({ error: 'Son kullanma tarihi geçersiz (AA/YY).' });
      return;
    }

    const priced = computeServerOrder(items, couponCode);
    const userId = await resolveUserId(idToken);

    const conversationId = crypto.randomUUID();

    // Sipariş taslağını Firestore'a yaz — callback bu taslaktan okuyacak,
    // client'tan callback aşamasında tekrar veri kabul edilmeyecek.
    const admin = getFirebaseAdmin();
    await admin.firestore().collection('paymentAttempts').doc(conversationId).set({
      status:    'pending',
      items:     priced.items,
      total:     priced.total,
      address,
      invoice:   invoice || null,
      delivery:  delivery || 'kargo',
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const identityNumber = /^\d{11}$/.test(invoice?.tcknVergiNo || '')
      ? invoice.tcknVergiNo
      : '11111111111'; // TCKN checkout'ta zorunlu toplanmıyor; iyzico alanı boş kabul etmiyor.

    const zipCode = address.posta || '00000';

    const request = {
      locale:          Iyzipay.LOCALE.TR,
      conversationId,
      price:           priced.subtotal.toFixed(2),
      paidPrice:       priced.total.toFixed(2),
      currency:        Iyzipay.CURRENCY.TRY,
      installment:     '1',
      basketId:        conversationId,
      paymentChannel:  Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup:    Iyzipay.PAYMENT_GROUP.PRODUCT,
      paymentCard: {
        cardHolderName: card.name,
        cardNumber:     String(card.number).replace(/\s/g, ''),
        expireMonth:    expiry.expireMonth,
        expireYear:     expiry.expireYear,
        cvc:            String(card.cvc),
        registerCard:   '0'
      },
      buyer: {
        id:                   userId || `guest-${conversationId.slice(0, 8)}`,
        name:                 address.ad,
        surname:              address.soyad,
        gsmNumber:            address.telefon,
        email:                address.email,
        identityNumber,
        registrationAddress:  address.adres || address.sehir || 'Adana',
        ip:                   clientIp(req),
        city:                 address.sehir || 'Adana',
        country:              'Turkey',
        zipCode
      },
      shippingAddress: {
        contactName: `${address.ad} ${address.soyad}`,
        city:        address.sehir || 'Adana',
        country:     'Turkey',
        address:     address.adres || address.sehir || '-',
        zipCode
      },
      billingAddress: {
        contactName: `${address.ad} ${address.soyad}`,
        city:        address.sehir || 'Adana',
        country:     'Turkey',
        address:     (invoice?.adres) || address.adres || address.sehir || '-',
        zipCode
      },
      basketItems: priced.items.map(i => ({
        id:        String(i.id),
        name:      i.name,
        category1: i.category || 'Elektronik',
        itemType:  Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
        price:     (i.price * i.qty).toFixed(2)
      })),
      callbackUrl: `${siteUrl(req)}/api/payment-callback`
    };

    const result = await iyzicoRequest('threedsInitialize', 'create', request);

    if (result.status !== 'success') {
      await admin.firestore().collection('paymentAttempts').doc(conversationId)
        .update({ status: 'failed', errorMessage: result.errorMessage || 'Bilinmeyen hata' });
      res.status(400).json({ error: result.errorMessage || 'Ödeme başlatılamadı.' });
      return;
    }

    // Banka HTML'i burada decode edilip Firestore'a yazılır; client'a asla
    // gönderilmez. Client sadece conversationId alır, iframe'i doğrudan
    // /api/threeds-frame'e yönlendirir — böylece banka sayfası kendi
    // response header'larını (bkz. threeds-frame.js) alır, site genelindeki
    // kısıtlı CSP'ye (vercel.json) tabi olmaz.
    await admin.firestore().collection('paymentAttempts').doc(conversationId).update({
      htmlContent: Buffer.from(result.threeDSHtmlContent, 'base64').toString('utf-8')
    });

    res.status(200).json({ conversationId });
  } catch (err) {
    if (err instanceof PricingError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[create-payment] beklenmeyen hata:', err);
    res.status(500).json({ error: 'Ödeme başlatılamadı. Lütfen tekrar deneyin.' });
  }
};
