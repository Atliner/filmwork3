/*
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
const WIN1256_HIGH = "€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈگ‘’“”•–—ک™ڑ›œ‌‍ں ،¢£¤¥¦§¨©ھ«¬­®¯°±²³´µ¶·¸¹؛»¼½¾؟ہءآأؤإئابةتثجحخدذرزسشصض×طظعغـفقكàلâمنهوçèéêëىيîïًٌٍَôُِ÷ّùْûü‎‏ے";

function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
async function hmacSha256Bytes(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof msg === 'string' ? enc.encode(msg) : msg;
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hmacHex(key, msg) {
  return bytesToHex(await hmacSha256Bytes(key, msg));
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function bytesB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function streamAesKey(secret) {
  let k = streamKeys.get(secret);
  if (!k) {
    k = crypto.subtle.digest('SHA-256', enc.encode('mvx-stream-v1|' + secret)).then(function (raw) {
      return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    });
    streamKeys.set(secret, k);
    if (streamKeys.size > 50) streamKeys.delete(streamKeys.keys().next().value);
  }
  return k;
}
async function streamTokenOpen(secret, token) {
  try {
    if (!token || token.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const all = b64urlDecode(token);
    if (all.length < 29) return null;
    const key = await streamAesKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
    const p = JSON.parse(dec.decode(plain));
    return p && typeof p === 'object' ? p : null;
  } catch (e) { return null; }
}
function streamIpPrefix(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip) return '';
  if (ip.indexOf(':') >= 0) {
    const halves = ip.split('::');
    const head = halves[0] ? halves[0].split(':') : [];
    let all = head;
    if (halves.length > 1) {
      const tail = halves[1] ? halves[1].split(':') : [];
      all = head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail);
    }
    return all.slice(0, 4).map(function (h) { return (h || '0').replace(/^0+(?=.)/, ''); }).join(':') + '::/64';
  }
  const p = ip.split('.');
  return p.length === 4 ? p.slice(0, 3).join('.') + '.0/24' : ip;
}
async function streamBindHash(secret, kind, value) {
  if (!value) return '';
  return (await hmacHex(enc.encode(secret), kind + '|' + value)).slice(0, 16);
}
function streamModernBrowserUa(ua) {
  let m = /(?:Chrome|CriOS|Chromium)\/(\d+)/.exec(ua);
  if (m && Number(m[1]) >= 80) return true;
  m = /Firefox\/(\d+)/.exec(ua);
  if (m && Number(m[1]) >= 90) return true;
  return false;
}
function streamEdgeCors(request, tok) {
  const origin = request.headers.get('origin') || '';
  const h = { 'vary': 'Origin' };
  if (!origin) return h;
  let host = '';
  try { host = new URL(origin).host.toLowerCase(); } catch (e) { return h; }
  const list = (tok && Array.isArray(tok.o)) ? tok.o : [];
  if (!list.length || list.indexOf(host) >= 0) {
    h['access-control-allow-origin'] = origin;
    h['access-control-expose-headers'] = 'Content-Length, Content-Range, Accept-Ranges, Content-Type';
  }
  return h;
}
function streamEdgeDeny(reason, request, tok) {
  return new Response('forbidden: ' + reason, { status: 403, headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-mvx-deny': reason }, streamEdgeCors(request, tok)) });
}
async function streamEdgeChecks(request, secret, tok, kind) {
  if (!tok || tok.v !== 1 || tok.k !== kind) return 'token';
  if (!(Number(tok.e) > Date.now() / 1000)) return 'expired';
  const ref = request.headers.get('referer') || request.headers.get('origin') || '';
  if (ref && Array.isArray(tok.o) && tok.o.length) {
    let host = '';
    try { host = new URL(ref).host.toLowerCase(); } catch (e) { host = ''; }
    if (host && tok.o.indexOf(host) < 0) return 'origin';
  }
  if (kind === 't') return '';
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (tok.i && ip && tok.i !== await streamBindHash(secret, 'ip', streamIpPrefix(ip))) return 'ip';
  const ua = request.headers.get('user-agent') || '';
  if (/AppleCoreMedia/i.test(ua)) return ''; // پخش‌کنندهٔ بومی iOS: UA و هدرهای Sec-Fetch ندارد
  if (tok.a && tok.a !== await streamBindHash(secret, 'ua', ua)) return 'ua';
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) {
    /* پخش داخل‌صفحه (MKV و حالا MP4 با چند ترک صدا/زیرنویس داخلی) یعنی خودِ صفحه
       بایت‌ها را با fetch می‌خواند و مرورگر dest=empty می‌فرستد؛ دانلودمنیجرها
       این هدرها را ندارند و همچنان با همان بررسی UA/referer بیرون می‌مانند. */
    /* empty = خواندن بایت‌ها با fetch توسط خودِ صفحه؛ فقط برای نسخه‌هایی که
       موتور داخلی (MKV یا MP4 چندترک) لازم دارند و در توکن علامت خورده‌اند. */
    const ok = kind === 'v'
      ? ['video', 'audio', 'media'].concat((tok.f === 'mkv' || tok.d === 1) ? ['empty'] : [])
      : ['video', 'audio', 'media', 'empty'];
    if (ok.indexOf(dest) < 0) return 'dest';
  } else if (streamModernBrowserUa(ua)) {
    /* WebView/older browsers may omit Fetch Metadata entirely — allow when the
       request clearly comes from the player page; a bare downloader (no referer) stays out. */
    if (!ref) return 'client';
  }
  return '';
}
function streamMime(fmt, upstreamType) {
  const t = String(upstreamType || '').toLowerCase();
  if (t.indexOf('video/') === 0 || t.indexOf('audio/') === 0) return upstreamType;
  if (fmt === 'mp4') return 'video/mp4';
  if (fmt === 'webm') return 'video/webm';
  if (fmt === 'mkv') return 'video/x-matroska';
  return upstreamType || 'video/mp4';
}
async function streamEdgeProgressive(request, tok, opts) {
  const headers = { 'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0', 'accept': '*/*' };
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.range = range;
  let up;
  const upCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const upTo = upCtrl ? setTimeout(function () { try { upCtrl.abort(); } catch (e) { } }, 8000) : 0;
  try {
    up = await fetch(tok.u, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: headers, redirect: 'follow', signal: upCtrl ? upCtrl.signal : undefined, cf: opts && opts.cacheTtl ? { cacheEverything: true, cacheTtl: opts.cacheTtl } : undefined });
    clearTimeout(upTo);
  } catch (e) {
    clearTimeout(upTo);
    return new Response('upstream unreachable', { status: 502, headers: Object.assign({ 'x-mvx-deny': 'upstream' }, streamEdgeCors(request, tok)) });
  }
  if (up.status >= 400 && up.status !== 416) return new Response('upstream ' + up.status, { status: up.status === 404 ? 404 : 502, headers: Object.assign({ 'cache-control': 'no-store' }, streamEdgeCors(request, tok)) });
  const h = new Headers(streamEdgeCors(request, tok));
  h.set('content-type', streamMime(tok.f, up.headers.get('content-type')));
  ['content-length', 'content-range'].forEach(function (k) { const v = up.headers.get(k); if (v) h.set(k, v); });
  h.set('accept-ranges', up.headers.get('accept-ranges') || (up.status === 206 ? 'bytes' : 'bytes'));
  h.set('cache-control', 'private, no-store, no-transform');
  h.set('content-disposition', 'inline');
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  return new Response(request.method === 'HEAD' ? null : up.body, { status: up.status, headers: h });
}
async function streamEdgeHls(request, tok, tokenStr, rest, base, secret) {
  const root = tok.u;
  const dir = root.slice(0, root.lastIndexOf('/') + 1);
  const rootOrigin = new URL(root).origin;
  let target;
  if (!rest || rest === '/') target = root;
  else if (rest.indexOf('/~') === 0) {
    const parts = rest.slice(2).split('.');
    if (parts.length !== 2) return streamEdgeDeny('path', request, tok);
    let abs = '';
    try { abs = dec.decode(b64urlDecode(parts[0])); } catch (e) { return streamEdgeDeny('path', request, tok); }
    if (parts[1] !== (await hmacHex(enc.encode(secret), 'abs|' + abs)).slice(0, 16)) return streamEdgeDeny('sig', request, tok);
    target = abs;
  } else {
    let rel = rest.slice(1);
    try { rel = rel.split('/').map(function (x) { return decodeURIComponent(x); }).map(function (x) { return encodeURIComponent(x); }).join('/'); } catch (e) { }
    const search = new URL(request.url).search;
    try { target = new URL(rel + search, dir).href; } catch (e) { return streamEdgeDeny('path', request, tok); }
    if (!search && target.split('?')[0] === root.split('?')[0]) target = root; // playlist اصلی با query امضای CDN خودش
    if (new URL(target).origin !== rootOrigin) return streamEdgeDeny('path', request, tok);
  }
  const headers = { 'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0', 'accept': '*/*' };
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.range = range;
  let up;
  try { up = await fetch(target, { headers: headers, redirect: 'follow' }); }
  catch (e) { return new Response('upstream unreachable', { status: 502, headers: streamEdgeCors(request, tok) }); }
  if (up.status >= 400) return new Response('upstream ' + up.status, { status: 502, headers: streamEdgeCors(request, tok) });
  const ct = (up.headers.get('content-type') || '').toLowerCase();
  const playlist = /mpegurl/.test(ct) || /\.m3u8(?:$|\?)/i.test(target);
  const h = new Headers(streamEdgeCors(request, tok));
  h.set('cache-control', 'private, no-store');
  if (!playlist) {
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(function (k) { const v = up.headers.get(k); if (v) h.set(k, v); });
    return new Response(up.body, { status: up.status, headers: h });
  }
  const text = await up.text();
  if (text.length > 4 * 1024 * 1024) return new Response('playlist too large', { status: 502 });
  const pre = base + '/h/' + tokenStr + '/';
  const cache = {};
  async function rewrite(uri) {
    let abs;
    try { abs = new URL(uri, target).href; } catch (e) { return uri; }
    if (abs.indexOf(dir) === 0) {
      const relPath = abs.slice(dir.length);
      // نسبی نسبت به خود این playlist بماند تا مرورگر خودش آدرس لبه را بسازد
      return pre + relPath;
    }
    if (cache[abs]) return cache[abs];
    const sig = (await hmacHex(enc.encode(secret), 'abs|' + abs)).slice(0, 16);
    cache[abs] = pre + '~' + bytesB64url(enc.encode(abs)) + '.' + sig;
    return cache[abs];
  }
  const out = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { out.push(line); continue; }
    if (line.charAt(0) === '#') {
      if (/URI="/.test(line)) {
        const m = /URI="([^"]*)"/.exec(line);
        out.push(m ? line.replace(m[0], 'URI="' + (await rewrite(m[1])) + '"') : line);
      } else out.push(line);
      continue;
    }
    out.push(await rewrite(line.trim()));
  }
  h.set('content-type', 'application/vnd.apple.mpegurl');
  return new Response(out.join('\n'), { status: 200, headers: h });
}
function decodeSubtitleBytes(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const sw = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) { sw[i - 2] = bytes[i + 1]; sw[i - 1] = bytes[i]; }
    return new TextDecoder('utf-16le').decode(sw);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { }
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b < 0x80 ? String.fromCharCode(b) : WIN1256_HIGH.charAt(b - 0x80);
  }
  return s.replace(/\u064a/g, 'ی').replace(/\u0643/g, 'ک');
}
function tsToVtt(t) {
  let m = t.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (m) return m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4].padEnd(3, '0');
  m = t.match(/^(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (m) return '00:' + m[1] + ':' + m[2] + '.' + m[3].padEnd(3, '0');
  return t;
}
function srtToVtt(srt) {
  let s = String(srt || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/i.test(s)) return s;
  const blocks = s.split(/\n{2,}/).map(function (b) { return b.trim(); }).filter(Boolean);
  let out = 'WEBVTT\n\n';
  for (const b of blocks) {
    const lines = b.split('\n');
    let ti = lines.findIndex(function (l) { return l.indexOf('-->') >= 0; });
    if (ti < 0) continue;
    const parts = lines[ti].split('-->');
    out += tsToVtt(parts[0].trim()) + ' --> ' + tsToVtt(parts[1].trim()) + '\n';
    for (let i = ti + 1; i < lines.length; i++) {
      const l = lines[i].replace(/<[^>]+>/g, '').trim();
      if (l) out += l + '\n';
    }
    out += '\n';
  }
  return out;
}
async function streamEdgeSubtitle(request, tok) {
  let up;
  try { up = await fetch(tok.u, { headers: { 'user-agent': 'Mozilla/5.0', 'accept': '*/*' }, redirect: 'follow' }); }
  catch (e) { return new Response('upstream unreachable', { status: 502, headers: streamEdgeCors(request, tok) }); }
  if (!up.ok) return new Response('upstream ' + up.status, { status: 502, headers: streamEdgeCors(request, tok) });
  const buf = new Uint8Array(await up.arrayBuffer());
  if (buf.length > 3 * 1024 * 1024) return new Response('subtitle too large', { status: 413, headers: streamEdgeCors(request, tok) });
  let text = decodeSubtitleBytes(buf).replace(/^\uFEFF/, '');
  if (!/^WEBVTT/i.test(text.trim())) text = srtToVtt(text);
  const h = new Headers(streamEdgeCors(request, tok));
  h.set('content-type', 'text/vtt; charset=utf-8');
  h.set('cache-control', 'private, max-age=3600');
  return new Response(text, { status: 200, headers: h });
}
async function streamEdgeStatus(request, secret, tok) {
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, streamEdgeCors(request, tok)) });
  if (!tok || tok.v !== 1) return json({ ok: false, reason: 'token' });
  if (!(Number(tok.e) > Date.now() / 1000)) return json({ ok: false, reason: 'expired' });
  const ref = request.headers.get('referer') || request.headers.get('origin') || '';
  if (ref && Array.isArray(tok.o) && tok.o.length) {
    let host = '';
    try { host = new URL(ref).host.toLowerCase(); } catch (e) { host = ''; }
    if (host && tok.o.indexOf(host) < 0) return json({ ok: false, reason: 'origin' });
  }
  if (tok.k !== 't') {
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (tok.i && ip && tok.i !== await streamBindHash(secret, 'ip', streamIpPrefix(ip))) return json({ ok: false, reason: 'ip' });
    const ua = request.headers.get('user-agent') || '';
    if (!/AppleCoreMedia/i.test(ua) && tok.a && tok.a !== await streamBindHash(secret, 'ua', ua)) return json({ ok: false, reason: 'ua' });
    try {
      const up = await fetch(tok.u, { method: 'GET', headers: { 'range': 'bytes=0-1', 'user-agent': ua || 'Mozilla/5.0' }, redirect: 'follow', signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
      const st = up.status;
      try { if (up.body) await up.body.cancel(); } catch (e) { }
      if (st >= 400 && st !== 416) return json({ ok: false, reason: 'upstream', upstream: st });
    } catch (e) {
      return json({ ok: false, reason: 'upstream', upstream: 0 });
    }
  }
  return json({ ok: true });
}
async function streamEdgeHandle(request, secret, opts) {
  opts = opts || {};
  if (!secret) return new Response('edge not configured', { status: 503 });
  const url = new URL(request.url);
  let path = url.pathname;
  if (opts.prefix && path.indexOf(opts.prefix) === 0) path = path.slice(opts.prefix.length);
  const m = /^\/(v|h|t|status)\/([A-Za-z0-9_-]{24,4000})(\/.*)?$/.exec(path);
  if (!m) return new Response('not found', { status: 404 });
  const tok = await streamTokenOpen(secret, m[2]);
  if (m[1] === 'status') return streamEdgeStatus(request, secret, tok);
  if (request.method === 'OPTIONS') {
    const h = streamEdgeCors(request, tok);
    h['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
    h['access-control-allow-headers'] = 'Range';
    h['access-control-max-age'] = '86400';
    return new Response(null, { status: 204, headers: h });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const bad = await streamEdgeChecks(request, secret, tok, m[1]);
  if (bad) return streamEdgeDeny(bad, request, tok);
  if (m[1] === 'v') return streamEdgeProgressive(request, tok, opts);
  if (m[1] === 't') return streamEdgeSubtitle(request, tok);
  return streamEdgeHls(request, tok, m[2], m[3] || '', url.origin + (opts.prefix || ''), secret);
}

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
