/* repro: admin bulk stream save through handleAdmin on a realistic series */
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const W = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { parseStreamLines, applyStreamEntries, streamLinesOf, streamSafeUrl, streamFmtOf,
  handleAdmin, Store, saveUser, saveItemRecord, createTgUser, bustSettings, getSettings };`).toString('base64'));

function memKV() {
  const data = new Map();
  return { data, get: async (k, o) => { const v = data.get(k); if (v == null) return null; return o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v; }, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter(k2 => k2.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
}
const kv = memKV();
const store = new W.Store(kv, { KV: kv });
W.bustSettings(store);
await store.set('set', { secret: 'site-secret-123', siteName: 'T', publicUrl: 'https://site.test' });
const admin = await W.createTgUser(store, { tgId: '1001', tgName: 'A' }); admin.role = 'admin'; await W.saveUser(store, admin);

const u = (p) => new URL('http://localhost/api/admin' + p);
const post = (p, body) => new Request(u(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function ep(n, id) {
  return {
    id, n, title: 'قسمت ' + n,
    variants: { sub: {}, dub: { '720': { label: '720p', files: [
      { id: 'f_' + id + 'a', title: 'Mymovies | 720p.WEB-DL.Doble | 457 MB', source: { chatId: '-1003981503084', msgId: '894' }, pl: 'https://edge02.355416.ir.cdn.ir/x/The.Pitt.S02E05.720p.mkv' }
    ] } } },
  };
}
const item = {
  id: 'i_pitt1', type: 'series', title: 'The Pitt', access: 'free', quality: 'WEB-DL',
  variants: { sub: {}, dub: {} },
  seasons: [
    { n: 1, title: 'فصل ۱', episodes: [ep(1, 'e_s1e1'), ep(2, 'e_s1e2')] },
    { n: 2, title: 'فصل ۲', episodes: [ep(5, 'e_s2e5')] },
  ],
  episodes: [],
};
await W.saveItemRecord(store, item);

const text = [
  'S01E01 480p دوبله https://edge02.355416.ir.cdn.ir/NmFkM2IxYjg0MjBkNg/The.Pitt.S01E01.480p.WEB-DL.KIMO.DUBLE.mkv | Filimo | 480p.WEB-DL.KIMO | 303.3 MB',
  'S01E01 720p دوبله https://edge03.355416.ir.cdn.ir/NmFkM2IxYTRkOTZhOQ/The.Pitt.S01E01.720p.WEB-DL.KIMO.DUBLE.mkv | Filimo | 720p.WEB-DL.KIMO | 620 MB',
].join('\n');

const res = await W.handleAdmin(store, u('/item/i_pitt1/streams'), post('/item/i_pitt1/streams', { text }), admin);
const body = await res.json();
console.log('status', res.status);
console.log('result =', JSON.stringify(body.result));
console.log('warnings =', JSON.stringify(body.warnings));
console.log('lines =\n' + (body.lines || '(empty)'));
const saved = await store.get('it:i_pitt1');
console.log('stored ep stream counts =', JSON.stringify(saved.seasons.map(s => s.episodes.map(e => (e.streams || []).length))));
console.log('stored ep.pl =', JSON.stringify(saved.seasons.map(s => s.episodes.map(e => (((e.variants || {}).dub || {})['720'] || {}).files && (((e.variants || {}).dub || {})['720'] || {}).files[0] && (((e.variants || {}).dub || {})['720'] || {}).files[0].pl))));

/* reopen check: stored bag.streams must survive for the admin box read-back */
const again = await store.get('it:i_pitt1');
console.log('store ep0 streams =', JSON.stringify((again.seasons[0].episodes[0].streams || []).map(s => s.url)));
