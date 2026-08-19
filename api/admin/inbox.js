'use strict';

/* =========================================
   /api/admin/inbox — müşteri talepleri kutusu
   =========================================
   İki koleksiyon buradan yönetilir:

   - `productQuestions` : ürün detayında sorulan sorular. Müşteri soruyu
     yazabiliyordu ama yanıtlamanın panelde karşılığı yoktu; yanıt yalnız
     Firebase Console'dan elle yazılabiliyordu (pratikte hiç yazılmıyordu).
   - `stockAlerts` : "gelince haber ver" talepleri. Kayıt ediliyordu ama
     hiçbir yerden OKUNMUYORDU — talep eden müşteriye asla dönülemiyordu.

   GET  ?type=questions|alerts   → listeyi getir
   POST { type:'question', id, answer } → soruyu yanıtla
   POST { type:'question', id, answer:null } → yanıtı kaldır
   DELETE { type, id }           → kaydı sil (spam temizliği)

   Yetki sunucuda: Firebase ID token + doğrulanmış e-posta + ADMIN_EMAILS.
   `stockAlerts` müşteri e-postası içerir; bu yüzden okuma yalnız yöneticiye
   açıktır (firestore.rules istemciye okumayı tamamen kapatır).             */

const { methodNotAllowed, json, fail, parseBody, rateLimit, clientIp } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const { clean } = require('../_lib/orders');
const store = require('../_lib/store');

const MAX_ANSWER_LENGTH = 2000;

module.exports = async (req, res) => {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  }

  const limit = rateLimit(`inbox:${clientIp(req)}`, { limit: 120, windowMs: 60 * 1000 });
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Çok fazla istek gönderildi.');

  if (!store.isStoreConfigured()) {
    return fail(res, 503, 'store_unavailable',
      'Sunucuda FIREBASE_SERVICE_ACCOUNT tanımlanmalı.');
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    const status = auth.code === 'unauthenticated' ? 401
      : auth.code === 'admin_not_configured' ? 503
      : 403;
    return fail(res, status, auth.code, auth.message);
  }

  if (req.method === 'GET')    return listHandler(req, res);
  if (req.method === 'POST')   return answerHandler(req, res, auth.admin);
  return deleteHandler(req, res, auth.admin);
};

async function listHandler(req, res) {
  const type = String((req.query || {}).type || 'questions');

  if (type === 'alerts') {
    let alerts;
    try {
      alerts = await store.listStockAlerts({ limit: 300 });
    } catch (err) {
      console.error('[inbox] stok bildirimleri okunamadı: %s', err.message);
      return fail(res, 503, 'list_failed', 'Stok bildirimleri okunamadı.');
    }
    return json(res, 200, { ok: true, type, count: alerts.length, alerts });
  }

  if (type !== 'questions') {
    return fail(res, 400, 'invalid_type', "type yalnız 'questions' veya 'alerts' olabilir.");
  }

  let questions;
  try {
    questions = await store.listProductQuestions({ limit: 300 });
  } catch (err) {
    console.error('[inbox] sorular okunamadı: %s', err.message);
    return fail(res, 503, 'list_failed', 'Sorular okunamadı.');
  }

  return json(res, 200, {
    ok: true,
    type,
    count: questions.length,
    unanswered: questions.filter(q => !q.answer).length,
    questions
  });
}

async function answerHandler(req, res, admin) {
  const body = parseBody(req);
  const type = String(body.type || 'question');
  const id   = String(body.id || '').trim();

  if (type !== 'question') {
    return fail(res, 400, 'invalid_type', 'Yalnız soru yanıtlanabilir.');
  }
  if (!id || id.length > 200) {
    return fail(res, 400, 'invalid_id', 'Kayıt kimliği geçersiz.');
  }

  /* answer null/boş gönderilirse yanıt KALDIRILIR (yanlış yanıtı geri alma). */
  const hasAnswer = body.answer !== null && body.answer !== undefined && String(body.answer).trim() !== '';
  const answer = hasAnswer ? clean(body.answer, MAX_ANSWER_LENGTH) : null;

  if (hasAnswer && answer.length < 2) {
    return fail(res, 400, 'invalid_answer', 'Yanıt çok kısa.');
  }

  let result;
  try {
    result = await store.answerProductQuestion(id, answer, admin.email);
  } catch (err) {
    console.error('[inbox] soru yanıtlanamadı (%s): %s', id, err.message);
    return fail(res, 503, 'update_failed', 'Yanıt kaydedilemedi.');
  }

  if (!result.applied && result.reason === 'not_found') {
    return fail(res, 404, 'not_found', 'Soru bulunamadı.');
  }

  return json(res, 200, { ok: true, id, answered: Boolean(answer) });
}

async function deleteHandler(req, res, admin) {
  const body = parseBody(req);
  const type = String(body.type || '');
  const id   = String(body.id || '').trim();

  if (!['question', 'alert'].includes(type)) {
    return fail(res, 400, 'invalid_type', "type yalnız 'question' veya 'alert' olabilir.");
  }
  if (!id || id.length > 200) {
    return fail(res, 400, 'invalid_id', 'Kayıt kimliği geçersiz.');
  }

  try {
    await store.deleteInboxItem(type === 'question' ? 'productQuestions' : 'stockAlerts', id);
  } catch (err) {
    console.error('[inbox] kayıt silinemedi (%s/%s): %s', type, id, err.message);
    return fail(res, 503, 'delete_failed', 'Kayıt silinemedi.');
  }

  console.log('[inbox] kayıt silindi: %s/%s by=%s', type, id, admin.email);
  return json(res, 200, { ok: true, id, deleted: true });
}
