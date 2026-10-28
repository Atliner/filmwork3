#!/usr/bin/env node
/* ساخت scripts/stream-edge-worker.js از همان توابع worker.js
   ─────────────────────────────────────────────────────────────
   لبهٔ پخش باید دقیقاً همان قالب توکن (AES-GCM) و همان قواعد امنیتی سایت را داشته باشد.
   برای اینکه دو نسخهٔ جدا هرگز از هم عقب نمانند، فایل لبه از روی خود worker.js ساخته می‌شود:
     node scripts/build-stream-edge.mjs          ← بازسازی
     node scripts/build-stream-edge.mjs --check  ← فقط بررسی به‌روز بودن (در tests استفاده می‌شود)
   خروجی یک فایل تک و مستقل است که در داشبورد Cloudflare قابل Paste است. */
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('worker.js', root), 'utf8');
const NAMES = ['bytesToHex', 'hmacSha256Bytes', 'hmacHex', 'b64urlDecode', 'bytesB64url', 'streamAesKey', 'streamTokenOpen',
  'streamIpPrefix', 'streamBindHash', 'streamModernBrowserUa', 'streamEdgeCors', 'streamEdgeDeny', 'streamEdgeChecks', 'streamMime',
  'streamRangeParse', 'streamRangeSlice', 'streamEdgeProgressive', 'streamEdgeHls', 'decodeSubtitleBytes', 'tsToVtt', 'srtToVtt', 'streamEdgeSubtitle', 'streamEdgeStatus', 'streamEdgeHandle'];
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { ' + NAMES.join(', ') + ', WIN1256_HIGH };').toString('base64'));

const header = `/*
 * =====================================================================
 *  🎬 سینماگرام — لبهٔ پخش آنلاین (stream edge)  ·  فایل تولیدشده
 * =====================================================================
 *  این فایل را دستی ویرایش نکنید؛ از روی worker.js ساخته می‌شود:
 *    node scripts/build-stream-edge.mjs
 *
 *  کاربرد: پراکسی امن ویدئو روی یک اکانت رایگان دیگر Cloudflare تا سهمیهٔ
 *  ۱۰۰هزار درخواست روزانهٔ Worker اصلی صرف پخش نشود. می‌توانید چند لبه روی
 *  چند اکانت بسازید؛ سایت کاربران را بین لبه‌ها پخش می‌کند.
 *
 *  نصب (داشبورد Cloudflare):
 *   1) Workers & Pages → Create → Worker → نام دلخواه (مثلاً edge1) → Deploy
 *   2) Edit code → کل همین فایل را Paste و Deploy کنید.
 *   3) Settings → Variables and Secrets → Add:
 *        Secret  EDGE_SECRET   = یک رمز تصادفی ۳۲+ نویسه (در پنل سایت دکمهٔ «ساخت رمز» هست)
 *        (اختیاری) Text CACHE_TTL = 0   ← اگر >0 باشد پاسخ مبدأ تا این ثانیه در کش لبه می‌ماند
 *   4) (توصیه) یک دامنهٔ اختصاصی به Worker بدهید؛ workers.dev در ایران اغلب فیلتر است.
 *   5) پنل سایت → تنظیمات → «🎬 پخش آنلاین» → افزودن لبه: آدرس + همان EDGE_SECRET.
 *
 *  این Worker هیچ دیتابیسی ندارد؛ فقط توکن رمزنگاری‌شدهٔ سایت را باز می‌کند،
 *  قواعد ضددانلود (IP، مرورگر، Sec-Fetch، Referer، انقضا) را بررسی می‌کند و
 *  بایت‌های ویدئو را با پشتیبانی Range از مبدأ عبور می‌دهد (CPU تقریباً صفر).
 * =====================================================================
 */
'use strict';
const EDGE_VERSION = 'mvx-edge-1';
const enc = new TextEncoder();
const dec = new TextDecoder();
const streamKeys = new Map();
const WIN1256_HIGH = ${JSON.stringify(mod.WIN1256_HIGH)};
`;

const body = NAMES.map(function (n) { return mod[n].toString(); }).join('\n');

const footer = `
async function edgeHealth(request, env) {
  const url = new URL(request.url);
  const secret = String(env.EDGE_SECRET || '');
  const ts = Number(url.searchParams.get('ts') || 0);
  const sig = String(url.searchParams.get('sig') || '');
  let auth = false;
  if (secret && sig && Math.abs(Date.now() / 1000 - ts) < 300) {
    auth = (await hmacHex(enc.encode(secret), 'health|' + ts)).slice(0, 32) === sig;
  }
  return new Response(JSON.stringify({ ok: true, v: EDGE_VERSION, configured: secret.length >= 16, auth: auth }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return edgeHealth(request, env);
    if (url.pathname === '/' || url.pathname === '/favicon.ico') {
      return new Response('MVX stream edge — ' + EDGE_VERSION, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const secret = String(env.EDGE_SECRET || '');
    if (secret.length < 16) return new Response('EDGE_SECRET is not configured', { status: 503 });
    return streamEdgeHandle(request, secret, { cacheTtl: Math.max(0, Math.min(86400, Number(env.CACHE_TTL) || 0)) });
  },
};
`;

const out = header + '\n' + body + '\n' + footer;
const target = new URL('scripts/stream-edge-worker.js', root);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur !== out) { console.error('scripts/stream-edge-worker.js قدیمی است؛ node scripts/build-stream-edge.mjs را اجرا کنید.'); process.exit(1); }
  console.log('stream-edge-worker.js is up to date');
} else {
  fs.writeFileSync(target, out);
  console.log('wrote scripts/stream-edge-worker.js (' + out.length + ' bytes)');
}
