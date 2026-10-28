/* موتور MP4 داخل‌صفحه (MSE): خواندن moov/stbl، جدول نمونه، ترتیب زمانی (ctts/B-frame)،
   انتخاب کی‌فریم برای seek، edit-list (priming صدا)، واکشی نمونه‌ها از پنجرهٔ Range،
   زیرنویس داخلی tx3g/wvtt و ساخت fMP4 با آفست ترکیب.
   فایل تست بایت‌به‌بایت همین‌جا ساخته می‌شود تا هیچ وابستگی بیرونی نداشته باشیم. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { MVX_PLAYER_MODULE, streamMp4MoovInfo, streamMp4Layout, streamParseMp4Tracks };`).toString('base64'));
const win = {};
W.MVX_PLAYER_MODULE(win);
const M = win.MVX_MP4, K = win.MVX_MKV;
assert.ok(M && M.mp4IndexParse && M.mp4FindStart && M.mp4VttText && M.mp4FeedChunk, 'MVX_MP4 روی پنجره سوار می‌شود');
assert.ok(K && K.mp4Fragment && K.mp4Init, 'مبدل fMP4 مشترک با MKV موجود است');

/* ── سازندهٔ جعبه‌ها ── */
const u8 = (n) => new Uint8Array([n & 255]);
const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255]);
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const u64 = (n) => cat(u32(Math.floor(n / 0x100000000)), u32(n >>> 0));
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

/* ── جدول‌های نمونه ── */
const VIDEO_SIZES = [120, 90, 110];
const AUDIO1_SIZES = [40, 41];
const AUDIO2_SIZES = [42, 43];
const SUB_TEXT = 'سلام دنیا';
const SUB_BYTES = cat(u16(Buffer.byteLength(SUB_TEXT, 'utf8')), utf8(SUB_TEXT));
const VTT_SAMPLE = box('vttc', box('payl', utf8('Second cue')), box('sttg', utf8('align:center')));

const stts = (e) => full('stts', 0, 0, u32(e.length), ...e.map(([n, d]) => cat(u32(n), u32(d))));
const ctts = (e) => full('ctts', 1, 0, u32(e.length), ...e.map(([n, o]) => cat(u32(n), u32(o >>> 0))));
const stss = (l) => full('stss', 0, 0, u32(l.length), ...l.map(u32));
const stsz = (sizes) => full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32));
const stsc = (e) => full('stsc', 0, 0, u32(e.length), ...e.map(([f, n]) => cat(u32(f), u32(n), u32(1))));
const stco = (offs) => full('stco', 0, 0, u32(offs.length), ...offs.map(u32));
const hdlr = (kind, name) => full('hdlr', 0, 0, u32(0), ascii(kind), zero(12), utf8(name), u8(0));
const langCode = (lang) => {
  const c = [(lang.charCodeAt(0) - 0x60) & 31, (lang.charCodeAt(1) - 0x60) & 31, (lang.charCodeAt(2) - 0x60) & 31];
  return u16((c[0] << 10) | (c[1] << 5) | c[2]);
};
const avc1 = (w, h, avcC) => box('avc1',
  zero(6), u16(1), zero(16), u16(w), u16(h), u32(0x480000), u32(0x480000), u32(0), u16(1),
  zero(32), u16(0x18), u16(0xffff), box('avcC', avcC));
const mp4a = (ch, rate, asc) => {
  const dsi = cat(u8(0x05), u8(asc.length), asc);
  const dcd = cat(u8(0x04), u8(13 + dsi.length), u8(0x40), u8(0x15), zero(3), u32(0), u32(0), dsi);
  const es = cat(u8(0x03), u8(3 + dcd.length), u16(1), u8(0), dcd);
  return box('mp4a', zero(6), u16(1), zero(8), u16(ch), u16(16), u16(0), u16(0), u32(rate * 65536), full('esds', 0, 0, es));
};
const tx3g = () => box('tx3g', zero(6), u16(1), zero(4), u8(0), u8(0), u16(0), u32(0), zero(8), zero(12));
function trak(o) {
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(o.id), u32(0), u32(0), zero(8), u16(0), u16(0), u16(0), u16(0), zero(36), u32(0), u32(0));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(o.timescale), u32(0), langCode(o.lang || 'und'), u16(0));
  const edts = o.elst ? box('edts', full('elst', 0, 0, u32(o.elst.length), ...o.elst.map((e) => cat(u32(e.seg), u32(e.mt >>> 0), u32(0x00010000))))) : zero(0);
  const stbl = box('stbl', full('stsd', 0, 0, u32(1), o.entry), o.stts, o.ctts || zero(0), o.stss || zero(0), o.stsz, o.stsc, stco(o.chunks));
  const minf = box('minf', o.kind === 'vide' ? full('vmhd', 0, 1, zero(8)) : full('smhd', 0, 0, zero(4)), stbl);
  return box('trak', tkhd, edts, box('mdia', mdhd, hdlr(o.kind, o.name || ''), minf));
}
const AVC_C = new Uint8Array([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
const ASC = new Uint8Array([0x12, 0x10]);

/* mdat: [ویدئو۰][صدا۱ ۰][صدا۲ ۰][زیرنویس][ویدئو۱][صدا۱ ۱][ویدئو۲][صدا۲ ۱] */
const payloads = [
  { t: 0, bytes: new Uint8Array(VIDEO_SIZES[0]).fill(0x11) },
  { t: 1, bytes: new Uint8Array(AUDIO1_SIZES[0]).fill(0x21) },
  { t: 2, bytes: new Uint8Array(AUDIO2_SIZES[0]).fill(0x31) },
  { t: 3, bytes: SUB_BYTES },
  { t: 0, bytes: new Uint8Array(VIDEO_SIZES[1]).fill(0x12) },
  { t: 1, bytes: new Uint8Array(AUDIO1_SIZES[1]).fill(0x22) },
  { t: 0, bytes: new Uint8Array(VIDEO_SIZES[2]).fill(0x13) },
  { t: 2, bytes: new Uint8Array(AUDIO2_SIZES[1]).fill(0x32) },
];
const mdatBody = cat(...payloads.map((p) => p.bytes));

const FTYP = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
function buildFile(moovLast) {
  const ftyp = FTYP;
  const makeMoov = (base) => {
    let o = base;
    const offs = payloads.map((p) => { const at = o; o += p.bytes.length; return at; });
    const of = (ti) => payloads.map((p, i) => (p.t === ti ? offs[i] : -1)).filter((x) => x >= 0);
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), zero(10), zero(12),
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(4));
    const video = trak({
      id: 1, kind: 'vide', timescale: 90000, name: 'VideoHandler',
      entry: avc1(1280, 720, AVC_C),
      stts: stts([[3, 3000]]),
      ctts: ctts([[1, 6012], [1, 3006], [1, 0]]),   /* B-frame */
      stss: stss([1]),
      stsz: stsz(VIDEO_SIZES), stsc: stsc([[1, 1]]), chunks: of(0),
    });
    const aud1 = trak({
      id: 2, kind: 'soun', timescale: 48000, name: 'SoundHandler',
      entry: mp4a(2, 48000, ASC),
      stts: stts([[2, 1024]]),
      elst: [{ seg: 2000, mt: 1024 }],              /* priming AAC */
      stsz: stsz(AUDIO1_SIZES), stsc: stsc([[1, 1]]), chunks: of(1),
    });
    const aud2 = trak({
      id: 3, kind: 'soun', timescale: 48000, lang: 'fas', name: 'فارسی',
      entry: mp4a(2, 48000, ASC),
      stts: stts([[2, 1024]]),
      stsz: stsz(AUDIO2_SIZES), stsc: stsc([[1, 1]]), chunks: of(2),
    });
    const sub = trak({
      id: 4, kind: 'sbtl', timescale: 1000, lang: 'eng', name: 'English',
      entry: tx3g(),
      stts: stts([[1, 2500]]),
      stsz: stsz([SUB_BYTES.length]), stsc: stsc([[1, 1]]), chunks: of(3),
    });
    return box('moov', mvhd, video, aud1, aud2, sub);
  };
  const probe = makeMoov(0);
  const moov = makeMoov(moovLast ? ftyp.length + 8 : ftyp.length + probe.length + 8);
  assert.equal(moov.length, probe.length, 'اندازهٔ moov با جای‌نگهدار ثابت می‌ماند');
  return moovLast ? cat(ftyp, box('mdat', mdatBody), moov) : cat(ftyp, moov, box('mdat', mdatBody));
}

const file = buildFile();
const moov = M.mp4FindMoovIn(file);
assert.ok(moov && !moov.partial, 'moov در سرِ فایل پیدا شد');
const idx = M.mp4IndexParse(file, moov, file.length);
assert.ok(idx, 'جدول نمونه‌ها ساخته شد');
assert.equal(idx.movieScale, 1000);
assert.equal(idx.tracks.length, 4, 'چهار ترک: ویدئو + دو صدا + زیرنویس');

const video = idx.tracks.find((t) => t.kind === 'video');
assert.equal(video.id, 1);
assert.equal(video.codec, 'avc1');
assert.equal(video.timescale, 90000);
assert.deepEqual([video.w, video.h], [1280, 720], 'ابعاد از نمونه‌ورودی avc1');
assert.deepEqual([...video.extra], [...AVC_C], 'avcC دست‌نخورده');
assert.equal(M.mp4CodecOf(video), 'avc1.4d4028', 'رشتهٔ کدک برای MediaSource');
assert.equal(video.count, 3);
assert.equal(M.mp4KeyAt(video, 0), true, 'نمونهٔ اول کی‌فریم است');
assert.equal(M.mp4KeyAt(video, 1), false);
assert.equal(M.mp4At(video.cdts, 1), 3000, 'dts نمونهٔ دوم');
assert.equal(M.mp4ValAt(video.cctts, 0), 6012, 'آفست ترکیب نمونهٔ اول (B-frame)');
assert.equal(M.mp4ValAt(video.cctts, 2), 0);
assert.equal(M.mp4ChunkKey(video, video.chunks[0]), true);
assert.equal(M.mp4ChunkKey(video, video.chunks[1]), false);

const audios = idx.tracks.filter((t) => t.kind === 'audio');
assert.equal(audios.length, 2, 'دو ترک صدا مثل فایل‌های دوبله‌دار');
assert.equal(audios[0].rate, 48000);
assert.equal(audios[0].ch, 2);
assert.deepEqual([...audios[0].extra], [...ASC], 'AudioSpecificConfig از esds بیرون کشیده شد');
assert.equal(M.mp4CodecOf(audios[0]), 'mp4a.40.2');
assert.equal(audios[0].shift, 1024, 'edit list: priming حذف می‌شود');
assert.equal(audios[1].lang, 'fas');
assert.equal(audios[1].name, 'فارسی', 'نام ترک صدا از hdlr');

const sub = idx.tracks.find((t) => t.kind === 'sub');
assert.equal(sub.codec, 'tx3g');
assert.equal(sub.name, 'English');

/* ترتیب چانک‌ها بر اساس آفست فایل = همان ترتیبی که خوانده می‌شود */
assert.equal(idx.order.length, payloads.length);
let prev = -1;
for (const c of idx.order) { assert.ok(c.off > prev, 'چانک‌ها صعودی مرتب شده‌اند'); prev = c.off; }
assert.equal(idx.order[0].ti, 0, 'اولین چانک در فایل، ویدئو است');

/* seek: از چانک کی‌فریم شروع می‌کنیم */
assert.equal(M.mp4FindStart({ video }, 0), video.chunks[0].mi);
assert.equal(M.mp4FindStart({ video }, 5), video.chunks[0].mi, 'زمانی که کی‌فریم تازه دارد → همان کی‌فریم');
assert.ok(M.mp4ChunkMs(video, video.chunks[2]) > 0);

/* ── مسیر واقعی «چانک ← نمونه»: برش بایت‌ها از بافر پنجره ── */
video.desc = { id: 1, kind: 'video', timescale: video.timescale, w: video.w, h: video.h, extra: video.extra };
audios[0].desc = { id: 2, kind: 'audio', timescale: audios[0].timescale, ch: audios[0].ch, rate: audios[0].rate, extra: audios[0].extra };
const m = {
  buf: file, base: 0, video, audio: audios[0], idx, vkey: false, pend: {}, fedTo: 0, seq: 1, queue: [],
  cues: { 4: { no: 4, cues: [] } },
};
for (const ch of idx.order) M.mp4FeedChunk(m, idx.tracks[ch.ti], ch);
const vlist = m.pend[1].list;
assert.equal(vlist.length, 3, 'هر سه نمونهٔ ویدئو از بایت‌های فایل بریده شد');
assert.deepEqual(vlist.map((s) => s.bt), [0, 3000, 6000], 'dts نمونه‌های ویدئو');
assert.deepEqual(vlist.map((s) => s.cts), [6012, 6006, 6000], 'cts از ctts (B-frame)');
assert.deepEqual(vlist.map((s) => s.key), [true, false, false], 'کی‌فریم از stss');
assert.deepEqual(vlist.map((s) => s.dur), [3000, 3000, 3000]);
assert.deepEqual([...vlist[1].data], [...payloads[4].bytes], 'بایت‌ها دست‌نخورده و از آفست درست');
assert.deepEqual([...vlist[0].data], [...payloads[0].bytes]);
const alist = m.pend[2].list;
assert.equal(alist.length, 1, 'نمونهٔ priming (dts منفی) دور ریخته شد');
assert.equal(alist[0].bt, 0);
assert.deepEqual([...alist[0].data], [...payloads[5].bytes], 'نمونهٔ صدای دوم فایل');
assert.ok(!m.pend[3], 'ترک صدای انتخاب‌نشده تغذیه نمی‌شود');
assert.equal(m.cues[4].cues.length, 1, 'زیرنویس داخلی tx3g استخراج شد');
assert.equal(m.cues[4].cues[0].t, SUB_TEXT);
assert.equal(m.cues[4].cues[0].s, 0);
assert.equal(m.cues[4].cues[0].e, 2500);
/* پنجرهٔ Range که از آفست غیرصفر شروع می‌شود (همان کاری که پمپ واقعی می‌کند) */
const cOff = video.chunks[1].off;
const m3 = { buf: file.subarray(cOff - 2), base: cOff - 2, video, audio: audios[0], vkey: true, pend: {}, fedTo: 0, seq: 1, queue: [], cues: {} };
M.mp4FeedChunk(m3, video, video.chunks[1]);
assert.deepEqual([...m3.pend[1].list[0].data], [...payloads[4].bytes], 'برش نمونه با آفست پایهٔ غیرصفر');
/* نمونه‌ای که کامل در پنجره نیست باید رد شود نه اینکه بایت نصفه بدهد */
const m4 = { buf: file.subarray(0, cOff + 10), base: 0, video, audio: audios[0], vkey: true, pend: {}, fedTo: 0, seq: 1, queue: [], cues: {} };
M.mp4FeedChunk(m4, video, video.chunks[1]);
assert.equal((m4.pend[1] || { list: [] }).list.length, 0, 'نمونهٔ ناقص کنار گذاشته می‌شود');

/* WebVTT داخل MP4 (wvtt → vttc/payl) */
assert.equal(M.mp4VttText(VTT_SAMPLE), 'Second cue');
assert.equal(M.mp4VttText(new Uint8Array([0, 0, 0, 99, 0x76, 0x74, 0x74, 0x63])), '', 'جعبهٔ ناقص کرش نمی‌کند');

/* ── fMP4: انتقال ctts در trun نسخهٔ ۱ ── */
const frag = K.mp4Fragment(video.desc, vlist, 1);
const fragStr = String.fromCharCode(...frag);
assert.ok(fragStr.includes('moof') && fragStr.includes('traf') && fragStr.includes('trun') && fragStr.includes('tfdt'));
const trunAt = fragStr.indexOf('trun');
assert.equal(frag[trunAt + 4], 1, 'نسخهٔ trun برای آفست ترکیب = ۱');
const trunFlags = (frag[trunAt + 5] << 16) | (frag[trunAt + 6] << 8) | frag[trunAt + 7];
assert.ok(trunFlags & 0x800, 'پرچم composition_time_offset روشن است');
const sampleCount = (frag[trunAt + 8] << 24) | (frag[trunAt + 9] << 16) | (frag[trunAt + 10] << 8) | frag[trunAt + 11];
assert.equal(sampleCount, 3);
const ctsAt = (i) => {
  const at = trunAt + 16 + i * 16;                 /* dur,size,flags,cts */
  return ((frag[at + 12] << 24) | (frag[at + 13] << 16) | (frag[at + 14] << 8) | frag[at + 15]) >>> 0;
};
assert.equal(ctsAt(0), 6012, 'composition offset نمونهٔ اول = 6012');
assert.equal(ctsAt(1), 3006);
assert.equal(ctsAt(2), 0);
const mdatAt = fragStr.indexOf('mdat') + 4;
assert.deepEqual([...frag.slice(mdatAt, mdatAt + VIDEO_SIZES[0])], [...payloads[0].bytes], 'mdat دست‌نخورده');
/* بدون اختلاف cts، trun باید مثل قبل نسخهٔ ۰ بماند (سازگاری با MKV) */
const plain = K.mp4Fragment(video.desc, [{ bt: 0, cts: 0, dur: 3000, key: true, data: new Uint8Array([9]) }], 2);
const plainStr = String.fromCharCode(...plain);
assert.equal(plain[plainStr.indexOf('trun') + 4], 0, 'بدون آفست ترکیب، نسخهٔ ۰');
/* init segment با کدک‌های استخراج‌شده از MP4 */
const initStr = String.fromCharCode(...K.mp4Init([video.desc, audios[0].desc]));
for (const b of ['ftyp', 'moov', 'avc1', 'avcC', 'mp4a', 'esds']) assert.ok(initStr.includes(b), 'init: ' + b);

/* ── probe سرور: moov بزرگ‌تر از سرِ بافر و moov ته فایل ── */
const headTrim = file.slice(0, moov.at + 120);   /* moov ناقص در سرِ بافر */
const info = W.streamMp4MoovInfo(headTrim);
assert.ok(info && info.partial, 'moov ناقص در سرِ بافر تشخیص داده می‌شود');
assert.ok(info.size > headTrim.length, 'اندازهٔ کامل moov از هدر خوانده می‌شود');
const moovBuf = file.slice(info.at, info.at + info.size);
const parsed = W.streamParseMp4Tracks(moovBuf, { body: info.hdr, end: moovBuf.length });
assert.equal(parsed.audio.length, 2, 'probe از moov کامل، هر دو ترک صدا را می‌بیند');
assert.equal(parsed.subs.length, 1);
assert.ok(parsed.video >= 1);
assert.equal(parsed.subs[0].fmt, 'tx3g');
/* بافری که از وسط فایل شروع می‌شود (moov در ته فایل) */
const tailBuf = file.slice(moov.at);
const tinfo = W.streamMp4MoovInfo(tailBuf);
assert.ok(tinfo && !tinfo.partial, 'moov در ته فایل پیدا شد');
assert.equal(W.streamParseMp4Tracks(tailBuf, tinfo).audio.length, 2);

/* ── فایل بدون faststart: moov بعد از mdat (چیدمان رایج تورنت) ── */
{
  const slow = buildFile(true);
  const lay = W.streamMp4Layout(slow.slice(0, 300));
  assert.equal(lay.moov, null, 'در سرِ فایل moov نیست');
  assert.ok(lay.mdatEnd > 0, 'پایان mdat از روی سرِ فایل محاسبه می‌شود');
  assert.equal(lay.mdatEnd, FTYP.length + 8 + mdatBody.length, 'آفست پایان mdat دقیق است');
  const win = slow.slice(lay.mdatEnd, lay.mdatEnd + 65536);
  const lay2 = W.streamMp4Layout(win);
  assert.ok(lay2.moov && !lay2.moov.partial, 'جعبهٔ بعد از mdat همان moov است');
  const g = W.streamParseMp4Tracks(win, lay2.moov);
  assert.equal(g.audio.length, 2);
  assert.equal(g.subs.length, 1);
  /* همان فایل با موتور کلاینت: جدول نمونه از moov ته فایل */
  const moovSlice = slow.slice(lay.mdatEnd);
  const idx2 = M.mp4IndexParse(moovSlice, M.mp4FindMoovIn(moovSlice), slow.length);
  assert.ok(idx2, 'ایندکس از moov ته فایل ساخته می‌شود');
  const v2 = idx2.tracks.find((t) => t.kind === 'video');
  assert.equal(v2.chunks[0].off, FTYP.length + 8, 'آفست نمونه‌ها مطلق و درست است');
  const m2 = { buf: slow, base: 0, video: v2, audio: idx2.tracks.find((t) => t.kind === 'audio'), idx: idx2, vkey: false, pend: {}, fedTo: 0, seq: 1, queue: [], cues: {} };
  v2.desc = { id: 1, kind: 'video', timescale: v2.timescale, w: v2.w, h: v2.h, extra: v2.extra };
  m2.audio.desc = { id: 2, kind: 'audio', timescale: m2.audio.timescale, ch: m2.audio.ch, rate: m2.audio.rate, extra: m2.audio.extra };
  for (const ch of idx2.order) M.mp4FeedChunk(m2, idx2.tracks[ch.ti], ch);
  assert.deepEqual([...m2.pend[1].list[0].data], [...payloads[0].bytes], 'نمونه‌ها با آفست درست خوانده می‌شوند');
}

console.log('PASS: MP4 in-page engine — moov/stbl parsing, multi audio tracks (VLC-style), edit-list priming, B-frame ctts → trun v1, keyframe seek, range window sample slicing, tx3g/wvtt embedded subtitles, server probe for huge/late moov, non-faststart (moov after mdat) layout.');
