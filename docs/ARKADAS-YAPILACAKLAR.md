# efemiletisim.com — Yapılacaklar (Vercel + Firebase + PayTR hesap erişimi gerekir)

Bu dosya, **kod tarafında bitmiş ama hesap erişimi olmadan tamamlanamayan** işleri listeler.
Buradaki adımların hiçbiri kod yazmayı gerektirmiyor; hepsi Vercel, Firebase ve PayTR
panellerinde yapılacak ayarlar ve doğrulamalardır.

Ayrıntılı rehberler: ödeme için `docs/PAYTR-ENTEGRASYON.md`, panel için `docs/ADMIN-KURULUMU.md`.

---

## 0. Şu anki durum — okumadan başlama

| Konu | Durum |
|---|---|
| Ödeme sağlayıcı | **PayTR iFrame API** (kart formu PayTR'nin iframe'i içinde) |
| Kart verisi | Bu sitede **hiç toplanmıyor** — PAN/CVV sunucumuza, veritabanına ve loglara girmiyor |
| Tutar | **Sunucuda** hesaplanıyor; istemciden yalnız `{id, sku, qty}` + kupon kodu alınıyor |
| Ödeme sonucu | Yalnız PayTR'nin `hash`'i doğrulanmış bildirimi belirler; tarayıcıdan gelen veri kanıt sayılmaz |
| Kart ödemesi | **KAPALI** — ortam değişkenleri girilmedi (Adım 1) |
| Yönetim paneli | **KAPALI** — `ADMIN_EMAILS` + servis hesabı girilmedi (Adım 2) |
| İade / mutabakat | Panelden yapılabiliyor (`/api/admin/refund`, `/api/admin/reconcile`) |
| Taksit | **Kapalı.** Açılırsa BDDK elektronik tavanı (3) kodda uygulanır |
| Stok | Ödeme onaylanınca düşer; yetmezse sipariş `pending_review` |
| Müşteri talepleri | Panelde **Talepler** sekmesi (soru yanıtlama + stok bildirimi) |
| Otomatik test | 246 test geçiyor (`npm test`) |

**Bu haliyle site güvenle yayında kalabilir.** Yapılandırma eksikken checkout kart yerine
EFT/havale sunar ("fail closed"); hiçbir koşulda "ödeme alındı" taklidi yapılmaz.

Adımları **sırayla** yap: Adım 1 → 2 → 3. Adım 3 (domain) olmadan 1 ve 2 yerelde/preview
adresinde de test edilebilir, ama canlı için üçü de gerekir.

---

## Adım 1 — Kart ödemesini açmak

### 1.1 PayTR mağaza bilgilerini al
PayTR Mağaza Paneli → **Bilgi → API Entegrasyon Bilgileri**:
`merchant_id`, `merchant_key`, `merchant_salt`.

> Bu üçü **sırdır**. Repoya koyma, mesajla/mail ile paylaşma, ekran görüntüsü alma.
> Sızarsa PayTR panelinden yenilenmesi gerekir.

### 1.2 Firebase servis hesabı oluştur
Firebase Console → ⚙️ **Proje Ayarları → Servis Hesapları → Yeni özel anahtar üret**.
İnen JSON dosyasının **tamamını** (tek satır hâlinde) kullanacaksın. Bu dosya da sırdır.

### 1.3 Vercel ortam değişkenlerini gir
Vercel → Project → **Settings → Environment Variables** (Production **ve** Preview için):

```
PAYTR_MERCHANT_ID=...
PAYTR_MERCHANT_KEY=...
PAYTR_MERCHANT_SALT=...
PAYTR_TEST_MODE=1
SITE_BASE_URL=https://efemiletisim.com
ORDER_TOKEN_SECRET=<rastgele 32+ karakter>
FIREBASE_SERVICE_ACCOUNT=<servis hesabı JSON'unun tamamı, tek satır>
```

`ORDER_TOKEN_SECRET` üretmek için: `openssl rand -hex 32`

Kaydettikten sonra **yeniden deploy et** (Deployments → ⋯ → Redeploy).
Ortam değişkeni eklemek tek başına canlıyı güncellemez.

> **Sık yapılan hata:** `FIREBASE_SERVICE_ACCOUNT` alanına JSON yerine yanlışlıkla
> Firebase Console'daki kod örneği, dosya yolu veya e-posta adresi yapıştırılıyor.
> Adım 1.7'deki teşhis ucu bu durumu ismiyle söyler.

### 1.4 Bildirim URL'sini PayTR paneline yaz ← ATLAMA
PayTR Mağaza Paneli → **Ayarlar → Bildirim URL**:

```
https://efemiletisim.com/api/payment/notify
```

Bu adım atlanırsa **para tahsil edilir ama sipariş "ödeme bekleniyor"da kalır** —
müşteri ödediği hâlde siparişi işleme girmez. En kritik tek adım budur.

### 1.5 Firestore kurallarını yayınla
```bash
firebase deploy --only firestore:rules
```

### 1.6 Test işlemlerini koş
`docs/PAYTR-ENTEGRASYON.md` → bölüm 4'teki testleri sırayla yap.
**Hepsi geçmeden `PAYTR_TEST_MODE=0` yapma.**

### 1.7 Kontrol
`https://efemiletisim.com/api/payment/config` şunu dönmeli:

```json
{ "cardEnabled": true, "mode": "test", ... }
```

`cardEnabled: false` geliyorsa yanıt hangi değişkenin eksik/bozuk olduğunu söyler.
Canlıya geçince `mode` `production` olur.

---

## Adım 2 — Yönetim panelini açmak

Ayrıntı: `docs/ADMIN-KURULUMU.md`

### 2.1 Yönetici hesabı oluştur

> ⚠️ Firebase Console → Authentication → **Add user** ile AÇMA.
> O yolla oluşan kullanıcının e-postası "doğrulanmamış" kalır, Console'da bunu
> doğrulanmış yapan bir düğme yoktur ve panel o hesabı içeri almaz.

1. `efemiletisim.com/hesap.html?tab=register` adresinden **normal kullanıcı gibi kayıt ol**.
2. Gelen doğrulama e-postasındaki bağlantıya tıkla (spam klasörüne de bak).
3. Bu e-postayı `ADMIN_EMAILS` değişkenine yaz.

Yönetici = normal Firebase kullanıcısı + e-postası `ADMIN_EMAILS` listesinde olan hesap.
Ayrı bir "admin kaydı" yoktur.

### 2.2 Vercel ortam değişkenleri

| Değişken | Değer |
|---|---|
| `ADMIN_EMAILS` | yönetici e-postan (virgülle birden fazla yazılabilir) |
| `FIREBASE_SERVICE_ACCOUNT` | Adım 1.2'deki servis hesabı JSON'u (aynısı) |
| `FIREBASE_STORAGE_BUCKET` | boş bırakılabilir; Firebase varsayılanı kullanılır |

Liste boşsa yönetici API'lerinin **tamamı kapalıdır** (fail closed).

### 2.3 Firebase Storage'ı aç
Firebase Console → **Storage → Get started**. Kova oluşmadan görsel yüklenemez.

### 2.4 Kuralları yayınla ← ATLAMA
```bash
firebase deploy --only firestore:rules,storage
```

Ya da Console → Firestore → Rules ve Storage → Rules ekranlarından
`firestore.rules` / `storage.rules` içeriğini yapıştırıp **Publish**.

Bu adım yapılmazsa `coupons` koleksiyonu tarayıcıdan okunabilir kalır ve
Storage'a yetkisiz yazma yolu açık kalabilir.

### 2.5 Kontrol
- [ ] Yetkisiz bir hesapla giriş → panel açılmıyor
- [ ] Yönetici hesabıyla giriş → panel açılıyor, ürünler sunucudan geliyor
- [ ] Panelden ürün ekle → `urunler.html`'de **başka bir tarayıcıda** görünüyor
- [ ] Panelden görsel yükle → ürün kartında görünüyor
- [ ] Aktif bir kupon oluştur → sepette uygulanıyor, toplam düşüyor
- [ ] Bir üye + bir misafir siparişi ver → ikisi de panelde görünüyor
- [ ] Sipariş durumunu "Kargoda" yap → müşterinin `profil.html` ekranında değişiyor

---

## Adım 3 — Domain bağlama

### 3.1 Domain'i Vercel hesabına bağla

1. [vercel.com](https://vercel.com) → giriş yap.
2. Projeyi Vercel'e getir: GitHub reposunu import et (Add New → Project) ya da
   lokalde `vercel --prod` çalıştır. Repo `vercel.json` içeriyor, ekstra ayara gerek yok.
3. **Project → Settings → Domains**.
4. "Add" → `efemiletisim.com`. Ardından `www.efemiletisim.com`'u da ayrıca ekle.
5. Vercel ekranda DNS kayıtlarını gösterir — apex (`@`) için **A kaydı**, `www` için
   **CNAME**. **Ekranda yazan değerleri birebir kullan**, buradan örnek IP uydurma.
6. Domain'i aldığın yerin (GoDaddy, Natro, İsimtescil, Turhost…) DNS paneline gir,
   kayıtları ekle. Aynı isimde çakışan eski A/CNAME kaydı varsa sil.
7. Yayılma genelde 10 dakika–birkaç saat sürer, nadiren 48 saate çıkar.
   Vercel'de "Valid Configuration" yazınca tamamdır.
8. `www` → apex yönlendirmesi için Domains ekranında "Edit → Redirect to".

### 3.2 Firebase — domain'i yetkili listesine ekle ← ATLAMA

1. Firebase Console → proje `efemiletisim` → **Authentication → Settings → Authorized domains**.
2. "Add domain" → `efemiletisim.com`. `www.efemiletisim.com`'u da ayrı satır olarak ekle.

Atlanırsa: canlı sitede giriş/kayıt `auth/unauthorized-domain` hatası verir, **kimse giriş
yapamaz**. Sessizce bozulur, fark etmesi zordur — domain bağlanır bağlanmaz bunu yap.

### 3.3 PayTR tarafını canlı adrese al
PayTR panelinde alan adı ve Bildirim URL'si `https://efemiletisim.com` üzerinden olmalı
(bkz. Adım 1.4).

---

## Adım 4 — Canlıya geçiş (test modundan çıkış)

Sırayla, hepsi işaretlenmeden `PAYTR_TEST_MODE=0` yapma:

- [ ] Adım 1, 2, 3 tamamlandı
- [ ] `docs/PAYTR-ENTEGRASYON.md` bölüm 4'teki testlerin hepsi geçti
- [ ] `/api/payment/config` → `cardEnabled: true`
- [ ] Bildirim URL'si PayTR panelinde kayıtlı ve doğru (M-2)
- [ ] Test işlemi PayTR **İşlemler** sayfasında görüldü (M-3)
- [ ] Firestore + Storage kuralları yayınlandı
- [ ] PayTR üye işyeri başvurusu onaylandı (evraklar aşağıda)
- [ ] PayTR **Canlı Mod** talebi gönderildi ve **onay SMS/e-postası geldi** (M-5)
- [ ] `PAYTR_TEST_MODE=0` yapıldı ve **yeniden deploy edildi**
- [ ] Gerçek kartla küçük tutarlı deneme siparişi verildi
- [ ] Aynı sipariş panelden iade edildi (`/api/admin/refund`) ve iade PayTR'de göründü
- [ ] `/api/admin/reconcile?orderId=...` o sipariş için `agrees: true` döndü

---

## Açık bulgular

Ödeme öncesi yapılan güvenlik/mevzuat denetiminden kalan, **henüz kapanmamış** maddeler.
Kapatılan bulgular koda yansıdı; burada yalnız açık olanlar var.

| ID | Konu | Öncelik | Durum / yapılması gereken | Sahip |
|---|---|---|---|---|
| **A-01** | `users/{uid}.orders` dizisi hâlâ istemciden yazılabiliyor | YÜKSEK | Sunucu sipariş API'si yapılandırılmadan önce EFT siparişleri kaybolmasın diye **bilerek** açık bırakıldı. Adım 1.3 tamamlandıktan sonra `firestore.rules` içindeki yorumlu katı kural etkinleştirilip yeniden deploy edilmeli | Geliştirici |
| **A-02** | ETBİS kaydı | YÜKSEK (mevzuat) | Kayıt tamamlanmalı, bilgi/logo siteye eklenmeli. **Kayıt yapılmadan siteye ETBİS ibaresi konulmamalıdır** | İşletme |
| **A-03** | İade / iptal süreci | ORTA | ✅ Kod tarafı bitti (`/api/admin/refund`). Kalan: iadeyi **kimin** hangi onayla yapacağı ve müşteriye nasıl bildirileceği süreci yazılı hale getirilmeli. İadeyi PayTR panelinden değil **panelden** yapın — panelden yapılan iade bizim kaydımıza yansımaz | İşletme |
| **A-04** | Günlük mutabakat | ORTA | ✅ Kod tarafı bitti (`/api/admin/reconcile`). Kalan: haftalık mutabakatın **fiilen yapılması** ve `pending_review` siparişlerin gözden geçirilmesi | İşletme |
| **A-05** | Stok kontrolü | DÜŞÜK | ✅ Kod tarafı bitti: ödeme onaylanınca stok transaction içinde düşer, yetmezse sipariş `pending_review` olur. Kalan: stok yalnız **panelden yönetilen** (Firestore) ürünlerde takip edilir — statik katalogdaki ürünlerin stoğu düşmez. Tüm katalog panele taşınmalı | İşletme |
| **A-06** | Katalog senkronu | DÜŞÜK | Statik fiyat/varyant değiştiren her commit'te `npm run sync-catalog` çalıştırılmalı; `npm run check-catalog` fark varsa hata verir. (Sürüklenme olursa sipariş **reddedilir**, yanlış tahsilat olmaz) | Geliştirici |
| **A-07** | Hız sınırı dağıtık değil | DÜŞÜK | Kart deneme freni fonksiyon örneği başına bellekte. Saldırı görülürse Vercel WAF / harici rate-limit servisi | Geliştirici |
| **A-08** | Site geneli CSP | DÜŞÜK | `odeme-guvenli.html` `'unsafe-inline'` olmadan servis ediliyor. Diğer sayfalar hâlâ `'unsafe-inline'` kullanıyor (aşağıya bak) | Geliştirici |

---

## PayTR panelinde senin yapacakların (kod işi değil)

Bu bölümdeki her şey **PayTR Mağaza Paneli** üzerinden elle yapılır. Kod tarafı
hazır; bunlar yapılmadan ödeme çalışmaz veya eksik çalışır.

### M-1. Entegrasyon bilgilerini al ← Adım 1.1
**Bilgi → API Entegrasyon Bilgileri**: `merchant_id`, `merchant_key`, `merchant_salt`.
`merchant_id` şirket yetkilisine e-posta ile de gönderilir.

### M-2. Bildirim URL'sini tanımla ← EN KRİTİK ADIM
**Ayarlar → Bildirim URL**: `https://efemiletisim.com/api/payment/notify`

Tanımlanmazsa **para tahsil edilir ama sipariş açık kalır**. Ödeme sonucunun tek
yetkili kaynağı bu adrestir; müşterinin tarayıcısı sonucu belirlemez.

### M-3. Test işlemi yap ve doğrula
1. Sitede bir sipariş başlat, PayTR ödeme formu açılsın.
2. Ödeme sayfasındaki **hazır gelen test kartı** ile öde — elle kart girmene gerek yok.
3. PayTR 3D Secure test sayfasını tamamla.
4. **İşlemler & Raporlar → İşlemler** sayfasından, test ödemesinde kullandığın
   e-posta adresiyle işlemi bul ve göründüğünü doğrula.

### M-4. Görünüm ve taksit ayarları
- **Ayarlar** → ödeme formunun renk düzeni (site rengi `#2563EB`).
- **Taksit Ayarları** → taksit tablosu ve peşin fiyatına taksit seçenekleri.

> Taksit açacaksan önce "BDDK taksit sınırı" notunu oku (aşağıda).

### M-5. Canlı moda geçiş başvurusu
1. **Canlı Mod** sayfasında **"Evet, Entegrasyonu Tamamladım"**a bas.
2. Canlıya geçiş talebini gönder.
3. PayTR destek ekibi (7/24) test işlemlerini inceler.
4. Onaylanınca **SMS ve e-posta** ile bilgi gelir. Onay gelmeden canlı ödeme alınmaz.
5. Onay geldikten sonra Vercel'de `PAYTR_TEST_MODE=0` yap ve **yeniden deploy et**.

### M-6. İade süreci — panelden değil, bizim panelimizden
İade artık yönetim panelimizden yapılabiliyor (`/api/admin/refund`); PayTR panelinden
yapılan iade **bizim sipariş kaydımıza yansımaz** ve mutabakatta fark olarak çıkar.

Karar vermen gerekenler: iadeyi kim onaylar, hangi sürede yapılır, müşteriye nasıl
bildirilir. Bunu yazılı hale getir (A-03).

### M-7. BDDK taksit sınırı — taksit açacaksan
Kredi kartı taksitlerinde ürün kategorisine göre yasal üst sınır vardır ve bu sınırlar
dönem dönem değişir. Bu katalog tamamen elektronik/telekomünikasyon ürünüdür ve en dar
sınıra girer.

Kodda kaza önleyici bir tavan var (`BDDK_ELECTRONICS_MAX_INSTALLMENT = 3`,
`api/_lib/env.js`) — daha yükseği istenirse kırpılır ve loglanır. **Bu bir uyum
garantisi değildir.** Taksit açmadan önce güncel BDDK sınırını ve PayTR panelindeki
taksit tanımını teyit et; sınır değişmişse koddaki sabiti de güncelle.

### M-8. Haftalık mutabakat
Panelimizde `/api/admin/reconcile?orderId=...` ile tek sipariş PayTR'ye karşı
otomatik karşılaştırılabiliyor. Yapılacak: haftada bir PayTR **İşlemler** raporunu
dışa aktar, sipariş listesiyle karşılaştır, farklı olanları bu uçtan sorgula (A-04).

---

## PayTR üye işyeri başvurusu — istenen evraklar

Canlı mağaza için başvuruda genelde şunlar sorulur:

- Ticaret sicil gazetesi
- Vergi levhası
- İmza sirküleri
- Ortakların kimlik görüntüleri
- IBAN / banka teyit belgesi
- Şirket künyesi (MERSİS, vergi no, vergi dairesi) — `js/site-config.js` içinde mevcut

**Marka ürünleri** satıldığı için distribütörlük/bayilik belgesi de istenebilir
(replika şüphesini kapatmak için). Distribütör partnerleri sitede zaten listeli.

Site tarafında başvuru şartlarının karşılandığı doğrulandı: çalışan site + fiyatlar,
gizlilik/KVKK, mesafeli satış sözleşmesi, ön bilgilendirme formu, iptal/iade, hakkımızda,
ana sayfadan erişilebilir iletişim bilgisi ve künye, ödeme sayfasında SSL (Vercel TLS).

---

## Bilinen eksikler ve ertelenmiş işler

### CSP sıkılaştırma (A-08) — kısmen yapıldı

**Yapılan:** `odeme-guvenli.html` (kart formunun taşındığı sayfa) tamamen satır içi kod
barındırmıyor ve kendisine özel, `'unsafe-inline'` **içermeyen** bir CSP ile servis ediliyor.
E-skimming açısından sitenin en kritik sayfası burasıdır.

**Yapılmayan ve sebebi:** Sitenin geri kalanı hâlâ `'unsafe-inline'` ile servis ediliyor.
`'unsafe-inline'` ancak bir sayfadaki satır içi kodun **tamamı** kaldırıldığında düşürülebilir;
yarım temizlik güvenlik kazancı vermez. 16 sayfada ~300 statik `on*="…"` handler'ı, ayrıca
çalışma anında üretilen işaretlemede (ürün kartı, sepet satırı, admin tablosu) yüzlerce
handler daha var. Regresyon riski yüksek, ayrı bir çalışma olarak duruyor.

**Nasıl ilerlenir:** sayfa sayfa — her sayfanın satır içi `<script>` bloğunu kendi
`js/<sayfa>-page.js` dosyasına al, `on*=` handler'larını `addEventListener` ve dinamik
listeler için olay delegasyonuna çevir, `style=""` attribute'larını sınıflara taşı.
Sayfa temizlenince `vercel.json`'a o sayfa için sıkı CSP kuralı ekle (`odeme-guvenli`
kuralı örnek). Hepsi bitince genel kuraldan `'unsafe-inline'` kaldırılabilir.

### Kod tarafında yapılamayanlar — sebepleriyle

Aşağıdakiler **bilerek** yapılmadı; her biri ya hesap erişimi ya iş kararı ya da
bu repoda karşılığı olmayan bir altyapı gerektiriyor.

| Konu | Neden kod ile çözülemedi | Ne gerekiyor |
|---|---|---|
| **Statik katalogda stok** | `api/_lib/catalog.json` bir dosyadır, çalışma anında yazılamaz; ayrıca kaynağı `js/data.js`'te varyant bazlı stok **yok** (yalnız ürün seviyesinde `stock: 10` var, hepsi aynı). Uydurma stok yazmak gerçek veri gibi görünüp yanlış karar verdirirdi | Katalogun panele taşınması (A-05) |
| **Stok bildirimi maili** | "Gelince haber ver" talepleri artık panelde görünüyor, ama stok girince **otomatik toplu mail** gönderimi zamanlanmış görev (cron) ister; bu repoda cron altyapısı yok | Vercel Cron + toplu gönderim kararı |
| **Sipariş iptalini müşterinin kendisi yapması** | İptal politikası (hangi durumda, hangi süre içinde, otomatik iade var mı) bir **iş kararıdır**; kodlanmadan önce kararlaştırılmalı | İşletme kararı |
| **Kargo firması entegrasyonu** | Takip numarası elle giriliyor. Otomatik gönderi oluşturma/takip için kargo firmasının API'si ve sözleşmesi gerekir | Kargo firması anlaşması + API anahtarı |
| **E-fatura / e-arşiv** | Fatura bilgisi toplanıyor ve siparişte saklanıyor, ama fatura **kesilmiyor**. Entegratör (GİB portal veya özel entegratör) hesabı ve mali müşavir onayı gerekir | Entegratör hesabı |
| **Site geneli CSP sıkılaştırma** | Aşağıya bakın (A-08) — teknik olarak yapılabilir ama yüksek regresyon riskli, geniş bir çalışma | Ayrı bir tur |
| **Dağıtık hız sınırı** | Şu anki fren fonksiyon örneği başına bellekte. Dağıtık olması için harici bir sayaç (Redis/WAF) gerekir | Altyapı kararı (A-07) |
| **Firestore katı kuralı (A-01)** | `users/{uid}.orders` yazma kısıtı `firestore.rules` içinde yorumlu duruyor. Etkinleştirmek **deploy kararıdır**; sunucu yapılandırılmadan açılırsa EFT siparişleri kaybolur | Adım 1.3 sonrası kural yayını |

### Ürün soru-cevap yanıtlama — ✅ yapıldı
Panelde **Talepler** sekmesinden yanıtlanıyor; yanıt ürün sayfasında görünüyor.
Yanıt kaldırma ve spam silme de var.

### Instagram görselleri
`docs/instagram/spec.json` içindeki SSS metni PayTR olarak güncellendi, ancak
`docs/instagram/gorseller/` altındaki **PNG'ler eski metinle üretilmiş olabilir**.
Paylaşmadan önce `docs/instagram/build.ps1` ile yeniden üret veya görselleri gözden geçir.

### Mobil app (opsiyonel, en son)
Aynı Firebase backend'e bağlı bir React Native (Expo) MVP düşünülüyor: ürün listesi,
detay, sepet (AsyncStorage), Firebase Auth, sipariş verme (mevcut `api/` uçları
platformdan bağımsız), profil/sipariş geçmişi. Marka rengi `#2563EB`, logolar
`assets/logos/`. Ayrı repo olarak kurulmalı; store süreçleri kapsam dışı.

---

## İş kararı bekleyen konular

- **Kupon kampanyası:** Kupon altyapısı hazır ve panelden yönetiliyor. İndirim tutarı,
  minimum sepet ve süre kararlaştırılınca panelden oluşturulup aktif edilebilir.
- **Katalog güncelliği:** Katalog "stok bilgisi.xlsx" ile senkron. Model değişimlerinde
  panelden güncelleme yapılmalı; statik fiyat değişirse `npm run sync-catalog`.

---

## Sorun çıkarsa

| Belirti | Muhtemel sebep | Bakılacak yer |
|---|---|---|
| Checkout'ta kart seçeneği yok, sadece EFT | Ortam değişkeni eksik/bozuk | `/api/payment/config` yanıtı |
| Para çekildi ama sipariş "ödeme bekleniyor" | Bildirim URL'si yanlış/eksik | PayTR paneli → Ayarlar → Bildirim URL (Adım 1.4) |
| Sipariş `pending_review` durumunda | Tahsil edilen tutar sipariş tutarıyla uyuşmuyor | Vercel logları + PayTR işlem detayı. **Sevkiyat başlatma**, önce mutabakat |
| Panele girilemiyor | E-posta doğrulanmamış veya `ADMIN_EMAILS`'te değil | `docs/ADMIN-KURULUMU.md` |
| Sitede giriş/kayıt çalışmıyor | Domain Firebase authorized listesinde değil | Adım 3.2 |

Ödeme kütüphanesini değiştiren her değişiklikten sonra: `npm run test:payment`
Panel/katalog tarafını değiştiren her değişiklikten sonra: `npm run test:admin`
