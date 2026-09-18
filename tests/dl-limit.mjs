import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { Store, createTgUser, makeToken, saveItemRecord, apiDlRequest, getSettings, tlrDayStamp, dlCounterRead, dlCounterBump, dlLimitOf, dlExempt, bustSettings, saveUser, handleAdmin };').toString('base64'));

const { Store, createTgUser, makeToken, saveItemRecord, apiDlRequest, getSettings, tlrDayStamp, dlCounterRead, dlCounterBump, dlLimitOf, dlExempt, bustSettings, saveUser, handleAdmin } = mod;

function req(token) {
  return new Request('http://localhost/api/dl/request', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
}

// ── ۱. روز‌شمار به وقت ایران (UTC+3:30) — مرز روز: ۲۰:۳۰ UTC ──
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 17, 20, 29)), '2026-09-17'); // ۲۳:۵۹ تهران
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 17, 20, 30)), '2026-09-18'); // ۰۰:۰۰ تهران
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 17, 23, 59)), '2026-09-18');
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 18, 5, 29)), '2026-09-18');
assert.equal(tlrDayStamp(Date.UTC(2026, 8, 18, 20, 30)), '2026-09-19');

// ── ۲. شمارنده‌ها ──
{
  const store = new Store(null, {});
  assert.equal(await dlCounterRead(store, 'a'), 0);
  assert.equal(await dlCounterBump(store, 'a'), 1);
  assert.equal(await dlCounterBump(store, 'a'), 2);
  assert.equal(await dlCounterRead(store, 'a'), 2);
  assert.equal(await dlCounterRead(store, 'b'), 0);
  assert.equal(await dlCounterBump(store, 'b'), 1);
}
assert.deepEqual(dlLimitOf({ dlDailyLimit: '25', dlDailyLimitBot: '0' }), { user: 25, bot: 0 });
assert.deepEqual(dlLimitOf({}), { user: 0, bot: 0 });
assert.deepEqual(dlLimitOf({ dlDailyLimit: -5, dlDailyLimitBot: 99999999 }), { user: 0, bot: 1000000 });
assert.equal(dlExempt({ role: 'admin' }), true);
assert.equal(dlExempt({ role: 'premium' }), true);
assert.equal(dlExempt({ role: 'free' }), false);
assert.equal(dlExempt(null), false);

// ── ۳. محیط مشترک: کاربر آزاد (دو نفر که نفر اول مدیر است) ──
let scen = 0;
async function env(extra) {
  // فallback حافظه‌ای Store بین نمونه‌ها مشترک است؛ با tgId منحصر‌به‌فهرست
  // هر سناریو کاربر تازه‌ای می‌سازد تا شمارنده‌ها عین production (یک KV واحد)
  // ولی جدا از هم سناریو‌ها بمانند.
  scen += 1;
  const tag = String(scen).repeat(4).slice(0, 4);
  const store = new Store(null, {});
  bustSettings(store); // کش تنظیمات در سطح ماژول، بین استور‌های حافظه‌ای مشترک است
  await store.set('set', Object.assign({
    secret: 'testsecret123',
    deliveryBotToken: '123:TEST',
    deliveryBotUsername: 'testfilebot',
    dlClickPrice: 0,
    dlDailyLimit: 0,
    dlDailyLimitBot: 0,
    walletUnitName: 'سکه',
  }, extra || {}));
  const user = await createTgUser(store, { tgId: tag + '1' });
  // اولین کاربر کل ماژول مدیر می‌شود؛ بقیه free هستند. برای تست کافی است.
  assert.ok(['admin', 'free'].includes(user.role));
  if (user.role === 'admin') user.role = 'free', await saveUser(store, user); // مدیریت از تست‌های محدودیت خارج شود
  await saveItemRecord(store, { id: 'it-test-' + tag, title: 'فیلم تست', source: 'https://t.me/ch/123' });
  const token = await makeToken(store, user);
  return { store, user, token, itemId: 'it-test-' + tag, tag };
}
async function dl(token, itemId) {
  return await apiDlRequest(envStore, { itemId: itemId || 'it-test-1' }, req(token));
}
let envStore = null;

// ── ۴. سقف کاربری: ۳ بار در روز ──
{
  const e = await env({ dlDailyLimit: 3 });
  envStore = e.store;
  const r1 = await dl(e.token, e.itemId);
  assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json()));
  const b1 = await r1.json();
  assert.equal(b1.ok, true);
  assert.equal(b1.dlLimit, 3);
  assert.equal(b1.dlUsed, 1);
  const r2 = await dl(e.token, e.itemId);
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).dlUsed, 2);
  const r3 = await dl(e.token, e.itemId);
  assert.equal(r3.status, 200);
  assert.equal((await r3.json()).dlUsed, 3);
  const r4 = await dl(e.token, e.itemId);
  assert.equal(r4.status, 403);
  const b4 = await r4.json();
  assert.equal(b4.dlLimit, true);
  assert.equal(b4.limit, 3);
  assert.equal(b4.used, 3);
  assert.match(b4.error, /سقف دانلود امروز/);
  // سکه کسر نشده (قیمت صفر است؛ اما مهم: درخواست اصلاً به ثبت نرسیده)
  assert.equal(await dlCounterRead(e.store, e.user.username + ':' + tlrDayStamp()), 3);
}

// ── ۵. سقف جداگانه برای هر کاربر ──
{
  const e = await env({ dlDailyLimit: 1 });
  envStore = e.store;
  assert.equal((await dl(e.token, e.itemId)).status, 200);
  assert.equal((await dl(e.token, e.itemId)).status, 403);
  const other = await createTgUser(e.store, { tgId: e.tag + '2' });
  if (other.role === 'admin') other.role = 'free', await saveUser(e.store, other);
  assert.equal(other.role, 'free');
  const t2 = await makeToken(e.store, other);
  assert.equal((await dl(t2, e.itemId)).status, 200);
}

// ── ۶. سقف کل ربات ──
{
  const e = await env({ dlDailyLimit: 0, dlDailyLimitBot: 1 });
  envStore = e.store;
  const r1 = await dl(e.token, e.itemId);
  assert.equal(r1.status, 200);
  assert.equal(await dlCounterRead(e.store, 'bot:' + tlrDayStamp()), 1);
  const r2 = await dl(e.token, e.itemId);
  assert.equal(r2.status, 403);
  const b2 = await r2.json();
  assert.equal(b2.dlLimit, true);
  assert.equal(b2.botLimit, 1);
  assert.match(b2.error, /ربات/);
}

// ── ۷. مدیر و premium مستثنا ──
{
  const e = await env({ dlDailyLimit: 1 });
  envStore = e.store;
  const premium = await createTgUser(e.store, { tgId: e.tag + '3' });
  premium.role = 'premium';
  await saveUser(e.store, premium);
  const tp = await makeToken(e.store, premium);
  const botBefore = await dlCounterRead(e.store, 'bot:' + tlrDayStamp());
  const r1 = await dl(tp, e.itemId);
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.dlLimit, 0); // کاربر مستثنا، عدد سقف نمی‌بیند
  const r2 = await dl(tp, e.itemId);
  assert.equal(r2.status, 200); // دوباره هم می‌تواند
  assert.equal(await dlCounterRead(e.store, premium.username + ':' + tlrDayStamp()), 0); // شمارنده‌اش بالا نرفته
  assert.equal(await dlCounterRead(e.store, 'bot:' + tlrDayStamp()), botBefore); // شمارندهٔ ربات هم
}

// ── ۸. بدون سقف (۰ = نامحدود) ──
{
  const e = await env({});
  envStore = e.store;
  for (let i = 0; i < 5; i++) assert.equal((await dl(e.token, e.itemId)).status, 200);
  assert.equal(await dlCounterRead(e.store, e.user.username + ':' + tlrDayStamp()), 0);
}

// ── ۹. تنظیمات پیش‌فرض: ۲۰ روزانه کاربری، ربات خاموش ──
{
  const store = new Store(null, {});
  bustSettings(store);
  await store.del('set'); // کلید مشترکِ سناریوهای قبل را حذف کن تا پیش‌فرض ساخته شود
  const set = await getSettings(store);
  assert.equal(set.dlDailyLimit, 20);
  assert.equal(set.dlDailyLimitBot, 0);
}

// ── ۱۰. کنترل از پنل ادمین (GET overview / POST settings) ──
{
  const store = new Store(null, {});
  bustSettings(store);
  await store.del('set');
  const admin = await createTgUser(store, { tgId: '7770001' });
  // اولین کاربر ماژول ممکن است مدیر شده باشد؛ در هر صورت برای تست ادمین می‌کنیم
  admin.role = 'admin';
  await saveUser(store, admin);

  const overview = new URL('http://localhost/api/admin/overview');
  const settingsUrl = new URL('http://localhost/api/admin/settings');
  const go = (u) => new Request(u, { method: 'GET' });
  const ps = (body) => new Request(settingsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const g0 = await (await handleAdmin(store, overview, go(overview), admin)).json();
  assert.equal(g0.dlDailyLimit, 20); // پیش‌فرض
  assert.equal(g0.dlDailyLimitBot, 0);

  // ذخیره از پنل
  let r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '25', dlDailyLimitBot: '500' }), admin);
  assert.equal(r.status, 200);
  bustSettings(store);
  let g = await (await handleAdmin(store, overview, go(overview), admin)).json();
  assert.equal(g.dlDailyLimit, 25);
  assert.equal(g.dlDailyLimitBot, 500);

  // مقدار نامعتبر رد می‌شود و مقدار قبلی دست‌نخورده می‌ماند
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '1.5' }), admin);
  assert.equal(r.status, 400);
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '-1' }), admin);
  assert.equal(r.status, 400);
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimitBot: '2000000' }), admin);
  assert.equal(r.status, 400);
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '999999' }), admin);
  assert.equal(r.status, 400);
  bustSettings(store);
  g = await (await handleAdmin(store, overview, go(overview), admin)).json();
  assert.equal(g.dlDailyLimit, 25);
  assert.equal(g.dlDailyLimitBot, 500);

  // صفر = غیرفعال
  r = await handleAdmin(store, settingsUrl, ps({ dlDailyLimit: '0', dlDailyLimitBot: '0' }), admin);
  assert.equal(r.status, 200);
  bustSettings(store);
  g = await (await handleAdmin(store, overview, go(overview), admin)).json();
  assert.equal(g.dlDailyLimit, 0);
  assert.equal(g.dlDailyLimitBot, 0);
}

console.log('PASS: Tehran day stamp; per-user counters; user daily cap; per-user isolation; global bot cap; admin/premium exemption; unlimited mode; defaults (20/0); admin panel save & validation.');
