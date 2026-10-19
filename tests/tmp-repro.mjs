/* شبیه‌سازی مسیر واقعی: جریان دقیق UI + تنظیمات پیش‌فرض تبلیغ + گرفتن ویدیو از لبه */
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { apiStreamOpen, apiStreamSrc, Store, saveUser, saveItemRecord, createTgUser, makeToken, bustSettings, getSettings,
  handleAdmin, pickStream, streamsOf, publicVariantMap, streamOptionsOf, streamEdgeHandle, streamTokenOpen, bustAds };`).toString('base64'));

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
function memKV() {
  const data = new Map();
  return { data, get: async (k, o) => { const v = data.get(k); if (v == null) return null; return o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v; }, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter(k2 => k2.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
}
const kv = memKV();
const store = new W.Store(kv, { KV: kv });
W.bustSettings(store);
/* تنظیمات نزدیک به واقعی: تبلیغ پیش‌پخش روشن (پیش‌فرض)، تبلیغ داخلی ثبت‌شده */
await store.set('set', { secret: 'site-secret-123', siteName: 'T', publicUrl: 'https://site.test', streamEnabled: true, streamPublic: true, adGateEnabled: false });
W.bustAds && W.bustAds(); await store.set('ads', [{ id: 'ad1', kind: 'video', mediaUrl: 'https://ads.example.com/v.mp4', linkUrl: 'https://ads.example.com/', sec: 8, active: true }]);
const admin = await W.createTgUser(store, { tgId: '1001', tgName: 'A' }); admin.role = 'admin'; await W.saveUser(store, admin);
const user = await W.createTgUser(store, { tgId: '2002', tgName: 'U', tgUsername: 'u' }); await W.saveUser(store, user);
const adminTok = await W.makeToken(store, admin), userTok = await W.makeToken(store, user);
const ctxs = { waitUntil() { } };

const u = (p) => new URL('http://localhost/api/admin' + p);
const post = (p, body) => new Request(u(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const adminPost = async (p, body) => {
  const r = await W.handleAdmin(store, u(p), post(p, body), admin);
  const j = await r.json();
  if (!j.item) throw new Error('admin fail: ' + JSON.stringify(j));
  return j.item;
};
const call = async (fn, token, body) => {
  const rr = await fn(store, body, new Request('https://site.test/api/x', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, origin: 'https://site.test' } }), ctxs);
  return { status: rr.status, body: await rr.json() };
};

/* ── جریان دقیق UI روی یک فیلم ── */
const item = { id: 'i_mov1', type: 'movie', title: 'فیلم', access: 'free', variants: { sub: {}, dub: {} }, episodes: [], seasons: [], updatedAt: 1 };
await W.saveItemRecord(store, item);
await adminPost('/item/i_mov1/variant', { track: 'sub', qualityLabel: '720', addQuality: true });
let saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', title: '720 معمولی', url: 'https://t.me/c/1234567890/11', addFile: true });
const g1 = saved.variants.sub['720'].files[0];
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', epId: '', fileId: g1.id, title: '720 معمولی', url: 'https://t.me/c/1234567890/11', pl: 'https://cdn.example.com/a.mp4' });
console.log('v1:', JSON.stringify(saved.variants.sub['720'].files.map(f => ({ id: f.id, t: f.title, pl: f.pl }))));
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', title: '720p.10bit', url: 'https://t.me/c/1234567890/12', addFile: true });
const g2 = saved.variants.sub['720'].files[1];
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', epId: '', fileId: g2.id, title: '720p.10bit', url: 'https://t.me/c/1234567890/12', pl: 'https://cdn.example.com/b.mp4' });
console.log('v2:', JSON.stringify(saved.variants.sub['720'].files.map(f => ({ id: f.id, t: f.title, pl: f.pl }))));

const openBody = (fid) => ({ itemId: 'i_mov1', epId: '', track: 'sub', quality: '720', streamId: '', fileId: fid, sid: '', reason: 'start', lastAdAt: 0, seen: {} });

/* آپ استریم جعلی برای لبه */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.endsWith('.mp4')) {
    const range = (init.headers || {}).range;
    return new Response('VIDEO-BYTES', { status: range ? 206 : 200, headers: { 'content-type': 'video/mp4', 'content-length': '11', ...(range ? { 'content-range': 'bytes 0-10/1000' } : {}) } });
  }
  return new Response('nope', { status: 404 });
};
try {
  for (const [name, fid] of [['v2 (10bit)', g2.id], ['v1 (معمولی)', g1.id]]) {
    let o = await call(W.apiStreamOpen, userTok, openBody(fid));
    console.log(`\n== open ${name}: status=${o.status} needAd=${!!o.body.needAd} err=${o.body.error || ''}`);
    if (o.body.needAd) {
      console.log('   ad =', JSON.stringify({ kind: o.body.ad && o.body.ad.kind, mediaUrl: o.body.ad && o.body.ad.mediaUrl, sec: o.body.ad && o.body.ad.sec }), 'cur =', JSON.stringify(o.body.cur));
      const rn = Date.now; Date.now = () => rn() + 20000;
      try {
        const o2 = await call(W.apiStreamSrc, userTok, { gate: o.body.gate, ad: { at: o.body.ad.at, t: 8, done: true }, seen: {} });
        console.log('   /stream/src →', o2.status, 'cur =', JSON.stringify(o2.body.cur), 'err =', o2.body.error || '');
        o = { body: Object.assign({}, o.body, o2.body) };
      } finally { Date.now = rn; }
    }
    if (!o.body.src) { console.log('   !!! NO SRC', JSON.stringify(o.body).slice(0, 300)); continue; }
    console.log('   cur =', JSON.stringify(o.body.cur));
    const tok = o.body.src.split('/sv/v/')[1] || o.body.src.split('/sv/h/')[1];
    const opened = await W.streamTokenOpen((await W.getSettings(store)).streamSecret, tok);
    console.log('   token.u =', opened && opened.u, 'f =', opened && opened.f);
    const vr = await W.streamEdgeHandle(new Request('https://site.test/sv/v/' + tok, { headers: { 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, 'sec-fetch-dest': 'video', referer: 'https://site.test/item/i_mov1', range: 'bytes=0-' } }), (await W.getSettings(store)).streamSecret, { prefix: '/sv' });
    const txt = await vr.text();
    console.log('   EDGE /sv/v →', vr.status, JSON.stringify(txt.slice(0, 30)), 'deny=' + (vr.headers.get('x-mvx-deny') || ''));
  }

  /* تعویض نسخه از منوی پلیر */
  const o = await call(W.apiStreamOpen, userTok, openBody(g1.id));
  let sid = o.body.sid;
  if (o.body.needAd) {
    const rn = Date.now; Date.now = () => rn() + 20000;
    try { const o2 = await call(W.apiStreamSrc, userTok, { gate: o.body.gate, ad: { at: o.body.ad.at, t: 8, done: true }, seen: {} }); sid = o2.body.sid || sid; } finally { Date.now = rn; }
  }
  const sw = await call(W.apiStreamOpen, userTok, { itemId: 'i_mov1', epId: '', track: 'sub', quality: '720', streamId: 'vf_' + g2.id, fileId: g1.id, sid, reason: 'switch', lastAdAt: Date.now(), seen: {} });
  console.log('\n== switch → vf_g2:', sw.status, 'needAd=', !!sw.body.needAd, 'cur =', JSON.stringify(sw.body.cur || sw.body.error));
} finally { globalThis.fetch = realFetch; }
