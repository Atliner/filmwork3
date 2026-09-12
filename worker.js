/*
 * =====================================================================
 *  🎬 سینماگرام v3 — یک‌فایلی | Cloudflare Worker + ربات/مینی‌اپ تلگرام
 * =====================================================================
 *  محتوا از کانال تلگرام شماست. پخش آنلاین وجود ندارد (ضد کپی).
 *  کاربر با ربات وارد می‌شود و فایل را همان‌جا، فقط ۱۰ ثانیه، دریافت می‌کند.
 *
 *  ── نصب ────────────────────────────────────────────────────────────
 *  1) dash.cloudflare.com → Workers & Pages → Create Worker
 *     کل این فایل را Paste کنید و Deploy نمایید.
 *  2) KV Namespace به نام "KV" بسازید و Binding با Variable name = KV.
 *  3) ربات ورود در @BotFather. Worker → Settings → Variables and Secrets:
 *       Secret: BOT_TOKEN          توکن ربات ورود/لاگین
 *       Variable: BOT_USERNAME     یوزرنیم بدون @
 *     ربات ارسال فایل (جدا، توصیه می‌شود):
 *       Secret: DELIVERY_BOT_TOKEN
 *       Variable: DELIVERY_BOT_USERNAME
 *     هر دو را «مدیر» کانال مخزن کنید. مخزن را خصوصی بگذارید (نه پابلیک).
 *     اگر کانال بن شد و فایل‌ها را با همان ترتیب فوروارد کردید:
 *       Variable: VAULT_REWRITE = xvcdn:newcdn
 *     فقط یوزرنیم/آیدی کانال عوض می‌شود؛ شماره پیام (مثلاً /62) ثابت می‌ماند.
 *     ربات مدیریت محتوا (اختیاری، کد در همین فایل):
 *       Secret: CONTENT_BOT_TOKEN / CONTENT_WEBHOOK_SECRET
 *       Variable: CONTENT_ADMIN_IDS (شناسه عددی مدیران)
 *       Durable Object binding: EDITOR → EditorSession (نیاز به migration)
 *     راهنمای نصب: docs/CONTENT-BOT.md / نمونه: wrangler.example.toml
 *  4) Login Widget: BotFather → Bot Settings → Domain / Login Widget
 *     Enter URL = فقط دامنهٔ سایت بدون https (مثال: xxx.workers.dev)
 *  5) اولین کسی که با تلگرام وارد شود مدیر است.
 *
 *  ── مینی‌اپ تمام‌صفحه + چیدمان ریسپانسیو ───────────────────────
 *  • BotFather → /mybots → بوت شما → Bot Settings → Configure Mini App:
 *      Enable Mini App + URL = دامنهٔ Worker، سپس Mode = «Fullscreen».
 *    (همین Mode همان «لانچ مود» بات‌فادر است: Fullscreen / Fullsize / Compact.
 *     حالت Fullscreen نوار عنوان بالایی ربات را در موبایل پنهان می‌کند.)
 *  • دکمهٔ «خانه» پایین دیگر وجود ندارد: TG.MainButton اصلاً show نمی‌شود.
 *  • عرض ریسپانسیو: در موبایل تمام عرض است و در دسکتاپ محتوا تا سقف
 *    --content-w کش می‌آید و وسط‌چین می‌شود (دیگر ستون ثابت ۴۸۰px نیست).
 *  • در موبایل با env(safe-area-inset-*) محتوا از نوار وضعیت (ساعت/باتری)
 *    و دکمه‌های پایین گوشی فاصله می‌گیرد (viewport-fit=cover).
 *
 *  ── نسخهٔ 3.50 ─────────────────────────────────────────────────────
 *  • ظاهر شیشه‌ای (iOS-like): دکمه‌های گرد، backdrop-filter، مودال شیت پایین.
 *  • صفحهٔ فیلم/سریال به سبک نماوا: بنر تمام‌عرض، عنوان و متادیتا وسط،
 *    کارت اطلاعات، بازیگران/عوامل دایره‌ای با اسکرول افقی.
 *  • سریال: فیلدهای airing / airingSeason / airingText («فصل N در حال پخش»)
 *    و yearEnd (سال آخرین فصل → «۲۰۲۱ – ۲۰۲۴»). ردیف «سریال‌های در حال پخش»
 *    در صفحهٔ اصلی و فیلتر ?airing=1 در /api/catalog.
 * =====================================================================
 */
'use strict';

const CONFIG = {
  TOKEN_TTL_DAYS: 30,
  PBKDF2_ITER: 5000,
  RES_TTL: 5400,
  MAX_BODY: 5 * 1024 * 1024,
  MAX_POSTER: 350 * 1024,
  MAX_ITEMS: 500,
  VANISH_SEC: 10,
  TICKET_TTL: 600,
  MINI_APP_URL: 'https://t.me/movie_shatelup_bot/directlink',
  SIGNUP_BONUS: 50,
  GALLERY_LIMIT: 4,
  GALLERY_MIN_COUNT: 1,
  GALLERY_MAX_COUNT: 10,
  GALLERY_CACHE_TTL: 86400,
  GALLERY_TIMEOUT_MS: 10000,
  GALLERY_TOTAL_MS: 25000,
  GALLERY_MAX_PAGES: 6,
  GALLERY_MAX_REDIRECTS: 3,
  GALLERY_MAX_HTML: 5 * 1024 * 1024,
  AD_MAX_SEC: 20,
  AD_MIN_SEC: 3,
  AD_MAX_COUNT: 60,
  /* ابعاد فایل تبلیغ (پیکسل). لایهٔ تبلیغ تمام‌صفحهٔ عمودی است (موبایل داخل وب‌اپ تلگرام)،
     پس نسبت ۹:۱۶ پیشنهاد می‌شود؛ w×h = ابعاد ایده‌آل، minW×minH = حداقل قابل قبول.
     این مقادیر به پنل مدیریت داده می‌شود تا تبلیغ‌دهنده بداند فایلش باید چقدر باشد. */
  AD_SPEC: {
    banner: { w: 1080, h: 1920, minW: 720, minH: 1280, maxKB: 600, formats: 'JPG / PNG / WebP' },
    video: { w: 1080, h: 1920, minW: 720, minH: 1280, maxMB: 5, formats: 'MP4 (H.264 با faststart)' },
  },
  TG_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const ECONOMY_DEFAULTS = {
  walletUnitName: 'سکه',
  signupBonus: CONFIG.SIGNUP_BONUS,
  sub1m: 100,
  sub3m: 250,
  sub6m: 450,
  sub1y: 800,
  dlClickPrice: 2,
  refSignupBonus: 50,
  refPurchasePercent: 1,
  starsEnabled: true,
  zarinpalMerchant: '',
  vanishSec: 10,
  starPacks: [
    { stars: 50, units: 500 },
    { stars: 100, units: 1100 },
    { stars: 250, units: 3000 },
  ],
  rialPacks: [],
  starShopsRev: 3,
  starShops: [
    { title: 'آسان استارز (ربات)', url: 'https://t.me/asanstars_bot', note: 'کارت شتاب داخل تلگرام' },
    { title: 'ربات رسمی PremiumBot', url: 'https://t.me/PremiumBot', note: 'خرید مستقیم استارز از تلگرام' },
    { title: 'کیف پول TON تلگرام', url: 'https://t.me/wallet', note: 'TON رسمی داخل تلگرام' },
    { title: 'ایرانیکارت', url: 'https://www.iranicard.ir/payments/foreign-services/telegram-stars/', note: 'حداقل خرید ۱۰۰ استارز' },
    { title: 'ساب‌تی‌جی', url: 'https://subtg.com/telegram-stars', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'آسان استارز', url: 'https://asanstars.com/', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'نامبرلند', url: 'https://numberland.ir/account/telegram-stars', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'مارکت پلو', url: 'https://marketpolo.ir/product/telegram-stars/', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'گیمرزشاپ', url: 'https://gamerzshop.ir/product/telegram-stars/', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'اکانت فور آل', url: 'https://account4all.ir/product/%D8%AE%D8%B1%DB%8C%D8%AF-%D8%A7%D8%B3%D8%AA%D8%A7%D8%B1%D8%B2-%D8%AA%D9%84%DA%AF%D8%B1%D8%A7%D9%85/', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'کافه ارز', url: 'https://ir.cafearz.com/services/create/telegram-stars', note: 'حداقل خرید ۱۰۰ استارز' },
    { title: 'موبوگیفت', url: 'https://mobogift.com/categories/telegram-stars', note: 'حداقل خرید ۱۰۰ استارز' },
    { title: 'PremiumAndStar', url: 'https://stars.promo/stars/', note: 'حداقل خرید ۵۰ استارز' },
    { title: 'پرمیوم فارسی', url: 'https://premiumfa.net/products/telegram-stars', note: 'حداقل خرید ۵۰ استارز' },
  ],
  k2kEnabled: false,
  k2kCardNumber: '',
  k2kCardHolder: '',
  k2kCardBank: 'بانک ملی',
  k2kSecret: '',
  k2kTtlSec: 1800,
  k2kPacks: [
    { toman: 50000, units: 500 },
    { toman: 100000, units: 1100 },
    { toman: 200000, units: 2500 },
  ],
};

/* ═══════════════════════ ابزارها ═══════════════════════ */

const enc = new TextEncoder();
const dec = new TextDecoder();

function hexToBytes(h) {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
}
function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function randomHex(n) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}
async function hmacSha256Bytes(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof msg === 'string' ? enc.encode(msg) : msg;
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hmacHex(key, msg) {
  return bytesToHex(await hmacSha256Bytes(key, msg));
}
function b64urlEncode(str) {
  const b = enc.encode(str);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/*
 * ── کش فرایندی برای کاهش فراخوانی KV (کاهش خواندن‌های تکراری در همان Worker) ──
 */
const memItem = new Map();
const memRes = new Map();
const memIdx = new Map();
const memSet = new Map();
const memUser = new Map();

async function getUser(store, username) {
  if (!username) return null;
  const c = memUser.get(username);
  if (c && Date.now() - c.t < 60000) return c.user;
  const user = await store.get('u:' + username);
  if (user) memUser.set(username, { t: Date.now(), user: user });
  else memUser.delete(username);
  return user;
}
function bustUser(username) { memUser.delete(username); }
function userIndexKeys(user) {
  if (!user) return [];
  return [user.tgId && 'tg:' + user.tgId, user.phone && 'ph:' + user.phone,
    user.tgUsername && 'tgu:' + normTgUser(user.tgUsername), user.refCode && 'refcode:' + user.refCode].filter(Boolean);
}
async function deleteOwnedIndexes(store, keys, owner) {
  for (const key of new Set(keys)) if (await store.get(key) === owner) await store.del(key);
}
async function saveUser(store, user) {
  const old = await store.get('u:' + user.username);
  const before = userIndexKeys(old), after = userIndexKeys(user);
  await store.set('u:' + user.username, user);
  bustUser(user.username);
  await deleteOwnedIndexes(store, before.filter(function (key) { return !after.includes(key); }), user.username);
  for (const key of after) if (!before.includes(key)) await store.set(key, user.username);
}
function itemSourceKeys(item) {
  const keys = new Set();
  if (item) walkSources(item, function (src) {
    if (!src || !src.msgId) return;
    if (src.chatId) keys.add('src:c:' + normalizeChannelId(src.chatId) + '/' + src.msgId);
    if (src.user) keys.add('src:' + src.user + '/' + src.msgId);
  });
  return [...keys];
}
async function saveItemRecord(store, item) {
  const old = await store.get('it:' + item.id);
  await store.set('it:' + item.id, item);
  bustItem(item.id);
  if (!old) return;
  const keep = new Set(itemSourceKeys(item));
  await deleteOwnedIndexes(store, itemSourceKeys(old).filter(function (key) { return !keep.has(key); }), item.id);
  const subs = new Set((item.subs || []).map(function (sub) { return sub.id; }));
  for (const sub of old.subs || []) if (!subs.has(sub.id)) {
    const rec = await store.get('sub:' + sub.id);
    if (rec && rec.itemId === item.id) await store.del('sub:' + sub.id);
  }
}

async function getItem(store, id) {
  const c = memItem.get(id);
  if (c && Date.now() - c.t < 60000) return c.item;
  const item = await store.get('it:' + id);
  if (item) memItem.set(id, { t: Date.now(), item: item });
  else memItem.delete(id);
  return item;
}
function bustItem(id) { memItem.delete(id); }
async function getIdx(store) {
  const c = memIdx.get('idx');
  if (c && Date.now() - c.t < 60000) return c.data;
  const data = (await store.get('idx')) || [];
  memIdx.set('idx', { t: Date.now(), data: data });
  return data;
}
function bustIdx() { memIdx.delete('idx'); }

function mergeSettings(s) {
  const out = Object.assign({
    secret: '',
    botToken: '',
    botUsername: '',
    botId: 0,
    webhookSecret: '',
    publicUrl: '',
    siteName: 'سینماگرام',
    tagline: 'فیلم و سریال، تحویل امن در تلگرام',
    autoSync: true,
    defaultAccess: 'free',
    requireLogin: true,
    syncOffset: 0,
    lastSyncAt: 0,
    lastSyncLog: '',
    fileCaption: '🔥 دانلود کامل این فیلم و هزاران سریال بروز دنیا در ربات شاتل‌آپ 👇\n🤖 @movie_shatelup_bot | جدیدترین اخبار سینما: @movie_shatelup 🎭',
    adEnabled: true,
    adButtonText: '🎭 جدیدترین اخبار سینما',
    adButtonUrl: 'https://t.me/movie_shatelup',
    adGateEnabled: true,
    adGateBtnText: '🚫 حذف تبلیغ‌ها',
    adGateTitle: 'دانلود بدون تبلیغ، فقط با اشتراک',
    adGateNote: 'کاربران دارای اشتراک فعال هیچ تبلیغی نمی‌بینند و بلافاصله بعد از کلیک روی دانلود، به ربات هدایت می‌شوند.\nبا خرید اشتراک، انتظار تبلیغ حذف می‌شود و هزینهٔ هر دانلود هم از کیف پول شما کسر نمی‌شود.',
    deliveryBotToken: '',
    deliveryBotUsername: '',
    vaultRewrite: '',
    vaultChatId: '',
    entryHosts: '',
    poolHosts: '',
    redirectMode: 'off',
    redirectSelected: '',
    widgetDomain: '',
  }, ECONOMY_DEFAULTS, s || {});
  if (!Array.isArray(out.starPacks) || !out.starPacks.length) out.starPacks = ECONOMY_DEFAULTS.starPacks.slice();
  if (!Array.isArray(out.rialPacks)) out.rialPacks = [];
  if (!Array.isArray(out.starShops) || !out.starShops.length) out.starShops = (ECONOMY_DEFAULTS.starShops || []).slice();
  if (!Array.isArray(out.k2kPacks) || !out.k2kPacks.length) out.k2kPacks = (ECONOMY_DEFAULTS.k2kPacks || []).slice();
  return out;
}

function parseHostList(text) {
  return String(text || '').split(/[\n,\s]+/).map(function (l) {
    l = String(l || '').trim().toLowerCase();
    l = l.replace(/^https?:\/\//i, '');
    const sl = l.indexOf('/');
    if (sl >= 0) l = l.slice(0, sl);
    return l.replace(/\.$/, '');
  }).filter(Boolean).slice(0, 40);
}
function hostMatchesList(host, list) {
  host = String(host || '').toLowerCase();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p) continue;
    if (p === host) return true;
    if (p.indexOf('*.') === 0) {
      const suf = p.slice(1);
      if (host === p.slice(2)) return true;
      if (host.length > suf.length && host.slice(host.length - suf.length) === suf) return true;
    }
  }
  return false;
}
function hopOriginList(set) {
  const pool = parseHostList(set && set.poolHosts);
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].indexOf('*') >= 0) continue;
    out.push('https://' + pool[i]);
  }
  return out;
}
function shouldHop(url, set) {
  const mode = String((set && set.redirectMode) || 'off');
  if (mode === 'off' || mode === '') return false;
  const host = String((url && url.hostname) || '').toLowerCase();
  const entry = parseHostList(set && set.entryHosts);
  if (!entry.length || !hostMatchesList(host, entry)) return false;
  return hopOriginList(set).length > 0;
}
function pickHopOrigin(set) {
  const list = hopOriginList(set);
  if (!list.length) return '';
  const mode = String((set && set.redirectMode) || 'off');
  if (mode === 'pick' || mode === 'selected') {
    let sel = String((set && set.redirectSelected) || '').trim().toLowerCase();
    sel = sel.replace(/^https?:\/\//i, '');
    const sl = sel.indexOf('/');
    if (sl >= 0) sel = sel.slice(0, sl);
    if (sel) {
      const want = 'https://' + sel;
      for (let i = 0; i < list.length; i++) if (list[i] === want) return want;
    }
    return list[0];
  }
  if (mode === 'random') return list[Math.floor(Math.random() * list.length)];
  return list[0];
}
function originFromRequest(request) {
  try {
    const o = String((request && request.headers && request.headers.get('origin')) || '').trim();
    if (o && /^https?:\/\//i.test(o)) return o.replace(/\/$/, '');
  } catch (e) { }
  try {
    const r = String((request && request.headers && request.headers.get('referer')) || '');
    if (r) return new URL(r).origin;
  } catch (e2) { }
  try { return new URL(request.url).origin; } catch (e3) { }
  return '';
}
function hopPage(set) {
  const list = hopOriginList(set);
  const mode = String((set && set.redirectMode) || 'random');
  const pick = (mode === 'random') ? '' : (pickHopOrigin(set) || list[0] || '');
  const links = list.map(function (u) {
    const h = u.replace(/^https?:\/\//, '');
    return '<a href="' + htmlEscape(u) + '" style="color:#ffb01f">' + htmlEscape(h) + '</a>';
  }).join('<br>');
  const html = '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="cache-control" content="no-store"><title>اتصال…</title><body style="font-family:Tahoma,sans-serif;background:#0b0e14;color:#eef1f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:380px;padding:24px"><div style="font-size:42px">🚀</div><h2>در حال انتقال به دامنهٔ سالم</h2><p style="color:#98a2b6;font-size:14px;line-height:1.8">اگر چند ثانیه طول کشید، یکی از دامنه‌های زیر را باز کنید.</p><p style="font-size:13px;line-height:1.9;margin-top:12px">' + links + '</p></div><script>(function(){var list=' + JSON.stringify(list).replace(/</g, '\\u003c') + ';var pick=' + JSON.stringify(pick).replace(/</g, '\\u003c') + ';var mode=' + JSON.stringify(mode) + ';if(mode==="random"&&list.length)pick=list[Math.floor(Math.random()*list.length)];if(!pick)pick=list[0];if(!pick)return;location.replace(pick+location.pathname+location.search+location.hash);})();</script></body></html>';
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache' } });
}

function envStr(env, keys) {
  env = env || {};
  for (let i = 0; i < keys.length; i++) {
    const v = env[keys[i]];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}
function envBotToken(env) {
  return normalizeBotToken(envStr(env, ['BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'BOT_TOKEN_SECRET']));
}
function envBotUsername(env) {
  return envStr(env, ['BOT_USERNAME', 'TELEGRAM_BOT_USERNAME', 'BOT_USER']).replace(/^@/, '');
}
function envDeliveryToken(env) {
  return normalizeBotToken(envStr(env, ['DELIVERY_BOT_TOKEN', 'FILE_BOT_TOKEN']));
}
function envDeliveryUsername(env) {
  return envStr(env, ['DELIVERY_BOT_USERNAME', 'FILE_BOT_USERNAME']).replace(/^@/, '');
}
function applyRuntimeBot(store, s) {
  const env = (store && store.env) || {};
  const et = envBotToken(env);
  const eu = envBotUsername(env);
  if (et) {
    s.botToken = et;
    const bid = botIdFromToken(et);
    if (bid) s.botId = bid;
    s.botFromEnv = true;
  }
  if (eu) {
    s.botUsername = eu;
    s.botUserFromEnv = true;
  }
  const dt = envDeliveryToken(env);
  const du = envDeliveryUsername(env);
  if (dt) {
    s.deliveryBotToken = dt;
    s.deliveryFromEnv = true;
  }
  if (du) {
    s.deliveryBotUsername = du;
    s.deliveryUserFromEnv = true;
  }
  const vr = envStr(env, ['VAULT_REWRITE', 'CHANNEL_MAP']);
  if (vr) {
    s.vaultRewriteEnv = vr;
    s.vaultRewriteFromEnv = true;
  }
  const vc = envStr(env, ['VAULT_CHAT_ID', 'VAULT_CHANNEL']);
  if (vc) {
    s.vaultChatId = extractVaultChatId(vc) || vc;
    s.vaultChatFromEnv = true;
  }
  const ks = envStr(env, ['K2K_SECRET', 'K2K_WEBHOOK_SECRET']);
  if (ks) {
    s.k2kSecret = ks;
    s.k2kSecretFromEnv = true;
  }
  return s;
}
async function writeSettings(store, set) {
  const out = Object.assign({}, set);
  delete out.botFromEnv;
  delete out.botUserFromEnv;
  delete out.deliveryFromEnv;
  delete out.deliveryUserFromEnv;
  delete out.vaultRewriteFromEnv;
  delete out.vaultRewriteEnv;
  delete out.vaultChatFromEnv;
  if (envBotToken(store && store.env)) delete out.botToken;
  if (envDeliveryToken(store && store.env)) delete out.deliveryBotToken;
  await store.set('set', out);
  bustSettings(store);
}
async function getSettings(store) {
  const ck = (store && store.kv) || 'set';
  const c = memSet.get(ck);
  if (c && Date.now() - c.t < 4000) return c.data;
  let s = await store.get('set');
  if (!s) {
    s = mergeSettings({ secret: randomHex(32), webhookSecret: randomHex(16) });
    await store.set('set', s);
  } else {
    const merged = mergeSettings(s);
    let changed = false;
    const prevShopRev = Number(s.starShopsRev) || 0;
    for (const k of Object.keys(merged)) {
      if (s[k] === undefined) { s[k] = merged[k]; changed = true; }
    }
    if (!s.secret) { s.secret = randomHex(32); changed = true; }
    if (!s.webhookSecret) { s.webhookSecret = randomHex(16); changed = true; }
    if (prevShopRev < 3) {
      s.starShops = ECONOMY_DEFAULTS.starShops.slice();
      s.starShopsRev = 3;
      changed = true;
    }
    if (s.botToken) {
      const nt = normalizeBotToken(s.botToken);
      if (nt !== s.botToken) { s.botToken = nt; changed = true; }
      const bid = botIdFromToken(nt);
      if (bid && s.botId !== bid) { s.botId = bid; changed = true; }
    }
    if (changed) await store.set('set', s);
    s = mergeSettings(s);
  }
  if (s.botToken) {
    s.botToken = normalizeBotToken(s.botToken);
    if (!s.botId) s.botId = botIdFromToken(s.botToken);
  }
  applyRuntimeBot(store, s);
  memSet.set(ck, { t: Date.now(), data: s });
  return s;
}
function bustSettings(store) {
  if (store && store.kv) memSet.delete(store.kv);
  else memSet.clear();
}

/* ═══════════════════════ رمزنگاری و توکن ═══════════════════════ */

async function hashPassword(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: CONFIG.PBKDF2_ITER },
    key, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function signToken(payload, secret) {
  const p = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacHex(enc.encode(secret), p);
  return p + '.' + sig;
}
async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || token.length > 600) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const p = token.slice(0, i), sig = token.slice(i + 1);
  const exp = await hmacHex(enc.encode(secret), p);
  if (exp.length !== sig.length) return null;
  let d = 0;
  for (let k = 0; k < exp.length; k++) d |= exp.charCodeAt(k) ^ sig.charCodeAt(k);
  if (d) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(p)));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

async function sha256Bytes(msg) {
  const data = typeof msg === 'string' ? enc.encode(msg) : msg;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/* Login Widget / oauth.telegram.org — secret = SHA256(bot_token) */
function normalizeBotToken(t) {
  t = String(t || '').replace(/^\uFEFF/, '').trim();
  t = t.replace(/^["']+|["']+$/g, '').trim();
  t = t.replace(/^bot/i, '').trim();
  return t;
}
const WIDGET_SIGNED_KEYS = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];
function officialWidgetFields(raw) {
  const src = raw || {};
  const aliases = { firstName: 'first_name', lastName: 'last_name', photoUrl: 'photo_url', authDate: 'auth_date' };
  const tmp = {};
  for (const k of Object.keys(src)) tmp[aliases[k] || k] = src[k];
  const out = {};
  if (tmp.hash != null && String(tmp.hash) !== '') out.hash = String(tmp.hash);
  for (let i = 0; i < WIDGET_SIGNED_KEYS.length; i++) {
    const k = WIDGET_SIGNED_KEYS[i];
    if (tmp[k] != null && String(tmp[k]) !== '') out[k] = String(tmp[k]);
  }
  return out;
}
async function verifyTgLoginWidget(data, botToken) {
  try {
    const token = normalizeBotToken(botToken);
    const d = officialWidgetFields(data);
    const hash = String(d.hash || '').toLowerCase();
    if (!hash || !token) return false;
    async function hexOf(obj) {
      const keys = Object.keys(obj).filter(function (k) { return k !== 'hash'; }).sort();
      const dcs = keys.map(function (k) { return k + '=' + obj[k]; }).join('\n');
      const secret = await sha256Bytes(token);
      return bytesToHex(await hmacSha256Bytes(secret, dcs)).toLowerCase();
    }
    if ((await hexOf(d)) === hash) return true;
    if (d.photo_url && String(d.photo_url).indexOf('%') >= 0) {
      const d2 = Object.assign({}, d);
      try { d2.photo_url = decodeURIComponent(d.photo_url); } catch (e) { return false; }
      if ((await hexOf(d2)) === hash) return true;
    }
    return false;
  } catch (e) { return false; }
}

async function verifyTgInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const pairs = [...params.entries()].sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (e) { return e[0] + '=' + e[1]; });
    const dcs = pairs.join('\n');
    const secret = await hmacSha256Bytes(enc.encode('WebAppData'), enc.encode(botToken));
    const expected = bytesToHex(await hmacSha256Bytes(secret, enc.encode(dcs)));
    return expected.toLowerCase() === String(hash).toLowerCase();
  } catch (e) { return false; }
}

/* ═══════════════════════ ذخیره‌سازی (KV با جایگزینی حافظه‌ای) ═══════════════════════ */

const memFallback = new Map();
class Store {
  constructor(kv, env) { this.kv = kv || null; this.env = env || {}; this.reads = new Map(); }
  async get(k) {
    // One upstream read per key per request; callers cannot mutate the cached snapshot.
    if (!this.reads.has(k)) {
      const read = this.kv
        ? this.kv.get(k, /^(tick:|tg:|tgstate:|u:|ph:)/.test(k) ? { type: 'json', cacheTtl: 30 } : 'json')
        : Promise.resolve().then(function () {
          const entry = memFallback.get(k);
          if (!entry) return null;
          if (entry.expiresAt && entry.expiresAt <= Date.now()) { memFallback.delete(k); return null; }
          return JSON.parse(entry.value);
        });
      this.reads.set(k, Promise.resolve(read).then(function (v) { return v == null ? null : JSON.stringify(v); }));
    }
    try { const value = await this.reads.get(k); return value == null ? null : JSON.parse(value); }
    catch (e) { this.reads.delete(k); throw e; }
  }
  async set(k, v, ttl) {
    const value = JSON.stringify(v);
    // TTL writes must still refresh expiration, even if the value is unchanged.
    if (!ttl && this.reads.has(k) && await this.reads.get(k) === value) return;
    if (this.kv) await this.kv.put(k, value, ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : undefined);
    else memFallback.set(k, { value: value, expiresAt: ttl ? Date.now() + ttl * 1000 : 0 });
    this.reads.set(k, Promise.resolve(value));
  }
  async del(k) {
    if (this.kv) await this.kv.delete(k);
    else memFallback.delete(k);
    this.reads.set(k, Promise.resolve(null));
  }
  async listPage(prefix, cursor, limit) {
    limit = Math.max(1, Math.min(1000, Number(limit) || 1000));
    if (this.kv) {
      const r = await this.kv.list({ prefix: prefix, limit: limit, ...(cursor ? { cursor: cursor } : {}) });
      return { keys: r.keys.map(function (k) { return k.name; }), cursor: r.list_complete ? '' : r.cursor };
    }
    const keys = [];
    for (const [key, entry] of memFallback) {
      if (entry.expiresAt && entry.expiresAt <= Date.now()) { memFallback.delete(key); continue; }
      if (key.startsWith(prefix) && (!cursor || key > cursor)) keys.push(key);
    }
    keys.sort();
    const page = keys.slice(0, limit);
    return { keys: page, cursor: keys.length > limit ? page[page.length - 1] : '' };
  }
  async list(prefix) {
    const keys = [];
    let cursor = '';
    do { const page = await this.listPage(prefix, cursor, 1000); keys.push(...page.keys); cursor = page.cursor; } while (cursor);
    return keys;
  }
}

/* ═══════════════════════ تلگرام: ربات، صفحهٔ share ═══════════════════════ */

const ALLOWED_MEDIA_HOSTS = ['telesco.pe', 'cdn.telegram.org', 'o.tl', 'api.telegram.org'];
function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_MEDIA_HOSTS.some(function (x) { return h === x || h.endsWith('.' + x); });
  } catch (e) { return false; }
}
function isPublicHttpUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return false;
    if (h === '::' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\.|^169\.254\./.test(h)) return false;
    return true;
  } catch (e) { return false; }
}

function parseTmeLink(raw) {
  if (!raw || typeof raw !== 'string') return null;
  raw = raw.trim();
  let m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/c\/(\d{6,20})\/(\d{1,10})(?:[/?#].*)?$/i);
  if (m) return { user: '', msgId: m[2], chatId: '-100' + m[1], private: true };
  m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/s\/c\/(\d{6,20})\/(\d{1,10})(?:[/?#].*)?$/i);
  if (m) return { user: '', msgId: m[2], chatId: '-100' + m[1], private: true };
  m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\/(\d{1,10})(?:[/?#].*)?$/i);
  if (m) return { user: m[1], msgId: m[2], chatId: null, private: false };
  m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/s\/([A-Za-z][A-Za-z0-9_]{3,31})\/(\d{1,10})(?:[/?#].*)?$/i);
  if (m) return { user: m[1], msgId: m[2], chatId: null, private: false };
  return null;
}
function normalizeChannelId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^-100\d{6,20}$/.test(s)) return s;
  if (/^\d{6,20}$/.test(s)) return '-100' + s;
  const cm = String(s).match(/(?:^|\/)c\/(\d{6,20})(?:\/|$)/i);
  if (cm) return '-100' + cm[1];
  return s;
}
function extractVaultChatId(raw) {
  let s = String(raw || '').trim();
  if (/^-100\d{6,20}$/.test(s)) return s;
  s = s.replace(/^[—–•\-]+\s*/, '');
  if (!s) return '';
  const parsed = parseTmeLink(s);
  if (parsed && parsed.chatId) return normalizeChannelId(parsed.chatId);
  let m = s.match(/(?:t|telegram)\.me\/c\/(\d{6,20})/i);
  if (m) return '-100' + m[1];
  m = s.match(/^-100\d{6,20}$/);
  if (m) return s;
  m = s.match(/^\d{6,20}$/);
  if (m) return '-100' + s;
  return '';
}
function defaultVaultChatId(set) {
  if (!set) return '';
  const direct = extractVaultChatId(set.vaultChatId);
  if (direct) return direct;
  const blob = String(set.vaultRewriteEnv || set.vaultRewrite || '');
  const lines = blob.split(/[\n,;]+/);
  for (let i = 0; i < lines.length; i++) {
    let line = String(lines[i] || '').trim().replace(/^[—–•\-]+\s*/, '');
    if (!line || line.charAt(0) === '#') continue;
    const parts = line.split(/[\s:=]+/).filter(Boolean);
    if (parts.length === 1) {
      const id = extractVaultChatId(parts[0]);
      if (id) return id;
    } else if (parts.length >= 2) {
      const id = extractVaultChatId(parts[parts.length - 1]);
      const head = parts[0];
      if (id && (head.length <= 2 || /[—–]/.test(head) || head === '-' )) return id;
    }
  }
  return '';
}
function parseVersionLinks(raw) {
  const links = String(raw || '').split(/[,،;\n\r]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (!links.length || links.length > 10) throw new Error('برای هر نسخه بین ۱ تا ۱۰ لینک تلگرام وارد کنید');
  const seen = new Set(), parsed = [];
  for (let i = 0; i < links.length; i++) {
    // parseTmeLink is permissive for imported captions; this input must be a whole URL.
    if (!/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:c\/\d+|[A-Za-z0-9_]+)\/\d+\/?(?:\?[^\s,،;]*)?$/.test(links[i])) throw new Error('لینک شماره ' + (i + 1) + ' معتبر نیست');
    const p = parseTmeLink(links[i]);
    if (!p) throw new Error('لینک شماره ' + (i + 1) + ' معتبر نیست');
    const key = (p.chatId || String(p.user).toLowerCase()) + '/' + p.msgId;
    if (!seen.has(key)) { seen.add(key); parsed.push(p); }
  }
  return parsed;
}
function versionSources(source) {
  return source && Array.isArray(source.parts) && source.parts.length ? source.parts : (source ? [source] : []);
}
function hydrateSource(source, set) {
  if (!source) return source;
  let out = Object.assign({}, source);
  const link = out.tmeUrl || out.directUrl || '';
  if (link) {
    const p = parseTmeLink(link);
    if (p) {
      if (p.chatId && !out.chatId) out.chatId = p.chatId;
      if (p.user && !out.user) out.user = p.user;
      if (p.msgId && !out.msgId) out.msgId = p.msgId;
    } else {
      const cid = extractVaultChatId(link);
      if (cid && !out.chatId) out.chatId = cid;
    }
  }
  if (out.chatId) out.chatId = normalizeChannelId(out.chatId);
  if (!out.chatId && !out.user && out.msgId) {
    const def = defaultVaultChatId(set);
    if (def) out.chatId = def;
  }
  out = rewriteSource(out, set);
  if (out.chatId) out.chatId = normalizeChannelId(out.chatId);
  return out;
}
function sourceFromParsed(parsed, res) {
  res = res || {};
  if (!parsed) return null;
  if (parsed.private || parsed.chatId) {
    return {
      user: '',
      msgId: String(parsed.msgId),
      tmeUrl: '',
      chatId: normalizeChannelId(parsed.chatId),
      fileId: '',
      mediaType: res.kind || '',
    };
  }
  return {
    user: parsed.user || '',
    msgId: String(parsed.msgId || ''),
    tmeUrl: res.tmeUrl || (parsed.user ? ('https://t.me/' + parsed.user + '/' + parsed.msgId) : ''),
    chatId: parsed.chatId || null,
    fileId: '',
    mediaType: res.kind || '',
  };
}
function publicSourceUrl(src) {
  if (!src) return '';
  if (src.chatId && src.msgId) return 'https://t.me/c/' + String(src.chatId).replace(/^-100/, '') + '/' + src.msgId;
  if (src.user && src.msgId) return 'https://t.me/' + String(src.user).replace(/^@/, '') + '/' + src.msgId;
  const u = String(src.tmeUrl || '');
  if (u && u.indexOf('t.me//') < 0 && /t\.me\/(c\/\d+|[^/]+)\/\d+/.test(u)) return u;
  if (src.directUrl) return src.directUrl;
  return '';
}
function tgChatParam(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  return s;
}
function normVaultKey(s) {
  s = String(s || '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^(?:www\.)?(?:t|telegram)\.me\//i, '').replace(/^@+/, '');
  s = s.replace(/\/+$/, '');
  const cm = s.match(/^c\/(\d{6,20})$/i);
  if (cm) return '-100' + cm[1];
  if (/^\d{6,20}$/.test(s) || /^-100\d{6,20}$/.test(s)) return normalizeChannelId(s);
  return s.toLowerCase();
}
function parseRewriteMap(raw) {
  const map = {};
  String(raw || '').split(/[\n,;]+/).forEach(function (line) {
    line = String(line || '').trim();
    if (!line || line.charAt(0) === '#') return;
    const parts = line.split(/[\s:=]+/).filter(Boolean);
    if (parts.length < 2) return;
    const a = normVaultKey(parts[0]);
    const b = normVaultKey(parts[1]);
    if (a && b) map[a] = b;
  });
  return map;
}
function rewriteSource(source, set) {
  if (!source) return source;
  const map = Object.assign({}, parseRewriteMap(set && set.vaultRewrite), parseRewriteMap(set && set.vaultRewriteEnv));
  if (!Object.keys(map).length) return source;
  const out = Object.assign({}, source);
  const userKey = normVaultKey(out.user || '');
  if (userKey && map[userKey]) {
    const dest = map[userKey];
    if (/^-?\d+$/.test(dest) || /^-100/.test(dest)) {
      out.chatId = normalizeChannelId(dest);
      out.user = '';
      out.tmeUrl = '';
    } else {
      out.user = dest;
      if (out.msgId) out.tmeUrl = 'https://t.me/' + dest + '/' + out.msgId;
    }
  }
  const cid = String(out.chatId || '');
  if (cid && map[cid]) {
    const dest = map[cid];
    if (/^-?\d+$/.test(dest) || /^-100/.test(dest)) out.chatId = normalizeChannelId(dest);
    else {
      out.user = dest;
      if (out.msgId) out.tmeUrl = 'https://t.me/' + dest + '/' + out.msgId;
    }
  }
  return out;
}
function fileBotToken(set) {
  return (set && set.deliveryBotToken) || (set && set.botToken) || '';
}
function fileBotUsername(set) {
  if (set && set.deliveryBotToken && set.deliveryBotUsername) return set.deliveryBotUsername;
  return (set && set.botUsername) || '';
}

function cleanHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
function parseSize(n, u) {
  const nn = parseFloat(n);
  if (isNaN(nn)) return null;
  const m = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return Math.round(nn * (m[u] || 1));
}

async function resolvePost(store, user, msgId, force) {
  const key = 'res:' + user + '/' + msgId;
  if (!force) {
    const mc = memRes.get(key);
    if (mc && Date.now() - mc.t < 600000) return mc.data;
    const c = await store.get(key);
    if (c && c.kind) {
      memRes.set(key, { t: Date.now(), data: c });
      return c;
    }
  }
  const tmeUrl = 'https://t.me/' + user + '/' + msgId;
  let kind = 'none', mediaUrl = null, thumb = null, w = null, h = null, caption = '', sizeBytes = null, docName = null;
  try {
    const r = await fetch('https://t.me/s/' + user + '/' + msgId, { headers: { 'User-Agent': CONFIG.TG_UA, 'Accept': 'text/html' } });
    if (r.ok) {
      const html = await r.text();
      const re = new RegExp('data-post="' + user + '/' + msgId + '".*?(?=data-post="|$)', 's');
      const mm = html.match(re);
      const block = mm ? mm[0] : html;
      let v = block.match(/<video[^>]+src="([^"]+)"/);
      let a = null;
      if (!v) a = block.match(/<audio[^>]+src="([^"]+)"/);
      if (v) { kind = 'video'; mediaUrl = v[1]; }
      else if (a) { kind = 'audio'; mediaUrl = a[1]; }
      let t = block.match(/tgme_widget_message_video_thumb" style="background-image:url\('([^']+)'\)/);
      if (t) thumb = t[1];
      if (!thumb) {
        t = block.match(/tgme_widget_message_photo(?:_big|_square|_small)?[^>]*>\s*<i[^>]*style="background-image:url\('([^']+)'\)/);
        if (t) thumb = t[1];
      }
      const ww = block.match(/tgme_widget_message_(?:video|photo_big|photo_square|audio)_wrap" style="width:(\d+)px;padding-top:(\d+)%/);
      if (ww) { w = parseInt(ww[1], 10); h = Math.round(parseInt(ww[1], 10) * parseInt(ww[2], 10) / 100); }
      const c = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
      if (c) caption = cleanHtml(c[1]);
      const d1 = block.match(/tgme_widget_message_document_title[^>]*>([\s\S]*?)<\/div>/);
      const d2 = block.match(/tgme_widget_message_document_extra[^>]*>([\s\S]*?)<\/div>/);
      if (d1 || d2) {
        if (kind === 'none') kind = 'document';
        if (d1) docName = cleanHtml(d1[1]);
        if (d2) {
          const sz = cleanHtml(d2[1]).match(/([\d.]+)\s*(KB|MB|GB|TB|B)/);
          if (sz) sizeBytes = parseSize(sz[1], sz[2]);
        }
      }
    }
  } catch (e) { }
  if ((kind === 'video' || kind === 'audio') && mediaUrl) {
    try {
      const h2 = await fetch(mediaUrl, { method: 'HEAD', headers: { 'User-Agent': CONFIG.TG_UA } });
      const cl = h2.headers.get('content-length');
      if (cl) sizeBytes = parseInt(cl, 10);
    } catch (e) { }
  }
  const out = { kind: kind, mediaUrl: mediaUrl, thumb: thumb, w: w, h: h, caption: caption, sizeBytes: sizeBytes, docName: docName, tmeUrl: tmeUrl, at: Date.now() };
  await store.set(key, out, CONFIG.RES_TTL);
  memRes.set(key, { t: Date.now(), data: out });
  return out;
}

async function botApi(token, method, params, timeoutMs) {
  const url = 'https://api.telegram.org/bot' + token + '/' + method;
  const opts = { method: params ? 'POST' : 'GET' };
  if (params) {
    opts.headers = { 'content-type': 'application/json' };
    opts.body = JSON.stringify(params);
  }
  try {
    const ac = new AbortController();
    const timer = setTimeout(function () { ac.abort(); }, Math.max(3000, Number(timeoutMs) || 8000));
    opts.signal = ac.signal;
    const r = await fetch(url, opts);
    clearTimeout(timer);
    return await r.json();
  } catch (e) {
    return { ok: false, description: String((e && e.message) || e) };
  }
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
function tsToVtt(t) {
  let m = t.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (m) return m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4].padEnd(3, '0');
  m = t.match(/^(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (m) return '00:' + m[1] + ':' + m[2] + '.' + m[3].padEnd(3, '0');
  return t;
}
function looksLikeSrt(s) {
  return /^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}/.test(String(s || ''));
}

/* ═══════════════════════ مدل داده ═══════════════════════ */

function newItem(title, type, source, channelName) {
  return {
    id: 'i_' + randomHex(6),
    title: title || 'بدون عنوان',
    type: type || 'movie',
    year: new Date().getFullYear(),
    /* سریال: سال آخرین فصل (اختیاری) + وضعیت پخش */
    yearEnd: 0,
    airing: false,
    airingSeason: 0,
    airingText: '',
    quality: '',
    genres: [],
    access: 'free',
    views: 0,
    featured: false,
    director: '',
    actors: '',
    country: '',
    ageRating: '',
    network: '',
    imdb: 0,
    galleryUrl: '',
    galleryImages: [],
    galleryImagesUpdatedAt: 0,
    galleryLimit: CONFIG.GALLERY_LIMIT,
    duration: 0,
    dubbed: false,
    subtitled: false,
    censored: false,
    description: '',
    source: source || null,
    channelName: channelName || '',
    posterOverride: '',
    media: {},
    episodes: [],
    seasons: [],
    variants: { sub: {}, dub: {} },
    subs: [],
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
}
const QUALITY_KEYS = ['480', '720', '1080', '4k'];
function classicQualityKey(q) {
  const s = String(q || '').toLowerCase().trim();
  if (/^(4k|2160p?|uhd)$/.test(s)) return '4k';
  if (/^1080p?$/.test(s)) return '1080';
  if (/^720p?$/.test(s)) return '720';
  if (/^(480p?|360p?|540p?|sd)$/.test(s)) return '480';
  return '';
}
function qualityKey(q) {
  const s = String(q || '').trim();
  if (!s) return '';
  const c = classicQualityKey(s);
  if (c) return c;
  if (/^[a-zA-Z0-9_\-]{1,48}$/.test(s)) return s;
  return '';
}
function displayQuality(q, cell) {
  if (cell && cell.label) return String(cell.label);
  const k = classicQualityKey(q) || qualityKey(q);
  if (k === '4k') return '4K';
  if (k === '1080') return '1080p';
  if (k === '720') return '720p';
  if (k === '480') return '480p';
  return String(q || '');
}
function ensureVariants(bag) {
  if (!bag.variants || typeof bag.variants !== 'object') bag.variants = { sub: {}, dub: {} };
  if (!bag.variants.sub || typeof bag.variants.sub !== 'object') bag.variants.sub = {};
  if (!bag.variants.dub || typeof bag.variants.dub !== 'object') bag.variants.dub = {};
  return bag.variants;
}
function variantFilesOf(cell) {
  if (!cell || typeof cell !== 'object') return [];
  if (Array.isArray(cell.files) && cell.files.length) {
    return cell.files.filter(function (f) { return f && f.source; });
  }
  if (cell.source) {
    return [{ id: cell.fileId || '', title: cell.title || '', source: cell.source, sizeBytes: cell.sizeBytes || null }];
  }
  return [];
}
function cellHasFile(cell) {
  return variantFilesOf(cell).length > 0;
}
function setVariantCell(bag, track, quality, source, sizeBytes) {
  const v = ensureVariants(bag);
  const t = track === 'dub' ? 'dub' : 'sub';
  const q = qualityKey(quality);
  if (!q) return '';
  const prev = v[t][q] || {};
  let files = variantFilesOf(prev);
  function save(fl) {
    if (!fl.length) { delete v[t][q]; return q; }
    v[t][q] = { source: fl[0].source, sizeBytes: fl[0].sizeBytes || null, premium: !!prev.premium, label: prev.label || displayQuality(q, prev), files: fl };
    return q;
  }
  if (!source) {
    files = files.slice(1);
    return save(files);
  }
  if (files.length) {
    files[0] = { id: files[0].id || ('f_' + randomHex(3)), title: files[0].title || '', source: source, sizeBytes: sizeBytes || null };
  } else {
    files = [{ id: 'f_' + randomHex(3), title: '', source: source, sizeBytes: sizeBytes || null }];
  }
  return save(files);
}
function upsertVariantFile(bag, track, quality, opts) {
  opts = opts || {};
  const v = ensureVariants(bag);
  const t = track === 'dub' ? 'dub' : 'sub';
  const q = qualityKey(quality);
  if (!q) return '';
  const prev = v[t][q] || {};
  let files = variantFilesOf(prev);
  const title = String(opts.title || '').trim().slice(0, 220);
  const fileId = String(opts.fileId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  if (opts.remove) {
    files = files.filter(function (f) { return f.id !== fileId; });
  } else if (fileId) {
    let found = false;
    files = files.map(function (f) {
      if (f.id !== fileId) return f;
      found = true;
      return { id: f.id, title: title || f.title || '', source: opts.source || f.source, sizeBytes: opts.sizeBytes != null ? opts.sizeBytes : f.sizeBytes };
    });
    if (!found && opts.source) {
      files.push({ id: fileId || ('f_' + randomHex(3)), title: title, source: opts.source, sizeBytes: opts.sizeBytes || null });
    }
  } else if (opts.source) {
    files.push({ id: 'f_' + randomHex(3), title: title, source: opts.source, sizeBytes: opts.sizeBytes || null });
  }
  files = files.filter(function (f) { return f && f.source; });
  if (!files.length) { delete v[t][q]; return q; }
  v[t][q] = { source: files[0].source, sizeBytes: files[0].sizeBytes || null, premium: !!prev.premium, label: prev.label || displayQuality(q, prev), files: files };
  return q;
}
function setVariantPremium(bag, track, quality, on) {
  const v = ensureVariants(bag);
  const t = track === 'dub' ? 'dub' : 'sub';
  const q = qualityKey(quality);
  if (!q) return;
  if (!v[t][q]) v[t][q] = { source: null, sizeBytes: null };
  v[t][q].premium = !!on;
}
function qualityLabel(q) {
  const k = qualityKey(q);
  if (k === '4k') return '4K';
  if (k === '1080') return '1080p';
  if (k === '720') return '720p';
  if (k === '480') return '480p';
  return '';
}
function collectQualitiesFromBag(bag, set) {
  if (!bag) return;
  const v = bag.variants || {};
  ['sub', 'dub'].forEach(function (t) {
    Object.keys(v[t] || {}).forEach(function (q) {
      const cell = v[t][q];
      if (cell && (cell.source || cell.has || cellHasFile(cell))) {
        const lab = displayQuality(q, cell);
        if (lab) set[lab] = true;
      }
    });
  });
  if (bag.quality) {
    const lab = displayQuality(bag.quality);
    if (lab) set[lab] = true;
  }
}
function listItemQualities(item) {
  const set = {};
  collectQualitiesFromBag(item, set);
  (item.seasons || []).forEach(function (s) {
    (s.episodes || []).forEach(function (e) { collectQualitiesFromBag(e, set); });
  });
  (item.episodes || []).forEach(function (e) { collectQualitiesFromBag(e, set); });
  const classic = ['480p', '720p', '1080p', '4K'];
  const out = classic.filter(function (q) { return set[q]; });
  Object.keys(set).forEach(function (q) { if (out.indexOf(q) < 0) out.push(q); });
  return out;
}
function countSeasons(item) {
  if (item.seasons && item.seasons.length) return item.seasons.length;
  if (item.episodes && item.episodes.length) return 1;
  return 0;
}
function countEpisodes(item) {
  if (item.seasons && item.seasons.length) {
    return item.seasons.reduce(function (n, s) { return n + ((s.episodes || []).length); }, 0);
  }
  return (item.episodes || []).length;
}
function syncEpisodesFromSeasons(item) {
  if (item.seasons && item.seasons.length) {
    const all = [];
    item.seasons.forEach(function (s) { (s.episodes || []).forEach(function (e) { all.push(e); }); });
    item.episodes = all;
  }
}
function findEpisode(item, epId) {
  if (!epId) return null;
  const seasons = (item.seasons && item.seasons.length) ? item.seasons : [{ episodes: item.episodes || [] }];
  for (let i = 0; i < seasons.length; i++) {
    const ep = (seasons[i].episodes || []).find(function (e) { return e.id === epId; });
    if (ep) return ep;
  }
  return null;
}
function ensureSeason(item, n, title) {
  const num = parseInt(n, 10) || 1;
  item.seasons = item.seasons || [];
  let s = item.seasons.find(function (x) { return (x.n || 1) === num; });
  if (!s) {
    s = { n: num, title: title || ('فصل ' + num), episodes: [] };
    item.seasons.push(s);
    item.seasons.sort(function (a, b) { return (a.n || 1) - (b.n || 1); });
  } else if (title) s.title = title;
  return s;
}
function publicVariantMap(bag, fallbackQuality) {
  const out = { sub: {}, dub: {} };
  const v = (bag && bag.variants) || {};
  ['sub', 'dub'].forEach(function (t) {
    const src = v[t] || {};
    Object.keys(src).forEach(function (q) {
      const cell = src[q];
      const files = variantFilesOf(cell);
      if (cell && (cell.source || cell.has || files.length)) {
        out[t][qualityKey(q) || q] = {
          has: true,
          label: displayQuality(q, cell),
          sizeBytes: cell.sizeBytes || (files[0] && files[0].sizeBytes) || null,
          premium: !!cell.premium,
          files: files.map(function (f) {
            return { id: f.id || '', title: f.title || '', sizeBytes: f.sizeBytes || null, has: true };
          }),
        };
      }
    });
  });
  const hasAny = Object.keys(out.sub).length + Object.keys(out.dub).length;
  if (!hasAny && bag && bag.source) {
    const q = qualityKey((bag.quality || fallbackQuality)) || '1080';
    out.sub[q] = { has: true, sizeBytes: bag.sizeBytes || (bag.media && bag.media.sizeBytes) || null, files: [] };
  }
  return out;
}
function publicSeasons(item) {
  const seasons = (item.seasons && item.seasons.length)
    ? item.seasons
    : ((item.episodes && item.episodes.length) ? [{ n: 1, title: 'فصل ۱', episodes: item.episodes }] : []);
  return seasons.map(function (s) {
    return {
      n: s.n || 1,
      title: s.title || ('فصل ' + (s.n || 1)),
      episodes: (s.episodes || []).map(function (e) {
        return {
          id: e.id,
          n: e.n || 0,
          title: e.title,
          sizeBytes: e.sizeBytes || null,
          premium: !!e.premium,
          variants: publicVariantMap(e, item.quality),
        };
      }),
    };
  });
}
function pickDownloadSource(item, opts) {
  opts = opts || {};
  const track = opts.track === 'dub' ? 'dub' : 'sub';
  const want = qualityKey(opts.quality);
  const wantFile = String(opts.fileId || '').replace(/[^a-zA-Z0-9_]/g, '');
  let bag = item;
  if (opts.epId) {
    const ep = findEpisode(item, opts.epId);
    if (!ep) return { error: 'قسمت پیدا نشد' };
    bag = ep;
  }
  const order = want ? [want] : Object.keys(((bag.variants || {})[track]) || {}).concat(['1080', '720', '480', '4k']);
  function pickFromCell(cell, t, k) {
    const files = variantFilesOf(cell);
    let f = null;
    if (wantFile) {
      for (let i = 0; i < files.length; i++) if (files[i].id === wantFile) f = files[i];
      if (!f && cell && cell.source && !files.length) f = { source: cell.source, title: '' };
      if (!f) return null;
    } else {
      f = files[0] || (cell && cell.source ? { source: cell.source, title: '' } : null);
    }
    if (!f || !f.source) return null;
    return { source: f.source, track: t, quality: k, premium: !!(cell.premium || bag.premium), fileId: f.id || '', title: f.title || '' };
  }
  function fromTrack(t) {
    const v = ((bag.variants || {})[t]) || {};
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      if (!v[k]) continue;
      const got = pickFromCell(v[k], t, k);
      if (got) return got;
    }
    return null;
  }
  const picked = fromTrack(track) || fromTrack(track === 'dub' ? 'sub' : 'dub');
  if (picked) return picked;
  if (bag.source && (!want || !qualityKey(bag.quality) || qualityKey(bag.quality) === want)) {
    return { source: bag.source, track: track, quality: want || qualityKey(bag.quality) || '', premium: !!bag.premium };
  }
  if (!want && item.source && item !== bag) {
    return { source: item.source, track: track, quality: '', premium: false };
  }
  return { error: 'فایل این کیفیت موجود نیست' };
}
function walkSources(item, cb) {
  const visit = cb;
  cb = function (source) { versionSources(source).forEach(visit); };
  if (item.source) cb(item.source);
  function walkBag(bag) {
    if (bag.source) cb(bag.source);
    const v = bag.variants || {};
    ['sub', 'dub'].forEach(function (t) {
      Object.keys(v[t] || {}).forEach(function (q) {
        const cell = v[t][q];
        if (cell && cell.source) cb(cell.source);
        variantFilesOf(cell).forEach(function (f) { if (f.source) cb(f.source); });
      });
    });
  }
  (item.episodes || []).forEach(walkBag);
  (item.seasons || []).forEach(function (s) { (s.episodes || []).forEach(walkBag); });
  walkBag(item);
}
function buildFileCaption(set, item) {
  let cap = String((set && set.fileCaption) || '').trim();
  if (!cap) {
    cap = '🔥 دانلود کامل این فیلم و هزاران سریال بروز دنیا در ربات شاتل‌آپ 👇\n🤖 @movie_shatelup_bot | جدیدترین اخبار سینما: @movie_shatelup 🎭';
  }
  const bot = (set && set.botUsername) ? ('@' + set.botUsername.replace(/^@/, '')) : '';
  cap = cap.split('{{title}}').join((item && item.title) || '').split('{{bot}}').join(bot);
    return cap.slice(0, 1024);
}
function buildMediaCaption(set, item) {
  return buildFileCaption(set, item);
}
function adKeyboard(set) {
  if (!set || set.adEnabled === false) return null;
  const url = String(set.adButtonUrl || '').trim();
  const text = String(set.adButtonText || '').trim() || 'باز کردن';
  if (!/^https?:\/\//i.test(url)) return null;
  return { inline_keyboard: [[{ text: text.slice(0, 64), url: url.slice(0, 300) }]] };
}
/* ═══════════════════════ سیستم تبلیغات (بنری/ویدئویی) ═══════════════════════ */

const memAds = new Map();

function adClampSec(n) {
  const v = Math.round(Number(n) || 0);
  if (!isFinite(v) || v <= 0) return CONFIG.AD_MAX_SEC;
  return Math.max(CONFIG.AD_MIN_SEC, Math.min(CONFIG.AD_MAX_SEC, v));
}
function adKind(k) {
  return String(k || '').toLowerCase() === 'video' ? 'video' : 'banner';
}
/* ابعاد فایل تبلیغ که پنل مدیریت اندازه‌گیری می‌کند (پیکسل)؛ ۰ = نامشخص */
function adDim(n) {
  const v = Math.round(Number(n) || 0);
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(20000, v);
}
function adSpecOf(kind) {
  const s = CONFIG.AD_SPEC || {};
  return (kind === 'video' ? s.video : s.banner) || {};
}
/* نسبت مجاز با ابعاد پیشنهادی (۱٪ خطای گرد کردن + تلورانس) */
function adRatioOk(kind, w, h) {
  const spec = adSpecOf(kind);
  if (!spec.w || !spec.h || !w || !h) return null;
  const want = spec.w / spec.h;
  const got = w / h;
  if (!isFinite(got) || !got) return false;
  return Math.abs(got - want) / want <= 0.06;
}
function adSafeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https:\/\//i.test(s)) return '';
  if (!isPublicHttpUrl(s)) return '';
  return s.slice(0, 600);
}
function normalizeAd(a) {
  const kind = adKind(a && a.kind);
  return {
    id: String((a && a.id) || ''),
    title: String((a && a.title) || '').slice(0, 90),
    kind: kind,
    mediaUrl: adSafeUrl(a && a.mediaUrl),
    posterUrl: adSafeUrl(a && a.posterUrl),
    linkUrl: adSafeUrl(a && a.linkUrl),
    cta: String((a && a.cta) || '').slice(0, 60),
    sec: adClampSec(a && a.sec),
    w: adDim(a && a.w),
    h: adDim(a && a.h),
    once: !!(a && a.once),
    muted: (a && a.muted) === false ? false : true,
    active: (a && a.active) === false ? false : true,
    weight: Math.max(1, Math.min(100, Math.round(Number(a && a.weight) || 1))),
    createdAt: Number(a && a.createdAt) || Date.now(),
    updatedAt: Number(a && a.updatedAt) || 0,
  };
}
async function getAds(store) {
  const c = memAds.get('ads');
  if (c && Date.now() - c.t < 30000) return c.list;
  const raw = (await store.get('ads')) || [];
  const list = (Array.isArray(raw) ? raw : []).map(normalizeAd).filter(function (a) { return a.id; });
  memAds.set('ads', { t: Date.now(), list: list });
  return list;
}
function bustAds() { memAds.delete('ads'); }
async function saveAds(store, list) {
  const clean = list.slice(0, CONFIG.AD_MAX_COUNT).map(normalizeAd).filter(function (a) { return a.id; });
  await store.set('ads', clean);
  bustAds();
  return clean;
}
async function getAdStat(store, id) {
  const s = (await store.get('adstat:' + id)) || {};
  return { views: Number(s.views) || 0, clicks: Number(s.clicks) || 0 };
}
async function bumpAdStat(store, id, field, by) {
  const s = await getAdStat(store, id);
  s[field] = (Number(s[field]) || 0) + (by || 1);
  await store.set('adstat:' + id, s);
  return s;
}
function adSeenMap(user) {
  const m = user && user.adSeen;
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}
function markAdSeen(user, adId) {
  const m = adSeenMap(user);
  m[adId] = Date.now();
  const keys = Object.keys(m);
  if (keys.length > 200) {
    keys.sort(function (a, b) { return (m[a] || 0) - (m[b] || 0); });
    for (let i = 0; i < keys.length - 200; i++) delete m[keys[i]];
  }
  user.adSeen = m;
}
function adIsPlayable(a) {
  return !!(a && a.active && a.mediaUrl && a.id);
}
function pickAdForUser(list, user) {
  const seen = adSeenMap(user);
  const pool = list.filter(function (a) {
    if (!adIsPlayable(a)) return false;
    if (a.once && seen[a.id]) return false;
    return true;
  });
  if (!pool.length) return null;
  let total = 0;
  for (let i = 0; i < pool.length; i++) total += pool[i].weight || 1;
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= (pool[i].weight || 1);
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
function publicAd(a) {
  return {
    id: a.id,
    title: a.title || '',
    kind: a.kind,
    mediaUrl: a.mediaUrl,
    posterUrl: a.posterUrl || '',
    cta: a.cta || '',
    sec: a.sec,
    muted: a.muted !== false,
    clickable: !!a.linkUrl,
  };
}
function adGateInfo(set) {
  return {
    btnText: String(set.adGateBtnText || '').trim() || '🚫 حذف تبلیغ‌ها',
    title: String(set.adGateTitle || '').trim() || 'دانلود بدون تبلیغ، فقط با اشتراک',
    note: String(set.adGateNote || '').trim(),
  };
}

function itemHasTrack(item, track) {
  if (track === 'dub' && item.dubbed) return true;
  if (track === 'sub' && item.subtitled) return true;
  function bagHas(bag) {
    const v = bag && bag.variants && bag.variants[track];
    if (!v) return false;
    return Object.keys(v).some(function (k) { return v[k] && (v[k].source || v[k].has); });
  }
  if (bagHas(item)) return true;
  const seasons = item.seasons || [];
  for (let i = 0; i < seasons.length; i++) {
    const eps = seasons[i].episodes || [];
    for (let j = 0; j < eps.length; j++) if (bagHas(eps[j])) return true;
  }
  const eps = item.episodes || [];
  for (let i = 0; i < eps.length; i++) if (bagHas(eps[i])) return true;
  return false;
}
async function idxUpsert(store, item) {
  const idx = await getIdx(store);
  const entry = {
    id: item.id, title: item.title, type: item.type, year: item.year, quality: item.quality,
    yearEnd: parseInt(item.yearEnd, 10) || 0,
    airing: !!(item.airing && item.type === 'series'),
    airingSeason: parseInt(item.airingSeason, 10) || 0,
    airingText: String(item.airingText || '').slice(0, 80),
    access: item.access, featured: !!item.featured, addedAt: item.addedAt,
    genres: item.genres || [], epCount: countEpisodes(item),
    seasonCount: countSeasons(item),
    views: item.views || 0,
    qualities: listItemQualities(item),
    desc: (item.description || '').slice(0, 140),
    posterOverride: item.posterOverride || '',
    posterSrc: (item.source && item.source.tmeUrl) ? item.source.tmeUrl : '',
    galleryPoster: galleryPosterOf(item),
    sizeBytes: (item.media && item.media.sizeBytes) ? item.media.sizeBytes : null,
    director: item.director || '',
    actors: item.actors || '',
    country: item.country || '',
    ageRating: item.ageRating || '',
    network: item.network || '',
    imdb: Number(item.imdb) || 0,
    duration: parseInt(item.duration, 10) || 0,
    dubbed: !!(item.dubbed || itemHasTrack(item, 'dub')),
    subtitled: !!(item.subtitled || itemHasTrack(item, 'sub')),
    censored: !!item.censored,
  };
  const i = idx.findIndex(function (x) { return x.id === item.id; });
  if (i >= 0) idx[i] = entry; else idx.unshift(entry);
  await store.set('idx', idx.slice(0, CONFIG.MAX_ITEMS));
  bustIdx();
}
function guessQuality(w) {
  if (!w) return '';
  if (w >= 2560) return '4K';
  if (w >= 1280) return '1080p';
  if (w >= 760) return '720p';
  if (w >= 560) return '540p';
  return '480p';
}

function hasActiveSub(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'premium') return true;
  const until = Number(user.subUntil) || 0;
  return until > Date.now();
}
function downloadPrice(user, set) {
  if (hasActiveSub(user)) return 0;
  const n = Number(set && set.dlClickPrice);
  return (isFinite(n) && n > 0) ? n : 0;
}
function allowed(user, item, set) {
  if (!user) return set && set.requireLogin === false;
  if (hasActiveSub(user)) return true;
  return item.access !== 'premium';
}
function maskPhone(p) {
  p = String(p || '');
  if (p.length < 8) return '****';
  return p.slice(0, 4) + '***' + p.slice(-2);
}
function pubUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, role: u.role, email: u.email || '',
    tgId: !!u.tgId, tgName: u.tgName || '',
    tgUsername: u.tgUsername || '',
    photo: u.photoUrl || '',
    phone: u.phone ? maskPhone(u.phone) : '',
    wallet: u.wallet || 0,
    subUntil: u.subUntil || 0,
    subPlan: u.subPlan || '',
    refCode: u.refCode || '',
    refCount: u.refCount || 0,
    createdAt: u.createdAt, lastLogin: u.lastLogin || 0,
  };
}
function normPhone(p) {
  p = String(p || '').replace(/[^\d+]/g, '');
  if (p.indexOf('00') === 0) p = '+' + p.slice(2);
  if (p.indexOf('+98') === 0) p = '0' + p.slice(3);
  if (p.indexOf('98') === 0 && p.length >= 12) p = '0' + p.slice(2);
  return p;
}
function normTgUser(s) {
  return String(s || '').replace(/^@+/, '').trim().toLowerCase();
}
function looksLikePhone(raw) {
  const n = normPhone(raw);
  return n.length >= 10 && /^\+?\d+$/.test(n);
}
function userHasPaidPurchase(user) {
  if (!user) return false;
  if (user.hasPaidPurchase || (Number(user.paidPurchases) || 0) > 0) return true;
  const txs = user.txs || [];
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    if (t && t.amount > 0 && (t.type === 'stars' || t.type === 'rial')) return true;
  }
  return false;
}
function canTransferCoins(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return userHasPaidPurchase(user);
}
async function indexUserHandles(store, user) {
  if (!user) return;
  const handle = normTgUser(user.tgUsername);
  if (handle) await store.set('tgu:' + handle, user.username);
  if (user.phone) await store.set('ph:' + user.phone, user.username);
}
async function resolveTransferDest(store, toRaw) {
  const raw = String(toRaw || '').trim();
  if (!raw) return null;
  if (looksLikePhone(raw)) {
    const mapped = await store.get('ph:' + normPhone(raw));
    if (mapped) {
      const u = await getUser(store, mapped);
      if (u) return u;
    }
  }
  const handle = normTgUser(raw);
  if (!handle) return null;
  const mapped = await store.get('tgu:' + handle);
  if (mapped) {
    const u = await getUser(store, mapped);
    if (u && normTgUser(u.tgUsername) === handle) return u;
  }
  const byUser = await getUser(store, handle);
  if (byUser) return byUser;
  const keys = await store.list('u:');
  const max = Math.min(keys.length, 2000);
  for (let i = 0; i < max; i++) {
    const u = await store.get(keys[i]);
    if (u && normTgUser(u.tgUsername) === handle) {
      await store.set('tgu:' + handle, u.username);
      return u;
    }
  }
  return null;
}
function genRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
function addTxLocal(user, amount, type, note) {
  user.txs = user.txs || [];
  user.txs.unshift({ t: Date.now(), amount: amount, type: type, note: note || '' });
  if (user.txs.length > 40) user.txs = user.txs.slice(0, 40);
}
async function creditWallet(store, user, amount, type, note) {
  amount = round2(amount);
  if (!(amount > 0)) return { error: 'مبلغ نامعتبر' };
  user.wallet = round2((user.wallet || 0) + amount);
  addTxLocal(user, amount, type, note);
  await saveUser(store, user);
  return { ok: true, wallet: user.wallet };
}
async function debitWallet(store, user, amount, type, note) {
  amount = round2(amount);
  if (!(amount > 0)) return { error: 'مبلغ نامعتبر' };
  if (round2(user.wallet || 0) < amount) return { error: 'موجودی کافی نیست', wallet: user.wallet || 0, need: amount };
  user.wallet = round2((user.wallet || 0) - amount);
  addTxLocal(user, -amount, type, note);
  await saveUser(store, user);
  return { ok: true, wallet: user.wallet };
}
async function rewardReferrer(store, user, purchaseAmount, why) {
  if (!user || !user.referrer) return 0;
  const set = await getSettings(store);
  const pct = Number(set.refPurchasePercent);
  if (!(pct > 0)) return 0;
  const bonus = round2(purchaseAmount * pct / 100);
  if (!(bonus > 0)) return 0;
  const ref = await getUser(store, user.referrer);
  if (!ref) return 0;
  await creditWallet(store, ref, bonus, 'ref_purchase', 'سهم معرفی از خرید سکهٔ «' + (user.tgName || user.username) + '»' + (why ? (' — ' + why) : ''));
  return bonus;
}
async function creditPurchasedCoins(store, user, units, type, note) {
  user.hasPaidPurchase = true;
  user.paidPurchases = (Number(user.paidPurchases) || 0) + 1;
  const r = await creditWallet(store, user, units, type, note);
  if (r && !r.error) await rewardReferrer(store, user, units, note || 'شارژ کیف پول');
  return r;
}
async function payFromWallet(store, user, amount, type, note) {
  return debitWallet(store, user, amount, type, note);
}

function planMeta(set, plan) {
  const map = {
    '1m': { days: 30, price: Number(set.sub1m) || 0, title: 'یک‌ماهه' },
    '3m': { days: 90, price: Number(set.sub3m) || 0, title: 'سه‌ماهه' },
    '6m': { days: 180, price: Number(set.sub6m) || 0, title: 'شش‌ماهه' },
    '1y': { days: 365, price: Number(set.sub1y) || 0, title: 'یک‌ساله' },
  };
  return map[plan] || null;
}
function publicEconomy(set) {
  return {
    unit: set.walletUnitName || 'سکه',
    dlClickPrice: Number(set.dlClickPrice) || 0,
    vanishSec: Number(set.vanishSec) || CONFIG.VANISH_SEC,
    refSignupBonus: Number(set.refSignupBonus) || 0,
    refPurchasePercent: Number(set.refPurchasePercent) || 0,
    plans: {
      '1m': Number(set.sub1m) || 0,
      '3m': Number(set.sub3m) || 0,
      '6m': Number(set.sub6m) || 0,
      '1y': Number(set.sub1y) || 0,
    },
    starPacks: set.starPacks || [],
    rialPacks: [],
    starsEnabled: set.starsEnabled !== false,
    rialEnabled: false,
    starShops: Array.isArray(set.starShops) ? set.starShops : [],
    k2kEnabled: !!(set.k2kEnabled && set.k2kCardNumber),
    k2kPacks: Array.isArray(set.k2kPacks) ? set.k2kPacks : [],
    k2kTtlSec: Number(set.k2kTtlSec) || 1800,
    botUsername: set.botUsername || '',
    botId: set.botId || 0,
  };
}
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toEnDigits(s) {
  return String(s == null ? '' : s).replace(/[۰-۹]/g, function (ch) {
    return String(FA_DIGITS.indexOf(ch));
  }).replace(/[٠-٩]/g, function (ch) {
    return String(AR_DIGITS.indexOf(ch));
  });
}
function digitsOnly(s) {
  return toEnDigits(s).replace(/\D/g, '');
}
function formatCardNumber(s) {
  const d = digitsOnly(s).slice(0, 16);
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}
// Validate the complete list: never silently drop a mistyped price.
function parseStarPacks(value) {
  let rows = value;
  if (typeof value === 'string') {
    rows = value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
      const parts = line.split('|');
      if (parts.length !== 2) throw new Error('هر خط بسته استارز باید به صورت «استارز | سکه» باشد');
      return { stars: parts[0], units: parts[1] };
    });
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8) throw new Error('بین ۱ تا ۸ بسته استارز وارد کنید؛ برای توقف فروش، شارژ با استارز را غیرفعال کنید');
  function positiveInteger(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return NaN;
    const text = toEnDigits(value).trim();
    if (!/^[0-9]+$/.test(text)) return NaN;
    const n = Number(text);
    return Number.isSafeInteger(n) && n > 0 ? n : NaN;
  }
  return rows.map(function (row, i) {
    const stars = positiveInteger(row && row.stars);
    const units = positiveInteger(row && row.units);
    if (!Number.isFinite(stars) || !Number.isFinite(units) || stars > 10000) throw new Error('بسته ' + (i + 1) + ': استارز باید عدد صحیح ۱ تا ۱۰۰۰۰ و سکه عدد صحیح مثبت باشد');
    return { stars: stars, units: units };
  });
}
function parseK2kPacksText(text) {
  return String(text || '').split('\n').map(function (line) {
    const p = String(line || '').split('|').map(function (x) { return x.trim(); });
    const toman = Number(toEnDigits(p[0] || '').replace(/[^\d.]/g, ''));
    const units = Number(toEnDigits(p[1] || '').replace(/[^\d.]/g, ''));
    if (!(toman > 0) || !(units > 0)) return null;
    return { toman: Math.round(toman), units: Math.round(units) };
  }).filter(Boolean).slice(0, 12);
}
function parseBamDeposit(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const t = toEnDigits(raw).replace(/[\u066C\u060C٬]/g, ',');
  if (!/واریز|بانک\s*ملی|بام|bam|baam|کارت|حساب|مانده|مبلغ/i.test(t)) return null;
  if (/برداشت|خرید\s|پرداخت\s+از/.test(t) && !/واریز|\+/.test(t)) return null;
  const reList = [
    /مبلغ\s*[:：]?\s*([+]?\s*[\d][\d,\s._]{2,})\s*(ریال|ريال|rial|تومان|تومن|toman)?/i,
    /واریز(?:\s*به\s*(?:کارت|حساب))?\s*[:：]?\s*([+]?\s*[\d][\d,\s._]{2,})\s*(ریال|ريال|rial|تومان|تومن|toman)?/i,
    /(?:^|[^\d])\+\s*([\d][\d,\s._]{2,})\s*(ریال|ريال|rial|تومان|تومن|toman)?/i,
    /([\d][\d,]{4,})\s*(ریال|ريال|rial)/i,
  ];
  let amount = 0;
  let unit = '';
  for (let i = 0; i < reList.length; i++) {
    const m = t.match(reList[i]);
    if (!m) continue;
    amount = parseInt(String(m[1]).replace(/[^\d]/g, ''), 10) || 0;
    unit = m[2] || '';
    if (amount > 0) break;
  }
  if (!(amount > 0)) return null;
  const toman = /توم/i.test(unit) || String(unit).toLowerCase() === 'toman';
  const tm = t.match(/(?:ساعت\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  let hhmm = '';
  if (tm && Number(tm[1]) <= 23 && Number(tm[2]) <= 59) {
    hhmm = ('0' + tm[1]).slice(-2) + ':' + tm[2];
  }
  return {
    amount: amount,
    amountRial: toman ? amount * 10 : amount,
    unit: toman ? 'toman' : 'rial',
    time: hhmm,
    raw: raw.slice(0, 2000),
  };
}
function k2kRialCandidates(amount, unit) {
  const n = Math.round(Number(amount) || 0);
  const out = [];
  const u = String(unit || '').toLowerCase();
  if (u.indexOf('توم') >= 0 || u === 'toman') out.push(n * 10);
  else if (u === 'rial' || u.indexOf('ریال') >= 0 || u.indexOf('ريال') >= 0) out.push(n);
  else {
    out.push(n, n * 10);
    if (n % 10 === 0) out.push(n / 10);
  }
  const seen = {};
  const uniq = [];
  for (let i = 0; i < out.length; i++) {
    const x = Math.round(out[i]);
    if (x > 0 && !seen[x]) { seen[x] = 1; uniq.push(x); }
  }
  return uniq;
}
function secretsEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function botIdFromToken(token) {
  const m = normalizeBotToken(token).match(/^(\d+):/);
  return m ? parseInt(m[1], 10) : 0;
}
function botLink(set, payload) {
  const u = (set && set.botUsername) || '';
  if (!u) return '';
  return 'https://t.me/' + u + (payload ? ('?start=' + encodeURIComponent(payload)) : '');
}
function fileBotLink(set, payload) {
  const u = fileBotUsername(set);
  if (!u) return '';
  return 'https://t.me/' + u + (payload ? ('?start=' + encodeURIComponent(payload)) : '');
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function stripLeadJunk(line) {
  return String(line || '').replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, '').trim();
}
function emptyish(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (s === '-' || s === '—' || s === '–' || s === '•' || low === 'n/a' || low === 'na' || s === 'ندارد' || s === 'نامشخص') return '';
  return s;
}
function firstYear(s) {
  const m = String(s || '').match(/\b((?:19|20)\d{2})\b/);
  return m ? parseInt(m[1], 10) : 0;
}
function parseImdbVal(s) {
  const m = String(s || '').match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:\/\s*10)?/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!(n > 0) || n > 10) return 0;
  return Math.round(n * 10) / 10;
}
function parseDurationVal(s) {
  s = String(s || '');
  let min = 0;
  const h = s.match(/(\d+)\s*(?:ساعت|hour|hr)/i);
  const m = s.match(/(\d+)\s*(?:دقیقه|min|minute)/i);
  if (h) min += parseInt(h[1], 10) * 60;
  if (m) min += parseInt(m[1], 10);
  if (min) return min;
  const only = s.match(/^(\d{2,3})$/);
  if (only) {
    const n = parseInt(only[1], 10);
    if (n >= 20 && n <= 500) return n;
  }
  return 0;
}
function splitGenres(s) {
  return String(s || '').split(/[,،|/•]+/).map(function (x) { return x.trim(); }).filter(function (x) {
    if (!x || x.length > 40) return false;
    return !/^(480p?|720p?|1080p?|2160p?|4k|uhd|bluray|web-?dl|webrip|hdrip|x265|x264|10bit|hdr)$/i.test(x);
  }).slice(0, 10);
}
/* قالب کانال: «فا | En ، فا2 | En2» یا «فا، فا2 | En, En2» → «فا | En ، فا2 | En2» */
function formatBilingualList(raw, maxLen) {
  let s = emptyish(String(raw || ''));
  if (!s) return '';
  s = s.replace(/\s*[|｜]\s*/g, ' | ').replace(/\s+/g, ' ').trim();
  maxLen = maxLen || 500;

  // از قبل جفت‌شده: «فا | En ، فا2 | En2»
  if (/\|\s*[A-Za-z]/.test(s) && /[،,]/.test(s)) {
    const pairs = s.split(/\s*[،,]\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (pairs.length >= 2 && pairs.every(function (p) { return /\|/.test(p); })) {
      return pairs.join(' ، ').slice(0, maxLen);
    }
  }

  // یک جفت ساده: «فا | En»
  if (/\|/.test(s) && !/[،,]/.test(s)) {
    const parts = s.split(/\s*\|\s*/);
    if (parts.length === 2) {
      const a = parts[0].trim();
      const b = parts[1].trim();
      if (a && b) return (a + ' | ' + b).slice(0, maxLen);
    }
    return s.slice(0, maxLen);
  }

  // دو سمت جدا با | : «فا1، فا2 | En1, En2»
  if (/\|/.test(s)) {
    const sides = s.split(/\s*\|\s*/);
    if (sides.length === 2) {
      const fa = sides[0].split(/\s*[،,]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
      const en = sides[1].split(/\s*[،,]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (fa.length && en.length) {
        const n = Math.max(fa.length, en.length);
        const out = [];
        for (let i = 0; i < n; i++) {
          const a = fa[i] || '';
          const b = en[i] || '';
          if (a && b) out.push(a + ' | ' + b);
          else if (a) out.push(a);
          else if (b) out.push(b);
        }
        if (out.length) return out.join(' ، ').slice(0, maxLen);
      }
    }
  }
  return s.slice(0, maxLen);
}
function cleanDescNoise(text) {
  let d = String(text || '').trim();
  if (!d) return '';
  // حذف CTA و برند کانال از توضیحات سایت
  d = d.replace(/📥\s*/g, '');
  d = d.replace(/برای\s*دانلود\s*و\s*تماشای\s*آنلاین[^\n]*/gi, '');
  d = d.replace(/برای\s*دانلود[^\n]*/gi, '');
  d = d.replace(/تماشای\s*آنلاین[^\n]*/gi, '');
  d = d.replace(/کلیک\s*کنید[^\n]*/gi, '');
  d = d.replace(/@?movie_shatelup(?:_bot)?/gi, '');
  d = d.replace(/https?:\/\/t\.me\/\S+/gi, '');
  d = d.replace(/\n{2,}/g, '\n').trim();
  // خطوط خالی/بی‌معنی را حذف کن
  d = d.split('\n').map(function (l) { return l.trim(); }).filter(function (l) {
    if (!l) return false;
    if (/^[-–—•▪️]+$/.test(l)) return false;
    if (/دانلود|تماشای\s*آنلاین|کلیک\s*کنید|movie_shatelup/i.test(l)) return false;
    return true;
  }).join('\n').trim();
  return d.slice(0, 1200);
}
function parseInfoCaption(raw) {
  const src = toEnDigits(String(raw || '')).replace(/\u200c/g, '').replace(/\r/g, '');
  const lines = src.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const out = {
    title: '', year: 0, genres: [], director: '', actors: '', country: '',
    ageRating: '', network: '', imdb: 0, duration: 0, type: '',
    dubbed: false, subtitled: false, description: '', poster: '',
  };
  const blob = src;
  if (/دوبله/.test(blob) && !/بدون\s*دوبله/.test(blob)) out.dubbed = true;
  if (/زیرنویس/.test(blob)) out.subtitled = true;
  if (/سریال|season\s*\d|فصل\s*\d|قسمت\s*\d/i.test(blob)) out.type = 'series';
  else if (/فیلم|movie/i.test(blob)) out.type = 'movie';

  const pairs = [
    { field: 'titleFa', keys: ['نام فارسی', 'عنوان فارسی', 'persian title', 'persian name', 'farsi title'] },
    { field: 'title', keys: ['نام فیلم', 'نام سریال', 'نام اثر', 'عنوان فیلم', 'عنوان سریال', 'عنوان اثر', 'title', 'name'] },
    { field: 'titleEn', keys: ['نام انگلیسی', 'عنوان انگلیسی', 'english title', 'english name'] },
    { field: 'director', keys: ['کارگردان', 'کارگردانی', 'director'] },
    { field: 'actors', keys: ['بازیگران', 'ستارگان', 'ستاره ها', 'ستاره‌ها', 'بازیگر', 'actors', 'cast', 'stars'] },
    { field: 'country', keys: ['محصول کشور', 'کشور سازنده', 'محصول', 'کشور', 'ساخت', 'country'] },
    { field: 'ageRating', keys: ['رده سنی', 'رده‌سنی', 'سن پخش', 'age rating', 'rated'] },
    { field: 'network', keys: ['شبکه پخش', 'پلتفرم', 'شبکه', 'network', 'channel'] },
    { field: 'genres', keys: ['ژانر', 'سبک', 'genre'] },
    { field: 'year', keys: ['سال تولید', 'سال ساخت', 'سال انتشار', 'سال', 'year'] },
    { field: 'imdb', keys: ['امتیاز imdb', 'imdb score', 'امتیاز', 'نمره', 'imdb'] },
    { field: 'duration', keys: ['مدت زمان', 'زمان فیلم', 'مدت', 'زمان', 'runtime', 'duration'] },
    { field: 'description', keys: ['خلاصه داستان', 'داستان فیلم', 'خلاصه', 'توضیحات', 'داستان', 'synopsis', 'plot', 'overview'] },
  ];
  const flat = [];
  pairs.forEach(function (p) {
    p.keys.forEach(function (k) { flat.push({ field: p.field, key: k }); });
  });
  flat.sort(function (a, b) { return b.key.length - a.key.length; });

  function matchLine(line) {
    const n = stripLeadJunk(line);
    if (!n) return null;
    // رد کردن هدر هشتگ/امتیاز مثل «#Top_IMDb_Movie | امتیاز: 9.2»
    if (/^#\S+/.test(n) && /امتیاز|imdb/i.test(n) && !/نام\s|خلاصه|ستارگان|کارگردان/.test(n)) return null;
    for (let i = 0; i < flat.length; i++) {
      const key = flat[i].key;
      const re = new RegExp('^' + escapeRe(key) + '\\s*[:\\-–—|=]?\\s*(.*)$', 'i');
      const m = n.match(re);
      if (m) return { field: flat[i].field, value: emptyish(m[1]) };
    }
    return null;
  }

  let titleFa = '';
  let titleEn = '';
  let descParts = [];
  let descMode = false;
  const unlabeled = [];
  for (let i = 0; i < lines.length; i++) {
    // رد کردن خطوط CTA / برند
    const plain = stripLeadJunk(lines[i]);
    if (/^(برای\s*دانلود|دانلود\s*و\s*تماشا|تماشای\s*آنلاین)/i.test(plain)) continue;
    if (/^@?movie_shatelup/i.test(plain)) continue;
    if (/کلیک\s*کنید/i.test(plain) && plain.length < 80) continue;

    const hit = matchLine(lines[i]);
    if (hit) {
      descMode = hit.field === 'description';
      if (hit.field === 'titleFa' && hit.value) titleFa = hit.value.replace(/#\S+/g, '').trim();
      else if (hit.field === 'title' && hit.value) out.title = hit.value.replace(/#\S+/g, '').trim();
      else if (hit.field === 'titleEn' && hit.value) titleEn = hit.value.replace(/#\S+/g, '').trim();
      else if (hit.field === 'director' && hit.value) out.director = formatBilingualList(hit.value, 200);
      else if (hit.field === 'actors' && hit.value) out.actors = formatBilingualList(hit.value, 500);
      else if (hit.field === 'country' && hit.value) out.country = hit.value.split(/[|/]/)[0].trim().slice(0, 80);
      else if (hit.field === 'ageRating' && hit.value) {
        // «R (بالای 17 سال)» → نگه داشتن متن کامل کوتاه
        out.ageRating = hit.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      } else if (hit.field === 'network' && hit.value) out.network = hit.value.replace(/\s*[|／]\s*/g, ' / ').slice(0, 80);
      else if (hit.field === 'genres' && hit.value) out.genres = splitGenres(hit.value);
      else if (hit.field === 'year') {
        const yr = String(hit.value || '').match(/((?:19|20)\d{2})\s*(?:-|–|—|~|تا)\s*((?:19|20)\d{2})/);
        const y = firstYear(hit.value) || firstYear(lines[i]);
        if (y) out.year = y;
        if (yr) { out.year = parseInt(yr[1], 10); out.yearEnd = parseInt(yr[2], 10); }
      } else if (hit.field === 'imdb') {
        const im = parseImdbVal(hit.value);
        if (im) out.imdb = im;
      } else if (hit.field === 'duration') {
        const d = parseDurationVal(hit.value);
        if (d) out.duration = d;
      } else if (hit.field === 'description') {
        if (hit.value) descParts.push(hit.value);
      }
      continue;
    }
    if (descMode) {
      // با رسیدن به خط CTA یا هشتگ جدید، خلاصه تمام می‌شود
      if (/^(برای\s*دانلود|دانلود\s*و\s*تماشا|@?movie_shatelup|#\S+)/i.test(plain)) {
        descMode = false;
        continue;
      }
      descParts.push(plain);
    } else unlabeled.push(plain);
  }
  if (descParts.length) out.description = cleanDescNoise(descParts.join('\n'));

  // عنوان سایت: «نام فارسی | نام انگلیسی»
  titleFa = emptyish(titleFa);
  titleEn = emptyish(titleEn);
  if (titleFa && titleEn) {
    out.title = (titleFa + ' | ' + titleEn).slice(0, 160);
  } else if (titleFa) {
    out.title = titleFa.slice(0, 160);
  } else if (out.title && titleEn && out.title.toLowerCase().indexOf(titleEn.toLowerCase()) < 0) {
    // اگر فقط «نام فیلم» + انگلیسی داشتیم
    if (!/\s\|\s/.test(out.title)) out.title = (out.title + ' | ' + titleEn).slice(0, 160);
  } else if (titleEn && !out.title) {
    out.title = titleEn.slice(0, 160);
  }

  if (!out.title) {
    for (let i = 0; i < unlabeled.length; i++) {
      let cand = unlabeled[i]
        .replace(/#\S+/g, '')
        .replace(/\b(480p|720p|1080p|2160p|4K|BluRay|WEB-?DL|WEBRip)\b/ig, '')
        .replace(/^(دانلود\s+)?(رایگان\s+)?(فیلم|سریال|انیمه|انیمیشن)\s+/i, '')
        .replace(/\s*[|｜]\s*امتیاز\s*[:：]?.*/i, '')
        .trim();
      if (/^امتیاز\s*[:：]?/i.test(cand)) continue;
      if (/imdb/i.test(cand) && cand.length < 40) continue;
      if (cand.length >= 2 && cand.length <= 140) { out.title = cand.slice(0, 140); break; }
    }
  }

  // اگر هنوز عنوان ترکیبی نیست و هر دو نام را از خطوط unlabeled داریم
  if (out.title && titleEn && !/\s\|\s/.test(out.title) && out.title.toLowerCase().indexOf(titleEn.toLowerCase()) < 0) {
    out.title = (out.title + ' | ' + titleEn).slice(0, 160);
  }

  if (!out.year) out.year = firstYear(src) || 0;
  if (!out.imdb) {
    // «امتیاز: 9.2» یا «#Top_IMDb_Movie | امتیاز: 9.2» یا «⭐️ امتیاز: 9.2 از 10»
    const imHead = blob.match(/(?:امتیاز|imdb)\s*[:：]?\s*(\d{1,2}(?:[.,]\d{1,2})?)/i);
    if (imHead) out.imdb = parseImdbVal(imHead[1]);
    if (!out.imdb) {
      const im2 = blob.match(/imdb[^\d]{0,12}(\d(?:[.,]\d{1,2})?)/i);
      if (im2) out.imdb = parseImdbVal(im2[1]);
    }
  }
  if (!out.duration) out.duration = parseDurationVal(src);
  if (!out.description) {
    for (let i = 0; i < unlabeled.length; i++) {
      const u = cleanDescNoise(unlabeled[i]);
      if (u && u !== out.title && u.length >= 40) {
        out.description = u.slice(0, 1200);
        break;
      }
    }
  } else {
    out.description = cleanDescNoise(out.description);
  }
  if (!out.type) out.type = 'movie';
  return out;
}

/* ═══════════════════════ احراز هویت ═══════════════════════ */

async function currentUser(request, store) {
  const set = await getSettings(store);
  let token = null;
  const h = request.headers.get('authorization');
  if (h && h.indexOf('Bearer ') === 0) token = h.slice(7);
  if (!token) { try { token = new URL(request.url).searchParams.get('t'); } catch (e) { } }
  if (!token) return null;
  const p = await verifyToken(token, set.secret);
  if (!p || !p.u) return null;
  const user = await getUser(store, p.u);
  return user || null;
}
async function requireAdmin(request, store) {
  const u = await currentUser(request, store);
  if (!u || u.role !== 'admin') return null;
  return u;
}
async function rlHit(store, key, max, ttl) {
  const k = 'rl:' + key;
  const cur = (await store.get(k)) || { n: 0 };
  cur.n += 1;
  if (cur.n > max) return false;
  await store.set(k, cur, ttl);
  return true;
}
function json(data, status, headers) {
  const h = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }, headers || {});
  return new Response(JSON.stringify(data), { status: status || 200, headers: h });
}
async function readBody(request, max) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > (max || CONFIG.MAX_BODY)) throw Object.assign(new Error('بدنهٔ درخواست خیلی بزرگ است'), { status: 413 });
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error('JSON نامعتبر'), { status: 400 }); }
}
async function makeToken(store, user) {
  const set = await getSettings(store);
  const exp = Math.floor(Date.now() / 1000) + CONFIG.TOKEN_TTL_DAYS * 86400;
  return await signToken({ u: user.username, exp: exp }, set.secret);
}
function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'local';
}

async function uniqueRefCode(store) {
  for (let i = 0; i < 8; i++) {
    const c = genRefCode();
    if (!(await store.get('refcode:' + c))) return c;
  }
  return genRefCode() + randomHex(2);
}

async function applyReferral(store, user, refCode) {
  if (!refCode || user.referrer) return;
  const code = String(refCode).trim().toUpperCase();
  const owner = await store.get('refcode:' + code);
  if (!owner || owner === user.username) return;
  const ref = await getUser(store, owner);
  if (!ref) return;
  user.referrer = ref.username;
  const set = await getSettings(store);
  const bonus = Number(set.refSignupBonus) || 0;
  ref.refCount = (ref.refCount || 0) + 1;
  if (bonus > 0) await creditWallet(store, ref, bonus, 'ref_signup', 'پاداش دعوت «' + (user.tgName || user.username) + '»');
  else await saveUser(store, ref);
}

async function firstTgShouldBeAdmin(store) {
  const keys = await store.list('u:');
  for (let i = 0; i < keys.length; i++) {
    const u = await store.get(keys[i]);
    if (u && u.role === 'admin' && u.tgId) return false;
  }
  return true;
}
async function ensureTgAdmin(store, user) {
  if (!user || user.role === 'admin') return user;
  if (!(await firstTgShouldBeAdmin(store))) return user;
  user.role = 'admin';
  await saveUser(store, user);
  return user;
}

function signupBonusOf(set) {
  const value = set && set.signupBonus;
  if (value == null || value === '') return CONFIG.SIGNUP_BONUS;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : CONFIG.SIGNUP_BONUS;
}
function telegramDisplayName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || ('کاربر ' + from.id);
}
async function createTgUser(store, opts) {
  const existing = await findUserByTg(store, opts.tgId);
  if (existing) return existing;
  const username = 'tg' + String(opts.tgId).slice(0, 20);
  let u = username;
  if (await store.get('u:' + u)) u = 'tg' + String(opts.tgId) + randomHex(2);
  const refCode = await uniqueRefCode(store);
  const user = {
    id: 'u_' + randomHex(4),
    username: u,
    salt: '', hash: '',
    role: (await firstTgShouldBeAdmin(store)) ? 'admin' : 'free',
    email: null,
    tgId: String(opts.tgId),
    tgName: opts.tgName || ('کاربر ' + opts.tgId),
    tgUsername: opts.tgUsername || '',
    photoUrl: opts.photoUrl || '',
    phone: opts.phone || '',
    wallet: 0,
    subUntil: 0,
    subPlan: '',
    refCode: refCode,
    refCount: 0,
    referrer: null,
    createdAt: Date.now(),
    logins: 1,
    lastLogin: Date.now(),
    txs: [],
  };
  // Credit the welcome gift only when a new account is created, independently of referral rewards.
  user.signupBonusGranted = signupBonusOf(await getSettings(store));
  if (user.signupBonusGranted > 0) await creditWallet(store, user, user.signupBonusGranted, 'signup_bonus', 'هدیهٔ اولین ثبت‌نام');
  await store.set('tg:' + user.tgId, user.username);
  await store.set('refcode:' + refCode, user.username);
  if (user.phone) await store.set('ph:' + user.phone, user.username);
  if (opts.refCode) await applyReferral(store, user, opts.refCode);
  await saveUser(store, user);
  return user;
}

/* ═══════════════════════ همگام‌سازی کانال ═══════════════════════ */

async function ingestChannelMessage(store, msg, log) {
  if (!msg || !msg.chat) return;
  const set = await getSettings(store);
  // Editorial uploads are drafts until confirmed, not standalone catalogue posts.
  if (store.env.CONTENT_BOT_TOKEN) {
    const channels = contentChannelRules(store.env), chatId = String(msg.chat.id);
    if (chatId === String(defaultVaultChatId(set)) || channels[chatId] || Object.values(channels).some(rule=>rule.targets.includes(chatId))) return { skipped: true };
  }
  const chat = msg.chat;
  const id = msg.message_id;
  const media = msg.video || msg.document || msg.audio || null;
  const caption = msg.caption || '';
  if (!media && !caption) return;
  const srcUser = chat.username || String(chat.id);
  const tmeUrl = chat.username ? ('https://t.me/' + chat.username + '/' + id) : '';
  const srcKey = 'src:' + srcUser + '/' + id;
  const itemId = await store.get(srcKey);
  let item = itemId ? await getItem(store, itemId) : null;
  const rawTitle = media ? (media.file_name || caption.trim()) : caption.trim();
  const cleanTitle = (rawTitle.split('\n')[0] || 'بدون عنوان').slice(0, 140);
  if (item) {
    if (log) log.push('✔ ' + cleanTitle + ' (قبلاً ثبت شده)');
    return { updated: true };
  }
  const type = /قسمت\s*\d+|ep\.?\s*\d+/i.test(caption) ? 'series' : (media ? 'movie' : 'clip');
  item = newItem(cleanTitle, type, null, chat.title);
  item.access = 'free';
  item.description = caption.slice(0, 1200);
  const src = {
    user: srcUser,
    msgId: String(id),
    tmeUrl: tmeUrl,
    chatId: chat.id,
    fileId: media && media.file_id ? media.file_id : '',
    mediaType: msg.video ? 'video' : (msg.document ? 'document' : (msg.audio ? 'audio' : '')),
  };
  const qk = qualityKey(guessQuality(media && media.width)) || '1080';
  if (type === 'series') {
    item.source = src;
    const ep = { id: 'e_' + randomHex(4), n: 1, title: cleanTitle, source: src, sizeBytes: media && media.file_size ? media.file_size : null, variants: { sub: {}, dub: {} } };
    ep.variants.sub[qk] = { source: src, sizeBytes: ep.sizeBytes };
    item.episodes = [ep];
    item.seasons = [{ n: 1, title: 'فصل ۱', episodes: [ep] }];
  } else {
    item.source = src;
    ensureVariants(item);
    item.variants.sub[qk] = { source: src, sizeBytes: media && media.file_size ? media.file_size : null };
  }
  if (media && media.file_size) item.media = { sizeBytes: media.file_size, width: media.width || null, height: media.height || null, kind: src.mediaType || 'video' };
  if (media && media.width) item.quality = item.quality || guessQuality(media.width);
  await saveItemRecord(store, item);
  await store.set(srcKey, item.id);
  await idxUpsert(store, item);
  if (log) log.push('➕ ' + cleanTitle);
  return { created: true };
}

async function runSync(store) {
  const set = await getSettings(store);
  const token = set.botToken;
  if (!token) return { error: 'توکن ربات تنظیم نشده است', log: [], created: 0, updated: 0 };
  const log = [];
  let created = 0, updated = 0;
  const res = await botApi(token, 'getUpdates', { offset: set.syncOffset || 0, limit: 100, timeout: 0 });
  if (!res.ok) {
    log.push('❌ ' + (res.description || 'خطا'));
    if (String(res.description || '').indexOf('webhook') >= 0) {
      log.push('ℹ️ وبهوک فعال است — پست‌های جدید کانال خودکار ثبت می‌شوند. همگام‌سازی دستی لازم نیست.');
    }
    set.lastSyncLog = log.join('\n');
    await writeSettings(store, set);
    return { log: log, created: created, updated: updated, error: res.description };
  }
  let maxId = set.syncOffset || 0;
  for (const upd of res.result) {
    maxId = Math.max(maxId, upd.update_id);
    const msg = upd.channel_post || upd.post || null;
    if (!msg) continue;
    const r = await ingestChannelMessage(store, msg, log);
    if (r && r.created) created++;
    else if (r && r.updated) updated++;
  }
  set.syncOffset = maxId + 1;
  set.lastSyncAt = Date.now();
  set.lastSyncLog = log.slice(-40).join('\n');
  await writeSettings(store, set);
  bustSettings();
  return { log: log.slice(-40), created: created, updated: updated, offset: maxId };
}

/* ═══════════════════════ گالری پوسترهای IMP Awards ═══════════════════════ */

function impPageInfo(raw) {
  let value = String(raw || '').trim();
  if (!value || value.length > 2000) return null;
  if (/^(?:www\.)?impawards\.com\//i.test(value)) value = 'http://' + value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!['www.impawards.com', 'impawards.com'].includes(url.hostname)) return null;
    const match = url.pathname.toLowerCase().match(/^(\/(?:\d{4}|tv|intl\/[a-z0-9_-]+\/\d{4})\/)([a-z0-9][a-z0-9_-]*)\.html$/);
    if (!match) return null;
    const directory = match[1];
    let stem = match[2], kind = 'poster';
    const suffix = stem.match(/_(xxlg|xlg|gallery)$/);
    if (suffix) { kind = suffix[1]; stem = stem.slice(0, -suffix[0].length); }
    const version = stem.match(/_ver([1-9][0-9]{0,5})$/);
    const slug = version ? stem.slice(0, -version[0].length) : stem;
    if (!slug || /^(?:alpha\d*|index\d*|gallery|latest|archives|awards)$/.test(slug)) return null;
    const origin = url.protocol + '//www.impawards.com';
    const path = directory + match[2] + '.html';
    return {
      url: origin + path, path: path, origin: origin, directory: directory,
      slug: slug, family: directory + slug, version: version ? Number(version[1]) : 1,
      kind: kind, parentUrl: origin + directory + stem + '.html',
    };
  } catch (e) { return null; }
}
function normalizeImpPageUrl(raw) {
  const info = impPageInfo(raw);
  return info ? info.url : '';
}
function galleryLimitOf(value, fallback) {
  const def = fallback != null ? fallback : CONFIG.GALLERY_LIMIT;
  const n = parseInt(value, 10);
  if (!isFinite(n)) return def;
  const min = CONFIG.GALLERY_MIN_COUNT || 1;
  const max = CONFIG.GALLERY_MAX_COUNT || 10;
  return Math.max(min, Math.min(max, n));
}
function impImageInfo(raw, pageUrl) {
  const page = impPageInfo(pageUrl);
  if (!page) return null;
  try {
    const url = new URL(String(raw || '').replace(/&amp;/g, '&'), page.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!['www.impawards.com', 'impawards.com'].includes(url.hostname)) return null;
    const prefix = page.directory + 'posters/';
    if (!url.pathname.startsWith(prefix)) return null;
    const file = url.pathname.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9_-]*\.(?:jpe?g|png|webp)$/i.test(file)) return null;
    const name = file.replace(/\.(?:jpe?g|png|webp)$/i, '').toLowerCase();
    // Sizes of one design are one image. Never invent an unlinked full-size filename.
    for (const medium of [false, true]) {
      if (medium && !name.startsWith('med_')) continue;
      let stem = medium ? name.slice(4) : name;
      let quality = medium ? 1 : 2;
      const size = stem.match(/_(xxlg|xlg)$/);
      if (size) { stem = stem.slice(0, -size[0].length); quality = size[1] === 'xxlg' ? 4 : 3; }
      const version = stem.match(/_ver([1-9][0-9]{0,5})$/);
      const slug = version ? stem.slice(0, -version[0].length) : stem;
      if (slug !== page.slug) continue;
      return {
        url: url.protocol + '//www.impawards.com' + url.pathname,
        version: version ? Number(version[1]) : 1, quality: quality,
      };
    }
  } catch (e) { }
  return null;
}
function normalizeImpImages(images, pageUrl, limit) {
  const max = galleryLimitOf(limit, CONFIG.GALLERY_LIMIT);
  const result = [], positions = new Map();
  for (const image of (Array.isArray(images) ? images : []).slice(0, 400)) {
    if (!image) continue;
    const info = impImageInfo(typeof image === 'string' ? image : image.url, pageUrl);
    if (!info) continue;
    const caption = cleanHtml(typeof image.caption === 'string' ? image.caption : '').slice(0, 250);
    if (positions.has(info.version)) {
      const index = positions.get(info.version);
      if (info.quality > impImageInfo(result[index].url, pageUrl).quality) {
        result[index] = { url: info.url, caption: caption || result[index].caption };
      } else if (!result[index].caption && caption) result[index].caption = caption;
    } else if (result.length < max) {
      positions.set(info.version, result.length);
      result.push({ url: info.url, caption: caption });
    }
  }
  return result;
}
function galleryHtmlAttr(tag, name) {
  const match = String(tag).match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return match ? cleanHtml(match[1] || match[2] || match[3] || '') : '';
}
function extractImpPage(html, pageUrl, limit) {
  const page = impPageInfo(pageUrl);
  if (!page) return { images: [], pages: [] };
  const images = [], pages = [], seen = new Set();
  const tags = /<(img|a)\b[^>]*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    const tag = match[0];
    if (match[1].toLowerCase() === 'img') {
      const raw = galleryHtmlAttr(tag, 'src');
      const info = impImageInfo(raw, page.url) || impImageInfo(galleryHtmlAttr(tag, 'data-src'), page.url);
      if (info && images.length < 400) images.push({ url: info.url, caption: galleryHtmlAttr(tag, 'alt') });
    } else {
      const href = galleryHtmlAttr(tag, 'href');
      if (!href) continue;
      const image = impImageInfo(href, page.url);
      if (image && images.length < 400) images.push({ url: image.url, caption: '' });
      let link;
      try { link = impPageInfo(new URL(href, page.url).href); } catch (e) { continue; }
      if (link && link.family === page.family && !seen.has(link.path) && pages.length < 150) {
        seen.add(link.path);
        pages.push(link.url);
      }
    }
  }
  return { images: normalizeImpImages(images, page.url, limit), pages: pages };
}

function galleryFetchError(code, upstreamStatus) {
  const http = upstreamStatus ? ' (HTTP ' + upstreamStatus + ')' : '';
  const messages = {
    IMP_CHALLENGE: 'IMP Awards صفحهٔ تصاویر را برنگرداند؛ احتمالاً بررسی ضدربات فعال است' + http + '. دسترسی خودکار سرور به این صفحه باید بررسی شود.',
    IMP_FORBIDDEN: 'IMP Awards درخواست سرور برای دریافت تصاویر را رد کرد' + http + '. تکرار درخواست یا تغییر VPN مرورگر لزوماً این محدودیت سروری را برطرف نمی‌کند.',
    IMP_RATE_LIMIT: 'IMP Awards تعداد درخواست‌های سرور را محدود کرده است' + http + '. مدتی بعد دوباره تلاش کنید.',
    IMP_NOT_FOUND: 'صفحهٔ این عنوان در IMP Awards پیدا نشد' + http + '. لینک فیلم یا سریال را بررسی کنید.',
    IMP_HTTP_ERROR: 'سرور IMP Awards پاسخ خطا برگرداند' + http + '.',
    IMP_REDIRECT: 'IMP Awards درخواست را به مقصدی خارج از صفحهٔ همین عنوان هدایت کرد' + http + '؛ برای امنیت، آن مقصد دنبال نشد.',
    IMP_REDIRECT_LOOP: 'تغییرمسیرهای صفحهٔ IMP Awards تکراری یا بیش از حد مجاز بود' + http + '.',
    IMP_CONTENT_TYPE: 'IMP Awards به‌جای صفحهٔ HTML تصاویر، پاسخ دیگری برگرداند' + http + '.',
    IMP_TOO_LARGE: 'صفحهٔ تصاویر IMP Awards بزرگ‌تر از حد مجاز دریافت است.',
    IMP_TIMEOUT: 'مهلت ارتباط سرور با IMP Awards تمام شد. پاسخ صفحه در زمان مجاز دریافت نشد.',
    IMP_TLS: 'اتصال امن (TLS) بین سرور و IMP Awards برقرار نشد یا قطع شد. دسترسی خروجی سرور به IMP Awards باید بررسی شود.',
    IMP_DNS: 'سرور نتوانست آدرس شبکهٔ IMP Awards را پیدا کند. تنظیمات DNS یا دسترسی شبکهٔ سرور باید بررسی شود.',
    IMP_CONNECTION_RESET: 'ارتباط سرور با IMP Awards قطع شد و صفحهٔ تصاویر دریافت نشد.',
    IMP_NETWORK: 'درخواست سرور به IMP Awards به‌علت خطای شبکه انجام نشد. این خطا در ارتباط سرور با IMP Awards رخ داده است.',
    IMP_NO_IMAGES: 'صفحهٔ IMP Awards دریافت شد، اما تصویر قابل‌دریافتی برای این عنوان پیدا نشد؛ ممکن است ساختار صفحه تغییر کرده باشد.',
    IMP_PARSE: 'صفحهٔ IMP Awards دریافت شد، اما خواندن اطلاعات تصاویر آن ناموفق بود.',
  };
  return Object.assign(new Error(messages[code] || messages.IMP_NETWORK), {
    galleryFailure: true, code: code, upstreamStatus: upstreamStatus || 0, status: 502,
  });
}
function classifyGalleryNetworkError(error, aborted) {
  const cause = error && error.cause;
  const code = String((cause && cause.code) || (error && error.code) || '');
  const message = String((error && error.message) || '') + ' ' + String((cause && cause.message) || '');
  if (aborted || (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) || /TIMEOUT|TIMEDOUT/i.test(code)) return 'IMP_TIMEOUT';
  if (/TLS|SSL|CERT|HANDSHAKE/i.test(code + ' ' + message)) return 'IMP_TLS';
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) return 'IMP_DNS';
  if (/ECONNRESET|UND_ERR_SOCKET/i.test(code)) return 'IMP_CONNECTION_RESET';
  return 'IMP_NETWORK';
}
async function readImpPage(url, timeoutMs) {
  const page = impPageInfo(url);
  if (!page) throw galleryFetchError('IMP_REDIRECT');
  let current = new URL(page.url);
  const visited = new Set();
  const controller = new AbortController();
  let upstreamStatus = 0;
  // One deadline covers the entire redirect chain and response body, not just the headers.
  const timeout = Math.min(CONFIG.GALLERY_TIMEOUT_MS, Number(timeoutMs) > 0 ? Number(timeoutMs) : CONFIG.GALLERY_TIMEOUT_MS);
  const timer = setTimeout(function () { controller.abort(); }, timeout);
  try {
    for (let redirects = 0; ; redirects++) {
      visited.add(current.href);
      upstreamStatus = 0;
      const response = await fetch(current.href, {
        headers: { 'User-Agent': CONFIG.TG_UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'manual', signal: controller.signal,
      });
      const status = response.status;
      upstreamStatus = status;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.get('location');
        if (response.body) await response.body.cancel().catch(function () {});
        let next;
        try { next = location ? new URL(location, current) : null; } catch (e) { next = null; }
        const destination = next && impPageInfo(next.href);
        // IMP serves public posters over HTTP as well; both protocols stay on the same title and host.
        if (!destination || destination.family !== page.family) {
          throw galleryFetchError('IMP_REDIRECT', status);
        }
        next.hash = '';
        if (redirects >= CONFIG.GALLERY_MAX_REDIRECTS || visited.has(next.href)) throw galleryFetchError('IMP_REDIRECT_LOOP', status);
        current = next;
        continue;
      }
      const wafAction = String(response.headers.get('x-amzn-waf-action') || '').toLowerCase();
      const challenge = wafAction === 'challenge' || wafAction === 'captcha';
      if (status !== 200 || challenge) {
        if (response.body) await response.body.cancel().catch(function () {});
        const code = (challenge || status === 202) ? 'IMP_CHALLENGE'
          : (status === 401 || status === 403) ? 'IMP_FORBIDDEN'
          : status === 429 ? 'IMP_RATE_LIMIT'
          : (status === 404 || status === 410) ? 'IMP_NOT_FOUND' : 'IMP_HTTP_ERROR';
        throw galleryFetchError(code, status);
      }
      if (!/text\/html/i.test(response.headers.get('content-type') || '')) {
        if (response.body) await response.body.cancel().catch(function () {});
        throw galleryFetchError('IMP_CONTENT_TYPE', status);
      }
      if (Number(response.headers.get('content-length')) > CONFIG.GALLERY_MAX_HTML) {
        if (response.body) await response.body.cancel().catch(function () {});
        throw galleryFetchError('IMP_TOO_LARGE', status);
      }
      if (!response.body) return { html: '', url: current.href };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > CONFIG.GALLERY_MAX_HTML) {
            await reader.cancel().catch(function () {});
            throw galleryFetchError('IMP_TOO_LARGE', status);
          }
          chunks.push(decoder.decode(part.value, { stream: true }));
        }
        chunks.push(decoder.decode());
        const html = chunks.join('');
        if (/<title[^>]*>\s*(?:Robot Check|Access Denied|Security Check|Request Blocked)\s*<\/title>/i.test(html)) {
          throw galleryFetchError('IMP_CHALLENGE', status);
        }
        if (/<title[^>]*>[^<]*(?:404[^<]*No Movie Posters|Internet Movie Poster Awards:\s*404)[^<]*<\/title>/i.test(html)) {
          throw galleryFetchError('IMP_NOT_FOUND', status);
        }
        return { html: html, url: current.href };
      } finally { reader.releaseLock(); }
    }
  } catch (e) {
    if (e && e.galleryFailure) throw e;
    throw galleryFetchError(classifyGalleryNetworkError(e, controller.signal.aborted), upstreamStatus);
  } finally { clearTimeout(timer); }
}
async function getImpGallery(store, rawUrl, options) {
  const page = impPageInfo(rawUrl);
  if (!page) throw Object.assign(new Error('لینک پوستر یا گالری IMP Awards معتبر نیست؛ نمونه: http://www.impawards.com/1994/shawshank_redemption_ver1_xlg.html'), { status: 400, code: 'IMP_INVALID_URL' });
  const key = 'gallery:imp:v1:' + bytesToHex(await sha256Bytes(page.path));
  options = options || {};
  const existingOpt = options.existing;
  const limit = galleryLimitOf(
    options.limit !== undefined ? options.limit : (options.count !== undefined ? options.count : options.galleryLimit),
    galleryLimitOf(existingOpt && existingOpt.galleryLimit, CONFIG.GALLERY_LIMIT)
  );
  if (!options.refresh) {
    const cached = await store.get(key);
    const cachedPage = cached && impPageInfo(cached.galleryUrl);
    if (cachedPage && cachedPage.path === page.path && Date.now() - cached.fetchedAt < CONFIG.GALLERY_CACHE_TTL * 1000) {
      const images = normalizeImpImages(cached.images, page.url, limit);
      if (images.length >= limit) return { galleryUrl: page.url, images: images, fetchedAt: cached.fetchedAt, limit: limit };
      const cachedLimit = galleryLimitOf(cached.limit !== undefined ? cached.limit : cached.galleryLimit, CONFIG.GALLERY_LIMIT);
      const cachedFull = normalizeImpImages(cached.images, page.url, cachedLimit);
      // Cached set was fetched with a smaller limit and is full: fall through and fetch more.
      if (cachedFull.length < cachedLimit || cachedLimit >= limit) {
        if (images.length) return { galleryUrl: page.url, images: images, fetchedAt: cached.fetchedAt, limit: limit };
      }
    }
    const existing = existingOpt;
    const savedPage = existing && impPageInfo(existing.galleryUrl);
    if (savedPage && savedPage.path === page.path) {
      const images = normalizeImpImages(existing.galleryImages, page.url, limit);
      if (images.length >= limit) return { galleryUrl: page.url, images: images, fetchedAt: existing.galleryImagesUpdatedAt || 0, limit: limit };
      const existingLimit = galleryLimitOf(existing.galleryLimit, CONFIG.GALLERY_LIMIT);
      const existingFull = normalizeImpImages(existing.galleryImages, page.url, existingLimit);
      if (existingFull.length < existingLimit || existingLimit >= limit) {
        if (images.length) return { galleryUrl: page.url, images: images, fetchedAt: existing.galleryImagesUpdatedAt || 0, limit: limit };
      }
    }
  }
  const queue = [], queued = new Set(), visited = new Set(), failures = [];
  const deadline = Date.now() + CONFIG.GALLERY_TOTAL_MS;
  let images = [], processed = 0;
  function enqueue(raw) {
    const info = impPageInfo(raw);
    if (!info || info.family !== page.family || queued.has(info.path) || queued.size >= 150) return;
    queued.add(info.path);
    queue.push(info);
  }
  enqueue(page.url);
  // XLG/XXLG pages often show only one image. Preserve _verN when opening their parent.
  if (page.kind === 'xlg' || page.kind === 'xxlg') enqueue(page.parentUrl);
  while (queue.length && processed < CONFIG.GALLERY_MAX_PAGES) {
    let index = -1, best = Infinity;
    const selected = images.map(function (image) { return impImageInfo(image.url, page.url); });
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      if (visited.has(candidate.path)) continue;
      if (images.length >= limit && !(candidate.kind === 'poster' && selected.some(function (image) {
        return image.version === candidate.version && image.quality < 2;
      }))) continue;
      const score = processed === 0 && candidate.path === page.path ? -1 : candidate.kind === 'gallery' ? 0 : candidate.kind === 'poster' ? 1 : 2;
      if (score < best) { best = score; index = i; }
    }
    if (index < 0) break;
    const next = queue.splice(index, 1)[0];
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failures.push({ page: next.path, error: galleryFetchError('IMP_TIMEOUT') });
      break;
    }
    visited.add(next.path);
    processed += 1;
    let read = false;
    try {
      const response = await readImpPage(next.url, remaining);
      read = true;
      const resolved = impPageInfo(response.url);
      if (resolved) visited.add(resolved.path);
      const found = extractImpPage(response.html, response.url, limit);
      if (!found.images.length) failures.push({ page: next.path, error: galleryFetchError('IMP_NO_IMAGES', 200) });
      images = normalizeImpImages(images.concat(found.images), page.url, limit);
      found.pages.forEach(enqueue);
    } catch (e) {
      failures.push({ page: next.path, error: e && e.galleryFailure ? e : galleryFetchError(read ? 'IMP_PARSE' : classifyGalleryNetworkError(e, false)) });
    }
  }
  if (!images.length) {
    if (!failures.length) failures.push({ page: page.path, error: galleryFetchError('IMP_NO_IMAGES') });
    const diagnostics = failures.map(function (failure) {
      return { page: failure.page, code: failure.error.code, upstreamStatus: failure.error.upstreamStatus || 0 };
    });
    const messages = [...new Set(failures.map(function (failure) { return failure.error.message; }))];
    const code = diagnostics.every(function (entry) { return entry.code === diagnostics[0].code; }) ? diagnostics[0].code : 'IMP_FETCH_FAILED';
    console.warn('gallery_import_failed', JSON.stringify({ source: 'impawards', title: page.family, attempts: diagnostics }));
    throw Object.assign(new Error(messages.join(' ')), { status: 502, code: code, diagnostics: diagnostics });
  }
  const result = { galleryUrl: page.url, images: images, fetchedAt: Date.now(), limit: limit };
  await store.set(key, result, CONFIG.GALLERY_CACHE_TTL);
  return result;
}

// Read old saved galleries without making another request to IMDb. They are only replaced on explicit edits.
function storedItemGallery(item) {
  const limit = galleryLimitOf(item && item.galleryLimit, CONFIG.GALLERY_LIMIT);
  if (Object.prototype.hasOwnProperty.call(item, 'galleryUrl')) {
    const url = normalizeImpPageUrl(item.galleryUrl);
    return {
      galleryUrl: url, galleryImages: url ? normalizeImpImages(item.galleryImages, url, limit) : [],
      galleryImagesUpdatedAt: item.galleryImagesUpdatedAt || 0,
      galleryLimit: limit,
      gallerySource: url ? 'impawards' : '', gallerySourceUrl: url,
    };
  }
  const legacyUrl = normalizeLegacyImdbTitleUrl(item.imdbUrl);
  const images = legacyUrl ? normalizeLegacyImdbImages(item.imdbImages, limit) : [];
  return {
    galleryUrl: '', galleryImages: images, galleryImagesUpdatedAt: item.imdbImagesUpdatedAt || 0,
    galleryLimit: limit,
    gallerySource: images.length ? 'imdb-legacy' : '', gallerySourceUrl: images.length ? legacyUrl : '',
  };
}

/* سازگاری فقط برای تصاویر ذخیره‌شدهٔ قبلی؛ هیچ صفحه‌ای از IMDb دریافت نمی‌شود. */
function normalizeLegacyImdbTitleUrl(raw) {
  let value = String(raw || '').trim();
  if (!value || value.length > 2000) return '';
  if (/^(?:(?:www|m)\.)?imdb\.com\//i.test(value)) value = 'https://' + value;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    if (!['imdb.com', 'www.imdb.com', 'm.imdb.com'].includes(url.hostname)) return '';
    const match = url.pathname.match(/^\/title\/(tt\d{7,12})(?:\/|$)/i);
    return match ? 'https://www.imdb.com/title/' + match[1].toLowerCase() + '/' : '';
  } catch (e) { return ''; }
}
function normalizeLegacyImdbImageUrl(raw) {
  try {
    const url = new URL(String(raw || '').replace(/&amp;/g, '&'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!['m.media-amazon.com', 'ia.media-imdb.com', 'images-na.ssl-images-amazon.com'].includes(url.hostname)) return '';
    if (!/^\/images\/M\/[a-z0-9@._,%+\-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return '';
    // Keep the same IMDb asset, but request a usable size instead of a cropped thumbnail.
    const extension = url.pathname.match(/\.(jpe?g|png|webp)$/i)[1].toLowerCase();
    const base = url.pathname.replace(/\._V\d+_.*$/i, '').replace(/\.(?:jpe?g|png|webp)$/i, '');
    return url.origin + base + '._V1_QL85_UX1280_.' + extension;
  } catch (e) { return ''; }
}
function normalizeLegacyImdbImages(images, limit) {
  const max = galleryLimitOf(limit, CONFIG.GALLERY_LIMIT);
  const result = [], seen = new Set();
  for (const image of (Array.isArray(images) ? images : []).slice(0, 200)) {
    if (!image) continue;
    const url = normalizeLegacyImdbImageUrl(typeof image === 'string' ? image : image.url);
    if (!url) continue;
    const key = new URL(url).pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    let caption = typeof image.caption === 'string' ? image.caption : (image.caption && image.caption.plainText) || '';
    caption = cleanHtml(caption).slice(0, 250);
    if (/^View (Poster|Image|Photo)$/i.test(caption)) caption = '';
    result.push({ url: url, caption: caption });
    if (result.length >= max) break;
  }
  return result;
}

/* ═══════════════════════ تصویر پوستر ═══════════════════════ */

async function imgResponse(request, url, store) {
  let target = null;
  const src = url.searchParams.get('src');
  const direct = url.searchParams.get('url');
  if (src) {
    const p = parseTmeLink(src);
    if (!p) return new Response('not found', { status: 404 });
    const res = await resolvePost(store, p.user, p.msgId, false);
    target = res.thumb || null;
  } else if (direct) {
    if (!isPublicHttpUrl(direct)) return new Response('forbidden', { status: 403 });
    target = direct;
  }
  if (!target) return new Response('not found', { status: 404 });
  try {
    const up = await fetch(target, { headers: { 'User-Agent': CONFIG.TG_UA } });
    if (!up.ok) return new Response('not found', { status: 404 });
    const h = new Headers();
    const ct = up.headers.get('content-type') || '';
    if (ct && ct.indexOf('image/') !== 0 && ct.indexOf('octet-stream') < 0) {
      return new Response('not an image', { status: 415 });
    }
    h.set('content-type', ct.indexOf('image/') === 0 ? ct : 'image/jpeg');
    h.set('cache-control', 'public, max-age=86400');
    h.set('access-control-allow-origin', '*');
    return new Response(up.body, { status: 200, headers: h });
  } catch (e) {
    return new Response('not found', { status: 404 });
  }
}

/* ═══════════════════════ API عمومی ═══════════════════════ */

function galleryPosterOf(item) {
  try {
    const list = (item && item.galleryImages) || [];
    for (let i = 0; i < list.length; i++) {
      const u = typeof list[i] === 'string' ? list[i] : list[i] && list[i].url;
      if (u && /^https?:\/\//i.test(u) && isPublicHttpUrl(u)) return u;
    }
    const legacy = (item && item.imdbImages) || [];
    for (let i = 0; i < legacy.length; i++) {
      const u = typeof legacy[i] === 'string' ? legacy[i] : legacy[i] && legacy[i].url;
      if (u && u.indexOf('https://') === 0) return u;
    }
  } catch (e) {}
  return '';
}
function posterUrlFor(entry) {
  const ov = entry.posterOverride || '';
  if (ov) {
    if (ov.indexOf('/img?') === 0) return ov;
    if (parseTmeLink(ov)) return '/img?src=' + encodeURIComponent(ov);
    if (/^https?:\/\//i.test(ov)) return '/img?url=' + encodeURIComponent(ov);
    return ov;
  }
  if (entry.posterSrc) return '/img?src=' + encodeURIComponent(entry.posterSrc);
  const gp = entry.galleryPoster || '';
  if (gp && /^https?:\/\//i.test(gp) && isPublicHttpUrl(gp)) return '/img?url=' + encodeURIComponent(gp);
  return '';
}

const viewsThrottle = new Map();

async function apiCatalog(store, url, request) {
  const set = await getSettings(store);
  const idx = await getIdx(store);
  const sp = url.searchParams;
  const q = (sp.get('q') || '').trim().toLowerCase();
  const type = sp.get('type') || '';
  const genre = sp.get('genre') || '';
  const access = sp.get('access') || '';
  const quality = sp.get('quality') || '';
  const country = sp.get('country') || '';
  const age = sp.get('age') || '';
  const network = sp.get('network') || '';
  const director = (sp.get('director') || '').trim().toLowerCase();
  const actor = (sp.get('actor') || '').trim().toLowerCase();
  const sort = sp.get('sort') || 'new';
  const y0 = parseInt(sp.get('y0'), 10);
  const y1 = parseInt(sp.get('y1'), 10);
  const s0 = parseFloat(sp.get('s0'));
  const s1 = parseFloat(sp.get('s1'));
  const wantDub = sp.get('dubbed') === '1';
  const wantSub = sp.get('sub') === '1';
  const wantAiring = sp.get('airing') === '1';
  const thisYear = new Date().getFullYear();
  const yearNarrow = (isFinite(y0) && y0 > 1888) || (isFinite(y1) && y1 < thisYear);
  const scoreNarrow = (isFinite(s0) && s0 > 1) || (isFinite(s1) && s1 < 10);
  function splitFilter(v) {
    return String(v || '').split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function hasAny(vals, raw) {
    const have = String(raw || '').split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < vals.length; i++) if (have.indexOf(vals[i]) >= 0) return true;
    return false;
  }
  let items = idx.slice();
  if (type) items = items.filter(function (x) { return x.type === type; });
  if (genre) {
    const gs = splitFilter(genre);
    items = items.filter(function (x) {
      const g = x.genres || [];
      for (let i = 0; i < gs.length; i++) if (g.indexOf(gs[i]) >= 0) return true;
      return false;
    });
  }
  if (access === 'premium') items = items.filter(function (x) { return x.access === 'premium'; });
  if (access === 'free') items = items.filter(function (x) { return x.access !== 'premium'; });
  if (country) {
    const cs = splitFilter(country);
    items = items.filter(function (x) { return hasAny(cs, x.country); });
  }
  if (age) {
    const as = splitFilter(age);
    items = items.filter(function (x) { return hasAny(as, x.ageRating); });
  }
  if (network) {
    const ns = splitFilter(network);
    items = items.filter(function (x) { return hasAny(ns, x.network); });
  }
  if (quality) {
    const qs = splitFilter(quality);
    items = items.filter(function (x) {
      const xq = qualityKey(x.quality) || String(x.quality || '').toLowerCase();
      for (let i = 0; i < qs.length; i++) {
        const qk = qualityKey(qs[i]);
        if (xq === qk || String(x.quality || '').toLowerCase().indexOf(String(qs[i]).toLowerCase()) >= 0) return true;
      }
      return false;
    });
  }
  if (director) items = items.filter(function (x) { return String(x.director || '').toLowerCase().indexOf(director) >= 0; });
  if (actor) items = items.filter(function (x) { return String(x.actors || '').toLowerCase().indexOf(actor) >= 0; });
  if (yearNarrow) {
    const a = isFinite(y0) ? y0 : 1888;
    const b = isFinite(y1) ? y1 : thisYear;
    /* سریال‌ها بازهٔ سال دارند (شروع تا آخرین فصل)؛ هم‌پوشانی با بازهٔ فیلتر کافی است */
    items = items.filter(function (x) {
      const y0 = x.year || 0;
      const y1 = Math.max(y0, x.yearEnd || 0);
      return y0 && y1 >= a && y0 <= b;
    });
  }
  if (scoreNarrow) {
    const a = isFinite(s0) ? s0 : 1;
    const b = isFinite(s1) ? s1 : 10;
    items = items.filter(function (x) { return x.imdb && x.imdb >= a && x.imdb <= b; });
  }
  if (wantDub) items = items.filter(function (x) { return !!x.dubbed; });
  if (wantSub) items = items.filter(function (x) { return !!x.subtitled; });
  if (wantAiring) items = items.filter(function (x) { return !!x.airing; });
  if (q) {
    items = items.filter(function (x) {
      const blob = [x.title, x.desc, x.director, x.actors, x.country, x.network, (x.genres || []).join(' ')].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }
  if (sort === 'title') items.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'fa'); });
  else if (sort === 'oldest') items.sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
  else if (sort === 'year') items.sort(function (a, b) { return Math.max(b.year || 0, b.yearEnd || 0) - Math.max(a.year || 0, a.yearEnd || 0); });
  else if (sort === 'imdb') items.sort(function (a, b) { return (b.imdb || 0) - (a.imdb || 0); });
  else items.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });

  const facets = { genres: {}, countries: {}, networks: {}, ages: {}, qualities: {} };
  let yMin = thisYear, yMax = 1888;
  for (const x of idx) {
    for (const g of (x.genres || [])) facets.genres[g] = 1;
    String(x.country || '').split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) { facets.countries[v] = 1; });
    String(x.network || '').split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) { facets.networks[v] = 1; });
    String(x.ageRating || '').split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) { facets.ages[v] = 1; });
    if (x.quality) {
      const k = qualityKey(x.quality);
      const lab = k === '4k' ? '4K' : (k === '1080' ? '1080p' : (k === '720' ? '720p' : (k === '480' ? '480p' : String(x.quality))));
      facets.qualities[lab] = 1;
    }
    if (x.year) { if (x.year < yMin) yMin = x.year; if (x.year > yMax) yMax = x.year; }
    if (x.yearEnd && x.yearEnd > yMax) yMax = x.yearEnd;
  }
  const out = [];
  for (const e of items.slice(0, 200)) {
    out.push({
      id: e.id, title: e.title, type: e.type, year: e.year, quality: e.quality,
      yearEnd: e.yearEnd || 0,
      airing: !!e.airing, airingSeason: e.airingSeason || 0, airingText: e.airingText || '',
      access: e.access, featured: e.featured, addedAt: e.addedAt, genres: e.genres || [],
      epCount: e.epCount || 0, seasonCount: e.seasonCount || 0,
      views: e.views || 0, qualities: e.qualities || [],
      desc: e.desc || '',
      poster: posterUrlFor(e),
      sizeBytes: e.sizeBytes || null,
      director: e.director || '',
      actors: e.actors || '',
      country: e.country || '',
      ageRating: e.ageRating || '',
      network: e.network || '',
      imdb: e.imdb || 0,
      duration: e.duration || 0,
      dubbed: !!e.dubbed,
      subtitled: !!e.subtitled,
      censored: !!e.censored,
    });
  }
  return json({
    items: out,
    total: items.length,
    genres: Object.keys(facets.genres),
    facets: {
      genres: Object.keys(facets.genres).sort(function (a, b) { return a.localeCompare(b, 'fa'); }),
      countries: Object.keys(facets.countries).sort(function (a, b) { return a.localeCompare(b, 'fa'); }),
      networks: Object.keys(facets.networks).sort(function (a, b) { return a.localeCompare(b, 'fa'); }),
      ages: Object.keys(facets.ages),
      qualities: Object.keys(facets.qualities),
      yearMin: yMin === thisYear && yMax === 1888 ? 1888 : yMin,
      yearMax: yMax < 1888 ? thisYear : Math.max(yMax, thisYear),
    },
    site: { siteName: set.siteName, tagline: set.tagline },
    economy: publicEconomy(set),
  });
}

async function apiItem(store, id, request) {
  const set = await getSettings(store);
  const item = await getItem(store, id);
  if (!item) return json({ error: 'یافته نشد' }, 404);
  const user = await currentUser(request, store);
  const canPlay = allowed(user, item, set);
  item.views = (item.views || 0) + 1;
  const lastV = viewsThrottle.get(item.id) || 0;
  if (Date.now() - lastV > 300000) {
    viewsThrottle.set(item.id, Date.now());
    await store.set('it:' + item.id, item);
  }
  const views = item.views;
  let out;
  const seasonsPub = publicSeasons(item);
  const variantsPub = publicVariantMap(item, item.quality);
  if (canPlay && user && user.role === 'admin') {
    out = Object.assign({}, item, { views: views });
    if (!out.seasons || !out.seasons.length) out.seasons = seasonsPub;
    if (!out.variants) out.variants = variantsPub;
  } else if (canPlay) {
    out = Object.assign({}, item, { views: views, seasons: seasonsPub, variants: variantsPub });
  } else {
    out = {
      id: item.id, title: item.title, type: item.type, year: item.year, quality: item.quality,
      yearEnd: item.yearEnd || 0, airing: !!item.airing, airingSeason: item.airingSeason || 0, airingText: item.airingText || '',
      seasonCount: countSeasons(item), epCount: countEpisodes(item),
      genres: item.genres, access: item.access, featured: item.featured, addedAt: item.addedAt,
      description: item.description || '', episodes: (item.episodes || []).map(function (e) { return { id: e.id, title: e.title }; }),
      seasons: seasonsPub, variants: variantsPub,
      director: item.director || '', actors: item.actors || '', country: item.country || '',
      ageRating: item.ageRating || '', network: item.network || '', imdb: item.imdb || 0,
      duration: item.duration || 0, dubbed: !!item.dubbed, subtitled: !!item.subtitled, censored: !!item.censored,
      subs: [], views: views, locked: false,
      poster: posterUrlFor({
        posterOverride: item.posterOverride || '',
        posterSrc: (item.source && item.source.tmeUrl) ? item.source.tmeUrl : '',
        galleryPoster: galleryPosterOf(item),
      }),
      posterOverride: item.posterOverride || '',
    };
  }
  Object.assign(out, storedItemGallery(item));
  delete out.imdbUrl;
  delete out.imdbImages;
  delete out.imdbImagesUpdatedAt;
  const idx = await getIdx(store);
  const related = idx
    .filter(function (x) {
      return x.id !== item.id && ((x.type === item.type) || (x.genres || []).some(function (g) { return (item.genres || []).indexOf(g) >= 0; }));
    })
    .slice(0, 8)
    .map(function (x) { return { id: x.id, title: x.title, type: x.type, year: x.year, yearEnd: x.yearEnd || 0, airing: !!x.airing, airingSeason: x.airingSeason || 0, quality: x.quality, access: x.access, addedAt: x.addedAt, poster: posterUrlFor(x), imdb: x.imdb || 0 }; });
  return json({
    item: out, related: related, canPlay: canPlay, user: pubUser(user),
    hasSub: hasActiveSub(user), dlPrice: Number(set.dlClickPrice) || 0,
    vanishSec: Number(set.vanishSec) || CONFIG.VANISH_SEC,
    economy: publicEconomy(set),
  });
}

/* ═══════════════════════ ورود تلگرام ═══════════════════════ */

async function apiLegacyLogin(store, body, request) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await store.get('u:' + username);
  const rlKey = 'login:' + ipOf(request) + ':' + (username || 'x');
  if (!user || !user.hash || !user.salt) {
    if (!(await rlHit(store, rlKey, 8, 600))) return json({ error: 'تلاش‌های ناموفق زیاد است' }, 429);
    return json({ error: 'این حساب ورود با رمز ندارد. از ربات تلگرام وارد شوید' }, 401);
  }
  const hash = await hashPassword(password, user.salt);
  let same = true;
  if (hash.length !== user.hash.length) same = false;
  else for (let i = 0; i < hash.length; i++) if (hash[i] !== user.hash[i]) { same = false; break; }
  if (!same) {
    if (!(await rlHit(store, rlKey, 8, 600))) return json({ error: 'تلاش‌های ناموفق زیاد است' }, 429);
    return json({ error: 'نام کاربری یا رمز عبور اشتباه است' }, 401);
  }
  user.logins = (user.logins || 0) + 1;
  user.lastLogin = Date.now();
  await saveUser(store, user);
  const token = await makeToken(store, user);
  return json({ token: token, user: pubUser(user) });
}

async function apiBootstrap(store, body, request) {
  const usersCount = (await store.list('u:')).length;
  if (usersCount > 0) return json({ error: 'راه‌اندازی فقط وقتی ممکن است که هنوز کاربری ثبت نشده باشد. از ربات تلگرام وارد شوید.' }, 403);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9_]{3,32}$/.test(username)) return json({ error: 'نام کاربری باید ۳ تا ۳۲ کاراکتر الفبا/عدد/آندرلاین باشد' }, 400);
  if (password.length < 6) return json({ error: 'رمز عبور حداقل ۶ کاراکتر' }, 400);
  const salt = randomHex(16);
  const refCode = await uniqueRefCode(store);
  const user = {
    id: 'u_' + randomHex(4), username: username, salt: salt,
    hash: await hashPassword(password, salt),
    role: 'admin', email: null, tgId: null, tgName: '',
    phone: '', wallet: 0, subUntil: 0, subPlan: '',
    refCode: refCode, refCount: 0, referrer: null,
    createdAt: Date.now(), logins: 1, lastLogin: Date.now(), txs: [],
  };
  await saveUser(store, user);
  await store.set('refcode:' + refCode, user.username);
  const token = await makeToken(store, user);
  return json({ token: token, user: pubUser(user), admin: true });
}

async function apiAuthStart(store, body, request) {
  const set = await getSettings(store);
  if (!set.botToken || !set.botUsername) {
    return json({ error: 'ربات تلگرام هنوز تنظیم نشده. مدیر باید توکن و یوزرنیم ربات را در پنل بگذارد.' }, 400);
  }
  if (!(await rlHit(store, 'astart:' + ipOf(request), 20, 600))) return json({ error: 'تعداد درخواست زیاد است؛ کمی صبر کنید' }, 429);
  const ticket = randomHex(8);
  const rec = {
    status: 'pending',
    refCode: String((body && body.ref) || '').trim().toUpperCase().slice(0, 12),
    createdAt: Date.now(),
    token: null,
    user: null,
    origin: originFromRequest(request),
  };
  await store.set('tick:' + ticket, rec, CONFIG.TICKET_TTL);
  return json({ ticket: ticket, botLink: botLink(set, 'tglogin_' + ticket), expireSec: CONFIG.TICKET_TTL });
}

async function apiAuthTicket(store, id) {
  const rec = await store.get('tick:' + String(id || ''));
  if (!rec || Date.now() - rec.createdAt > CONFIG.TICKET_TTL * 1000) return json({ status: 'missing' }, 404);
  if (rec.status === 'ready') return json({ status: 'ready', token: rec.token, user: rec.user });
  return json({ status: rec.status || 'pending' });
}


const WIDGET_FIELDS = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'];
function pickWidgetPayload(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (let i = 0; i < WIDGET_FIELDS.length; i++) {
    const k = WIDGET_FIELDS[i];
    if (raw[k] != null && String(raw[k]) !== '') out[k] = String(raw[k]);
  }
  return out;
}

async function loginWithWidgetData(store, raw, refCode) {
  const set = await getSettings(store);
  if (!set.botToken) return { error: 'ربات تنظیم نشده', status: 400 };
  const data = officialWidgetFields(raw);
  if (!data.id || !data.hash || !data.auth_date) return { error: 'دادهٔ ورود ناقص است', status: 400 };
  if (!(await verifyTgLoginWidget(data, set.botToken))) {
    return { error: 'امضای تلگرام نامعتبر است. از «ادامه در ربات» استفاده کنید یا توکن همان ربات را در پنل بگذارید.', status: 403 };
  }
  const authDate = parseInt(data.auth_date, 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || Math.abs(now - authDate) > 86400) return { error: 'ورود منقضی شده؛ دوباره تلاش کنید', status: 403 };
  const tgId = String(data.id);
  let user = await findUserByTg(store, tgId);
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || (data.username ? data.username : ('کاربر ' + tgId));
  const photo = data.photo_url ? String(data.photo_url) : '';
  const un = data.username ? String(data.username) : '';
  if (!user) {
    user = await createTgUser(store, { tgId: tgId, tgName: name, tgUsername: un, photoUrl: photo, phone: '', refCode: refCode || '' });
  } else {
    user.lastLogin = Date.now();
    user.logins = (user.logins || 0) + 1;
    if (name) user.tgName = name;
    if (un) user.tgUsername = un;
    if (photo) user.photoUrl = photo;
    await saveUser(store, user);
  }
  user = await ensureTgAdmin(store, user);
  const token = await makeToken(store, user);
  return { token: token, user: pubUser(user), full: user };
}

async function apiWidgetLogin(store, body, request) {
  if (!(await rlHit(store, 'wid:' + ipOf(request), 30, 600))) return json({ error: 'تعداد درخواست زیاد است' }, 429);
  const out = await loginWithWidgetData(store, body || {}, (body && body.ref) || '');
  if (out.error) return json({ error: out.error }, out.status || 403);
  return json({ token: out.token, user: out.user });
}

const WIDGET_FRAG_SCRIPT = [
  '(function(){',
  'var h=location.hash||"";',
  'var i=h.indexOf("tgAuthResult=");',
  'if(i<0){setTimeout(function(){if(!location.hash){var el=document.getElementById("wmsg");if(el)el.textContent="ورود انجام نشد. به سایت برگردید.";}},2800);return;}',
  'var b64=decodeURIComponent(h.slice(i+13).split("&")[0]);',
  'var data;try{var bin=atob(b64);var u8=new Uint8Array(bin.length);for(var i2=0;i2<bin.length;i2++)u8[i2]=bin.charCodeAt(i2);data=JSON.parse(new TextDecoder("utf-8").decode(u8));}catch(e){document.body.textContent="داده نامعتبر";return;}',
  'fetch("/api/auth/widget",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})',
  '.then(function(r){return r.json();}).then(function(j){',
  'if(j.token){try{localStorage.setItem("mvx_t",j.token);}catch(e){}location.replace("/#/");}',
  'else{var el=document.getElementById("wmsg");if(el)el.textContent=j.error||"ورود ناموفق";}',
  '}).catch(function(){var el=document.getElementById("wmsg");if(el)el.textContent="خطای ارتباط";});',
  '})();',
].join('');

function widgetResultPage(ok, msg, script) {
  const html = '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود تلگرام</title><body style="font-family:Tahoma,sans-serif;background:#0b0e14;color:#eef1f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#151a24;border:1px solid #242c3b;border-radius:14px;padding:28px;max-width:420px;text-align:center"><div style="font-size:42px">' + (ok ? '✈️' : '❌') + '</div><h2 id="wmsg">' + htmlEscape(msg) + '</h2><p style="color:#98a2b6;font-size:14px"><a href="/#/auth" style="color:#ffb01f">بازگشت به سایت</a></p></div>' + (script ? ('<script>' + script + '</script>') : '') + '</body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function apiWidgetCb(store, url, request) {
  const raw = {};
  url.searchParams.forEach(function (v, k) { raw[k] = v; });
  if (!raw.hash) return widgetResultPage(true, 'در حال بررسی ورود تلگرام…', WIDGET_FRAG_SCRIPT);
  if (!(await rlHit(store, 'wid:' + ipOf(request), 30, 600))) return widgetResultPage(false, 'تعداد درخواست زیاد است');
  const out = await loginWithWidgetData(store, raw, raw.ref || '');
  if (out.error) return widgetResultPage(false, out.error);
  const script = 'try{localStorage.setItem("mvx_t",' + JSON.stringify(String(out.token)) + ');}catch(e){}location.replace("/#/");';
  return widgetResultPage(true, 'ورود موفق — در حال بازگشت به سایت…', script);
}


async function completeTicket(store, ticketId, user) {
  if (!ticketId) return;
  const t = await store.get('tick:' + ticketId);
  if (!t) return;
  const token = await makeToken(store, user);
  t.status = 'ready';
  t.token = token;
  t.user = pubUser(user);
  await store.set('tick:' + ticketId, t, CONFIG.TICKET_TTL);
}

async function findUserByTg(store, tgId) {
  const uname = await store.get('tg:' + String(tgId));
  if (!uname) return null;
  return await getUser(store, uname);
}

async function tgSend(token, chatId, text, extra) {
  const params = Object.assign({ chat_id: chatId, text: text, parse_mode: 'HTML' }, extra || {});
  return botApi(token, 'sendMessage', params);
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: 'ارسال شماره موبایل', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true,
  };
}
function phoneAskText(set) {
  const name = (set && set.siteName) || 'سایت';
  return 'برای ورود / ثبت‌نام در ' + name + '، روی دکمه زیر بزن تا شماره‌ات ارسال بشه:\n\nاین اطلاعات نزد ما محفوظ می‌ماند و صرفاً برای تکمیل حساب کاربری شما دریافت می‌شود.';
}
async function askOwnPhone(token, chatId, set, extraLine) {
  const text = (extraLine ? extraLine + '\n\n' : '') + phoneAskText(set);
  return tgSend(token, chatId, text, { reply_markup: contactKeyboard() });
}
async function sendMiniAppReturn(token, chatId, isNew, isAdmin, signupBonus) {
  let text = isNew
    ? ('✅ ثبت‌نام انجام شد' + (isAdmin ? ' — شما مدیر سایت هستید' : '') + '.')
    : '✅ ورود انجام شد.';
  if (isNew && signupBonus > 0) text += '\n🎁 ' + signupBonus.toLocaleString('fa-IR') + ' سکه هدیهٔ اولین ثبت‌نام به کیف پول شما اضافه شد.';
  text += '\nبرای ادامه، روی دکمهٔ «ورود به مینی‌اپ» بزنید.';
  return tgSend(token, chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: 'ورود به مینی‌اپ', url: CONFIG.MINI_APP_URL }]] },
  });
}
function isOwnAccountContact(msg, tgId) {
  if (!msg || !msg.contact || !msg.contact.phone_number) return false;
  if (msg.forward_date || msg.forward_from || msg.forward_origin || msg.forward_sender_name || msg.external_reply) return false;
  if (msg.contact.user_id == null || msg.contact.user_id === '') return false;
  return String(msg.contact.user_id) === String(tgId);
}

async function deliverMedia(token, toChatId, source, caption, extra) {
  extra = extra || {};
  const set = extra.set || extra._set || null;
  source = hydrateSource(source, set);
  if (!source) return { ok: false, description: 'منبع فایل ثبت نشده' };
  if (source.chatId) source.chatId = normalizeChannelId(source.chatId);
  const cap = caption || '⏱ ۱۰ ثانیه فرصت دارید این فایل را Forward کنید؛ سپس حذف می‌شود.';
  function pack(params) {
    if (cap) params.caption = String(cap).slice(0, 1024);
    if (extra.reply_markup) params.reply_markup = extra.reply_markup;
    return params;
  }
  const ids = [];
  function addId(v) {
    if (v == null || v === '') return;
    const s = String(v);
    if (ids.indexOf(s) < 0) ids.push(s);
  }
  if (source.chatId) {
    addId(normalizeChannelId(source.chatId));
    addId(source.chatId);
  }
  if (source.user) addId('@' + String(source.user).replace(/^@/, ''));
  let lastErr = '';
  const to = tgChatParam(toChatId);
  for (let i = 0; i < ids.length; i++) {
    const from = tgChatParam(ids[i]);
    const r = await botApi(token, 'copyMessage', pack({
      chat_id: to,
      from_chat_id: from,
      message_id: Number(source.msgId),
    }), 120000);
    if (r.ok) return r;
    lastErr = r.description || lastErr;
    const rPlain = await botApi(token, 'copyMessage', {
      chat_id: to,
      from_chat_id: from,
      message_id: Number(source.msgId),
    }, 120000);
    if (rPlain.ok) return rPlain;
    lastErr = rPlain.description || lastErr;
    const r2 = await botApi(token, 'forwardMessage', {
      chat_id: to,
      from_chat_id: from,
      message_id: Number(source.msgId),
    }, 120000);
    if (r2.ok) return r2;
    lastErr = r2.description || lastErr;
  }
  if (source.fileId) {
    const mt = source.mediaType || 'video';
    const method = mt === 'document' ? 'sendDocument' : (mt === 'audio' ? 'sendAudio' : 'sendVideo');
    const field = mt === 'document' ? 'document' : (mt === 'audio' ? 'audio' : 'video');
    const params = pack({ chat_id: to });
    params[field] = source.fileId;
    const r = await botApi(token, method, params, 120000);
    if (r.ok) return r;
    lastErr = r.description || lastErr;
  }
  const hint = source.chatId ? (' آیدی کانال: ' + source.chatId + ' / پیام ' + source.msgId) : '';
  return { ok: false, description: (lastErr || 'منبع فایل در دسترس نیست') + ' — ربات ارسال باید مدیر کانال مخزن باشد.' + hint };
}

async function vanishLater(ctx, token, chatId, messageId, sec) {
  const ms = Math.max(3, Math.min(25, Number(sec) || CONFIG.VANISH_SEC)) * 1000;
  const job = async function () {
    await sleep(ms);
    await botApi(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  };
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job());
}

async function fulfillDownload(store, ctx, token, chatId, dl, set) {
  const item = await getItem(store, dl.itemId);
  if (!item) return tgSend(token, chatId, '❌ محتوا پیدا نشد.');
  const picked = pickDownloadSource(item, { epId: dl.epId, track: dl.track, quality: dl.quality, fileId: dl.fileId });
  if (picked.error) return tgSend(token, chatId, '❌ ' + picked.error);
  const sec = Number(set.vanishSec) || CONFIG.VANISH_SEC;
  const cap = buildMediaCaption(set, item);
  const kb = adKeyboard(set);
  const sources = versionSources(picked.source);
  dl.sentParts = dl.sentParts || [];
  for (let i = 0; i < sources.length; i++) {
    const src = hydrateSource(sources[i], set);
    const partKey = JSON.stringify([src.chatId || src.user || '', src.msgId || '', src.fileId || '']);
    if (dl.sentParts.includes(partKey)) continue;
    const r = await deliverMedia(token, chatId, src, cap, {reply_markup:kb || undefined, set:set});
    if (!r.ok) {
      await tgSend(token, chatId, '❌ ارسال فایل ' + (i + 1) + ' از ' + sources.length + ' ناموفق بود.\n' + htmlEscape(r.description || 'خطا') + '\nبرای ادامه، همان لینک دریافت را دوباره باز کنید؛ فایل‌های ارسال‌شده در این درخواست تکرار نمی‌شوند.');
      return;
    }
    const sentId = r.result && r.result.message_id;
    if (sentId) await vanishLater(ctx, token, chatId, sentId, sec);
    dl.sentParts.push(partKey);
    if (i === sources.length - 1) { dl.used = true; dl.usedAt = Date.now(); }
    await store.set('dl:' + dl.id, dl, 3600);
  }
  if (!dl.used) { dl.used = true; dl.usedAt = Date.now(); await store.set('dl:' + dl.id, dl, 3600); }
  await tgSend(token, chatId, '✅ ' + sources.length + ' فایل این نسخه ارسال شد.\n⏱ هر فایل ' + sec + ' ثانیه پس از ارسال پاک می‌شود؛ به‌موقع آن را Forward کنید.');

}

async function handleStartPayload(store, ctx, set, from, chatId, payload, token) {
  token = token || fileBotToken(set) || set.botToken;
  const tgId = String(from.id);
  let user = await findUserByTg(store, tgId);

  let loginTicket = null;
  if (payload.indexOf('tglogin_') === 0) loginTicket = payload.slice(8);
  else if (payload.indexOf('login_') === 0) loginTicket = payload.slice(6);
  if (loginTicket) {
    if (set.deliveryBotToken && token === set.deliveryBotToken && token !== set.botToken) {
      await tgSend(token, chatId, 'برای ورود از ربات اصلی استفاده کنید:\n' + botLink(set, 'tglogin_' + loginTicket));
      return;
    }
    const ticket = loginTicket;
    const rec = await store.get('tick:' + ticket);
    if (!rec) {
      await tgSend(token, chatId, '⌛️ این لینک ورود منقضی شده. از سایت دوباره «ورود با تلگرام» را بزنید.');
      return;
    }
    if (user && user.phone) {
      user.lastLogin = Date.now();
      user.logins = (user.logins || 0) + 1;
      await saveUser(store, user);
      user = await ensureTgAdmin(store, user);
      await completeTicket(store, ticket, user);
      await sendMiniAppReturn(token, chatId, false, user.role === 'admin');
      return;
    }
    await store.set('tgstate:' + tgId, { mode: 'wait_contact', ticket: ticket, refCode: rec.refCode || '' }, 1800);
    await askOwnPhone(token, chatId, set);
    return;
  }

  if (payload.indexOf('dl_') === 0) {
    const id = payload.slice(3);
    const dl = await store.get('dl:' + id);
    if (!dl || dl.exp < Date.now()) {
      await tgSend(token, chatId, '⌛️ درخواست دانلود منقضی شده. از سایت دوباره دکمهٔ دریافت را بزنید.');
      return;
    }
    if (dl.tgId && String(dl.tgId) !== tgId) {
      await tgSend(token, chatId, '❌ این درخواست مال حساب دیگری است.');
      return;
    }
    if (dl.used) {
      await tgSend(token, chatId, 'این فایل قبلاً ارسال شده.');
      return;
    }
    if (!user) {
      await store.set('tgstate:' + tgId, { mode: 'wait_contact', pendingDl: id }, 1800);
      await askOwnPhone(token, chatId, set);
      return;
    }
    await fulfillDownload(store, ctx, token, chatId, dl, set);
    return;
  }

  if (payload.indexOf('stars_') === 0) {
    const idx = parseInt(payload.slice(6), 10);
    const packs = set.starPacks || [];
    const pack = packs[idx];
    if (!pack || !set.starsEnabled) {
      await tgSend(token, chatId, 'این بسته در دسترس نیست.');
      return;
    }
    if (!user) {
      await tgSend(token, chatId, 'ابتدا از سایت وارد شوید، سپس شارژ کنید.');
      return;
    }
    const r = await botApi(token, 'sendInvoice', {
      chat_id: chatId,
      title: 'شارژ کیف پول',
      description: pack.stars + ' استارز = ' + pack.units + ' ' + (set.walletUnitName || 'سکه'),
      payload: 'stars:' + pack.units + ':' + user.username,
      currency: 'XTR',
      prices: [{ label: pack.units + ' ' + (set.walletUnitName || 'سکه'), amount: Number(pack.stars) }],
    });
    if (!r.ok) await tgSend(token, chatId, 'ارسال فاکتور ناموفق: ' + (r.description || ''));
    return;
  }

  if (payload.indexOf('ref_') === 0) {
    const code = payload.slice(4);
    if (user) {
      await tgSend(token, chatId, 'شما قبلاً ثبت‌نام کرده‌اید.');
      return;
    }
    await store.set('tgstate:' + tgId, { mode: 'wait_contact', ticket: '', refCode: code }, 1800);
    await askOwnPhone(token, chatId, set);
    return;
  }

  if (user && user.phone) {
    await tgSend(token, chatId, 'سلام ' + (from.first_name || '') + ' 👋\nاز سایت روی «ورود / ثبت‌نام با تلگرام» بزنید یا /wallet را بفرستید.', { reply_markup: { remove_keyboard: true } });
    return;
  }
  await store.set('tgstate:' + tgId, { mode: 'wait_contact', ticket: '', refCode: '' }, 1800);
  await askOwnPhone(token, chatId, set);
}

async function finishNewUserFromState(store, set, from, chatId, state, phone, name) {
  const token = set.botToken;
  const tgId = String(from.id);
  let user = await findUserByTg(store, tgId);
  if (!user && phone) {
    const existing = await store.get('ph:' + phone);
    if (existing) user = await getUser(store, existing);
  }
  const isNew = !user;
  if (!user) {
    user = await createTgUser(store, {
      tgId: tgId,
      tgName: name || from.first_name || '',
      tgUsername: from.username ? String(from.username).replace(/^@/, '') : '',
      phone: phone,
      refCode: state && state.refCode,
    });
  } else {
    if (phone && !user.phone) {
      user.phone = phone;
      await store.set('ph:' + phone, user.username);
    }
    if (name) user.tgName = name;
    if (from.username) user.tgUsername = String(from.username).replace(/^@/, '');
    if (!user.tgId) {
      user.tgId = tgId;
      await store.set('tg:' + tgId, user.username);
    }
    user.lastLogin = Date.now();
    user.logins = (user.logins || 0) + 1;
    await saveUser(store, user);
  }
  user = await ensureTgAdmin(store, user);
  let ticket = state && state.ticket;
  if (!ticket) {
    ticket = randomHex(8);
    await store.set('tick:' + ticket, { status: 'pending', createdAt: Date.now() }, CONFIG.TICKET_TTL);
  }
  await completeTicket(store, ticket, user);
  await store.del('tgstate:' + tgId);
  await sendMiniAppReturn(token, chatId, isNew, user.role === 'admin', user.signupBonusGranted);
  return user;
}

async function handleTgUpdate(store, update, ctx, request, opts) {
  const set = await getSettings(store);
  const fileMode = !!(opts && opts.fileBot);
  const token = fileMode ? fileBotToken(set) : set.botToken;
  if (!token) return json({ ok: false, error: 'no bot' }, 400);

  if (update.channel_post) {
    if (fileMode) return json({ ok: true });
    const log = [];
    await ingestChannelMessage(store, update.channel_post, log);
    if (log.length) {
      set.lastSyncAt = Date.now();
      set.lastSyncLog = ((set.lastSyncLog || '') + '\n' + log.join('\n')).split('\n').slice(-40).join('\n');
      await writeSettings(store, set);
      bustSettings();
    }
    return json({ ok: true });
  }

  if (update.pre_checkout_query) {
    await botApi(token, 'answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
    return json({ ok: true });
  }

  if (update.callback_query) {
    if (fileMode) {
      await botApi(token, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
      return json({ ok: true });
    }
    return await handleK2kAdminCallback(store, update.callback_query, set, token);
  }

  const msg = update.message;
  if (msg && msg.successful_payment) {
    const sp = msg.successful_payment;
    const parts = String(sp.invoice_payload || '').split(':');
    if (parts[0] === 'stars' && parts[2]) {
      const units = Number(parts[1]) || 0;
      const user = await getUser(store, parts[2]);
      if (user && units > 0) {
        await creditPurchasedCoins(store, user, units, 'stars', 'شارژ با استارز تلگرام');
        await tgSend(token, msg.chat.id, '✅ ' + units + ' ' + (set.walletUnitName || 'سکه') + ' به کیف پول‌تان اضافه شد.\nموجودی: ' + user.wallet);
      }
    }
    return json({ ok: true });
  }

  if (!msg || !msg.chat || msg.chat.type !== 'private') {
    if (update.callback_query) {
      await botApi(token, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
    }
    return json({ ok: true });
  }

  const from = msg.from || {};
  const chatId = msg.chat.id;
  const tgId = String(from.id);
  const text = String(msg.text || '').trim();

  if (text.indexOf('/start') === 0) {
    const payload = text.replace(/^\/start(?:@\w+)?\s*/, '').trim();
    await handleStartPayload(store, ctx, set, from, chatId, payload, token);
    return json({ ok: true });
  }

  const state = await store.get('tgstate:' + tgId);

  if (msg.contact) {
    if (!isOwnAccountContact(msg, tgId)) {
      await askOwnPhone(token, chatId, set, 'فقط دکمهٔ «ارسال شماره موبایل» پایین را بزن و Share را بزن. شماره را تایپ نکن.');
      return json({ ok: true });
    }
    const phone = normPhone(msg.contact.phone_number);
    const st = state || { mode: 'wait_contact', ticket: '', refCode: '' };
    const user = await finishNewUserFromState(store, set, from, chatId, st, phone, telegramDisplayName(from));
    if (st.pendingDl && user) {
      const dl = await store.get('dl:' + st.pendingDl);
      if (dl && !dl.used) await fulfillDownload(store, ctx, token, chatId, dl, set);
    }
    return json({ ok: true });
  }

  if (state && state.mode === 'wait_contact') {
    await askOwnPhone(token, chatId, set, 'شماره را تایپ نکن. فقط دکمهٔ «ارسال شماره موبایل» را بزن.');
    return json({ ok: true });
  }

  if (state && state.mode === 'wait_name') {
    // Complete registrations started before the name step was removed.
    if (!state.phone) {
      await askOwnPhone(token, chatId, set);
      return json({ ok: true });
    }
    const user = await finishNewUserFromState(store, set, from, chatId, state, state.phone, telegramDisplayName(from));
    if (state.pendingDl && user) {
      const dl = await store.get('dl:' + state.pendingDl);
      if (dl && !dl.used) await fulfillDownload(store, ctx, token, chatId, dl, set);
    }
    return json({ ok: true });
  }

  if (text === '/wallet' || text === 'کیف پول') {
    const user = await findUserByTg(store, tgId);
    if (!user) await tgSend(token, chatId, 'ابتدا از سایت وارد شوید.');
    else await tgSend(token, chatId, '💰 موجودی: ' + (user.wallet || 0) + ' ' + (set.walletUnitName || 'سکه') + (hasActiveSub(user) ? '\n👑 اشتراک فعال' : ''));
    return json({ ok: true });
  }

  await tgSend(token, chatId, 'از سایت روی «ورود با تلگرام» یا «دریافت از ربات» بزنید. دستورها: /start /wallet');
  return json({ ok: true });
}

async function apiTgLoginExisting(store, body) {
  const set = await getSettings(store);
  const initData = String(body.initData || '');
  if (!initData || !set.botToken) return json({ error: 'ورود با تلگرام هنوز فعال نشده' }, 400);
  if (!(await verifyTgInitData(initData, set.botToken))) return json({ error: 'اعتبارسنجی اطلاعات تلگرام ناموفق بود' }, 403);
  const params = new URLSearchParams(initData);
  const uObj = JSON.parse(params.get('user') || '{}');
  const tgId = String(uObj.id || '');
  if (!tgId) return json({ error: 'کاربر تلگرامی یافت نشد' }, 400);
  let user = await findUserByTg(store, tgId);
  if (!user && body.existingOnly === true) return json({ needsSignup: true });
  const name = [uObj.first_name, uObj.last_name].filter(Boolean).join(' ') || (uObj.username || ('کاربر ' + tgId));
  if (!user) {
    user = await createTgUser(store, {
      tgId: tgId, tgName: name, tgUsername: uObj.username || '', photoUrl: uObj.photo_url || '',
      phone: '', refCode: (body && body.ref) || '',
    });
  } else {
    user.lastLogin = Date.now();
    user.logins = (user.logins || 0) + 1;
    if (uObj.first_name) user.tgName = name;
    if (uObj.username) user.tgUsername = uObj.username;
    if (uObj.photo_url) user.photoUrl = uObj.photo_url;
    await saveUser(store, user);
  }
  user = await ensureTgAdmin(store, user);
  const token = await makeToken(store, user);
  return json({ token: token, user: pubUser(user) });
}

/* ═══════════════════════ کیف پول / اشتراک / دانلود ═══════════════════════ */

async function apiWallet(store, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const set = await getSettings(store);
  return json({
    user: pubUser(user),
    wallet: user.wallet || 0,
    txs: user.txs || [],
    hasSub: hasActiveSub(user),
    subUntil: user.subUntil || 0,
    canTransfer: canTransferCoins(user),
    economy: publicEconomy(set),
  });
}

async function apiTransfer(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  if (!canTransferCoins(user)) {
    return json({ error: 'برای انتقال سکه باید حداقل یک‌بار با استارز یا درگاه، سکه خریده باشید' }, 403);
  }
  const amount = round2(body.amount);
  const toRaw = String(body.to || '').trim();
  if (!(amount > 0)) return json({ error: 'مبلغ نامعتبر است' }, 400);
  if (!toRaw) return json({ error: 'گیرنده را وارد کنید (شماره یا یوزرنیم تلگرام)' }, 400);
  if (!(await rlHit(store, 'tx:' + user.username, 20, 3600))) return json({ error: 'تعداد انتقال زیاد است' }, 429);
  const dest = await resolveTransferDest(store, toRaw);
  if (!dest) return json({ error: 'گیرنده پیدا نشد. شماره موبایل یا @یوزرنیم تلگرام را وارد کنید' }, 404);
  if (dest.username === user.username) return json({ error: 'نمی‌توانید به خودتان انتقال دهید' }, 400);
  const fresh = await getUser(store, user.username);
  const label = dest.tgUsername ? ('@' + dest.tgUsername) : (dest.tgName || dest.username);
  const d = await debitWallet(store, fresh, amount, 'transfer_out', 'انتقال به ' + label);
  if (d.error) return json(d, 402);
  await creditWallet(store, dest, amount, 'transfer_in', 'دریافت از ' + (fresh.tgName || fresh.username));
  return json({ ok: true, wallet: fresh.wallet, to: dest.tgName || dest.tgUsername || dest.username });
}

async function apiSubscribe(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const set = await getSettings(store);
  const plan = String(body.plan || '');
  const meta = planMeta(set, plan);
  if (!meta || !(meta.price > 0)) return json({ error: 'طرح نامعتبر است' }, 400);
  const fresh = await getUser(store, user.username);
  const d = await payFromWallet(store, fresh, meta.price, 'subscribe', 'اشتراک ' + meta.title);
  if (d.error) return json(d, 402);
  const base = Math.max(Date.now(), fresh.subUntil || 0);
  fresh.subUntil = base + meta.days * 86400000;
  fresh.subPlan = plan;
  await saveUser(store, fresh);
  return json({ ok: true, user: pubUser(fresh), wallet: fresh.wallet, subUntil: fresh.subUntil });
}

async function apiDlRequest(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  if (!user.tgId) return json({ error: 'حساب تلگرام متصل نیست. یک‌بار با ربات وارد شوید.' }, 400);
  const set = await getSettings(store);
  if (!fileBotToken(set) || !fileBotUsername(set)) return json({ error: 'ربات ارسال فایل تنظیم نشده' }, 400);
  const item = await getItem(store, String(body.itemId || ''));
  if (!item) return json({ error: 'محتوا پیدا نشد' }, 404);
  const epId = body.epId ? String(body.epId) : '';
  const track = body.track === 'dub' ? 'dub' : 'sub';
  const quality = qualityKey(body.quality);
  const fileId = String(body.fileId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  const picked = pickDownloadSource(item, { epId: epId, track: track, quality: quality, fileId: fileId });
  if (picked.error) return json({ error: picked.error }, 400);
  if (picked.premium && !hasActiveSub(user)) {
    return json({ error: 'این کیفیت/قسمت فقط با اشتراک فعال قابل دریافت است.', needSub: true }, 403);
  }
  const fresh = await getUser(store, user.username);
  const sub = hasActiveSub(fresh);
  const price = downloadPrice(fresh, set);
  if (price > 0) {
    const d = await payFromWallet(store, fresh, price, 'download', 'دانلود: ' + (item.title || ''));
    if (d.error) return json(Object.assign(d, { needWallet: true }), 402);
  }
  const id = randomHex(8);
  const rec = {
    id: id,
    username: fresh.username,
    tgId: String(fresh.tgId),
    itemId: item.id,
    epId: epId,
    track: track,
    quality: quality || picked.quality || '',
    fileId: fileId || picked.fileId || '',
    createdAt: Date.now(),
    exp: Date.now() + 10 * 60 * 1000,
    used: false,
  };
  await store.set('dl:' + id, rec, 700);

  const botLink = fileBotLink(set, 'dl_' + id);
  const out = {
    ok: true,
    ticket: id,
    charged: price,
    unlimited: !!sub,
    wallet: fresh.wallet,
    vanishSec: Number(set.vanishSec) || CONFIG.VANISH_SEC,
    hasSub: sub,
    gateInfo: adGateInfo(set),
  };

  // کاربران دارای اشتراک هیچ تبلیغی نمی‌بینند
  const ad = sub ? null : (set.adGateEnabled === false ? null : pickAdForUser(await getAds(store), fresh));
  if (!ad) {
    out.botLink = botLink;
    return json(out);
  }

  const gid = randomHex(10);
  await store.set('adg:' + gid, {
    id: gid,
    username: fresh.username,
    dlId: id,
    adId: ad.id,
    sec: ad.sec,
    startAt: Date.now(),
    done: false,
  }, 1800);

  if (ad.once) {
    markAdSeen(fresh, ad.id);
    await saveUser(store, fresh);
  }
  await bumpAdStat(store, ad.id, 'views', 1);

  out.needAd = true;
  out.gate = gid;
  out.ad = publicAd(ad);
  return json(out);
}

async function apiDlGate(store, gid, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const g = await store.get('adg:' + gid);
  if (!g) return json({ error: 'مهلت تماشای تبلیغ تمام شد. دوباره روی دانلود بزنید.' }, 404);
  if (g.username !== user.username) return json({ error: 'دسترسی نامعتبر' }, 403);
  const rec = await store.get('dl:' + g.dlId);
  if (!rec) return json({ error: 'لینک دانلود منقضی شد. دوباره تلاش کنید.' }, 410);
  const need = adClampSec(g.sec);
  const passed = (Date.now() - (Number(g.startAt) || 0)) / 1000;
  if (passed + 0.8 < need) {
    return json({ error: 'تبلیغ هنوز تمام نشده است', remain: Math.max(0, Math.ceil(need - passed)) }, 425);
  }
  const set = await getSettings(store);
  if (!g.done) {
    g.done = true;
    await store.set('adg:' + gid, g, 1800);
  }
  return json({
    ok: true,
    botLink: fileBotLink(set, 'dl_' + g.dlId),
    vanishSec: Number(set.vanishSec) || CONFIG.VANISH_SEC,
  });
}

async function apiAdClick(store, adId, request) {
  const list = await getAds(store);
  let ad = null;
  for (let i = 0; i < list.length; i++) if (list[i].id === adId) ad = list[i];
  if (!ad || !ad.linkUrl) return json({ error: 'لینکی برای این تبلیغ ثبت نشده' }, 404);
  const ip = ipOf(request);
  const ok = await rlHit(store, 'adclick:' + adId + ':' + ip, 30, 300);
  if (ok) await bumpAdStat(store, adId, 'clicks', 1);
  return json({ ok: true, url: ad.linkUrl });
}

async function apiStarsStart(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const set = await getSettings(store);
  if (!set.starsEnabled || !set.botToken || !set.botUsername) return json({ error: 'شارژ با استارز فعال نیست' }, 400);
  const idx = parseInt(body.pack, 10);
  const pack = (set.starPacks || [])[idx];
  if (!pack) return json({ error: 'بسته نامعتبر' }, 400);
  if (user.tgId) {
    const r = await botApi(set.botToken, 'sendInvoice', {
      chat_id: Number(user.tgId) || user.tgId,
      title: 'شارژ کیف پول',
      description: pack.stars + ' استارز = ' + pack.units + ' ' + (set.walletUnitName || 'سکه'),
      payload: 'stars:' + pack.units + ':' + user.username,
      currency: 'XTR',
      prices: [{ label: pack.units + ' ' + (set.walletUnitName || 'سکه'), amount: Number(pack.stars) }],
    });
    if (r.ok) return json({ ok: true, sent: true, botLink: botLink(set, '') });
  }
  return json({ ok: true, sent: false, botLink: botLink(set, 'stars_' + idx) });
}

async function apiRialStart(store, body, request) {
  return json({ error: 'درگاه ریالی نداریم. با استارز تلگرام شارژ کنید؛ اگر استارز ندارید از راهنمای کیف پول با کارت شتاب بخرید.' }, 400);
}

function k2kMs(n) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) return 0;
  if (n < 1e11) n *= 1000;
  return Math.round(n);
}
function k2kPublicInvoice(inv) {
  if (!inv) return null;
  const now = Date.now();
  const createdAt = k2kMs(inv.createdAt);
  const expiresAt = k2kMs(inv.expiresAt);
  return {
    id: inv.id,
    status: inv.status,
    amountToman: inv.amountToman,
    amountRial: inv.amountRial,
    extraToman: inv.extraToman || 0,
    packToman: inv.packToman || inv.amountToman || 0,
    units: inv.units,
    cardNumber: inv.cardNumber,
    cardNumberFmt: formatCardNumber(inv.cardNumber),
    cardHolder: inv.cardHolder || '',
    cardBank: inv.cardBank || '',
    createdAt: createdAt,
    expiresAt: expiresAt,
    remainingMs: Math.max(0, expiresAt - now),
    paidAt: inv.paidAt || 0,
    trackCode: inv.trackCode || '',
    transferAt: inv.transferAt || 0,
    transferDate: inv.transferDate || '',
    transferTime: inv.transferTime || '',
    submittedAt: inv.submittedAt || 0,
  };
}
function normK2kTrack(raw) {
  let s = toEnDigits(raw || '').toUpperCase().trim();
  s = s.replace(/[^A-Z0-9]/g, '');
  return s.slice(0, 48);
}
function pad2(n) {
  n = String(n);
  return n.length < 2 ? ('0' + n) : n;
}
function parseK2kTransfer(body) {
  body = body || {};
  let date = toEnDigits(body.transferDate || body.date || '').trim();
  let time = toEnDigits(body.transferTime || body.time || '').trim();
  const dm = date.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dm || !tm) return { ok: false };
  const y = parseInt(dm[1], 10), mo = parseInt(dm[2], 10), d = parseInt(dm[3], 10);
  const hh = parseInt(tm[1], 10), mm = parseInt(tm[2], 10), ss = parseInt(tm[3] || '0', 10);
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return { ok: false };
  const at = Date.UTC(y, mo - 1, d, hh, mm, ss) - (3 * 3600000 + 30 * 60000);
  return { ok: true, at: at, date: y + '-' + pad2(mo) + '-' + pad2(d), time: pad2(hh) + ':' + pad2(mm) };
}
async function listAdminUsers(store) {
  const keys = await store.list('u:');
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const u = await store.get(keys[i]);
    if (u && u.role === 'admin') out.push(u);
  }
  return out;
}
async function k2kLoadPend(store) {
  const v = await store.get('k2k:pend');
  if (Array.isArray(v)) return v.map(function (x) { return String(x || ''); }).filter(Boolean);
  return [];
}
async function k2kSavePend(store, ids) {
  const seen = {};
  const out = [];
  (ids || []).forEach(function (id) {
    id = String(id || '');
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push(id);
  });
  await store.set('k2k:pend', out.slice(0, 120));
}
async function k2kDropPend(store, id) {
  const pend = await k2kLoadPend(store);
  await k2kSavePend(store, pend.filter(function (x) { return x !== id; }));
}
async function k2kAllActive(store) {
  const ids = await k2kLoadPend(store);
  try {
    const keys = await store.list('k2k:');
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i] || '');
      if (k === 'k2k:pend' || k.indexOf('k2k:track:') === 0) continue;
      if (k.indexOf('k2k:') !== 0) continue;
      const id = k.slice(4);
      if (!id || id === 'pend' || ids.indexOf(id) >= 0) continue;
      ids.push(id);
    }
  } catch (e) { }
  const out = [];
  const seen = {};
  const now = Date.now();
  const keep = [];
  for (let i = 0; i < ids.length; i++) {
    const inv = await store.get('k2k:' + ids[i]);
    if (!inv || !inv.id || seen[inv.id]) continue;
    seen[inv.id] = 1;
    if (inv.status === 'pending' && k2kMs(inv.expiresAt) < now) {
      inv.status = 'expired';
      await store.set('k2k:' + inv.id, inv, 86400);
      continue;
    }
    if (inv.status === 'pending' || inv.status === 'submitted') {
      out.push(inv);
      keep.push(inv.id);
    }
  }
  await k2kSavePend(store, keep);
  return out;
}
function k2kRandInt(min, max) {
  const buf = crypto.getRandomValues(new Uint8Array(2));
  const n = (buf[0] << 8) | buf[1];
  return min + (n % (max - min + 1));
}
async function k2kPickUniqueExtra(store, packToman) {
  const used = {};
  const act = await k2kAllActive(store);
  for (let i = 0; i < act.length; i++) used[Number(act[i].amountToman) || 0] = 1;
  for (let t = 0; t < 40; t++) {
    const extra = k2kRandInt(11, 199);
    const amt = packToman + extra;
    if (!used[amt]) return extra;
  }
  for (let extra = 11; extra <= 499; extra++) {
    if (!used[packToman + extra]) return extra;
  }
  return 11 + (Date.now() % 89);
}
async function k2kCancelUserPending(store, username) {
  const pend = await k2kLoadPend(store);
  const keep = [];
  const now = Date.now();
  for (let i = 0; i < pend.length; i++) {
    const inv = await store.get('k2k:' + pend[i]);
    if (!inv) continue;
    if (inv.status === 'pending' && inv.username === username) {
      inv.status = 'cancelled';
      await store.set('k2k:' + inv.id, inv, 86400);
      continue;
    }
    if (inv.status === 'pending' && k2kMs(inv.expiresAt) < now) {
      inv.status = 'expired';
      await store.set('k2k:' + inv.id, inv, 86400);
      continue;
    }
    if (inv.status === 'pending' || inv.status === 'submitted') keep.push(pend[i]);
  }
  await k2kSavePend(store, keep);
  return keep;
}
function k2kAdminText(inv, user, set) {
  const name = (user && (user.tgName || user.username)) || inv.username;
  const un = user && user.tgUsername ? (' @' + user.tgUsername) : '';
  const phone = user && user.phone ? ('\nموبایل: ' + htmlEscape(user.phone)) : '';
  const unit = (set && set.walletUnitName) || 'سکه';
  return '💳 <b>کارت‌به‌کارت — رسید واریز</b>\n\n' +
    'کاربر: ' + htmlEscape(name) + htmlEscape(un) + phone + '\n' +
    'مبلغ دقیق (یکتا): <b>' + inv.amountToman + '</b> تومان' +
    (inv.extraToman ? (' — بسته ' + (inv.packToman || '') + ' + ' + inv.extraToman) : '') + '\n' +
    'زمان اعلام: <b>' + htmlEscape((inv.transferDate || '') + ' ' + (inv.transferTime || '')) + '</b>\n' +
    'سکه: ' + inv.units + ' ' + htmlEscape(unit) + '\n' +
    'فاکتور: <code>' + htmlEscape(inv.id) + '</code>\n\n' +
    'فقط با مبلغ یکتای واریزی تطبیق دهید.';
}
async function k2kNotifyAdmins(store, set, inv, user) {
  const token = set.botToken;
  if (!token) return;
  const text = k2kAdminText(inv, user, set);
  inv.adminText = text;
  const kb = {
    inline_keyboard: [[
      { text: '✅ تأیید', callback_data: 'k2k:ok:' + inv.id },
      { text: '❌ رد', callback_data: 'k2k:no:' + inv.id },
    ]],
  };
  const admins = await listAdminUsers(store);
  const notices = [];
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    if (!a || !a.tgId) continue;
    const r = await botApi(token, 'sendMessage', { chat_id: a.tgId, text: text, parse_mode: 'HTML', reply_markup: kb }, 2500);
    if (r && r.ok && r.result && r.result.message_id) {
      notices.push({ chatId: a.tgId, messageId: r.result.message_id });
    }
  }
  inv.adminNotices = notices;
  await store.set('k2k:' + inv.id, inv, 86400 * 14);
}
async function k2kEditAdminNotices(store, set, inv, approved, adminUser) {
  const token = set && set.botToken;
  if (!token) return;
  const notes = inv.adminNotices || [];
  const mark = approved ? '✅ تأیید شد' : '❌ رد شد';
  const by = (adminUser && (adminUser.tgName || adminUser.username)) || '';
  const base = inv.adminText || k2kAdminText(inv, null, set);
  const text = base + '\n\n<b>' + mark + '</b>' + (by ? (' توسط ' + htmlEscape(by)) : '');
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (!n || !n.chatId || !n.messageId) continue;
    await botApi(token, 'editMessageText', {
      chat_id: n.chatId,
      message_id: n.messageId,
      parse_mode: 'HTML',
      text: text,
    }, 2500);
  }
}
async function k2kApplyDecision(store, id, adminUser, approve, reason) {
  id = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const inv = await store.get('k2k:' + id);
  if (!inv) return { error: 'فاکتور نیست', statusCode: 404 };
  if (inv.status === 'paid') return { error: 'قبلاً تأیید شده', statusCode: 400 };
  if (inv.status === 'rejected') return { error: 'قبلاً رد شده', statusCode: 400 };
  if (inv.status !== 'submitted') return { error: 'هنوز اعلام واریز نشده', statusCode: 400 };
  const set = await getSettings(store);
  const user = await getUser(store, inv.username);
  if (!user) return { error: 'کاربر فاکتور نیست', statusCode: 404 };
  const token = set.botToken;
  if (approve) {
    inv.status = 'paid';
    inv.paidAt = Date.now();
    inv.decidedBy = adminUser && adminUser.username;
    await store.set('k2k:' + inv.id, inv, 86400 * 14);
    await k2kDropPend(store, inv.id);
    const r = await creditPurchasedCoins(store, user, inv.units, 'k2k', 'کارت‌به‌کارت ' + inv.amountToman + ' تومان');
    if (r && r.error) return { error: r.error, statusCode: 500 };
    if (user.tgId && token) {
      await botApi(token, 'sendMessage', { chat_id: user.tgId, text: '✅ واریز کارت‌به‌کارت تأیید شد.\n' + inv.units + ' ' + (set.walletUnitName || 'سکه') + ' به کیف پول اضافه شد.\nموجودی: ' + user.wallet, parse_mode: 'HTML' }, 2500);
    }
    await k2kEditAdminNotices(store, set, inv, true, adminUser);
    return { ok: true, status: 'paid', units: inv.units, wallet: user.wallet };
  }
  inv.status = 'rejected';
  inv.rejectedAt = Date.now();
  inv.decidedBy = adminUser && adminUser.username;
  inv.rejectReason = String(reason || '').slice(0, 200);
  await store.set('k2k:' + inv.id, inv, 86400 * 7);
  await k2kDropPend(store, inv.id);
  if (user.tgId && token) {
    await botApi(token, 'sendMessage', { chat_id: user.tgId, text: '❌ واریز کارت‌به‌کارت تأیید نشد.\nمبلغ واریزی با فاکتور مطابقت نداشت. اگر دقیقاً این مبلغ را واریز کرده‌اید با پشتیبانی تماس بگیرید.', parse_mode: 'HTML' }, 2500);
  }
  await k2kEditAdminNotices(store, set, inv, false, adminUser);
  return { ok: true, status: 'rejected' };
}
async function handleK2kAdminCallback(store, cq, set, token) {
  const data = String((cq && cq.data) || '');
  const m = data.match(/^k2k:(ok|no):([a-zA-Z0-9]+)$/);
  if (!m) {
    await botApi(token, 'answerCallbackQuery', { callback_query_id: cq.id });
    return json({ ok: true });
  }
  const fromId = String((cq.from && cq.from.id) || '');
  const admin = await findUserByTg(store, fromId);
  if (!admin || admin.role !== 'admin') {
    await botApi(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'فقط مدیر می‌تواند تأیید کند', show_alert: true });
    return json({ ok: true });
  }
  const out = await k2kApplyDecision(store, m[2], admin, m[1] === 'ok', '');
  await botApi(token, 'answerCallbackQuery', {
    callback_query_id: cq.id,
    text: out.error ? out.error : (out.status === 'paid' ? 'تأیید شد ✓' : 'رد شد'),
    show_alert: !!out.error,
  }, 2500);
  return json({ ok: true, k2k: out.status || null });
}
async function apiK2kCreate(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const set = await getSettings(store);
  if (!set.k2kEnabled || !set.k2kCardNumber) {
    return json({ error: 'کارت‌به‌کارت فعلاً فعال نیست' }, 400);
  }
  const packs = Array.isArray(set.k2kPacks) ? set.k2kPacks : [];
  const idx = Math.round(Number(body && body.pack));
  const pack = packs[idx];
  if (!pack || !(pack.toman > 0) || !(pack.units > 0)) return json({ error: 'بسته نامعتبر است' }, 400);
  const ttl = Math.max(600, Number(set.k2kTtlSec) || 1800);
  await k2kCancelUserPending(store, user.username);
  const extra = await k2kPickUniqueExtra(store, pack.toman);
  const amountToman = pack.toman + extra;
  const now = Date.now();
  const inv = {
    id: 'k' + randomHex(8),
    status: 'pending',
    username: user.username,
    packToman: pack.toman,
    units: pack.units,
    extraToman: extra,
    amountToman: amountToman,
    amountRial: amountToman * 10,
    cardNumber: set.k2kCardNumber,
    cardHolder: set.k2kCardHolder || '',
    cardBank: set.k2kCardBank || 'بانک ملی',
    createdAt: now,
    expiresAt: now + ttl * 1000,
  };
  await store.set('k2k:' + inv.id, inv, ttl + 86400);
  const ids = await k2kLoadPend(store);
  ids.unshift(inv.id);
  await k2kSavePend(store, ids);
  return json(k2kPublicInvoice(inv));
}
async function apiK2kGet(store, id, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  id = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const inv = await store.get('k2k:' + id);
  if (!inv || inv.username !== user.username) return json({ error: 'فاکتور نیست' }, 404);
  if (inv.status === 'pending' && k2kMs(inv.expiresAt) < Date.now()) {
    inv.status = 'expired';
    await store.set('k2k:' + inv.id, inv, 86400);
  }
  const out = k2kPublicInvoice(inv);
  out.wallet = user.wallet || 0;
  return json(out);
}
async function apiK2kCancel(store, id, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  id = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const inv = await store.get('k2k:' + id);
  if (!inv || inv.username !== user.username) return json({ error: 'فاکتور نیست' }, 404);
  if (inv.status === 'pending') {
    inv.status = 'cancelled';
    await store.set('k2k:' + inv.id, inv, 86400);
    await k2kDropPend(store, inv.id);
  }
  return json(k2kPublicInvoice(inv));
}
async function apiK2kTrack(store, id, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  id = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const inv = await store.get('k2k:' + id);
  if (!inv || inv.username !== user.username) return json({ error: 'فاکتور نیست' }, 404);
  if (inv.status === 'submitted') return json({ error: 'واریز قبلاً اعلام شده؛ منتظر تأیید مدیر بمانید' }, 400);
  if (inv.status === 'paid') return json({ error: 'این فاکتور قبلاً تأیید شده' }, 400);
  if (inv.status !== 'pending') return json({ error: 'این فاکتور قابل اعلام واریز نیست' }, 400);
  if (inv.expiresAt && k2kMs(inv.expiresAt) < Date.now()) {
    inv.status = 'expired';
    await store.set('k2k:' + inv.id, inv, 86400);
    return json({ error: 'مهلت فاکتور تمام شد' }, 400);
  }
  const when = parseK2kTransfer(body);
  if (!when.ok) return json({ error: 'تاریخ و ساعت واریز را وارد کنید (طبق رسید بانک)' }, 400);
  const code = normK2kTrack(body && body.trackCode);
  if (code) {
    const used = await store.get('k2k:track:' + code);
    if (used && String(used) !== inv.id) return json({ error: 'این کد قبلاً ثبت شده' }, 400);
    await store.set('k2k:track:' + code, inv.id, 86400 * 14);
  }
  inv.trackCode = code;
  inv.transferAt = when.at;
  inv.transferDate = when.date;
  inv.transferTime = when.time;
  inv.status = 'submitted';
  inv.submittedAt = Date.now();
  await store.set('k2k:' + inv.id, inv, 86400 * 14);
  const pendNow = await k2kLoadPend(store);
  if (pendNow.indexOf(inv.id) < 0) {
    pendNow.unshift(inv.id);
    await k2kSavePend(store, pendNow);
  }
  const set = await getSettings(store);
  await k2kNotifyAdmins(store, set, inv, user);
  const out = k2kPublicInvoice(inv);
  out.wallet = user.wallet || 0;
  return json(out);
}
async function apiAdminK2kList(store) {
  const act = await k2kAllActive(store);
  const out = [];
  for (let i = 0; i < act.length; i++) {
    const inv = act[i];
    const u = await getUser(store, inv.username);
    out.push({
      id: inv.id,
      status: inv.status,
      amountToman: inv.amountToman,
      amountRial: inv.amountRial,
      extraToman: inv.extraToman || 0,
      packToman: inv.packToman || 0,
      units: inv.units,
      trackCode: inv.trackCode || '',
      transferAt: inv.transferAt || 0,
      transferDate: inv.transferDate || '',
      transferTime: inv.transferTime || '',
      createdAt: inv.createdAt,
      submittedAt: inv.submittedAt || 0,
      expiresAt: inv.expiresAt,
      username: inv.username,
      tgName: (u && u.tgName) || '',
      phone: (u && u.phone) || '',
    });
  }
  out.sort(function (a, b) {
    const as = a.status === 'submitted' ? 1 : 0;
    const bs = b.status === 'submitted' ? 1 : 0;
    if (bs !== as) return bs - as;
    return (b.submittedAt || b.createdAt || 0) - (a.submittedAt || a.createdAt || 0);
  });
  return json({ invoices: out });
}
function k2kHookSecretOf(request, body, set) {
  const hdr = request.headers.get('x-k2k-secret') || '';
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().indexOf('bearer ') === 0 ? auth.slice(7).trim() : '';
  let q = '';
  try { q = new URL(request.url).searchParams.get('secret') || ''; } catch (e) { q = ''; }
  const fromBody = body && body.secret ? String(body.secret) : '';
  return hdr || bearer || fromBody || q;
}
async function apiK2kBale(store, body, request) {
  return await apiK2kHook(store, body || {}, request);
}
async function apiK2kHook(store, body, request) {
  const set = await getSettings(store);
  if (!set.k2kSecret) return json({ error: 'وب‌هوک کارت‌به‌کارت تنظیم نشده' }, 503);
  const got = k2kHookSecretOf(request, body, set);
  if (!secretsEqual(got, set.k2kSecret)) return json({ error: 'forbidden' }, 401);
  return json({ ok: true, matched: false, manual: true });
}

function payResultPage(ok, msg) {
  const color = ok ? '#3ddc84' : '#ff5470';
  const html = '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>نتیجه پرداخت</title><body style="font-family:Tahoma,sans-serif;background:#0b0e14;color:#eef1f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#151a24;border:1px solid #242c3b;border-radius:14px;padding:28px;max-width:420px;text-align:center"><div style="font-size:42px">' + (ok ? '✅' : '❌') + '</div><h2 style="color:' + color + '">' + htmlEscape(msg) + '</h2><p style="color:#98a2b6;font-size:14px">می‌توانید این صفحه را ببندید و به سایت برگردید.</p><p><a href="/#/wallet" style="color:#ffb01f">بازگشت به کیف پول</a></p></div></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function apiZarinpalCb(store, url) {
  return payResultPage(false, 'درگاه ریالی غیرفعال است. کیف پول را با استارز شارژ کنید.');
  const status = url.searchParams.get('Status') || url.searchParams.get('status');
  const authority = url.searchParams.get('Authority') || url.searchParams.get('authority');
  if (status !== 'OK' || !authority) return payResultPage(false, 'پرداخت لغو شد یا ناموفق بود');
  const rec = await store.get('pay:' + authority);
  if (!rec) return payResultPage(false, 'رسید پرداخت پیدا نشد یا منقضی است');
  const set = await getSettings(store);
  try {
    const zr = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant_id: set.zarinpalMerchant, amount: rec.amountRial, authority: authority }),
    });
    const data = await zr.json();
    const code = data && data.data && data.data.code;
    if (code !== 100 && code !== 101) return payResultPage(false, 'تأیید پرداخت ناموفق بود');
    if (code === 101) return payResultPage(true, 'این پرداخت قبلاً ثبت شده بود');
    const user = await getUser(store, rec.username);
    if (!user) return payResultPage(false, 'کاربر پیدا نشد');
    rec.done = true;
    await store.set('pay:' + authority, rec, 86400);
    await creditPurchasedCoins(store, user, rec.units, 'rial', 'شارژ زرین‌پال');
    return payResultPage(true, rec.units + ' ' + (set.walletUnitName || 'سکه') + ' به کیف پول اضافه شد');
  } catch (e) {
    return payResultPage(false, 'خطا در تأیید پرداخت');
  }
}


async function fetchChannelPostMeta(store, set, rawUrl, adminUser) {
  const parsed = parseTmeLink(rawUrl);
  if (!parsed) return { error: 'لینک پیام کانال معتبر نیست. نمونه: https://t.me/kanal/123' };
  if (!parsed.private && parsed.user) {
    const res = await resolvePost(store, parsed.user, parsed.msgId, true);
    const tmeUrl = res.tmeUrl || ('https://t.me/' + parsed.user + '/' + parsed.msgId);
    return {
      caption: res.caption || '',
      thumb: res.thumb || tmeUrl,
      tmeUrl: tmeUrl,
      kind: res.kind || '',
    };
  }
  const token = fileBotToken(set) || set.botToken;
  if (!token) return { error: 'برای خواندن کانال خصوصی توکن ربات را بگذارید و ربات را مدیر کانال کنید' };
  const dest = adminUser && adminUser.tgId;
  if (!dest) return { error: 'برای کانال خصوصی با همین تلگرام وارد پنل شوید' };
  const r = await botApi(token, 'forwardMessage', {
    chat_id: tgChatParam(dest),
    from_chat_id: tgChatParam(parsed.chatId),
    message_id: Number(parsed.msgId),
    disable_notification: true,
  }, 15000);
  if (!r.ok || !r.result) {
    return { error: 'پست خصوصی خوانده نشد. ربات باید مدیر کانال باشد. ' + (r.description || '') };
  }
  const msg = r.result;
  const caption = msg.caption || msg.text || '';
  if (msg.message_id) {
    await botApi(token, 'deleteMessage', { chat_id: tgChatParam(dest), message_id: msg.message_id }, 4000);
  }
  const poster = publicSourceUrl({ chatId: parsed.chatId, msgId: parsed.msgId });
  return { caption: caption, thumb: poster, tmeUrl: poster, kind: msg.photo ? 'photo' : (msg.video ? 'video' : 'text') };
}

/* ═══════════════════════ API مدیریت ═══════════════════════ */

function maskToken(t) {
  if (!t) return '';
  return t.length <= 10 ? t : t.slice(0, 8) + '…' + t.slice(-4);
}

async function adminUpsertItem(store, set, body, existing) {
  const item = existing ? JSON.parse(JSON.stringify(existing)) : newItem(body.title, body.type, null, '');
  const fields = ['title', 'type', 'year', 'quality', 'access', 'featured', 'description', 'channelName', 'posterOverride', 'director', 'actors', 'country', 'ageRating', 'network'];
  for (const f of fields) {
    if (body[f] !== undefined) {
      if (f === 'year') item[f] = parseInt(body[f], 10) || item.year;
      else if (f === 'featured') item[f] = !!body[f];
      else item[f] = body[f];
    }
  }
  if (body.imdb !== undefined) {
    const n = Number(body.imdb);
    item.imdb = isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  }
  /* سریال: سال آخرین فصل + وضعیت «در حال پخش» */
  if (body.yearEnd !== undefined) {
    const ye = parseInt(body.yearEnd, 10) || 0;
    item.yearEnd = (ye > 1888 && ye < 2200) ? ye : 0;
  }
  if (body.airing !== undefined) item.airing = !!body.airing;
  if (body.airingSeason !== undefined) item.airingSeason = Math.max(0, Math.min(999, parseInt(body.airingSeason, 10) || 0));
  if (body.airingText !== undefined) item.airingText = String(body.airingText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (item.type !== 'series') { item.airing = false; }
  if (body.imdbUrl && body.galleryUrl === undefined) {
    return { error: 'منبع گالری به IMP Awards تغییر کرده است. صفحه را تازه کنید و لینک پوستر IMP Awards را وارد کنید.', status: 400 };
  }
  const galleryLimitProvided = body.galleryLimit !== undefined || body.galleryCount !== undefined;
  const wantedGalleryLimit = galleryLimitProvided
    ? galleryLimitOf(body.galleryLimit !== undefined ? body.galleryLimit : body.galleryCount, galleryLimitOf(existing && existing.galleryLimit, CONFIG.GALLERY_LIMIT))
    : null;
  if (body.galleryUrl !== undefined) {
    const rawUrl = String(body.galleryUrl || '').trim();
    const limit = wantedGalleryLimit != null ? wantedGalleryLimit : galleryLimitOf(existing && existing.galleryLimit, CONFIG.GALLERY_LIMIT);
    if (!rawUrl) {
      item.galleryUrl = '';
      item.galleryImages = [];
      item.galleryImagesUpdatedAt = 0;
      item.galleryLimit = limit;
    } else {
      try {
        const gallery = await getImpGallery(store, rawUrl, { existing: existing, limit: limit });
        item.galleryUrl = gallery.galleryUrl;
        item.galleryImages = gallery.images;
        item.galleryImagesUpdatedAt = gallery.fetchedAt;
        item.galleryLimit = limit;
      } catch (e) { return { error: e.message, status: e.status || 502, code: e.code, diagnostics: e.diagnostics }; }
    }
    delete item.imdbUrl;
    delete item.imdbImages;
    delete item.imdbImagesUpdatedAt;
  } else if (galleryLimitProvided) {
    const limit = wantedGalleryLimit;
    item.galleryLimit = limit;
    if (Object.prototype.hasOwnProperty.call(item, 'galleryUrl') && item.galleryUrl) {
      const current = normalizeImpImages(item.galleryImages, item.galleryUrl, limit);
      if (current.length < limit) {
        try {
          const gallery = await getImpGallery(store, item.galleryUrl, { existing: existing, limit: limit });
          item.galleryImages = gallery.images;
          item.galleryImagesUpdatedAt = gallery.fetchedAt;
        } catch (e) {
          item.galleryImages = current;
        }
      } else {
        item.galleryImages = current;
      }
    } else if (!Object.prototype.hasOwnProperty.call(item, 'galleryUrl') && item.imdbImages) {
      item.imdbImages = normalizeLegacyImdbImages(item.imdbImages, limit);
    } else if (item.galleryImages && item.galleryImages.length > limit) {
      item.galleryImages = normalizeImpImages(item.galleryImages, item.galleryUrl, limit);
    }
  } else if (item.galleryLimit == null) {
    item.galleryLimit = galleryLimitOf(existing && existing.galleryLimit, CONFIG.GALLERY_LIMIT);
  }
  if (body.duration !== undefined) item.duration = Math.max(0, parseInt(body.duration, 10) || 0);
  if (body.dubbed !== undefined) item.dubbed = !!body.dubbed;
  if (body.subtitled !== undefined) item.subtitled = !!body.subtitled;
  if (body.censored !== undefined) item.censored = !!body.censored;
  if (body.genres !== undefined) {
    item.genres = String(body.genres).split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
  }
  if (body.posterUrl !== undefined) {
    const pu = String(body.posterUrl).trim();
    if (!pu) item.posterOverride = '';
    else if (pu.length > 2000) return { error: 'لینک پوستر خیلی بلند است' };
    else if (parseTmeLink(pu) || isPublicHttpUrl(pu)) item.posterOverride = pu;
    else return { error: 'لینک پوستر باید http:// یا https:// باشد (تلگرام یا هر سایت تصویر)' };
  }
  if (item.posterOverride && item.posterOverride.indexOf('data:') === 0 && item.posterOverride.length > CONFIG.MAX_POSTER * 2) {
    return { error: 'پوستر بزرگ‌تر از حد مجاز است' };
  }
  if (body.sourceUrl !== undefined && String(body.sourceUrl).trim() !== '') {
    const p = parseTmeLink(String(body.sourceUrl).trim());
    if (p) {
      if (p.private) {
        item.source = sourceFromParsed(p);
        ensureVariants(item);
        const qkP = qualityKey(item.quality) || '1080';
        item.variants.sub[qkP] = { source: item.source, sizeBytes: null };
        await store.set('src:c:' + p.chatId + '/' + p.msgId, item.id);
      } else {
        const res = await resolvePost(store, p.user, p.msgId, true);
        item.source = { user: p.user, msgId: p.msgId, tmeUrl: res.tmeUrl, chatId: null, fileId: '', mediaType: res.kind || '' };
        ensureVariants(item);
        const qk0 = qualityKey(item.quality) || qualityKey(guessQuality(res.w)) || '1080';
        item.variants.sub[qk0] = { source: item.source, sizeBytes: res.sizeBytes || null };
        if (res.kind === 'video' || res.kind === 'audio') {
          item.media = { sizeBytes: res.sizeBytes, width: res.w, height: res.h, kind: res.kind };
          if (!item.quality && res.w) item.quality = guessQuality(res.w);
          if (!item.description && res.caption) item.description = res.caption.slice(0, 1200);
          if (!item.title || item.title === 'بدون عنوان') item.title = res.caption.split('\n')[0].slice(0, 140) || item.title;
        } else if (res.kind === 'document') {
          item.media = { sizeBytes: res.sizeBytes, kind: 'document' };
        }
        await store.set('src:' + p.user + '/' + p.msgId, item.id);
      }
    } else if (/^https:\/\//.test(String(body.sourceUrl).trim()) && isAllowedMediaUrl(String(body.sourceUrl).trim())) {
      item.source = { directUrl: String(body.sourceUrl).trim() };
    } else {
      return { error: 'لینک منبع معتبر نیست (لینک t.me/کانال/شماره)' };
    }
  }
  item.updatedAt = Date.now();
  await saveItemRecord(store, item);
  bustItem(item.id);
  await idxUpsert(store, item);
  return { item: item };
}

async function maybeSetWebhook(store, set, origin) {
  if (!set.botToken) return;
  if (origin) set.publicUrl = origin;
  if (!set.webhookSecret) set.webhookSecret = randomHex(16);
  if (set.publicUrl) {
    const r = await botApi(set.botToken, 'setWebhook', {
      url: set.publicUrl + '/api/tg/webhook',
      secret_token: set.webhookSecret,
      allowed_updates: ['message', 'channel_post', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false,
    });
    set.webhookOk = !!r.ok;
    set.webhookError = r.ok ? '' : (r.description || '');
  }
  if (set.botToken) {
    if (!set.botId) set.botId = botIdFromToken(set.botToken);
    const me = await botApi(set.botToken, 'getMe');
    if (me.ok && me.result) {
      if (me.result.username && !set.botUserFromEnv) set.botUsername = me.result.username;
      if (me.result.id) set.botId = me.result.id;
    }
  }
  const ft = fileBotToken(set);
  if (ft && ft !== set.botToken && set.publicUrl) {
    const rf = await botApi(ft, 'setWebhook', {
      url: set.publicUrl + '/api/tg/file-webhook',
      secret_token: set.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    set.fileWebhookOk = !!rf.ok;
    set.fileWebhookError = rf.ok ? '' : (rf.description || '');
    const mef = await botApi(ft, 'getMe');
    if (mef.ok && mef.result && mef.result.username && !set.deliveryUserFromEnv) {
      set.deliveryBotUsername = mef.result.username;
    }
  }
}

const MAINTENANCE_PREFIXES = ['src:', 'views:', 'sub:', 'tg:', 'ph:', 'tgu:', 'refcode:', 'adstat:', 'k2k:track:'];
async function orphanReason(store, key) {
  if (!MAINTENANCE_PREFIXES.some(function (p) { return key.startsWith(p); })) return '';
  const value = await store.get(key);
  if (value == null) return '';
  if (key.startsWith('src:')) {
    if (typeof value !== 'string' || !/^i_[a-z0-9]+$/.test(value)) return '';
    return await store.get('it:' + value) ? '' : 'ارجاع به محتوای حذف‌شده';
  }
  if (key.startsWith('views:')) return await store.get('it:' + key.slice(6)) ? '' : 'آمار محتوای حذف‌شده';
  if (key.startsWith('sub:')) {
    if (!value.itemId) return '';
    return await store.get('it:' + value.itemId) ? '' : 'زیرنویس محتوای حذف‌شده';
  }
  if (key.startsWith('adstat:')) {
    const ads = await store.get('ads');
    return Array.isArray(ads) && !ads.some(function (ad) { return 'adstat:' + ad.id === key; }) ? 'آمار تبلیغ حذف‌شده' : '';
  }
  if (key.startsWith('k2k:track:')) {
    if (typeof value !== 'string') return '';
    return await store.get('k2k:' + value) ? '' : 'کد پیگیری فاکتور حذف‌شده یا منقضی';
  }
  if (typeof value !== 'string' || !/^[a-z0-9_]+$/.test(value)) return '';
  return await store.get('u:' + value) ? '' : 'ارجاع به کاربر حذف‌شده';
}
async function maintenanceBatch(store, body) {
  if (body.action === 'delete') {
    if (body.confirm !== 'DELETE_ORPHANS' || !Array.isArray(body.keys) || body.keys.length > 10) return json({error:'درخواست پاک‌سازی نامعتبر'}, 400);
    let deleted = 0, skipped = 0;
    for (const key of new Set(body.keys)) {
      if (typeof key !== 'string' || key.length > 512) return json({error:'کلید نامعتبر'}, 400);
      // Re-check every dependency in this new request, never trust the preview.
      if (await orphanReason(store, key)) { await store.del(key); deleted++; } else skipped++;
    }
    return json({deleted:deleted, skipped:skipped});
  }
  const prefix = body.prefix || 'src:';
  if (!MAINTENANCE_PREFIXES.includes(prefix)) return json({error:'گروه نامعتبر'}, 400);
  const page = await store.listPage(prefix, String(body.cursor || '').slice(0, 2048), 10);
  const candidates = [];
  for (const key of page.keys) {
    const reason = await orphanReason(store, key);
    if (reason) candidates.push({key:key, reason:reason});
  }
  return json({scanned:page.keys.length, candidates:candidates, cursor:page.cursor});
}
async function contentSetupStatus(store, admin) {
  const env=store.env, settings=await getSettings(store);
  const token=String(env.CONTENT_BOT_TOKEN || '');
  const independent=!!token && token!==settings.botToken && token!==fileBotToken(settings);
  const adminIds=String(env.CONTENT_ADMIN_IDS || '').split(',').map(x=>x.trim()).filter(Boolean);
  let channelMessage='اختیاری: هنوز کانالی تنظیم نشده؛ گفتگوی خصوصی ربات قابل استفاده است.', channelsOk=true;
  try {
    const rules=contentChannelRules(env), ids=Object.keys(rules);
    const samples=['-1001111111111','-1002222222222','-1003333333333'];
    if (ids.some(id=>samples.includes(id) || rules[id].targets.some(t=>samples.includes(t)))) {
      channelsOk=false; channelMessage='شناسه‌های کانال نمونه هنوز در تنظیمات هستند. آن‌ها را با شناسه واقعی کانال خودتان جایگزین کنید.';
    } else if (ids.length) channelMessage=ids.length+' کانال تعریف شده؛ عضویت و مجوز ادمین ربات در تلگرام باید جداگانه بررسی شود.';
  } catch(e) { channelsOk=false; channelMessage=e.message; }
  let origin=''; try { origin=await contentSiteOrigin(env); } catch {}
  const steps=[
    {ok:independent,title:'۱. توکن ربات مدیریت',help:!token?'در Cloudflare همین Worker، CONTENT_BOT_TOKEN را با نوع Secret اضافه کنید.':!independent?'توکن باید متعلق به ربات سوم باشد، نه ربات ورود یا دانلود.':'توکن تنظیم شده است. برنامه نمی‌تواند تشخیص دهد آن را Text گذاشته‌اید یا Secret؛ در پنل Cloudflare نوع Secret را انتخاب کنید.'},
    {ok:/^[A-Za-z0-9_-]{32,256}$/.test(String(env.CONTENT_WEBHOOK_SECRET || '')),title:'۲. رمز اتصال ربات',help:'CONTENT_WEBHOOK_SECRET یک رمز تصادفی جدا از توکن است. با دکمه زیر بسازید و در Cloudflare با نوع Secret ذخیره کنید.'},
    {ok:/^\d+(?:\s*,\s*\d+)*$/.test(String(env.CONTENT_ADMIN_IDS || '').trim()) && (!admin?.tgId || adminIds.includes(String(admin.tgId))),title:'۳. شناسه مدیر',help:'CONTENT_ADMIN_IDS باید شناسه عددی تلگرام حساب مدیر باشد؛ نام کاربری یا عدد نمونه 42 نیست.'},
    {ok:!!env.EDITOR,title:'۴. حافظه گفتگوی ربات',help:'EDITOR متغیر متنی نیست. در Bindings باید به Durable Object با کلاس EditorSession متصل شود. ایجاد کلاس و migration یک مرحله راه‌اندازی با Wrangler نیاز دارد؛ کپی کد به‌تنهایی کافی نیست.'},
    {ok:!!env.KV && !!origin && !!defaultVaultChatId(settings),title:'۵. سایت، مخزن و دیتابیس',help:!origin?'دامنه HTTPS سایت را در تنظیمات سایت یا SITE_PUBLIC_ORIGIN مشخص کنید.':!defaultVaultChatId(settings)?'کانال مخزن فعلی را در تنظیمات سایت مشخص کنید.':'از KV و مخزن فعلی سایت استفاده می‌شود؛ دیتابیس جدید نسازید.'},
    {ok:channelsOk,title:'۶. کانال‌ها (اختیاری)',help:channelMessage}
  ];
  return {steps,ready:steps.every(x=>x.ok),adminId:String(admin?.tgId || ''),origin};
}

async function setupContentWebhook(store, request) {
  const env = store.env, settings = await getSettings(store);
  const checklist = await contentSetupStatus(store);
  if (!checklist.ready) return json({error:checklist.steps.filter(step=>!step.ok).map(step=>step.title+': '+step.help).join('\n')},400);
  if (!env.CONTENT_BOT_TOKEN || !env.EDITOR || !env.KV) return json({error:'CONTENT_BOT_TOKEN و bindingهای EDITOR و KV را روی همین Worker تنظیم کنید'},400);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(String(env.CONTENT_WEBHOOK_SECRET || ''))) return json({error:'CONTENT_WEBHOOK_SECRET باید ۳۲ تا ۲۵۶ کاراکتر معتبر داشته باشد'},400);
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(String(env.CONTENT_ADMIN_IDS || '').trim())) return json({error:'CONTENT_ADMIN_IDS باید شناسه عددی مدیران باشد'},400);
  if (env.CONTENT_BOT_TOKEN === settings.botToken || env.CONTENT_BOT_TOKEN === fileBotToken(settings)) return json({error:'توکن ربات مدیریت باید با ربات ورود و ارسال فایل متفاوت باشد'},400);
  let origin;
  try { contentChannelRules(env); origin = await contentSiteOrigin(env); } catch (e) { return json({error:e.message},400); }
  const url = origin + '/api/tg/content-webhook';
  const result = await botApi(env.CONTENT_BOT_TOKEN, 'setWebhook', {
    url:url, secret_token:env.CONTENT_WEBHOOK_SECRET, allowed_updates:['message','channel_post'],max_connections:1,drop_pending_updates:false
  });
  if (!result.ok) return json({error:'ثبت وبهوک در تلگرام ناموفق بود؛ توکن، دامنه و دسترسی Worker را بررسی کنید'},502);
  return json({ok:true,url:url});
}

async function handleAdmin(store, url, request, adminUser) {
  const set = await getSettings(store);
  const p = url.pathname.replace(/^\/api\/admin\//, '');
  const m = request.method;

  if (p === 'content-bot/setup' && m === 'POST') return setupContentWebhook(store, request);

  if (p === 'maintenance' && m === 'POST') return maintenanceBatch(store, await readBody(request, 16 * 1024));

  if (p === 'overview' && m === 'GET') {
    const users = await store.list('u:');
    const items = (await store.get('idx')) || [];
    return json({
      items: items.length, users: users.length,
      contentBotSetup: await contentSetupStatus(store, adminUser),
      lastSyncAt: set.lastSyncAt, lastSyncLog: set.lastSyncLog,
      botSet: !!set.botToken, botFromEnv: !!set.botFromEnv, botUserFromEnv: !!set.botUserFromEnv, autoSync: !!set.autoSync,
      deliverySet: !!set.deliveryBotToken, deliveryFromEnv: !!set.deliveryFromEnv, deliveryUserFromEnv: !!set.deliveryUserFromEnv,
      deliveryBotUsername: set.deliveryBotUsername || '',
      vaultRewrite: set.vaultRewriteFromEnv ? (set.vaultRewriteEnv || '') : (set.vaultRewrite || ''),
      vaultRewriteFromEnv: !!set.vaultRewriteFromEnv,
      vaultChatId: set.vaultChatId || '',
      vaultChatFromEnv: !!set.vaultChatFromEnv,
      siteName: set.siteName, tagline: set.tagline, defaultAccess: set.defaultAccess, requireLogin: set.requireLogin !== false,
      botTokenMasked: maskToken(set.botToken),
      botUsername: set.botUsername || '',
      botId: set.botId || 0,
      webhookOk: !!set.webhookOk,
      webhookError: set.webhookError || '',
      publicUrl: set.publicUrl || '',
      entryHosts: set.entryHosts || '',
      poolHosts: set.poolHosts || '',
      redirectMode: set.redirectMode || 'off',
      redirectSelected: set.redirectSelected || '',
      widgetDomain: set.widgetDomain || '',
      economy: publicEconomy(set),
      zarinpalMerchant: set.zarinpalMerchant ? maskToken(set.zarinpalMerchant) : '',
      starsEnabled: set.starsEnabled !== false,
      walletUnitName: set.walletUnitName,
      signupBonus: signupBonusOf(set),
      sub1m: set.sub1m, sub3m: set.sub3m, sub6m: set.sub6m, sub1y: set.sub1y,
      dlClickPrice: set.dlClickPrice, refSignupBonus: set.refSignupBonus, refPurchasePercent: set.refPurchasePercent,
      vanishSec: set.vanishSec,
      k2kEnabled: !!set.k2kEnabled,
      k2kCardNumber: set.k2kCardNumber || '',
      k2kCardHolder: set.k2kCardHolder || '',
      k2kCardBank: set.k2kCardBank || 'بانک ملی',
      k2kSecretMasked: set.k2kSecret ? maskToken(set.k2kSecret) : '',
      k2kSecretFromEnv: !!set.k2kSecretFromEnv,
      k2kTtlSec: Number(set.k2kTtlSec) || 1800,
      k2kPacks: set.k2kPacks || [],
      fileCaption: set.fileCaption || '',
      adEnabled: set.adEnabled !== false,
      adButtonText: set.adButtonText || '',
      adButtonUrl: set.adButtonUrl || '',
      starPacks: set.starPacks, rialPacks: [], starShops: set.starShops || [],
    });
  }

  if (p === 'settings' && m === 'POST') {
    const body = await readBody(request, 50 * 1024);
    let starPacks;
    if (body.starPacksText !== undefined || body.starPacks !== undefined) {
      try { starPacks = parseStarPacks(body.starPacksText !== undefined ? body.starPacksText : body.starPacks); }
      catch (e) { return json({ error: e.message }, 400); }
    }
    if (body.siteName !== undefined) set.siteName = String(body.siteName).slice(0, 60) || set.siteName;
    if (body.tagline !== undefined) set.tagline = String(body.tagline).slice(0, 140) || '';
    if (body.autoSync !== undefined) set.autoSync = !!body.autoSync;
    if (body.defaultAccess !== undefined) set.defaultAccess = body.defaultAccess === 'premium' ? 'premium' : 'free';
    if (body.requireLogin !== undefined) set.requireLogin = !!body.requireLogin;
    if (body.botUsername !== undefined && !envBotUsername(store.env)) {
      set.botUsername = String(body.botUsername).replace(/^@/, '').trim().slice(0, 32);
    }
    if (body.publicUrl !== undefined) set.publicUrl = String(body.publicUrl).replace(/\/$/, '').trim();
    if (body.entryHosts !== undefined) set.entryHosts = String(body.entryHosts).slice(0, 2000);
    if (body.poolHosts !== undefined) set.poolHosts = String(body.poolHosts).slice(0, 4000);
    if (body.redirectMode !== undefined) {
      const rm = String(body.redirectMode);
      set.redirectMode = (rm === 'random' || rm === 'pick') ? rm : 'off';
    }
    if (body.redirectSelected !== undefined) {
      let sel = String(body.redirectSelected).trim().toLowerCase().replace(/^https?:\/\//i, '');
      const sls = sel.indexOf('/');
      if (sls >= 0) sel = sel.slice(0, sls);
      set.redirectSelected = sel.slice(0, 80);
    }
    if (body.widgetDomain !== undefined) {
      let wd = String(body.widgetDomain).trim().toLowerCase().replace(/^https?:\/\//i, '');
      const wsl = wd.indexOf('/');
      if (wsl >= 0) wd = wd.slice(0, wsl);
      set.widgetDomain = wd.slice(0, 80);
    }
    if (body.signupBonus !== undefined) {
      const n = Number(body.signupBonus);
      if (body.signupBonus === '' || body.signupBonus === null || typeof body.signupBonus === 'boolean' || !Number.isSafeInteger(n) || n < 0) return json({ error: 'هدیه ثبت‌نام باید عدد صحیح صفر یا بیشتر باشد' }, 400);
      set.signupBonus = n;
    }
    if (body.walletUnitName !== undefined) set.walletUnitName = String(body.walletUnitName).slice(0, 20) || set.walletUnitName;
    ['sub1m', 'sub3m', 'sub6m', 'sub1y', 'dlClickPrice', 'refSignupBonus', 'refPurchasePercent', 'vanishSec'].forEach(function (k) {
      if (body[k] !== undefined) {
        const n = Number(body[k]);
        if (isFinite(n) && n >= 0) set[k] = n;
      }
    });
    if (body.fileCaption !== undefined) set.fileCaption = String(body.fileCaption).slice(0, 1000);
    if (body.adEnabled !== undefined) set.adEnabled = !!body.adEnabled;
    if (body.adButtonText !== undefined) set.adButtonText = String(body.adButtonText).slice(0, 64);
    if (body.adButtonUrl !== undefined) {
      const au = String(body.adButtonUrl).trim();
      if (!au || /^https?:\/\//i.test(au)) set.adButtonUrl = au.slice(0, 300);
    }
    if (body.adGateEnabled !== undefined) set.adGateEnabled = !!body.adGateEnabled;
    if (body.adGateBtnText !== undefined) set.adGateBtnText = String(body.adGateBtnText).slice(0, 64);
    if (body.adGateTitle !== undefined) set.adGateTitle = String(body.adGateTitle).slice(0, 90);
    if (body.adGateNote !== undefined) set.adGateNote = String(body.adGateNote).slice(0, 1200);
    if (body.starsEnabled !== undefined) set.starsEnabled = !!body.starsEnabled;
    if (body.zarinpalMerchant !== undefined) {
      const z = String(body.zarinpalMerchant).trim();
      if (z) set.zarinpalMerchant = z;
    }
    if (starPacks !== undefined) set.starPacks = starPacks;
    if (body.starShopsText !== undefined) {
      set.starShops = String(body.starShopsText).split('\n').map(function (line) {
        const p = String(line || '').split('|').map(function (x) { return x.trim(); });
        if (p.length < 2 || !/^https?:\/\//i.test(p[1])) return null;
        return { title: p[0].slice(0, 48), url: p[1].slice(0, 400), note: (p[2] || '').slice(0, 80) };
      }).filter(Boolean).slice(0, 24);
      set.starShopsRev = 3;
    } else if (Array.isArray(body.starShops)) {
      set.starShops = body.starShops.slice(0, 24).map(function (x) {
        return { title: String(x.title || '').slice(0, 48), url: String(x.url || '').slice(0, 400), note: String(x.note || '').slice(0, 80) };
      }).filter(function (x) { return x.title && /^https?:\/\//i.test(x.url); });
      set.starShopsRev = 3;
    }
    if (Array.isArray(body.rialPacks)) set.rialPacks = body.rialPacks.slice(0, 8).map(function (p) {
      return { toman: Number(p.toman) || 0, units: Number(p.units) || 0 };
    }).filter(function (p) { return p.toman > 0 && p.units > 0; });
    if (body.k2kEnabled !== undefined) set.k2kEnabled = !!body.k2kEnabled;
    if (body.k2kCardNumber !== undefined) {
      const d = digitsOnly(body.k2kCardNumber);
      if (!d || d.length === 16) set.k2kCardNumber = d;
    }
    if (body.k2kCardHolder !== undefined) set.k2kCardHolder = String(body.k2kCardHolder).slice(0, 64);
    if (body.k2kCardBank !== undefined) set.k2kCardBank = String(body.k2kCardBank).slice(0, 48) || 'بانک ملی';
    if (body.k2kTtlSec !== undefined) {
      const n = Number(body.k2kTtlSec);
      if (isFinite(n) && n >= 600 && n <= 86400) set.k2kTtlSec = Math.round(n);
    }
    if (body.k2kSecret !== undefined && !set.k2kSecretFromEnv) {
      const sec = String(body.k2kSecret).trim();
      if (sec) set.k2kSecret = sec.slice(0, 80);
    }
    if (body.k2kPacksText !== undefined) {
      const packs = parseK2kPacksText(body.k2kPacksText);
      if (packs.length) set.k2kPacks = packs;
    } else if (Array.isArray(body.k2kPacks)) {
      set.k2kPacks = body.k2kPacks.slice(0, 12).map(function (p) {
        return { toman: Math.round(Number(p.toman) || 0), units: Math.round(Number(p.units) || 0) };
      }).filter(function (p) { return p.toman > 0 && p.units > 0; });
    }
    if (set.k2kEnabled && !set.k2kSecret) set.k2kSecret = randomHex(16);
    if (body.botToken !== undefined && !envBotToken(store.env)) {
      const t = String(body.botToken).trim();
      if (t) {
        set.botToken = t;
        const bid = botIdFromToken(t);
        if (bid) set.botId = bid;
      }
    }
    if (body.deliveryBotUsername !== undefined && !envDeliveryUsername(store.env)) {
      set.deliveryBotUsername = String(body.deliveryBotUsername).replace(/^@/, '').trim().slice(0, 32);
    }
    if (body.deliveryBotToken !== undefined && !envDeliveryToken(store.env)) {
      const t = String(body.deliveryBotToken).trim();
      if (t) set.deliveryBotToken = t;
    }
    if (body.vaultRewrite !== undefined && !envStr(store.env, ['VAULT_REWRITE', 'CHANNEL_MAP'])) {
      set.vaultRewrite = String(body.vaultRewrite).slice(0, 2000);
    }
    if (body.vaultChatId !== undefined && !envStr(store.env, ['VAULT_CHAT_ID', 'VAULT_CHANNEL'])) {
      const vc = String(body.vaultChatId).trim().slice(0, 200);
      set.vaultChatId = extractVaultChatId(vc) || vc;
    }
    const origin = set.publicUrl || (function () { try { return new URL(request.url).origin; } catch (e) { return ''; } }());
    await maybeSetWebhook(store, set, origin);
    await writeSettings(store, set);
    bustSettings();
    return json({ ok: true, botTokenMasked: maskToken(set.botToken), botUsername: set.botUsername, webhookOk: !!set.webhookOk, webhookError: set.webhookError || '', siteName: set.siteName, tagline: set.tagline, economy: publicEconomy(set) });
  }

  if (p === 'test-bot' && m === 'POST') {
    if (!set.botToken) return json({ error: 'توکن ربات تنظیم نشده' }, 400);
    const r = await botApi(set.botToken, 'getMe');
    if (r.ok && r.result) {
      if (r.result.username) set.botUsername = r.result.username;
      if (r.result.id) set.botId = r.result.id;
      await writeSettings(store, set);
    }
    return json(r.ok ? { ok: true, bot: r.result } : { error: r.description || 'خطا' }, r.ok ? 200 : 400);
  }

  if (p === 'test-vault' && m === 'POST') {
    const body = await readBody(request);
    const token = fileBotToken(set);
    if (!token) return json({ error: 'توکن ربات ارسال تنظیم نشده' }, 400);
    const me = await botApi(token, 'getMe');
    const raw = String(body.url || body.chatId || set.vaultChatId || '').trim();
    const parsed = parseTmeLink(raw);
    const chatId = (parsed && parsed.chatId) || extractVaultChatId(raw) || defaultVaultChatId(set);
    const msgId = (parsed && parsed.msgId) || body.msgId || '';
    if (!chatId) return json({ error: 'لینک یا آیدی کانال مخزن را بفرستید', bot: me.result || null }, 400);
    const chat = await botApi(token, 'getChat', { chat_id: tgChatParam(chatId) });
    let copied = null;
    if (msgId && adminUser && adminUser.tgId) {
      copied = await botApi(token, 'copyMessage', {
        chat_id: tgChatParam(adminUser.tgId),
        from_chat_id: tgChatParam(chatId),
        message_id: Number(msgId),
      }, 60000);
    }
    return json({
      ok: !!(chat.ok && (!msgId || (copied && copied.ok))),
      bot: me.result || null,
      chatId: chatId,
      msgId: msgId || '',
      getChat: chat.ok ? { id: chat.result && chat.result.id, title: chat.result && chat.result.title, type: chat.result && chat.result.type } : { error: chat.description || 'fail' },
      copyMessage: copied ? (copied.ok ? { ok: true, message_id: copied.result && copied.result.message_id } : { error: copied.description || 'fail' }) : null,
      hint: chat.ok ? (copied && !copied.ok ? (copied.description || '') : 'ربات کانال را می‌بیند') : 'ربات این کانال را پیدا نکرد — توکن ربات ارسال با ربات ادمین‌شده یکی نیست یا آیدی غلط است',
    }, (chat.ok ? 200 : 400));
  }

  if (p === 'sync' && m === 'POST') {
    const out = await runSync(store).catch(function (e) { return { error: String(e.message || e), log: [] }; });
    return json(out);
  }


  if ((p === 'parse-info' || p === 'parseinfo') && m === 'POST') {
    const body = await readBody(request);
    let caption = String(body.text || body.caption || '').trim();
    let thumb = '';
    let tmeUrl = '';
    const raw = String(body.url || '').trim();
    if (raw) {
      const got = await fetchChannelPostMeta(store, set, raw, adminUser);
      if (got.error && !caption) return json({ error: got.error }, 400);
      if (got.caption) caption = got.caption;
      thumb = got.thumb || '';
      tmeUrl = got.tmeUrl || raw;
    }
    if (!caption) return json({ error: 'متن یا لینک پست مشخصات را بفرستید' }, 400);
    const fields = parseInfoCaption(caption);
    if (thumb && !fields.poster) fields.poster = thumb;
    if (tmeUrl && !fields.poster) fields.poster = tmeUrl;
    return json({ fields: fields, caption: caption.slice(0, 2000) });
  }

  if (p === 'imdb-gallery' && m === 'POST') {
    return json({ error: 'منبع گالری به IMP Awards تغییر کرده است. صفحه را تازه کنید و از بخش گالری پوسترها استفاده کنید.' }, 410);
  }
  if (p === 'gallery' && m === 'POST') {
    if (!(await rlHit(store, 'gallery:' + adminUser.username, 20, 600))) return json({ error: 'تعداد درخواست‌های گالری زیاد است؛ کمی صبر کنید.' }, 429);
    const body = await readBody(request, 16 * 1024);
    try {
      const limit = galleryLimitOf(body.limit !== undefined ? body.limit : (body.count !== undefined ? body.count : body.galleryLimit), CONFIG.GALLERY_LIMIT);
      return json(await getImpGallery(store, body.url, { refresh: body.refresh === true, limit: limit }));
    } catch (e) { return json({ error: e.message, code: e.code, diagnostics: e.diagnostics }, e.status || 502); }
  }

  if (p === 'validate' && m === 'POST') {
    const body = await readBody(request);
    const raw = String(body.url || '').trim();
    if (/^https:\/\//.test(raw) && isAllowedMediaUrl(raw)) {
      return json({ kind: 'direct', directUrl: raw, tmeUrl: '' });
    }
    const parsed = parseTmeLink(raw);
    if (!parsed) return json({ error: 'لینک معتبر نیست؛ نمونه: https://t.me/kanal/123 یا کانال خصوصی https://t.me/c/1234567890/62' }, 400);
    if (parsed.private) {
      return json({ kind: 'private', tmeUrl: '', chatId: parsed.chatId, msgId: parsed.msgId, streamable: false, private: true });
    }
    const res = await resolvePost(store, parsed.user, parsed.msgId, true);
    return json({
      kind: res.kind, tmeUrl: res.tmeUrl, caption: res.caption, docName: res.docName,
      sizeBytes: res.sizeBytes, w: res.w, h: res.h, thumb: res.thumb,
      streamable: res.kind === 'video' || res.kind === 'audio',
    });
  }

  if (p === 'item' && m === 'POST') {
    const body = await readBody(request, 2 * 1024 * 1024);
    const raw = String(body.url || '').trim();
    if (raw) {
      const parsed = parseTmeLink(raw);
      let existingItem = null;
      if (parsed) {
        const srcKey = parsed.private
          ? ('src:c:' + parsed.chatId + '/' + parsed.msgId)
          : ('src:' + parsed.user + '/' + parsed.msgId);
        const existingId = await store.get(srcKey);
        if (existingId) existingItem = await getItem(store, existingId);
        if (existingItem) return json({ error: 'این پست قبلاً در سایت ثبت شده است', duplicate: true }, 409);
      }
      body.sourceUrl = raw;
      const out = await adminUpsertItem(store, set, body, existingItem);
      if (out.error) return json({ error: out.error, code: out.code, diagnostics: out.diagnostics }, out.status || 400);
      return json({ item: out.item });
    }
    const out = await adminUpsertItem(store, set, body, null);
    if (out.error) return json({ error: out.error, code: out.code, diagnostics: out.diagnostics }, out.status || 400);
    return json({ item: out.item });
  }

  let mm = p.match(/^item\/(i_[a-z0-9]+)$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request, 2 * 1024 * 1024);
    const out = await adminUpsertItem(store, set, body, item);
    if (out.error) return json({ error: out.error, code: out.code, diagnostics: out.diagnostics }, out.status || 400);
    return json({ item: out.item });
  }
  if (mm && m === 'DELETE') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    await deleteOwnedIndexes(store, itemSourceKeys(item), item.id);
    for (const sub of item.subs || []) {
      const rec = await store.get('sub:' + sub.id);
      if (rec && rec.itemId === item.id) await store.del('sub:' + sub.id);
    }
    await store.del('views:' + item.id);
    await store.del('it:' + item.id);
    bustItem(item.id);
    const idx = await getIdx(store);
    await store.set('idx', idx.filter(function (x) { return x.id !== item.id; }));
    bustIdx();
    return json({ ok: true });
  }

  mm = p.match(/^item\/(i_[a-z0-9]+)\/episode$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request);
    if (body.premium !== undefined && body.epId && !String(body.url || '').trim()) {
      const epFlag = findEpisode(item, String(body.epId));
      if (!epFlag) return json({ error: 'قسمت پیدا نشد' }, 404);
      epFlag.premium = !!body.premium;
      item.updatedAt = Date.now();
      await saveItemRecord(store, item);
      bustItem(item.id);
      await idxUpsert(store, item);
      return json({ item: item });
    }
    const parsed = parseTmeLink(String(body.url || '').trim());
    if (!parsed) return json({ error: 'لینک قسمت معتبر نیست. برای کانال خصوصی: https://t.me/c/آیدی/شماره' }, 400);
    let res = { kind: '', tmeUrl: '', sizeBytes: null, w: 0 };
    if (!parsed.private) {
      res = await resolvePost(store, parsed.user, parsed.msgId, true);
    }
    const src = sourceFromParsed(parsed, res);
    const seasonN = parseInt(body.seasonN, 10) || 1;
    const season = ensureSeason(item, seasonN, body.seasonTitle);
    const track = body.track === 'dub' ? 'dub' : 'sub';
    const qk = qualityKey(body.quality) || classicQualityKey(body.quality) || qualityKey(guessQuality(res.w)) || (String(body.quality || '').trim() ? ('q_' + randomHex(3)) : '1080');
    let ep = null;
    if (body.epId) ep = findEpisode(item, String(body.epId));
    if (!ep) {
      ep = {
        id: 'e_' + randomHex(4),
        n: (season.episodes || []).length + 1,
        title: String(body.title || '').trim() || ('قسمت ' + ((season.episodes || []).length + 1)),
        source: src,
        sizeBytes: res.sizeBytes,
        variants: { sub: {}, dub: {} },
        premium: false,
      };
      season.episodes = season.episodes || [];
      season.episodes.push(ep);
    }
    ep.source = src;
    ep.sizeBytes = res.sizeBytes || ep.sizeBytes;
    if (body.title) ep.title = String(body.title).trim().slice(0, 140);
    setVariantCell(ep, track, qk, src, res.sizeBytes);
    if (ep.variants && ep.variants[track] && ep.variants[track][qk]) {
      const ql = String(body.qualityLabel || body.quality || '').trim().slice(0, 60);
      if (ql && !classicQualityKey(ql)) ep.variants[track][qk].label = ql;
    }
    if (!item.source || !(item.source.chatId || item.source.user || item.source.tmeUrl)) item.source = src;
    syncEpisodesFromSeasons(item);
    item.updatedAt = Date.now();
    await saveItemRecord(store, item);
    bustItem(item.id);
    await store.set('src:' + parsed.user + '/' + parsed.msgId, item.id);
    await idxUpsert(store, item);
    return json({ item: item });
  }
  mm = p.match(/^item\/(i_[a-z0-9]+)\/episodes\/(e_[a-z0-9]+)\/delete$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const ep = findEpisode(item, mm[2]);
    item.episodes = (item.episodes || []).filter(function (x) { return x.id !== mm[2]; });
    (item.seasons || []).forEach(function (s) {
      s.episodes = (s.episodes || []).filter(function (x) { return x.id !== mm[2]; });
    });
    syncEpisodesFromSeasons(item);
    item.updatedAt = Date.now();
    await saveItemRecord(store, item);
    bustItem(item.id);
    await idxUpsert(store, item);
    return json({ item: item });
  }
  mm = p.match(/^item\/(i_[a-z0-9]+)\/season$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request);
    const n = parseInt(body.n, 10) || ((item.seasons || []).length + 1);
    ensureSeason(item, n, body.title);
    item.type = 'series';
    syncEpisodesFromSeasons(item);
    item.updatedAt = Date.now();
    await saveItemRecord(store, item);
    bustItem(item.id);
    await idxUpsert(store, item);
    return json({ item: item });
  }
  mm = p.match(/^item\/(i_[a-z0-9]+)\/variant$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request);
    const track = body.track === 'dub' ? 'dub' : 'sub';
    let bag = item;
    if (body.epId) {
      bag = findEpisode(item, String(body.epId));
      if (!bag) return json({ error: 'قسمت پیدا نشد' }, 404);
    }
    let qk = qualityKey(body.quality);
    const labelIn = String(body.qualityLabel || body.label || '').trim().slice(0, 60);
    if (!qk && (body.addQuality || labelIn || body.quality)) {
      const want = labelIn || String(body.quality || '').trim();
      const existing = ((bag.variants || {})[track]) || {};
      const eks = Object.keys(existing);
      for (let i = 0; i < eks.length; i++) {
        if (String(existing[eks[i]].label || '') === want) { qk = eks[i]; break; }
      }
      if (!qk) qk = classicQualityKey(want) || ('q_' + randomHex(4));
    }
    if (!qk) return json({ error: 'کیفیت نامعتبر است' }, 400);
    if (body.removeQuality) {
      const vv = ensureVariants(bag);
      delete vv[track][qk];
      syncEpisodesFromSeasons(item);
      item.updatedAt = Date.now();
      await saveItemRecord(store, item);
      bustItem(item.id);
      await idxUpsert(store, item);
      return json({ item: item });
    }
    const hasUrl = Object.prototype.hasOwnProperty.call(body, 'url');
    const raw = hasUrl ? String(body.url || '').trim() : '';
    const fileId = String(body.fileId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
    const addFile = !!body.addFile;
    const removeFile = !!body.removeFile || (fileId && hasUrl && !raw);
    const pendingIndexes = [];
    async function parseSrc(link) {
      let parsedLinks;
      try { parsedLinks = parseVersionLinks(link); }
      catch (e) { return {error:e.message}; }
      const parts = [];
      let size = 0, sizeKnown = true, kind = '';
      for (const parsed of parsedLinks) {
        let res = {kind:'', tmeUrl:'', sizeBytes:null};
        if (!parsed.private) res = await resolvePost(store, parsed.user, parsed.msgId, true);
        parts.push(sourceFromParsed(parsed, res));
        if (res.sizeBytes) size += res.sizeBytes; else sizeKnown = false;
        kind = kind || res.kind || '';
        pendingIndexes.push(parsed.private ? 'src:c:' + parsed.chatId + '/' + parsed.msgId : 'src:' + parsed.user + '/' + parsed.msgId);
      }
      const src = parts.length === 1 ? parts[0] : Object.assign({}, parts[0], {parts:parts});
      return {src:src, res:{sizeBytes:sizeKnown ? size : null, kind:kind}};
    }
    if (removeFile && fileId) {
      upsertVariantFile(bag, track, qk, { fileId: fileId, remove: true });
    } else if (addFile || fileId) {
      if (hasUrl && !raw && !removeFile) return json({ error: 'لینک فایل را وارد کنید' }, 400);
      let src = null, res = { sizeBytes: null, kind: '' };
      if (raw) {
        const got = await parseSrc(raw);
        if (got.error) return json({ error: got.error }, 400);
        src = got.src; res = got.res;
      }
      upsertVariantFile(bag, track, qk, {
        fileId: fileId,
        title: body.title,
        source: src,
        sizeBytes: res.sizeBytes || null,
        remove: false,
      });
      if (src) {
        if (!body.epId) {
          if (!item.source || !(item.source.tmeUrl || item.source.chatId)) item.source = src;
          if (res.sizeBytes) item.media = Object.assign(item.media || {}, { sizeBytes: res.sizeBytes, kind: res.kind });
          if (!item.quality) item.quality = qk === '4k' ? '4K' : (qk + 'p');
        } else {
          bag.source = bag.source || src;
          bag.sizeBytes = res.sizeBytes || bag.sizeBytes;
        }
      }
    } else if (hasUrl) {
      if (!raw) {
        setVariantCell(bag, track, qk, null, null);
      } else {
        const got = await parseSrc(raw);
        if (got.error) return json({ error: got.error }, 400);
        const src = got.src, res = got.res;
        setVariantCell(bag, track, qk, src, res.sizeBytes);
        if (!body.epId) {
          if (!item.source || !(item.source.tmeUrl || item.source.chatId)) item.source = src;
          if (res.sizeBytes) item.media = Object.assign(item.media || {}, { sizeBytes: res.sizeBytes, kind: res.kind });
          if (!item.quality) item.quality = qk === '4k' ? '4K' : (qk + 'p');
        } else {
          bag.source = bag.source || src;
          bag.sizeBytes = res.sizeBytes || bag.sizeBytes;
        }
      }
    }
    if (body.premium !== undefined) {
      setVariantPremium(bag, track, qk, !!body.premium);
    }
    if (labelIn) {
      ensureVariants(bag);
      if (!bag.variants[track][qk]) bag.variants[track][qk] = { source: null, sizeBytes: null, files: [] };
      bag.variants[track][qk].label = labelIn;
    }
    syncEpisodesFromSeasons(item);
    item.updatedAt = Date.now();
    await saveItemRecord(store, item);
    for (const key of pendingIndexes) await store.set(key, item.id);
    bustItem(item.id);
    await idxUpsert(store, item);
    return json({ item: item });
  }
  mm = p.match(/^item\/(i_[a-z0-9]+)\/episodes\/order$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request);
    const order = Array.isArray(body.order) ? body.order : [];
    const map = {};
    for (const e of item.episodes || []) map[e.id] = e;
    const next = [];
    for (const id of order) if (map[id]) { next.push(map[id]); delete map[id]; }
    for (const k in map) next.push(map[k]);
    item.episodes = next;
    await saveItemRecord(store, item);
    bustItem(item.id);
    await idxUpsert(store, item);
    return json({ item: item });
  }

  mm = p.match(/^item\/(i_[a-z0-9]+)\/subs$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    const body = await readBody(request, 1024 * 1024);
    const text = String(body.text || '');
    if (!text.trim()) return json({ error: 'متن زیرنویس خالی است' }, 400);
    const vtt = looksLikeSrt(text) ? srtToVtt(text) : text;
    const subId = 's_' + randomHex(4);
    await store.set('sub:' + subId, { itemId: item.id, name: String(body.name || 'زیرنویس'), lang: String(body.lang || 'fa'), vtt: vtt });
    item.subs = item.subs || [];
    item.subs.push({ id: subId, name: String(body.name || 'زیرنویس'), lang: String(body.lang || 'fa') });
    item.updatedAt = Date.now();
    await saveItemRecord(store, item);
    bustItem(item.id);
    return json({ item: item });
  }
  mm = p.match(/^item\/(i_[a-z0-9]+)\/subs\/(s_[a-z0-9]+)\/delete$/);
  if (mm && m === 'POST') {
    const item = await getItem(store, mm[1]);
    if (!item) return json({ error: 'یافته نشد' }, 404);
    await store.del('sub:' + mm[2]);
    item.subs = (item.subs || []).filter(function (x) { return x.id !== mm[2]; });
    await saveItemRecord(store, item);
    bustItem(item.id);
    return json({ item: item });
  }

  if (p === 'users' && m === 'GET') {
    const out = [];
    const keys = await store.list('u:');
    for (const k of keys) {
      const u = await store.get(k);
      if (u) out.push(Object.assign(pubUser(u), {
        tgName: u.tgName || '', logins: u.logins || 0, phone: u.phone || '',
        wallet: u.wallet || 0, subUntil: u.subUntil || 0, referrer: u.referrer || '',
        tgId: u.tgId || '',
      }));
    }
    out.sort(function (a, b) { return (b.lastLogin || 0) - (a.lastLogin || 0); });
    return json({ users: out });
  }
  mm = p.match(/^users\/([a-z0-9_]+)\/role$/);
  if (mm && m === 'POST') {
    const body = await readBody(request);
    const role = body.role;
    if (['admin', 'premium', 'free'].indexOf(role) < 0) return json({ error: 'سطح نامعتبر' }, 400);
    if (mm[1] === adminUser.username && role !== 'admin') return json({ error: 'نمی‌توانید سطح خود را کاهش دهید' }, 400);
    const u = await store.get('u:' + mm[1]);
    if (!u) return json({ error: 'یافته نشد' }, 404);
    u.role = role;
    await saveUser(store, u);
    return json({ ok: true });
  }
  mm = p.match(/^users\/([a-z0-9_]+)\/wallet$/);
  if (mm && m === 'POST') {
    const body = await readBody(request);
    const amount = round2(body.amount);
    if (!amount) return json({ error: 'مبلغ نامعتبر' }, 400);
    const u = await getUser(store, mm[1]);
    if (!u) return json({ error: 'یافته نشد' }, 404);
    if (amount > 0) await creditWallet(store, u, amount, 'admin', String(body.note || 'شارژ توسط مدیر'));
    else {
      const d = await debitWallet(store, u, -amount, 'admin', String(body.note || 'کسر توسط مدیر'));
      if (d.error) return json(d, 400);
    }
    return json({ ok: true, wallet: u.wallet });
  }
  mm = p.match(/^users\/([a-z0-9_]+)\/delete$/);
  if (mm && m === 'POST') {
    if (mm[1] === adminUser.username) return json({ error: 'نمی‌توانید خودتان را حذف کنید' }, 400);
    const u = await getUser(store, mm[1]);
    if (!u) return json({ error: 'یافته نشد' }, 404);
    await deleteOwnedIndexes(store, userIndexKeys(u), u.username);
    if (u.tgId) await store.del('tgstate:' + u.tgId);
    await store.del('u:' + mm[1]);
    bustUser(mm[1]);
    return json({ ok: true });
  }

  if (p === 'codes' && m === 'GET') {
    const out = [];
    const keys = await store.list('code:');
    for (const k of keys) {
      const c = await store.get(k);
      if (c) {
        const mode = giftCodeMode(c);
        out.push({
          code: k.slice(5), units: c.units || 0, exp: c.exp,
          used: c.used || 0, usedCount: giftUsedCount(c),
          mode: mode, maxUsers: mode === 'quota' ? (Number(c.maxUsers) || 1) : (mode === 'once' ? 1 : 0),
          createdAt: c.createdAt,
        });
      }
    }
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return json({ codes: out });
  }
  if (p === 'codes' && m === 'POST') {
    const body = await readBody(request);
    const units = Math.max(1, Number(body.units) || 100);
    const days = Math.max(1, Math.min(3650, parseInt(body.days, 10) || 30));
    const mode = giftCodeMode({ mode: body.mode });
    const maxUsers = mode === 'quota'
      ? Math.max(1, Math.min(100000, parseInt(body.maxUsers, 10) || 1))
      : (mode === 'once' ? 1 : 0);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    c += '-';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    const rec = { units: units, exp: Date.now() + days * 86400000, used: 0, usedBy: {}, mode: mode, maxUsers: maxUsers, createdAt: Date.now() };
    await store.set('code:' + c, rec);
    return json({ code: c, days: days, units: units, mode: mode, maxUsers: maxUsers });
  }
  mm = p.match(/^codes\/([A-Z0-9\-]+)\/delete$/);
  if (mm && m === 'POST') {
    await store.del('code:' + mm[1]);
    return json({ ok: true });
  }

  if (p === 'ads' && m === 'GET') {
    const list = await getAds(store);
    const out = [];
    let totalViews = 0;
    let totalClicks = 0;
    for (const a of list) {
      const st = await getAdStat(store, a.id);
      totalViews += st.views;
      totalClicks += st.clicks;
      out.push(Object.assign({}, a, {
        views: st.views,
        clicks: st.clicks,
        ctr: st.views ? Math.round((st.clicks / st.views) * 1000) / 10 : 0,
        ratioOk: adRatioOk(a.kind, a.w, a.h),
      }));
    }
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return json({
      ads: out,
      maxSec: CONFIG.AD_MAX_SEC,
      minSec: CONFIG.AD_MIN_SEC,
      spec: CONFIG.AD_SPEC,
      totals: { views: totalViews, clicks: totalClicks, count: out.length,
        active: out.filter(function (x) { return x.active; }).length },
      gate: {
        adGateEnabled: set.adGateEnabled !== false,
        adGateBtnText: set.adGateBtnText || '',
        adGateTitle: set.adGateTitle || '',
        adGateNote: set.adGateNote || '',
      },
    });
  }
  if (p === 'ads' && m === 'POST') {
    const body = await readBody(request, 64 * 1024);
    const list = await getAds(store);
    const id = String(body.id || '').trim();
    const media = adSafeUrl(body.mediaUrl);
    if (!media) return json({ error: 'لینک بنر/ویدئو باید یک آدرس معتبر https باشد' }, 400);
    const link = String(body.linkUrl || '').trim();
    if (link && !adSafeUrl(link)) return json({ error: 'لینک مقصد تبلیغ باید https معتبر باشد' }, 400);

    if (id) {
      let found = -1;
      for (let i = 0; i < list.length; i++) if (list[i].id === id) found = i;
      if (found < 0) return json({ error: 'تبلیغ یافت نشد' }, 404);
      list[found] = normalizeAd(Object.assign({}, list[found], body, {
        id: id, mediaUrl: media, createdAt: list[found].createdAt, updatedAt: Date.now(),
      }));
      const saved = await saveAds(store, list);
      return json({ ok: true, ad: saved[found] });
    }
    if (list.length >= CONFIG.AD_MAX_COUNT) return json({ error: 'حداکثر ' + CONFIG.AD_MAX_COUNT + ' تبلیغ' }, 400);
    const nid = 'ad' + randomHex(6);
    const ad = normalizeAd(Object.assign({}, body, {
      id: nid, mediaUrl: media, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    list.push(ad);
    await saveAds(store, list);
    return json({ ok: true, ad: ad });
  }
  mm = p.match(/^ads\/([a-z0-9_]{2,32})\/delete$/);
  if (mm && m === 'POST') {
    const list = (await getAds(store)).filter(function (a) { return a.id !== mm[1]; });
    await saveAds(store, list);
    await store.del('adstat:' + mm[1]);
    return json({ ok: true });
  }
  mm = p.match(/^ads\/([a-z0-9_]{2,32})\/reset$/);
  if (mm && m === 'POST') {
    await store.set('adstat:' + mm[1], { views: 0, clicks: 0 });
    return json({ ok: true });
  }
  mm = p.match(/^ads\/([a-z0-9_]{2,32})\/toggle$/);
  if (mm && m === 'POST') {
    const list = await getAds(store);
    let hit = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === mm[1]) { list[i].active = !list[i].active; hit = list[i]; }
    if (!hit) return json({ error: 'تبلیغ یافت نشد' }, 404);
    await saveAds(store, list);
    return json({ ok: true, active: hit.active });
  }

  if (p === 'k2k' && m === 'GET') return await apiAdminK2kList(store);
  mm = p.match(/^k2k\/([a-zA-Z0-9]+)\/(approve|reject)$/);
  if (mm && m === 'POST') {
    const body = await readBody(request);
    const out = await k2kApplyDecision(store, mm[1], adminUser, mm[2] === 'approve', body && body.reason);
    if (out.error) return json({ error: out.error }, out.statusCode || 400);
    return json(out);
  }

  return json({ error: 'یافته نشد' }, 404);
}

function giftCodeMode(c) {
  const m = String((c && c.mode) || 'once').toLowerCase();
  if (m === 'each' || m === 'all' || m === 'per_user' || m === 'unlimited') return 'each';
  if (m === 'quota' || m === 'limited' || m === 'count') return 'quota';
  return 'once';
}
function giftUsedByMap(c) {
  if (c && c.usedBy && typeof c.usedBy === 'object' && !Array.isArray(c.usedBy)) return c.usedBy;
  return {};
}
function giftUsedCount(c) {
  const n = Object.keys(giftUsedByMap(c)).length;
  if (n) return n;
  return c && c.used ? 1 : 0;
}

async function apiRedeemCode(store, body, request) {
  const user = await currentUser(request, store);
  if (!user) return json({ error: 'وارد شوید' }, 401);
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return json({ error: 'کد را وارد کنید' }, 400);
  const c = await store.get('code:' + code);
  if (!c || (c.exp && c.exp < Date.now())) return json({ error: 'کد نامعتبر یا منقضی است' }, 400);
  const mode = giftCodeMode(c);
  const usedBy = giftUsedByMap(c);
  if (usedBy[user.username]) return json({ error: 'شما قبلاً این کد را استفاده کرده‌اید' }, 400);
  const n = Object.keys(usedBy).length || (c.used && mode === 'once' ? 1 : 0);
  if (mode === 'once' && (c.used || n >= 1)) return json({ error: 'این کد قبلاً استفاده شده' }, 400);
  if (mode === 'quota') {
    const max = Math.max(1, Number(c.maxUsers) || 1);
    if (n >= max) return json({ error: 'ظرفیت این کد تمام شده' }, 400);
  }
  usedBy[user.username] = Date.now();
  c.usedBy = usedBy;
  c.used = Object.keys(usedBy).length;
  c.mode = mode;
  await store.set('code:' + code, c);
  const fresh = await getUser(store, user.username);
  await creditWallet(store, fresh, Number(c.units) || 0, 'gift', 'کد تخفیف ' + code);
  return json({ ok: true, units: c.units, wallet: fresh.wallet, mode: mode });
}

/* ═══════════════════════ مسیریابی API ═══════════════════════ */

/* Internal editorial actions: never exposed as a public HTTP API. */
async function contentBotAction(store, body, action) {
  const actorId = String(body.actorId || '');
  const allowed = String(store.env.CONTENT_ADMIN_IDS || '').split(',').map(function (v) { return v.trim(); });
  if (!allowed.includes(actorId)) return json({error:'دسترسی ربات مدیریت مجاز نیست'}, 403);
  const username = await store.get('tg:' + actorId);
  const admin = username && await store.get('u:' + username);
  if (!admin || admin.role !== 'admin' || String(admin.tgId) !== actorId) return json({error:'حساب مدیر سایت یافت نشد'}, 403);
  const set = await getSettings(store);
  const vault = defaultVaultChatId(set);
  if (!vault) return json({error:'کانال مخزن سایت تنظیم نشده'}, 400);
  if (action === 'whoami') return json({ok:true, vault:vault});
  if (!/^i_[a-z0-9]+$/.test(String(body.itemId || ''))) return json({error:'شناسه اثر نامعتبر'}, 400);
  const item = await store.get('it:' + body.itemId);
  if (!item) return json({error:'اثر حذف شده یا یافت نشد'}, 404);
  if (action === 'item') return json({item:{id:item.id, title:item.title, type:item.type, year:item.year, description:item.description || '', updatedAt:item.updatedAt || 0}, vault:vault});
  if (action !== 'publish') return json({error:'not found'},404);
  const files = body.files;
  if (!/^[a-f0-9]{32}$/.test(String(body.jobId || '')) || !Array.isArray(files) || !files.length || files.length > 20) return json({error:'پیش‌نویس نامعتبر؛ حداکثر ۲۰ فایل'},400);
  const digest = bytesToHex(await sha256Bytes(JSON.stringify(files)));
  const receipt = (item.contentBotReceipts || []).find(function (r) { return r.id === body.jobId; });
  if (receipt && receipt.digest !== digest) return json({error:'شناسه پیش‌نویس با محتوای متفاوت تکرار شده'},409);
  if (!receipt && Number(body.expectedUpdatedAt) !== Number(item.updatedAt || 0)) return json({error:'اثر در سایت تغییر کرده؛ مشخصات را تازه کنید و دوباره پیش‌نمایش بگیرید'},409);
  // Validate the entire batch before touching the item or any index.
  for (const file of files) {
    if (!file || !['dub','hardsub','softsub','original'].includes(file.kind) || !['480','720','1080','4k'].includes(file.quality) ||
        !/^[a-f0-9]{16}$/.test(String(file.key || '')) || !(String(file.chatId) === String(vault) || contentChannelRules(store.env)[String(file.chatId)]?.adminId === actorId) ||
        !Number.isSafeInteger(file.msgId) || file.msgId < 1 ||
        (item.type === 'series' && (!Number.isInteger(file.season) || file.season < 1 || file.season > 200 || !Number.isInteger(file.episode) || file.episode < 1 || file.episode > 10000))) return json({error:'اطلاعات فصل، قسمت، کیفیت یا مخزن نامعتبر'},400);
    const owner = await store.get('src:c:' + file.chatId + '/' + file.msgId);
    if (owner && owner !== item.id) return json({error:'یکی از فایل‌ها قبلاً به اثر دیگری متصل است'},409);
  }
  if (!receipt) {
    // Migrate legacy flat episodes only in memory; keep their original IDs and files.
    if (item.type === 'series' && !(item.seasons || []).length && (item.episodes || []).length) item.seasons = [{n:1,title:'فصل ۱',episodes:item.episodes}];
    for (const file of files) {
      let bag = item;
      if (item.type === 'series') {
        const season = ensureSeason(item, file.season);
        let ep = season.episodes.find(function (e) { return Number(e.n) === file.episode; });
        if (!ep) { ep = {id:'e_' + randomHex(4),n:file.episode,title:'قسمت ' + file.episode,variants:{sub:{},dub:{}}}; season.episodes.push(ep); }
        season.episodes.sort(function (a,b) { return a.n - b.n; });
        bag = ep;
      }
      const src = {chatId:String(file.chatId),msgId:String(file.msgId),user:'',tmeUrl:'https://t.me/c/' + String(file.chatId).replace(/^-100/,'') + '/' + file.msgId,mediaType:'document'};
      const label = {dub:'دوبله فارسی',hardsub:'هاردساب',softsub:'سافت‌ساب',original:'زبان اصلی'}[file.kind];
      upsertVariantFile(bag, file.kind === 'dub' ? 'dub' : 'sub', file.quality, {
        fileId:'f_' + file.key, title:file.channelImport ? String(file.title || label).slice(0,220) : label + (file.title ? ' — ' + String(file.title).slice(0,100) : ''), source:src,
        sizeBytes:Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 ? file.sizeBytes : null
      });
      if (!bag.source) bag.source = src;
      if (!item.source) item.source = src;
      if (file.kind === 'dub') item.dubbed = true;
      if (file.kind === 'hardsub' || file.kind === 'softsub') item.subtitled = true;
    }
    syncEpisodesFromSeasons(item);
    item.updatedAt = Date.now();
    item.contentBotReceipts = [{id:body.jobId,digest:digest,at:Date.now()}, ...(item.contentBotReceipts || [])].slice(0,16);
    await saveItemRecord(store,item);
  }
  // Also repair indexes on a retry after the primary write succeeded.
  for (const file of files) await store.set('src:c:' + file.chatId + '/' + file.msgId,item.id);
  await idxUpsert(store,item);
  return json({ok:true,itemId:item.id,count:files.length,replayed:!!receipt});
}

/* Explicit channel allowlist; targets cannot be sources (prevents relay loops). */
function contentChannelRules(env) {
  const raw = String(env.CONTENT_CHANNEL_RULES || '').trim();
  if (!raw) return {};
  let rules;
  try { rules = JSON.parse(raw); } catch { throw new Error('CONTENT_CHANNEL_RULES باید JSON معتبر باشد'); }
  if (!rules || Array.isArray(rules) || typeof rules !== 'object' || Object.keys(rules).length > 10) throw new Error('حداکثر ۱۰ کانال منبع مجاز است');
  const ids = Object.keys(rules);
  const out = {};
  for (const id of ids) {
    const r = rules[id];
    if (!/^-100\d{6,20}$/.test(id) || !r || !adminAllowed(env,r.adminId) || !Array.isArray(r.targets || []) || (r.targets || []).length > 3) throw new Error('شناسه کانال، مدیر یا مقصدهای انتقال نامعتبر است');
    const targets = [...new Set((r.targets || []).map(String))];
    if (targets.some(t=>! /^-100\d{6,20}$/.test(t) || ids.includes(t))) throw new Error('مقصد انتقال نباید هیچ‌یک از کانال‌های منبع باشد');
    out[id] = {adminId:String(r.adminId),targets,publish:r.publish !== false};
  }
  return out;
}
function parseChannelHeader(text, previous, origin) {
  const lines = String(text || '').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if (!lines.some(l=>/^#(?:اثر|نسخه|نوع|نام|پایان)(?:\s|$)/.test(l))) return null;
  if (lines.length===1 && lines[0]==='#پایان') return {stopped:true};
  const fields = {};
  for (const line of lines) {
    const m=/^#(اثر|نسخه|نوع|نام)\s+(.+)$/.exec(line);
    if (!m || fields[m[1]]) throw new Error('سربرگ نامعتبر است؛ از الگوی #اثر، #نسخه، #نوع و #نام استفاده کنید');
    fields[m[1]]=m[2].trim();
  }
  const fresh = !!fields['اثر'];
  const ctx = fresh ? {} : {...(previous || {})};
  if (fresh) {
    ctx.itemId = /^i_[a-z0-9]+$/.test(fields['اثر']) ? fields['اثر'] : itemIdFromLink(fields['اثر'],origin);
    if (!ctx.itemId) throw new Error('لینک یا شناسه #اثر معتبر نیست');
  }
  const kinds = {'دوبله':'dub','هاردساب':'hardsub','سافت‌ساب':'softsub','سافتساب':'softsub','زبان اصلی':'original',dub:'dub',hardsub:'hardsub',softsub:'softsub',original:'original'};
  if (fields['نسخه']) { ctx.version = fields['نسخه'].slice(0,64); if (!fields['نوع']) ctx.kind = null; }
  if (fields['نوع']) ctx.kind = kinds[fields['نوع']];
  if (fields['نام']) ctx.alias = fields['نام'].slice(0,120);
  if (!ctx.itemId || !ctx.version || !ctx.kind) throw new Error('ابتدا #اثر، #نسخه و #نوع را کامل کنید؛ با تغییر نسخه، نوع را نیز بنویسید. «زیرنویس» مبهم است؛ هاردساب یا سافتساب را مشخص کنید');
  ctx.stopped=false;
  return ctx;
}
function channelFileDetails(media, context, item) {
  const name = String(media.file_name || '');
  const parsed = parseFilename(name);
  if (!parsed.quality || (item.type==='series' && (!parsed.season || !parsed.episode))) throw new Error('فصل، قسمت یا کیفیت نام فایل روشن نیست: '+name);
  const qpos = name.search(/(?:^|[._ -])(?:2160|1080|720|480)p?(?=[._ -])|(?:^|[._ -])4k(?=[._ -])/i);
  const detected = item.type==='series' ? parsed.detectedTitle : (qpos>=0 ? name.slice(0,qpos).replace(/\b(?:19|20)\d{2}\b/g,'') : '');
  const alias = context.alias || item.title.split('|').find(t=>/[a-z]{2}/i.test(t));
  const norm = v=>String(v || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g,'');
  if (!alias || norm(detected)!==norm(alias)) throw new Error('نام فایل با اثر فعال یکسان نیست؛ #نام را برابر نام سریال/فیلم قبل از SxxExx قرار دهید: '+name);
  const lower = name.toLowerCase();
  const tagged = /hardsub/.test(lower) ? 'hardsub' : /softsub/.test(lower) ? 'softsub' : /dubbed|duble/.test(lower) ? 'dub' : '';
  if (tagged && tagged!==context.kind) throw new Error('نوع فایل با #نوع فعال تعارض دارد: '+name);
  const specs = (qpos>=0 ? name.slice(qpos) : parsed.quality+'p').replace(/\.(mkv|mp4|avi|mov|m4v|webm)$/i,'').split(/[._ ]+/).filter(Boolean)
    .filter(x=>! /^(farsi|persian|dubbed|duble|hardsub|softsub)$/i.test(x)).join('.');
  const size = Number.isSafeInteger(media.file_size) && media.file_size>0 ? (media.file_size/1048576).toFixed(1).replace(/\.0$/,'')+' MB' : 'حجم نامشخص';
  return {...parsed,season:item.type==='series'?parsed.season:1,episode:item.type==='series'?parsed.episode:1,title:context.version+' | '+specs.slice(0,128)+' | '+size,sizeBytes:media.file_size || null};
}

/* Integrated editorial bot. Telegram copies media; this Worker never downloads movie files. */
const STAGES = ['dub', 'hardsub', 'softsub', 'original'];
const LABELS = {dub:'دوبله فارسی',hardsub:'زیرنویس چسبیده (هاردساب)',softsub:'زیرنویس سافت‌ساب',original:'زبان اصلی بدون زیرنویس'};
const DAY = 86400000;
export function parseFilename(name) {
  const text = String(name || '').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  const match = text.match(/(?:^|[ ._\-])s(\d{1,3})[ ._\-]*e(\d{1,4})(?!\d)/i) || text.match(/(?:^|[ ._\-])(\d{1,3})x(\d{1,4})(?!\d)/i);
  const q = text.match(/(?:^|[ ._\-\[(])(2160|1080|720|480)p?(?=$|[ ._\-\])])/i) || text.match(/(?:^|[ ._\-])(4k)(?=$|[ ._\-])/i);
  // Multi-episode packs must be assigned explicitly; never guess one episode.
  const multi = /e\d+(?:e\d+|[- ]e?\d+)/i.test(text);
  return {season:match && !multi ? Number(match[1]) : null,episode:match && !multi ? Number(match[2]) : null,
    quality:q ? (/2160|4k/i.test(q[1]) ? '4k' : q[1]) : null,
    detectedTitle:match ? text.slice(0,match.index).replace(/[._]/g,' ').trim() : text.replace(/\.(mkv|mp4|avi)$/i,'')};
}
export function itemIdFromLink(text, origin) {
  try {
    const u = new URL(text.trim());
    if (u.origin !== new URL(origin).origin) return '';
    return /^#\/item\/(i_[a-z0-9]+)$/.exec(u.hash)?.[1] || '';
  } catch { return ''; }
}
function sourceLink(text) {
  const m = /^https:\/\/t\.me\/(?:c\/(\d+)|([a-zA-Z0-9_]+))\/(\d+)\/?$/.exec(text.trim());
  return m ? {chatId:m[1] ? '-100'+m[1] : '@'+m[2],msgId:Number(m[3])} : null;
}
const hex = bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
async function keyFor(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).slice(0,16); }
const randomJob = ()=>hex(crypto.getRandomValues(new Uint8Array(16)));
async function tg(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot'+env.CONTENT_BOT_TOKEN+'/'+method, {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.description || 'ارتباط با تلگرام ناموفق بود');
  return data.result;
}
async function site(env, action, body) {
  const r = await contentBotAction(new Store(env.KV, env), body, action);
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error || 'خطای سایت'); e.status = r.status; throw e; }
  return data;
}
async function contentSiteOrigin(env) {
  const settings = await getSettings(new Store(env.KV, env));
  const raw = env.SITE_PUBLIC_ORIGIN || settings.publicUrl || '';
  try { const url = new URL(raw); if (url.protocol === 'https:') return url.origin; } catch {}
  throw new Error('دامنه عمومی سایت را در تنظیمات یا SITE_PUBLIC_ORIGIN مشخص کنید');
}
function adminAllowed(env,id) { return String(env.CONTENT_ADMIN_IDS || '').split(',').map(x=>x.trim()).includes(String(id)); }
const contentBotWebhook = {
  async fetch(request,env) {
    const path = new URL(request.url).pathname;
    if (path !== '/api/tg/content-webhook' || request.method !== 'POST') return new Response('Not found',{status:404});
    if (!env.CONTENT_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.CONTENT_WEBHOOK_SECRET) return new Response('Forbidden',{status:403});
    if (!env.CONTENT_BOT_TOKEN || !env.EDITOR || !env.KV) return Response.json({error:'Editorial bot bindings are not configured'},{status:503});
    const raw = await request.text();
    if (raw.length > 128*1024) return new Response('Too large',{status:413});
    let update; try { update=JSON.parse(raw); } catch { return new Response('Invalid JSON',{status:400}); }
    if (update.channel_post) {
      const post = update.channel_post;
      let rules;
      try { rules=contentChannelRules(env); } catch { return new Response('Invalid channel configuration',{status:503}); }
      if (post.chat?.type!=='channel' || !rules[String(post.chat.id)]) return Response.json({ok:true});
      const channel = env.EDITOR.get(env.EDITOR.idFromName('channel:'+post.chat.id));
      return channel.fetch(new Request('https://editor.internal/channel-enqueue',{method:'POST',body:JSON.stringify(post)}));
    }
    const msg = update.message;
    // Only private messages from allowlisted admins can change a private draft.
    if (!msg || msg.chat?.type !== 'private' || msg.from?.is_bot || !adminAllowed(env,msg.from?.id)) return Response.json({ok:true});
    const stub = env.EDITOR.get(env.EDITOR.idFromName('admin:'+msg.from.id));
    return stub.fetch(new Request('https://editor.internal/update',{method:'POST',body:JSON.stringify(update)}));
  }
};
export class EditorSession {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; this.tail=Promise.resolve(); }
  fetch(request) {
    // Serialize messages across all awaits; concurrent Telegram deliveries must not lose draft files.
    const result = this.tail.then(()=>this.dispatch(request));
    this.tail = result.catch(()=>{});
    return result;
  }
  async dispatch(request) {
    if (new URL(request.url).pathname.startsWith('/channel-')) return this.channelRequest(request);
    // All publications from this bot are routed through a single durable coordinator.
    if (new URL(request.url).pathname === '/publish') {
      const data = await request.json();
      try { return Response.json(await site(this.env,'publish',data)); }
      catch(e) { return Response.json({error:e.message},{status:e.status || 502}); }
    }
    const update=await request.json(), msg=update.message, actor=String(msg.from.id);
    const seen=await this.ctx.storage.get('seen') || [];
    if (seen.includes(update.update_id)) return Response.json({ok:true});
    try {
      await site(this.env,'whoami',{actorId:actor}); // Check current site role, not just an allowlist.
      await this.process(msg,actor);
      await this.ctx.storage.put('seen',[...seen,update.update_id].slice(-100));
    } catch(e) {
      // Do not log tokens or Telegram message payloads.
      try { await this.say(msg.chat.id,'⚠️ '+e.message+'\nبرای راهنما /help را بفرستید.'); } catch { return new Response('Retry',{status:503}); }
    }
    return Response.json({ok:true});
  }
  async channelRequest(request) {
    const path=new URL(request.url).pathname, body=await request.json();
    if (path==='/channel-enqueue') {
      if (!Number.isSafeInteger(body.message_id) || body.message_id<1) return new Response('Bad message',{status:400});
      const channel=String(body.chat?.id || '');
      if (!contentChannelRules(this.env)[channel]) return new Response('Forbidden',{status:403});
      await this.ctx.storage.put('channel-id',channel);
      const meta=await this.ctx.storage.get('channel-meta') || {};
      if (body.message_id <= (meta.lastId || 0)) return Response.json({ok:true,ignoredOld:true});
      const key='queue:'+String(body.message_id).padStart(16,'0');
      if (await this.ctx.storage.get(key)) return Response.json({ok:true});
      const backlog=await this.ctx.storage.list({prefix:'queue:',limit:501});
      if (backlog.size>=500) return new Response('Queue full; retry',{status:503});
      await this.ctx.storage.put(key,{post:body,copies:[],attempts:0});
      if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+1500);
      return Response.json({ok:true});
    }
    const channel=await this.ctx.storage.get('channel-id');
    const meta=await this.ctx.storage.get('channel-meta') || {};
    if (path==='/channel-status') {
      const pending=await this.ctx.storage.list({prefix:'queue:',limit:501});
      const failed=await this.ctx.storage.list({prefix:'failed:',limit:20});
      return Response.json({message:'کانال '+(channel || 'بدون پست دریافتی')+'\nاثر فعال: '+(meta.context?.title || 'متوقف')+'\nنسخه: '+(meta.context?.version || '—')+'\nآخرین پیام پردازش‌شده: '+(meta.lastId || 0)+'\nثبت موفق: '+(meta.imported || 0)+'\nدر صف: '+pending.size+'\nآخرین خطا: '+(meta.lastError || 'ندارد')+'\nفایل‌های نیازمند بررسی: '+[...failed.values()].map(e=>e.post.message_id).join(', ')+'\nبرای تلاش دوباره: /retry '+channel+' شماره‌پیام'});
    }
    if (path==='/channel-skip-relay') {
      const rule=contentChannelRules(this.env)[channel];
      const entry=await this.ctx.storage.list({prefix:'queue:',limit:1});
      if (!rule || !entry.size || [...entry.values()][0].post.message_id!==body.id) return Response.json({error:'شماره پیام باید اولین پیام متوقف‌شده صف باشد'}, {status:400});
      const [key,event]=[...entry.entries()][0];
      event.copies=[...rule.targets]; event.relaySkipped=true;
      await this.ctx.storage.put(key,event);
      await this.ctx.storage.setAlarm(Date.now()+1000);
      return Response.json({message:'انتقال این پیام به مقصدهای باقی‌مانده رد شد. صف ادامه پیدا می‌کند؛ پیام منبع حذف نشده است.'});
    }
    if (path==='/channel-retry') {
      if (!Number.isSafeInteger(body.id) || body.id<1) return Response.json({error:'شماره پیام معتبر وارد کنید'}, {status:400});
      const key=String(body.id).padStart(16,'0');
      const event=await this.ctx.storage.get('failed:'+key);
      if (!event) return Response.json({error:'این پیام در فهرست خطاهای اخیر نیست؛ وضعیت کانال را بررسی کنید'}, {status:404});
      event.retry=true; event.importDone=false; event.error=''; event.attempts=0;
      if (event.importJob) {
        const item=await site(this.env,'item',{actorId:event.importJob.actorId,itemId:event.importJob.itemId});
        event.importJob.expectedUpdatedAt=item.item.updatedAt;
      } else event.context=meta.context;
      await this.ctx.storage.put('queue:'+key,event);
      await this.ctx.storage.setAlarm(Date.now()+1000);
      return Response.json({message:'پیام برای بررسی مجدد در صف قرار گرفت. فایل اصلی در کانال حذف یا دوباره کپی نمی‌شود.'});
    }
    return new Response('Not found',{status:404});
  }
  async drainChannel() {
    const channel=await this.ctx.storage.get('channel-id');
    const rule=contentChannelRules(this.env)[channel];
    if (!rule) return; // Removing a source from configuration stops its pending work.
    const queue=await this.ctx.storage.list({prefix:'queue:',limit:1});
    if (!queue.size) return;
    const [key,event]=[...queue.entries()][0], post=event.post;
    const meta=await this.ctx.storage.get('channel-meta') || {};
    const media=post.document || post.video || post.audio;
    try {
      await site(this.env,'whoami',{actorId:rule.adminId});
      if (!event.importDone && rule.publish) {
        if (!event.importJob) {
          try {
            if (!media) {
              const header=parseChannelHeader(post.text || '',meta.context,await contentSiteOrigin(this.env));
              if (header?.stopped) meta.context=null;
              else if (header) {
                const target=await site(this.env,'item',{actorId:rule.adminId,itemId:header.itemId});
                meta.context={...header,title:target.item.title};
              } else if (String(post.text || '').trim()) {
                meta.context=null;
                throw new Error('متن بدون الگو دریافت شد؛ ورود خودکار متوقف شد. سربرگ #اثر، #نسخه و #نوع را دوباره بفرستید.');
              }
              event.importDone=true;
            } else {
              const context=event.context || meta.context;
              if (!context || context.stopped) throw new Error('سربرگ فعال وجود ندارد؛ ابتدا #اثر، #نسخه و #نوع را مشخص کنید.');
              const target=await site(this.env,'item',{actorId:rule.adminId,itemId:context.itemId});
              const details=channelFileDetails({...media,file_name:media.file_name || String(post.caption || '').split('\n')[0]},context,target.item);
              event.context=context;
              const file={key:await keyFor(channel+':'+post.message_id),kind:context.kind,quality:details.quality,season:details.season,episode:details.episode,
                title:details.title,sizeBytes:details.sizeBytes,chatId:channel,msgId:post.message_id,channelImport:true};
              const jobId=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('channel:'+channel+':'+post.message_id)))).slice(0,32);
              event.importJob={actorId:rule.adminId,itemId:context.itemId,expectedUpdatedAt:target.item.updatedAt,jobId,files:[file]};
              await this.ctx.storage.put(key,event); // Receipt identity survives network failures.
            }
          } catch(e) {
            if (e.status && e.status>=500) throw e;
            if (!media) meta.context=null;
            event.error=e.message; event.importDone=true;
          }
        }
        if (event.importJob && !event.importDone) {
          const coordinator=this.env.EDITOR.get(this.env.EDITOR.idFromName('publication-coordinator'));
          const response=await coordinator.fetch(new Request('https://editor.internal/publish',{method:'POST',body:JSON.stringify(event.importJob)}));
          const result=await response.json();
          if (response.status>=500) throw new Error(result.error || 'انتشار موقتاً ناموفق بود');
          if (!response.ok) event.error=result.error || 'انتشار ناموفق';
          else { event.published=true; event.error=''; }
          event.importDone=true;
        }
      }
      if (!rule.publish) event.importDone=true;
      await this.ctx.storage.put('channel-meta',meta);
      await this.ctx.storage.put(key,event);
      // One post at a time and one destination at a time; a failed target blocks newer posts.
      for (const target of rule.targets) {
        if (event.copies.includes(target)) continue;
        await tg(this.env,'copyMessage',{chat_id:target,from_chat_id:channel,message_id:post.message_id});
        event.copies.push(target);
        await this.ctx.storage.put(key,event);
      }
      if (event.error) {
        meta.lastError='پیام '+post.message_id+': '+event.error;
        if (media) {
          await this.ctx.storage.put('failed:'+String(post.message_id).padStart(16,'0'),event);
          const failures=await this.ctx.storage.list({prefix:'failed:',limit:100});
          for (const stale of [...failures.keys()].slice(0,Math.max(0,failures.size-20))) await this.ctx.storage.delete(stale);
        }
        try { await this.say(rule.adminId,'⚠️ کانال '+channel+'، پیام '+post.message_id+'\n'+event.error+'\nوضعیت: /channel '+channel); } catch {}
      } else if (media) await this.ctx.storage.delete('failed:'+String(post.message_id).padStart(16,'0'));
      if (event.published) meta.imported=(meta.imported || 0)+1;
      meta.lastId=Math.max(meta.lastId || 0,post.message_id);
      await this.ctx.storage.put('channel-meta',meta);
      await this.ctx.storage.delete(key);
      const next=await this.ctx.storage.list({prefix:'queue:',limit:1});
      if (next.size) await this.ctx.storage.setAlarm(Date.now()+1000);
    } catch(e) {
      event.attempts=(event.attempts || 0)+1;
      meta.lastError='صف در پیام '+post.message_id+' متوقف است: '+e.message;
      await this.ctx.storage.put(key,event);
      await this.ctx.storage.put('channel-meta',meta);
      await this.ctx.storage.setAlarm(Date.now()+Math.min(300000,5000*2**Math.min(event.attempts,6)));
      if (event.attempts===1) { try { await this.say(rule.adminId,'⚠️ '+meta.lastError+'\nپس از اصلاح دسترسی/تنظیمات، تلاش مجدد خودکار است.'); } catch {} }
    }
  }
  say(chat,text) { return tg(this.env,'sendMessage',{chat_id:chat,text,reply_markup:{resize_keyboard:true,keyboard:[
    ['راهنما','وضعیت کانال‌ها'],['مرحله بعد','پیش‌نمایش'],['انتشار پس از بررسی','تازه‌کردن مشخصات'],
    ['تأیید فایل منتظر','ردکردن فایل منتظر'],['اصلاح فصل و کیفیت','لغو پیش‌نویس']
  ]}}); }
  async save(draft) {
    draft.touchedAt=Date.now();
    await this.ctx.storage.put('draft',draft);
    await this.ctx.storage.setAlarm(Date.now()+DAY);
  }
  stageText(d) {
    return 'اثر: '+d.item.title+'\nاکنون فایل‌های '+LABELS[STAGES[d.stage]]+' را بفرستید (خود فایل یا فوروارد). عنوان نسخه را می‌توانید در کپشن بنویسید.\nدکمه «مرحله بعد» برای ردکردن این دسته؛ «پیش‌نمایش» برای بررسی فایل‌ها؛ «لغو پیش‌نویس» برای انصراف';
  }
  async process(msg,actor) {
    let text=String(msg.text || '').trim(); const chat=msg.chat.id;
    const buttons={'راهنما':'/help','مرحله بعد':'/next','پیش‌نمایش':'/review','انتشار پس از بررسی':'/confirm','تأیید فایل منتظر':'/accept','ردکردن فایل منتظر':'/skip','تازه‌کردن مشخصات':'/refresh'};
    text=buttons[text] || text;
    const publicOrigin = await contentSiteOrigin(this.env);
    const control = /^\/(channel|retry|skiprelay) (-100\d{6,20})(?: (\d+))?$/.exec(text);
    if (control) {
      const rule=contentChannelRules(this.env)[control[2]];
      if (!rule || rule.adminId!==actor) return this.say(chat,'این کانال به حساب مدیریت شما متصل نیست.');
      const target=this.env.EDITOR.get(this.env.EDITOR.idFromName('channel:'+control[2]));
      const r=await target.fetch(new Request('https://editor.internal/channel-'+(control[1]==='retry'?'retry':control[1]==='skiprelay'?'skip-relay':'status'),{method:'POST',body:JSON.stringify({id:Number(control[3] || 0)})}));
      const result=await r.json();
      return this.say(chat,result.message || result.error || 'درخواست انجام شد.');
    }
    let d=await this.ctx.storage.get('draft');
    if (text==='وضعیت کانال‌ها') {
      const rules=contentChannelRules(this.env), ids=Object.keys(rules).filter(id=>rules[id].adminId===actor);
      if (!ids.length) return this.say(chat,'هنوز کانالی برای شما تنظیم نشده. در پنل سایت، بخش راه‌اندازی ربات، تنظیم کانال را بسازید. شناسه تلگرام شما: '+actor);
      for (const id of ids) {
        const target=this.env.EDITOR.get(this.env.EDITOR.idFromName('channel:'+id));
        const r=await target.fetch(new Request('https://editor.internal/channel-status',{method:'POST',body:'{}'}));
        const report=await r.json(); await this.say(chat,report.message || 'وضعیت در دسترس نیست.');
      }
      return;
    }
    if (text==='لغو پیش‌نویس' && d?.phase!=='publishing') {
      if (!d) return this.say(chat,'پیش‌نویس فعالی ندارید.');
      d.cancelRequested=true; await this.save(d);
      return tg(this.env,'sendMessage',{chat_id:chat,text:'فایل‌های منتشرنشده این پیش‌نویس از مخزن پاک شوند؟',reply_markup:{resize_keyboard:true,keyboard:[['تأیید لغو','ادامه کار']]}});
    }
    if (text==='تأیید لغو') {
      if (!d?.cancelRequested) return this.say(chat,'درخواست لغو فعالی ندارید.');
      text='/cancel';
    } else if (d?.cancelRequested) { delete d.cancelRequested; await this.save(d); }
    if (text==='ادامه کار') return this.say(chat,d ? this.stageText(d) : 'لینک صفحه اثر را بفرستید.');
    if (text==='اصلاح فصل و کیفیت') {
      if (!d?.pending || d.phase==='publishing') return this.say(chat,'فایل منتظر اصلاح وجود ندارد.');
      d.awaitingAssignment=true; await this.save(d);
      return this.say(chat,'فصل، قسمت و کیفیت را با فاصله بفرستید. مثال: 2 3 1080 یعنی فصل ۲، قسمت ۳، کیفیت 1080. برای فیلم بنویسید: 1 1 1080');
    }
    if (d?.awaitingAssignment && /^[0-9۰-۹]+ +[0-9۰-۹]+ +(480|720|1080|2160|4k|۴۸۰|۷۲۰|۱۰۸۰|۲۱۶۰)$/.test(text)) {
      text='/assign '+text.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))); delete d.awaitingAssignment;
    }
    if (text === '/help' || text === '/start') return this.say(chat,
      'سلام! شناسه تلگرام شما: '+actor+'\n\nبرای ثبت خودکار، سربرگ و فایل‌ها را در کانال تنظیم‌شده بگذارید؛ لازم نیست برای هر فایل فرمانی بفرستید. دکمه «وضعیت کانال‌ها» نتیجه را نشان می‌دهد.\n\nبرای ثبت دستی، لینک صفحه فیلم یا سریال را بفرستید و با دکمه‌های پایین ادامه دهید: «مرحله بعد»، «پیش‌نمایش» و سپس «انتشار پس از بررسی».\nاگر نام فایل روشن نبود، «اصلاح فصل و کیفیت» را بزنید. دکمه «لغو پیش‌نویس» قبل از حذف تأیید می‌گیرد. فرمان‌های قبلی هم همچنان کار می‌کنند.');
    if (d?.phase === 'publishing' && !['/confirm','/review'].includes(text)) return this.say(chat,'نتیجه انتشار هنوز قطعی نیست. ابتدا /confirm را دوباره بفرستید؛ لغو یا حذف فایل در این وضعیت مجاز نیست.');
    if (text === '/cancel') {
      if (d) await this.discard(d);
      return this.say(chat,'پیش‌نویس لغو شد. لینک اثر را بفرستید.');
    }
    const itemId=itemIdFromLink(text,publicOrigin);
    if (itemId) {
      if (d) return this.say(chat,'ابتدا پیش‌نویس فعلی را با /confirm ثبت یا با /cancel لغو کنید.');
      const data=await site(this.env,'item',{actorId:actor,itemId});
      if (!['movie','series'].includes(data.item.type)) return this.say(chat,'این اثر فیلم یا سریال نیست.');
      d={actor,chat,jobId:randomJob(),item:data.item,vault:data.vault,stage:0,files:[],pending:null,phase:'collect'};
      await this.save(d);
      return this.say(chat,'🎬 '+data.item.title+' — '+(data.item.year || '')+'\n'+data.item.description.slice(0,700)+'\n\n'+this.stageText(d));
    }
    if (!d) return this.say(chat,'ابتدا لینک صفحه فیلم یا سریال در همین سایت را بفرستید.');
    if (text === '/refresh') {
      const data=await site(this.env,'item',{actorId:actor,itemId:d.item.id});
      if (data.vault !== d.vault) return this.say(chat,'مخزن تغییر کرده است؛ این پیش‌نویس را لغو و دوباره شروع کنید.');
      d.item=data.item; d.phase='collect'; await this.save(d); return this.review(d);
    }
    if (text === '/skip') { d.pending=null; d.phase='collect'; await this.save(d); return this.say(chat,'فایل منتظر رد شد.\n'+this.stageText(d)); }
    if (text === '/next') {
      if (d.pending) return this.say(chat,'ابتدا فایل منتظر را با /assign یا /accept تعیین تکلیف کنید؛ برای ردکردن /skip.');
      if (d.stage === STAGES.length-1) return this.review(d);
      d.stage++; d.phase='collect'; await this.save(d); return this.say(chat,this.stageText(d));
    }
    if (text === '/review') return this.review(d);
    if (text === '/confirm') {
      if (!['review','publishing'].includes(d.phase) || d.pending || !d.files.length) return this.say(chat,'ابتدا /review را بفرستید و موارد مبهم را تکمیل کنید.');
      const retrying = d.phase === 'publishing';
      d.phase='publishing'; await this.save(d);
      const coordinator=this.env.EDITOR.get(this.env.EDITOR.idFromName('publication-coordinator'));
      const r=await coordinator.fetch(new Request('https://editor.internal/publish',{method:'POST',body:JSON.stringify({actorId:actor,itemId:d.item.id,expectedUpdatedAt:d.item.updatedAt,jobId:d.jobId,files:d.files})}));
      const result=await r.json();
      if (!r.ok) {
        if (!retrying && [400,403,404,409].includes(r.status)) { d.phase='collect'; await this.save(d); }
        throw new Error((result.error || 'انتشار ناموفق')+(r.status===409 ? '\n/refresh سپس /review و /confirm' : ''));
      }
      await this.ctx.storage.delete('draft'); await this.ctx.storage.deleteAlarm();
      return this.say(chat,'✅ '+result.count+' فایل به '+d.item.title+' اضافه شد.\n'+publicOrigin+'/#/item/'+d.item.id);
    }
    if (/^\/remove \d+$/.test(text)) {
      const index=Number(text.split(' ')[1])-1;
      if (!d.files[index]) return this.say(chat,'شماره فایل در پیش‌نویس وجود ندارد.');
      const file=d.files[index];
      await tg(this.env,'deleteMessage',{chat_id:d.vault,message_id:file.msgId});
      d.files.splice(index,1); d.phase='collect'; await this.save(d); return this.say(chat,'فایل از پیش‌نویس و مخزن حذف شد؛ برای خلاصه /review.');
    }
    if (text === '/accept' || text.startsWith('/assign ')) {
      if (!d.pending) return this.say(chat,'فایل منتظری وجود ندارد.');
      if (text.startsWith('/assign ')) {
        const m=/^\/assign (\d+) (\d+) (480|720|1080|2160|4k)$/.exec(text);
        if (!m) return this.say(chat,'مثال: /assign 2 3 1080');
        Object.assign(d.pending,{season:Number(m[1]),episode:Number(m[2]),quality:m[3]==='2160'?'4k':m[3]});
      }
      return this.stageFile(d,d.pending,true);
    }
    if (d.pending) return this.say(chat,'یک فایل منتظر تأیید است. /accept یا /assign یا /skip را بفرستید.');
    const media=msg.document || msg.video || msg.audio;
    const link=sourceLink(text);
    if (!media && !link) return this.say(chat,this.stageText(d));
    if (d.files.length>=20) return this.say(chat,'پیش‌نویس به سقف ۲۰ فایل رسیده؛ /review را بفرستید.');
    const parsed=parseFilename(media?.file_name || msg.caption || '');
    const file={...parsed,kind:STAGES[d.stage],title:String(msg.caption || '').slice(0,100),sizeBytes:media?.file_size || null,
      inputChat:link?.chatId || chat,inputMessage:link?.msgId || msg.message_id,
      key:await keyFor((media?.file_unique_id || (link ? link.chatId+':'+link.msgId : chat+':'+msg.message_id))+':'+STAGES[d.stage])};
    return this.stageFile(d,file,false);
  }
  async stageFile(d,file,accepted) {
    if (d.files.some(x=>x.key===file.key)) { d.pending=null; await this.save(d); return this.say(d.chat,'این فایل قبلاً در همین پیش‌نویس دریافت شده است.'); }
    const validQuality=['480','720','1080','4k'].includes(file.quality);
    const validEpisode=d.item.type!=='series' || (Number.isInteger(file.season)&&file.season>=1&&file.season<=200&&Number.isInteger(file.episode)&&file.episode>=1&&file.episode<=10000);
    const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
    const english=d.item.title.split('|').find(t=>/[a-z]{2}/i.test(t));
    const uncertainName=!english || !norm(file.detectedTitle).includes(norm(english.trim()));
    if (!validQuality || !validEpisode || (!accepted && uncertainName)) {
      d.pending=file; d.phase='collect'; await this.save(d);
      return this.say(d.chat,'نیاز به بررسی: '+(file.detectedTitle || 'نام نامشخص')+'\nفصل '+(file.season ?? '؟')+'، قسمت '+(file.episode ?? '؟')+'، کیفیت '+(file.quality || '؟')+'\nاثر مقصد: '+d.item.title+'\nبرای اصلاح: /assign 1 2 1080\nاگر اطلاعات درست است: /accept\nردکردن: /skip');
    }
    const copied=await tg(this.env,'copyMessage',{chat_id:d.vault,from_chat_id:file.inputChat,message_id:file.inputMessage});
    d.files.push({key:file.key,kind:file.kind,title:file.title,season:d.item.type==='series'?file.season:1,episode:d.item.type==='series'?file.episode:1,
      quality:file.quality,sizeBytes:file.sizeBytes,chatId:d.vault,msgId:copied.message_id});
    d.pending=null; d.phase='collect'; await this.save(d);
    return this.say(d.chat,'📥 فایل '+d.files.length+' در پیش‌نویس: '+LABELS[file.kind]+' | '+file.quality+(d.item.type==='series'?' | S'+file.season+'E'+file.episode:'')+'\nفایل بعدی را بفرستید؛ /next یا /review. هنوز در سایت منتشر نشده است.');
  }
  async review(d) {
    if (d.pending) return this.say(d.chat,'ابتدا فایل منتظر را تعیین تکلیف کنید: /assign یا /accept یا /skip.');
    if (!d.files.length) return this.say(d.chat,'پیش‌نویس خالی است.\n'+this.stageText(d));
    if (d.phase!=='publishing') { d.phase='review'; await this.save(d); }
    return this.say(d.chat,'پیش‌نمایش '+d.item.title+'\n'+d.files.map((f,i)=>(i+1)+'. '+LABELS[f.kind]+' | '+f.quality+(d.item.type==='series'?' | S'+f.season+'E'+f.episode:'')+(f.title?' | '+f.title:'')).join('\n')+'\n\n/confirm تأیید و انتشار\n/remove 2 حذف فایل دوم\n/cancel لغو');
  }
  async discard(d) {
    if (d.phase==='publishing') return;
    if (d.files.length) await tg(this.env,'deleteMessages',{chat_id:d.vault,message_ids:d.files.map(f=>f.msgId)});
    await this.ctx.storage.delete('draft'); await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const run=this.tail.then(async()=>{
      if (await this.ctx.storage.get('channel-id')) return this.drainChannel();
      const d=await this.ctx.storage.get('draft');
      if (!d) return;
      if (d.phase==='publishing') { await this.ctx.storage.setAlarm(Date.now()+DAY); return; } // Never delete possibly published files.
      if (Date.now()-d.touchedAt<DAY) { await this.ctx.storage.setAlarm(d.touchedAt+DAY); return; }
      await this.discard(d);
      try { await this.say(d.chat,'پیش‌نویس بدون فعالیت پس از ۲۴ ساعت لغو شد.'); } catch {}
    });
    this.tail=run.catch(()=>{}); return run;
  }
}


async function handleApi(request, url, store, ctx) {
  const p = url.pathname.replace(/^\/api\//, '');
  const m = request.method;
  let mm;

  if (p === 'tg/content-webhook') return contentBotWebhook.fetch(request, store.env);
  // Retired external bridge is intentionally inaccessible.
  if (p.startsWith('content-bot/')) return json({error:'not found'},404);

  if ((p === 'tg/webhook' || p === 'tg/file-webhook') && m === 'POST') {
    const set = await getSettings(store);
    const hdr = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (set.webhookSecret && hdr !== set.webhookSecret) return json({ error: 'forbidden' }, 401);
    const body = await readBody(request, 1024 * 1024);
    return await handleTgUpdate(store, body, ctx, request, { fileBot: p === 'tg/file-webhook' });
  }

  if (p === 'site' && m === 'GET') {
    const set = await getSettings(store);
    return json({
      siteName: set.siteName, tagline: set.tagline, economy: publicEconomy(set),
      botId: set.botId || 0,
      widgetDomain: String(set.widgetDomain || '').trim() || String(set.publicUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
      redirectMode: set.redirectMode || 'off',
    });
  }

  if (p === 'catalog' && m === 'GET') return await apiCatalog(store, url, request);

  mm = p.match(/^item\/(i_[a-z0-9]+)$/);
  if (mm && m === 'GET') return await apiItem(store, mm[1], request);

  if (p === 'auth/bootstrap' && m === 'POST') return await apiBootstrap(store, await readBody(request), request);
  if (p === 'auth/login' && m === 'POST') return await apiLegacyLogin(store, await readBody(request), request);
  if (p === 'auth/widget' && m === 'POST') return await apiWidgetLogin(store, await readBody(request), request);
  if (p === 'auth/widget-cb' && m === 'GET') return await apiWidgetCb(store, url, request);
  if (p === 'auth/start' && m === 'POST') return await apiAuthStart(store, await readBody(request), request);
  mm = p.match(/^auth\/ticket\/([a-f0-9]{8,64})$/);
  if (mm && m === 'GET') return await apiAuthTicket(store, mm[1]);
  if (p === 'auth/tg' && m === 'POST') return await apiTgLoginExisting(store, await readBody(request, 1024 * 1024));
  if (p === 'auth/logout' && m === 'POST') return json({ ok: true });
  if (p === 'me' && m === 'GET') {
    const set = await getSettings(store);
    const u = await currentUser(request, store);
    return json({ user: pubUser(u), site: { siteName: set.siteName, tagline: set.tagline }, economy: publicEconomy(set) });
  }

  if (p === 'wallet' && m === 'GET') return await apiWallet(store, request);
  if (p === 'wallet/transfer' && m === 'POST') return await apiTransfer(store, await readBody(request), request);
  if (p === 'wallet/stars' && m === 'POST') return await apiStarsStart(store, await readBody(request), request);
  if (p === 'wallet/rial' && m === 'POST') return await apiRialStart(store, await readBody(request), request);
  if (p === 'wallet/k2k' && m === 'POST') return await apiK2kCreate(store, await readBody(request), request);
  if (p.indexOf('wallet/k2k/') === 0 && p.slice(-6) === '/track' && m === 'POST') {
    return await apiK2kTrack(store, p.slice('wallet/k2k/'.length, -6), await readBody(request), request);
  }
  if (p.indexOf('wallet/k2k/') === 0 && p.slice(-7) === '/cancel' && m === 'POST') {
    return await apiK2kCancel(store, p.slice('wallet/k2k/'.length, -7), request);
  }
  if (p.indexOf('wallet/k2k/') === 0 && m === 'GET') return await apiK2kGet(store, p.slice('wallet/k2k/'.length), request);
  if ((p === 'k2k/hook' || p === 'wallet/k2k/hook') && m === 'POST') return await apiK2kHook(store, await readBody(request, 64 * 1024), request);
  if ((p === 'k2k/bale' || p === 'k2k/bale-webhook') && m === 'POST') return await apiK2kBale(store, await readBody(request, 64 * 1024), request);
  if (p === 'wallet/zarinpal/cb' && m === 'GET') return await apiZarinpalCb(store, url);
  if (p === 'wallet/redeem' && m === 'POST') return await apiRedeemCode(store, await readBody(request), request);
  if (p === 'subscribe' && m === 'POST') return await apiSubscribe(store, await readBody(request), request);
  if (p === 'dl/request' && m === 'POST') return await apiDlRequest(store, await readBody(request), request);
  mm = p.match(/^dl\/gate\/([a-f0-9]{6,32})$/);
  if (mm && m === 'POST') return await apiDlGate(store, mm[1], request);
  mm = p.match(/^ad\/([a-z0-9_]{2,32})\/click$/);
  if (mm && m === 'POST') return await apiAdClick(store, mm[1], request);

  if (p.indexOf('admin/') === 0) {
    const admin = await requireAdmin(request, store);
    if (!admin) return json({ error: 'دسترسی مدیریت لازم است', status: 403 }, 403);
    return await handleAdmin(store, url, request, admin);
  }

  return json({ error: 'یافته نشد' }, 404);
}

function faviconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0e14"/><path d="M24 18 L46 32 L24 46 Z" fill="#ff7a1a"/><rect x="12" y="16" width="6" height="32" rx="3" fill="#ffb01f"/></svg>';
}

function htmlPage(settings) {
  const html = APP_HTML
    .replace(/@@MINI_APP_URL@@/g, CONFIG.MINI_APP_URL)
    .replace(/@@SITE@@/g, htmlEscape(settings.siteName))
    .replace(/@@TAG@@/g, htmlEscape(settings.tagline || ''));
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}

export default {
  async fetch(request, env, ctx) {
    if (!request || typeof request.url !== 'string') {
      try {
        const store = new Store(env.KV, env);
        const set = await getSettings(store);
        if (set.autoSync && set.botToken && !set.webhookOk) await runSync(store);
      } catch (e) { console.error('cron sync error', e); }
      return new Response('ok');
    }
    const url = new URL(request.url);
    try {
      const store = new Store(env.KV, env);
      if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(faviconSvg(), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      }
      if (url.pathname === '/img' && request.method === 'GET') return await imgResponse(request, url, store);
      if (url.pathname.indexOf('/api/') === 0 && request.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-telegram-bot-api-secret-token,x-k2k-secret' } });
      }
      if (url.pathname.indexOf('/api/') === 0) return await handleApi(request, url, store, ctx);
      const set = await getSettings(store);
      if (request.method === 'GET' && set.botToken && !set.webhookOk) {
        const origin = set.publicUrl || url.origin;
        if (!set.publicUrl && origin) set.publicUrl = origin;
        const job = maybeSetWebhook(store, set, origin).then(function () { return writeSettings(store, set); });
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
      }
      return htmlPage(set);
    } catch (e) {
      const st = e && e.status ? e.status : 500;
      if (st >= 500) console.error(e);
      return json({ error: (e && e.message) || 'خطای سرور' }, st);
    }
  },
};

export const schedules = [{ cron: '*/30 * * * *' }];

/* ═══════════════════════ کل سایت (HTML + CSS) ═══════════════════════ */
const APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="mvx-version" content="v3.50">
<meta name="theme-color" content="#0b0e14">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>@@SITE@@</title>
<meta name="description" content="@@TAG@@">
<meta property="og:title" content="@@SITE@@">
<meta property="og:description" content="@@TAG@@">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;800;900&display=swap" rel="stylesheet" media="print" onload="this.media='all'" onerror="this.remove()">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;800;900&display=swap"></noscript>
<style>
:root{
  --bg:#0b0e14; --bg2:#10141c; --card:#151a24; --card2:#1a202c; --line:#242c3b;
  --tx:#eef1f6; --tx2:#98a2b6; --tx3:#6b7689;
  --acc:#ff7a1a; --acc2:#ffb01f; --acc-soft:rgba(255,122,26,.14);
  --grad:linear-gradient(135deg,#ff5f2e,#ffb01f);
  --ok:#3ddc84; --err:#ff5470; --warn:#ffc53d;
  --live:#ff3b5c;
  /* ── سبک شیشه‌ای (iOS-like glass) ── */
  --glass:rgba(255,255,255,.06);
  --glass-2:rgba(255,255,255,.1);
  --glass-line:rgba(255,255,255,.12);
  --glass-line-2:rgba(255,255,255,.2);
  --glass-blur:blur(18px) saturate(160%);
  --shadow:0 12px 36px rgba(0,0,0,.45);
  --rad:18px; --rad-s:14px; --rad-xs:10px;
  --hdr-h:60px;
  /* چیدمان ریسپانسیو: محتوا در دسکتاپ تا سقف --content-w کش می‌آید و وسط‌چین
     می‌شود؛ در موبایل تمام عرض است. مودال‌ها سقف جداگانه‌ای دارند. */
  --content-w:1240px;
  --modal-w:520px;
  --modal-w-wide:780px;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth}
body{background:#07090d;color:var(--tx);font-family:Vazirmatn,Vazir,system-ui,Tahoma,sans-serif;font-size:15px;line-height:1.7;overflow-x:hidden}
body:before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(60% 40% at 85% -10%,rgba(255,122,26,.14),transparent 60%),radial-gradient(50% 35% at 0% 100%,rgba(56,189,248,.08),transparent 60%)}
/* پوستهٔ ریسپانسیو: هدر و ناوبری تمام عرض، مین تا سقف --content-w وسط‌چین */
#app{width:100%;min-height:100vh;min-height:100dvh;background:transparent;position:relative;z-index:1}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font-family:inherit;font-size:14px;color:var(--tx);background:rgba(255,255,255,.05);border:1px solid var(--glass-line);border-radius:12px;padding:10px 12px;outline:none;width:100%;transition:border-color .15s,box-shadow .15s,background .15s}
input:focus,select:focus,textarea:focus{border-color:rgba(255,122,26,.7);background:rgba(255,255,255,.07);box-shadow:0 0 0 3px var(--acc-soft)}
select{-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--tx3) 50%),linear-gradient(135deg,var(--tx3) 50%,transparent 50%);background-position:11px calc(50% + 1px),16px calc(50% + 1px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-inline-start:28px}
select option{background:#151a24;color:var(--tx)}
textarea{resize:vertical;min-height:90px}
img{max-width:100%}
::selection{background:var(--acc);color:#fff}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:#2a3345;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}

/* padding-top = safe area: در حالت تمام‌صفحهٔ تلگرام، نوار وضعیت گوشی
   (ساعت/باتری) روی WebView می‌افتد و هدر باید از آن پایین‌تر باشد */
.hdr{position:sticky;top:0;z-index:50;height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));display:flex;align-items:center;gap:14px;padding:env(safe-area-inset-top,0px) 18px 0;background:rgba(11,14,20,.62);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-line)}
/* صفحهٔ جزئیات: هدر شفاف روی بنر (مثل نماوا) */
.hdr.hdr-float{position:fixed;left:0;right:0;background:linear-gradient(180deg,rgba(5,7,10,.75),rgba(5,7,10,0));backdrop-filter:none;-webkit-backdrop-filter:none;border-bottom:0}
.hdr.hdr-float .logo-tx{filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}
.hdr.hdr-float.scrolled{background:rgba(11,14,20,.72);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-line)}
.hdr.hdr-float{transition:background .25s,border-color .25s}
.hdr-back{display:none;width:38px;height:38px;border-radius:50%;background:var(--glass);border:1px solid var(--glass-line);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);align-items:center;justify-content:center;font-size:20px;color:#fff;flex:none}

main.m-full{max-width:none;padding:0}
.logo{display:flex;align-items:center;gap:8px;font-weight:900;font-size:19px;white-space:nowrap}
.logo-ic{font-size:22px;filter:drop-shadow(0 2px 6px rgba(255,122,26,.5))}
.logo-tx{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.hdr-actions{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.hdr-hamb{display:none;font-size:20px;width:38px;height:38px;border-radius:50%;background:var(--glass);border:1px solid var(--glass-line);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
/* ناوبری دسکتاپ در هدر (موبایل ناوبری پایین را دارد) */
.hdr-nav{display:none;align-items:center;gap:2px;margin-inline-start:6px}
.hdr-nav a{padding:8px 12px;border-radius:999px;font-size:14px;font-weight:700;color:var(--tx2);white-space:nowrap}
.hdr-nav a:hover{color:var(--tx)}
.hdr-nav a.on{color:var(--acc2);background:var(--acc-soft);box-shadow:inset 0 0 0 1px rgba(255,122,26,.35)}
@media (min-width:601px){.hdr-nav{display:flex}}
.user-chip{display:flex;align-items:center;gap:8px;background:var(--glass);border:1px solid var(--glass-line);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-radius:999px;padding:4px 12px 4px 5px;font-size:13px;cursor:pointer}
.user-chip:hover{border-color:var(--acc)}
.wallet-chip{padding:4px 12px;background:var(--acc-soft);border-color:rgba(255,122,26,.35);color:var(--acc2);font-weight:800}
.avatar{width:30px;height:30px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#10131a;flex:none}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--glass);border:1px solid var(--glass-line);color:var(--tx2);white-space:nowrap}
.badge.live{background:rgba(255,59,92,.16);border-color:rgba(255,59,92,.5);color:#ff8aa0}
.badge.live:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--live);box-shadow:0 0 0 3px rgba(255,59,92,.25);animation:pulse 1.4s infinite}
.badge.acc{background:var(--acc-soft);border-color:rgba(255,122,26,.4);color:var(--acc2)}
.badge.gold{background:rgba(255,197,61,.12);border-color:rgba(255,197,61,.4);color:var(--warn)}
.badge.red{background:rgba(255,84,112,.12);border-color:rgba(255,84,112,.4);color:var(--err)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:999px;padding:11px 20px;font-size:14px;font-weight:800;transition:transform .12s,filter .15s,background .15s,border-color .15s;border:1px solid transparent}
.btn:active{transform:scale(.96)}
.btn-primary{background:var(--grad);color:#14100a;box-shadow:0 6px 22px rgba(255,122,26,.35),inset 0 1px 0 rgba(255,255,255,.35)}
.btn-primary:hover{filter:brightness(1.08)}
.btn-ghost{background:var(--glass);border-color:var(--glass-line);color:var(--tx);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.btn-ghost:hover{border-color:rgba(255,122,26,.6);color:var(--acc2);background:var(--glass-2)}
.btn-white{background:rgba(255,255,255,.94);color:#0b0e14;box-shadow:0 8px 26px rgba(0,0,0,.45)}
.btn-white:hover{background:#fff}
.btn-danger{background:rgba(255,84,112,.12);border-color:rgba(255,84,112,.4);color:var(--err)}
.btn-tg{background:#229ed9;color:#fff}
.btn-sm{padding:7px 13px;font-size:12.5px;border-radius:999px}
.btn-lg{padding:14px 26px;font-size:15px}
.btn-block{width:100%}
.btn:disabled{opacity:.5;cursor:not-allowed}

.bnav{position:fixed;bottom:0;right:0;left:0;z-index:50;display:none;align-items:stretch;justify-content:space-around;background:rgba(11,14,20,.72);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-top:1px solid var(--glass-line);padding-bottom:env(safe-area-inset-bottom)}
.bnav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0 6px;font-size:11px;color:var(--tx3);position:relative}
.bnav a .ic{font-size:20px;transition:transform .15s}
.bnav a.on{color:var(--acc2)}
.bnav a.on .ic{filter:drop-shadow(0 2px 8px rgba(255,122,26,.6));transform:translateY(-1px)}
.bnav a.on:after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:26px;height:3px;border-radius:0 0 4px 4px;background:var(--grad)}
main{min-height:calc(100vh - var(--hdr-h));min-height:calc(100dvh - var(--hdr-h));padding:20px 18px 90px;max-width:var(--content-w);margin:0 auto}

.hero-wrap{position:relative;border-radius:var(--rad);overflow:hidden;margin-bottom:26px;background:#0a0d14;direction:rtl;border:1px solid var(--glass-line);box-shadow:var(--shadow)}
.hero-track{display:flex;direction:ltr;width:100%;transition:transform .55s ease}
.hero-slide{position:relative;flex:0 0 100%;width:100%;min-width:100%;max-width:100%;min-height:340px;display:flex;align-items:flex-end;overflow:hidden;direction:rtl}
.hero-blur{position:absolute;inset:-28px;background-size:cover;background-position:center;filter:blur(24px) brightness(.32) saturate(1.05)}
.hero-poster{position:absolute;inset:0;background-size:contain;background-position:center;background-repeat:no-repeat;z-index:1}
.hero-in{position:relative;z-index:2;padding:26px 26px 34px;width:100%;display:flex;flex-direction:column;gap:10px;background:linear-gradient(180deg,transparent 0%,rgba(11,14,20,.55) 38%,rgba(11,14,20,.94) 100%)}
.hero-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:6px;z-index:3}
.hero-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.35);border:0;padding:0;cursor:pointer;transition:width .2s}
.hero-dot.on{background:var(--acc);width:20px;border-radius:999px}
.hero-title{font-size:26px;font-weight:900;line-height:1.35;text-shadow:0 2px 14px rgba(0,0,0,.5)}
.hero-meta{display:flex;flex-wrap:wrap;gap:8px}
.hero-desc{color:var(--tx2);font-size:14px;max-width:640px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hero-btns{display:flex;gap:10px;margin-top:6px;flex-wrap:wrap}

.row{margin-bottom:26px}
.row-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
.row-h h3{font-size:17px;font-weight:800;display:flex;align-items:center;gap:8px}
.row-h a{font-size:12.5px;color:var(--tx3)}
.row-live h3:before{content:'';width:8px;height:8px;border-radius:50%;background:var(--live);box-shadow:0 0 0 4px rgba(255,59,92,.22);animation:pulse 1.4s infinite}
.hscroll{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 10px;scroll-snap-type:x mandatory}
.hscroll::-webkit-scrollbar{height:6px}
.card{flex:none;width:150px;scroll-snap-align:start;cursor:pointer;background:var(--glass);border-radius:var(--rad);overflow:hidden;border:1px solid var(--glass-line);transition:transform .16s,border-color .16s,box-shadow .16s}
.card:hover{transform:translateY(-4px);border-color:rgba(255,122,26,.55);box-shadow:0 10px 26px rgba(0,0,0,.45)}
.card-live{position:absolute;top:8px;right:8px;z-index:2;display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px;background:rgba(255,59,92,.85);color:#fff;backdrop-filter:blur(6px);box-shadow:0 4px 12px rgba(255,59,92,.4)}
.card-live:before{content:'';width:5px;height:5px;border-radius:50%;background:#fff;animation:pulse 1.4s infinite}
.card-p{position:relative;aspect-ratio:2/3;background-size:cover;background-position:center top;background-color:var(--card2)}
.card-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:900;background:linear-gradient(160deg,#1c2333,#121722);color:#333d52}
.card-p .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:900;color:#39445c}
.card-ov{position:absolute;inset:0;background:rgba(8,10,15,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s}
.card:hover .card-ov{opacity:1}
.card-ov span{width:48px;height:48px;border-radius:50%;background:var(--grad);color:#14100a;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 6px 20px rgba(255,122,26,.5)}
.card-b1{position:absolute;top:8px;right:8px}
.card-b2{position:absolute;bottom:8px;left:8px}
.card-t{padding:9px 10px 3px;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-m{padding:0 10px 10px;font-size:11.5px;color:var(--tx3);display:flex;gap:6px;align-items:center}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.grid .card{width:auto}

.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;align-items:center}
.chip{padding:7px 15px;border-radius:999px;background:var(--glass);border:1px solid var(--glass-line);font-size:13px;font-weight:600;color:var(--tx2);cursor:pointer;transition:all .15s;white-space:nowrap}
.chip:hover{border-color:var(--acc);color:var(--acc2)}
.chip.on{background:var(--acc-soft);border-color:var(--acc);color:var(--acc2)}
.fselect{width:auto;min-width:130px;padding:7px 12px;border-radius:999px;font-size:13px;cursor:pointer}

.detail{display:grid;grid-template-columns:280px 1fr;gap:26px;align-items:start}
/* ═══ صفحهٔ فیلم/سریال — سبک نماوا: بنر تمام‌عرض + عنوان وسط + اطلاعات ═══ */
.dhero{position:relative;overflow:hidden;background:#07090d;min-height:460px;display:flex;align-items:flex-end;isolation:isolate}
.dhero-bg{position:absolute;inset:-40px;z-index:0;background-size:cover;background-position:center 20%;filter:blur(34px) brightness(.38) saturate(1.25);transform:scale(1.08)}
.dhero-img{display:none;position:absolute;inset:0;z-index:1;background-size:cover;background-position:center top;background-repeat:no-repeat}
.dhero-fade{position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,rgba(7,9,13,.45) 0%,rgba(7,9,13,0) 22%,rgba(7,9,13,0) 42%,rgba(7,9,13,.82) 68%,#07090d 100%)}
.dhero-in{position:relative;z-index:3;width:100%;max-width:var(--content-w);margin:0 auto;padding:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 26px) 18px 26px;display:grid;grid-template-columns:270px 1fr;gap:30px;align-items:end}
.d-poster{position:relative;border-radius:var(--rad);overflow:hidden;aspect-ratio:2/3;background:var(--card);border:1px solid var(--glass-line-2);box-shadow:0 24px 60px rgba(0,0,0,.6)}
.d-poster img,.d-poster .dp-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background-size:cover;background-position:center top}
.d-lock{position:absolute;inset:0;background:rgba(8,10,15,.78);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;text-align:center}
.d-lock .ic{font-size:40px}
.d-head{display:flex;flex-direction:column;gap:12px;min-width:0}
.d-title{font-size:32px;font-weight:900;line-height:1.35;text-shadow:0 2px 18px rgba(0,0,0,.6);margin:0}
.d-title-en{font-size:14px;font-weight:700;color:var(--tx2);direction:ltr;text-align:right;letter-spacing:.02em;margin-top:-6px}
.d-meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-weight:800;font-size:13.5px;color:#e8edf7}
.dm{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dm-age{padding:1px 9px;border-radius:999px;border:1.5px solid rgba(255,255,255,.55);font-size:12px;letter-spacing:.02em;direction:ltr}
.dm-imdb{gap:7px;direction:ltr;unicode-bidi:isolate;background:#f5c518;color:#171409;border-radius:7px;padding:3px 9px;font-weight:900;white-space:nowrap}
.dm-imdb b{font-size:11px;font-weight:900;color:inherit;border-right:1px solid #17140940;padding-right:7px;line-height:1.7}
.dm-live{color:#ff8aa0;background:rgba(255,59,92,.16);border:1px solid rgba(255,59,92,.5);border-radius:999px;padding:2px 10px 2px 8px;font-size:12px}
.dm-live:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--live);box-shadow:0 0 0 3px rgba(255,59,92,.25);animation:pulse 1.4s infinite}
.d-genres{display:flex;flex-wrap:wrap;gap:6px}
.dg{padding:4px 11px;border-radius:999px;font-size:12px;font-weight:800;background:var(--glass);border:1px solid var(--glass-line);color:var(--tx2)}
.dg:hover{color:var(--tx);border-color:var(--glass-line-2)}
.d-cta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:4px}
.d-cta .btn-lg{min-width:190px}
.d-cta .btn-ico{width:46px;height:46px;padding:0;border-radius:50%;font-size:18px}
.d-desc{color:var(--tx2);font-size:14.5px;max-width:720px;white-space:pre-line;line-height:1.9;margin:0}
.d-desc.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
.d-more{align-self:flex-start;font-size:12.5px;font-weight:800;color:var(--acc2);padding:2px 0}
.d-body{max-width:var(--content-w);margin:0 auto;padding:6px 18px 90px}
.d-sec{margin:0 0 26px}
.d-sec-h{font-size:17px;font-weight:900;margin:22px 0 12px;display:flex;align-items:center;gap:8px}
.d-sec-h small{font-size:12px;color:var(--tx3);font-weight:700}
/* کارت اطلاعات (دسته‌بندی/کشور/صدا/زیرنویس) — مثل نماوا: آیکن راست، متن چپ */
.d-info-card{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);overflow:hidden}
.d-info-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--glass-line);font-size:13.5px}
.d-info-row:last-child{border-bottom:0}
.d-info-row .ic{flex:none;width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid var(--glass-line);display:flex;align-items:center;justify-content:center;font-size:16px}
.d-info-row .k{color:var(--tx3);font-weight:700;white-space:nowrap}
.d-info-row .k:after{content:':';margin-inline-start:2px}
.d-info-row .v{color:var(--tx);font-weight:700;min-width:0;overflow-wrap:anywhere}
.d-info-row .v.live{color:#ff8aa0}
/* بازیگران و عوامل — دایره‌ها با اسکرول افقی */
.people{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 12px;scroll-snap-type:x proximity;scrollbar-width:thin}
.person{flex:none;width:92px;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;scroll-snap-align:start}
.person .av{width:76px;height:76px;border-radius:50%;background:linear-gradient(160deg,#1f2735,#121722);border:1px solid var(--glass-line-2);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;color:#b9c3d6;box-shadow:inset 0 0 0 4px rgba(255,255,255,.03),0 8px 22px rgba(0,0,0,.4)}
.person:nth-child(5n+1) .av{background:linear-gradient(160deg,#3a2a1f,#151a24);color:#ffb01f}
.person:nth-child(5n+2) .av{background:linear-gradient(160deg,#1f2c3a,#151a24);color:#7dd3fc}
.person:nth-child(5n+3) .av{background:linear-gradient(160deg,#2a1f3a,#151a24);color:#c4b5fd}
.person:nth-child(5n+4) .av{background:linear-gradient(160deg,#1f3a2c,#151a24);color:#86efac}
.person b{font-size:12px;font-weight:800;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.person span{font-size:11px;color:var(--tx3);font-weight:700}
/* سازگاری با کد قدیمی */
.d-info h1{font-size:24px;font-weight:900;margin-bottom:8px;line-height:1.4}
.d-meta{margin-bottom:14px}
.d-facts{display:flex;flex-wrap:wrap;align-items:center;gap:2px 0;margin:2px 0 10px;font-weight:800;font-size:13.5px;line-height:1.85}
.df-sep{color:#4b5568;font-style:normal;font-weight:700;margin:0 7px;opacity:.85}
.df-type{color:#ff7a1a}
.df-year{color:#e8edf7}
.df-dur{color:#7dd3fc}
.df-country{color:#86efac}
.df-age{color:#fbbf24}
.df-net{color:#c4b5fd}
.df-imdb{color:#f5c518;background:rgba(245,197,24,.12);border:1px solid rgba(245,197,24,.38);border-radius:8px;padding:1px 8px;font-weight:900;letter-spacing:.02em}
.df-views{color:#94a3b8}
.d-people{color:var(--tx2);font-size:13.5px;margin:0 0 8px;line-height:1.75}
.d-people b{color:#dbe4f0;font-weight:800;margin-inline-end:4px}
.d-flags{display:flex;flex-wrap:wrap;align-items:center;gap:2px 0;margin:0 0 12px;font-size:12.5px;font-weight:800}
.df-dub{color:#34d399}
.df-sub{color:#60a5fa}
.d-actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.gallery-section{margin:20px 0 24px}
.d-body .gallery-section{display:none}
.gallery-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.gallery-head h2{font-size:16px;font-weight:800}
.gallery-head a{font-size:12px;color:var(--acc2)}
.gallery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.gallery-thumb{display:flex;align-items:center;justify-content:center;aspect-ratio:16/10;min-width:0;overflow:hidden;border-radius:12px;border:1px solid var(--line);background:var(--card);padding:0}
button.gallery-thumb{cursor:zoom-in}
button.gallery-thumb:focus-visible{outline:2px solid var(--acc2);outline-offset:3px}
.gallery-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.gallery-missing{font-size:12px;color:var(--tx3);padding:12px;text-align:center}
.gallery-lightbox img{display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:8px}
.gallery-lightbox p{font-size:13px;color:var(--tx2);text-align:center;margin-top:12px}
.gallery-help{font-size:12px;color:var(--tx3);line-height:1.8;margin-bottom:12px}
.gallery-editor .gallery-grid{margin-top:10px}
.gallery-grid--posters .gallery-thumb{aspect-ratio:2/3}
.gallery-grid--posters .gallery-thumb img{object-fit:contain}
.dp-carousel{position:absolute;inset:0;overflow:hidden;background:var(--card);direction:ltr}
.dp-track{display:flex;height:100%;transition:transform .35s ease}
.dp-slide{position:relative;flex:0 0 100%;min-width:100%;height:100%;overflow:hidden;background:var(--card);padding:0;border:0}
button.dp-slide{cursor:zoom-in}
.dp-slide img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top}
.dp-missing{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--tx3);padding:12px;text-align:center}
.dp-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(8,10,15,.62);color:#fff;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px)}
.dp-nav:hover{background:rgba(255,122,26,.85);border-color:transparent}
.dp-prev{right:8px}
.dp-next{left:8px}
.dp-dots{position:absolute;bottom:10px;left:0;right:0;z-index:3;display:flex;justify-content:center;gap:6px;pointer-events:none}
.dp-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.4);border:0;padding:0}
.dp-dot.on{background:#fff;width:18px;border-radius:999px}
.dp-count{position:absolute;top:8px;left:8px;z-index:3;font-size:11.5px;font-weight:800;color:#fff;background:rgba(8,10,15,.62);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:2px 9px;backdrop-filter:blur(6px)}
.dp-src{position:absolute;top:8px;right:8px;z-index:3;font-size:11px;font-weight:700;color:#ffd9ad;background:rgba(8,10,15,.62);border:1px solid rgba(255,176,31,.35);border-radius:999px;padding:2px 9px;text-decoration:none;backdrop-filter:blur(6px)}
.dp-src:hover{color:#fff;border-color:var(--acc2)}
.eps{display:flex;flex-direction:column;gap:8px;max-width:720px}
.ep{display:flex;align-items:center;gap:12px;background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad-s);padding:11px 14px;cursor:pointer;transition:border .15s,background .15s,transform .12s}
.ep:hover{border-color:rgba(255,122,26,.6);background:var(--glass-2)}
.ep:active{transform:scale(.99)}
.ep-n{flex:none;width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid var(--glass-line);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:var(--acc2)}
.ep-t{flex:1;font-size:14px;font-weight:600}
.ep-s{font-size:12px;color:var(--tx3);white-space:nowrap}
.ep .go{color:var(--acc2);font-size:18px}
.note{background:var(--glass);border:1px dashed var(--glass-line-2);border-radius:var(--rad-s);padding:12px 14px;font-size:13px;color:var(--tx2);margin-bottom:16px}

.auth{max-width:440px;margin:4vh auto 0}
.auth-card{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:26px;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);box-shadow:var(--shadow)}
.auth-card h2{font-size:20px;font-weight:900;margin-bottom:4px}
.auth-sub{color:var(--tx3);font-size:13px;margin-bottom:18px}
.tg-login{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:#229ed9;color:#fff;border-radius:var(--rad-s);padding:14px;font-weight:700}
.tg-login:hover{filter:brightness(1.1)}
.auth-or{display:flex;align-items:center;gap:10px;color:var(--tx3);font-size:12px;margin:14px 0}
.auth-or:before,.auth-or:after{content:'';flex:1;height:1px;background:var(--line)}
.auth-way{border:1px solid var(--line);border-radius:var(--rad-s);padding:14px;margin:0 0 12px;background:var(--bg2)}
.auth-way h3{font-size:14px;font-weight:800;margin:0 0 4px}
.auth-way p{font-size:12px;color:var(--tx3);margin:0 0 10px;line-height:1.65}
.auth-way.on{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.auth-way .tg-login{margin:0}
.auth-way .steps{margin:8px 0 12px}
#tg-widget-box{min-height:40px;display:flex;justify-content:center;align-items:center;margin:4px 0 8px}
.steps{display:flex;flex-direction:column;gap:8px;margin:16px 0;font-size:13px;color:var(--tx2)}
.steps b{color:var(--tx)}
.fmsg{font-size:13px;margin-top:10px;min-height:18px}
.fmsg.err{color:var(--err)}
.fmsg.ok{color:var(--ok)}
.poll-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-left:6px;animation:pulse 1.2s infinite;flex:none}
@keyframes pulse{50%{opacity:.3}}
.login-wait{position:fixed;top:calc(var(--hdr-h) + 8px);left:12px;right:12px;margin:0 auto;max-width:560px;z-index:90;background:#163325;color:#3ddc84;border:1px solid rgba(61,220,132,.4);border-radius:12px;padding:12px 14px;font-size:13.5px;font-weight:800;display:none;align-items:center;gap:10px;box-shadow:0 10px 28px rgba(0,0,0,.4)}

.acc{max-width:560px;margin:0 auto}
.acc-card{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:24px;text-align:center;margin-bottom:14px;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.acc-avatar{width:74px;height:74px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;color:#14100a;margin:0 auto 12px;overflow:hidden;object-fit:cover}
.acc-name{font-size:19px;font-weight:800}
.acc-mail{color:var(--tx3);font-size:13px}
.acc-rows{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);overflow:hidden;margin-bottom:14px}
.acc-row{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;font-size:14px;border-bottom:1px solid var(--glass-line);gap:10px}
.acc-row:last-child{border-bottom:none}
.acc-row .v{color:var(--tx2);font-size:13px;text-align:left}

.wal-hero{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:22px;text-align:center;margin-bottom:16px;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);box-shadow:var(--shadow)}
.wal-hero .n{font-size:36px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.wal-hero .u{color:var(--tx3);font-size:13px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.plan{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:16px;display:flex;flex-direction:column;gap:6px;transition:border-color .15s,transform .15s}
.plan:hover{border-color:rgba(255,122,26,.5);transform:translateY(-2px)}
.plan h4{font-size:15px;font-weight:800}
.plan .pr{font-size:22px;font-weight:900;color:var(--acc2)}
.plan .ds{font-size:12px;color:var(--tx3);flex:1}
.packs{display:flex;flex-direction:column;gap:8px}
.pack{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad-s);padding:12px 14px}
.shop-more-btn{margin-top:8px}
.k2k-amt{font-size:26px;font-weight:800;letter-spacing:.5px;direction:ltr;text-align:center;margin:8px 0 4px}
.k2k-num{font-family:ui-monospace,Tahoma,sans-serif;direction:ltr;letter-spacing:2px;font-size:18px;font-weight:700;text-align:center;padding:10px;background:var(--bg);border-radius:10px;border:1px dashed var(--line)}
.k2k-timer{text-align:center;color:var(--warn);font-weight:700;margin-top:8px}
.k2k-st{text-align:center;font-size:13px;color:var(--tx3);margin-top:6px}
.k2k-gate{position:fixed;inset:0;z-index:180;background:#eef1f7;color:#1c2434;overflow:auto}
.k2k-gbar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#1b2a4a;color:#fff;z-index:2}
.k2k-gbar b{flex:1;text-align:center;font-size:14px;font-weight:700}
.k2k-back{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.12);color:#fff;font-size:22px;line-height:1}
.k2k-body{max-width:430px;margin:0 auto;padding:16px 16px 48px}
.k2k-guide{background:#fff;border-radius:22px;padding:28px 22px;text-align:center;box-shadow:0 10px 40px rgba(16,24,40,.06)}
.k2k-q{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;background:#2f6bff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800}
.k2k-guide h3{font-size:20px;font-weight:800;margin-bottom:18px}
.k2k-step{display:flex;gap:12px;text-align:right;margin:14px 0;align-items:flex-start}
.k2k-step span{width:28px;height:28px;border-radius:50%;background:#e8efff;color:#2f6bff;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none;font-size:13px}
.k2k-step b{display:block;font-size:14px}
.k2k-step p{font-size:12.5px;color:#667085;margin-top:4px;line-height:1.7}
.k2k-go{margin-top:18px;width:100%;background:#2f6bff;color:#fff;border-radius:14px;padding:14px;font-weight:800;font-size:15px}
.k2k-go:disabled{opacity:.6}
.k2k-row{display:flex;gap:10px;align-items:stretch;margin-bottom:8px}
.k2k-visa{flex:1.45;background:linear-gradient(160deg,#163a73,#2f6fd6 55%,#4b8dff);border-radius:20px;padding:18px 16px;color:#fff;min-height:168px;box-shadow:0 16px 40px rgba(24,64,140,.35);display:flex;flex-direction:column}
.k2k-chip{width:34px;height:24px;border-radius:5px;background:linear-gradient(180deg,#f5d76e,#c9a227);margin-bottom:10px}
.k2k-visa .who{font-size:14px;font-weight:700;margin-bottom:14px}
.k2k-visa .nums{display:flex;justify-content:space-between;direction:ltr;font-size:15px;font-weight:800;letter-spacing:.5px}
.k2k-visa .bank{margin-top:auto;padding-top:14px;font-size:12px;opacity:.92}
.k2k-side{flex:.9;display:flex;flex-direction:column;gap:10px}
.k2k-pill{background:#fff;border-radius:16px;padding:12px;box-shadow:0 4px 16px rgba(16,24,40,.05);flex:1}
.k2k-live{display:flex;align-items:center;gap:7px;color:#128a4b;font-weight:800;font-size:13px}
.k2k-dot{width:8px;height:8px;border-radius:50%;background:#22c55e}
.k2k-sub{font-size:12px;color:#667085;font-weight:600;margin-top:6px;line-height:1.6}
.k2k-clock{font-size:24px;font-weight:800;color:#128a4b;direction:ltr;text-align:center}
.k2k-bar{height:6px;background:#e6f6ec;border-radius:99px;overflow:hidden;margin-top:8px}
.k2k-bar > i{display:block;height:100%;background:#22c55e;width:100%;border-radius:99px}
.k2k-exact{margin:10px 0 12px;padding:10px 12px;border-radius:12px;background:rgba(255,176,31,.12);border:1px solid rgba(255,176,31,.35);font-size:13px;line-height:1.7;font-weight:700}
.pay-wait td{background:rgba(255,176,31,.06)}
.k2k-amtbox{background:#fff;border-radius:18px;padding:16px;margin:10px 0;box-shadow:0 4px 16px rgba(16,24,40,.05)}
.k2k-line{display:flex;align-items:center;gap:8px;margin-top:10px}
.k2k-line .val{flex:1;background:#f4f6fb;border-radius:12px;padding:12px;font-weight:800;direction:ltr;text-align:center;font-size:16px;letter-spacing:.4px}
.k2k-copy{flex:none;background:#2f6bff;color:#fff;border-radius:12px;padding:12px 14px;font-weight:800;font-size:13px;white-space:nowrap}
.k2k-copy.on{background:#128a4b}
.k2k-amtbox .lbl{font-size:12.5px;color:#667085;font-weight:700}
.k2k-amtbox .big{font-size:30px;font-weight:800;direction:ltr;text-align:center;margin:4px 0 2px}
.k2k-amtbox .rial{font-size:12px;color:#98a2b3;text-align:center}
.k2k-ok{text-align:center;padding:48px 16px}
.k2k-ok .ck{width:72px;height:72px;margin:0 auto 14px;border-radius:50%;background:#22c55e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:34px}
.k2k-track{margin-top:12px;background:#fff;border-radius:18px;padding:16px;box-shadow:0 4px 16px rgba(16,24,40,.05)}
.k2k-track label{display:block;font-size:13px;font-weight:800;margin-bottom:8px;color:#1c2434}
.k2k-gate input,.k2k-gate select,.k2k-gate textarea{color:#111;background:#fff;-webkit-text-fill-color:#111;caret-color:#111}
.k2k-track input,.k2k-track select{width:100%;border:1px solid #d9e1ef;border-radius:12px;padding:12px;font-size:18px;letter-spacing:.5px;text-align:center;direction:ltr;font-weight:800;background:#fff;color:#111;-webkit-text-fill-color:#111;caret-color:#111}
.k2k-when{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.k2k-track .k2k-go{margin-top:12px}
.k2k-wait{text-align:center;padding:22px 8px}
.k2k-wait b{display:block;font-size:16px;margin:8px 0 4px}
.k2k-dead .k2k-clock,.k2k-dead .k2k-live{color:#e11d48}
.k2k-dead .k2k-dot{background:#e11d48}
.k2k-dead .k2k-bar > i{background:#e11d48;width:0}
.tx-list{font-size:13px}
.tx-list .acc-row .v{direction:ltr}

.adm{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start}
.adm-nav{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:10px;position:sticky;top:calc(76px + env(safe-area-inset-top,0px));display:flex;flex-direction:column;gap:4px;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.adm-nav button{display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:12px;font-size:14px;font-weight:600;color:var(--tx2);text-align:right}
.adm-nav button:hover{background:var(--glass-2);color:var(--tx)}
.adm-nav button.on{background:var(--acc-soft);color:var(--acc2);box-shadow:inset 0 0 0 1px rgba(255,122,26,.35)}
.adm-pane{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--rad);padding:20px;min-height:300px;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.adm-h{font-size:17px;font-weight:800;margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.adm-box{background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:var(--rad-s);padding:14px;margin-bottom:14px}
.adm-box h4{font-size:13.5px;font-weight:700;color:var(--tx2);margin-bottom:10px}
.adm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.adm-item{display:flex;gap:12px;align-items:center;background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:var(--rad-s);padding:10px;margin-bottom:9px}
.adm-item .th{flex:none;width:44px;height:62px;border-radius:8px;background-size:cover;background-position:center top;background-color:var(--card2)}
.adm-item .th .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#39445c;font-weight:900;font-size:20px}
.adm-item .inf{flex:1;min-width:120px}
.adm-item .inf b{font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.adm-item .inf span{font-size:11.5px;color:var(--tx3);display:flex;gap:8px;flex-wrap:wrap}
.adm-item .acts{display:flex;gap:6px;flex-wrap:wrap}
/* ── مشخصات فایل تبلیغ (برای تبلیغ‌دهنده) ── */
.adspec{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.adspec .c{background:var(--card);border:1px solid var(--line);border-radius:var(--rad-s);padding:12px}
.adspec .c h5{font-size:13px;font-weight:800;margin-bottom:4px}
.adspec .c .dim{font-size:19px;font-weight:900;color:var(--acc2);direction:ltr;text-align:center;padding:6px 0 8px;letter-spacing:.5px}
.adspec .c ul{list-style:none;font-size:12px;color:var(--tx3);line-height:2}
.adspec .c ul b{color:var(--tx2);font-weight:700}
.adchk{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12.5px;color:var(--tx3);line-height:1.7}
.adchk .pv{flex:none;width:34px;height:52px;border-radius:6px;border:1px solid var(--line);background:#0a0d13 center/contain no-repeat}
.adchk .ok{color:var(--ok);font-weight:800}
.adchk .warn{color:var(--warn);font-weight:800}
.adchk .bad{color:var(--err);font-weight:800}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.tbl th{text-align:right;color:var(--tx3);font-size:12px;font-weight:700;padding:9px 10px;border-bottom:1px solid var(--line)}
.tbl td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl .sel{width:auto;min-width:100px;padding:6px 10px}
.log{background:#070a0f;border:1px solid var(--line);border-radius:var(--rad-s);padding:12px;font-size:12.5px;direction:rtl;max-height:280px;overflow:auto;white-space:pre-wrap;font-family:inherit;color:var(--tx2)}
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}
.stat{background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:var(--rad-s);padding:14px;text-align:center}
.stat b{display:block;font-size:22px;font-weight:900;color:var(--acc2)}
.stat span{font-size:12px;color:var(--tx3)}
.field{margin-bottom:13px}
.field label{display:block;font-size:12.5px;color:var(--tx2);margin-bottom:5px;font-weight:600}
.field-hint{font-size:11.5px;color:var(--tx3);margin-top:4px;line-height:1.6}
/* سوییچ iOS */
.sw{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px;font-weight:700;user-select:none}
.sw input{position:absolute;opacity:0;width:0;height:0}
.sw i{width:46px;height:28px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid var(--glass-line);position:relative;transition:background .2s;flex:none}
.sw i:after{content:'';position:absolute;top:2px;inset-inline-start:2px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .2s}
.sw input:checked + i{background:var(--ok);border-color:transparent}
.sw input:checked + i:after{transform:translateX(-18px)}
.sw.live input:checked + i{background:var(--live)}
.airing-box{background:rgba(255,59,92,.06);border:1px solid rgba(255,59,92,.28);border-radius:var(--rad-s);padding:14px;margin-bottom:14px}
.airing-box h4{font-size:13.5px;font-weight:800;color:#ff8aa0;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.airing-fields{display:grid;grid-template-columns:120px 1fr;gap:0 12px;margin-top:10px}
.airing-fields.off{opacity:.45;pointer-events:none}
.year-2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}

.mwrap{position:fixed;inset:0;z-index:400;background:rgba(5,7,10,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .15s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal{background:rgba(21,26,36,.88);border:1px solid var(--glass-line-2);border-radius:22px;width:100%;max-width:var(--modal-w);max-height:92vh;max-height:92dvh;overflow-y:auto;padding:22px;animation:pop .18s;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08)}
.modal.wide{max-width:var(--modal-w-wide)}
@keyframes pop{from{transform:translateY(14px) scale(.98);opacity:0}to{transform:none;opacity:1}}
@keyframes sheetUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.modal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal-h h3{font-size:17px;font-weight:800}
.modal-x{width:32px;height:32px;border-radius:50%;background:var(--glass-2);border:1px solid var(--glass-line);font-size:14px;color:var(--tx2);display:flex;align-items:center;justify-content:center}
.modal-x:hover{color:var(--err)}
.form-2col{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
/* ── لایهٔ تبلیغ تمام‌صفحه ──
   z-index تبلیغ عمداً زیر مودال (400) است تا مودال «حذف تبلیغ‌ها/اشتراک»
   بالای آن خوانا بماند؛ به همین دلیل showAdThen پیش از نمایش تبلیغ،
   مودال انتخاب قسمت/کیفیت را می‌بندد تا کیفیت‌ها روی تبلیغ نیفتند. */
.adx{position:fixed;inset:0;z-index:300;background:#05070a;display:flex;flex-direction:column;animation:fadeIn .18s}
.adx-bar{position:absolute;top:env(safe-area-inset-top,0px);left:0;right:0;height:4px;background:rgba(255,255,255,.12);z-index:4}
.adx-bar i{display:block;height:100%;width:0%;background:var(--grad);transition:width .25s linear;box-shadow:0 0 12px rgba(255,122,26,.7)}
.adx-top{position:relative;z-index:5;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:calc(14px + env(safe-area-inset-top,0px)) 14px 10px;background:linear-gradient(180deg,rgba(5,7,10,.96),rgba(5,7,10,0))}
.adx-sec{display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,.62);border:1px solid var(--line);border-radius:999px;padding:6px 13px;font-size:13px;font-weight:900;color:var(--tx);white-space:nowrap;backdrop-filter:blur(6px)}
.adx-sec b{color:var(--acc2);font-size:14px;min-width:22px;text-align:center;display:inline-block}
.adx-nosub{display:inline-flex;align-items:center;gap:7px;background:var(--grad);color:#fff;border-radius:999px;padding:7px 15px;font-size:13px;font-weight:900;box-shadow:0 6px 20px rgba(255,122,26,.35)}
.adx-nosub:active{transform:scale(.97)}
.adx-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer}
.adx-stage img,.adx-stage video{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block}
.adx-stage.no-link{cursor:default}
.adx-fail{color:var(--tx3);font-size:13.5px;text-align:center;padding:24px}
.adx-cta{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:5;background:var(--grad);color:#fff;font-weight:900;font-size:14px;padding:11px 26px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.6);pointer-events:none;max-width:88%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.adx-foot{position:relative;z-index:5;padding:12px 14px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(5,7,10,.96),rgba(5,7,10,0))}
.adx-go{width:100%;border-radius:var(--rad-s);padding:14px;font-size:15px;font-weight:900;background:var(--bg2);border:1px solid var(--line);color:var(--tx3);display:flex;align-items:center;justify-content:center;gap:8px;cursor:not-allowed}
.adx-go.on{background:var(--grad);color:#fff;border-color:transparent;cursor:pointer;box-shadow:0 8px 26px rgba(255,122,26,.4);animation:pop .2s}
.adx-mute{position:absolute;top:calc(56px + env(safe-area-inset-top,0px));inset-inline-end:14px;z-index:6;width:38px;height:38px;border-radius:50%;background:rgba(0,0,0,.6);border:1px solid var(--line);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
#toasts{position:fixed;bottom:24px;right:50%;transform:translateX(50%);z-index:500;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{background:rgba(26,32,44,.8);border:1px solid var(--glass-line-2);border-radius:999px;padding:10px 20px;font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5);animation:toastIn .2s;max-width:90vw;backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.toast.err{border-color:rgba(255,84,112,.5);color:var(--err)}
.toast.ok{border-color:rgba(61,220,132,.5);color:var(--ok)}
@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}

.empty{text-align:center;padding:60px 20px;color:var(--tx3)}
.empty .ic{font-size:52px;margin-bottom:12px}
.empty h3{color:var(--tx2);font-size:17px;margin-bottom:6px}
.empty p{font-size:13.5px;max-width:460px;margin:0 auto}
.sk{background:linear-gradient(90deg,var(--card) 25%,var(--card2) 50%,var(--card) 75%);background-size:200% 100%;animation:sk 1.2s infinite;border-radius:var(--rad)}
@keyframes sk{to{background-position:-200% 0}}
.spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--acc);animation:spin .8s linear infinite;margin:40px auto}
@keyframes spin{to{transform:rotate(360deg)}}


.dl-box{margin:6px 0 18px;padding:16px 16px 12px;border:1px solid var(--glass-line);border-radius:var(--rad);background:var(--glass);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.dl-box .d-sec-h{margin-top:0}
.seg{display:flex;gap:4px;background:rgba(255,255,255,.06);border:1px solid var(--glass-line);border-radius:999px;padding:4px;margin-bottom:12px;max-width:420px}
.seg-btn{flex:1;border-radius:999px;padding:8px 10px;font-weight:800;font-size:13px;color:var(--tx2);transition:background .15s,color .15s}
.seg-btn.on{background:rgba(255,255,255,.14);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.12)}
.q-row{display:flex;flex-wrap:wrap;gap:8px;max-width:560px;margin-bottom:8px}
.q-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 10px;min-width:108px;flex:1;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);font-weight:800;font-size:13px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.q-btn span{font-weight:600;font-size:10px;color:var(--tx3)}
.q-btn.off{opacity:.35;cursor:not-allowed}
.q-btn.lock{border-color:rgba(255,176,31,.55);box-shadow:inset 0 0 0 1px rgba(255,176,31,.22)}
.q-btn.lock span{color:var(--acc2)}
.q-btn:not(.off):hover{border-color:var(--acc);background:var(--acc-soft)}
.q-btn.on{border-color:var(--acc);background:var(--acc-soft);box-shadow:0 0 0 3px var(--acc-soft)}
.season-bar{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;margin:0 0 4px;scrollbar-width:thin}
.season-chip{flex:none;display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:999px;background:var(--glass);border:1px solid var(--glass-line);font-weight:800;font-size:13px;white-space:nowrap;transition:background .15s}
.season-chip.on{background:var(--grad);color:#fff;border-color:transparent;box-shadow:0 6px 18px rgba(255,122,26,.35)}
.season-chip .live-dot{width:7px;height:7px;border-radius:50%;background:var(--live);box-shadow:0 0 0 3px rgba(255,59,92,.25);animation:pulse 1.4s infinite}
.season-chip.on .live-dot{background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.3)}
.var-block{margin:10px 0 14px;padding:10px;border:1px dashed var(--line);border-radius:var(--rad-s)}
.var-block h5{font-size:13px;margin-bottom:8px}
.var-row{display:grid;grid-template-columns:64px 1fr auto auto;gap:8px;align-items:center;margin-bottom:6px}
.var-row input{min-width:0}
.var-row-lab{grid-template-columns:1fr auto auto}
.var-q{margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed var(--line)}
.var-q:last-child{border-bottom:0}
.var-extra{display:grid;grid-template-columns:minmax(100px,160px) 1fr auto auto;gap:8px;align-items:center;margin:6px 0}
.var-add{margin:4px 0 8px}
.var-newq{grid-template-columns:minmax(120px,1fr) auto}
.q-alts{display:flex;flex-direction:column;gap:6px;margin:8px 0 12px;max-width:560px}
.q-alt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-weight:700;font-size:13.5px;text-align:right}
.q-alt .go{color:var(--acc2)}
.star-btn{min-width:40px;opacity:.38;font-size:15px;padding:6px 8px}
.star-btn.on{opacity:1;filter:drop-shadow(0 0 6px rgba(255,176,31,.75))}
.ep-star{min-width:40px;opacity:.38;font-size:15px}
.ep-star.on{opacity:1;filter:drop-shadow(0 0 6px rgba(255,176,31,.75))}

.card-imdb{position:absolute;top:8px;left:8px;z-index:2;background:rgba(8,10,15,.82);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:4px 7px;text-align:center;line-height:1.15;min-width:42px}
.card-imdb b{display:block;font-size:13px;font-weight:900}
.card-imdb i{display:block;font-style:normal;font-size:9px;font-weight:800;color:#f5c518;letter-spacing:.04em}
.pro-search{display:grid;grid-template-columns:150px 1fr;gap:16px;background:var(--glass);border:1px solid var(--glass-line);border-radius:22px;padding:16px;margin:0 0 22px;box-shadow:var(--shadow);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.pro-side{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:8px 10px;border-inline-end:1px solid var(--line);text-align:center}
.pro-ico{width:64px;height:64px;border-radius:20px;background:var(--glass-2);border:1px solid var(--glass-line);display:flex;align-items:center;justify-content:center;font-size:28px}
.pro-side b{font-size:13.5px;color:var(--acc2);font-weight:900}
.pro-side span{font-size:11px;color:var(--tx3)}
.pro-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px;align-items:end}
.ps-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.ps-field>label{font-size:12px;color:var(--tx3);font-weight:800}
.ps-field input,.ps-field select{width:100%;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--glass-line);padding:9px 14px;font-size:13px}
.ps-types{display:flex;gap:8px}
.ps-types button{flex:1;border-radius:999px;padding:9px 8px;background:rgba(255,255,255,.05);border:1px solid var(--glass-line);font-weight:800;font-size:13px;color:var(--tx2)}
.ps-types button.on{background:var(--grad);color:#14100a;border-color:transparent}
.ps-toggles{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ps-tog{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--glass-line);font-size:12.5px;font-weight:700;color:var(--tx2);cursor:pointer}
.ps-tog.live.on{border-color:rgba(255,59,92,.6);color:#ff8aa0;background:rgba(255,59,92,.14)}
.ps-tog.on{border-color:var(--acc);color:var(--acc2);background:var(--acc-soft)}
.ps-searchrow{display:flex;gap:8px;grid-column:1/-1}
.ps-searchrow input{flex:1;border-radius:999px;padding:12px 16px;background:rgba(255,255,255,.05);border:1px solid var(--glass-line)}
.ps-range{grid-column:span 1}
.ps-range-h{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;color:var(--tx3);margin-bottom:2px}
.ps-range-h b{color:var(--tx);font-variant-numeric:tabular-nums}
.ps-multi .ps-check-list{display:flex;flex-wrap:wrap;gap:6px;max-height:128px;overflow:auto;padding:8px;background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:14px}
.ps-check-list.is-empty{min-height:40px;align-items:center}
.ps-none{font-size:12px;color:var(--tx3);padding:4px 6px}
.ps-chk{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.05);border:1px solid var(--glass-line);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;color:var(--tx2);user-select:none}
.ps-chk input{width:auto;margin:0;accent-color:var(--acc);flex:none}
.ps-chk.on{border-color:var(--acc);background:var(--acc-soft);color:var(--acc2)}
.ps-dual{position:relative;height:40px;direction:ltr}
.ps-track{position:absolute;left:0;right:0;top:50%;height:6px;background:#2a3140;border-radius:99px;transform:translateY(-50%)}
.ps-fill{position:absolute;height:100%;background:var(--acc);border-radius:99px}
.ps-dual input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;pointer-events:none;position:absolute;inset:0;width:100%;height:40px;margin:0;padding:0}
.ps-dual input[type=range]::-webkit-slider-runnable-track{height:6px;background:transparent;border:none}
.ps-dual input[type=range]::-moz-range-track{height:6px;background:transparent;border:none}
.ps-dual input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;pointer-events:auto;width:18px;height:18px;margin-top:-6px;background:var(--acc);border:3px solid #fff;border-radius:50%;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.45)}
.ps-dual input[type=range]::-moz-range-thumb{pointer-events:auto;width:18px;height:18px;background:var(--acc);border:3px solid #fff;border-radius:50%;cursor:pointer}
.pro-count{font-size:13px;color:var(--tx3);margin:-8px 0 14px}

.share-box{display:flex;gap:8px;align-items:stretch;margin-bottom:14px}
.share-box input{flex:1;min-width:0;direction:ltr;text-align:left;font-size:12px;padding:10px 12px}
.share-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.share-app{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 6px;border-radius:14px;background:var(--glass);border:1px solid var(--glass-line);font-size:12px;font-weight:800;color:var(--tx)}
.share-app:hover{border-color:var(--acc);background:var(--acc-soft)}
.share-app span{font-size:22px;line-height:1}
/* ── چیدمان ریسپانسیو: قوانین زیر فقط در عرض‌های کوچک (موبایل/تبلت) ── */
@media (max-width:820px){
  .pro-search{grid-template-columns:1fr}
  .pro-side{flex-direction:row;justify-content:flex-start;border-inline-end:none;border-bottom:1px solid var(--line);padding-bottom:12px}
  .pro-grid{grid-template-columns:1fr 1fr}
}
@media (max-width:520px){
  .pro-grid{grid-template-columns:1fr}
  .ps-range{grid-column:auto}
}
@media (max-width:760px){
  .detail{grid-template-columns:1fr}
  .adm{grid-template-columns:1fr}
  .adm-nav{position:static;flex-direction:row;overflow-x:auto;padding:8px;border-radius:999px}
  .adm-nav button{white-space:nowrap;flex:none;border-radius:999px}
  /* صفحهٔ اثر در موبایل — مثل نماوا: پوستر بزرگ بالا، عنوان و اطلاعات وسط‌چین زیر آن */
  .dhero{min-height:0;display:block}
  .dhero-img{display:block;height:min(72vh,560px);position:relative;inset:auto;background-size:cover;background-position:center top;-webkit-mask-image:linear-gradient(180deg,#000 55%,rgba(0,0,0,.35) 82%,transparent 100%);mask-image:linear-gradient(180deg,#000 55%,rgba(0,0,0,.35) 82%,transparent 100%)}
  .dhero-bg{filter:blur(40px) brightness(.3) saturate(1.3)}
  .dhero-fade{background:linear-gradient(180deg,rgba(7,9,13,.5) 0%,rgba(7,9,13,0) 18%,rgba(7,9,13,0) 50%,rgba(7,9,13,.6) 75%,#07090d 100%)}
  .dhero-in{grid-template-columns:1fr;gap:0;padding:0 16px 22px;margin-top:calc(-1 * min(28vh,220px))}
  .dhero-in .d-poster{display:none}
  .d-head{align-items:center;text-align:center;gap:10px}
  .d-title{font-size:23px}
  .d-title-en{text-align:center;margin-top:-4px}
  .d-meta-row{justify-content:center;font-size:12.5px;gap:6px 10px}
  .d-genres{justify-content:center}
  .d-cta{justify-content:center;width:100%}
  .d-cta .btn-lg{min-width:0;flex:1;max-width:320px}
  .d-desc{text-align:center;font-size:13.5px}
  .d-more{align-self:center}
  .d-body{padding:4px 14px 100px}
  .d-body .gallery-section{display:block}
  .d-info-row{font-size:13px}
  .people{gap:10px}
  .person{width:84px}
  .person .av{width:68px;height:68px;font-size:22px}
}
@media (max-width:600px){
  body{font-size:14px}
  .hdr{padding:env(safe-area-inset-top,0px) 12px 0;gap:10px}
  .hdr-hamb{display:flex;align-items:center;justify-content:center}
  main{padding:14px 12px 100px}
  .bnav{display:flex}
  .hero-slide{min-height:260px}
  .hero-title{font-size:20px}
  .card{width:128px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
  .card-t{font-size:12px}
  .form-2col{grid-template-columns:1fr}
  .airing-fields{grid-template-columns:1fr}
  .d-info h1{font-size:19px}
  .q-row{display:flex}
  .var-row,.var-extra{grid-template-columns:1fr}
  /* مودال در موبایل: شیت پایین صفحه (iOS-like) */
  .mwrap{padding:0;align-items:flex-end}
  .modal{padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0;max-height:94dvh;animation:sheetUp .22s cubic-bezier(.2,.8,.2,1)}
  .modal:before{content:'';display:block;width:42px;height:5px;border-radius:999px;background:rgba(255,255,255,.22);margin:-6px auto 12px}
  .modal.wide{max-width:100%}
  .adm-pane{padding:14px 12px}
  .adm-row input,.adm-row select{min-width:0}
  .adm-item{flex-wrap:wrap}
  .adm-item .acts{width:100%;justify-content:flex-end}
  .tbl{display:block;overflow-x:auto;white-space:nowrap}
  .stat-cards{grid-template-columns:repeat(2,1fr)}
  .adspec{grid-template-columns:1fr}
  .k2k-when{grid-template-columns:1fr}
}

/* Cinematic home banner; preserve portrait artwork without stretching it. */
.hero-slide{height:clamp(400px,39vw,560px);min-height:0;isolation:isolate}
.hero-blur{filter:blur(28px) brightness(.48) saturate(1.1)}
.hero-poster{left:0;right:38%;background-size:contain;background-position:center}
.hero-slide:after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(270deg,#0a0d14 0%,rgba(10,13,20,.92) 30%,rgba(10,13,20,.15) 66%,transparent),linear-gradient(0deg,rgba(10,13,20,.65),transparent 35%);pointer-events:none}
.hero-in{width:55%;align-self:center;padding:40px 42px 52px;background:none;gap:16px}
.hero-title{font-size:clamp(26px,3vw,42px);line-height:1.5;text-wrap:balance}
.hero-desc{line-height:1.9;color:#d1d5df;-webkit-line-clamp:3}
.hero-cta{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.4);color:#fff;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);gap:24px;border-radius:12px;padding:11px 20px}
.hero-cta:hover{background:rgba(255,255,255,.2);border-color:#fff}
.hero-dot{width:24px;height:24px;background:radial-gradient(circle,#ffffff70 3px,transparent 4px)}
.hero-dot.on{width:24px;background:radial-gradient(circle,var(--acc) 5px,transparent 6px)}
.detail-posters{max-width:440px;margin:28px auto}
.detail-posters .dp-carousel{position:relative;inset:auto;width:100%;aspect-ratio:2/3;border-radius:16px}
@media(max-width:640px){
.hero-wrap{border-radius:20px;margin-bottom:24px}
.hero-slide{height:clamp(420px,125vw,580px);min-height:0}
.hero-poster{inset:0;background-position:center top;background-size:contain}
.hero-slide:after{background:linear-gradient(0deg,rgba(7,9,13,.96),rgba(7,9,13,.62) 20%,transparent 52%)}
.hero-in{width:100%;align-self:flex-end;padding:20px 20px 44px;gap:9px}
.hero-title{font-size:23px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hero-desc{display:none}
.hero-meta .badge:nth-child(n+3){display:none}
.hero-meta .badge{font-size:11px;background:rgba(0,0,0,.22)}
.hero-btns{margin-top:3px}
.hero-cta{font-size:13px;padding:9px 16px}
.detail-posters{max-width:360px;width:100%}
}
@media(prefers-reduced-motion:reduce){.hero-track{transition:none}}

</style>
</head>
<body>
<div id="app"><div style="text-align:center;padding-top:40px"><div class="spin"></div><div style="color:var(--tx3);font-size:13px;margin-top:12px">در حال بارگذاری…</div></div></div>
<div id="toasts"></div>
<div id="modal-root"></div>
<script>
(function () {
'use strict';

var MVX_VER = 'v3.50';
/*
 * نکتهٔ معماری: کل این کد داخل یک template-literal در worker.js زندگی می‌کند.
 * لایهٔ template هر بک‌اسلش را مصرف می‌کند، بنابراین در کلاینت هیچ‌وقت
 * بک‌اسلش نمی‌نویسیم: خط‌تجدید با NL، منظم‌ها با new RegExp.
 */
var NL = String.fromCharCode(10);
var APP = { user: null, tg: null, catalog: null, siteName: '@@SITE@@', tagline: '@@TAG@@', economy: { unit: 'سکه', dlClickPrice: 2, plans: {}, botUsername: '' } };
var TG = (window.Telegram && window.Telegram.WebApp) || null;
var TG_READY = false;
var __bootErr = null;
function captureErr (msg) { if (!__bootErr && msg) __bootErr = String(msg); }
window.addEventListener('error', function (e) {
  captureErr((e.message || 'خطای جاوااسکریپت') + ' (خط ' + (e.lineno || '?') + ')');
});
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  captureErr('promise: ' + (r && r.message ? r.message : (r && r.error ? r.error : String(r))));
});

document.addEventListener('click', function (e) {
  try {
    var t = e.target && e.target.closest ? e.target.closest('[data-nav]') : null;
    if (t) {
      var h = t.getAttribute('data-nav');
      if (h) location.hash = h;
    }
  } catch (err) { }
});

function showFatal (msg) {
  try {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<div class="empty" style="padding:60px 20px"><div class="ic">⚠️</div><h3>خطا در بارگذاری</h3>' +
      '<p style="direction:ltr;text-align:center;font-size:12px;margin-top:10px;color:var(--err);word-break:break-all">' + esc(msg) + '</p>' +
      '<div style="margin-top:18px"><button class="btn btn-primary" onclick="location.reload()">🔄 تلاش مجدد</button></div></div>';
  } catch (e2) { }
}

function startWatchdog () {
  setTimeout(function () {
    try {
      var app = document.getElementById('app');
      if (!app || app.innerHTML.indexOf('در حال بارگذاری') < 0) return;
      app.innerHTML = '<div class="empty" style="padding:50px 20px"><div class="ic">⏳</div>' +
        '<h3>صفحه کامل بارگذاری نشد</h3>' +
        '<p style="margin-top:8px">' + (__bootErr ? 'خطای ثبت‌شده: <b style="color:var(--err);direction:ltr;display:inline-block">' + esc(__bootErr) + '</b>' : 'خطایی ثبت نشده — احتمالاً مشکل موقت شبکه است.') + '</p>' +
        '<div id="diag-server" style="margin-top:14px;font-size:13px;color:var(--tx2)">در حال بررسی سرور…</div>' +
        '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn btn-primary" onclick="location.reload()">🔄 تلاش مجدد</button>' +
        '<a class="btn btn-ghost" href="#/auth">صفحهٔ ورود</a></div>' +
        '<div style="margin-top:18px;font-size:11px;color:var(--tx3)">نسخه: ' + MVX_VER + '</div></div>';
      fetch('/api/site').then(function (r) { return r.json(); }).then(function (j) {
        var d = document.getElementById('diag-server');
        if (d) d.innerHTML = '✅ سرور فعال است (<b>' + esc(j.siteName || 'worker') + '</b>) — دوباره تلاش کنید یا کش مرورگر را پاک کنید.';
      }).catch(function (e) {
        var d = document.getElementById('diag-server');
        if (d) d.innerHTML = '❌ ارتباط با سرور برقرار نشد: <span style="direction:ltr">' + esc(String((e && e.message) || e)) + '</span>';
      });
    } catch (e2) { }
  }, 6000);
}

function $ (s, r) { return (r || document).querySelector(s); }
function $all (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function faNum (n) { try { return Number(n).toLocaleString('fa-IR'); } catch (e) { return String(n); } }
function faYear (n) {
  n = parseInt(n, 10);
  if (!n) return '';
  var s = String(n);
  var fa = '۰۱۲۳۴۵۶۷۸۹';
  var out = '';
  var i;
  for (i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    out += (c >= '0' && c <= '9') ? fa.charAt(c.charCodeAt(0) - 48) : c;
  }
  return out;
}
function faMoney (n) {
  n = Number(n) || 0;
  try { return n.toLocaleString('fa-IR', { maximumFractionDigits: 2 }); } catch (e) { return String(n); }
}
function faDate (t) { if (!t) return ''; try { return new Date(t).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; } }
function fmtBytes (b) {
  if (!b) return '';
  var u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
  var i = 0; b = Number(b);
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (b < 10 && i > 0 ? b.toFixed(1) : Math.round(b)) + ' ' + u[i];
}
function unitName () { return (APP.economy && APP.economy.unit) || 'سکه'; }
function sourceHref (src) {
  if (!src) return '';
  if (Array.isArray(src.parts) && src.parts.length) return src.parts.map(sourceHref).join(',');
  if (src.chatId && src.msgId) return 'https://t.me/c/' + String(src.chatId).replace(/^-100/, '') + '/' + src.msgId;
  if (src.user && src.msgId) return 'https://t.me/' + String(src.user).replace(/^@/, '') + '/' + src.msgId;
  var u = src.tmeUrl || '';
  if (u && u.indexOf('t.me//') < 0 && u.indexOf('t.me/') >= 0) return u;
  if (src.directUrl) return src.directUrl;
  return '';
}
function hostOnly (u) {
  u = String(u || '');
  var i = u.indexOf('://');
  if (i >= 0) u = u.slice(i + 3);
  i = u.indexOf('/');
  if (i >= 0) u = u.slice(0, i);
  return u;
}
function hasSub (u) {
  u = u || APP.user;
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'premium') return true;
  return !!(u.subUntil && u.subUntil > Date.now());
}
function getToken () { try { return localStorage.getItem('mvx_t') || ''; } catch (e) { return ''; } }
function setToken (t) { try { t ? localStorage.setItem('mvx_t', t) : localStorage.removeItem('mvx_t'); } catch (e) { } }
function getRef () { try { return sessionStorage.getItem('mvx_ref') || ''; } catch (e) { return ''; } }
function setRef (c) { try { c ? sessionStorage.setItem('mvx_ref', c) : sessionStorage.removeItem('mvx_ref'); } catch (e) { } }

function getTick () { try { return localStorage.getItem('mvx_tick') || ''; } catch (e) { return ''; } }
function setTick (id) { try { id ? localStorage.setItem('mvx_tick', id) : localStorage.removeItem('mvx_tick'); } catch (e) { } }
var __pollTimer = null;
var __burstTimer = null;
var __pollBusy = false;
var __pollAt = 0;
function stopPoll () {
  if (__pollTimer) { clearInterval(__pollTimer); __pollTimer = null; }
  if (__burstTimer) { clearInterval(__burstTimer); __burstTimer = null; }
}
function hideLoginWait () {
  var el = document.getElementById('login-wait');
  if (el) el.style.display = 'none';
}
function showLoginWait () {
  if (getToken() || APP.user || !getTick()) { hideLoginWait(); return; }
  var el = document.getElementById('login-wait');
  if (!el) {
    el = document.createElement('div');
    el.id = 'login-wait';
    el.className = 'login-wait';
    el.innerHTML = '<span class="poll-dot"></span><span>در انتظار تأیید تلگرام؛ ورود را در ربات تأیید کنید.</span>';
    (document.body || document.documentElement).appendChild(el);
  }
  el.style.display = 'flex';
}
function peekLoginTicket (force) {
  if (getToken() || APP.user) { stopPoll(); setTick(''); hideLoginWait(); return; }
  var id = getTick();
  if (!id) { hideLoginWait(); return; }
  showLoginWait();
  var now = Date.now();
  if (__pollBusy) return;
  __pollBusy = true;
  __pollAt = now;
  api('/auth/ticket/' + id + '?t=' + now, { timeout: 8000 }).then(function (t) {
    if (__pollAt === now) __pollBusy = false;
    if (getTick() !== id || APP.user) return;
    if (t && t.status === 'ready' && t.token) {
      stopPoll();
      setTick('');
      hideLoginWait();
      setToken(t.token);
      APP.user = t.user;
      toast('خوش آمدید ' + ((t.user && (t.user.tgName || t.user.username)) || '') + ' ✓', 'ok');
      try { haptic('light'); } catch (eH) { }
      try { render(); } catch (eR) { }
    } else if (t && t.status === 'missing') {
      setTick('');
      stopPoll();
      hideLoginWait();
    }
  }).catch(function (e) {
    if (__pollAt === now) __pollBusy = false;
    if (getTick() !== id || APP.user) return;
    if (e.status === 404) { setTick(''); stopPoll(); hideLoginWait(); toast('لینک ورود منقضی شده؛ دوباره ورود با تلگرام را بزنید.', 'err'); }
  });
}
function burstPeek () {
  if (getToken() || APP.user || !getTick()) return;
  showLoginWait();
  peekLoginTicket(true);

}
var __miniLoginBusy = false;
function loginMiniApp () {
  if (!TG || !TG.initData || APP.user || __miniLoginBusy) return;
  __miniLoginBusy = true;
  return api('/auth/tg', { method: 'POST', body: { initData: TG.initData, existingOnly: true } }).then(function (r) {
    if (r.needsSignup) return;
    if (!r.token || !r.user) throw new Error('ورود مینی‌اپ ناموفق بود');
    setToken(r.token);
    APP.user = r.user;
    stopPoll();
    setTick('');
    hideLoginWait();
    render();
  }).catch(function (e) {
    captureErr('/auth/tg: ' + (e.message || ''));
    toast(e.message || 'ورود مینی‌اپ ناموفق بود', 'err');
  }).then(function () { __miniLoginBusy = false; });
}
function startLoginWatch () {
  if (getToken() || APP.user) return;
  if (!getTick()) return;
  showLoginWait();
  burstPeek();
  if (__pollTimer) return;
  __pollTimer = setInterval(function () { peekLoginTicket(false); }, 1500);
}
function bindLoginResume () {
  if (window.__loginResumeBound) return;
  window.__loginResumeBound = true;
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { loginMiniApp(); burstPeek(); } });
  window.addEventListener('focus', function () { loginMiniApp(); burstPeek(); });
  window.addEventListener('pageshow', function () { loginMiniApp(); burstPeek(); });
  document.addEventListener('click', function () { if (getTick() && !APP.user) peekLoginTicket(true); }, true);
}
bindLoginResume();
function api (path, opts) {
  opts = opts || {};
  var hd = { 'Content-Type': 'application/json' };
  var t = getToken();
  if (t) hd['Authorization'] = 'Bearer ' + t;
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, opts.timeout || 15000);
  return fetch('/api' + path, {
    signal: controller.signal,
    cache: 'no-store',
    method: opts.method || 'GET',
    headers: hd,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return { error: 'خطای ارتباط با سرور' }; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || ('خطا ' + r.status)); e.status = r.status; e.data = j; throw e; }
      return j;
    });
  }).catch(function (e) {
    if (e.name === 'AbortError') throw new Error('پاسخ سرور طول کشید؛ اتصال را بررسی و دوباره تلاش کنید.');
    throw e;
  }).finally(function () { clearTimeout(timeout); });
}

function qs (q) {
  var o = {};
  String(q || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    var k = i >= 0 ? kv.slice(0, i) : kv;
    var v = i >= 0 ? kv.slice(i + 1) : '';
    try { o[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { }
  });
  return o;
}
function isTgWebHash (h) {
  h = String(h || '');
  return h.indexOf('tgWebApp') >= 0 || h.indexOf('#tgWebApp') >= 0;
}
function miniAppItemUrl (id) {
  if (!/^i_[a-z0-9]+$/.test(String(id || ''))) return '';
  return '@@MINI_APP_URL@@' + '?startapp=item_' + id;
}
function itemRouteFromStart (value) {
  var match = /^item_(i_[a-z0-9]+)$/.exec(String(value || ''));
  return match && value.length <= 512 ? '#/item/' + match[1] : '';
}
var __itemLaunchHandled = false;
function applyMiniAppItemLaunch () {
  if (__itemLaunchHandled) return;
  var hash = location.hash || '';
  // Only apply launch navigation at entry, never after the user has navigated.
  if (hash && hash !== '#' && hash !== '#/' && !isTgWebHash(hash)) {
    __itemLaunchHandled = true;
    return;
  }
  var query = new URLSearchParams(location.search || '');
  var fragment = new URLSearchParams(hash.slice(1));
  var start = (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) ||
    query.get('tgWebAppStartParam') || fragment.get('tgWebAppStartParam') || '';
  // This is a navigation hint only; authentication still verifies Telegram initData server-side.
  var route = itemRouteFromStart(start);
  if (route) {
    __itemLaunchHandled = true;
    query.delete('tgWebAppStartParam');
    var search = query.toString();
    history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + route);
  }
}
function currentRoute () {
  var h = '';
  try { h = location.hash || ''; } catch (e) { h = ''; }
  if (!h || h === '#' || isTgWebHash(h)) {
    var search = '';
    try { search = String(location.search || ''); if (search.charAt(0) === '?') search = search.slice(1); } catch (e2) { search = ''; }
    var q = qs(search);
    if (q.tgWebAppStartParam && !q.start) q.start = q.tgWebAppStartParam;
    return { path: '/', query: q, tg: true };
  }
  var i = h.indexOf('?');
  var path = i >= 0 ? h.slice(1, i) : h.slice(1);
  var query = i >= 0 ? h.slice(i + 1) : '';
  if (!path || path.charAt(0) !== '/') path = '/' + path;
  if (path.indexOf('tgWebApp') >= 0) path = '/';
  return { path: path, query: qs(query) };
}
function nav (hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function toast (msg, type) {
  var el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(function () { el.remove(); }, 320); }, 3200);
}
/* مرجع بسته‌شدن مودالِ باز؛ تا کدهای دیگر (مثل تبلیغ) بتوانند تمیز ببندندش. */
var MODAL_CLOSE = null;
function openModal (title, bodyHtml, onOpen, wide) {
  var root = $('#modal-root');
  root.innerHTML = '<div class="mwrap"><div class="modal' + (wide ? ' wide' : '') + '"><div class="modal-h"><h3>' + esc(title) + '</h3><button class="modal-x">✕</button></div><div class="modal-b">' + bodyHtml + '</div></div></div>';
  var wrap = $('.mwrap', root);
  function close () { if (MODAL_CLOSE === close) MODAL_CLOSE = null; root.innerHTML = ''; document.removeEventListener('keydown', key); }
  function key (e) { if (e.key === 'Escape') close(); }
  $('.modal-x', root).addEventListener('click', close);
  wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
  document.addEventListener('keydown', key);
  MODAL_CLOSE = close;
  if (onOpen) onOpen(wrap, close);
  return close;
}
function closeModal () { if (MODAL_CLOSE) MODAL_CLOSE(); else { var r = $('#modal-root'); if (r) r.innerHTML = ''; } }
function haptic (type) {
  if (TG && TG.HapticFeedback) { try { type ? TG.HapticFeedback.impactOccurred(type) : TG.HapticFeedback.notificationOccurred('error'); } catch (e) { } }
}
function openBot (url) {
  if (!url) { toast('لینک تنظیم نشده', 'err'); return; }
  if (TG && typeof TG.openTelegramLink === 'function') {
    try { TG.openTelegramLink(String(url)); return; } catch (e) { }
  }
  // Same-tab navigation also works after an async download request without a popup blocker.
  location.assign(String(url));
}
function openExt (url) {
  if (!url) { toast('لینک تنظیم نشده', 'err'); return; }
  var u = String(url);
  var isTg = u.indexOf('t.me/') >= 0 || u.indexOf('tg://') === 0;
  if (TG) {
    try {
      if (isTg) { TG.openTelegramLink(u); return; }
      if (typeof TG.openLink === 'function') { TG.openLink(u); return; }
    } catch (e) { }
  }
  window.open(u, '_blank');
}
var Q_KEYS = ['480', '720', '1080', '4k'];
var Q_LABEL = { '480': '480p', '720': '720p', '1080': '1080p', '4k': '4K' };
function qKey (q) {
  var s = String(q || '').toLowerCase();
  if (s.indexOf('4k') >= 0 || s.indexOf('2160') >= 0) return '4k';
  if (s.indexOf('1080') >= 0) return '1080';
  if (s.indexOf('720') >= 0) return '720';
  if (s.indexOf('480') >= 0 || s.indexOf('360') >= 0 || s.indexOf('540') >= 0) return '480';
  return '';
}
function variantsOf (bag, it) {
  var v = bag && bag.variants;
  var has = v && ((v.sub && Object.keys(v.sub).length) || (v.dub && Object.keys(v.dub).length));
  if (has) return { sub: v.sub || {}, dub: v.dub || {} };
  var q = qKey((bag && bag.quality) || (it && it.quality)) || '1080';
  var o = { sub: {}, dub: {} };
  if (bag && (bag.source || (it && bag === it && it.source))) o.sub[q] = { has: true, sizeBytes: (bag.sizeBytes) || (bag.media && bag.media.sizeBytes) || (it && it.media && it.media.sizeBytes) };
  return o;
}
function seasonsOf (it) {
  if (it.seasons && it.seasons.length) return it.seasons;
  if (it.episodes && it.episodes.length) return [{ n: 1, title: 'فصل ۱', episodes: it.episodes }];
  return [];
}
function currentDlPrice () {
  if (hasSub()) return 0;
  var n = Number(APP.economy && APP.economy.dlClickPrice);
  return (isFinite(n) && n > 0) ? n : 0;
}
function cellFilesOf (cell) {
  if (!cell) return [];
  if (cell.files && cell.files.length) return cell.files;
  if (cell.has || cell.source) return [{ id: '', title: '', sizeBytes: cell.sizeBytes || null, has: true }];
  return [];
}
function qualityButtonsHtml (variants, track, bagLock) {
  var v = (variants && variants[track]) || {};
  var price = currentDlPrice();
  var sub = hasSub();
  var classic = ['480', '720', '1080', '4k'];
  var keys = Object.keys(v).filter(function (k) {
    var cell = v[k];
    return cell && (cell.has || cell.source || (cell.files && cell.files.length));
  });
  keys.sort(function (a, b) {
    var ia = classic.indexOf(a), ib = classic.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return String((v[a] && v[a].label) || a).localeCompare(String((v[b] && v[b].label) || b), 'fa');
  });
  if (!keys.length) {
    return '<p class="note">برای «' + (track === 'dub' ? 'دوبله' : 'زیرنویس') + '» هنوز کیفیتی ثبت نشده.</p>';
  }
  return '<div class="q-row">' + keys.map(function (k) {
    var cell = v[k];
    var files = cellFilesOf(cell);
    var on = files.length > 0;
    var prem = !!(bagLock || (cell && cell.premium));
    var lab = (cell && cell.label) || Q_LABEL[k] || k;
    var extra = '';
    if (on && files.length > 1) extra += '<span>' + faNum(files.length) + ' نسخه</span>';
    else if (on && cell.sizeBytes) extra += '<span>' + fmtBytes(cell.sizeBytes) + '</span>';
    if (on && prem && !sub) extra += '<span>⭐ اشتراک</span>';
    else if (on && price > 0) extra += '<span>' + faMoney(price) + ' ' + unitName() + '</span>';
    return '<button type="button" class="q-btn' + (on ? '' : ' off') + (on && prem && !sub ? ' lock' : '') + '" data-q="' + esc(k) + '" data-nf="' + files.length + '"' + (on ? '' : ' disabled') + '>' + esc(lab) + extra + '</button>';
  }).join('') + '</div><div class="q-alts" id="q-alts"></div>';
}
function trackTabsHtml (id, onTrack) {
  return '<div class="seg" id="' + id + '">' +
    '<button type="button" class="seg-btn' + (onTrack === 'sub' ? ' on' : '') + '" data-track="sub">زیرنویس</button>' +
    '<button type="button" class="seg-btn' + (onTrack === 'dub' ? ' on' : '') + '" data-track="dub">دوبله</button>' +
    '</div>';
}
function copyText (text, cb) {
  function ok () { if (cb) cb(); }
  function fallback () {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast('کپی نشد — لینک را دستی کپی کنید', 'err'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
  } else fallback();
}
function pageShareUrl () {
  var origin = '';
  try { origin = location.origin || ''; } catch (e) { origin = ''; }
  var hash = '#/';
  try { hash = location.hash || '#/'; } catch (e2) { hash = '#/'; }
  return origin + '/' + hash;
}
function sharePage (title, url) {
  title = title || APP.siteName || '';
  url = url || pageShareUrl();
  openShareModal(title, url);
}
function openShareModal (title, url) {
  var text = (title || '') + ' ' + url;
  var tg = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(title || '');
  var wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  var tw = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title || '') + '&url=' + encodeURIComponent(url);
  var fb = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
  var li = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
  var eitaa = 'https://eitaa.com/share/url?url=' + encodeURIComponent(url);
  var html = '<div class="share-box"><input id="sh-url" readonly dir="ltr" value="' + esc(url) + '"><button type="button" class="btn btn-primary" id="sh-copy">کپی</button></div>' +
    '<div class="share-grid">' +
    '<a class="share-app" href="' + tg + '" target="_blank" rel="noopener"><span>✈️</span>تلگرام</a>' +
    '<a class="share-app" href="' + wa + '" target="_blank" rel="noopener"><span>🟢</span>واتساپ</a>' +
    '<a class="share-app" href="' + eitaa + '" target="_blank" rel="noopener"><span>🟠</span>ایتا</a>' +
    '<a class="share-app" href="' + tw + '" target="_blank" rel="noopener"><span>🐦</span>ایکس</a>' +
    '<a class="share-app" href="' + fb + '" target="_blank" rel="noopener"><span>📘</span>فیسبوک</a>' +
    '<a class="share-app" href="' + li + '" target="_blank" rel="noopener"><span>💼</span>لینکدین</a>' +
    '</div>' +
    '<button type="button" class="btn btn-ghost btn-block" id="sh-native" style="margin-top:12px">سایر برنامه‌ها</button>';
  openModal('اشتراک‌گذاری', html, function (wrap) {
    var inp = $('#sh-url', wrap);
    if (inp) inp.addEventListener('click', function () { inp.select(); });
    var b = $('#sh-copy', wrap);
    if (b) b.addEventListener('click', function () { copyText(url, function () { toast('لینک کپی شد ✓', 'ok'); }); });
    var nat = $('#sh-native', wrap);
    if (nat) {
      if (navigator.share) {
        nat.addEventListener('click', function () {
          navigator.share({ title: title, text: title, url: url }).catch(function () { });
        });
      } else nat.style.display = 'none';
    }
  });
}
function applySiteBranding () {
  try { document.title = APP.siteName || document.title; } catch (e) { }
  var logo = $('.logo-tx');
  if (logo) logo.textContent = APP.siteName || '';
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', APP.tagline || '');
  var ogt = document.querySelector('meta[property="og:title"]');
  if (ogt) ogt.setAttribute('content', APP.siteName || '');
  var ogd = document.querySelector('meta[property="og:description"]');
  if (ogd) ogd.setAttribute('content', APP.tagline || '');
}
function posterSrc (it) {
  var p = (it && (it.posterOverride || it.poster)) || '';
  if (!p) {
    if (it && it.source && it.source.tmeUrl) return '/img?src=' + encodeURIComponent(it.source.tmeUrl);
    return '';
  }
  if (p.indexOf('/img?') === 0 || p.indexOf('data:') === 0) return p;
  if (p.indexOf('t.me/') >= 0 || p.indexOf('telegram.me/') >= 0) return '/img?src=' + encodeURIComponent(p);
  if (p.indexOf('http://') === 0 || p.indexOf('https://') === 0) return '/img?url=' + encodeURIComponent(p);
  return p;
}

function headerHtml (active, opts) {
  opts = opts || {};
  var userPart;
  var walletPart = '';
  if (APP.user) {
    var roleBadge = APP.user.role === 'admin' ? '<span class="badge gold">مدیر</span>' : (hasSub() ? '<span class="badge acc">اشتراک</span>' : '');
    var nm = APP.user.tgName || APP.user.username;
    userPart = '<a class="user-chip" href="#/account"><span class="avatar">' + esc(nm.charAt(0).toUpperCase()) + '</span><span>' + esc(nm) + '</span>' + roleBadge + '</a>';
    walletPart = '<a class="user-chip wallet-chip" href="#/wallet">💰 ' + faMoney(APP.user.wallet) + '</a>';
  } else {
    userPart = '<a class="btn btn-primary btn-sm" href="#/auth">ورود با تلگرام</a>';
  }
  var admBtn = APP.user && APP.user.role === 'admin' ? '<a class="hdr-hamb" href="#/admin" title="پنل مدیریت">⚙️</a>' : '';
  var desktopNav = '<a href="#/" class="' + (active === 'home' ? 'on' : '') + '">خانه</a>' +
    '<a href="#/catalog" class="' + (active === 'catalog' ? 'on' : '') + '">آرشیو</a>' +
    '<a href="#/wallet" class="' + (active === 'wallet' ? 'on' : '') + '">کیف پول</a>' +
    '<a href="#/account" class="' + (active === 'account' ? 'on' : '') + '">حساب</a>' +
    (APP.user && APP.user.role === 'admin' ? '<a href="#/admin" class="' + (active === 'admin' ? 'on' : '') + '">مدیریت</a>' : '');
  return '<header class="hdr' + (opts.float ? ' hdr-float' : '') + '">' +
    '<a class="logo" href="#/"><span class="logo-ic">🎬</span><span class="logo-tx">' + esc(APP.siteName) + '</span></a>' +
    '<nav class="hdr-nav">' + desktopNav + '</nav>' +
    '<div class="hdr-actions">' + walletPart + admBtn + userPart + '</div>' +
    '</header>' +
    '<nav class="bnav">' +
    '<a href="#/" class="' + (active === 'home' ? 'on' : '') + '"><span class="ic">🏠</span>خانه</a>' +
    '<a href="#/catalog" class="' + (active === 'catalog' ? 'on' : '') + '"><span class="ic">🎞️</span>آرشیو</a>' +
    '<a href="#/wallet" class="' + (active === 'wallet' ? 'on' : '') + '"><span class="ic">💰</span>کیف پول</a>' +
    '<a href="#/account" class="' + (active === 'account' ? 'on' : '') + '"><span class="ic">👤</span>حساب</a>' +
    (APP.user && APP.user.role === 'admin' ? '<a href="#/admin" class="' + (active === 'admin' ? 'on' : '') + '"><span class="ic">⚙️</span>مدیریت</a>' : '') +
    '</nav>';
}
var __hdrScrollBound = false;
function syncFloatHeader () {
  var h = $('.hdr-float');
  if (!h) return;
  var y = window.pageYOffset || document.documentElement.scrollTop || 0;
  if (y > 30) h.classList.add('scrolled'); else h.classList.remove('scrolled');
}
function bindHeader () {
  if (!__hdrScrollBound) {
    __hdrScrollBound = true;
    window.addEventListener('scroll', syncFloatHeader, { passive: true });
  }
  syncFloatHeader();
}
function footerHtml () {
  return '<div style="text-align:center;color:var(--tx3);font-size:12px;margin-top:34px;padding-top:18px;border-top:1px solid var(--line)">© ' + esc(APP.siteName) + ' — ' + esc(APP.tagline) + '</div>';
}

function typeLabel (t) { return t === 'series' ? 'سریال' : (t === 'clip' ? 'کلیپ' : 'فیلم'); }
/* سال: فیلم یک سال دارد؛ سریال بازهٔ «سال فصل اول – سال آخرین فصل» */
function yearLabel (it) {
  if (!it) return '';
  var y0 = parseInt(it.year, 10) || 0;
  var y1 = parseInt(it.yearEnd, 10) || 0;
  if (!y0 && !y1) return '';
  if (!y0) return faYear(y1);
  if (it.type === 'series' && y1 && y1 !== y0) return faYear(y0) + ' – ' + faYear(y1);
  return faYear(y0);
}
/* متن وضعیت پخش سریال: «فصل ۳ در حال پخش» یا متن دلخواه مدیر */
function airingLabel (it) {
  if (!it || !it.airing) return '';
  if (it.airingText && String(it.airingText).trim()) return String(it.airingText).trim();
  var n = parseInt(it.airingSeason, 10) || 0;
  return n ? ('فصل ' + faNum(n) + ' در حال پخش') : 'در حال پخش';
}
function isAiring (it) { return !!(it && it.type === 'series' && it.airing); }
function cardHtml (it) {
  var poster = it.poster;
  var imdb = it.imdb ? '<span class="card-imdb"><b>' + Number(it.imdb).toFixed(1) + '</b><i>IMDb</i></span>' : '';
  var live = isAiring(it) ? '<span class="card-live">در حال پخش</span>' : '';
  var inner = poster
    ? '<div class="card-p" style="background-image:url(' + esc(poster) + ')">' + imdb + live + '<div class="card-ov"><span>📥</span></div></div>'
    : '<div class="card-p">' + imdb + live + '<div class="card-ov"><span>📥</span></div></div>';
  var yl = yearLabel(it);
  var sub = isAiring(it) && it.airingSeason ? ('فصل ' + faNum(it.airingSeason)) : typeLabel(it.type);
  return '<a class="card" href="#/item/' + it.id + '">' + inner +
    '<div class="card-t">' + esc(it.title) + '</div>' +
    '<div class="card-m"><span>' + sub + (yl ? ' • ' + yl : '') + '</span></div></a>';
}
function rowHtml (title, items, linkText, link, cls) {
  if (!items.length) return '';
  return '<div class="row' + (cls ? ' ' + cls : '') + '"><div class="row-h"><h3>' + esc(title) + '</h3>' +
    (link ? '<a href="' + link + '">' + (linkText || 'مشاهده همه') + ' ←</a>' : '') +
    '</div><div class="hscroll">' + items.map(cardHtml).join('') + '</div></div>';
}
function gridHtml (items) {
  return '<div class="grid">' + items.map(cardHtml).join('') + '</div>';
}
function emptyHtml (ic, title, sub, btnHtml) {
  return '<div class="empty"><div class="ic">' + (ic || '🎬') + '</div><h3>' + esc(title) + '</h3><p>' + esc(sub || '') + '</p>' +
    (btnHtml ? '<div style="margin-top:16px">' + btnHtml + '</div>' : '') + '</div>';
}
function adminEmptyGuide () {
  return APP.user && APP.user.role === 'admin'
    ? emptyHtml('📥', 'هنوز محتوایی ندارید', 'برای شروع، لینک یک پست تلگرام را در پنل مدیریت ← محتوا بچسبانید.', '<a class="btn btn-primary" href="#/admin">رفتن به پنل مدیریت</a>')
    : emptyHtml('🎬', 'هنوز محتوایی ثبت نشده', 'این سایت برای شما ساخته شده اما هنوز محتوایی ندارد. کمی صبر کنید یا با مدیر سایت تماس بگیرید.');
}

function heroSlideHtml (it) {
  var poster = it.poster || '';
  var blur = poster ? '<div class="hero-blur" style="background-image:url(' + esc(poster) + ')"></div>' : '';
  var fit = poster ? '<div class="hero-poster" style="background-image:url(' + esc(poster) + ')"></div>' : '';
  return '<div class="hero-slide">' + blur + fit + '<div class="hero-in">' +
    '<h1 class="hero-title">' + esc(it.title) + '</h1>' +
    '<div class="hero-meta">' + (isAiring(it) ? '<span class="badge live">' + esc(airingLabel(it)) + '</span>' : '') +
    '<span class="badge">' + typeLabel(it.type) + (yearLabel(it) ? ' • ' + yearLabel(it) : '') + '</span>' +
    (it.genres && it.genres.length ? it.genres.slice(0, 4).map(function (g) { return '<span class="badge">' + esc(g) + '</span>'; }).join('') : '') + '</div>' +
    (it.desc ? '<div class="hero-desc">' + esc(it.desc) + '</div>' : '') +
    '<div class="hero-btns"><a class="btn hero-cta" href="#/item/' + it.id + '">مشاهده و دریافت <span aria-hidden="true">↗</span></a></div>' +
    '</div></div>';
}
function heroHtml (items) {
  if (!items || !items.length) return '';
  var dots = items.map(function (_, i) {
    return '<button type="button" class="hero-dot' + (i === 0 ? ' on' : '') + '" aria-label="نمایش اسلاید ' + faNum(i + 1) + '" data-hi="' + i + '"></button>';
  }).join('');
  return '<div class="hero-wrap" id="hero-wrap" dir="rtl">' +
    '<div class="hero-track" id="hero-track">' + items.map(heroSlideHtml).join('') + '</div>' +
    '<div class="hero-dots" id="hero-dots">' + dots + '</div></div>';
}
var __heroTimer = 0;
function stopHero () {
  if (__heroTimer) { clearInterval(__heroTimer); __heroTimer = 0; }
}
function bindHero () {
  stopHero();
  var wrap = $('#hero-wrap');
  if (!wrap) return;
  var track = $('#hero-track', wrap);
  var slides = $all('.hero-slide', wrap);
  var dots = $all('.hero-dot', wrap);
  if (!track || !slides.length) return;
  var i = 0;
  var x0 = 0;
  function go (n) {
    i = (n + slides.length) % slides.length;
    track.style.transform = 'translateX(' + (-i * 100) + '%)';
    slides.forEach(function (slide, k) { slide.inert = k !== i; slide.setAttribute('aria-hidden', k !== i ? 'true' : 'false'); });
    dots.forEach(function (d, k) {
      d.className = 'hero-dot' + (k === i ? ' on' : '');
    });
  }
  dots.forEach(function (d) {
    d.addEventListener('click', function () {
      go(parseInt(d.getAttribute('data-hi'), 10) || 0);
    });
  });
  wrap.addEventListener('touchstart', function (e) {
    if (e.changedTouches && e.changedTouches[0]) x0 = e.changedTouches[0].clientX;
  }, { passive: true });
  wrap.addEventListener('touchend', function (e) {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (dx > 48) go(i - 1);
    else if (dx < -48) go(i + 1);
  }, { passive: true });
  go(0);
  if (slides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    __heroTimer = setInterval(function () { if (!document.hidden && !wrap.matches(':hover') && !wrap.contains(document.activeElement)) go(i + 1); }, 6500);
  }
}
function viewHome (c) {
  var items = c.items;
  if (!items.length) return '<div style="margin-top:40px">' + adminEmptyGuide() + '</div>';
  var featured = items.filter(function (x) { return x.featured; });
  if (!featured.length) featured = items.slice(0, 1);
  var movies = items.filter(function (x) { return x.type === 'movie'; });
  var series = items.filter(function (x) { return x.type === 'series'; });
  var airing = series.filter(isAiring);
  return heroHtml(featured) +
    proSearchHtml(c, {}) +
    (airing.length ? rowHtml('سریال‌های در حال پخش', airing.slice(0, 16), 'همه', '#/catalog?type=series&airing=1', 'row-live') : '') +
    rowHtml('🆕 جدیدترین‌ها', items.slice(0, 12), 'همه', '#/catalog') +
    (series.length ? rowHtml('📺 سریال‌ها', series.slice(0, 12), '', '#/catalog?type=series') : '') +
    (movies.length ? rowHtml('🎬 فیلم‌ها', movies.slice(0, 12), '', '#/catalog?type=movie') : '') +
    footerHtml();
}

function facetsOf (c) {
  var f = (c && c.facets) || {};
  var year = new Date().getFullYear();
  return {
    genres: f.genres || [],
    countries: f.countries || [],
    networks: f.networks || [],
    ages: f.ages || [],
    qualities: f.qualities || [],
    yearMin: f.yearMin || 1888,
    yearMax: Math.max(year, f.yearMax || year)
  };
}
function splitSel (v) {
  if (!v) return [];
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function checkListHtml (id, list, selected) {
  var sel = splitSel(selected);
  if (!list || !list.length) {
    return '<div class="ps-check-list is-empty" id="' + id + '"><span class="ps-none">هنوز موردی از پنل ثبت نشده</span></div>';
  }
  return '<div class="ps-check-list" id="' + id + '">' + list.map(function (x) {
    var on = sel.indexOf(x) >= 0;
    return '<label class="ps-chk' + (on ? ' on' : '') + '"><input type="checkbox" value="' + esc(x) + '"' + (on ? ' checked' : '') + '><span>' + esc(x) + '</span></label>';
  }).join('') + '</div>';
}
function readCheckList (id) {
  var box = $('#' + id);
  if (!box) return '';
  var out = [];
  $all('input[type=checkbox]', box).forEach(function (c) {
    if (c.checked && c.value) out.push(c.value);
  });
  return out.join(',');
}
function applyCatalogQuery (q) {
  var keys = ['q', 'type', 'access', 'genre', 'quality', 'country', 'age', 'network', 'director', 'actor', 'sort', 'y0', 'y1', 's0', 's1', 'dubbed', 'sub', 'airing'];
  var parts = [];
  keys.forEach(function (k) {
    if (q[k] != null && String(q[k]) !== '') parts.push(k + '=' + encodeURIComponent(q[k]));
  });
  return '#/catalog' + (parts.length ? '?' + parts.join('&') : '');
}
function proSearchHtml (c, q) {
  q = q || {};
  var f = facetsOf(c);
  var y0 = q.y0 || f.yearMin;
  var y1 = q.y1 || f.yearMax;
  var s0 = q.s0 || '1';
  var s1 = q.s1 || '10';
  return '<form class="pro-search" id="pro-search" action="javascript:void(0)">' +
    '<div class="pro-side"><div class="pro-ico">🔎</div><b>جستجو حرفه‌ای</b><span>فیلتر فیلم و سریال</span></div>' +
    '<div class="pro-grid">' +
    '<div class="ps-field"><label>نوع</label><div class="ps-types">' +
    '<button type="button" class="ps-type' + (q.type === 'movie' ? ' on' : '') + '" data-type="movie">فیلم</button>' +
    '<button type="button" class="ps-type' + (q.type === 'series' ? ' on' : '') + '" data-type="series">سریال</button>' +
    '</div></div>' +
    '<div class="ps-field"><label>کارگردان</label><input id="f-dir" placeholder="مثلاً Christopher Nolan" value="' + esc(q.director || '') + '"></div>' +
    '<div class="ps-field"><label>بازیگران</label><input id="f-act" placeholder="مثلاً Leonardo DiCaprio" value="' + esc(q.actor || '') + '"></div>' +
    '<div class="ps-field ps-multi"><label>کشور</label>' + checkListHtml('f-country', f.countries, q.country) + '</div>' +
    '<div class="ps-field ps-multi"><label>رده سنی</label>' + checkListHtml('f-age', f.ages, q.age) + '</div>' +
    '<div class="ps-field ps-multi"><label>ژانر</label>' + checkListHtml('f-genre', f.genres, q.genre) + '</div>' +
    '<div class="ps-field ps-multi"><label>کیفیت</label>' + checkListHtml('f-quality', f.qualities, q.quality) + '</div>' +
    '<div class="ps-field ps-multi"><label>شبکه</label>' + checkListHtml('f-net', f.networks, q.network) + '</div>' +
    '<div class="ps-field"><label>ترتیب</label><select id="f-sort">' +
    '<option value="new"' + (!q.sort || q.sort === 'new' ? ' selected' : '') + '>جدیدترین‌ها</option>' +
    '<option value="oldest"' + (q.sort === 'oldest' ? ' selected' : '') + '>قدیمی‌ترین</option>' +
    '<option value="year"' + (q.sort === 'year' ? ' selected' : '') + '>سال ساخت</option>' +
    '<option value="imdb"' + (q.sort === 'imdb' ? ' selected' : '') + '>بالاترین امتیاز</option>' +
    '<option value="title"' + (q.sort === 'title' ? ' selected' : '') + '>الفبا</option></select></div>' +
    '<div class="ps-field ps-range"><div class="ps-range-h"><span>سال ساخت</span><b id="yr-lab">' + faNum(y1) + ' — ' + faNum(y0) + '</b></div>' +
    '<div class="ps-dual"><div class="ps-track"><div class="ps-fill" id="yr-fill"></div></div>' +
    '<input type="range" id="f-y0" min="' + f.yearMin + '" max="' + f.yearMax + '" value="' + y0 + '">' +
    '<input type="range" id="f-y1" min="' + f.yearMin + '" max="' + f.yearMax + '" value="' + y1 + '"></div></div>' +
    '<div class="ps-field ps-range"><div class="ps-range-h"><span>امتیاز</span><b id="sc-lab">' + Number(s1).toFixed(1) + ' — ' + Number(s0).toFixed(1) + '</b></div>' +
    '<div class="ps-dual"><div class="ps-track"><div class="ps-fill" id="sc-fill"></div></div>' +
    '<input type="range" id="f-s0" min="1" max="10" step="0.1" value="' + s0 + '">' +
    '<input type="range" id="f-s1" min="1" max="10" step="0.1" value="' + s1 + '"></div></div>' +
    '<div class="ps-searchrow"><input id="f-q" type="search" placeholder="جستجوی نام فیلم، بازیگر، کارگردان…" value="' + esc(q.q || '') + '">' +
    '<button class="btn btn-primary" type="submit" id="f-go">جستجو</button></div>' +
    '<div class="ps-toggles" style="grid-column:1/-1">' +
    '<button type="button" class="ps-tog' + (q.dubbed === '1' ? ' on' : '') + '" data-f="dubbed">دوبله فارسی</button>' +
    '<button type="button" class="ps-tog' + (q.sub === '1' ? ' on' : '') + '" data-f="sub">زیرنویس</button>' +
    '<button type="button" class="ps-tog live' + (q.airing === '1' ? ' on' : '') + '" data-f="airing">🔴 در حال پخش</button>' +
    '</div></div></form>';
}
function readProQuery () {
  var q = {};
  var t = $('.ps-type.on');
  if (t && t.getAttribute('data-type')) q.type = t.getAttribute('data-type');
  var dir = $('#f-dir'); if (dir && dir.value.trim()) q.director = dir.value.trim();
  var act = $('#f-act'); if (act && act.value.trim()) q.actor = act.value.trim();
  var country = readCheckList('f-country'); if (country) q.country = country;
  var age = readCheckList('f-age'); if (age) q.age = age;
  var genre = readCheckList('f-genre'); if (genre) q.genre = genre;
  var quality = readCheckList('f-quality'); if (quality) q.quality = quality;
  var net = readCheckList('f-net'); if (net) q.network = net;
  var sort = $('#f-sort'); if (sort && sort.value && sort.value !== 'new') q.sort = sort.value;
  var qq = $('#f-q'); if (qq && qq.value.trim()) q.q = qq.value.trim();
  var y0 = $('#f-y0'); var y1 = $('#f-y1');
  if (y0 && y1) {
    var a = Math.min(Number(y0.value), Number(y1.value));
    var b = Math.max(Number(y0.value), Number(y1.value));
    if (a > Number(y0.min)) q.y0 = String(a);
    if (b < Number(y1.max)) q.y1 = String(b);
  }
  var s0 = $('#f-s0'); var s1 = $('#f-s1');
  if (s0 && s1) {
    var a2 = Math.min(Number(s0.value), Number(s1.value));
    var b2 = Math.max(Number(s0.value), Number(s1.value));
    if (a2 > 1) q.s0 = String(a2);
    if (b2 < 10) q.s1 = String(b2);
  }
  $all('.ps-tog.on').forEach(function (b) { q[b.getAttribute('data-f')] = '1'; });
  return q;
}
function syncDual (a, b, fill, lab, kind) {
  if (!a || !b) return;
  var x = Number(a.value), y = Number(b.value);
  if (x > y) { var t = x; x = y; y = t; }
  var min = Number(a.min), max = Number(a.max) || 1;
  var l = ((x - min) / (max - min)) * 100;
  var r = ((y - min) / (max - min)) * 100;
  if (fill) { fill.style.left = l + '%'; fill.style.width = Math.max(0, r - l) + '%'; }
  if (lab) {
    if (kind === 'score') lab.textContent = y.toFixed(1) + ' — ' + x.toFixed(1);
    else lab.textContent = faNum(y) + ' — ' + faNum(x);
  }
}
function bindProSearch () {
  var form = $('#pro-search');
  if (!form) return;
  function go () { nav(applyCatalogQuery(readProQuery())); }
  form.addEventListener('submit', function (e) { e.preventDefault(); go(); });
  $all('.ps-type').forEach(function (b) {
    b.addEventListener('click', function () {
      var was = b.className.indexOf('on') >= 0;
      $all('.ps-type').forEach(function (x) { x.className = 'ps-type'; });
      if (!was) b.className = 'ps-type on';
      go();
    });
  });
  $all('.ps-tog').forEach(function (b) {
    b.addEventListener('click', function () {
      var isLive = b.className.indexOf('live') >= 0;
      b.className = (b.className.indexOf(' on') >= 0 ? 'ps-tog' : 'ps-tog on') + (isLive ? ' live' : '');
      go();
    });
  });
  ['f-country', 'f-age', 'f-genre', 'f-quality', 'f-net', 'f-sort'].forEach(function (id) {
    var el = $('#' + id);
    if (el) el.addEventListener('change', go);
  });
  $all('.ps-chk input').forEach(function (c) {
    c.addEventListener('change', function () {
      var lab = c.parentNode;
      if (lab && lab.className && lab.className.indexOf('ps-chk') >= 0) {
        lab.className = c.checked ? 'ps-chk on' : 'ps-chk';
      }
      go();
    });
  });
  ['f-dir', 'f-act', 'f-q'].forEach(function (id) {
    var el = $('#' + id);
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  });
  function hookDual (id0, id1, fillId, labId, kind) {
    var a = $('#' + id0), b = $('#' + id1), fill = $('#' + fillId), lab = $('#' + labId);
    function paint () { syncDual(a, b, fill, lab, kind); }
    paint();
    [a, b].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', paint);
      el.addEventListener('change', go);
    });
  }
  hookDual('f-y0', 'f-y1', 'yr-fill', 'yr-lab', 'year');
  hookDual('f-s0', 'f-s1', 'sc-fill', 'sc-lab', 'score');
}
function bindCatalogFilters () { bindProSearch(); }
function viewCatalog (c, q) {
  q = q || {};
  var n = (c.total != null ? c.total : (c.items || []).length);
  var title = q.q ? ('جستجوی «' + q.q + '»') : (q.airing === '1' ? 'سریال‌های در حال پخش' : (q.type ? typeLabel(q.type) : 'آرشیو'));
  var body = (c.items && c.items.length)
    ? gridHtml(c.items)
    : emptyHtml('🔍', 'چیزی پیدا نشد', 'فیلترها را عوض کنید یا عبارت دیگری جستجو کنید.');
  return proSearchHtml(c, q) +
    '<div class="pro-count">' + esc(title) + ' — ' + faNum(n) + ' عنوان</div>' +
    body + footerHtml();
}
function viewSearch (c, q) { return viewCatalog(c, q); }

function galleryLimitForView (it) {
  var n = it && (it.galleryLimit != null ? it.galleryLimit : it.galleryCount);
  n = parseInt(n, 10);
  if (!isFinite(n)) return 4;
  return Math.max(1, Math.min(10, n));
}
function galleryImagesForView (images, limit) {
  var max = parseInt(limit, 10);
  if (!isFinite(max)) max = 4;
  max = Math.max(1, Math.min(10, max));
  return (Array.isArray(images) ? images : []).filter(function (image) {
    return image && typeof image.url === 'string' && (image.url.indexOf('https://') === 0 || image.url.indexOf('http://') === 0);
  }).slice(0, max);
}
function galleryImageGridHtml (images, title, preview, source, limit) {
  var posters = source !== 'imdb-legacy';
  return '<div class="gallery-grid' + (posters ? ' gallery-grid--posters' : '') + '">' + galleryImagesForView(images, limit).map(function (image, index) {
    var caption = image.caption || ((posters ? 'پوستر ' : 'تصویر ') + faNum(index + 1) + ' از ' + (title || 'این عنوان'));
    // The site proxy avoids mixed-content requests when IMP's original image uses HTTP.
    var picture = '<img src="/img?url=' + encodeURIComponent(image.url) + '" alt="' + esc(caption) + '" loading="lazy" decoding="async">';
    if (preview) return '<div class="gallery-thumb">' + picture + '</div>';
    return '<button type="button" class="gallery-thumb" data-gallery-image="' + index + '" aria-label="بزرگ‌نمایی تصویر ' + faNum(index + 1) + '">' + picture + '</button>';
  }).join('') + '</div>';
}
function galleryHtml (it) {
  var images = galleryImagesForView(it.galleryImages, galleryLimitForView(it));
  var source = it.gallerySource || 'impawards';
  var url = String(it.gallerySourceUrl || it.galleryUrl || '');
  var legacy = source === 'imdb-legacy';
  var valid = legacy ? url.indexOf('https://www.imdb.com/title/tt') === 0
    : (url.indexOf('http://www.impawards.com/') === 0 || url.indexOf('https://www.impawards.com/') === 0);
  if (!images.length || !valid) return '';
  return '<section class="gallery-section" aria-label="گالری تصاویر">' +
    '<div class="gallery-head"><h2>' + (legacy ? 'گالری تصاویر ذخیره‌شده' : 'گالری پوسترها') + '</h2><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
    (legacy ? 'IMDb — تصاویر قبلی' : 'IMP Awards') + ' ↗</a></div>' +
    galleryImageGridHtml(images, it.title, false, source) + '</section>';
}
function bindGalleryImageErrors (root) {
  $all('.gallery-thumb img', root).forEach(function (image) {
    function failed () {
      var tile = image.parentNode;
      if (!tile) return;
      tile.innerHTML = '<span class="gallery-missing">تصویر در دسترس نیست</span>';
      if ('disabled' in tile) tile.disabled = true;
    }
    image.addEventListener('error', failed);
    if (image.complete && !image.naturalWidth) failed();
  });
}
function bindGallery (it) {
  var images = galleryImagesForView(it.galleryImages, galleryLimitForView(it));
  $all('[data-gallery-image]').forEach(function (button) {
    button.addEventListener('click', function () {
      var image = images[Number(button.getAttribute('data-gallery-image'))];
      if (!image) return;
      var caption = image.caption || it.title || '';
      openModal('تصاویر ' + (it.title || ''), '<div class="gallery-lightbox"><img src="/img?url=' + encodeURIComponent(image.url) + '" alt="' + esc(caption) + '">' +
        (caption ? '<p>' + esc(caption) + '</p>' : '') + '</div>');
    });
  });
  bindGalleryImageErrors();
}
function posterSlidesForView (it) {
  var slides = [];
  var main = '';
  try { main = posterSrc(it) || ''; } catch (e) { main = ''; }
  var limit = galleryLimitForView(it);
  var gallery = galleryImagesForView(it.galleryImages, limit);
  function proxied (raw) {
    if (!raw) return '';
    if (raw.indexOf('/img?') === 0) return raw;
    return '/img?url=' + encodeURIComponent(raw);
  }
  if (main) {
    slides.push({ url: main, caption: (it && it.title) || '', main: true });
    for (var i = 0; i < gallery.length; i++) {
      var p = proxied(gallery[i].url);
      var dup = false;
      for (var j = 0; j < slides.length; j++) if (slides[j].url === p) dup = true;
      if (dup) continue;
      slides.push({ url: p, caption: gallery[i].caption || '', main: false });
    }
  } else {
    for (var k = 0; k < gallery.length; k++) {
      slides.push({ url: proxied(gallery[k].url), caption: gallery[k].caption || '', main: k === 0 });
    }
  }
  return slides;
}
function posterCarouselSource (it) {
  var url = String((it && (it.gallerySourceUrl || it.galleryUrl)) || '');
  var source = (it && it.gallerySource) || 'impawards';
  var legacy = source === 'imdb-legacy';
  var valid = legacy
    ? url.indexOf('https://www.imdb.com/title/tt') === 0 || url.indexOf('http://www.imdb.com/title/tt') === 0
    : url.indexOf('http://www.impawards.com/') === 0 || url.indexOf('https://www.impawards.com/') === 0;
  if (!valid) return null;
  return { url: url, label: legacy ? 'IMDb' : 'IMP Awards' };
}
function posterCarouselHtml (it) {
  var slides = posterSlidesForView(it);
  if (!slides.length) {
    return '<div class="dp-img" style="display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:900;color:#39445c">' + esc(((it && it.title) || '?').charAt(0)) + '</div>';
  }
  var src = posterCarouselSource(it);
  var srcHtml = src ? '<a class="dp-src" href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.label) + ' \u2197</a>' : '';
  if (slides.length === 1) {
    return '<div class="dp-carousel" id="dp-carousel" dir="ltr"><div class="dp-track" id="dp-track">' +
      '<button type="button" class="dp-slide" data-carousel-image="0" aria-label="\u0628\u0632\u0631\u06af\u200c\u0646\u0645\u0627\u06cc\u06cc \u062a\u0635\u0648\u06cc\u0631"><img src="' + esc(slides[0].url) + '" alt="' + esc(slides[0].caption || (it.title || '')) + '" loading="eager" decoding="async"></button>' +
      '</div>' + srcHtml + '</div>';
  }
  var track = slides.map(function (slide, i) {
    return '<button type="button" class="dp-slide" data-carousel-image="' + i + '" aria-label="\u062a\u0635\u0648\u06cc\u0631 ' + faNum(i + 1) + '"><img src="' + esc(slide.url) + '" alt="' + esc(slide.caption || ((it.title || '') + ' ' + (i + 1))) + '" ' + (i === 0 ? 'loading="eager"' : 'loading="lazy"') + ' decoding="async"></button>';
  }).join('');
  var dots = slides.map(function (slide, i) {
    return '<span class="dp-dot' + (i === 0 ? ' on' : '') + '" data-dot="' + i + '"></span>';
  }).join('');
  return '<div class="dp-carousel" id="dp-carousel" dir="ltr"><div class="dp-track" id="dp-track">' + track + '</div>' +
    '<button type="button" class="dp-nav dp-prev" id="dp-prev" aria-label="\u0642\u0628\u0644\u06cc">\u203a</button>' +
    '<button type="button" class="dp-nav dp-next" id="dp-next" aria-label="\u0628\u0639\u062f\u06cc">\u2039</button>' +
    '<div class="dp-count" id="dp-count">' + faNum(1) + ' / ' + faNum(slides.length) + '</div>' +
    srcHtml + '<div class="dp-dots" id="dp-dots">' + dots + '</div></div>';
}
function bindPosterCarousel (it) {
  var slides = posterSlidesForView(it);
  var wrap = $('#dp-carousel');
  if (!wrap) return;
  var suppressed = false;
  $all('.dp-slide img', wrap).forEach(function (image) {
    function failed () {
      var tile = image.parentNode;
      if (!tile || tile.getAttribute('data-carousel-broken')) return;
      tile.setAttribute('data-carousel-broken', '1');
      tile.innerHTML = '<span class="dp-missing">\u062a\u0635\u0648\u06cc\u0631 \u062f\u0631 \u062f\u0633\u062a\u0631\u0633 \u0646\u06cc\u0633\u062a</span>';
      try { tile.disabled = true; } catch (e) {}
    }
    image.addEventListener('error', failed);
    if (image.complete && !image.naturalWidth) failed();
  });
  $all('[data-carousel-image]', wrap).forEach(function (button) {
    button.addEventListener('click', function () {
      if (suppressed) return;
      if (button.getAttribute('data-carousel-broken')) return;
      var slide = slides[Number(button.getAttribute('data-carousel-image'))];
      if (!slide) return;
      var caption = slide.caption || (it.title || '');
      openModal('\u062a\u0635\u0627\u0648\u06cc\u0631 ' + (it.title || ''), '<div class="gallery-lightbox"><img src="' + esc(slide.url) + '" alt="' + esc(caption) + '">' + (caption ? '<p>' + esc(caption) + '</p>' : '') + '</div>');
    });
  });
  var track = $('#dp-track', wrap);
  var dots = $all('[data-dot]', wrap);
  var count = $('#dp-count', wrap);
  var prev = $('#dp-prev', wrap);
  var next = $('#dp-next', wrap);
  if (!track || slides.length < 2) return;
  var i = 0;
  function paint () {
    track.style.transform = 'translateX(' + (-i * 100) + '%)';
    dots.forEach(function (d, k) {
      d.className = 'dp-dot' + (k === i ? ' on' : '');
    });
    if (count) count.textContent = faNum(i + 1) + ' / ' + faNum(slides.length);
  }
  function go (n) {
    i = (n + slides.length) % slides.length;
    paint();
  }
  if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); go(i - 1); });
  if (next) next.addEventListener('click', function (e) { e.stopPropagation(); go(i + 1); });
  var x0 = 0, tracking = false;
  wrap.addEventListener('touchstart', function (e) {
    if (e.changedTouches && e.changedTouches[0]) { x0 = e.changedTouches[0].clientX; tracking = true; }
  }, { passive: true });
  wrap.addEventListener('touchend', function (e) {
    if (!tracking || !e.changedTouches || !e.changedTouches[0]) return;
    tracking = false;
    var dx = e.changedTouches[0].clientX - x0;
    if (dx > 48) { suppressed = true; go(i - 1); setTimeout(function () { suppressed = false; }, 250); }
    else if (dx < -48) { suppressed = true; go(i + 1); setTimeout(function () { suppressed = false; }, 250); }
  }, { passive: true });
  paint();
}
function galleryEditorHtml (it) {
  var limit = galleryLimitForView(it);
  var images = galleryImagesForView(it.galleryImages, limit);
  var legacy = it.gallerySource === 'imdb-legacy';
  var opts = '';
  for (var n = 1; n <= 10; n++) {
    opts += '<option value="' + n + '"' + (n === limit ? ' selected' : '') + '>' + faNum(n) + ' \u062a\u0635\u0648\u06cc\u0631</option>';
  }
  return '<div class="adm-box gallery-editor"><h4>گالری پوسترهای IMP Awards</h4>' +
    '<div class="field"><label for="e-gallery-url">لینک پوستر یا گالری IMP Awards (اختیاری)</label><input id="e-gallery-url" type="url" dir="ltr" maxlength="2000" value="' + esc(it.galleryUrl || '') + '" placeholder="http://www.impawards.com/1994/shawshank_redemption_ver1_xlg.html"></div>' +
    '<div class="field"><label for="e-gallery-count">\u062a\u0639\u062f\u0627\u062f \u062a\u0635\u0627\u0648\u06cc\u0631 \u06af\u0627\u0644\u0631\u06cc</label><select id="e-gallery-count" class="sel">' + opts + '</select></div>' +
    '<p class="gallery-help">لینک معمولی، نسخهٔ بزرگ (xlg / xxlg) یا گالری را وارد کنید. پوسترهای همان فیلم یا سریال دریافت می‌شود، نه عکس صحنه‌ها. گالری داخل همان قاب تصویر اصلی به‌صورت کاروسل افقی نمایش داده می‌شود. لینک پوستر اصلی جداست؛ اگر خالی باشد، اولین تصویر گالری به‌عنوان تصویر اصلی نمایش داده می‌شود.</p>' +
    (legacy ? '<p class="gallery-help">تصاویر قبلی IMDb حفظ می‌شوند؛ برای جایگزینی آن‌ها لینک IMP Awards را وارد کنید. دریافت جدید فقط از IMP Awards است.</p>' : '') +
    '<div class="adm-row"><button type="button" class="btn btn-ghost btn-sm" id="e-gallery-load">دریافت / تازه‌سازی پوسترها</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="e-gallery-clear">حذف گالری</button></div>' +
    '<div class="fmsg" id="e-gallery-msg" role="status" aria-live="polite">' + (images.length ? faNum(images.length) + ' تصویر ذخیره شده است.' : '') + '</div>' +
    '<div id="e-gallery-preview">' + (images.length ? galleryImageGridHtml(images, it.title, true, it.gallerySource, limit) : '') + '</div></div>';
}
function bindGalleryEditor (wrap, it) {
  var input = $('#e-gallery-url', wrap), button = $('#e-gallery-load', wrap);
  var message = $('#e-gallery-msg', wrap), preview = $('#e-gallery-preview', wrap);
  var countSel = $('#e-gallery-count', wrap);
  if (!input || !button || !message || !preview) return null;
  var requestId = 0, edited = false;
  function currentLimit () {
    var n = countSel ? parseInt(countSel.value, 10) : galleryLimitForView(it);
    if (!isFinite(n)) n = galleryLimitForView(it);
    return Math.max(1, Math.min(10, n));
  }
  function resetButton () { button.disabled = false; button.textContent = 'دریافت / تازه‌سازی پوسترها'; }
  function changed () {
    edited = true;
    requestId += 1;
    resetButton();
    preview.innerHTML = '';
    message.className = 'fmsg';
    message.textContent = input.value.trim() ? 'برای پیش‌نمایش، پوسترها را دریافت کنید یا لینک را ذخیره کنید.' : 'گالری با ذخیرهٔ فرم حذف می‌شود.';
  }
  input.addEventListener('input', changed);
  if (countSel) countSel.addEventListener('change', changed);
  var clear = $('#e-gallery-clear', wrap);
  if (clear) clear.addEventListener('click', function () { input.value = ''; changed(); });
  button.addEventListener('click', function () {
    var rawUrl = input.value.trim();
    var limit = currentLimit();
    if (!rawUrl) { message.className = 'fmsg err'; message.textContent = 'ابتدا لینک IMP Awards را وارد کنید.'; return; }
    var current = ++requestId;
    button.disabled = true;
    button.textContent = 'در حال دریافت پوسترها…';
    message.className = 'fmsg';
    message.textContent = 'در حال خواندن پوسترهای این عنوان در IMP Awards…';
    return api('/admin/gallery', { method: 'POST', body: { url: rawUrl, refresh: true, limit: limit } }).then(function (result) {
      if (current !== requestId || input.value.trim() !== rawUrl) return;
      edited = true;
      input.value = result.galleryUrl;
      var images = galleryImagesForView(result.images, limit);
      preview.innerHTML = galleryImageGridHtml(images, it.title, true, 'impawards', limit);
      bindGalleryImageErrors(preview);
      message.className = 'fmsg ok';
      message.textContent = faNum(images.length) + ' پوستر دریافت شد' + (images.length < limit ? '؛ فعلاً همین تعداد در دسترس بود' : '') + '. برای ثبت گالری، فرم را ذخیره کنید.';
      resetButton();
    }).catch(function (e) {
      if (current !== requestId || input.value.trim() !== rawUrl) return;
      message.className = 'fmsg err';
      message.textContent = e.message + (galleryImagesForView(it.galleryImages, currentLimit()).length ? ' تصاویر ذخیره‌شدهٔ قبلی تغییر نکرده‌اند.' : '');
      resetButton();
    });
  });
  bindGalleryImageErrors(preview);
  return { value: function () {
    var value = input.value.trim();
    // An untouched blank IMP field must not erase a legacy gallery during an unrelated edit.
    return it.gallerySource === 'imdb-legacy' && !edited && !value ? undefined : value;
  }, limit: function () {
    return currentLimit();
  } };
}

/* ═══════════ صفحهٔ جزئیات ═══════════ */
function viewItem (data, id) {
  var it = data.item;
  var canPlay = data.canPlay;
  var posterHtml = posterCarouselHtml(it);
  var mainPoster = '';
  try { mainPoster = (posterSlidesForView(it)[0] || {}).url || ''; } catch (e) { mainPoster = ''; }
  var isSeries = it.type === 'series';
  var live = isAiring(it);
  var liveText = airingLabel(it);
  /* عنوان: اگر «فارسی | English» باشد دو خطی نمایش می‌دهیم (مثل نماوا) */
  var tFa = String(it.title || '');
  var tEn = '';
  var tp = tFa.split(' | ');
  var FA_RE = new RegExp('[\\u0600-\\u06FF]');
  if (tp.length === 2 && /[A-Za-z]/.test(tp[1]) && !FA_RE.test(tp[1])) { tFa = tp[0]; tEn = tp[1]; }
  else if (tp.length === 2 && /[A-Za-z]/.test(tp[0]) && !FA_RE.test(tp[0])) { tFa = tp[1]; tEn = tp[0]; }

  /* ردیف متادیتا زیر عنوان: رده‌سنی / سال / مدت / IMDb / دوبله / زیرنویس */
  var metaParts = [];
  if (it.ageRating) metaParts.push('<span class="dm dm-age">' + esc(it.ageRating) + '</span>');
  if (yearLabel(it)) metaParts.push('<span class="dm dm-year">' + yearLabel(it) + '</span>');
  if (it.duration) metaParts.push('<span class="dm dm-dur">' + faNum(it.duration) + ' دقیقه</span>');
  if (isSeries) {
    var sc = it.seasonCount != null ? it.seasonCount : seasonsOf(it).length;
    if (sc) metaParts.push('<span class="dm">' + faNum(sc) + ' فصل</span>');
  }
  if (it.imdb) metaParts.push('<span class="dm dm-imdb"><b>IMDb</b>' + Number(it.imdb).toFixed(1) + '</span>');
  if (it.dubbed) metaParts.push('<span class="dm">🎙 دوبله فارسی</span>');
  if (it.subtitled) metaParts.push('<span class="dm">💬 زیرنویس</span>');
  if (live) metaParts.unshift('<span class="dm dm-live">' + esc(liveText) + '</span>');
  var metaRow = metaParts.length ? '<div class="d-meta-row">' + metaParts.join('') + '</div>' : '';

  var gens = (it.genres || []).map(function (g) {
    return '<a class="dg" href="#/catalog?genre=' + encodeURIComponent(g) + '">' + esc(g) + '</a>';
  }).join('');

  var price = data.hasSub ? 0 : (data.dlPrice || (APP.economy && APP.economy.dlClickPrice) || 0);
  var vanish = data.vanishSec || 10;

  /* دکمهٔ اصلی (مثل «ورود و پخش» نماوا) */
  var mainBtn;
  if (!APP.user) mainBtn = '<a class="btn btn-white btn-lg" href="#/auth">▶ ورود و دریافت</a>';
  else if (!canPlay) mainBtn = '<a class="btn btn-white btn-lg" href="#/subscribe">👑 خرید اشتراک و دریافت</a>';
  else mainBtn = '<button type="button" class="btn btn-white btn-lg" id="btn-dl-main">' + (isSeries ? '▶ دریافت قسمت‌ها' : '📥 دریافت فایل') + '</button>';
  var cta = '<div class="d-cta">' + mainBtn +
    '<button type="button" class="btn btn-ghost btn-ico" id="btn-share" title="اشتراک‌گذاری">🔗</button>' +
    ((APP.user && APP.user.role === 'admin') ? '<button type="button" class="btn btn-ghost btn-ico" id="btn-edit-item" title="ویرایش">✏️</button>' : '') +
    '</div>';

  var descHtml = it.description
    ? '<p class="d-desc clamp" id="d-desc">' + esc(it.description) + '</p><button type="button" class="d-more" id="d-more">بیشتر…</button>'
    : '';

  var hero = '<section class="dhero">' +
    (mainPoster ? '<div class="dhero-bg" style="background-image:url(' + esc(mainPoster) + ')"></div><div class="dhero-img" style="background-image:url(' + esc(mainPoster) + ')"></div>' : '') +
    '<div class="dhero-fade"></div>' +
    '<div class="dhero-in">' +
    '<div class="d-poster">' + (mainPoster ? '<img class="dp-img" src="' + esc(mainPoster) + '" alt="' + esc(it.title) + '">' : '') + '</div>' +
    '<div class="d-head">' +
    '<h1 class="d-title">' + esc(tFa) + '</h1>' +
    (tEn ? '<div class="d-title-en">' + esc(tEn) + '</div>' : '') +
    metaRow +
    (gens ? '<div class="d-genres">' + gens + '</div>' : '') +
    cta + descHtml +
    '</div></div></section>';

  /* کارت اطلاعات — مثل نماوا: دسته‌بندی / کشور / صدا / زیرنویس / شبکه / وضعیت پخش */
  function infoRow (ic, k, v, cls) {
    if (!v) return '';
    return '<div class="d-info-row"><span class="ic">' + ic + '</span><span class="k">' + k + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + v + '</span></div>';
  }
  var langs = [];
  if (it.dubbed) langs.push('فارسی');
  if (it.country && /ایران/.test(it.country)) { if (langs.indexOf('فارسی') < 0) langs.push('فارسی'); }
  var infoRows =
    infoRow('🔴', 'وضعیت پخش', live ? esc(liveText) : '', 'live') +
    infoRow('🎞', 'دسته‌بندی', (it.genres || []).length ? esc((it.genres || []).join('، ')) : '') +
    infoRow('🏳️', 'کشور سازنده', esc(it.country || '')) +
    infoRow('📅', isSeries ? 'سال پخش' : 'سال تولید', yearLabel(it)) +
    infoRow('🎙', 'صدا', it.dubbed ? 'دوبله فارسی' : (it.subtitled ? 'زبان اصلی' : '')) +
    infoRow('💬', 'زیرنویس', it.subtitled ? 'فارسی' : '') +
    infoRow('📺', 'شبکه', esc(it.network || '')) +
    infoRow('🔞', 'رده سنی', esc(it.ageRating || '')) +
    infoRow('👁', 'بازدید', it.views ? faNum(it.views) : '');
  var infoCard = infoRows ? '<section class="d-sec"><div class="d-info-card">' + infoRows + '</div></section>' : '';

  /* بازیگران و عوامل — دایره‌ای با اسکرول افقی */
  function splitPeople (str) {
    return String(str || '').split(/[,،]/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 20);
  }
  function personHtml (name, role) {
    var ini = name.charAt(0).toUpperCase();
    return '<a class="person" href="#/catalog?' + (role ? 'director' : 'actor') + '=' + encodeURIComponent(name) + '"><span class="av">' + esc(ini) + '</span><b>' + esc(name) + '</b>' + (role ? '<span>' + role + '</span>' : '') + '</a>';
  }
  var actors = splitPeople(it.actors);
  var directors = splitPeople(it.director);
  var castSec = actors.length
    ? '<section class="d-sec"><div class="d-sec-h">بازیگران ' + (isSeries ? 'سریال' : 'فیلم') + ' ' + esc(tFa) + '</div><div class="people">' + actors.map(function (a) { return personHtml(a, ''); }).join('') + '</div></section>'
    : '';
  var crewSec = directors.length
    ? '<section class="d-sec"><div class="d-sec-h">عوامل ' + (isSeries ? 'سریال' : 'فیلم') + ' ' + esc(tFa) + '</div><div class="people">' + directors.map(function (d) { return personHtml(d, 'کارگردان'); }).join('') + '</div></section>'
    : '';

  var note = '<div class="note">🛡 پخش آنلاین وجود ندارد. فایل فقط داخل ربات ارسال می‌شود و بعد از <b>' + faNum(vanish) + ' ثانیه</b> پاک می‌گردد.' +
    (data.hasSub
      ? '<br>👑 اشتراک فعال — دانلود نامحدود، بدون کسر سکه.'
      : (price > 0
        ? '<br>بدون اشتراک، هر دانلود <b>' + faMoney(price) + ' ' + unitName() + '</b> از کیف پول. با اشتراک، دانلود نامحدود و بدون کسر سکه است.'
        : '')) +
    '</div>';
  var lockNote = '';
  if (APP.user && !canPlay) lockNote = '<div class="note">👑 این اثر ویژهٔ مشترکین است. <a href="#/subscribe" style="color:var(--acc2);font-weight:800">خرید اشتراک</a> · <a href="#/wallet" style="color:var(--acc2);font-weight:800">کیف پول</a></div>';

  var dlPanel;
  if (isSeries) {
    dlPanel = '<div class="dl-box" id="dl-box"><div class="d-sec-h">📥 دانلود سریال' + (live ? ' <small>' + esc(liveText) + '</small>' : '') + '</div><div class="season-bar" id="season-bar"></div><div class="eps" id="ep-list"></div></div>';
  } else {
    dlPanel = '<div class="dl-box" id="dl-box"><div class="d-sec-h">📥 انتخاب کیفیت دانلود</div>' + trackTabsHtml('track-tabs', 'sub') + '<div id="q-row-wrap"></div></div>';
  }
  var related = '';
  if (data.related && data.related.length) {
    var relItems = data.related.map(function (r) { return { id: r.id, title: r.title, type: r.type, year: r.year, yearEnd: r.yearEnd, airing: r.airing, airingSeason: r.airingSeason, quality: r.quality, access: r.access, poster: r.poster, imdb: r.imdb, sizeBytes: null }; });
    related = rowHtml('🎯 مرتبط با این اثر', relItems);
  }
  return hero + '<div class="d-body">' +
    lockNote + dlPanel + note + infoCard + '<section class="d-sec detail-posters" aria-label="گالری پوسترها"><h2 class="d-sec-h">گالری پوسترها</h2>' + posterHtml + '</section>' + castSec + crewSec + related + footerHtml() +
    '</div>';
}

/* ═══════════ تبلیغ تایمردار پیش از هدایت به ربات ═══════════ */
var AD_LAYER = null;

function adCloseLayer () {
  if (AD_LAYER) {
    if (AD_LAYER.tick) clearInterval(AD_LAYER.tick);
    if (AD_LAYER.el && AD_LAYER.el.parentNode) AD_LAYER.el.parentNode.removeChild(AD_LAYER.el);
  }
  AD_LAYER = null;
  try { document.body.style.overflow = ''; } catch (e) { }
}

function openAdGateInfo (gate) {
  gate = gate || {};
  var note = gate.note || 'کاربران دارای اشتراک فعال هیچ تبلیغی نمی‌بینند.';
  var lines = String(note).split(NL).filter(function (x) { return x.trim(); });
  var html = '<div style="font-size:13.5px;color:var(--tx2);line-height:2">' +
    lines.map(function (l) { return '<p style="margin-bottom:8px">' + esc(l) + '</p>'; }).join('') +
    '</div>' +
    '<div class="note" style="margin-top:14px;margin-bottom:14px">⏱ حداکثر زمان هر تبلیغ ' + faNum(20) + ' ثانیه است و برای هر دانلود فقط یک تبلیغ نمایش داده می‌شود.</div>' +
    '<button class="btn btn-primary btn-block" id="adg-sub">✨ مشاهدهٔ طرح‌های اشتراک</button>';
  openModal(gate.title || 'دانلود بدون تبلیغ', html, function (wrap, close) {
    var b = $('#adg-sub', wrap);
    if (b) b.addEventListener('click', function () { close(); adCloseLayer(); nav('#/subscribe'); });
  });
}

function showAdThen (res, done) {
  var ad = res.ad || {};
  var gate = res.gateInfo || {};
  var total = Math.max(1, Math.min(20, Number(ad.sec) || 20));
  var remain = total;

  adCloseLayer();
  /* باگ لایه‌ها: مودال «دانلود قسمت» (z-index:400) روی تبلیغ (z-index:300) می‌ماند
     و کیفیت‌ها وسط تبلیغ دیده می‌شدند. تبلیغ باید تنها لایهٔ روی صفحه باشد،
     پس مودال بازِ انتخاب قسمت/کیفیت قبل از نمایش تبلیغ بسته می‌شود.
     (مودال خودِ تبلیغ — «حذف تبلیغ‌ها/اشتراک» — عمداً بالای تبلیغ باز می‌شود.) */
  closeModal();
  var el = document.createElement('div');
  el.className = 'adx';

  var mediaHtml;
  if (ad.kind === 'video') {
    mediaHtml = '<video id="adx-v" playsinline webkit-playsinline autoplay ' +
      (ad.muted === false ? '' : 'muted ') + 'preload="auto"' +
      (ad.posterUrl ? ' poster="' + esc(ad.posterUrl) + '"' : '') +
      ' src="' + esc(ad.mediaUrl) + '"></video>';
  } else {
    mediaHtml = '<img id="adx-i" alt="' + esc(ad.title || 'تبلیغ') + '" src="' + esc(ad.mediaUrl) + '">';
  }

  el.innerHTML =
    '<div class="adx-bar"><i id="adx-fill"></i></div>' +
    '<div class="adx-top">' +
      '<span class="adx-sec">⏳ <b id="adx-n">' + faNum(total) + '</b> ثانیه</span>' +
      '<button type="button" class="adx-nosub" id="adx-nosub">' + esc(gate.btnText || '🚫 حذف تبلیغ‌ها') + '</button>' +
    '</div>' +
    '<div class="adx-stage' + (ad.clickable ? '' : ' no-link') + '" id="adx-stage">' + mediaHtml +
      (ad.clickable ? '<span class="adx-cta">' + esc(ad.cta || 'برای مشاهده کلیک کنید') + ' ↗</span>' : '') +
    '</div>' +
    (ad.kind === 'video' ? '<button type="button" class="adx-mute" id="adx-mute">' + (ad.muted === false ? '🔊' : '🔇') + '</button>' : '') +
    '<div class="adx-foot"><button type="button" class="adx-go" id="adx-go" disabled>⏳ لطفاً تا پایان تبلیغ صبر کنید</button></div>';

  document.body.appendChild(el);
  try { document.body.style.overflow = 'hidden'; } catch (e) { }
  AD_LAYER = { el: el, tick: null };

  var fill = $('#adx-fill', el);
  var num = $('#adx-n', el);
  var go = $('#adx-go', el);
  var stage = $('#adx-stage', el);
  var finished = false;

  var media = $('#adx-v', el) || $('#adx-i', el);
  if (media) {
    media.addEventListener('error', function () {
      stage.innerHTML = '<div class="adx-fail">نمایش این تبلیغ ممکن نشد.' + NL + 'تایمر ادامه دارد و بعد از پایان، دانلود شما آزاد می‌شود.</div>';
    });
  }
  var vid = $('#adx-v', el);
  if (vid) {
    vid.addEventListener('ended', function () { try { vid.currentTime = 0; vid.play(); } catch (e) { } });
    try { var pp = vid.play(); if (pp && pp.catch) pp.catch(function () { }); } catch (e) { }
    var mb = $('#adx-mute', el);
    if (mb) mb.addEventListener('click', function (ev) {
      ev.stopPropagation();
      vid.muted = !vid.muted;
      mb.textContent = vid.muted ? '🔇' : '🔊';
      if (!vid.muted) { try { vid.play(); } catch (e) { } }
    });
  }

  if (ad.clickable) {
    stage.addEventListener('click', function () {
      haptic('light');
      api('/ad/' + ad.id + '/click', { method: 'POST' }).then(function (r) {
        openExt(r.url);
      }).catch(function () { });
    });
  }

  $('#adx-nosub', el).addEventListener('click', function () { openAdGateInfo(gate); });

  function paint () {
    var pct = ((total - remain) / total) * 100;
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (num) num.textContent = faNum(Math.max(0, remain));
  }
  paint();

  function unlock () {
    if (finished) return;
    finished = true;
    if (AD_LAYER && AD_LAYER.tick) clearInterval(AD_LAYER.tick);
    if (fill) fill.style.width = '100%';
    var sec = $('.adx-sec', el);
    if (sec) sec.innerHTML = '✅ تبلیغ تمام شد';
    go.className = 'adx-go on';
    go.disabled = false;
    go.innerHTML = '🚀 ادامه و دریافت فایل';
    haptic('light');
    go.addEventListener('click', function () {
      go.disabled = true;
      go.innerHTML = 'در حال آماده‌سازی…';
      api('/dl/gate/' + res.gate, { method: 'POST' }).then(function (g) {
        adCloseLayer();
        done(g);
      }).catch(function (e) {
        if (e.data && e.data.remain) {
          go.disabled = false;
          go.innerHTML = '🚀 ادامه و دریافت فایل';
          toast('هنوز ' + faNum(e.data.remain) + ' ثانیه مانده', 'err');
          return;
        }
        adCloseLayer();
        toast(e.message, 'err');
      });
    });
  }

  AD_LAYER.tick = setInterval(function () {
    remain -= 1;
    paint();
    if (remain <= 0) unlock();
  }, 1000);
}

function requestDownload (itemId, opts, btn) {
  opts = opts || {};
  if (!APP.user) { nav('#/auth'); return; }
  var orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  function release () { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }

  return api('/dl/request', { method: 'POST', body: { itemId: itemId, epId: opts.epId || '', track: opts.track || 'sub', quality: opts.quality || '', fileId: opts.fileId || '' } }).then(function (r) {
    if (APP.user) APP.user.wallet = r.wallet;
    release();
    var chargeMsg = r.charged
      ? (faMoney(r.charged) + ' ' + unitName() + ' کسر شد.')
      : (r.unlimited ? 'اشتراک فعال — بدون کسر سکه.' : '');
    if (chargeMsg) toast(chargeMsg, 'ok');

    closeModal();
    if (r.needAd && r.ad) {
      showAdThen(r, function (g) { openBot(g.botLink); });
      return;
    }
    openBot(r.botLink);
  }).catch(function (e) {
    release();
    if (e.data && e.data.needWallet) { toast('موجودی کافی نیست', 'err'); nav('#/wallet'); return; }
    if (e.data && e.data.needSub) { nav('#/subscribe'); return; }
    toast(e.message, 'err');
  });
}

function bindQualityClicks (root, it, track, ep, bagLock) {
  var variants = variantsOf(ep || it, it);
  $all('.q-btn', root).forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.classList.contains('lock')) {
        toast('این کیفیت فقط با اشتراک فعال در دسترس است', 'err');
        nav('#/subscribe');
        return;
      }
      /* رنگ دکمهٔ کیفیتِ انتخاب‌شده مثل حالت هاور می‌شود تا نسخه‌های زیر
         مشخص باشد برای کدام کیفیت است */
      $all('.q-btn', root).forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var q = b.getAttribute('data-q');
      var cell = (variants[track] || {})[q] || {};
      var files = cellFilesOf(cell);
      var alts = $('#q-alts', root) || $('#q-alts');
      /* نسخه‌ها را همیشه نشان بده — حتی وقتی کیفیت فقط یک نسخه دارد */
      if (files.length > 0 && alts) {
        alts.innerHTML = files.map(function (f, i) {
          var cell = (variants[track] || {})[q] || {};
          var qlab = cell.label || Q_LABEL[q] || q;
          var lab = (f.title && f.title.trim()) ? f.title : (qlab + (i ? (' — نسخه ' + faNum(i + 1)) : ''));
          return '<button type="button" class="q-alt" data-q="' + q + '" data-fid="' + esc(f.id || '') + '"><span>' + esc(lab) + '</span><span class="go">⬇</span></button>';
        }).join('');
        $all('.q-alt', alts).forEach(function (a) {
          a.addEventListener('click', function () {
            requestDownload(it.id, { epId: ep && ep.id, track: track, quality: a.getAttribute('data-q'), fileId: a.getAttribute('data-fid') }, a);
          });
        });
        return;
      }
      requestDownload(it.id, { epId: ep && ep.id, track: track, quality: q, fileId: (files[0] && files[0].id) || '' }, b);
    });
  });
}
function bindMovieDl (it) {
  var track = 'sub';
  var wrap = $('#q-row-wrap');
  if (!wrap) return;
  function paint () {
    wrap.innerHTML = qualityButtonsHtml(variantsOf(it, it), track, false);
    bindQualityClicks(wrap, it, track, null, false);
  }
  $all('#track-tabs .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      track = b.getAttribute('data-track');
      $all('#track-tabs .seg-btn').forEach(function (x) { x.className = 'seg-btn' + (x === b ? ' on' : ''); });
      paint();
    });
  });
  paint();
}

function openEpDlModal (it, ep) {
  /* حین پخش تبلیغ، مودال قسمت نباید روی تبلیغ باز شود */
  if (AD_LAYER) return;
  var track = 'sub';
  var html = trackTabsHtml('ep-track-tabs', 'sub') + '<div id="ep-q-wrap"></div>';
  openModal(ep.title || 'دانلود قسمت', html, function (wrap) {
    function paint () {
      var box = $('#ep-q-wrap', wrap);
      if (!box) return;
      box.innerHTML = qualityButtonsHtml(variantsOf(ep, it), track, !!ep.premium);
      bindQualityClicks(box, it, track, ep, !!ep.premium);
    }
    $all('#ep-track-tabs .seg-btn', wrap).forEach(function (b) {
      b.addEventListener('click', function () {
        track = b.getAttribute('data-track');
        $all('#ep-track-tabs .seg-btn', wrap).forEach(function (x) { x.className = 'seg-btn' + (x === b ? ' on' : ''); });
        paint();
      });
    });
    paint();
  });
}

function bindSeriesDl (it) {
  var seasons = seasonsOf(it);
  var sN = seasons.length ? (seasons[0].n || 1) : 1;
  /* اگر سریال در حال پخش است، فصلِ در حال پخش پیش‌فرض باشد */
  if (isAiring(it) && it.airingSeason) {
    seasons.forEach(function (s0) { if ((s0.n || 1) === parseInt(it.airingSeason, 10)) sN = s0.n || 1; });
  }
  var bar = $('#season-bar');
  var box = $('#ep-list');
  if (!bar || !box) return;
  function currentSeason () {
    var i;
    for (i = 0; i < seasons.length; i++) if ((seasons[i].n || 1) === sN) return seasons[i];
    return seasons[0];
  }
  function paintSeasons () {
    bar.innerHTML = seasons.map(function (s) {
      var n = s.n || 1;
      var liveDot = (isAiring(it) && parseInt(it.airingSeason, 10) === n) ? '<span class="live-dot"></span>' : '';
      return '<button type="button" class="season-chip' + (n === sN ? ' on' : '') + '" data-sn="' + n + '">' + liveDot + esc(s.title || ('فصل ' + n)) + '</button>';
    }).join('') || '<span style="color:var(--tx3);font-size:13px">فصلی ثبت نشده</span>';
    $all('.season-chip', bar).forEach(function (b) {
      b.addEventListener('click', function () {
        sN = parseInt(b.getAttribute('data-sn'), 10) || 1;
        paintSeasons();
        paintEps();
      });
    });
  }
  function paintEps () {
    var s = currentSeason() || { episodes: [] };
    var eps = s.episodes || [];
    box.innerHTML = eps.map(function (e, i) {
      return '<div class="ep" data-epid="' + esc(e.id) + '"><span class="ep-n">' + faNum(e.n || (i + 1)) + '</span><span class="ep-t">' + esc(e.title) + '</span><span class="go">⬇</span></div>';
    }).join('') || '<p style="color:var(--tx3);font-size:13px">قسمتی در این فصل نیست.</p>';
    $all('[data-epid]', box).forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-epid');
        var ep = null;
        var j;
        for (j = 0; j < eps.length; j++) if (eps[j].id === id) ep = eps[j];
        if (ep) openEpDlModal(it, ep);
      });
    });
  }
  paintSeasons();
  paintEps();
}

function bindItem (it, data) {
  bindPosterCarousel(it);
  bindGallery(it);
  var sh = $('#btn-share');
  if (sh) sh.addEventListener('click', function () { shareOrCopy(it); });
  var ed = $('#btn-edit-item');
  if (ed) ed.addEventListener('click', function () { nav('#/admin/content?edit=' + it.id); });
  var more = $('#d-more'), desc = $('#d-desc');
  if (more && desc) {
    /* اگر متن کوتاه است دکمهٔ «بیشتر» لازم نیست */
    if (desc.scrollHeight <= desc.clientHeight + 2) more.style.display = 'none';
    more.addEventListener('click', function () {
      var open = desc.classList.toggle('clamp');
      more.textContent = open ? 'بیشتر…' : 'کمتر';
    });
  }
  var main = $('#btn-dl-main');
  if (main) main.addEventListener('click', function () {
    var box = $('#dl-box');
    if (box) { try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { box.scrollIntoView(); } }
    var first = $('#dl-box .q-btn:not(.off)') || $('#dl-box .ep');
    if (first && it.type !== 'series' && $all('#dl-box .q-btn:not(.off)').length === 1) first.click();
  });
  if (it.type === 'series') bindSeriesDl(it);
  else bindMovieDl(it);
}
function shareOrCopy (it) {
  var siteUrl = location.origin + '/#/item/' + it.id;
  var miniUrl = miniAppItemUrl(it.id);
  var html = '<p class="note">لینک مینی‌اپ، تلگرام را روی صفحه همین فیلم یا سریال باز می‌کند. لینک سایت در مرورگر باز می‌شود.</p>' +
    '<div class="field"><label for="share-mini-url">لینک مینی‌اپ تلگرام</label><input id="share-mini-url" dir="ltr" readonly value="' + esc(miniUrl) + '"></div>' +
    '<div class="adm-row"><button type="button" class="btn btn-primary" id="share-mini-copy">کپی لینک مینی‌اپ</button><button type="button" class="btn btn-ghost" id="share-mini-send">اشتراک در تلگرام</button></div>' +
    '<div class="field" style="margin-top:20px"><label for="share-site-url">لینک سایت</label><input id="share-site-url" dir="ltr" readonly value="' + esc(siteUrl) + '"></div>' +
    '<button type="button" class="btn btn-ghost" id="share-site-copy">کپی لینک سایت</button>';
  openModal('اشتراک‌گذاری ' + (it.title || ''), html, function (wrap) {
    $('#share-mini-copy', wrap).addEventListener('click', function () { copyText(miniUrl, function () { toast('لینک مینی‌اپ کپی شد', 'ok'); }); });
    $('#share-site-copy', wrap).addEventListener('click', function () { copyText(siteUrl, function () { toast('لینک سایت کپی شد', 'ok'); }); });
    $('#share-mini-send', wrap).addEventListener('click', function () {
      openBot('https://t.me/share/url?url=' + encodeURIComponent(miniUrl) + '&text=' + encodeURIComponent(it.title || ''));
    });
    $all('input[readonly]', wrap).forEach(function (input) { input.addEventListener('click', function () { input.select(); }); });
  });
}

/* ═══════════ ورود با تلگرام ═══════════ */
function viewAuth (q) {
  if (APP.user) {
    return '<div class="auth"><div class="auth-card"><h2>✓ شما وارد هستید</h2><p class="auth-sub">به‌عنوان «' + esc(APP.user.tgName || APP.user.username) + '»</p>' +
      '<div class="d-actions" style="justify-content:center"><a class="btn btn-primary" href="#/">رفتن به سایت</a><a class="btn btn-ghost" href="#/account">حساب کاربری</a></div></div></div>';
  }
  return '<div class="auth"><div class="auth-card">' +
    '<h2>ورود / ثبت‌نام</h2>' +
    '<p class="auth-sub">با ربات تلگرام وارد شوید. پس از تأیید، دکمهٔ «ورود به مینی‌اپ» را در ربات بزنید.</p>' +
    '<div class="steps">' +
    '<div><b>۱.</b> دکمه زیر را بزنید؛ ربات باز می‌شود.</div>' +
    '<div><b>۲.</b> اگر قبلاً ثبت‌نام کرده‌اید همان‌جا ورود تأیید می‌شود. اگر تازه‌اید «ارسال شماره موبایل» و بعد نام.</div>' +
    '<div><b>۳.</b> در ربات روی «ورود به مینی‌اپ» بزنید تا وارد حساب خود شوید.</div>' +
    '</div>' +
    '<button type="button" class="tg-login" id="btn-tg-login"><span style="font-size:18px">✈️</span> ورود / ثبت‌نام با ربات</button>' +
    '<div class="fmsg" id="a-msg"></div>' +
    '</div></div>';
}
function bindAuth (q) {
  if (APP.user) return;
  var msg = $('#a-msg');
  if (q.ticket) setTick(q.ticket);
  if (getTick()) {
    if (msg) {
      msg.className = 'fmsg ok';
      msg.innerHTML = '<span class="poll-dot"></span>در انتظار تأیید ربات… پس از تأیید، روی «ورود به مینی‌اپ» بزنید.';
    }
    startLoginWatch();
  }
  var btn = $('#btn-tg-login');
  if (!btn) return;
  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'در حال باز کردن ربات…';
    api('/auth/start', { method: 'POST', body: { ref: q.ref || getRef() } }).then(function (r) {
      setTick(r.ticket);
      startLoginWatch();
      openBot(r.botLink);
      if (msg) {
        msg.className = 'fmsg ok';
        msg.innerHTML = '<span class="poll-dot"></span>در ربات ورود را تأیید کنید و سپس روی «ورود به مینی‌اپ» بزنید.';
      }
      btn.disabled = false;
      btn.innerHTML = '<span style="font-size:18px">✈️</span> ورود / ثبت‌نام با ربات';
    }).catch(function (e) {
      btn.disabled = false;
      btn.innerHTML = '<span style="font-size:18px">✈️</span> ورود / ثبت‌نام با ربات';
      if (msg) { msg.className = 'fmsg err'; msg.textContent = e.message; }
    });
  });
}

/* ═══════════ کیف پول / اشتراک / معرفی ═══════════ */
function viewWallet (data) {
  if (!APP.user) return emptyHtml('💰', 'وارد نشده‌اید', 'برای کیف پول ابتدا با تلگرام وارد شوید.', '<a class="btn btn-primary" href="#/auth">ورود با تلگرام</a>');
  var eco = (data && data.economy) || APP.economy || {};
  var w = (data && data.wallet != null) ? data.wallet : (APP.user.wallet || 0);
  var canTx = !!(data && data.canTransfer);
  var txs = (data && data.txs) || [];
  var starPacks = eco.starPacks || [];
  var shops = eco.starShops || [];
  var k2kPacks = eco.k2kPacks || [];
  var k2kHtml = k2kPacks.length && eco.k2kEnabled
    ? '<div class="adm-box"><h4>شارژ کارت‌به‌کارت ریالی</h4>' +
      '<div class="note">هر فاکتور یک <b>مبلغ یکتا</b> دارد. دقیقاً همان مبلغ را واریز کنید و دکمه تایید را بزنید. مهلت واریز ' + faNum(Math.round((eco.k2kTtlSec || 1800) / 60)) + ' دقیقه.</div>' +
      '<div class="packs">' + k2kPacks.map(function (p, i) {
        return '<div class="pack"><div><b>خرید ' + faMoney(p.units) + ' ' + unitName() + '</b><div class="v">' + faNum(p.toman) + ' تومان</div></div><button type="button" class="btn btn-primary btn-sm" data-k2k="' + i + '">کارت‌به‌کارت</button></div>';
      }).join('') + '</div></div>' : '';
  var starsHtml = starPacks.length && eco.starsEnabled !== false
    ? '<div class="adm-box"><h4>شارژ با استارز تلگرام</h4>' +
      '<div class="note">فاکتور رسمی تلگرام باز می‌شود. اگر استارز در اکانت دارید با یک کلیک پرداخت می‌شود. اگر ندارید، پایین صفحه با کارت شتاب بخرید (حدود ۲ دقیقه) و برگردید.</div>' +
      '<div class="packs">' + starPacks.map(function (p, i) {
      return '<div class="pack"><div><b>خرید ' + faMoney(p.units) + ' ' + unitName() + '</b><div class="v">' + faNum(p.stars) + ' استارز تلگرام</div></div><button class="btn btn-tg btn-sm" data-stars="' + i + '">پرداخت فاکتور</button></div>';
    }).join('') + '</div></div>' : '';
  function shopRow (sh) {
    var u = String(sh.url || '');
    var isTg = u.indexOf('t.me/') >= 0;
    return '<div class="pack"><div><b>' + esc(sh.title) + '</b><div class="v">' + esc(sh.note || u) + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-shop="' + esc(u) + '">' + (isTg ? 'باز کردن ربات' : 'باز کردن سایت') + '</button></div>';
  }
  var shopHead = shops.slice(0, 3);
  var shopRest = shops.slice(3);
  var moreLabel = 'دیدن بیشتر — ' + faNum(shopRest.length) + ' فروشگاه';
  var shopHtml = shops.length
    ? '<div class="adm-box"><h4>استارز ندارید؟ خرید با کارت شتاب</h4>' +
      '<div class="note">ما درگاه ریالی نداریم. استارز را از ربات یا سایت واسط بخرید، بعد همان بالا فاکتور رسمی را بپردازید. این‌ها واسطه‌اند نه تلگرام و نه این سایت.</div>' +
      '<div class="packs">' + shopHead.map(shopRow).join('') + '</div>' +
      (shopRest.length
        ? '<div class="packs" id="shop-more" style="display:none;margin-top:8px">' + shopRest.map(shopRow).join('') + '</div>' +
          '<button type="button" class="btn btn-ghost btn-block shop-more-btn" id="shop-more-btn" data-label="' + esc(moreLabel) + '">' + esc(moreLabel) + '</button>'
        : '') +
      '</div>'
    : '';
  var txHtml = txs.length
    ? '<div class="acc-rows tx-list">' + txs.map(function (t) {
      var pos = t.amount > 0;
      return '<div class="acc-row"><span>' + esc(t.note || t.type) + '<br><span style="font-size:11px;color:var(--tx3)">' + faDate(t.t) + '</span></span><span class="v" style="color:' + (pos ? 'var(--ok)' : 'var(--err)') + ';font-weight:800">' + (pos ? '+' : '') + faMoney(t.amount) + '</span></div>';
    }).join('') + '</div>'
    : '<p style="color:var(--tx3);font-size:13px;text-align:center">هنوز تراکنشی ندارید.</p>';
  return '<div class="acc">' +
    '<div class="wal-hero"><div class="n">' + faMoney(w) + '</div><div class="u">' + unitName() + (hasSub() ? ' • اشتراک فعال تا ' + faDate(APP.user.subUntil) : '') + '</div>' +
    '<div class="d-actions" style="justify-content:center;margin-top:14px">' +
    '<a class="btn btn-primary btn-sm" href="#/subscribe">👑 اشتراک</a>' +
    '<a class="btn btn-ghost btn-sm" href="#/referral">🎁 معرفی دوستان</a>' +
    '</div></div>' +
    k2kHtml + starsHtml + shopHtml +
    '<div class="adm-box"><h4>انتقال به کاربر دیگر</h4>' +
    '<div class="note">گیرنده را با <b>شماره موبایل</b> یا <b>یوزرنیم تلگرام</b> (@username) وارد کنید. انتقال فقط بعد از حداقل یک خرید موفق سکه با استارز ممکن است.</div>' +
    '<div class="field"><label>شماره یا یوزرنیم تلگرام گیرنده</label><input id="tr-to" placeholder="@username یا 09…" ' + (canTx ? '' : 'disabled') + '></div>' +
    '<div class="field"><label>مبلغ (' + unitName() + ')</label><input id="tr-am" type="number" min="1" step="1" ' + (canTx ? '' : 'disabled') + '></div>' +
    (canTx
      ? '<button class="btn btn-ghost btn-block" id="tr-go">ارسال</button>'
      : '<div class="note">برای باز شدن انتقال، یک‌بار سکه بخرید. شارژ مدیر یا کد تخفیف کافی نیست.</div>') +
    '</div>' +
    '<div class="adm-box"><h4>کد تخفیف</h4><div class="adm-row"><input id="rd-code" placeholder="XXXX-XXXX" style="flex:1;letter-spacing:2px"><button class="btn btn-primary btn-sm" id="rd-go">اعمال</button></div></div>' +
    '<div class="d-sec-h">تاریخچه</div>' + txHtml +
    '</div>';
}
function bindWallet () {
  $all('[data-shop]').forEach(function (b) {
    b.addEventListener('click', function () { openExt(b.getAttribute('data-shop')); });
  });
  var moreBtn = $('#shop-more-btn');
  if (moreBtn) moreBtn.addEventListener('click', function () {
    var box = $('#shop-more');
    if (!box) return;
    var hide = box.style.display === 'none';
    box.style.display = hide ? 'flex' : 'none';
    moreBtn.textContent = hide ? 'نمایش کمتر' : (moreBtn.getAttribute('data-label') || 'دیدن بیشتر');
  });
  $all('[data-stars]').forEach(function (b) {
    b.addEventListener('click', function () {
      api('/wallet/stars', { method: 'POST', body: { pack: parseInt(b.getAttribute('data-stars'), 10) } }).then(function (r) {
        toast(r.sent ? 'فاکتور رسمی تلگرام ارسال شد. اگر استارز دارید یک‌کلیکی بپردازید.' : 'ربات را باز کنید و فاکتور را بپردازید. استارز ندارید؟ از راهنمای همین صفحه بخرید.', 'ok');
        openBot(r.botLink);
      }).catch(function (e) { toast(e.message, 'err'); });
    });
  });
  var tr = $('#tr-go');
  if (tr) tr.addEventListener('click', function () {
    var to = $('#tr-to').value.trim();
    var am = parseFloat($('#tr-am').value);
    if (!to || !(am > 0)) { toast('گیرنده و مبلغ را وارد کنید', 'err'); return; }
    tr.disabled = true;
    api('/wallet/transfer', { method: 'POST', body: { to: to, amount: am } }).then(function (r) {
      APP.user.wallet = r.wallet;
      toast('انتقال انجام شد ✓', 'ok');
      nav('#/wallet');
    }).catch(function (e) { toast(e.message, 'err'); tr.disabled = false; });
  });
  var rd = $('#rd-go');
  if (rd) rd.addEventListener('click', function () {
    api('/wallet/redeem', { method: 'POST', body: { code: $('#rd-code').value.trim() } }).then(function (r) {
      APP.user.wallet = r.wallet;
      toast(faMoney(r.units) + ' ' + unitName() + ' اضافه شد', 'ok');
      nav('#/wallet');
    }).catch(function (e) { toast(e.message, 'err'); });
  });
  $all('[data-k2k]').forEach(function (b) {
    b.addEventListener('click', function () {
      openK2kGuide(parseInt(b.getAttribute('data-k2k'), 10));
    });
  });
}
function k2kPad(n) { n = Math.floor(n); if (n < 0) n = 0; return (n < 10 ? '0' : '') + n; }
function k2kOnlyDigits(s) {
  var t = String(s || ''), o = '', i, c;
  for (i = 0; i < t.length; i++) { c = t.charAt(i); if (c >= '0' && c <= '9') o += c; }
  return o;
}
function k2kFaDigits(s) {
  var fa = '۰۱۲۳۴۵۶۷۸۹', t = String(s || ''), o = '', i, c;
  for (i = 0; i < t.length; i++) {
    c = t.charAt(i);
    o += (c >= '0' && c <= '9') ? fa.charAt(c.charCodeAt(0) - 48) : c;
  }
  return o;
}
function k2kGateClose() {
  var root = $('#modal-root');
  if (root) root.innerHTML = '';
}
function openK2kGuide(packIdx) {
  var root = $('#modal-root');
  if (!root) return;
  root.innerHTML =
    '<div class="k2k-gate">' +
      '<div class="k2k-gbar"><button type="button" class="k2k-back" id="k2k-x">‹</button><b>پرداخت کارت‌به‌کارت</b><span style="width:36px"></span></div>' +
      '<div class="k2k-body">' +
        '<div class="k2k-guide">' +
          '<div class="k2k-q">؟</div>' +
          '<h3>راهنمای پرداخت آسان</h3>' +
          '<div class="k2k-step"><span>' + k2kFaDigits('1') + '</span><div><b>کپی شماره کارت</b><p>با دکمهٔ «کپی» کنار شماره، کارت را کپی کنید</p></div></div>' +
          '<div class="k2k-step"><span>' + k2kFaDigits('2') + '</span><div><b>واریز مبلغ یکتای فاکتور</b><p>عدد نمایش‌داده‌شده مخصوص شماست. دقیقاً همان را واریز کنید؛ کم یا زیاد نشود</p></div></div>' +
          '<div class="k2k-step"><span>' + k2kFaDigits('3') + '</span><div><b>تایید واریز</b><p>پس از انجام کارت‌به‌کارت، روی دکمه «واریز را انجام دادم» کلیک کنید تا سیستمی بررسی شود</p></div></div>' +
          '<button type="button" class="k2k-go" id="k2k-accept">شرایط را خواندم</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  var xb = $('#k2k-x');
  if (xb) xb.addEventListener('click', k2kGateClose);
  var acc = $('#k2k-accept');
  if (acc) acc.addEventListener('click', function () {
    acc.disabled = true;
    acc.textContent = 'در حال صدور فاکتور…';
    api('/wallet/k2k', { method: 'POST', body: { pack: packIdx } }).then(function (inv) {
      openK2kInvoice(inv);
    }).catch(function (e) {
      toast(e.message, 'err');
      k2kGateClose();
    });
  });
}
function openK2kInvoice(inv) {
  if (!inv || !inv.id) { toast('فاکتور ساخته نشد', 'err'); k2kGateClose(); return; }
  var root = $('#modal-root');
  if (!root) return;
  var digits = k2kOnlyDigits(inv.cardNumber || '');
  var g = [], gi;
  for (gi = 0; gi < 16; gi += 4) g.push(k2kFaDigits(digits.slice(gi, gi + 4) || '0000'));
  function k2kAsMs(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return 0;
    if (n < 1e11) n *= 1000;
    return n;
  }
  var remain0 = Number(inv.remainingMs);
  if (!isFinite(remain0) || remain0 < 0) remain0 = Math.max(0, k2kAsMs(inv.expiresAt) - Date.now());
  var deadline = Date.now() + remain0;
  var totalMs = Math.max(1000, k2kAsMs(inv.expiresAt) - k2kAsMs(inv.createdAt) || remain0);
  root.innerHTML =
    '<div class="k2k-gate" id="k2k-gate">' +
      '<div class="k2k-gbar"><button type="button" class="k2k-back" id="k2k-x">‹</button><b>پرداخت کارت‌به‌کارت</b><span style="width:36px"></span></div>' +
      '<div class="k2k-body" id="k2k-body">' +
        '<div class="k2k-row">' +
          '<div class="k2k-visa">' +
            '<div class="k2k-chip"></div>' +
            '<div class="who">' + esc(inv.cardHolder || 'دارنده کارت') + '</div>' +
            '<div class="nums"><span>' + g[0] + '</span><span>' + g[1] + '</span><span>' + g[2] + '</span><span>' + g[3] + '</span></div>' +
            '<div class="bank">' + esc(inv.cardBank || 'بانک') + '</div>' +
          '</div>' +
          '<div class="k2k-side">' +
            '<div class="k2k-pill" id="k2k-livebox">' +
              '<div class="k2k-live"><i class="k2k-dot"></i> <span id="k2k-live-tx">منتظر واریز</span></div>' +
              '<div class="k2k-sub" id="k2k-st">بعد از واریز، روی دکمه تایید کلیک کنید</div>' +
            '</div>' +
            '<div class="k2k-pill">' +
              '<div class="k2k-clock" id="k2k-clock">۳۰:۰۰</div>' +
              '<div class="k2k-sub" style="text-align:center">مهلت پرداخت</div>' +
              '<div class="k2k-bar"><i id="k2k-bar"></i></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="k2k-amtbox">' +
          '<div class="lbl">مبلغ دقیق این فاکتور</div>' +
          '<div class="big" id="k2k-amt">' + faNum(inv.amountToman) + '</div>' +
          '<div class="rial">تومان — معادل ' + faNum(inv.amountRial) + ' ریال' + (inv.extraToman ? (' — یکتا +' + faNum(inv.extraToman)) : '') + '</div>' +
          '<div class="k2k-exact">این مبلغ مخصوص همین فاکتور است. در همراه‌بانک دقیقاً همین عدد را وارد کنید. اگر حتی یک تومان کم یا زیاد باشد، واریز شما شناسایی نمی‌شود.</div>' +
          '<div class="k2k-line"><div class="val" id="k2k-amt-en">' + faNum(inv.amountToman) + ' تومان</div>' +
            '<button type="button" class="k2k-copy" id="k2k-copy-amt">کپی مبلغ</button></div>' +
          '<div class="lbl" style="margin-top:14px">شماره کارت</div>' +
          '<div class="k2k-line"><div class="val" id="k2k-card">' + esc(inv.cardNumberFmt || digits) + '</div>' +
            '<button type="button" class="k2k-copy" id="k2k-copy-card">کپی کارت</button></div>' +
        '</div>' +
        '<div class="k2k-track" id="k2k-track-box">' +
          '<label style="text-align:center;margin-bottom:12px;">پس از واریز دقیق مبلغ فوق، روی دکمه زیر کلیک کنید.</label>' +
          '<button type="button" class="k2k-go" id="k2k-send-track" style="margin-top:0;">واریز را انجام دادم</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  var stopped = false, checking = false, iv = null, paid = false, submitted = !!(inv.status === 'submitted');
  function stopAll() { stopped = true; if (iv) clearInterval(iv); }
  function closeAndCancel() {
    if (!paid && !submitted && inv.id) api('/wallet/k2k/' + inv.id + '/cancel', { method: 'POST' }).catch(function () {});
    stopAll();
    k2kGateClose();
  }
  function paintRemain(left) {
    left = Math.max(0, Number(left) || 0);
    var el = $('#k2k-clock');
    var mm = Math.floor(left / 60000);
    var ss = Math.floor((left / 1000) % 60);
    if (el) el.textContent = k2kFaDigits(k2kPad(mm) + ':' + k2kPad(ss));
    var bar = $('#k2k-bar');
    if (bar) {
      var pct = Math.max(0, Math.min(100, (left / totalMs) * 100));
      bar.style.width = pct + '%';
    }
  }
  function showPaid(wallet) {
    paid = true;
    stopAll();
    if (wallet != null && APP.user) APP.user.wallet = wallet;
    var body = $('#k2k-body');
    if (body) body.innerHTML = '<div class="k2k-ok"><div class="ck">✓</div><h3>پرداخت تایید شد</h3><p class="k2k-sub">سکه به کیف پول اضافه شد</p></div>';
    toast('واریز تایید شد ✓ سکه اضافه شد', 'ok');
    setTimeout(function () { k2kGateClose(); nav('#/wallet'); }, 1600);
  }
  function showRejected() {
    stopAll();
    var body = $('#k2k-body');
    if (body) body.innerHTML = '<div class="k2k-ok"><div class="ck" style="background:#e11d48">✕</div><h3>تأیید نشد</h3><p class="k2k-sub">مبلغ واریزی با فاکتور مطابقت نداشت</p></div>';
  }
  function showWait(code) {
    submitted = true;
    var liveTx = $('#k2k-live-tx');
    if (liveTx) liveTx.textContent = 'منتظر مدیر';
    var st = $('#k2k-st');
    if (st) st.textContent = 'ارسال شد — مدیر بررسی می‌کند';
    var box = $('#k2k-track-box');
    if (box) {
      var when = (inv.transferDate || '') + ' ' + (inv.transferTime || '');
      box.innerHTML = '<div class="k2k-wait"><div class="k2k-live"><i class="k2k-dot"></i> ارسال شد</div><b>مبلغ ' + faNum(inv.amountToman) + ' تومان</b><p class="k2k-sub">زمان اعلام: ' + esc(when.trim() || '') + '</p><p class="k2k-sub">اعلان برای مدیر فرستاده شد. تطبیق فقط با مبلغ یکتا انجام می‌شود.</p></div>';
    }
  }
  function showDead(msg) {
    if (submitted) return;
    stopAll();
    var gate = $('#k2k-gate');
    if (gate) gate.className = 'k2k-gate k2k-dead';
    var st = $('#k2k-st');
    if (st) st.textContent = msg || 'مهلت تمام شد';
    var liveEl = $('#k2k-livebox');
    if (liveEl) {
      var t = $('.k2k-live', liveEl);
      if (t) t.innerHTML = '<i class="k2k-dot"></i> منقضی';
    }
    paintRemain(0);
    var send = $('#k2k-send-track');
    if (send) send.disabled = true;
  }
  function poll() {
    if (stopped || checking) return;
    checking = true;
    api('/wallet/k2k/' + inv.id).then(function (r) {
      if (stopped) return;
      if (r.status === 'paid') { showPaid(r.wallet); return; }
      if (r.status === 'rejected') { showRejected(); return; }
      if (r.status === 'submitted') { showWait(r.trackCode); return; }
      if (r.status === 'expired' || r.status === 'cancelled') { showDead(r.status === 'expired' ? 'مهلت فاکتور تمام شد' : 'لغو شد'); return; }
    }).catch(function () {}).then(function () { checking = false; });
  }
  paintRemain(remain0);
  if (inv.status === 'submitted') showWait(inv.trackCode);
  var tickN = 0;
  iv = setInterval(function () {
    if (stopped) return;
    if (!submitted) {
      var left = Math.max(0, deadline - Date.now());
      paintRemain(left);
      if (left <= 0) { showDead('مهلت فاکتور تمام شد'); return; }
    }
    tickN += 1;
    if (tickN % 5 === 0) poll();
  }, 1000);
  function flashCopy(btn, label) {
    if (!btn) return;
    btn.className = 'k2k-copy on';
    btn.textContent = 'کپی شد ✓';
    setTimeout(function () { btn.className = 'k2k-copy'; btn.textContent = label; }, 1400);
  }
  var xa = $('#k2k-copy-amt');
  if (xa) xa.addEventListener('click', function () {
    copyText(String(inv.amountToman), function () { flashCopy(xa, 'کپی مبلغ'); });
  });
  var xc = $('#k2k-copy-card');
  if (xc) xc.addEventListener('click', function () {
    copyText(digits, function () { flashCopy(xc, 'کپی کارت'); });
  });
  var xb = $('#k2k-x');
  if (xb) xb.addEventListener('click', closeAndCancel);
  var send = $('#k2k-send-track');
  if (send) send.addEventListener('click', function () {
    var tehran = new Date(Date.now() + (3 * 60 + 30) * 60000);
    var date = tehran.getUTCFullYear() + '-' + k2kPad(tehran.getUTCMonth() + 1) + '-' + k2kPad(tehran.getUTCDate());
    var time = k2kPad(tehran.getUTCHours()) + ':' + k2kPad(tehran.getUTCMinutes());
    var code = '';
    send.disabled = true;
    send.textContent = 'در حال ارسال…';
    api('/wallet/k2k/' + inv.id + '/track', { method: 'POST', body: { trackCode: code, transferDate: date, transferTime: time } }).then(function (r) {
      inv.status = r.status;
      inv.trackCode = r.trackCode;
      inv.transferDate = r.transferDate;
      inv.transferTime = r.transferTime;
      showWait(r.trackCode);
      toast('ارسال شد — منتظر تأیید مدیر', 'ok');
    }).catch(function (e) {
      send.disabled = false;
      send.textContent = 'ارسال برای تأیید';
      toast(e.message, 'err');
    });
  });
}

function viewSubscribe () {
  if (!APP.user) return emptyHtml('👑', 'وارد نشده‌اید', 'برای خرید اشتراک ابتدا وارد شوید.', '<a class="btn btn-primary" href="#/auth">ورود با تلگرام</a>');
  var plans = (APP.economy && APP.economy.plans) || {};
  var items = [
    ['1m', 'یک‌ماهه', '۳۰ روز دانلود نامحدود بدون کسر سکه'],
    ['3m', 'سه‌ماهه', '۹۰ روز دانلود نامحدود — به‌صرفه‌تر'],
    ['6m', 'شش‌ماهه', '۱۸۰ روز دانلود نامحدود'],
    ['1y', 'یک‌ساله', '۳۶۵ روز دانلود نامحدود — بهترین قیمت']
  ];
  var cards = items.map(function (p) {
    var price = Number(plans[p[0]]) || 0;
    return '<div class="plan"><h4>' + p[1] + '</h4><div class="pr">' + faMoney(price) + ' <span style="font-size:13px;font-weight:600">' + unitName() + '</span></div><div class="ds">' + p[2] + '</div>' +
      '<button class="btn btn-primary btn-block" data-plan="' + p[0] + '">خرید از کیف پول</button></div>';
  }).join('');
  return '<div class="acc"><h2 style="font-size:20px;font-weight:900;margin-bottom:8px">👑 اشتراک</h2>' +
    '<p style="color:var(--tx2);font-size:13.5px;margin-bottom:16px">با اشتراک، همهٔ فیلم‌ها و سریال‌ها را نامحدود و بدون کسر سکه دانلود می‌کنید. سکه فقط از کاربران بدون اشتراک بابت هر دانلود کم می‌شود. خودِ اشتراک از کیف پول پرداخت می‌شود.</p>' +
    (hasSub() ? '<div class="note">اشتراک فعلی تا <b>' + faDate(APP.user.subUntil) + '</b> فعال است. خرید جدید به انتهای همان تاریخ اضافه می‌شود.</div>' : '') +
    '<div class="plans">' + cards + '</div>' +
    '<p style="font-size:12.5px;color:var(--tx3);text-align:center">موجودی: ' + faMoney(APP.user.wallet) + ' ' + unitName() + ' — <a href="#/wallet" style="color:var(--acc2)">شارژ کیف پول</a></p>' +
    '</div>';
}
function bindSubscribe () {
  $all('[data-plan]').forEach(function (b) {
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/subscribe', { method: 'POST', body: { plan: b.getAttribute('data-plan') } }).then(function (r) {
        APP.user = r.user;
        toast('اشتراک فعال شد ✓', 'ok');
        nav('#/account');
      }).catch(function (e) {
        b.disabled = false;
        if (e.status === 402) { toast('موجودی کافی نیست', 'err'); nav('#/wallet'); }
        else toast(e.message, 'err');
      });
    });
  });
}

function viewReferral () {
  if (!APP.user) return emptyHtml('🎁', 'وارد نشده‌اید', '', '<a class="btn btn-primary" href="#/auth">ورود با تلگرام</a>');
  var code = APP.user.refCode || '';
  var bonus = (APP.economy && APP.economy.refSignupBonus) || 0;
  var pct = (APP.economy && APP.economy.refPurchasePercent) || 0;
  return '<div class="acc"><div class="acc-card"><div style="font-size:40px">🎁</div>' +
    '<div class="acc-name">کد معرفی شما</div>' +
    '<div style="font-size:28px;font-weight:900;letter-spacing:3px;margin:8px 0;color:var(--acc2)">' + esc(code) + '</div>' +
    '<p class="auth-sub">با هر ثبت‌نام جدید ' + faMoney(bonus) + ' ' + unitName() + ' می‌گیرید. وقتی دعوت‌شده با درگاه سایت یا استارز برای خودش سکه بخرد، ' + faNum(pct) + '٪ از همان سکه‌ها به شما اضافه می‌شود.</p>' +
    '<div class="d-actions" style="justify-content:center"><button class="btn btn-primary" id="ref-bot">✈️ لینک ربات</button></div></div>' +
    '<div class="acc-rows"><div class="acc-row"><span>تعداد دعوت موفق</span><span class="v">' + faNum(APP.user.refCount || 0) + '</span></div></div></div>';
}
function bindReferral () {
  var code = APP.user && APP.user.refCode;
  var b = $('#ref-bot');
  if (b) b.addEventListener('click', function () {
    if (!code || !APP.economy || !APP.economy.botUsername) {
      toast('لینک معرفی ربات در دسترس نیست', 'err');
      return;
    }
    var bot = 'https://t.me/' + APP.economy.botUsername + '?start=ref_' + encodeURIComponent(code);
    copyText(bot, function () { toast('لینک ربات کپی شد', 'ok'); });
  });
}

/* ═══════════ حساب کاربری ═══════════ */
function viewAccount () {
  if (!APP.user) return emptyHtml('👤', 'وارد نشده‌اید', 'برای مشاهدهٔ حساب، با تلگرام وارد شوید.', '<a class="btn btn-primary" href="#/auth">ورود با تلگرام</a>');
  var u = APP.user;
  var nm = u.tgName || u.username;
  var role = u.role === 'admin' ? '<span class="badge gold">مدیر سایت</span>' : (hasSub(u) ? '<span class="badge acc">اشتراک فعال</span>' : '<span class="badge">بدون اشتراک</span>');
  var av = u.photo
    ? '<img class="acc-avatar" src="' + esc(u.photo) + '" alt="">'
    : '<div class="acc-avatar">' + esc(nm.charAt(0).toUpperCase()) + '</div>';
  var handle = u.tgUsername ? ('@' + u.tgUsername) : ('@' + u.username);
  return '<div class="acc">' +
    '<div class="acc-card">' + av +
    '<div class="acc-name">' + esc(nm) + '</div>' +
    '<div class="acc-mail">' + esc(handle) + (u.phone ? ' • ' + esc(u.phone) : '') + '</div>' +
    '<div style="margin-top:10px">' + role + '</div></div>' +
    '<div class="acc-rows">' +
    '<div class="acc-row"><span>کیف پول</span><span class="v">' + faMoney(u.wallet) + ' ' + unitName() + '</span></div>' +
    '<div class="acc-row"><span>اشتراک</span><span class="v">' + (hasSub(u) ? ('تا ' + faDate(u.subUntil)) : 'ندارد') + '</span></div>' +
    '<div class="acc-row"><span>کد معرفی</span><span class="v">' + esc(u.refCode || '—') + '</span></div>' +
    '<div class="acc-row"><span>تاریخ عضویت</span><span class="v">' + faDate(u.createdAt) + '</span></div>' +
    '<div class="acc-row"><span>آخرین ورود</span><span class="v">' + faDate(u.lastLogin) + '</span></div>' +
    (u.tgId ? '<div class="acc-row"><span>اتصال تلگرام</span><span class="v" style="color:var(--ok)">✓ متصل</span></div>' : '') +
    '</div>' +
    '<div class="d-actions" style="margin-bottom:12px">' +
    '<a class="btn btn-primary" href="#/wallet">💰 کیف پول</a>' +
    '<a class="btn btn-ghost" href="#/subscribe">👑 اشتراک</a>' +
    '<a class="btn btn-ghost" href="#/referral">🎁 معرفی</a>' +
    '</div>' +
    (u.role === 'admin' ? '<a class="btn btn-primary btn-block" href="#/admin">⚙️ پنل مدیریت</a>' : '') +
    '<button class="btn btn-danger btn-block" id="btn-logout" style="margin-top:14px">خروج از حساب</button>' +
    '</div>';
}
function bindAccount () {
  var b = $('#btn-logout');
  if (b) b.addEventListener('click', function () {
    setToken('');
    setTick('');
    stopPoll();
    APP.user = null;
    toast('خارج شدید — برای ورود دوباره به ربات بروید');
    nav('#/');
  });
}

/* ═══════════ پنل مدیریت ═══════════ */
function adminNav (tab) {
  var tabs = [['overview', '📊 نمای کلی'], ['content', '🎬 محتوا'], ['ads', '📢 تبلیغات'], ['users', '👥 کاربران'], ['pays', '💳 پرداخت‌ها'], ['codes', '🎫 کد تخفیف'], ['settings', '⚙️ تنظیمات']];
  return '<div class="adm"><div class="adm-nav">' + tabs.map(function (t) {
    return '<button data-at="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
  }).join('') + '</div><div class="adm-pane" id="adm-pane"></div></div>';
}
function bindAdminNav () {
  $all('.adm-nav [data-at]').forEach(function (b) {
    b.addEventListener('click', function () { nav('#/admin/' + b.getAttribute('data-at')); });
  });
}
function loadAdminTab (tab, q) {
  var pane = $('#adm-pane');
  if (!pane) return;
  pane.innerHTML = '<div class="spin"></div>';
  var promise;
  if (tab === 'overview') promise = api('/admin/overview');
  else if (tab === 'content') promise = api('/catalog').then(function (c) { return c; });
  else if (tab === 'ads') promise = api('/admin/ads');
  else if (tab === 'users') promise = api('/admin/users');
  else if (tab === 'pays') promise = api('/admin/k2k');
  else if (tab === 'codes') promise = api('/admin/codes');
  else if (tab === 'settings') promise = api('/admin/overview');
  else promise = api('/admin/overview');
  promise.then(function (data) { pane.innerHTML = adminTabHtml(tab, data, q); bindAdminTab(tab, q); })
    .catch(function (e) { pane.innerHTML = emptyHtml('⚠️', 'خطا', e.message); });
}
function bindDatabaseMaintenance () {
  var scan = $('#db-scan'), clean = $('#db-clean'), group = $('#db-prefix'), report = $('#db-report');
  if (!scan || !clean || !group) return;
  var cursor = '', candidates = [], done = false;
  group.addEventListener('change', function () { cursor = ''; candidates = []; done = false; clean.disabled = true; scan.textContent = 'بررسی ۱۰ کلید'; report.textContent = 'گروه جدید آماده بررسی است.'; });
  function busy(on) { scan.disabled = on; group.disabled = on; clean.disabled = on || !candidates.length; }
  scan.addEventListener('click', function () {
    busy(true);
    api('/admin/maintenance', {method:'POST', body:{prefix:group.value, cursor:done ? '' : cursor}}).then(function (r) {
      cursor = r.cursor || ''; done = !cursor; candidates = r.candidates || [];
      report.textContent = 'بررسی‌شده: ' + faNum(r.scanned) + '؛ قابل پاک‌سازی: ' + faNum(candidates.length) + (done ? '؛ پایان این گروه.' : '؛ برای ادامه، بررسی بعدی را بزنید.');
      candidates.forEach(function (entry) { var line = document.createElement('div'); line.textContent = entry.key + ' — ' + entry.reason; report.appendChild(line); });
      scan.textContent = done ? 'بررسی دوباره از ابتدا' : 'بررسی ۱۰ کلید بعدی';
    }).catch(function (e) { candidates = []; report.textContent = e.message; }).finally(function () { busy(false); });
  });
  clean.addEventListener('click', function () {
    if (!candidates.length || !confirm('پس از تهیه پشتیبان، ' + faNum(candidates.length) + ' ارجاع بدون صاحب حذف شود؟ این عملیات برگشت‌پذیر نیست.')) return;
    busy(true);
    api('/admin/maintenance', {method:'POST', body:{action:'delete', confirm:'DELETE_ORPHANS', keys:candidates.map(function (x) { return x.key; })}}).then(function (r) {
      candidates = []; report.textContent = 'حذف‌شده: ' + faNum(r.deleted) + '؛ حفظ‌شده پس از بررسی مجدد: ' + faNum(r.skipped);
    }).catch(function (e) { report.textContent = e.message; }).finally(function () { busy(false); });
  });
}
function contentSetupHtml (status) {
  status=status || {steps:[]};
  return '<div class="adm-box" style="margin-top:24px"><h4>راه‌اندازی ربات مدیریت — قدم‌به‌قدم</h4>' +
    '<p class="note">ابتدا ربات را بدون انتقال کانال‌ها راه بیندازید. اعداد 42 و -1001111111111 فقط نمونه‌اند. توکن و رمز را در چت یا کد سایت ننویسید.</p>' +
    (status.steps || []).map(function (step) { return '<div class="note"><b>' + (step.ok ? '✅ ' : '⚠️ ') + esc(step.title) + '</b><br>' + esc(step.help) + '</div>'; }).join('') +
    '<div class="field"><label>شناسه تلگرام همین حساب مدیر — برای CONTENT_ADMIN_IDS</label><input id="content-admin-id" readonly dir="ltr" value="' + esc(status.adminId || '') + '"></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="content-admin-copy">کپی شناسه مدیر</button>' +
    '<div class="field" style="margin-top:16px"><label>ساخت رمز CONTENT_WEBHOOK_SECRET</label><input id="content-secret-value" readonly dir="ltr" autocomplete="off" placeholder="با دکمه زیر ساخته می‌شود"></div>' +
    '<div class="adm-row"><button type="button" class="btn btn-ghost" id="content-secret-generate">ساخت رمز تصادفی</button><button type="button" class="btn btn-ghost" id="content-secret-copy">کپی رمز ساخته‌شده</button></div>' +
    '<p class="note">این رمز فقط در مرورگر ساخته می‌شود و اینجا ذخیره نمی‌شود. در Cloudflare → Worker سایت → Settings → Variables and Secrets → Add، نام CONTENT_WEBHOOK_SECRET و نوع Secret را انتخاب و رمز را وارد کنید.</p>' +
    '<details style="margin:18px 0"><summary>ساخت تنظیم کانال بدون نوشتن JSON</summary><p class="note">برای شروع فقط کانال منبع را وارد کنید؛ مقصد را خالی بگذارید تا انتقال غیرفعال بماند. می‌توانید لینک یک پست کانال خصوصی یا شناسه عددی -100… را وارد کنید.</p>' +
    '<div class="field"><label>کانال منبع</label><input id="content-source-id" dir="ltr" placeholder="لینک یک پست از کانال خودتان"></div>' +
    '<div class="field"><label>شناسه مدیر مسئول کانال</label><input id="content-rule-admin" dir="ltr" value="' + esc(status.adminId || '') + '"></div>' +
    '<div class="field"><label>مقصدهای انتقال — اختیاری، هر خط یک کانال، حداکثر ۳ مقصد</label><textarea id="content-target-ids" dir="ltr" rows="3"></textarea></div>' +
    '<button type="button" class="btn btn-ghost" id="content-rules-generate">ساخت تنظیم کانال</button>' +
    '<div class="field"><label>متن آماده برای CONTENT_CHANNEL_RULES</label><textarea id="content-rules-value" dir="ltr" readonly rows="7"></textarea></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="content-rules-copy">کپی تنظیم کانال</button>' +
    '<p class="note">این ابزار یک کانال می‌سازد و تنظیمات موجود را تغییر نمی‌دهد. متن خروجی را در Variable از نوع Text با نام CONTENT_CHANNEL_RULES بگذارید. اگر چند منبع دارید، خروجی را بدون ادغام جایگزین تنظیم فعلی نکنید.</p></details>' +
    '<p class="note">پس از ذخیره تنظیمات Cloudflare، این صفحه را تازه کنید. علامت سبز فقط وجود/ساختار تنظیم را نشان می‌دهد؛ صحت توکن و مجوز کانال هنگام استفاده بررسی می‌شود.</p>' +
    '<button type="button" class="btn btn-primary" id="content-bot-setup">اتصال ربات به سایت</button><div id="content-bot-status" class="note" aria-live="polite"></div></div>';
}
function setupChannelId (raw) {
  raw=String(raw || '').trim();
  if (/^-100[0-9]{6,20}$/.test(raw)) return raw;
  try { var url=new URL(raw), parts=url.pathname.split('/'); if (url.protocol==='https:' && url.hostname==='t.me' && parts[1]==='c' && /^[0-9]{6,20}$/.test(parts[2]) && /^[0-9]+$/.test(parts[3]) && (parts.length===4 || (parts.length===5 && !parts[4]))) return '-100'+parts[2]; } catch(e) {}
  throw new Error('شناسه -100… یا لینک یک پست کانال خصوصی به شکل https://t.me/c/…/… وارد کنید. لینک دعوت کانال کافی نیست.');
}
function buildChannelSetup (source, admin, targets) {
  var id=setupChannelId(source), who=String(admin || '').trim();
  if (!/^[0-9]+$/.test(who) || who==='42') throw new Error('شناسه واقعی مدیر را وارد کنید؛ 42 فقط نمونه است.');
  var dest=String(targets || '').split(NL).map(function (x) { return x.trim(); }).filter(Boolean).map(setupChannelId);
  dest=dest.filter(function (x,i) { return dest.indexOf(x)===i; });
  if (dest.length>3 || dest.indexOf(id)>=0) throw new Error('حداکثر ۳ مقصد مجاز است و منبع نباید مقصد خودش باشد.');
  var samples=['-1001111111111','-1002222222222','-1003333333333'];
  if ([id].concat(dest).some(function (x) { return samples.indexOf(x)>=0; })) throw new Error('شناسه‌های نمونه را با کانال واقعی خودتان جایگزین کنید.');
  var out={}; out[id]={adminId:who,publish:true,targets:dest}; return JSON.stringify(out,null,2);
}
function bindContentSetup () {
  function bind(id,fn) { var b=$('#'+id); if(b) b.addEventListener('click',fn); }
  function copy(id) { var el=$('#'+id); if(el && el.value) copyText(el.value,function () { toast('کپی شد؛ در تنظیمات Cloudflare وارد کنید.','ok'); }); else toast('ابتدا مقدار را بسازید یا وارد کنید.','err'); }
  bind('content-admin-copy',function () { copy('content-admin-id'); });
  bind('content-secret-generate',function () { try { var bytes=new Uint8Array(32); crypto.getRandomValues(bytes); $('#content-secret-value').value=Array.from(bytes,function (b) { return b.toString(16).padStart(2,'0'); }).join(''); } catch(e) { toast('ساخت رمز در این مرورگر ممکن نیست.','err'); } });
  bind('content-secret-copy',function () { copy('content-secret-value'); });
  bind('content-rules-generate',function () { try { $('#content-rules-value').value=buildChannelSetup($('#content-source-id').value,$('#content-rule-admin').value,$('#content-target-ids').value); } catch(e) { $('#content-rules-value').value=''; toast(e.message,'err'); } });
  bind('content-rules-copy',function () { copy('content-rules-value'); });
}
function adminTabHtml (tab, data, q) {
  if (tab === 'overview') {
    return '<div class="adm-h">📊 نمای کلی</div><div class="stat-cards">' +
      '<div class="stat"><b>' + faNum(data.items) + '</b><span>محتوا</span></div>' +
      '<div class="stat"><b>' + faNum(data.users) + '</b><span>کاربر</span></div>' +
      '<div class="stat"><b>' + (data.botSet ? '✓' : '✗') + '</b><span>ربات تلگرام</span></div>' +
      '</div>' +
      '<div class="adm-box"><h4>ثبت مشخصات از پست کانال</h4>' +
      '<p style="font-size:13px;color:var(--tx2)">در ویرایش هر اثر، لینک پست مشخصات کانال را بگذارید تا عنوان، سال، ژانر و بقیهٔ فیلدها خودکار پر شوند.</p></div>' +
      '<div class="adm-row">' +
      (data.botSet ? '' : '<span class="badge red">⚠️ توکن ربات تنظیم نشده</span>') +
      '<a class="btn btn-ghost btn-sm" href="#/admin/content">➕ افزودن محتوا</a>' +
      '<a class="btn btn-ghost btn-sm" href="#/admin/settings">⚙️ تنظیمات</a>' +
      '</div>';
  }
  if (tab === 'content') {
    var rows = data.items.map(function (it) {
      var th = it.poster ? '<div class="th" style="background-image:url(' + it.poster + ')"><div class="ph"></div></div>' : '<div class="th"><div class="ph">' + esc((it.title || '?').charAt(0)) + '</div></div>';
      var qBadges = (it.qualities && it.qualities.length)
        ? it.qualities.map(function (q) { return '<em class="badge">' + esc(q) + '</em>'; }).join('')
        : (it.quality ? '<em class="badge">' + esc(it.quality) + '</em>' : '');
      var seriesMeta = (it.type === 'series')
        ? ('<em class="badge">' + faNum(it.seasonCount || 0) + ' فصل</em><em class="badge">' + faNum(it.epCount || 0) + ' قسمت</em>' +
          (isAiring(it) ? '<em class="badge live">' + esc(airingLabel(it)) + '</em>' : ''))
        : '';
      return '<div class="adm-item">' + th + '<div class="inf"><b>' + esc(it.title) + '</b><span>' +
        '<em class="badge">' + typeLabel(it.type) + (yearLabel(it) ? ' ' + yearLabel(it) : '') + '</em>' +
        '<em class="badge">' + faNum(it.views || 0) + ' بازدید</em>' +
        qBadges + seriesMeta +
        (it.sizeBytes ? '<em class="badge">' + fmtBytes(it.sizeBytes) + '</em>' : '') +
        (it.featured ? '<em class="badge acc">⭐ هیرو</em>' : '') +
        '</span></div><div class="acts">' +
        '<button class="btn btn-ghost btn-sm" data-edit="' + it.id + '">✏️</button>' +
        '<button class="btn btn-danger btn-sm" data-del="' + it.id + '" data-name="' + esc(it.title) + '">🗑</button>' +
        '</div></div>';
    }).join('');
    return '<div class="adm-h">🎬 مدیریت محتوا <span class="badge">' + faNum(data.items.length) + '</span></div>' +
      '<div class="adm-box"><h4>افزودن از لینک پست تلگرام</h4>' +
      '<div class="adm-row"><input id="adm-url" placeholder="https://t.me/kanal/12345" style="flex:1;min-width:200px" value="' + (q.url ? esc(q.url) : '') + '">' +
      '<button class="btn btn-ghost btn-sm" id="adm-preview">👁 پیش‌نمایش</button>' +
      '<button class="btn btn-primary btn-sm" id="adm-add">➕ افزودن</button></div>' +
      '<div id="adm-preview" style="margin-top:10px"></div></div>' +
      (rows || '<div class="empty" style="padding:30px"><div class="ic">📭</div><p>محتوایی نیست. لینک پست تلگرام را در بالا بچسبانید.</p></div>');
  }
  if (tab === 'ads') {
    var g = data.gate || {};
    var tot = data.totals || {};
    var maxSec = data.maxSec || 20;
    syncAdMeta(data);
    var adRows = (data.ads || []).map(function (a) {
      var thumb = (a.kind === 'banner' && a.mediaUrl) ? a.mediaUrl : (a.posterUrl || '');
      var th = thumb
        ? '<div class="th" style="background-image:url(' + esc(thumb) + ')"></div>'
        : '<div class="th"><div class="ph">' + (a.kind === 'video' ? '🎬' : '🖼') + '</div></div>';
      return '<div class="adm-item"' + (a.active ? '' : ' style="opacity:.5"') + '>' + th +
        '<div class="inf"><b>' + esc(a.title || 'بدون عنوان') + '</b><span>' +
        '<em class="badge acc">' + (a.kind === 'video' ? '🎬 ویدئویی' : '🖼 بنری') + '</em>' +
        '<em class="badge">⏱ ' + faNum(a.sec) + ' ثانیه</em>' +
        '<em class="badge">' + (a.once ? '۱ بار برای هر کاربر' : 'تکرارشونده') + '</em>' +
        '<em class="badge">👁 ' + faNum(a.views || 0) + ' نمایش</em>' +
        '<em class="badge">🖱 ' + faNum(a.clicks || 0) + ' کلیک</em>' +
        '<em class="badge">CTR ' + faNum(a.ctr || 0) + '٪</em>' +
        (a.w && a.h
          ? ('<em class="badge' + (a.ratioOk === false ? ' red' : ' acc') + '" dir="ltr">' + (a.ratioOk === false ? '⚠ ' : '✓ ') + (a.w + '×' + a.h) + ' · ' + faRatio(a.w, a.h) + '</em>')
          : '<em class="badge">ابعاد: نامشخص</em>') +
        (a.linkUrl ? '' : '<em class="badge red">بدون لینک مقصد</em>') +
        (a.active ? '' : '<em class="badge red">غیرفعال</em>') +
        '</span></div><div class="acts">' +
        '<button class="btn btn-ghost btn-sm" data-ad-edit="' + esc(a.id) + '">✏️</button>' +
        '<button class="btn btn-ghost btn-sm" data-ad-tog="' + esc(a.id) + '">' + (a.active ? '⏸' : '▶️') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-ad-reset="' + esc(a.id) + '">↺ آمار</button>' +
        '<button class="btn btn-danger btn-sm" data-ad-del="' + esc(a.id) + '" data-name="' + esc(a.title || a.id) + '">🗑</button>' +
        '</div></div>';
    }).join('');

    return '<div class="adm-h">📢 تبلیغات پیش از دانلود</div>' +
      '<div class="stat-cards">' +
      '<div class="stat"><b>' + faNum(tot.count || 0) + '</b><span>کل تبلیغ‌ها</span></div>' +
      '<div class="stat"><b>' + faNum(tot.active || 0) + '</b><span>فعال</span></div>' +
      '<div class="stat"><b>' + faNum(tot.views || 0) + '</b><span>مجموع نمایش</span></div>' +
      '<div class="stat"><b>' + faNum(tot.clicks || 0) + '</b><span>مجموع کلیک</span></div>' +
      '</div>' +
      '<div class="note">بعد از کلیک روی دانلود، برای کاربران <b>بدون اشتراک</b> یک تبلیغ (حداکثر ' + faNum(maxSec) + ' ثانیه) نمایش داده می‌شود و تا پایان تایمر هدایت به ربات انجام نمی‌شود. کاربران دارای اشتراک هیچ تبلیغی نمی‌بینند. هیچ فایلی روی سایت آپلود نمی‌شود — فقط لینک مستقیم <code dir="ltr">https</code> بنر یا ویدئو را وارد کنید.</div>' +
      '<div class="adm-box"><h4>تنظیمات کلی سیستم تبلیغات</h4>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="adg-on" style="width:auto"' + (g.adGateEnabled !== false ? ' checked' : '') + '> فعال بودن تبلیغ پیش از هدایت به ربات</label>' +
      '<div class="field"><label>متن دکمهٔ «حذف تبلیغ»</label><input id="adg-btn" value="' + esc(g.adGateBtnText || '') + '" placeholder="🚫 حذف تبلیغ‌ها"></div>' +
      '<div class="field"><label>عنوان مودال توضیحات</label><input id="adg-title" value="' + esc(g.adGateTitle || '') + '" placeholder="دانلود بدون تبلیغ، فقط با اشتراک"></div>' +
      '<div class="field"><label>متن مودال توضیحات (هر خط یک پاراگراف)</label><textarea id="adg-note" rows="4">' + esc(g.adGateNote || '') + '</textarea></div>' +
      '<button class="btn btn-primary btn-sm" id="adg-save">💾 ذخیرهٔ تنظیمات تبلیغات</button>' +
      '</div>' +
      '<div class="adm-box"><h4>📐 ابعاد و قالب فایل تبلیغ (برای تبلیغ‌دهنده)</h4>' +
      '<div class="adspec">' + adSpecCardHtml('banner', ADSEC.min, maxSec) + adSpecCardHtml('video', ADSEC.min, maxSec) + '</div>' +
      '<div class="note" style="margin:12px 0 0">اگر فایل با این ابعاد نباشد، تبلیغ در موبایل با حاشیهٔ سیاه (بالا/پایین یا دو طرف) نمایش داده می‌شود. این متن را برای تبلیغ‌دهنده بفرستید.</div>' +
      '<div class="adm-row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost btn-sm" id="ad-spec-copy">📋 کپی مشخصات برای تبلیغ‌دهنده</button></div>' +
      '</div>' +
      '<div class="adm-row" style="margin-bottom:12px"><button class="btn btn-primary btn-sm" id="ad-new">➕ تبلیغ جدید</button>' +
      '<button class="btn btn-ghost btn-sm" id="ad-ref">🔄 به‌روزرسانی آمار</button></div>' +
      (adRows || '<div class="empty" style="padding:30px"><div class="ic">📢</div><p>هنوز تبلیغی ثبت نشده. با دکمهٔ «تبلیغ جدید» اولین بنر یا ویدئو را اضافه کنید.</p></div>');
  }
  if (tab === 'users') {
    var rows = data.users.map(function (u) {
      return '<tr><td><b>' + esc(u.tgName || u.username) + '</b><br><span style="color:var(--tx3);font-size:11.5px">@' + esc(u.username) + (u.phone ? ' • ' + esc(u.phone) : '') + '</span></td>' +
        '<td><select class="sel" data-role-for="' + esc(u.username) + '"><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>مدیر</option><option value="premium"' + (u.role === 'premium' ? ' selected' : '') + '>مادام‌العمر</option><option value="free"' + (u.role === 'free' ? ' selected' : '') + '>عادی</option></select></td>' +
        '<td class="v">' + faMoney(u.wallet || 0) + '<br><button class="btn btn-ghost btn-sm" data-w-user="' + esc(u.username) + '">شارژ</button></td>' +
        '<td class="v">' + (u.subUntil ? faDate(u.subUntil) : '—') + '</td>' +
        '<td><button class="btn btn-danger btn-sm" data-del-user="' + esc(u.username) + '">حذف</button></td></tr>';
    }).join('');
    return '<div class="adm-h">👥 کاربران <span class="badge">' + faNum(data.users.length) + '</span></div>' +
      '<table class="tbl"><thead><tr><th>کاربر</th><th>سطح</th><th>کیف پول</th><th>اشتراک</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" style="color:var(--tx3)">کاربری نیست</td></tr>') + '</tbody></table>';
  }
  if (tab === 'pays') {
    var invs = data.invoices || [];
    var waitN = invs.filter(function (x) { return x.status === 'submitted'; }).length;
    var rows = invs.map(function (c) {
      var st = c.status === 'submitted' ? '<span class="badge acc">منتظر تأیید</span>' : (c.status === 'pending' ? '<span class="badge">در انتظار واریز</span>' : esc(c.status || ''));
      var extra = c.extraToman ? ('<br><span style="font-size:11px;color:var(--acc2)">یکتا +' + faNum(c.extraToman) + '</span>') : '';
      var when = (c.transferDate && c.transferTime) ? (esc(c.transferDate) + '<br><b dir="ltr">' + esc(c.transferTime) + '</b>') : '—';
      return '<tr class="' + (c.status === 'submitted' ? 'pay-wait' : '') + '"><td><b>' + esc(c.tgName || c.username) + '</b><br><span style="color:var(--tx3);font-size:11.5px">' + esc(c.phone || c.username) + '</span></td>' +
        '<td class="v"><b>' + faNum(c.amountToman) + '</b> تومان' + extra + '<br><span style="font-size:11px;color:var(--tx3)">' + faMoney(c.units) + ' ' + unitName() + '</span></td>' +
        '<td class="v" style="direction:ltr;text-align:right;font-weight:800">' + when + '</td>' +
        '<td class="v">' + st + '<br><span style="font-size:11px;color:var(--tx3)">' + faDate(c.submittedAt || c.createdAt) + '</span></td>' +
        '<td>' + (c.status === 'submitted'
          ? '<div class="adm-row"><button class="btn btn-primary btn-sm" data-k2k-ok="' + esc(c.id) + '">تأیید</button><button class="btn btn-danger btn-sm" data-k2k-no="' + esc(c.id) + '">رد</button></div>'
          : '') + '</td></tr>';
    }).join('');
    return '<div class="adm-h">💳 پرداخت‌های کارت‌به‌کارت ' + (waitN ? '<span class="badge acc">' + faNum(waitN) + ' منتظر تأیید</span>' : '') + '</div>' +
      '<div class="note">مطابقت را <b>فقط با مبلغ یکتا</b> بررسی کنید. مبالغ به‌گونه‌ای تنظیم شده‌اند که برای هر فاکتور یکتا باشند.</div>' +
      '<div class="adm-row" style="margin-bottom:10px"><button type="button" class="btn btn-ghost btn-sm" id="pays-ref">به‌روزرسانی</button></div>' +
      '<div style="overflow:auto"><table class="tbl"><thead><tr><th>کاربر</th><th>مبلغ دقیق</th><th>زمان اعلام واریز</th><th>وضعیت</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" style="color:var(--tx3)">هنوز اعلام واریزی نیست. بعد از کلیک کاربر روی دکمه تایید، اینجا دکمهٔ تأیید/رد می‌آید.</td></tr>') + '</tbody></table></div>';
  }
  if (tab === 'codes') {
    function codeModeLabel (c) {
      var m = c.mode || 'once';
      if (m === 'each') return 'همه کاربران — هر نفر یک‌بار';
      if (m === 'quota') return 'حداکثر ' + faNum(c.maxUsers || 1) + ' کاربر — هر نفر یک‌بار';
      return 'یک‌بار مصرف — فقط یک کاربر';
    }
    function codeUseLabel (c) {
      var n = c.usedCount != null ? c.usedCount : (c.used || 0);
      var expired = c.exp && c.exp < Date.now();
      if (expired) return '<span class="badge red">منقضی</span>';
      if ((c.mode || 'once') === 'once') return n ? '<span class="badge">مصرف‌شده</span>' : '<span class="badge acc">فعال</span>';
      if (c.mode === 'quota') {
        var max = c.maxUsers || 1;
        return faNum(n) + ' از ' + faNum(max) + (n >= max ? ' <span class="badge">تکمیل</span>' : '');
      }
      return faNum(n) + ' نفر استفاده کرده‌اند';
    }
    var rows = data.codes.map(function (c) {
      return '<tr><td style="font-weight:800;letter-spacing:2px">' + esc(c.code) + '</td><td>' + faMoney(c.units) + ' ' + unitName() + '</td>' +
        '<td class="v">' + faDate(c.exp) + '</td>' +
        '<td class="v" style="font-size:12.5px">' + esc(codeModeLabel(c)) + '</td>' +
        '<td class="v">' + codeUseLabel(c) + '</td>' +
        '<td><button class="btn btn-danger btn-sm" data-del-code="' + esc(c.code) + '">حذف</button></td></tr>';
    }).join('');
    return '<div class="adm-h">🎫 کدهای تخفیف کیف پول</div>' +
      '<div class="adm-box"><h4>ساخت کد جدید</h4>' +
      '<div class="adm-row">' +
      '<div class="field" style="margin:0"><label>مبلغ (' + unitName() + ')</label><input id="code-units" type="number" min="1" value="100" style="width:120px"></div>' +
      '<div class="field" style="margin:0"><label>اعتبار (روز)</label><input id="code-days" type="number" min="1" max="3650" value="30" style="width:120px" placeholder="مثلاً ۴۵"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:10px"><label>نحوهٔ استفاده</label>' +
      '<select id="code-mode" class="sel">' +
      '<option value="once">یک‌بار مصرف — فقط یک کاربر</option>' +
      '<option value="each">همه کاربران می‌توانند استفاده کنند — هر نفر یک‌بار</option>' +
      '<option value="quota">تعداد مشخصی کاربر — هر نفر یک‌بار</option>' +
      '</select></div>' +
      '<div class="field" id="code-max-wrap" style="display:none"><label>حداکثر تعداد کاربر</label>' +
      '<input id="code-max" type="number" min="1" value="10" style="width:140px"></div>' +
      '<div class="adm-row"><button class="btn btn-primary btn-sm" id="code-add">➕ ساخت</button><span id="code-new" class="badge acc" style="display:none"></span></div></div>' +
      '<table class="tbl"><thead><tr><th>کد</th><th>مبلغ</th><th>اعتبار</th><th>حالت</th><th>مصرف</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" style="color:var(--tx3)">کدی ساخته نشده</td></tr>') + '</tbody></table>';
  }
  if (tab === 'settings') {
    return '<div class="adm-h">⚙️ تنظیمات سایت</div>' +
      '<div class="adm-box"><h4>ظاهر</h4>' +
      '<div class="field"><label>نام سایت</label><input id="set-name" value="' + esc(data.siteName) + '"></div>' +
      '<div class="field"><label>شعار</label><input id="set-tag" value="' + esc(data.tagline) + '"></div></div>' +
      '<div class="adm-box"><h4>تلگرام</h4>' +
      (data.botFromEnv
        ? '<div class="note">توکن ربات از Runtime secrets ورکر خوانده می‌شود (<code>BOT_TOKEN</code>). در پنل لازم نیست وارد کنید.</div>'
        : '<div class="field"><label>توکن ربات</label><input id="set-bot" type="password" placeholder="123456:ABC-DEF…"></div>') +
      (data.botUserFromEnv
        ? '<div class="note">یوزرنیم ربات از Runtime variables ورکر است (<code>BOT_USERNAME</code>): @' + esc(data.botUsername || '') + '</div>'
        : '<div class="field"><label>یوزرنیم ربات (بدون @)</label><input id="set-botun" value="' + esc(data.botUsername || '') + '" placeholder="MyCinemaBot"></div>') +
      '<div class="adm-row"><button class="btn btn-ghost btn-sm" id="set-test">✅ تست ربات</button><span id="set-test-out" class="badge" style="display:none"></span></div>' +
      '</div>' +
      '<div class="adm-box"><h4>ربات ارسال فایل و مخزن</h4>' +
      '<div class="note">ربات ورود را از ربات ارسال فایل جدا کنید. <b>ربات ارسال</b> باید در کانال مخزن ادمین باشد (نه فقط ربات ورود). مخزن را خصوصی بگذارید.<br>فیلد جایگزینی فقط وقتی کانال <b>عوض</b> شده: هر خط «قدیم جدید». خودِ لینک فایل را روی فیلم بگذارید مثل <code dir="ltr">https://t.me/c/4458209353/62</code> — یک عدد تنها در این فیلد کافی نیست.</div>' +
      (data.deliveryFromEnv
        ? '<div class="note">توکن ربات ارسال از Runtime secrets است (<code>DELIVERY_BOT_TOKEN</code>).</div>'
        : '<div class="field"><label>توکن ربات ارسال فایل (اختیاری)</label><input id="set-fbot" type="password" placeholder="اگر خالی باشد همان ربات ورود فایل می‌فرستد"></div>') +
      (data.deliveryUserFromEnv
        ? '<div class="note">یوزرنیم ربات ارسال از env است: @' + esc(data.deliveryBotUsername || '') + '</div>'
        : '<div class="field"><label>یوزرنیم ربات ارسال (بدون @)</label><input id="set-fbotun" value="' + esc(data.deliveryBotUsername || '') + '" placeholder="FileBot"></div>') +
      (data.vaultChatFromEnv
        ? '<div class="note">کانال مخزن از env است: <b dir="ltr">' + esc(data.vaultChatId || '') + '</b></div>'
        : '<div class="field"><label>لینک یا آیدی کانال مخزن (خصوصی)</label><input id="set-vaultid" dir="ltr" value="' + esc(data.vaultChatId || '') + '" placeholder="https://t.me/c/4458209353/62"></div>') +
      (data.vaultRewriteFromEnv
        ? '<div class="note">جایگزینی کانال از env (<code>VAULT_REWRITE</code>): <b dir="ltr">' + esc(data.vaultRewrite || '') + '</b></div>'
        : '<div class="field"><label>جایگزینی فقط اگر کانال عوض شد — هر خط: قدیم جدید</label><textarea id="set-vault" rows="2" placeholder="xvcdn newcdn">' + esc(data.vaultRewrite || '') + '</textarea></div>') +
      '<div class="adm-row"><button class="btn btn-ghost btn-sm" id="set-vault-test">🧪 تست مخزن</button><span id="set-vault-out" class="badge" style="display:none"></span></div>' +
      '<div class="note">در تلگرام «Restrict saving content / محافظت از محتوا» را خاموش کنید وگرنه ربات حتی به‌عنوان ادمین هم نمی‌تواند فایل را کپی کند.</div>' +
      '</div>' +
      '<div class="adm-box"><h4>اقتصاد و اشتراک</h4>' +
      '<div class="form-2col">' +
      '<div class="field"><label>نام واحد کیف پول</label><input id="set-unit" value="' + esc(data.walletUnitName || 'سکه') + '"></div>' +
      '<div class="field"><label>هدیه سکه اولین ثبت‌نام (صفر = بدون هدیه)</label><input id="set-signup-bonus" type="number" min="0" step="1" value="' + esc(data.signupBonus) + '"><small>فقط برای حساب‌های جدید؛ مستقل از پاداش دعوت.</small></div>' +
      '<div class="field"><label>قیمت هر دانلود (فقط کاربر بدون اشتراک)</label><input id="set-dlp" type="number" value="' + esc(data.dlClickPrice) + '"></div>' +
      '<div class="field"><label>اشتراک ۱ ماهه</label><input id="set-s1" type="number" value="' + esc(data.sub1m) + '"></div>' +
      '<div class="field"><label>اشتراک ۳ ماهه</label><input id="set-s3" type="number" value="' + esc(data.sub3m) + '"></div>' +
      '<div class="field"><label>اشتراک ۶ ماهه</label><input id="set-s6" type="number" value="' + esc(data.sub6m) + '"></div>' +
      '<div class="field"><label>اشتراک ۱ ساله</label><input id="set-s12" type="number" value="' + esc(data.sub1y) + '"></div>' +
      '<div class="field"><label>پاداش دعوت (ثبت‌نام)</label><input id="set-refb" type="number" value="' + esc(data.refSignupBonus) + '"></div>' +
      '<div class="field"><label>درصد سهم از خرید سکهٔ دعوت‌شده (نه دانلود)</label><input id="set-refp" type="number" value="' + esc(data.refPurchasePercent) + '"></div>' +
      '<div class="field"><label>ثانیه تا حذف فایل در ربات</label><input id="set-van" type="number" min="3" max="25" value="' + esc(data.vanishSec || 10) + '"></div>' +
      '</div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-top:8px"><input type="checkbox" id="set-stars" style="width:auto"' + (data.starsEnabled !== false ? ' checked' : '') + '> شارژ با استارز تلگرام (فاکتور رسمی)</label>' +
      '<div class="field" style="margin-top:10px"><label for="set-star-packs">بسته‌های شارژ استارز (هر خط: استارز | سکه)</label><textarea id="set-star-packs" rows="4" dir="ltr" aria-describedby="star-packs-help">' +
      (data.starPacks || []).map(function (x) { return esc(x.stars + ' | ' + x.units); }).join('&#10;') +
      '</textarea><small id="star-packs-help">مثال: 50 | 500 یعنی پرداخت ۵۰ استارز و دریافت ۵۰۰ سکه. بین ۱ تا ۸ بسته؛ استارز عدد صحیح ۱ تا ۱۰۰۰۰ و سکه عدد صحیح مثبت. برای حذف یک بسته، خط آن را پاک کنید.</small></div>' +
      '<div class="field" style="margin-top:10px"><label>سایت‌ها و ربات‌های خرید استارز با کارت شتاب (هر خط: عنوان | لینک | توضیح)</label><textarea id="set-shops" rows="8" dir="ltr">' +
      (data.starShops || []).map(function (x) {
        return esc((x.title || '') + ' | ' + (x.url || '') + (x.note ? (' | ' + x.note) : ''));
      }).join('&#10;') +
      '</textarea></div>' +
      '<div class="note">زرین‌پال نداریم. سه مورد اول استارز در کیف پول دیده می‌شود؛ بقیه پشت «دیدن بیشتر». کارت‌به‌کارت ریالی باکس بعدی است.</div>' +
      '</div>' +
      '<div class="adm-box"><h4>کارت‌به‌کارت ریالی (تأیید دستی)</h4>' +
      '<div class="note">کاربر مبلغ یکتا را واریز می‌کند و با یک کلیک اعلام واریز می‌کند. فقط با استفاده از مبلغ یکتا در پیامک بانک تطبیق دهید و تأیید کنید.</div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin:8px 0"><input type="checkbox" id="set-k2k" style="width:auto"' + (data.k2kEnabled ? ' checked' : '') + '> فعال‌سازی کارت‌به‌کارت</label>' +
      '<div class="form-2col">' +
      '<div class="field"><label>شماره کارت ۱۶ رقمی</label><input id="set-k2k-card" dir="ltr" inputmode="numeric" maxlength="19" value="' + esc(data.k2kCardNumber || '') + '" placeholder="6037"></div>' +
      '<div class="field"><label>نام دارنده کارت</label><input id="set-k2k-holder" value="' + esc(data.k2kCardHolder || '') + '" placeholder="طبق کارت"></div>' +
      '<div class="field"><label>بانک</label><input id="set-k2k-bank" value="' + esc(data.k2kCardBank || 'بانک ملی') + '"></div>' +
      '<div class="field"><label>مهلت اعلام واریز (دقیقه)</label><input id="set-k2k-ttl" type="number" min="10" max="1440" value="' + esc(Math.max(10, Math.round((data.k2kTtlSec || 1800) / 60))) + '"></div>' +
      '</div>' +
      '<div class="field"><label>بسته‌ها (هر خط: تومان | سکه)</label><textarea id="set-k2k-packs" rows="4" dir="ltr">' +
      (data.k2kPacks || []).map(function (x) { return esc((x.toman || '') + ' | ' + (x.units || '')); }).join('&#10;') +
      '</textarea></div>' +
      '</div>' +
      '<div class="adm-box"><h4>دسترسی محتوا</h4>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="set-reqlogin" style="width:auto"' + (data.requireLogin ? ' checked' : '') + '> ورود اجباری برای دریافت فایل</label>' +
      '<div class="note">قفل اشتراک روی هر کیفیت (و برای سریال روی هر قسمت) با ستاره در ویرایش محتوا تنظیم می‌شود.</div></div>' +
      '<div class="adm-box"><h4>کپشن فایل و تبلیغ زیر فایل در ربات</h4>' +
      '<div class="note">کپشن فقط همان متن زیر فایل است. دکمهٔ تبلیغ جداگانه زیر فایل می‌آید و متن یا لینک دکمه داخل کپشن تکرار نمی‌شود.</div>' +
      '<div class="field"><label>متن زیر فایل ارسالی (کپشن)</label><textarea id="set-caption" rows="4">' + esc(data.fileCaption || '') + '</textarea></div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="set-ad-on" style="width:auto"' + (data.adEnabled !== false ? ' checked' : '') + '> نمایش دکمهٔ تبلیغ زیر فایل (فقط دکمه، نه داخل کپشن)</label>' +
      '<div class="field"><label>متن دکمهٔ تبلیغ</label><input id="set-ad-txt" value="' + esc(data.adButtonText || '') + '" placeholder="🎭 جدیدترین اخبار سینما"></div>' +
      '<div class="field"><label>لینک دکمه (https://…)</label><input id="set-ad-url" dir="ltr" value="' + esc(data.adButtonUrl || '') + '" placeholder="https://t.me/movie_shatelup"></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="set-save">💾 ذخیره تنظیمات</button>' +
      contentSetupHtml(data.contentBotSetup) +
      '<div class="adm-box" style="margin-top:24px"><h4>نگهداری پایگاه داده KV</h4>' +
      '<p class="note">فقط ارجاع‌های بدون صاحب بررسی می‌شوند؛ محتوای اصلی، کاربران، کدها و سوابق مالی حذف نمی‌شوند. ابتدا پشتیبان بگیرید و هنگام ثبت‌نام، ورود اطلاعات یا بازیابی نسخه پشتیبان پاک‌سازی نکنید. به‌دلیل تأخیر همگام‌سازی KV، پس از تغییرات چند دقیقه صبر کنید.</p>' +
      '<div class="field"><label for="db-prefix">گروه بررسی</label><select id="db-prefix">' +
      [['src:', 'ارجاع منابع فیلم و سریال'], ['views:', 'آمار قدیمی محتوا'], ['sub:', 'زیرنویس‌ها'], ['tg:', 'شناسه تلگرام'], ['ph:', 'ارجاع شماره'], ['tgu:', 'نام تلگرام'], ['refcode:', 'ارجاع دعوت'], ['adstat:', 'آمار تبلیغات'], ['k2k:track:', 'ارجاع پیگیری پرداخت']].map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') +
      '</select></div><div class="adm-row"><button type="button" class="btn btn-ghost" id="db-scan">بررسی ۱۰ کلید</button><button type="button" class="btn btn-danger" id="db-clean" disabled>حذف موارد گزارش‌شده</button></div><div id="db-report" class="note" aria-live="polite">بررسی فقط با درخواست شما انجام می‌شود.</div></div>';
  }
  return '';
}
/* ── ابعاد و قالب فایل تبلیغ ──
   مقدار پیش‌فرض از سرور (CONFIG.AD_SPEC) با پاسخ /admin/ads به‌روزرسانی می‌شود. */
var ADSPEC = {
  banner: { w: 1080, h: 1920, minW: 720, minH: 1280, maxKB: 600, formats: 'JPG / PNG / WebP' },
  video: { w: 1080, h: 1920, minW: 720, minH: 1280, maxMB: 5, formats: 'MP4 (H.264 با faststart)' },
};
var ADSEC = { max: 20, min: 3 };
function applyAdSpec (sp) {
  if (!sp) return;
  if (sp.banner) ADSPEC.banner = Object.assign({}, ADSPEC.banner, sp.banner);
  if (sp.video) ADSPEC.video = Object.assign({}, ADSPEC.video, sp.video);
}
function syncAdMeta (d) {
  if (!d) return;
  applyAdSpec(d.spec);
  if (Number(d.maxSec) > 0) ADSEC.max = Number(d.maxSec);
  if (Number(d.minSec) > 0) ADSEC.min = Number(d.minSec);
}
function faRatio (w, h) {
  w = Number(w) || 0; h = Number(h) || 0;
  if (!w || !h) return '—';
  function g (a, b) { return b ? g(b, a % b) : a; }
  var d = g(w, h) || 1;
  var a = Math.round(w / d), b = Math.round(h / d);
  if (a > 40 || b > 40) return (Math.round((w / h) * 100) / 100) + ':1';
  return a + ':' + b;
}
function adRatioOkClient (kind, w, h) {
  var o = ADSPEC[kind === 'video' ? 'video' : 'banner'] || {};
  w = Number(w) || 0; h = Number(h) || 0;
  if (!o.w || !o.h || !w || !h) return null;
  var want = o.w / o.h, got = w / h;
  if (!isFinite(got) || !got) return false;
  return Math.abs(got - want) / want <= 0.06;
}
function adSpecMaxText (o) {
  if (!o) return '';
  if (Number(o.maxMB) > 0) return faNum(o.maxMB) + ' مگابایت';
  if (Number(o.maxKB) > 0) return faNum(o.maxKB) + ' کیلوبایت';
  return '';
}
function adSpecMinSec (minSec) { return Math.max(1, Number(minSec) || 3); }
function adSpecCardHtml (kind, minSec, maxSec) {
  var o = ADSPEC[kind === 'video' ? 'video' : 'banner'] || {};
  if (!o.w || !o.h) return '';
  var isVid = kind === 'video';
  var rows = [];
  rows.push('<li>نسبت تصویر: <b>' + faRatio(o.w, o.h) + ' عمودی</b></li>');
  if (o.minW && o.minH) rows.push('<li>حداقل قابل قبول: <b>' + (o.minW + '×' + o.minH) + '</b></li>');
  if (o.formats) rows.push('<li>فرمت: <b>' + esc(o.formats) + '</b></li>');
  var max = adSpecMaxText(o);
  if (max) rows.push('<li>حجم فایل: <b>حداکثر ' + max + '</b></li>');
  if (isVid) rows.push('<li>مدت: <b>' + faNum(adSpecMinSec(minSec)) + ' تا ' + faNum(maxSec || 20) + ' ثانیه</b> — با پایان تایمر، ویدئو قطع می‌شود</li>');
  rows.push('<li>متن و لوگو را در <b>وسط کادر</b> بگذارید؛ نوار تایمر بالا و دکمهٔ ادامه پایین روی فایل است.</li>');
  return '<div class="c"><h5>' + (isVid ? '🎬 ویدئو' : '🖼 بنر تصویری') + '</h5>' +
    '<div class="dim">' + (o.w + ' × ' + o.h) + '</div>' +
    '<ul>' + rows.join('') + '</ul></div>';
}
function adSpecText (minSec, maxSec) {
  var L = [];
  L.push('مشخصات فایل تبلیغ' + (APP.siteName ? (' — ' + APP.siteName) : ''));
  L.push('تبلیغ پیش از دانلود، تمام‌صفحه و عمودی (موبایل) نمایش داده می‌شود.');
  ['banner', 'video'].forEach(function (k) {
    var o = ADSPEC[k] || {};
    if (!o.w || !o.h) return;
    L.push('');
    L.push((k === 'video' ? 'ویدئو' : 'بنر تصویری') + ': ' + o.w + 'x' + o.h + ' پیکسل (نسبت ' + faRatio(o.w, o.h) + ')');
    if (o.minW && o.minH) L.push('حداقل ابعاد: ' + o.minW + 'x' + o.minH);
    if (o.formats) L.push('فرمت: ' + o.formats);
    var max = adSpecMaxText(o);
    if (max) L.push('حداکثر حجم فایل: ' + max);
    if (k === 'video') L.push('مدت: ' + adSpecMinSec(minSec) + ' تا ' + (maxSec || 20) + ' ثانیه — ترجیحاً بدون صدا');
  });
  L.push('');
  L.push('نکات: لینک مستقیم https بدون ریدایرکت؛ متن و لوگو در وسط کادر (۱۲٪ بالا و پایین پشت نوار تایمر و دکمهٔ ادامه است).');
  return L.join(NL);
}
/* سنجش ابعاد واقعی فایل لینک‌شده — فقط در پنل مدیریت، بدون مصرف پهنای باند سرور */
function probeAdMedia (url, isVideo, cb) {
  var fin = function (r) { cb(r); cb = function () { }; };
  try {
    if (isVideo) {
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.style.position = 'fixed';
      v.style.left = '-9999px';
      v.style.width = '1px';
      v.style.height = '1px';
      v.addEventListener('loadedmetadata', function () {
        var r = { w: v.videoWidth || 0, h: v.videoHeight || 0, dur: Math.round(Number(v.duration) || 0) };
        if (v.parentNode) v.parentNode.removeChild(v);
        fin(r);
      });
      v.addEventListener('error', function () {
        if (v.parentNode) v.parentNode.removeChild(v);
        fin(null);
      });
      document.body.appendChild(v);
      v.src = url;
      setTimeout(function () {
        if (v.parentNode) v.parentNode.removeChild(v);
        fin(null);
      }, 12000);
      return;
    }
    var im = new Image();
    im.onload = function () { fin({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 }); };
    im.onerror = function () { fin(null); };
    im.src = url;
    setTimeout(function () { fin(null); }, 12000);
  } catch (e) { fin(null); }
}
function openAdEditor (ad, maxSec, onSaved) {
  ad = ad || {};
  maxSec = maxSec || 20;
  var isNew = !ad.id;
  var html =
    '<div class="field"><label>عنوان (فقط برای پنل مدیریت)</label><input id="ad-title" value="' + esc(ad.title || '') + '" placeholder="کمپین نوروزی"></div>' +
    '<div class="field"><label>نوع تبلیغ</label>' +
    '<select id="ad-kind" class="sel"><option value="banner"' + (ad.kind !== 'video' ? ' selected' : '') + '>🖼 بنری (تصویر)</option>' +
    '<option value="video"' + (ad.kind === 'video' ? ' selected' : '') + '>🎬 ویدئویی</option></select></div>' +
    '<div class="adspec" id="ad-spec-live" style="grid-template-columns:1fr;margin-bottom:14px"></div>' +
    '<div class="field"><label id="ad-media-lab">لینک مستقیم فایل (https)</label>' +
    '<input id="ad-media" dir="ltr" value="' + esc(ad.mediaUrl || '') + '" placeholder="https://cdn.example.com/banner.jpg">' +
    '<div class="adchk"><span class="pv" id="ad-pv"></span><span id="ad-chk-msg" style="flex:1">—</span>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="ad-measure">📐 سنجش دوباره</button></div>' +
    '<input type="hidden" id="ad-w" value="' + esc(ad.w || 0) + '"><input type="hidden" id="ad-h" value="' + esc(ad.h || 0) + '"></div>' +
    '<div class="field" id="ad-poster-wrap"><label>لینک تصویر پوستر ویدئو (اختیاری)</label>' +
    '<input id="ad-poster" dir="ltr" value="' + esc(ad.posterUrl || '') + '" placeholder="https://cdn.example.com/poster.jpg"></div>' +
    '<div class="field"><label>لینک مقصد — با کلیک روی تبلیغ کاربر به اینجا می‌رود</label>' +
    '<input id="ad-link" dir="ltr" value="' + esc(ad.linkUrl || '') + '" placeholder="https://example.com/landing"></div>' +
    '<div class="field"><label>متن روی تبلیغ (اختیاری)</label><input id="ad-cta" value="' + esc(ad.cta || '') + '" placeholder="برای مشاهده کلیک کنید"></div>' +
    '<div class="form-2col">' +
    '<div class="field"><label>مدت تبلیغ (ثانیه — حداکثر ' + faNum(maxSec) + ')</label>' +
    '<input id="ad-sec" type="number" min="' + ADSEC.min + '" max="' + maxSec + '" value="' + esc(ad.sec || maxSec) + '"></div>' +
    '<div class="field"><label>وزن نمایش (عدد بزرگ‌تر = شانس بیشتر)</label>' +
    '<input id="ad-weight" type="number" min="1" max="100" value="' + esc(ad.weight || 1) + '"></div>' +
    '</div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="ad-once" style="width:auto"' + (ad.once ? ' checked' : '') + '> فقط یک بار برای هر کاربر نمایش داده شود</label>' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:8px" id="ad-muted-wrap"><input type="checkbox" id="ad-muted" style="width:auto"' + (ad.muted === false ? '' : ' checked') + '> ویدئو بی‌صدا پخش شود (توصیه می‌شود)</label>' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:14px"><input type="checkbox" id="ad-active" style="width:auto"' + (ad.active === false ? '' : ' checked') + '> فعال</label>' +
    '<div class="note">فایل روی سایت آپلود نمی‌شود؛ فقط لینک ذخیره می‌شود. لینک باید <b dir="ltr">https</b> و از سروری با اجازهٔ نمایش در سایت شما باشد.</div>' +
    '<div class="adm-row" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="ad-cancel">انصراف</button>' +
    '<button class="btn btn-primary btn-sm" id="ad-save">💾 ' + (isNew ? 'ثبت تبلیغ' : 'ذخیره') + '</button></div>';

  openModal(isNew ? 'تبلیغ جدید' : 'ویرایش تبلیغ', html, function (wrap, close) {
    var kind = $('#ad-kind', wrap);
    var mediaInp = $('#ad-media', wrap);
    var chkMsg = $('#ad-chk-msg', wrap);
    var chkPv = $('#ad-pv', wrap);
    var savedUrl = String(ad.mediaUrl || '').trim();
    var savedW = Number(ad.w) || 0, savedH = Number(ad.h) || 0;
    function wantText () {
      var o = ADSPEC[kind.value === 'video' ? 'video' : 'banner'] || {};
      if (!o.w || !o.h) return '';
      return ' <b style="color:var(--tx2)">اندازهٔ لازم: ' + (o.w + '×' + o.h) + '</b>';
    }
    function syncKind () {
      var isVid = kind.value === 'video';
      $('#ad-poster-wrap', wrap).style.display = isVid ? '' : 'none';
      $('#ad-muted-wrap', wrap).style.display = isVid ? '' : 'none';
      $('#ad-media-lab', wrap).textContent = isVid
        ? 'لینک مستقیم ویدئو (https — مثلاً mp4)'
        : 'لینک مستقیم تصویر بنر (https — jpg/png/webp/gif)';
      $('#ad-spec-live', wrap).innerHTML = adSpecCardHtml(kind.value, ADSEC.min, maxSec);
      chkPv.style.display = isVid ? 'none' : '';
      measure(false);
    }
    function setDims (w, h) {
      $('#ad-w', wrap).value = w || 0;
      $('#ad-h', wrap).value = h || 0;
    }
    /* ابعاد واقعی فایل را از خودِ لینک می‌خوانیم؛ اگر خوانده نشد صفر ثبت می‌شود */
    function measure (fromBtn) {
      var url = (mediaInp.value || '').trim();
      var RE_HTTPS = new RegExp('^https:', 'i');
      if (!RE_HTTPS.test(url)) {
        setDims(0, 0);
        chkMsg.innerHTML = '<span style="color:var(--tx3)">ابتدا لینک مستقیم فایل را وارد کنید.</span>' + wantText();
        chkPv.style.backgroundImage = '';
        return;
      }
      chkMsg.innerHTML = '<span style="color:var(--tx3)">⏳ بررسی ابعاد فایل…</span>';
      probeAdMedia(url, kind.value === 'video', function (r) {
        if (!r || !r.w || !r.h) {
          /* لینک عوض نشده؟ پس همان ابعاد ثبت‌شده را نگه می‌داریم */
          if (url !== savedUrl) setDims(0, 0);
          chkMsg.innerHTML = (savedW && savedH && url === savedUrl)
            ? ('<b style="color:var(--tx2)">ابعاد ثبت‌شده: ' + (savedW + '×' + savedH) + '</b> — سرور میزبان اجازهٔ بررسی نداد' + wantText())
            : ('<span class="warn">⚠️ ابعاد فایل قابل خواندن نبود</span> (سرور میزبان اجازهٔ بررسی نداد یا لینک مستقیم نیست)' + wantText());
          return;
        }
        setDims(r.w, r.h);
        if (kind.value !== 'video') chkPv.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
        var o = ADSPEC[kind.value === 'video' ? 'video' : 'banner'] || {};
        var okRatio = adRatioOkClient(kind.value, r.w, r.h);
        var small = (o.minW && r.w < o.minW) || (o.minH && r.h < o.minH);
        var wrongRatio = okRatio === false;
        var txt = '<b style="color:var(--ok)">✓ ابعاد فایل: ' + (r.w + '×' + r.h) + ' · نسبت ' + faRatio(r.w, r.h);
        if (r.dur) txt += ' · ' + faNum(r.dur) + ' ثانیه';
        txt += '</b>';
        if (wrongRatio) txt = '<span class="warn">⚠️ نسبت تصویر این فایل ' + faRatio(r.w, r.h) + ' است؛ برای تبلیغ تمام‌صفحه نسبت ' + faRatio(o.w, o.h) + ' لازم است (وگرنه بالا/پایین یا دو طرف تبلیغ سیاه می‌ماند).</span><br>' + txt;
        else if (small) txt = '<span class="bad">⛔ ابعاد از حد مجاز (' + (o.minW + '×' + o.minH) + ') کوچک‌تر است و روی موبایل تار دیده می‌شود.</span><br>' + txt;
        chkMsg.innerHTML = txt + wantText();
        if (fromBtn) toast('ابعاد خوانده شد ✓', 'ok');
      });
    }
    mediaInp.addEventListener('change', function () { measure(false); });
    mediaInp.addEventListener('blur', function () { measure(false); });
    var mBtn = $('#ad-measure', wrap);
    if (mBtn) mBtn.addEventListener('click', function () { measure(true); });
    kind.addEventListener('change', syncKind);
    syncKind();
    $('#ad-cancel', wrap).addEventListener('click', close);
    $('#ad-save', wrap).addEventListener('click', function () {
      var btn = $('#ad-save', wrap);
      var body = {
        id: ad.id || '',
        title: $('#ad-title', wrap).value.trim(),
        kind: kind.value,
        mediaUrl: $('#ad-media', wrap).value.trim(),
        posterUrl: $('#ad-poster', wrap).value.trim(),
        linkUrl: $('#ad-link', wrap).value.trim(),
        cta: $('#ad-cta', wrap).value.trim(),
        sec: Math.max(3, Math.min(maxSec, parseInt($('#ad-sec', wrap).value, 10) || maxSec)),
        weight: Math.max(1, Math.min(100, parseInt($('#ad-weight', wrap).value, 10) || 1)),
        once: $('#ad-once', wrap).checked,
        muted: $('#ad-muted', wrap).checked,
        active: $('#ad-active', wrap).checked,
        w: parseInt($('#ad-w', wrap).value, 10) || 0,
        h: parseInt($('#ad-h', wrap).value, 10) || 0,
      };
      if (!body.mediaUrl) { toast('لینک بنر یا ویدئو لازم است', 'err'); return; }
      btn.disabled = true; btn.textContent = 'در حال ذخیره…';
      api('/admin/ads', { method: 'POST', body: body }).then(function () {
        toast('ذخیره شد ✓', 'ok');
        close();
        if (onSaved) onSaved();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '💾 ذخیره';
        toast(e.message, 'err');
      });
    });
  });
}

function bindAdminTab (tab, q) {
  if (tab === 'ads') {
    var maxSec = 20;
    var byId = {};
    var reload = function () { loadAdminTab('ads', q); };
    api('/admin/ads').then(function (d) {
      maxSec = d.maxSec || 20;
      syncAdMeta(d);
      (d.ads || []).forEach(function (a) { byId[a.id] = a; });
    }).catch(function () { });

    var nb = $('#ad-new');
    if (nb) nb.addEventListener('click', function () { openAdEditor(null, maxSec, reload); });
    var rb = $('#ad-ref');
    if (rb) rb.addEventListener('click', reload);
    var sc = $('#ad-spec-copy');
    if (sc) sc.addEventListener('click', function () {
      copyText(adSpecText(ADSEC.min, ADSEC.max), function () { toast('مشخصات تبلیغ کپی شد ✓', 'ok'); });
    });

    var gs = $('#adg-save');
    if (gs) gs.addEventListener('click', function () {
      gs.disabled = true;
      api('/admin/settings', { method: 'POST', body: {
        adGateEnabled: $('#adg-on').checked,
        adGateBtnText: $('#adg-btn').value.trim(),
        adGateTitle: $('#adg-title').value.trim(),
        adGateNote: $('#adg-note').value,
      } }).then(function () {
        gs.disabled = false;
        toast('ذخیره شد ✓', 'ok');
      }).catch(function (e) { gs.disabled = false; toast(e.message, 'err'); });
    });

    $all('[data-ad-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ad-edit');
        if (byId[id]) { openAdEditor(byId[id], maxSec, reload); return; }
        api('/admin/ads').then(function (d) {
          var hit = null;
          (d.ads || []).forEach(function (a) { if (a.id === id) hit = a; });
          if (hit) openAdEditor(hit, d.maxSec || 20, reload);
          else toast('تبلیغ یافت نشد', 'err');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
    });
    $all('[data-ad-tog]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/admin/ads/' + b.getAttribute('data-ad-tog') + '/toggle', { method: 'POST' })
          .then(reload).catch(function (e) { toast(e.message, 'err'); });
      });
    });
    $all('[data-ad-reset]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/admin/ads/' + b.getAttribute('data-ad-reset') + '/reset', { method: 'POST' })
          .then(function () { toast('آمار صفر شد', 'ok'); reload(); })
          .catch(function (e) { toast(e.message, 'err'); });
      });
    });
    $all('[data-ad-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var nm = b.getAttribute('data-name');
        openModal('حذف تبلیغ', '<p style="font-size:14px;color:var(--tx2)">«' + esc(nm) + '» و آمار آن حذف شود؟</p><div class="adm-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost btn-sm" id="m-cancel">انصراف</button><button class="btn btn-danger btn-sm" id="m-yes">حذف</button></div>', function (wrap, close) {
          $('#m-cancel', wrap).addEventListener('click', close);
          $('#m-yes', wrap).addEventListener('click', function () {
            api('/admin/ads/' + b.getAttribute('data-ad-del') + '/delete', { method: 'POST' }).then(function () {
              close();
              toast('حذف شد', 'ok');
              reload();
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
      });
    });
  }
  if (tab === 'content') {
    var urlIn = $('#adm-url');
    var pvBox = $('#adm-preview');
    function preview () {
      var u = urlIn.value.trim();
      if (!u) { toast('لینک را وارد کنید', 'err'); return; }
      pvBox.innerHTML = '<div class="spin" style="margin:10px auto"></div>';
      api('/admin/validate', { method: 'POST', body: { url: u } }).then(function (r) {
        pvBox.innerHTML = '<div class="adm-item" style="margin-top:8px">' +
          (r.thumb ? '<div class="th" style="background-image:url(' + r.thumb + ')"></div>' : '') +
          '<div class="inf"><b>' + esc(r.caption ? r.caption.split(NL)[0].slice(0, 80) : (r.docName || 'محتوا')) + '</b><span>' +
          '<em class="badge acc">' + esc(r.kind || '') + '</em>' +
          (r.sizeBytes ? '<em class="badge">' + fmtBytes(r.sizeBytes) + '</em>' : '') +
          (r.w ? '<em class="badge">' + r.w + '×' + r.h + '</em>' : '') +
          '</span></div></div>';
      }).catch(function (e) { pvBox.innerHTML = ''; toast(e.message, 'err'); });
    }
    $('#adm-preview').addEventListener('click', preview);
    $('#adm-add').addEventListener('click', function () {
      var u = urlIn.value.trim();
      if (!u) { toast('لینک را وارد کنید', 'err'); return; }
      var btn = $('#adm-add');
      btn.disabled = true; btn.textContent = 'در حال دریافت…';
      api('/admin/item', { method: 'POST', body: { url: u } }).then(function (r) {
        toast('ثبت شد ✓', 'ok');
        openItemEdit(r.item.id, null);
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '➕ افزودن';
        if (e.data && e.data.duplicate) toast('این پست قبلاً ثبت شده', 'err');
        else toast(e.message, 'err');
      });
    });
    $all('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openItemEdit(b.getAttribute('data-edit'), null); });
    });
    $all('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var nm = b.getAttribute('data-name');
        openModal('حذف محتوا', '<p style="font-size:14px;color:var(--tx2)">«' + esc(nm) + '» برای همیشه حذف شود؟</p><div class="adm-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost btn-sm" id="m-cancel">انصراف</button><button class="btn btn-danger btn-sm" id="m-yes">حذف</button></div>', function (wrap, close) {
          $('#m-cancel', wrap).addEventListener('click', close);
          $('#m-yes', wrap).addEventListener('click', function () {
            api('/admin/item/' + b.getAttribute('data-del'), { method: 'DELETE' }).then(function () {
              toast('حذف شد', 'ok'); close();
              loadAdminTab('content', q);
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
      });
    });
  }
  if (tab === 'users') {
    $all('[data-role-for]').forEach(function (s) {
      s.addEventListener('change', function () {
        api('/admin/users/' + s.getAttribute('data-role-for') + '/role', { method: 'POST', body: { role: s.value } }).then(function () {
          toast('سطح تغییر کرد ✓', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
    });
    $all('[data-w-user]').forEach(function (b) {
      b.addEventListener('click', function () {
        var un = b.getAttribute('data-w-user');
        openModal('شارژ کیف پول «' + un + '»', '<div class="field"><label>مبلغ (مثبت = شارژ، منفی = کسر)</label><input id="w-am" type="number"></div><div class="field"><label>توضیح</label><input id="w-note" value="شارژ توسط مدیر"></div><button class="btn btn-primary btn-block" id="w-go">ثبت</button>', function (wrap, close) {
          $('#w-go', wrap).addEventListener('click', function () {
            api('/admin/users/' + un + '/wallet', { method: 'POST', body: { amount: parseFloat($('#w-am', wrap).value), note: $('#w-note', wrap).value } }).then(function () {
              toast('انجام شد', 'ok'); close(); loadAdminTab('users', q);
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
      });
    });
    $all('[data-del-user]').forEach(function (b) {
      b.addEventListener('click', function () {
        openModal('حذف کاربر', '<p style="font-size:14px">کاربر «' + esc(b.getAttribute('data-del-user')) + '» حذف شود؟</p><div class="adm-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost btn-sm" id="m-cancel">انصراف</button><button class="btn btn-danger btn-sm" id="m-yes">حذف</button></div>', function (wrap, close) {
          $('#m-cancel', wrap).addEventListener('click', close);
          $('#m-yes', wrap).addEventListener('click', function () {
            api('/admin/users/' + b.getAttribute('data-del-user') + '/delete', { method: 'POST' }).then(function () {
              toast('حذف شد', 'ok'); close();
              loadAdminTab('users', q);
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
      });
    });
  }
  if (tab === 'pays') {
    function decide (id, ok) {
      api('/admin/k2k/' + id + '/' + (ok ? 'approve' : 'reject'), { method: 'POST', body: {} }).then(function () {
        toast(ok ? 'تأیید شد ✓ سکه نشست' : 'رد شد', ok ? 'ok' : 'err');
        loadAdminTab('pays', q);
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    $all('[data-k2k-ok]').forEach(function (b) {
      b.addEventListener('click', function () { decide(b.getAttribute('data-k2k-ok'), true); });
    });
    $all('[data-k2k-no]').forEach(function (b) {
      b.addEventListener('click', function () { decide(b.getAttribute('data-k2k-no'), false); });
    });
    var ref = $('#pays-ref');
    if (ref) ref.addEventListener('click', function () { loadAdminTab('pays', q); });
    if (window.__paysTimer) { clearInterval(window.__paysTimer); window.__paysTimer = null; }
    window.__paysTimer = setInterval(function () {
      var h = String(location.hash || '');
      if (h.indexOf('admin/pays') < 0) { clearInterval(window.__paysTimer); window.__paysTimer = null; return; }
      api('/admin/k2k').then(function (data) {
        var pane = $('#adm-pane');
        if (!pane) return;
        pane.innerHTML = adminTabHtml('pays', data, q);
        bindAdminTab('pays', q);
      }).catch(function () {});
    }, 8000);
  }
  if (tab === 'codes') {
    var modeEl = $('#code-mode');
    var maxWrap = $('#code-max-wrap');
    function syncCodeMax () {
      if (maxWrap) maxWrap.style.display = (modeEl && modeEl.value === 'quota') ? '' : 'none';
    }
    if (modeEl) modeEl.addEventListener('change', syncCodeMax);
    syncCodeMax();
    $('#code-add').addEventListener('click', function () {
      var days = parseInt($('#code-days').value, 10) || 30;
      var units = parseFloat($('#code-units').value) || 100;
      var mode = (modeEl && modeEl.value) || 'once';
      var maxUsers = parseInt($('#code-max') && $('#code-max').value, 10) || 10;
      api('/admin/codes', { method: 'POST', body: { units: units, days: days, mode: mode, maxUsers: maxUsers } }).then(function (r) {
        var el = $('#code-new');
        el.style.display = '';
        el.textContent = 'کد جدید: ' + r.code;
        copyText(r.code, null);
        toast('کد ساخته شد و کپی شد ✓', 'ok');
        setTimeout(function () { loadAdminTab('codes', q); }, 800);
      }).catch(function (e) { toast(e.message, 'err'); });
    });
    $all('[data-del-code]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/admin/codes/' + b.getAttribute('data-del-code') + '/delete', { method: 'POST' }).then(function () {
          toast('کد حذف شد', 'ok');
          loadAdminTab('codes', q);
        }).catch(function (e) { toast(e.message, 'err'); });
      });
    });
  }
  if (tab === 'settings') {
    bindDatabaseMaintenance();
    bindContentSetup();
    var contentSetup = $('#content-bot-setup');
    if (contentSetup) contentSetup.addEventListener('click', function () {
      var status = $('#content-bot-status');
      contentSetup.disabled = true; status.textContent = 'در حال ثبت وبهوک…';
      api('/admin/content-bot/setup', {method:'POST',body:{}}).then(function (r) {
        status.textContent = 'وبهوک ثبت شد: ' + r.url;
      }).catch(function (e) { status.textContent = e.message; }).finally(function () { contentSetup.disabled = false; });
    });
    $('#set-save').addEventListener('click', function () {
      var body = {
        siteName: $('#set-name').value.trim(),
        tagline: $('#set-tag').value.trim(),
        requireLogin: $('#set-reqlogin').checked,
        botUsername: ($('#set-botun') && $('#set-botun').value.trim()) || undefined,
        deliveryBotUsername: ($('#set-fbotun') && $('#set-fbotun').value.trim()) || undefined,
        vaultRewrite: ($('#set-vault') && $('#set-vault').value) || undefined,
        vaultChatId: ($('#set-vaultid') && $('#set-vaultid').value.trim()) || undefined,
        walletUnitName: $('#set-unit').value.trim(),
        signupBonus: $('#set-signup-bonus').value,
        dlClickPrice: $('#set-dlp').value,
        sub1m: $('#set-s1').value, sub3m: $('#set-s3').value, sub6m: $('#set-s6').value, sub1y: $('#set-s12').value,
        refSignupBonus: $('#set-refb').value, refPurchasePercent: $('#set-refp').value,
        vanishSec: $('#set-van').value,
        starsEnabled: $('#set-stars').checked,
        starPacksText: $('#set-star-packs').value,
        k2kEnabled: !!( $('#set-k2k') && $('#set-k2k').checked ),
        k2kCardNumber: ($('#set-k2k-card') && $('#set-k2k-card').value) || '',
        k2kCardHolder: ($('#set-k2k-holder') && $('#set-k2k-holder').value) || '',
        k2kCardBank: ($('#set-k2k-bank') && $('#set-k2k-bank').value) || '',
        k2kTtlSec: Math.round(Math.max(10, parseFloat($('#set-k2k-ttl') && $('#set-k2k-ttl').value) || 30) * 60),
        k2kPacksText: ($('#set-k2k-packs') && $('#set-k2k-packs').value) || '',
        fileCaption: $('#set-caption').value,
        adEnabled: $('#set-ad-on').checked,
        adButtonText: $('#set-ad-txt').value.trim(),
        adButtonUrl: $('#set-ad-url').value.trim(),
      };
      var btEl = $('#set-bot');
      var bt = btEl ? btEl.value.trim() : '';
      if (bt) body.botToken = bt;
      var ftEl = $('#set-fbot');
      var ft = ftEl ? ftEl.value.trim() : '';
      if (ft) body.deliveryBotToken = ft;
      var shopsEl = $('#set-shops');
      if (shopsEl) body.starShopsText = shopsEl.value;
      var ksec = $('#set-k2k-secret');
      if (ksec && ksec.value.trim()) body.k2kSecret = ksec.value.trim();
      api('/admin/settings', { method: 'POST', body: body }).then(function (r) {
        toast('ذخیره شد', 'ok');
        APP.siteName = (r.siteName || body.siteName || APP.siteName);
        APP.tagline = (r.tagline != null ? r.tagline : (body.tagline || APP.tagline));
        if (r.economy) APP.economy = r.economy;
        applySiteBranding();
        loadAdminTab('settings', q);
      }).catch(function (e) { toast(e.message, 'err'); });
    });
    $('#set-test').addEventListener('click', function () {
      var out = $('#set-test-out');
      out.style.display = '';
      out.className = 'badge';
      out.textContent = 'در حال تست…';
      api('/admin/test-bot', { method: 'POST' }).then(function (r) {
        out.className = 'badge acc';
        out.textContent = 'ربات: @' + (r.bot.username || '');
      }).catch(function (e) {
        out.className = 'badge red';
        out.textContent = e.message;
      });
    });
    var vt = $('#set-vault-test');
    if (vt) vt.addEventListener('click', function () {
      var out = $('#set-vault-out');
      out.style.display = '';
      out.className = 'badge';
      out.textContent = 'در حال تست مخزن…';
      var url = ($('#set-vaultid') && $('#set-vaultid').value.trim()) || '';
      api('/admin/test-vault', { method: 'POST', body: { url: url } }).then(function (r) {
        out.className = r.ok ? 'badge acc' : 'badge red';
        var bot = (r.bot && r.bot.username) ? ('@' + r.bot.username) : '';
        var chat = (r.getChat && r.getChat.title) ? r.getChat.title : ((r.getChat && r.getChat.error) || '');
        var copy = r.copyMessage ? (r.copyMessage.ok ? 'کپی شد' : (r.copyMessage.error || '')) : '';
        out.textContent = (bot + ' | ' + chat + (copy ? (' | ' + copy) : '') + (r.hint ? (' | ' + r.hint) : '')).replace(/^ \| /, '');
        if (!r.ok) toast(r.hint || chat || 'ناموفق', 'err');
        else toast('ربات کانال را می‌بیند' + (copy ? ' — ' + copy : ''), 'ok');
      }).catch(function (e) {
        out.className = 'badge red';
        out.textContent = e.message;
        toast(e.message, 'err');
      });
    });
  }
}

function openItemEdit (id, prefillUrl) {
  api('/item/' + id).then(function (r) {
    openItemEditor(r.item, prefillUrl);
  }).catch(function (e) {
    toast('بارگذاری آیتم ناموفق بود: ' + e.message, 'err');
  });
}
function openItemEditor (it, prefillUrl) {
  var isSeries = it.type === 'series';
  function cellOf (bag, track, q) {
    return bag && bag.variants && bag.variants[track] && bag.variants[track][q];
  }
  function cellPrem (bag, track, q) {
    var v = cellOf(bag, track, q);
    return !!(v && v.premium);
  }
  function cellFiles (bag, track, q) {
    var v = cellOf(bag, track, q);
    if (!v) return [];
    if (v.files && v.files.length) return v.files;
    if (v.source) return [{ id: '', title: v.title || '', source: v.source }];
    return [];
  }
  function qualityIds (bag, track) {
    var v = (bag && bag.variants && bag.variants[track]) || {};
    return Object.keys(v);
  }
  function qLabel (bag, track, q) {
    var cell = cellOf(bag, track, q);
    if (cell && cell.label) return cell.label;
    return (Q_LABEL && Q_LABEL[q]) || q;
  }
  function variantGridHtml (bag, epId) {
    var tracks = [{ k: 'sub', l: 'زیرنویس' }, { k: 'dub', l: 'دوبله' }];
    return tracks.map(function (t) {
      var ids = qualityIds(bag, t.k);
      var blocks = ids.map(function (q) {
        var files = cellFiles(bag, t.k, q);
        var prem = cellPrem(bag, t.k, q);
        /* کیفیت اصلی فقط عنوان است (بدون لینک)؛ همهٔ فایل‌ها به‌صورت
           «نسخهٔ دیگر» با عنوان + لینک نمایش داده می‌شوند. */
        var extras = files;
        var extraHtml = extras.map(function (f) {
          return '<div class="var-extra">' +
            '<input data-vt="' + t.k + '-' + q + '-' + (epId || '') + '-' + esc(f.id) + '" placeholder="عنوان نسخه" value="' + esc(f.title || '') + '">' +
            '<input data-vu2="' + t.k + '-' + q + '-' + (epId || '') + '-' + esc(f.id) + '" placeholder="https://t.me/kanal/123,https://t.me/kanal/124" title="حداکثر ۱۰ لینک؛ جداکننده ویرگول انگلیسی یا فارسی" value="' + esc(sourceHref(f.source) || '') + '" dir="ltr">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-vf="' + t.k + ':' + q + ':' + (epId || '') + ':' + esc(f.id) + '">ثبت</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-vd="' + t.k + ':' + q + ':' + (epId || '') + ':' + esc(f.id) + '">حذف</button></div>';
        }).join('');
        return '<div class="var-q">' +
          '<div class="var-row var-row-lab">' +
          '<input data-ql="' + t.k + '-' + q + (epId ? '-' + epId : '') + '" placeholder="عنوان کیفیت" value="' + esc(qLabel(bag, t.k, q)) + '">' +
          '<button type="button" class="btn btn-ghost btn-sm star-btn' + (prem ? ' on' : '') + '" data-vp="' + t.k + ':' + q + ':' + (epId || '') + '" data-on="' + (prem ? '1' : '0') + '" title="فقط اشتراک">⭐</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-vq="' + t.k + ':' + q + ':' + (epId || '') + '" title="حذف این کیفیت">🗑</button></div>' +
          extraHtml +
          '<button type="button" class="btn btn-ghost btn-sm var-add" data-va="' + t.k + ':' + q + ':' + (epId || '') + '">＋ نسخه دیگر (عنوان + لینک‌ها)</button>' +
          '</div>';
      }).join('');
      return '<div class="var-block"><h5>' + t.l + '</h5>' +
        (blocks || '<p style="font-size:12.5px;color:var(--tx3)">هنوز کیفیتی نیست — پایین اضافه کنید.</p>') +
        '<div class="var-extra var-newq">' +
        '<input class="nq-lab" placeholder="عنوان کیفیت مثلاً 720p WEB-DL">' +
        '<button type="button" class="btn btn-primary btn-sm" data-nq="' + t.k + ':' + (epId || '') + '">افزودن کیفیت</button></div></div>';
    }).join('');
  }
  var html =
    '<div class="adm-box" style="margin-bottom:14px"><h4>پر کردن از پست کانال</h4>' +
    '<p style="font-size:12.5px;color:var(--tx3);margin-bottom:8px">لینک پیامی را بگذارید که مشخصات فیلم یا سریال در متن/کپشن آن است. فیلدها خودکار پر می‌شوند.</p>' +
    '<div class="adm-row"><input id="e-info-url" dir="ltr" placeholder="https://t.me/kanal/123,https://t.me/kanal/124" title="حداکثر ۱۰ لینک؛ جداکننده ویرگول انگلیسی یا فارسی" style="flex:1;min-width:180px">' +
    '<button type="button" class="btn btn-primary btn-sm" id="e-info-fill">پر کردن فیلدها</button></div></div>' +
    '<div class="field"><label>عنوان</label><input id="e-title" value="' + esc(it.title || '') + '"></div>' +
    '<div class="form-2col">' +
    '<div class="field"><label>نوع</label><select id="e-type"><option value="movie"' + (it.type === 'movie' ? ' selected' : '') + '>فیلم</option><option value="series"' + (it.type === 'series' ? ' selected' : '') + '>سریال</option><option value="clip"' + (it.type === 'clip' ? ' selected' : '') + '>کلیپ</option></select></div>' +
    '<div class="field"><label id="e-year-lab">' + (isSeries ? 'سال شروع (فصل اول)' : 'سال تولید') + '</label><input id="e-year" type="number" min="1888" max="2199" value="' + (it.year || '') + '" placeholder="2021"></div>' +
    '</div>' +
    /* سریال: سال آخرین فصل + وضعیت پخش */
    '<div id="e-series-box"' + (isSeries ? '' : ' style="display:none"') + '>' +
    '<div class="form-2col">' +
    '<div class="field"><label>سال آخرین فصل</label><input id="e-year-end" type="number" min="1888" max="2199" value="' + (it.yearEnd || '') + '" placeholder="مثلاً 2024"><div class="field-hint">خالی بگذارید اگر فقط یک فصل دارد. در سایت به شکل «۲۰۲۱ – ۲۰۲۴» نمایش داده می‌شود.</div></div>' +
    '</div>' +
    '<div class="airing-box"><h4>🔴 وضعیت پخش سریال</h4>' +
    '<label class="sw live"><input type="checkbox" id="e-airing"' + (it.airing ? ' checked' : '') + '><i></i><span>در حال پخش است</span></label>' +
    '<div class="airing-fields' + (it.airing ? '' : ' off') + '" id="e-airing-fields">' +
    '<div class="field"><label>فصل در حال پخش</label><input id="e-airing-season" type="number" min="1" max="999" value="' + (it.airingSeason || '') + '" placeholder="3"></div>' +
    '<div class="field"><label>متن دلخواه (اختیاری)</label><input id="e-airing-text" maxlength="80" value="' + esc(it.airingText || '') + '" placeholder="مثلاً: فصل ۳ — هر جمعه قسمت جدید"><div class="field-hint">اگر خالی باشد خودکار «فصل N در حال پخش» نوشته می‌شود. سریال‌های در حال پخش در صفحهٔ اصلی ردیف جدا دارند.</div></div>' +
    '</div></div>' +
    '</div>' +
    '<div class="field"><label>ژانرها (با ویرگول)</label><input id="e-genres" value="' + esc((it.genres || []).join(', ')) + '" placeholder="اکشن، درام"></div>' +
    '<div class="form-2col">' +
    '<div class="field"><label>کارگردان</label><input id="e-dir" value="' + esc(it.director || '') + '"></div>' +
    '<div class="field"><label>بازیگران</label><input id="e-act" value="' + esc(it.actors || '') + '" placeholder="با ویرگول جدا کنید"></div>' +
    '<div class="field"><label>کشور</label><input id="e-country" value="' + esc(it.country || '') + '" placeholder="آمریکا"></div>' +
    '<div class="field"><label>رده سنی</label><input id="e-age" value="' + esc(it.ageRating || '') + '" placeholder="PG-13"></div>' +
    '<div class="field"><label>شبکه</label><input id="e-net" value="' + esc(it.network || '') + '" placeholder="Netflix"></div>' +
    '<div class="field"><label>امتیاز IMDb</label><input id="e-imdb" type="number" min="0" max="10" step="0.1" value="' + (it.imdb || '') + '"></div>' +
    '<div class="field"><label>مدت (دقیقه)</label><input id="e-dur" type="number" min="0" value="' + (it.duration || '') + '"></div>' +
    '</div>' +
    '<div class="ps-toggles" style="margin-bottom:12px">' +
    '<label class="ps-tog' + (it.dubbed ? ' on' : '') + '"><input type="checkbox" id="e-dub" style="width:auto"' + (it.dubbed ? ' checked' : '') + '> دوبله فارسی</label>' +
    '<label class="ps-tog' + (it.subtitled ? ' on' : '') + '"><input type="checkbox" id="e-sub" style="width:auto"' + (it.subtitled ? ' checked' : '') + '> زیرنویس</label>' +
    '</div>' +
    '<div class="field"><label>لینک پوستر (هر سایت — http/https)</label><input id="e-poster" dir="ltr" value="' + esc(it.posterOverride || '') + '" placeholder="https://example.com/poster.jpg"></div>' +
    galleryEditorHtml(it) +
    '<div class="field"><label>لینک فایل تلگرام</label><input id="e-source" value="' + esc(prefillUrl || sourceHref(it.source) || '') + '" placeholder="https://t.me/kanal/12345"></div>' +
    '<div class="field"><label>توضیحات</label><textarea id="e-desc">' + esc(it.description || '') + '</textarea></div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;margin-bottom:12px"><input type="checkbox" id="e-featured" style="width:auto"' + (it.featured ? ' checked' : '') + '> ⭐ نمایش در هیرو صفحهٔ اصلی</label>' +
    (isSeries ? '' : ('<div class="d-sec-h">کیفیت‌ها و نوع صدا</div><p style="font-size:12px;color:var(--tx3);margin-bottom:8px">کیفیت اصلی فقط عنوان است (بدون لینک). زیر هر کیفیت با «نسخه دیگر» فایل را با عنوان و لینک اضافه کنید. ستاره یعنی فقط اشتراک.</p><div id="e-var">' + variantGridHtml(it, '') + '</div>')) +
    (isSeries ? (
      '<div class="d-sec-h">فصل‌ها و قسمت‌ها</div>' +
      '<p style="font-size:12px;color:var(--tx3);margin-bottom:8px">ستاره روی قسمت کل قسمت را قفل اشتراک می‌کند؛ ستاره کنار کیفیت همان فایل را.</p>' +
      '<div class="adm-row"><input id="e-sn" type="number" placeholder="شماره فصل" style="width:110px" value="' + ((seasonsOf(it).length || 0) + 1) + '"><input id="e-st" placeholder="عنوان فصل" style="flex:1;min-width:120px"><button class="btn btn-ghost btn-sm" id="e-s-add">➕ فصل</button></div>' +
      '<div class="adm-row" style="margin-top:8px"><select id="e-ep-s" class="sel" style="width:120px"></select><input id="e-ep-title" placeholder="عنوان قسمت" style="width:140px"><input id="e-ep-url" placeholder="https://t.me/kanal/123,https://t.me/kanal/124" title="حداکثر ۱۰ لینک؛ جداکننده ویرگول انگلیسی یا فارسی" style="flex:1;min-width:140px" dir="ltr">' +
      '<select id="e-ep-track" class="sel"><option value="sub">زیرنویس</option><option value="dub">دوبله</option></select>' +
      '<input id="e-ep-q" placeholder="عنوان کیفیت مثلاً 1080p WEB-DL" style="width:160px" value="1080p">' +
      '<button class="btn btn-ghost btn-sm" id="e-ep-add">افزودن</button></div>' +
      '<div id="e-eps" style="margin-top:10px"></div>'
    ) : '') +
    '<div class="adm-row" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-ghost" id="e-cancel">انصراف</button><button class="btn btn-primary" id="e-save">💾 ذخیره</button></div>';
  openModal('ویرایش محتوا', html, function (wrap, close) {
    $('#e-cancel', wrap).addEventListener('click', close);
    /* نمایش فیلدهای مخصوص سریال بر اساس «نوع» */
    function syncSeriesBox () {
      var ty = $('#e-type', wrap);
      var box = $('#e-series-box', wrap);
      var lab = $('#e-year-lab', wrap);
      var ser = ty && ty.value === 'series';
      if (box) box.style.display = ser ? '' : 'none';
      if (lab) lab.textContent = ser ? 'سال شروع (فصل اول)' : 'سال تولید';
    }
    var tySel = $('#e-type', wrap);
    if (tySel) tySel.addEventListener('change', syncSeriesBox);
    var airChk = $('#e-airing', wrap);
    if (airChk) airChk.addEventListener('change', function () {
      var f = $('#e-airing-fields', wrap);
      if (f) f.className = 'airing-fields' + (airChk.checked ? '' : ' off');
      if (airChk.checked) {
        var sIn = $('#e-airing-season', wrap);
        if (sIn && !sIn.value) sIn.value = String(seasonsOf(it).length || 1);
      }
    });
    var galleryEditor = bindGalleryEditor(wrap, it);
    function applyParsed (f) {
      if (!f) return;
      function setv (id, v) {
        var el = $(id, wrap);
        if (!el || v == null || v === '' || v === 0) return;
        el.value = v;
      }
      setv('#e-title', f.title);
      if (f.type) {
        var ty = $('#e-type', wrap);
        if (ty) ty.value = f.type;
      }
      setv('#e-year', f.year);
      setv('#e-year-end', f.yearEnd);
      if (f.genres && f.genres.length) setv('#e-genres', Array.isArray(f.genres) ? f.genres.join('، ') : f.genres);
      setv('#e-dir', f.director);
      setv('#e-act', f.actors);
      setv('#e-country', f.country);
      setv('#e-age', f.ageRating);
      setv('#e-net', f.network);
      setv('#e-imdb', f.imdb);
      setv('#e-dur', f.duration);
      setv('#e-desc', f.description);
      if (f.poster) setv('#e-poster', f.poster);
      if (f.dubbed) {
        var d = $('#e-dub', wrap);
        if (d) { d.checked = true; if (d.parentNode && d.parentNode.className.indexOf('ps-tog') >= 0) d.parentNode.className = 'ps-tog on'; }
      }
      if (f.subtitled) {
        var s = $('#e-sub', wrap);
        if (s) { s.checked = true; if (s.parentNode && s.parentNode.className.indexOf('ps-tog') >= 0) s.parentNode.className = 'ps-tog on'; }
      }
      toast('فیلدها از پست کانال پر شد ✓', 'ok');
    }
    var fillBtn = $('#e-info-fill', wrap);
    if (fillBtn) fillBtn.addEventListener('click', function () {
      var u = ($('#e-info-url', wrap) && $('#e-info-url', wrap).value.trim()) || '';
      if (!u) { toast('لینک پست مشخصات را بگذارید', 'err'); return; }
      fillBtn.disabled = true; fillBtn.textContent = 'در حال خواندن پست…';
      api('/admin/parse-info', { method: 'POST', body: { url: u } }).then(function (r) {
        fillBtn.disabled = false; fillBtn.textContent = 'پر کردن فیلدها';
        applyParsed(r.fields || {});
      }).catch(function (e) {
        fillBtn.disabled = false; fillBtn.textContent = 'پر کردن فیلدها';
        toast(e.message, 'err');
      });
    });
    function saveMeta () {
      var body = {
        title: $('#e-title', wrap).value.trim(),
        type: $('#e-type', wrap).value,
        year: $('#e-year', wrap).value,
        yearEnd: $('#e-year-end', wrap) ? $('#e-year-end', wrap).value : '',
        airing: !!($('#e-airing', wrap) && $('#e-airing', wrap).checked),
        airingSeason: $('#e-airing-season', wrap) ? $('#e-airing-season', wrap).value : '',
        airingText: $('#e-airing-text', wrap) ? $('#e-airing-text', wrap).value.trim() : '',
        genres: $('#e-genres', wrap).value,
        description: $('#e-desc', wrap).value,
        featured: $('#e-featured', wrap).checked,
        director: $('#e-dir', wrap).value.trim(),
        actors: $('#e-act', wrap).value.trim(),
        country: $('#e-country', wrap).value.trim(),
        ageRating: $('#e-age', wrap).value.trim(),
        network: $('#e-net', wrap).value.trim(),
        imdb: $('#e-imdb', wrap).value,
        duration: $('#e-dur', wrap).value,
        dubbed: $('#e-dub', wrap).checked,
        subtitled: $('#e-sub', wrap).checked,
      };
      if (galleryEditor) {
        var galleryUrl = galleryEditor.value();
        if (galleryUrl !== undefined) body.galleryUrl = galleryUrl;
        if (galleryEditor.limit) {
          var galleryLimit = galleryEditor.limit();
          if (galleryLimit !== undefined) body.galleryLimit = galleryLimit;
        }
      }
      var poster = $('#e-poster', wrap);
      if (poster) body.posterUrl = poster.value.trim();
      var su = $('#e-source', wrap).value.trim();
      if (su) body.sourceUrl = su;
      var btn = $('#e-save', wrap);
      btn.disabled = true; btn.textContent = 'در حال ذخیره…';
      api('/admin/item/' + it.id, { method: 'POST', body: body }).then(function () {
        toast('ذخیره شد ✓', 'ok');
        close();
        refreshAfterAdmin();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '💾 ذخیره';
        toast(e.message, 'err');
      });
    }
    $('#e-save', wrap).addEventListener('click', saveMeta);
    function rebindVar (root, epid) {
      var bag = it;
      if (epid) {
        var ss = seasonsOf(it);
        var i, j;
        for (i = 0; i < ss.length; i++) {
          for (j = 0; j < (ss[i].episodes || []).length; j++) {
            if (ss[i].episodes[j].id === epid) bag = ss[i].episodes[j];
          }
        }
      }
      root.innerHTML = variantGridHtml(bag || {}, epid || '');
      bindVar(root, epid || '');
    }
    function bindVar (root, epId) {
      $all('[data-vp]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-vp').split(':');
          var track = parts[0];
          var q = parts[1];
          var epid = parts[2] || epId || '';
          var on = b.getAttribute('data-on') === '1';
          b.disabled = true;
          api('/admin/item/' + it.id + '/variant', { method: 'POST', body: { track: track, quality: q, epId: epid, premium: !on } }).then(function (r) {
            it = r.item;
            b.disabled = false;
            b.setAttribute('data-on', on ? '0' : '1');
            b.className = 'btn btn-ghost btn-sm star-btn' + (on ? '' : ' on');
            toast(on ? 'قفل اشتراک این کیفیت برداشته شد' : 'این کیفیت فقط با اشتراک', 'ok');
          }).catch(function (e) {
            b.disabled = false;
            toast(e.message, 'err');
          });
        });
      });
      $all('[data-va]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-va').split(':');
          var track = parts[0], q = parts[1], epid = parts[2] || epId || '';
          var row = document.createElement('div');
          row.className = 'var-extra';
          row.innerHTML = '<input class="vf-new-t" placeholder="عنوان نسخه مثلاً دوبله دوم">' +
            '<input class="vf-new-u" placeholder="https://t.me/kanal/123,https://t.me/kanal/124" title="حداکثر ۱۰ لینک؛ جداکننده ویرگول انگلیسی یا فارسی" dir="ltr">' +
            '<button type="button" class="btn btn-primary btn-sm vf-new-go">ثبت</button>' +
            '<button type="button" class="btn btn-ghost btn-sm vf-new-x">انصراف</button>';
          b.parentNode.insertBefore(row, b);
          $('.vf-new-x', row).addEventListener('click', function () { row.remove(); });
          $('.vf-new-go', row).addEventListener('click', function () {
            var title = ($('.vf-new-t', row) && $('.vf-new-t', row).value.trim()) || '';
            var url = ($('.vf-new-u', row) && $('.vf-new-u', row).value.trim()) || '';
            if (!url) { toast('لینک نسخه را وارد کنید', 'err'); return; }
            api('/admin/item/' + it.id + '/variant', { method: 'POST', body: { track: track, quality: q, url: url, title: title, addFile: true, epId: epid } }).then(function (r) {
              it = r.item;
              toast('نسخه اضافه شد ✓', 'ok');
              rebindVar(root, epid);
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
      });
      $all('[data-vf]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-vf').split(':');
          var track = parts[0], q = parts[1], epid = parts[2] || epId || '', fid = parts[3] || '';
          var titleEl = $('[data-vt="' + track + '-' + q + '-' + (epid || '') + '-' + fid + '"]', root);
          var urlEl = $('[data-vu2="' + track + '-' + q + '-' + (epid || '') + '-' + fid + '"]', root);
          api('/admin/item/' + it.id + '/variant', { method: 'POST', body: {
            track: track, quality: q, epId: epid, fileId: fid,
            title: titleEl ? titleEl.value.trim() : '',
            url: urlEl ? urlEl.value.trim() : ''
          } }).then(function (r) {
            it = r.item;
            toast('نسخه ذخیره شد ✓', 'ok');
            rebindVar(root, epid);
          }).catch(function (e) { toast(e.message, 'err'); });
        });
      });
      $all('[data-vd]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-vd').split(':');
          var track = parts[0], q = parts[1], epid = parts[2] || epId || '', fid = parts[3] || '';
          api('/admin/item/' + it.id + '/variant', { method: 'POST', body: { track: track, quality: q, epId: epid, fileId: fid, removeFile: true } }).then(function (r) {
            it = r.item;
            toast('نسخه حذف شد', 'ok');
            rebindVar(root, epid);
          }).catch(function (e) { toast(e.message, 'err'); });
        });
      });
      $all('[data-vq]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-vq').split(':');
          var track = parts[0], q = parts[1], epid = parts[2] || epId || '';
          api('/admin/item/' + it.id + '/variant', { method: 'POST', body: { track: track, quality: q, epId: epid, removeQuality: true } }).then(function (r) {
            it = r.item;
            toast('کیفیت حذف شد', 'ok');
            rebindVar(root, epid);
          }).catch(function (e) { toast(e.message, 'err'); });
        });
      });
      $all('[data-nq]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var parts = b.getAttribute('data-nq').split(':');
          var track = parts[0], epid = parts[1] || epId || '';
          var box = b.parentNode;
          var lab = ($('.nq-lab', box) && $('.nq-lab', box).value.trim()) || '';
          if (!lab) { toast('عنوان کیفیت را بنویسید', 'err'); return; }
          /* کیفیت اصلی فقط عنوان دارد (بدون لینک) */
          api('/admin/item/' + it.id + '/variant', { method: 'POST', body: { track: track, qualityLabel: lab, addQuality: true, epId: epid } }).then(function (r) {
            it = r.item;
            toast('کیفیت اضافه شد ✓', 'ok');
            rebindVar(root, epid);
          }).catch(function (e) { toast(e.message, 'err'); });
        });
      });
    }
    if (!isSeries) bindVar($('#e-var', wrap), '');
    if (isSeries) {
      function fillSeasonSelect () {
        var sel = $('#e-ep-s', wrap);
        var ss = seasonsOf(it);
        sel.innerHTML = ss.map(function (s) {
          return '<option value="' + (s.n || 1) + '">' + esc(s.title || ('فصل ' + (s.n || 1))) + '</option>';
        }).join('') || '<option value="1">فصل ۱</option>';
      }
      function renderEps () {
        var box = $('#e-eps', wrap);
        var ss = seasonsOf(it);
        box.innerHTML = ss.map(function (s) {
          var head = '<div class="d-sec-h" style="margin:12px 0 8px">📺 ' + esc(s.title || ('فصل ' + (s.n || 1))) + '</div>';
          var eps = (s.episodes || []).map(function (e, i) {
            return '<div class="ep" style="flex-wrap:wrap"><span class="ep-n">' + faNum(e.n || (i + 1)) + '</span><span class="ep-t">' + esc(e.title) + '</span>' +
              '<button type="button" class="btn btn-ghost btn-sm ep-star' + (e.premium ? ' on' : '') + '" data-epstar="' + e.id + '" data-on="' + (e.premium ? '1' : '0') + '" title="کل قسمت فقط اشتراک">⭐</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-epq="' + e.id + '">کیفیت‌ها</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-epl="' + e.id + '">🗑</button>' +
              '<div class="var-ep" id="var-' + e.id + '" style="display:none;width:100%;margin-top:8px"></div></div>';
          }).join('') || '<p style="color:var(--tx3);font-size:12.5px">قسمتی در این فصل نیست.</p>';
          return head + eps;
        }).join('') || '<p style="color:var(--tx3);font-size:12.5px">فصلی نیست — اول فصل اضافه کنید.</p>';
        $all('[data-epl]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            api('/admin/item/' + it.id + '/episodes/' + b.getAttribute('data-epl') + '/delete', { method: 'POST' }).then(function (r) {
              it = r.item; fillSeasonSelect(); renderEps();
            }).catch(function (e) { toast(e.message, 'err'); });
          });
        });
        $all('[data-epq]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            var id = b.getAttribute('data-epq');
            var pane = $('#var-' + id, box);
            if (!pane) return;
            if (pane.style.display === 'none') {
              var ep = null;
              var ss2 = seasonsOf(it);
              var i, j;
              for (i = 0; i < ss2.length; i++) {
                for (j = 0; j < (ss2[i].episodes || []).length; j++) {
                  if (ss2[i].episodes[j].id === id) ep = ss2[i].episodes[j];
                }
              }
              pane.innerHTML = variantGridHtml(ep || {}, id);
              pane.style.display = 'block';
              bindVar(pane, id);
            } else pane.style.display = 'none';
          });
        });
      }
      fillSeasonSelect();
      renderEps();
      $('#e-s-add', wrap).addEventListener('click', function () {
        api('/admin/item/' + it.id + '/season', { method: 'POST', body: { n: $('#e-sn', wrap).value, title: $('#e-st', wrap).value.trim() } }).then(function (r) {
          it = r.item; fillSeasonSelect(); renderEps(); toast('فصل اضافه شد ✓', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      $('#e-ep-add', wrap).addEventListener('click', function () {
        var u = $('#e-ep-url', wrap).value.trim();
        if (!u) { toast('لینک قسمت را وارد کنید', 'err'); return; }
        api('/admin/item/' + it.id + '/episode', { method: 'POST', body: {
          url: u,
          title: $('#e-ep-title', wrap).value.trim(),
          seasonN: $('#e-ep-s', wrap).value,
          track: $('#e-ep-track', wrap).value,
          quality: $('#e-ep-q', wrap).value
        } }).then(function (r) {
          it = r.item;
          fillSeasonSelect();
          renderEps();
          $('#e-ep-url', wrap).value = '';
          toast('قسمت اضافه شد ✓', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
    }
  }, true);
}

function refreshAfterAdmin () {
  if (currentRoute().path.indexOf('/admin') === 0) {
    var parts = currentRoute().path.split('/');
    loadAdminTab(parts[2] || 'overview', currentRoute().query);
  } else {
    render();
  }
}

/* ═══════════ رندر اصلی ═══════════ */
function render () {
  stopHero();
  var r = currentRoute();
  var path = r.path;
  var app = $('#app');
  var active = 'home';
  var tgBack = TG && TG.BackButton;

  function backBtn (on) {
    if (tgBack) { try { on ? tgBack.show() : tgBack.hide(); } catch (e) { } }
  }
  if (TG) { try { tgBack && tgBack.offClick && TG.BackButton.offClick(); } catch (e) { } }

  function shell (inner, opts) {
    opts = opts || {};
    app.innerHTML = headerHtml(opts.active || active, { float: !!opts.float }) + '<main' + (opts.float ? ' class="m-full"' : '') + '>' + inner + '</main>';
    bindHeader();
    /* مثل بات‌فادر: دکمهٔ اصلی تلگرام (مثل «خانه» پایین) اصلاً نمایش داده
       نمی‌شود؛ ناوبری با هدر بالا و دکمهٔ بازگشت تلگرام است. */
    try { if (TG && TG.MainButton) TG.MainButton.hide(); } catch (e) { }
    window.scrollTo(0, 0);
    if (opts.back) {
      backBtn(true);
      if (tgBack) { try { tgBack.onClick(function () { history.length > 1 ? history.back() : nav('#/'); }); } catch (e) { } }
    } else backBtn(false);
  }

  if (path === '/' || path === '') {
    api('/catalog').then(function (c) {
      APP.catalog = c;
      APP.siteName = c.site.siteName; APP.tagline = c.site.tagline || APP.tagline;
      if (c.economy) APP.economy = c.economy;
      document.title = c.site.siteName;
      shell(viewHome(c));
      bindHero();
      bindProSearch();
    }).catch(function (e) {
      app.innerHTML = headerHtml('home') + '<main>' + emptyHtml('⚠️', 'خطا در بارگذاری', e.message) + '</main>';
      bindHeader();
    });
    return;
  }
  if (path === '/catalog') {
    var qp = r.query;
    api('/catalog?' + new URLSearchParams(qp).toString()).then(function (c) {
      if (c.economy) APP.economy = c.economy;
      shell(viewCatalog(c, qp), { active: 'catalog' });
      bindCatalogFilters();
    }).catch(function (e) { app.innerHTML = headerHtml('catalog') + '<main>' + emptyHtml('⚠️', 'خطا', e.message) + '</main>'; bindHeader(); });
    return;
  }
  if (path === '/search') {
    api('/catalog?' + new URLSearchParams(r.query).toString()).then(function (c) {
      if (c.economy) APP.economy = c.economy;
      shell(viewCatalog(c, r.query), { active: 'catalog' });
      bindProSearch();
    }).catch(function (e) { app.innerHTML = headerHtml('catalog') + '<main>' + emptyHtml('⚠️', 'خطا', e.message) + '</main>'; bindHeader(); });
    return;
  }
  var m;
  if ((m = path.match(new RegExp('^/item/(i_[a-z0-9]+)$')))) {
    api('/item/' + m[1]).then(function (d) {
      if (d.economy) APP.economy = d.economy;
      shell(viewItem(d, m[1]), { active: '', back: true, float: true });
      bindItem(d.item, d);
    }).catch(function (e) {
      if (e.status === 404) shell(emptyHtml('😕', 'یافته نشد', 'این صفحه وجود ندارد.'), { active: '' });
    });
    return;
  }
  if ((m = path.match(new RegExp('^/watch/(i_[a-z0-9]+)')))) {
    nav('#/item/' + m[1]);
    return;
  }
  if (path === '/auth') {
    if (r.query.ref) setRef(r.query.ref);
    shell(viewAuth(r.query), { active: '' });
    bindAuth(r.query);
    return;
  }
  if (path === '/account') {
    shell(viewAccount(), { active: 'account' });
    bindAccount();
    return;
  }
  if (path === '/wallet') {
    if (!APP.user) { shell(viewWallet(null), { active: 'wallet' }); return; }
    api('/wallet').then(function (d) {
      APP.user = d.user || APP.user;
      if (d.economy) APP.economy = d.economy;
      shell(viewWallet(d), { active: 'wallet' });
      bindWallet();
    }).catch(function (e) { shell(emptyHtml('⚠️', 'خطا', e.message), { active: 'wallet' }); });
    return;
  }
  if (path === '/subscribe') {
    api('/me').then(function (d) {
      if (d.user) APP.user = d.user;
      if (d.economy) APP.economy = d.economy;
      if (d.site) { APP.siteName = d.site.siteName; APP.tagline = d.site.tagline || APP.tagline; }
      shell(viewSubscribe(), { active: 'wallet', back: true });
      bindSubscribe();
    }).catch(function () {
      shell(viewSubscribe(), { active: 'wallet', back: true });
      bindSubscribe();
    });
    return;
  }
  if (path === '/referral') {
    api('/me').then(function (d) {
      if (d.user) APP.user = d.user;
      if (d.economy) APP.economy = d.economy;
      if (d.site) { APP.siteName = d.site.siteName; APP.tagline = d.site.tagline || APP.tagline; }
      shell(viewReferral(), { active: 'account', back: true });
      bindReferral();
    }).catch(function () {
      shell(viewReferral(), { active: 'account', back: true });
      bindReferral();
    });
    return;
  }
  if (path === '/admin' || path.indexOf('/admin/') === 0) {
    if (!APP.user || APP.user.role !== 'admin') {
      shell(emptyHtml('🔐', 'دسترسی مدیریت لازم است', 'ابتدا با حساب مدیر وارد شوید.', '<a class="btn btn-primary" href="#/auth">ورود</a>'));
      return;
    }
    var tab = path === '/admin' ? 'overview' : path.split('/')[2] || 'overview';
    if (['overview', 'content', 'ads', 'users', 'pays', 'codes', 'settings'].indexOf(tab) < 0) tab = 'overview';
    shell(adminNav(tab), { active: 'admin', back: true });
    bindAdminNav();
    loadAdminTab(tab, r.query);
    if (r.query.edit) setTimeout(function () { openItemEdit(r.query.edit, null); }, 300);
    return;
  }
  shell(emptyHtml('😕', 'صفحه پیدا نشد', 'آدرس را بررسی کنید.', '<a class="btn btn-primary" href="#/">صفحه اصلی</a>'));
}

var __mainBtnBound = false;
function initTg (webapp) {
  if (!webapp) return;
  TG = webapp;
  try {
    TG.ready();
    TG.expand();
    TG.setHeaderColor('#0b0e14');
    TG.setBackgroundColor('#0b0e14');
    if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
  } catch (e) { }
  if (TG_READY) return;
  TG_READY = true;
  applyMiniAppItemLaunch();
  try {
    if (isTgWebHash(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search + '#/');
    }
  } catch (e2) { }
  try { loginMiniApp(); startLoginWatch(); } catch (eMini) { }
  try {
    if (TG && TG.onEvent && !window.__tgActBound) {
      window.__tgActBound = true;
      /* در بازگشت به اپ، دوباره تمام‌صفحه بماند (مثل BatFather) */
      TG.onEvent('activated', function () { loginMiniApp(); burstPeek(); try { TG.expand(); } catch (e5) { } });
      TG.onEvent('viewportChanged', function () { loginMiniApp(); burstPeek(); });
    }
  } catch (eAct) { }
  try { render(); } catch (e4) { }
}
window.__mvxInitTg = initTg;

var __tgLoading = false;
function loadTgScript () {
  if (TG_READY || __tgLoading) return;
  __tgLoading = true;
  try {
    var s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = function () {
      try { if (window.Telegram && Telegram.WebApp) initTg(Telegram.WebApp); } catch (e) { }
    };
    s.onerror = function () { __tgLoading = false; };
    (document.head || document.body).appendChild(s);
  } catch (e) { __tgLoading = false; }
}

function boot () {
  try {
    applyMiniAppItemLaunch();
    if (TG && !TG_READY) initTg(TG);
    loadTgScript();
    var rq = currentRoute();
    if (rq.query.ref) setRef(rq.query.ref);
    if (rq.query.ticket) setTick(rq.query.ticket);
    api('/me').then(function (r) {
      if (r.user) APP.user = r.user;
      if (r.site) { APP.siteName = r.site.siteName; APP.tagline = r.site.tagline || APP.tagline; }
      if (r.economy) APP.economy = r.economy;
      applySiteBranding();
      if (!r.user) { loginMiniApp(); startLoginWatch(); }
      render();
    }).catch(function (e) { captureErr('/me: ' + (e.message || '')); });
    window.addEventListener('hashchange', render);
    render();
    startLoginWatch();
    startWatchdog();
  } catch (e) {
    showFatal((e && e.message) ? e.message : String(e));
  }
}
var __booted = false;
function __goBoot () { if (!__booted) { __booted = true; boot(); } }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __goBoot);
  setTimeout(__goBoot, 1500);
} else {
  __goBoot();
}
})();
</script>
</body>
</html>`;
