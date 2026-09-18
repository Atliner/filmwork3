/*
 * ═══════════════════════════════════════════════════════════════════
 *  🧩 shard-proxy — شارد D1 روی اکانت دیگر (فدراسیون filmwork3)
 * ═══════════════════════════════════════════════════════════════════
 *  این Worker را روی اکانتِ دیگر Cloudflare Deploy کنید تا دیتابیس D1 آن
 *  اکانت به‌عنوان «شارد» به سایت اصلی اضافه شود. سایت فقط رکوردهای
 *  آثار (it:/sub:) را با hash قطعی کلید به این شارد می‌فرستد؛ کاربران،
 *  کیف پول و تراکنش‌ها هرگز خارج از اکانت اصلی نمی‌روند.
 *
 *  ── اتصال‌های لازم (Settings → Variables and Secrets) ──
 *   Binding:  SHARD_DB    (D1 Database — ترجیحاً خالی)
 *   Secret:   SHARD_SECRET (رمز تصادفی؛ حداقل ۱۶ نویسه)
 *
 *  ── امنیت ──
 *   هر درخواست باید با امضای HMAC-SHA256 روی «method + path + hash(body)
 *   + زمان + nonce» امضا شده باشد؛ پنجره زمانی ±۳۰ ثانیه و nonce تکراری
 *   رد می‌شود. فقط کلیدهای it:/sub: پذیرفته می‌شوند و هیچ داده‌ای
 *   خارج از این دو پیشوند قابل خواندن/نوشتن نیست.
 *
 *  راهنمای کامل: docs/D1-SHARDS.md
 *  نصب خودکار:   node scripts/shard-installer.mjs
 * ═══════════════════════════════════════════════════════════════════
 */
'use strict';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS filmwork_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER) WITHOUT ROWID',
  'CREATE INDEX IF NOT EXISTS filmwork_records_expiry ON filmwork_records(expires_at) WHERE expires_at IS NOT NULL',
];
const ALLOWED_PREFIXES = ['it:', 'sub:'];
const MAX_RECORD = 1000000;
const MAX_BODY = 1100000;
const TS_WINDOW_SEC = 300;
const NONCE_TTL_MS = 600000;

/* nonceها در حافظهٔ isolate نگه داشته می‌شوند (سقف ۵۰۰ + پیرایش) */
const seenNonces = new Map();
function pruneNonces() {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [n, t] of seenNonces) if (t < cutoff) seenNonces.delete(n);
  if (seenNonces.size > 5000) {
    for (const [n, t] of seenNonces) if (t < Date.now() - 300000) seenNonces.delete(n);
    if (seenNonces.size > 6000) seenNonces.clear();
  }
}
function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
async function sha256Hex(text) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || '')));
}
async function hmacSha256Hex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, data));
}
function allowedKey(k) {
  k = String(k || '');
  for (const p of ALLOWED_PREFIXES) if (k.indexOf(p) === 0) return true;
  return false;
}
/* تأیید امضا + بازگشت متن بدنه برای استفادهٔ مجدد */
async function verify(req, secret) {
  if (!secret) return { error: 'no-secret', body: '' };
  const ts = req.headers.get('x-shard-ts');
  const nonce = req.headers.get('x-shard-nonce');
  const sign = req.headers.get('x-shard-sign');
  if (!ts || !nonce || !sign) return { error: 'missing-headers', body: '' };
  const now = Math.floor(Date.now() / 1000);
  if (!/^\d{9,12}$/.test(ts) || Math.abs(now - Number(ts)) > TS_WINDOW_SEC) return { error: 'timestamp-out-of-window', body: '' };
  if (seenNonces.has(nonce)) return { error: 'nonce-reused', body: '' };
  const url = new URL(req.url);
  let bodyText = '';
  if (req.method === 'POST' || req.method === 'PUT') {
    const len = parseInt(req.headers.get('content-length') || '0', 10);
    if (len > MAX_BODY) return { error: 'body-too-large', body: '' };
    bodyText = await req.text();
  }
  const bodyHash = await sha256Hex(bodyText);
  const expected = await hmacSha256Hex(secret, new TextEncoder().encode(req.method + '\n' + url.pathname + url.search + '\n' + bodyHash + '\n' + ts + '\n' + nonce));
  const got = String(sign).toLowerCase();
  if (expected.length !== got.length || expected !== got) return { error: 'bad-signature', body: '' };
  seenNonces.set(nonce, Date.now());
  pruneNonces();
  return { error: null, body: bodyText };
}
function j(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
async function openDb(env) {
  const db = env.SHARD_DB;
  if (!db || !db.prepare) return null;
  await db.batch(SCHEMA.map(function (sql) { return db.prepare(sql); }));
  return db;
}
async function catalogItems(db) {
  const rows = await db.prepare('SELECT value FROM filmwork_records WHERE key LIKE \'it:%\' AND (expires_at IS NULL OR expires_at > ?)')
    .bind(Math.floor(Date.now() / 1000)).all();
  const items = [];
  for (const r of rows.results || []) {
    try {
      const v = JSON.parse(r.value);
      items.push({ id: v.id || '', title: v.title || '', type: v.type || '', addedAt: v.addedAt || 0, updatedAt: v.updatedAt || 0 });
    } catch (e) { /* رکورد ناقص را نمایش نده */ }
  }
  items.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
  return items;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const p = url.pathname;
      if (!['/health', '/get', '/put', '/del', '/list', '/catalog'].includes(p)) return j({ error: 'not-found' }, 404);
      const v = await verify(request, env.SHARD_SECRET);
      if (v.error) return j({ error: v.error }, 401);
      const db = await openDb(env);
      if (!db) return j({ error: 'no-d1-binding' }, 500);

      if (p === '/health') return j({ ok: true, time: Date.now() });
      if (p === '/get') {
        const k = url.searchParams.get('k') || '';
        if (!allowedKey(k)) return j({ error: 'key-not-allowed' }, 400);
        const row = await db.prepare('SELECT value FROM filmwork_records WHERE key=? AND (expires_at IS NULL OR expires_at > ?)')
          .bind(k, Math.floor(Date.now() / 1000)).first();
        if (!row) return j({ missing: true });
        return j({ value: JSON.parse(row.value) });
      }
      if (request.method !== 'POST') return j({ error: 'method-not-allowed' }, 405);
      const body = v.body ? JSON.parse(v.body) : null;
      if (!body || typeof body !== 'object') return j({ error: 'bad-json' }, 400);
      const k = String(body.k || '');
      if (!allowedKey(k)) return j({ error: 'key-not-allowed' }, 400);

      if (p === '/put') {
        const val = typeof body.v === 'string' ? body.v : JSON.stringify(body.v);
        if (new TextEncoder().encode(val).length > MAX_RECORD) return j({ error: 'record-too-large' }, 413);
        const ttl = Math.max(0, Math.floor(Number(body.ttl) || 0));
        const expires = ttl ? Math.floor(Date.now() / 1000) + ttl : null;
        await db.prepare('INSERT INTO filmwork_records(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at')
          .bind(k, val, expires).run();
        return j({ ok: true });
      }
      if (p === '/del') {
        await db.prepare('DELETE FROM filmwork_records WHERE key=?').bind(k).run();
        return j({ ok: true });
      }
      if (p === '/list') {
        const prefix = String(body.prefix || '');
        if (prefix && !ALLOWED_PREFIXES.some(function (x) { return prefix.indexOf(x) === 0; })) return j({ error: 'prefix-not-allowed' }, 400);
        let after = '';
        if (body.cursor) {
          const decoded = JSON.parse(decodeURIComponent(body.cursor));
          if (decoded.prefix !== prefix || typeof decoded.after !== 'string') return j({ error: 'bad-cursor' }, 400);
          after = decoded.after;
        }
        const limit = Math.max(1, Math.min(1000, Number(body.limit) || 1000));
        const rows = await db.prepare('SELECT key FROM filmwork_records WHERE key>=? AND key<? AND key>? ORDER BY key LIMIT ?')
          .bind(prefix, prefix + '\u{10ffff}', after, limit + 1).all();
        const list = rows.results || [];
        const more = list.length > limit;
        const page = list.slice(0, limit);
        return j({ keys: page.map(function (r) { return r.key; }), cursor: more ? encodeURIComponent(JSON.stringify({ prefix: prefix, after: page[page.length - 1].key })) : '' });
      }
      if (p === '/catalog') {
        const items = await catalogItems(db);
        return j({ items: items, count: items.length });
      }
      return j({ error: 'not-found' }, 404);
    } catch (e) {
      return j({ error: 'internal' }, 500);
    }
  },
};
