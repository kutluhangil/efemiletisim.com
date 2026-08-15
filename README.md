<div align="center">
  <img src="assets/logos/logo-full.png" alt="efem iletişim" width="220">

  <h1>efemiletisim.com</h1>
  <p><strong>Akıllı saat, kulaklık ve tablet aksesuar mağazası</strong> — Vanilla JS + Firebase ile inşa edilmiş, statik hosting üzerinde çalışan hızlı bir e-ticaret sitesi.</p>

  <p>
    <img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JS">
    <img src="https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?style=flat-square&logo=firebase&logoColor=black" alt="Firebase">
    <img src="https://img.shields.io/badge/Hosting-Vercel-000000?style=flat-square&logo=vercel" alt="Vercel">
    <img src="https://img.shields.io/badge/Payment-iyzico%20(3DS%20%2B%20Vercel%20Functions)-2563EB?style=flat-square" alt="iyzico 3DS">
    <img src="https://img.shields.io/badge/license-Proprietary-lightgrey?style=flat-square" alt="License">
  </p>
</div>

---

## Ekran Görüntüleri

| Ana Sayfa | Ürün Listeleme |
|---|---|
| ![Ana Sayfa](docs/screenshots/home.jpg) | ![Ürünler](docs/screenshots/products.jpg) |

| Ürün Detay | Sepet |
|---|---|
| ![Ürün Detay](docs/screenshots/product-detail.jpg) | ![Sepet](docs/screenshots/cart.jpg) |

---

## Özellikler

- **Ürün kataloğu** — kategori (saat / kulaklık / tablet) ve marka bazlı filtreleme, fiyat aralığı, minimum puan, sıralama (fiyat/puan/yeni/öne çıkan)
- **Canlı arama** — navbar üzerinden anlık ürün/marka arama dropdown'u
- **Ürün detay** — galeri, teknik özellik tablosu, ilgili ürünler, stok durumu
- **Favoriler** — localStorage tabanlı, profil sayfasında listeleniyor
- **Sepet** — miktar güncelleme, kupon kodu desteği (altyapı hazır, kampanya aktif edilmeyi bekliyor)
- **Ödeme akışı** — adres formu + kart formu, gerçek iyzico 3D Secure entegrasyonu (Vercel
  Functions backend, `/api`), EFT/Havale alternatifi, sunucu tarafında fiyat doğrulama
- **Üyelik** — Firebase Authentication (e-posta doğrulama dahil), Firestore'da sipariş/favori geçmişi
- **Hesap paneli** — sipariş geçmişi, favoriler, adres ve profil yönetimi
- **Admin paneli** (`admin.html`) — Firebase Authentication ("admin" custom claim) ile korunan
  ürün yönetimi + Firestore tabanlı sipariş yönetimi arayüzü
- **Kurumsal tek-kaynak yapı** — tüm marka/iletişim/yasal bilgiler `js/site-config.js`'ten besleniyor, sayfalarda tekrar yok
- **SEO** — `sitemap.xml`, `robots.txt`, Organization/Product schema.org enjeksiyonu
- **Yasal sayfalar** — KVKK/gizlilik, mesafeli satış sözleşmesi, iptal/iade
- **Güvenlik başlıkları** — CSP, HSTS, X-Frame-Options vb. `vercel.json` üzerinden
- **Mikro etkileşimler** — magnetic hover butonlar, scroll-reveal, sayaç animasyonları

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Frontend | Vanilla HTML5 / CSS3 / JavaScript (framework yok, build adımı yok) |
| Kimlik doğrulama & veri | Firebase Authentication + Firestore |
| Ödeme | iyzico 3D Secure API (Vercel Functions, `/api`) — şu an sandbox anahtarlarıyla, production'a geçiş için `docs/ARKADAS-YAPILACAKLAR.md` |
| Hosting | Vercel (`vercel.json`) + Firebase Hosting yapılandırması (`firebase.json`) |
| Diğer | localStorage (sepet/favoriler), schema.org JSON-LD, CSP güvenlik başlıkları |

## Proje Yapısı

```
├─ index.html, urunler.html, urun-detay.html,
│  sepet.html, odeme.html, hesap.html, profil.html,
│  hakkimizda.html, admin.html          → sayfalar (routing nedeniyle kökte)
├─ css/                                  → main / components / pages
├─ js/
│  ├─ site-config.js                     → TEK kaynak: marka, iletişim, yasal künye
│  ├─ data.js                            → ürün kataloğu (Vercel Functions'tan da require edilir)
│  ├─ products.js                        → filtre, arama, favori, ürün kartı
│  ├─ cart.js                            → sepet, kupon, toplam hesaplama
│  ├─ payment.js                         → ödeme formu + iyzico 3DS backend çağrıları
│  ├─ auth.js / firebase-auth.js         → üyelik, Firestore sipariş/favori
│  └─ main.js                            → navbar, toast, animasyonlar, SEO schema
├─ api/                                  → Vercel Functions: iyzico ödeme + sipariş backend'i
│  └─ _lib/                              → firebaseAdmin, pricing, orders, iyzico ortak kodu
├─ scripts/                              → set-admin-claim.js (admin yetkisi atama CLI'ı)
├─ assets/                               → images, icons, logos
├─ docs/                                 → RAPOR.md, ARKADAS-YAPILACAKLAR.md, screenshots
├─ vercel.json / firebase.json           → hosting + güvenlik başlıkları
├─ firestore.rules                       → users / orders / paymentAttempts / vb. kuralları
└─ sitemap.xml / robots.txt
```

## Kurulum

Build adımı yok — statik dosyalar. Yerelde çalıştırmak için herhangi bir statik sunucu yeterli:

```bash
python3 -m http.server 8000
# veya
npx serve .
```

Ardından `http://localhost:8000` adresini açın.

Firebase bağlantısı için `js/firebase-config.js` içindeki proje anahtarlarını kendi Firebase projenizle güncelleyin.

## Durum

Ödeme akışı gerçek iyzico 3D Secure entegrasyonu ile çalışıyor (Vercel Functions backend,
`/api`), şu an sandbox anahtarlarıyla test modunda. Production'a geçiş — iyzico merchant
başvurusu, gerçek API anahtarları, admin hesabı kurulumu — için `docs/ARKADAS-YAPILACAKLAR.md`.

---

<div align="center">
  <sub>© 2026 efemiletisim.com — Efem İletişim Teknoloji San. ve Tic. Ltd. Şti.</sub>
</div>
