/* پلتفرم تبلیغ‌دهندگان (ads.js) با D1 واقعی (SQLite) + اتصال سرتاسری به سایت اصلی (worker.js):
   ثبت‌نام/مدیر، آپلود و Range، کارت‌به‌کارت هوشمند و استارز، کمپین و قوانین، صف تأیید مدیر،
   فهرست امضاشده، رویدادهای دسته‌ای یکتا، صورت‌حساب CPV/CPM و سقف بودجه، آمار شخصی و کلی،
   انتخاب تبلیغ در سایت، شمارش بازدید/کلیک، دکمهٔ لینک زیر فایل ربات و ریدایرکت. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const adsSrc = fs.readFileSync(new URL('../ads.js', import.meta.url), 'utf8');
const ADS = await import('data:text/javascript;base64,' + Buffer.from(adsSrc + '\nexport { ADS_HTML, tehranDay, SETTINGS_DEFAULTS };').toString('base64'));
const ads = ADS.default;
const siteSrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const SITE = await import('data:text/javascript;base64,' + Buffer.from(siteSrc + `
export { Store, createTgUser, saveUser, saveItemRecord, makeToken, bustSettings, apiDlRequest, apiDlGate, apiAdTokenClick, pickAdForSlot, adNetInventory, adNetFlush, adNetConfig,
  deliveryKeyboard, handleAdRedirect, adRedirectUrl, AD_NET, apiStreamOpen, apiStreamSrc, bustAds };`).toString('base64'));

function d1() {
  const sql = new DatabaseSync(':memory:');
  const conv = p => p.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v);
  const db = {
    sql,
    prepare(text) {
      const make = params => ({ bind: (...p) => make(conv(p)), first: async () => sql.prepare(text).get(...params) ?? null,
        all: async () => ({ results: sql.prepare(text).all(...params) }), run: async () => ({ success: true, meta: sql.prepare(text).run(...params) }) });
      return make([]);
    },
    batch: async stmts => { sql.exec('BEGIN'); try { const out = []; for (const s of stmts) out.push(await s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } },
  };
  return db;
}
function memKV() {
  const m = new Map();
  return { m, put: async (k, v) => { m.set(k, v instanceof Uint8Array ? v.slice() : v); }, get: async (k, t) => { const v = m.get(k); if (v == null) return null; return t === 'arrayBuffer' ? (v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v) : v; }, delete: async k => { m.delete(k); } };
}
const NET = 'net-secret-0123456789abcdefABCDEF';
const env = { ADS_DB: d1(), ADS_KV: memKV(), NET_SECRET: NET, ADS_BOT_TOKEN: 'bot:token' };
const ORIGIN = 'https://ads.test';
let tok = '';
async function call(path, { method, body, token, headers, raw } = {}) {
  const h = Object.assign({ 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, headers || {});
  if (token !== undefined ? token : tok) h.authorization = 'Bearer ' + (token !== undefined ? token : tok);
  const r = await ads.fetch(new Request(ORIGIN + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined) }), env, { waitUntil() { } });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const tg = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').at(-1), body = JSON.parse(init.body || '{}');
    tg.push({ method, body });
    if (method === 'createInvoiceLink') return Response.json({ ok: true, result: 'https://t.me/$invoice123' });
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 1, username: 'AdsBot' } });
    return Response.json({ ok: true, result: { message_id: 1 } });
  }
  if (url.startsWith(ORIGIN)) return ads.fetch(new Request(url, init), env, { waitUntil() { } }); // سایت اصلی ← پلتفرم
  return new Response('not found', { status: 404 });
};

try {
  /* ── ۱. صفحه و ثبت‌نام: اولین حساب مدیر می‌شود ── */
  const page = await ads.fetch(new Request(ORIGIN + '/'), env, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const s of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])) new vm.Script(s);
  assert.equal((await call('/api/auth/register', { body: { email: 'boss@example.com', name: 'Boss', password: 'short', accept: true } })).status, 400);
  assert.equal((await call('/api/auth/register', { body: { email: 'boss@example.com', name: 'Boss', password: 'longpassword1' } })).status, 400, 'پذیرش قوانین لازم است');
  const adminReg = await call('/api/auth/register', { body: { email: 'boss@example.com', name: 'Boss', password: 'longpassword1', accept: true } });
  assert.equal(adminReg.status, 200); assert.equal(adminReg.body.user.role, 'admin');
  const ADMIN = adminReg.body.token;
  const advReg = await call('/api/auth/register', { body: { email: 'shop@example.com', name: 'فروشگاه نمونه', password: 'longpassword2', accept: true, phone: '۰۹۱۲۱۲۳۴۵۶۷' } });
  assert.equal(advReg.body.user.role, 'adv'); assert.equal(advReg.body.user.phone, '09121234567');
  assert.equal((await call('/api/auth/register', { body: { email: 'shop@example.com', name: 'تکراری', password: 'longpassword2', accept: true } })).status, 409);
  assert.equal((await call('/api/auth/login', { body: { email: 'shop@example.com', password: 'wrong-pass' } })).status, 401);
  tok = (await call('/api/auth/login', { body: { email: 'shop@example.com', password: 'longpassword2' } })).body.token;
  assert.equal((await call('/api/admin/overview')).status, 403, 'تبلیغ‌دهنده به پنل مدیر دسترسی ندارد');
  assert.equal((await call('/api/me', { token: 'garbage.token' })).status, 401);

  /* ── ۲. تنظیمات مدیر: تعرفه، کارت، استارز، کلید اتصال از Secret ── */
  const st = await call('/api/admin/settings', { token: ADMIN });
  assert.equal(st.body.settings.netFromEnv, true); assert.equal(st.body.settings.secret, undefined, 'رمز داخلی پنهان است');
  const saved = await call('/api/admin/settings', { token: ADMIN, body: { tariffs: { video: { cpm: 0, cpv: 100, cpc: 0 }, banner: { cpm: 10000, cpv: 0, cpc: 0 }, link: { cpm: 8000, cpv: 0, cpc: 500 } }, minBudget: 50000, k2k: { enabled: true, card: '6037-9911-2233-4455', holder: 'مدیر', bank: 'ملی', min: 50000, max: 5000000, ttlMin: 30, presets: '100000, 200000' }, stars: { enabled: true, packs: [{ stars: 100, toman: 150000 }] }, siteName: 'سینماگرام' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.k2k.card, '6037991122334455');
  assert.equal((await call('/api/admin/settings', { token: ADMIN, body: { k2k: { enabled: true, card: '123' } } })).status, 400);
  assert.equal((await call('/api/admin/net-secret', { token: ADMIN, method: 'POST' })).status, 400, 'کلید از Secret است و از پنل عوض نمی‌شود');

  /* ── ۳. کیف پول: کارت‌به‌کارت با مبلغ یکتا + تأیید مدیر (یک‌بار) و استارز ── */
  const inv = (await call('/api/wallet/k2k', { body: { amount: 200000 } })).body.invoice;
  assert.ok(inv.extra >= 11 && inv.extra <= 999); assert.equal(inv.total, 200000 + inv.extra); assert.equal(inv.card, '6037991122334455');
  const inv2 = (await call('/api/wallet/k2k', { body: { amount: 200000 } })).body.invoice;
  assert.equal((await call('/api/wallet/k2k/' + inv.id)).body.invoice.status, 'cancelled', 'فاکتور قبلی همان کاربر لغو می‌شود');
  assert.equal((await call('/api/wallet/k2k', { body: { amount: 1000 } })).status, 400);
  const sub = await call('/api/wallet/k2k/' + inv2.id + '/submit', { method: 'POST' });
  assert.equal(sub.body.invoice.status, 'submitted');
  const pays = await call('/api/admin/payments', { token: ADMIN });
  assert.equal(pays.body.invoices[0].id, inv2.id); assert.equal(pays.body.invoices[0].status, 'submitted');
  assert.equal((await call('/api/admin/payments/' + inv2.id + '/approve', { token: ADMIN, body: {} })).status, 200);
  assert.equal((await call('/api/admin/payments/' + inv2.id + '/approve', { token: ADMIN, body: {} })).status, 400, 'دوبار شارژ نمی‌شود');
  let me = (await call('/api/me')).body.user;
  assert.equal(me.balance, 200000 + inv2.extra);
  const star = await call('/api/wallet/stars', { body: { pack: 0 } });
  assert.equal(star.body.link, 'https://t.me/$invoice123');
  const appSecret = JSON.parse(env.ADS_DB.sql.prepare("SELECT v FROM adv_kv WHERE k='settings'").get().v).secret;
  const secret = (await import('node:crypto')).createHmac('sha256', appSecret).update('tg-webhook').digest('hex').slice(0, 48);
  const hook = body => ads.fetch(new Request(ORIGIN + '/api/tg/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {});
  assert.equal((await ads.fetch(new Request(ORIGIN + '/api/tg/webhook', { method: 'POST', body: '{}' }), env, {})).status, 403);
  await hook({ pre_checkout_query: { id: 'q1', currency: 'XTR', total_amount: 100, invoice_payload: 'adv:' + star.body.invoice } });
  assert.equal(tg.at(-1).method, 'answerPreCheckoutQuery'); assert.equal(tg.at(-1).body.ok, true);
  await hook({ pre_checkout_query: { id: 'q2', currency: 'XTR', total_amount: 5, invoice_payload: 'adv:' + star.body.invoice } });
  assert.equal(tg.at(-1).body.ok, false, 'مبلغ نادرست رد می‌شود');
  const payment = { message: { message_id: 5, chat: { id: 777, type: 'private' }, from: { id: 777 }, successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: 'adv:' + star.body.invoice, telegram_payment_charge_id: 'charge-1' } } };
  await hook(payment); await hook(payment);
  me = (await call('/api/me')).body.user;
  assert.equal(me.balance, 200000 + inv2.extra + 150000, 'پرداخت استارز دقیقاً یک‌بار اعمال شد');
  assert.equal(me.tg, true, 'تلگرام پرداخت‌کننده به حساب وصل شد');

  /* ── ۴. آپلود ویدئو (بررسی بایت‌های فایل) و پخش با Range ── */
  const mp4 = new Uint8Array(4096); mp4.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  assert.equal((await call('/api/media?kind=video&w=1280&h=720&dur=12', { method: 'POST', raw: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), headers: { 'content-type': 'video/mp4' } })).status, 400);
  assert.equal((await call('/api/media?kind=video&w=1280&h=720&dur=95', { method: 'POST', raw: mp4, headers: { 'content-type': 'video/mp4' } })).status, 400, 'ویدئوی طولانی‌تر از سقف');
  const up = await call('/api/media?kind=video&w=1280&h=720&dur=12', { method: 'POST', raw: mp4, headers: { 'content-type': 'video/mp4' } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const ref = up.body.media.url.split('/').pop();
  const full = await ads.fetch(new Request(ORIGIN + up.body.media.url), env, {});
  assert.equal(full.status, 200); assert.match(full.headers.get('cache-control'), /immutable/); assert.equal((await full.arrayBuffer()).byteLength, 4096);
  const part = await ads.fetch(new Request(ORIGIN + up.body.media.url, { headers: { range: 'bytes=100-199' } }), env, {});
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 100-199/4096'); assert.equal((await part.arrayBuffer()).byteLength, 100);

  /* ── ۵. کمپین ویدئویی: پیش‌نویس، کمبود موجودی، ارسال (کنار گذاشتن بودجه)، تأیید مدیر ── */
  const base = { format: 'video', name: 'معرفی محصول', slots: ['pre', 'dl'], creative: { video: ref, cta: 'خرید', landing: 'https://shop.example.com/sale' }, target: { types: ['series'], genres: ['درام'] }, budget: 60000, freqCap: 2, bid: 1.5 };
  assert.match((await call('/api/campaigns', { body: { ...base, creative: { ...base.creative, landing: 'https://bit.ly/x' } } })).body.error, /کوتاه‌کننده/);
  assert.match((await call('/api/campaigns', { body: { ...base, name: 'کازینو آنلاین' } })).body.error, /غیرمجاز/);
  assert.match((await call('/api/campaigns', { body: { ...base, budget: 1000 } })).body.error, /حداقل بودجه/);
  const draft = await call('/api/campaigns', { body: base });
  assert.equal(draft.status, 200); assert.equal(draft.body.campaign.status, 'draft');
  const CID = draft.body.id;
  const big = await call('/api/campaigns', { body: { ...base, name: 'خیلی بزرگ', budget: 99000000, submit: true } });
  assert.equal(big.status, 402); assert.equal(big.body.needWallet, true);
  const submitted = await call('/api/campaigns/' + CID + '/submit', { method: 'POST' });
  assert.equal(submitted.body.campaign.status, 'pending');
  assert.deepEqual(submitted.body.campaign.prices, { cpm: 0, cpv: 100, cpc: 0 }, 'تعرفه هنگام ارسال قفل شد');
  me = (await call('/api/me')).body.user;
  const balAfterHold = me.balance;
  assert.equal(balAfterHold, 200000 + inv2.extra + 150000 - 60000);

  /* ── ۶. اتصال امضاشدهٔ سایت: کمپین در انتظار در فهرست نیست؛ بعد از تأیید هست ── */
  const siteKV = (() => { const m = new Map(); return { m, get: async (k, o) => { const v = m.get(k); return v == null ? null : (o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) }; })();
  const siteEnv = { KV: siteKV };
  const store = new SITE.Store(siteKV, siteEnv);
  SITE.bustSettings(store);
  await store.set('set', { secret: 'site-secret', publicUrl: 'https://site.test', adNetEnabled: true, adNetUrl: ORIGIN, adNetSecret: NET, streamEnabled: true, deliveryBotToken: '1:F', deliveryBotUsername: 'FileBot', adGateEnabled: true, dlBurstLimit: 0 });
  const viewer = await SITE.createTgUser(store, { tgId: '5005', tgName: 'Viewer' }); viewer.role = 'free'; await SITE.saveUser(store, viewer);
  const vtok = await SITE.makeToken(store, viewer);
  const item = { id: 'i_drama', type: 'series', title: 'درام', genres: ['درام'], access: 'free', variants: { sub: {}, dub: {} }, episodes: [],
    seasons: [{ n: 1, episodes: [{ id: 'e_1', n: 1, title: 'قسمت ۱', variants: { sub: { '720': { files: [{ id: 'f_1', source: { chatId: '-1001', msgId: '5' } }] } }, dub: {} }, streams: [{ id: 'v_1', track: 'sub', quality: '720', url: 'https://cdn.example.com/e1.mp4', fmt: 'mp4' }] }] }] };
  await SITE.saveItemRecord(store, item);
  const set = Object.assign({}, await store.get('set'));
  let inventory = await SITE.adNetInventory(store, set);
  assert.ok(inventory, 'اتصال امضاشده برقرار شد');
  assert.equal(inventory.campaigns.length, 0, 'کمپین تأییدنشده هرگز نمایش داده نمی‌شود');
  const bad = await realFetchSign(ORIGIN + '/api/net/inventory', 'wrong-secret-xxxxxxxxxxxx');
  assert.equal(bad, 401);
  assert.equal((await call('/api/admin/review/' + CID, { token: ADMIN, body: { approve: false, reason: '' } })).status, 400, 'دلیل رد لازم است');
  assert.equal((await call('/api/admin/review/' + CID, { token: ADMIN, body: { approve: true } })).status, 200);
  SITE.AD_NET.invAt = 0;
  inventory = await SITE.adNetInventory(store, set);
  assert.equal(inventory.campaigns.length, 1);
  const c0 = inventory.campaigns[0];
  assert.equal(c0.video.src, ORIGIN + '/m/' + ref); assert.equal(c0.w, 1.5); assert.deepEqual(c0.tg.types, ['series']);

  /* ── ۷. سایت: انتخاب تبلیغ با هدف‌گیری و سقف تکرار، شمارش بازدید کامل و کلیک ── */
  const req = () => new Request('https://site.test/api/x', { method: 'POST', headers: { authorization: 'Bearer ' + vtok, 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile', 'cf-connecting-ip': '7.7.7.7' } });
  const movie = { id: 'i_mv', type: 'movie', genres: ['اکشن'] };
  assert.equal(await SITE.pickAdForSlot(store, set, viewer, movie, 'pre', null, req(), {}), null, 'هدف‌گیری: فقط سریال/درام');
  assert.equal(await SITE.pickAdForSlot(store, set, viewer, item, 'pre', null, req(), { [CID]: 2 }), null, 'سقف تکرار روزانه');
  const ad = await SITE.pickAdForSlot(store, set, viewer, item, 'pre', null, req(), {});
  assert.equal(ad.net, true); assert.equal(ad.kind, 'video'); assert.equal(ad.skipAfter, 5); assert.equal(ad.sec, 12);
  /* جریان واقعی پخش: تبلیغ قبل از پخش، سپس آدرس پس از زمان کافی + ثبت بازدید کامل */
  const open = await SITE.apiStreamOpen(store, { itemId: item.id, epId: 'e_1' }, req(), null);
  const ob = await open.json();
  assert.equal(ob.needAd, true); assert.equal(ob.ad.net, true);
  const realNow = Date.now; Date.now = () => realNow() + 15000;
  try {
    const src = await SITE.apiStreamSrc(store, { gate: ob.gate, ad: { at: ob.ad.at, t: 12, done: true } }, req(), null);
    assert.equal(src.status, 200);
    const clk = await SITE.apiAdTokenClick(store, { at: ob.ad.at }, req(), null);
    assert.equal((await clk.json()).url, 'https://shop.example.com/sale');
    await SITE.apiAdTokenClick(store, { at: ob.ad.at }, req(), null); // کلیک تکراری همان تبلیغ شمرده نمی‌شود
  } finally { Date.now = realNow; }
  /* قبل از دانلود: همان شبکه؛ پایان زمان → بازدید کامل */
  const dl = await SITE.apiDlRequest(store, { itemId: item.id, epId: 'e_1', track: 'sub', quality: '720' }, req(), null);
  const dlb = await dl.json();
  assert.equal(dlb.needAd, true); assert.equal(dlb.ad.net, true); assert.equal(dlb.charged, 0, 'دانلود رایگان');
  Date.now = () => realNow() + 30000;
  try { assert.equal((await SITE.apiDlGate(store, dlb.gate, req(), null)).status, 200); } finally { Date.now = realNow; }
  /* رویدادها به پلتفرم رسیده‌اند (بدون ctx سایت فوراً می‌فرستد؛ با ctx هر ~۲۰ ثانیه دسته‌ای) */
  const cfg = SITE.adNetConfig(set, siteEnv);
  async function drain() {
    for (let i = 0; i < 100 && (SITE.AD_NET.flushing || SITE.AD_NET.buf.size || SITE.AD_NET.pending); i++) { await new Promise(r => setTimeout(r, 5)); await SITE.adNetFlush(cfg); }
    assert.equal(SITE.AD_NET.buf.size, 0); assert.equal(SITE.AD_NET.pending, null, SITE.AD_NET.lastError);
  }
  await drain();
  const sampleRows = [{ c: CID, s: 'pre', day: ADS.tehranDay(), h: 9, d: 'd', t: 'series', imp: 2, view: 2, click: 1, skip: 1, opp: 0, watch: 24 }, { c: '*', s: 'pre', day: ADS.tehranDay(), h: 9, d: 'd', t: 'series', imp: 0, view: 0, click: 0, skip: 0, opp: 5, watch: 0 }];
  const dup = await realFetchSign(ORIGIN + '/api/net/events', NET, JSON.stringify({ v: 1, id: 'aaaaaaaaaaaa', rows: sampleRows }));
  const dup2 = await realFetchSign(ORIGIN + '/api/net/events', NET, JSON.stringify({ v: 1, id: 'aaaaaaaaaaaa', rows: sampleRows }), true);
  assert.equal(dup, 200); assert.equal(dup2.dup, true, 'دستهٔ تکراری دوبار شمرده نمی‌شود');
  const statsRes = await call('/api/campaigns/' + CID + '/stats?days=7');
  const t = statsRes.body.total;
  assert.equal(t.views, 4, '۲ بازدید از جریان واقعی + ۲ از دستهٔ آزمایشی');
  assert.equal(t.clicks, 2);
  assert.equal(Math.round(statsRes.body.campaign.spent), 4 * 100 * 1.5, 'CPV × ضریب پیشنهاد');
  assert.ok(statsRes.body.hours.reduce((a, b) => a + b, 0) >= 2, 'نمودار ساعتی امروز پر شد');
  assert.ok(statsRes.body.slots.find(s => s.slot === 'pre') && statsRes.body.slots.find(s => s.slot === 'dl'));
  const market = (await call('/api/market')).body;
  assert.ok(market.slots.find(s => s.slot === 'pre').opps7 > 0, 'آمار کلی بازار: فرصت نمایش جایگاه');
  assert.ok(market.formats.video.views >= 4);

  /* ── ۸. سقف بودجه → «بودجه تمام شد»؛ بیش از بودجه هزینه نمی‌شود ── */
  const today = ADS.tehranDay();
  await realFetchSign(ORIGIN + '/api/net/events', NET, JSON.stringify({ v: 1, id: 'bbbbbbbbbbbb', rows: [{ c: CID, s: 'pre', day: today, h: 10, d: 'm', t: 'series', imp: 500, view: 500, click: 0, skip: 0, opp: 0, watch: 5000 }] }));
  const after = (await call('/api/campaigns/' + CID)).body.campaign;
  assert.equal(after.spent, 60000); assert.equal(after.status, 'completed');
  SITE.AD_NET.invAt = 0;
  assert.equal((await SITE.adNetInventory(store, set)).campaigns.length, 0, 'کمپین تمام‌شده از فهرست خارج شد');

  /* ── ۹. تبلیغ لینکی زیر فایل ربات + ریدایرکت شمارش کلیک ── */
  assert.match((await call('/api/campaigns', { body: { format: 'link', name: 'لینک', slots: ['bot'], creative: { link: { text: '📥 دانلود سریع', url: 'https://shop.example.com' } }, budget: 50000 } })).body.error, /شبیه دکمه/);
  assert.match((await call('/api/campaigns', { body: { format: 'link', name: 'لینک', slots: ['bot'], creative: { link: { text: '🎁🎁🎁 تخفیف', url: 'https://shop.example.com' } }, budget: 50000 } })).body.error, /ایموجی/);
  assert.match((await call('/api/campaigns', { body: { format: 'link', name: 'لینک', slots: ['bot'], creative: { link: { text: 'اپلیکیشن ما', url: 'https://shop.example.com/app.apk' } }, budget: 50000 } })).body.error, /اجرایی/);
  const link = await call('/api/campaigns', { body: { format: 'link', name: 'کانال تخفیف', slots: ['bot'], creative: { link: { text: '🎁 تخفیف ویژهٔ امروز', url: 'https://t.me/shopdeals' } }, budget: 50000, submit: true } });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  await call('/api/admin/review/' + link.body.id, { token: ADMIN, body: { approve: true } });
  SITE.AD_NET.invAt = 0;
  const kb = await SITE.deliveryKeyboard(store, set, { username: viewer.username }, item, null);
  assert.equal(kb.inline_keyboard[0][0].text, '🎁 تخفیف ویژهٔ امروز');
  assert.equal(kb.inline_keyboard[0][0].url, 'https://t.me/shopdeals', 'لینک تلگرامی مستقیم روی دکمه می‌نشیند — بدون سایت');
  assert.ok(!/\/r\/|site\.test/.test(kb.inline_keyboard[0][0].url), 'آدرس سایت نباید در لینک تلگرامی باشد');
  assert.equal(await SITE.adRedirectUrl(set, { id: 'c_x', link: { url: 'https://telegram.me/shopdeals' } }), 'https://telegram.me/shopdeals', 'دامنه‌های هم‌خانوادهٔ تلگرام هم مستقیم');
  const webUrl = await SITE.adRedirectUrl(set, { id: link.body.id, link: { url: 'https://shop.example.com/deal' } });
  assert.match(webUrl, /^https:\/\/site\.test\/r\//, 'لینک غیرتلگرامی برای شمارش دقیق کلیک از /r/ می‌گذرد');
  const redir = await SITE.handleAdRedirect(new Request(webUrl, { headers: { 'cf-connecting-ip': '8.8.8.8' } }), new URL(webUrl), store, null);
  assert.equal(redir.status, 302); assert.equal(redir.headers.get('location'), 'https://shop.example.com/deal');
  const forged = await SITE.handleAdRedirect(new Request('https://site.test/r/abc.def'), new URL('https://site.test/r/abc.def'), store, null);
  assert.equal(forged.headers.get('location'), 'https://site.test/', 'توکن جعلی به مقصد دلخواه نمی‌برد');
  const subscriber = await SITE.createTgUser(store, { tgId: '6006', tgName: 'S' }); subscriber.subUntil = Date.now() + 86400000; subscriber.role = 'free'; await SITE.saveUser(store, subscriber);
  const kbSub = await SITE.deliveryKeyboard(store, set, { username: subscriber.username }, item, null);
  assert.ok(!kbSub || !kbSub.inline_keyboard.some(r => /t\.me\/shopdeals|\/r\//.test(r[0].url)), 'مشترک تبلیغ لینکی نمی‌بیند');
  await drain();
  const lstats = (await call('/api/campaigns/' + link.body.id + '/stats?days=1')).body.total;
  assert.equal(lstats.imps, 1); assert.equal(lstats.clicks, 1);

  /* ── ۱۰. ویرایش کمپین فعال → دوباره صف بررسی؛ توقف → بازگشت باقی‌مانده؛ رد → بازگشت ── */
  const before = (await call('/api/me')).body.user.balance;
  const edit = await call('/api/campaigns/' + link.body.id, { body: { format: 'link', name: 'کانال تخفیف', slots: ['bot'], creative: { link: { text: '🎁 تخفیف تازه', url: 'https://t.me/shopdeals' } }, budget: 50000 } });
  assert.equal(edit.body.campaign.status, 'pending'); assert.equal(edit.body.recheck, true);
  SITE.AD_NET.invAt = 0;
  assert.equal((await SITE.adNetInventory(store, set)).campaigns.length, 0, 'تغییر محتوا تا تأیید دوباره نمایش داده نمی‌شود');
  const rej = await call('/api/admin/review/' + link.body.id, { token: ADMIN, body: { approve: false, reason: 'متن دکمه مبهم است' } });
  assert.equal(rej.status, 200);
  const spentLink = (await call('/api/campaigns/' + link.body.id)).body.campaign.spent;
  assert.equal((await call('/api/me')).body.user.balance, before + Math.floor(50000 - spentLink));
  const resub = await call('/api/campaigns/' + link.body.id, { body: { format: 'link', name: 'کانال تخفیف', slots: ['bot'], creative: { link: { text: 'کانال تخفیف‌ها', url: 'https://t.me/shopdeals' } }, budget: 50000, submit: true } });
  assert.equal(resub.body.campaign.status, 'pending');
  assert.equal((await call('/api/me')).body.user.balance, before, 'ارسال دوبارهٔ کمپین ردشده فقط باقی‌ماندهٔ بودجه را کنار می‌گذارد');
  const stop = await call('/api/campaigns/' + link.body.id + '/stop', { method: 'POST' });
  assert.ok(stop.body.refunded > 0);
  const txs = (await call('/api/wallet')).body.txs;
  assert.ok(txs.some(x => x.type === 'campaign_refund') && txs.some(x => x.type === 'campaign_hold') && txs.some(x => x.type === 'stars') && txs.some(x => x.type === 'k2k'));

  /* ── ۱۰.۵ مدت نمایش بنر: تبلیغ‌دهنده برای هر کمپین تعیین می‌کند؛ خالی = پیش‌فرض پلتفرم (ادمین) ── */
  await call('/api/admin/settings', { token: ADMIN, body: { bannerSec: 10 } });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...new Array(24).fill(0)]);
  const imgUp = await call('/api/media?kind=image&w=1080&h=1920', { method: 'POST', raw: png, headers: { 'content-type': 'image/png' } });
  assert.equal(imgUp.status, 200, JSON.stringify(imgUp.body));
  const imgRef = imgUp.body.media.url.split('/').pop();
  const b1 = await call('/api/campaigns', { body: { format: 'banner', name: 'بنر بدون مدت', slots: ['dl'], creative: { tall: imgRef, landing: 'https://shop.example.com/banner' }, budget: 50000, freqCap: 1, submit: true } });
  assert.equal(b1.status, 200, JSON.stringify(b1.body));
  await call('/api/admin/review/' + b1.body.id, { token: ADMIN, body: { approve: true } });
  const b2 = await call('/api/campaigns', { body: { format: 'banner', name: 'بنر با مدت', slots: ['dl'], creative: { tall: imgRef, landing: 'https://shop.example.com/banner', sec: 12 }, budget: 50000, freqCap: 1, submit: true } });
  assert.equal(b2.status, 200, JSON.stringify(b2.body));
  assert.equal(b2.body.campaign.creative.sec, 12);
  await call('/api/admin/review/' + b2.body.id, { token: ADMIN, body: { approve: true } });
  SITE.AD_NET.invAt = 0;
  const invB = await SITE.adNetInventory(store, set);
  const n1 = invB.campaigns.find(x => x.id === b1.body.id), n2 = invB.campaigns.find(x => x.id === b2.body.id);
  assert.equal(n1.banner.sec, 10, 'بدون مدت اختصاصی → مدت پیش‌فرض پلتفرم');
  assert.equal(n2.banner.sec, 12);
  const adDef = await SITE.pickAdForSlot(store, set, viewer, item, 'dl', null, req(), { [b2.body.id]: 1 });
  assert.equal(adDef.net, true); assert.equal(adDef.kind, 'banner'); assert.equal(adDef.sec, 10, 'ثانیه‌شمار بنر بدون مدت = پیش‌فرض ادمین');
  const adOwn = await SITE.pickAdForSlot(store, set, viewer, item, 'dl', null, req(), { [b1.body.id]: 1 });
  assert.equal(adOwn.kind, 'banner'); assert.equal(adOwn.sec, 12, 'ثانیه‌شمار بنر = مدت اختصاصی تبلیغ‌دهنده');

  /* ── ۱۱. مدیر: مسدودسازی تبلیغ‌دهنده کمپین‌ها را متوقف و نشست را باطل می‌کند ── */
  const users = (await call('/api/admin/users', { token: ADMIN })).body.users;
  const shop = users.find(u => u.email === 'shop@example.com');
  assert.equal((await call('/api/admin/users/' + shop.id, { token: ADMIN, body: { action: 'adjust', amount: 10000, note: 'هدیه' } })).status, 200);
  assert.equal((await call('/api/admin/users/' + shop.id, { token: ADMIN, body: { action: 'block' } })).status, 200);
  assert.equal((await call('/api/me')).status, 401, 'نشست حساب مسدود باطل شد');
  const ov = (await call('/api/admin/overview', { token: ADMIN })).body;
  assert.ok(ov.today.spend > 0 && ov.netConfigured && ov.kv);
} finally { globalThis.fetch = realFetch; }

async function realFetchSign(url, secret, body, json) {
  const u = new URL(url);
  const method = body ? 'POST' : 'GET';
  const ts = String(Math.floor(Date.now() / 1000)), nonce = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  const crypto = await import('node:crypto');
  const h = crypto.createHash('sha256').update(body || '').digest('hex');
  const sign = crypto.createHmac('sha256', secret).update(method + '\n' + u.pathname + u.search + '\n' + h + '\n' + ts + '\n' + nonce).digest('hex');
  const r = await ads.fetch(new Request(url, { method, body: body || undefined, headers: { 'content-type': 'application/json', 'x-net-ts': ts, 'x-net-nonce': nonce, 'x-net-sign': sign } }), env, {});
  return json ? r.json() : r.status;
}
console.log('PASS: ads platform — first-admin signup, auth/blocking, smart card-to-card + Stars (idempotent), upload sniffing + Range, campaign rules, budget hold/refund, admin review gate, signed inventory, unique event batches, CPV×bid billing & budget cap, personal + market stats; end-to-end with the site (targeting, frequency cap, pre-roll, download gate, clicks, bot link button + redirect, subscribers ad-free).');
