import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {D1Backend,D1_SCHEMA,Store,runD1Migration,isHeavyKey,isHeavyPrefix,storageMode};').toString('base64'));
function database() {
  const sql=new DatabaseSync(':memory:');
  const db={sql,withSession:()=>db,prepare(text){
    const make=params=>({bind:(...p)=>make(p),first:async()=>sql.prepare(text).get(...params) ?? null,
      all:async()=>({results:sql.prepare(text).all(...params)}),run:async()=>({success:true,meta:sql.prepare(text).run(...params)}),text,params});return make([]);
  },batch:async statements=>{const results=[];for(const s of statements) results.push(await s.run());return results;}};
  return db;
}
function readyDb() {
  const db=database();
  db.sql.exec('CREATE TABLE filmwork_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER) WITHOUT ROWID');
  db.sql.exec('CREATE TABLE filmwork_migration (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)');
  db.sql.prepare('INSERT INTO filmwork_migration(id,state) VALUES(1,?)').run(JSON.stringify({phase:'ready'}));
  return db;
}
function kvStore() {
  const values=new Map(),expirations=new Map();let puts=0,deletes=0;
  return {
    values,puts:()=>puts,deletes:()=>deletes,
    get:async(k,opt)=>{const v=values.get(k) ?? null;if(v==null)return null;
      if(expirations.has(k)&&expirations.get(k)<=Math.floor(Date.now()/1000))return null;
      return v&&(opt==='json'||opt?.type==='json')?JSON.parse(v):v;},
    put:async(k,v,opt)=>{puts++;values.set(k,v);if(opt?.expirationTtl)expirations.set(k,Math.floor(Date.now()/1000)+opt.expirationTtl);else expirations.delete(k);},
    delete:async k=>{deletes++;values.delete(k);expirations.delete(k);},
    list:async({prefix='',cursor='',limit=1000})=>{
      const now=Math.floor(Date.now()/1000);
      const keys=[...values.keys()].filter(k=>k.startsWith(prefix)&&k>cursor&&!(expirations.has(k)&&expirations.get(k)<=now)).sort();
      const page=keys.slice(0,limit);
      return {keys:page.map(name=>({name,...(expirations.has(name)?{expiration:expirations.get(name)}:{})})),list_complete:keys.length<=limit,cursor:page.at(-1) || ''};
    },
  };
}
function d1Keys(db){return db.sql.prepare('SELECT key FROM filmwork_records ORDER BY key').all().map(r=>r.key);}

/* ── ۱) مسیریابی ترکیبی: سنگین‌ها D1، سبک‌ها KV ── */
{
  const kv=kvStore(),db=readyDb(),env={KV:kv,DB:db,STORAGE_BACKEND:'hybrid'};
  const store=new app.Store(kv,env);
  assert.equal(store.hybrid,true);
  await store.set('u:hyb1',{username:'hyb1',wallet:5});
  await store.set('it:i_hyb1',{id:'i_hyb1',title:'آزمایش'});
  await store.set('src:chan/1','i_hyb1');
  await store.set('dlc:2026-09-18',{n:3});
  await store.set('set',{siteName:'تست'});
  await store.set('res:chan/1',{kind:'video'});
  const inD1=d1Keys(db);
  for(const k of ['u:hyb1','it:i_hyb1','src:chan/1','dlc:2026-09-18']){
    assert(inD1.includes(k),'سنگین '+k+' باید در D1 باشد');
    assert(!kv.values.has(k),'سنگین '+k+' نباید در KV باشد');
  }
  for(const k of ['set','res:chan/1']){
    assert(kv.values.has(k),'سبک '+k+' باید در KV باشد');
    assert(!inD1.includes(k),'سبک '+k+' نباید در D1 باشد');
  }
  assert.deepEqual(await store.get('u:hyb1'),{username:'hyb1',wallet:5});
  assert.deepEqual(await store.get('it:i_hyb1'),{id:'i_hyb1',title:'آزمایش'});
  assert.deepEqual(await store.get('set'),{siteName:'تست'});
  await store.del('src:chan/1');
  assert(!d1Keys(db).includes('src:chan/1'));
  assert.equal(await store.get('src:chan/1'),null);
}

/* ── ۲) D1 آماده‌نشده → سنگین‌ها به KV تنزل می‌کنند و سایت می‌چرخد ── */
{
  const kv=kvStore(),db=database();
  db.sql.exec('CREATE TABLE filmwork_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER) WITHOUT ROWID');
  db.sql.exec('CREATE TABLE filmwork_migration (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)');
  const env={KV:kv,DB:db,STORAGE_BACKEND:'hybrid'};
  const store=new app.Store(kv,env);
  await store.set('u:degraded',{username:'degraded',wallet:1});
  assert(kv.values.has('u:degraded'),'با D1 غیرآماده، سنگین‌ها باید به KV تنزل کنند');
  assert(!d1Keys(db).length,'داده‌ای نباید در D1 غیرآماده نوشته شود');
  assert.deepEqual(await store.get('u:degraded'),{username:'degraded',wallet:1});
  assert.deepEqual(await store.list('u:'),['u:degraded']);
}

/* ── ۳) فهرست‌گیری ترکیبی: پیشوند سنگین از D1، سبک از KV، خالی از هر دو (دوفاز) ── */
{
  const kv=kvStore(),db=readyDb(),env={KV:kv,DB:db,STORAGE_BACKEND:'hybrid'};
  const store=new app.Store(kv,env);
  await store.set('u:aa',{username:'aa'});
  await store.set('u:bb',{username:'bb'});
  await store.set('set',{siteName:'خ'});
  await store.set('res:z',{kind:'video'});
  const heavy=await store.list('u:');
  assert.deepEqual(heavy.sort(),['u:aa','u:bb']);
  const light=await store.list('res:');
  assert.deepEqual(light,['res:z']);
  const all=await store.list('');
  assert.deepEqual(all.sort(),['res:z','set','u:aa','u:bb'].sort(),'فهرست خالی باید دوفاز D1+KV بدهد');
  const page1=await store.listPage('', '', 2);
  assert.equal(page1.keys.length,2);
  assert(page1.cursor,'فهرست خالی باید کرسور دوفاز بدهد');
  const page2=await store.listPage('', page1.cursor, 10);
  assert.equal(new Set([...page1.keys,...page2.keys]).size,4);
  // پیشوند سنگین وقتی D1 خالی است → به KV تنزل (داده‌های قدیمی)
  const kvOnly=kvStore(),dbEmpty=readyDb(),s2=new app.Store(kvOnly,{KV:kvOnly,DB:dbEmpty,STORAGE_BACKEND:'hybrid'});
  kvOnly.values.set('u:legacy',JSON.stringify({username:'legacy'}));
  assert.deepEqual(await s2.list('u:'),['u:legacy']);
}

/* ── ) حالت قدیم all-D1 دست‌نخورده: همه‌چیز (حتی set) در D1 ── */
{
  const kv=kvStore(),db=readyDb(),env={KV:kv,DB:db,STORAGE_BACKEND:'d1'};
  const store=new app.Store(kv,env);
  assert.equal(store.hybrid,false);
  await store.set('set',{siteName:'قدیمی'});
  assert(d1Keys(db).includes('set'));
  assert.equal(kv.puts(),0,'حالت d1 نباید روی KV بنویسد');
  assert.deepEqual(await store.get('set'),{siteName:'قدیمی'});
}

/* ── ۵) حالت kv بدون D1: همه‌چیز KV (سازگاری کامل) ── */
{
  const kv=kvStore(),env={KV:kv};
  const store=new app.Store(kv,env);
  assert.equal(store.hybrid,false);
  await store.set('u:only',{username:'only'});
  await store.set('set',{siteName:'x'});
  assert(kv.values.has('u:only') && kv.values.has('set'));
}

/* ── ) طبقه‌بندی کلیدها ── */
assert.equal(app.isHeavyKey('u:x'),true);
assert.equal(app.isHeavyKey('it:i_123'),true);
assert.equal(app.isHeavyKey('idx'),true);
assert.equal(app.isHeavyKey('dlc:2026-09-18'),true);
assert.equal(app.isHeavyKey('rl:ip:1'),true);
assert.equal(app.isHeavyKey('set'),false);
assert.equal(app.isHeavyKey('res:a/1'),false);
assert.equal(app.isHeavyKey('gallery:x'),false);
assert.equal(app.isHeavyKey('catrev'),false);
assert.equal(app.isHeavyKey('mirror:-100123/4/-100567'),false);
assert.equal(app.isHeavyPrefix('u:'),true);
assert.equal(app.isHeavyPrefix('it:'),true);
assert.equal(app.isHeavyPrefix('set'),false);
assert.equal(app.isHeavyPrefix(''),false);
assert.equal(app.storageMode({STORAGE_BACKEND:'Hybrid'}),'hybrid');
assert.equal(app.storageMode({}), 'kv');
assert.equal(app.storageMode({STORAGE_BACKEND:'d1'}),'d1');

console.log('PASS: hybrid routing (D1 heavy incl. counters, KV light), D1-not-ready degrade, two-phase mixed listing, legacy d1/kv modes, key classification.');
