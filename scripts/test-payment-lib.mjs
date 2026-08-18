#!/usr/bin/env node
/* =========================================
   Ödeme kütüphanesi birim testleri (bağımlılıksız)
   =========================================
   Ağ/gerçek PayTR çağrısı yapmaz. Doğruladıkları:
   - PayTR token imzası (paytr_token) ve bildirim imzası (hash)
   - Tutarın kuruşa çevrimi ve sepet (user_basket) biçimi
   - merchant_oid kuralı: alfanumerik, en fazla 64 karakter
   - Sunucu tarafı sepet fiyatlaması ve varyant (sku) doğrulaması
   - Sipariş erişim jetonu

   Çalıştırma: npm run test:payment                                        */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.PAYTR_MERCHANT_ID   ||= '123456';
process.env.PAYTR_MERCHANT_KEY  ||= 'test-merchant-key';
process.env.PAYTR_MERCHANT_SALT ||= 'test-merchant-salt';
process.env.ORDER_TOKEN_SECRET  ||= 'unit-test-order-secret';

const paytr  = require('../api/_lib/paytr.js');
const orders = require('../api/_lib/orders.js');
const { paytrConfig } = require('../api/_lib/env.js');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else    { failed++; console.error(`  FAIL ${name}\n       beklenen: ${JSON.stringify(expected)}\n       gelen   : ${JSON.stringify(actual)}`); }
}

function truthy(name, value) {
  check(name, Boolean(value), true);
}

const cfg = paytrConfig();

console.log('\ntutar ve sepet biçimi');
check('7.499,00 ₺ → kuruş', paytr.amountFromKurus(749900), '749900');
check('12,50 ₺ → kuruş',    paytr.amountFromKurus(1250),   '1250');
check('birim fiyat metni',  paytr.priceText(749900),       '7499.00');
check('birim fiyat metni (kuruşlu)', paytr.priceText(1250), '12.50');
{
  const basket = paytr.buildBasket([
    { name: 'Örnek Ürün (Jet Siyah · S/M)', unitKurus: 1800, qty: 1 },
    { name: 'İkinci Ürün', unitKurus: 3325, qty: 2 }
  ]);
  const decoded = JSON.parse(Buffer.from(basket, 'base64').toString('utf8'));
  check('sepet PayTR biçiminde', decoded, [
    ['Örnek Ürün (Jet Siyah · S/M)', '18.00', 1],
    ['İkinci Ürün', '33.25', 2]
  ]);
}

console.log('\nmerchant_oid kuralı (PayTR: alfanumerik, ≤64)');
truthy('üretilen sipariş no geçerli', paytr.isValidMerchantOid(orders.newOrderId()));
check('tireli id reddedilir',    paytr.isValidMerchantOid('EFM260817-A5973E'), false);
check('boşluklu id reddedilir',  paytr.isValidMerchantOid('EFM 260817'), false);
check('alt çizgi reddedilir',    paytr.isValidMerchantOid('EFM_260817'), false);
check('65 karakter reddedilir',  paytr.isValidMerchantOid('A'.repeat(65)), false);
check('64 karakter kabul',       paytr.isValidMerchantOid('A'.repeat(64)), true);
truthy('eski tireli id hâlâ okunabiliyor', orders.isValidOrderId('EFM260817-A5973E'));
truthy('yeni id geçerli', orders.isValidOrderId(orders.newOrderId()));

console.log('\npaytr_token (1. adım imzası)');
{
  const fields = {
    user_ip: '85.34.78.112',
    merchant_oid: 'EFM260817A5973E',
    email: 'ali@example.com',
    payment_amount: '749900',
    user_basket: paytr.buildBasket([{ name: 'Ürün', unitKurus: 749900, qty: 1 }]),
    no_installment: '1',
    max_installment: '0',
    currency: 'TL',
    test_mode: '1'
  };

  // PayTR dokümanındaki formülün bağımsız uygulaması
  const expected = crypto.createHmac('sha256', cfg.merchantKey).update(
    cfg.merchantId + fields.user_ip + fields.merchant_oid + fields.email +
    fields.payment_amount + fields.user_basket + fields.no_installment +
    fields.max_installment + fields.currency + fields.test_mode + cfg.merchantSalt
  ).digest('base64');

  check('token imzası dokümandaki formülle aynı', paytr.tokenHash(fields, cfg), expected);

  const tampered = { ...fields, payment_amount: '1' };
  truthy('tutar değişince imza değişir', paytr.tokenHash(tampered, cfg) !== expected);
}

console.log('\nbildirim imzası (2. adım)');
{
  const payload = { merchant_oid: 'EFM260817A5973E', status: 'success', total_amount: '749900' };
  const valid = crypto.createHmac('sha256', cfg.merchantKey)
    .update(payload.merchant_oid + cfg.merchantSalt + payload.status + payload.total_amount)
    .digest('base64');

  check('hash dokümandaki formülle aynı', paytr.notificationHash(payload, cfg), valid);
  truthy('geçerli imza kabul edilir', paytr.verifyNotification({ ...payload, hash: valid }, cfg));
  check('bozuk imza reddedilir', paytr.verifyNotification({ ...payload, hash: valid.replace(/.$/, 'X') }, cfg), false);
  check('imzasız bildirim reddedilir', paytr.verifyNotification(payload, cfg), false);
  check('tutar değiştirilirse imza tutmaz',
    paytr.verifyNotification({ ...payload, total_amount: '1', hash: valid }, cfg), false);
  check('durum değiştirilirse imza tutmaz',
    paytr.verifyNotification({ ...payload, status: 'failed', hash: valid }, cfg), false);
}

console.log('\nPayTR alan temizleme');
check('e-postada Türkçe karakter sadeleşir', paytr.asciiSafe('çğıöşü@örnek.com', 100), 'cgiosu@ornek.com');
check('uzunluk sınırlanır', paytr.asciiSafe('x'.repeat(500), 10).length, 10);

/* Katalog js/data.js'ten üretildiği için test verisi de oradan alınır;
   fiyat/sku değiştiğinde testler kendiliğinden uyum sağlar. */
const catalog = require('../api/_lib/catalog.json');
const P1 = catalog.products[0];
const P2 = catalog.products[1];
const SKU1 = P1.variants[0].sku;
const SKU1B = P1.variants[1].sku;
const SKU2 = P2.variants[0].sku;

console.log('\npriceBasket — sunucu otoritesi');
{
  const ok = await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 2 }]);
  check('bilinen ürün fiyatlanır', ok.totalKurus, P1.priceKurus * 2);

  // İstemcinin gönderdiği fiyat alanı YOK SAYILIR
  const tampered = await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 1, price: 1, total: 1 }]);
  check('istemci fiyatı yok sayılır', tampered.totalKurus, P1.priceKurus);

  truthy('bilinmeyen ürün reddedilir', (await orders.priceBasket([{ id: 999999, sku: SKU1, qty: 1 }])).error);
  truthy('sıfır adet reddedilir',      (await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 0 }])).error);
  truthy('negatif adet reddedilir',    (await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: -3 }])).error);
  truthy('aşırı adet reddedilir',      (await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 999 }])).error);
  truthy('aynı varyant iki satırda reddedilir',
    (await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 1 }, { id: P1.id, sku: SKU1, qty: 1 }])).error);
  truthy('boş sepet reddedilir',       (await orders.priceBasket([])).error);
}

console.log('\nvaryantlar');
{
  truthy('sku eksikse reddedilir', (await orders.priceBasket([{ id: P1.id, qty: 1 }])).error);
  truthy('sahte sku reddedilir',   (await orders.priceBasket([{ id: P1.id, sku: 'YOK-123', qty: 1 }])).error);
  truthy('başka ürünün sku\'su reddedilir', (await orders.priceBasket([{ id: P1.id, sku: SKU2, qty: 1 }])).error);

  const twoColors = await orders.priceBasket([
    { id: P1.id, sku: SKU1,  qty: 1 },
    { id: P1.id, sku: SKU1B, qty: 2 }
  ]);
  check('iki varyant ayrı satır', twoColors.lines?.length, 2);
  check('toplam doğru', twoColors.totalKurus, P1.priceKurus * 3);

  const spoofed = await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 1, color: 'Altın Sarısı', size: 'XXL' }]);
  check('renk katalogdan', spoofed.lines[0].color, P1.variants[0].color);
  check('beden katalogdan', spoofed.lines[0].size, P1.variants[0].size);
  check('sku kaydedilir', spoofed.lines[0].sku, SKU1);
  check('satır başlığı', orders.lineTitle(spoofed.lines[0]),
    `${P1.name} (${[P1.variants[0].color, P1.variants[0].size].filter(Boolean).join(' · ')})`);
}

console.log('\nsepet toplamı = PayTR user_basket toplamı');
{
  const basket = await orders.priceBasket([{ id: P1.id, sku: SKU1, qty: 2 }, { id: P2.id, sku: SKU2, qty: 1 }]);
  const encoded = paytr.buildBasket(basket.lines.map(l => ({ name: l.name, unitKurus: l.unitKurus, qty: l.qty })));
  const rows = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const sum = rows.reduce((s, [, price, qty]) => s + Math.round(Number(price) * 100) * qty, 0);
  check('sepet satırları toplamı = sipariş toplamı', sum, basket.totalKurus);
  check('gönderilecek payment_amount', paytr.amountFromKurus(basket.totalKurus), String(basket.totalKurus));
}

console.log('\nalıcı doğrulama');
{
  truthy('geçersiz e-posta reddedilir', orders.validateBuyer({ ad: 'Ali', soyad: 'Veli', email: 'ali@', telefon: '05001112233' }).error);
  truthy('geçersiz telefon reddedilir', orders.validateBuyer({ ad: 'Ali', soyad: 'Veli', email: 'a@b.com', telefon: '1234' }).error);
  check('geçerli alıcı', orders.validateBuyer({ ad: 'Ali', soyad: 'Veli', email: 'A@B.com', telefon: '0500 111 22 33' }).buyer.email, 'a@b.com');
}

console.log('\nsipariş kimliği ve erişim jetonu');
{
  const id = orders.newOrderId();
  truthy('id biçimi geçerli', orders.isValidOrderId(id));
  check('uydurma id reddedilir', orders.isValidOrderId('EFM123456'), false);
  const token = orders.orderAccessToken(id);
  truthy('doğru jeton kabul edilir', orders.verifyOrderAccessToken(id, token));
  check('yanlış jeton reddedilir', orders.verifyOrderAccessToken(id, 'a'.repeat(32)), false);
  check('başka siparişin jetonu reddedilir', orders.verifyOrderAccessToken(orders.newOrderId(), token), false);
}

console.log('\nmetin temizleme');
{
  check('kontrol karakterleri ayıklanır', orders.clean('a bc'), 'a b c');
  check('uzunluk sınırlanır', orders.clean('x'.repeat(500), 10).length, 10);
}


/* ─── İade ve durum sorgu servisleri ───
   Her servisin imza alan sırası FARKLIDIR. Sıra yanlış olursa PayTR isteği
   reddeder ama kod sessizce "başarısız" görünür; testler sırayı bağımsız
   hesaplayarak sabitler. */

console.log('\nkuruş ↔ ondalık dönüşümü (durum sorgu yanıtı)');
{
  check('"10.8" → kuruş',    paytr.kurusFromDecimal('10.8'),  1080);
  check('"10.25" → kuruş',   paytr.kurusFromDecimal('10.25'), 1025);
  check('"0.76" → kuruş',    paytr.kurusFromDecimal('0.76'),    76);
  check('virgüllü değer',    paytr.kurusFromDecimal('10,25'), 1025);
  check('boş değer null',    paytr.kurusFromDecimal(''),      null);
  check('sayı olmayan null', paytr.kurusFromDecimal('abc'),   null);
  // Kayan nokta tuzağı: 10.8 * 100 = 1080.0000000000001
  check('kayan nokta hatası yuvarlanır', Number.isInteger(paytr.kurusFromDecimal('10.8')), true);
}

console.log('\niade imzası (merchant_id + merchant_oid + return_amount + merchant_salt)');
{
  const fields = { merchant_oid: 'EFM2608181A2B3C', return_amount: '149.90' };
  const expected = crypto
    .createHmac('sha256', cfg.merchantKey)
    .update(cfg.merchantId + fields.merchant_oid + fields.return_amount + cfg.merchantSalt)
    .digest('base64');

  check('iade imzası doğru üretiliyor', paytr.refundHash(fields, cfg), expected);

  // Alan sırası bozulursa imza DEĞİŞMELİ
  const wrongOrder = crypto
    .createHmac('sha256', cfg.merchantKey)
    .update(cfg.merchantId + fields.return_amount + fields.merchant_oid + cfg.merchantSalt)
    .digest('base64');
  truthy('yanlış alan sırası farklı imza üretir', paytr.refundHash(fields, cfg) !== wrongOrder);

  // İade tutarı ONDALIKLI gider (token servisindeki kuruş biçiminden farklı)
  check('iade tutarı ondalıklı biçimde', paytr.priceText(14990), '149.90');
  truthy('token servisi ile aynı DEĞİL', paytr.amountFromKurus(14990) !== paytr.priceText(14990));
}

console.log('\ndurum sorgu imzası (merchant_id + merchant_oid + merchant_salt)');
{
  const fields = { merchant_oid: 'EFM2608181A2B3C' };
  const expected = crypto
    .createHmac('sha256', cfg.merchantKey)
    .update(cfg.merchantId + fields.merchant_oid + cfg.merchantSalt)
    .digest('base64');

  check('durum sorgu imzası doğru üretiliyor', paytr.statusHash(fields, cfg), expected);

  // Durum sorguda tutar YOKTUR; aynı sipariş için iade imzasıyla karışmamalı
  const refundSig = paytr.refundHash({ merchant_oid: fields.merchant_oid, return_amount: '149.90' }, cfg);
  truthy('aynı sipariş için iade imzasından farklı', paytr.statusHash(fields, cfg) !== refundSig);
}

console.log('\nmutabakat karşılaştırması');
{
  const reconcile = require('../api/admin/reconcile.js');
  const paidOrder = { status: 'paid', totalKurus: 14990, refundedKurus: 0, environment: 'production' };

  const match = reconcile.compare(paidOrder, {
    status: 'success', paymentTotalKurus: 14990, returns: [], testMode: false
  });
  check('tutar tutuyorsa sorun yok', match.problems.length, 0);
  truthy('mutabık', match.agrees);

  const mismatch = reconcile.compare(paidOrder, {
    status: 'success', paymentTotalKurus: 9990, returns: [], testMode: false
  });
  check('tutar farkı yakalanır', mismatch.problems[0].code, 'amount_mismatch');
  check('mutabık değil', mismatch.agrees, false);

  const ghostRefund = reconcile.compare(paidOrder, {
    status: 'success', paymentTotalKurus: 14990,
    returns: [{ return_amount: '50.00' }], testMode: false
  });
  check('panelden yapılan iade yakalanır', ghostRefund.problems[0].code, 'refund_mismatch');

  const notPaidLocally = reconcile.compare(
    { ...paidOrder, status: 'awaiting_payment' },
    { status: 'success', paymentTotalKurus: 14990, returns: [], testMode: false }
  );
  check('bildirim kaçmışsa yakalanır', notPaidLocally.problems[0].code, 'remote_paid_local_not');

  const testInProd = reconcile.compare(paidOrder, {
    status: 'success', paymentTotalKurus: 14990, returns: [], testMode: true
  });
  truthy('canlı siparişte test işlemi yakalanır',
    testInProd.problems.some(p => p.code === 'environment_mismatch'));
}

console.log('\nBDDK taksit tavanı (elektronik katalog)');
{
  const envLib = require('../api/_lib/env.js');
  const savedMax = process.env.PAYTR_MAX_INSTALLMENT;
  const savedNo  = process.env.PAYTR_NO_INSTALLMENT;

  process.env.PAYTR_NO_INSTALLMENT  = '0';
  process.env.PAYTR_MAX_INSTALLMENT = '12';
  const capped = envLib.installmentSettings();
  check('12 taksit tavana kırpılır', capped.maxInstallment, envLib.BDDK_ELECTRONICS_MAX_INSTALLMENT);
  check('istenen değer raporlanır',  capped.requestedMaxInstallment, 12);

  process.env.PAYTR_MAX_INSTALLMENT = '2';
  check('tavan altı değer korunur', envLib.installmentSettings().maxInstallment, 2);

  delete process.env.PAYTR_NO_INSTALLMENT;
  delete process.env.PAYTR_MAX_INSTALLMENT;
  const def = envLib.installmentSettings();
  check('varsayılan: taksit kapalı', def.noInstallment, 1);
  check('varsayılan: max 0',         def.maxInstallment, 0);

  if (savedMax !== undefined) process.env.PAYTR_MAX_INSTALLMENT = savedMax;
  if (savedNo  !== undefined) process.env.PAYTR_NO_INSTALLMENT  = savedNo;
}

console.log(`\n${passed} test geçti, ${failed} test başarısız.\n`);
process.exit(failed ? 1 : 0);
