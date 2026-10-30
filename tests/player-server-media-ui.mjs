/* پلیر + پردازش رسانهٔ سروری — بدون مرورگر، ولی با همان مسیر واقعی:
   پاسخ `/api/stream/open` → آدرس‌های media → گرفتن فهرست ترک‌ها → تزریق
   <track kind="subtitles"> در <video> → روشن/خاموش کردن زیرنویس بومی →
   انتخاب نردبان «remux سرور» برای MKV → آدرس remux با audio/start برای جهش.

   اگر این تست سبز باشد، همان دو خواستهٔ اصلی برآورده شده است:
     ۱) Worker فهرست ترک‌ها و زیرنویس WebVTT را می‌دهد و پلیر آن را مصرف می‌کند،
     ۲) برای هر زیرنویس داخلی یک <track> واقعی در ویدئو تزریق می‌شود که
        کاربر بتواند از منوی خود پلیر روشن/خاموشش کند. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE };`).toString('base64'));

/* ── محیط جعلی مرورگر ── */
const logs = [];
const timers = [];
const fetched = [];
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', style: {}, children: [],
    classList: {
      list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; },
      contains(c) { return this.list.has(c); }
    },
    setAttribute(k, v) { el[k] = v; }, getAttribute() { return null; }, removeAttribute() { },
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
    /* مثل مرورگر: HTMLTrackElement یک شیء track با حالت اولیهٔ disabled دارد */
    if (e.tagName === 'TRACK') e.track = { mode: 'disabled' };
    return e;
  },
  querySelector: (s) => fakeEl(s), querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
  documentElement: fakeEl('html'), fullscreenElement: null
};

/* پاسخ Worker: همان چیزی که `/api/stream/tracks` واقعی می‌دهد */
const SJ = '/api/stream/sub?t=TOK&track=';
const TRACKS = {
  ok: true, container: 'mkv', duration: 120,
  tracks: {
    video: [{ no: 1, codec: 'V_MPEG4/ISO/AVC', width: 1920, height: 1080, label: 'ویدئو' }],
    audio: [
      { no: 2, codec: 'A_AAC', lang: 'en', srclang: 'en', label: 'اصلی - [انگلیسی]', ok: true },
      { no: 3, codec: 'A_AAC', lang: 'fa', srclang: 'fa', label: 'دوبله فارسی', ok: true }
    ],
    subs: [
      { no: 4, codec: 'S_TEXT/UTF8', fmt: 'srt', lang: 'fa', srclang: 'fa', label: 'زیرنویس فارسی', supported: true, src: SJ + '4' },
      { no: 5, codec: 'S_HDMV/PGS', fmt: 'bitmap', lang: 'en', srclang: 'en', label: 'PGS', supported: false, src: SJ + '5' }
    ]
  },
  remux: { ok: true, src: '/api/stream/remux?t=TOK', audio: [2, 3] }
};
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nسلام دنیا\n';
const win = {
  console: { warn: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) },
  document: doc, MediaSource: undefined,
  localStorage: { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); }, removeItem(k) { this.m.delete(k); } },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
  fetch: async (url) => {
    url = String(url);
    fetched.push(url);
    if (url.indexOf('/api/stream/tracks') === 0) {
      return { ok: true, status: 200, json: async () => TRACKS, text: async () => JSON.stringify(TRACKS) };
    }
    if (url.indexOf('/api/stream/sub') === 0) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => VTT };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  },
  setTimeout: (f, ms) => { timers.push(f); return timers.length; }, clearTimeout: () => { },
  setInterval: () => 0, clearInterval: () => { }
};
win.window = win;
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() { } };

W.MVX_PLAYER_MODULE(win);
const api = win.MvxPlayer;
const video = fakeEl('video');
video.currentTime = 0; video.paused = true; video.duration = 120; video.muted = false; video.volume = 1;
video.readyState = 4; video.error = null; video.src = ''; video.playbackRate = 1;
video.buffered = { length: 0, start() { return 0; }, end() { return 0; } };
video.load = () => { }; video.play = () => Promise.resolve(); video.pause = () => { }; video.canPlayType = () => '';

const SUB = fakeEl('.mvp-sub');
const root = fakeEl('root');
root._kids = new Map([['.mvp-sub', SUB]]);

/* همان آبجکتی که setSource می‌سازد */
const P = {
  video: video, root: root, closed: false, panel: '', subOn: '', cues: [], cueIdx: 0, opts: {}, sid: 's', host: {},
  cur: { track: 'dub' }, subs: [{ id: 't_1', label: 'زیرنویس دستی', lang: 'fa', src: '/sv/t/tt' }],
  info: {
    src: '/sv/v/TOK', direct: '', fmt: 'mkv', demux: true, cur: { track: 'dub' },
    media: { tracks: '/api/stream/tracks?t=TOK', sub: SJ, remux: '/api/stream/remux?t=TOK' },
    subs: [{ id: 't_1', label: 'زیرنویس دستی', lang: 'fa', src: '/sv/t/tt' }]
  }
};
api._engine.bind(P);

const flush = async (n) => { for (let i = 0; i < (n || 30); i++) { await new Promise((r) => setImmediate(r)); timers.splice(0).forEach((f) => { try { f(); } catch (e) { } }); } };

/* ── ۱. فهرست ترک‌ها از Worker ── */
assert.ok(api._engine.srvTracks, 'srvTracks در دسترس است');
const p = api._engine.srvTracks(P.info);
await flush();
assert.ok(P.srv && P.srv.ok, 'فهرست ترک‌های سروری گرفته شد' + (P.srvErr ? ' — خطا: ' + P.srvErr : ''));
assert.equal(P.srv.container, 'mkv');
assert.equal(P.srv.duration, 120, 'مدت فایل از سرور');
assert.equal(P.srv.tracks.audio.length, 2, 'دو ترک صدا از سرور');
assert.equal(P.srvRemux, '/api/stream/remux?t=TOK', 'آدرس remux آمادهٔ پخش است');
assert.equal(P.mkvAudioPref, 3, 'نسخهٔ دوبله → ترک صدای فارسی برای remux');

/* ── ۲. تزریق <track> برای زیرنویس‌های داخلی ── */
const tracks = video.children.filter((c) => c.tagName === 'TRACK');
assert.equal(tracks.length, 1, 'فقط برای زیرنویس متنی و پشتیبانی‌شده <track> تزریق می‌شود (' + tracks.length + ')');
const t4 = tracks[0];
assert.equal(t4.kind, 'subtitles', 'نوع track = subtitles');
assert.equal(t4.srclang, 'fa', 'زبان = fa');
assert.equal(t4.src, SJ + '4', 'src = آدرس WebVTT همان ترک');
assert.equal(t4.label, 'زیرنویس فارسی', 'برچسب فارسی از سرور');
assert.equal(t4.track.mode, 'hidden', 'حالت پیش‌فرض hidden است تا لایهٔ پلیر کار کند');

/* زیرنویس سروری در فهرست زیرنویس پلیر هم آمد (کنار زیرنویس دستی) */
assert.ok(P.subs.some((s) => s.id === 'srv_4' && s.src === SJ + '4'), 'زیرنویس داخلی در فهرست پلیر');
assert.ok(!P.subs.some((s) => s.id === 'srv_5'), 'زیرنویس تصویری (PGS) در فهرست نمی‌آید');

/* ── ۳. روشن کردن زیرنویس و نمایش بومی (track) ── */
P.subPref = 'srv_4';
api._engine.selectSub('srv_4', true);
await flush();
assert.equal(P.subOn, 'srv_4', 'زیرنویس سروری انتخاب شد');
assert.ok(fetched.some((u) => u === SJ + '4'), 'متن WebVTT از Worker گرفته شد');
assert.ok(P.cues.length === 1, 'کیوی زیرنویس (برای لایهٔ فارسی پلیر) پارس شد');
assert.equal(t4.track.mode, 'hidden', 'در حالت لایهٔ پلیر، track بومی خاموش است');

/* لایهٔ فارسی پلیر باید متن را در همان ثانیه نشان دهد */
video.currentTime = 1.5;
api._engine.srvToggle(false);
await flush();
assert.ok(SUB.innerHTML.indexOf('سلام دنیا') >= 0, 'لایهٔ فارسی متن را نشان می‌دهد: ' + SUB.innerHTML);

api._engine.srvToggle(true);
await flush();
assert.equal(P.ccNative, true, 'حالت نمایش بومی روشن شد');
assert.equal(t4.track.mode, 'showing', 'track بومی به showing رفت (منوی زیرنویس مرورگر)');
assert.equal(SUB.innerHTML, '', 'وقتی مرورگر متن را می‌نویسد، لایهٔ پلیر خالی می‌ماند');

api._engine.srvToggle(false);
await flush();
assert.equal(P.ccNative, false);
assert.equal(t4.track.mode, 'hidden', 'خاموش‌کردن، track بومی را hidden می‌کند');

/* ── ۴. نردبان پخش MKV: اول remux سرور ── */
let rungs = api._engine.srvRungs();
assert.equal(rungs[0].mode, 'srv', 'پلهٔ اول = remux سرور');
assert.equal(rungs[0].src, '/api/stream/remux?t=TOK');
assert.ok(rungs.some((r) => r.mode === 'demux'), 'موتور داخلی مرورگر پلهٔ پشتیبان می‌ماند');
P.forceClientDemux = true;
rungs = api._engine.srvRungs();
assert.ok(!rungs.some((r) => r.mode === 'srv'), 'با درخواست کاربر، موتور داخلی مرورگر اول می‌شود');
P.forceClientDemux = false;

/* ── ۵. آدرس remux با ترک صدا و ثانیهٔ شروع ── */
assert.equal(api._engine.srvUrl('/api/stream/remux?t=TOK', 61.7), '/api/stream/remux?t=TOK&audio=3&start=61', 'audio + start (ثانیهٔ صحیح)');
P.mkvAudioPref = 0;
assert.equal(api._engine.srvUrl('/api/stream/remux?t=TOK', 0), '/api/stream/remux?t=TOK', 'بدون ترک و بدون جهش');
assert.equal(api._engine.srvUrl('', 12), '', 'بدون آدرس remux خالی برمی‌گردد');

/* نسخهٔ زیرنویس → صدای اصلی (ترک ۲) */
P.cur = { track: 'sub' };
P.mkvAudioPref = 0;
assert.equal(api._engine.srvAudio(TRACKS), 2, 'نسخهٔ زیرنویس → ترک صدای اصلی');
P.cur = { track: 'dub' };
assert.equal(api._engine.srvAudio(TRACKS), 3, 'نسخهٔ دوبله → ترک صدای فارسی');

/* ── ۵.۵ تعویض فایل: trackهای فایل قبلی باید پاک شوند ── */
api._engine.srvClear();
assert.equal(video.children.filter((c) => c.tagName === 'TRACK').length, 0, 'trackهای قدیمی از <video> پاک شدند');
assert.deepEqual(Object.keys(P.srvTracks || {}), [], 'فهرست trackهای پلیر خالی شد');

/* تزریق دوباره برای ادامهٔ تست */
api._engine.srvTracks(P.info);
await flush();

/* ── ۶. پنل ترک‌ها در حالت پخش سروری ── */
P.srvActive = true;
api._engine.panel('trk');
const panel = root.querySelector('[data-p="trk"]').innerHTML;
assert.ok(panel.indexOf('پردازش روی سرور فعال است') > 0, 'برچسب موتور = پردازش روی سرور');

assert.ok(panel.indexOf('دوبله فارسی') > 0, 'ترک‌های صدا از سرور در پنل');
assert.ok(panel.indexOf('data-aud="3"') > 0, 'کلیک روی ترک صدا در پخش سروری');
assert.ok(panel.indexOf('data-clienteng="1"') > 0, 'دکمهٔ برگشت به موتور داخلی مرورگر');
assert.ok(panel.indexOf('data-ccnative') > 0, 'دکمهٔ نمایش بومی زیرنویس (track)');
assert.ok(panel.indexOf('دوبله فارسی') > 0 && panel.indexOf('⚠') < 0, 'ترک‌های AAC بدون هشدار');
P.srvActive = false;

console.log('PASS: پردازش رسانهٔ سروری در پلیر — فهرست ترک‌ها از Worker، <track kind="subtitles" srclang="fa"> برای هر زیرنویس داخلی، روشن/خاموش با نمایش بومی، و نردبان «remux سرور» با audio/start.');
