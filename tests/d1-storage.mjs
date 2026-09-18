import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {D1Backend,D1_SCHEMA,Store,runD1Migration,signToken,D1_MIGRATION_HTML};').toString('base64'));
function database() {
 const sql=new DatabaseSync(':memory:');let failBatch=false;
 const db={sql,withSession:()=>db,prepare(text){
   const make=params=>({bind:(...p)=>make(p),first:async()=>sql.prepare(text).get(...params) ?? null,
     all:async()=>({results:sql.prepare(text).all(...params)}),run:async()=>({success:true,meta:sql.prepare(text).run(...params)}),text,params});return make([]);
 },batch:async statements=>{
   sql.exec('BEGIN');try{const results=[];for(const s of statements){results.push(await s.run());if(failBatch){failBatch=false;throw Error('simulated interrupted batch');}}sql.exec('COMMIT');return results;}
   catch(e){sql.exec('ROLLBACK');throw e;}
 },failNextBatch(){failBatch=true;}};return db;
}
let kvWrites=0;
const values=new Map(),expirations=new Map();
for(let i=0;i<37;i++) values.set('record:'+String(i).padStart(3,'0'),JSON.stringify({i,text:'فارسی'}));
values.set('set',JSON.stringify({secret:'test-secret'}));
values.set('u:admin',JSON.stringify({username:'admin',role:'admin',wallet:137}));
values.set('u:reader',JSON.stringify({username:'reader',role:'free'}));
values.set('ttl:sample',JSON.stringify({valid:true}));expirations.set('ttl:sample',Math.floor(Date.now()/1000)+3600);
const kv={get:async(k,opt)=>{const v=values.get(k)??null;return v && (opt==='json'||opt?.type==='json')?JSON.parse(v):v;},
 put:async()=>{kvWrites++;throw Error('KV writes forbidden');},delete:async()=>{kvWrites++;throw Error('KV delete forbidden');},
 list:async({prefix='',cursor='',limit=1000})=>{
 const keys=[...values.keys()].filter(k=>k.startsWith(prefix)&&k>cursor).sort();const page=keys.slice(0,limit);
 return {keys:page.map(name=>({name,...(expirations.has(name)?{expiration:expirations.get(name)}:{})})),list_complete:keys.length<=limit,cursor:page.at(-1) || ''};
 }};
const db=database(),env={KV:kv,DB:db,STORAGE_BACKEND:'kv',STORAGE_MAINTENANCE:'1'};
assert.throws(()=>new app.Store(kv,{...env,STORAGE_BACKEND:'d1',DB:null}),/DB/);
await assert.rejects(()=>app.runD1Migration({...env,STORAGE_MAINTENANCE:'0'},'start'),/MAINTENANCE/);
assert.equal((await app.runD1Migration(env,'status')).state,null);
await assert.rejects(()=>new app.Store(kv,{...env,STORAGE_BACKEND:'d1',STORAGE_MAINTENANCE:'0'}).get('set'),/نهایی/);
let state=(await app.runD1Migration(env,'start')).state;assert.equal(state.phase,'copy');
// A failed data/checkpoint batch must roll back both data and cursor.
// Fail the second batch (first batch only checks schema).
const originalBatch=db.batch;let batches=0;
db.batch=async statements=>{if(++batches===2) db.failNextBatch();return originalBatch(statements);};
await assert.rejects(()=>app.runD1Migration(env,'step'),/interrupted/);
assert.equal((await app.runD1Migration(env,'status')).state.copied,0);
assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM filmwork_records').get().n,0);
db.batch=originalBatch;
while(state.phase!=='ready') state=(await app.runD1Migration(env,'step')).state;
assert.equal(state.copied,values.size);assert.equal(state.verified,values.size);
assert.equal(kvWrites,0);
const active={...env,STORAGE_BACKEND:'d1',STORAGE_MAINTENANCE:'0'};
const store=new app.Store(kv,active);
assert.deepEqual(await store.get('u:admin'),{username:'admin',role:'admin',wallet:137});
assert.equal(db.sql.prepare('SELECT expires_at FROM filmwork_records WHERE key=?').get('ttl:sample').expires_at,expirations.get('ttl:sample'));
await store.set('record:new',{n:1});assert.deepEqual(await store.get('record:new'),{n:1});
await store.del('record:new');assert.equal(await store.get('record:new'),null);
assert(!values.has('record:new'));
await store.set('ttl:new',{n:1},90);
assert(db.sql.prepare('SELECT expires_at FROM filmwork_records WHERE key=?').get('ttl:new').expires_at>=Math.floor(Date.now()/1000)+89);
db.sql.prepare('UPDATE filmwork_records SET expires_at=1 WHERE key=?').run('ttl:new');
assert.equal(await new app.Store(kv,active).get('ttl:new'),null);
for (const key of ['literal_%:a','literal_%:b','literal_XX:a']) await store.set(key,{key});
assert.deepEqual((await store.listPage('literal_%:','',1)).keys,['literal_%:a']);
let cursor='',listed=[];
do {const page=await store.listPage('record:',cursor,7);listed.push(...page.keys);cursor=page.cursor;}while(cursor);
assert.equal(listed.length,37);assert.equal(new Set(listed).size,37);
const page=await store.listPage('record:','',1);
await assert.rejects(()=>store.listPage('u:',page.cursor,1),/نشانگر/);
await assert.rejects(()=>new app.Store(kv,{...active,STORAGE_MAINTENANCE:'1'}).set('x',1),/متوقف/);
// A deliberate source change is detected instead of activating divergent data.
const broken=database(),changed={...env,DB:broken};await app.runD1Migration(changed,'start');
let phase='copy';while(phase==='copy') phase=(await app.runD1Migration(changed,'step')).state.phase;
values.set('record:000',JSON.stringify({tampered:true}));
await assert.rejects(()=>app.runD1Migration(changed,'step'),/بررسی انتقال ناموفق/);
assert.equal((await app.runD1Migration(changed,'status')).state.phase,'verify');
values.set('record:000',JSON.stringify({i:0,text:'فارسی'}));
// Read-only admin auth works even with incomplete old settings and exhausted KV writes.
const ctx={storage:{}};const coordinator=new app.EditorSession(ctx,env);
env.EDITOR={idFromName:n=>n,get:()=>coordinator};
const token=await app.signToken({u:'admin'},'test-secret');
const call=(auth,action='status')=>app.default.fetch(new Request('https://test/api/admin/storage/d1',{method:'POST',headers:auth?{authorization:'Bearer '+auth}: {},body:JSON.stringify({action})}),env,{});
assert.equal((await call('')).status,403);
assert.equal((await call(await app.signToken({u:'reader'},'test-secret'))).status,403);
assert.equal((await call(token)).status,200);
assert.equal((await app.default.fetch(new Request('https://test/api/tg/webhook',{method:'POST',body:'{}'}),env,{})).status,503);
assert.equal((await app.default.fetch(new Request('https://test/storage-migration'),env,{})).status,200);
assert.equal((await call('', 'backup')).status,403);
const backup=await (await call(token,'backup')).json();
assert(backup.entries.length>0);assert.equal(backup.entries[0].value,values.get(backup.entries[0].key));
// Editorial publication on the D1 backend must not touch KV, including its journal replay.
active.CONTENT_ADMIN_IDS='42';
await store.set('set',{secret:'test-secret',vaultChatId:'-1001234567890',publicUrl:'https://test'});
await store.set('tg:42','admin');
await store.set('u:admin',{username:'admin',role:'admin',tgId:'42',wallet:137});
await store.set('it:i_d1',{id:'i_d1',title:'D1 Movie',type:'movie',updatedAt:1,variants:{sub:{},dub:{}}});
const durable=new Map(), pubCtx={storage:{get:async k=>structuredClone(durable.get(k)),put:async(k,v)=>durable.set(k,structuredClone(v)),delete:async k=>durable.delete(k)}};
const publisher=new app.EditorSession(pubCtx,active);
const job={actorId:'42',itemId:'i_d1',expectedUpdatedAt:1,jobId:'a'.repeat(32),files:[{key:'a'.repeat(16),kind:'dub',quality:'1080',season:1,episode:1,chatId:'-1001234567890',msgId:5,title:'نسخه آزمایشی'}]};
const publish=()=>publisher.fetch(new Request('https://internal/publish',{method:'POST',body:JSON.stringify(job)}));
assert.equal((await publish()).status,200);
assert.equal((await (await publish()).json()).replayed,true);
const actual=JSON.parse(db.sql.prepare('SELECT value FROM filmwork_records WHERE key=?').get('it:i_d1').value);
assert.equal(actual.variants.dub['1080'].files.length,1);
assert(!values.has('it:i_d1'));
assert.equal((await app.default.fetch(new Request('https://test/'),active,{})).status,200);
assert.equal(kvWrites,0);
new vm.Script(app.D1_MIGRATION_HTML.match(/<script>([\s\S]*?)<\/script>/)[1]);
console.log('PASS: real SQLite D1 adapter, safe migration, atomic checkpoints, TTL, prefix pagination, maintenance, read-only admin authorization and zero KV writes.');
