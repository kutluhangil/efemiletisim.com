/* =========================================
   efemiletisim.com – Sipariş yazma (server-side, Admin SDK)
   =========================================
   Tek giriş noktası: hem EFT hem kart (iyzico) siparişleri buradan yazılır.
   Üye + misafir siparişleri aynı üst düzey `orders` koleksiyonuna gider,
   üye siparişleri ayrıca users/{uid}.orders içine de eklenir (profil.html
   bu alanı okuyor). Admin SDK Firestore Security Rules'u atlar, bu yüzden
   client'ın kendi sahte "başarılı sipariş" yazması artık mümkün değil.
   ========================================= */

const { getFirebaseAdmin } = require('./firebaseAdmin');

function buildOrderId() {
  return 'EFM' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
}

/**
 * @param {object} params
 * @param {Array}  params.items          computeServerOrder() çıktısındaki items
 * @param {number} params.total          computeServerOrder() çıktısındaki total
 * @param {object} params.address
 * @param {object} params.invoice
 * @param {string} params.delivery       'kargo' | 'magaza'
 * @param {string} params.paymentMethod  'kart' | 'eft'
 * @param {string} [params.paymentId]
 * @param {string} [params.eftReceiptNo]
 * @param {string|null} params.userId    Firebase uid veya null (misafir)
 */
async function createOrderRecord(params) {
  const admin = getFirebaseAdmin();
  const db    = admin.firestore();

  const {
    items, total, address, invoice, delivery,
    paymentMethod, paymentId = null, eftReceiptNo = null, userId = null
  } = params;

  const addr = address || {};
  const customerName  = [addr.ad, addr.soyad].filter(Boolean).join(' ') || null;
  const customerEmail = addr.email || null;

  const order = {
    id:             buildOrderId(),
    date:           new Date().toISOString(),
    status:         paymentMethod === 'eft' ? 'processing' : 'processing',
    statusLabel:    'Hazırlanıyor',
    items,
    total,
    address:        address || null,
    invoice:        invoice || null,
    delivery:       delivery || 'kargo',
    paymentMethod:  paymentMethod || 'kart',
    paymentId:      paymentId,
    eftReceiptNo:   eftReceiptNo,
    trackingNumber: null,
    userId:         userId,
    guest:          !userId,
    source:         userId ? 'member' : 'guest',
    customerName,
    customerEmail,
    createdAt:      admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('orders').doc(order.id).set(order);

  if (userId) {
    await db.collection('users').doc(userId).update({
      orders: admin.firestore.FieldValue.arrayUnion(order)
    });
  }

  if (customerEmail) {
    await queueOrderConfirmationMail(order, customerEmail);
  }

  return order;
}

async function queueOrderConfirmationMail(order, toEmail) {
  const admin = getFirebaseAdmin();
  const db    = admin.firestore();

  const itemsHtml = (order.items || [])
    .map(i => `<li>${i.name} × ${i.qty} — ${i.price * i.qty} ₺</li>`)
    .join('');

  await db.collection('mail').add({
    to: toEmail,
    message: {
      subject: `Siparişiniz Alındı – ${order.id}`,
      html:
        `<p>Merhaba,</p>` +
        `<p><strong>${order.id}</strong> numaralı siparişiniz alındı ve hazırlanıyor.</p>` +
        `<ul>${itemsHtml}</ul>` +
        `<p><strong>Toplam: ${order.total} ₺</strong></p>` +
        `<p>Bizi tercih ettiğiniz için teşekkür ederiz.<br>efem iletişim</p>`
    }
  });
}

/* Firebase ID token doğrulama — istek gövdesinde idToken varsa uid döner,
   yoksa/ geçersizse null (misafir olarak devam edilir, hata fırlatılmaz). */
async function resolveUserId(idToken) {
  if (!idToken) return null;
  try {
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

module.exports = { createOrderRecord, resolveUserId, buildOrderId };
