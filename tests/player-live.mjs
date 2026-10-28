/* بازتولید مسیر واقعی: /api/stream/open (موتور داخلی) → /sv/v/<توکن> → مبدأ،
   با همان هدرهایی که مرورگر می‌فرستد. اگر این تست سبز باشد، تحویل بایت‌ها از
   سمت سرور درست است و مشکل فقط محیط کاربر است؛ اگر قرمز باشد، همین‌جا دلیلش را می‌بینیم. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { streamTokenMake, apiStreamBytes, Store, bustSettings, getSettings, createTgUser, saveUser, saveItemRecord, makeToken, apiStreamOpen, applyStreamEntries, parseStreamLines, streamTokenOpen, streamOwnSecret };`).toString('base64'));

/* ── MP4 کوچک: یک ویدئو + دو صدا ── */
const ui8 = (a) => new Uint8Array(a);
const cat = (...p) => { let n = 0; for (const x of p) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const asc = (s) => new TextEncoder().encode(s);
const u16 = (n) => ui8([n >> 8 & 255, n & 255]);
const u32 = (n) => ui8([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const box = (t, ...p) => { const b = cat(...p); return cat(u32(b.length + 8), asc(t), b); };
const full = (t, v, f, ...p) => box(t, ui8([v, (f >> 16) & 255, (f >> 8) & 255, f & 255]), ...p);
function buildMp4() {
  const AVC_C = ui8([1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x28, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
  const esds = full('esds', 0, 0, cat(ui8([3, 25, 0, 2, 0, 4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 5, 2, 0x12, 0x10]), ui8([6, 1, 2])));
  const vSample = box('avc1', ui8(new Array(6).fill(0)), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(1280), u16(720), u32(0x00480000), u32(0x00480000), u32(0), u16(1), ui8(new Array(32).fill(0)), u16(0x0018), u16(0xffff), box('avcC', AVC_C));
  const aSample = box('mp4a', ui8(new Array(6).fill(0)), u16(1), u16(0), u16(0), u32(0), u32(0), u32(2), u16(16), u16(0), u16(0), u32(48000 << 16), esds);
  const tracks = [
    { kind: 'vide', id: 1, ts: 1000, sample: vSample, dur: 1000, sizes: [200, 200, 200, 200], name: 'Video' },
    { kind: 'soun', id: 2, ts: 48000, sample: aSample, dur: 1024, sizes: [90, 90, 90, 90], name: 'Original' },
    { kind: 'soun', id: 3, ts: 48000, sample: aSample, dur: 1024, sizes: [91, 91, 91, 91], name: 'دوبله فارسی' }
  ];
  const ftyp0 = box('ftyp', asc('isom'), u32(512), asc('isomiso2avc1mp41'));
  const mdatBody = cat(...tracks.flatMap((t) => t.sizes.map((s) => new Uint8Array(s).fill(1))));
  const base = ftyp0.length + 8;
  let cur = 0;
  const traks = tracks.map((t) => {
    const offs = t.sizes.map((s) => { const o = base + cur; cur += s; return o; });
    const stbl = box('stbl',
      box('stsd', ui8([0, 0, 0, 0]), u32(1), t.sample),
      full('stts', 0, 0, u32(1), u32(t.sizes.length), u32(t.dur)),
      full('stsc', 0, 0, u32(1), u32(1), u32(t.sizes.length), u32(1)),
      full('stsz', 0, 0, u32(0), u32(t.sizes.length), ...t.sizes.map((s) => u32(s))),
      full('stco', 0, 0, u32(t.sizes.length), ...offs.map((o) => u32(o))));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.ts), u32(t.sizes.length * t.dur), u16(0x55C4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), asc(t.kind), u32(0), u32(0), u32(0), asc(t.kind + 'h'));
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(0), ui8(new Array(60).fill(0)), u32(t.kind === 'vide' ? 1280 << 16 : 0), u32(t.kind === 'vide' ? 720 << 16 : 0));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, box('name', new TextEncoder().encode(t.name)), box('minf', stbl)));
  });
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(4000), u32(0x00010000), u16(0x100), ui8(new Array(10).fill(0)), ui8(new Array(36).fill(0)), ui8(new Array(24).fill(0)), u32(tracks.length + 1));
  return cat(ftyp0, box('mdat', mdatBody), box('moov', mvhd, ...traks));
}
const FILE = buildMp4();
const ORIGIN = 'https://cdn.origin.test/movie.mp4';

function originFetch(honorRange) {
  return async (u, opts) => {
    const url = String(u && u.url ? u.url : u);
    if (url.indexOf('cdn.origin.test') < 0) return new Response('nope', { status: 404 });
    const h = (opts && opts.headers) || {};
    const rg = String((h.range || h.Range || (h.get && h.get('range'))) || '');
    if (!rg) return new Response(FILE, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(FILE.length), 'accept-ranges': 'bytes' } });
    const m = /^bytes=(\d*)-(\d*)$/.exec(rg);
    const total = FILE.length;
    let a = m[1] === '' ? Math.max(0, total - (Number(m[2]) || 0)) : Number(m[1]);
    let b = (m[1] === '' || m[2] === '') ? total - 1 : Math.min(total - 1, Number(m[2]));
    if (!honorRange) return new Response(FILE, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(total) } });
    if (a > b) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + total } });
    const part = FILE.subarray(a, b + 1);
    return new Response(part, { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': String(part.length), 'content-range': 'bytes ' + a + '-' + b + '/' + total, 'accept-ranges': 'bytes' } });
  };
}

function memKV() {
  const data = new Map();
  return {
    data,
    get: async (k, o) => { const v = data.get(k); if (v == null) return null; return (o === 'json' || (o && o.type === 'json')) ? JSON.parse(v) : v; },
    put: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true })
  };
}

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const realFetch = globalThis.fetch;

async function scenario(honorRange) {
  const kv = memKV();
  const env = { KV: kv };
  const store = new W.Store(kv, env);
  W.bustSettings(store);
  await store.set('set', { secret: 'site-secret-123', siteName: 'Test', publicUrl: 'https://site.test', streamEnabled: true, streamPublic: true });
  const user = await W.createTgUser(store, { tgId: '2002', tgName: 'User', tgUsername: 'viewer' });
  user.role = 'free';
  await W.saveUser(store, user);
  const userTok = await W.makeToken(store, user);
  const movie = { id: 'i_mov1', type: 'movie', title: 'فیلم | Movie', access: 'free', genres: ['اکشن'], variants: { sub: {}, dub: {} }, episodes: [], seasons: [], updatedAt: 1 };
  W.applyStreamEntries(movie, W.parseStreamLines('720 دوبله ' + ORIGIN, { type: 'movie' }).entries);
  await W.saveItemRecord(store, movie);

  globalThis.fetch = originFetch(honorRange);
  const ctx = { waitUntil() { } };
  const body = { itemId: movie.id, epId: '', track: 'dub', quality: '720', streamId: '', sid: '', reason: 'engine', lastAdAt: 0, seen: {}, demux: true };
  const res = await W.apiStreamOpen(store, body, new Request('https://site.test/api/stream/open', {
    method: 'POST', headers: { authorization: 'Bearer ' + userTok, 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, origin: 'https://site.test', 'content-type': 'application/json' }
  }), ctx);
  const info = await res.json();
  assert.equal(res.status, 200, 'open: ' + JSON.stringify(info).slice(0, 200));
  assert.ok(info.src && /\/sv\/v\//.test(info.src), 'src از مسیر لبه: ' + info.src);
  assert.equal(info.demux, true, 'open با پرچم demux (موتور داخلی)');

  /* همان درخواستی که موتور در مرورگر می‌زند */
  const hit = async (rangeHeaders) => {
    const rq = new Request(info.src, {
      headers: Object.assign({ 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'user-agent': CHROME, referer: 'https://site.test/p/i_mov1', 'cf-connecting-ip': '5.6.7.8' }, rangeHeaders)
    });
    return W.default.fetch(rq, env, ctx);
  };
  const first = await hit({ range: 'bytes=0-524287' });
  return { info, first, store, env, ctx, hit };
}

{
  const sc1 = await scenario(true);
  const { info, first, hit, store } = sc1;
  const env2 = sc1.env, ctx2 = sc1.ctx;
  const deny = first.headers.get('x-mvx-deny') || '';
  const txt = first.status >= 400 ? (await first.clone().text()).slice(0, 120) : '';
  assert.equal(first.status, 206, 'بایت‌های موتور با موفقیت آمد (' + first.status + ' ' + deny + ' ' + txt + ')');
  assert.ok(first.headers.get('content-range'), 'content-range دارد');

  /* منطق نصب‌شده: پنجرهٔ دوم (Range) هم باید ۲۰۶ باشد */
  const len = FILE.length;
  const mid = Math.floor(len / 2);
  const second = await hit({ range: 'bytes=' + mid + '-' + (len - 1) });
  assert.equal(second.status, 206, 'پنجرهٔ دوم: ' + second.status + ' ' + (second.headers.get('x-mvx-deny') || ''));
  console.log('PASS: real /stream/open (reason=engine, demux) → /sv/v/<token> with sec-fetch-dest:empty → 206. Engine bytes are served for MP4.');

  /* مسیر پشتیبان: همان بایت‌ها از /api/stream/bytes — برای وقتی لبه رد می‌کند */
  const proxy = (a, b, extra) => W.default.fetch(new Request('https://site.test/api/stream/bytes?u=' + encodeURIComponent(info.src) + '&a=' + a + '&b=' + b + (extra || ''),
    { headers: { 'sec-fetch-dest': 'empty', 'user-agent': CHROME, referer: 'https://site.test/p/i_mov1' } }), env2, ctx2);
  const pr = await proxy(1000, 2000);
  const denyP = pr.status >= 400 ? (await pr.clone().text()).slice(0, 100) : '';
  assert.equal(pr.status, 206, 'بایت‌های پشتیبان: ' + pr.status + ' ' + denyP);
  const got = new Uint8Array(await pr.arrayBuffer());
  assert.equal(got.length, 1001, 'طول پنجرهٔ پشتیبان');
  assert.equal(pr.headers.get('content-range'), 'bytes 1000-2000/' + FILE.length, 'content-range پشتیبان');
  for (let i = 0; i < got.length; i += 53) assert.equal(got[i], FILE[1000 + i], 'بایت ' + i + ' پشتیبان');
  /* جریان باز (MKV): full=1 بدون سقف پنجره */
  const open = await proxy(500, '', '&full=1');
  assert.equal(open.status, 206, 'جریان باز پشتیبان: ' + open.status);
  const rest = new Uint8Array(await open.arrayBuffer());
  assert.equal(rest.length, FILE.length - 500, 'کل باقی فایل در جریان باز');
  /* توکن عادی (بدون پرچم موتور) نباید اجازهٔ خواندن از این مسیر بگیرد */
  const setNow = await W.getSettings(store);
  const plainToken = await W.streamTokenMake(setNow.streamSecret, { v: 1, k: 'v', u: ORIGIN, e: Math.floor(Date.now() / 1000) + 600, s: 'a'.repeat(24), f: 'mp4', d: 0 });
  const sDirect = await W.getSettings(store);
  const uDbg = new URL('https://site.test/api/stream/bytes?u=' + encodeURIComponent('https://site.test/sv/v/' + plainToken) + '&a=0&b=100');
  const rDbg = await W.apiStreamBytes(store, new Request(uDbg, { headers: { 'user-agent': CHROME } }), uDbg);
  assert.equal(rDbg.headers.get('x-mvx-deny'), 'engine-only', 'direct streamEnabled=' + sDirect.streamEnabled + ' got=' + (await rDbg.clone().text()).slice(0,60));
  const plain = await W.default.fetch(new Request('https://site.test/api/stream/bytes?u=' + encodeURIComponent('/sv/v/' + plainToken) + '&a=0&b=100', { headers: { 'user-agent': CHROME } }), env2, ctx2);
  assert.equal(plain.status, 403, 'توکن بدون d=1 رد می‌شود');
  assert.equal(plain.headers.get('x-mvx-deny'), 'engine-only', 'en=' + setNow.streamEnabled);
  /* توکن دستکاری‌شده هم رد می‌شود */
  const bogus = await W.default.fetch(new Request('https://site.test/api/stream/bytes?u=' + encodeURIComponent('/sv/v/' + plainToken.slice(0, 30) + 'x') + '&a=0&b=100', { headers: { 'user-agent': CHROME } }), env2, ctx2);
  assert.equal(bogus.status, 403, 'توکن نامعتبر رد می‌شود');
  console.log('PASS: fallback /api/stream/bytes returns byte-exact 206 windows (and open-ended streams for MKV).');
}

{
  globalThis.fetch = realFetch;
  /* مبدأ بدون Range: لبه باید خودش ۲۰۶ برش‌خورده بدهد */
  const { hit } = await scenario(false);
  const len = FILE.length, mid = 1200;
  const a = await hit({ range: 'bytes=0-' + (mid - 1) });
  const b = await hit({ range: 'bytes=' + mid + '-' + (len - 1) });
  assert.equal(a.status, 206, 'بدون Range، پنجرهٔ اول ۲۰۶ شد (' + a.status + ')');
  assert.equal(b.status, 206, 'بدون Range، پنجرهٔ دوم ۲۰۶ شد (' + b.status + ')');
  const bytes = new Uint8Array(await b.arrayBuffer());
  const expect = FILE.subarray(1200);
  assert.equal(bytes.length, expect.length, 'طول بدنهٔ برش‌خورده ' + bytes.length + ' != ' + expect.length);
  for (let i = 0; i < bytes.length; i += 97) assert.equal(bytes[i], expect[i], 'بایت ' + i + ' از برش یکسان است');
  console.log('PASS: origin without Range — the edge slices and returns byte-exact 206 windows.');
}

globalThis.fetch = realFetch;
