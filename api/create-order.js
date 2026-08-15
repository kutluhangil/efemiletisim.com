/* =========================================
   efemiletisim.com – POST /api/create-order
   =========================================
   Kart gerektirmeyen sipariş oluşturma (şu an sadece EFT/Havale).
   Kart ödemesi api/create-payment.js + api/payment-callback.js üzerinden,
   iyzico onayından SONRA aynı createOrderRecord() ile yazılır.
   ========================================= */

const { computeServerOrder, PricingError } = require('./_lib/pricing');
const { createOrderRecord, resolveUserId } = require('./_lib/orders');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = req.body || {};
    const { items, address, invoice, delivery, paymentMethod, eftReceiptNo, couponCode, idToken } = body;

    if (paymentMethod !== 'eft') {
      res.status(400).json({ error: 'Bu endpoint yalnızca EFT/Havale siparişleri içindir.' });
      return;
    }

    if (!address || !address.ad || !address.soyad || !address.telefon || !address.email) {
      res.status(400).json({ error: 'Teslimat/iletişim bilgileri eksik.' });
      return;
    }

    const priced  = computeServerOrder(items, couponCode);
    const userId  = await resolveUserId(idToken);

    const order = await createOrderRecord({
      items:         priced.items,
      total:         priced.total,
      address,
      invoice,
      delivery,
      paymentMethod: 'eft',
      eftReceiptNo:  eftReceiptNo || null,
      userId
    });

    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof PricingError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[create-order] beklenmeyen hata:', err);
    res.status(500).json({ error: 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.' });
  }
};
