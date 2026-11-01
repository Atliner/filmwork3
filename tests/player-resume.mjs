/* سمت پلیر برای «ادامهٔ تماشا»: نوشتن mvx_resume در حین پخش.

   قرارداد بین پلیر و صفحهٔ خانه:
     localStorage['mvx_resume'] = [{id, ep, title, poster, type, t, d, epT, at}, …]
   آخرین‌ها اول، حداکثر ۲۴ مورد. فایل تمام‌شده حذف می‌شود. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE };`).toString('base64'));

const store = new Map();
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', children: [], className: '',
    style: { _v: new Map(), setProperty(k, v) { this._v.set(k, v); }, getPropertyValue(k) { return this._v.get(k) || ''; } },
    classList: {
      list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; },
      contains(c) { return this.list.contains ? false : this.list.has(c); }
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
  console: { warn() { }, log() { } }, document: doc, MediaSource: undefined,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { }
};
win.window = win;
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() { } };

W.MVX_PLAYER_MODULE(win);
const api = win.MvxPlayer;

const video = fakeEl('video');
video.duration = 6000; video.currentTime = 1200; video.paused = false; video.volume = 1;
video.play = () => Promise.resolve(); video.pause = () => { };
video.buffered = { length: 0, start() { return 0; }, end() { return 0; } };

function makePlayer(over) {
  const P = Object.assign({
    video, root: fakeEl('root'), closed: false, panel: '', subs: [], subOn: '', cues: [], opts: { itemId: 'i_abc123', epId: '' },
    adActive: false, info: { src: '/sv/v/T', fmt: 'mp4', item: { id: 'i_abc123', title: 'فیلم تست', poster: '/img/p', type: 'movie' } }
  }, over || {});
  api._engine.bind(P);
  return P;
}
const resume = () => JSON.parse(store.get('mvx_resume') || '[]');

/* ── ۱. ذخیرهٔ نیمهٔ فیلم ── */
makePlayer();
api._engine.savePos(true);
let list = resume();
assert.equal(list.length, 1, 'یک رکورد ثبت شد');
assert.equal(list[0].id, 'i_abc123');
assert.equal(list[0].ep, '', 'فیلم → بدون شناسهٔ قسمت');
assert.equal(list[0].title, 'فیلم تست');
assert.equal(list[0].poster, '/img/p');
assert.equal(list[0].t, 1200);
assert.equal(list[0].d, 6000);
assert.equal(list[0].epT, '');
assert.ok(list[0].at > 0, 'زمان ثبت');
assert.equal(JSON.parse(store.get('mvx_pos:i_abc123:')).t, 1200, 'موقعیت دقیق پلیر هم ذخیره شد');

/* ── ۲. ذخیرهٔ دوباره: رکورد تکراری ساخته نمی‌شود، به‌روز می‌شود ── */
video.currentTime = 1800;
api._engine.savePos(true);
list = resume();
assert.equal(list.length, 1, 'همان رکورد به‌روز شد');
assert.equal(list[0].t, 1800);

/* ── ۳. سریال: شناسهٔ قسمت و برچسب فصل/قسمت ── */
makePlayer({
  opts: { itemId: 'i_abc123', epId: 'e_77' },
  info: { src: '/sv/v/T2', fmt: 'mp4', item: { id: 'i_abc123', title: 'سریال تست', poster: '/img/s', type: 'series' }, ep: { cur: { id: 'e_77', season: 2, n: 5 } } }
});
video.currentTime = 500;
api._engine.savePos(true);
list = resume();
assert.equal(list.length, 2, 'قسمت جدید رکورد جدا دارد');
assert.equal(list[0].ep, 'e_77', 'تازه‌ترین اول');
assert.equal(list[0].epT, 'فصل 2 · قسمت 5');
assert.equal(JSON.parse(store.get('mvx_pos:i_abc123:e_77')).t, 500, 'موقعیت همان قسمت');

/* ── ۴. فایل خیلی کوتاه (< ۶۰ ثانیه) ذخیره نمی‌شود ── */
makePlayer({ info: { src: '/sv/v/T3', fmt: 'mp4', item: { id: 'i_short', title: 'کوتاه', type: 'movie' } } });
video.duration = 40; video.currentTime = 10;
api._engine.savePos(true);
assert.equal(resume().length, 2, 'ویدیوی کوتاه اضافه نشد');

/* ── ۵. نزدیک پایان: رکورد و موقعیت حذف می‌شوند ── */
video.duration = 6000; video.currentTime = 5960;
makePlayer({ opts: { itemId: 'i_abc123', epId: 'e_77' }, info: { src: '/sv/v/T2', fmt: 'mp4', item: { id: 'i_abc123', title: 'سریال تست', type: 'series' }, ep: { cur: { id: 'e_77', season: 2, n: 5 } } } });
api._engine.savePos(true);
list = resume();
assert.equal(list.filter((x) => x.ep === 'e_77').length, 0, 'قسمت تمام‌شده از فهرست حذف شد');
assert.equal(store.get('mvx_pos:i_abc123:e_77'), undefined, 'موقعیت پلیر هم پاک شد');
assert.equal(list.length, 1, 'فیلم نیمه‌تمام مانده');

/* ── ۶. سقف ۲۴ رکورد ── */
for (let i = 0; i < 40; i++) {
  makePlayer({ opts: { itemId: 'i_' + String(i).padStart(6, '0'), epId: '' }, info: { src: '/sv/v/x', fmt: 'mp4', item: { id: 'i_' + String(i).padStart(6, '0'), title: 'تست ' + i, type: 'movie' } } });
  video.duration = 6000; video.currentTime = 600;
  api._engine.savePos(true);
}
assert.equal(resume().length, 24, 'حداکثر ۲۴ مورد نگه داشته می‌شود');
assert.equal(resume()[0].id, 'i_000039', 'آخرین تماشا اول فهرست');

/* ── ۷. تبلیغ فعال: چیزی ثبت نمی‌شود ── */
const before = resume().length;
makePlayer({ adActive: true, opts: { itemId: 'i_ad', epId: '' } });
api._engine.savePos(true);
assert.equal(resume().length, before, 'حین تبلیغ موقعیت ذخیره نمی‌شود');

console.log('PASS: پلیر موقعیت تماشا را در mvx_resume (و mvx_pos) ثبت می‌کند — فصل/قسمت، حذف فایل تمام‌شده، سقف ۲۴ مورد و نادیده‌گرفتن تبلیغ.');
