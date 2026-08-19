# efemiletisim.com — proje notları

Design direction: high-end-visual-design

Ana renk korunuyor: `--primary: #2563EB` (bkz. `css/main.css`). Tasarım yükseltmesi bu rengi değiştirmeden yapılıyor.

Kurumsal bilgi tek kaynak: `js/site-config.js`. Footer, hakkımızda, ödeme sayfası mağaza adresi gibi yerler `data-link`/`data-text` attribute'leriyle buradan besleniyor (`js/main.js` → `initSiteLinks()`). Sunucu tarafının ihtiyaç duyduğu künye alanları `api/_lib/merchant.js` içinde kopyalanmıştır; `site-config.js` değişirse orası da güncellenmeli.

Detaylı ilerleme raporu: `docs/RAPOR.md`. Değişiklik günlüğü: `CHANGELOG.md`. Arkadaşın için hazır AI prompt'ları: `docs/ARKADAS-YAPILACAKLAR.md`.

## Ürün görselleri — ürün eklerken/güncellerken zorunlu kural

Galerideki her görsel, o üründe **satılan** şeyi göstermek zorundadır. Excel/liste ile toplu ürün eklerken de, tek ürün düzenlerken de aşağıdaki denetim yapılmadan görsel yayına alınmaz.

Bir görsel şu durumlarda **yanlıştır, silinir** (yerine doğrusu indirilir):

- Üründe **olmayan bir rengi** gösteriyorsa. Galeri yalnız `variants[].color` listesindeki renkleri gösterebilir. (Örn. yalnız "Siyah" satılan JBL PartyBox Club 120'de beyaz gövde; yalnız "Mavi" satılan JBL Go 5'te gri/kamuflaj gövde.)
- **Başka bir ürünü** gösteriyorsa (AirPods 4 galerisinde AirPods Max, Galaxy Buds4 galerisinde Buds4 Pro, GT 6 Pro galerisinde standart GT 6).
- Bölgesel olarak **yanlış varyantsa** — Türkiye'de satılan adaptörün görselinde ABD/İngiltere fişi olması gibi.
- Ürün fotoğrafı değil de **reklam afişi, karşılaştırma tablosu, "kutunun içindekiler" şeması, başka ürünün kampanya görseli** ya da üzerinde **başka satıcının filigranı** olan bir görselse.
- **Amatör çekimse** (masada/halıda çekilmiş kullanıcı fotoğrafı) veya çok renkli **koleksiyon kolajıysa** — hangi rengi aldığı belirsiz kalır.

Kaynak sırası: önce **üreticinin kendi CDN'i**, sonra yetkili satıcı. Çalışan yollar:

- Apple: `store.storeimages.cdn-apple.com/1/as-images.apple.com/is/<key>?wid=1400&hei=1400&fmt=png-alpha`. Saat kasası render'ı `watch-case-<boyut>-<malzeme>-<renk>-<nc|cell>-<seri>_VW_34FR` / `_VW_PF` (bkz. `scripts/fetch-apple-watch-images.mjs`). Aksesuarda **`_GEO_EMEA`** son eki AB fişli görseli verir — Türkiye için doğru olan odur.
- Samsung: `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/global?modelList=<MODEL>&siteCode=tr` çağrısı galeri URL'lerini döner (`images.samsung.com/is/image/samsung/p6pim/...`). Model kodu renge göre değişir (`SM-L350NZKATUR` = koyu gri, `...NZSATUR` = gümüş).
- Huawei: `consumer.huawei.com/dam/content/dam/huawei-cbg-site/common/mkt/pdp/wearables/<ürün>/images/switch/<ad>.png` — sayfadaki adın **`-thumb` eki atılınca** tam çözünürlük gelir.
- Xiaomi: `mi.com/tr/product/<slug>/` sayfasındaki `i0*.appmifile.com` görselleri.

Denetim yöntemi: `node scripts/catalog-audit.mjs` eksik/küçük dosyayı yakalar ama **renk/ürün eşleşmesini yakalamaz** — o yüzden görseller ürün adı + varyant renkleriyle yan yana **gözle** karşılaştırılır. Değişiklikten sonra hiçbir ürün görselsiz kalmamalı; dosya adı uzantısı değişirse `js/data.js` içindeki yol da güncellenmeli.

## Ödeme — değiştirmeden önce oku

Ödeme **PayTR iFrame API** ile çalışır (kart formu PayTR tarafında, iframe içinde). Kurulum ve canlıya çıkış: `docs/PAYTR-ENTEGRASYON.md`. Açık mevzuat/güvenlik bulguları ve hesap erişimi gerektiren işler: `docs/ARKADAS-YAPILACAKLAR.md`.

Bozulmaması gereken kurallar:

- Bu projede **kart numarası/CVV toplanmaz, taşınmaz, saklanmaz.** Checkout'a kart alanı geri eklenmez.
- **Tutar istemciden alınmaz.** Sunucu sepeti kendi kataloğundan yeniden fiyatlar (`api/_lib/catalog-store.js`: Firestore `products` → statik `api/_lib/catalog.json`); istemciden yalnız `{id, sku, qty}` ve **kupon kodu** kabul edilir. Renk/beden bilgisi ve indirim tutarı da sunucuda hesaplanır, istemciden gelen değer kullanılmaz. Statik katalog (fiyat/varyant) değişirse `npm run sync-catalog`.
- **Ödeme sonucu tarayıcıdan gelen veriye göre belirlenmez.** Sonucun tek kaynağı PayTR'nin Bildirim URL'sine (`/api/payment/notify`) gönderdiği, `hash`'i doğrulanmış POST'tur; işlendiğinde PayTR'ye gövdesi tam olarak `OK` olan yanıt dönülür (`api/_lib/settle.js`).
- Tahsil edilen tutar sipariş tutarıyla uyuşmazsa sipariş `pending_review` olur — `paid` yapılmaz, sevkiyat başlamaz. `hash` doğrulanamayan bildirim hiçbir durumu değiştirmez.
- Sırlar (`PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT`, service account) yalnız sunucu ortam değişkeninde durur; repoya, istemci koduna veya loga girmez.
- Yapılandırma eksikse kart ödemesi kapalı kalır ve checkout EFT'ye düşer ("fail closed"); sahte başarı üretilmez.

- Sipariş numarası (`merchant_oid`) **alfanumerik** olmak zorundadır (PayTR kuralı); `newOrderId()` bunu garanti eder.
- PayTR'nin dört servisinin **imza alan sırası birbirinden farklıdır** ve birinden diğerine kopyalanamaz (`api/_lib/paytr.js` başındaki nota bak): token alma, bildirim doğrulama, iade (`merchant_id+merchant_oid+return_amount+salt`), durum sorgu (`merchant_id+merchant_oid+salt`). Tutar biçimi de farklıdır: token servisinde **kuruş** (`3456`), iade servisinde **ondalıklı** (`34.56`).
- İade `/api/admin/refund` üzerinden yapılır; tutar kalan tutarı aşamaz, sipariş `refunds[]` dizisine denetim kaydı yazılır. PayTR panelinden elle yapılan iade bizim kaydımıza yansımaz — mutabakat (`/api/admin/reconcile`) bunu `refund_mismatch` olarak yakalar.
- Taksit varsayılan kapalı. Bu katalog elektronik/telekom olduğu için `BDDK_ELECTRONICS_MAX_INSTALLMENT` tavanı uygulanır; tavan bir uyum garantisi değil kaza önleyicidir.

Ödeme kütüphanesini değiştirdikten sonra `npm run test:payment` çalıştırılmalı.

## Yönetim paneli (ürün · kupon · görsel)

Kurulum ve doğrulama listesi: `docs/ADMIN-KURULUMU.md`.

- Panele giriş **Firebase Authentication** ile, yetki **sunucuda** (`/api/verify-admin` → ID token + doğrulanmış e-posta + `ADMIN_EMAILS`). `admin.html` içindeki hiçbir istemci bayrağı yetki yerine geçmez; panele sabit şifre geri eklenmez.
- Ürün, kupon ve görsel yazma işlemlerinin tamamı `/api/admin/*` üzerinden, Admin SDK ile yapılır. `firestore.rules` istemciye `products` yazmayı, `coupons` okumayı **kapatır**; `storage.rules` yazmayı tamamen kapatır. Kuralları gevşetmek yerine uç eklenir.
- `priceKurus` istemciden alınmaz; `price` üzerinden `api/_lib/product-schema.js` içinde türetilir. Ödeme akışı yalnız `priceKurus` okur.
- Kupon indirimi istemciden alınmaz; kod sunucuda `api/_lib/coupons.js` ile doğrulanır. İndirim sepeti aşamaz, toplam sıfıra inerse sipariş reddedilir.
- Güvenlik kuralları (`firestore.rules`, `storage.rules`) repoda durur, **deploy'u proje sahibi yapar**.

- **Stok ödeme onaylanınca düşer** (sipariş oluşturulurken değil), tek transaction'da ya hepsi ya hiçbiri. Yetmezse sipariş `paid` YAPILMAZ, `pending_review`e düşer. Stok yalnız Firestore `products`'ta tutulur; statik katalog satırları `skipped` döner ve düştü SAYILMAZ. Durum yazılamazsa düşülen stok `restoreStock` ile geri verilir (çift düşüm önleme).
- Kargo takip numarası `orders/{id}.trackingNumber` alanına, `/api/admin/orders` üzerinden yazılır. `js/data.js` içindeki `updateOrderTrackingNumber()` eski yerel defter içindir; sunucu siparişlerinde kullanılmaz.
- Durum değişince müşteriye mail `api/_lib/order-mails.js` üzerinden gider (kargoda / teslim / iptal / iade). Yalnız durum GERÇEKTEN değiştiyse gönderilir; aynı durumu tekrar kaydetmek ikinci mail üretmez.

- Ürün soruları ve stok bildirimleri panelde **Talepler** sekmesinden yönetilir (`/api/admin/inbox`). Soru yanıtı yalnız Admin SDK ile yazılır; `stockAlerts` müşteri e-postası içerdiği için istemciye okuma kapalıdır.

Panel/katalog tarafını değiştirdikten sonra `npm run test:admin` çalıştırılmalı.

## Kök dizin

Proje kök dizini: sayfa HTML'leri (routing gereği taşınamaz), `css/`/`js/`/`assets/`, sunucu tarafı ödeme için `api/` ve `scripts/`, hosting/config dosyaları (`vercel.json`, `firebase.json`, `firestore.rules`, `storage.rules`, `robots.txt`, `sitemap.xml`, `.gitignore`, `.vercelignore`, `package.json`, `.env.example`, `dev-server.js`) ve `CLAUDE.md`/`CHANGELOG.md`/`README.md` içerir. Rapor/yardımcı doküman `docs/`'a, logo kaynak dosyası `assets/logos/source/`'a taşındı.
