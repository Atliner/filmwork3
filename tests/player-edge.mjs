/* از کلیک «موتور داخلی» تا آخر: پلیر (fetch با Range و dest=empty) → لبهٔ پخش (توکن/بررسی‌ها)
   → مبدأ (با و بدون پشتیبانی Range) — روی یک MP4 واقعیِ چندصدایی.
   این تست همان چیزی را می‌سنجد که کاربر در مرورگر می‌بیند: آیا موتور شروع می‌شود یا برمی‌گردد
   به پخش معمولی. اگر سبز باشد، مشکل «موتور روشن نمی‌شود» در لبهٔ سرور نیست. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { streamTokenMake, streamEdgeHandle, MVX_PLAYER_MODULE };`).toString('base64'));
const edgeMod = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(new URL('../scripts/stream-edge-worker.js', import.meta.url), 'utf8')).toString('base64'));

/* ── ساخت MP4: ftyp + mdat + moov (یک ویدئو + دو صدا + یک tx3g) ── */
const ui8 = (a) => new Uint8Array(a);
const cat = (...p) => { let n = 0; for (const x of p) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const asc = (s) => new TextEncoder().encode(s);
const u16 = (n) => ui8([n >> 8 & 255, n & 255]);
const u32 = (n) => ui8([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const box = (t, ...payload) => { const b = cat(...payload); return cat(u32(b.length + 8), asc(t), b); };
const full = (t, v, f, ...p) => box(t, ui8([v, (f >> 16) & 255, (f >> 8) & 255, f & 255]), ...p);

function trak(kind, id, timescale, extra, sampleEntry, dur, sizes) {
  const n = sizes.length;
  const stts = full('stts', 0, 0, u32(1), u32(n), u32(dur));
  const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
  const stsz = full('stsz', 0, 0, u32(0), u32(n), ...sizes.map((s) => u32(s)));
  const stco = full('stco', 0, 0, u32(1), u32(0));
  const hdlr = full('hdlr', 0, 0, u32(0), asc(kind), u32(0), u32(0), u32(0), asc(kind === 'vide' ? 'Video\0' : (kind === 'soun' ? 'Sound\0' : 'Subtitle\0')));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(n * dur), u16(0x55C4), u16(0));
  const stbl = box('stbl', box('stsd', ui8([0, 0, 0, 0]), u32(1), sampleEntry), stts, stsc, stsz, stco);
  return box('trak', box('tkhd', ui8([0, 0, 0, 3]), u32(0), u32(0), u32(id), u32(0), u32(0), ui8(new Array(60).fill(0)), u32(0), u32(0), u32(0), u32(0), u32(0)), box('mdia', mdhd, hdlr, box('minf', stbl)), extra);
}
const avcC = ui8([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const esds = full('esds', 0, 0, cat(ui8([3, 25, 0, 2, 0, 4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 5, 2, 0x12, 0x10]), ui8([6, 1, 2])));
const vSample = box('avc1', ui8(new Array(6).fill(0)), ui16h(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(1280), u16(720), u32(0x00480000), u32(0x00480000), u32(0), u16(1), ui8(new Array(32).fill(0)), u16(0x0018), u16(0xffff), box('avcC', avcC));
function ui16h(n) { return ui8([n >> 8 & 255, n & 255]); }
const aSample = (ch) => box('mp4a', ui8(new Array(6).fill(0)), ui16h(1), u16(0), u16(0), u32(0), u32(0), u32(ch), u16(16), u16(0), u16(0), u32(48000 << 16), esds);
const tSample = box('tx3g', ui8(new Array(6).fill(0)), ui16h(1), u16(0), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(1), u32(12));
const tracks = [
  { kind: 'vide', id: 1, ts: 1000, sample: vSample, dur: 1000, sizes: [200, 200, 200, 200] },
  { kind: 'soun', id: 2, ts: 48000, sample: aSample(2), dur: 1024, sizes: [90, 90, 90, 90], lang: 'eng' },
  { kind: 'soun', id: 3, ts: 48000, sample: aSample(2), dur: 1024, sizes: [91, 91, 91, 91], lang: 'fas', name: 'دوبله فارسی' },
  { kind: 'sbtl', id: 4, ts: 1000, sample: tSample, dur: 1500, sizes: [30, 30], lang: 'fas' }
];
const subt = (t) => ui16h(t.length) + t;
function buildFile() {
  const mdatData = [];
  let off = 0;
  const mdatHead = 8;
  const layout = [];
  for (const t of tracks) for (const s of t.sizes) { layout.push({ t, at: mdatHead + off }); mdatData.push(new Uint8Array(s).fill(1)); off += s; }
  const mdatBody = cat(...mdatData);
  const mdat = box('mdat', mdatBody);
  /* آفست‌های واقعی: بعد از ftyp */
  const ftyp0 = box('ftyp', asc('isom'), u32(512), asc('isomiso2avc1mp41'));
  const base = ftyp0.length + 8; /* mdat payload start */
  let cur = 0;
  const chunks = [];
  for (const t of tracks) {
    const arr = [];
    for (const s of t.sizes) { arr.push(base + cur); cur += s; }
    chunks.push(arr);
  }
  const traks = tracks.map((t, ti) => {
    const stco = full('stco', 0, 0, u32(t.sizes.length), ...chunks[ti].map((c) => u32(c)));
    const stsz = full('stsz', 0, 0, u32(0), u32(t.sizes.length), ...t.sizes.map((s) => u32(s)));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(t.sizes.length), u32(1));
    const stts = full('stts', 0, 0, u32(1), u32(t.sizes.length), u32(t.dur));
    const hdlr = full('hdlr', 0, 0, u32(0), asc(t.kind), u32(0), u32(0), u32(0), asc(t.kind + 'h'));
    const nm = t.name ? box('name', asc(t.name)) : new Uint8Array(0);
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.ts), u32(t.sizes.length * t.dur), ui16h(t.lang === 'fas' ? 0x55C4 : 0x55C4), u16(0));
    const stbl = box('stbl', box('stsd', ui8([0, 0, 0, 0]), u32(1), t.sample), stts, stsc, stsz, stco);
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(0), ui8(new Array(60).fill(0)), u32(t.kind === 'vide' ? 1280 << 16 : 0), u32(t.kind === 'vide' ? 720 << 16 : 0));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, nm, box('minf', stbl)));
  });
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(4000), u32(0x00010000), u16(0x100), ui8(new Array(10).fill(0)), ui8(new Array(36).fill(0)), ui8(new Array(24).fill(0)), u32(tracks.length + 1));
  const moov = box('moov', mvhd, ...traks);
  return { head: ftyp0, moov, mdat, file: cat(ftyp0, mdat, moov) };
}
const F = buildFile();
const FILE = F.file;

/* ── مبدأ جعلی با/بدون Range ── */
function originFetch(files, honorRange) {
  return async (u, opts) => {
    const body = files[u];
    if (!body) return new Response('nope', { status: 404 });
    const rg = ((opts && opts.headers && (opts.headers.range || opts.headers.Range)) || '');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(rg));
    if (!m) {
      return new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), 'accept-ranges': 'bytes' } });
    }
    if (!honorRange) {
      return new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length) } });
    }
    const total = body.length;
    let a = m[1] === '' ? Math.max(0, total - (Number(m[2]) || 0)) : Number(m[1]);
    let b = m[1] === '' || m[2] === '' ? total - 1 : Math.min(total - 1, Number(m[2]));
    if (a > b) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + total } });
    const part = body.subarray(a, b + 1);
    return new Response(part, { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': String(part.length), 'content-range': 'bytes ' + a + '-' + b + '/' + total, 'accept-ranges': 'bytes' } });
  };
}


/* ── MKV کوچک برای مسیر «کلیک روی موتور داخلی» (که از ثانیهٔ جاری ادامه می‌دهد) ── */
const mkUi8 = (a) => new Uint8Array(a);
const mkCat = (...p) => { let n = 0; for (const x of p) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const mkSz = (n) => { for (let len = 1; len <= 8; len++) { const max = Math.pow(2, 7 * len) - 2; if (n <= max) { const b = new Array(len).fill(0); let v = n; for (let i = len - 1; i >= 0; i--) { b[i] = v & 255; v = Math.floor(v / 256); } b[0] |= (0x100 >> len) & 255; return mkUi8(b); } } throw new Error('big'); };
const mkEl = (id, payload) => mkCat(id, mkSz(payload.length), payload);
const mkUint = (n, len) => { const b = new Array(len).fill(0); for (let i = len - 1; i >= 0; i--) { b[i] = n & 255; n = Math.floor(n / 256); } return mkUi8(b); };
const mkStr = (s) => mkCat(new TextEncoder().encode(s), mkUi8([0]));
const MKID = {
  ebml: mkUi8([0x1A, 0x45, 0xDF, 0xA3]), seg: mkUi8([0x18, 0x53, 0x80, 0x67]),
  info: mkUi8([0x15, 0x49, 0xA9, 0x66]), tScale: mkUi8([0x2A, 0xD7, 0xB1]),
  tracks: mkUi8([0x16, 0x54, 0xAE, 0x6B]), entry: mkUi8([0xAE]),
  tNo: mkUi8([0xD7]), tType: mkUi8([0x83]), codec: mkUi8([0x86]), priv: mkUi8([0x63, 0xA2]),
  name: mkUi8([0x53, 0x6E]), lang: mkUi8([0x22, 0xB5, 0x9C]),
  video: mkUi8([0xE0]), w: mkUi8([0xB0]), h: mkUi8([0xBA]),
  audio: mkUi8([0xE1]), rate: mkUi8([0xB5]), ch: mkUi8([0x9F]),
  cluster: mkUi8([0x1F, 0x43, 0xB6, 0x75]), clTime: mkUi8([0xE7]), block: mkUi8([0xA3])
};
const MK_AVCC = mkUi8([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const MK_ASC = mkUi8([0x12, 0x10]);
const mkRate8 = (r) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, r); return b; };
const mkT = (no, type, codec, priv, extra, nm, lg) => mkEl(MKID.entry, mkCat(
  mkEl(MKID.tNo, mkUint(no, 1)), mkEl(MKID.tType, mkUint(type, 1)), mkEl(MKID.codec, mkStr(codec)),
  nm ? mkEl(MKID.name, mkStr(nm)) : new Uint8Array(0), lg ? mkEl(MKID.lang, mkStr(lg)) : new Uint8Array(0),
  priv ? mkEl(MKID.priv, priv) : new Uint8Array(0), extra || new Uint8Array(0)));
function buildMkv() {
  const vT = mkT(1, 1, 'V_MPEG4/ISO/AVC', MK_AVCC, mkEl(MKID.video, mkCat(mkEl(MKID.w, mkUint(1280, 2)), mkEl(MKID.h, mkUint(720, 2)))), 'Video', 'und');
  const aT = (no, nm, lg) => mkT(no, 2, 'A_AAC', MK_ASC, mkEl(MKID.audio, mkCat(mkEl(MKID.rate, mkRate8(48000)), mkEl(MKID.ch, mkUint(2, 1)))), nm, lg);
  const cl = [];
  for (let c = 0; c < 20; c++) {
    const blocks = [];
    for (let i = 0; i < 10; i++) blocks.push(mkEl(MKID.block, mkCat(mkUi8([0x81]), mkUint(i * 100, 2), mkUi8([i === 0 ? 0x80 : 0]), mkCat(mkUi8([0, 0, 0, 2, 0x65, 0x40 + (i % 3)]), new Uint8Array(40).fill(c * 10 + i)))));
    blocks.push(mkEl(MKID.block, mkCat(mkUi8([0x82]), mkUint(0, 2), mkUi8([0x80]), mkUi8([0x21, 0x10, c]))));
    blocks.push(mkEl(MKID.block, mkCat(mkUi8([0x83]), mkUint(0, 2), mkUi8([0x80]), mkUi8([0x21, 0x11, c]))));
    cl.push(mkEl(MKID.cluster, mkCat(mkEl(MKID.clTime, mkUint(c * 1000, 2)), ...blocks)));
  }
  return mkCat(mkEl(MKID.ebml, mkUi8([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])),
    mkEl(MKID.seg, mkCat(mkEl(MKID.info, mkEl(MKID.tScale, mkUint(1000000, 3))), mkEl(MKID.tracks, mkCat(vT, aT(2, 'Original', 'eng'), aT(3, 'دوبله فارسی', 'fas'))), ...cl)));
}
const MKVFILE = buildMkv();

/* ── محیط جعلی مرورگر (حداقل برای موتور) ── */
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
  constructor(type) { this.type = type; this.updating = false; this.listeners = {}; this.buffered = { length: 1, start: () => 0, end: () => 60 }; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener() { }
  appendBuffer(b) { appends.push({ type: this.type, buf: new Uint8Array(b) }); this.updating = true; timers.push(() => { this.updating = false; (this.listeners.updateend || []).slice().forEach((f) => f({ type: 'updateend' })); }); }
  remove() { } abort() { }
}
class FakeMS {
  constructor() { this.readyState = 'closed'; this.listeners = {}; }
  static isTypeSupported() { return true; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); if (e === 'sourceopen') timers.push(() => { this.readyState = 'open'; this.emit('sourceopen'); }); }
  removeEventListener() { }
  emit(e, o) { (this.listeners[e] || []).slice().forEach((f) => f(o || { type: e })); }
  addSourceBuffer(t) { this.sb = new FakeSB(t); return this.sb; }
  endOfStream() { this.readyState = 'ended'; }
}
function makeWin(fetchImpl) {
  const doc = {
    createElement: () => fakeEl('<el>'), querySelector: (s) => fakeEl(s), querySelectorAll: () => [],
    addEventListener() { }, removeEventListener() { }, head: { appendChild() { } }, body: { appendChild() { } },
    documentElement: fakeEl('html'), fullscreenElement: null
  };
  const win = {
    console: { warn: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) },
    document: doc, MediaSource: FakeMS,
    localStorage: { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); }, removeItem(k) { this.m.delete(k); } },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/124.0 Mobile Safari/537.36' },
    fetch: fetchImpl,
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
    setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
    URL: { createObjectURL: () => 'blob:mvx', revokeObjectURL() { } }
  };
  win.window = win;
  return win;
}
const fakeVideo = () => ({
  currentTime: 0, paused: false, duration: 60, muted: false, volume: 1, readyState: 4, error: null, src: '', playbackRate: 1,
  buffered: { length: 1, start: () => 0, end: () => 60 },
  classList: fakeEl('v').classList, style: {},
  setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
  addEventListener() { }, removeEventListener() { }, load() { }, play() { return Promise.resolve(); }, pause: () => { },
  canPlayType() { return 'maybe'; }
});

const SECRET = 'k'.repeat(40);
const ORIGIN = 'https://origin.test/movie.mp4';

async function runEngine(honorRange, kind) {
  const isMkv = kind === 'mkv';
  const ORIGIN_URL = isMkv ? 'https://origin.test/movie.mkv' : ORIGIN;
  const BODY = isMkv ? MKVFILE : FILE;
  logs.length = 0; timers.length = 0; appends.length = 0;
  const origin = originFetch({ [ORIGIN_URL]: BODY }, honorRange);
  const tok = await W.streamTokenMake(SECRET, { v: 1, k: 'v', u: ORIGIN_URL, e: Math.floor(Date.now() / 1000) + 600, s: 'sess', f: isMkv ? 'mkv' : 'mp4', d: 1, o: ['site.test'] });
  const src = '/sv/v/' + tok;
  const out = new Map();
  /* هم کلاینت و هم لبه (fetch گلوبال) از همین روتر استفاده می‌کنند؛ وگرنه لبه سعی می‌کند
     واقعاً به origin برسد و تست به‌جای سنجش منطق، در شبکه گیر می‌کند */
  const fetchImpl = async (url, opts) => {
    const u = String(url && url.url ? url.url : url);
    if (u.indexOf('origin.test') > -1) return origin(u, opts);
    if (u.indexOf('/sv/') === 0 || u.indexOf('/sv/') > -1) {
      const req = new Request('https://site.test' + u.replace(/^https?:\/\/[^/]+/, ''),
        { headers: Object.assign({ 'sec-fetch-dest': 'empty', 'user-agent': 'Mozilla/5.0 Chrome/124.0', referer: 'https://site.test/p/x' }, (opts && opts.headers) || {}) });
      const res = await W.streamEdgeHandle(req, SECRET, { prefix: '/sv' });
      const hh = (opts && opts.headers) || {};
      const rq = String((hh.range || hh.Range) || (hh.get && hh.get('range')) || '');
      if (!rq && opts) out.set('nohdr', (out.get('nohdr') || '') + Object.keys(hh).join(',') + ';');
      if (rq) out.set('sawRange', (out.get('sawRange') || '') + rq + ';');
      if (rq) {
        const cr = res.headers.get('content-range') || '', cl = res.headers.get('content-length') || '';
        if (res.status === 206 && /^bytes \d+-\d+\/(\d+|\*)$/.test(cr) && /^\d+$/.test(cl)) out.set('rangeOk', cr + ' len=' + cl);
        else if (!out.get('rangeBad')) out.set('rangeBad', res.status + ' cr=' + cr + ' cl=' + cl);
      }
      if (res.status >= 400) {
        let body = '';
        try { body = await res.clone().text(); } catch (e) { }
        out.set('deny', res.status + ' ' + body + ' ' + (res.headers.get('x-mvx-deny') || ''));
      }
      return res;
    }
    return origin(u, opts);
  };
  const win = makeWin(fetchImpl);
  const gFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  W.MVX_PLAYER_MODULE(win);
  const api = win.MvxPlayer;
  const P = {
    video: fakeVideo(), root: fakeEl('root'),
    info: { src: src, fmt: isMkv ? 'mkv' : 'mp4', demux: true, direct: '', cur: { track: 'dub' }, tracks: { container: isMkv ? 'mkv' : 'mp4', audio: [{ no: 2 }, { no: 3 }], subs: isMkv ? [] : [{ no: 4 }] }, subs: [] },
    cur: { track: 'dub' }, subs: [], embCues: {}, closed: false, panel: '', subOn: '', subPref: undefined, cues: [],
    mp4AudioPref: 0, mp4Done: false, mp4Idx: null, forceDemux: true, forceNative: false, pendingSeek: 0, opts: {}, sid: 's', host: {},
    mkvDone: false, mkvWhy: '', mp4Why: ''
  };
  api._engine.bind(P);
  P.mkvSeek = 0;
  P.pendingSeek = 0;
  /* مثل کلیک کاربر روی «🔁 موتور داخلی»: از ثانیهٔ جاری (۸ ثانیه) ادامه می‌دهد
     و برای همین درخواست بایتی (Range) می‌زند — همان جایی که قبلاً می‌شکست */
  if (isMkv) api._engine.startMkv(src, 8);
  else api._engine.start(src, 8);
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5));
      timers.splice(0).forEach((f) => f());
    }
  } finally { globalThis.fetch = gFetch; }
  return { P, appends: appends.slice(), logs: logs.slice(), out, rangeOk: out.get('rangeOk') || '', rangeBad: out.get('rangeBad') || '', sawRange: out.get('sawRange') || '' };
}

/* ۱) مبدأی که Range را می‌فهمد: موتور باید شروع شود */
for (const kind of ['mp4', 'mkv']) {
  const r = await runEngine(true, kind);
  assert.ok(!r.P.mp4Why && !r.P.mkvWhy, 'موتور داخلی شروع شد (دلیل شکست: ' + (r.P.mkvWhy || r.P.mp4Why) + ' — لاگ: ' + r.logs.join(' | ') + ' — لبه: ' + (r.out.get('deny') || 'ok') + ')');
  const mm = r.P.mkv || r.P.mp4;
  assert.ok(r.appends.length > 1, 'قطعه‌ها به MediaSource رسیدند (' + r.appends.length + ') — state=' + JSON.stringify(mm && { ready: mm.ready, q: mm.queue && mm.queue.length, ci: mm.ci, order: mm.idx && mm.idx.order && mm.idx.order.length, done: mm.done, reading: mm.reading, failed: mm.failed, base: mm.base, buf: mm.buf && mm.buf.length, type: mm.type }) + ' — logs=' + r.logs.join(' | '));
  const init = String.fromCharCode(...r.appends[0].buf);
  for (const b of ['ftyp', 'moov', 'avc1', 'avcC', 'mp4a', 'esds']) assert.ok(init.includes(b), 'init: ' + b);
  assert.ok(r.appends.length >= 2, 'بعد از init، فرگمنت هم آمد');
  if (kind === 'mkv') {
    /* کلیک وسط فیلم: نمونه‌های قبل از محل پخش نباید append شوند و پلیر باید همان‌جا باشد */
    assert.ok(r.P.video.currentTime >= 5.9 && r.P.video.currentTime <= 8.1, 'MKV از محل پخش ادامه داد (currentTime=' + r.P.video.currentTime + '، هدف ۸ ثانیه)');
  }
  /* MP4 با پنجره‌های بایتی خوانده می‌شود؛ MKV از ابتدا جریانی است و Range فقط برای جهش می‌زند */
  if (kind === 'mp4') assert.match(r.sawRange, /bytes=\d+-/, 'درخواست‌های MP4 با Range رفتند (' + r.sawRange + ')');
}
console.log('sizes: mp4=' + FILE.length + ' mkv=' + MKVFILE.length);
console.log('PASS: end-to-end internal engine (mp4 + mkv) — click at second 8 → /sv/v/<token> (dest=empty) → edge → origin with Range → fMP4 appends reach MediaSource.');

/* ۲) مبدأی که Range را نادیده می‌گیرد (۲۰۰ با کل فایل): لبه باید خودش برش بدهد (۲۰۶)
   تا موتور داخلی همان‌طور پخش شود — این حالت در عمل «همیشه برمی‌گردد به پخش معمولی» بود */
for (const kind of ['mp4', 'mkv']) {
  const r = await runEngine(false, kind);
  assert.ok(!r.P.mp4Why && !r.P.mkvWhy, 'مبدأ بدون Range هم پخش می‌شود (دلیل شکست: ' + (r.P.mkvWhy || r.P.mp4Why) + ' — لبه: ' + (r.out.get('deny') || 'ok') + ')');
  assert.ok(r.appends.length > 1, 'قطعه‌ها با برش ۲۰۶ در لبه رسیدند (' + r.appends.length + ')');
}
console.log('PASS: origin that ignores Range (mp4 + mkv) — the edge slices the 200 body into a real 206, so the engine still plays.');

/* ۳) ۲۰۶ برش‌خورده از نظر پروتکل درست باشد */
{
  const r = await runEngine(false, 'mp4');
  assert.ok(r.rangeOk && !r.rangeBad, 'پاسخ لبه content-range = bytes a-b/total دارد (' + (r.rangeOk || r.rangeBad) + ')');
}
console.log('PASS: sliced response is protocol-correct (206 + Content-Range + Content-Length).');
