# برنامهٔ چندسکویی — اندروید، اندروید تی‌وی، ویندوز و iOS (PWA)

> هدف: هر دستگاه «فایل نهایی» داشته باشد. APK و EXE در GitHub Actions ساخته و به همان
> Release چسبانده می‌شوند؛ آیفون/دسکتاپ از خود سایت نصب می‌شوند (PWA) چون اپل اجازهٔ
> نصب فایل APK/EXE نمی‌دهد.

| دستگاه | فایل نهایی | چطور ساخته می‌شود |
|---|---|---|
| اندروید (گوشی/تبلت) | `filmwork-android.apk` | `Build apps` → job اندروید |
| اندروید تی‌وی / باکس | **همان** `filmwork-android.apk` | همان بیلد (Manifest با `LEANBACK_LAUNCHER`) |
| ویندوز ۱۰/۱۱ | `filmwork-windows-x.y.z.exe` (نصب‌کننده + portable) | job ویندوز |
| آیفون / آیپد | نصب از Safari → «Add to Home Screen» | خود سایت (`/manifest.webmanifest` + `/sw.js`) |
| مک/لینوکس/کروم | نصب PWA از نوار آدرس | همان |
| تلگرام | مینی‌اپ (بدون نصب) | BotFather → Configure Mini App |

## ساخت با گیت‌هاب (بدون نصب چیزی روی سیستم)

> **فعال‌سازی یک‌بارهٔ CI:** فایل ورک‌فلوی بیلد در `app/ci/build-apps.yml` نگه داشته شده
> (توکن‌های GitHub App اجازهٔ ساختن فایل داخل `.github/workflows/` را ندارند). یک‌بار
> این را اجرا کن و پوش کن:
> ```bash
> mkdir -p .github/workflows && cp app/ci/build-apps.yml .github/workflows/
> git add .github/workflows/build-apps.yml && git commit -m "ci: build apps" && git push
> ```
> اگر با توکن شما هم رد شد، فایل را از رابط وب گیت‌هاب
> (Add file → Create new file → `.github/workflows/build-apps.yml`) بساز و محتوای
> `app/ci/build-apps.yml` را در آن بچسبان.

1. تگ بزن تا Release ساخته شود:
   ```bash
   git tag app-v1.0.0
   git push origin app-v1.0.0
   ```
2. یا از تب **Actions** → **Build apps** → **Run workflow** و آدرس سایت را وارد کن.
   آدرس را می‌توانی یک‌بار به‌صورت Variable با نام `SITE_URL` در Settings → Variables ذخیره کنی
   تا هر بار لازم نباشد.

پس از پایان: در **Releases** فایل‌های `filmwork-android.apk` و `filmwork-windows-*.exe` آماده‌اند.

> نسخهٔ APK فعلاً با کلید debug امضا می‌شود (قابل نصب روی همهٔ گوشی‌ها). اگر خواستی
> امضای رسمی (Play Store یا آپدیت بدون حذف برنامه) داشته باشی، Keystore را بساز و این
> Secretها را در ریپو بگذار: `KEYSTORE_BASE64`، `KEYSTORE_PASSWORD`، `KEY_ALIAS`،
> `KEY_PASSWORD` — سپس در جریان بیلد `assembleRelease` با
> `-Pandroid.injected.signing.store.file=…` اجرا می‌شود.

## اجرای محلی (اختیاری)

```bash
# اندروید — نیاز به Android Studio / JDK 17
cd app
npm install
SITE_URL=https://your-site.com node scripts/configure.mjs
npx cap add android && npx cap sync android
node scripts/patch-android.mjs
cd android && ./gradlew assembleDebug

# ویندوز
cd app/desktop
npm install
echo https://your-site.com > site-url.txt
npm run dist
```

## نکته‌های مهم

- برنامه **پوستهٔ سایت** است؛ محتوا و پخش آنلاین همان سایت است و با هر تغییر سایت
  نیازی به APK جدید نیست. فقط اگر آدرس سایت عوض شد، APK/EXE تازه بساز (یا در صفحهٔ
  انتخاب آدرس، آدرس تازه را وارد کن).
- برای Android TV همان APK را با `adb install` یا از فلش نصب کن؛ در لانچر تلویزیون
  با آیکن برنامه دیده می‌شود. کنترل از راه دور (D-pad) در سایت پشتیبانی می‌شود
  (کلیدهای جهت‌دار بین کارت‌ها جابه‌جا می‌شوند و Enter باز می‌کند).
- PWA روی آیفون: سایت باید **HTTPS** باشد و از Safari نصب شود (نه از داخل تلگرام).
- در حالت مینی‌اپ تلگرام، Service Worker ثبت نمی‌شود (لازم هم نیست).
