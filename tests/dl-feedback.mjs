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

/* ── ۲) رفتار goToDlBot: مینی‌اپ بسته می‌شود و کاربر به ربات دریافت
   هدایت می‌شود؛ نه مودال ماندگار ── */
const fnStart = source.indexOf('function goToDlBot (botLink) {');
const fnEnd = source.indexOf('function requestDownload (itemId, opts, btn) {');
assert.ok(fnStart > 0 && fnEnd > fnStart, 'goToDlBot not found');
const block = source.slice(fnStart, fnEnd);

const LINK = 'https://t.me/FileBot?start=dl_x1';

function runScenario(makeTg) {
  const calls = { openTelegramLink: [], close: 0, assign: [], toast: [], haptic: [], closeModal: 0 };
  const pending = [];
  const sandbox = {
    toast: (m, t) => { calls.toast.push([m, t]); },
    haptic: (t) => { calls.haptic.push(t); },
    closeModal: () => { calls.closeModal += 1; },
    setTimeout: (fn) => { pending.push(fn); },
    location: { assign: (u) => { calls.assign.push(u); } },
    TG: makeTg(calls),
  };
  vm.createContext(sandbox);
  const { goToDlBot } = new vm.Script('(function(){' + block + '\nreturn { goToDlBot };})()').runInContext(sandbox);
  goToDlBot(LINK);
  // اجرای callbackهای setTimeout (بخش بستن مینی‌اپ)
  pending.forEach((fn) => fn());
  return calls;
}

/* حالت الف) کاربر جای دیگری است / SDK کامل تلگرام: به ربات دریافت هدایت
   می‌شود و مینی‌اپ هم صراحتاً بسته می‌شود. */
const full = runScenario((calls) => ({
  openTelegramLink: (u) => { calls.openTelegramLink.push(u); },
  close: () => { calls.close += 1; },
}));
assert.deepEqual(full.openTelegramLink, [LINK], 'باید به چت ربات دریافت هدایت کند');
assert.equal(full.close, 1, 'مینی‌اپ باید صراحتاً بسته شود (حتی اگر کاربر از پیش در چت ربات باشد)');
assert.equal(full.closeModal, 1, 'هر مودال بازی باید بسته شود');
assert.equal(full.assign.length, 0, 'وقتی close موجود است نباید ناوبری خام همان‌تب انجام شود');

/* حالت ب) shim سبک (بدون close واقعی): openTelegramLink خودش ناوبری
   می‌کند؛ اگر close نبود، به ناوبری مستقیم برمی‌گردیم. */
const noClose = runScenario((calls) => ({
  openTelegramLink: (u) => { calls.openTelegramLink.push(u); },
}));
assert.deepEqual(noClose.openTelegramLink, [LINK], 'shim هم باید openTelegramLink را صدا بزند');
assert.deepEqual(noClose.assign, [LINK], 'بدون close باید به ناوبری مستقیم برگردد');

/* حالت ج) اصلاً TG نیست: ناوبری مستقیم در همان تب. */
const noTg = runScenario(() => null);
assert.deepEqual(noTg.assign, [LINK], 'بدون TG باید ناوبری مستقیم انجام شود');
assert.equal(noTg.openTelegramLink.length, 0);

console.log('PASS: download feedback (mini-app closes itself and routes the user to the delivery bot, covering the already-in-chat case).');
