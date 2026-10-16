/*
 * =====================================================================
 *  📢 سینماگرام — پلتفرم تبلیغ‌دهندگان (ads.js) · یک Worker مستقل
 * =====================================================================
 *  این فایل را روی یک Worker جدا (در هر اکانت دیگری از Cloudflare) Deploy کنید.
 *  تبلیغ‌دهنده ثبت‌نام می‌کند، کیف پولش را با «استارز تلگرام» یا «کارت‌به‌کارت
 *  هوشمند» شارژ می‌کند، جایگاه‌ها و تعرفه‌ها را می‌بیند و کمپین می‌سازد:
 *    • ویدئویی (مثل یوتیوب/آپارات): قبل از دانلود + شروع پخش + تعویض کیفیت/نسخه
 *      + میان‌پخش؛ هزینه فقط به ازای «بازدید کامل» (CPV)، رد کردن رایگان است.
 *    • بنری: روی پلیر، هنگام توقف و قبل از دانلود (CPM)
 *    • لینکی: دکمهٔ زیر فایل‌های ارسالی ربات (CPM) با قوانین روشن
 *  هر کمپین و هر تغییرش تا «تأیید مدیر» در همین پلتفرم پخش نمی‌شود.
 *  آمار دقیق (نمایش، بازدید کامل، رد کردن، کلیک، CTR، زمان تماشا، دستگاه، نوع
 *  محتوا، ساعت) برای هر تبلیغ‌دهنده + آمار کلی بازار برای همه.
 *
 *  ── نصب ────────────────────────────────────────────────────────────
 *  1) Workers & Pages → Create Worker → کل این فایل را Paste و Deploy کنید.
 *  2) Storage → D1 → Create database (مثلاً ads-db) → در Worker:
 *       Settings → Bindings → D1 → Variable name = ADS_DB
 *  3) (توصیه برای فایل ویدئو/بنر) KV namespace بسازید → Binding با نام ADS_KV
 *     (بدون KV، فایل‌ها تکه‌تکه در همان D1 ذخیره می‌شوند).
 *  4) Settings → Variables and Secrets:
 *       Secret  NET_SECRET     کلید اتصال به سایت اصلی (۳۲+ نویسهٔ تصادفی)؛ همین
 *                               را در پنل سایت ← تبلیغات ← «کلید اتصال» بگذارید.
 *       Secret  ADS_BOT_TOKEN   (اختیاری) توکن یک ربات تلگرام برای استارز و اعلان‌ها
 *       Text    ADMIN_EMAILS    (اختیاری) ایمیل مدیران، با ویرگول؛ اگر خالی باشد
 *                               اولین حساب ثبت‌نام‌شده مدیر می‌شود.
 *  5) دامنهٔ اختصاصی بدهید (workers.dev در ایران فیلتر است و Cache API ندارد).
 *  6) وارد پنل شوید ← تنظیمات: تعرفه‌ها، کارت، استارز و «ثبت وبهوک ربات».
 *  راهنمای کامل: docs/ADS-PLATFORM.md
 *
 *  ── سهمیهٔ رایگان ──
 *  انتخاب تبلیغ در خود سایت انجام می‌شود (فهرست کمپین‌ها هر ۹۰ ثانیه یک‌بار گرفته
 *  می‌شود) و رویدادها دسته‌ای (هر ~۲۰ ثانیه) می‌رسند؛ هر دسته ۲ نوشتن D1 به ازای
 *  هر کمپین دارد. فایل‌های تبلیغ با کش «immutable» یک‌بار برای هر کاربر دانلود می‌شوند.
 * =====================================================================
 */
'use strict';
const VERSION = 'ads-1.0';
const enc = new TextEncoder();
const dec = new TextDecoder();
const DAY = 86400000;
const PBKDF2_ITER = 5000; // سقف CPU پلن رایگان (۱۰ms)؛ با محدودیت تلاش ورود جبران می‌شود
const SLOT_INFO = {
  dl: { f: 'video,banner', title: 'قبل از دانلود', desc: 'تمام‌صفحه پیش از هدایت به ربات دانلود؛ غیرقابل‌رد' },
  pre: { f: 'video', title: 'شروع پخش آنلاین', desc: 'پیش از شروع فیلم/قسمت در پلیر (Pre-roll)' },
  sw: { f: 'video', title: 'تعویض کیفیت/نسخه', desc: 'وقتی بیننده کیفیت یا دوبله/زیرنویس را عوض می‌کند' },
  mid: { f: 'video', title: 'میان‌پخش', desc: 'وسط تماشا (اگر سایت فعال کرده باشد)' },
  ov: { f: 'banner', title: 'بنر روی پلیر', desc: 'نوار پهن پایین تصویر حین پخش (۷۲۸×۹۰)' },
  pause: { f: 'banner', title: 'بنر توقف', desc: 'وسط تصویر هنگام Pause (۳۰۰×۲۵۰)' },
  bot: { f: 'link', title: 'دکمهٔ زیر فایل ربات', desc: 'دکمهٔ لینک زیر فایل‌های ارسالی ربات؛ زیر هر فایل روی‌هم حداکثر ۳ لینک می‌آید (با دکمهٔ سایت، ۲ لینک تبلیغی) و در هر ارسال چند کمپین متفاوت با وزن پیشنهاد انتخاب می‌شوند — نمایش‌ها بین همهٔ کمپین‌ها می‌چرخد' },
};
const FORMAT_SLOTS = { video: ['dl', 'pre', 'sw', 'mid'], banner: ['ov', 'pause', 'dl'], link: ['bot'] };
const FORMAT_TITLE = { video: 'ویدئویی', banner: 'بنری', link: 'لینکی' };
const DEFAULT_RULES = [
  'قوانین عمومی',
  '۱. محتوای تبلیغ (و صفحهٔ مقصد) نباید غیراخلاقی، قمار/شرط‌بندی، کلاهبرداری، فروش اطلاعات یا حساب، سیاسی یا مغایر قوانین باشد.',
  '۲. تبلیغ نباید خود را جای سایت/ربات جا بزند یا دکمهٔ جعلی «دانلود»، «پخش» و «ادامه» نشان دهد.',
  '۳. هر کمپین و هر تغییر در فایل، متن یا لینک، پیش از نمایش توسط مدیر بررسی می‌شود.',
  '۴. بودجهٔ کمپین هنگام ارسال برای بررسی از کیف پول کنار گذاشته می‌شود؛ اگر رد شود یا کمپین را متوقف کنید، باقی‌مانده فوراً برمی‌گردد.',
  '۵. تعرفه‌ها هنگام ارسال کمپین قفل می‌شوند؛ تغییر تعرفهٔ سایت روی کمپین‌های فعلی اثر ندارد.',
  '',
  'تبلیغ ویدئویی',
  '• فایل MP4 (H.264/AAC)، حداکثر ۳۰ ثانیه و ۸ مگابایت؛ افقی ۱۶:۹ برای پلیر و (اختیاری) عمودی ۹:۱۶ برای قبل از دانلود.',
  '• هزینه فقط به ازای «بازدید کامل» (۱۰ ثانیه یا کل ویدئو اگر کوتاه‌تر است) کسر می‌شود؛ رد کردن زودتر رایگان است.',
  '• پیام اصلی را در ۵ ثانیهٔ اول بگویید؛ دکمهٔ «رد کردن» پس از چند ثانیه ظاهر می‌شود.',
  '',
  'تبلیغ بنری',
  '• JPG/PNG/WebP/GIF حداکثر ۶۰۰ کیلوبایت: پهن ۷۲۸×۹۰ (پلیر)، مستطیل ۳۰۰×۲۵۰ (توقف)، عمودی ۱۰۸۰×۱۹۲۰ (قبل از دانلود).',
  '• هزینه به ازای هر هزار نمایش (CPM)؛ کلیک‌ها برای گزارش شمرده می‌شوند.',
  '',
  'تبلیغ لینکی (دکمهٔ زیر فایل ربات)',
  '• متن دکمه ۳ تا ۳۲ نویسه، حداکثر ۲ ایموجی، بدون کلمات گمراه‌کننده (دانلود، پخش، ادامه، دریافت فایل…).',
  '• لینک باید https یا لینک تلگرام باشد؛ کوتاه‌کننده‌های لینک و لینک مستقیم فایل اجرایی (apk, exe, zip…) ممنوع است.',
  '• هزینه به ازای هر هزار ارسال فایل (CPM)؛ هر کاربر روزانه حداکثر به اندازهٔ «سقف تکرار» یک تبلیغ را می‌بیند.',
].join('\n');
const SETTINGS_DEFAULTS = {
  siteName: 'سینماگرام', siteUrl: '', brand: 'تبلیغات سینماگرام', support: '',
  netSecret: '', secret: '',
  tariffs: { video: { cpm: 0, cpv: 60, cpc: 0 }, banner: { cpm: 12000, cpv: 0, cpc: 0 }, link: { cpm: 8000, cpv: 0, cpc: 0 } },
  minBudget: 100000, minDaily: 20000, maxBid: 5,
  viewSec: 10, skipAfter: 5, bannerSec: 8, maxVideoSec: 30, minVideoSec: 5, maxVideoMB: 8, maxImageKB: 600, invTtl: 90,
  allowExternalMedia: true, linkViaSite: true,
  rules: DEFAULT_RULES,
  bannedWords: 'شرط‌بندی,شرطبندی,کازینو,قمار,پوکر,بت فوروارد,پورن,سکسی,بزرگسالان,هک اکانت,فروش اکانت',
  shorteners: 'bit.ly,tinyurl.com,goo.gl,t.co,cutt.ly,is.gd,ow.ly,rebrand.ly,shorturl.at,tiny.cc,yun.ir,b2n.ir',
  k2k: { enabled: false, card: '', holder: '', bank: 'بانک ملی', min: 50000, max: 50000000, ttlMin: 30, presets: [200000, 500000, 1000000, 3000000] },
  stars: { enabled: false, packs: [{ stars: 100, toman: 150000 }, { stars: 250, toman: 390000 }, { stars: 500, toman: 800000 }] },
  adminTgIds: '', botUsername: '',
};

/* ═══════ ابزارها ═══════ */
function hex(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s; }
function rid(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256Hex(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text))); }
async function hmacHexStr(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))));
}
function b64u(str) {
  const b = enc.encode(str); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str); const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return dec.decode(b);
}
function safeEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {}) });
}
function err(msg, status, extra) { return json(Object.assign({ error: msg }, extra || {}), status || 400); }
async function readJson(request, max) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > (max || 65536)) throw Object.assign(new Error('درخواست خیلی بزرگ است'), { status: 413 });
  const t = await request.text();
  if (t.length > (max || 65536)) throw Object.assign(new Error('درخواست خیلی بزرگ است'), { status: 413 });
  if (!t) return {};
  try { return JSON.parse(t); } catch (e) { throw Object.assign(new Error('JSON نامعتبر'), { status: 400 }); }
}
function enDigits(s) {
  return String(s == null ? '' : s).replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }).replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
}
function intOf(v, d, lo, hi) { v = Math.round(Number(enDigits(v))); if (!Number.isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); }
function numOf(v, d, lo, hi) { v = Number(enDigits(v)); if (!Number.isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); }
function tehranDay(ms) { return new Date((ms || Date.now()) + 12600000).toISOString().slice(0, 10); }
function dayShift(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
function clientIp(request) { return request.headers.get('cf-connecting-ip') || 'local'; }
const memRate = new Map();
function rateOk(key, max, windowMs) {
  const now = Date.now();
  let r = memRate.get(key);
  if (!r || now - r.t > windowMs) { r = { t: now, n: 0 }; memRate.set(key, r); }
  r.n += 1;
  if (memRate.size > 5000) for (const [k, v] of memRate) if (now - v.t > windowMs) memRate.delete(k);
  return r.n <= max;
}
function httpsUrl(u, max) {
  u = String(u || '').trim();
  if (!u || u.length > (max || 300) || !/^https:\/\/[^\s<>"']+$/i.test(u)) return '';
  try {
    const x = new URL(u);
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local') || h.endsWith('.internal')) return '';
    return x.href;
  } catch (e) { return ''; }
}
function emojiCount(s) { const m = String(s).match(/\p{Extended_Pictographic}/gu); return m ? m.length : 0; }

/* ═══════ دیتابیس ═══════ */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS adv_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, company TEXT, pass TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'adv', status TEXT NOT NULL DEFAULT 'active', balance INTEGER NOT NULL DEFAULT 0, tg_id TEXT, created_at INTEGER NOT NULL, last_login INTEGER, sess_ver INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS adv_tx (id TEXT PRIMARY KEY, uid TEXT NOT NULL, amount INTEGER NOT NULL, balance INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, note TEXT, ref TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS adv_tx_uid ON adv_tx(uid, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS adv_tx_ref ON adv_tx(ref)`,
  `CREATE TABLE IF NOT EXISTS adv_media (id TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0, dur REAL NOT NULL DEFAULT 0, store TEXT NOT NULL, chunks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS adv_media_chunks (id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n))`,
  `CREATE TABLE IF NOT EXISTS adv_campaigns (id TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL, slots TEXT NOT NULL, creative TEXT NOT NULL, target TEXT NOT NULL, bid REAL NOT NULL DEFAULT 1, prices TEXT NOT NULL DEFAULT '{}', budget INTEGER NOT NULL DEFAULT 0, daily_cap INTEGER NOT NULL DEFAULT 0, spent REAL NOT NULL DEFAULT 0, freq_cap INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, reason TEXT, start_at INTEGER, end_at INTEGER, imps INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, submitted_at INTEGER, reviewed_at INTEGER, reviewed_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS adv_c_uid ON adv_campaigns(uid, created_at)`,
  `CREATE INDEX IF NOT EXISTS adv_c_status ON adv_campaigns(status)`,
  `CREATE TABLE IF NOT EXISTS adv_stats (day TEXT NOT NULL, cid TEXT NOT NULL, slot TEXT NOT NULL, imps INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, skips INTEGER NOT NULL DEFAULT 0, opps INTEGER NOT NULL DEFAULT 0, watch INTEGER NOT NULL DEFAULT 0, spend REAL NOT NULL DEFAULT 0, mob INTEGER NOT NULL DEFAULT 0, desk INTEGER NOT NULL DEFAULT 0, movie INTEGER NOT NULL DEFAULT 0, series INTEGER NOT NULL DEFAULT 0, hours TEXT NOT NULL DEFAULT '', PRIMARY KEY (day, cid, slot))`,
  `CREATE INDEX IF NOT EXISTS adv_stats_cid ON adv_stats(cid, day)`,
  `CREATE TABLE IF NOT EXISTS adv_invoices (id TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, extra INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS adv_inv_status ON adv_invoices(status, kind)`,
  `CREATE INDEX IF NOT EXISTS adv_inv_uid ON adv_invoices(uid, created_at)`,
  `CREATE TABLE IF NOT EXISTS adv_batches (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS adv_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)`,
];
const schemaReady = new WeakMap();
async function ensureSchema(env) {
  if (!env.ADS_DB) throw Object.assign(new Error('اتصال D1 با نام ADS_DB تنظیم نشده است'), { status: 503 });
  if (schemaReady.get(env.ADS_DB)) return;
  await env.ADS_DB.batch(SCHEMA.map(function (q) { return env.ADS_DB.prepare(q); }));
  schemaReady.set(env.ADS_DB, true);
}
function db(env) { return env.ADS_DB; }
async function one(env, sql, ...args) { return await db(env).prepare(sql).bind(...args).first(); }
async function all(env, sql, ...args) { const r = await db(env).prepare(sql).bind(...args).all(); return r.results || []; }
async function run(env, sql, ...args) { return await db(env).prepare(sql).bind(...args).run(); }
async function kvGet(env, k) {
  const r = await one(env, 'SELECT v, exp FROM adv_kv WHERE k = ?', k);
  if (!r || (r.exp && r.exp < Date.now())) return null;
  try { return JSON.parse(r.v); } catch (e) { return null; }
}
async function kvSet(env, k, v, ttlMs) {
  await run(env, 'INSERT INTO adv_kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp', k, JSON.stringify(v), ttlMs ? Date.now() + ttlMs : null);
}

/* ═══════ تنظیمات ═══════ */
let SET_CACHE = null;
async function getSettings(env, fresh) {
  if (!fresh && SET_CACHE && Date.now() - SET_CACHE.t < 15000 && SET_CACHE.db === env.ADS_DB) return SET_CACHE.s;
  let s = await kvGet(env, 'settings');
  let changed = false;
  if (!s) { s = {}; changed = true; }
  const out = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  for (const k of Object.keys(s)) {
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && s[k] && typeof s[k] === 'object') out[k] = Object.assign(out[k], s[k]);
    else out[k] = s[k];
  }
  for (const f of ['video', 'banner', 'link']) out.tariffs[f] = Object.assign({ cpm: 0, cpv: 0, cpc: 0 }, SETTINGS_DEFAULTS.tariffs[f], (s.tariffs || {})[f] || {});
  if (!out.secret || out.secret.length < 32) { out.secret = rid(32); changed = true; }
  if (changed) await kvSet(env, 'settings', out);
  SET_CACHE = { t: Date.now(), s: out, db: env.ADS_DB };
  return out;
}
async function saveSettings(env, s) { await kvSet(env, 'settings', s); SET_CACHE = null; INV_CACHE = null; MARKET_CACHE = null; }
function appSecret(env, set) { return String(env.ADS_SECRET || set.secret || ''); }
function netSecret(env, set) { return String(env.NET_SECRET || set.netSecret || ''); }
function botToken(env) { return String(env.ADS_BOT_TOKEN || '').trim(); }

/* ═══════ احراز هویت ═══════ */
async function hashPassword(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(function (h) { return parseInt(h, 16); }));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: PBKDF2_ITER }, key, 256);
  return hex(new Uint8Array(bits));
}
async function makeSession(env, set, user) {
  const p = b64u(JSON.stringify({ u: user.id, v: user.sess_ver || 1, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }));
  return p + '.' + (await hmacHexStr(appSecret(env, set), 'sess|' + p));
}
async function currentUser(request, env, set) {
  const h = request.headers.get('authorization') || '';
  const tok = h.indexOf('Bearer ') === 0 ? h.slice(7) : '';
  if (!tok || tok.length > 600) return null;
  const i = tok.lastIndexOf('.');
  if (i < 1) return null;
  const p = tok.slice(0, i);
  if (!safeEq(tok.slice(i + 1), await hmacHexStr(appSecret(env, set), 'sess|' + p))) return null;
  let d; try { d = JSON.parse(unb64u(p)); } catch (e) { return null; }
  if (!d || !d.u || d.exp < Date.now() / 1000) return null;
  const u = await one(env, 'SELECT * FROM adv_users WHERE id = ?', d.u);
  if (!u || u.status !== 'active' || Number(u.sess_ver) !== Number(d.v)) return null;
  return u;
}
function pubUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, phone: u.phone || '', company: u.company || '', role: u.role, balance: u.balance, tg: !!u.tg_id, createdAt: u.created_at } : null;
}
function isAdminEmail(env, email) {
  return String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(Boolean).indexOf(String(email).toLowerCase()) >= 0;
}
/* ── ورود و ثبت‌نام فقط با تلگرام (مثل سایت اصلی worker.js):
   سایت «ورود با تلگرام» ← لینک ربات با تیکت ← ارسال شماره موبایل (request_contact)
   ← ساخت/اتصال حساب ← تیکت آماده ← سایت خودکار وارد می‌شود. ایمیل و رمز عبور حذف شد. */
const AUTH_TTL_MS = 300000;
function normPhone(p) {
  p = String(p || '').replace(/[^\d+]/g, '');
  if (p.indexOf('00') === 0) p = '+' + p.slice(2);
  if (p.indexOf('+98') === 0) p = '0' + p.slice(3);
  if (p.indexOf('98') === 0 && p.length >= 12) p = '0' + p.slice(2);
  return p;
}
function tgDisplayName(from) {
  return String(((from && from.first_name) || '') + ' ' + ((from && from.last_name) || '')).replace(/\s+/g, ' ').trim().slice(0, 60);
}
function contactKeyboard() {
  return { keyboard: [[{ text: 'ارسال شماره موبایل', request_contact: true }]], resize_keyboard: true, one_time_keyboard: false, is_persistent: true };
}
function isOwnContact(msg, tgId) {
  if (!msg || !msg.contact || !msg.contact.phone_number) return false;
  if (msg.forward_date || msg.forward_from || msg.forward_origin || msg.forward_sender_name || msg.external_reply) return false;
  if (msg.contact.user_id == null || msg.contact.user_id === '') return false;
  return String(msg.contact.user_id) === String(tgId);
}
async function completeTgTicket(env, set, ticketId, user) {
  const t = await kvGet(env, 'tick:' + String(ticketId || ''));
  if (!t) return;
  await kvSet(env, 'tick:' + ticketId, { status: 'ready', at: t.at || Date.now(), token: await makeSession(env, set, user), user: pubUser(user) }, AUTH_TTL_MS);
}
async function tgAuthUser(env, set, from, phone) {
  const tgId = String(from.id);
  let u = await one(env, 'SELECT * FROM adv_users WHERE tg_id = ?', tgId);
  if (u) {
    if (u.status !== 'active') return { error: 'حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید.' };
    if (phone && !u.phone) { await run(env, 'UPDATE adv_users SET phone = ? WHERE id = ?', phone, u.id); u.phone = phone; }
    await run(env, 'UPDATE adv_users SET last_login = ? WHERE id = ?', Date.now(), u.id);
    return { user: u, isNew: false };
  }
  if (phone) {
    u = await one(env, 'SELECT * FROM adv_users WHERE phone = ? ORDER BY created_at LIMIT 1', phone);
    if (u) {
      if (u.status !== 'active') return { error: 'حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید.' };
      await run(env, 'UPDATE adv_users SET tg_id = ?, last_login = ? WHERE id = ?', tgId, Date.now(), u.id);
      u.tg_id = tgId;
      return { user: u, isNew: false };
    }
  }
  /* حساب قدیمیِ بدون هویت (مدیر اولِ ثبت‌نام‌شده) → همان حساب به تلگرام وصل می‌شود */
  const legacy = await all(env, "SELECT * FROM adv_users WHERE role = 'admin' AND (tg_id IS NULL OR tg_id = '') AND (phone IS NULL OR phone = '')");
  if (legacy.length === 1) {
    u = legacy[0];
    await run(env, 'UPDATE adv_users SET tg_id = ?, phone = ?, last_login = ? WHERE id = ?', tgId, phone || '', Date.now(), u.id);
    u.tg_id = tgId; u.phone = phone || '';
    return { user: u, isNew: false };
  }
  const count = await one(env, 'SELECT COUNT(*) AS n FROM adv_users');
  const adminEnv = String(env.ADMIN_EMAILS || '').trim();
  const role = (!adminEnv && !(count && count.n)) ? 'admin' : 'adv';
  const salt = rid(16);
  u = { id: 'u_' + rid(6), email: 'tg' + tgId + '@telegram', name: tgDisplayName(from) || ('کاربر ' + tgId), phone: phone || '', company: '', pass: await hashPassword(rid(16), salt), salt: salt, role: role, status: 'active', balance: 0, created_at: Date.now(), last_login: Date.now(), sess_ver: 1, tg_id: tgId };
  await run(env, 'INSERT INTO adv_users (id, email, name, phone, company, pass, salt, role, status, balance, created_at, last_login, sess_ver, tg_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    u.id, u.email, u.name, u.phone, u.company, u.pass, u.salt, u.role, u.status, 0, u.created_at, u.last_login, 1, u.tg_id);
  return { user: u, isNew: true };
}
async function apiAuthStart(request, env, set) {
  if (!botToken(env) || !set.botUsername) return err('ربات تلگرام پلتفرم هنوز تنظیم نشده است', 400);
  if (!rateOk('astart:' + clientIp(request), 20, 600000)) return err('تعداد درخواست زیاد است؛ کمی صبر کنید', 429);
  const ticket = rid(8);
  await kvSet(env, 'tick:' + ticket, { status: 'pending', at: Date.now() }, AUTH_TTL_MS);
  return json({ ticket: ticket, botLink: 'https://t.me/' + set.botUsername + '?start=tglogin_' + ticket, expireSec: Math.round(AUTH_TTL_MS / 1000) });
}
async function apiAuthTicket(env, set, id) {
  const rec = await kvGet(env, 'tick:' + String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20));
  if (!rec) return err('لینک ورود منقضی شده است؛ دوباره تلاش کنید.', 404);
  if (rec.status === 'ready') return json({ status: 'ready', token: rec.token, user: rec.user });
  return json({ status: 'pending' });
}
async function apiProfile(request, env, set, user) {
  const b = await readJson(request, 8192);
  const name = b.name !== undefined ? String(b.name).replace(/\s+/g, ' ').trim().slice(0, 60) : user.name;
  if (name.length < 2) return err('نام کوتاه است');
  const phone = b.phone !== undefined ? normPhone(b.phone).slice(0, 15) : user.phone;
  const company = b.company !== undefined ? String(b.company).trim().slice(0, 80) : user.company;
  await run(env, 'UPDATE adv_users SET name = ?, phone = ?, company = ? WHERE id = ?', name, phone, company, user.id);
  return json({ ok: true, user: pubUser(Object.assign({}, user, { name: name, phone: phone, company: company })) });
}

/* ═══════ کیف پول (اتمی) ═══════ */
function txStmt(env, uid, amount, type, note, ref) {
  return db(env).prepare('INSERT INTO adv_tx (id, uid, amount, balance, type, note, ref, created_at) VALUES (?, ?, ?, (SELECT balance FROM adv_users WHERE id = ?), ?, ?, ?, ?)')
    .bind('t_' + rid(6), uid, amount, uid, type, String(note || '').slice(0, 200), ref || null, Date.now());
}
async function credit(env, uid, amount, type, note, ref) {
  amount = Math.floor(amount);
  if (!(amount > 0)) return { ok: false };
  if (ref) { const dup = await one(env, 'SELECT id FROM adv_tx WHERE ref = ?', ref); if (dup) return { ok: true, dup: true }; }
  try {
    await db(env).batch([db(env).prepare('UPDATE adv_users SET balance = balance + ? WHERE id = ?').bind(amount, uid), txStmt(env, uid, amount, type, note, ref)]);
  } catch (e) {
    if (ref && /UNIQUE/i.test(String(e && e.message))) return { ok: true, dup: true };
    throw e;
  }
  return { ok: true };
}
async function debit(env, uid, amount, type, note) {
  amount = Math.ceil(amount);
  if (!(amount > 0)) return { ok: true };
  const r = await run(env, 'UPDATE adv_users SET balance = balance - ? WHERE id = ? AND balance >= ?', amount, uid, amount);
  if (!r.meta || !r.meta.changes) return { ok: false, error: 'موجودی کیف پول کافی نیست' };
  await txStmt(env, uid, -amount, type, note, null).run();
  return { ok: true };
}

/* ═══════ فایل‌های تبلیغ (ویدئو/تصویر) ═══════ */
function sniff(bytes) {
  const b = bytes;
  const s = function (i, n) { let o = ''; for (let k = i; k < i + n && k < b.length; k++) o += String.fromCharCode(b[k]); return o; };
  if (b.length > 12 && s(4, 4) === 'ftyp') return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (s(0, 4) === 'GIF8') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  return null;
}
const CHUNK = 1500000;
async function apiUpload(request, env, set, user) {
  if (!rateOk('up:' + user.id, 30, 3600000)) return err('تعداد آپلود زیاد است؛ کمی بعد تلاش کنید.', 429);
  const url = new URL(request.url);
  const want = url.searchParams.get('kind') === 'image' ? 'image' : 'video';
  const max = want === 'video' ? intOf(set.maxVideoMB, 8, 1, 24) * 1048576 : intOf(set.maxImageKB, 600, 50, 5000) * 1024;
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) return err('حجم فایل بیش از حد مجاز است (' + (want === 'video' ? intOf(set.maxVideoMB, 8, 1, 24) + ' مگابایت' : intOf(set.maxImageKB, 600, 50, 5000) + ' کیلوبایت') + ')', 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return err('فایل خالی است');
  if (buf.length > max) return err('حجم فایل بیش از حد مجاز است', 413);
  const t = sniff(buf);
  if (!t || t.kind !== want) return err(want === 'video' ? 'فقط ویدئوی MP4 یا WebM قبول است' : 'فقط تصویر JPG، PNG، WebP یا GIF قبول است');
  const w = intOf(url.searchParams.get('w'), 0, 0, 8000), h = intOf(url.searchParams.get('h'), 0, 0, 8000);
  const dur = numOf(url.searchParams.get('dur'), 0, 0, 3600);
  if (want === 'video' && dur && dur > intOf(set.maxVideoSec, 30, 5, 120) + 0.5) return err('مدت ویدئو بیش از ' + intOf(set.maxVideoSec, 30, 5, 120) + ' ثانیه است');
  const id = rid(12);
  const store = env.ADS_KV ? 'kv' : 'd1';
  if (store === 'kv') await env.ADS_KV.put('m:' + id, buf, { metadata: { mime: t.mime } });
  else {
    const stmts = [];
    for (let i = 0, n = 0; i < buf.length; i += CHUNK, n++) stmts.push(db(env).prepare('INSERT INTO adv_media_chunks (id, n, data) VALUES (?, ?, ?)').bind(id, n, buf.slice(i, i + CHUNK).buffer));
    await db(env).batch(stmts);
  }
  const chunks = store === 'd1' ? Math.ceil(buf.length / CHUNK) : 0;
  await run(env, 'INSERT INTO adv_media (id, uid, kind, mime, size, w, h, dur, store, chunks, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, user.id, t.kind, t.mime, buf.length, w, h, dur, store, chunks, Date.now());
  return json({ ok: true, media: { id: id, url: '/m/' + id + '.' + t.ext, kind: t.kind, mime: t.mime, size: buf.length, w: w, h: h, dur: dur } });
}
async function serveMedia(request, env, ctx, id) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const ckey = new URL('/m/' + id, request.url).href;
  let full = null;
  if (cache) { try { full = await cache.match(ckey); } catch (e) { full = null; } }
  if (!full) {
    const m = await one(env, 'SELECT * FROM adv_media WHERE id = ?', id);
    if (!m) return new Response('not found', { status: 404 });
    let body = null;
    if (m.store === 'kv' && env.ADS_KV) body = await env.ADS_KV.get('m:' + id, 'arrayBuffer');
    else {
      const rows = await all(env, 'SELECT data FROM adv_media_chunks WHERE id = ? ORDER BY n', id);
      const parts = rows.map(function (r) { return new Uint8Array(r.data); }); // D1: ArrayBuffer یا آرایهٔ عدد
      const total = parts.reduce(function (a, p) { return a + p.length; }, 0);
      const out = new Uint8Array(total); let o = 0;
      parts.forEach(function (p) { out.set(p, o); o += p.length; });
      body = out.buffer;
    }
    if (!body) return new Response('not found', { status: 404 });
    full = new Response(body, { headers: { 'content-type': m.mime, 'content-length': String(body.byteLength), 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
    if (cache) { const c = full.clone(); const job = cache.put(ckey, c).catch(function () { }); if (ctx && ctx.waitUntil) ctx.waitUntil(job); }
  }
  const range = request.headers.get('range');
  const mm = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!mm) return new Response(request.method === 'HEAD' ? null : full.body, { status: 200, headers: full.headers });
  const buf = await full.arrayBuffer();
  const size = buf.byteLength;
  let start = mm[1] === '' ? Math.max(0, size - Number(mm[2])) : Number(mm[1]);
  let end = mm[1] !== '' && mm[2] !== '' ? Math.min(size - 1, Number(mm[2])) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
  const h = new Headers(full.headers);
  h.set('content-range', 'bytes ' + start + '-' + end + '/' + size);
  h.set('content-length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : buf.slice(start, end + 1), { status: 206, headers: h });
}

/* ═══════ کمپین‌ها ═══════ */
function campaignPublic(c, origin) {
  const cr = safeParse(c.creative, {});
  return {
    id: c.id, name: c.name, format: c.format, slots: safeParse(c.slots, []), creative: cr, creativeUrls: creativeUrls(cr, c.format, origin), target: safeParse(c.target, {}),
    bid: c.bid, prices: safeParse(c.prices, {}), budget: c.budget, dailyCap: c.daily_cap, spent: Math.round(c.spent), freqCap: c.freq_cap,
    status: c.status, reason: c.reason || '', startAt: c.start_at || 0, endAt: c.end_at || 0, imps: c.imps, views: c.views, clicks: c.clicks,
    approved: !!c.approved, createdAt: c.created_at, updatedAt: c.updated_at, submittedAt: c.submitted_at || 0, reviewedAt: c.reviewed_at || 0,
  };
}
function safeParse(s, d) { try { const v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
function mediaUrl(ref, origin) {
  if (!ref) return '';
  if (/^https:\/\//i.test(ref)) return ref;
  if (/^[a-f0-9]{24}\.[a-z0-9]{2,4}$/.test(ref)) return origin + '/m/' + ref;
  return '';
}
function creativeUrls(cr, format, origin) {
  if (format === 'video') return { video: mediaUrl(cr.video, origin), videoP: mediaUrl(cr.videoP, origin), poster: mediaUrl(cr.poster, origin) };
  if (format === 'banner') return { wide: mediaUrl(cr.wide, origin), rect: mediaUrl(cr.rect, origin), tall: mediaUrl(cr.tall, origin) };
  return {};
}
async function mediaRefOk(env, set, ref, uid, kind) {
  if (!ref) return { ok: true, empty: true };
  if (/^https:\/\//i.test(ref)) return set.allowExternalMedia !== false && httpsUrl(ref, 600) ? { ok: true, external: true } : { ok: false, error: 'لینک فایل باید https معتبر باشد' };
  const m = /^([a-f0-9]{24})\.([a-z0-9]{2,4})$/.exec(String(ref));
  if (!m) return { ok: false, error: 'فایل نامعتبر است' };
  const row = await one(env, 'SELECT * FROM adv_media WHERE id = ?', m[1]);
  if (!row || (uid && row.uid !== uid)) return { ok: false, error: 'فایل پیدا نشد؛ دوباره آپلود کنید' };
  if (row.kind !== kind) return { ok: false, error: kind === 'video' ? 'فایل باید ویدئو باشد' : 'فایل باید تصویر باشد' };
  return { ok: true, row: row };
}
function ruleCheckText(set, text) {
  const t = String(text || '').toLowerCase();
  const words = String(set.bannedWords || '').split(/[,،\n]+/).map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean);
  for (const w of words) if (t.indexOf(w) >= 0) return 'متن شامل کلمهٔ غیرمجاز «' + w + '» است';
  return '';
}
function linkRuleCheck(set, url) {
  let x; try { x = new URL(url); } catch (e) { return 'لینک نامعتبر است'; }
  const host = x.hostname.toLowerCase().replace(/^www\./, '');
  const short = String(set.shorteners || '').split(/[,،\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (short.indexOf(host) >= 0) return 'کوتاه‌کنندهٔ لینک مجاز نیست؛ لینک اصلی مقصد را بدهید';
  if (/\.(apk|exe|msi|bat|cmd|scr|zip|rar|7z|dmg|ipa|jar|js|vbs|ps1)(?:$|[?#])/i.test(x.pathname)) return 'لینک مستقیم فایل اجرایی/فشرده مجاز نیست';
  return '';
}
async function validateCampaign(env, set, b, user, prev) {
  const format = ['video', 'banner', 'link'].indexOf(b.format) >= 0 ? b.format : '';
  if (!format) return { error: 'نوع تبلیغ را انتخاب کنید' };
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 3) return { error: 'نام کمپین (حداقل ۳ نویسه) را وارد کنید' };
  const slots = (Array.isArray(b.slots) ? b.slots : []).filter(function (s) { return FORMAT_SLOTS[format].indexOf(s) >= 0; });
  if (!slots.length) return { error: 'حداقل یک جایگاه نمایش انتخاب کنید' };
  const c = b.creative || {};
  const cr = { title: String(c.title || '').trim().slice(0, 60), cta: String(c.cta || '').trim().slice(0, 24) };
  const landing = String(c.landing || '').trim();
  if (landing) {
    cr.landing = httpsUrl(landing, 300);
    if (!cr.landing) return { error: 'لینک مقصد باید https معتبر (حداکثر ۳۰۰ نویسه) باشد' };
    const lr = linkRuleCheck(set, cr.landing); if (lr) return { error: lr };
  }
  const textErr = ruleCheckText(set, [name, cr.title, cr.cta].join(' ')); if (textErr) return { error: textErr };
  if (format === 'video') {
    const v = await mediaRefOk(env, set, c.video, user.id, 'video');
    if (!v.ok) return { error: v.error };
    const vp = await mediaRefOk(env, set, c.videoP, user.id, 'video');
    if (!vp.ok) return { error: 'ویدئوی عمودی: ' + vp.error };
    if (v.empty && vp.empty) return { error: 'فایل ویدئوی تبلیغ را آپلود کنید' };
    const ps = await mediaRefOk(env, set, c.poster, user.id, 'image');
    if (!ps.ok) return { error: 'تصویر پوستر: ' + ps.error };
    const durs = [v.row && v.row.dur, vp.row && vp.row.dur, numOf(c.dur, 0, 0, 600)].filter(function (x) { return x > 0; });
    const dur = durs.length ? Math.max.apply(null, durs) : 15;
    if (dur > intOf(set.maxVideoSec, 30, 5, 120) + 0.5) return { error: 'مدت ویدئو حداکثر ' + intOf(set.maxVideoSec, 30, 5, 120) + ' ثانیه است' };
    if (dur < intOf(set.minVideoSec, 5, 1, 30) - 0.5) return { error: 'مدت ویدئو حداقل ' + intOf(set.minVideoSec, 5, 1, 30) + ' ثانیه است' };
    Object.assign(cr, { video: v.empty ? '' : c.video, videoP: vp.empty ? '' : c.videoP, poster: ps.empty ? '' : c.poster, dur: Math.round(dur * 10) / 10,
      w: (v.row && v.row.w) || (vp.row && vp.row.w) || 0, h: (v.row && v.row.h) || (vp.row && vp.row.h) || 0 });
    if (slots.indexOf('dl') < 0 && !cr.video) return { error: 'برای پلیر، ویدئوی افقی لازم است' };
  } else if (format === 'banner') {
    for (const k of ['wide', 'rect', 'tall']) {
      const r = await mediaRefOk(env, set, c[k], user.id, 'image');
      if (!r.ok) return { error: 'تصویر ' + ({ wide: 'پهن', rect: 'مستطیل', tall: 'عمودی' })[k] + ': ' + r.error };
      cr[k] = r.empty ? '' : c[k];
    }
    if (!cr.wide && !cr.rect && !cr.tall) return { error: 'حداقل یک تصویر بنر آپلود کنید' };
    if (!cr.landing) return { error: 'برای بنر، لینک مقصد لازم است' };
    const bsec = intOf(c.sec, 0, 0, 30);
    if (bsec > 0) cr.sec = Math.max(3, bsec);
    if (slots.indexOf('ov') >= 0 && !cr.wide) return { error: 'برای «بنر روی پلیر» تصویر پهن (۷۲۸×۹۰) لازم است' };
    if (slots.indexOf('pause') >= 0 && !cr.rect && !cr.wide) return { error: 'برای «بنر توقف» تصویر مستطیل (۳۰۰×۲۵۰) لازم است' };
    if (slots.indexOf('dl') >= 0 && !cr.tall && !cr.rect) return { error: 'برای «قبل از دانلود» تصویر عمودی (۱۰۸۰×۱۹۲۰) لازم است' };
  } else {
    const text = String((c.link || {}).text || c.text || '').replace(/[\r\n\t]+/g, ' ').trim();
    const url = httpsUrl((c.link || {}).url || c.url || '', 300);
    if (text.length < 3 || text.length > 32) return { error: 'متن دکمه باید ۳ تا ۳۲ نویسه باشد' };
    if (emojiCount(text) > 2) return { error: 'حداکثر ۲ ایموجی در متن دکمه مجاز است' };
    if (/دانلود|پخش|ادامه|دریافت\s*فایل|download|play|continue/i.test(text)) return { error: 'متن دکمه نباید شبیه دکمه‌های خود ربات (دانلود/پخش/ادامه) باشد' };
    if (!url) return { error: 'لینک دکمه باید https یا لینک تلگرام (https://t.me/…) باشد' };
    const lr = linkRuleCheck(set, url); if (lr) return { error: lr };
    const te = ruleCheckText(set, text); if (te) return { error: te };
    cr.link = { text: text, url: url };
    cr.landing = url;
  }
  const t = b.target || {};
  const target = {
    types: (Array.isArray(t.types) ? t.types : []).filter(function (x) { return x === 'movie' || x === 'series'; }),
    genres: (Array.isArray(t.genres) ? t.genres : []).map(function (g) { return String(g).trim().slice(0, 40); }).filter(Boolean).slice(0, 20),
    dev: (Array.isArray(t.dev) ? t.dev : []).filter(function (x) { return x === 'm' || x === 'd'; }),
  };
  const maxBid = numOf(set.maxBid, 5, 1, 20);
  const bid = Math.round(numOf(b.bid, 1, 1, maxBid) * 10) / 10;
  const budget = intOf(b.budget, 0, 0, 1e12);
  if (budget < intOf(set.minBudget, 100000, 0, 1e12)) return { error: 'حداقل بودجهٔ کمپین ' + Number(set.minBudget).toLocaleString('fa-IR') + ' تومان است' };
  const daily = intOf(b.dailyCap, 0, 0, 1e12);
  if (daily && daily < intOf(set.minDaily, 20000, 0, 1e12)) return { error: 'سقف روزانه (اگر تعیین می‌کنید) حداقل ' + Number(set.minDaily).toLocaleString('fa-IR') + ' تومان است' };
  const freq = intOf(b.freqCap, 3, 0, 20);
  const startAt = b.startAt ? intOf(b.startAt, 0, 0, 9e15) : 0;
  const endAt = b.endAt ? intOf(b.endAt, 0, 0, 9e15) : 0;
  if (endAt && endAt <= Math.max(Date.now(), startAt)) return { error: 'زمان پایان باید بعد از شروع و در آینده باشد' };
  if (prev && budget < Math.ceil(prev.spent)) return { error: 'بودجه نمی‌تواند کمتر از مبلغ مصرف‌شده باشد' };
  return { ok: true, c: { format: format, name: name, slots: slots, creative: cr, target: target, bid: bid, budget: budget, daily_cap: daily, freq_cap: freq, start_at: startAt || null, end_at: endAt || null } };
}
function creativeKey(c) { return JSON.stringify([c.format, c.slots, c.creative, c.target]); }
async function apiCampaignSave(request, env, set, user, id) {
  const b = await readJson(request, 32768);
  const prev = id ? await one(env, 'SELECT * FROM adv_campaigns WHERE id = ? AND uid = ?', id, user.id) : null;
  if (id && !prev) return err('کمپین پیدا نشد', 404);
  if (prev && ['ended', 'completed', 'rejected'].indexOf(prev.status) >= 0 && prev.status !== 'rejected') return err('کمپین پایان‌یافته قابل ویرایش نیست؛ کمپین تازه بسازید');
  const v = await validateCampaign(env, set, b, user, prev);
  if (v.error) return err(v.error);
  const c = v.c, now = Date.now();
  if (!prev) {
    const cid = 'c_' + rid(5);
    await run(env, 'INSERT INTO adv_campaigns (id, uid, name, format, slots, creative, target, bid, prices, budget, daily_cap, spent, freq_cap, status, start_at, end_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)',
      cid, user.id, c.name, c.format, JSON.stringify(c.slots), JSON.stringify(c.creative), JSON.stringify(c.target), c.bid, '{}', c.budget, c.daily_cap, c.freq_cap, 'draft', c.start_at, c.end_at, now, now);
    if (b.submit) return submitCampaign(env, set, user, cid);
    return json({ ok: true, id: cid, campaign: campaignPublic(await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', cid), originOf(set)) });
  }
  const changedCreative = creativeKey({ format: prev.format, slots: safeParse(prev.slots, []), creative: safeParse(prev.creative, {}), target: safeParse(prev.target, {}) }) !== creativeKey(c);
  const held = ['pending', 'active', 'paused'].indexOf(prev.status) >= 0;
  let status = prev.status;
  if (held && changedCreative) status = 'pending'; // هر تغییر محتوایی دوباره بررسی می‌شود
  if (prev.status === 'rejected') status = 'draft';
  if (held && c.budget !== prev.budget) {
    const diff = c.budget - prev.budget;
    if (diff > 0) { const d = await debit(env, user.id, diff, 'campaign_hold', 'افزایش بودجهٔ «' + c.name + '»'); if (!d.ok) return err(d.error, 402); }
    else await credit(env, user.id, -diff, 'campaign_refund', 'کاهش بودجهٔ «' + c.name + '»');
  }
  await run(env, 'UPDATE adv_campaigns SET name = ?, format = ?, slots = ?, creative = ?, target = ?, bid = ?, budget = ?, daily_cap = ?, freq_cap = ?, start_at = ?, end_at = ?, status = ?, updated_at = ?, submitted_at = CASE WHEN ? = \'pending\' AND status != \'pending\' THEN ? ELSE submitted_at END, reason = CASE WHEN ? = \'pending\' THEN NULL ELSE reason END WHERE id = ?',
    c.name, c.format, JSON.stringify(c.slots), JSON.stringify(c.creative), JSON.stringify(c.target), c.bid, c.budget, c.daily_cap, c.freq_cap, c.start_at, c.end_at, status, now, status, now, status, prev.id);
  if (status === 'pending' && prev.status !== 'pending') notifyAdminsReview(env, set, prev.id, c.name, user).catch(function () { });
  INV_CACHE = null;
  if (b.submit && (status === 'draft')) return submitCampaign(env, set, user, prev.id);
  return json({ ok: true, id: prev.id, recheck: status === 'pending' && changedCreative && held, campaign: campaignPublic(await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', prev.id), originOf(set)) });
}
function lockedPrices(set, format) {
  const t = set.tariffs[format] || {};
  return { cpm: numOf(t.cpm, 0, 0, 1e9), cpv: numOf(t.cpv, 0, 0, 1e9), cpc: numOf(t.cpc, 0, 0, 1e9) };
}
async function submitCampaign(env, set, user, id) {
  const c = await one(env, 'SELECT * FROM adv_campaigns WHERE id = ? AND uid = ?', id, user.id);
  if (!c) return err('کمپین پیدا نشد', 404);
  if (c.status !== 'draft') return err('این کمپین قبلاً ارسال شده است');
  // فقط باقی‌ماندهٔ بودجه کنار گذاشته می‌شود (کمپین ردشده‌ای که قبلاً بخشی از بودجه را مصرف کرده دوبار پول نمی‌دهد)
  const need = Math.max(0, Math.ceil(Number(c.budget) - Number(c.spent)));
  const d = await debit(env, user.id, need, 'campaign_hold', 'بودجهٔ کمپین «' + c.name + '»');
  if (!d.ok) return err('موجودی کیف پول برای بودجهٔ این کمپین کافی نیست؛ ابتدا کیف پول را شارژ کنید.', 402, { needWallet: true, need: need });
  const now = Date.now();
  await run(env, "UPDATE adv_campaigns SET status = 'pending', prices = ?, submitted_at = ?, updated_at = ?, reason = NULL WHERE id = ?", JSON.stringify(lockedPrices(set, c.format)), now, now, id);
  notifyAdminsReview(env, set, id, c.name, user).catch(function () { });
  return json({ ok: true, id: id, submitted: true, campaign: campaignPublic(await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', id), originOf(set)) });
}
async function refundRemaining(env, c, note) {
  const left = Math.floor(Number(c.budget) - Number(c.spent));
  if (left > 0) await credit(env, c.uid, left, 'campaign_refund', note + ' «' + c.name + '»', 'refund:' + c.id + ':' + c.updated_at);
  return left;
}
async function apiCampaignAction(request, env, set, user, id, action) {
  const c = await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', id);
  const admin = user.role === 'admin';
  if (!c || (c.uid !== user.id && !admin)) return err('کمپین پیدا نشد', 404);
  const now = Date.now();
  if (action === 'submit') return submitCampaign(env, set, user, id);
  if (action === 'pause') {
    if (c.status !== 'active') return err('فقط کمپین فعال قابل توقف موقت است');
    await run(env, "UPDATE adv_campaigns SET status = 'paused', updated_at = ? WHERE id = ?", now, id);
  } else if (action === 'resume') {
    if (c.status !== 'paused') return err('کمپین متوقف نیست');
    await run(env, "UPDATE adv_campaigns SET status = ?, updated_at = ? WHERE id = ?", c.approved ? 'active' : 'pending', now, id);
  } else if (action === 'stop') {
    if (['active', 'paused', 'pending'].indexOf(c.status) < 0) return err('این کمپین در حال اجرا نیست');
    await run(env, "UPDATE adv_campaigns SET status = 'ended', updated_at = ? WHERE id = ?", now, id);
    const left = await refundRemaining(env, Object.assign({}, c, { updated_at: now }), 'بازگشت باقی‌ماندهٔ بودجه');
    INV_CACHE = null;
    return json({ ok: true, refunded: left });
  } else if (action === 'delete') {
    if (c.status !== 'draft' && c.status !== 'rejected') return err('فقط پیش‌نویس یا کمپین ردشده حذف می‌شود');
    await run(env, 'DELETE FROM adv_campaigns WHERE id = ?', id);
  } else return err('عملیات نامعتبر');
  INV_CACHE = null;
  return json({ ok: true });
}
async function apiCampaignList(env, set, user, scope) {
  const rows = scope === 'all'
    ? await all(env, 'SELECT * FROM adv_campaigns ORDER BY updated_at DESC LIMIT 300')
    : await all(env, 'SELECT * FROM adv_campaigns WHERE uid = ? ORDER BY created_at DESC LIMIT 200', user.id);
  return rows.map(function (c) { return campaignPublic(c, originOf(set)); });
}
async function apiCampaignStats(env, set, user, id, days) {
  const c = await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', id);
  if (!c || (c.uid !== user.id && user.role !== 'admin')) return err('کمپین پیدا نشد', 404);
  const since = dayShift(tehranDay(), -(intOf(days, 30, 1, 365) - 1));
  const rows = await all(env, 'SELECT * FROM adv_stats WHERE cid = ? AND day >= ? ORDER BY day', id, since);
  const byDay = {}, bySlot = {}, hours = new Array(24).fill(0);
  const tot = { imps: 0, views: 0, clicks: 0, skips: 0, watch: 0, spend: 0, mob: 0, desk: 0, movie: 0, series: 0 };
  const today = tehranDay();
  rows.forEach(function (r) {
    const d = byDay[r.day] || (byDay[r.day] = { day: r.day, imps: 0, views: 0, clicks: 0, skips: 0, spend: 0 });
    const s = bySlot[r.slot] || (bySlot[r.slot] = { slot: r.slot, imps: 0, views: 0, clicks: 0, skips: 0, spend: 0 });
    ['imps', 'views', 'clicks', 'skips', 'spend'].forEach(function (k) { d[k] += r[k]; s[k] += r[k]; });
    Object.keys(tot).forEach(function (k) { tot[k] += r[k] || 0; });
    if (r.day === today && r.hours) { const hh = safeParse(r.hours, []); for (let i = 0; i < 24; i++) hours[i] += Number(hh[i]) || 0; }
  });
  const list = [];
  for (let i = intOf(days, 30, 1, 365) - 1; i >= 0; i--) { const day = dayShift(today, -i); list.push(byDay[day] || { day: day, imps: 0, views: 0, clicks: 0, skips: 0, spend: 0 }); }
  return json({ campaign: campaignPublic(c, originOf(set)), days: list, slots: Object.values(bySlot), total: tot, hours: hours });
}

/* ═══════ بررسی مدیر ═══════ */
async function apiReview(request, env, set, admin, id) {
  const b = await readJson(request, 8192);
  const c = await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', id);
  if (!c) return err('کمپین پیدا نشد', 404);
  if (c.status !== 'pending') return err('این کمپین در صف بررسی نیست');
  const now = Date.now();
  if (b.approve) {
    await run(env, "UPDATE adv_campaigns SET status = 'active', approved = 1, reason = NULL, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?", now, admin.email, now, id);
    INV_CACHE = null;
    notifyUser(env, c.uid, '✅ کمپین «' + c.name + '» تأیید شد و نمایش آن شروع شد.').catch(function () { });
    return json({ ok: true, status: 'active' });
  }
  const reason = String(b.reason || '').trim().slice(0, 400);
  if (reason.length < 3) return err('دلیل رد را بنویسید تا تبلیغ‌دهنده بتواند اصلاح کند');
  await run(env, "UPDATE adv_campaigns SET status = 'rejected', reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?", reason, now, admin.email, now, id);
  const left = await refundRemaining(env, Object.assign({}, c, { updated_at: now }), 'بازگشت بودجهٔ کمپین ردشده');
  notifyUser(env, c.uid, '❌ کمپین «' + c.name + '» تأیید نشد.\nدلیل: ' + reason + (left > 0 ? '\n' + left.toLocaleString('fa-IR') + ' تومان به کیف پول برگشت.' : '')).catch(function () { });
  return json({ ok: true, status: 'rejected', refunded: left });
}

/* ═══════ اتصال سایت اصلی (HMAC) ═══════ */
const NONCES = new Map();
async function verifyNet(request, env, set, bodyText) {
  const secret = netSecret(env, set);
  if (secret.length < 16) return 'کلید اتصال سایت (NET_SECRET) تنظیم نشده است';
  const ts = Number(request.headers.get('x-net-ts') || 0);
  const nonce = String(request.headers.get('x-net-nonce') || '');
  const sign = String(request.headers.get('x-net-sign') || '');
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return 'زمان درخواست نامعتبر است (ساعت سرور)';
  if (!/^[a-f0-9]{8,64}$/.test(nonce) || NONCES.has(nonce)) return 'درخواست تکراری';
  const url = new URL(request.url);
  const body = await sha256Hex(bodyText || '');
  const expect = await hmacHexStr(secret, request.method + '\n' + url.pathname + url.search + '\n' + body + '\n' + ts + '\n' + nonce);
  if (!safeEq(expect, sign)) return 'امضای اتصال نامعتبر است؛ کلید دو طرف را بررسی کنید';
  NONCES.set(nonce, Date.now());
  if (NONCES.size > 20000) { const lim = Date.now() - 600000; for (const [k, v] of NONCES) if (v < lim) NONCES.delete(k); }
  return '';
}
function originOf(set) { return String(set._origin || set.publicUrl || '').replace(/\/+$/, ''); }
let INV_CACHE = null;
async function buildInventory(env, set) {
  if (INV_CACHE && Date.now() - INV_CACHE.t < 30000) return INV_CACHE.data;
  const now = Date.now(), today = tehranDay();
  const rows = await all(env, "SELECT * FROM adv_campaigns WHERE status = 'active'");
  const ids = rows.map(function (r) { return r.id; });
  const spentToday = {};
  if (ids.length) {
    const ph = ids.map(function () { return '?'; }).join(',');
    (await all(env, 'SELECT cid, SUM(spend) AS s FROM adv_stats WHERE day = ? AND cid IN (' + ph + ') GROUP BY cid', today, ...ids)).forEach(function (r) { spentToday[r.cid] = r.s || 0; });
  }
  const origin = originOf(set);
  const campaigns = [];
  for (const c of rows) {
    if (c.start_at && c.start_at > now) continue;
    if (c.end_at && c.end_at <= now) { endCampaign(env, c, 'پایان زمان کمپین').catch(function () { }); continue; }
    if (Number(c.spent) >= Number(c.budget) - 1) continue;
    if (c.daily_cap && (spentToday[c.id] || 0) >= c.daily_cap) continue;
    const cr = safeParse(c.creative, {});
    const u = creativeUrls(cr, c.format, origin);
    const item = { id: c.id, f: c.format, slots: safeParse(c.slots, []), w: Number(c.bid) || 1, cap: c.freq_cap || 0, tg: safeParse(c.target, {}), cr: { title: cr.title || '', cta: cr.cta || '', landing: cr.landing || '' } };
    if (c.format === 'video') item.cr.video = { src: u.video, srcP: u.videoP, poster: u.poster, dur: cr.dur || 15, w: cr.w || 0, h: cr.h || 0 };
    else if (c.format === 'banner') item.cr.banner = { wide: u.wide, rect: u.rect, tall: u.tall, sec: cr.sec || intOf(set.bannerSec, 8, 3, 30) };
    else item.cr.link = cr.link || {};
    campaigns.push(item);
  }
  const data = { v: 1, rev: rid(4), ttl: intOf(set.invTtl, 90, 30, 600), cfg: { viewSec: intOf(set.viewSec, 10, 1, 60), skipAfter: intOf(set.skipAfter, 5, 0, 30), maxSec: intOf(set.maxVideoSec, 30, 5, 120), linkViaSite: set.linkViaSite !== false }, campaigns: campaigns };
  INV_CACHE = { t: Date.now(), data: data };
  return data;
}
async function endCampaign(env, c, note) {
  const now = Date.now();
  const r = await run(env, "UPDATE adv_campaigns SET status = 'ended', updated_at = ? WHERE id = ? AND status IN ('active','paused')", now, c.id);
  if (r.meta && r.meta.changes) { await refundRemaining(env, Object.assign({}, c, { updated_at: now }), note); INV_CACHE = null; }
}
const SLOTS = Object.keys(SLOT_INFO);
/* رویدادهای دسته‌ای سایت: هر دسته یک‌بار (شناسهٔ یکتا) و در یک تراکنش D1 اعمال می‌شود */
async function netEvents(env, set, body) {
  const id = String(body.id || '');
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [];
  if (!/^[a-f0-9]{10,40}$/.test(id) || !rows.length) return err('دستهٔ رویداد نامعتبر است');
  const ins = await run(env, 'INSERT OR IGNORE INTO adv_batches (id, at) VALUES (?, ?)', id, Date.now());
  if (!ins.meta || !ins.meta.changes) return json({ ok: true, dup: true });
  const today = tehranDay();
  const okDays = [dayShift(today, -1), today, dayShift(today, 1)];
  const groups = new Map();
  for (const r of rows) {
    if (!r || SLOTS.indexOf(r.s) < 0 || okDays.indexOf(r.day) < 0) continue;
    const cid = r.c === '*' ? '*' : (/^c_[a-z0-9]{4,32}$/.test(String(r.c)) ? r.c : '');
    if (!cid) continue;
    const h = intOf(r.h, 0, 0, 23);
    const key = r.day + '|' + cid + '|' + r.s + '|' + h;
    const g = groups.get(key) || { day: r.day, cid: cid, slot: r.s, h: h, imps: 0, views: 0, clicks: 0, skips: 0, opps: 0, watch: 0, mob: 0, desk: 0, movie: 0, series: 0 };
    const n = function (v) { return intOf(v, 0, 0, 1e7); };
    const imp = n(r.imp), view = n(r.view), click = n(r.click), skip = n(r.skip), opp = n(r.opp);
    g.imps += imp; g.views += view; g.clicks += click; g.skips += skip; g.opps += opp; g.watch += n(r.watch);
    const touched = imp + opp;
    if (r.d === 'd') g.desk += touched; else g.mob += touched;
    if (r.t === 'series') g.series += touched; else if (r.t === 'movie') g.movie += touched;
    groups.set(key, g);
  }
  const cids = [...new Set([...groups.values()].map(function (g) { return g.cid; }).filter(function (c) { return c !== '*'; }))];
  const camps = {};
  const dayCost = {};
  if (cids.length) {
    const ph = cids.map(function () { return '?'; }).join(',');
    (await all(env, 'SELECT id, uid, name, prices, bid, budget, spent, daily_cap, status, updated_at FROM adv_campaigns WHERE id IN (' + ph + ')', ...cids)).forEach(function (c) { camps[c.id] = c; });
    (await all(env, 'SELECT cid, SUM(spend) AS s FROM adv_stats WHERE day = ? AND cid IN (' + ph + ') GROUP BY cid', today, ...cids)).forEach(function (r) { dayCost[r.cid] = r.s || 0; });
  }
  const stmts = [];
  const perCamp = {};
  for (const g of groups.values()) {
    let cost = 0;
    const c = camps[g.cid];
    if (c) {
      const p = safeParse(c.prices, {}), bid = Number(c.bid) || 1;
      cost = (g.imps * (Number(p.cpm) || 0) / 1000 + g.views * (Number(p.cpv) || 0) + g.clicks * (Number(p.cpc) || 0)) * bid;
      const pc = perCamp[c.id] || (perCamp[c.id] = { cost: 0, imps: 0, views: 0, clicks: 0 });
      const left = Math.max(0, Number(c.budget) - Number(c.spent) - pc.cost);
      cost = Math.min(cost, left);
      if (c.daily_cap && g.day === today) cost = Math.min(cost, Math.max(0, c.daily_cap - (dayCost[c.id] || 0) - pc.cost));
      cost = Math.round(cost * 100) / 100;
      pc.cost += cost; pc.imps += g.imps; pc.views += g.views; pc.clicks += g.clicks;
    }
    const hours = new Array(24).fill(0);
    hours[g.h] = g.cid === '*' ? g.opps : g.imps;
    stmts.push(db(env).prepare(
      "INSERT INTO adv_stats (day, cid, slot, imps, views, clicks, skips, opps, watch, spend, mob, desk, movie, series, hours) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) " +
      "ON CONFLICT(day, cid, slot) DO UPDATE SET imps = imps + excluded.imps, views = views + excluded.views, clicks = clicks + excluded.clicks, skips = skips + excluded.skips, opps = opps + excluded.opps, watch = watch + excluded.watch, spend = spend + excluded.spend, mob = mob + excluded.mob, desk = desk + excluded.desk, movie = movie + excluded.movie, series = series + excluded.series, " +
      "hours = json_set(CASE WHEN hours = '' THEN '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]' ELSE hours END, '$[' || CAST(?16 AS INTEGER) || ']', COALESCE(json_extract(CASE WHEN hours = '' THEN '[]' ELSE hours END, '$[' || CAST(?16 AS INTEGER) || ']'), 0) + ?17)"
    ).bind(g.day, g.cid, g.slot, g.imps, g.views, g.clicks, g.skips, g.opps, g.watch, cost, g.mob, g.desk, g.movie, g.series, JSON.stringify(hours), g.h, hours[g.h]));
  }
  const ended = [];
  for (const cid of Object.keys(perCamp)) {
    const pc = perCamp[cid], c = camps[cid];
    stmts.push(db(env).prepare("UPDATE adv_campaigns SET spent = MIN(budget, spent + ?), imps = imps + ?, views = views + ?, clicks = clicks + ? WHERE id = ?").bind(pc.cost, pc.imps, pc.views, pc.clicks, cid));
    if (c.status === 'active' && Number(c.spent) + pc.cost >= Number(c.budget) - 1) ended.push(cid);
  }
  if (stmts.length) await db(env).batch(stmts);
  for (const cid of ended) {
    await run(env, "UPDATE adv_campaigns SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'active'", Date.now(), cid);
    notifyUser(env, camps[cid].uid, '🏁 بودجهٔ کمپین «' + camps[cid].name + '» کامل مصرف شد. برای ادامه، کمپین تازه بسازید.').catch(function () { });
    INV_CACHE = null;
  }
  if (Math.random() < 0.02) await run(env, 'DELETE FROM adv_batches WHERE at < ?', Date.now() - 3 * DAY);
  return json({ ok: true, groups: groups.size, billed: Object.keys(perCamp).length });
}
async function netSummary(env) {
  const today = tehranDay();
  const t = await one(env, "SELECT SUM(imps) AS imps, SUM(views) AS views, SUM(clicks) AS clicks, SUM(spend) AS spend FROM adv_stats WHERE day = ? AND cid != '*'", today);
  const a = await one(env, "SELECT COUNT(*) AS n FROM adv_campaigns WHERE status = 'active'");
  const p = await one(env, "SELECT COUNT(*) AS n FROM adv_campaigns WHERE status = 'pending'");
  return json({ ok: true, v: VERSION, active: (a && a.n) || 0, pending: (p && p.n) || 0, today: { imps: (t && t.imps) || 0, views: (t && t.views) || 0, clicks: (t && t.clicks) || 0, spend: Math.round((t && t.spend) || 0) } });
}

/* ═══════ آمار کلی بازار (برای همهٔ تبلیغ‌دهنده‌ها) ═══════ */
let MARKET_CACHE = null;
async function marketStats(env, set) {
  if (MARKET_CACHE && Date.now() - MARKET_CACHE.t < 600000) return MARKET_CACHE.data;
  const today = tehranDay(), since = dayShift(today, -29), since7 = dayShift(today, -6);
  const rows = await all(env, "SELECT s.day, s.cid, s.slot, s.imps, s.views, s.clicks, s.skips, s.opps, s.spend, s.mob, s.desk, c.format FROM adv_stats s LEFT JOIN adv_campaigns c ON c.id = s.cid WHERE s.day >= ?", since);
  const days = {}, slots = {}, formats = {};
  SLOTS.forEach(function (s) { slots[s] = { slot: s, title: SLOT_INFO[s].title, desc: SLOT_INFO[s].desc, opps7: 0, imps7: 0, views7: 0, clicks7: 0, skips7: 0, spend7: 0 }; });
  ['video', 'banner', 'link'].forEach(function (f) { formats[f] = { imps: 0, views: 0, clicks: 0, spend: 0 }; });
  let mob = 0, desk = 0;
  rows.forEach(function (r) {
    const d = days[r.day] || (days[r.day] = { day: r.day, imps: 0, views: 0, clicks: 0, opps: 0 });
    if (r.cid === '*') { d.opps += r.opps; if (r.day >= since7 && slots[r.slot]) slots[r.slot].opps7 += r.opps; return; }
    d.imps += r.imps; d.views += r.views; d.clicks += r.clicks;
    mob += r.mob; desk += r.desk;
    if (r.day >= since7 && slots[r.slot]) { const s = slots[r.slot]; s.imps7 += r.imps; s.views7 += r.views; s.clicks7 += r.clicks; s.skips7 += r.skips; s.spend7 += r.spend; }
    if (r.format && formats[r.format]) { const f = formats[r.format]; f.imps += r.imps; f.views += r.views; f.clicks += r.clicks; f.spend += r.spend; }
  });
  const list = [];
  for (let i = 29; i >= 0; i--) { const day = dayShift(today, -i); list.push(days[day] || { day: day, imps: 0, views: 0, clicks: 0, opps: 0 }); }
  const act = await all(env, "SELECT format, COUNT(*) AS n FROM adv_campaigns WHERE status = 'active' GROUP BY format");
  const advs = await one(env, 'SELECT COUNT(DISTINCT uid) AS n FROM adv_campaigns WHERE status IN (\'active\',\'completed\',\'ended\',\'paused\')');
  const data = {
    days: list, slots: Object.values(slots), formats: formats, devices: { mob: mob, desk: desk },
    active: act.reduce(function (o, r) { o[r.format] = r.n; return o; }, {}), advertisers: (advs && advs.n) || 0, updatedAt: Date.now(),
  };
  MARKET_CACHE = { t: Date.now(), data: data };
  return data;
}
function publicConfig(set) {
  return {
    brand: set.brand, siteName: set.siteName, siteUrl: set.siteUrl, support: set.support, rules: set.rules,
    tariffs: set.tariffs, minBudget: set.minBudget, minDaily: set.minDaily, maxBid: set.maxBid, viewSec: set.viewSec, skipAfter: set.skipAfter, bannerSec: set.bannerSec, linkViaSite: set.linkViaSite !== false,
    maxVideoSec: set.maxVideoSec, minVideoSec: set.minVideoSec, maxVideoMB: set.maxVideoMB, maxImageKB: set.maxImageKB, allowExternalMedia: set.allowExternalMedia !== false,
    slots: SLOT_INFO, formatSlots: FORMAT_SLOTS, formatTitle: FORMAT_TITLE,
    k2k: { enabled: !!(set.k2k && set.k2k.enabled && set.k2k.card), min: set.k2k.min, max: set.k2k.max, presets: set.k2k.presets || [] },
    stars: { enabled: !!(set.stars && set.stars.enabled), packs: set.stars.packs || [] }, botUsername: set.botUsername || '',
  };
}
let GENRES_CACHE = null;
async function siteGenres(set) {
  if (GENRES_CACHE && Date.now() - GENRES_CACHE.t < 3600000) return GENRES_CACHE.list;
  let list = [];
  const base = String(set.siteUrl || '').replace(/\/+$/, '');
  if (/^https:\/\//.test(base)) {
    try {
      const r = await fetch(base + '/api/catalog', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      list = ((d && d.facets && d.facets.genres) || []).map(String).slice(0, 80);
    } catch (e) { list = []; }
  }
  GENRES_CACHE = { t: Date.now(), list: list };
  return list;
}

/* ═══════ تلگرام (اختیاری): استارز، اعلان‌ها، تأیید کارت‌به‌کارت ═══════ */
async function tgApi(env, method, params, timeoutMs) {
  const token = botToken(env);
  if (!token) return { ok: false, description: 'ADS_BOT_TOKEN تنظیم نشده' };
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(timeoutMs || 8000) });
    return await r.json();
  } catch (e) { return { ok: false, description: String((e && e.message) || e) }; }
}
async function notifyUser(env, uid, text) {
  if (!botToken(env)) return;
  const u = await one(env, 'SELECT tg_id FROM adv_users WHERE id = ?', uid);
  if (u && u.tg_id) await tgApi(env, 'sendMessage', { chat_id: u.tg_id, text: text }, 4000);
}
async function adminChats(env, set) {
  const ids = String(set.adminTgIds || '').split(/[,\s]+/).filter(function (x) { return /^\d{3,20}$/.test(x); });
  (await all(env, "SELECT tg_id FROM adv_users WHERE role = 'admin' AND tg_id IS NOT NULL")).forEach(function (r) { if (ids.indexOf(String(r.tg_id)) < 0) ids.push(String(r.tg_id)); });
  return ids.slice(0, 10);
}
async function notifyAdmins(env, set, text, markup) {
  if (!botToken(env)) return;
  for (const chat of await adminChats(env, set)) await tgApi(env, 'sendMessage', { chat_id: chat, text: text, reply_markup: markup || undefined, disable_web_page_preview: true }, 4000);
}
async function notifyAdminsReview(env, set, cid, name, user) {
  await notifyAdmins(env, set, '🆕 کمپین برای بررسی: «' + name + '»\nتبلیغ‌دهنده: ' + (user.name || '') + ' (' + (user.phone || user.email || '') + ')\nپنل مدیریت ← صف بررسی' + (originOf(set) ? '\n' + originOf(set) + '/#/admin/review' : ''));
}
async function apiTgLink(env, set, user) {
  if (!botToken(env) || !set.botUsername) return err('ربات تلگرام پلتفرم هنوز تنظیم نشده است');
  const code = rid(8);
  await kvSet(env, 'tglink:' + code, user.id, 1800000);
  return json({ ok: true, link: 'https://t.me/' + set.botUsername + '?start=link_' + code });
}
async function apiStarsCreate(request, env, set, user) {
  if (!(set.stars && set.stars.enabled) || !botToken(env)) return err('پرداخت با استارز فعال نیست');
  const b = await readJson(request, 2048);
  const pack = (set.stars.packs || [])[intOf(b.pack, -1, -1, 50)];
  if (!pack || !(pack.stars > 0) || !(pack.toman > 0)) return err('بسته نامعتبر است');
  if (!rateOk('stars:' + user.id, 10, 3600000)) return err('تعداد فاکتورها زیاد است؛ کمی بعد تلاش کنید.', 429);
  const id = 'i_' + rid(6), now = Date.now();
  await run(env, 'INSERT INTO adv_invoices (id, uid, kind, amount, stars, status, created_at, updated_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)', id, user.id, 'stars', pack.toman, pack.stars, 'pending', now, now, now + DAY);
  const r = await tgApi(env, 'createInvoiceLink', {
    title: 'شارژ کیف پول تبلیغات', description: pack.stars + ' استارز = ' + Number(pack.toman).toLocaleString('fa-IR') + ' تومان اعتبار تبلیغ',
    payload: 'adv:' + id, currency: 'XTR', prices: [{ label: 'اعتبار تبلیغ', amount: Number(pack.stars) }],
  });
  if (!r.ok) return err('ساخت فاکتور تلگرام ناموفق بود: ' + (r.description || ''), 502);
  return json({ ok: true, link: r.result, invoice: id });
}
function invPublic(inv, set) {
  const d = safeParse(inv.data, {});
  return { id: inv.id, kind: inv.kind, amount: inv.amount, extra: inv.extra, total: inv.amount + inv.extra, stars: inv.stars, status: inv.status,
    card: d.card || '', holder: d.holder || '', bank: d.bank || '', transferAt: d.transferAt || '', createdAt: inv.created_at, expiresAt: inv.expires_at || 0,
    remainingMs: inv.expires_at ? Math.max(0, inv.expires_at - Date.now()) : 0, reason: d.reason || '' };
}
async function apiK2kCreate(request, env, set, user) {
  const k = set.k2k || {};
  if (!k.enabled || !k.card) return err('کارت‌به‌کارت فعلاً فعال نیست');
  if (!rateOk('k2k:' + user.id, 12, 3600000)) return err('تعداد فاکتورها زیاد است؛ کمی بعد تلاش کنید.', 429);
  const b = await readJson(request, 2048);
  const amount = intOf(b.amount, 0, 0, 1e12);
  if (amount < intOf(k.min, 50000, 1000, 1e12) || amount > intOf(k.max, 50000000, 1000, 1e12)) return err('مبلغ باید بین ' + Number(k.min).toLocaleString('fa-IR') + ' و ' + Number(k.max).toLocaleString('fa-IR') + ' تومان باشد');
  const now = Date.now();
  await run(env, "UPDATE adv_invoices SET status = 'cancelled', updated_at = ? WHERE uid = ? AND kind = 'k2k' AND status = 'pending'", now, user.id);
  const act = await all(env, "SELECT amount, extra FROM adv_invoices WHERE kind = 'k2k' AND status IN ('pending','submitted') AND (expires_at IS NULL OR expires_at > ? OR status = 'submitted')", now);
  const used = new Set(act.map(function (r) { return r.amount + r.extra; }));
  let extra = 0;
  for (let t = 0; t < 80 && !extra; t++) { const e = 11 + Math.floor(Math.random() * 989); if (!used.has(amount + e)) extra = e; }
  if (!extra) extra = 11 + (now % 900);
  const id = 'i_' + rid(6);
  const data = { card: String(k.card).replace(/\D/g, '').slice(0, 16), holder: k.holder || '', bank: k.bank || '' };
  await run(env, 'INSERT INTO adv_invoices (id, uid, kind, amount, extra, status, data, created_at, updated_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, user.id, 'k2k', amount, extra, 'pending', JSON.stringify(data), now, now, now + intOf(k.ttlMin, 30, 10, 1440) * 60000);
  return json({ ok: true, invoice: invPublic(await one(env, 'SELECT * FROM adv_invoices WHERE id = ?', id), set) });
}
async function apiK2kAction(request, env, set, user, id, action) {
  const inv = await one(env, 'SELECT * FROM adv_invoices WHERE id = ? AND uid = ?', id, user.id);
  if (!inv || inv.kind !== 'k2k') return err('فاکتور پیدا نشد', 404);
  const now = Date.now();
  if (inv.status === 'pending' && inv.expires_at && inv.expires_at < now) { await run(env, "UPDATE adv_invoices SET status = 'expired', updated_at = ? WHERE id = ?", now, id); inv.status = 'expired'; }
  if (action === 'cancel' && inv.status === 'pending') { await run(env, "UPDATE adv_invoices SET status = 'cancelled', updated_at = ? WHERE id = ?", now, id); inv.status = 'cancelled'; }
  if (action === 'submit') {
    if (inv.status !== 'pending') return err(inv.status === 'expired' ? 'مهلت این فاکتور تمام شده؛ فاکتور تازه بسازید' : 'این فاکتور قابل اعلام واریز نیست');
    const d = safeParse(inv.data, {});
    d.transferAt = new Date(now + 12600000).toISOString().slice(0, 16).replace('T', ' ');
    await run(env, "UPDATE adv_invoices SET status = 'submitted', data = ?, updated_at = ? WHERE id = ?", JSON.stringify(d), now, id);
    inv.status = 'submitted'; inv.data = JSON.stringify(d);
    notifyAdmins(env, set, '💳 کارت‌به‌کارت تبلیغات — اعلام واریز\nتبلیغ‌دهنده: ' + user.name + ' (' + user.email + ')\nمبلغ دقیق (یکتا): ' + (inv.amount + inv.extra).toLocaleString('fa-IR') + ' تومان\nزمان اعلام: ' + d.transferAt + '\nفاکتور: ' + id + '\nفقط با مبلغ یکتا تطبیق دهید.',
      { inline_keyboard: [[{ text: '✅ تأیید', callback_data: 'k2k:ok:' + id }, { text: '❌ رد', callback_data: 'k2k:no:' + id }]] }).catch(function () { });
  }
  return json({ ok: true, invoice: invPublic(inv, set) });
}
async function decideK2k(env, set, id, approve, by, reason) {
  const inv = await one(env, 'SELECT * FROM adv_invoices WHERE id = ?', id);
  if (!inv || inv.kind !== 'k2k') return { error: 'فاکتور پیدا نشد' };
  if (inv.status === 'paid') return { error: 'قبلاً تأیید شده' };
  if (inv.status !== 'submitted' && inv.status !== 'pending') return { error: 'این فاکتور در انتظار بررسی نیست' };
  const now = Date.now(), d = safeParse(inv.data, {});
  d.decidedBy = by;
  if (approve) {
    const r = await run(env, "UPDATE adv_invoices SET status = 'paid', data = ?, updated_at = ? WHERE id = ? AND status IN ('submitted','pending')", JSON.stringify(d), now, id);
    if (!r.meta || !r.meta.changes) return { error: 'وضعیت فاکتور تغییر کرده است' };
    await credit(env, inv.uid, inv.amount + inv.extra, 'k2k', 'کارت‌به‌کارت ' + (inv.amount + inv.extra).toLocaleString('fa-IR') + ' تومان', 'k2k:' + id);
    notifyUser(env, inv.uid, '✅ واریز کارت‌به‌کارت تأیید شد و ' + (inv.amount + inv.extra).toLocaleString('fa-IR') + ' تومان به کیف پول تبلیغات اضافه شد.').catch(function () { });
    return { ok: true, status: 'paid' };
  }
  d.reason = String(reason || 'مبلغ واریزی با فاکتور مطابقت نداشت').slice(0, 200);
  await run(env, "UPDATE adv_invoices SET status = 'rejected', data = ?, updated_at = ? WHERE id = ?", JSON.stringify(d), now, id);
  notifyUser(env, inv.uid, '❌ واریز کارت‌به‌کارت تأیید نشد: ' + d.reason).catch(function () { });
  return { ok: true, status: 'rejected' };
}
async function tgWebhookSecret(env, set) { return (await hmacHexStr(appSecret(env, set), 'tg-webhook')).slice(0, 48); }
async function tgWebhook(request, env, set) {
  if (!safeEq(request.headers.get('x-telegram-bot-api-secret-token') || '', await tgWebhookSecret(env, set))) return new Response('forbidden', { status: 403 });
  const up = await readJson(request, 256 * 1024);
  const now = Date.now();
  if (up.pre_checkout_query) {
    const q = up.pre_checkout_query;
    const m = /^adv:(i_[a-f0-9]{12})$/.exec(String(q.invoice_payload || ''));
    const inv = m ? await one(env, 'SELECT * FROM adv_invoices WHERE id = ?', m[1]) : null;
    const ok = !!(inv && inv.kind === 'stars' && inv.status === 'pending' && q.currency === 'XTR' && Number(q.total_amount) === Number(inv.stars));
    await tgApi(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'این فاکتور معتبر نیست یا قبلاً پرداخت شده است.' });
    return json({ ok: true });
  }
  const msg = up.message;
  if (msg && msg.successful_payment) {
    const sp = msg.successful_payment;
    const m = /^adv:(i_[a-f0-9]{12})$/.exec(String(sp.invoice_payload || ''));
    const inv = m ? await one(env, 'SELECT * FROM adv_invoices WHERE id = ?', m[1]) : null;
    if (inv && inv.kind === 'stars' && sp.currency === 'XTR' && Number(sp.total_amount) === Number(inv.stars)) {
      await run(env, "UPDATE adv_invoices SET status = 'paid', data = ?, updated_at = ? WHERE id = ?", JSON.stringify({ charge: sp.telegram_payment_charge_id, tg: msg.from && msg.from.id }), now, inv.id);
      const r = await credit(env, inv.uid, inv.amount, 'stars', 'شارژ با ' + inv.stars + ' استارز', 'stars:' + sp.telegram_payment_charge_id);
      if (msg.from && msg.from.id) await run(env, 'UPDATE adv_users SET tg_id = COALESCE(tg_id, ?) WHERE id = ?', String(msg.from.id), inv.uid);
      if (!r.dup) await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: '✅ ' + Number(inv.amount).toLocaleString('fa-IR') + ' تومان به کیف پول تبلیغات شما اضافه شد. می‌توانید به پنل برگردید.' });
    }
    return json({ ok: true });
  }
  if (up.callback_query) {
    const cq = up.callback_query;
    const m = /^k2k:(ok|no):(i_[a-f0-9]{12})$/.exec(String(cq.data || ''));
    const chats = await adminChats(env, set);
    if (!m || chats.indexOf(String(cq.from && cq.from.id)) < 0) { await tgApi(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'فقط مدیر پلتفرم', show_alert: true }); return json({ ok: true }); }
    const out = await decideK2k(env, set, m[2], m[1] === 'ok', 'tg:' + cq.from.id, '');
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: out.error || (out.status === 'paid' ? 'تأیید شد ✓' : 'رد شد'), show_alert: !!out.error });
    if (!out.error && cq.message) await tgApi(env, 'editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: (cq.message.text || '') + '\n\n' + (out.status === 'paid' ? '✅ تأیید شد' : '❌ رد شد') });
    return json({ ok: true });
  }
  if (msg && msg.chat && msg.chat.type === 'private') {
    const tgId = String((msg.from && msg.from.id) || '');
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const state = await kvGet(env, 'tgstate:' + tgId);
    if (msg.contact) {
      if (!isOwnContact(msg, tgId)) {
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'فقط دکمهٔ «ارسال شماره موبایل» پایین را بزن و Share را بزن. شماره را تایپ نکن.', reply_markup: contactKeyboard() });
        return json({ ok: true });
      }
      const phone = normPhone(msg.contact.phone_number);
      const st = state || {};
      const got = await tgAuthUser(env, set, msg.from, phone);
      if (got.error) {
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: got.error });
        return json({ ok: true });
      }
      await kvSet(env, 'tgstate:' + tgId, { mode: 'done' }, 60000);
      if (st.ticket) await completeTgTicket(env, set, st.ticket, got.user);
      await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: (got.isNew ? '✅ ثبت‌نام انجام شد.' : '✅ ورود انجام شد.') + (st.ticket ? ' حالا به پنل برگردید؛ ورود شما خودکار کامل می‌شود.' : ''), reply_markup: { remove_keyboard: true } });
      if (st.ticket && originOf(set)) await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'بازگشت به پنل:', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل تبلیغات', url: originOf(set) }]] } });
      return json({ ok: true });
    }
    const mt = /^\/start\s+tglogin_([a-zA-Z0-9]{4,20})$/.exec(text);
    if (mt) {
      const rec = await kvGet(env, 'tick:' + mt[1]);
      if (!rec || rec.status === 'ready') {
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: '⌛️ این لینک ورود منقضی شده. از سایت دوباره «ورود با تلگرام» را بزنید.' });
        return json({ ok: true });
      }
      const u0 = await one(env, 'SELECT * FROM adv_users WHERE tg_id = ?', tgId);
      if (u0 && u0.phone && u0.status === 'active') {
        await run(env, 'UPDATE adv_users SET last_login = ? WHERE id = ?', Date.now(), u0.id);
        await completeTgTicket(env, set, mt[1], u0);
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: '✅ ورود انجام شد. حالا به پنل برگردید؛ ورود شما خودکار کامل می‌شود.' });
        if (originOf(set)) await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'بازگشت به پنل:', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل تبلیغات', url: originOf(set) }]] } });
        return json({ ok: true });
      }
      await kvSet(env, 'tgstate:' + tgId, { mode: 'wait_contact', ticket: mt[1] }, 1800000);
      await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'برای ورود / ثبت‌نام در پنل تبلیغات، روی دکمهٔ زیر بزن تا شماره‌ات ارسال بشه:\n\nاین اطلاعات نزد ما محفوظ می‌ماند و صرفاً برای تکمیل حساب کاربری شما دریافت می‌شود.', reply_markup: contactKeyboard() });
      return json({ ok: true });
    }
    if (state && state.mode === 'wait_contact') {
      await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'شماره را تایپ نکن. فقط دکمهٔ «ارسال شماره موبایل» را بزن.', reply_markup: contactKeyboard() });
      return json({ ok: true });
    }
    const mm = /^\/start\s+link_([a-f0-9]{16})$/.exec(text);
    if (mm) {
      const uid = await kvGet(env, 'tglink:' + mm[1]);
      if (uid) {
        await run(env, 'UPDATE adv_users SET tg_id = ? WHERE id = ?', String(msg.from.id), uid);
        await run(env, 'DELETE FROM adv_kv WHERE k = ?', 'tglink:' + mm[1]);
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: '✅ تلگرام شما به حساب تبلیغات متصل شد. نتیجهٔ بررسی کمپین‌ها، پرداخت‌ها و پایان بودجه را همین‌جا خبر می‌دهیم.' });
      } else await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: 'لینک اتصال منقضی شده؛ از پنل تبلیغات دوباره «اتصال تلگرام» را بزنید.' });
      return json({ ok: true });
    }
    await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: '📢 ربات پلتفرم تبلیغات ' + (set.brand || '') + '\nبرای ساخت کمپین و شارژ کیف پول وارد پنل شوید' + (originOf(set) ? ':\n' + originOf(set) : '.') });
  }
  return json({ ok: true });
}

/* ═══════ API مدیر پلتفرم ═══════ */
function maskSecret(s) { s = String(s || ''); return s.length <= 10 ? (s ? '••••' : '') : s.slice(0, 4) + '…' + s.slice(-4); }
async function adminOverview(env, set) {
  const n = async function (sql, ...a) { const r = await one(env, sql, ...a); return (r && r.n) || 0; };
  const today = tehranDay();
  const t = await one(env, "SELECT SUM(imps) AS imps, SUM(views) AS views, SUM(clicks) AS clicks, SUM(spend) AS spend FROM adv_stats WHERE day = ? AND cid != '*'", today);
  const m = await one(env, "SELECT SUM(spend) AS spend FROM adv_stats WHERE day >= ? AND cid != '*'", dayShift(today, -29));
  return json({
    users: await n('SELECT COUNT(*) AS n FROM adv_users'), pending: await n("SELECT COUNT(*) AS n FROM adv_campaigns WHERE status = 'pending'"),
    active: await n("SELECT COUNT(*) AS n FROM adv_campaigns WHERE status = 'active'"), k2kWaiting: await n("SELECT COUNT(*) AS n FROM adv_invoices WHERE kind = 'k2k' AND status = 'submitted'"),
    balances: (await one(env, 'SELECT SUM(balance) AS n FROM adv_users') || {}).n || 0,
    today: { imps: (t && t.imps) || 0, views: (t && t.views) || 0, clicks: (t && t.clicks) || 0, spend: Math.round((t && t.spend) || 0) }, spend30: Math.round((m && m.spend) || 0),
    netConfigured: netSecret(env, set).length >= 16, netFromEnv: !!env.NET_SECRET, bot: !!botToken(env), kv: !!env.ADS_KV, version: VERSION,
  });
}
async function adminCampaigns(env, set, status) {
  const rows = status ? await all(env, 'SELECT c.*, u.email AS u_email, u.name AS u_name, u.phone AS u_phone FROM adv_campaigns c LEFT JOIN adv_users u ON u.id = c.uid WHERE c.status = ? ORDER BY c.updated_at DESC LIMIT 300', status)
    : await all(env, 'SELECT c.*, u.email AS u_email, u.name AS u_name, u.phone AS u_phone FROM adv_campaigns c LEFT JOIN adv_users u ON u.id = c.uid ORDER BY c.updated_at DESC LIMIT 300');
  return json({ campaigns: rows.map(function (r) { return Object.assign(campaignPublic(r, originOf(set)), { owner: { id: r.uid, email: r.u_email || '', phone: r.u_phone || '', name: r.u_name || '' } }); }) });
}
async function adminUsers(env, url) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const rows = q ? await all(env, "SELECT u.*, (SELECT COUNT(*) FROM adv_campaigns c WHERE c.uid = u.id) AS camps FROM adv_users u WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 200", '%' + q + '%', '%' + q + '%')
    : await all(env, 'SELECT u.*, (SELECT COUNT(*) FROM adv_campaigns c WHERE c.uid = u.id) AS camps FROM adv_users u ORDER BY created_at DESC LIMIT 200');
  return json({ users: rows.map(function (u) { return Object.assign(pubUser(u), { status: u.status, campaigns: u.camps || 0, lastLogin: u.last_login || 0 }); }) });
}
async function adminUserAction(request, env, admin, uid) {
  const b = await readJson(request, 4096);
  const u = await one(env, 'SELECT * FROM adv_users WHERE id = ?', uid);
  if (!u) return err('کاربر پیدا نشد', 404);
  if (b.action === 'adjust') {
    const amount = intOf(b.amount, 0, -1e12, 1e12);
    const note = String(b.note || '').trim().slice(0, 120) || 'تنظیم دستی مدیر';
    if (!amount) return err('مبلغ را وارد کنید');
    if (amount > 0) await credit(env, uid, amount, 'admin', note + ' (' + admin.email + ')');
    else { const d = await debit(env, uid, -amount, 'admin', note + ' (' + admin.email + ')'); if (!d.ok) return err(d.error); }
  } else if (b.action === 'block' || b.action === 'unblock') {
    if (u.id === admin.id) return err('نمی‌توانید حساب خودتان را مسدود کنید');
    await run(env, 'UPDATE adv_users SET status = ?, sess_ver = sess_ver + 1 WHERE id = ?', b.action === 'block' ? 'blocked' : 'active', uid);
    if (b.action === 'block') { for (const c of await all(env, "SELECT * FROM adv_campaigns WHERE uid = ? AND status = 'active'", uid)) await run(env, "UPDATE adv_campaigns SET status = 'paused', updated_at = ? WHERE id = ?", Date.now(), c.id); INV_CACHE = null; }
  } else if (b.action === 'admin' || b.action === 'unadmin') {
    if (u.id === admin.id) return err('نقش خودتان را تغییر ندهید');
    await run(env, 'UPDATE adv_users SET role = ? WHERE id = ?', b.action === 'admin' ? 'admin' : 'adv', uid);
  } else return err('عملیات نامعتبر');
  return json({ ok: true, user: pubUser(await one(env, 'SELECT * FROM adv_users WHERE id = ?', uid)) });
}
async function adminPayments(env, set) {
  const rows = await all(env, "SELECT i.*, u.email AS u_email, u.name AS u_name FROM adv_invoices i LEFT JOIN adv_users u ON u.id = i.uid WHERE (i.kind = 'k2k' AND i.status IN ('submitted','pending')) OR i.updated_at > ? ORDER BY CASE i.status WHEN 'submitted' THEN 0 ELSE 1 END, i.updated_at DESC LIMIT 200", Date.now() - 14 * DAY);
  return json({ invoices: rows.map(function (r) { return Object.assign(invPublic(r, set), { owner: { email: r.u_email || '', name: r.u_name || '' } }); }) });
}
function adminSettingsView(env, set) {
  const s = JSON.parse(JSON.stringify(set));
  delete s.secret; delete s._origin;
  s.netSecret = env.NET_SECRET ? '' : (set.netSecret || '');
  s.netFromEnv = !!env.NET_SECRET;
  s.botConfigured = !!botToken(env);
  s.kv = !!env.ADS_KV;
  return s;
}
async function adminSettingsSave(request, env, set) {
  const b = await readJson(request, 64 * 1024);
  const s = JSON.parse(JSON.stringify(set));
  delete s._origin;
  const str = function (k, max) { if (b[k] !== undefined) s[k] = String(b[k]).trim().slice(0, max); };
  str('siteName', 60); str('brand', 60); str('support', 120); str('bannedWords', 4000); str('shorteners', 2000);
  if (b.rules !== undefined) s.rules = String(b.rules).slice(0, 12000);
  if (b.siteUrl !== undefined) { const u = String(b.siteUrl).trim().replace(/\/+$/, ''); if (u && !httpsUrl(u + '/', 300)) return err('آدرس سایت باید https باشد'); s.siteUrl = u; }
  if (b.tariffs) for (const f of ['video', 'banner', 'link']) if (b.tariffs[f]) s.tariffs[f] = { cpm: numOf(b.tariffs[f].cpm, 0, 0, 1e9), cpv: numOf(b.tariffs[f].cpv, 0, 0, 1e9), cpc: numOf(b.tariffs[f].cpc, 0, 0, 1e9) };
  const ints = { minBudget: [0, 1e12], minDaily: [0, 1e12], viewSec: [1, 60], skipAfter: [0, 30], bannerSec: [3, 30], maxVideoSec: [5, 120], minVideoSec: [1, 30], maxVideoMB: [1, 24], maxImageKB: [50, 5000], invTtl: [30, 600] };
  for (const k of Object.keys(ints)) if (b[k] !== undefined) s[k] = intOf(b[k], s[k], ints[k][0], ints[k][1]);
  if (b.maxBid !== undefined) s.maxBid = numOf(b.maxBid, 5, 1, 20);
  if (b.allowExternalMedia !== undefined) s.allowExternalMedia = !!b.allowExternalMedia;
  if (b.linkViaSite !== undefined) s.linkViaSite = !!b.linkViaSite;
  if (b.adminTgIds !== undefined) s.adminTgIds = String(b.adminTgIds).replace(/[^\d,\s]/g, '').slice(0, 300);
  if (b.botUsername !== undefined) s.botUsername = String(b.botUsername).replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  if (b.k2k) {
    const k = b.k2k;
    const card = enDigits(String(k.card || '')).replace(/\D/g, '');
    if (card && card.length !== 16) return err('شماره کارت باید ۱۶ رقم باشد');
    s.k2k = { enabled: !!k.enabled, card: card, holder: String(k.holder || '').slice(0, 60), bank: String(k.bank || '').slice(0, 40), min: intOf(k.min, 50000, 1000, 1e12), max: intOf(k.max, 50000000, 1000, 1e12), ttlMin: intOf(k.ttlMin, 30, 10, 1440),
      presets: (Array.isArray(k.presets) ? k.presets : String(k.presets || '').split(/[,،\s]+/)).map(function (x) { return intOf(x, 0, 0, 1e12); }).filter(function (x) { return x > 0; }).slice(0, 8) };
    if (s.k2k.enabled && !s.k2k.card) return err('برای فعال‌کردن کارت‌به‌کارت شماره کارت لازم است');
  }
  if (b.stars) {
    const packs = (Array.isArray(b.stars.packs) ? b.stars.packs : []).map(function (p) { return { stars: intOf(p.stars, 0, 0, 100000), toman: intOf(p.toman, 0, 0, 1e12) }; }).filter(function (p) { return p.stars > 0 && p.toman > 0; }).slice(0, 8);
    s.stars = { enabled: !!b.stars.enabled, packs: packs.length ? packs : set.stars.packs };
  }
  await saveSettings(env, s);
  return json({ ok: true, settings: adminSettingsView(env, await getSettings(env, true)) });
}
async function adminNetSecret(env, set) {
  if (env.NET_SECRET) return err('کلید از Secret ورکر (NET_SECRET) خوانده می‌شود؛ تغییر آن از داشبورد Cloudflare است');
  const s = JSON.parse(JSON.stringify(set)); delete s._origin;
  s.netSecret = rid(24);
  await saveSettings(env, s);
  return json({ ok: true, netSecret: s.netSecret });
}
async function adminBotWebhook(env, set, origin) {
  if (!botToken(env)) return err('ابتدا Secret با نام ADS_BOT_TOKEN را در Worker تنظیم کنید');
  const me = await tgApi(env, 'getMe', {});
  if (!me.ok) return err('توکن ربات معتبر نیست: ' + (me.description || ''));
  const r = await tgApi(env, 'setWebhook', { url: origin + '/api/tg/webhook', secret_token: await tgWebhookSecret(env, set), allowed_updates: ['message', 'callback_query', 'pre_checkout_query'], drop_pending_updates: false });
  if (!r.ok) return err('ثبت وبهوک ناموفق بود: ' + (r.description || ''));
  const s = JSON.parse(JSON.stringify(set)); delete s._origin;
  s.botUsername = me.result.username || s.botUsername;
  await saveSettings(env, s);
  return json({ ok: true, bot: me.result.username, url: origin + '/api/tg/webhook' });
}

/* ═══════ کارهای زمان‌بندی‌شده (Cron) ═══════ */
async function cron(env) {
  await ensureSchema(env);
  const now = Date.now();
  for (const c of await all(env, "SELECT * FROM adv_campaigns WHERE status IN ('active','paused') AND end_at IS NOT NULL AND end_at <= ? LIMIT 50", now)) await endCampaign(env, c, 'پایان زمان کمپین');
  await run(env, "UPDATE adv_invoices SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?", now, now);
  await run(env, 'DELETE FROM adv_batches WHERE at < ?', now - 3 * DAY);
  await run(env, 'DELETE FROM adv_kv WHERE exp IS NOT NULL AND exp < ?', now);
}

/* ═══════ مسیریابی ═══════ */
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname, m = request.method;
  let mm;
  if ((mm = /^\/m\/([a-f0-9]{24})(?:\.[a-z0-9]{2,4})?$/.exec(p)) && (m === 'GET' || m === 'HEAD')) { await ensureSchema(env); return serveMedia(request, env, ctx, mm[1]); }
  if (p === '/favicon.ico' || p === '/favicon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0e14"/><path d="M14 38V26l26-12v36L14 38z" fill="#ff7a1a"/><rect x="42" y="22" width="8" height="20" rx="3" fill="#ffb01f"/></svg>', { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
  if (p.indexOf('/api/') !== 0) return new Response(ADS_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' } });
  await ensureSchema(env);
  const set = await getSettings(env);
  set._origin = url.origin;
  const a = p.slice(5);
  /* اتصال سایت اصلی */
  if (a.indexOf('net/') === 0) {
    const bodyText = m === 'POST' ? await request.text() : '';
    if (bodyText.length > 2 * 1024 * 1024) return err('دسته خیلی بزرگ است', 413);
    const bad = await verifyNet(request, env, set, bodyText);
    if (bad) return err(bad, 401);
    if (a === 'net/inventory' && m === 'GET') return json(await buildInventory(env, set));
    if (a === 'net/events' && m === 'POST') { let body; try { body = JSON.parse(bodyText || '{}'); } catch (e) { return err('JSON نامعتبر'); } return netEvents(env, set, body); }
    if (a === 'net/summary' && m === 'GET') return netSummary(env);
    return err('یافت نشد', 404);
  }
  if (a === 'tg/webhook' && m === 'POST') return tgWebhook(request, env, set);
  if (a === 'config' && m === 'GET') {
    const mk = await marketStats(env, set);
    return json({ config: publicConfig(set), genres: await siteGenres(set), market: { slots: mk.slots, active: mk.active, advertisers: mk.advertisers } });
  }
  if ((a === 'auth/register' || a === 'auth/login') && m === 'POST') return err('ورود و ثبت‌نام فقط با تلگرام است.', 410);
  if (a === 'auth/start' && m === 'POST') return apiAuthStart(request, env, set);
  if ((mm = /^auth\/ticket\/([a-zA-Z0-9]{4,20})$/.exec(a)) && m === 'GET') return apiAuthTicket(env, set, mm[1]);
  const user = await currentUser(request, env, set);
  if (!user) return err('ابتدا وارد شوید', 401);
  if (a === 'me' && m === 'GET') return json({ user: pubUser(user) });
  if (a === 'me' && m === 'POST') return apiProfile(request, env, set, user);
  if (a === 'me/tg-link' && m === 'POST') return apiTgLink(env, set, user);
  if (a === 'market' && m === 'GET') return json(await marketStats(env, set));
  if (a === 'dashboard' && m === 'GET') {
    const since = dayShift(tehranDay(), -13);
    const days = await all(env, 'SELECT day, SUM(imps) AS imps, SUM(views) AS views, SUM(clicks) AS clicks, SUM(spend) AS spend FROM adv_stats WHERE day >= ? AND cid IN (SELECT id FROM adv_campaigns WHERE uid = ?) GROUP BY day', since, user.id);
    const map = {}; days.forEach(function (d) { map[d.day] = d; });
    const series = []; for (let i = 13; i >= 0; i--) { const day = dayShift(tehranDay(), -i); series.push(map[day] || { day: day, imps: 0, views: 0, clicks: 0, spend: 0 }); }
    return json({ user: pubUser(user), campaigns: await apiCampaignList(env, set, user), series: series, txs: await all(env, 'SELECT amount, balance, type, note, created_at FROM adv_tx WHERE uid = ? ORDER BY created_at DESC LIMIT 8', user.id) });
  }
  if (a === 'campaigns' && m === 'GET') return json({ campaigns: await apiCampaignList(env, set, user) });
  if (a === 'campaigns' && m === 'POST') return apiCampaignSave(request, env, set, user, '');
  if ((mm = /^campaigns\/(c_[a-f0-9]{10})$/.exec(a))) {
    if (m === 'POST') return apiCampaignSave(request, env, set, user, mm[1]);
    if (m === 'GET') { const c = await one(env, 'SELECT * FROM adv_campaigns WHERE id = ?', mm[1]); if (!c || (c.uid !== user.id && user.role !== 'admin')) return err('کمپین پیدا نشد', 404); return json({ campaign: campaignPublic(c, originOf(set)) }); }
  }
  if ((mm = /^campaigns\/(c_[a-f0-9]{10})\/stats$/.exec(a)) && m === 'GET') return apiCampaignStats(env, set, user, mm[1], url.searchParams.get('days'));
  if ((mm = /^campaigns\/(c_[a-f0-9]{10})\/(submit|pause|resume|stop|delete)$/.exec(a)) && m === 'POST') return apiCampaignAction(request, env, set, user, mm[1], mm[2]);
  if (a === 'media' && m === 'POST') return apiUpload(request, env, set, user);
  if (a === 'wallet' && m === 'GET') {
    return json({ balance: user.balance, txs: await all(env, 'SELECT amount, balance, type, note, created_at FROM adv_tx WHERE uid = ? ORDER BY created_at DESC LIMIT 60', user.id),
      invoices: (await all(env, 'SELECT * FROM adv_invoices WHERE uid = ? ORDER BY created_at DESC LIMIT 20', user.id)).map(function (i) { return invPublic(i, set); }) });
  }
  if (a === 'wallet/stars' && m === 'POST') return apiStarsCreate(request, env, set, user);
  if (a === 'wallet/k2k' && m === 'POST') return apiK2kCreate(request, env, set, user);
  if ((mm = /^wallet\/k2k\/(i_[a-f0-9]{12})(?:\/(submit|cancel))?$/.exec(a))) return apiK2kAction(request, env, set, user, mm[1], mm[2] || 'get');
  /* مدیر */
  if (a.indexOf('admin/') === 0) {
    if (user.role !== 'admin') return err('دسترسی مدیریت لازم است', 403);
    if (a === 'admin/overview' && m === 'GET') return adminOverview(env, set);
    if (a === 'admin/campaigns' && m === 'GET') return adminCampaigns(env, set, String(url.searchParams.get('status') || '').replace(/[^a-z]/g, ''));
    if ((mm = /^admin\/review\/(c_[a-f0-9]{10})$/.exec(a)) && m === 'POST') return apiReview(request, env, set, user, mm[1]);
    if ((mm = /^admin\/campaigns\/(c_[a-f0-9]{10})\/(pause|resume|stop)$/.exec(a)) && m === 'POST') return apiCampaignAction(request, env, set, user, mm[1], mm[2]);
    if (a === 'admin/users' && m === 'GET') return adminUsers(env, url);
    if ((mm = /^admin\/users\/(u_[a-f0-9]{12})$/.exec(a)) && m === 'POST') return adminUserAction(request, env, user, mm[1]);
    if (a === 'admin/payments' && m === 'GET') return adminPayments(env, set);
    if ((mm = /^admin\/payments\/(i_[a-f0-9]{12})\/(approve|reject)$/.exec(a)) && m === 'POST') {
      const b = await readJson(request, 4096);
      const out = await decideK2k(env, set, mm[1], mm[2] === 'approve', user.email, b.reason);
      return out.error ? err(out.error) : json(out);
    }
    if (a === 'admin/settings' && m === 'GET') return json({ settings: adminSettingsView(env, set) });
    if (a === 'admin/settings' && m === 'POST') return adminSettingsSave(request, env, set);
    if (a === 'admin/net-secret' && m === 'POST') return adminNetSecret(env, set);
    if (a === 'admin/bot-webhook' && m === 'POST') return adminBotWebhook(env, set, url.origin);
  }
  return err('یافت نشد', 404);
}
export default {
  async fetch(request, env, ctx) {
    try { return await route(request, env, ctx); }
    catch (e) {
      const st = (e && e.status) || 500;
      if (st >= 500) console.error(e);
      return err((e && e.message) || 'خطای سرور', st);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(cron(env).catch(function (e) { console.error('cron', e); })); },
};

/* ═══════ رابط کاربری (SPA) — متن این تابع به مرورگر فرستاده می‌شود ═══════ */
function ADS_APP(W) {
  'use strict';
  var D = W.document;
  var S = { token: '', user: null, cfg: null, genres: [], market: null, k2kTimer: 0 };
  try { S.token = W.localStorage.getItem('adv_t') || ''; } catch (e) { }
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  function fa(n) { return String(n == null ? '' : n).replace(/[0-9]/g, function (d) { return FA.charAt(+d); }); }
  function num(n) { n = Number(n) || 0; try { return n.toLocaleString('fa-IR', { maximumFractionDigits: 1 }); } catch (e) { return fa(n); } }
  function money(n) { return num(Math.round(Number(n) || 0)) + ' تومان'; }
  function pct(a, b) { return b ? num(Math.round((a / b) * 1000) / 10) + '٪' : '—'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function date(t) { if (!t) return '—'; try { return new Date(t).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }
  function dtime(t) { if (!t) return '—'; try { return new Date(t).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function dayLabel(d) { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }); } catch (e) { return d; } }
  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
  function setToken(t) { S.token = t || ''; try { if (t) W.localStorage.setItem('adv_t', t); else W.localStorage.removeItem('adv_t'); } catch (e) { } }
  function api(path, opts) {
    opts = opts || {};
    var h = { 'content-type': 'application/json' };
    if (S.token) h.authorization = 'Bearer ' + S.token;
    return fetch('/api' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return { error: 'خطای ارتباط با سرور' }; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('خطا ' + r.status)); e.status = r.status; e.data = j; if (r.status === 401 && S.token && path.indexOf('/auth/') < 0) { setToken(''); S.user = null; nav('#/login'); } throw e; }
        return j;
      });
    });
  }
  function upload(file, kind, meta, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      var qs = '?kind=' + kind + '&w=' + (meta.w || 0) + '&h=' + (meta.h || 0) + '&dur=' + (meta.dur || 0);
      x.open('POST', '/api/media' + qs);
      x.setRequestHeader('authorization', 'Bearer ' + S.token);
      x.setRequestHeader('content-type', file.type || 'application/octet-stream');
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () { var j = {}; try { j = JSON.parse(x.responseText); } catch (e) { } if (x.status >= 200 && x.status < 300) resolve(j.media); else reject(new Error(j.error || ('خطای آپلود ' + x.status))); };
      x.onerror = function () { reject(new Error('اتصال قطع شد')); };
      x.send(file);
    });
  }
  function probe(file, kind) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var done = function (r) { URL.revokeObjectURL(url); resolve(r); };
      if (kind === 'video') {
        var v = D.createElement('video');
        v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = function () { done({ w: v.videoWidth || 0, h: v.videoHeight || 0, dur: Math.round((v.duration || 0) * 10) / 10 }); };
        v.onerror = function () { done({ w: 0, h: 0, dur: 0 }); };
        v.src = url;
      } else {
        var im = new Image();
        im.onload = function () { done({ w: im.naturalWidth, h: im.naturalHeight, dur: 0 }); };
        im.onerror = function () { done({ w: 0, h: 0, dur: 0 }); };
        im.src = url;
      }
      setTimeout(function () { resolve({ w: 0, h: 0, dur: 0 }); }, 15000);
    });
  }
  function toast(msg, type) {
    var t = D.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 3600);
  }
  function modal(title, html, onOpen) {
    var root = $('#modal');
    root.innerHTML = '<div class="mw"><div class="md"><div class="mh"><b>' + esc(title) + '</b><button class="x" type="button">✕</button></div><div class="mb">' + html + '</div></div></div>';
    var close = function () { root.innerHTML = ''; };
    $('.x', root).onclick = close;
    $('.mw', root).onclick = function (e) { if (e.target.classList.contains('mw')) close(); };
    if (onOpen) onOpen($('.md', root), close);
    return close;
  }
  function copy(text, label) {
    var ok = function () { toast((label || 'کپی') + ' شد ✓', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { prompt('کپی کنید:', text); });
    else prompt('کپی کنید:', text);
  }
  function nav(h) { if (location.hash === h) render(); else location.hash = h; }
  var STATUS = { draft: ['پیش‌نویس', ''], pending: ['در انتظار بررسی', 'warn'], active: ['در حال نمایش', 'ok'], paused: ['متوقف موقت', ''], rejected: ['ردشده', 'bad'], ended: ['پایان‌یافته', ''], completed: ['بودجه تمام شد', 'acc'] };
  function badge(st) { var s = STATUS[st] || [st, '']; return '<span class="bdg ' + s[1] + '">' + s[0] + '</span>'; }
  function fmtTitle(f) { return (S.cfg && S.cfg.formatTitle && S.cfg.formatTitle[f]) || f; }
  function slotTitle(s) { return (S.cfg && S.cfg.slots && S.cfg.slots[s] && S.cfg.slots[s].title) || s; }
  function unitText(f) {
    var t = (S.cfg && S.cfg.tariffs && S.cfg.tariffs[f]) || {};
    var parts = [];
    if (t.cpv) parts.push(money(t.cpv) + ' هر بازدید کامل');
    if (t.cpm) parts.push(money(t.cpm) + ' هر ۱۰۰۰ نمایش');
    if (t.cpc) parts.push(money(t.cpc) + ' هر کلیک');
    return parts.join(' + ') || 'رایگان';
  }
  /* ── نمودار SVG ساده (بدون کتابخانه) ── */
  function chart(series, keys, opts) {
    opts = opts || {};
    var W0 = 640, H0 = opts.h || 180, pad = 26;
    var max = 1;
    series.forEach(function (d) { keys.forEach(function (k) { max = Math.max(max, Number(d[k[0]]) || 0); }); });
    var n = series.length, bw = (W0 - pad * 2) / Math.max(1, n);
    var out = '<svg class="chart" viewBox="0 0 ' + W0 + ' ' + (H0 + 24) + '" preserveAspectRatio="none">';
    for (var g = 0; g <= 4; g++) { var gy = pad / 2 + (H0 - pad) * g / 4; out += '<line x1="' + pad + '" x2="' + (W0 - pad) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>'; }
    series.forEach(function (d, i) {
      keys.forEach(function (k, j) {
        var v = Number(d[k[0]]) || 0;
        var h = (H0 - pad) * v / max;
        var w = Math.max(2, bw / keys.length - 3);
        var x = pad + i * bw + j * (bw / keys.length) + 1.5;
        out += '<rect x="' + x.toFixed(1) + '" y="' + (pad / 2 + H0 - pad - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0.5, h).toFixed(1) + '" rx="2" fill="' + k[2] + '"><title>' + esc(dayLabel(d.day) + ' — ' + k[1] + ': ' + num(v)) + '</title></rect>';
      });
      if (n <= 16 || i % Math.ceil(n / 10) === 0) out += '<text x="' + (pad + i * bw + bw / 2).toFixed(1) + '" y="' + (H0 + 16) + '" class="lbl">' + esc(opts.labels ? opts.labels[i] : dayLabel(d.day)) + '</text>';
    });
    out += '</svg><div class="legend">' + keys.map(function (k) { return '<span><i style="background:' + k[2] + '"></i>' + k[1] + '</span>'; }).join('') + '</div>';
    return out;
  }
  function kpi(label, value, sub) { return '<div class="kpi"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }

  /* ── پوسته ── */
  function shell(active, inner) {
    var u = S.user;
    var links = u ? [['dash', '📊 داشبورد'], ['campaigns', '🎯 کمپین‌ها'], ['new', '➕ کمپین تازه'], ['wallet', '💰 کیف پول'], ['market', '📈 بازار و تعرفه‌ها'], ['rules', '📜 قوانین']] : [['', '🏠 خانه'], ['market-public', '📈 تعرفه‌ها'], ['rules', '📜 قوانین']];
    if (u && u.role === 'admin') links.push(['admin', '🛡 مدیریت']);
    var brand = (S.cfg && S.cfg.brand) || 'تبلیغات';
    $('#app').innerHTML = '<header class="top"><a class="logo" href="#/' + (u ? 'dash' : '') + '"><span>📢</span>' + esc(brand) + '</a><nav>' +
      links.map(function (l) { return '<a href="#/' + l[0] + '" class="' + (active === l[0] ? 'on' : '') + '">' + l[1] + '</a>'; }).join('') + '</nav><div class="me">' +
      (u ? '<a class="chip" href="#/wallet">💰 ' + money(u.balance) + '</a><a class="chip" href="#/account">👤 ' + esc(u.name) + '</a>' : '<a class="btn sm pri" href="#/login">ورود / ثبت‌نام</a>') +
      '</div></header><main>' + inner + '</main><footer>' + esc(brand) + ' — ' + (S.cfg && S.cfg.siteName ? 'تبلیغ در ' + esc(S.cfg.siteName) : '') + (S.cfg && S.cfg.support ? ' · پشتیبانی: ' + esc(S.cfg.support) : '') + '</footer>';
  }
  function needLogin() { if (!S.user) { nav('#/login'); return true; } return false; }

  /* ── صفحهٔ معرفی ── */
  function viewLanding() {
    var c = S.cfg || {};
    var slots = (S.market && S.market.slots) || [];
    var fmt = function (f, ic, t, d) { return '<div class="feat"><div class="ic">' + ic + '</div><h3>' + t + '</h3><p>' + d + '</p><div class="price">' + unitText(f) + '</div></div>'; };
    shell('', '<section class="hero"><h1>تبلیغ شما جلوی چشم هزاران بینندهٔ فیلم و سریال</h1><p>ویدئو، بنر یا لینک — خودتان کمپین بسازید، بودجه را تعیین کنید و آمار دقیق نمایش، بازدید کامل و کلیک را لحظه‌به‌لحظه ببینید. هزینهٔ تبلیغ ویدئویی فقط به ازای «بازدید کامل» است.</p>' +
      '<div class="cta"><a class="btn pri lg" href="#/login">شروع رایگان</a><a class="btn lg" href="#/login">ورود به پنل</a></div></section>' +
      '<section class="feats">' + fmt('video', '🎬', 'تبلیغ ویدئویی', 'پیش از دانلود، شروع پخش آنلاین و هنگام تعویض کیفیت/دوبله. مثل یوتیوب: رد کردن پیش از بازدید کامل رایگان است.') +
      fmt('banner', '🖼', 'تبلیغ بنری', 'نوار روی پلیر حین تماشا، بنر هنگام توقف و تمام‌صفحه پیش از دانلود.') +
      fmt('link', '🔗', 'تبلیغ لینکی', 'دکمهٔ اختصاصی شما زیر هر فایلی که ربات برای کاربران می‌فرستد.') + '</section>' +
      (slots.length ? '<section class="card"><h2>ظرفیت جایگاه‌ها (میانگین روزانهٔ ۷ روز اخیر)</h2><div class="tbl"><table><thead><tr><th>جایگاه</th><th>فرصت نمایش روزانه</th><th>توضیح</th></tr></thead><tbody>' +
        slots.map(function (s) { return '<tr><td><b>' + esc(s.title) + '</b></td><td>' + num(Math.round(s.opps7 / 7)) + '</td><td class="mut">' + esc(s.desc) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
      '<section class="card steps"><h2>چطور کار می‌کند؟</h2><ol><li>ثبت‌نام و شارژ کیف پول با <b>استارز تلگرام</b> یا <b>کارت‌به‌کارت</b></li><li>ساخت کمپین: فایل یا متن، جایگاه، مخاطب و بودجه</li><li>بررسی و تأیید مدیر (معمولاً چند ساعت)</li><li>نمایش خودکار + آمار دقیق؛ باقی‌ماندهٔ بودجه هر زمان قابل برگشت است</li></ol></section>');
  }
  function viewAuth() {
    shell('', '<section class="auth card"><h2>ورود / ثبت‌نام با تلگرام</h2>' +
      '<p class="mut">ورود و ثبت‌نام فقط با تلگرام انجام می‌شود — دقیقاً مثل ورود سایت اصلی. بعد از زدن دکمه، در ربات تلگرام، شمارهٔ موبایل خود را با دکمهٔ «ارسال شماره موبایل» به اشتراک بگذارید.</p>' +
      '<button class="btn pri block" id="a-tg">ورود / ثبت‌نام با تلگرام</button>' +
      '<p class="mut c" id="a-stat"></p></section>');
    $('#a-tg').onclick = function () {
      var btn = $('#a-tg'), stat = $('#a-stat');
      btn.disabled = true; stat.textContent = 'در حال اتصال به ربات…';
      api('/auth/start', { method: 'POST' }).then(function (r) {
        W.open(r.botLink, '_blank');
        stat.textContent = 'در ربات تلگرام، شمارهٔ موبایل را ارسال کنید…';
        var t0 = Date.now(), ttl = (r.expireSec || 180) * 1000;
        var iv = setInterval(function () {
          if (Date.now() - t0 > ttl) { clearInterval(iv); stat.textContent = 'مهلت تمام شد؛ دوباره تلاش کنید.'; btn.disabled = false; return; }
          api('/auth/ticket/' + r.ticket).then(function (t) {
            if (t.status === 'ready') {
              clearInterval(iv);
              setToken(t.token); S.user = t.user;
              toast('خوش آمدید ✓', 'ok');
              nav(t.user.role === 'admin' ? '#/admin' : '#/dash');
            }
          }).catch(function () { });
        }, 1500);
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; stat.textContent = ''; });
    };
  }

  function viewDash() {
    if (needLogin()) return;
    shell('dash', '<div class="spin"></div>');
    Promise.all([api('/dashboard'), api('/market').catch(function () { return null; })]).then(function (rs) {
      var d = rs[0], mk = rs[1];
      S.user = d.user;
      var cs = d.campaigns || [];
      var t = { imps: 0, views: 0, clicks: 0, spend: 0 };
      (d.series || []).forEach(function (x) { t.imps += x.imps; t.views += x.views; t.clicks += x.clicks; t.spend += x.spend; });
      var act = cs.filter(function (c) { return c.status === 'active'; }).length;
      var pend = cs.filter(function (c) { return c.status === 'pending'; }).length;
      shell('dash', '<div class="h1row"><h1>سلام ' + esc(d.user.name) + ' 👋</h1><a class="btn pri" href="#/new">➕ کمپین تازه</a></div>' +
        '<div class="kpis">' + kpi('موجودی کیف پول', money(d.user.balance), '<a href="#/wallet">شارژ</a>') + kpi('کمپین در حال نمایش', num(act), pend ? num(pend) + ' در انتظار بررسی' : '') +
        kpi('نمایش ۱۴ روز', num(t.imps), 'بازدید کامل: ' + num(t.views)) + kpi('کلیک ۱۴ روز', num(t.clicks), 'CTR ' + pct(t.clicks, t.imps)) + kpi('هزینهٔ ۱۴ روز', money(t.spend), '') + '</div>' +
        '<section class="card"><h2>عملکرد ۱۴ روز اخیر</h2>' + chart(d.series || [], [['imps', 'نمایش', '#ff7a1a'], ['views', 'بازدید کامل', '#ffb01f'], ['clicks', 'کلیک', '#3ddc84']]) + '</section>' +
        '<section class="card"><div class="h2row"><h2>کمپین‌های شما</h2><a href="#/campaigns">همه ←</a></div>' + campList(cs.slice(0, 6)) + '</section>' +
        (mk ? '<section class="card"><div class="h2row"><h2>نبض بازار (همهٔ تبلیغ‌دهنده‌ها)</h2><a href="#/market">جزئیات ←</a></div>' + marketMini(mk) + '</section>' : '') +
        (d.user.tg ? '' : '<section class="card note">🔔 تلگرام خود را از <a href="#/account">حساب کاربری</a> وصل کنید تا نتیجهٔ بررسی کمپین و پرداخت‌ها را فوری بگیرید.</section>'));
    }).catch(function (e) { shell('dash', '<div class="card err">' + esc(e.message) + '</div>'); });
  }
  function marketMini(mk) {
    var t = { imps: 0, clicks: 0, views: 0, opps: 0 };
    (mk.days || []).slice(-7).forEach(function (d) { t.imps += d.imps; t.clicks += d.clicks; t.views += d.views; t.opps += d.opps; });
    return '<div class="kpis">' + kpi('فرصت نمایش روزانه', num(Math.round(t.opps / 7)), 'میانگین ۷ روز') + kpi('نمایش روزانه', num(Math.round(t.imps / 7)), '') + kpi('CTR شبکه', pct(t.clicks, t.imps), '') +
      kpi('کمپین فعال', num((mk.active.video || 0) + (mk.active.banner || 0) + (mk.active.link || 0)), 'ویدئو ' + num(mk.active.video || 0) + ' · بنر ' + num(mk.active.banner || 0) + ' · لینک ' + num(mk.active.link || 0)) + '</div>';
  }
  function campList(cs) {
    if (!cs.length) return '<div class="empty">هنوز کمپینی نساخته‌اید. <a href="#/new">اولین کمپین را بسازید</a></div>';
    return '<div class="clist">' + cs.map(function (c) {
      var p = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : 0;
      return '<a class="citem" href="#/c/' + c.id + '"><div class="ct"><b>' + esc(c.name) + '</b>' + badge(c.status) + '<span class="bdg">' + fmtTitle(c.format) + '</span></div>' +
        '<div class="cm"><span>نمایش ' + num(c.imps) + '</span>' + (c.format === 'video' ? '<span>بازدید کامل ' + num(c.views) + '</span>' : '') + '<span>کلیک ' + num(c.clicks) + '</span><span>CTR ' + pct(c.clicks, c.imps) + '</span></div>' +
        '<div class="bar"><i style="width:' + p.toFixed(1) + '%"></i></div><div class="cm mut"><span>' + money(c.spent) + ' از ' + money(c.budget) + '</span>' + (c.status === 'rejected' && c.reason ? '<span class="bad">دلیل رد: ' + esc(c.reason) + '</span>' : '') + '</div></a>';
    }).join('') + '</div>';
  }
  function viewCampaigns() {
    if (needLogin()) return;
    shell('campaigns', '<div class="spin"></div>');
    api('/campaigns').then(function (d) {
      shell('campaigns', '<div class="h1row"><h1>کمپین‌ها</h1><a class="btn pri" href="#/new">➕ کمپین تازه</a></div><section class="card">' + campList(d.campaigns || []) + '</section>');
    }).catch(function (e) { shell('campaigns', '<div class="card err">' + esc(e.message) + '</div>'); });
  }

  /* ── ساخت/ویرایش کمپین ── */
  function viewEdit(id) {
    if (needLogin()) return;
    var load = id ? api('/campaigns/' + id).then(function (d) { return d.campaign; }) : Promise.resolve(null);
    shell(id ? 'campaigns' : 'new', '<div class="spin"></div>');
    load.then(function (c) { editForm(c); }).catch(function (e) { shell('campaigns', '<div class="card err">' + esc(e.message) + '</div>'); });
  }
  function editForm(c) {
    var cfg = S.cfg;
    var st = {
      id: c ? c.id : '', format: c ? c.format : 'video', name: c ? c.name : '', slots: c ? c.slots.slice() : [], creative: c ? JSON.parse(JSON.stringify(c.creative || {})) : {},
      urls: c ? (c.creativeUrls || {}) : {}, target: c ? c.target : { types: [], genres: [], dev: [] }, bid: c ? c.bid : 1, budget: c ? c.budget : cfg.minBudget,
      dailyCap: c ? c.dailyCap : 0, freqCap: c ? c.freqCap : 3, startAt: c ? c.startAt : 0, endAt: c ? c.endAt : 0, status: c ? c.status : 'draft', spent: c ? c.spent : 0,
    };
    if (!st.slots.length) st.slots = cfg.formatSlots[st.format].slice();
    var locked = c && c.status !== 'draft' && c.status !== 'rejected';
    function dt(ms) { if (!ms) return ''; var d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
    function fmtCard(f, ic, t, d) {
      return '<label class="fmt' + (st.format === f ? ' on' : '') + (locked ? ' dis' : '') + '"><input type="radio" name="fmt" value="' + f + '"' + (st.format === f ? ' checked' : '') + (locked ? ' disabled' : '') + '><span class="ic">' + ic + '</span><b>' + t + '</b><small>' + d + '</small><em>' + unitText(f) + '</em></label>';
    }
    function mediaBox(key, label, kind, hint) {
      var url = st.urls[key] || (/^https:/.test(st.creative[key] || '') ? st.creative[key] : '');
      var prev = url ? (kind === 'video' ? '<video src="' + esc(url) + '" controls playsinline muted></video>' : '<img src="' + esc(url) + '" alt="">') : '<div class="ph">' + (kind === 'video' ? '🎬' : '🖼') + '</div>';
      return '<div class="media" data-key="' + key + '" data-kind="' + kind + '"><div class="pv">' + prev + '</div><div class="mi"><b>' + label + '</b><small>' + hint + '</small>' +
        '<input type="file" accept="' + (kind === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif') + '"><div class="prog"><i></i></div>' +
        (cfg.allowExternalMedia ? '<input class="ext" dir="ltr" placeholder="یا لینک مستقیم https" value="' + esc(/^https:/.test(st.creative[key] || '') ? st.creative[key] : '') + '">' : '') +
        (st.creative[key] ? '<button type="button" class="btn sm ghost rm">حذف فایل</button>' : '') + '</div></div>';
    }
    function creativeHtml() {
      var cr = st.creative;
      if (st.format === 'video') return mediaBox('video', 'ویدئوی افقی ۱۶:۹ (برای پلیر)', 'video', 'MP4 · حداکثر ' + fa(cfg.maxVideoSec) + ' ثانیه و ' + fa(cfg.maxVideoMB) + ' مگابایت · ۱۲۸۰×۷۲۰ یا ۱۹۲۰×۱۰۸۰') +
        mediaBox('videoP', 'ویدئوی عمودی ۹:۱۶ (اختیاری؛ قبل از دانلود)', 'video', '۱۰۸۰×۱۹۲۰ — اگر نگذارید همان افقی نمایش داده می‌شود') +
        mediaBox('poster', 'تصویر پوستر (اختیاری)', 'image', 'تا بارگذاری ویدئو نمایش داده می‌شود') +
        '<label>متن دکمهٔ روی تبلیغ<input id="e-cta" maxlength="24" value="' + esc(cr.cta || '') + '" placeholder="مشاهده"></label>' +
        '<label>لینک مقصد (اختیاری)<input id="e-landing" dir="ltr" value="' + esc(cr.landing || '') + '" placeholder="https://example.com"></label>';
      if (st.format === 'banner') return mediaBox('wide', 'بنر پهن ۷۲۸×۹۰ (روی پلیر)', 'image', 'JPG/PNG/WebP/GIF · حداکثر ' + fa(cfg.maxImageKB) + ' کیلوبایت · نسخهٔ ۱۴۵۶×۱۸۰ تیزتر است') +
        mediaBox('rect', 'بنر مستطیل ۳۰۰×۲۵۰ (هنگام توقف)', 'image', 'نسخهٔ ۶۰۰×۵۰۰ تیزتر است') +
        mediaBox('tall', 'بنر عمودی ۱۰۸۰×۱۹۲۰ (قبل از دانلود)', 'image', 'متن و لوگو را وسط کادر بگذارید') +
        '<label>لینک مقصد (لازم)<input id="e-landing" dir="ltr" value="' + esc(cr.landing || '') + '" placeholder="https://example.com"></label>' +
        '<label>مدت نمایش/ثانیه‌شمار (ثانیه)<input id="e-bsec" type="number" min="3" max="30" value="' + esc(cr.sec || '') + '" placeholder="پیش‌فرض ' + fa(cfg.bannerSec || 8) + '"><small>در «قبل از دانلود»، ثانیه‌شمار به همین اندازه است؛ خالی = پیش‌فرض پلتفرم (سایت‌ها حداکثر ۲۰ ثانیه)</small></label>';
      var l = cr.link || {};
      return '<label>متن دکمه (۳ تا ۳۲ نویسه)<input id="e-ltext" maxlength="32" value="' + esc(l.text || '') + '" placeholder="🎁 تخفیف ویژهٔ امروز"></label>' +
        '<label>لینک (https یا https://t.me/…)<input id="e-lurl" dir="ltr" value="' + esc(l.url || '') + '" placeholder="https://t.me/yourchannel"><small>' + (cfg.linkViaSite !== false ? 'لینک شما (تلگرامی یا معمولی) از مسیر سایت باز می‌شود تا کلیک دقیق ثبت شود' : 'لینک شما مستقیم باز می‌شود (بدون عبور از سایت) و کلیکی شمرده نمی‌شود — فقط نمایش ثبت می‌شود') + '. زیر هر فایل حداکثر ۳ لینک تبلیغی می‌آید و نمایش‌ها بین کمپین‌ها می‌چرخد (با وزن پیشنهاد).</small></label>' +
        '<div class="tgprev"><div class="bub"><b>🎬 نام فیلم.1080p.mkv</b><small>فایل ارسالی ربات</small></div><div class="tbtn" id="e-lprev">' + esc(l.text || 'متن دکمهٔ شما') + '</div></div>';
    }
    function slotsHtml() {
      return cfg.formatSlots[st.format].map(function (s) {
        var on = st.slots.indexOf(s) >= 0;
        return '<label class="slot' + (on ? ' on' : '') + '"><input type="checkbox" value="' + s + '"' + (on ? ' checked' : '') + '><b>' + esc(cfg.slots[s].title) + '</b><small>' + esc(cfg.slots[s].desc) + '</small></label>';
      }).join('');
    }
    function chips(list, name, opts) {
      return opts.map(function (o) { var on = list.indexOf(o[0]) >= 0; return '<label class="chipx' + (on ? ' on' : '') + '"><input type="checkbox" name="' + name + '" value="' + esc(o[0]) + '"' + (on ? ' checked' : '') + '>' + esc(o[1]) + '</label>'; }).join('');
    }
    function estimate() {
      var t = cfg.tariffs[st.format] || {}, b = Number(st.budget) || 0, bid = Number(st.bid) || 1;
      if (st.format === 'video' && t.cpv) return 'حدود <b>' + num(Math.floor(b / (t.cpv * bid))) + '</b> بازدید کامل';
      if (t.cpm) return 'حدود <b>' + num(Math.floor(b / (t.cpm * bid) * 1000)) + '</b> نمایش';
      if (t.cpc) return 'حدود <b>' + num(Math.floor(b / (t.cpc * bid))) + '</b> کلیک';
      return '';
    }
    var genres = (S.genres || []).slice(0, 60);
    shell(st.id ? 'campaigns' : 'new', '<div class="h1row"><h1>' + (st.id ? 'ویرایش کمپین' : 'کمپین تازه') + '</h1>' + (st.id ? badge(st.status) : '') + '</div>' +
      (locked ? '<div class="card note">این کمپین ' + (STATUS[st.status] || [''])[0] + ' است. هر تغییر در فایل، متن، لینک، جایگاه یا مخاطب، آن را دوباره به صف بررسی مدیر می‌برد (نمایش تا تأیید متوقف می‌شود). تغییر بودجه فوری اعمال می‌شود.</div>' : '') +
      '<section class="card"><h2>۱. نوع تبلیغ</h2><div class="fmts">' +
      fmtCard('video', '🎬', 'ویدئویی', 'پیش از دانلود و داخل پلیر') + fmtCard('banner', '🖼', 'بنری', 'روی پلیر، توقف، پیش از دانلود') + fmtCard('link', '🔗', 'لینکی', 'دکمهٔ زیر فایل‌های ربات') + '</div>' +
      '<label>نام کمپین (فقط برای شما)<input id="e-name" maxlength="80" value="' + esc(st.name) + '" placeholder="مثلاً: معرفی محصول جدید — آبان"></label></section>' +
      '<section class="card"><h2>۲. محتوای تبلیغ</h2><div id="e-cr">' + creativeHtml() + '</div></section>' +
      '<section class="card"><h2>۳. جایگاه‌های نمایش</h2><div class="slots" id="e-slots">' + slotsHtml() + '</div></section>' +
      '<section class="card"><h2>۴. مخاطب (اختیاری)</h2><div class="row2"><div><h4>نوع محتوا</h4><div class="chips">' + chips(st.target.types || [], 'types', [['movie', 'فیلم'], ['series', 'سریال']]) + '</div></div>' +
      '<div><h4>دستگاه</h4><div class="chips">' + chips(st.target.dev || [], 'dev', [['m', 'موبایل'], ['d', 'کامپیوتر']]) + '</div></div></div>' +
      (genres.length ? '<h4>ژانر (هیچ = همه)</h4><div class="chips">' + chips(st.target.genres || [], 'genres', genres.map(function (g) { return [g, g]; })) + '</div>' : '') +
      '<label>سقف تکرار برای هر کاربر در روز (۰ = بدون سقف)<input id="e-freq" type="number" min="0" max="20" value="' + esc(st.freqCap) + '"></label></section>' +
      '<section class="card"><h2>۵. بودجه، اولویت و زمان</h2><div class="row2">' +
      '<label>بودجهٔ کل (تومان)<input id="e-budget" type="number" min="' + cfg.minBudget + '" step="10000" value="' + esc(st.budget) + '"><small>حداقل ' + money(cfg.minBudget) + ' · مصرف‌شده: ' + money(st.spent) + '</small></label>' +
      '<label>سقف هزینهٔ روزانه (اختیاری)<input id="e-daily" type="number" min="0" step="10000" value="' + esc(st.dailyCap || '') + '" placeholder="بدون سقف"><small>برای پخش یکنواخت بودجه در چند روز</small></label></div>' +
      '<label>ضریب پیشنهاد (اولویت نمایش): <b id="e-bidv">' + fa(Number(st.bid).toFixed(1)) + '×</b><input id="e-bid" type="range" min="1" max="' + cfg.maxBid + '" step="0.1" value="' + esc(st.bid) + '"><small>تعرفهٔ پایه × ضریب = هزینهٔ هر واحد. ضریب بالاتر سهم بیشتری از نمایش‌ها می‌گیرد.</small></label>' +
      '<div class="est" id="e-est">' + estimate() + '</div>' +
      '<div class="row2"><label>شروع (اختیاری)<input id="e-start" type="datetime-local" value="' + dt(st.startAt) + '"></label><label>پایان (اختیاری)<input id="e-end" type="datetime-local" value="' + dt(st.endAt) + '"></label></div></section>' +
      '<div class="actions">' + (!locked ? '<button class="btn" id="e-save">💾 ذخیرهٔ پیش‌نویس</button><button class="btn pri" id="e-submit">🚀 ارسال برای بررسی</button>' : '<button class="btn pri" id="e-save">💾 ذخیرهٔ تغییرات</button>') + '</div>');
    function collect() {
      var cr = {};
      ['video', 'videoP', 'poster', 'wide', 'rect', 'tall'].forEach(function (k) { if (st.creative[k]) cr[k] = st.creative[k]; });
      var g = function (id) { var el = $('#' + id); return el ? el.value.trim() : ''; };
      cr.cta = g('e-cta'); cr.landing = g('e-landing');
      if (st.format === 'link') cr.link = { text: g('e-ltext'), url: g('e-lurl') };
      if (st.creative.dur) cr.dur = st.creative.dur;
      if (st.format === 'banner') { var bs = parseInt(g('e-bsec'), 10); if (bs > 0) cr.sec = Math.max(3, Math.min(30, bs)); }
      var val = function (name) { return $$('input[name="' + name + '"]:checked').map(function (x) { return x.value; }); };
      var ts = function (id) { var v = g(id); return v ? new Date(v).getTime() : 0; };
      return { format: st.format, name: g('e-name'), slots: $$('#e-slots input:checked').map(function (x) { return x.value; }), creative: cr,
        target: { types: val('types'), dev: val('dev'), genres: val('genres') }, freqCap: g('e-freq'), budget: g('e-budget'), dailyCap: g('e-daily') || 0, bid: g('e-bid'), startAt: ts('e-start'), endAt: ts('e-end') };
    }
    function bind() {
      $$('input[name="fmt"]').forEach(function (r) {
        r.onchange = function () {
          st.format = r.value; st.slots = cfg.formatSlots[st.format].slice(); st.creative = {}; st.urls = {};
          $$('.fmt').forEach(function (x) { x.classList.toggle('on', x.querySelector('input').value === st.format); });
          $('#e-cr').innerHTML = creativeHtml(); $('#e-slots').innerHTML = slotsHtml(); bindMedia(); bindSlots(); $('#e-est').innerHTML = estimate();
        };
      });
      $$('.chipx input').forEach(function (x) { x.onchange = function () { x.parentNode.classList.toggle('on', x.checked); }; });
      bindSlots();
      var bid = $('#e-bid');
      bid.oninput = function () { st.bid = Number(bid.value); $('#e-bidv').textContent = fa(Number(bid.value).toFixed(1)) + '×'; $('#e-est').innerHTML = estimate(); };
      $('#e-budget').oninput = function () { st.budget = Number($('#e-budget').value) || 0; $('#e-est').innerHTML = estimate(); };
      bindMedia();
      var save = function (submit) {
        var b = collect();
        b.submit = !!submit;
        var go = function () {
          $$('.actions .btn').forEach(function (x) { x.disabled = true; });
          api('/campaigns' + (st.id ? '/' + st.id : ''), { body: b }).then(function (r) {
            toast(r.submitted ? 'کمپین برای بررسی ارسال شد ✓' : (r.recheck ? 'ذخیره شد؛ کمپین دوباره در صف بررسی است' : 'ذخیره شد ✓'), 'ok');
            nav('#/c/' + r.id);
          }).catch(function (e) {
            $$('.actions .btn').forEach(function (x) { x.disabled = false; });
            if (e.data && e.data.needWallet) { modal('موجودی کافی نیست', '<p>برای ارسال این کمپین ' + money(e.data.need) + ' لازم است. کمپین به‌صورت پیش‌نویس ذخیره شد؛ پس از شارژ، از صفحهٔ کمپین «ارسال برای بررسی» را بزنید.</p><a class="btn pri block" href="#/wallet">شارژ کیف پول</a>'); if (!st.id && e.data.id) st.id = e.data.id; return; }
            toast(e.message, 'err');
          });
        };
        if (submit) modal('ارسال برای بررسی', '<p>با ارسال، <b>' + money(Math.max(0, Number(b.budget) - st.spent)) + '</b> از کیف پول برای این کمپین کنار گذاشته می‌شود. اگر رد شود یا کمپین را متوقف کنید، باقی‌مانده فوراً برمی‌گردد.</p><p class="mut">موجودی فعلی: ' + money(S.user.balance) + '</p><button class="btn pri block" id="m-ok">تأیید و ارسال</button>', function (m, close) { $('#m-ok', m).onclick = function () { close(); go(); }; });
        else go();
      };
      var sv = $('#e-save'); if (sv) sv.onclick = function () { save(false); };
      var sb = $('#e-submit'); if (sb) sb.onclick = function () { save(true); };
    }
    function bindSlots() {
      $$('#e-slots input').forEach(function (x) { x.onchange = function () { x.parentNode.classList.toggle('on', x.checked); }; });
    }
    function bindMedia() {
      var lt = $('#e-ltext');
      if (lt) lt.oninput = function () { $('#e-lprev').textContent = lt.value || 'متن دکمهٔ شما'; };
      $$('.media').forEach(function (box) {
        var key = box.getAttribute('data-key'), kind = box.getAttribute('data-kind');
        var inp = $('input[type=file]', box), bar = $('.prog i', box), ext = $('.ext', box), rm = $('.rm', box);
        inp.onchange = function () {
          var f = inp.files && inp.files[0];
          if (!f) return;
          probe(f, kind).then(function (meta) {
            if (kind === 'video' && meta.dur && meta.dur > cfg.maxVideoSec + 0.5) { toast('مدت ویدئو بیش از ' + fa(cfg.maxVideoSec) + ' ثانیه است', 'err'); return; }
            box.classList.add('up');
            return upload(f, kind, meta, function (p) { bar.style.width = Math.round(p * 100) + '%'; }).then(function (m) {
              st.creative[key] = m.url.split('/').pop();
              st.urls[key] = m.url;
              if (kind === 'video' && meta.dur) st.creative.dur = Math.max(st.creative.dur || 0, meta.dur);
              $('.pv', box).innerHTML = kind === 'video' ? '<video src="' + esc(m.url) + '" controls playsinline muted></video>' : '<img src="' + esc(m.url) + '" alt="">';
              toast('فایل بارگذاری شد ✓ (' + (meta.w ? fa(meta.w + '×' + meta.h) : '') + (meta.dur ? ' · ' + fa(meta.dur) + ' ثانیه' : '') + ')', 'ok');
            });
          }).catch(function (e) { toast(e.message, 'err'); }).then(function () { box.classList.remove('up'); bar.style.width = '0'; });
        };
        if (ext) ext.onchange = function () { var v = ext.value.trim(); if (v) { st.creative[key] = v; st.urls[key] = v; } else delete st.creative[key]; };
        if (rm) rm.onclick = function () { delete st.creative[key]; delete st.urls[key]; $('#e-cr').innerHTML = creativeHtml(); bindMedia(); };
      });
    }
    bind();
  }

  /* ── جزئیات و آمار کمپین ── */
  function viewCampaign(id) {
    if (needLogin()) return;
    shell('campaigns', '<div class="spin"></div>');
    api('/campaigns/' + id + '/stats?days=30').then(function (d) {
      var c = d.campaign, t = d.total;
      var p = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : 0;
      var acts = [];
      if (c.status === 'draft') acts.push('<button class="btn pri" data-act="submit">🚀 ارسال برای بررسی</button>');
      if (c.status === 'active') acts.push('<button class="btn" data-act="pause">⏸ توقف موقت</button>');
      if (c.status === 'paused') acts.push('<button class="btn pri" data-act="resume">▶ ادامه</button>');
      if (['active', 'paused', 'pending'].indexOf(c.status) >= 0) acts.push('<button class="btn bad" data-act="stop">⏹ پایان و بازگشت باقی‌مانده</button>');
      if (['ended', 'completed'].indexOf(c.status) < 0) acts.push('<a class="btn" href="#/edit/' + c.id + '">✏️ ویرایش / افزایش بودجه</a>');
      if (c.status === 'draft' || c.status === 'rejected') acts.push('<button class="btn ghost" data-act="delete">🗑 حذف</button>');
      var slotRows = (d.slots || []).map(function (s) { return '<tr><td>' + esc(slotTitle(s.slot)) + '</td><td>' + num(s.imps) + '</td><td>' + (c.format === 'video' ? num(s.views) + ' (' + pct(s.views, s.imps) + ')' : '—') + '</td><td>' + num(s.clicks) + '</td><td>' + pct(s.clicks, s.imps) + '</td><td>' + money(s.spend) + '</td></tr>'; }).join('');
      var dayRows = (d.days || []).slice().reverse().filter(function (x) { return x.imps || x.clicks || x.spend; }).map(function (x) { return '<tr><td>' + dayLabel(x.day) + '</td><td>' + num(x.imps) + '</td><td>' + num(x.views) + '</td><td>' + num(x.skips) + '</td><td>' + num(x.clicks) + '</td><td>' + pct(x.clicks, x.imps) + '</td><td>' + money(x.spend) + '</td></tr>'; }).join('');
      var hours = (d.hours || []).map(function (v, i) { return { day: '', v: v, h: i }; });
      shell('campaigns', '<div class="h1row"><h1>' + esc(c.name) + '</h1>' + badge(c.status) + '<span class="bdg">' + fmtTitle(c.format) + '</span></div>' +
        (c.status === 'rejected' ? '<div class="card err">❌ دلیل رد: ' + esc(c.reason) + '<br><small>کمپین را ویرایش و دوباره ارسال کنید.</small></div>' : '') +
        (c.status === 'pending' ? '<div class="card note">⏳ کمپین در صف بررسی مدیر است. بعد از تأیید، نمایش خودکار شروع می‌شود.</div>' : '') +
        '<div class="acts">' + acts.join('') + '<button class="btn ghost" id="c-csv">⬇ خروجی CSV</button></div>' +
        '<div class="kpis">' + kpi('نمایش', num(t.imps), 'موبایل ' + pct(t.mob, t.mob + t.desk)) + (c.format === 'video' ? kpi('بازدید کامل', num(t.views), 'نرخ ' + pct(t.views, t.imps) + ' · رد ' + num(t.skips)) : '') +
        kpi('کلیک', num(t.clicks), 'CTR ' + pct(t.clicks, t.imps)) + (c.format === 'video' ? kpi('میانگین تماشا', fa(t.imps ? (t.watch / t.imps).toFixed(1) : 0) + ' ثانیه', '') : '') +
        kpi('هزینه', money(c.spent), 'از ' + money(c.budget)) + '</div>' +
        '<div class="card"><div class="bar big"><i style="width:' + p.toFixed(1) + '%"></i></div><div class="cm mut"><span>مصرف بودجه ' + fa(p.toFixed(1)) + '٪</span><span>باقی‌مانده ' + money(Math.max(0, c.budget - c.spent)) + '</span>' + (c.dailyCap ? '<span>سقف روزانه ' + money(c.dailyCap) + '</span>' : '') + '<span>ضریب ' + fa(c.bid) + '×</span></div></div>' +
        '<section class="card"><h2>۳۰ روز اخیر</h2>' + chart(d.days || [], c.format === 'video' ? [['imps', 'نمایش', '#ff7a1a'], ['views', 'بازدید کامل', '#ffb01f'], ['clicks', 'کلیک', '#3ddc84']] : [['imps', 'نمایش', '#ff7a1a'], ['clicks', 'کلیک', '#3ddc84']]) + '</section>' +
        '<div class="row2"><section class="card"><h2>امروز به تفکیک ساعت (تهران)</h2>' + chart(hours, [['v', 'نمایش', '#ff7a1a']], { h: 120, labels: hours.map(function (x) { return fa(x.h); }) }) + '</section>' +
        '<section class="card"><h2>مخاطبان</h2>' + kpi('موبایل / کامپیوتر', pct(t.mob, t.mob + t.desk) + ' / ' + pct(t.desk, t.mob + t.desk), '') + kpi('فیلم / سریال', pct(t.movie, t.movie + t.series) + ' / ' + pct(t.series, t.movie + t.series), '') + '</section></div>' +
        '<section class="card"><h2>به تفکیک جایگاه</h2><div class="tbl"><table><thead><tr><th>جایگاه</th><th>نمایش</th><th>بازدید کامل</th><th>کلیک</th><th>CTR</th><th>هزینه</th></tr></thead><tbody>' + (slotRows || '<tr><td colspan="6" class="mut">هنوز آماری ثبت نشده</td></tr>') + '</tbody></table></div></section>' +
        '<section class="card"><h2>روزانه</h2><div class="tbl"><table><thead><tr><th>روز</th><th>نمایش</th><th>بازدید کامل</th><th>رد کردن</th><th>کلیک</th><th>CTR</th><th>هزینه</th></tr></thead><tbody>' + (dayRows || '<tr><td colspan="7" class="mut">هنوز آماری ثبت نشده</td></tr>') + '</tbody></table></div></section>' +
        '<section class="card"><h2>محتوای تبلیغ</h2>' + creativePreview(c) + '<p class="mut">جایگاه‌ها: ' + c.slots.map(slotTitle).join('، ') + ' · ساخت: ' + date(c.createdAt) + (c.reviewedAt ? ' · بررسی: ' + date(c.reviewedAt) : '') + '</p></section>');
      $$('[data-act]').forEach(function (b) {
        b.onclick = function () {
          var a = b.getAttribute('data-act');
          var conf = { stop: 'کمپین پایان یابد و باقی‌ماندهٔ بودجه به کیف پول برگردد؟', delete: 'این کمپین حذف شود؟' }[a];
          if (conf && !confirm(conf)) return;
          b.disabled = true;
          api('/campaigns/' + c.id + '/' + a, { method: 'POST' }).then(function (r) {
            toast(r.refunded ? money(r.refunded) + ' به کیف پول برگشت ✓' : 'انجام شد ✓', 'ok');
            if (a === 'delete') nav('#/campaigns'); else viewCampaign(c.id);
          }).catch(function (e) { b.disabled = false; if (e.data && e.data.needWallet) { toast(e.message, 'err'); nav('#/wallet'); } else toast(e.message, 'err'); });
        };
      });
      $('#c-csv').onclick = function () {
        var rows = [['day', 'impressions', 'complete_views', 'skips', 'clicks', 'spend_toman']].concat((d.days || []).map(function (x) { return [x.day, x.imps, x.views, x.skips, x.clicks, Math.round(x.spend)]; }));
        var blob = new Blob([rows.map(function (r) { return r.join(','); }).join('\n')], { type: 'text/csv' });
        var a = D.createElement('a'); a.href = URL.createObjectURL(blob); a.download = c.id + '-stats.csv'; a.click();
      };
    }).catch(function (e) { shell('campaigns', '<div class="card err">' + esc(e.message) + '</div>'); });
  }
  function creativePreview(c) {
    var u = c.creativeUrls || {}, cr = c.creative || {};
    if (c.format === 'video') return '<div class="prevs">' + (u.video ? '<div><small>افقی</small><video src="' + esc(u.video) + '" controls playsinline' + (u.poster ? ' poster="' + esc(u.poster) + '"' : '') + '></video></div>' : '') + (u.videoP ? '<div><small>عمودی</small><video class="tall" src="' + esc(u.videoP) + '" controls playsinline></video></div>' : '') + '</div>' + (cr.landing ? '<p>مقصد: <a href="' + esc(cr.landing) + '" target="_blank" rel="noopener" dir="ltr">' + esc(cr.landing) + '</a> · دکمه: «' + esc(cr.cta || 'مشاهده') + '»</p>' : '');
    if (c.format === 'banner') return '<div class="prevs">' + ['wide', 'rect', 'tall'].map(function (k) { return u[k] ? '<div><small>' + ({ wide: 'پهن', rect: 'مستطیل', tall: 'عمودی' })[k] + '</small><img src="' + esc(u[k]) + '" alt=""></div>' : ''; }).join('') + '</div><p>مقصد: <a href="' + esc(cr.landing || '') + '" target="_blank" rel="noopener" dir="ltr">' + esc(cr.landing || '') + '</a></p>';
    var l = cr.link || {};
    return '<div class="tgprev"><div class="bub"><b>🎬 نام فیلم.1080p.mkv</b><small>فایل ارسالی ربات</small></div><div class="tbtn">' + esc(l.text || '') + '</div></div><p>لینک: <a href="' + esc(l.url || '') + '" target="_blank" rel="noopener" dir="ltr">' + esc(l.url || '') + '</a></p>';
  }

  /* ── کیف پول: استارز و کارت‌به‌کارت هوشمند ── */
  function viewWallet() {
    if (needLogin()) return;
    shell('wallet', '<div class="spin"></div>');
    Promise.all([api('/wallet'), api('/me')]).then(function (rs) {
      var w = rs[0]; S.user = rs[1].user;
      var c = S.cfg;
      var stars = c.stars.enabled ? '<section class="card"><h2>⭐ شارژ با استارز تلگرام</h2><p class="mut">فاکتور رسمی تلگرام باز می‌شود؛ بعد از پرداخت، اعتبار فوری اضافه می‌شود.</p><div class="packs">' +
        c.stars.packs.map(function (p, i) { return '<button class="pack" data-star="' + i + '"><b>' + money(p.toman) + '</b><span>' + fa(p.stars) + ' استارز</span></button>'; }).join('') + '</div></section>' : '';
      var k2k = c.k2k.enabled ? '<section class="card"><h2>💳 کارت‌به‌کارت هوشمند</h2><p class="mut">برای هر فاکتور یک مبلغ یکتا ساخته می‌شود؛ دقیقاً همان را واریز و «واریز کردم» را بزنید تا مدیر تأیید کند.</p><div class="packs">' +
        (c.k2k.presets || []).map(function (p) { return '<button class="pack" data-k2k="' + p + '"><b>' + money(p) + '</b><span>کارت‌به‌کارت</span></button>'; }).join('') +
        '</div><div class="row2"><label>مبلغ دلخواه (تومان)<input id="w-amt" type="number" min="' + c.k2k.min + '" max="' + c.k2k.max + '" step="1000" placeholder="' + num(c.k2k.min) + ' تا ' + num(c.k2k.max) + '"></label><button class="btn pri" id="w-k2k" style="align-self:end">صدور فاکتور</button></div></section>' : '';
      var txs = (w.txs || []).map(function (t) { return '<tr><td>' + dtime(t.created_at) + '</td><td>' + esc(t.note || t.type) + '</td><td class="' + (t.amount > 0 ? 'ok' : 'bad') + '">' + (t.amount > 0 ? '+' : '') + num(t.amount) + '</td><td>' + num(t.balance) + '</td></tr>'; }).join('');
      var invs = (w.invoices || []).map(function (i) { return '<tr><td>' + dtime(i.createdAt) + '</td><td>' + (i.kind === 'stars' ? '⭐ ' + fa(i.stars) + ' استارز' : '💳 کارت‌به‌کارت') + '</td><td>' + money(i.total) + '</td><td>' + ({ pending: 'در انتظار پرداخت', submitted: 'منتظر تأیید مدیر', paid: '✅ پرداخت شد', rejected: '❌ رد شد', expired: 'منقضی', cancelled: 'لغو' }[i.status] || i.status) + (i.status === 'pending' && i.kind === 'k2k' ? ' <button class="btn sm" data-open="' + i.id + '">ادامه</button>' : '') + '</td></tr>'; }).join('');
      shell('wallet', '<h1>کیف پول</h1><div class="wal"><span>موجودی قابل استفاده</span><b>' + money(w.balance) + '</b><small>بودجهٔ کمپین‌های در حال اجرا جداگانه کنار گذاشته شده است.</small></div>' +
        (stars || k2k ? stars + k2k : '<div class="card note">روش پرداختی هنوز فعال نشده است؛ با پشتیبانی تماس بگیرید.</div>') +
        '<section class="card"><h2>فاکتورها</h2><div class="tbl"><table><thead><tr><th>زمان</th><th>روش</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>' + (invs || '<tr><td colspan="4" class="mut">فاکتوری نیست</td></tr>') + '</tbody></table></div></section>' +
        '<section class="card"><h2>تراکنش‌ها</h2><div class="tbl"><table><thead><tr><th>زمان</th><th>شرح</th><th>مبلغ (تومان)</th><th>مانده</th></tr></thead><tbody>' + (txs || '<tr><td colspan="4" class="mut">تراکنشی نیست</td></tr>') + '</tbody></table></div></section>');
      $$('[data-star]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          api('/wallet/stars', { body: { pack: Number(b.getAttribute('data-star')) } }).then(function (r) {
            W.open(r.link, '_blank');
            toast('فاکتور تلگرام باز شد؛ بعد از پرداخت این صفحه را تازه کنید.', 'ok');
          }).catch(function (e) { toast(e.message, 'err'); }).then(function () { b.disabled = false; });
        };
      });
      var startK2k = function (amount) { api('/wallet/k2k', { body: { amount: amount } }).then(function (r) { k2kModal(r.invoice); }).catch(function (e) { toast(e.message, 'err'); }); };
      $$('[data-k2k]').forEach(function (b) { b.onclick = function () { startK2k(Number(b.getAttribute('data-k2k'))); }; });
      var kb = $('#w-k2k'); if (kb) kb.onclick = function () { startK2k(Number($('#w-amt').value)); };
      $$('[data-open]').forEach(function (b) { b.onclick = function () { api('/wallet/k2k/' + b.getAttribute('data-open')).then(function (r) { k2kModal(r.invoice); }); }; });
    }).catch(function (e) { shell('wallet', '<div class="card err">' + esc(e.message) + '</div>'); });
  }
  function k2kModal(inv) {
    clearInterval(S.k2kTimer);
    var card = String(inv.card || ''), groups = card.match(/.{1,4}/g) || [];
    var close = modal('پرداخت کارت‌به‌کارت', '<div class="k2k"><div class="vcard"><span>' + esc(inv.bank || '') + '</span><b dir="ltr">' + fa(groups.join(' ')) + '</b><small>' + esc(inv.holder || '') + '</small></div>' +
      '<div class="amt"><span>مبلغ دقیق این فاکتور</span><b>' + num(inv.total) + '</b><small>تومان — شامل ' + num(inv.extra) + ' تومان کد یکتا</small></div>' +
      '<p class="warn">دقیقاً همین مبلغ را واریز کنید؛ حتی یک تومان اختلاف، تطبیق را ناممکن می‌کند.</p>' +
      '<div class="row2"><button class="btn" id="k-cc">کپی شماره کارت</button><button class="btn" id="k-ca">کپی مبلغ</button></div>' +
      '<div class="st" id="k-st"></div><button class="btn pri block" id="k-done">واریز را انجام دادم</button></div>', function (m) {
      $('#k-cc', m).onclick = function () { copy(card, 'شماره کارت'); };
      $('#k-ca', m).onclick = function () { copy(String(inv.total), 'مبلغ'); };
      var paint = function (i) {
        var s = $('#k-st', m); if (!s) return;
        var left = Math.max(0, (i.expiresAt || 0) - Date.now());
        var mins = Math.floor(left / 60000), secs = Math.floor(left / 1000) % 60;
        s.innerHTML = i.status === 'pending' ? '⏳ مهلت: ' + fa((mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs) : i.status === 'submitted' ? '🕒 اعلام شد؛ منتظر تأیید مدیر…' : i.status === 'paid' ? '✅ تأیید شد و به کیف پول اضافه شد' : '❌ ' + ({ rejected: 'رد شد: ' + (i.reason || ''), expired: 'مهلت تمام شد', cancelled: 'لغو شد' }[i.status] || i.status);
        $('#k-done', m).style.display = i.status === 'pending' ? '' : 'none';
      };
      paint(inv);
      $('#k-done', m).onclick = function () {
        api('/wallet/k2k/' + inv.id + '/submit', { method: 'POST' }).then(function (r) { inv = r.invoice; paint(inv); toast('اعلام شد؛ پس از تأیید مدیر شارژ می‌شود', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
      };
      var n = 0;
      S.k2kTimer = setInterval(function () {
        if (!$('#k-st')) { clearInterval(S.k2kTimer); return; }
        paint(inv);
        if (++n % 6 === 0 && (inv.status === 'submitted' || inv.status === 'pending')) api('/wallet/k2k/' + inv.id).then(function (r) { var was = inv.status; inv = r.invoice; paint(inv); if (inv.status === 'paid' && was !== 'paid') { toast('واریز تأیید شد ✓', 'ok'); setTimeout(function () { close(); viewWallet(); }, 1500); } }).catch(function () { });
      }, 1000);
    });
  }

  /* ── بازار و تعرفه‌ها (آمار کلی برای همه) ── */
  function tariffTable() {
    var c = S.cfg;
    return '<div class="tbl"><table><thead><tr><th>نوع</th><th>تعرفهٔ پایه</th><th>جایگاه‌ها</th></tr></thead><tbody>' + ['video', 'banner', 'link'].map(function (f) {
      return '<tr><td><b>' + fmtTitle(f) + '</b></td><td>' + unitText(f) + '</td><td class="mut">' + c.formatSlots[f].map(slotTitle).join('، ') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="mut">حداقل بودجهٔ کمپین ' + money(c.minBudget) + ' · ضریب پیشنهاد ۱ تا ' + fa(c.maxBid) + '× · بازدید کامل ویدئو = ' + fa(c.viewSec) + ' ثانیه یا کل ویدئو · دکمهٔ رد کردن پس از ' + fa(c.skipAfter) + ' ثانیه</p>';
  }
  function viewMarket(pub) {
    if (!pub && needLogin()) return;
    if (pub) { shell('market-public', '<h1>تعرفه‌ها و جایگاه‌ها</h1><section class="card">' + tariffTable() + '</section><section class="card note">برای دیدن آمار کامل بازار <a href="#/login">ثبت‌نام</a> کنید یا <a href="#/login">وارد شوید</a>.</section>'); return; }
    shell('market', '<div class="spin"></div>');
    api('/market').then(function (mk) {
      var rows = (mk.slots || []).map(function (s) { return '<tr><td><b>' + esc(s.title) + '</b><br><small class="mut">' + esc(s.desc) + '</small></td><td>' + num(Math.round(s.opps7 / 7)) + '</td><td>' + num(Math.round(s.imps7 / 7)) + '</td><td>' + pct(s.imps7, s.opps7) + '</td><td>' + (s.views7 ? pct(s.views7, s.imps7) : '—') + '</td><td>' + pct(s.clicks7, s.imps7) + '</td></tr>'; }).join('');
      var f = mk.formats || {};
      shell('market', '<h1>بازار و تعرفه‌ها</h1><p class="mut">آمار کلی همهٔ تبلیغ‌دهنده‌ها (بدون اطلاعات شخصی) — به‌روزرسانی هر ۱۰ دقیقه.</p>' +
        '<section class="card"><h2>تعرفه‌ها</h2>' + tariffTable() + '</section>' + '<section class="card"><h2>۳۰ روز اخیر شبکه</h2>' + chart(mk.days || [], [['opps', 'فرصت نمایش', '#6b7689'], ['imps', 'نمایش', '#ff7a1a'], ['clicks', 'کلیک', '#3ddc84']]) + '</section>' +
        '<section class="card"><h2>جایگاه‌ها (میانگین روزانهٔ ۷ روز)</h2><div class="tbl"><table><thead><tr><th>جایگاه</th><th>فرصت نمایش</th><th>نمایش فروخته‌شده</th><th>پرشدگی</th><th>نرخ بازدید کامل</th><th>CTR</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="mut">«فرصت نمایش» یعنی دفعاتی که جایگاه برای کاربر بدون اشتراک باز شده؛ پرشدگی پایین = رقابت کمتر و نمایش ارزان‌تر.</p></section>' +
        '<section class="card"><h2>به تفکیک نوع (۳۰ روز)</h2><div class="kpis">' + ['video', 'banner', 'link'].map(function (k) { var x = f[k] || {}; return kpi(fmtTitle(k), num(x.imps || 0) + ' نمایش', 'CTR ' + pct(x.clicks || 0, x.imps || 0) + (k === 'video' ? ' · بازدید کامل ' + pct(x.views || 0, x.imps || 0) : '') + ' · eCPM ' + (x.imps ? money((x.spend / x.imps) * 1000) : '—') + ' · فعال: ' + num((mk.active || {})[k] || 0)); }).join('') + '</div>' +
        '<p class="mut">دستگاه بینندگان: موبایل ' + pct(mk.devices.mob, mk.devices.mob + mk.devices.desk) + ' · کامپیوتر ' + pct(mk.devices.desk, mk.devices.mob + mk.devices.desk) + ' · تبلیغ‌دهندگان فعال: ' + num(mk.advertisers) + '</p></section>');
    }).catch(function (e) { shell('market', '<div class="card err">' + esc(e.message) + '</div>'); });
  }
  function viewRules() {
    shell('rules', '<h1>قوانین و مشخصات فنی تبلیغات</h1><section class="card rules">' + esc((S.cfg && S.cfg.rules) || '').split('\n').map(function (l) { return l.trim() ? (/^[^\s•\d۰-۹]/.test(l) && l.length < 40 ? '<h3>' + l + '</h3>' : '<p>' + l + '</p>') : ''; }).join('') + '</section><section class="card"><h2>تعرفه‌ها</h2>' + (S.cfg ? tariffTable() : '') + '</section>');
  }
  function viewAccount() {
    if (needLogin()) return;
    var u = S.user;
    shell('account', '<h1>حساب کاربری</h1><section class="card"><label>نام / برند<input id="p-name" value="' + esc(u.name) + '"></label><label>شرکت (اختیاری)<input id="p-co" value="' + esc(u.company) + '"></label><label>موبایل<input id="p-ph" dir="ltr" value="' + esc(u.phone) + '"></label><button class="btn pri" id="p-save">ذخیره</button></section>' +
      '<section class="card"><h2>🔔 اتصال تلگرام</h2><p class="mut">' + (u.tg ? '✅ تلگرام شما متصل است.' : 'برای دریافت فوری نتیجهٔ بررسی، پرداخت و پایان بودجه، تلگرام را وصل کنید.') + '</p><button class="btn" id="p-tg">' + (u.tg ? 'اتصال دوباره' : 'اتصال تلگرام') + '</button></section>' +
            '<button class="btn bad" id="p-out">خروج از حساب</button>');
    $('#p-save').onclick = function () { api('/me', { body: { name: $('#p-name').value, company: $('#p-co').value, phone: $('#p-ph').value } }).then(function (r) { S.user = r.user; toast('ذخیره شد ✓', 'ok'); }).catch(function (e) { toast(e.message, 'err'); }); };
        $('#p-tg').onclick = function () { api('/me/tg-link', { method: 'POST' }).then(function (r) { W.open(r.link, '_blank'); }).catch(function (e) { toast(e.message, 'err'); }); };
    $('#p-out').onclick = function () { setToken(''); S.user = null; nav('#/'); };
  }

  /* ── پنل مدیر ── */
  function adminShell(tab, inner) {
    var tabs = [['admin', 'نمای کلی'], ['admin/review', 'صف بررسی'], ['admin/campaigns', 'کمپین‌ها'], ['admin/users', 'تبلیغ‌دهنده‌ها'], ['admin/payments', 'پرداخت‌ها'], ['admin/settings', 'تنظیمات']];
    shell('admin', '<div class="tabs">' + tabs.map(function (t) { return '<a href="#/' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</a>'; }).join('') + '</div>' + inner);
  }
  function viewAdmin(tab) {
    if (needLogin()) return;
    if (S.user.role !== 'admin') { shell('', '<div class="card err">دسترسی مدیریت ندارید.</div>'); return; }
    adminShell(tab, '<div class="spin"></div>');
    if (tab === 'admin') return api('/admin/overview').then(function (o) {
      adminShell(tab, (!o.netConfigured ? '<div class="card err">⚠️ کلید اتصال سایت تنظیم نشده؛ از «تنظیمات» کلید بسازید و در پنل سایت وارد کنید.</div>' : '') +
        (!o.kv ? '<div class="card note">ℹ️ فضای KV (ADS_KV) وصل نیست؛ فایل‌ها در D1 ذخیره می‌شوند (حجم دیتابیس سریع‌تر پر می‌شود).</div>' : '') +
        (!o.bot ? '<div class="card note">ℹ️ ربات تلگرام (ADS_BOT_TOKEN) تنظیم نشده؛ پرداخت استارز و اعلان‌ها غیرفعال است.</div>' : '') +
        '<div class="kpis">' + kpi('در انتظار بررسی', num(o.pending), '<a href="#/admin/review">بررسی</a>') + kpi('کمپین فعال', num(o.active), '') + kpi('کارت‌به‌کارت منتظر', num(o.k2kWaiting), '<a href="#/admin/payments">پرداخت‌ها</a>') +
        kpi('درآمد امروز', money(o.today.spend), 'نمایش ' + num(o.today.imps) + ' · کلیک ' + num(o.today.clicks)) + kpi('درآمد ۳۰ روز', money(o.spend30), '') + kpi('تبلیغ‌دهنده', num(o.users), 'موجودی کل: ' + money(o.balances)) + '</div><p class="mut">نسخه ' + esc(o.version) + '</p>');
    }).catch(adminErr(tab));
    if (tab === 'admin/review') return api('/admin/campaigns?status=pending').then(function (d) {
      var cs = d.campaigns || [];
      adminShell(tab, '<h1>صف بررسی (' + fa(cs.length) + ')</h1>' + (cs.length ? cs.map(function (c) {
        return '<section class="card rev"><div class="h2row"><h2>' + esc(c.name) + ' <span class="bdg">' + fmtTitle(c.format) + '</span></h2><span class="mut">' + esc(c.owner.name) + ' · <span dir="ltr">' + esc(c.owner.phone || c.owner.email) + '</span></span></div>' +
          creativePreview(c) + '<p class="mut">جایگاه‌ها: ' + c.slots.map(slotTitle).join('، ') + ' · بودجه: ' + money(c.budget) + ' · ضریب ' + fa(c.bid) + '× · مخاطب: ' + ((c.target.types || []).join('/') || 'همه') + ((c.target.genres || []).length ? ' · ژانر: ' + esc(c.target.genres.join('، ')) : '') + ' · ارسال: ' + dtime(c.submittedAt) + '</p>' +
          '<textarea id="r-' + c.id + '" rows="2" placeholder="دلیل رد (برای تبلیغ‌دهنده نمایش داده می‌شود)"></textarea><div class="acts"><button class="btn pri" data-ok="' + c.id + '">✅ تأیید و شروع نمایش</button><button class="btn bad" data-no="' + c.id + '">❌ رد و بازگشت بودجه</button></div></section>';
      }).join('') : '<div class="card empty">صف بررسی خالی است ✓</div>'));
      $$('[data-ok]').forEach(function (b) { b.onclick = function () { b.disabled = true; api('/admin/review/' + b.getAttribute('data-ok'), { body: { approve: true } }).then(function () { toast('تأیید شد ✓', 'ok'); viewAdmin(tab); }).catch(function (e) { b.disabled = false; toast(e.message, 'err'); }); }; });
      $$('[data-no]').forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-no'); api('/admin/review/' + id, { body: { approve: false, reason: $('#r-' + id).value } }).then(function () { toast('رد شد', 'ok'); viewAdmin(tab); }).catch(function (e) { toast(e.message, 'err'); }); }; });
    }).catch(adminErr(tab));
    if (tab === 'admin/campaigns') return api('/admin/campaigns').then(function (d) {
      var rows = (d.campaigns || []).map(function (c) {
        return '<tr><td><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><br><small class="mut">' + esc(c.owner.name) + '</small></td><td>' + fmtTitle(c.format) + '</td><td>' + badge(c.status) + '</td><td>' + num(c.imps) + ' / ' + num(c.clicks) + '</td><td>' + money(c.spent) + ' / ' + money(c.budget) + '</td><td>' +
          (c.status === 'active' ? '<button class="btn sm" data-ca="pause:' + c.id + '">توقف</button>' : '') + (c.status === 'paused' ? '<button class="btn sm" data-ca="resume:' + c.id + '">ادامه</button>' : '') + (['active', 'paused', 'pending'].indexOf(c.status) >= 0 ? '<button class="btn sm bad" data-ca="stop:' + c.id + '">پایان</button>' : '') + '</td></tr>';
      }).join('');
      adminShell(tab, '<h1>همهٔ کمپین‌ها</h1><section class="card"><div class="tbl"><table><thead><tr><th>کمپین</th><th>نوع</th><th>وضعیت</th><th>نمایش/کلیک</th><th>هزینه/بودجه</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">کمپینی نیست</td></tr>') + '</tbody></table></div></section>');
      $$('[data-ca]').forEach(function (b) { b.onclick = function () { var p = b.getAttribute('data-ca').split(':'); if (p[0] === 'stop' && !confirm('کمپین پایان یابد و باقی‌مانده به تبلیغ‌دهنده برگردد؟')) return; api('/admin/campaigns/' + p[1] + '/' + p[0], { method: 'POST' }).then(function () { viewAdmin(tab); }).catch(function (e) { toast(e.message, 'err'); }); }; });
    }).catch(adminErr(tab));
    if (tab === 'admin/users') return api('/admin/users').then(function (d) {
      var rows = (d.users || []).map(function (u) {
        return '<tr><td><b>' + esc(u.name) + '</b><br><small dir="ltr" class="mut">' + esc(u.email) + '</small></td><td>' + (u.role === 'admin' ? '<span class="bdg acc">مدیر</span>' : '') + (u.status !== 'active' ? '<span class="bdg bad">مسدود</span>' : '') + '</td><td>' + money(u.balance) + '</td><td>' + num(u.campaigns) + '</td><td>' + date(u.createdAt) + '</td><td>' +
          '<button class="btn sm" data-ua="adjust:' + u.id + '">تنظیم موجودی</button><button class="btn sm" data-ua="' + (u.status === 'active' ? 'block' : 'unblock') + ':' + u.id + '">' + (u.status === 'active' ? 'مسدود' : 'رفع مسدودی') + '</button><button class="btn sm ghost" data-ua="' + (u.role === 'admin' ? 'unadmin' : 'admin') + ':' + u.id + '">' + (u.role === 'admin' ? 'حذف مدیر' : 'مدیر کن') + '</button></td></tr>';
      }).join('');
      adminShell(tab, '<h1>تبلیغ‌دهنده‌ها</h1><section class="card"><div class="tbl"><table><thead><tr><th>نام</th><th>نقش</th><th>موجودی</th><th>کمپین</th><th>عضویت</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>');
      $$('[data-ua]').forEach(function (b) {
        b.onclick = function () {
          var p = b.getAttribute('data-ua').split(':');
          if (p[0] === 'adjust') {
            modal('تنظیم موجودی', '<label>مبلغ (منفی = کسر)<input id="m-amt" type="number" step="1000"></label><label>توضیح<input id="m-note" placeholder="مثلاً هدیهٔ شروع"></label><button class="btn pri block" id="m-go">ثبت</button>', function (m, close) {
              $('#m-go', m).onclick = function () { api('/admin/users/' + p[1], { body: { action: 'adjust', amount: $('#m-amt', m).value, note: $('#m-note', m).value } }).then(function () { close(); toast('ثبت شد ✓', 'ok'); viewAdmin(tab); }).catch(function (e) { toast(e.message, 'err'); }); };
            });
            return;
          }
          api('/admin/users/' + p[1], { body: { action: p[0] } }).then(function () { viewAdmin(tab); }).catch(function (e) { toast(e.message, 'err'); });
        };
      });
    }).catch(adminErr(tab));
    if (tab === 'admin/payments') return api('/admin/payments').then(function (d) {
      var rows = (d.invoices || []).map(function (i) {
        return '<tr class="' + (i.status === 'submitted' ? 'hl' : '') + '"><td>' + esc(i.owner.name) + '<br><small dir="ltr" class="mut">' + esc(i.owner.email) + '</small></td><td>' + (i.kind === 'stars' ? '⭐ ' + fa(i.stars) : '💳') + '</td><td><b>' + num(i.total) + '</b>' + (i.extra ? '<br><small class="mut">یکتا +' + num(i.extra) + '</small>' : '') + '</td><td>' + esc(i.transferAt || dtime(i.createdAt)) + '</td><td>' + esc(i.status) + '</td><td>' +
          (i.kind === 'k2k' && (i.status === 'submitted' || i.status === 'pending') ? '<button class="btn sm pri" data-pay="approve:' + i.id + '">تأیید</button><button class="btn sm bad" data-pay="reject:' + i.id + '">رد</button>' : '') + '</td></tr>';
      }).join('');
      adminShell(tab, '<h1>پرداخت‌ها</h1><div class="card note">کارت‌به‌کارت را فقط با <b>مبلغ یکتا</b> در پیامک بانک تطبیق دهید. اگر ربات تلگرام تنظیم شده باشد، دکمهٔ تأیید/رد در تلگرام هم می‌آید.</div><section class="card"><div class="tbl"><table><thead><tr><th>تبلیغ‌دهنده</th><th>روش</th><th>مبلغ دقیق</th><th>زمان اعلام</th><th>وضعیت</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">پرداختی نیست</td></tr>') + '</tbody></table></div></section>');
      $$('[data-pay]').forEach(function (b) { b.onclick = function () { var p = b.getAttribute('data-pay').split(':'); var reason = p[0] === 'reject' ? prompt('دلیل رد:', 'مبلغ واریزی با فاکتور مطابقت نداشت') : ''; if (reason === null) return; api('/admin/payments/' + p[1] + '/' + p[0], { body: { reason: reason } }).then(function () { toast('انجام شد ✓', 'ok'); viewAdmin(tab); }).catch(function (e) { toast(e.message, 'err'); }); }; });
    }).catch(adminErr(tab));
    if (tab === 'admin/settings') return api('/admin/settings').then(function (d) { adminSettings(d.settings); }).catch(adminErr(tab));
  }
  function adminErr(tab) { return function (e) { adminShell(tab, '<div class="card err">' + esc(e.message) + '</div>'); }; }
  function adminSettings(s) {
    var tr = s.tariffs;
    var tRow = function (f) { return '<tr><td><b>' + fmtTitle(f) + '</b></td><td><input type="number" min="0" data-t="' + f + ':cpm" value="' + esc(tr[f].cpm) + '"></td><td><input type="number" min="0" data-t="' + f + ':cpv" value="' + esc(tr[f].cpv) + '"></td><td><input type="number" min="0" data-t="' + f + ':cpc" value="' + esc(tr[f].cpc) + '"></td></tr>'; };
    var n = function (id, label, v, hint) { return '<label>' + label + '<input type="number" id="' + id + '" value="' + esc(v) + '">' + (hint ? '<small>' + hint + '</small>' : '') + '</label>'; };
    adminShell('admin/settings', '<h1>تنظیمات پلتفرم</h1>' +
      '<section class="card"><h2>🔗 اتصال به سایت اصلی</h2>' + (s.netFromEnv ? '<p class="ok">کلید از Secret ورکر (NET_SECRET) خوانده می‌شود.</p>' :
        '<label>کلید اتصال (در پنل سایت ← تبلیغات ← «کلید اتصال» وارد کنید)<div class="row2"><input id="s-net" dir="ltr" readonly value="' + esc(s.netSecret || '') + '" placeholder="هنوز ساخته نشده"><div class="acts"><button class="btn" id="s-netcp">کپی</button><button class="btn" id="s-netgen">' + (s.netSecret ? 'ساخت کلید تازه' : 'ساخت کلید') + '</button></div></div><small>با ساخت کلید تازه، اتصال سایت تا وارد کردن کلید جدید قطع می‌شود.</small></label>') +
      '<p class="mut">آدرس این پلتفرم برای پنل سایت: <b dir="ltr">' + esc(location.origin) + '</b> <button class="btn sm" id="s-orcp">کپی</button></p>' +
      '<div class="row2"><label>نام سایت<input id="s-site" value="' + esc(s.siteName) + '"></label><label>آدرس سایت (برای فهرست ژانرها)<input id="s-url" dir="ltr" value="' + esc(s.siteUrl) + '" placeholder="https://example.com"></label></div>' +
      '<div class="row2"><label>نام برند پلتفرم<input id="s-brand" value="' + esc(s.brand) + '"></label><label>پشتیبانی (آیدی/شماره)<input id="s-sup" value="' + esc(s.support) + '"></label></div>' +
      '<label class="chk"><input type="checkbox" id="s-lvia"' + (s.linkViaSite !== false ? ' checked' : '') + '> لینک‌های تبلیغ زیر فایل از مسیر سایت (/r/) بگذرند<small>روشن (پیش‌فرض) = همهٔ لینک‌ها — تلگرامی و غیرتلگرامی — از /r/ سایت می‌گذرند و کلیک دقیق ثبت می‌شود. خاموش = همهٔ لینک‌ها مستقیم باز می‌شوند، آدرس سایت در کار نیست و کلیکی شمرده نمی‌شود (فقط نمایش ثبت می‌شود).</small></label></section>' +
      '<section class="card"><h2>💲 تعرفه‌ها (تومان)</h2><div class="tbl"><table><thead><tr><th>نوع</th><th>هر ۱۰۰۰ نمایش (CPM)</th><th>هر بازدید کامل (CPV)</th><th>هر کلیک (CPC)</th></tr></thead><tbody>' + tRow('video') + tRow('banner') + tRow('link') + '</tbody></table></div><small class="mut">تعرفه هنگام ارسال هر کمپین قفل می‌شود.</small>' +
      '<div class="row2">' + n('s-minb', 'حداقل بودجهٔ کمپین', s.minBudget) + n('s-mind', 'حداقل سقف روزانه', s.minDaily) + n('s-maxbid', 'حداکثر ضریب پیشنهاد', s.maxBid) + n('s-view', 'بازدید کامل = چند ثانیه', s.viewSec) + n('s-skip', 'دکمهٔ رد کردن پس از (ثانیه)', s.skipAfter) + n('s-bsec', 'مدت پیش‌فرض نمایش بنر (ثانیه)', s.bannerSec, 'وقتی کمپین بنری مدت اختصاصی ندارد') + n('s-vmax', 'حداکثر مدت ویدئو', s.maxVideoSec) + n('s-vmin', 'حداقل مدت ویدئو', s.minVideoSec) + n('s-vmb', 'حداکثر حجم ویدئو (MB)', s.maxVideoMB) + n('s-ikb', 'حداکثر حجم تصویر (KB)', s.maxImageKB) + n('s-ttl', 'تازه‌سازی فهرست در سایت (ثانیه)', s.invTtl, 'کمتر = سریع‌تر، ولی درخواست بیشتر') + '</div>' +
      '<label class="chk"><input type="checkbox" id="s-ext"' + (s.allowExternalMedia ? ' checked' : '') + '> اجازهٔ لینک مستقیم فایل (به‌جای آپلود)</label></section>' +
      '<section class="card"><h2>💳 کارت‌به‌کارت</h2><label class="chk"><input type="checkbox" id="k-on"' + (s.k2k.enabled ? ' checked' : '') + '> فعال</label><div class="row2"><label>شماره کارت<input id="k-card" dir="ltr" value="' + esc(s.k2k.card) + '"></label><label>نام دارنده<input id="k-holder" value="' + esc(s.k2k.holder) + '"></label><label>بانک<input id="k-bank" value="' + esc(s.k2k.bank) + '"></label>' + n('k-ttl', 'مهلت پرداخت (دقیقه)', s.k2k.ttlMin) + n('k-min', 'حداقل مبلغ', s.k2k.min) + n('k-max', 'حداکثر مبلغ', s.k2k.max) + '</div><label>مبالغ پیشنهادی (با ویرگول)<input id="k-pre" dir="ltr" value="' + esc((s.k2k.presets || []).join(', ')) + '"></label></section>' +
      '<section class="card"><h2>⭐ استارز تلگرام و ربات</h2>' + (s.botConfigured ? '<p class="ok">ADS_BOT_TOKEN تنظیم شده است' + (s.botUsername ? ' — @' + esc(s.botUsername) : '') + '.</p><button class="btn" id="s-hook">ثبت/به‌روزرسانی وبهوک ربات</button>' : '<p class="warn">برای استارز و اعلان‌ها Secret با نام ADS_BOT_TOKEN را در Worker بگذارید.</p>') +
      '<label class="chk"><input type="checkbox" id="st-on"' + (s.stars.enabled ? ' checked' : '') + '> پرداخت با استارز فعال</label><label>بسته‌ها (هر خط: استارز | تومان)<textarea id="st-packs" rows="4" dir="ltr">' + esc((s.stars.packs || []).map(function (p) { return p.stars + ' | ' + p.toman; }).join('\n')) + '</textarea></label>' +
      '<label>شناسهٔ عددی تلگرام مدیران (اعلان و تأیید پرداخت)<input id="s-admtg" dir="ltr" value="' + esc(s.adminTgIds) + '" placeholder="123456789, 987654321"></label></section>' +
      '<section class="card"><h2>📜 قوانین و فیلترها</h2><label>متن قوانین (به تبلیغ‌دهنده‌ها نمایش داده می‌شود)<textarea id="s-rules" rows="12">' + esc(s.rules) + '</textarea></label><label>کلمات ممنوع (با ویرگول)<textarea id="s-ban" rows="3">' + esc(s.bannedWords) + '</textarea></label><label>دامنه‌های کوتاه‌کنندهٔ ممنوع<textarea id="s-short" rows="2" dir="ltr">' + esc(s.shorteners) + '</textarea></label></section>' +
      '<div class="actions"><button class="btn pri" id="s-save">💾 ذخیرهٔ تنظیمات</button></div>');
    var cp = $('#s-netcp'); if (cp) cp.onclick = function () { copy($('#s-net').value, 'کلید'); };
    $('#s-orcp').onclick = function () { copy(location.origin, 'آدرس'); };
    var gen = $('#s-netgen'); if (gen) gen.onclick = function () { if (!confirm('کلید تازه ساخته شود؟')) return; api('/admin/net-secret', { method: 'POST' }).then(function (r) { $('#s-net').value = r.netSecret; copy(r.netSecret, 'کلید تازه'); }).catch(function (e) { toast(e.message, 'err'); }); };
    var hook = $('#s-hook'); if (hook) hook.onclick = function () { api('/admin/bot-webhook', { method: 'POST' }).then(function (r) { toast('وبهوک @' + r.bot + ' ثبت شد ✓', 'ok'); }).catch(function (e) { toast(e.message, 'err'); }); };
    $('#s-save').onclick = function () {
      var v = function (id) { var el = $('#' + id); return el ? el.value : undefined; };
      var t = { video: {}, banner: {}, link: {} };
      $$('[data-t]').forEach(function (i) { var p = i.getAttribute('data-t').split(':'); t[p[0]][p[1]] = Number(i.value) || 0; });
      var packs = String(v('st-packs') || '').split('\n').map(function (l) { var p = l.split('|'); return p.length === 2 ? { stars: Number(p[0].trim()), toman: Number(p[1].trim()) } : null; }).filter(Boolean);
      var body = { siteName: v('s-site'), siteUrl: v('s-url'), brand: v('s-brand'), support: v('s-sup'), tariffs: t, minBudget: v('s-minb'), minDaily: v('s-mind'), maxBid: v('s-maxbid'), viewSec: v('s-view'), skipAfter: v('s-skip'), bannerSec: v('s-bsec'), maxVideoSec: v('s-vmax'), minVideoSec: v('s-vmin'), maxVideoMB: v('s-vmb'), maxImageKB: v('s-ikb'), invTtl: v('s-ttl'),
        allowExternalMedia: $('#s-ext').checked, linkViaSite: $('#s-lvia').checked, rules: v('s-rules'), bannedWords: v('s-ban'), shorteners: v('s-short'), adminTgIds: v('s-admtg'),
        k2k: { enabled: $('#k-on').checked, card: v('k-card'), holder: v('k-holder'), bank: v('k-bank'), ttlMin: v('k-ttl'), min: v('k-min'), max: v('k-max'), presets: v('k-pre') },
        stars: { enabled: $('#st-on').checked, packs: packs } };
      api('/admin/settings', { body: body }).then(function () { toast('ذخیره شد ✓', 'ok'); return loadCfg(); }).catch(function (e) { toast(e.message, 'err'); });
    };
  }

  /* ── مسیریابی ── */
  function loadCfg() { return api('/config').then(function (d) { S.cfg = d.config; S.genres = d.genres || []; S.market = d.market || null; D.title = (S.cfg.brand || 'تبلیغات'); }); }
  function render() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    clearInterval(S.k2kTimer);
    W.scrollTo(0, 0);
    if (!S.cfg) { $('#app').innerHTML = '<div class="spin"></div>'; loadCfg().then(render).catch(function (e) { $('#app').innerHTML = '<div class="card err" style="margin:40px">' + esc(e.message) + '</div>'; }); return; }
    if (h === '' || h === 'home') { if (S.user) return viewDash(); return viewLanding(); }
    if (h === 'login') return viewAuth('login');
    if (h === 'register') return viewAuth('register');
    if (h === 'dash') return viewDash();
    if (h === 'campaigns') return viewCampaigns();
    if (h === 'new') return viewEdit('');
    if (parts[0] === 'edit' && parts[1]) return viewEdit(parts[1]);
    if (parts[0] === 'c' && parts[1]) return viewCampaign(parts[1]);
    if (h === 'wallet') return viewWallet();
    if (h === 'market') return viewMarket(false);
    if (h === 'market-public') return viewMarket(true);
    if (h === 'rules') return viewRules();
    if (h === 'account') return viewAccount();
    if (parts[0] === 'admin') return viewAdmin(parts[1] ? 'admin/' + parts[1] : 'admin');
    shell('', '<div class="card empty">صفحه پیدا نشد. <a href="#/">خانه</a></div>');
  }
  W.addEventListener('hashchange', render);
  (S.token ? api('/me').then(function (r) { S.user = r.user; }).catch(function () { setToken(''); }) : Promise.resolve()).then(render);
}

/* ═══════ صفحهٔ HTML و ظاهر ═══════ */
const ADS_CSS = [
  ':root{--bg:#0b0e14;--bg2:#10141c;--card:#151a24;--line:#242c3b;--tx:#eef1f6;--tx2:#98a2b6;--tx3:#6b7689;--acc:#ff7a1a;--acc2:#ffb01f;--grad:linear-gradient(135deg,#ff5f2e,#ffb01f);--ok:#3ddc84;--err:#ff5470;--warn:#ffc53d;--rad:16px}',
  '*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--tx);font-family:Vazirmatn,Tahoma,sans-serif;font-size:14.5px;line-height:1.75}',
  'a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}h1{font-size:22px;margin:6px 0 14px}h2{font-size:16px;margin:0 0 12px}h3{font-size:15px;margin:14px 0 6px}h4{font-size:13px;margin:10px 0 6px;color:var(--tx2)}',
  '.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:10px 18px;background:rgba(11,14,20,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line);flex-wrap:wrap}',
  '.logo{display:flex;align-items:center;gap:8px;font-weight:900;font-size:16px;color:var(--tx)}.logo span{font-size:22px}',
  '.top nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}.top nav a{padding:6px 11px;border-radius:999px;color:var(--tx2);font-size:13px;font-weight:700}.top nav a.on,.top nav a:hover{background:rgba(255,255,255,.07);color:var(--tx);text-decoration:none}',
  '.me{display:flex;gap:8px;align-items:center}.chip{padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--tx);font-size:12.5px;font-weight:700;white-space:nowrap}',
  'main{max-width:1100px;margin:0 auto;padding:18px 16px 40px}footer{text-align:center;color:var(--tx3);font-size:12px;padding:20px;border-top:1px solid var(--line)}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:var(--rad);padding:16px;margin-bottom:14px}.card.note{border-color:rgba(255,197,61,.35);background:rgba(255,197,61,.06)}.card.err{border-color:rgba(255,84,112,.4);background:rgba(255,84,112,.07)}',
  '.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--tx);border-radius:12px;padding:9px 16px;font:inherit;font-weight:800;cursor:pointer;text-decoration:none!important;white-space:nowrap}',
  '.btn:hover{background:rgba(255,255,255,.1)}.btn:disabled{opacity:.5;cursor:default}.btn.pri{background:var(--grad);color:#111;border:0}.btn.bad{color:#fff;background:rgba(255,84,112,.18);border-color:rgba(255,84,112,.4)}.btn.ghost{background:none}.btn.sm{padding:5px 10px;font-size:12px;border-radius:9px}.btn.lg{padding:13px 26px;font-size:16px}.btn.block{display:flex;width:100%;margin-top:10px}',
  'label{display:block;margin:10px 0;font-weight:700;font-size:13px;color:var(--tx2)}label small,.mut{color:var(--tx3);font-weight:500;font-size:12px}.c{text-align:center}.ok{color:var(--ok)}.bad{color:var(--err)}.warn{color:var(--warn)}',
  'input,textarea,select{display:block;width:100%;margin-top:5px;background:var(--bg2);border:1px solid var(--line);border-radius:11px;color:var(--tx);padding:10px 12px;font:inherit;font-weight:500}input:focus,textarea:focus{outline:none;border-color:var(--acc)}',
  'input[type=checkbox],input[type=radio]{display:inline;width:auto;margin:0 0 0 6px;accent-color:var(--acc)}input[type=range]{padding:0;accent-color:var(--acc)}label.chk{display:flex;align-items:center;gap:6px;color:var(--tx)}',
  '.hero{text-align:center;padding:50px 10px 30px}.hero h1{font-size:30px;line-height:1.5;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}.hero p{max-width:720px;margin:0 auto 22px;color:var(--tx2);font-size:15.5px}.cta{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',
  '.feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:20px 0}.feat{background:var(--card);border:1px solid var(--line);border-radius:var(--rad);padding:18px}.feat .ic{font-size:30px}.feat p{color:var(--tx2);font-size:13px}.feat .price{font-weight:800;color:var(--acc2);font-size:13px}',
  '.steps ol{margin:0;padding-right:20px}.steps li{margin:6px 0}',
  '.auth{max-width:420px;margin:30px auto}',
  '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}.kpi span{color:var(--tx3);font-size:12px;font-weight:700}.kpi b{font-size:19px;font-weight:900}.kpi small{color:var(--tx2);font-size:11.5px}',
  '.h1row,.h2row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between}.h1row h1{margin-left:auto}.h2row h2{margin:0}',
  '.bdg{display:inline-block;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.08);font-size:11.5px;font-weight:800;margin:0 4px}.bdg.ok{background:rgba(61,220,132,.16);color:var(--ok)}.bdg.warn{background:rgba(255,197,61,.16);color:var(--warn)}.bdg.bad{background:rgba(255,84,112,.16);color:var(--err)}.bdg.acc{background:rgba(255,122,26,.18);color:var(--acc2)}',
  '.clist{display:flex;flex-direction:column;gap:8px}.citem{display:block;padding:12px 14px;border-radius:13px;background:var(--bg2);border:1px solid var(--line);color:var(--tx);text-decoration:none!important}.citem:hover{border-color:var(--acc)}.ct{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.ct b{margin-left:6px}',
  '.cm{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--tx2);margin-top:4px}.bar{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:var(--grad)}.bar.big{height:10px}',
  '.empty{text-align:center;color:var(--tx2);padding:24px}.spin{width:44px;height:44px;margin:60px auto;border-radius:50%;border:4px solid rgba(255,255,255,.1);border-top-color:var(--acc2);animation:sp .8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}',
  '.chart{width:100%;height:auto;display:block}.chart .grid{stroke:rgba(255,255,255,.06)}.chart .lbl{fill:var(--tx3);font-size:10px;text-anchor:middle}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--tx2);margin-top:4px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-left:5px}',
  '.tbl{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:right;padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--tx3);font-weight:800;font-size:12px;white-space:nowrap}tr.hl td{background:rgba(255,197,61,.06)}td input{min-width:90px}',
  '.fmts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.fmt{display:flex;flex-direction:column;gap:2px;padding:14px;border-radius:14px;border:2px solid var(--line);background:var(--bg2);cursor:pointer;color:var(--tx);margin:0}.fmt input{display:none}.fmt.on{border-color:var(--acc);background:rgba(255,122,26,.08)}.fmt.dis{opacity:.6;cursor:default}.fmt .ic{font-size:26px}.fmt small{color:var(--tx2);font-weight:500}.fmt em{font-style:normal;color:var(--acc2);font-size:12px}',
  '.media{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px dashed var(--line);border-radius:14px;margin:10px 0}.media .pv{width:150px;flex:none;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center}.media .pv video,.media .pv img{width:100%;height:100%;object-fit:contain}.media .ph{font-size:30px;opacity:.5}.media .mi{flex:1;min-width:0}.media .mi b{display:block}.media input[type=file]{padding:6px}',
  '.prog{height:5px;border-radius:5px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:6px}.prog i{display:block;height:100%;width:0;background:var(--grad);transition:width .2s}.media.up{border-color:var(--acc)}',
  '.slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.slot{display:flex;flex-direction:column;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg2);cursor:pointer;margin:0;color:var(--tx)}.slot.on{border-color:var(--acc);background:rgba(255,122,26,.08)}.slot input{position:absolute;opacity:0}.slot small{color:var(--tx2);font-weight:500}',
  '.chips{display:flex;flex-wrap:wrap;gap:6px}.chipx{display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--bg2);cursor:pointer;margin:0;color:var(--tx);font-size:12.5px}.chipx input{display:none}.chipx.on{border-color:var(--acc);background:rgba(255,122,26,.12);color:var(--acc2)}',
  '.row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:start}.est{padding:10px 14px;border-radius:12px;background:rgba(255,122,26,.08);color:var(--tx);font-size:13.5px;margin:8px 0}.actions,.acts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
  '.tgprev{max-width:340px;background:#17212b;border-radius:14px;padding:10px;margin:10px 0}.tgprev .bub{background:#182533;border-radius:10px;padding:10px;color:#fff}.tgprev .bub small{display:block;color:#8ea0b4}.tgprev .tbtn{margin-top:6px;text-align:center;background:rgba(255,255,255,.1);border-radius:8px;padding:8px;color:#fff;font-weight:700;font-size:13px}',
  '.prevs{display:flex;gap:12px;flex-wrap:wrap}.prevs div{display:flex;flex-direction:column;gap:4px}.prevs video{width:320px;max-width:100%;border-radius:10px;background:#000}.prevs video.tall{width:160px}.prevs img{max-width:320px;border-radius:10px}',
  '.wal{background:var(--grad);color:#111;border-radius:var(--rad);padding:20px;margin-bottom:14px;display:flex;flex-direction:column}.wal b{font-size:30px;font-weight:900}.wal small{opacity:.75}',
  '.packs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.pack{appearance:none;display:flex;flex-direction:column;gap:2px;padding:14px;border-radius:13px;border:1px solid var(--line);background:var(--bg2);color:var(--tx);font:inherit;cursor:pointer;text-align:right}.pack:hover{border-color:var(--acc)}.pack b{font-size:15px}.pack span{color:var(--tx2);font-size:12px}',
  '.k2k .vcard{background:linear-gradient(135deg,#243049,#121826);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:4px;margin-bottom:12px}.k2k .vcard b{font-size:21px;letter-spacing:2px}.k2k .amt{text-align:center;padding:10px;border-radius:14px;background:rgba(255,122,26,.08);margin-bottom:8px}.k2k .amt b{display:block;font-size:30px;font-weight:900;color:var(--acc2)}.k2k .st{text-align:center;font-weight:800;margin:10px 0}',
  '.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.tabs a{padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--tx2);font-weight:800;font-size:13px}.tabs a.on{background:var(--grad);color:#111}',
  '.rev textarea{margin-top:8px}.rules p{margin:4px 0;color:var(--tx2)}.rules h3{color:var(--tx)}',
  '#modal .mw{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px}#modal .md{width:min(460px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:18px}#modal .mh{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}#modal .mb{padding:16px}#modal .x{background:none;border:0;color:var(--tx);font-size:18px;cursor:pointer}',
  '#toasts{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:60;display:flex;flex-direction:column;gap:8px;align-items:center}.toast{padding:10px 18px;border-radius:999px;background:#222b3a;border:1px solid var(--line);font-weight:700;font-size:13px;transition:opacity .3s;max-width:92vw}.toast.ok{border-color:rgba(61,220,132,.5)}.toast.err{border-color:rgba(255,84,112,.6)}',
  '@media (max-width:700px){.top nav{order:3;flex-basis:100%;overflow:auto;flex-wrap:nowrap}.hero h1{font-size:23px}.media{flex-direction:column}.media .pv{width:100%}.h1row h1{margin-left:0}}',
].join('\n');
const ADS_HTML = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0e14"><title>پلتفرم تبلیغات</title>' +
  '<link rel="icon" href="/favicon.svg"><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;800;900&display=swap" rel="stylesheet" media="print" onload="this.media=\'all\'">' +
  '<style>' + ADS_CSS + '</style></head><body><div id="app"><div class="spin"></div></div><div id="modal"></div><div id="toasts"></div>' +
  '<script>(' + ADS_APP.toString() + ')(window);</' + 'script></body></html>';
