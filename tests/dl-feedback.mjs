import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

/* ── ۱) اتصال مسیرها: requestDownload باید در هر دو حالت (مستقیم + پس از
   تبلیغ) goToDlBot را صدا بزند، نه openBot خام یا مودال ── */
const reqStart = source.indexOf('function requestDownload (itemId, opts, btn) {');
const reqEnd = source.indexOf('function bindQualityClicks', reqStart);
assert.ok(reqStart > 0 && reqEnd > reqStart, 'requestDownload not found');
const reqBody = source.slice(reqStart, reqEnd);
assert.ok(reqBody.includes('goToDlBot(g.botLink)'), 'مسیر تبلیغ باید goToDlBot داشته باشد');
assert.ok(reqBody.includes('goToDlBot(r.botLink)'), 'مسیر مستقیم باید goToDlBot داشته باشد');
assert.ok(!/openBot\(r\.botLink\)/.test(reqBody), 'openBot خام نباید مستقیم در requestDownload باشد');
assert.ok(!/openBot\(g\.botLink\)/.test(reqBody), 'openBot خام نباید در مسیر تبلیغ باشد');

/* ── ۲) رفتار goToDlBot: کاربر به ربات دریافت هدایت می‌شود و مینی‌اپ
   مینیمایز می‌شود (نه بسته)؛ فقط در حالتِ لبه‌ایِ «از پیش در همان چت»
   که هیچ سیگنالی نمی‌آید، به‌عنوان آخرین چاره close() صدا زده می‌شود ── */
const fnStart = source.indexOf('function goToDlBot (botLink) {');
const fnEnd = source.indexOf('function requestDownload (itemId, opts, btn) {');
assert.ok(fnStart > 0 && fnEnd > fnStart, 'goToDlBot not found');
const block = source.slice(fnStart, fnEnd);

const LINK = 'https://t.me/FileBot?start=dl_x1';

function runScenario(opts) {
  opts = opts || {};
  const calls = { openTelegramLink: [], close: 0, assign: [], toast: [], haptic: [], closeModal: 0 };
  const timers = [];
  const winL = {}, docL = {}, tgL = {};
  function add(store, type, fn) { (store[type] = store[type] || []).push(fn); }
  function remove(store, type, fn) { if (store[type]) store[type] = store[type].filter(f => f !== fn); }
  function fire(store, type, ctx) { (store[type] || []).slice().forEach(fn => fn.call(ctx)); }

  const documentObj = {
    hidden: false,
    addEventListener: (t, fn) => add(docL, t, fn),
    removeEventListener: (t, fn) => remove(docL, t, fn),
  };
  const windowObj = {
    addEventListener: (t, fn) => add(winL, t, fn),
    removeEventListener: (t, fn) => remove(winL, t, fn),
  };
  const TG = opts.noTg ? null : {
    openTelegramLink: (u) => { calls.openTelegramLink.push(u); },
    onEvent: (t, fn) => add(tgL, t, fn),
    offEvent: (t, fn) => remove(tgL, t, fn),
    close: () => { calls.close += 1; },
    isActive: opts.isActive === undefined ? true : opts.isActive,
  };
  const sandbox = {
    toast: (m, t) => { calls.toast.push([m, t]); },
    haptic: (t) => { calls.haptic.push(t); },
    closeModal: () => { calls.closeModal += 1; },
    setTimeout: (fn) => { timers.push(fn); },
    location: { assign: (u) => { calls.assign.push(u); } },
    document: documentObj,
    window: windowObj,
    TG,
  };
  vm.createContext(sandbox);
  const { goToDlBot } = new vm.Script('(function(){' + block + '\nreturn { goToDlBot };})()').runInContext(sandbox);
  goToDlBot(LINK);

  // شبیه‌سازی مینیمایز/مخفی‌شدن قبل از اجرای تایمرِ آخرین‌چاره
  if (opts.signal === 'visibility') { documentObj.hidden = true; fire(docL, 'visibilitychange', documentObj); }
  if (opts.signal === 'blur') fire(winL, 'blur');
  if (opts.signal === 'deactivated') fire(tgL, 'deactivated');

  // اجرای callbackهای setTimeout (بخش آخرین‌چاره)
  timers.forEach((fn) => fn());
  return calls;
}

/* حالت الف) مینیمایز موفق (سیگنال visibilitychange): کاربر به ربات دریافت
   می‌رود و مینی‌اپ مینیمایز می‌شود — نباید بسته شود. */
const vis = runScenario({ signal: 'visibility' });
assert.deepEqual(vis.openTelegramLink, [LINK], 'باید به چت ربات دریافت هدایت کند');
assert.equal(vis.close, 0, 'با مینیمایزِ موفق نباید مینی‌اپ بسته شود');
assert.equal(vis.closeModal, 1, 'هر مودال بازی باید بسته شود');
assert.equal(vis.assign.length, 0, 'وقتی مینیمایز شد نباید ناوبری خام انجام شود');

/* سیگنال‌های دیگرِ مخفی‌شدن هم باید جلوی بسته‌شدن را بگیرند. */
assert.equal(runScenario({ signal: 'blur' }).close, 0, 'blur هم یعنی مینیمایز شد');
assert.equal(runScenario({ signal: 'deactivated' }).close, 0, 'رویداد deactivated هم یعنی مینیمایز شد');
assert.equal(runScenario({ isActive: false }).close, 0, 'isActive=false یعنی از پیش مینیمایز است');

/* حالت ب) کاربر از پیش در همان چت است: openTelegramLink بی‌اثر، هیچ
   سیگنالی نمی‌آید → آخرین چاره close(). */
const stuck = runScenario({});
assert.deepEqual(stuck.openTelegramLink, [LINK], 'باز هم باید openTelegramLink را امتحان کند');
assert.equal(stuck.close, 1, 'در حالتِ گیرکرده باید به‌عنوان آخرین چاره بسته شود');

/* حالت ج) اصلاً TG نیست: ناوبری مستقیم در همان تب. */
const noTg = runScenario({ noTg: true });
assert.deepEqual(noTg.assign, [LINK], 'بدون TG باید ناوبری مستقیم انجام شود');
assert.equal(noTg.openTelegramLink.length, 0);

console.log('PASS: download feedback (mini-app minimizes and routes to delivery bot; closes only as a last resort in the already-in-chat case).');
