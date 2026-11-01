/* تنظیمات ظاهر زیرنویس (مثل پلیرهای حرفه‌ای) — بدون مرورگر:
   فونت، اندازه، رنگ، حاشیه/سایه، شفافیت پس‌زمینه، جای عمودی و فاصلهٔ خطوط.

   مسیر واقعی: پنل «تنظیمات پخش» → دکمهٔ data-cc → ccSet → localStorage
   (`mvx_cc`) → applyCc → CSS variable روی ریشهٔ .mvp → `.mvp-sub`.

   اگر این تست سبز باشد: مدیر/کاربر بدون دست‌زدن به کد می‌تواند ظاهر زیرنویس را
   برای هر سلیقه‌ای عوض کند و تنظیمش بین فیلم‌ها و بعد از رفرش می‌ماند. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE };`).toString('base64'));

const store = new Map();
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', children: [],
    style: {
      _v: new Map(),
      setProperty(k, v) { this._v.set(k, v); },
      getPropertyValue(k) { return this._v.has(k) ? this._v.get(k) : ''; },
      removeProperty(k) { this._v.delete(k); }
    },
    classList: {
      list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; },
      contains(c) { return this.list.has(c); }
    },
    setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k] === undefined ? null : el[k]; },
    hasAttribute(k) { return el[k] !== undefined && el[k] !== null && el[k] !== ''; },
    removeAttribute(k) { el[k] = undefined; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    addEventListener(e, f) { (el._ev = el._ev || {})[e] = (el._ev[e] || []).concat(f); },
    removeEventListener() { }, contains() { return false; }, focus() { },
    querySelector(s) { const m = el._kids || (el._kids = new Map()); if (!m.has(s)) m.set(s, fakeEl(s)); return m.get(s); },
    querySelectorAll() { return []; }
  };
  return el;
}
const doc = {
  createElement: (t) => { const e = fakeEl('<' + t + '>'); e.tagName = String(t).toUpperCase(); return e; },
  querySelector: (s) => fakeEl(s), querySelectorAll: () => [],
  addEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
  documentElement: fakeEl('html'), fullscreenElement: null
};
const win = {
  console: { warn() { }, log() { } },
  document: doc, MediaSource: undefined,
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, v); },
    removeItem(k) { store.delete(k); }
  },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { }
};
win.window = win;
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() { } };

W.MVX_PLAYER_MODULE(win);
const api = win.MvxPlayer;

const video = fakeEl('video');
video.play = () => Promise.resolve(); video.pause = () => { }; video.currentTime = 0;
video.paused = true; video.duration = 100; video.volume = 1; video.muted = false;
video.buffered = { length: 0, start() { return 0; }, end() { return 0; } };
video.canPlayType = () => '';
const root = fakeEl('root');
const P = {
  video, root, closed: false, panel: '', subs: [{ id: 't_1', label: 'فارسی', lang: 'fa', src: '/sv/t/x' }],
  subOn: 't_1', cues: [], subOffset: 0, opts: {}, cur: { track: 'sub' }, sid: 's',
  info: { src: '/sv/v/TOK', fmt: 'mp4', cur: { track: 'sub' }, options: { sub: [], dub: [] } }
};
api._engine.bind(P);

const css = (name) => root.style.getPropertyValue(name);

/* ── ۱. مقادیر پیش‌فرض ── */
const def = api._engine.ccPrefs();
assert.equal(def.size, 'm', 'اندازهٔ پیش‌فرض متوسط');
assert.equal(def.edge, 'shadow', 'حاشیهٔ پیش‌فرض سایه');
assert.equal(Number(def.bg), 62, 'پس‌زمینهٔ پیش‌فرض ۶۲٪');
assert.equal(def.pos, 'bottom', 'جای پیش‌فرض پایین');
assert.equal(def.lh, 'normal', 'فاصلهٔ خطوط پیش‌فرض عادی');
assert.equal(def.font, 'system');

/* ── ۲. اعمال روی CSS variableها ── */
api._engine.ccApply();
assert.equal(css('--cc-fs'), '20px', 'اندازهٔ متوسط = ۲۰px');
assert.ok(css('--cc-lh') === '1.55', 'line-height = 1.55');
assert.ok(css('--cc-bg').indexOf('rgba(0,0,0,') === 0, 'پس‌زمینه نیمه‌شفاف: ' + css('--cc-bg'));
assert.equal(css('--cc-c'), '#ffffff');
assert.ok(css('--cc-edge').indexOf('0 0 6px #000') > 0, 'سایهٔ متن');
assert.equal(css('--cc-bot'), '9%', 'فاصله از پایین');
assert.ok(root.classList.contains('sub-nobg') === false, 'کلاس پس‌زمینه فعال است');

/* ── ۳. اندازه‌ها ── */
for (const [k, px] of [['s', '16px'], ['l', '27px'], ['xl', '34px'], ['m', '20px']]) {
  api._engine.ccSet('size', k);
  assert.equal(css('--cc-fs'), px, 'اندازهٔ ' + k + ' = ' + px);
}
assert.equal(JSON.parse(store.get('mvx_cc')).size, 'm', 'اندازه در localStorage ذخیره شد');

/* ── ۴. فونت ── */
api._engine.ccSet('font', 'tahoma');
assert.ok(css('--cc-ff').indexOf('Tahoma') === 0, 'فونت تاهوما اعمال شد: ' + css('--cc-ff'));
api._engine.ccSet('font', 'naskh');
assert.ok(css('--cc-ff').indexOf('Noto Naskh Arabic') > 0, 'فونت نسخ');

/* ── ۵. رنگ ── */
api._engine.ccSet('color', '#ffe066');
assert.equal(css('--cc-c'), '#ffe066', 'رنگ زرد');
assert.equal(JSON.parse(store.get('mvx_cc')).color, '#ffe066');

/* ── ۶. حاشیه/خوانایی ── */
api._engine.ccSet('edge', 'none');
assert.equal(css('--cc-edge'), 'none', 'بدون سایه');
api._engine.ccSet('edge', 'outline');
assert.ok(css('--cc-edge').split(',').length > 4, 'خط دور = چند سایهٔ جهتی');
api._engine.ccSet('edge', 'glow');

/* ── ۷. پس‌زمینه: صفر = بدون کادر و کلاس sub-nobg ── */
api._engine.ccSet('bg', 0);
assert.equal(css('--cc-bg'), 'transparent', 'پس‌زمینه صفر = شفاف');
assert.ok(root.classList.contains('sub-nobg'), 'کلاس sub-nobg برای سازگاری');
api._engine.ccSet('bg', 85);
assert.ok(css('--cc-bg').indexOf('0.85') > 0, 'پس‌زمینه ۸۵٪: ' + css('--cc-bg'));
assert.ok(!root.classList.contains('sub-nobg'));

/* ── ۸. جای زیرنویس ── */
api._engine.ccSet('pos', 'top');
assert.equal(css('--cc-bot'), '78%', 'زیرنویس بالای تصویر');
api._engine.ccSet('pos', 'mid');
assert.equal(css('--cc-bot'), '26%');

/* ── ۹. فاصلهٔ خطوط ── */
api._engine.ccSet('lh', 'loose');
assert.equal(css('--cc-lh'), '1.95');
api._engine.ccSet('lh', 'tight');
assert.equal(css('--cc-lh'), '1.25');

/* ── ۱۰. مقدار نامعتبر نباید ذخیره شود (به پیش‌فرض برمی‌گردد) ── */
const bad = api._engine.ccSet('size', 'huge');
assert.equal(bad.size, 'm', 'اندازهٔ نامعتبر رد شد');
assert.equal(css('--cc-fs'), '20px', 'CSS با مقدار معتبر ماند');
assert.equal(api._engine.ccSet('whatever', 'x') && api._engine.ccPrefs().whatever, undefined, 'کلید ناشناخته ذخیره نمی‌شود');

/* ── ۱۱. پنل تنظیمات، همهٔ کنترل‌ها را دارد ── */
api._engine.ccSet('size', 'l');
api._engine.ccSet('color', '#7ee7ff');
P.panel = 'set';
api._engine.panel('set');
const panel = root.querySelector('[data-p="set"]').innerHTML;
for (const needle of ['data-cc="size" data-ccv="l"', 'data-cc="font" data-ccv="system"', 'data-cc="color" data-ccv="#7ee7ff"',
  'data-cc="edge" data-ccv="shadow"', 'data-cc="bg" data-ccv="35"', 'data-cc="pos" data-ccv="bottom"',
  'data-cc="lh" data-ccv="normal"', 'اندازه', 'فونت', 'رنگ متن', 'حاشیه و خوانایی', 'پس‌زمینه', 'جای زیرنویس', 'فاصلهٔ خطوط']) {
  assert.ok(panel.indexOf(needle) > 0, 'کنترل «' + needle + '» در پنل هست');
}
assert.ok(/class="mvp-opt on" data-cc="size" data-ccv="l"/.test(panel), 'گزینهٔ فعال اندازه مشخص است');
assert.ok(/class="mvp-opt sw on" data-cc="color"/.test(panel), 'رنگ فعال مشخص است');
assert.ok(panel.indexOf('data-off="-0.5"') > 0, 'هم‌زمانی زیرنویس هم مانده است');

/* ── ۱۲. ماندگاری: پس از «رفرش» همان تنظیمات برمی‌گردد ── */
const saved = JSON.parse(store.get('mvx_cc'));
assert.equal(saved.size, 'l');
assert.equal(saved.color, '#7ee7ff');
const fresh = api._engine.ccPrefs();
assert.equal(fresh.size, 'l', 'تنظیم در نشست بعدی هم هست');
assert.equal(fresh.color, '#7ee7ff');

/* ── ۱۳. مهاجرت از تنظیمات قدیمی (کلاس sub-xl و sub-nobg) ── */
store.delete('mvx_cc');
store.set('mvx_subsize', JSON.stringify('xl'));
store.set('mvx_subbg', JSON.stringify(false));
const mig = api._engine.ccPrefs();
assert.equal(mig.size, 'xl', 'اندازهٔ قبلی حفظ شد');
assert.equal(Number(mig.bg), 0, 'پس‌زمینهٔ خاموش قبلی حفظ شد');

console.log('PASS: تنظیمات ظاهر زیرنویس — اندازه/فونت/رنگ/حاشیه/پس‌زمینه/جا/فاصلهٔ خطوط با data-cc، ذخیره در mvx_cc، مهاجرت از تنظیمات قدیمی، و بازگشت مقدار نامعتبر به پیش‌فرض.');
