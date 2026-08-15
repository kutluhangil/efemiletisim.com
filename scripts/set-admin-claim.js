#!/usr/bin/env node
/* =========================================
   efemiletisim.com – Admin custom claim atama
   =========================================
   Kullanım:
     node scripts/set-admin-claim.js kullanici@ornek.com
     node scripts/set-admin-claim.js kullanici@ornek.com --remove   (admin yetkisini kaldırır)

   Ön koşul: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
   ortam değişkenleri ayarlı olmalı (bkz. .env.example) — ya .env dosyasını
   `export $(cat .env | xargs)` ile yükleyin ya da terminale elle export edin.

   Bu script, hedef kullanıcının admin.html'e giriş yapabilmesi için önce
   Firebase Authentication'da normal bir e-posta/şifre hesabı olarak var
   olmasını gerektirir (Firebase Console → Authentication → Add user, ya da
   sitedeki hesap.html üzerinden normal kayıt).

   Claim ayarlandıktan sonra kullanıcının admin.html'de tekrar giriş yapması
   (ya da mevcut oturumda token'ı yenilemesi) gerekir — Firebase ID token'lar
   custom claim'i yalnızca yeniden basıldığında taşır.
   ========================================= */

const { getFirebaseAdmin } = require('../api/_lib/firebaseAdmin');

async function main() {
  const email  = process.argv[2];
  const remove = process.argv.includes('--remove');

  if (!email) {
    console.error('Kullanım: node scripts/set-admin-claim.js kullanici@ornek.com [--remove]');
    process.exit(1);
  }

  const admin = getFirebaseAdmin();
  const user  = await admin.auth().getUserByEmail(email);

  await admin.auth().setCustomUserClaims(user.uid, { admin: !remove });

  console.log(
    remove
      ? `${email} (uid: ${user.uid}) için admin yetkisi kaldırıldı.`
      : `${email} (uid: ${user.uid}) artık admin. admin.html'de tekrar giriş yapması gerekiyor.`
  );
  process.exit(0);
}

main().catch(err => {
  console.error('Hata:', err.message);
  process.exit(1);
});
