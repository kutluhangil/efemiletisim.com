'use strict';

/* =========================================
   POST /api/admin/refund — yönetici iade işlemi
   =========================================
   PayTR İade servisi (https://www.paytr.com/odeme/iade) üzerinden tam veya
   kısmi iade yapar ve sonucu sipariş kaydına yazar.

   Bu uç PARA HAREKETİ yapar; korumaları bilerek katıdır:

   - Yetki sunucuda: Firebase ID token + doğrulanmış e-posta + ADMIN_EMAILS.
   - İade tutarı istemciden gelse de sipariş tutarıyla sınırlanır: daha önce
     iade edilenler düşülür, kalan tutarı aşan istek REDDEDİLİR (PayTR de
     reddeder, ama yanlış isteğin ağa çıkmasına gerek yok).
   - Yalnız ödemesi alınmış (paid) siparişler iade edilebilir; EFT siparişleri
     bu uçtan iade edilmez (banka üzerinden yapılır), çünkü PayTR'de karşılığı
     olan bir kart işlemi yoktur.
   - Her iade denetim kaydı bırakır (kim, ne zaman, ne kadar).
   - Sipariş kaydı transaction içinde güncellenir; aynı istek iki kez gelse de
     iade toplamı bozulmaz.

   İade PayTR tarafında anında sonuçlanır (bildirim URL'sine ayrı bir çağrı
   gelmez), bu yüzden sonuç doğrudan yanıttan yazılır.                       */

const { methodNotAllowed, json, fail, parseBody, rateLimit, clientIp, logPaymentEvent } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const { paytrConfig, isCardPaymentEnabled } = require('../_lib/env');
const { refundPayment } = require('../_lib/paytr');
const { isValidOrderId, formatTry } = require('../_lib/orders');
const { refundedMail } = require('../_lib/order-mails');
const store = require('../_lib/store');

/* Siparişin o ana kadar iade edilmiş toplamı (kuruş). */
function refundedKurus(order) {
  const list = Array.isArray(order.refunds) ? order.refunds : [];
  return list.reduce((sum, r) => sum + (Number(r.amountKurus) || 0), 0);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const limit = rateLimit(`refund:${clientIp(req)}`, { limit: 20, windowMs: 60 * 1000 });
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Çok fazla istek gönderildi.');

  const cfg = paytrConfig();
  if (!cfg || !isCardPaymentEnabled()) {
    return fail(res, 503, 'payment_not_configured',
      'Ödeme yapılandırması eksik olduğu için iade yapılamaz.');
  }

  if (!store.isStoreConfigured()) {
    return fail(res, 503, 'store_unavailable',
      'Sipariş defteri yapılandırılmamış. Sunucuda FIREBASE_SERVICE_ACCOUNT tanımlanmalı.');
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    const status = auth.code === 'unauthenticated' ? 401
      : auth.code === 'admin_not_configured' ? 503
      : 403;
    return fail(res, status, auth.code, auth.message);
  }

  const body = parseBody(req);
  const orderId = String(body.orderId || '');

  if (!isValidOrderId(orderId)) {
    return fail(res, 400, 'invalid_order', 'Sipariş numarası geçersiz.');
  }

  let order;
  try {
    order = await store.getOrder(orderId);
  } catch (err) {
    console.error('[refund] sipariş okunamadı (%s): %s', orderId, err.message);
    return fail(res, 503, 'read_failed', 'Sipariş okunamadı. Lütfen tekrar deneyin.');
  }
  if (!order) return fail(res, 404, 'not_found', 'Sipariş bulunamadı.');

  if (order.status !== 'paid') {
    return fail(res, 409, 'not_refundable',
      `Yalnız ödemesi alınmış siparişler iade edilebilir. Bu siparişin durumu: ${order.status}.`);
  }
  if (order.paymentMethod !== 'card') {
    return fail(res, 409, 'not_card_payment',
      'Bu sipariş kartla ödenmemiş. EFT/havale iadesi banka üzerinden yapılır.');
  }

  /* Tutar: gönderilmezse kalan tutarın tamamı iade edilir. */
  const alreadyKurus = refundedKurus(order);
  const remainingKurus = Number(order.totalKurus) - alreadyKurus;

  if (remainingKurus <= 0) {
    return fail(res, 409, 'already_refunded', 'Bu siparişin tamamı zaten iade edilmiş.');
  }

  let amountKurus;
  if (body.amountKurus === undefined || body.amountKurus === null || body.amountKurus === '') {
    amountKurus = remainingKurus;
  } else {
    amountKurus = Math.round(Number(body.amountKurus));
    if (!Number.isFinite(amountKurus) || amountKurus <= 0) {
      return fail(res, 400, 'invalid_amount', 'İade tutarı pozitif bir sayı olmalıdır.');
    }
  }

  if (amountKurus > remainingKurus) {
    return fail(res, 400, 'amount_exceeds_remaining',
      `İade tutarı kalan tutarı aşıyor. Kalan: ${formatTry(remainingKurus)}, istenen: ${formatTry(amountKurus)}.`);
  }

  /* PayTR'ye istek. Buradan sonrası ağ işlemi; hata hâlinde sipariş kaydı
     DEĞİŞMEZ, yönetici tekrar deneyebilir. */
  let result;
  try {
    result = await refundPayment({ merchantOid: orderId, returnKurus: amountKurus }, cfg);
  } catch (err) {
    console.error('[refund] PayTR isteği başarısız (%s): %s', orderId, err.message);
    logPaymentEvent({ event: 'refund_request_failed', orderId, actor: auth.admin.email });
    return fail(res, 502, 'provider_unreachable',
      'PayTR iade servisine ulaşılamadı. İade YAPILMADI, tekrar deneyin.');
  }

  if (!result.ok) {
    logPaymentEvent({
      event:  'refund_rejected',
      orderId,
      amountKurus,
      errNo:  result.errNo,
      actor:  auth.admin.email
    });
    return fail(res, 422, 'refund_rejected',
      `PayTR iadeyi reddetti: ${result.errMsg || 'bilinmeyen hata'} (kod: ${result.errNo || '-'}).`);
  }

  /* İade başarılı — sipariş kaydına işle. Transaction içinde tekrar okunur ki
     araya giren başka bir iade toplamı bozmasın. */
  const record = {
    amountKurus,
    amountText: formatTry(amountKurus),
    at:         new Date().toISOString(),
    by:         auth.admin.email,
    testMode:   Boolean(result.isTest)
  };

  let applied;
  try {
    applied = await store.transitionOrder(orderId, (current) => {
      const soFar = refundedKurus(current);
      const total = Number(current.totalKurus);
      if (soFar + amountKurus > total) return null;   // yarış durumu: yazma

      const refunds = [...(Array.isArray(current.refunds) ? current.refunds : []), record];
      const refundedTotal = soFar + amountKurus;

      return {
        refunds,
        refundedKurus: refundedTotal,
        status:        refundedTotal >= total ? 'refunded' : current.status,
        statusLabel:   refundedTotal >= total ? 'İade Edildi' : current.statusLabel
      };
    });
  } catch (err) {
    /* Para İADE EDİLDİ ama kayıt yazılamadı — sessizce geçilemez. */
    console.error('[refund] KAYIT YAZILAMADI, iade PayTR tarafında yapıldı (%s): %s', orderId, err.message);
    logPaymentEvent({
      event: 'refund_record_failed', orderId, amountKurus, actor: auth.admin.email
    });
    return fail(res, 500, 'refund_done_record_failed',
      `İade PayTR tarafında YAPILDI (${formatTry(amountKurus)}) ancak sipariş kaydına yazılamadı. ` +
      'Kaydı elle düzeltin — tekrar iade denemeyin.');
  }

  /* Müşteriye iade bildirimi. Mail hatası iadeyi geri almaz — para zaten
     iade edildi; yalnız loglanır ve yanıtta bildirilir. */
  const fullyRefunded = (alreadyKurus + amountKurus) >= Number(order.totalKurus);
  let mailed = false;
  if (order.buyer && order.buyer.email) {
    const mail = refundedMail(order, { amountText: record.amountText, fullyRefunded });
    try {
      await store.queueMail(order.buyer.email, mail.subject, mail.html);
      mailed = true;
    } catch (err) {
      console.error('[refund] iade maili kuyruğa yazılamadı (%s): %s', orderId, err.message);
    }
  }

  logPaymentEvent({
    event:       'refund_ok',
    orderId,
    amountKurus,
    refundedTotalKurus: alreadyKurus + amountKurus,
    fullyRefunded,
    customerMailed: mailed,
    actor:       auth.admin.email
  });

  return json(res, 200, {
    ok: true,
    orderId,
    refunded:            record.amountText,
    refundedKurus:       amountKurus,
    refundedTotalKurus:  alreadyKurus + amountKurus,
    remainingKurus:      remainingKurus - amountKurus,
    fullyRefunded,
    customerMailed:      mailed,
    applied:             applied.applied
  });
};
