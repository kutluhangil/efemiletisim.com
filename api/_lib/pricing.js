/* =========================================
   efemiletisim.com – Sunucu tarafı fiyat doğrulama
   =========================================
   Sepet toplamı ASLA client'tan gelen `total` değerine güvenilerek alınmaz.
   Burada js/data.js içindeki BASE_PRODUCTS (tek doğruluk kaynağı) üzerinden
   yeniden hesaplanır. Böylece DevTools ile fiyat/toplam değiştirme (TC-PRICE-TAMPER)
   ödeme adımına hiç ulaşamaz.
   ========================================= */

const path = require('path');
const { BASE_PRODUCTS } = require(path.join(__dirname, '..', '..', 'js', 'data.js'));

const FREE_SHIPPING = 0;

/* cart.js'teki COUPONS objesinin sunucu tarafı yansıması.
   ⚠️ İkisi birlikte güncellenmeli — bkz. js/cart.js. Şu an tek kupon (EFEM500)
   enabled:false olduğu için pratikte devre dışı. */
const COUPONS = {
  EFEM500: { type: 'fixed', value: 500, minSubtotal: 5000, enabled: false }
};

class PricingError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'PRICING_ERROR';
  }
}

/* items: [{ id, qty }] — client sepetinden sadece id + qty güvenilir kabul edilir,
   isim/fiyat/kategori gibi diğer alanlar yok sayılır. */
function computeServerOrder(items, couponCode) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError('Sepet boş.', 'EMPTY_CART');
  }

  const resolvedItems = items.map(({ id, qty }) => {
    const product = BASE_PRODUCTS.find(p => p.id === parseInt(id, 10));
    if (!product) {
      throw new PricingError(`Ürün bulunamadı: ${id}`, 'PRODUCT_NOT_FOUND');
    }
    const quantity = Math.max(1, Math.min(parseInt(qty, 10) || 1, product.stock));
    if (quantity < 1) {
      throw new PricingError(`Stokta yok: ${product.name}`, 'OUT_OF_STOCK');
    }
    return {
      id:       product.id,
      name:     product.name,
      category: product.categoryLabel,
      price:    product.price,
      image:    product.images[0],
      qty:      quantity
    };
  });

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.price * i.qty, 0);

  let discount = 0;
  if (couponCode) {
    const coupon = COUPONS[String(couponCode).trim().toUpperCase()];
    if (coupon && coupon.enabled && subtotal >= coupon.minSubtotal) {
      discount = coupon.type === 'percent'
        ? Math.round(subtotal * coupon.value / 100)
        : coupon.value;
    }
  }

  const shipping = FREE_SHIPPING;
  const total = Math.max(0, subtotal + shipping - discount);

  return { items: resolvedItems, subtotal, shipping, discount, total };
}

module.exports = { computeServerOrder, PricingError };
