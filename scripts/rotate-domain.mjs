#!/usr/bin/env node
/*
 * rotate-domain.mjs — ساخت سریع ساب‌دامنهٔ تازه برای سایت (وقتی دامنه فیلتر شد)
 * ───────────────────────────────────────────────────────────────────────────
 *  فقط یک CNAME تازه در کلودفلر می‌سازد که به همان Worker/هاست اشاره می‌کند؛
 *  IP سرور عوض نمی‌شود و داده‌ها دست نمی‌خورند.
 *
 *  متغیرهای لازم:
 *    CF_API_TOKEN   توکن با دسترسی Zone.DNS:Edit (همان زون)
 *    CF_ZONE_ID     شناسهٔ Zone (Overview → پایین صفحه)
 *    TARGET         مقصد CNAME: مثلاً your-worker.your-sub.workers.dev
 *                   یا IP/هاست هاست اشتراکی: server.example.com
 *  متغیرهای اختیاری:
 *    SUB            نام ساب‌دامنهٔ تازه (پیش‌فرض: play-<timestamp>)
 *    PROXIED        true/false (پیش‌فرض true — پشت کلودفلر بماند)
 *    TTL            1 = خودکار
 *
 *  نمونه:
 *    CF_API_TOKEN=… CF_ZONE_ID=… TARGET=film.example.workers.dev SUB=play2 \
 *      node scripts/rotate-domain.mjs
 *
 *  خروجی: آدرس کامل تازه + دستورهایی که باید در بات‌فادر/متغیرها عوض شود.
 */

const API = 'https://api.cloudflare.com/client/v4';
const token = process.env.CF_API_TOKEN || '';
const zone = process.env.CF_ZONE_ID || '';
const target = String(process.env.TARGET || '').trim().replace(/\/+$/, '').replace(/^https?:\/\//, '');
const sub = String(process.env.SUB || ('play' + Date.now().toString(36))).trim().toLowerCase();
const proxied = String(process.env.PROXIED || 'true') !== 'false';
const ttl = Number(process.env.TTL || 1);

if (!token || !zone || !target) {
  console.error('CF_API_TOKEN و CF_ZONE_ID و TARGET لازم‌اند.');
  process.exit(1);
}
if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) {
  console.error('SUB نامعتبر است: فقط حروف کوچک انگلیسی، عدد و خط تیره.');
  process.exit(1);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = (json.errors || []).map((e) => e.message).join(' / ') || ('HTTP ' + res.status);
    throw new Error(err);
  }
  return json.result;
}

const zones = await api('/zones/' + zone);
const name = sub + '.' + zones.name;

const existing = await api('/zones/' + zone + '/dns_records?type=CNAME&name=' + encodeURIComponent(name));
const record = { type: 'CNAME', name, content: target, proxied, ttl, comment: 'filmwork rotate ' + new Date().toISOString() };

if (existing && existing.length) {
  await api('/zones/' + zone + '/dns_records/' + existing[0].id, 'PUT', record);
  console.log('✓ رکورد قبلی به‌روز شد: ' + name + ' → ' + target);
} else {
  await api('/zones/' + zone + '/dns_records', 'POST', record);
  console.log('✓ ساب‌دامنهٔ تازه ساخته شد: ' + name + ' → ' + target);
}

const url = 'https://' + name;
console.log('\nآدرس تازه: ' + url + (proxied ? '  (پشت کلودفلر)' : ''));
console.log('\nقدم‌های بعدی:');
console.log('  1) در Cloudflare → Workers → دامنهٔ سفارشی/Route را برای همین نام اضافه کن (اگر Worker است).');
console.log('  2) BotFather → /mybots → Bot Settings → Domain / Mini App → ' + name);
console.log('  3) در سایت: تنظیمات ← آدرس عمومی (SITE_PUBLIC_ORIGIN) = ' + url);
console.log('  4) اگر APK/EXE داری: SITE_URL=' + url + ' و بیلد تازه (یا در صفحهٔ انتخاب آدرس، آدرس تازه را بزن).');
