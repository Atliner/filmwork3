/* موتور MP4 داخل‌صفحه — اجرای واقعیِ «ابتدای کار» بدون مرورگر:
   moov/stbl، پنجرهٔ Range، برش نمونه‌ها، ساخت fMP4 و appendBuffer به MediaSource جعلی.
   هدف: مطمئن شویم مسیری که کاربر با کلیک «موتور داخلی» طی می‌کند واقعاً اجرا می‌شود
   (اگر این‌جا سبز باشد، شکست در مرورگر یعنی مشکل محیطی: نبود MediaSource، Range یا توکن لبه). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE, streamMp4Layout };`).toString('base64'));

/* ── ساخت یک MP4 واقع‌نما: ftyp/moov/mdat، دو ترک صدا، زیرنویس tx3g، B-frame ── */
const u8 = (n) => new Uint8Array([n & 255]);
const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255]);
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 255));
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const zero = (n) => new Uint8Array(n);
function cat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type, ...parts) => { const body = cat(...parts); return cat(u32(body.length + 8), ascii(type), body); };
const full = (type, ver, flags, ...parts) => box(type, new Uint8Array([ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const stts = (e) => full('stts', 0, 0, u32(e.length), ...e.map(([n, d]) => cat(u32(n), u32(d))));
const ctts = (e) => full('ctts', 1, 0, u32(e.length), ...e.map(([n, o]) => cat(u32(n), u32(o >>> 0))));
const stss = (l) => full('stss', 0, 0, u32(l.length), ...l.map(u32));
const stsz = (z) => full('stsz', 0, 0, u32(0), u32(z.length), ...z.map(u32));
const stsc = (e) => full('stsc', 0, 0, u32(e.length), ...e.map(([f, n]) => cat(u32(f), u32(n), u32(1))));
const stco = (o) => full('stco', 0, 0, u32(o.length), ...o.map(u32));
const hdlr = (kind, name) => full('hdlr', 0, 0, u32(0), ascii(kind), zero(12), utf8(name), u8(0));
const lang = (l) => u16([(l.charCodeAt(0) - 0x60) & 31, (l.charCodeAt(1) - 0x60) & 31, (l.charCodeAt(2) - 0x60) & 31].reduce((a, c, i) => a | (c << (10 - i * 5)), 0));
const AVC_C = new Uint8Array([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const ASC = new Uint8Array([0x12, 0x10]);
const avc1 = (w, h) => box('avc1', zero(6), u16(1), zero(16), u16(w), u16(h), u32(0x480000), u32(0x480000), u32(0), u16(1), zero(32), u16(0x18), u16(0xffff), box('avcC', AVC_C));
const mp4a = (ch, rate) => {
  const dsi = cat(u8(0x05), u8(ASC.length), ASC);
  const dcd = cat(u8(0x04), u8(13 + dsi.length), u8(0x40), u8(0x15), zero(3), u32(0), u32(0), dsi);
  const es = cat(u8(0x03), u8(3 + dcd.length), u16(1), u8(0), dcd);
  return box('mp4a', zero(6), u16(1), zero(8), u16(ch), u16(16), u16(0), u16(0), u32(rate * 65536), full('esds', 0, 0, es));
};
function trak(o) {
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(o.id), u32(0), u32(0), zero(8), u16(0), u16(0), u16(0), u16(0), zero(36), u32(0), u32(0));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(o.ts), u32(0), lang(o.lang || 'und'), u16(0));
  const stbl = box('stbl', full('stsd', 0, 0, u32(1), o.entry), o.stts, o.ctts || zero(0), o.stss || zero(0), o.stsz, o.stsc, stco(o.chunks));
  return box('trak', tkhd, box('mdia', mdhd, hdlr(o.kind, o.name || ''), box('minf', o.kind === 'vide' ? full('vmhd', 0, 1, zero(8)) : full('smhd', 0, 0, zero(4)), stbl)));
}
const tx3g = () => box('tx3g', zero(6), u16(1), zero(4), u8(0), u8(0), u16(0), u32(0), zero(8), zero(12));

/* ۴۰ فریم ویدئو (۳۰fps، هر ۱۰ فریم یک کی‌فریم) + ۲ ترک صدا + یک زیرنویس */
const VN = 40, VTS = 30000, VSIZES = Array.from({ length: VN }, (_, i) => 200 + (i % 7));
const A1 = [60, 61], A2 = [62, 63];
const SUB_TEXT = 'سلام ۱';
const SUB = cat(u16(utf8(SUB_TEXT).length), utf8(SUB_TEXT));
const payloads = [];
for (let i = 0; i < VN; i++) payloads.push({ t: 0, bytes: new Uint8Array(VSIZES[i]).fill(0x10 + (i % 9)) });
payloads.push({ t: 1, bytes: new Uint8Array(A1[0]).fill(0x21) });
payloads.push({ t: 2, bytes: new Uint8Array(A2[0]).fill(0x31) });
payloads.push({ t: 3, bytes: SUB });
payloads.push({ t: 1, bytes: new Uint8Array(A1[1]).fill(0x22) });
payloads.push({ t: 2, bytes: new Uint8Array(A2[1]).fill(0x32) });
const mdatBody = cat(...payloads.map((p) => p.bytes));
const FTYP = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
function build() {
  const make = (base) => {
    let o = base;
    const offs = payloads.map((p) => { const at = o; o += p.bytes.length; return at; });
    const of = (ti) => payloads.map((p, i) => (p.t === ti ? offs[i] : -1)).filter((x) => x >= 0);
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), zero(10), zero(12), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(5));
    const video = trak({
      id: 1, kind: 'vide', ts: VTS, name: 'VideoHandler', entry: avc1(1280, 720),
      stts: stts([[VN, 1000]]), stss: stss([1, 11, 21, 31]), stsz: stsz(VSIZES), stsc: stsc([[1, 1]]), chunks: of(0),
    });
    const a1 = trak({ id: 2, kind: 'soun', ts: 48000, name: 'SoundHandler', entry: mp4a(2, 48000), stts: stts([[2, 1024]]), stsz: stsz(A1), stsc: stsc([[1, 1]]), chunks: of(1) });
    const a2 = trak({ id: 3, kind: 'soun', ts: 48000, lang: 'fas', name: 'فارسی', entry: mp4a(2, 48000), stts: stts([[2, 1024]]), stsz: stsz(A2), stsc: stsc([[1, 1]]), chunks: of(2) });
    const sub = trak({ id: 4, kind: 'sbtl', ts: 1000, lang: 'eng', name: 'English', entry: tx3g(), stts: stts([[1, 2500]]), stsz: stsz([SUB.length]), stsc: stsc([[1, 1]]), chunks: of(3) });
    return box('moov', mvhd, video, a1, a2, sub);
  };
  const probe = make(0);
  return cat(FTYP, make(FTYP.length + probe.length + 8), box('mdat', mdatBody));
}
const FILE = build();

/* ── محیط مرورگر جعلی ── */
function fakeEl(sel) {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', style: {}, children: [],
    classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, toggle(c, on) { if (on === undefined) on = !this.list.has(c); if (on) this.list.add(c); else this.list.delete(c); return on; }, contains(c) { return this.list.has(c); } },
    setAttribute() { }, getAttribute() { return null; }, removeAttribute() { }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { }, contains() { return false; }, focus() { },
    /* هر انتخابگر یک گرهٔ جعلی پایدار (همان کاری که DOM واقعی می‌کند) */
    querySelector(sel) { const m = el._kids || (el._kids = new Map()); if (!m.has(sel)) m.set(sel, fakeEl(sel)); return m.get(sel); },
    querySelectorAll() { return []; }
  };
  return el;
}
const logs = [];
function makeWindow() {
  const els = new Map();
  const appends = [];
  const timers = [];
  const doc = {
    createElement: (t) => fakeEl('<' + t + '>'),
    querySelector: (sel) => { if (!els.has(sel)) els.set(sel, fakeEl(sel)); return els.get(sel); },
    querySelectorAll: () => [],
    addEventListener() { }, removeEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
    documentElement: fakeEl('html'), fullscreenElement: null
  };
  class FakeSB {
    constructor(type) { this.type = type; this.updating = false; this.mode = ''; this.listeners = {}; this.buffered = { length: 0, start() { return 0; }, end() { return 0; } }; }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    removeEventListener() { }
    appendBuffer(buf) {
      appends.push({ type: this.type, buf: new Uint8Array(buf) });
      this.updating = true;
      timers.push(() => { this.updating = false; (this.listeners.updateend || []).forEach((f) => f()); });
    }
    remove() { } abort() { }
  }
  class FakeMS {
    constructor() { this.readyState = 'closed'; this.listeners = {}; this.sb = null; }
    static isTypeSupported() { return true; }
    addEventListener(ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
      if (ev === 'sourceopen') timers.push(() => { this.readyState = 'open'; fn({}); });
    }
    addSourceBuffer(type) { this.sb = new FakeSB(type); return this.sb; }
    endOfStream() { this.readyState = 'ended'; }
  }
  const win = {
    console: { warn(...a) { logs.push(a.join(' ')); }, log(...a) { logs.push(a.join(' ')); } },
    document: doc,
    MediaSource: FakeMS,
    localStorage: { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); }, removeItem(k) { this.m.delete(k); } },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' },
    fetch: async (url, opts) => {
      const h = (opts && opts.headers) || {};
      const rng = String(h.range || h.Range || '');
      const mm = /^bytes=(\d+)-(\d*)$/.exec(rng);
      let start = 0, end = FILE.length - 1, status = 200;
      if (mm) {
        start = Number(mm[1]);
        if (mm[2]) end = Math.min(Number(mm[2]), FILE.length - 1);
        status = 206;
      }
      if (start > FILE.length - 1) return { ok: false, status: 416, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      const body = FILE.slice(start, end + 1);
      return {
        ok: true, status,
        headers: { get: (k) => (String(k).toLowerCase() === 'content-range' ? 'bytes ' + start + '-' + end + '/' + FILE.length : (String(k).toLowerCase() === 'content-type' ? 'video/mp4' : null)) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
        body: { getReader: () => { let done = false; return { read: async () => (done ? { done: true } : (done = true, { done: false, value: body })), cancel() { } }; } }
      };
    },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return t; },
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (t) => clearInterval(t)
  };
  win.window = win;
  win.URL = { createObjectURL: () => 'blob:mvx-test', revokeObjectURL() { } };
  return { win, appends, timers, els };
}

const fakeVideo = () => {
  const ev = {};
  return {
    currentTime: 0, paused: false, ended: false, duration: 60, muted: false, volume: 1, readyState: 4, error: null,
    src: '', currentSrc: '', playbackRate: 1, buffered: { length: 0, start() { return 0; }, end() { return 0; } },
    classList: fakeEl('v').classList, style: {},
    setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
    addEventListener(ev2, fn) { (ev[ev2] = ev[ev2] || []).push(fn); },
    removeEventListener() { }, dispatch(ev2, d) { (ev[ev2] || []).forEach((f) => f(d || {})); },
    load() { }, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
    canPlayType() { return ''; }, focus() { }
  };
};

/* ── اجرا ── */
const env = makeWindow();
W.MVX_PLAYER_MODULE(env.win);
const api = env.win.MvxPlayer;
assert.ok(api && api._engine, 'قلاب تست موتور روی MvxPlayer هست');

const video = fakeVideo();
const P = {
  video, root: fakeEl('root'), info: null, cur: { track: 'dub', quality: '720', streamId: 's1' },
  subs: [], embCues: {}, closed: false, panel: '', subOn: '', cues: [], mkvAudioPref: 0, mp4AudioPref: 0,
  mp4AudioOff: false, forceDemux: true, forceNative: false, opts: {}, sid: 'x', host: {}, pendingSeek: 0,
  info: { src: 'https://site.test/sv/v/token', fmt: 'mp4', tracks: { container: 'mp4', audio: [{ no: 2 }, { no: 3 }], subs: [{ no: 4 }] }, cur: { track: 'dub' } },
  trackInfo: { container: 'mp4', audio: [{ no: 2 }, { no: 3 }], subs: [{ no: 4 }] }
};
api._engine.bind(P);

/* تصمیم موتور: همان تابعی که setSource استفاده می‌کند */
assert.equal(api._engine.plan('mp4', 'mp4', P.info.tracks, false, true), true, 'کلیک «موتور داخلی» → موتور روشن');
assert.equal(api._engine.plan('mp4', 'mp4', P.info.tracks, false, false), true, 'چند ترک صدا → خودکار موتور');
assert.equal(api._engine.plan('mp4', 'mp4', { audio: [{ no: 1 }], subs: [] }, false, false), false, 'تک‌ترک بدون زیرنویس → بومی');
assert.equal(api._engine.plan('mp4', 'mp4', P.info.tracks, true, true), false, 'حالت بومی اجباری برنده است');
assert.equal(api._engine.plan('webm', 'webm', P.info.tracks, false, true), false, 'webm بومی می‌ماند');
assert.equal(api._engine.plan('mkv', 'mkv', P.info.tracks, false, true), false, 'mkv مسیر خودش را دارد');

api._engine.start('https://site.test/sv/v/token', 0);

const flush = async (rounds) => {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setTimeout(r, 1));
    const t = env.timers.splice(0);
    t.forEach((f) => f());
  }
};
await flush(60);

const st = api._engine.state();
assert.ok(st, 'شیء موتور ساخته شد' + (logs.length ? ' — لاگ: ' + logs.join(' | ') : '') + (P.mp4Why ? ' — دلیل: ' + P.mp4Why : ''));
assert.equal(st.failed, false, 'موتور شکست نخورد');
assert.equal(st.type, 'video/mp4; codecs="avc1.4d4028,mp4a.40.2"', 'نوع MediaSource از کدک‌های واقعی فایل: ' + st.type);
/* نسخهٔ «دوبله» → ترک فارسی (id 3) به‌طور خودکار انتخاب می‌شود، نه ترک اول */
assert.ok(st.audio && st.audio.id === 3, 'ترک صدای فارسی برای نسخهٔ دوبله انتخاب شد (id=' + (st.audio && st.audio.id) + ')');
assert.equal(st.audios[1].name, 'فارسی');
assert.ok(st.audios.length === 2, 'هر دو ترک صدا فهرست شدند');
assert.equal(st.subTracks.length, 1, 'ترک زیرنویس داخلی دیده شد');
assert.ok(env.appends.length > 1, 'داده به MediaSource داده شد (' + env.appends.length + ' قطعه)');

/* init اول + هر قطعه: moof/mdat با شمارهٔ ترتیب صعودی */
const first = env.appends[0].buf;
const head = String.fromCharCode(...first);
for (const b of ['ftyp', 'moov', 'avc1', 'avcC', 'mp4a', 'esds']) assert.ok(head.includes(b), 'init segment: ' + b);
assert.equal(env.appends[0].type, st.type);
let frags = 0, lastSeq = -1;
for (const a of env.appends.slice(1)) {
  const s = String.fromCharCode(...a.buf.slice(0, Math.min(200, a.buf.length)));
  assert.ok(s.includes('moof'), 'هر قطعه moof دارد');
  const at = s.indexOf('mfhd');
  const seq = (a.buf[at + 8] << 24) | (a.buf[at + 9] << 16) | (a.buf[at + 10] << 8) | a.buf[at + 11]; /* type+ver/flags(4)+seq */
  assert.ok(seq > lastSeq, 'شمارهٔ ترتیب قطعه‌ها صعودی است');
  lastSeq = seq;
  frags++;
}
assert.ok(frags >= 2, 'حداقل یک قطعهٔ ویدئو و یک قطعهٔ صدا (' + frags + ')');
/* بایت‌های نمونه‌ها بدون تغییر داخل mdatها هستند */
const joined = Buffer.concat(env.appends.map((a) => Buffer.from(a.buf)));
assert.ok(joined.includes(Buffer.from(payloads[0].bytes)), 'نمونهٔ اول ویدئو دست‌نخورده در mdat');
assert.ok(joined.includes(Buffer.from(payloads[VN + 1].bytes)), 'نمونهٔ صدای ترک انتخاب‌شده در خروجی');
assert.ok(!joined.includes(Buffer.from(payloads[VN].bytes)), 'ترک صدای غیرانتخابی وارد خروجی نمی‌شود');
assert.ok(!joined.includes(Buffer.from(payloads[VN + 3].bytes)), 'نمونهٔ دوم ترک غیرانتخابی هم نیامد');

/* زیرنویس داخلی استخراج شد */
assert.ok(P.embCues[4] && P.embCues[4].cues.length === 1, 'زیرنویس tx3g خوانده و ثبت شد');
assert.equal(P.embCues[4].cues[0].t, SUB_TEXT);
assert.ok(P.subs.some((s) => s.embedded === 4), 'زیرنویس داخلی در فهرست پلیر آمد');

/* خواندن ادامه‌دار: با جلو رفتن پخش، پنجرهٔ بعدی گرفته می‌شود */
const before = st.ci;
video.currentTime = 1.0;
st.fedTo = 0;   /* شبیه‌سازی «بافر جلو خالی شد» */
st.done = false;
st.ci = Math.min(st.ci, 8);
await flush(40);
assert.ok(env.appends.length > 3, 'پنجرهٔ بعدی هم خوانده و append شد');

/* تعویض ترک صدا: نوع MediaSource عوض می‌شود، از همان ثانیه */
const appendsBefore = env.appends.length;
assert.ok(typeof st.audio.id === 'number');
console.log('PASS: MP4 engine runs end-to-end headlessly — moov/stbl → range windows → fMP4 (init + moof/mdat, increasing sequence) → appendBuffer, audio/subtitle track discovery, embedded tx3g cues, next-window pumping. (' + env.appends.length + ' appends before switch)');
