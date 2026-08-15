/* =========================================
   efemiletisim.com – Ödeme (gerçek iyzico 3D Secure entegrasyonu)
   =========================================
   Kart bilgisi bu dosyadan asla doğrudan işlenmez/saklanmaz — sadece
   /api/create-payment'a iletilir (Vercel Function, iyzico'ya bağlanır).
   Sipariş, 3DS onayından SONRA sunucu tarafında yazılır (bkz.
   api/payment-callback.js). Bu dosya sadece: (1) backend'i çağırır,
   (2) dönen 3DS HTML'ini decode eder, (3) EFT siparişini backend'e yollar.
   ========================================= */

/* ─── Kart bilgisiyle ödeme başlat (3DS Initialize) ───
   checkoutPayload: { items, address, invoice, delivery, couponCode }
   Dönüş: { ok:true, conversationId } | { ok:false, error }
   Banka 3DS HTML'i client'a hiç gönderilmez — iframe doğrudan
   /api/threeds-frame?conversationId=...'e yönlendirilir (bkz. odeme.html
   openThreeDsModal). Sebep: site CSP'si banka sayfasının kendi
   script/domain'lerini engeller; ayrı bir endpoint kendi header'larıyla
   bu sınırlamayı by-pass eder (bkz. api/threeds-frame.js). */
async function initiateCardPayment(cardData, checkoutPayload) {
  const idToken = await (window.getIdTokenSafe ? window.getIdTokenSafe() : null);

  try {
    const res = await fetch('/api/create-payment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...checkoutPayload, card: cardData, idToken })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Ödeme başlatılamadı.' };
    return { ok: true, conversationId: data.conversationId };
  } catch (err) {
    console.error('[payment] create-payment isteği başarısız:', err);
    return { ok: false, error: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' };
  }
}

/* ─── EFT/Havale siparişi oluştur (kart/iyzico akışına girmez) ─── */
async function submitEftOrder(checkoutPayload) {
  const idToken = await (window.getIdTokenSafe ? window.getIdTokenSafe() : null);

  try {
    const res = await fetch('/api/create-order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...checkoutPayload, paymentMethod: 'eft', idToken })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Sipariş oluşturulamadı.' };
    return { ok: true, order: data.order };
  } catch (err) {
    console.error('[payment] create-order isteği başarısız:', err);
    return { ok: false, error: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' };
  }
}

/* ─── Kart numarası formatla (XXXX XXXX XXXX XXXX) ─── */
function formatCardNumber(value) {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/* ─── Son kullanma tarihi formatla (MM/YY) ─── */
function formatExpiry(value) {
  return value.replace(/\D/g, '').slice(0, 4).replace(/(\d{2})(?=\d)/, '$1/');
}

/* ─── Kart tipi algıla ─── */
function detectCardType(number) {
  const n = number.replace(/\s/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  return 'unknown';
}

/* ─── Kart input event dinleyicileri ─── */
function initPaymentForm() {
  const cardNumberInput = document.getElementById('card-number');
  const cardExpiryInput = document.getElementById('card-expiry');
  const cardCvcInput    = document.getElementById('card-cvc');
  const cardNameInput   = document.getElementById('card-name');

  if (cardNumberInput) {
    cardNumberInput.addEventListener('input', (e) => {
      e.target.value = formatCardNumber(e.target.value);
      const type = detectCardType(e.target.value);
      updateCardTypeDisplay(type);
    });
  }

  if (cardExpiryInput) {
    cardExpiryInput.addEventListener('input', (e) => {
      e.target.value = formatExpiry(e.target.value);
    });
  }

  if (cardCvcInput) {
    cardCvcInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  // Kart önizleme güncelle
  [cardNumberInput, cardExpiryInput, cardCvcInput, cardNameInput].forEach(input => {
    if (input) input.addEventListener('input', updateCardPreview);
  });
}

function updateCardTypeDisplay(type) {
  const icons = document.getElementById('card-type-icons');
  if (!icons) return;
  const cardSvg = '<svg class="icon icon-sm" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';
  const labels  = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', unknown: '' };
  icons.innerHTML = `${cardSvg} ${labels[type] || ''}`;
}

function updateCardPreview() {
  const num  = document.getElementById('card-number')?.value  || '';
  const exp  = document.getElementById('card-expiry')?.value  || '';
  const name = document.getElementById('card-name')?.value    || '';

  const previewNum  = document.getElementById('preview-number');
  const previewExp  = document.getElementById('preview-expiry');
  const previewName = document.getElementById('preview-name');

  if (previewNum)  previewNum.textContent  = num  || '•••• •••• •••• ••••';
  if (previewExp)  previewExp.textContent  = exp  || 'AA/YY';
  if (previewName) previewName.textContent = name || 'KART SAHİBİ';
}

/* ─── Ödeme form validasyonu ─── */
function validatePaymentForm(data) {
  const errors = [];

  if (!data.number || data.number.replace(/\s/g, '').length < 16) {
    errors.push({ field: 'card-number', msg: 'Geçerli bir kart numarası girin.' });
  }

  if (!data.name || data.name.trim().length < 3) {
    errors.push({ field: 'card-name', msg: 'Kart üzerindeki adı girin.' });
  }

  const expParts = (data.expiry || '').split('/');
  if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
    errors.push({ field: 'card-expiry', msg: 'Geçerli bir son kullanma tarihi girin (AA/YY).' });
  }

  if (!data.cvc || data.cvc.length < 3) {
    errors.push({ field: 'card-cvc', msg: 'Geçerli bir CVV/CVC girin.' });
  }

  return errors;
}

/* ─── Adres form validasyonu ─── */
const ADDRESS_REQUIRED_FIELDS = ['ad', 'soyad', 'telefon', 'email', 'adres', 'sehir', 'ilce'];

function validateAddressForm(data, required = ADDRESS_REQUIRED_FIELDS) {
  const errors = [];

  required.forEach(field => {
    if (!data[field] || !data[field].toString().trim()) {
      errors.push({ field: `addr-${field}`, msg: 'Bu alan zorunludur.' });
    }
  });

  if (data.telefon && !/^(\+90|0)?[5][0-9]{9}$/.test(data.telefon.replace(/\s/g, ''))) {
    errors.push({ field: 'addr-telefon', msg: 'Geçerli bir Türkiye telefon numarası girin.' });
  }

  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.push({ field: 'addr-email', msg: 'Geçerli bir e-posta adresi girin.' });
  }

  return errors;
}

/* ─── Hata mesajlarını göster ─── */
function showFormErrors(errors) {
  // Önceki hataları temizle
  document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.form-input.error, .form-select.error').forEach(el => el.classList.remove('error'));

  errors.forEach(({ field, msg }) => {
    const input = document.getElementById(field);
    const errorEl = document.getElementById(`${field}-error`);
    if (input)   input.classList.add('error');
    if (errorEl) errorEl.textContent = msg;
  });
}

/* ─── Test kartları göster (iyzico resmi sandbox kartları) ─── */
function showTestCards() {
  return `
    <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:var(--space-4);font-size:0.8125rem;margin-top:var(--space-4)">
      <div style="font-weight:700;margin-bottom:var(--space-2);color:var(--primary)">Test Kartları (Sandbox Modu — iyzico resmi test kartları)</div>
      <div style="display:grid;gap:var(--space-2)">
        <div><svg class="icon icon-sm" viewBox="0 0 24 24" style="color:var(--success)"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/></svg> <code style="background:var(--surface);padding:2px 6px;border-radius:4px">5528 7900 0000 0008</code> → Başarılı ödeme (Mastercard)</div>
        <div><svg class="icon icon-sm" viewBox="0 0 24 24" style="color:var(--error)"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg> <code style="background:var(--surface);padding:2px 6px;border-radius:4px">4111 1111 1111 1129</code> → Yetersiz bakiye</div>
        <div><svg class="icon icon-sm" viewBox="0 0 24 24" style="color:var(--error)"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg> <code style="background:var(--surface);padding:2px 6px;border-radius:4px">4124 1111 1111 1116</code> → Geçersiz CVC</div>
      </div>
      <div style="margin-top:var(--space-2);color:var(--text-muted)">Son Tarih: gelecekte herhangi bir tarih / CVV: herhangi 3 hane. Kaynak: docs.iyzico.com/testing</div>
    </div>
  `;
}
