#!/usr/bin/env node
/* =========================================
   Yönetici sipariş yönetimi testleri
   =========================================
   Gerçek Firestore'a bağlanmaz; sipariş defteri ve kimlik doğrulama
   sahtelenir. Doğruladıkları:

   - Yetkisiz erişim: token yok → 401, yetkisiz e-posta → 403,
     ADMIN_EMAILS tanımsız → 503
   - Liste: üye + misafir siparişlerinin tamamı tek yerde
   - Durum güncelleme: yalnız izin verilen sevkiyat durumları
   - Üye siparişinde users/{uid}.orders kopyasının da güncellenmesi
   - Geç gelen ödeme bildiriminin "Kargoda" siparişi geri almaması

   Çalıştırma: node scripts/test-admin-orders.mjs                            */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else    { failed++; console.error(`  FAIL ${name}\n       beklenen: ${JSON.stringify(expected)}\n       gelen   : ${JSON.stringify(actual)}`); }
}

process.env.PAYTR_MERCHANT_ID   = '123456';
process.env.PAYTR_MERCHANT_KEY  = 'admin-test-key';
process.env.PAYTR_MERCHANT_SALT = 'admin-test-salt';
process.env.ORDER_TOKEN_SECRET  = 'admin-test-secret';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test', client_email: 't@t.iam.gserviceaccount.com', private_key: 'x'
});
process.env.ADMIN_EMAILS = 'patron@efemiletisim.com, destek@efemiletisim.com';

/* ─── Sahte sipariş defteri ─── */
const orders = new Map();
const mails = [];
const questions = new Map();
const alerts = new Map();
const users  = new Map();
let tokenIdentity = null;   // { uid, email, emailVerified } | null

orders.set('EFM260818AAAAAA', {
  id: 'EFM260818AAAAAA', date: '2026-08-18T10:00:00.000Z',
  status: 'paid', statusLabel: 'Hazırlanıyor', guest: false, userId: 'user-1',
  paymentMethod: 'kart', delivery: 'kargo', totalKurus: 2345900,
  buyer: { ad: 'Ali', soyad: 'Veli', email: 'ali@example.com', telefon: '05001112233' },
  items: [{ id: 1, sku: '1422880', name: 'Apple Watch', color: 'Jet Siyah', size: 'S/M', qty: 1, unitKurus: 2345900, totalKurus: 2345900 }]
});
orders.set('EFM260818BBBBBB', {
  id: 'EFM260818BBBBBB', date: '2026-08-18T11:00:00.000Z',
  status: 'awaiting_transfer', statusLabel: 'EFT/havale bekleniyor', guest: true, userId: null,
  paymentMethod: 'eft', delivery: 'magaza', totalKurus: 605500,
  buyer: { ad: 'Ayşe', soyad: 'Yılmaz', email: 'ayse@example.com', telefon: '05009998877' },
  items: [{ id: 15, sku: 'X1', name: 'Huawei Watch Fit 4', color: 'Siyah', size: '', qty: 1, unitKurus: 605500, totalKurus: 605500 }]
});

users.set('user-1', {
  orders: [
    { id: 'EFM260818AAAAAA', status: 'paid', statusLabel: 'Hazırlanıyor', total: 23459 },
    { id: 'ESKI123', status: 'delivered', statusLabel: 'Teslim Edildi', total: 100 }
  ]
});

const fakeStore = {
  getStore: () => ({}),
  isStoreConfigured: () => true,
  verifyIdToken: async (header) => (header && tokenIdentity ? tokenIdentity : null),
  getOrder: async (id) => (orders.has(id) ? { ...orders.get(id) } : null),
  listOrders: async ({ status = null } = {}) => {
    const all = [...orders.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    return status ? all.filter(o => o.status === status) : all;
  },
  setOrderStatus: async (id, status, label, actor, { trackingNumber } = {}) => {
    const cur = orders.get(id);
    if (!cur) return { applied: false, reason: 'not_found', order: null };
    const statusChanged   = cur.status !== status;
    const trackingChanged = trackingNumber !== undefined
      && (cur.trackingNumber || null) !== (trackingNumber || null);
    if (!statusChanged && !trackingChanged) return { applied: false, reason: 'no_change', order: cur };
    const next = { ...cur, status, statusLabel: label, fulfillment: { updatedBy: actor, previousStatus: cur.status } };
    if (trackingNumber !== undefined) next.trackingNumber = trackingNumber || null;
    orders.set(id, next);
    return { applied: true, statusChanged, trackingChanged, order: next };
  },
  syncUserOrderStatus: async (uid, orderId, status, label) => {
    const u = users.get(uid);
    if (!u) return { applied: false, reason: 'user_not_found' };
    let found = false;
    u.orders = u.orders.map(o => (o.id === orderId ? (found = true, { ...o, status, statusLabel: label }) : o));
    return found ? { applied: true } : { applied: false, reason: 'order_not_in_profile' };
  },
  transitionOrder: async (id, decide) => {
    const cur = orders.get(id);
    if (!cur) return { applied: false, reason: 'not_found', order: null };
    const patch = decide(cur);
    if (!patch) return { applied: false, reason: 'no_change', order: cur };
    orders.set(id, { ...cur, ...patch });
    return { applied: true, order: orders.get(id) };
  },
  appendOrderToUserProfile: async () => {},
  listProductQuestions: async () => [...questions.values()],
  answerProductQuestion: async (id, answer, actor) => {
    if (!questions.has(id)) return { applied: false, reason: 'not_found' };
    questions.set(id, { ...questions.get(id), answer, answeredBy: answer ? actor : null });
    return { applied: true };
  },
  listStockAlerts: async () => [...alerts.values()],
  deleteInboxItem: async (col, id) => {
    (col === 'productQuestions' ? questions : alerts).delete(id);
  },
  queueMail: async (to, subject, html) => { mails.push({ to, subject, html }); },
  recordEventOnce: async () => true
};

require.cache[require.resolve('../api/_lib/store.js')] = {
  id: require.resolve('../api/_lib/store.js'),
  filename: require.resolve('../api/_lib/store.js'),
  loaded: true,
  exports: fakeStore
};

const adminOrders = require('../api/admin/orders.js');
const { settleNotification } = require('../api/_lib/settle.js');

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    send(p) { this.body = p; return this; },
    end(p) { if (p !== undefined) this.body = p; return this; }
  };
}

async function call(handler, { method = 'GET', body = {}, query = {}, auth = true } = {}) {
  const headers = { 'x-forwarded-for': '10.0.0.9' };
  if (auth) headers.authorization = 'Bearer sahte-token';
  const res = makeRes();
  await handler({ method, body, query, headers, socket: { remoteAddress: '10.0.0.9' } }, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* düz metin */ }
  return { res, json };
}

console.log('\n1) yetki kontrolü');
{
  tokenIdentity = null;
  const anon = await call(adminOrders, { auth: false });
  check('token yoksa 401', anon.res.statusCode, 401);

  tokenIdentity = { uid: 'u9', email: 'rastgele@gmail.com', emailVerified: true };
  const stranger = await call(adminOrders);
  check('yetkisiz e-posta 403', stranger.res.statusCode, 403);

  tokenIdentity = { uid: 'u1', email: 'patron@efemiletisim.com', emailVerified: false };
  const unverified = await call(adminOrders);
  check('doğrulanmamış e-posta 403', unverified.res.statusCode, 403);

  const saved = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
  tokenIdentity = { uid: 'u1', email: 'patron@efemiletisim.com', emailVerified: true };
  const notConfigured = await call(adminOrders);
  check('ADMIN_EMAILS tanımsızsa 503', notConfigured.res.statusCode, 503);
  check('sebep bildiriliyor', notConfigured.json.code, 'admin_not_configured');
  process.env.ADMIN_EMAILS = saved;
}

console.log('\n2) liste — üye + misafir tek yerde');
{
  tokenIdentity = { uid: 'u1', email: 'PATRON@efemiletisim.com', emailVerified: true };
  const list = await call(adminOrders);
  check('HTTP 200', list.res.statusCode, 200);
  check('büyük/küçük harf farkı yetkiyi bozmuyor', list.json.ok, true);
  check('iki sipariş de listede', list.json.count, 2);
  check('misafir siparişi görünüyor', list.json.orders.some(o => o.guest === true), true);
  check('üye siparişi görünüyor', list.json.orders.some(o => o.guest === false), true);
  check('tutar okunur biçimde', list.json.orders.find(o => o.id === 'EFM260818AAAAAA').totalText, '23.459,00 ₺');
  check('sku listede', list.json.orders.find(o => o.id === 'EFM260818AAAAAA').items[0].sku, '1422880');
  check('izin verilen durumlar bildiriliyor', Object.keys(list.json.statuses), ['processing', 'shipped', 'delivered', 'cancelled']);
}

console.log('\n3) durum güncelleme');
{
  tokenIdentity = { uid: 'u1', email: 'patron@efemiletisim.com', emailVerified: true };

  const badStatus = await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818AAAAAA', status: 'paid' } });
  check('ödeme durumu elle atanamaz', badStatus.res.statusCode, 400);

  const badId = await call(adminOrders, { method: 'POST', body: { orderId: 'ABC', status: 'shipped' } });
  check('geçersiz sipariş no 400', badId.res.statusCode, 400);

  const missing = await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818FFFFFF', status: 'shipped' } });
  check('olmayan sipariş 404', missing.res.statusCode, 404);

  const ok = await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818AAAAAA', status: 'shipped' } });
  check('geçerli güncelleme 200', ok.res.statusCode, 200);
  check('sipariş kargoda', orders.get('EFM260818AAAAAA').status, 'shipped');
  check('etiket Türkçe', orders.get('EFM260818AAAAAA').statusLabel, 'Kargoda');
  check('kim güncelledi kaydedildi', orders.get('EFM260818AAAAAA').fulfillment.updatedBy, 'patron@efemiletisim.com');

  check('üye profiline yansıdı', ok.json.profileSynced, true);
  const profil = users.get('user-1').orders.find(o => o.id === 'EFM260818AAAAAA');
  check('profildeki durum güncel', profil.status, 'shipped');
  check('profildeki etiket güncel', profil.statusLabel, 'Kargoda');
  check('profildeki diğer sipariş bozulmadı', users.get('user-1').orders.find(o => o.id === 'ESKI123').status, 'delivered');
}

console.log('\n4) misafir siparişi');
{
  const ok = await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818BBBBBB', status: 'processing' } });
  check('güncelleme başarılı', ok.res.statusCode, 200);
  check('profil senkronu yok (misafir)', ok.json.profileSynced, false);
  check('sebep bildiriliyor', ok.json.profileSyncReason, 'guest');
  check('sipariş durumu değişti', orders.get('EFM260818BBBBBB').status, 'processing');
}

console.log('\n5) geç gelen ödeme bildirimi sevkiyatı geri almamalı');
{
  // Sipariş "Kargoda" iken PayTR bildirimi tekrar gelirse durum korunmalı
  const before = orders.get('EFM260818AAAAAA').status;
  await settleNotification({
    merchant_oid: 'EFM260818AAAAAA', status: 'success',
    total_amount: '2345900', payment_amount: '2345900',
    currency: 'TL', test_mode: '1'
  }, { source: 'test' });
  check('durum korundu', orders.get('EFM260818AAAAAA').status, before);
}

console.log('\n6) kargo takip numarası siparişe yazılır');
const mailsBeforeShip = mails.length;
{
  const r = await call(adminOrders, { method: 'POST', body: {
    orderId: 'EFM260818BBBBBB', status: 'shipped', trackingNumber: 'YK-123456789'
  }});
  check('güncelleme başarılı', r.res.statusCode, 200);
  check('takip no kaydedildi', orders.get('EFM260818BBBBBB').trackingNumber, 'YK-123456789');
  check('yanıtta takip no dönüyor', r.json.trackingNumber, 'YK-123456789');
}

console.log('\n7) durum değişince müşteriye mail gider');
{
  const yeni = mails.slice(mailsBeforeShip);
  check('tek yeni mail', yeni.length, 1);
  check('konu kargo maili', yeni[0].subject.includes('kargoya verildi'), true);
  check('takip numarası mailde var', yeni[0].html.includes('YK-123456789'), true);
}

console.log('\n8) aynı durumu tekrar kaydetmek ikinci mail üretmez');
{
  const before = mails.length;
  await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818BBBBBB', status: 'shipped' } });
  check('yeni mail yok', mails.length, before);
}

console.log('\n9) geçersiz takip numarası reddedilir');
{
  const bad = await call(adminOrders, { method: 'POST', body: {
    orderId: 'EFM260818BBBBBB', status: 'shipped', trackingNumber: 'YK 123/456'
  }});
  check('400 döner', bad.res.statusCode, 400);
  check('hata kodu', bad.json.code, 'invalid_tracking');
  check('takip no değişmedi', orders.get('EFM260818BBBBBB').trackingNumber, 'YK-123456789');

  const long = await call(adminOrders, { method: 'POST', body: {
    orderId: 'EFM260818BBBBBB', status: 'shipped', trackingNumber: 'A'.repeat(65)
  }});
  check('65 karakter reddedilir', long.res.statusCode, 400);
}

console.log('\n10) teslim maili cayma hakkını hatırlatır');
{
  await call(adminOrders, { method: 'POST', body: { orderId: 'EFM260818BBBBBB', status: 'delivered' } });
  const d = mails.filter(m => m.subject.includes('teslim edildi'));
  check('teslim maili gitti', d.length, 1);
  check('14 gün geçiyor', d[0].html.includes('14'), true);
}

console.log('\n11) müşteri talepleri kutusu — sorular');
{
  const adminInbox = require('../api/admin/inbox.js');
  questions.set('q1', { id: 'q1', productId: 1, question: 'Kutuda şarj aleti var mı?', answer: null });
  questions.set('q2', { id: 'q2', productId: 2, question: 'Suya dayanıklı mı?', answer: 'Evet, 5ATM.' });
  alerts.set('a1', { id: 'a1', productId: 1, email: 'musteri@example.com', createdAt: null });

  const list = await call(adminInbox, { method: 'GET', query: { type: 'questions' } });
  check('liste 200', list.res.statusCode, 200);
  check('soru sayısı', list.json.count, 2);
  check('yanıtsız sayısı', list.json.unanswered, 1);

  const ans = await call(adminInbox, { method: 'POST', body: {
    type: 'question', id: 'q1', answer: 'Evet, 20W adaptör kutuda geliyor.'
  }});
  check('yanıt kaydedildi', ans.res.statusCode, 200);
  check('yanıt siparişe yazıldı', questions.get('q1').answer, 'Evet, 20W adaptör kutuda geliyor.');
  check('yanıtlayan kaydedildi', questions.get('q1').answeredBy, 'patron@efemiletisim.com');

  const cleared = await call(adminInbox, { method: 'POST', body: { type: 'question', id: 'q1', answer: null } });
  check('yanıt kaldırıldı', cleared.res.statusCode, 200);
  check('yanıt null', questions.get('q1').answer, null);

  const tooShort = await call(adminInbox, { method: 'POST', body: { type: 'question', id: 'q2', answer: 'x' } });
  check('tek harflik yanıt 400', tooShort.res.statusCode, 400);

  const missing = await call(adminInbox, { method: 'POST', body: {
    type: 'question', id: 'yok', answer: 'Geçerli uzunlukta bir yanıt.'
  }});
  check('olmayan soru 404', missing.res.statusCode, 404);
}

console.log('\n12) müşteri talepleri kutusu — stok bildirimleri');
{
  const adminInbox = require('../api/admin/inbox.js');
  const list = await call(adminInbox, { method: 'GET', query: { type: 'alerts' } });
  check('liste 200', list.res.statusCode, 200);
  check('talep sayısı', list.json.count, 1);
  check('e-posta dönüyor', list.json.alerts[0].email, 'musteri@example.com');

  const del = await call(adminInbox, { method: 'DELETE', body: { type: 'alert', id: 'a1' } });
  check('silindi', del.res.statusCode, 200);
  check('kayıt gitti', alerts.size, 0);

  const bad = await call(adminInbox, { method: 'GET', query: { type: 'baska' } });
  check('geçersiz tür 400', bad.res.statusCode, 400);
}

console.log('\n13) talepler kutusu yetkisiz erişime kapalı');
{
  const adminInbox = require('../api/admin/inbox.js');
  const saved = tokenIdentity;
  tokenIdentity = null;
  const anon = await call(adminInbox, { method: 'GET', query: { type: 'questions' } });
  check('kimliksiz 401', anon.res.statusCode, 401);
  tokenIdentity = saved;
}

console.log(`\n${passed} test geçti, ${failed} test başarısız.\n`);
process.exit(failed ? 1 : 0);
