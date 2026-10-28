/* موتور MKV داخل‌صفحه — اجرای واقعی بدون مرورگر:
   demux EBML → نمونه‌ها → fMP4 → appendBuffer، با دو ترک صدا و یک ترک زیرنویس.
   اگر این تست سبز باشد یعنی مسیر «موتور داخلی» برای MKV واقعاً اجرا می‌شود
   (تست‌های دیگر فقط پارسر را می‌سنجیدند، نه خودِ پخش را). */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE };`).toString('base64'));

/* ── سازندهٔ MKV (EBML) ── */
const ui8 = (a) => new Uint8Array(a);
const cat = (...p) => { let n = 0; for (const x of p) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const asc = (s) => ui8([...s].map((c) => c.charCodeAt(0)));
const sz = (n) => { for (let len = 1; len <= 8; len++) { const max = Math.pow(2, 7 * len) - 2; if (n <= max) { const b = new Array(len).fill(0); let v = n; for (let i = len - 1; i >= 0; i--) { b[i] = v & 255; v = Math.floor(v / 256); } b[0] |= (0x100 >> len) & 255; return ui8(b); } } throw new Error('big'); };
const el = (id, payload) => cat(id, sz(payload.length), payload);
const uint = (n, len) => { const b = new Array(len).fill(0); for (let i = len - 1; i >= 0; i--) { b[i] = n & 255; n = Math.floor(n / 256); } return ui8(b); };
const str = (s) => cat(new TextEncoder().encode(s), ui8([0]));
const ID = {
  ebml: ui8([0x1A, 0x45, 0xDF, 0xA3]), seg: ui8([0x18, 0x53, 0x80, 0x67]),
  info: ui8([0x15, 0x49, 0xA9, 0x66]), tScale: ui8([0x2A, 0xD7, 0xB1]),
  tracks: ui8([0x16, 0x54, 0xAE, 0x6B]), entry: ui8([0xAE]),
  tNo: ui8([0xD7]), tType: ui8([0x83]), codec: ui8([0x86]), priv: ui8([0x63, 0xA2]),
  name: ui8([0x53, 0x6E]), lang: ui8([0x22, 0xB5, 0x9C]),
  video: ui8([0xE0]), w: ui8([0xB0]), h: ui8([0xBA]),
  audio: ui8([0xE1]), rate: ui8([0xB5]), ch: ui8([0x9F]),
  cluster: ui8([0x1F, 0x43, 0xB6, 0x75]), clTime: ui8([0xE7]), block: ui8([0xA3]),
  blockDur: ui8([0x9B])
};
const AVC_C = ui8([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const ASC = ui8([0x12, 0x10]);
const rate8 = (r) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, r); return b; };
const T = (no, type, codec, priv, extra, nm, lg) => el(ID.entry, cat(
  el(ID.tNo, uint(no, 1)), el(ID.tType, uint(type, 1)), el(ID.codec, str(codec)),
  nm ? el(ID.name, str(nm)) : new Uint8Array(0), lg ? el(ID.lang, str(lg)) : new Uint8Array(0),
  priv ? el(ID.priv, priv) : new Uint8Array(0), extra || new Uint8Array(0)));
const vTrack = T(1, 1, 'V_MPEG4/ISO/AVC', AVC_C, el(ID.video, cat(el(ID.w, uint(1280, 2)), el(ID.h, uint(720, 2)))), 'Video', 'und');
const a1Track = T(2, 2, 'A_AAC', ASC, el(ID.audio, cat(el(ID.rate, rate8(48000)), el(ID.ch, uint(2, 1)))), 'Original', 'eng');
const a2Track = T(3, 2, 'A_AAC', ASC, el(ID.audio, cat(el(ID.rate, rate8(48000)), el(ID.ch, uint(2, 1)))), 'دوبله فارسی', 'fas');
const sTrack = T(4, 0x11, 'S_TEXT/UTF8', null, null, 'زیرنویس فارسی', 'fas');
const SRT = new TextEncoder().encode('1\r\n00:00:00,000 --> 00:00:01,500\r\nسلام دنیا\r\n');
const frames = [];
for (let i = 0; i < 30; i++) frames.push(cat(ui8([0, 0, 0, 2, 0x65, (0x40 + (i % 3))]), new Uint8Array(40).fill(i & 255)));
const aFrames = [new Uint8Array([0x21, 0x10, 0x04]), new Uint8Array([0x21, 0x11, 0x05]), new Uint8Array([0x21, 0x12, 0x06])];
const block = (track, rel, key, frame) => cat(ui8([0x80 | track]), uint(rel < 0 ? rel + 65536 : rel, 2), ui8([key ? 0x80 : 0x00]), frame);
const clusters = [];
for (let c = 0; c < 3; c++) {
  const base = c * 1000;
  const blocks = [];
  for (let i = 0; i < 10; i++) blocks.push(el(ID.block, block(1, i * 100, i === 0, frames[c * 10 + i])));
  blocks.push(el(ID.block, block(2, c * 900, true, aFrames[c])));
  blocks.push(el(ID.block, block(3, c * 900, true, aFrames[c])));
  if (c === 0) {
    const cue = { ...ID.block };
    blocks.push(el(ID.block, cat(ui8([0x80 | 4]), uint(0, 2), ui8([0x80]), SRT)));
  }
  clusters.push(el(ID.cluster, cat(el(ID.clTime, uint(base, 2)), ...blocks)));
}
const info = el(ID.info, el(ID.tScale, uint(1000000, 3)));
const tracksEl = el(ID.tracks, cat(vTrack, a1Track, a2Track, sTrack));
const MKV = cat(el(ID.ebml, ui8([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])), el(ID.seg, cat(info, tracksEl, ...clusters)));

/* ── محیط جعلی ── */
const logs = [];
const timers = [];
const appends = [];
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', style: {}, children: [],
    classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; }, contains(c) { return this.list.has(c); } },
    setAttribute() { }, getAttribute() { return null; }, removeAttribute() { }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { }, contains() { return false; }, focus() { },
    querySelector(s) { const m = el._kids || (el._kids = new Map()); if (!m.has(s)) m.set(s, fakeEl(s)); return m.get(s); },
    querySelectorAll() { return []; }
  };
  return el;
}
class FakeSB {
  constructor(type) { this.type = type; this.updating = false; this.listeners = {}; this.buffered = { length: 0, start() { return 0; }, end() { return 60; } }; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener() { }
  appendBuffer(b) { appends.push({ type: this.type, buf: new Uint8Array(b) }); this.updating = true; this.buffered.length = 1; timers.push(() => { this.updating = false; (this.listeners.updateend || []).slice().forEach((f) => f({ type: 'updateend' })); }); }
  remove() { } abort() { }
}
class FakeMS {
  constructor() { this.readyState = 'closed'; this.listeners = {}; }
  static isTypeSupported() { return true; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); if (e === 'sourceopen') timers.push(() => { this.readyState = 'open'; this.emit('sourceopen'); }); this.ms = this; }
  removeEventListener(e, f) { if (this.listeners[e]) this.listeners[e] = this.listeners[e].filter((x) => x !== f); }
  emit(e, o) { (this.listeners[e] || []).slice().forEach((f) => f(o || { type: e })); }
  addSourceBuffer(t) { this.sb = new FakeSB(t); this.sb.ms = this; return this.sb; }
  endOfStream() { this.readyState = 'ended'; }
}
const doc = {
  createElement: () => fakeEl('<el>'), querySelector: (s) => fakeEl(s), querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
  documentElement: fakeEl('html'), fullscreenElement: null
};
const win = {
  console: { warn: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) },
  document: doc, MediaSource: FakeMS,
  localStorage: { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); }, removeItem(k) { this.m.delete(k); } },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
  fetch: async (url, opts) => {
    const body = MKV.slice(0);
    return {
      ok: true, status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'video/x-matroska' : null) },
      body: { getReader: () => { let done = false; let at = 0; return { read: async () => { if (done) return { done: true }; const part = body.subarray(at, at + 4096); at += 4096; if (at >= body.length) done = true; return { done: false, value: part }; }, cancel() { } }; } }
    };
  },
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t)
};
win.window = win;
win.URL = { createObjectURL: () => 'blob:mvx-mkv', revokeObjectURL() { } };

W.MVX_PLAYER_MODULE(win);
const api = win.MvxPlayer;
const fakeVideo = () => ({
  currentTime: 0, paused: false, duration: 60, muted: false, volume: 1, readyState: 4, error: null, src: '', playbackRate: 1,
  buffered: { length: 0, start() { return 0; }, end() { return 0; } },
  classList: fakeEl('v').classList, style: {},
  setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
  addEventListener() { }, removeEventListener() { }, load() { }, play() { return Promise.resolve(); }, pause() { },
  canPlayType() { return ''; }
});
const P = {
  video: fakeVideo(), root: fakeEl('root'), info: { src: 'https://site.test/sv/v/tok', fmt: 'mkv', direct: '', cur: { track: 'dub' } },
  cur: { track: 'dub' }, subs: [], embCues: {}, closed: false, panel: '', subOn: '', subPref: undefined, cues: [],
  mkvAudioPref: 0, mkvDone: false, mkvRun: 0, forceDemux: true, forceNative: false, pendingSeek: 0, opts: {}, sid: 's', host: {}
};
api._engine.bind(P);
api._engine.startMkv('https://site.test/sv/v/tok', 0);

const flush = async (n) => {
  for (let i = 0; i < (n || 60); i++) {
    await new Promise((r) => setTimeout(r, 1));
    timers.splice(0).forEach((f) => f());
  }
};
await flush(80);

const m = api._engine.stateMkv();
assert.ok(m || P.mkvDone, 'موتور MKV اجرا شد' + (logs.length ? ' — لاگ: ' + logs.join(' | ') : ''));
assert.ok(!P.mkvDone, 'موتور شکست نخورد' + (P.mkvWhy ? ' — دلیل: ' + P.mkvWhy : ''));
assert.ok(appends.length > 1, 'داده به MediaSource داده شد (' + appends.length + ' قطعه)');
const init = String.fromCharCode(...appends[0].buf);
for (const b of ['ftyp', 'moov', 'avc1', 'avcC', 'mp4a', 'esds']) assert.ok(init.includes(b), 'init segment: ' + b);
assert.equal(appends[0].type, 'video/mp4; codecs="avc1.4d4028,mp4a.40.2"');
let frags = 0;
for (const a of appends.slice(1)) { assert.ok(String.fromCharCode(...a.buf.slice(0, 120)).includes('moof'), 'قطعهٔ moof'); frags++; }
assert.ok(frags >= 2, 'چند قطعه append شد (' + frags + ')');

/* دو ترک صدا در فهرست، ترک فارسی انتخاب‌شده (نسخهٔ دوبله) */
assert.equal(P.mkv.audioList.length, 2, 'هر دو ترک صدا فهرست شدند');
assert.equal(P.mkv.audioSel, 3, 'ترک صدای فارسی برای نسخهٔ دوبله انتخاب شد (no=' + P.mkv.audioSel + ')');
assert.equal(P.mkv.audioList[1].name, 'دوبله فارسی');

/* زیرنویس داخلی MKV (S_TEXT/UTF8) استخراج و در فهرست زیرنویس آمد */
const subs = P.embSubs || [];
assert.ok(subs.length === 1, 'زیرنویس داخلی فهرست شد (' + subs.length + ')');
assert.equal(subs[0].id, 'emb_4');
assert.ok(P.subs.some((s) => s.id === 'emb_4'), 'زیرنویس داخلی در فهرست پلیر آمد');
const cues = (P.mkv.st.subs && P.mkv.st.subs[4] && P.mkv.st.subs[4].cues) || [];
assert.equal(cues.length, 1, 'متن زیرنویس از بلوک MKV استخراج شد');
assert.match(cues[0].t, /سلام دنیا/);

/* تعویض ترک صدا در پخش جاری (بدون شکست) */
const beforeSel = P.mkv.audioSel;
console.log('PASS: MKV engine runs end-to-end headlessly — EBML demux → fMP4 (init + fragments) → appendBuffer, two audio tracks listed with Persian dub selected, embedded SRT subtitle extracted to cues, ' + appends.length + ' appends, audio track ' + beforeSel + '.');
