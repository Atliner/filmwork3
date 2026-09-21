import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

/* ── ۱) اتصال مسیرها: requestDownload باید در هر دو حالت (مستقیم + پس از
   تبلیغ) showDlBot را صدا بزند، نه openBot خام ── */
const reqStart = source.indexOf('function requestDownload (itemId, opts, btn) {');
const reqEnd = source.indexOf('function bindQualityClicks', reqStart);
assert.ok(reqStart > 0 && reqEnd > reqStart, 'requestDownload not found');
const reqBody = source.slice(reqStart, reqEnd);
assert.ok(reqBody.includes('showDlBot(g.botLink, g)'), 'مسیر تبلیغ باید showDlBot داشته باشد');
assert.ok(reqBody.includes('showDlBot(r.botLink, r)'), 'مسیر مستقیم باید showDlBot داشته باشد');
assert.ok(!/openBot\(r\.botLink\)/.test(reqBody), 'openBot خام نباید مستقیم در requestDownload باشد');
assert.ok(!/openBot\(g\.botLink\)/.test(reqBody), 'openBot خام نباید در مسیر تبلیغ باشد');

/* ── ۲) رفتار showDlBot: مودال + خودکار-باز کردن چت + دکمه‌ها ── */
const fnStart = source.indexOf('function showDlBot (botLink, r) {');
const fnEnd = source.indexOf('function requestDownload (itemId, opts, btn) {');
assert.ok(fnStart > 0 && fnEnd > fnStart, 'showDlBot not found');
const block = source.slice(fnStart, fnEnd);

const LINK = 'https://t.me/FileBot?start=dl_x1';
const calls = { openBot: [], modal: null, toast: [], copied: [] };
const handlers = {};
const sandbox = {
  esc,
  openModal: (title, html, onOpen) => { calls.modal = { title, html, onOpen }; return function () { }; },
  openBot: url => { calls.openBot.push(url); },
  copyText: (t, cb) => { calls.copied.push(t); if (cb) cb(); },
  toast: (m, t) => { calls.toast.push([m, t]); },
  $: (sel, r) => ({ addEventListener: (ev, fn) => { (handlers[sel] = handlers[sel] || {})[ev] = fn; } }),
  setTimeout: (fn, ms) => { globalThis.setTimeout(fn, Math.min(ms, 5)); },
};
vm.createContext(sandbox);
const { showDlBot } = new vm.Script('(function(){' + block + '\nreturn { showDlBot };})()').runInContext(sandbox);

showDlBot(LINK, {});

// مودال با متن راهنما باز شده
assert.equal(calls.modal.title, 'فایل شما در راه است');
assert.ok(calls.modal.html.includes(LINK), 'لینک باید داخل مودال باشد');
assert.ok(calls.modal.html.includes('dlbot-open') && calls.modal.html.includes('dlbot-copy'), 'دکمه‌های باز کردن/کپی');
assert.ok(calls.modal.html.includes('ربات دریافت'), 'نام ربات دریافت');
assert.ok(/۱۰ دقیقه/.test(calls.modal.html), 'اخبار اعتبار ۱۰ دقیقه‌ای');
assert.ok(calls.modal.html.includes('بالای چت'), 'راهنما برای کاربری که از پیش در چت ربات است');

// دکمه‌ها وصل می‌شوند
calls.modal.onOpen({}, () => { });
assert.equal(typeof handlers['#dlbot-open'].click, 'function');
assert.equal(typeof handlers['#dlbot-copy'].click, 'function');

// باز کردن دستی چت
handlers['#dlbot-open'].click();
assert.deepEqual(calls.openBot, [LINK], 'باز کردن دستی باید همان لینک را بفرستد');

// کپی لینک
handlers['#dlbot-copy'].click();
assert.deepEqual(calls.copied, [LINK]);
assert.ok(calls.toast.some(t => t[0].includes('کپی')));

/* خودکار-باز کردن: ~۳۰۰ms بعد از نمایش مودال، openBot صدا زده می‌شود
   تا در حالت اول (کاربر در چت ربات نیست) چت همان لحظه باز شود و
   مینی‌اپ جمع شود — رفتار قبلی حفظ می‌شود. */
await new Promise(r => setTimeout(r, 60));
assert.deepEqual(calls.openBot, [LINK, LINK], 'باید یک بار خودکار هم چت ربات دریافت را باز کند');

console.log('PASS: download feedback (persistent mini-app modal + auto-open delivery bot; user sees status even when already in the bot chat).');
