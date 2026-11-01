# سینماگرام v3 — سایت فیلم و سریال تک‌فایلی

کل سایت (API، پنل مدیریت، مینی‌اپ تلگرام، پلیر و پیام‌رسان) در یک فایل `worker.js`
است. یک بار deploy می‌شود و روی Cloudflare Workers، هاست اشتراکی Node یا آینهٔ PHP
اجرا می‌شود.

## شروع سریع

### الف) Cloudflare Workers (پیشنهادی)

1. یک D1 بساز و به Worker با نام **`DB`** بایند کن (KV لازم نیست).
2. `wrangler.toml` را با شناسهٔ D1 و نام Worker خودت تنظیم کن.
3. `npx wrangler deploy` (یا اتصال ریپو به Workers Builds).
4. سایت را باز کن — جدول‌ها در اولین درخواست خودکار ساخته می‌شوند.
   توکن ربات را در Settings → Variables/Secrets بگذار.

### ب) هاست اشتراکی (cPanel) با Node

```bash
PORT=8080 node hosting/server.mjs
```

داده‌ها در `hosting/data/*.sqlite` می‌مانند؛ بدون هیچ وابستگی به Cloudflare.

### ج) آینهٔ PHP (بدون Node، فقط برای پنهان‌کردن IP)

`hosting/php/index.php` + `hosting/php/.htaccess` را در `public_html` بگذار و
`UPSTREAM` را به آدرس سایت اصلی تغییر بده.

## امکانات

| بخش | خلاصه | راهنما |
|---|---|---|
| پخش آنلاین | پردازش MKV/MP4 روی سرور، توکن کوتاه‌عمر، لبه‌های پخش | [docs/ONLINE-PLAYER.md](docs/ONLINE-PLAYER.md) |
| دوبلهٔ صوتی جدا | مدیر برای هر نسخه لینک فایل صدا می‌دهد؛ کاربر مثل زیرنویس انتخاب می‌کند | [docs/ONLINE-PLAYER.md](docs/ONLINE-PLAYER.md) |
| ظاهر زیرنویس | اندازه، فونت، رنگ، حاشیه، شفافیت، جای زیرنویس، فاصلهٔ خطوط | داخل پلیر → ⚙ تنظیمات |
| ادامهٔ تماشا | پلیر موقعیت را ذخیره می‌کند و در صفحهٔ خانه ردیف «ادامهٔ تماشا» می‌آید | — |
| بدون KV | همه‌چیز روی D1 (۱۰۰ برابر سهمیهٔ نوشتن) | [docs/NO-KV-D1.md](docs/NO-KV-D1.md) |
| هاست اشتراکی | اجرای مستقل روی Node یا آینهٔ PHP | [docs/SHARED-HOSTING.md](docs/SHARED-HOSTING.md) |
| ضد فیلتر | دامنه پشت Cloudflare + آینهٔ هاست؛ IP سرور دیده نمی‌شود | [docs/ANTI-FILTER.md](docs/ANTI-FILTER.md) |
| D1 چندحسابی | شارد محتوا روی اکانت دوم | [docs/D1-SHARDS.md](docs/D1-SHARDS.md) |
| برنامه‌ها | APK اندروید/تی‌وی، EXE ویندوز، PWA آیفون | [app/README.md](app/README.md) |
| جابه‌جایی دامنه | وقتی دامنه فیلتر شد | [docs/DOMAIN-MOVE.md](docs/DOMAIN-MOVE.md) |
| ربات محتوا | ساخت خودکار آثار از کانال تلگرام | [docs/CONTENT-BOT.md](docs/CONTENT-BOT.md) |
| پلتفرم تبلیغات | `ads.js` — حراج تبلیغ و پلیر تبلیغ | [docs/ADS-PLATFORM.md](docs/ADS-PLATFORM.md) |

## برنامه‌ها (فایل نهایی)

| دستگاه | فایل | ساخت |
|---|---|---|
| اندروید + اندروید تی‌وی | `filmwork-android.apk` | `.github/workflows/` از `app/ci/build-apps.yml` |
| ویندوز ۱۰/۱۱ | `filmwork-windows-x.y.z.exe` | همان ورک‌فلو |
| آیفون / آیپد | نصب PWA از Safari | خود سایت |

> فعال‌سازی CI: `mkdir -p .github/workflows && cp app/ci/build-apps.yml .github/workflows/`
> و سپس push. جزئیات در [app/README.md](app/README.md).

## تست

```bash
node tests/check.mjs           # اعتبارسنجی کلی
for f in tests/*.mjs; do node "$f" || echo "FAIL $f"; done
```

## متغیرهای مهم

| متغیر | کار |
|---|---|
| `DB` (Binding) | D1 اصلی (کاربر، کیف پول، آثار، تنظیمات) |
| `STORAGE_BACKEND` | `d1` / `hybrid` / `kv` — خالی = خودکار |
| `BOT_TOKEN`, `BOT_USERNAME` | ربات ورود/ارسال فایل |
| `CONTENT_BOT_TOKEN`, `CONTENT_ADMIN_IDS` | ربات ساخت محتوا |
| `SITE_PUBLIC_ORIGIN` | قفل‌کردن آدرس عمومی (لینک‌ها همیشه از این دامنه) |
| `UPSTREAM_SITE` | حالت آینه روی `hosting/server.mjs` |
| `UPSTREAM` | آدرس مبدأ در `hosting/php/index.php` |
