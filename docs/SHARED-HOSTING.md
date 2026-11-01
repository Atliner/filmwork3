# اجرا روی هاست اشتراکی (cPanel / DirectAdmin) — بدون Cloudflare

> همان `worker.js` بدون هیچ تغییری روی Node اجرا می‌شود؛ D1/KV/Durable Object
> با SQLite شبیه‌سازی شده‌اند. برای هاست‌های بدون Node هم یک آینهٔ PHP هست.
> این دو مسیر با هم فرق دارند:

| روش | چه چیزی اجرا می‌شود | داده‌ها کجا | مناسب |
|---|---|---|---|
| **Node** (`hosting/server.mjs`) | کل سایت، مستقل | SQLite روی همان هاست | هاست با Node 20+ و SSH/cron |
| **PHP آینه** (`hosting/php/index.php`) | فقط پروکسی به سایت کلادفلر | روی کلادفلر | هر هاست PHP، مخفی‌کردن IP و دور زدن فیلتر |

---

## ۱) مسیر PHP — آینهٔ ساده (سریع‌ترین راه)

اگر هاستت فقط PHP دارد (اکثر هاست‌های ایرانی)، همین کافی است:

1. سایت اصلی را روی Cloudflare Worker بالا بیاور (یا هر جایی که هست).
2. در هاست: `public_html/index.php` = فایل `hosting/php/index.php` را بگذار و
   مقدار `UPSTREAM` را به آدرس سایت اصلی تغییر بده.
3. `hosting/php/.htaccess` را هم کنارش بگذار.
4. SSL را روشن کن (AutoSSL / Let's Encrypt در cPanel).
5. یک ساب‌دامنه (مثلاً `play.example.com`) به همین هاست وصل کن.

کاربر فقط IP هاست را می‌بیند؛ دامنه و IP کلادفلر پنهان است. اگر دامنه فیلتر شد:
یک ساب‌دامنهٔ تازه بساز و `public_html` را همان‌جا ست کن — **هیچ تغییری در سایت لازم نیست**.

محدودیت‌ها: مصرف پهنای باند هاست برای ویدیو، `max_execution_time` (در `.htaccess`
صفر شده)، و اینکه دو بار ترافیک رد می‌شود (کاربر → هاست → کلادفلر). برای پخش
ویدیوی زیاد، از لبه‌های پخش (`docs/ONLINE-PLAYER.md`) استفاده کن تا مسیر ویدیو
از هاست رد نشود.

---

## ۲) مسیر Node — سایت مستقل روی هاست

### پیش‌نیازها

- Node **۲۰ یا بالاتر** (ترجیحاً ۲۲؛ `node:sqlite` از ۲۲.۵ پایدارتر است).
- دسترسی SSH یا «Setup Node.js App» در cPanel.
- یک پوشهٔ خارج از `public_html` برای داده‌ها (مهم).

### نصب

```bash
cd ~/filmwork
node --version          # باید 20+
PORT=8080 node hosting/server.mjs
```

سپس در cPanel → **Setup Node.js App**:

| فیلد | مقدار |
|---|---|
| Application root | `filmwork` |
| Application startup file | `hosting/server.mjs` |
| Environment | `PORT=8080`، `STORAGE_BACKEND=d1`، توکن‌های ربات |
| Node version | 22 |

در `.htaccess` دامنه، درخواست‌ها را به پورت برنامه پروکسی کن:

```apache
RewriteEngine On
RewriteRule ^(.*)$ http://127.0.0.1:8080/$1 [P,L]
```

(اگر هاست `mod_proxy` ندارد، از «Application URL» خودِ cPanel استفاده کن.)

### داده‌ها و پشتیبان

| فایل | محتوا |
|---|---|
| `hosting/data/site.sqlite` | همان D1 سایت (کاربر، کیف پول، آثار، تنظیمات) |
| `hosting/data/cache.sqlite` | کش اختیاری |
| `hosting/data/durable.sqlite` | صف انتشار، mirror، آلارم‌ها (جای Durable Object) |

- این پوشه را **داخل public_html نگذار**؛ فایل SQLite نباید از وب قابل دانلود باشد.
- پشتیبان: `sqlite3 site.sqlite ".backup backup-$(date +%F).sqlite"` (هنگام ترافیک کم).
- اگر هاستت فقط ۱ GB فضا دارد، SQLite چند صد مگابایت کاربر/آثار را راحت می‌گیرد؛
  خود ویدیوها روی تلگرام/هاست جدا هستند.

### کرون

اگر cron Node را اجرا نمی‌کند، همان `server.mjs` هر ۳۰ دقیقه خودش کارهای دوره‌ای
(وبهوک ربات، همگام‌سازی، بنر) را انجام می‌دهد. برای اطمینان بیشتر:

```
*/10 * * * * curl -s -m 20 http://127.0.0.1:8080/api/health >/dev/null
```

### حالت آینه از روی Node

اگر می‌خواهی همین هاست فقط «درب» سایت کلادفلر باشد (داده روی کلادفلر بماند)، در
`hosting/config.json`:

```json
{ "UPSTREAM_SITE": "https://your-site.workers.dev" }
```

در این حالت هیچ داده‌ای روی هاست نوشته نمی‌شود و همه‌چیز (پخش، پنل، ربات) از
کلادفلر می‌آید؛ هاست فقط IP خودش را نشان می‌دهد.

### پیکربندی

`hosting/config.json` (در گیت نیست):

```json
{
  "PORT": 8080,
  "HOST": "0.0.0.0",
  "STORAGE_BACKEND": "d1",
  "BOT_TOKEN": "…",
  "BOT_USERNAME": "…",
  "DELIVERY_BOT_TOKEN": "…",
  "DELIVERY_BOT_USERNAME": "…",
  "CONTENT_BOT_TOKEN": "…",
  "CONTENT_WEBHOOK_SECRET": "…",
  "CONTENT_ADMIN_IDS": "123456",
  "SITE_PUBLIC_ORIGIN": "https://play.example.com",
  "UPSTREAM_SITE": ""
}
```

همه را می‌شود با متغیر محیطی هم داد (اولویت env بالاتر است).

### محدودیت‌ها و نکته‌ها

- **HTTPS** برای مینی‌اپ/PWA/ورود تلگرام لازم است؛ از AutoSSL هاست استفاده کن.
- `better-sqlite3` لازم نیست؛ فقط `node:sqlite` توکار. اگر Node هاست < ۲۲.۵ بود و
  ماژول را نداشت، درخواست بده نسخهٔ ۲۲ نصب شود (یا از NodeSource استفاده کن) —
  مسیر PHP همیشه در دسترس است.
- رمز فایل‌ها: `chmod 600 hosting/data/*.sqlite` و `chmod 700 hosting/data`.
- آپدیت: فایل `worker.js` و `hosting/` را جایگزین کن و سرویس را Restart کن
  (داده‌ها در `hosting/data` می‌مانند).
- اگر روی هاست `worker.js` را با Node اجرا می‌کنی، هر دو نسخه (Cloudflare و هاست)
  **دادهٔ جدا** دارند. برای یکی نگه‌داشتن داده، از حالت آینه (`UPSTREAM_SITE`) یا
  از شارد/پروکسی استفاده کن؛ SQLite محلی با D1 کلادفلر سینک نمی‌شود.
