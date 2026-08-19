'use strict';

/* =========================================
   GET /api/admin/reconcile?orderId=... — mutabakat
   =========================================
   PayTR Durum Sorgu servisiyle (https://www.paytr.com/odeme/durum-sorgu)
   bizim sipariş kaydımızı karşılaştırır. Amaç: "bizde ne yazıyor" ile
   "PayTR'de ne olmuş" arasındaki farkı GÖRÜNÜR kılmak.

   Bu uç hiçbir şeyi DÜZELTMEZ, yalnız rapor eder. Otomatik düzeltme bilerek
   yok: tutar uyuşmazlığı çoğu zaman insan kararı gerektirir (eksik tahsilat,
   elle yapılmış iade, çift işlem). Sessizce "düzeltmek" gerçek sorunu gizler.

   Yalnız yönetici erişebilir (kart maskesi, tutar, kesinti bilgisi döner).   */

const { methodNotAllowed, json, fail, rateLimit, clientIp } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const { paytrConfig, isCardPaymentEnabled } = require('../_lib/env');
const { queryTransactionStatus } = require('../_lib/paytr');
const { isValidOrderId, formatTry } = require('../_lib/orders');
const store = require('../_lib/store');

/* Bizdeki kayıt ile PayTR'nin döndüğü durumu karşılaştırır.
   Dönüş: { agrees, problems[] } */
function compare(order, remote) {
  const problems = [];

  const localTotal = Number(order.totalKurus);
  if (remote.paymentTotalKurus !== null && remote.paymentTotalKurus !== localTotal) {
    problems.push({
      code: 'amount_mismatch',
      message: `Tahsil edilen tutar sipariş tutarıyla uyuşmuyor. ` +
               `Bizde: ${formatTry(localTotal)}, PayTR'de: ${formatTry(remote.paymentTotalKurus)}.`
    });
  }

  if (order.status === 'paid' && remote.status !== 'success') {
    problems.push({
      code: 'local_paid_remote_not',
      message: 'Bizde "ödendi" görünüyor ama PayTR başarılı bir işlem döndürmedi.'
    });
  }

  if (order.status !== 'paid' && order.status !== 'refunded' && remote.status === 'success') {
    problems.push({
      code: 'remote_paid_local_not',
      message: `PayTR'de başarılı ödeme var ama bizdeki durum "${order.status}". ` +
               'Bildirim URL\'si çalışmıyor olabilir.'
    });
  }

  /* İade karşılaştırması: PayTR'nin returns dizisi bizim kaydımızla uyumlu mu. */
  const localRefundKurus = Number(order.refundedKurus) || 0;
  const remoteRefundKurus = remote.returns.reduce((sum, r) => {
    const n = Number(String(r.return_amount || '').replace(',', '.'));
    return sum + (Number.isFinite(n) ? Math.round(n * 100) : 0);
  }, 0);

  if (localRefundKurus !== remoteRefundKurus) {
    problems.push({
      code: 'refund_mismatch',
      message: `İade toplamı uyuşmuyor. Bizde: ${formatTry(localRefundKurus)}, ` +
               `PayTR'de: ${formatTry(remoteRefundKurus)}. ` +
               'PayTR panelinden elle iade yapılmış olabilir.'
    });
  }

  if (remote.testMode && order.environment === 'production') {
    problems.push({
      code: 'environment_mismatch',
      message: 'Sipariş canlı ortama ait görünüyor ama PayTR işlemi TEST modunda.'
    });
  }

  return { agrees: problems.length === 0, problems };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const limit = rateLimit(`reconcile:${clientIp(req)}`, { limit: 60, windowMs: 60 * 1000 });
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Çok fazla istek gönderildi.');

  const cfg = paytrConfig();
  if (!cfg || !isCardPaymentEnabled()) {
    return fail(res, 503, 'payment_not_configured',
      'Ödeme yapılandırması eksik olduğu için mutabakat yapılamaz.');
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

  const orderId = String((req.query || {}).orderId || '');
  if (!isValidOrderId(orderId)) {
    return fail(res, 400, 'invalid_order', 'Sipariş numarası geçersiz.');
  }

  let order;
  try {
    order = await store.getOrder(orderId);
  } catch (err) {
    console.error('[reconcile] sipariş okunamadı (%s): %s', orderId, err.message);
    return fail(res, 503, 'read_failed', 'Sipariş okunamadı. Lütfen tekrar deneyin.');
  }
  if (!order) return fail(res, 404, 'not_found', 'Sipariş bulunamadı.');

  let remote;
  try {
    remote = await queryTransactionStatus({ merchantOid: orderId }, cfg);
  } catch (err) {
    console.error('[reconcile] PayTR sorgusu başarısız (%s): %s', orderId, err.message);
    return fail(res, 502, 'provider_unreachable', 'PayTR durum sorgu servisine ulaşılamadı.');
  }

  if (!remote.ok) {
    return json(res, 200, {
      ok: true,
      orderId,
      found: false,
      local: { status: order.status, totalKurus: order.totalKurus, totalText: formatTry(order.totalKurus) },
      remote: { status: remote.status, errNo: remote.errNo, errMsg: remote.errMsg },
      agrees: false,
      problems: [{
        code: 'not_found_at_provider',
        message: `PayTR'de bu sipariş numarasına ait başarılı işlem bulunamadı: ${remote.errMsg || '-'}`
      }]
    });
  }

  const { agrees, problems } = compare(order, remote);

  return json(res, 200, {
    ok: true,
    orderId,
    found: true,
    agrees,
    problems,
    local: {
      status:        order.status,
      totalKurus:    order.totalKurus,
      totalText:     formatTry(order.totalKurus),
      refundedKurus: Number(order.refundedKurus) || 0,
      paidAt:        order.paidAt || null,
      environment:   order.environment || null
    },
    remote: {
      paymentTotalKurus: remote.paymentTotalKurus,
      paymentTotalText:  remote.paymentTotalKurus !== null ? formatTry(remote.paymentTotalKurus) : null,
      paymentDate:       remote.paymentDate,
      installment:       remote.installment,
      cardBrand:         remote.cardBrand,
      maskedPan:         remote.maskedPan,
      paymentType:       remote.paymentType,
      testMode:          remote.testMode,
      netKurus:          remote.netKurus,
      feeKurus:          remote.feeKurus,
      returns:           remote.returns
    }
  });
};

module.exports.compare = compare;
