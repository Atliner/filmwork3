/* پردازش رسانه روی سرور (Worker) — اجرای واقعی بدون مرورگر:
   سه مسیر تازه روی یک MKV ساختگی (H.264 + دو صدای AAC + یک زیرنویس SRT) و یک
   MP4 ساختگی (ویدئو + زیرنویس tx3g) سنجیده می‌شود:
     /api/stream/tracks → فهرست ترک‌ها (JSON) و آدرس زیرنویس‌ها
     /api/stream/sub    → زیرنویس داخلی به‌صورت WebVTT
     /api/stream/remux  → MKV به fMP4 تکه‌تکه (ftyp+moov و moof+mdat)
   اگر این تست سبز باشد یعنی مرورگر برای پخش MKV و زیرنویس نرم به هیچ کتابخانهٔ
   سمت کلاینت نیاز ندارد: کار در خود Worker انجام می‌شود. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { apiStreamTracks, apiStreamSub, apiStreamRemux, srvMkvHeader, srvCuesToVtt, srvVttTime,
         streamTokenMake, getSettings, bustSettings, memRate, streamBuild };`).toString('base64'));

/* ── ابزار بایت ── */
const ui8 = (a) => new Uint8Array(a);
const cat = (...p) => { let n = 0; for (const x of p) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const utf8 = (s) => new TextEncoder().encode(s);
const u16 = (n) => ui8([(n >> 8) & 255, n & 255]);
const u32 = (n) => ui8([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const box = (t, ...payload) => { const b = cat(...payload); return cat(u32(b.length + 8), utf8(t), b); };
const full = (t, v, f, ...p) => box(t, ui8([v, (f >> 16) & 255, (f >> 8) & 255, f & 255]), ...p);

/* ══════════ MKV ساختگی ══════════ */
const sz = (n) => { for (let len = 1; len <= 8; len++) { const max = Math.pow(2, 7 * len) - 2; if (n <= max) { const b = new Array(len).fill(0); let v = n; for (let i = len - 1; i >= 0; i--) { b[i] = v & 255; v = Math.floor(v / 256); } b[0] |= (0x100 >> len) & 255; return ui8(b); } } throw new Error('big'); };
const el = (id, payload) => cat(id, sz(payload.length), payload);
const uint = (n, len) => { const b = new Array(len).fill(0); for (let i = len - 1; i >= 0; i--) { b[i] = n & 255; n = Math.floor(n / 256); } return ui8(b); };
const str = (s) => cat(utf8(s), ui8([0]));
const f64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return b; };
const ID = {
  ebml: ui8([0x1A, 0x45, 0xDF, 0xA3]), seg: ui8([0x18, 0x53, 0x80, 0x67]),
  info: ui8([0x15, 0x49, 0xA9, 0x66]), tScale: ui8([0x2A, 0xD7, 0xB1]), dur: ui8([0x44, 0x89]),
  tracks: ui8([0x16, 0x54, 0xAE, 0x6B]), entry: ui8([0xAE]),
  tNo: ui8([0xD7]), tType: ui8([0x83]), codec: ui8([0x86]), priv: ui8([0x63, 0xA2]),
  name: ui8([0x53, 0x6E]), lang: ui8([0x22, 0xB5, 0x9C]),
  video: ui8([0xE0]), w: ui8([0xB0]), h: ui8([0xBA]),
  audio: ui8([0xE1]), rate: ui8([0xB5]), ch: ui8([0x9F]),
  cluster: ui8([0x1F, 0x43, 0xB6, 0x75]), clTime: ui8([0xE7]), block: ui8([0xA3]),
  group: ui8([0xA0]), blk: ui8([0xA1]), blkDur: ui8([0x9B]),
  cues: ui8([0x1C, 0x53, 0xBB, 0x6B]), cuePoint: ui8([0xBB]), cueTime: ui8([0xB3]),
  cuePos: ui8([0xB7]), cueCluster: ui8([0xF1]),
};
const AVCC = ui8([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const ASC = ui8([0x12, 0x10]);
const trk = (no, type, codec, priv, extra, nm, lg) => el(ID.entry, cat(
  el(ID.tNo, uint(no, 1)), el(ID.tType, uint(type, 1)), el(ID.codec, str(codec)),
  nm ? el(ID.name, str(nm)) : new Uint8Array(0), lg ? el(ID.lang, str(lg)) : new Uint8Array(0),
  priv ? el(ID.priv, priv) : new Uint8Array(0), extra || new Uint8Array(0)));
const vTrack = trk(1, 1, 'V_MPEG4/ISO/AVC', AVCC, el(ID.video, cat(el(ID.w, uint(1280, 2)), el(ID.h, uint(720, 2)))), 'Video', 'und');
const aTrack = (no, nm, lg) => trk(no, 2, 'A_AAC', ASC, el(ID.audio, cat(el(ID.rate, f64(48000)), el(ID.ch, uint(2, 1)))), nm, lg);
const sTrack = trk(4, 0x11, 'S_TEXT/UTF8', null, null, 'زیرنویس فارسی', 'fas');
const SUBS = ['سلام دنیا', 'خط دوم'];
const block = (track, rel, key, frame) => cat(ui8([0x80 | track]), uint(rel < 0 ? rel + 65536 : rel, 2), ui8([key ? 0x80 : 0]), frame);

function buildMkv(cueOffsets) {
  const info = el(ID.info, cat(el(ID.tScale, uint(1000000, 3)), el(ID.dur, f64(4000.0))));
  const tracks = el(ID.tracks, cat(vTrack, aTrack(2, 'Original', 'eng'), aTrack(3, 'دوبله فارسی', 'fas'), sTrack));
  const cuesEl = el(ID.cues, cat(...[0, 1].map((i) => el(ID.cuePoint, cat(
    el(ID.cueTime, uint(i * 1000, 4)),
    el(ID.cuePos, cat(el(ID.cueCluster, uint(cueOffsets[i] || 0, 8)))))))));
  const clusters = [];
  let clusterPos = 0;
  for (let c = 0; c < 2; c++) {
    const parts = [el(ID.clTime, uint(c * 1000, 2))];
    for (let i = 0; i < 10; i++) {
      parts.push(el(ID.block, block(1, i * 100, i === 0, cat(ui8([0, 0, 0, 2, 0x65, 0x40 + (i % 3)]), new Uint8Array(40).fill(c * 10 + i)))));
    }
    parts.push(el(ID.block, block(2, 0, true, ui8([0x21, 0x10, c]))));
    parts.push(el(ID.block, block(3, 0, true, ui8([0x21, 0x11, c]))));
    if (c === 0) {
      /* زیرنویس در BlockGroup با BlockDuration (کاری که mkvmerge می‌کند) */
      parts.push(el(ID.group, cat(el(ID.blk, block(4, 0, false, utf8(SUBS[0]))), el(ID.blkDur, uint(900, 2)))));
    } else {
      parts.push(el(ID.block, block(4, 0, false, utf8(SUBS[1]))));
    }
    clusters.push({ body: el(ID.cluster, cat(...parts)), time: c * 1000 });
  }
  /* اندازهٔ Cues با مقدارهای صفر و واقعی یکی است (۸ بایتی) */
  const head = cat(info, tracks, cuesEl);
  let off = head.length;
  for (const c of clusters) { clusterPos = off; void clusterPos; off += c.body.length; }
  return { bytes: cat(el(ID.ebml, ui8([1, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])), el(ID.seg, cat(head, ...clusters.map((c) => c.body)))), headLen: head.length, clusters };
}
/* دو پاس: اول اندازه‌ها، بعد آفست‌های واقعی خوشه‌ها */
const pass1 = buildMkv([]);
const CLUSTER_OFFSETS = (() => {
  const out = [];
  let off = pass1.headLen;
  for (const c of pass1.clusters) { out.push(off); off += c.body.length; }
  return out;
})();
const MKV = buildMkv(CLUSTER_OFFSETS).bytes;
const MKV_HDR = W.srvMkvHeader(MKV);
assert.equal(MKV_HDR.ok, true);
assert.equal(MKV_HDR.tracks.length, 4, 'Tracks باید ۴ ترک داشته باشد');
assert.equal(MKV_HDR.durationMs, 4000);
assert.ok(MKV_HDR.cuesAt > 0, 'آفست Cues باید پیدا شود');

/* ══════════ MP4 ساختگی (ویدئو + زیرنویس tx3g) ══════════ */
const MP4_SUBS = ['سلام دنیا', 'خط دوم'];
const tx3gSamples = MP4_SUBS.map((t) => { const b = utf8(t); return cat(u16(b.length), b); });
const ftyp = box('ftyp', utf8('isom'), u32(512), utf8('isomiso2avc1mp41'));
const mdat = box('mdat', ...tx3gSamples);
const sampleOff = [ftyp.length + 8, ftyp.length + 8 + tx3gSamples[0].length];
const avc1 = box('avc1', ui8(new Array(6).fill(0)), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(640), u16(360), u32(0x00480000), u32(0x00480000), u32(0), u16(1), ui8(new Array(32).fill(0)), u16(0x0018), u16(0xffff), box('avcC', AVCC));
const tx3g = box('tx3g', ui8(new Array(6).fill(0)), u16(1), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(1), u32(12));
function mp4Trak(kind, id, ts, sampleEntry, sizes, dur, offsets, lang) {
  const n = sizes.length;
  const stts = full('stts', 0, 0, u32(n), ...sizes.flatMap(() => [u32(1), u32(dur)]));
  const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
  const stsz = full('stsz', 0, 0, u32(0), u32(n), ...sizes.map((s) => u32(s)));
  const stco = full('stco', 0, 0, u32(n), ...offsets.map((o) => u32(o)));
  const stbl = box('stbl', full('stsd', 0, 0, u32(1), sampleEntry), stts, stsc, stsz, stco);
  const hdlr = full('hdlr', 0, 0, u32(0), utf8(kind), u32(0), u32(0), u32(0), utf8(kind + 'Hand\0'));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(n * dur), u16(0x55C4), u16(0));
  /* tkhd v0: ۵ فیلد ۴بایتی (۲۰) + reserved(8) + layer/alt/volume/reserved(8) +
     matrix(36) = ۷۲ بایت، بعد width و height (۱۶.۱۶ ثابت) */
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(0), ui8(new Array(52).fill(0)),
    u32(kind === 'vide' ? 640 << 16 : 0), u32(kind === 'vide' ? 360 << 16 : 0));
  void lang;
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', stbl)));
}
const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(4000), u32(0x00010000), u16(0x100), u16(0), ui8(new Array(8).fill(0)), ui8(new Array(36).fill(0)), ui8(new Array(24).fill(0)), u32(3));
const moov = box('moov', mvhd,
  mp4Trak('vide', 1, 1000, avc1, [200, 200], 1000, [ftyp.length + 8, ftyp.length + 208]),
  mp4Trak('sbtl', 4, 1000, tx3g, tx3gSamples.map((s) => s.length), 2000, sampleOff));
const MP4 = cat(ftyp, mdat, moov);

/* ══════════ محیط: مبدأ جعلی با Range ══════════ */
const ORIGIN_MKV = 'https://cdn.example.com/movies/demo.mkv';
const ORIGIN_MP4 = 'https://cdn.example.com/movies/demo.mp4';
const FILES = { [ORIGIN_MKV]: MKV, [ORIGIN_MP4]: MP4 };
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, opts) => {
  const key = String(u);
  calls.push({ url: key, range: (opts && opts.headers && (opts.headers.range || opts.headers.Range)) || '' });
  const body = FILES[key];
  if (!body) return new Response('nope', { status: 404 });
  const rg = String((opts && opts.headers && (opts.headers.range || opts.headers.Range)) || '');
  const m = /^bytes=(\d*)-(\d*)$/.exec(rg);
  if (!m) return new Response(body, { status: 200, headers: { 'content-type': 'video/x-matroska', 'content-length': String(body.length) } });
  const total = body.length;
  const a = m[1] === '' ? Math.max(0, total - (Number(m[2]) || 0)) : Number(m[1]);
  const b = (m[1] === '' || m[2] === '') ? total - 1 : Math.min(total - 1, Number(m[2]));
  if (a > b) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + total } });
  const part = body.subarray(a, b + 1);
  return new Response(part, { status: 206, headers: { 'content-type': 'video/x-matroska', 'content-length': String(part.length), 'content-range': 'bytes ' + a + '-' + b + '/' + total } });
};

/* ══════════ store و تنظیمات ══════════ */
const data = new Map();
const store = {
  kv: {}, env: {},
  get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
  set: async (k, v) => { data.set(k, structuredClone(v)); },
  list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
};
const settings = { streamEnabled: true, secret: 'test-secret-0123456789abcdef0123456789', streamSecret: 'edge-secret-0123456789abcdef0123456789' };
data.set('set', settings);
W.bustSettings();
const set = await W.getSettings(store);
assert.equal(set.streamSecret, settings.streamSecret, 'streamSecret باید از تنظیمات خوانده شود');

const TOKEN = await W.streamTokenMake(set.streamSecret, {
  v: 1, k: 'v', u: ORIGIN_MKV, e: Math.floor(Date.now() / 1000) + 3600, s: 'sid-test', f: 'mkv', d: 1, o: [],
});
const TOKEN_MP4 = await W.streamTokenMake(set.streamSecret, { v: 1, k: 'v', u: ORIGIN_MP4, e: Math.floor(Date.now() / 1000) + 3600, s: 'sid-test2', f: 'mp4', d: 1, o: [] });
const TOKEN_NODEMUX = await W.streamTokenMake(set.streamSecret, { v: 1, k: 'v', u: ORIGIN_MKV, e: Math.floor(Date.now() / 1000) + 3600, s: 'sid3', f: 'mp4', d: 0, o: [] });
const TOKEN_EXPIRED = await W.streamTokenMake(set.streamSecret, { v: 1, k: 'v', u: ORIGIN_MKV, e: Math.floor(Date.now() / 1000) - 60, s: 'sid4', f: 'mkv', d: 1, o: [] });

const req = (path, dest) => new Request('https://site.example' + path, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/124.0', 'sec-fetch-dest': dest || 'empty' } });

/* ══════════ ۱) فهرست ترک‌ها ══════════ */
{
  const url = new URL('https://site.example/api/stream/tracks?t=' + TOKEN);
  const res = await W.apiStreamTracks(store, req(url.pathname + url.search), url);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.container, 'mkv');
  assert.equal(j.duration, 4);
  assert.equal(j.tracks.video.length, 1);
  assert.equal(j.tracks.video[0].codec, 'V_MPEG4/ISO/AVC');
  assert.equal(j.tracks.video[0].width, 1280);
  assert.equal(j.tracks.audio.length, 2, 'دو ترک صدا');
  assert.equal(j.tracks.audio[1].label.indexOf('دوبله فارسی'), 0, 'نام ترک دوبله باید از فایل بیاید');
  assert.equal(j.tracks.subs.length, 1);
  const sub = j.tracks.subs[0];
  assert.equal(sub.no, 4);
  assert.equal(sub.supported, true);
  assert.equal(sub.srclang, 'fa', 'fas باید به fa نرمال شود');
  assert.ok(sub.src.indexOf('/api/stream/sub?t=') === 0 && sub.src.indexOf('track=4') > 0, 'آدرس زیرنویس باید آماده باشد');
  assert.equal(j.remux.ok, true, 'MKV با H.264/AAC باید قابل remux باشد');
  assert.ok(j.remux.src.indexOf('/api/stream/remux?t=') === 0);
  assert.deepEqual(j.remux.audio, [2, 3]);
  console.log('PASS: /api/stream/tracks — ترک‌های صدا/زیرنویس/ویدئو + آدرس زیرنویس + توانمندی remux.');
}

/* ══════════ ۲) زیرنویس داخلی → WebVTT ══════════ */
{
  const url = new URL('https://site.example/api/stream/sub?t=' + TOKEN + '&track=4');
  const res = await W.apiStreamSub(store, req(url.pathname + url.search, 'track'), url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/vtt; charset=utf-8');
  assert.equal(res.headers.get('x-mvx-track'), '4');
  const vtt = await res.text();
  assert.ok(vtt.startsWith('WEBVTT'), 'خروجی باید WebVTT باشد');
  assert.ok(vtt.indexOf('00:00:00.000 --> 00:00:00.900') > 0, 'کیوی اول و مدت BlockDuration');
  assert.ok(vtt.indexOf('سلام دنیا') > 0, 'متن فارسی باید سالم باشد');
  assert.ok(vtt.indexOf('خط دوم') > 0, 'کیوی دوم از SimpleBlock');
  assert.ok(vtt.indexOf('00:00:01.000') > 0, 'زمان کیوی دوم از Timecode خوشه');
  assert.equal(res.headers.get('x-mvx-partial'), '0', 'فایل کوچک در یک بار اسکن تمام می‌شود');
  const again = await W.apiStreamSub(store, req(url.pathname + url.search, 'track'), url);
  assert.equal(await again.text(), vtt, 'درخواست دوم از کش همان خروجی را می‌دهد');
  console.log('PASS: /api/stream/sub — استخراج SRT داخلی (SimpleBlock + BlockGroup) و تبدیل به WebVTT فارسی.');
}

/* ══════════ ۳) زیرنویس MP4 (tx3g) ══════════ */
{
  const url = new URL('https://site.example/api/stream/sub?t=' + TOKEN_MP4 + '&track=4');
  const before = calls.length;
  const res = await W.apiStreamSub(store, req(url.pathname + url.search, 'track'), url);
  assert.equal(res.status, 200);
  /* نمونه‌های پراکنده در یک بازه خوانده می‌شوند (سهمیهٔ subrequest) */
  assert.ok(calls.length - before <= 3, 'زیرنویس MP4 با چند درخواست بازه‌ایِ دسته‌ای خوانده می‌شود (' + (calls.length - before) + ')');
  assert.equal(res.headers.get('x-mvx-partial'), '0');
  const vtt = await res.text();
  assert.ok(vtt.indexOf('سلام دنیا') > 0, 'زیرنویس tx3g باید استخراج شود');
  assert.ok(vtt.indexOf('00:00:02.000 --> 00:00:04.000') > 0, 'زمان از جدول stts');
  const t = new URL('https://site.example/api/stream/tracks?t=' + TOKEN_MP4);
  const j = await (await W.apiStreamTracks(store, req(t.pathname + t.search), t)).json();
  assert.equal(j.container, 'mp4');
  assert.equal(j.tracks.subs.length, 1);
  assert.equal(j.tracks.subs[0].supported, true);
  assert.equal(j.tracks.video[0].width, 640, 'پهنای ترک ویدئو از tkhd');
  assert.equal(j.remux.ok, false, 'برای MP4 مسیر remux لازم نیست');
  console.log('PASS: /api/stream/tracks + sub روی MP4 — زیرنویس tx3g با جدول نمونه‌ها استخراج شد.');
}

/* ══════════ ۴) remux: MKV → fMP4 ══════════ */
function topBoxes(bytes) {
  const out = [];
  let p = 0;
  while (p + 8 <= bytes.length) {
    const size = (bytes[p] * 0x1000000) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3];
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (size < 8 || p + size > bytes.length) break;
    out.push({ type, body: bytes.subarray(p + 8, p + size), size });
    p += size;
  }
  return out;
}
function walkBoxes(bytes, start, end, type) {
  return topBoxes(bytes.subarray(start, end)).filter((b) => b.type === type);
}
{
  const url = new URL('https://site.example/api/stream/remux?t=' + TOKEN + '&audio=2');
  const res = await W.apiStreamRemux(store, req(url.pathname + url.search, 'video'), url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('x-mvx-audio'), '2');
  const bytes = new Uint8Array(await new Response(res.body).arrayBuffer());
  const tops = topBoxes(bytes);
  const types = tops.map((b) => b.type);
  assert.equal(types[0], 'ftyp');
  assert.equal(types[1], 'moov', 'init segment بلافاصله می‌آید');
  assert.ok(types.indexOf('moof') > 0 && types.indexOf('mdat') > 0, 'تکه‌های fMP4 باید moof+mdat باشند');

  /* moov: دو ترک (ویدئو + یک صدا) و کدک‌های درست */
  const moov = tops[1].body;
  const traks = walkBoxes(moov, 0, moov.length, 'trak');
  assert.equal(traks.length, 2, 'فقط یک ترک صدا در هر جریان remux');
  const moovStr = Buffer.from(moov).toString('latin1');
  assert.ok(moovStr.indexOf('avc1') > 0, 'نمونهٔ ویدئو avc1');
  assert.ok(moovStr.indexOf('avcC') > 0, 'پیکربندی H.264 منتقل شود');
  assert.ok(moovStr.indexOf('mp4a') > 0, 'نمونهٔ صدا mp4a');
  assert.ok(moovStr.indexOf('esds') > 0, 'پیکربندی AAC منتقل شود');
  assert.ok(moovStr.indexOf('mvex') > 0 && moovStr.indexOf('trex') > 0, 'moov باید mvex داشته باشد');

  /* شمارش نمونه‌ها: ۲ خوشه × ۱۰ فریم ویدئو، ۲ خوشه × ۱ بستهٔ صدا */
  let vSamples = 0, aSamples = 0, videoFrames = 0, audioFrames = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i].type !== 'moof') continue;
    const traf = walkBoxes(tops[i].body, 0, tops[i].body.length, 'traf')[0];
    const tfhd = walkBoxes(traf.body, 0, traf.body.length, 'tfhd')[0].body;
    const trackId = (tfhd[4] * 0x1000000) + (tfhd[5] << 16) + (tfhd[6] << 8) + tfhd[7];
    const trun = walkBoxes(traf.body, 0, traf.body.length, 'trun')[0].body;
    const count = (trun[4] * 0x1000000) + (trun[5] << 16) + (trun[6] << 8) + trun[7];
    const dataOffset = (trun[8] * 0x1000000) + (trun[9] << 16) + (trun[10] << 8) + trun[11];
    /* data-offset باید به ابتدای mdat بعد از moof اشاره کند */
    assert.equal(dataOffset, tops[i].size + 8, 'data-offset باید درست باشد');
    const mdat = tops[i + 1];
    assert.equal(mdat.type, 'mdat');
    let sum = 0;
    /* trun: version/flags(4) + count(4) + data-offset(4) + هر نمونه ۱۲ بایت (duration,size,flags) */
    for (let k = 0; k < count; k++) sum += (trun[12 + k * 12 + 4] * 0x1000000) + (trun[12 + k * 12 + 5] << 16) + (trun[12 + k * 12 + 6] << 8) + trun[12 + k * 12 + 7];
    assert.equal(mdat.body.length, sum, 'اندازهٔ mdat باید مجموع نمونه‌ها باشد');
    if (trackId === 1) { vSamples += count; videoFrames += count; } else { aSamples += count; audioFrames += count; }
  }
  assert.equal(videoFrames, 20, '۲۰ فریم ویدئو از دو خوشه');
  assert.equal(audioFrames, 2, '۲ بستهٔ صدای ترک انتخاب‌شده');
  assert.ok(vSamples === 20 && aSamples === 2);

  /* tfdt اولین fragment ویدئو = ۰ و دومی = ۱۰۰۰ میلی‌ثانیه */
  const vidTfdt = [];
  for (let i = 0; i < tops.length; i++) {
    if (tops[i].type !== 'moof') continue;
    const traf = walkBoxes(tops[i].body, 0, tops[i].body.length, 'traf')[0];
    const tfhd = walkBoxes(traf.body, 0, traf.body.length, 'tfhd')[0].body;
    const trackId = (tfhd[4] * 0x1000000) + (tfhd[5] << 16) + (tfhd[6] << 8) + tfhd[7];
    if (trackId !== 1) continue;
    const tfdt = walkBoxes(traf.body, 0, traf.body.length, 'tfdt')[0].body;
    const hi = (tfdt[4] * 0x1000000) + (tfdt[5] << 16) + (tfdt[6] << 8) + tfdt[7];
    const lo = (tfdt[8] * 0x1000000) + (tfdt[9] << 16) + (tfdt[10] << 8) + tfdt[11];
    vidTfdt.push(hi * 4294967296 + lo);
  }
  assert.deepEqual(vidTfdt, [0, 1000], 'زمان پایهٔ تکه‌ها باید مطلق (میلی‌ثانیه) باشد');
  console.log('PASS: /api/stream/remux — MKV به fMP4 تکه‌تکه (ftyp/moov/mvex + moof/mdat) با avc1+mp4a و آفست‌های درست.');
}

/* ══════════ ۵) remux از ثانیهٔ دلخواه (جهش) ══════════ */
{
  calls.length = 0;
  const url = new URL('https://site.example/api/stream/remux?t=' + TOKEN + '&audio=3&start=1');
  const res = await W.apiStreamRemux(store, req(url.pathname + url.search, 'video'), url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-mvx-start'), '1');
  const bytes = new Uint8Array(await new Response(res.body).arrayBuffer());
  const tops = topBoxes(bytes);
  const moovStr = Buffer.from(tops[1].body).toString('latin1');
  assert.ok(moovStr.indexOf('mp4a') > 0);
  /* باید فقط از خوشهٔ دوم (زمان ۱۰۰۰) شروع شود */
  const firstMoof = tops.filter((b) => b.type === 'moof')[0];
  const traf = walkBoxes(firstMoof.body, 0, firstMoof.body.length, 'traf')[0];
  const tfdt = walkBoxes(traf.body, 0, traf.body.length, 'tfdt')[0].body;
  const hi = (tfdt[4] * 0x1000000) + (tfdt[5] << 16) + (tfdt[6] << 8) + tfdt[7];
  const lo = (tfdt[8] * 0x1000000) + (tfdt[9] << 16) + (tfdt[10] << 8) + tfdt[11];
  assert.equal(hi * 4294967296 + lo, 1000, 'با start=1 باید از نزدیک‌ترین خوشه (۱۰۰۰ms) شروع شود');
  const clusterAbs = MKV_HDR.segmentData + CLUSTER_OFFSETS[1];
  const usedRange = calls.filter((c) => c.range && c.range.indexOf('bytes=' + clusterAbs) === 0);
  assert.ok(usedRange.length > 0, 'بایت‌ها باید از آفست همان خوشه خوانده شوند (نه از صفر)');
  console.log('PASS: /api/stream/remux — جهش با start/audio از آفست خوشهٔ درست read می‌شود.');
}

/* ══════════ ۶) دروازه‌ها ══════════ */
{
  const noTok = new URL('https://site.example/api/stream/tracks');
  const r1 = await W.apiStreamTracks(store, req(noTok.pathname), noTok);
  assert.equal(r1.status, 400);

  const badTok = new URL('https://site.example/api/stream/sub?t=' + 'a'.repeat(40) + '&track=4');
  const r2 = await W.apiStreamSub(store, req(badTok.pathname + badTok.search), badTok);
  assert.equal(r2.status, 403);

  const exp = new URL('https://site.example/api/stream/tracks?t=' + TOKEN_EXPIRED);
  const r3 = await W.apiStreamTracks(store, req(exp.pathname + exp.search), exp);
  assert.equal(r3.status, 410, 'توکن منقضی باید ۴۱۰ بدهد');

  const noDemux = new URL('https://site.example/api/stream/tracks?t=' + TOKEN_NODEMUX);
  const r4 = await W.apiStreamTracks(store, req(noDemux.pathname + noDemux.search), noDemux);
  assert.equal(r4.status, 403);
  assert.equal((await r4.json()).code, 'engine-only');

  const noTrack = new URL('https://site.example/api/stream/sub?t=' + TOKEN);
  const r5 = await W.apiStreamSub(store, req(noTrack.pathname + noTrack.search), noTrack);
  assert.equal(r5.status, 400);

  const wrongTrack = new URL('https://site.example/api/stream/sub?t=' + TOKEN + '&track=99');
  const r6 = await W.apiStreamSub(store, req(wrongTrack.pathname + wrongTrack.search), wrongTrack);
  assert.equal(r6.status, 404);
  console.log('PASS: دروازه‌ها — توکن لازم/معتبر/منقضی، پرچم engine، شمارهٔ ترک اشتباه.');
}

/* ══════════ ۷) داده‌های کمکی ══════════ */
assert.equal(W.srvVttTime(3723456), '01:02:03.456');
assert.equal(W.srvVttTime(0), '00:00:00.000');
const vtt = W.srvCuesToVtt([{ s: 5000, e: 1000, t: 'x' }, { s: 0, e: 1500, t: 'سلام' }]);
assert.ok(vtt.indexOf('00:00:00.000 --> 00:00:01.500\nسلام') > 0, 'کیوها مرتب و بی‌مدت منفی هستند');
console.log('PASS: قالب زمان WebVTT و مرتب‌سازی کیوها.');

/* ══════════ ۷) خروجی /api/stream/open: آدرس‌های media برای پلیر ══════════ */
{
  const item = { id: 'it1', title: 'نمونه', type: 'movie', posterSrc: '', gallery: [], versions: [] };
  const bag = { streams: [], streamSubs: [] };
  const picked = {
    stream: { id: 'v1', url: ORIGIN_MKV, fmt: 'mkv', quality: '720', label: '720p', subs: [] },
    bag: bag, track: 'dub', quality: '720', premium: false,
  };
  const user = { username: 'ali', tgId: '12345', role: 'user' };
  const info = await W.streamBuild(store, set, user, item, picked, 'sid-open', req('/api/stream/open', 'empty'), '', false);
  assert.equal(info.ok, true);
  assert.equal(info.fmt, 'mkv', 'کانتینر از magic خوانده می‌شود');
  assert.equal(info.demux, true, 'MKV همیشه موتور/پردازش لازم دارد');
  assert.ok(info.media && info.media.tracks.indexOf('/api/stream/tracks?t=') === 0, 'آدرس فهرست ترک‌ها در پاسخ');
  assert.ok(info.media.sub.indexOf('/api/stream/sub?t=') === 0 && info.media.sub.slice(-7) === '&track=', 'پیشوند آدرس زیرنویس');
  assert.ok(info.media.remux.indexOf('/api/stream/remux?t=') === 0, 'آدرس remux برای MKV');
  /* توکنِ داخل آدرس‌ها همان توکن پخش است و به d=1 ختم می‌شود */
  const tok = info.media.tracks.split('t=')[1];
  assert.equal(tok, info.src.split('/').pop(), 'همان توکن پخش، بدون آدرس مبدأ در صفحه');
  console.log('PASS: /api/stream/open — media.tracks/sub/remux برای پلیر، بدون افشای آدرس مبدأ.');
}

globalThis.fetch = realFetch;
console.log('\nهمهٔ تست‌های پردازش رسانه روی سرور سبز شد.');
