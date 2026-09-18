import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {maintenanceBatch};').toString('base64'));
const from='-1003991198857',to='-1004305938506',other='-1004430176383';
const key=n=>'mirror:'+from+'/'+n+'/'+to, record=n=>({chatId:to,msgId:n});
const data=new Map(), archive=new Map(), durable=new Map();
const kv={get:async k=>structuredClone(archive.get(k)??null),delete:async k=>archive.delete(k),
 list:async({prefix,limit=10,cursor=''})=>{const keys=[...archive.keys()].filter(k=>k.startsWith(prefix)&&k>cursor).sort();return {keys:keys.slice(0,limit).map(name=>({name})),list_complete:keys.length<=limit,cursor:keys[limit-1]||''};}};
function active(){return {env:{KV:kv,STORAGE_BACKEND:'d1',EDITOR:{idFromName:n=>n,get:()=>({fetch:async request=>{const b=await request.json();return Response.json({records:durable.get(b.msgId)||{},active:null,managed:true});}})}},
 get:async k=>structuredClone(data.get(k)??null),del:async k=>data.delete(k),
 listPage:async(prefix,cursor,limit)=>{const keys=[...data.keys()].filter(k=>k.startsWith(prefix)&&k>cursor).sort();return {keys:keys.slice(0,limit),cursor:keys.length>limit?keys[limit-1]:''};}};}
const call=async body=>{const r=await app.maintenanceBatch(active(),body);return {status:r.status,...await r.json()};};
for (let n=100;n<104;n++) data.set(key(n),record(n));
// Known live source: must remain even though its message number is below the cutoff.
data.set('src:c:'+from+'/100','i_live');data.set('it:i_live',{id:'i_live',source:{chatId:from,msgId:'100'}});
// No ownership index is not evidence of an orphan.
// 101 intentionally has no src index.
// 102 can be safely removed because DO has the same destination mapping.
durable.set(102,{[to]:record(102)});
// 103 has a known owner whose item is gone.
data.set('src:c:'+from+'/103','i_removed');
let preview=await call({prefix:'mirror:',channel:from,before:171});
assert.deepEqual(preview.candidates.map(x=>x.key),[key(102),key(103)]);
assert.equal(preview.storage,'D1');
// A changed dependency after preview must be rechecked before deletion.
durable.set(102,{});
let result=await call({action:'delete',confirm:'DELETE_ORPHANS',keys:preview.candidates.map(x=>x.key),channel:from,before:171});
assert.equal(result.deleted,1);assert.equal(result.skipped,1);assert(data.has(key(102)));assert(data.has(key(100)));assert(data.has(key(101)));
archive.set(key(100),record(100));archive.set(key(101),record(900));archive.set(key(200),record(200));data.set(key(200),record(200));
archive.set('mirror:'+other+'/50/'+to,record(50));data.set('mirror:'+other+'/50/'+to,record(50));
preview=await call({scope:'legacy-kv',prefix:'mirror:',channel:from,before:171});
assert.deepEqual(preview.candidates.map(x=>x.key),[key(100)]);
assert.equal(preview.storage,'KV قدیمی');
result=await call({scope:'legacy-kv',action:'delete',confirm:'DELETE_ORPHANS',keys:[key(100),key(101),key(200),'u:admin'],channel:from,before:171});
assert.equal(result.deleted,1);assert.equal(result.skipped,3);
assert(data.has(key(100)),'live D1 mapping is preserved');assert(!archive.has(key(100)));
assert(archive.has(key(101)));assert(archive.has(key(200)));assert(archive.has('mirror:'+other+'/50/'+to));
assert.equal((await call({scope:'legacy-kv',prefix:'src:'})).status,400);
assert.equal((await call({prefix:'mirror:',channel:'bad'})).status,400);
assert.equal((await call({prefix:'mirror:',before:-1})).status,400);
assert.equal((await call({action:'delete',keys:[key(100)]})).status,400);
console.log('PASS: mirror cleanup preview, explicit storage selection, channel/cutoff filtering, preserved live/uncertain mappings and deletion-time revalidation.');
