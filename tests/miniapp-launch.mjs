import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/*
 * رفع باگ «لینک مستقیم فیلم/سریال در مینی‌اپ تلگرام روی لودینگ می‌ماند».
 * این تست منطق اسکرپت ابتدای صفحه (ثبت پارامترهای لانچ + web_app_ready واقعی)،
 * کمک‌های تلاش مجدد کلاینت و مقاوم‌سازی سمت سرور را بدون مرورگر بررسی می‌کند.
 */
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { APP_HTML, Store, newItem, saveItemRecord, idxUpsert, getSettings };').toString('base64'));
const html = mod.APP_HTML;

/* ───────── ۱) اسکرپت ابتدای صفحه ───────── */
const headScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert(headScript.includes('__mvxLaunch') && headScript.includes('__mvxSendReady'), 'first script must be the launch/ready script');
assert(html.indexOf(headScript) < html.indexOf('<style>'), 'launch capture must run before anything else in the page');

function runHead({ search = '', hash = '', proxy, parent, storage = new Map(), storageThrows = false } = {}) {
  const winListeners = {}, docListeners = {}, timers = [];
  const sessionStorage = storageThrows
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
  const win = {
    location: { search, hash },
    sessionStorage,
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
  };
  win.window = win;
  win.parent = parent || win;
  if (proxy) win.TelegramWebviewProxy = proxy;
  const document = { addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); } };
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  vm.runInContext(headScript, vm.createContext({ window: win, document, setTimeout }));
  return { win, winListeners, docListeners, timers, storage };
}

const initData = 'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A424242%2C%22first_name%22%3A%22%D8%B9%D9%84%DB%8C%22%7D&auth_date=1700000000&start_param=item_i_abc123&hash=abcdef0123456789';
const tgHash = '#tgWebAppData=' + encodeURIComponent(initData) + '&tgWebAppVersion=9.0&tgWebAppPlatform=android&tgWebAppThemeParams=' + encodeURIComponent('{"bg_color":"#17212b"}');

{
  // Android/iOS/desktop: TelegramWebviewProxy.postEvent(type, JSON(data)) — the same call the official SDK makes.
  const calls = [];
  const run = runHead({ search: '?tgWebAppStartParam=item_i_abc123', hash: tgHash, proxy: { postEvent: (t, d) => calls.push([t, d]) } });
  assert.deepEqual({ ...run.win.__mvxLaunch }, { initData, startParam: 'item_i_abc123', version: '9.0', platform: 'android', restored: false });
  assert.equal(calls.length, 0, 'the early script defers the ready signal until the splash exists');
  assert.equal(run.win.__mvxSendReady(), 'native');
  assert.deepEqual(calls, [['web_app_ready', '""'], ['web_app_expand', '""']]);
  run.win.__mvxSendReady();
  assert.deepEqual(calls.slice(2), [['web_app_ready', '""']], 'expand is requested once');
  run.win.__mvxPostEvent('web_app_setup_back_button', { is_visible: true });
  assert.deepEqual(calls.at(-1), ['web_app_setup_back_button', '{"is_visible":true}']);
  // backups: DOMContentLoaded, load and two timers all re-send ready
  assert(run.docListeners.DOMContentLoaded.length === 1 && run.winListeners.load.length === 1);
  assert.deepEqual(run.timers.map(t => t.ms), [3000, 7000]);
  const before = calls.length;
  run.docListeners.DOMContentLoaded[0](); run.winListeners.load[0](); run.timers.forEach(t => t.fn());
  assert.equal(calls.length - before, 4);
  assert(calls.slice(before).every(c => c[0] === 'web_app_ready'));
}

{
  // Telegram Web (iframe): parent.postMessage(JSON({eventType, eventData}), '*')
  const messages = [];
  const parent = { postMessage: (m, target) => messages.push([m, target]) };
  const run = runHead({ hash: '#/', parent });
  assert.equal(run.win.__mvxSendReady(), 'iframe');
  assert.deepEqual(messages.map(([m, t]) => [JSON.parse(m), t]), [
    [{ eventType: 'web_app_ready', eventData: '' }, '*'],
    [{ eventType: 'web_app_expand', eventData: '' }, '*'],
  ]);
}

{
  // Plain browser / unsupported bridge: no exception, nothing sent, expand deferred until a bridge exists.
  const run = runHead({ hash: '#/' });
  assert.equal(run.win.__mvxSendReady(), '');
  const throwing = runHead({ hash: '#/', proxy: { postEvent() { throw new Error('bridge down'); } } });
  assert.equal(throwing.win.__mvxSendReady(), '');
  const brokenParent = runHead({ hash: '#/', parent: { postMessage() { throw new Error('blocked'); } } });
  assert.equal(brokenParent.win.__mvxSendReady(), '');
}

{
  // Launch parameters come from the query, the hash or the signed initData; Persian JSON in initData survives.
  const fromHash = runHead({ hash: tgHash + '&tgWebAppStartParam=item_i_hash99' });
  assert.equal(fromHash.win.__mvxLaunch.startParam, 'item_i_hash99');
  assert.equal(fromHash.win.__mvxLaunch.initData, initData);
  const fromInitData = runHead({ hash: tgHash });
  assert.equal(fromInitData.win.__mvxLaunch.startParam, 'item_i_abc123');
  const noStart = runHead({ hash: '#tgWebAppData=' + encodeURIComponent('query_id=A&hash=b') + '&tgWebAppVersion=8.0' });
  assert.equal(noStart.win.__mvxLaunch.startParam, '');
  assert.equal(noStart.win.__mvxLaunch.initData, 'query_id=A&hash=b');
  const plus = runHead({ hash: '#tgWebAppData=a%3Db%26note%3Dx+y&tgWebAppPlatform=ios' });
  assert.equal(plus.win.__mvxLaunch.initData, 'a=b&note=x y');
  const plain = runHead({ hash: '#/' });
  assert.deepEqual({ ...plain.win.__mvxLaunch }, { initData: '', startParam: '', version: '', platform: '', restored: false });
}

{
  // Telegram's "Reload Page" reopens the rewritten URL (no tgWebApp* params): the session must survive,
  // but the one-time start param must not re-route a reload of another page.
  const first = runHead({ search: '?tgWebAppStartParam=item_i_abc123', hash: tgHash });
  assert(first.storage.size === 1);
  const reloaded = runHead({ hash: '#/item/i_abc123', storage: first.storage });
  assert.deepEqual({ ...reloaded.win.__mvxLaunch }, { initData, startParam: '', version: '9.0', platform: 'android', restored: true });
  const other = runHead({ hash: '#/', storage: first.storage });
  assert.equal(other.win.__mvxLaunch.startParam, '');
  // a fresh launch always wins over stale stored data
  const fresh = runHead({ hash: '#tgWebAppData=' + encodeURIComponent('query_id=NEW&hash=h'), storage: first.storage });
  assert.equal(fresh.win.__mvxLaunch.initData, 'query_id=NEW&hash=h');
  assert.equal(fresh.win.__mvxLaunch.restored, false);
  // blocked storage must never break the page
  const blocked = runHead({ hash: tgHash, storageThrows: true });
  assert.equal(blocked.win.__mvxLaunch.initData, initData);
  assert.equal(runHead({ hash: '#/', storageThrows: true }).win.__mvxLaunch.initData, '');
}

{
  // The in-page Telegram shim is built from the captured launch data. A *restored* session (after "Reload Page")
  // authenticates, but its start_param must not bounce the user back to the first launch's movie.
  const shimCode = html.slice(html.indexOf('function tgInitDataFromUrl'), html.indexOf('var __bootErr'));
  function shim({ search = '', hash = '', launch }) {
    const posted = [];
    const ctx = vm.createContext({ URLSearchParams, location: { search, hash }, LAUNCH: launch, tgPost: (t, d) => posted.push([t, d]) });
    vm.runInContext(shimCode, ctx);
    return { tg: ctx.buildTgFallback(), posted };
  }
  const fresh = shim({ hash: tgHash, launch: { initData, startParam: 'item_i_abc123', restored: false } });
  assert.equal(fresh.tg.initData, initData);
  assert.equal(fresh.tg.initDataUnsafe.start_param, 'item_i_abc123');
  const restored = shim({ hash: '#/', launch: { initData, startParam: '', restored: true } });
  assert.equal(restored.tg.initData, initData, 'restored session still authenticates');
  assert.equal(restored.tg.initDataUnsafe.start_param, undefined, 'restored start_param is never re-applied');
  assert.equal(restored.tg.initDataUnsafe.query_id, 'AAHdF6IQAAAAAN0XohDhrOrc');
  const outside = shim({ hash: '#/', launch: { initData: '', startParam: '', restored: false } });
  assert.equal(outside.tg.initData, '');
  restored.tg.ready(); restored.tg.expand();
  assert.deepEqual(restored.posted, [['web_app_ready', undefined], ['web_app_expand', undefined]], 'shim speaks the native protocol');
}

/* ───────── ۲) ساختار صفحه ───────── */
assert(!html.includes("event: 'web_app_ready'"), 'the old, unsupported ready payload must be gone');
const splashIdx = html.indexOf('<div id="app">');
const splashReady = html.indexOf('window.__mvxSendReady', splashIdx);
const mainScript = html.indexOf("var MVX_VER = 'v3.51'");
assert(splashIdx > 0 && splashReady > splashIdx && splashReady < mainScript, 'ready is sent right after the splash markup, before the heavy main script');
assert(html.includes('<meta name="mvx-version" content="v3.51">'));
assert(html.includes('loadTgScriptSoon();') && !/loadTgScript\(\);\s*var rq = currentRoute/.test(html), 'telegram.org SDK must not be requested during boot');
assert(html.includes("tgPost('web_app_ready')") && html.includes("tgPost('web_app_expand')"), 'fallback shim speaks the real protocol');
assert(html.includes('function tgInitData ()') && html.includes('initData: initData, existingOnly: true'), 'mini-app login uses the captured launch data');
assert(html.includes('function itemErrorHtml') && html.includes('id="item-retry"'), 'item route has a visible error + retry');
assert(!/\.catch\(function \(e\) \{\s*if \(e\.status === 404\) shell/.test(html), 'item route must not swallow non-404 errors');
{
  const from = html.indexOf("if ((m = path.match(new RegExp('^/item/(i_[a-z0-9]+)$'))))");
  const route = html.slice(from, html.indexOf("if ((m = path.match(new RegExp('^/watch/", from));
  assert(from > 0 && route.length > 100);
  for (const needle of ['loadItemData(itemId, fresh)', 'seq !== __renderSeq', 'shell(itemErrorHtml(e)', 'bindItemRetry()', "e.status === 404", 'try { bindItem(d.item, d); }']) {
    assert(route.includes(needle), 'item route must contain: ' + needle);
  }
}
{
  // the loader shares one in-flight request, hedges slow ones and never hedges a superseded one
  const loader = html.slice(html.indexOf('function loadItemData'), html.indexOf('function forceRender'));
  for (const needle of ['cur.id === id && cur.tok === tok', 'firstSuccess(cur.p, startItemChain(id))', 'hedge(startItemChain(id)', '__itemReq !== rec', '3000']) {
    assert(loader.includes(needle), 'item loader must contain: ' + needle);
  }
}
for (const bad of ['\\', '`', '${']) assert(!headScript.includes(bad), `head script must stay template-literal safe: ${bad}`);

/* ───────── ۳) کمک‌های تلاش مجدد کلاینت ───────── */
const helperCode = html.slice(html.indexOf('/* @@retry-helpers-begin */'), html.indexOf('/* @@retry-helpers-end */'));
assert(['function retryAsync', 'function firstSuccess', 'function isRetryableErr', 'function hedge'].every(name => helperCode.includes(name)));
const helpers = vm.createContext({ setTimeout, Promise });
vm.runInContext(helperCode, helpers);
const httpErr = (status, message = 'x') => Object.assign(new Error(message), { status });

for (const [err, expected] of [[new Error('network'), true], [httpErr(500), true], [httpErr(502), true], [httpErr(429), true], [httpErr(408), true], [httpErr(404), false], [httpErr(400), false], [httpErr(401), false], [httpErr(403), false], [undefined, true]]) {
  assert.equal(helpers.isRetryableErr(err), expected, String(err && err.status));
}
{
  let calls = 0;
  const seen = [];
  const value = await helpers.retryAsync(n => { seen.push(n); calls++; return calls < 3 ? Promise.reject(httpErr(500, 'boom')) : Promise.resolve('ok'); }, { tries: 3, delays: [1, 1] });
  assert.equal(value, 'ok');
  assert.deepEqual(seen, [0, 1, 2]);
}
{
  let calls = 0;
  await assert.rejects(helpers.retryAsync(() => { calls++; return Promise.reject(httpErr(404, 'missing')); }, { tries: 3, delays: [1, 1] }), /missing/);
  assert.equal(calls, 1, '404 is final, never retried');
}
{
  let calls = 0;
  await assert.rejects(helpers.retryAsync(() => { calls++; return Promise.reject(httpErr(503, `down ${calls}`)); }, { tries: 3, delays: [1, 1] }), /down 3/);
  assert.equal(calls, 3);
  await assert.rejects(helpers.retryAsync(() => { throw new Error('sync failure'); }, { tries: 2, delays: [1] }), /sync failure/);
}
{
  const never = new Promise(() => {});
  assert.equal(await helpers.firstSuccess(Promise.reject(new Error('a')), Promise.resolve('b')), 'b');
  assert.equal(await helpers.firstSuccess(Promise.resolve('a'), never), 'a');
  assert.equal(await helpers.firstSuccess(never, Promise.resolve('b')), 'b');
  await assert.rejects(helpers.firstSuccess(Promise.reject(new Error('one')), Promise.reject(new Error('two'))), /one|two/);
}

{
  // hedge: a slow first request gets a parallel twin after `ms`; the first success wins.
  const delay = (ms, value, fail) => new Promise((resolve, reject) => setTimeout(() => (fail ? reject(value) : resolve(value)), ms));
  let made = 0;
  assert.equal(await helpers.hedge(delay(1, 'fast'), () => { made++; return delay(1, 'twin'); }, 40), 'fast');
  await delay(60);
  assert.equal(made, 0, 'no twin when the first request answers in time');

  made = 0;
  assert.equal(await helpers.hedge(delay(400, 'slow'), () => { made++; return delay(1, 'twin'); }, 20), 'twin');
  assert.equal(made, 1, 'twin is started once, after the hedge delay');

  made = 0;
  await assert.rejects(helpers.hedge(delay(1, httpErr(404, 'gone'), true), () => { made++; return delay(1, 'twin'); }, 40), /gone/);
  await delay(60);
  assert.equal(made, 0, 'a fast failure is returned as is, without a twin');

  await assert.rejects(helpers.hedge(delay(30, httpErr(500, 'first'), true), () => delay(1, httpErr(500, 'second'), true), 5), /first|second/);
  assert.equal(await helpers.hedge(delay(30, httpErr(500, 'first'), true), () => delay(1, 'rescued'), 5), 'rescued', 'twin rescues a failing first request');
  // a superseded request declines to start its twin; the original still decides the result
  assert.equal(await helpers.hedge(delay(30, 'original'), () => Promise.reject(new Error('superseded')), 5), 'original');
}

/* ───────── ۴) سرور: شمارندهٔ بازدید نباید صفحهٔ فیلم را خراب کند ───────── */
function fakeKV() {
  const data = new Map();
  const state = { failPuts: false, puts: 0 };
  return {
    state, data,
    async get(key, opts) {
      if (!data.has(key)) return null;
      const raw = data.get(key);
      return (opts === 'json' || opts?.type === 'json') ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      state.puts++;
      if (state.failPuts && key.startsWith('it:')) throw new Error('KV put failed: daily write quota exceeded');
      data.set(key, value);
    },
    async delete(key) { data.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: '' }; },
  };
}
{
  const kv = fakeKV();
  const env = { KV: kv };
  const store = new mod.Store(kv, env);
  await mod.getSettings(store);
  for (const id of ['i_viewfail1', 'i_viewfail2']) {
    const item = mod.newItem('فیلم تست ' + id, 'movie', null, 'chan');
    item.id = id;
    item.access = 'free';
    await mod.saveItemRecord(store, item);
    await mod.idxUpsert(store, item);
  }
  kv.state.failPuts = true;
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  // Workers runtime: the write is handed to ctx.waitUntil and its failure is contained.
  const waited = [];
  const withCtx = await mod.default.fetch(new Request('https://test/api/item/i_viewfail1'), env, { waitUntil: p => waited.push(p) });
  assert.equal(withCtx.status, 200);
  assert.equal((await withCtx.json()).item.id, 'i_viewfail1');
  assert.equal(waited.length, 1, 'view counter write is deferred via waitUntil');
  await Promise.all(waited);

  // No waitUntil available: the write is awaited but a storage failure still cannot 500 the page.
  const withoutCtx = await mod.default.fetch(new Request('https://test/api/item/i_viewfail2'), env, {});
  assert.equal(withoutCtx.status, 200);
  assert.equal((await withoutCtx.json()).item.id, 'i_viewfail2');

  // Unknown ids still 404 (the client shows "not found", never a spinner).
  const missing = await mod.default.fetch(new Request('https://test/api/item/i_nope0000'), env, {});
  assert.equal(missing.status, 404);
  console.warn = realWarn;
  assert.equal(warnings.filter(w => w.includes('[views]')).length, 2, 'failed view writes are logged, not thrown');
}

console.log('PASS: Mini App launch params survive URL rewrite and reload; real web_app_ready (native + iframe); retry helpers; item API survives view-counter write failures.');
