# efemiletisim.com — Arkadaşın Yapacakları (hesap erişimi gerektiren adımlar)

Bu dosya artık bir "AI'ye yaptır" prompt listesi değil — **kodu tamamladım, geri kalanı senin
hesaplarında (Vercel, Firebase, iyzico) elle/CLI ile yapman gereken adımlar**. Kod tarafında
yapılabilecek her şeyi (gerçek iyzico entegrasyonu, admin panelinin Firebase Auth'a taşınması,
sipariş yönetimi) zaten yazdım — aşağıdaki adımlar sadece SENİN hesap bilgilerini/kimlik
bilgilerini gerektirdiği için benim tarafımdan tamamlanamadı.

Sırayla ilerle, adım 1-4 birbirine bağımlı (biri bitmeden sonraki test edilemez).

---

## 1. Bağımlılıkları kur ve ortam değişkenlerini ayarla

```
npm install
cp .env.example .env
```

`.env` içini doldur:

- **iyzico sandbox anahtarları**: [sandbox-merchant.iyzipay.com](https://sandbox-merchant.iyzipay.com)
  üzerinden ücretsiz sandbox hesabı aç, `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` değerlerini oradan al.
  `IYZICO_BASE_URL` sandbox için zaten `https://sandbox-api.iyzipay.com` olarak dolu.
- **Firebase Admin SDK bilgileri**: Firebase Console → Proje Ayarları → Servis Hesapları →
  "Yeni özel anahtar oluştur" ile bir JSON indir. İçindeki `client_email` ve `private_key`
  alanlarını `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`'e kopyala (private_key'i tek
  satırda, `\n` karakterleriyle birlikte bırak — `.env.example`'daki not aynen geçerli).
  **Bu JSON dosyasını asla commit etme** (`serviceAccountKey.json` zaten `.gitignore`'da).

## 2. Firebase — admin hesabı ve Firestore kuralları

Admin paneli artık `admin.html` içinde hardcoded şifre yerine gerçek Firebase Authentication +
"admin" custom claim kullanıyor (bkz. `admin.html` içindeki Firebase Auth modülü).

1. Firebase Console → Authentication → Add user ile kendi e-posta/şifreni admin hesabı olarak
   ekle (ya da `hesap.html` üzerinden normal kayıt olabilirsin, ikisi de olur).
2. `.env` dolu haldeyken şunu çalıştır:
   ```
   node scripts/set-admin-claim.js senin@e-postan.com
   ```
   Bu, hesabına `admin: true` custom claim'i ekler. `admin.html`'de bu claim olmayan hiçbir
   hesap panele giremez.
3. Firestore kurallarını deploy et (yeni `orders`/`paymentAttempts` koleksiyon kuralları eklendi):
   ```
   firebase login
   firebase deploy --only firestore:rules
   ```
4. `admin.html`'e git, yeni e-posta/şifrenle giriş yap. Sipariş verisi olmadığı için
   "Siparişler" sekmesi başta boş görünecek — bu normal, adım 4'te bir test siparişi vereceksin.

## 3. Vercel — environment variables + deploy

1. Bu proje zaten `vercel.json` içeriyor ve `/api` altında Vercel Functions var
   (`api/create-order.js`, `api/create-payment.js`, `api/payment-callback.js`,
   `api/payment-webhook.js`). Ekstra config gerekmiyor.
2. Vercel Dashboard → Project → Settings → Environment Variables üzerinden `.env`'deki AYNI
   değişkenleri (IYZICO_*, FIREBASE_*, SITE_URL) gir. `SITE_URL` prod'da
   `https://efemiletisim.com` olmalı — bu, iyzico'nun 3DS callback'i ve webhook imza
   doğrulamasının doğru host'a gitmesi için kritik.
3. `vercel --prod` ile deploy et (ya da GitHub entegrasyonuysa push sonrası otomatik deploy olur).

## 4. Uçtan uca sandbox testi (deploy sonrası)

1. Canlı/preview URL'de sepete ürün ekle, ödeme sayfasına git, **iyzico sandbox test kartını**
   kullan: `5528 7900 0000 0008`, herhangi bir gelecek tarih, herhangi 3 haneli CVV (ödeme
   sayfasındaki "Test Kartları" kutusu güncel sandbox kartlarını gösteriyor).
2. 3D Secure ekranı bir modal içinde (iframe) açılmalı — sandbox'ta genelde tek tuşla geçilen
   bir doğrulama ekranı çıkar. Onayladıktan sonra sayfa kendiliğinden "Siparişiniz Alındı"
   ekranına dönmeli.
3. `admin.html` → Siparişler sekmesinde bu siparişi gör, durumunu değiştirmeyi dene.
4. Bir de **misafir modunda** (giriş yapmadan) sipariş ver — eskiden bu siparişler hiçbir yere
   kaydolmuyordu, şimdi admin panelinde "Misafir" etiketiyle görünmeli.
5. iyzico Merchant Panel → Ayarlar → Webhook bölümünden `https://efemiletisim.com/api/payment-webhook`
   adresini webhook URL'i olarak tanımla ve bir test olayı tetikle. `api/payment-webhook.js`
   içindeki imza doğrulama formülü iyzico'nun güncel dokümantasyonundan (docs.iyzico.com/en/advanced/webhook)
   okunarak yazıldı ama gerçek bir sandbox hesabı olmadığı için uçtan uca doğrulanamadı —
   webhook 401 ile reddediyorsa önce o dokümana bakıp formülü (secretKey + iyziEventType +
   paymentId + paymentConversationId + status, HMAC-SHA256) tekrar kontrol et.

Bunlar bitince bana haber ver, birlikte kontrol ederiz.

---

## 5. iyzico — sadece production'a geçince

1. iyzico'nun gerçek/production merchant hesabına geçtiğinde (başvuru onaylandıktan sonra),
   Merchant panelinde entegrasyon/domain ayarı varsa `https://efemiletisim.com` olarak gir.
2. `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` / `IYZICO_BASE_URL` ortam değişkenlerini Vercel
   Dashboard'dan production değerleriyle güncelle (`IYZICO_BASE_URL=https://api.iyzipay.com`).
3. Ödeme sayfasındaki VISA/mastercard/iyzico rozetleri şu an CSS ile çizilmiş metin
   rozetleri — iyzico başvurusu için genelde resmi görsel logo istenir. iyzico'nun
   [marka/logo kaynaklarından](https://iyzico.com) (ya da başvuru sürecinde onlardan gelen
   materyalden) resmi PNG/SVG'leri indirip `assets/logos/` altına koy, `odeme.html` (~380-455.
   satırlar civarı, `trust-mark`/`iyzico-badge` class'ları) ve `index.html`/`hakkimizda.html`
   içindeki `payment-icon` rozetlerini gerçek görsellerle değiştir.

---

## Öncelik sırası (kalan işler)

1. ~~Prompt 1 — Gerçek iyzico entegrasyonu~~ ✅ Kod tarafı tamam, yukarıdaki 1-4. adımlarla
   canlıya alman/test etmen gerekiyor.
2. ~~Prompt 2 — Admin panelini Firebase Auth'a taşı~~ ✅ Kod tarafı tamam (custom claim tabanlı),
   yukarıdaki 2. adımla kendi admin hesabını oluşturman gerekiyor.
3. ~~Prompt 3 — Sipariş yönetimi (misafir siparişleri dahil)~~ ✅ Siparişler artık Firestore
   `orders` koleksiyonunda, admin panelinden görülüyor.
4. **Prompt 4 — Kupon yönetim ekranı** — henüz yapılmadı. `js/cart.js` ve
   `api/_lib/pricing.js` içindeki `COUPONS` objesi hâlâ hardcoded (tek kupon EFEM500,
   `enabled:false`). İstersen ikisini de Firestore `coupons` koleksiyonuna taşıyıp admin
   panelinden yönetilebilir hale getirebiliriz — ayrı bir iş turu.
5. **Prompt 5 — Mobil app** — opsiyonel, en son.
6. **Prompt 6 — CSP sıkılaştırma** — opsiyonel, ileri seviye güvenlik, acil değil.
7. **Ürün kataloğu Firestore'a taşınmadı** — ürünler hâlâ `js/data.js` içindeki
   `BASE_PRODUCTS` sabit dizisinde, admin panelinden eklenen/düzenlenen ürünler hâlâ
   `localStorage`'da (tarayıcıya özel, cihazlar arası senkron değil, görsel yükleme yok —
   sadece URL yapıştırma var). Bu, sipariş/ödeme/admin-auth güvenlik açıklarından farklı
   olarak bir güvenlik riski değil, sadece operasyonel bir kısıt; kapsamı büyük olduğu için
   bu iş turuna dahil etmedim. İstersen ayrı bir iş turunda Firestore `products` koleksiyonuna
   + Firebase Storage görsel yüklemeye taşıyabiliriz.

---

## Senin doldurman gereken veriler (AI'nin işi değil, bilgi eksik)

`js/site-config.js` içinde:

| Alan | Şu anki durum | Ne gerekiyor |
|---|---|---|
| `legal.ibanBankName` | boş `''` | IBAN'ındaki banka adı (banka kodunu güvenilir şekilde doğrulayamadım, tahmin etmek yerine boş bıraktım — sen doldur) |
| `partners.distributors` → İndeks, Ouno Servis | logo yok, metin rozeti | PNG/SVG logo dosyası ver, `assets/logos/indeks.svg` ve `assets/logos/ouno.svg` olarak eklenip bağlanır |
| Huawei Watch GT4, Watch Fit 3 görselleri | placeholder SVG | `consumer.huawei.com` bot korumalı, elle indirip `assets/images/products/huawei-watch-gt4.jpg` / `huawei-watch-fit3.jpg` olarak koy |
| JBL Tune 770NC, Live 660NC görselleri | placeholder SVG | `jbl.com` (Harman) otomatik erişimi engelliyor, elle indirip `jbl-tune770nc.jpg` / `jbl-live660nc.jpg` olarak koy |
| Ödeme sayfası VISA/mastercard/iyzico rozetleri | CSS metin rozeti | Yukarıdaki "iyzico — production'a geçince" bölümüne bak |

## İş kararı bekleyen konular (kod değil, senin/işletmenin kararı)

- **EFEM500 kuponu** (`js/cart.js` → `COUPONS`, `api/_lib/pricing.js` → aynı tablo) tanımlı ama
  `enabled: false`. İndirim tutarı ve minimum sepet tutarı kararlaştırılınca her iki dosyada da
  `value`/`minSubtotal` doldurup `enabled: true` yapman yeterli (ileride Prompt 4 ile admin
  panelinden de yapılabilecek).
- **Katalog güncelliği**: ürünlerin çoğu 2023 model (Apple Watch Series 9, iPad 10. Nesil vb.),
  bu modeller markaların resmi sitelerinde artık satışta değil. Kısa vadede sorun değil ama
  orta vadede güncel modellere geçiş düşünülmeli.
- **iyzico merchant başvurusu**: production iyzico hesabı için başvuru yaparken şirket künyesi
  (MERSİS, vergi no, vergi dairesi) ve muhtemelen distribütörlük/bayilik belgesi istenebilir —
  bkz. `docs/RAPOR.md` bölüm 4, "Replika şüphesi" notu.
- **Kart bilgisi backend'e gidiyor artık (önemli farkındalık)**: Ödeme gerçek hale geldiği için
  `api/create-payment.js` kart numarası/CVV'yi işliyor (iyzico'ya iletmek için, hiçbir yerde
  saklamıyor/loglamıyor) — ama artık bu PCI DSS kapsamını genişletiyor. Checkout Form/hosted
  ödeme yerine doğrudan API entegrasyonu seçildi çünkü mevcut kart formu UI'ı buna göre
  tasarlıydı. İyzico başvurusu öncesi bu konuyu iyzico/PCI danışmanınla teyit etmen faydalı
  olur (bkz. `docs/deep-research-report.md`, PCI scope bölümü).
