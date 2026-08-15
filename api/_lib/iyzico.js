/* =========================================
   efemiletisim.com – iyzico istemcisi (Node SDK)
   ========================================= */

const Iyzipay = require('iyzipay');

function getIyzipayClient() {
  const apiKey    = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const uri       = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';

  if (!apiKey || !secretKey) {
    throw new Error(
      'iyzico ortam değişkenleri eksik: IYZICO_API_KEY, IYZICO_SECRET_KEY (bkz. .env.example).'
    );
  }

  return new Iyzipay({ apiKey, secretKey, uri });
}

/* iyzico SDK callback-style çalışır, Promise'e sarıyoruz. */
function iyzicoRequest(resource, method, request) {
  const iyzipay = getIyzipayClient();
  return new Promise((resolve, reject) => {
    iyzipay[resource][method](request, (err, result) => {
      if (err) { reject(err); return; }
      resolve(result);
    });
  });
}

module.exports = { Iyzipay, getIyzipayClient, iyzicoRequest };
