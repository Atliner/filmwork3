import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { Store, createTgUser, makeToken, saveItemRecord, apiDlRequest, getSettings, tlrDayStamp, dlCounterRead, dlExempt, bustSettings, saveUser, getUser, handleAdmin, dlBurstEvaluate, dlBurstOf, parseCooldownSteps, faDigits, dlStateRead, sendDlNotice, publicEconomy, APP_HTML, ECONOMY_DEFAULTS, CONFIG };').toString('base64'));
const { Store, createTgUser, makeToken, saveItemRecord, apiDlRequest, getSettings, tlrDayStamp, dlCounterRead, dlExempt, bustSettings, saveUser, getUser, handleAdmin, dlBurstEvaluate, dlBurstOf, parseCooldownSteps, faDigits, dlStateRead, publicEconomy, APP_HTML, ECONOMY_DEFAULTS, CONFIG, EditorSession } = mod;

/* ساعت قابل‌تنظیم: محدودیت بر اساس Date.now() کار می‌کند؛ با advance() دقیقه‌ها «می‌گذرند» */
const realNow = Date.now.bind(Date);
const realFetch = globalThis.fetch;
let skew = 0;
Date.now = () => realNow() + skew;
const advance = (ms) => { skew += ms; };
const MIN = 60000;

try {

// ── ۱. منطق خالصِ پله‌ها: ۱۰ پشت‌سرهم → ۱، ۲، ۱۰، ۳۰ دقیقه (و بعد همان ۳۰) ──
{
  const cfg = { limit: 10, steps: [1, 2, 10, 30], resetMs: 60 * MIN };
  let st = {}, t = 1_800_000_000_000;
  const tenInARow = () => {
    for (let i = 0; i < 9; i++) {
      const ev = dlBurstEvaluate(st, t, cfg);
      assert.equal(ev.blocked, false);
      assert.equal(ev.triggered, false);
      st = ev.next; t += 1000;
    }
    const ev = dlBurstEvaluate(st, t, cfg);
    assert.equal(ev.blocked, false);
    assert.equal(ev.triggered, true, 'دانلود دهم باید انتظار را شروع کند');
    st = ev.next;
    return ev.waitMs / MIN;
  };
  const waits = [];
  for (let k = 0; k < 6; k++) {
    waits.push(tenInARow());
    assert.equal(st.until, t + waits[k] * MIN);
    const still = dlBurstEvaluate(st, t + 1000, cfg);
    assert.equal(still.blocked, true);
    assert.ok(still.waitMs > 0 && still.waitMs <= waits[k] * MIN);
    assert.equal(dlBurstEvaluate(st, st.until - 1, cfg).blocked, true);
    assert.equal(dlBurstEvaluate(st, st.until, cfg).blocked, false); // لحظهٔ پایان انتظار آزاد است
    t = st.until;
  }
  assert.deepEqual(waits, [1, 2, 10, 30, 30, 30]);

  // کمی کمتر از زمان بازنشانی → همان مرحله می‌ماند؛ به‌اندازهٔ زمان بازنشانی → از اول
  const keep = dlBurstEvaluate(st, st.until + cfg.resetMs - 1, cfg);
  assert.equal(keep.next.lvl, st.lvl);
  const fresh = dlBurstEvaluate(st, st.until + cfg.resetMs, cfg);
  assert.equal(fresh.next.n, 1);
  assert.equal(fresh.next.lvl, 0);
  t = st.until + cfg.resetMs; st = fresh.next; t += 1000;
  for (let i = 0; i < 8; i++) { const ev = dlBurstEvaluate(st, t, cfg); st = ev.next; t += 1000; }
  const again = dlBurstEvaluate(st, t, cfg);
  assert.equal(again.triggered, true);
  assert.equal(again.waitMs, MIN, 'بعد از بازنشانی دوباره از ۱ دقیقه شروع می‌شود');

  // دورِ نیمه‌کاره هم با بیکاریِ طولانی صفر می‌شود
  let p = {}, pt = 5_000_000_000_000;
  for (let i = 0; i < 5; i++) { p = dlBurstEvaluate(p, pt, cfg).next; pt += 1000; }
  assert.equal(p.n, 5);
  assert.equal(dlBurstEvaluate(p, pt + 10 * MIN, cfg).next.n, 6);
  assert.equal(dlBurstEvaluate(p, pt + cfg.resetMs, cfg).next.n, 1);

  // limit = 1 → هر دانلود بعدی منتظر می‌ماند؛ داده‌های خراب نمی‌ترکند
  assert.equal(dlBurstEvaluate({}, 1e12, { limit: 1, steps: [3], resetMs: 5 * MIN }).waitMs, 3 * MIN);
  assert.equal(dlBurstEvaluate({ n: 'x', until: -5, lvl: NaN }, 1e12, cfg).blocked, false);
  assert.equal(dlBurstEvaluate(null, 1e12, cfg).blocked, false);
}

// ── ۲. خواندن تنظیمات ──
assert.deepEqual(parseCooldownSteps('1,2,10,30'), [1, 2, 10, 30]);
assert.deepEqual(parseCooldownSteps('۱،۲،۱۰،۳۰'), [1, 2, 10, 30]);
assert.deepEqual(parseCooldownSteps('٣,٥'), [3, 5]);
assert.deepEqual(parseCooldownSteps(' 1 , 2 ;10  30 '), [1, 2, 10, 30]);
assert.deepEqual(parseCooldownSteps([1, '2', 10, '۳۰']), [1, 2, 10, 30]);
assert.deepEqual(parseCooldownSteps('5'), [5]);
assert.deepEqual(parseCooldownSteps(5), [5]);
assert.deepEqual(parseCooldownSteps('1440'), [1440]);
for (const bad of ['', '   ', ',', '0', '1,0', '-1', '1.5', '1,,x', 'abc', '1441', '99999', '1,2,3,4,5,6,7,8,9,10,11', null, undefined, {}, true, [], [1, 'x'], [0]]) {
  assert.equal(parseCooldownSteps(bad), null, 'باید رد شود: ' + JSON.stringify(bad));
}
{
  const d = dlBurstOf({});
  assert.equal(d.limit, 10);
  assert.deepEqual(d.steps, [1, 2, 10, 30]);
  assert.equal(d.resetMin, 60);
  assert.equal(d.notify, true);
  assert.equal(dlBurstOf({ dlBurstLimit: '0' }).limit, 0);
  assert.equal(dlBurstOf({ dlBurstLimit: 7.9 }).limit, 7);
  assert.equal(dlBurstOf({ dlBurstLimit: 'abc' }).limit, 10);
  assert.equal(dlBurstOf({ dlBurstLimit: -3 }).limit, 10);
  assert.equal(dlBurstOf({ dlBurstLimit: '' }).limit, 10);
  assert.equal(dlBurstOf({ dlBurstLimit: 5000 }).limit, 1000);
  assert.deepEqual(dlBurstOf({ dlCooldownSteps: 'garbage' }).steps, [1, 2, 10, 30]);
  assert.deepEqual(dlBurstOf({ dlCooldownSteps: [2, 4] }).steps, [2, 4]);
  // زمان بازنشانی هرگز کمتر از آخرین زمان انتظار نمی‌شود (وگرنه کمی صبر کردن از پله‌های بالا فرار می‌داد)
  assert.equal(dlBurstOf({ dlBurstResetMin: 5 }).resetMin, 30);
  assert.equal(dlBurstOf({ dlBurstResetMin: 5, dlCooldownSteps: '1,2' }).resetMin, 5);
  assert.equal(dlBurstOf({ dlBurstResetMin: 120, dlCooldownSteps: [1, 2] }).resetMs, 120 * MIN);
  assert.equal(dlBurstOf({ dlBurstResetMin: 0 }).resetMin, 60);
  assert.equal(dlBurstOf({ dlLimitNotify: false }).notify, false);
  assert.equal(dlBurstOf({ dlLimitNotify: true }).notify, true);
}
assert.equal(faDigits(30), '۳۰');
assert.equal(faDigits(12), '۱۲');
assert.equal(dlExempt({ role: 'admin' }), true);
assert.equal(dlExempt({ role: 'premium' }), true);
assert.equal(dlExempt({ role: 'free' }), false);
assert.equal(dlExempt(null), false);
// روز ایران فقط برای سقف کل ربات می‌ماند
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 17, 20, 29)), '2026-09-17');
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 17, 20, 30)), '2026-09-18');

// ── ۳. تنظیمات پیش‌فرض ──
{
  const store = new Store(null, {});
  bustSettings(store);
  await store.del('set');
  const set = await getSettings(store);
  assert.equal(set.dlBurstLimit, 10);
  assert.deepEqual(set.dlCooldownSteps, [1, 2, 10, 30]);
  assert.equal(set.dlBurstResetMin, 60);
  assert.equal(set.dlLimitNotify, true);
  assert.equal(set.dlDailyLimitBot, 0);
  assert.ok(!('dlDailyLimit' in set), 'سقف روزانهٔ هر کاربر دیگر وجود ندارد');
  assert.ok(!('dlDailyLimit' in ECONOMY_DEFAULTS));
  // هیچ‌کدام از عددهای محدودیت به سمت کاربر (اقتصاد عمومی) نمی‌رود
  const pub = publicEconomy(set);
  for (const k of Object.keys(pub)) assert.ok(!/^dl(Burst|Cooldown|Daily|LimitNotify)/.test(k), 'نشت به کاربر: ' + k);
}

// ── ۴. محیط مشترک برای درخواست‌های واقعی دانلود ──
let scen = 0;
async function env(extra, envExtra, role) {
  scen += 1;
  const tag = '9' + String(scen).padStart(3, '0');
  const store = new Store(null, envExtra || {});
  bustSettings(store);
  await store.set('set', Object.assign({
    secret: 'testsecret123',
    deliveryBotToken: '123:TEST',
    deliveryBotUsername: 'testfilebot',
    dlClickPrice: 0,
    walletUnitName: 'سکه',
  }, extra || {}));
  const user = await createTgUser(store, { tgId: tag + '1' });
  user.role = role || 'free'; // اولین کاربر ماژول مدیر می‌شود؛ برای تست صریحاً تعیین می‌کنیم
  await saveUser(store, user);
  const itemId = 'i_t' + tag;
  await saveItemRecord(store, { id: itemId, title: 'فیلم تست', source: 'https://t.me/ch/123' });
  const token = await makeToken(store, user);
  return { store, user, token, itemId, tag };
}
const dlReq = (token) => new Request('http://localhost/api/dl/request', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
const dl = (e, who) => apiDlRequest(e.store, { itemId: e.itemId }, dlReq((who || e).token));
const wallet = async (e) => (await getUser(e.store, e.user.username)).wallet;
async function setWallet(e, n) { const u = await getUser(e.store, e.user.username); u.wallet = n; await saveUser(e.store, u); }

// ── ۵. پله‌ها در درخواست واقعی: بدون اعلام قانون، بدون کسر سکه در درخواست مسدود ──
{
  const e = await env({ dlBurstLimit: 3, dlCooldownSteps: '1,2', dlBurstResetMin: 60, dlClickPrice: 5 });
  await setWallet(e, 100);
  for (let i = 0; i < 3; i++) {
    const r = await dl(e);
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.charged, 5);
    // هیچ نشانه‌ای از قانون برای کاربر عادی نمی‌آید
    for (const k of ['dlLimit', 'dlUsed', 'dlBurstLimit', 'limit', 'used']) assert.ok(!(k in b), 'نشت: ' + k);
  }
  assert.equal(await wallet(e), 85);

  const r4 = await dl(e);
  assert.equal(r4.status, 429);
  assert.match(r4.headers.get('retry-after') || '', /^\d+$/);
  const b4 = await r4.json();
  assert.equal(b4.dlWait, true);
  assert.equal(b4.waitMin, 1);
  assert.ok(b4.waitSec >= 55 && b4.waitSec <= 60, String(b4.waitSec));
  assert.equal(b4.notify, false); // EDITOR بسته نشده؛ قولِ پیام نمی‌دهیم
  assert.equal(b4.error, 'برای دریافت فایل بعدی باید ۱ دقیقه صبر کنید.');
  assert.doesNotMatch(b4.error, /سقف|محدودیت|حداکثر|روز|پشت‌سرهم|کپی/); // فقط «n دقیقه صبر کنید»
  assert.ok(!b4.ticket && !b4.botLink, 'درخواست مسدود بلیت نمی‌دهد');
  for (let i = 0; i < 5; i++) assert.equal((await dl(e)).status, 429); // هرچه فشار بدهد همان می‌ماند
  assert.equal(await wallet(e), 85, 'درخواست مسدود سکه کم نمی‌کند');

  // انتظار تمام شد → دور بعد، ۲ دقیقه
  advance(MIN + 1000);
  for (let i = 0; i < 3; i++) assert.equal((await dl(e)).status, 200);
  assert.equal(await wallet(e), 70);
  const r5 = await dl(e);
  assert.equal(r5.status, 429);
  assert.equal((await r5.json()).error, 'برای دریافت فایل بعدی باید ۲ دقیقه صبر کنید.');
  advance(MIN + 1000); // هنوز ۲ دقیقه نشده
  assert.equal((await dl(e)).status, 429);
  advance(MIN); // ۲ دقیقه و ۲ ثانیه گذشته
  for (let i = 0; i < 3; i++) assert.equal((await dl(e)).status, 200);
  const r6 = await dl(e); // فهرست دو پله دارد؛ آخرین عدد تکرار می‌شود
  assert.equal(r6.status, 429);
  assert.equal((await r6.json()).waitMin, 2);

  // کمی از انتظار گذشته → زمان باقیمانده کمتر نشان داده می‌شود (رو به بالا گرد می‌شود)
  advance(90 * 1000);
  const r7 = await dl(e);
  assert.equal(r7.status, 429);
  assert.equal((await r7.json()).waitMin, 1);
}

// ── ۶. دانلودِ ناموفق (کیف پول خالی) یک «جا» مصرف نمی‌کند ──
{
  const e = await env({ dlBurstLimit: 2, dlCooldownSteps: '1', dlClickPrice: 5 });
  await setWallet(e, 0);
  for (let i = 0; i < 6; i++) {
    const r = await dl(e);
    assert.equal(r.status, 402);
    assert.equal((await r.json()).needWallet, true);
  }
  assert.equal((await dlStateRead(e.store, e.user.username)).n, 0, 'شکست پرداخت شمرده نمی‌شود');
  await setWallet(e, 100);
  assert.equal((await dl(e)).status, 200);
  assert.equal((await dl(e)).status, 200);
  assert.equal((await dl(e)).status, 429); // فقط همین دو دانلودِ واقعی شمرده شد
  assert.equal(await wallet(e), 90);
}

// ── ۷. مدیر و کاربر مادام‌العمر مستثنا؛ ۰ = خاموش؛ کاربران از هم جدا ──
{
  for (const role of ['admin', 'premium']) {
    const e = await env({ dlBurstLimit: 1 }, null, role);
    for (let i = 0; i < 6; i++) assert.equal((await dl(e)).status, 200, role);
    assert.equal((await dlStateRead(e.store, e.user.username)).n, 0, role + ' شمارنده ندارد');
  }
  const off = await env({ dlBurstLimit: 0 });
  for (let i = 0; i < 15; i++) assert.equal((await dl(off)).status, 200);

  const a = await env({ dlBurstLimit: 2, dlCooldownSteps: '5' });
  assert.equal((await dl(a)).status, 200);
  assert.equal((await dl(a)).status, 200);
  assert.equal((await dl(a)).status, 429);
  const other = await createTgUser(a.store, { tgId: a.tag + '2' });
  other.role = 'free'; await saveUser(a.store, other);
  const b = { token: await makeToken(a.store, other) };
  assert.equal((await dl(a, b)).status, 200, 'کاربر دیگر مسدود نیست');
  assert.equal((await dl(a)).status, 429);
}

// ── ۸. درخواست‌های هم‌زمان: دقیقاً ۱۰ تا رد می‌شوند ──
{
  const e = await env({}); // پیش‌فرض‌ها: ۱۰ پشت‌سرهم، ۱ دقیقه
  const results = await Promise.all(Array.from({ length: 25 }, () =>
    apiDlRequest(new Store(null, {}), { itemId: e.itemId }, dlReq(e.token))));
  const codes = results.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 200).length, 10, codes.join(','));
  assert.equal(codes.filter((c) => c === 429).length, 15, codes.join(','));
  const st = await dlStateRead(e.store, e.user.username);
  assert.ok(st.until > Date.now() && st.until <= Date.now() + MIN);
  assert.equal(st.lvl, 1);
}

// ── ۹. تنظیم قدیمی روزانه نادیده گرفته می‌شود؛ سقف کل ربات سر جایش ──
{
  const e = await env({ dlDailyLimit: 1, dlBurstLimit: 0 });
  for (let i = 0; i < 5; i++) assert.equal((await dl(e)).status, 200);

  const cap = await env({ dlBurstLimit: 0, dlDailyLimitBot: 2 });
  const before = await dlCounterRead(cap.store, 'bot:' + tlrDayStamp());
  assert.equal((await dl(cap)).status, 200);
  assert.equal((await dl(cap)).status, 200);
  const r = await dl(cap);
  assert.equal(r.status, 403);
  const b = await r.json();
  assert.equal(b.botLimit, 2);
  assert.match(b.error, /ربات/);
  assert.equal(await dlCounterRead(cap.store, 'bot:' + tlrDayStamp()), before + 2);

  // درخواستِ مسدودِ «پشت‌سرهم» به شمارندهٔ کل ربات اضافه نمی‌شود
  const mix = await env({ dlBurstLimit: 2, dlCooldownSteps: '9', dlDailyLimitBot: 1000 });
  const b0 = await dlCounterRead(mix.store, 'bot:' + tlrDayStamp());
  for (let i = 0; i < 6; i++) await dl(mix);
  assert.equal(await dlCounterRead(mix.store, 'bot:' + tlrDayStamp()), b0 + 2);
}

// ── ۱۰. مسیر CACHE_KV: وضعیت همان‌جا با TTL معقول ذخیره می‌شود ──
{
  const kvData = new Map(), ttls = new Map();
  const CACHE_KV = {
    get: async (k) => kvData.get(k) ?? null,
    put: async (k, v, o) => { kvData.set(k, v); ttls.set(k, o && o.expirationTtl); },
  };
  const e = await env({ dlBurstLimit: 2, dlCooldownSteps: '1,2' }, { CACHE_KV });
  assert.equal((await dl(e)).status, 200);
  assert.equal((await dl(e)).status, 200);
  assert.equal((await dl(e)).status, 429);
  const key = 'dlc:st:' + e.user.username;
  assert.ok(kvData.has(key));
  const ttl = ttls.get(key);
  assert.ok(ttl >= 120 && ttl <= 172800, 'TTL=' + ttl);
  assert.equal(JSON.parse(kvData.get(key)).lvl, 1);
}

// ── ۱۱. پیام پایان انتظار: زمان‌بندی فقط یک‌بار برای هر انتظار؛ بدون قولِ الکی ──
{
  const jobs = [];
  const mkEditor = (impl) => ({ idFromName: (n) => n, get: (n) => ({ fetch: async (rq) => { jobs.push({ name: n, url: rq.url, body: await rq.json() }); return impl(); } }) });
  const PROMISE = 'وقتی دانلود دوباره فعال شد، برایتان پیام می‌فرستیم.';

  const e = await env({ dlBurstLimit: 2, dlCooldownSteps: '1,2' }, { EDITOR: mkEditor(() => Response.json({ ok: true })) });
  await dl(e); await dl(e);
  const r1 = await dl(e);
  const b1 = await r1.json();
  assert.equal(r1.status, 429);
  assert.equal(b1.notify, true);
  assert.equal(b1.error, 'برای دریافت فایل بعدی باید ۱ دقیقه صبر کنید. ' + PROMISE);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'dln:' + e.user.tgId);
  assert.equal(jobs[0].url, 'https://editor.internal/dl-notify');
  assert.equal(jobs[0].body.tgId, e.user.tgId);
  assert.equal(jobs[0].body.itemId, e.itemId);
  const st1 = await dlStateRead(e.store, e.user.username);
  assert.equal(jobs[0].body.at, st1.until);
  assert.equal(st1.nfy, st1.until);
  for (let i = 0; i < 4; i++) {
    const r = await dl(e);
    assert.equal(r.status, 429);
    assert.equal((await r.json()).notify, true); // همان قول، بدون زمان‌بندی دوباره
  }
  assert.equal(jobs.length, 1, 'برای هر انتظار فقط یک کار زمان‌بندی می‌شود');
  // انتظار بعدی (۲ دقیقه) دوباره یک کار تازه می‌گیرد
  advance(MIN + 1000);
  await dl(e); await dl(e);
  const r2 = await dl(e);
  assert.equal(r2.status, 429);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].body.at, (await dlStateRead(e.store, e.user.username)).until);
  assert.ok(jobs[1].body.at > jobs[0].body.at);

  // خاموش در پنل → نه کاری و نه قولی
  const n0 = jobs.length;
  const off = await env({ dlBurstLimit: 1, dlLimitNotify: false }, { EDITOR: mkEditor(() => Response.json({ ok: true })) });
  await dl(off);
  const ro = await dl(off);
  assert.equal(ro.status, 429);
  const bo = await ro.json();
  assert.equal(bo.notify, false);
  assert.ok(!bo.error.includes('پیام'));
  assert.equal(jobs.length, n0);

  // DO جواب خطا بدهد → قول نمی‌دهیم؛ درخواست بعدی دوباره تلاش می‌کند
  const bad = await env({ dlBurstLimit: 1 }, { EDITOR: mkEditor(() => new Response('x', { status: 500 })) });
  await dl(bad);
  const rb = await dl(bad);
  assert.equal(rb.status, 429);
  assert.equal((await rb.json()).notify, false);
  const n1 = jobs.length;
  await dl(bad);
  assert.equal(jobs.length, n1 + 1);

  // DO پرتاب کند یا گیر کند → باز هم درخواست درست پاسخ می‌دهد
  const boom = await env({ dlBurstLimit: 1 }, { EDITOR: { idFromName: () => { throw new Error('no do'); }, get: () => { throw new Error('no do'); } } });
  await dl(boom);
  const rt = await dl(boom);
  assert.equal(rt.status, 429);
  assert.ok(!(await rt.json()).error.includes('پیام'));

  // بدون EDITOR: محدودیت کار می‌کند، فقط قولی داده نمی‌شود
  const none = await env({ dlBurstLimit: 1 });
  await dl(none);
  const rn = await dl(none);
  assert.equal(rn.status, 429);
  assert.equal((await rn.json()).error, 'برای دریافت فایل بعدی باید ۱ دقیقه صبر کنید.');
}

// ── ۱۲. سمت Durable Object: زمان‌بندی، alarm، ارسال از ربات، تلاش مجدد ──
function storageContext() {
  const values = new Map(); let alarm = null;
  return { values, alarm: () => alarm, storage: {
    get: async (k) => structuredClone(values.get(k)),
    put: async (k, v) => { values.set(k, structuredClone(v)); },
    delete: async (k) => values.delete(k),
    list: async () => new Map(),
    getAlarm: async () => alarm,
    setAlarm: async (n) => { alarm = n; },
    deleteAlarm: async () => { alarm = null; },
  } };
}
{
  const kvData = new Map();
  const KV = {
    get: async (k) => structuredClone(kvData.get(k) ?? null),
    put: async (k, v) => { kvData.set(k, JSON.parse(v)); },
    delete: async (k) => { kvData.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
  const putSettings = async (extra) => {
    kvData.set('set', Object.assign({ secret: 'x', deliveryBotToken: '111:FILE', botToken: '222:MAIN', dlLimitNotify: true }, extra || {}));
    bustSettings(new Store(KV, { KV }));
  };
  await putSettings();
  const envDo = { KV };
  const sent = [];
  let plan = () => ({ ok: true, result: { message_id: 1 } });
  globalThis.fetch = async (url, init) => {
    const m = String(url).match(/api\.telegram\.org\/bot([^/]+)\/(\w+)/);
    assert.ok(m, 'فقط تلگرام: ' + url);
    const body = JSON.parse(init.body);
    sent.push({ token: m[1], method: m[2], body });
    const p = plan(m[1], body, sent.length);
    if (p instanceof Error) throw p;
    return Response.json(p);
  };
  const sched = (session, body, raw) => session.fetch(new Request('https://editor.internal/dl-notify', { method: 'POST', body: raw !== undefined ? raw : JSON.stringify(body) }));

  // زمان‌بندی + اعتبارسنجی
  {
    const c = storageContext();
    const s = new EditorSession(c, envDo);
    const at = Date.now() + 90_000;
    const r = await sched(s, { tgId: '555001', at, itemId: 'i_abc123' });
    assert.equal(r.status, 200);
    assert.deepEqual(c.values.get('dln'), { tgId: '555001', at, itemId: 'i_abc123', tries: 0 });
    assert.equal(c.alarm(), at + 1000);
    // دیرتر بماند، زودتر جایش را نگیرد
    await sched(s, { tgId: '555001', at: at + 60_000, itemId: 'i_abc123' });
    assert.equal(c.values.get('dln').at, at + 60_000);
    await sched(s, { tgId: '555001', at: at - 30_000, itemId: 'i_abc123' });
    assert.equal(c.values.get('dln').at, at + 60_000);
    assert.equal(c.alarm(), at + 61_000);
    // آیدی اثرِ نامعتبر حذف می‌شود
    const c2 = storageContext(); const s2 = new EditorSession(c2, envDo);
    await sched(s2, { tgId: '555002', at, itemId: 'x"y' });
    assert.equal(c2.values.get('dln').itemId, '');
    // زمان گذشته/خیلی دور به بازهٔ امن می‌رسد
    const c3 = storageContext(); const s3 = new EditorSession(c3, envDo);
    await sched(s3, { tgId: '555003', at: Date.now() - 99_000 });
    assert.ok(c3.values.get('dln').at >= Date.now() - 50 && c3.values.get('dln').at <= Date.now() + 50);
    const c4 = storageContext(); const s4 = new EditorSession(c4, envDo);
    await sched(s4, { tgId: '555004', at: Date.now() + 10 * 86400_000 });
    assert.ok(c4.values.get('dln').at <= Date.now() + 86400_000 + 50);
    // ورودی خراب
    for (const body of [{ tgId: 'abc', at }, { tgId: '', at }, { tgId: '1'.repeat(21), at }, { at }, { tgId: '5', at: 'x' }, { tgId: '5' }, { tgId: '5', at: null }]) {
      const cc = storageContext(); const ss = new EditorSession(cc, envDo);
      assert.equal((await sched(ss, body)).status, 400, JSON.stringify(body));
      assert.equal(cc.values.has('dln'), false);
    }
    assert.equal((await sched(new EditorSession(storageContext(), envDo), null, '{not json')).status, 400);
    // نگهداری دیتابیس هم زمان‌بندی را نمی‌شکند (فقط ارسال به تعویق می‌افتد)
    const cp = storageContext(); const sp = new EditorSession(cp, { KV, STORAGE_MAINTENANCE: '1' });
    assert.equal((await sched(sp, { tgId: '555005', at: Date.now() + 1000 })).status, 200);
    advance(5000);
    sent.length = 0;
    await sp.alarm();
    assert.equal(sent.length, 0);
    assert.ok(cp.values.has('dln'));
    assert.ok(cp.alarm() >= Date.now() + 59_000);
  }

  // alarm: زودتر برسد → بدون ارسال؛ سر وقت → ارسال از ربات ارسال فایل؛ بعدش رکورد پاک
  {
    const c = storageContext(); const s = new EditorSession(c, envDo);
    const at = Date.now() + 60_000;
    await sched(s, { tgId: '555010', at, itemId: 'i_film7' });
    sent.length = 0;
    await s.alarm();
    assert.equal(sent.length, 0, 'پیش از پایان انتظار نباید پیام برود');
    assert.equal(c.alarm(), at + 1000);
    advance(61_000);
    await s.alarm();
    assert.equal(sent.length, 1);
    const m = sent[0];
    assert.equal(m.token, '111:FILE');
    assert.equal(m.method, 'sendMessage');
    assert.equal(m.body.chat_id, 555010);
    assert.match(m.body.text, /محدودیت دانلود شما برداشته شد/);
    assert.match(m.body.text, /دوباره/);
    const btn = m.body.reply_markup.inline_keyboard[0][0];
    assert.equal(btn.url, CONFIG.MINI_APP_URL + '?startapp=item_i_film7');
    assert.equal(c.values.has('dln'), false);
    // کار تمام‌شده دوباره پیام نمی‌دهد
    await s.alarm();
    assert.equal(sent.length, 1);

    // بدون آیدی اثر → دکمهٔ مینی‌اپ
    const c2 = storageContext(); const s2 = new EditorSession(c2, envDo);
    await sched(s2, { tgId: '555011', at: Date.now() });
    advance(1500); sent.length = 0;
    await s2.alarm();
    assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].url, CONFIG.MINI_APP_URL);
  }

  // ربات ارسال فایل کاربر را نمی‌شناسد (403) → ربات اصلی؛ هر دو 403 → تمام (بدون تلاش بی‌پایان)
  {
    const c = storageContext(); const s = new EditorSession(c, envDo);
    await sched(s, { tgId: '555020', at: Date.now() });
    advance(1500); sent.length = 0;
    plan = (token) => token === '111:FILE' ? { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } : { ok: true, result: {} };
    await s.alarm();
    assert.deepEqual(sent.map((x) => x.token), ['111:FILE', '222:MAIN']);
    assert.equal(c.values.has('dln'), false);

    const c2 = storageContext(); const s2 = new EditorSession(c2, envDo);
    await sched(s2, { tgId: '555021', at: Date.now() });
    advance(1500); sent.length = 0;
    plan = () => ({ ok: false, error_code: 403, description: 'Forbidden' });
    await s2.alarm();
    assert.equal(sent.length, 2);
    assert.equal(c2.values.has('dln'), false, 'کاربری که ربات را بسته دوباره امتحان نمی‌شود');
  }

  // خطای موقت (شبکه/۵xx/۴۲۹) → تلاش مجدد با تأخیر؛ بعد از ۴ بار رها می‌کند
  {
    const c = storageContext(); const s = new EditorSession(c, envDo);
    await sched(s, { tgId: '555030', at: Date.now() });
    advance(1500); sent.length = 0;
    plan = () => new Error('network down');
    for (let i = 1; i <= 4; i++) {
      await s.alarm();
      assert.equal(c.values.get('dln').tries, i);
      const wait = c.alarm() - Date.now();
      assert.ok(Math.abs(wait - 10_000 * i) < 300, 'تأخیر تلاش مجدد باید ' + (10 * i) + ' ثانیه باشد: ' + wait);
    }
    await s.alarm(); // پنجمین شکست → رها
    assert.equal(c.values.has('dln'), false);
    assert.equal(sent.length, 10); // ۵ نوبت × ۲ ربات

    // ۴۲۹ با retry_after
    const c2 = storageContext(); const s2 = new EditorSession(c2, envDo);
    await sched(s2, { tgId: '555031', at: Date.now() });
    advance(1500);
    plan = () => ({ ok: false, error_code: 429, parameters: { retry_after: 7 } });
    await s2.alarm();
    assert.equal(c2.values.get('dln').tries, 1);
    const w = c2.alarm() - Date.now();
    assert.ok(w >= 6900 && w <= 7100, 'retry_after باید رعایت شود: ' + w);

    // بعد از خطای موقت، موفقیت → پاک می‌شود
    plan = () => ({ ok: true, result: {} });
    sent.length = 0;
    await s2.alarm();
    assert.equal(sent.length, 1);
    assert.equal(c2.values.has('dln'), false);
  }

  // مدیر در پنل پیام را خاموش کرده → در لحظهٔ ارسال هم رعایت می‌شود
  {
    await putSettings({ dlLimitNotify: false });
    const c = storageContext(); const s = new EditorSession(c, envDo);
    await sched(s, { tgId: '555040', at: Date.now() });
    advance(1500); sent.length = 0;
    plan = () => ({ ok: true, result: {} });
    await s.alarm();
    assert.equal(sent.length, 0);
    assert.equal(c.values.has('dln'), false);
    await putSettings();
  }

  // alarm در DOای که رکورد dln ندارد (پیش‌نویس/کانال قدیمی) خطا نمی‌دهد و پیامی نمی‌فرستد
  {
    const c = storageContext(); const s = new EditorSession(c, envDo);
    sent.length = 0;
    await s.alarm();
    assert.equal(sent.length, 0);
  }

  // سرتاسری: درخواست مسدود → کار در DO واقعی → alarm → پیام به همان کاربر
  {
    const sessions = new Map(), ctxs = new Map();
    const editor = { idFromName: (n) => n, get: (n) => {
      if (!sessions.has(n)) { const c = storageContext(); ctxs.set(n, c); sessions.set(n, new EditorSession(c, envDo)); }
      return sessions.get(n);
    } };
    const e = await env({ dlBurstLimit: 2, dlCooldownSteps: '1,2', deliveryBotToken: '111:FILE' }, { EDITOR: editor });
    await dl(e); await dl(e);
    const r = await dl(e);
    const b = await r.json();
    assert.equal(r.status, 429);
    assert.equal(b.notify, true);
    const name = 'dln:' + e.user.tgId;
    assert.ok(ctxs.has(name));
    const job = ctxs.get(name).values.get('dln');
    assert.equal(job.tgId, e.user.tgId);
    assert.equal(job.itemId, e.itemId);
    assert.ok(job.at > Date.now() && job.at <= Date.now() + MIN);
    advance(MIN + 2000);
    plan = () => ({ ok: true, result: {} });
    sent.length = 0;
    await sessions.get(name).alarm();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.chat_id, Number(e.user.tgId));
    assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].url, CONFIG.MINI_APP_URL + '?startapp=item_' + e.itemId);
    // و کاربر واقعاً دوباره می‌تواند دانلود کند
    assert.equal((await dl(e)).status, 200);
  }
  globalThis.fetch = realFetch;
}

// ── ۱۳. پنل ادمین: خواندن/ذخیره/اعتبارسنجی ──
{
  const store = new Store(null, {});
  bustSettings(store);
  await store.del('set');
  const admin = await createTgUser(store, { tgId: '7770001' });
  admin.role = 'admin';
  await saveUser(store, admin);

  const overview = new URL('http://localhost/api/admin/overview');
  const settingsUrl = new URL('http://localhost/api/admin/settings');
  const go = (u) => new Request(u, { method: 'GET' });
  const ps = (body) => new Request(settingsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ov = async () => { bustSettings(store); return await (await handleAdmin(store, overview, go(overview), admin)).json(); };

  const g0 = await ov();
  assert.equal(g0.dlBurstLimit, 10);
  assert.deepEqual(g0.dlCooldownSteps, [1, 2, 10, 30]);
  assert.equal(g0.dlBurstResetMin, 60);
  assert.equal(g0.dlLimitNotify, true);
  assert.equal(g0.dlDailyLimitBot, 0);
  assert.equal(g0.dlNoticeReady, false); // EDITOR بسته نشده
  assert.ok(!('dlDailyLimit' in g0));

  // ذخیره از پنل (رقم فارسی و ویرگول فارسی هم پذیرفته می‌شود)
  let r = await handleAdmin(store, settingsUrl, ps({ dlBurstLimit: '5', dlCooldownSteps: '۲،۴،۸', dlBurstResetMin: '45', dlLimitNotify: false, dlDailyLimitBot: '500' }), admin);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  let g = await ov();
  assert.equal(g.dlBurstLimit, 5);
  assert.deepEqual(g.dlCooldownSteps, [2, 4, 8]);
  assert.equal(g.dlBurstResetMin, 45);
  assert.equal(g.dlLimitNotify, false);
  assert.equal(g.dlDailyLimitBot, 500);

  // مقدار نامعتبر رد می‌شود و هیچ‌چیز (حتی حافظهٔ کش) نیمه‌کاره عوض نمی‌شود
  const bads = [
    { dlBurstLimit: '1.5' }, { dlBurstLimit: '-1' }, { dlBurstLimit: '1001' }, { dlBurstLimit: '' }, { dlBurstLimit: null }, { dlBurstLimit: true }, { dlBurstLimit: 'abc' },
    { dlCooldownSteps: '' }, { dlCooldownSteps: '0' }, { dlCooldownSteps: '1,x' }, { dlCooldownSteps: '1441' }, { dlCooldownSteps: '1,2,3,4,5,6,7,8,9,10,11' }, { dlCooldownSteps: null }, { dlCooldownSteps: {} },
    { dlBurstResetMin: '0' }, { dlBurstResetMin: '1441' }, { dlBurstResetMin: '' }, { dlBurstResetMin: '2.5' }, { dlBurstResetMin: false },
    { dlDailyLimitBot: '2000000' }, { dlDailyLimitBot: '-1' },
  ];
  for (const b of bads) {
    r = await handleAdmin(store, settingsUrl, ps(b), admin);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.ok((await r.json()).error);
  }
  // یک فیلد درست + یک فیلد خراب = هیچ‌کدام اعمال نشود (بدون bustSettings، همان کش زنده)
  r = await handleAdmin(store, settingsUrl, ps({ dlBurstLimit: '3', dlCooldownSteps: 'abc' }), admin);
  assert.equal(r.status, 400);
  const live = await getSettings(store);
  assert.equal(live.dlBurstLimit, 5);
  r = await handleAdmin(store, settingsUrl, ps({ dlBurstLimit: '3', dlBurstResetMin: '0', dlLimitNotify: true, dlDailyLimitBot: '9' }), admin);
  assert.equal(r.status, 400);
  const live2 = await getSettings(store);
  assert.equal(live2.dlBurstLimit, 5);
  assert.equal(live2.dlLimitNotify, false);
  assert.equal(live2.dlDailyLimitBot, 500);
  g = await ov();
  assert.equal(g.dlBurstLimit, 5);
  assert.deepEqual(g.dlCooldownSteps, [2, 4, 8]);

  // زمان بازنشانی کمتر از آخرین مرحله ذخیره می‌شود اما در عمل بالا می‌رود
  r = await handleAdmin(store, settingsUrl, ps({ dlBurstResetMin: '3' }), admin);
  assert.equal(r.status, 200);
  bustSettings(store);
  assert.equal(dlBurstOf(await getSettings(store)).resetMin, 8);

  // فرستادن فیلد قدیمی خطا نمی‌دهد و اثری ندارد
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '25' }), admin);
  assert.equal(r.status, 200);
  assert.ok(!('dlDailyLimit' in await ov()));

  // صفر = خاموش
  r = await handleAdmin(store, settingsUrl, ps({ dlBurstLimit: '0', dlDailyLimitBot: '0' }), admin);
  assert.equal(r.status, 200);
  g = await ov();
  assert.equal(g.dlBurstLimit, 0);
  assert.equal(g.dlDailyLimitBot, 0);

  // وقتی EDITOR هست، پنل هشدار نمی‌دهد
  const store2 = new Store(null, { EDITOR: { idFromName: (n) => n, get: () => ({}) } });
  bustSettings(store2);
  const g2 = await (await handleAdmin(store2, overview, go(overview), admin)).json();
  assert.equal(g2.dlNoticeReady, true);
}

// ── ۱۴. رابط کاربری: هیچ‌جا قانون اعلام نمی‌شود؛ فرم ادمین و پیام انتظار هست ──
{
  const html = APP_HTML;
  const gone = ['حداکثر <b>', 'دانلود در روز', 'سقف روزانه', 'دانلود رایگان تا', 'به وقت ایران) دارد', 'برای جلوگیری از کپی منابع', 'dlLimitLine', 'dlUsed', 'dlLim ', 'دانلود دیگر برایتان مانده'];
  for (const g of gone) assert.ok(!html.includes(g), 'باید حذف شده باشد: ' + g);
  assert.ok(!/dlDailyLimit(?!Bot)/.test(html), 'dlDailyLimit در کلاینت نباید بماند');
  assert.ok(!/APP\.economy\.dl(Burst|Cooldown)/.test(html));
  for (const id of ['set-dlburst', 'set-dlsteps', 'set-dlreset', 'set-dlnotify', 'set-dlmaxbot']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(html.includes("e.data.dlWait") && html.includes("toast(e.message, 'err', 7000)"), 'پیام انتظار با toast طولانی‌تر');
  assert.ok(html.includes('function toast (msg, type, ms)'));
  assert.ok(html.includes('dlBurstLimit: $(\'#set-dlburst\')'));
  // قالب‌رشتهٔ APP_HTML نباید با کاراکترهای ممنوع خراب شود
  assert.ok(!html.includes('${'));
}

// ── ۱۵. رفتار کلاینت: فقط به کسی که به محدودیت خورده یک پیام نشان داده می‌شود ──
{
  const rs = source.indexOf('function requestDownload (itemId, opts, btn) {');
  const re = source.indexOf('function bindQualityClicks', rs);
  const ts = source.indexOf('function toast (msg, type, ms) {');
  const te = source.indexOf('\n}\n', ts) + 3;
  assert.ok(rs > 0 && re > rs && ts > 0 && te > ts, 'کد کلاینت پیدا نشد');
  const run = async (apiImpl) => {
    const calls = { toast: [], haptic: 0, nav: [], closeModal: 0, goToDlBot: [] };
    const sandbox = {
      APP: { user: { wallet: 5 } },
      api: apiImpl,
      toast: (m, t, ms) => { calls.toast.push([m, t, ms]); },
      haptic: () => { calls.haptic += 1; },
      nav: (h) => { calls.nav.push(h); },
      closeModal: () => { calls.closeModal += 1; },
      goToDlBot: (l) => { calls.goToDlBot.push(l); },
      showAdThen: () => { throw new Error('تبلیغ نباید بیاید'); },
      faMoney: (n) => String(n),
      unitName: () => 'سکه',
    };
    vm.createContext(sandbox);
    const { requestDownload } = new vm.Script('(function(){' + source.slice(rs, re) + '\nreturn { requestDownload };})()').runInContext(sandbox);
    const btn = { disabled: false, innerHTML: 'دانلود', textContent: '' };
    await requestDownload('i_x', {}, btn);
    calls.btn = btn;
    return calls;
  };
  // ۱) مسدود: دقیقاً یک toast، طولانی‌تر از معمول، با همان متن سرور؛ دکمه آزاد می‌شود
  const waitMsg = 'برای دریافت فایل بعدی باید ۲ دقیقه صبر کنید.';
  const blocked = await run(() => Promise.reject(Object.assign(new Error(waitMsg), { status: 429, data: { dlWait: true, waitMin: 2 } })));
  assert.deepEqual(blocked.toast, [[waitMsg, 'err', 7000]]);
  assert.equal(blocked.haptic, 1);
  assert.deepEqual(blocked.nav, []);
  assert.equal(blocked.goToDlBot.length, 0);
  assert.equal(blocked.btn.disabled, false);
  assert.equal(blocked.btn.innerHTML, 'دانلود');
  // ۲) موفق: حتی اگر سرور قدیمی dlLimit/dlUsed بفرستد، «n دانلود دیگر مانده» نشان داده نمی‌شود
  const okRun = await run(() => Promise.resolve({ ok: true, charged: 2, wallet: 8, botLink: 'https://t.me/FileBot?start=dl_x', dlLimit: 20, dlUsed: 19 }));
  assert.equal(okRun.toast.length, 1);
  assert.match(okRun.toast[0][0], /کسر شد/);
  assert.ok(!okRun.toast.some((t) => /مانده|سقف|دانلود دیگر/.test(t[0])));
  assert.deepEqual(okRun.goToDlBot, ['https://t.me/FileBot?start=dl_x']);
  // ۳) کیف پول و اشتراک مثل قبل
  const poor = await run(() => Promise.reject(Object.assign(new Error('موجودی کافی نیست'), { status: 402, data: { needWallet: true } })));
  assert.deepEqual(poor.toast, [['موجودی کافی نیست', 'err', undefined]]);
  assert.deepEqual(poor.nav, ['#/wallet']);
  const sub = await run(() => Promise.reject(Object.assign(new Error('x'), { status: 403, data: { needSub: true } })));
  assert.deepEqual(sub.nav, ['#/subscribe']);
  assert.equal(sub.toast.length, 0);
  // ۴) toast: مدت‌زمان اختیاری؛ پیش‌فرض ۳۲۰۰ میلی‌ثانیه
  const delays = [];
  const toastCtx = {
    document: { createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }) },
    $: () => ({ appendChild() {} }),
    setTimeout: (fn, ms) => { delays.push(ms); },
  };
  vm.createContext(toastCtx);
  const { toast } = new vm.Script('(function(){' + source.slice(ts, te) + '\nreturn { toast };})()').runInContext(toastCtx);
  toast('a', 'err');
  toast('b', 'err', 7000);
  assert.deepEqual(delays, [3200, 7000]);
}

console.log('PASS: step ladder 1/2/10/30 + repeat + idle reset; settings parsing; defaults; real requests (429 + wait text, no charge, rollback, exempt, off, isolation, 25 parallel → 10 pass); CACHE_KV path; notice scheduling once; DO schedule/alarm/send/retry; admin panel save, validation, atomicity; UI announcements removed; client toast/requestDownload behaviour.');

} finally {
  Date.now = realNow;
  globalThis.fetch = realFetch;
}
