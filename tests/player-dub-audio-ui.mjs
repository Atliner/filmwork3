/* دوبلهٔ صوتی جدا در پلیر — بدون مرورگر، ولی با همان مسیر واقعی:
   `/api/stream/open` → `info.audios` → setupAudios → <audio class="mvp-a">
   → بی‌صدا شدن <video> → همگام‌سازی زمان/سرعت/جهش → برگشت به صدای اصلی.

   اگر این تست سبز باشد، خواستهٔ «فایل صوتی دوبلهٔ جدا مثل زیرنویس قابل انتخاب
   باشد» برآورده شده است:
     ۱) مدیر لینک صدا را می‌دهد (`f.dubs` → `audios` در پاسخ open)،
     ۲) پلیر آن را در پنل «صدا و زیرنویس» نشان می‌دهد (`data-extaud`)،
     ۳) با انتخابش تصویر بی‌صدا و صدا از همان فایل پخش می‌شود و هم‌زمان می‌ماند. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE };`).toString('base64'));

/* ── محیط جعلی مرورگر ── */
const logs = [];
const timers = [];
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', style: {}, children: [], src: '', volume: 1,
    muted: false, paused: true, playbackRate: 1, currentTime: 0, readyState: 4, ended: false,
    classList: {
      list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; },
      contains(c) { return this.list.has(c); }
    },
    setAttribute(k, v) { el[k] = v; if (k === 'src') el.src = v; },
    getAttribute(k) { return el[k] === undefined ? null : el[k]; },
    hasAttribute(k) { return el[k] !== undefined && el[k] !== null && el[k] !== ''; },
    removeAttribute(k) { if (k === 'src') { el.src = ''; el._srcRemoved = true; } el[k] = undefined; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener(e, f) { (el._ev = el._ev || {})[e] = (el._ev[e] || []).concat(f); },
    removeEventListener() { }, contains() { return false; }, focus() { },
    querySelector(s) { const m = el._kids || (el._kids = new Map()); if (!m.has(s)) m.set(s, fakeEl(s)); return m.get(s); },
    querySelectorAll() { return []; }
  };
  return el;
}
const doc = {
  createElement: (tag) => {
    const e = fakeEl('<' + tag + '>');
    e.tagName = String(tag).toUpperCase();
    if (e.tagName === 'TRACK') e.track = { mode: 'disabled' };
    return e;
  },
  querySelector: (s) => fakeEl(s), querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
  documentElement: fakeEl('html'), fullscreenElement: null
};
const win = {
  console: { warn: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) },
  document: doc, MediaSource: undefined,
  localStorage: { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); }, removeItem(k) { this.m.delete(k); } },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
  setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => { },
  setInterval: () => 0, clearInterval: () => { }
};
win.window = win;
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() { } };

W.MVX_PLAYER_MODULE(win);
const api = win.MvxPlayer;

/* عناصر واقعی پلیر */
const video = fakeEl('video');
video.systemMute = false;
video.play = () => { video.paused = false; return Promise.resolve(); };
video.pause = () => { video.paused = true; };

const audio = fakeEl('audio');
let audioLoads = 0;
audio.load = () => { audioLoads++; };
audio.play = () => { audio.paused = false; return Promise.resolve(); };
audio.pause = () => { audio.paused = true; };

const SUB = fakeEl('.mvp-sub');
const root = fakeEl('root');
root._kids = new Map([['.mvp-sub', SUB], ['.mvp-a', audio]]);

const AUD = [
  { id: 'fa_1', label: 'دوبله فارسی', lang: 'fa', src: '/sv/v/DUB1' },
  { id: 'fa_2', label: 'دوبله دوم', lang: 'fa', src: '/sv/v/DUB2' }
];
const P = {
  video, root, closed: false, panel: '', subOn: '', cues: [], opts: {}, sid: 's', host: {},
  cur: { track: 'dub' },
  audios: [], audioOn: '', audioPref: '', audioOffset: 0, audioReady: false, audioSrc: '', userMuted: false,
  info: { src: '/sv/v/TOK', fmt: 'mkv', demux: true, cur: { track: 'dub' }, audios: AUD, audioDefault: 'fa_1' }
};
api._engine.bind(P);

const flush = async (n) => { for (let i = 0; i < (n || 20); i++) await new Promise((r) => setImmediate(r)); };

/* ── ۱. فهرست صداهای دوبله از پاسخ /api/stream/open ── */
api._engine.setupAudios(P.info);
await flush();
let st = api._engine.audioState();
assert.equal(st.list.length, 2, 'دو فایل صدای دوبله از سرور');
assert.equal(st.on, 'fa_1', 'audioDefault انتخاب شد (نسخهٔ دوبله → دوبلهٔ فارسی)');
assert.equal(P.audioPref, 'دوبله فارسی', 'عنوان صدا برای حفظ ترجیح بین کیفیت‌ها ذخیره شد');
assert.equal(video.muted, true, 'تصویر بی‌صدا شد تا صدا از فایل دوبله بیاید');
assert.equal(audio.src, '/sv/v/DUB1', 'منبع <audio> همان فایل دوبله است');

/* ── ۲. آماده‌شدن فایل صوتی و همگام‌سازی اولیه ── */
assert.equal(P.audioReady, false, 'تا canplay، صدا آماده نیست');
video.currentTime = 42.4;
audio.oncanplay();
await flush();
st = api._engine.audioState();
assert.equal(st.ready, true, 'canplay → آماده');
assert.equal(audio.currentTime, 42.4, 'صدا با تصویر هم‌زمان شد');

/* انحراف کوچک (< ۰٫۳۵ ثانیه) نباید پرش ایجاد کند */
audio.currentTime = 42.6;
assert.equal(api._engine.audioSync(false), undefined);
assert.equal(audio.currentTime, 42.6, 'انحراف ۰٫۲ ثانیه اصلاح نمی‌شود (بدون تیک)');

/* انحراف بزرگ باید فوراً اصلاح شود */
audio.currentTime = 30;
api._engine.audioSync(false);
assert.equal(audio.currentTime, 42.4, 'انحراف ۱۲ ثانیه اصلاح شد');

/* ── ۳. تنظیم تأخیر ±۰٫۵ ثانیه (اگر نسخهٔ صدا کمی جلو/عقب باشد) ── */
P.audioOffset = -0.5;
api._engine.audioSync(true);
assert.equal(audio.currentTime, 41.9, 'تأخیر −۰٫۵ ثانیه اعمال شد');
P.audioOffset = 0;
api._engine.audioSync(true);
assert.equal(audio.currentTime, 42.4, 'هم‌زمان شد');

/* ── ۴. تعویض به صدای دیگر و حفظ عنوان در کیفیت بعدی ── */
api._engine.selectAudio('fa_2', true);
await flush();
assert.equal(P.audioOn, 'fa_2');
assert.equal(audio.src, '/sv/v/DUB2', 'فایل صدای دوم بارگذاری شد');
const loadsAfter2 = audioLoads;
audio.oncanplay();
await flush();
assert.equal(audioLoads, loadsAfter2, 'صدا با canplay دوباره load نمی‌شود');

/* کیفیت دیگر: همان عنوان در فهرست تازه → همان صدا دوباره انتخاب می‌شود */
api._engine.setupAudios({ audios: [
  { id: 'fa_7', label: 'دوبله دوم', lang: 'fa', src: '/sv/v/DUB2b' },
  { id: 'fa_8', label: 'دوبله فارسی', lang: 'fa', src: '/sv/v/DUB1b' }
] });
await flush();
assert.equal(P.audioOn, 'fa_7', 'ترجیح کاربر با عنوان صدا در کیفیت تازه حفظ شد');
assert.equal(audio.src, '/sv/v/DUB2b', 'فایل صدای کیفیت تازه');

/* ── ۵. نسخهٔ بدون دوبله: صدای اصلی برمی‌گردد ── */
api._engine.setupAudios({ audios: [] });
await flush();
assert.equal(P.audioOn, '', 'نسخهٔ بدون فایل صوتی → صدای اصلی');
assert.equal(video.muted, false, 'تصویر دوباره صدا دارد');
assert.ok(audio._srcRemoved || audio.src === '', 'منبع صدا پاک شد');

/* ── ۶. خطای فایل صدا → برگشت خودکار به صدای اصلی (بدون قطع پخش) ── */
api._engine.setupAudios(P.info);
await flush();
assert.equal(P.audioOn, 'fa_1', 'دوبله دوباره فعال شد');
audio.onerror();
await flush();
assert.equal(P.audioOn, '', 'خطای بارگذاری صدا → صدای اصلی');
assert.equal(video.muted, false, 'پخش تصویر با صدا ادامه دارد');

/* ── ۷. پنل «صدا و زیرنویس» دکمهٔ انتخاب دوبله را دارد ── */
api._engine.setupAudios(P.info);
await flush();
api._engine.panel('trk');
const panel = root.querySelector('[data-p="trk"]').innerHTML;
assert.ok(panel.indexOf('data-extaud=""') > 0, 'دکمهٔ «صدای اصلی» در پنل');
assert.ok(panel.indexOf('data-extaud="fa_1"') > 0, 'دکمهٔ دوبلهٔ اول در پنل');
assert.ok(panel.indexOf('data-extaud="fa_2"') > 0, 'دکمهٔ دوبلهٔ دوم در پنل');
assert.ok(panel.indexOf('دوبله فارسی ✓') > 0, 'صدای فعال علامت ✓ دارد');
assert.ok(panel.indexOf('data-audshift="-0.5"') > 0, 'دکمهٔ تنظیم تأخیر صدا (فقط وقتی دوبله فعال است)');
assert.ok(panel.indexOf('🎙 صدا / دوبله') > 0, 'بخش «صدا / دوبله» بالای ترک‌های داخلی');
assert.ok(panel.lastIndexOf('data-extaud') < panel.indexOf('ترک صدای داخل فایل'), 'دوبلهٔ جدا پیش از ترک‌های داخل فایل می‌آید');

/* ── ۸. اگر کاربر خودش پلیر را بی‌صدا کرده، برگشت به صدای اصلی نباید صدا را برگرداند ── */
api._engine.selectAudio('fa_1', true);
await flush();
audio.oncanplay();
await flush();
assert.equal(video.muted, true, 'در دوبله تصویر بی‌صدا است');
P.userMuted = true;
api._engine.selectAudio('', true);
await flush();
assert.equal(video.muted, true, 'انتخاب کاربر (بی‌صدا) حفظ می‌شود');
P.userMuted = false;
api._engine.selectAudio('fa_1', true);
await flush();
assert.equal(video.muted, true, 'با انتخاب دوبله دوباره تصویر بی‌صدا می‌شود');
assert.equal(P.audioOn, 'fa_1');

console.log('PASS: دوبلهٔ صوتی جدا در پلیر — فهرست صدا از Worker، <audio class="mvp-a"> با تصویر بی‌صدا، هم‌زمان‌سازی (تأخیر ±۰٫۵ ثانیه)، تعویض کیفیت با حفظ ترجیح، و برگشت خودکار به صدای اصلی هنگام نبود/خطای فایل.');
