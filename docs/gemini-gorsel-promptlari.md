# Gemini Görsel Üretim Prompt'ları — efemiletisim.com

Bu dosya, siteye eklenecek **dekoratif ve pazarlama görsellerinin** Gemini ile üretilmesi için hazır prompt'ları içerir. Ürün fotoğraflarının yerine geçmez — ürün görselleri her zaman üreticinin kendi CDN'inden gelir (bkz. `CLAUDE.md` → "Ürün görselleri" kuralı).

**Neden yeniden yazıldı:** Önceki sürüm krem zeminli, ince kalem çizimi (line-art) bir stil öneriyordu. Site bir **e-ticaret vitrini**; kategori kartlarında koyu gradyan overlay üstüne beyaz başlık binen, `border-radius: 28px`, hover'da `scale(1.08)` yapan fotoğraf kartları var. Çizim stili bu kartlarda soluk kalıyor ve ürünle ilgisi kurulamıyor. Yeni yön: **stüdyo ışığıyla çekilmiş gibi, premium, koyu zeminli ürün sahneleri.**

Model: Gemini görsel üretimi (Nano Banana / Imagen). Prompt'lar İngilizce — bu modellerde stil tutarlılığı İngilizce'de belirgin şekilde daha iyi.

---

## 0) Site tasarım kimliği (prompt'ların dayandığı gerçekler)

| Şey | Değer | Nereden |
|---|---|---|
| Ana renk | `#2563EB` | `css/main.css` → `--primary` |
| Koyu kurumsal ton | `#0F172A` | `--secondary` |
| Vurgu (amber) | `#F59E0B` | `--accent` |
| Açık zemin | `#F8FAFC` / `#FFFFFF` | `--bg` / `--surface` |
| Tipografi | Inter | `main.css` @import |
| Kategori kartı | 4:3, 28px köşe, alttan `rgba(15,23,42,0.85)` gradyan overlay, hover'da mavi overlay | `css/components.css` → `.category-card` |
| Karanlık mod | Var (`data-theme="dark"`) | `js/theme-init.js` |

Bu iki sonucu doğurur ve tüm prompt'lara işlendi:

1. **Kategori/hero görsellerinde kompozisyonun alt üçte biri boş ve koyu kalmalı** — üstüne siyah gradyan + başlık biniyor.
2. **Krem/beyaz zeminli görseller yasak** (boş durum ikonları hariç) — karanlık modda parlayan beyaz dikdörtgen gibi durur. Koyu zemin her iki temada da çalışır.

---

## 1) Stil sabiti — A ailesi: Kategori & Hero (fotografik)

Her kategori/hero prompt'unun **başına** olduğu gibi yapıştır.

```
STYLE: Premium e-commerce product photography, studio lighting, shot on a
medium-format camera with an 85mm lens, shallow depth of field. Single hero
product floating or resting on a seamless deep-navy gradient backdrop
(#0F172A fading to #1E3A8A), lit with one large soft key light from the upper
left and a cool rim light in electric blue (#2563EB) tracing the product's
edge. Subtle blue reflection pooling under the product. Clean, expensive,
minimal — like an Apple or Bang & Olufsen product page. Sharp, high detail on
materials (brushed metal, matte plastic, glass, fabric weave). No text, no
logos, no watermark, no people's faces, no busy props, no clutter.
COMPOSITION: Product occupies the upper two thirds of the frame and is
centred slightly high; the bottom third stays dark, empty and unbusy because
a black gradient and white heading are overlaid there in the UI.
```

**Negatif liste** (Gemini ayrı bir alan sunuyorsa oraya):
`text, letters, logos, watermark, brand names, hands, faces, white background, cream paper texture, clipart, flat vector icon, 3D toy render, plastic-looking CGI, harsh shadows, cluttered background, collage, multiple duplicate products`

---

## 2) Kategori Kartları (4 adet — zorunlu)

**Kullanım yeri:** `index.html` "Ne Arıyorsunuz?" bölümü ve `urunler.html` kategori filtreleri.
**Boyut:** 1600×1200 px (4:3). Karta `object-fit: cover` ile oturuyor.
**Kayıt:** `assets/images/category-<slug>.webp` (yanına `.jpg` fallback bırak).

> Not: `saat` ve `kulaklik` kartlarında hâlâ eski çizim görseli var — bunlar da bu yeni prompt'larla **değiştirilecek**. `aksesuar` ve `ses` kartlarında görsel hiç yok, şu an gradyan + ikon fallback görünüyor.

### 2a. Akıllı Saatler → `assets/images/category-saat.webp`
```
[1) A ailesi STYLE prefix'ini buraya yapıştır]

SUBJECT: Three modern smartwatches arranged in a tight diagonal cluster,
floating at slightly different heights and angles — one shown face-on with a
glowing dark watch face, one three-quarter turned showing the crown and side
button, one from behind showing the sensor puck and a woven fabric strap.
Mixed materials: brushed titanium case, matte aluminium case, soft silicone
band. The face-on watch's display emits a faint electric blue (#2563EB) glow
that catches the other two. Generic unbranded designs, no logos, no readable
text on the screens — only abstract glowing arcs and rings.
```

### 2b. Kulaklıklar → `assets/images/category-kulaklik.webp`
```
[1) A ailesi STYLE prefix'ini buraya yapıştır]

SUBJECT: One premium over-ear wireless headphone floating in three-quarter
view, headband arched, ear cushions in matte black with a subtle leather
grain, next to and slightly behind it a smaller open true-wireless earbud
charging case with one earbud lifted out and hovering above it. Blue rim
light traces the headband curve and the earbud stem. Soft, almost invisible
ripples of light in the background suggesting sound waves — abstract, not
literal graphics. Unbranded, no logos.
```

### 2c. Aksesuarlar → `assets/images/category-aksesuar.webp` (YENİ)
```
[1) A ailesi STYLE prefix'ini buraya yapıştır]

SUBJECT: A neat floating arrangement of charging accessories — a compact
white-and-grey USB-C wall charger with EU round pins (European plug, not US
flat blades, not UK three-pin), a coiled braided USB-C cable forming a
graceful loop in mid-air, and a slim power bank standing on edge behind them.
A single blue LED dot glows on the power bank. Objects are spaced apart with
clean air between them, not touching. Unbranded, no printed text on the
charger body.
```
> **Önemli:** EU (yuvarlak iki uçlu) fiş şart — Türkiye'de satılan ürün bu. ABD/İngiltere fişi çıkarsa yeniden üret, aynı hata ürün görsellerinde de yasak (`CLAUDE.md`).

### 2d. Ses & Diğer → `assets/images/category-ses.webp` (YENİ)
```
[1) A ailesi STYLE prefix'ini buraya yapıştır]

SUBJECT: A cylindrical portable bluetooth speaker standing upright, wrapped
in tightly woven acoustic mesh fabric with visible thread texture, a rubber
carry strap looping off to one side, and a second smaller speaker lying on
its side blurred in the background (bokeh). A ring of electric blue light
glows around the base of the main speaker and spills onto the surface.
Faint low-frequency air distortion around the driver. Unbranded, no logos,
no text on the fabric.
```

---

## 3) Ana Sayfa Hero Görseli

**Kullanım yeri:** `index.html:175` — şu an `assets/images/hero-banner.jpg`.
**Boyut:** 2400×1600 px. Sağ tarafta ürünler, **sol üçte bir boş** (başlık + CTA oraya biniyor).
**Kayıt:** `assets/images/hero-banner.webp` (+ `.jpg`).

```
[1) A ailesi STYLE prefix'ini buraya yapıştır — ama COMPOSITION satırını
aşağıdakiyle DEĞİŞTİR:]

COMPOSITION: Wide cinematic frame. The left 40% of the image is empty, deep
navy negative space for a headline and buttons. All products sit in the right
60%, arranged in a receding diagonal from bottom-right to upper-centre.

SUBJECT: A curated hero arrangement of consumer tech — a smartwatch standing
upright on a low invisible pedestal in the foreground (sharpest), an over-ear
headphone resting at an angle behind it, a pair of true-wireless earbuds in
an open case, and a small bluetooth speaker furthest back and softly out of
focus. A broad electric blue (#2563EB) light gradient washes in from the
right edge. Everything unbranded, no logos, no text.
```

---

## 4) Kampanya / Güven Şeritleri (opsiyonel, geniş bantlar)

**Boyut:** 2000×600 px. Bu görseller **arka plan** olarak kullanılır, üstlerine metin biner.

### 4a. Ücretsiz kargo şeridi → `assets/images/banner-kargo.webp`
```
[A ailesi STYLE prefix]

SUBJECT: A minimal, elegant cardboard shipping box floating slightly
off-centre to the right, its tape seam catching a thin electric blue light
line, motion-blurred blue light streaks passing behind it left-to-right
suggesting speed and delivery. Very wide, short banner composition with the
left half nearly empty. No text, no shipping labels, no barcodes, no logos.
```

### 4b. Güvenli ödeme şeridi → `assets/images/banner-odeme.webp`
```
[A ailesi STYLE prefix]

SUBJECT: A single closed padlock rendered as a polished dark-metal object,
centred, with a soft electric blue (#2563EB) glow emanating from the keyhole
and a faint concentric ring of light expanding outward like a shield. Very
wide, short banner composition, deep navy backdrop, generous empty space on
both sides. No text, no credit cards, no shield clipart, no lock icon
graphics — a real photographic-looking object.
```

---

## 5) Hakkımızda — Mağaza Atmosferi

**Kullanım yeri:** `hakkimizda.html:297` (şu an `hakkimizda-sketch.webp`).
**Boyut:** 1600×1100 px.
**Kayıt:** `assets/images/hakkimizda-magaza.webp`

```
STYLE: Warm, editorial interior photography, golden-hour daylight coming
through a shopfront window, shot at 35mm with natural depth of field. Real,
lived-in, human scale — an independent neighbourhood electronics and telecom
store, not a corporate big-box retailer. Muted warm greys and wood tones with
one cool blue (#2563EB) accent from a backlit shelf edge or display glow.
Photographic, not illustrated. No text, no readable signage, no logos, no
recognisable faces (people only as soft out-of-focus silhouettes if at all).

SUBJECT: The interior of a small clean electronics shop — a glass counter
with smartwatches and earbuds neatly arranged on risers, a wooden wall shelf
behind it with boxed accessories, a single pendant lamp overhead. Everything
tidy and deliberately sparse, showing care rather than volume. Wide
composition with calm empty space in the upper third.
```

---

## 6) Boş Durum (Empty State) Görselleri — B ailesi (farklı stil)

Boş durumlar kart **içinde**, açık zeminde görünür ve küçüktür. Fotoğraf orada ağır kaçar. Burada ayrı bir stil ailesi kullan:

**B ailesi stil sabiti:**
```
STYLE: Minimal 3D-rendered icon illustration on a fully transparent
background (PNG with alpha). Soft clay-like matte surfaces, gentle ambient
occlusion, one soft shadow directly beneath the object. Two-tone palette
only: neutral slate grey (#94A3B8) for the object body and electric blue
(#2563EB) for exactly one highlighted detail. Rounded, friendly, slightly
oversized proportions. Centred, generous padding around the object. No
background, no ground plane, no text, no gradients behind the subject.
```

**Boyut:** 600×600 px, **şeffaf PNG** (karanlık modda da çalışması için zorunlu).

### 6a. Boş sepet → `assets/images/empty-cart.png`
```
[B ailesi STYLE prefix]
SUBJECT: An empty shopping basket tilted slightly, seen from a three-quarter
angle, nothing inside it. One small blue dot floats just above the rim as if
an item is about to drop in.
```

### 6b. Boş favoriler → `assets/images/empty-favorites.png`
```
[B ailesi STYLE prefix]
SUBJECT: A rounded hollow heart shape with a thick soft outline and an empty
centre. A single small solid blue heart floats beside it, much smaller, as an
invitation.
```

### 6c. Sipariş yok → `assets/images/empty-orders.png`
```
[B ailesi STYLE prefix]
SUBJECT: A closed cardboard-style shipping box with a blue tape strip across
the top seam, sitting alone. Nothing else in frame.
```

### 6d. Sonuç bulunamadı → `assets/images/empty-search.png` (YENİ — `urunler.html` filtre boş dönünce)
```
[B ailesi STYLE prefix]
SUBJECT: A rounded magnifying glass tilted at 30 degrees, its lens empty and
faintly blue-tinted, with three tiny grey dots scattered below it suggesting
nothing was found.
```

---

## 7) 404 Sayfası

**Boyut:** 1200×900 px, şeffaf PNG. **Kayıt:** `assets/images/404.png`
```
[B ailesi STYLE prefix]
SUBJECT: A smartwatch lying flat on its side, screen dark except for a single
blue question-mark-shaped glow arc, with one small disconnected cable end
floating nearby. Calm and charming, not alarming.
```

---

## 8) Sosyal Paylaşım (OG) Görseli

**Kullanım yeri:** `og:image` meta etiketi (tüm sayfalar).
**Boyut:** 1200×630 px — **metin Gemini'ye yazdırılmaz**, sonradan sen ekleyeceksin.
```
[A ailesi STYLE prefix — COMPOSITION satırını şununla değiştir:]
COMPOSITION: 1200x630 landscape. Products clustered in the right third; the
left two thirds is clean deep-navy negative space reserved for a logo and a
headline that will be added later in an editor.

SUBJECT: A smartwatch and a pair of true-wireless earbuds in an open case,
lit with a blue rim light, floating over a deep navy gradient.
```

---

## 9) Üretim Kuralları / Kontrol Listesi

- **Aynı sohbette üret.** Önce A ailesi prefix'iyle 2a'yı ürettir, beğendiğini onayla, sonra *"same style, new subject: ..."* diyerek devam et. Farklı sohbetlerde stil kayar.
- **Marka/logo çıkarsa at.** Gemini sık sık Apple/Samsung benzeri logo uyduruyor. Logolu, yazılı, filigranlı çıktı **kullanılmaz** — hem hukuki risk hem `CLAUDE.md` kuralı.
- **Yazı çıkarsa at.** Üretken modeller bozuk harf yazar; hepsi "no text" ile üretilecek, metin UI tarafında.
- **Ürün fotoğrafı olarak KULLANILMAZ.** Bu görsellerin hiçbiri `assets/images/products/` altına konmaz. Katalogda satılan ürünü yalnız üreticinin gerçek görseli temsil eder.
- **Format:** PNG indir → WebP'ye çevir, yanına `.jpg` fallback bırak (`<img onerror>` zincirinde kullanılıyor).
  ```bash
  cwebp -q 82 category-aksesuar.png -o category-aksesuar.webp
  ```
- **Boyut hedefi:** kategori/hero görseli WebP'de **250 KB altı** kalsın; hero 400 KB'ı aşmasın.
- **Kayıt yeri:** `assets/images/` (ürün klasörünün dışı).
- **Şeffaflık:** B ailesi (boş durum + 404) mutlaka alpha kanallı PNG — WebP'ye çevirirken `-alpha_q 100`.
- **Karanlık mod testi:** görseli ekledikten sonra sayfayı hem açık hem koyu temada aç. Beyaz/krem zemin görünüyorsa görsel yanlış üretilmiş demektir.
- **Alt metin:** her `<img>` anlamlı `alt` alır (örn. `alt="Şarj adaptörü ve kablo aksesuarları"`). Dekoratif de olsa boş bırakma.
- **Kod tarafı:** `aksesuar` ve `ses` kategori kartlarına `<img>` etiketi eklendi; dosya yoksa `onerror="this.remove()"` ile gradyan fallback'e düşüyor. Yani görselleri üretip `assets/images/` altına atman yeterli, HTML'e dokunmana gerek yok.
