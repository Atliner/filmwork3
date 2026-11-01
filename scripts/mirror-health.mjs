#!/usr/bin/env node
/*
 * mirror-health.mjs — پایش چند آدرس (دامنهٔ اصلی، آینهٔ هاست، لبه) از بیرون
 * ───────────────────────────────────────────────────────────────────────────
 *  روی خود هاست اشتراکی در cron بگذار (هر ۵ دقیقه) تا وقتی دامنه/Worker از
 *  دسترس خارج شد، بفهمی و آدرس تازه بسازی:
 *
 *     # هر ۵ دقیقه
 *     *​/5 * * * *  cd /home/USER/filmwork && /usr/bin/node scripts/mirror-health.mjs \
 *                    https://site.example.com https://mirror.example.ir >> health.log 2>&1
 *
 *  خروجی: یک خط برای هر آدرس (کد، زمان پاسخ) و کد خروج ۱ اگر همه خطا بدهند.
 */
const urls = process.argv.slice(2).filter(Boolean);
if (!urls.length) {
  console.error('آدرس‌ها را بده: node scripts/mirror-health.mjs https://a https://b');
  process.exit(2);
}
const PATH = process.env.HEALTH_PATH || '/api/health';
let alive = 0;
for (const base of urls) {
  const url = base.replace(/\/+$/, '') + PATH;
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), Number(process.env.TIMEOUT_MS || 12000));
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'user-agent': 'filmwork-health/1' } });
    clearTimeout(to);
    const ms = Date.now() - t0;
    const ok = res.status > 0 && res.status < 500;
    if (ok) alive++;
    console.log(new Date().toISOString() + '  ' + (ok ? 'UP  ' : 'WARN') + '  ' + res.status + '  ' + ms + 'ms  ' + base);
  } catch (e) {
    console.log(new Date().toISOString() + '  DOWN  ---  ' + (Date.now() - t0) + 'ms  ' + base + '  (' + (e && e.message) + ')');
  }
}
process.exit(alive ? 0 : 1);
