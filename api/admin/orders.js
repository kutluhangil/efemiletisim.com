'use strict';

/* =========================================
   /api/admin/orders — yönetici sipariş yönetimi
   =========================================
   GET  → tüm siparişler (üye + misafir) tek listede
   POST → sipariş durumunu güncelle ({ orderId, status })

   Yetki sunucuda doğrulanır: Firebase ID token + doğrulanmış e-posta +
   ADMIN_EMAILS listesinde bulunma (bkz. api/_lib/admin-auth.js).
   admin.html'in eski istemci tarafı şifresi bir yetki kontrolü DEĞİLDİR;
   bu uç ondan bağımsız olarak korunur.

   Durum güncellemesi iki yeri birden günceller:
     orders/{orderId}                → tek doğruluk kaynağı
     users/{uid}.orders[] içindeki kopya → müşteri profil.html'de görsün    */

const { methodNotAllowed, json, fail, parseBody, rateLimit, clientIp, logPaymentEvent } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const { isValidOrderId, formatTry } = require('../_lib/orders');
const { mailForStatus } = require('../_lib/order-mails');
const store = require('../_lib/store');

/* Yöneticinin elle atayabileceği sevkiyat durumları. Ödeme durumları
   (paid, pending_review, failed …) buradan değiştirilemez; onları yalnız
   ödeme bildirimi yazar. */
const FULFILLMENT_STATUS = {
  processing: 'Hazırlanıyor',
  shipped:    'Kargoda',
  delivered:  'Teslim Edildi',
  cancelled:  'İptal'
};

/* Listede müşteriye ait hassas alanların tamamı yöneticiye gösterilir
   (sipariş yönetimi için gerekli), ancak ödeme sağlayıcısının ham yanıtı
   ve iç kimlikler dışarı verilmez. */
function adminOrderView(order) {
  return {
    id:            order.id,
    date:          order.date,
    status:        order.status,
    statusLabel:   order.statusLabel,
    paymentMethod: order.paymentMethod,
    paymentProvider: order.paymentProvider || null,
    environment:   order.environment || null,
    guest:         Boolean(order.guest),
    userId:        order.userId || null,
    buyer:         order.buyer || null,
    address:       order.address || null,
    invoice:       order.invoice || null,
    delivery:      order.delivery || 'kargo',
    eftReceiptNo:  order.eftReceiptNo || null,
    trackingNumber: order.trackingNumber || null,
    items: (order.items || []).map(i => ({
      id: i.id, sku: i.sku || null, name: i.name,
      color: i.color || '', size: i.size || '',
      qty: i.qty, unitKurus: i.unitKurus, totalKurus: i.totalKurus
    })),
    totalKurus:  order.totalKurus,
    totalText:   formatTry(order.totalKurus),
    paidAt:      order.paidAt || null,
    fulfillment: order.fulfillment || null,
    refundedKurus: Number(order.refundedKurus) || 0,
    refunds: Array.isArray(order.refunds) ? order.refunds.map(r => ({
      amountKurus: r.amountKurus, amountText: r.amountText, at: r.at, by: r.by
    })) : [],
    stock: order.stock ? {
      decremented: (order.stock.decremented || []).length,
      skipped:     (order.stock.skipped || []).length
    } : null,
    payment: order.payment ? {
      paymentType:      order.payment.paymentType || null,
      installmentCount: order.payment.installmentCount || 0,
      testMode:         Boolean(order.payment.testMode),
      problems:         order.payment.problems || []
    } : null
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  const limit = rateLimit(`admin:${clientIp(req)}`, { limit: 120, windowMs: 60 * 1000 });
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Çok fazla istek gönderildi.');

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

  if (req.method === 'GET') return listHandler(req, res);
  return updateHandler(req, res, auth.admin);
};

async function listHandler(req, res) {
  const query = req.query || {};
  const status = typeof query.status === 'string' && query.status !== 'all' ? query.status : null;
  const limit = Math.min(parseInt(query.limit, 10) || 200, 500);

  let orders;
  try {
    orders = await store.listOrders({ limit, status });
  } catch (err) {
    console.error('[admin] siparişler okunamadı: %s', err.message);
    return fail(res, 503, 'list_failed', 'Siparişler okunamadı. Lütfen tekrar deneyin.');
  }

  return json(res, 200, {
    ok: true,
    count: orders.length,
    statuses: FULFILLMENT_STATUS,
    orders: orders.map(adminOrderView)
  });
}

async function updateHandler(req, res, admin) {
  const body = parseBody(req);
  const orderId = String(body.orderId || '');
  const status  = String(body.status || '');

  if (!isValidOrderId(orderId)) {
    return fail(res, 400, 'invalid_order', 'Sipariş numarası geçersiz.');
  }
  if (!Object.prototype.hasOwnProperty.call(FULFILLMENT_STATUS, status)) {
    return fail(res, 400, 'invalid_status',
      `Geçersiz durum. İzin verilenler: ${Object.keys(FULFILLMENT_STATUS).join(', ')}`);
  }

  /* Takip numarası isteğe bağlı: gönderilmezse mevcut değer korunur.
     "Kargoda" durumuna geçerken aynı istekte gönderilebilir ki müşteriye
     giden kargo maili takip numarasını da içersin. */
  let trackingNumber;
  if (Object.prototype.hasOwnProperty.call(body, 'trackingNumber')) {
    const raw = String(body.trackingNumber || '').trim();
    if (raw.length > 64) {
      return fail(res, 400, 'invalid_tracking', 'Kargo takip numarası en fazla 64 karakter olabilir.');
    }
    if (raw && !/^[A-Za-z0-9\-]+$/.test(raw)) {
      return fail(res, 400, 'invalid_tracking',
        'Kargo takip numarası yalnız harf, rakam ve tire içerebilir.');
    }
    trackingNumber = raw || null;
  }

  let result;
  try {
    result = await store.setOrderStatus(
      orderId, status, FULFILLMENT_STATUS[status], admin.email, { trackingNumber }
    );
  } catch (err) {
    console.error('[admin] durum güncellenemedi (%s): %s', orderId, err.message);
    return fail(res, 503, 'update_failed', 'Sipariş durumu güncellenemedi.');
  }

  if (!result.applied && result.reason === 'not_found') {
    return fail(res, 404, 'not_found', 'Sipariş bulunamadı.');
  }

  /* Üye siparişiyse profildeki kopyayı da güncelle; başarısız olursa
     yönetici işlemi bloklanmaz, sonuçta bildirilir. */
  let profileSync = { applied: false, reason: 'guest' };
  const order = result.order;
  if (order && order.userId) {
    profileSync = await store.syncUserOrderStatus(order.userId, orderId, status, FULFILLMENT_STATUS[status]);
  }

  /* Müşteriye durum bildirimi. Yalnız durum GERÇEKTEN değiştiyse gönderilir;
     aynı durumu tekrar kaydetmek müşteriye ikinci bir mail göndermemeli.
     Mail hatası yönetici işlemini geri almaz, ama "gönderildi" de denmez. */
  let mailed = false;
  if (result.statusChanged && order && order.buyer && order.buyer.email) {
    const mail = mailForStatus(order, status);
    if (mail) {
      try {
        await store.queueMail(order.buyer.email, mail.subject, mail.html);
        mailed = true;
      } catch (err) {
        console.error('[admin] durum maili kuyruğa yazılamadı (%s): %s', orderId, err.message);
      }
    }
  }

  logPaymentEvent({
    event: 'admin_order_status',
    orderId,
    status,
    applied: result.applied,
    statusChanged: Boolean(result.statusChanged),
    trackingChanged: Boolean(result.trackingChanged),
    profileSynced: profileSync.applied,
    customerMailed: mailed,
    actor: admin.email
  });

  return json(res, 200, {
    ok: true,
    orderId,
    status,
    statusLabel: FULFILLMENT_STATUS[status],
    applied: result.applied,
    trackingNumber: result.order ? (result.order.trackingNumber || null) : null,
    customerMailed: mailed,
    profileSynced: profileSync.applied,
    profileSyncReason: profileSync.reason || null
  });
}

module.exports.FULFILLMENT_STATUS = FULFILLMENT_STATUS;
module.exports.adminOrderView = adminOrderView;
