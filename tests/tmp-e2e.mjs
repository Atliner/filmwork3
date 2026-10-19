/* E2E پلیر واقعی در jsdom: کلیک نسخه → MP.open → /stream/open → setSource → play */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { apiStreamOpen, apiStreamSrc, Store, saveUser, saveItemRecord, createTgUser, makeToken, bustSettings, getSettings,
  handleAdmin, MVX_PLAYER_MODULE, streamsOf, publicVariantMap, bustAds };`).toString('base64'));

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
function memKV() {
  const data = new Map();
  return { data, get: async (k, o) => { const v = data.get(k); if (v == null) return null; return o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v; }, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter(k2 => k2.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
}
const kv = memKV();
const store = new W.Store(kv, { KV: kv });
W.bustSettings(store);
await store.set('set', { secret: 'site-secret-123', siteName: 'T', publicUrl: 'https://site.test', streamEnabled: true, streamPublic: true, adGateEnabled: false });
await store.set('ads', [{ id: 'ad1', kind: 'video', mediaUrl: 'https://ads.example.com/v.mp4', linkUrl: 'https://ads.example.com/', cta: 'خرید', sec: 3, active: true }]);
W.bustAds();
const admin = await W.createTgUser(store, { tgId: '1001', tgName: 'A' }); admin.role = 'admin'; await W.saveUser(store, admin);
const user = await W.createTgUser(store, { tgId: '2002', tgName: 'U', tgUsername: 'u' }); await W.saveUser(store, user);
const userTok = await W.makeToken(store, user);
const ctxs = { waitUntil() { } };

const u = (p) => new URL('http://localhost/api/admin' + p);
const post = (p, body) => new Request(u(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const adminPost = async (p, body) => {
  const r = await W.handleAdmin(store, u(p), post(p, body), admin);
  const j = await r.json();
  if (!j.item) throw new Error('admin fail: ' + JSON.stringify(j));
  return j.item;
};

const item = { id: 'i_mov1', type: 'movie', title: 'فیلم', access: 'free', variants: { sub: {}, dub: {} }, episodes: [], seasons: [], updatedAt: 1 };
await W.saveItemRecord(store, item);
await adminPost('/item/i_mov1/variant', { track: 'sub', qualityLabel: '720', addQuality: true });
let saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', title: '720 معمولی', url: 'https://t.me/c/1234567890/11', addFile: true });
const g1 = saved.variants.sub['720'].files[0];
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', epId: '', fileId: g1.id, title: '720 معمولی', url: 'https://t.me/c/1234567890/11', pl: 'https://cdn.example.com/a.mp4' });
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', title: '720p.10bit', url: 'https://t.me/c/1234567890/12', addFile: true });
const g2 = saved.variants.sub['720'].files[1];
saved = await adminPost('/item/i_mov1/variant', { track: 'sub', quality: '720', epId: '', fileId: g2.id, title: '720p.10bit', url: 'https://t.me/c/1234567890/12', pl: 'https://cdn.example.com/b.mp4' });

/* ── jsdom + پلیر واقعی ── */
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://site.test/', pretendToBeVisual: true });
const win = dom.window;
const played = [];
win.HTMLMediaElement.prototype.play = function () { played.push('play:' + (this.src || 'ad')); try { Object.defineProperty(this, 'paused', { get: () => false, configurable: true }); } catch (e) { } return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { };
win.HTMLMediaElement.prototype.load = function () { };
win.HTMLMediaElement.prototype.canPlayType = function () { return ''; };
Object.defineProperty(win.HTMLMediaElement.prototype, 'readyState', { get() { return 4; } });
const errs = [];
win.addEventListener('error', (e) => errs.push(String(e.error || e.message)));

W.MVX_PLAYER_MODULE(win);
const MP = win.MvxPlayer;
if (!MP) { console.log('FAIL: player module did not init'); process.exit(1); }

const apiLog = [];
const hostApi = async (path, opts) => {
  apiLog.push(path + ' ' + JSON.stringify(opts && opts.body && opts.body.fileId));
  const body = (opts && opts.body) || {};
  let r;
  if (path === '/stream/open') r = await W.apiStreamOpen(store, body, new Request('https://site.test/api/stream/open', { method: 'POST', headers: { authorization: 'Bearer ' + userTok, 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, origin: 'https://site.test' } }), ctxs);
  else if (path === '/stream/src') r = await W.apiStreamSrc(store, body, new Request('https://site.test/api/stream/src', { method: 'POST', headers: { authorization: 'Bearer ' + userTok, 'cf-connecting-ip': '5.6.7.8', 'user-agent': CHROME, origin: 'https://site.test' } }), ctxs);
  else return { ok: true };
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e; }
  return j;
};

/* کلیک «پخش آنلاین» نسخهٔ ۲ — دقیقاً پارامترهای bindQualityClicks/openPlayer */
MP.open({ itemId: 'i_mov1', epId: '', track: 'sub', quality: '720', fileId: g2.id, title: 'فیلم' }, {
  api: hostApi, openExt: () => { }, tg: null, onNeedSub: () => { }, onNeedLogin: () => { }, onClose: () => { }
});

await new Promise(r => setTimeout(r, 5000));
const qv = () => win.document.querySelector('.mvp-root video.mvp-v') || win.document.querySelectorAll('video.mvp-v')[win.document.querySelectorAll('video.mvp-v').length - 1];
const v2 = qv();
console.log('apiLog =', JSON.stringify(apiLog));
console.log('video.src =', v2 && String(v2.src).slice(0, 60));
if (v2) v2.dispatchEvent(new win.Event('loadedmetadata'));
await new Promise(r => setTimeout(r, 100));
console.log('played after metadata =', JSON.stringify(played));
console.log('player errors =', JSON.stringify(errs));
console.log('isOpen =', MP.isOpen && MP.isOpen());

/* نسخهٔ ۱ */
apiLog.length = 0;
MP.close();
MP.open({ itemId: 'i_mov1', epId: '', track: 'sub', quality: '720', fileId: g1.id, title: 'فیلم' }, {
  api: hostApi, openExt: () => { }, tg: null, onNeedSub: () => { }, onNeedLogin: () => { }, onClose: () => { }
});
await new Promise(r => setTimeout(r, 5000));
const v3 = qv();
console.log('\n--- v1 ---');
console.log('apiLog =', JSON.stringify(apiLog));
console.log('video.src =', v3 && String(v3.src).slice(0, 60));
if (v3) v3.dispatchEvent(new win.Event('loadedmetadata'));
await new Promise(r => setTimeout(r, 100));
console.log('played after metadata =', JSON.stringify(played));
console.log('player errors =', JSON.stringify(errs));
process.exit(0);
