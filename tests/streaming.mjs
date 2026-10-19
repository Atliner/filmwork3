/* پخش آنلاین: مدل داده و پارسر لینک‌ها، توکن رمزنگاری‌شده، لبهٔ پخش (داخلی و Worker جدا)،
   API شروع/تعویض/تمدید با تبلیغ، نشت‌نکردن لینک‌ها، بخش لینک پخش ربات سوم، پلیر و پنل. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { parseStreamLines, applyStreamEntries, streamLinesOf, publicStreamMap, publicVariantMap, pickStream, streamOptionsOf, streamTokenMake, streamTokenOpen, streamIpPrefix,
  streamBindHash, streamEdgeHandle, decodeSubtitleBytes, apiStreamOpen, apiStreamSrc, apiItem, Store, saveUser, saveItemRecord, createTgUser, makeToken,
  bustSettings, getSettings, contentBotAction, buildPlayerJs, handleAssets, APP_HTML, MVX_PLAYER_MODULE, handleAdmin, bustItem, decorateItemStreams, bustAds };`).toString('base64'));
const edgeMod = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(new URL('../scripts/stream-edge-worker.js', import.meta.url), 'utf8')).toString('base64'));
const edge = edgeMod.default;

/* ── ۱. پارسر لینک‌ها (قالب مشترک ربات و پنل) ── */
{
  const p = W.parseStreamLines([
    'S01E05 720 دوبله https://cdn.example.com/silo/s01e05-720.mp4 | WEB-DL',
    '• S01E05 1080p زیرنویس https://cdn.example.com/silo/s01e05-1080.mp4',
    'فصل ۲ قسمت ۳ ۴۸۰ زبان اصلی https://cdn.example.com/silo/s02e03-480.m3u8',
    'S01E05 زیرنویس https://cdn.example.com/silo/s01e05.fa.srt',
    '#نوع دوبله', '#کیفیت 1080', '#فصل 3',
    'قسمت 7 https://cdn.example.com/silo/ep7.mp4',
    'https://cdn.example.com/Silo.S04E02.720p.WEB-DL.Farsi.Dubbed.mp4',
    'S01E06 https://cdn.example.com/no-quality.mp4',
    'S01E06 720 https://cdn.example.com/x.mp4?q=1',
    'S01E06 720 دوبله http://192.168.1.5/private.mp4',
    'S01E08 720 دوبله https://cdn.example.com/ep8.mkv',
    'حذف S01E09 720 دوبله',
    'متن بی‌ربط',
  ].join('\n'), { type: 'series' });
  const e = p.entries;
  assert.equal(e[0].season, 1); assert.equal(e[0].episode, 5); assert.equal(e[0].quality, '720'); assert.equal(e[0].track, 'dub'); assert.equal(e[0].label, 'WEB-DL'); assert.equal(e[0].fmt, 'mp4');
  assert.equal(e[1].quality, '1080'); assert.equal(e[1].track, 'sub');
  assert.deepEqual([e[2].season, e[2].episode, e[2].quality, e[2].track, e[2].fmt], [2, 3, '480', 'sub', 'hls']);
  assert.equal(e[3].kind, 'subtitle'); assert.equal(e[3].lang, 'fa');
  assert.deepEqual([e[4].season, e[4].episode, e[4].quality, e[4].track], [3, 7, '1080', 'dub']); // پیش‌فرض‌های #نوع/#کیفیت/#فصل
  assert.deepEqual([e[5].season, e[5].episode, e[5].quality, e[5].track], [4, 2, '720', 'dub']); // از نام فایل
  // «S01E06 https://…/no-quality.mp4» با پیش‌فرض‌های بالا پذیرفته می‌شود؛ خط بعدی نوع را از پیش‌فرض می‌گیرد
  assert.equal(e[6].quality, '1080');
  assert.equal(e[7].track, 'dub');
  assert.equal(e[8].fmt, 'mkv');
  assert.ok(p.warnings.some(w => /MKV/.test(w.warning)));
  assert.ok(p.errors.some(x => /داخلی/.test(x.error)), 'آدرس شبکهٔ داخلی (SSRF) رد شود');
  assert.ok(p.errors.some(x => /لینک http/.test(x.error)));
  assert.deepEqual(p.removes, [{ season: 1, episode: 9, track: 'dub', quality: '720' }]);
  const strict = W.parseStreamLines('S01E01 https://cdn.example.com/a.mp4\nS01E02 720 https://cdn.example.com/b.mp4\n720 دوبله https://cdn.example.com/c.mp4', { type: 'series' });
  assert.ok(strict.errors.some(x => /کیفیت/.test(x.error)));
  assert.ok(strict.errors.some(x => /نوع نسخه/.test(x.error)));
  assert.ok(strict.errors.some(x => /فصل و قسمت/.test(x.error)));
  const movie = W.parseStreamLines('1080 دوبله https://cdn.example.com/m-1080.mp4\nhttps://cdn.example.com/m.en.vtt | English', { type: 'movie' });
  assert.equal(movie.errors.length, 0);
  assert.equal(movie.entries[1].lang, 'en'); assert.equal(movie.entries[1].label, 'English');
}
console.log('PASS: stream link parser (Persian/English words, defaults, filename inference, subtitles, removes, SSRF and format checks).');

/* ── ۲. اعمال روی اثر، نقشهٔ عمومی بدون لینک و انتخاب پخش ── */
const series = { id: 'i_ser1', type: 'series', title: 'سیلو | Silo', access: 'free', genres: ['درام'], seasons: [{ n: 1, title: 'فصل ۱', episodes: [{ id: 'e_aaaa', n: 5, title: 'قسمت ۵', variants: { sub: { '1080': { premium: true, files: [{ id: 'f_1', source: { chatId: '-1001', msgId: '1' } }] } }, dub: {} } }] }], episodes: [] };
{
  const p = W.parseStreamLines('S01E05 720 دوبله https://cdn.example.com/s01e05-720.mp4\nS01E05 1080 زیرنویس https://cdn.example.com/s01e05-1080.mp4\nS01E05 زیرنویس https://cdn.example.com/s01e05.fa.srt\nS01E06 720 دوبله https://cdn.example.com/s01e06-720.mp4', { type: 'series' });
  const r = W.applyStreamEntries(series, p.entries);
  assert.deepEqual([r.added, r.created], [4, 1]);
  const again = W.applyStreamEntries(series, p.entries);
  assert.equal(again.added, 0); assert.equal(again.updated, 4);
  const ep5 = series.seasons[0].episodes.find(e => e.n === 5);
  assert.equal(ep5.streams.length, 2); assert.equal(ep5.streamSubs.length, 1);
  const map = W.publicStreamMap(ep5, series);
  assert.deepEqual(Object.keys(map.dub), ['720']);
  assert.equal(map.sub['1080'].premium, true, 'قفل اشتراکِ کیفیت دانلود روی پخش همان کیفیت هم اعمال شود');
  assert.equal(map.subs, 1);
  assert.ok(!JSON.stringify(map).includes('cdn.example.com'));
  const pick = W.pickStream(series, { epId: ep5.id, track: 'dub' });
  assert.equal(pick.quality, '720'); assert.equal(pick.premium, false);
  assert.equal(W.pickStream(series, { epId: ep5.id, track: 'sub', quality: '1080' }).premium, true);
  assert.match(W.streamLinesOf(series), /S01E05 720p دوبله https:\/\/cdn\.example\.com\/s01e05-720\.mp4/);
  const rm = W.applyStreamEntries(series, [], { removes: [{ season: 1, episode: 6, track: '', quality: '' }] });
  assert.equal(rm.removed, 1);
}
console.log('PASS: stream entries merge/dedupe/remove, auto episode creation, premium inheritance and URL-free public map.');

/* ── ۲.الف. «لینک پخش آنلاین» هر نسخه (زیر لینک فایل) — بدون عنوان، ادغام با bag.streams ── */
{
  const series2 = { id: 'i_ser2', type: 'series', title: 'اثر تست', access: 'free', seasons: [{ n: 1, episodes: [{ id: 'e_pl1', n: 1, variants: {
    sub: { '720': { files: [{ id: 'f_a', title: 'نسخه ۱', source: { chatId: '-1001', msgId: '10' }, pl: 'https://cdn.example.com/play/720.mp4' }] } },
    dub: { '480': { label: 'دوبلاژ', files: [{ id: 'f_b', title: 'Filimo | 480p', source: { chatId: '-1001', msgId: '11' }, pl: 'https://cdn.example.com/play/480.m3u8' }] } }
  } }] }], episodes: [] };
  const ep = series2.seasons[0].episodes[0];
  const map = W.publicStreamMap(ep, series2);
  assert.deepEqual(Object.keys(map.sub), ['720']);
  assert.deepEqual(Object.keys(map.dub), ['480']);
  assert.ok(!JSON.stringify(map).includes('cdn.example.com'), 'نقشهٔ عمومی بدون لینک بماند');
  const pick = W.pickStream(series2, { epId: ep.id, track: 'dub' });
  assert.equal(pick.quality, '480');
  assert.equal(pick.stream.label, 'Filimo | 480p', 'عنوانِ نسخه روی لینک پخش می‌آید تا کاربر نسخه را در پلیر بشناسد');
  assert.equal(pick.stream.url, 'https://cdn.example.com/play/480.m3u8');
  assert.equal(pick.stream.fmt, 'hls');
  const pick2 = W.pickStream(series2, { epId: ep.id, track: 'sub', quality: '720' });
  assert.equal(pick2.stream.id, 'vf_f_a', 'شناسهٔ پخش از شناسهٔ فایل پایدار می‌ماند');
  assert.match(W.streamLinesOf(series2), /https:\/\/cdn\.example\.com\/play\/720\.mp4/);
  // ادغام با فهرست دستی: همان لینک دوبار شمرده نشود؛ نسخهٔ دارای عنوان مقدم است
  ep.streams = [{ id: 'v_1', track: 'sub', quality: '720', url: 'https://cdn.example.com/play/720.mp4', fmt: 'mp4', label: 'دستی' }];
  const map2 = W.publicStreamMap(ep, series2);
  assert.equal(map2.sub['720'].n, 1, 'همان لینک از فایل و فهرست دستی دوبار نمایش داده نشود');
  assert.equal(W.pickStream(series2, { epId: ep.id, track: 'sub', quality: '720' }).stream.label, 'دستی');
  delete ep.variants.sub['720'].files[0].pl;
  assert.deepEqual(Object.keys(W.publicStreamMap(ep, series2).sub), ['720'], 'فهرست دستی همچنان هست');
  delete ep.streams;
  assert.deepEqual(Object.keys(W.publicStreamMap(ep, series2).sub), [], 'بدون لینک پخش، آن کیفیت از نقشهٔ پخش می‌رود');
}

{
  /* ── ۲.ج) انتخاب دقیقِ نسخه در پلیر: دو نسخه از یک کیفیت، هر کدام با عنوان و شناسهٔ خودش ── */
  const it = { id: 'i_ver', type: 'movie', title: 'فیلم', access: 'free', variants: {
    sub: { '720': { files: [
      { id: 'f_1', title: '720p معمولی', source: { chatId: '-1', msgId: '1' }, pl: 'https://cdn.example.com/720.mp4' },
      { id: 'f_2', title: '720p.10bit', source: { chatId: '-1', msgId: '2' }, pl: 'https://cdn.example.com/720-10bit.mp4' },
      { id: 'f_3', title: '720p بدون پخش', source: { chatId: '-1', msgId: '3' } }
    ] } }
  } };
  const opts = W.streamOptionsOf(it, it, null);
  assert.equal(opts.sub.length, 2, 'فقط نسخه‌های دارای لینک پخش در فهرست پلیر می‌آیند');
  assert.equal(opts.sub[0].label, '720p معمولی', 'عنوان دقیقِ نسخه در پلیر دیده می‌شود');
  assert.equal(opts.sub[1].label, '720p.10bit');
  assert.notEqual(opts.sub[0].id, opts.sub[1].id, 'هر نسخه شناسهٔ جدا دارد');
  const pm = W.publicVariantMap(it, '720');
  assert.deepEqual(pm.sub['720'].files.map(f => !!f.pl), [true, true, false], 'پرچمِ پخشِ هر نسخه در دادهٔ صفحه هست');
  const p2 = W.pickStream(it, { track: 'sub', fileId: 'f_2' });
  assert.equal(p2.stream.id, 'vf_f_2', 'انتخاب دقیقِ نسخه با fileId');
  assert.equal(p2.stream.label, '720p.10bit');
}

console.log('PASS: per-version online-play link (title-less) merges into streams and drives playback.');

/* ── ۲.ب. ذخیرهٔ لینک پخش نسخه از همان مسیر عنوان/لینک فایل (endpoint نسخه) ── */
{
  const store = new W.Store(null, {});
  W.bustSettings(store);
  const admin = await W.createTgUser(store, { tgId: '7770009' });
  admin.role = 'admin';
  await W.saveUser(store, admin);
  const item = { id: 'i_pltest', type: 'movie', title: 'فیلم تست', access: 'free', variants: { sub: {}, dub: {} }, episodes: [] };
  await W.saveItemRecord(store, item);
  const u = (p) => new URL('http://localhost/api/admin' + p);
  const post = (p, body) => new Request(u(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await W.handleAdmin(store, u('/item/i_pltest/variant'), post('/item/i_pltest/variant', { track: 'dub', quality: '480', title: 'Filimo | 480p', url: 'https://t.me/c/1234567890/89', pl: 'https://cdn.example.com/play/480.mp4', addFile: true }), admin);
  assert.equal(r.status, 200);
  let saved = (await r.json()).item;
  let f = saved.variants.dub['480'].files[0];
  assert.equal(f.pl, 'https://cdn.example.com/play/480.mp4', 'لینک پخش کنار عنوان و لینک فایل ذخیره شود');
  assert.equal(f.title, 'Filimo | 480p');
  assert.equal(W.pickStream(saved, { track: 'dub' }).stream.url, 'https://cdn.example.com/play/480.mp4');
  r = await W.handleAdmin(store, u('/item/i_pltest/variant'), post('/item/i_pltest/variant', { track: 'dub', quality: '480', fileId: f.id, title: f.title, url: 'https://t.me/c/1234567890/89', pl: '' }), admin);
  saved = (await r.json()).item;
  assert.ok(!saved.variants.dub['480'].files[0].pl, 'خالی‌کردن فیلد = حذف لینک پخش');
  assert.ok(W.pickStream(saved, { track: 'dub' }).error, 'بدون لینک پخش، پخشی در کار نیست');
  r = await W.handleAdmin(store, u('/item/i_pltest/variant'), post('/item/i_pltest/variant', { track: 'dub', quality: '480', fileId: f.id, url: 'https://t.me/c/1234567890/89', pl: 'ftp://x' }), admin);
  assert.equal(r.status, 400, 'لینک پخش نامعتبر رد شود');
}
console.log('PASS: per-version play link saves through the same variant endpoint as title/file-link.');


/* ── ۳. توکن پخش و لبه (همان کد در worker.js و scripts/stream-edge-worker.js) ── */
execFileSync(process.execPath, [new URL('../scripts/build-stream-edge.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' });
const SECRET = 'edge-secret-0123456789abcdef';
const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const realFetch = globalThis.fetch;
const upstream = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  upstream.push({ url, headers: init.headers || {} });
  if (url.endsWith('.mp4')) {
    const range = (init.headers || {}).range;
    return new Response('VIDEO-BYTES', { status: range ? 206 : 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '11', ...(range ? { 'content-range': 'bytes 0-10/1000' } : {}), 'set-cookie': 'origin=secret', server: 'origin-host' } });
  }
  if (url.includes('index.m3u8')) return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttps://other-cdn.example.net/seg2.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  if (url.endsWith('.ts') || url.endsWith('key.bin')) return new Response('TS', { headers: { 'content-type': 'video/mp2t' } });
  if (url.endsWith('.srt')) {
    // «سلام» در Windows-1256
    const bytes = Buffer.concat([Buffer.from('1\r\n00:00:01,000 --> 00:00:02,500\r\n'), Buffer.from([0xD3, 0xE1, 0xC7, 0xE3]), Buffer.from('\r\n\r\n')]);
    return new Response(bytes);
  }
  return new Response('nope', { status: 404 });
};
try {
  const now = Math.floor(Date.now() / 1000);
  const ipHash = await W.streamBindHash(SECRET, 'ip', W.streamIpPrefix('5.6.7.8'));
  const uaHash = await W.streamBindHash(SECRET, 'ua', CHROME);
  const base = { v: 1, k: 'v', u: 'https://origin.example.org/movie.mp4', e: now + 600, s: 'a'.repeat(24), f: 'mp4', o: ['site.test'], i: ipHash, a: uaHash };
  const tok = await W.streamTokenMake(SECRET, base);
  assert.deepEqual(await W.streamTokenOpen(SECRET, tok), base);
  assert.equal(await W.streamTokenOpen('other-secret-xxxxxxxxxxxx', tok), null);
  assert.equal(await W.streamTokenOpen(SECRET, tok.slice(0, -2) + (tok.endsWith('A') ? 'B' : 'A') + tok.slice(-1)), null);
  assert.ok(!Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1').includes('origin.example.org'), 'آدرس مبدأ داخل توکن رمزنگاری شده است');
  assert.equal(W.streamIpPrefix('2a01:4f8:c0c:1234:abcd::1'), '2a01:4f8:c0c:1234::/64');
  const req = (path, h = {}) => new Request('https://edge.test' + path, { headers: { 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, 'sec-fetch-dest': 'video', referer: 'https://site.test/', range: 'bytes=0-', ...h } });
  const env = { EDGE_SECRET: SECRET };
  for (const [name, handler] of [['worker.js', r => W.streamEdgeHandle(r, SECRET, {})], ['stream-edge-worker.js', r => edge.fetch(r, env)]]) {
    const ok = await handler(req('/v/' + tok));
    assert.equal(ok.status, 206, name);
    assert.equal(await ok.text(), 'VIDEO-BYTES');
    assert.equal(ok.headers.get('content-type'), 'video/mp4');
    assert.equal(ok.headers.get('cache-control'), 'private, no-store, no-transform');
    assert.equal(ok.headers.get('set-cookie'), null, 'هدرهای مبدأ نشت نکنند');
    assert.equal(upstream.at(-1).headers.range, 'bytes=0-');
    const deny = async (h, reason, path = '/v/' + tok) => { const r = await handler(req(path, h)); assert.equal(r.status, 403, name + ' ' + reason); assert.equal(r.headers.get('x-mvx-deny'), reason); };
    await deny({ 'cf-connecting-ip': '9.9.9.9' }, 'ip');
    await deny({ 'sec-fetch-dest': 'document' }, 'dest');       // کپی لینک در تب جدید
    await deny({ 'sec-fetch-dest': 'empty' }, 'dest');          // fetch افزونه‌ها
    await deny({ 'sec-fetch-dest': '' }, 'client');             // دانلودمنیجر با UA کپی‌شده
    await deny({ 'user-agent': 'Mozilla/5.0 Firefox/120.0' }, 'ua');
    await deny({ referer: 'https://evil.test/' }, 'origin');
    const ios = await handler(req('/v/' + tok, { 'user-agent': 'AppleCoreMedia/1.0.0.21A329 (iPhone; U; CPU OS 17_0 like Mac OS X)', 'sec-fetch-dest': '' }));
    assert.equal(ios.status, 206, 'پخش‌کنندهٔ بومی iOS (بدون Sec-Fetch و با UA متفاوت) مجاز است');
    const expired = await W.streamTokenMake(SECRET, { ...base, e: now - 5 });
    await deny({}, 'expired', '/v/' + expired);
    await deny({}, 'token', '/h/' + tok + '/index.m3u8'); // نوع توکن باید با مسیر بخواند
  }
  /* HLS: playlist بازنویسی می‌شود؛ قطعه‌های هم‌پوشه نسبی، دامنهٔ دیگر امضاشده */
  const htok = await W.streamTokenMake(SECRET, { ...base, k: 'h', u: 'https://origin.example.org/hls/index.m3u8?sig=abc', f: 'hls' });
  const pl = await edge.fetch(req('/h/' + htok + '/index.m3u8', { 'sec-fetch-dest': 'empty', origin: 'https://site.test' }), env);
  assert.equal(pl.status, 200);
  assert.equal(pl.headers.get('access-control-allow-origin'), 'https://site.test');
  assert.equal(upstream.at(-1).url, 'https://origin.example.org/hls/index.m3u8?sig=abc', 'query امضای CDN حفظ شود');
  const text = await pl.text();
  assert.ok(text.includes('URI="https://edge.test/h/' + htok + '/key.bin"'));
  assert.ok(text.includes('https://edge.test/h/' + htok + '/seg1.ts'));
  assert.ok(!text.includes('origin.example.org') && !text.includes('other-cdn.example.net'), 'آدرس مبدأ در playlist دیده نشود');
  const signed = text.split('\n').find(l => l.includes('/~'));
  assert.ok(signed);
  const seg = await edge.fetch(req(new URL(signed).pathname, { 'sec-fetch-dest': 'empty' }), env);
  assert.equal(seg.status, 200); assert.equal(upstream.at(-1).url, 'https://other-cdn.example.net/seg2.ts');
  const forged = await edge.fetch(req('/h/' + htok + '/~' + Buffer.from('https://evil.example/x').toString('base64url') + '.0000000000000000', { 'sec-fetch-dest': 'empty' }), env);
  assert.equal(forged.status, 403);
  /* زیرنویس: Windows-1256 → VTT یونیکد */
  const ttok = await W.streamTokenMake(SECRET, { v: 1, k: 't', u: 'https://origin.example.org/fa.srt', e: now + 600, o: ['site.test'] });
  const sub = await edge.fetch(req('/t/' + ttok, { origin: 'https://site.test', 'sec-fetch-dest': 'empty' }), env);
  const vtt = await sub.text();
  assert.match(vtt, /^WEBVTT/); assert.ok(vtt.includes('سلام')); assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.500'));
  assert.equal(W.decodeSubtitleBytes(new TextEncoder().encode('درود')), 'درود');
  const h = await edge.fetch(new Request('https://edge.test/health?ts=' + now + '&sig=bad'), env);
  assert.deepEqual(await h.json(), { ok: true, v: 'mvx-edge-1', configured: true, auth: false });
} finally { globalThis.fetch = realFetch; }
console.log('PASS: encrypted stream tokens, edge anti-download checks (IP/UA/Sec-Fetch/Referer/expiry), iOS CoreMedia, HLS rewrite with signed foreign segments, cp1256 subtitles; edge file in sync with worker.js.');

/* ── ۴. API پخش: کلید اصلی، فقط مدیر، اشتراک، جلسه‌ها، تبلیغ پیش از پخش، لبهٔ داخلی ── */
function memKV() {
  const data = new Map();
  return { data, get: async (k, o) => { const v = data.get(k); if (v == null) return null; return o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v; }, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
}
const kv = memKV();
const env = { KV: kv };
const store = new W.Store(kv, env);
W.bustSettings(store);
await store.set('set', { secret: 'site-secret-123', siteName: 'Test', publicUrl: 'https://site.test', streamEnabled: false, adGateEnabled: true });
const admin = await W.createTgUser(store, { tgId: '1001', tgName: 'Admin' }); admin.role = 'admin'; await W.saveUser(store, admin);
const user = await W.createTgUser(store, { tgId: '2002', tgName: 'User', tgUsername: 'viewer' }); user.role = 'free'; await W.saveUser(store, user);
const userTok = await W.makeToken(store, user), adminTok = await W.makeToken(store, admin);
const movie = { id: 'i_mov1', type: 'movie', title: 'فیلم | Movie', access: 'free', genres: ['اکشن'], variants: { sub: {}, dub: {} }, episodes: [], seasons: [], updatedAt: 1 };
W.applyStreamEntries(movie, W.parseStreamLines('720 دوبله https://cdn.example.com/m-720.mp4\n1080 دوبله https://cdn.example.com/m-1080.mp4\nhttps://cdn.example.com/m.fa.srt', { type: 'movie' }).entries);
await W.saveItemRecord(store, movie);
await W.saveItemRecord(store, series);
const ctxs = { waitUntil() { } };
const call = async (fn, token, body, ip = '5.6.7.8') => {
  const r = await fn(store, body, new Request('https://site.test/api/x', { method: 'POST', headers: { authorization: token ? 'Bearer ' + token : '', 'cf-connecting-ip': ip, 'user-agent': CHROME, origin: 'https://site.test' } }), ctxs);
  return { status: r.status, body: await r.json() };
};
const setSet = async patch => { const s = await store.get('set'); await store.set('set', { ...s, ...patch }); W.bustSettings(store); };
{
  assert.equal((await call(W.apiStreamOpen, userTok, { itemId: movie.id })).status, 403, 'سیستم خاموش');
  await setSet({ streamEnabled: true, streamPublic: false });
  assert.equal((await call(W.apiStreamOpen, '', { itemId: movie.id })).status, 401);
  const testOnly = await call(W.apiStreamOpen, userTok, { itemId: movie.id });
  assert.equal(testOnly.status, 403); assert.equal(testOnly.body.code, 'admins');
  assert.equal((await call(W.apiStreamOpen, adminTok, { itemId: movie.id })).status, 200, 'مدیر در حالت آزمایشی پخش می‌کند');
  await setSet({ streamPublic: true });
  const r = await call(W.apiStreamOpen, userTok, { itemId: movie.id, track: 'dub' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.needAd, undefined, 'بدون تبلیغ داخلی/شبکه، مستقیم پخش');
  assert.match(r.body.src, /^https:\/\/site\.test\/sv\/v\/[A-Za-z0-9_-]+$/);
  assert.equal(r.body.cur.quality, '720'); assert.equal(r.body.subs.length, 1);
  assert.equal(r.body.subDefault, '', 'نسخهٔ دوبله: زیرنویس پیش‌فرض خاموش');
  assert.equal(r.body.wm, '2002', 'اولویت واترمارک با شناسهٔ عددی تلگرام است، نه یوزرنیم (@viewer)');
  assert.ok(!JSON.stringify(r.body).includes('cdn.example.com'), 'API پخش لینک مبدأ را نشان نمی‌دهد');
  assert.ok(r.body.options.dub.length === 2 && r.body.options.sub.length === 0);
  /* لبهٔ داخلی Worker (/sv) همان توکن را با رمز ذخیره‌شده باز می‌کند */
  const set = await W.getSettings(store);
  assert.ok(set.streamSecret && set.streamSecret.length >= 32);
  const opened = await W.streamTokenOpen(set.streamSecret, r.body.src.split('/sv/v/')[1]);
  assert.equal(opened.u, 'https://cdn.example.com/m-720.mp4');
  assert.deepEqual(opened.o.slice(0, 1), ['site.test']);
  /* جلسه‌ها: تعویض با جلسهٔ ناشناس رد، سقف هم‌زمانی */
  const sw = await call(W.apiStreamOpen, userTok, { itemId: movie.id, reason: 'switch', sid: 'f'.repeat(24), track: 'dub', quality: '1080' });
  assert.equal(sw.status, 409);
  const sw2 = await call(W.apiStreamOpen, userTok, { itemId: movie.id, reason: 'switch', sid: r.body.sid, track: 'dub', quality: '1080' });
  assert.equal(sw2.status, 200); assert.equal(sw2.body.cur.quality, '1080'); assert.equal(sw2.body.sid, r.body.sid);
  await setSet({ streamMaxSessions: 1 });
  const other = await call(W.apiStreamOpen, userTok, { itemId: movie.id });
  assert.notEqual(other.body.sid, r.body.sid);
  assert.equal((await call(W.apiStreamOpen, userTok, { itemId: movie.id, reason: 'renew', sid: r.body.sid })).status, 409, 'جلسهٔ قدیمی پس از سقف قطع می‌شود');
  /* اشتراک */
  const ep5 = series.seasons[0].episodes.find(e => e.n === 5);
  const locked = await call(W.apiStreamOpen, userTok, { itemId: series.id, epId: ep5.id, track: 'sub', quality: '1080' });
  assert.equal(locked.status, 403); assert.equal(locked.body.needSub, true);
  const freeEp = await call(W.apiStreamOpen, userTok, { itemId: series.id, epId: ep5.id, track: 'sub' });
  assert.equal(freeEp.status, 403, 'زیرنویس این قسمت فقط ۱۰۸۰ دارد که ویژه است');
  const dubEp = await call(W.apiStreamOpen, userTok, { itemId: series.id, epId: ep5.id, track: 'dub' });
  assert.equal(dubEp.status, 200); assert.equal(dubEp.body.ep.cur.n, 5);
  /* تبلیغ داخلی پیش از پخش: بدون منبع، تا پایان زمان تبلیغ آدرس داده نمی‌شود */
  await store.set('ads', [{ id: 'ad1', kind: 'video', mediaUrl: 'https://ads.example.com/v.mp4', linkUrl: 'https://ads.example.com/', sec: 8, active: true }]);
  W.bustAds();
  await setSet({ streamMaxSessions: 3 });
  const withAd = await call(W.apiStreamOpen, userTok, { itemId: movie.id, track: 'dub' });
  assert.equal(withAd.body.needAd, true); assert.ok(withAd.body.gate); assert.equal(withAd.body.src, undefined);
  assert.equal(withAd.body.ad.mediaUrl, 'https://ads.example.com/v.mp4');
  const early = await call(W.apiStreamSrc, userTok, { gate: withAd.body.gate });
  assert.equal(early.status, 425, 'قبل از پایان تبلیغ (زمان سرور) آدرس داده نمی‌شود');
  const rn = Date.now; Date.now = () => rn() + 20000;
  try {
    const late = await call(W.apiStreamSrc, userTok, { gate: withAd.body.gate, ad: { at: withAd.body.ad.at, t: 8, done: true } });
    assert.equal(late.status, 200); assert.match(late.body.src, /\/sv\/v\//);
  } finally { Date.now = rn; }
  assert.equal((await call(W.apiStreamSrc, adminTok, { gate: withAd.body.gate })).status, 410, 'دروازه به همان کاربر گره خورده');
  const renew = await call(W.apiStreamOpen, userTok, { itemId: movie.id, reason: 'renew', sid: withAd.body.sid, streamId: withAd.body.cur.streamId });
  assert.equal(renew.body.needAd, undefined, 'تمدید توکن تبلیغ ندارد');
  /* مشترک: هیچ تبلیغی */
  const subUser = await W.createTgUser(store, { tgId: '3003', tgName: 'Sub' }); subUser.role = 'free'; subUser.subUntil = Date.now() + 86400000; await W.saveUser(store, subUser);
  const subTok = await W.makeToken(store, subUser);
  const subOpen = await call(W.apiStreamOpen, subTok, { itemId: movie.id });
  assert.equal(subOpen.body.needAd, undefined); assert.equal(subOpen.body.noAds, true);
  assert.equal((await call(W.apiStreamOpen, subTok, { itemId: series.id, epId: ep5.id, track: 'sub', quality: '1080' })).status, 200, 'مشترک به کیفیت ویژه دسترسی دارد');
}
console.log('PASS: stream API master/admin-only switches, login, subscriber-only qualities, sessions & concurrency, house pre-roll gate enforced by server time, renew without ads, subscribers ad-free, built-in /sv edge token.');

/* ── ۵. صفحهٔ اثر: لینک‌ها به کاربر عادی نمی‌رسند ── */
{
  const get = async token => { const r = await W.apiItem(store, series.id, new Request('https://site.test/api/item/' + series.id, { headers: { authorization: token ? 'Bearer ' + token : '' } }), null); return r.json(); };
  const pub = await get(userTok);
  assert.ok(!JSON.stringify(pub).includes('cdn.example.com'), 'هیچ لینک پخشی در پاسخ کاربر عادی نیست');
  assert.equal(pub.stream.on, true); assert.equal(pub.stream.any, true);
  assert.ok(pub.item.seasons[0].episodes.find(e => e.n === 5).stm.dub['720']);
  const anon = await get('');
  assert.ok(!JSON.stringify(anon).includes('cdn.example.com'));
  const adm = await get(adminTok);
  assert.ok(JSON.stringify(adm).includes('cdn.example.com'), 'مدیر برای ویرایش لینک‌ها را می‌بیند');
  assert.ok(adm.item.seasons[0].episodes.find(e => e.n === 5).stm.sub['1080']);
}
console.log('PASS: item API exposes only URL-free stream availability to users; admins keep raw links for editing.');

/* ── ۶. پنل: لینک‌های هر اثر، کلیدها و لبه‌ها ── */
{
  const adm = async (path, body, method = 'POST') => { const r = await W.handleAdmin(store, new URL('https://site.test/api/admin/' + path), new Request('https://site.test/api/admin/' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } }), admin); return { status: r.status, body: await r.json() }; };
  const bad = await adm('item/' + movie.id + '/streams', { text: '720 دوبله https://cdn.example.com/ok.mp4\n720 https://cdn.example.com/no-track.mp4' });
  assert.equal(bad.status, 400); assert.equal(bad.body.errors[0].line, 2);
  W.bustItem(movie.id);
  assert.equal((await store.get('it:' + movie.id)).streams.length, 2, 'با خطا هیچ تغییری ذخیره نمی‌شود');
  const ok = await adm('item/' + movie.id + '/streams', { text: '480 زیرنویس https://cdn.example.com/m-480.mp4 | سبک' });
  assert.equal(ok.status, 200); assert.equal(ok.body.item.streams.length, 1); assert.equal(ok.body.lines, '480p زیرنویس https://cdn.example.com/m-480.mp4 | سبک');
  assert.equal((await store.get('idx')).find(x => x.id === movie.id).hasStream, true);
  const save = await adm('settings', { streamTokenMin: 5 });
  assert.equal(save.status, 400, 'اعتبار توکن کمتر از ۱۰ دقیقه رد شود');
  const save2 = await adm('settings', { streamEnabled: true, streamPublic: true, streamTokenMin: 90, streamMaxSessions: 2, adNetEnabled: true, adNetUrl: 'ftp://bad' });
  assert.equal(save2.status, 400);
  assert.equal((await W.getSettings(store)).streamTokenMin, 180, 'تغییر نیمه‌کاره ذخیره نمی‌شود');
  const ov = await adm('overview', null, 'GET');
  assert.equal(ov.body.stream.enabled, true); assert.equal(ov.body.dlChargeEnabled, false);
  const realF = globalThis.fetch;
  globalThis.fetch = async url => { const u = new URL(String(url)); const ts = u.searchParams.get('ts'); return edge.fetch(new Request(String(url), { headers: {} }), { EDGE_SECRET: SECRET }).then(r => r) || ts; };
  try {
    const wrong = await adm('stream-edges', { action: 'add', id: 'edge-1', url: 'https://edge1.test', secret: 'wrong-secret-xxxxxxxxxxxxxxxx' });
    assert.equal(wrong.status, 400);
    const added = await adm('stream-edges', { action: 'add', id: 'edge-1', url: 'https://edge1.test', secret: SECRET });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.stream.edges[0].id, 'edge-1');
    assert.ok(!JSON.stringify(added.body).includes(SECRET), 'رمز لبه در پاسخ پنل ماسک می‌شود');
  } finally { globalThis.fetch = realF; }
  await store.set('ads', []); W.bustAds();
  const viaEdge = await call(W.apiStreamOpen, userTok, { itemId: movie.id });
  assert.match(viaEdge.body.src, /^https:\/\/edge1\.test\/v\//, 'با لبهٔ تعریف‌شده، پخش از Worker لبه است');
  assert.equal(viaEdge.body.edge, 'edge-1');
  const avoid = await call(W.apiStreamOpen, userTok, { itemId: movie.id, reason: 'renew', sid: viaEdge.body.sid, avoidEdge: 'edge-1' });
  assert.match(avoid.body.src, /^https:\/\/site\.test\/sv\//, 'اگر لبه خراب بود، Worker اصلی جایگزین می‌شود');
}
console.log('PASS: admin stream-link editor (atomic, line errors), settings validation, edge registration with health/secret check, edge selection and failover.');

/* ── ۷. بخش «لینک پخش آنلاین» ربات سوم ── */
{
  const botEnv = { CONTENT_BOT_TOKEN: 'fake', CONTENT_ADMIN_IDS: '1001', SITE_PUBLIC_ORIGIN: 'https://site.test', KV: kv };
  await setSet({ vaultChatId: '-1001234567890' });
  const r = await W.contentBotAction(new W.Store(kv, botEnv), { actorId: '1001', itemId: series.id, entries: [{ kind: 'video', season: 1, episode: 5, track: 'dub', quality: '1080', url: 'http://10.0.0.1/x.mp4' }] }, 'streams');
  assert.equal(r.status, 400, 'سرور ورودی ربات را دوباره بررسی می‌کند');
  assert.match((await r.json()).error, /لینک/);
  const okRes = await W.contentBotAction(new W.Store(kv, botEnv), { actorId: '1001', itemId: series.id, entries: [{ kind: 'video', season: 2, episode: 1, track: 'dub', quality: '720', url: 'https://cdn.example.com/s02e01.mp4' }] }, 'streams');
  assert.equal(okRes.status, 200);
  assert.equal((await okRes.json()).result.created, 1);
  const list = await W.contentBotAction(new W.Store(kv, botEnv), { actorId: '1001', itemId: series.id }, 'streamlist');
  assert.match((await list.json()).lines, /S02E01 720p دوبله/);
  assert.equal((await W.contentBotAction(new W.Store(kv, botEnv), { actorId: '9999', itemId: series.id, entries: [] }, 'streams')).status, 403);
}
console.log('PASS: content-bot streams action (server-side revalidation, role check, episode creation, listing).');

/* ── ۸. پلیر: فایل جدا، کش immutable، پارسر VTT ── */
{
  const a = W.buildPlayerJs();
  new vm.Script(a.code);
  const r = await W.handleAssets(new Request('https://site.test/assets/player.js?v=' + a.v), new URL('https://site.test/assets/player.js?v=' + a.v));
  assert.match(r.headers.get('cache-control'), /immutable/);
  const stale = await W.handleAssets(new Request('https://site.test/assets/player.js?v=old'), new URL('https://site.test/assets/player.js?v=old'));
  assert.equal(stale.headers.get('cache-control'), 'no-cache');
  const fakeWin = { document: {}, localStorage: { getItem: () => null, setItem() { }, removeItem() { } } };
  W.MVX_PLAYER_MODULE(fakeWin);
  const cues = fakeWin.MvxPlayer._parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<i>سلام</i>\nدنیا\n\n00:01:00,500 --> 00:01:02,000 align:start\nخط دوم\n');
  assert.equal(cues.length, 2); assert.equal(cues[0].t, 'سلام\nدنیا'); assert.equal(cues[1].s, 60.5);
  for (const k of ['controlslist="nodownload', 'disablepictureinpicture', "addEventListener('contextmenu'", 'mvp-wm', '/stream/open', '/stream/src', "'/api/ad/evs'", 'رد کردن تبلیغ']) assert.ok(a.code.includes(k), k);
  /* تمام‌صفحه در مینی‌اپ: اولویت با WebApp.requestFullscreen، همگامی آیکن با وضعیت واقعی، پیام برای کلاینت بدون پشتیبانی */
  for (const k of ['tgInApp', 'fsWanted', 'requestFullscreen', 'web_app_request_fullscreen', 'web_app_exit_fullscreen', 'web_app_expand', 'fullscreenChanged', 'fullscreenFailed', 'تمام‌صفحه در این کلاینت پشتیبانی نمی‌شود']) assert.ok(a.code.includes(k), k);
  for (const k of ['web_app_request_fullscreen', 'web_app_exit_fullscreen', 'fullscreen_changed', 'receiveEvent', 'TelegramWebviewProxy']) assert.ok(W.APP_HTML.includes(k), k);
  /* قفل رفتاری دکمهٔ تمام‌صفحه در مینی‌اپ (باگ موبایل): بعد از «شکستِ تکرارِ بی‌خطرِ درخواست»،
     فشار دوم باید «خروج» باشد — نه ورود دوباره. (تابع‌های واقعی از کد پلیر استخراج و اجرا می‌شوند.) */
  {
    const code = a.code;
    function grabFn(name) {
      const start = code.indexOf('function ' + name + '(');
      assert.ok(start >= 0, name);
      const lineStart = code.lastIndexOf('\n', start) + 1;
      const indent = code.slice(lineStart, start);
      const end = code.indexOf('\n' + indent + '}', start);
      return code.slice(start, end + 1 + indent.length + 1);
    }
    const body = [grabFn('toggleFs'), grabFn('tgFs'), grabFn('onFs'), grabFn('onFsFail'),
      'return { toggleFs: toggleFs, tgFs: tgFs, onFs: onFs, onFsFail: onFsFail };'].join('\n');
    const evs = [];
    const P = { root: {}, fsWanted: false, tgFsOn: false };
    const D = {};
    const WW = { __mvxPostEvent: (t) => { evs.push(t); return 'native'; }, screen: {} };
    const tg = { requestFullscreen: () => { evs.push('sdk:request'); }, exitFullscreen: () => { evs.push('sdk:exit'); }, expand: () => { evs.push('sdk:expand'); } };
    const fn = new Function('P', 'D', 'W', 'tgApp', 'tgInApp', 'isFs', 'syncFs', 'toast', 'q', 'I', body);
    const api = fn(P, D, WW, () => tg, () => true, () => !!P.tgFsOn || !!D.fullscreenElement, () => {}, () => {}, null, { fs: '', fsx: '' });
    api.toggleFs();
    assert.ok(evs.includes('web_app_request_fullscreen'), 'فشار اول = درخواست تمام‌صفحه');
    assert.equal(P.fsWanted, true);
    api.onFs({ is_fullscreen: true });
    assert.equal(P.tgFsOn, true);
    api.onFsFail(); /* شکستِ تکرارِ بی‌خطرِ رویداد خام هنگام ورود */
    assert.equal(P.fsWanted, true, 'جهتِ دکمه نباید با رویدادها عوض شود');
    assert.equal(P.tgFsOn, true, 'وضعیتِ واقعی نباید با «شکستِ تکرار» پاک شود');
    evs.length = 0;
    api.toggleFs();
    assert.ok(evs.includes('web_app_exit_fullscreen'), 'فشار دوم = خروج از تمام‌صفحه');
    assert.ok(evs.includes('web_app_expand') || evs.includes('sdk:expand'), 'بازگشت مینی‌اپ به حالت فول‌سایز');
    assert.ok(!evs.includes('web_app_request_fullscreen'), 'فشار دوم نباید دوباره ورود بزند');
    assert.equal(P.fsWanted, false);
    api.onFs({ is_fullscreen: false });
    assert.equal(P.tgFsOn, false);
    evs.length = 0;
    api.toggleFs();
    assert.ok(evs.includes('web_app_request_fullscreen'), 'چرخهٔ بعدی دوباره سالم وارد می‌شود');
  }


  /* نسخه‌ها در صفحهٔ اثر و پلیر: عنوانِ هر نسخه بالا (یک خط) و دکمه‌ها زیر آن؛
     پخش آنلاین فقط برای نسخهٔ دارای لینک؛ پلیر شناسهٔ نسخه را می‌فرستد */
  assert.ok(a.code.includes('fileId: P.opts.fileId'), 'پلیر شناسهٔ نسخه را به سرور می‌فرستد');
  assert.ok(a.code.includes('نسخه / کیفیت'), 'منوی پلیر نسخه‌ها را جدا و با عنوان نشان می‌دهد');
  for (const k of ['data-fid', '&f=', 'q-play', 'q-dl', 'white-space:nowrap']) assert.ok(W.APP_HTML.includes(k), k);
  {
    const page = W.APP_HTML;
    function grabFn(name) {
      const start = page.indexOf('function ' + name);
      assert.ok(start >= 0, name);
      const lineStart = page.lastIndexOf('\n', start) + 1;
      const indent = page.slice(lineStart, start);
      const end = page.indexOf('\n' + indent + '}', start);
      return page.slice(start, end + 1 + indent.length + 1);
    }
    const body = [grabFn('cellFilesOf'), grabFn('qualityButtonsHtml'),
      'return { qualityButtonsHtml: qualityButtonsHtml };'].join('\n');
    const fn = new Function('esc', 'faNum', 'Q_LABEL', 'fmtBytes', 'faMoney', 'unitName', 'currentDlPrice', 'hasSub', 'streamReady', body);
    const api = fn((s) => String(s), String, {}, String, String, () => 'تومان', () => 0, () => false, () => true);
    const variants = { sub: { '720': { has: true, label: '720p', sizeBytes: 100, files: [
      { id: 'f_1', title: 'نسخهٔ بلند بسیار طولانی برای تست تک‌خطی', sizeBytes: 123, has: true, pl: true },
      { id: 'f_2', title: 'نسخه ۲', sizeBytes: 123, has: true, pl: false }
    ] } }, dub: {} };
    const html = api.qualityButtonsHtml(variants, 'sub', false, { sub: { '720': { n: 1 } }, dub: {}, subs: 0 });
    assert.equal(html.split('q-dl').length - 1, 2, 'برای هر نسخه یک دکمهٔ دانلود');
    assert.equal(html.split('q-play').length - 1, 1, 'پخش آنلاین فقط برای نسخهٔ دارای لینک');
    assert.ok(html.indexOf('نسخهٔ بلند بسیار طولانی برای تست تک‌خطی') < html.indexOf('📥 دانلود'), 'عنوان بالای دکمه‌هاست');
    assert.ok(html.includes('data-fid="f_2"'), 'دانلودِ هر نسخه، همان نسخه است');
    assert.ok(/q-play[^>]*data-fid="f_1"|data-fid="f_1"[^>]*q-play/.test(html) || (html.split('data-fid="f_1"').length - 1) >= 2, 'دکمهٔ پخش به نسخهٔ دارای لینک گره خورده');
  }
  /* تبلیغ پیش از دانلود: بدون دکمه/متن اضافه زیر تبلیغ؛ ثانیه‌شمار فقط بعد از لود کامل رسانه */
  assert.ok(!W.APP_HTML.includes('id="adx-go"'), 'دکمهٔ «ادامه» زیر تبلیغ پیش از دانلود حذف شده');
  assert.ok(!W.APP_HTML.includes('adx-cta'), 'متن cta روی تبلیغ پیش از دانلود حذف شده');
  for (const k of ['canplaythrough', 'startTick', 'mediaFail']) assert.ok(W.APP_HTML.includes(k), k);
  assert.ok(W.APP_HTML.includes("'/assets/player.js?v=' + PLAYER_V"));
  assert.ok(!W.APP_HTML.includes('${'));
  const scripts = [...W.APP_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
  for (const s of scripts) new vm.Script(s);
}
console.log('PASS: player is a separate immutable asset with anti-download attributes, ads, VTT parser; site scripts still parse.');

/* ── ۹. پلتفرم تبلیغات قطع است: تبلیغ داخلی جایگزین و بدون تلاش تکراری (تأخیر) ── */
{
  const s9 = await W.getSettings(store);
  const cfgSet = { ...s9, adNetEnabled: true, adNetUrl: 'https://ads-down.test', adNetSecret: 'x'.repeat(32), adGateEnabled: true };
  await store.set('set', cfgSet); W.bustSettings(store);
  await store.set('ads', [{ id: 'adh', kind: 'banner', mediaUrl: 'https://ads.example.com/b.jpg', sec: 5, active: true }]); W.bustAds();
  let tries = 0;
  const realF = globalThis.fetch;
  globalThis.fetch = async url => { if (String(url).startsWith('https://ads-down.test')) { tries++; throw new Error('down'); } return realF(url); };
  try {
    const a = await call(W.apiStreamOpen, userTok, { itemId: movie.id });
    const b = await call(W.apiStreamOpen, userTok, { itemId: movie.id });
    assert.equal(a.body.needAd, true); assert.equal(a.body.ad.net, false, 'تبلیغ داخلی جایگزین شد');
    assert.equal(b.body.ad.net, false);
    assert.equal(tries, 1, 'بعد از خطا ۳۰ ثانیه دوباره به پلتفرم وصل نمی‌شویم');
  } finally { globalThis.fetch = realF; }
}
console.log('PASS: ad platform outage falls back to house ads with a 30s backoff (no per-request timeouts).');

/* ── ۱۰. بنرهای پلیر: تبلیغ داخلی برای جایگاه‌های خالی، مدیر تبلیغ‌ها را می‌بیند، مشترک نه ── */
{
  await setSet({ plAdPre: false, plAdBanner: true, plAdPause: true, adNetEnabled: false, adNetUrl: '', adNetSecret: '' });
  await store.set('ads', [{ id: 'adw', kind: 'banner', mediaUrl: 'https://ads.example.com/wide.jpg', w: 728, h: 90, linkUrl: 'https://shop.example.com/', sec: 8, active: true, weight: 1 }]); W.bustAds();
  const r = await call(W.apiStreamOpen, userTok, { itemId: movie.id, track: 'dub' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ov = (r.body.banners || []).filter(b => b.slot === 'ov');
  const pz = (r.body.banners || []).filter(b => b.slot === 'pause');
  assert.equal(ov.length, 1, 'بنر پهن داخلی برای «روی پلیر» انتخاب شد');
  assert.equal(ov[0].mediaUrl, 'https://ads.example.com/wide.jpg');
  assert.equal(ov[0].net, false);
  assert.equal(pz.length, 1, 'بنر توقف داخلی انتخاب شد');
  assert.ok(r.body.adCfg && r.body.adCfg.banner === true, 'زمان‌بندی بنر پلیر برای کاربر بدون اشتراک روشن است');
  const adm = await call(W.apiStreamOpen, adminTok, { itemId: movie.id, track: 'dub' });
  assert.ok(!adm.body.noAds, 'مدیر برای آزمایش، تبلیغ‌های پلیر را می‌بیند');
  assert.ok((adm.body.banners || []).length > 0, 'مدیر هم بنرهای پلیر را می‌بیند');
  assert.equal(adm.body.wm, '1001', 'واترمارک بدون یوزرنیم: فقط شناسهٔ عددی تلگرام');
  const sub2 = await W.createTgUser(store, { tgId: '7007', tgName: 'S2', tgUsername: 's2user' }); sub2.role = 'free'; sub2.subUntil = Date.now() + 86400000; await W.saveUser(store, sub2);
  const sub2Open = await call(W.apiStreamOpen, await W.makeToken(store, sub2), { itemId: movie.id, track: 'dub' });
  assert.equal(sub2Open.body.noAds, true, 'مشترک واقعی بدون تبلیغ');
  assert.equal(sub2Open.body.banners, undefined, 'مشترک واقعی بنر نمی‌بیند');
  assert.equal(sub2Open.body.wm, '7007', 'با وجود یوزرنیم، واترمارک شناسهٔ عددی تلگرام است (اولویت با عددی)');
}
console.log('PASS: player banners fall back to house ads (wide overlay + pause), watermark is the numeric Telegram id (username only as fallback), admins see player ads for testing while real subscribers stay ad-free.');
// تایمر ارسال دسته‌ای رویدادها (waitUntil ۲۰ ثانیه‌ای) را در Node منتظر نمی‌مانیم.
process.exit(0);
