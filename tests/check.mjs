import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { APP_HTML, apiAuthTicket, signupBonusOf, telegramDisplayName, createTgUser, bustSettings, parseStarPacks, Store, saveUser, saveItemRecord, itemSourceKeys, maintenanceBatch, parseVersionLinks, versionSources, sourceFromParsed };').toString('base64'));
const scripts = [...mod.APP_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
for (const script of scripts) new vm.Script(script);
assert(!mod.APP_HTML.includes('id="hdr-back"'));
assert(mod.APP_HTML.includes('.hero-desc{display:none}'));
assert(mod.APP_HTML.includes('.detail-posters .dp-carousel{position:relative'));
assert(source.includes("infoCard + '<section class=\"d-sec detail-posters\""));
const ready = await mod.apiAuthTicket({get: async () => ({status:'ready', token:'test', user:{username:'test'}, createdAt:Date.now()})}, 'ticket');
assert.equal((await ready.json()).token, 'test');
const expired = await mod.apiAuthTicket({get: async () => ({status:'pending', createdAt:1})}, 'ticket');
assert.equal(expired.status, 404);
const missing = await mod.apiAuthTicket({get: async () => null}, 'ticket');
assert.equal(missing.status, 404);
console.log('PASS: generated browser scripts parse; header, mobile banner, gallery placement, ready/expired/missing tickets.');

assert.equal(mod.signupBonusOf({}), 50);
assert.equal(mod.signupBonusOf({signupBonus:0}), 0);
assert.equal(mod.signupBonusOf({signupBonus:125}), 125);
for (const value of [-1, 1.5, Infinity, 'bad']) assert.equal(mod.signupBonusOf({signupBonus:value}), 50);
assert.equal(mod.telegramDisplayName({id:1,first_name:'علی',last_name:'رضایی'}), 'علی رضایی');
assert.equal(mod.telegramDisplayName({id:1,username:'ali'}), 'ali');
assert(!source.includes("st.mode = 'wait_name'"));
assert(!source.includes('لطفاً نام و نام خانوادگی خود را وارد کنید'));
for (const bonus of [0, 125]) {
  const data = new Map([['set', {signupBonus:bonus}]]);
  const store = {kv:{}, env:{}, get:async k=>data.get(k) ?? null, set:async(k,v)=>data.set(k,structuredClone(v)), list:async prefix=>[...data.keys()].filter(k=>k.startsWith(prefix))};
  const user = await mod.createTgUser(store, {tgId:'1234', tgName:'Test',phone:'09123456789'});
  assert.equal(user.wallet, bonus);
  assert.equal(user.signupBonusGranted, bonus);
  const returning = await mod.createTgUser(store, {tgId:'1234',tgName:'Test'});
  assert.equal(returning.wallet, bonus);
}
console.log('PASS: Telegram names; default/custom/zero signup gifts; no repeated gift on return.');

assert.deepEqual(mod.parseStarPacks('50 | 500\n۱۰۰ | ۱۱۰۰\n٢٥٠ | ٣٠٠٠'), [
  {stars:50,units:500}, {stars:100,units:1100}, {stars:250,units:3000}
]);
assert.deepEqual(mod.parseStarPacks([{stars:75,units:900}]), [{stars:75,units:900}]);
assert.deepEqual(mod.parseStarPacks(' 10 | 20 \n\n'), [{stars:10,units:20}]);
for (const invalid of ['', '0 | 20', '-5 | 20', '1.5 | 20', '20 | 0', '20 | 1.5', '20 | 30 | 40', 'abc | 20', '10001 | 20', '10 | 9007199254740992', Array(9).fill({stars:1,units:1}), [null], [{stars:true,units:1}]]) {
  assert.throws(() => mod.parseStarPacks(invalid));
}
assert(mod.APP_HTML.includes('id="set-star-packs"'));
assert(mod.APP_HTML.includes("starPacksText: $('#set-star-packs').value"));
console.log('PASS: Stars package editor; Persian/Arabic digits; valid custom prices; invalid and oversized lists rejected.');
const launchCode = mod.APP_HTML.slice(mod.APP_HTML.indexOf('function isTgWebHash'), mod.APP_HTML.indexOf('function currentRoute'))
  .replaceAll('@@MINI_APP_URL@@', 'https://t.me/movie_shatelup_bot/directlink');
function launchContext(search = '', hash = '', start = '') {
  const location = {search, hash, pathname:'/'};
  const context = vm.createContext({URLSearchParams, location, TG:{initDataUnsafe:{start_param:start}}, history:{replaceState(_s,_t,url) {
    const parsed = new URL(url, 'https://example.com');
    location.hash = parsed.hash;
    location.search = parsed.search;
  }}});
  vm.runInContext(launchCode, context);
  return context;
}
for (const [query, hash, start] of [
  ['?tgWebAppStartParam=item_i_abc123', '', ''],
  ['', '#tgWebAppStartParam=item_i_abc123&tgWebAppVersion=8.0', ''],
  ['', '#/', 'item_i_abc123']
]) {
  const ctx = launchContext(query, hash, start);
  ctx.applyMiniAppItemLaunch();
  assert.equal(ctx.location.hash, '#/item/i_abc123');
  ctx.location.hash = '#/';
  ctx.applyMiniAppItemLaunch();
  assert.equal(ctx.location.hash, '#/');
  assert.equal(ctx.miniAppItemUrl('i_abc123'), 'https://t.me/movie_shatelup_bot/directlink?startapp=item_i_abc123');
}
const ctx = launchContext('', '#/wallet', 'item_i_abc123');
ctx.applyMiniAppItemLaunch();
assert.equal(ctx.location.hash, '#/wallet');
for (const bad of ['item_../../admin', 'item_i_abc?x=y', 'ref_123', '', 'item_i_ABC']) assert.equal(ctx.itemRouteFromStart(bad), '');
const delayed = launchContext('', '#/');
delayed.applyMiniAppItemLaunch();
delayed.TG.initDataUnsafe.start_param = 'item_i_abc123';
delayed.applyMiniAppItemLaunch();
assert.equal(delayed.location.hash, '#/item/i_abc123');
console.log('PASS: Mini App share URL; SDK/query/hash launch; delayed SDK; one-time routing; invalid payloads and existing navigation.');
// A real Store wrapper over an instrumented KV, including pagination and errors.
function fakeKV(initial = {}) {
  const data = new Map(Object.entries(initial));
  const counts = {get:0, put:0, del:0, list:0};
  const kv = {
    async get(key) { counts.get++; return structuredClone(data.get(key) ?? null); },
    async put(key, value) { counts.put++; data.set(key, JSON.parse(value)); },
    async delete(key) { counts.del++; data.delete(key); },
    async list({prefix, cursor, limit}) {
      counts.list++;
      const keys = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
      const offset = Number(cursor || 0), end = offset + Math.min(limit, 2);
      return {keys:keys.slice(offset,end).map(name => ({name})), list_complete:end >= keys.length, cursor:String(end)};
    }
  };
  return {kv, data, counts};
}
{
  const f = fakeKV({a:{n:1}, 'p:1':1, 'p:2':2, 'p:3':3});
  const store = new mod.Store(f.kv);
  const [a,b] = await Promise.all([store.get('a'),store.get('a')]);
  a.n = 99;
  assert.equal(b.n, 1);
  assert.equal((await store.get('a')).n, 1);
  assert.equal(f.counts.get, 1);
  await store.set('a',{n:1}); assert.equal(f.counts.put, 0);
  await store.set('a',{n:2}); assert.equal((await store.get('a')).n, 2);
  await store.set('a',{n:2},60); assert.equal(f.counts.put, 2);
  assert.deepEqual(await store.list('p:'), ['p:1','p:2','p:3']);
  assert.equal(f.counts.list,2);
  await store.del('a'); assert.equal(await store.get('a'),null);
  await assert.rejects(() => new mod.Store({put:async()=>{throw Error('quota');}}).set('a',1), /quota/);
  await assert.rejects(() => new mod.Store({get:async()=>{throw Error('network');}}).get('a'), /network/);
  await assert.rejects(() => new mod.Store({delete:async()=>{throw Error('quota');}}).del('a'), /quota/);
}
{
  const old = {username:'tgtest',tgId:'11',phone:'0911',tgUsername:'old',refCode:'ABC',wallet:0};
  const f = fakeKV({'u:tgtest':old,'tg:11':'tgtest','ph:0911':'tgtest','tgu:old':'tgtest','refcode:ABC':'tgtest'});
  await mod.saveUser(new mod.Store(f.kv), {...old,wallet:10});
  assert.equal(f.counts.put,1); // no rewriting unchanged lookup indexes on wallet updates
  await mod.saveUser(new mod.Store(f.kv), {...old,wallet:10,phone:'0922',tgUsername:'new'});
  assert(!f.data.has('ph:0911')); assert(!f.data.has('tgu:old'));
  assert.equal(f.data.get('ph:0922'),'tgtest'); assert.equal(f.data.get('tgu:new'),'tgtest');
}
{
  const old = {id:'i_abc',source:{chatId:'-100123',msgId:1},episodes:[{id:'e_a',source:{user:'channel',msgId:2}}],subs:[{id:'s_a'}]};
  const f = fakeKV({'it:i_abc':old,'src:c:-100123/1':'i_abc','src:channel/2':'i_abc','sub:s_a':{itemId:'i_abc'}});
  await mod.saveItemRecord(new mod.Store(f.kv), {...old,episodes:[],subs:[]});
  assert(f.data.has('src:c:-100123/1')); assert(!f.data.has('src:channel/2')); assert(!f.data.has('sub:s_a'));
  assert.equal([...f.data.keys()].filter(k=>k.startsWith('it:')).length,1);
}
{
  const f = fakeKV({'src:a/1':'i_gone','src:a/2':'i_live','it:i_live':{id:'i_live'}, 'k2k:paid':{status:'paid'}, 'u:live':{username:'live'}});
  const preview = await (await mod.maintenanceBatch(new mod.Store(f.kv), {prefix:'src:'})).json();
  assert.equal(preview.candidates.length,1); assert.equal(f.counts.del,0);
  // A restored target is protected even when it was absent during the preview.
  f.data.set('it:i_gone',{id:'i_gone'});
  const skipped = await (await mod.maintenanceBatch(new mod.Store(f.kv),{action:'delete',confirm:'DELETE_ORPHANS',keys:['src:a/1','k2k:paid','u:live']})).json();
  assert.equal(skipped.deleted,0); assert(f.data.has('k2k:paid'));
  f.data.delete('it:i_gone');
  const deleted = await (await mod.maintenanceBatch(new mod.Store(f.kv),{action:'delete',confirm:'DELETE_ORPHANS',keys:['src:a/1']})).json();
  assert.equal(deleted.deleted,1); assert(f.data.has('src:a/2'));
  const unauthorized = await mod.maintenanceBatch(new mod.Store(f.kv),{action:'delete',keys:['src:a/2']});
  assert.equal(unauthorized.status,400);
}
console.log('PASS: KV read deduplication, unchanged writes, TTL refresh, pagination, failure propagation, index cleanup and safe maintenance.');
const multiLinks = 'https://t.me/c/4458209353/63,https://t.me/c/4458209353/64';
const parsedParts = mod.parseVersionLinks(multiLinks);
assert.equal(parsedParts.length,2);
assert.equal(String(parsedParts[1].msgId),'64');
assert.equal(mod.parseVersionLinks(multiLinks.replace(',', '،')).length,2);
assert.equal(mod.parseVersionLinks(multiLinks.replace(',', '\n')).length,2);
assert.equal(mod.parseVersionLinks('https://t.me/channel/1,https://t.me/channel/1').length,1);
for (const bad of ['', 'https://t.me/channel/1,bad', 'https://t.me/channel/1 extra', Array(11).fill('https://t.me/channel/1').join(',')]) assert.throws(()=>mod.parseVersionLinks(bad));
const parts = parsedParts.map(p => mod.sourceFromParsed(p,{}));
const bundle = {...parts[0], parts};
assert.equal(mod.versionSources(bundle).length,2);
assert.equal(mod.versionSources(parts[0]).length,1);
assert.equal(mod.itemSourceKeys({source:bundle}).length,2);
const hrefCode = mod.APP_HTML.slice(mod.APP_HTML.indexOf('function sourceHref'),mod.APP_HTML.indexOf('function hostOnly'));
const hrefCtx = vm.createContext({}); vm.runInContext(hrefCode,hrefCtx);
assert.equal(hrefCtx.sourceHref(bundle),multiLinks);
// Mock Telegram at the delivery boundary to test ordering, partial failure and resume.
const deliveryCode = source.slice(source.indexOf('async function fulfillDownload'),source.indexOf('async function handleStartPayload'));
const deliveries = [], timers = [], writes = [];
let failSecond = true;
const deliveryCtx = vm.createContext({
  getItem:async()=>({title:'Test'}), pickDownloadSource:()=>({source:bundle}),
  CONFIG:{VANISH_SEC:10}, buildMediaCaption:()=>'', adKeyboard:()=>null,
  versionSources:mod.versionSources, hydrateSource:s=>s, htmlEscape:s=>s,
  deliverMedia:async(_token,_chat,s)=> {
    deliveries.push(String(s.msgId));
    return String(s.msgId)==='64' && failSecond ? {ok:false,description:'test failure'} : {ok:true,result:{message_id:s.msgId}};
  },
  vanishLater:async(_ctx,_token,_chat,id)=>timers.push(String(id)), tgSend:async()=>({ok:true})
});
vm.runInContext(deliveryCode,deliveryCtx);
const dl = {id:'test',itemId:'i_abc'};
const dlStore = {set:async(_key,value)=>writes.push(structuredClone(value))};
await deliveryCtx.fulfillDownload(dlStore,{},'token',1,dl,{});
assert.deepEqual(deliveries,['63','64']); assert(!dl.used); assert.equal(dl.sentParts.length,1);
failSecond = false;
await deliveryCtx.fulfillDownload(dlStore,{},'token',1,dl,{});
assert.deepEqual(deliveries,['63','64','64']); assert(dl.used);
assert.deepEqual(timers,['63','64']); assert(writes.at(-1).used);
console.log('PASS: Multi-link versions; full validation; source traversal; editor round-trip; ordered delivery, per-file deletion and partial-failure resume.');

const setupCode=mod.APP_HTML.slice(mod.APP_HTML.indexOf('function setupChannelId'),mod.APP_HTML.indexOf('function bindContentSetup'));
const setupCtx=vm.createContext({URL,NL:'\n'}); vm.runInContext(setupCode,setupCtx);
const rules=JSON.parse(setupCtx.buildChannelSetup('https://t.me/c/4458209353/63','123456789',''));
assert.deepEqual(rules,{'-1004458209353':{adminId:'123456789',publish:true,targets:[]}});
assert.throws(()=>setupCtx.buildChannelSetup('-1001111111111','123456789',''));
assert.throws(()=>setupCtx.buildChannelSetup('-1004458209353','42',''));
assert.throws(()=>setupCtx.buildChannelSetup('-1004458209353','123456789','-1004458209353'));
assert.throws(()=>setupCtx.setupChannelId('https://t.me/+invite'));
console.log('PASS: no-JSON setup builder accepts real post links and rejects placeholders, invite links and self-relays.');
