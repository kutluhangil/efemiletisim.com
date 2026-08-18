'use strict';

/* =========================================
   Sipariş durumu e-postaları (müşteriye)
   =========================================
   Sipariş onayı maili `settle.js` içindedir (ödeme anında). Bu dosya
   ödemeden SONRAKİ durum değişikliklerini müşteriye bildirir:

     shipped   → kargoya verildi (takip numarasıyla)
     delivered → teslim edildi + cayma hakkı hatırlatması
     cancelled → sipariş iptal edildi
     refunded  → iade yapıldı (tutar + süre bilgisi)

   Mail gönderimi Firestore `mail` koleksiyonuna yazılır; gerçek gönderimi
   "Trigger Email from Firestore" extension'ı yapar (bkz. docs/EMAIL-KURULUMU.md).
   Extension kurulu değilse doküman birikir ama mail çıkmaz — bu sessiz bir
   başarısızlıktır, kurulum listesinde ayrıca kontrol edilir.

   Mail gönderimi sipariş işlemini BLOKLAMAZ: hata olursa loglanır, yönetici
   işlemi geri alınmaz. Ama "gönderildi" diye de raporlanmaz.               */

const { MERCHANT } = require('./merchant');
const { formatTry, lineTitle } = require('./orders');

/* Cayma hakkı süresi (mesafeli satışta teslimden itibaren). */
const WITHDRAWAL_DAYS = 14;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function itemRows(order) {
  return (order.items || [])
    .map(i => `<li>${escapeHtml(lineTitle(i))} × ${i.qty} — ${formatTry(i.totalKurus)}</li>`)
    .join('');
}

function signature() {
  return `<p style="margin-top:20px">Sorularınız için: ${escapeHtml(MERCHANT.supportEmail)}<br>` +
         `${escapeHtml(MERCHANT.brandName)}</p>`;
}

function greeting(order) {
  const name = order.buyer && order.buyer.ad ? order.buyer.ad : '';
  return `<p>Merhaba ${escapeHtml(name)},</p>`;
}

/* ─── Kargoya verildi ─── */
function shippedMail(order) {
  const tracking = order.trackingNumber
    ? `<p><strong>Kargo takip numaranız: ${escapeHtml(order.trackingNumber)}</strong><br>
       Kargo firmasının sitesinden bu numarayla gönderinizi takip edebilirsiniz.</p>`
    : `<p>Takip numarası kargo firmasından alınır alınmaz tarafınıza iletilecektir.</p>`;

  return {
    subject: `Siparişiniz kargoya verildi – ${order.id}`,
    html: `${greeting(order)}
      <p><strong>${escapeHtml(order.id)}</strong> numaralı siparişiniz kargoya verildi.</p>
      ${tracking}
      <ul>${itemRows(order)}</ul>
      <p><strong>Toplam: ${formatTry(order.totalKurus)}</strong> (KDV dahil)</p>
      ${signature()}`
  };
}

/* ─── Teslim edildi ─── */
function deliveredMail(order) {
  return {
    subject: `Siparişiniz teslim edildi – ${order.id}`,
    html: `${greeting(order)}
      <p><strong>${escapeHtml(order.id)}</strong> numaralı siparişiniz teslim edildi.
      Bizi tercih ettiğiniz için teşekkür ederiz.</p>
      <p>Üründe bir sorun varsa veya cayma hakkınızı kullanmak isterseniz,
      teslim tarihinden itibaren <strong>${WITHDRAWAL_DAYS} gün</strong> içinde bize
      ulaşmanız yeterlidir.</p>
      ${signature()}`
  };
}

/* ─── İptal edildi ─── */
function cancelledMail(order) {
  const paid = order.status === 'refunded' || order.paidAt;
  return {
    subject: `Siparişiniz iptal edildi – ${order.id}`,
    html: `${greeting(order)}
      <p><strong>${escapeHtml(order.id)}</strong> numaralı siparişiniz iptal edilmiştir.</p>
      ${paid
        ? `<p>Tahsil edilen <strong>${formatTry(order.totalKurus)}</strong> tutarındaki ödemeniz
           iade edilecektir. İade, bankanıza bağlı olarak genellikle birkaç iş günü içinde
           kartınıza yansır.</p>`
        : `<p>Bu sipariş için tahsilat yapılmamıştır; kartınızdan herhangi bir tutar çekilmemiştir.</p>`}
      ${signature()}`
  };
}

/* ─── İade yapıldı ───
   refund: { amountText, fullyRefunded } */
function refundedMail(order, refund) {
  return {
    subject: `İadeniz işleme alındı – ${order.id}`,
    html: `${greeting(order)}
      <p><strong>${escapeHtml(order.id)}</strong> numaralı siparişiniz için
      <strong>${escapeHtml(refund.amountText)}</strong> tutarında iade işlemi yapılmıştır.</p>
      ${refund.fullyRefunded
        ? '<p>Siparişinizin tamamı iade edilmiştir.</p>'
        : `<p>Bu kısmi bir iadedir; siparişinizin kalan tutarı için değişiklik yoktur.</p>`}
      <p>İade tutarı, bankanıza bağlı olarak genellikle birkaç iş günü içinde
      kartınıza yansır. Yansımazsa bizimle iletişime geçin.</p>
      ${signature()}`
  };
}

/* Sevkiyat durumuna göre mail üretir; o durum için mail tanımlı değilse null. */
function mailForStatus(order, status) {
  switch (status) {
    case 'shipped':   return shippedMail(order);
    case 'delivered': return deliveredMail(order);
    case 'cancelled': return cancelledMail(order);
    default:          return null;
  }
}

module.exports = {
  WITHDRAWAL_DAYS,
  mailForStatus,
  shippedMail,
  deliveredMail,
  cancelledMail,
  refundedMail
};
