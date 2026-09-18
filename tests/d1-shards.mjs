import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {Store,RemoteShard,shardHash};').toString('base64'));
const SECRET='0123456789abcdef0123456789abcdef';
function database() {
  const sql=new DatabaseSync(':memory:');
  const db={sql,withSession:()=>db,prepare(text){
    const make=params=>({bind:(...p)=>make(p),first:async()=>sql.prepare(text).get(...params) ?? null,
      all:async()=>({results:sql.prepare(text).all(...params)}),run:async()=>({success:true,meta:sql.prepare(text).run(...params)}),text,params});return make([]);
  },batch:async statements=>{for(const s of statements) await s.run();return [];}};
  return db;
}
function readyDb(){
  const db=database();
  db.sql.exec('CREATE TABLE filmwork_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER) WITHOUT ROWID');
  db.sql.exec('CREATE TABLE filmwork_migration (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)');
  db.sql.prepare('INSERT INTO filmwork_migration(id,state) VALUES(1,?)').run(JSON.stringify({phase:'ready'}));
  return db;
}
function kvStore(){
  const values=new Map();
  return {values,
    get:async k=>{const v=values.get(k) ?? null;return v?JSON.parse(v):null;},
    put:async(k,v)=>{values.set(k,v);},
    delete:async k=>{values.delete(k);},
    list:async({prefix='',cursor='',limit=1000})=>{
      const keys=[...values.keys()].filter(k=>k.startsWith(prefix)&&k>cursor).sort();
      const page=keys.slice(0,limit);
      return {keys:page.map(name=>({name})),list_complete:keys.length<=limit,cursor:page.at(-1) || ''};
    }};
}
/* ── سرور شارد جعلی با تأیید واقعی امضای HMAC (الگوریتم مستقل) ── */
function makeShardServer(name, opts={}) {
  const store=new Map(),log=[];
  let down=false,badSig=false;
  return {
    name,store,log,
    set down(v){down=v;}, get down(){return down;},
    set badSig(v){badSig=v;},
    async handle(url, init) {
      log.push({name, url: new URL(url).href, method: init?.method || 'GET'});
      if (down) throw new Error('network down: '+name);
      const u=new URL(url);
      const bodyText=init?.body || '';
      const ts=init.headers['x-shard-ts'], nonce=init.headers['x-shard-nonce'], sign=init.headers['x-shard-sign'];
      const bodyHash=crypto.createHash('sha256').update(bodyText).digest('hex');
      const expected=crypto.createHmac('sha256',SECRET).update((init?.method || 'GET')+'\n'+u.pathname+u.search+'\n'+bodyHash+'\n'+ts+'\n'+nonce).digest('hex');
      if (badSig || expected!==String(sign).toLowerCase()) return new Response(JSON.stringify({error:'bad-signature'}),{status:401});
      if (u.pathname==='/health') return new Response(JSON.stringify({ok:true,count:store.size}),{status:200});
      if (u.pathname==='/get'){
        const k=u.searchParams.get('k');
        if (!/^(it:|sub:)/.test(k||'')) return new Response(JSON.stringify({error:'key-not-allowed'}),{status:400});
        return new Response(JSON.stringify(store.has(k)?{value:JSON.parse(store.get(k))}:{missing:true}),{status:200});
      }
      if (u.pathname==='/put'){
        const b=JSON.parse(bodyText);
        if (!/^(it:|sub:)/.test(b.k)) return new Response(JSON.stringify({error:'key-not-allowed'}),{status:400});
        store.set(b.k,b.v);
        return new Response(JSON.stringify({ok:true}),{status:200});
      }
      if (u.pathname==='/del'){
        const b=JSON.parse(bodyText);
        store.delete(b.k);
        return new Response(JSON.stringify({ok:true}),{status:200});
      }
      return new Response(JSON.stringify({error:'not-found'}),{status:404});
    },
  };
}
const A=makeShardServer('shard-a'),B=makeShardServer('shard-b');
const kv=kvStore(),db=readyDb();
kv.values.set('set',JSON.stringify({
  secret:'shard-test-secret',
  shards:[{id:'a',url:'https://shard-a.test',secret:SECRET},{id:'b',url:'https://shard-b.test',secret:SECRET}],
}));
const env={KV:kv,DB:db,STORAGE_BACKEND:'hybrid'};
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
  const u=String(url);
  if (u.startsWith('https://shard-a.test/')) return A.handle(u,init);
  if (u.startsWith('https://shard-b.test/')) return B.handle(u,init);
  return realFetch(url,init);
};
try {
  /* ── ۱) مسیریابی قطعی hash: هر کلید به یک شارد ثابت ── */
  assert.equal(app.shardHash('it:i_1'),app.shardHash('it:i_1'),'hash باید قطعی باشد');
  /* نوشتن اثر → فقط شارد مربوطه، نه D1 اصلی */
  const store=new app.Store(kv,env);
  const key='it:i_fed1';
  await store.set(key,{id:'i_fed1',title:'شارد ۱'});
  const idx=app.shardHash(key)%2;
  const target=idx===0?A:B, other=idx===0?B:A;
  assert(target.store.has(key),'کلید باید در شارد hash‌شده نوشته شود');
  assert(!other.store.has(key),'کلید نباید در شارد دیگر باشد');
  assert(!db.sql.prepare('SELECT key FROM filmwork_records WHERE key=?').get(key),'نوشته‌شده روی شارد نباید در D1 اصلی تکرار شود');
  /* خواندن → از شارد (نمونهٔ تازه، بدون memoization درون‌درخواستی) */
  const storeR=new app.Store(kv,env);
  assert.deepEqual(await storeR.get(key),{id:'i_fed1',title:'شارد ۱'});
  assert(target.log.some(e=>e.url.endsWith('/get?k='+encodeURIComponent(key))),'باید از شارد hash‌شده خوانده شود');
  /* sub: هم فدره می‌شود */
  const subKey='sub:s_fed1';
  await store.set(subKey,{id:'s_fed1',itemId:'i_fed1'});
  assert((app.shardHash(subKey)%2===0?A:B).store.has(subKey));
  /* حذف → از شارد */
  await store.del(key);
  assert(!target.store.has(key));
  /* ── ۲) کلیدهای غیرفدره هرگز به شارد نمی‌روند ── */
  const beforeA=A.log.length,beforeB=B.log.length;
  await store.set('u:feduser',{username:'feduser',wallet:9});
  await store.set('src:chan/9','i_fed1');
  await store.set('set',{siteName:'بعد از تغییر'});
  assert.equal(A.log.length,beforeA,'u:/src:/set نباید به شارد a برود');
  assert.equal(B.log.length,beforeB,'u:/src:/set نباید به شارد b برود');
  assert(db.sql.prepare('SELECT key FROM filmwork_records WHERE key=?').get('u:feduser'),'کاربر باید در D1 اصلی بماند');
  /* ── ۳) شارد قطع → خواندن از D1 اصلی (نسخه محلی) ── */
  target.down=true;
  db.sql.prepare('INSERT INTO filmwork_records(key,value,expires_at) VALUES(?,?,?)').run(key,JSON.stringify({id:'i_fed1',title:'نسخه محلی'}),null);
  const store2=new app.Store(kv,env);
  assert.deepEqual(await store2.get(key),{id:'i_fed1',title:'نسخه محلی'},'با شارد قطع، باید از D1 اصلی بخواند');
  /* ── ۴) شارد قطع → نوشتن به D1 اصلی تنزل می‌کند ── */
  const key2='it:i_fed2';
  await store2.set(key2,{id:'i_fed2',title:'تنزل'});
  const idx2=app.shardHash(key2)%2;
  const target2=idx2===0?A:B;
  assert(target2.down);
  assert(db.sql.prepare('SELECT key FROM filmwork_records WHERE key=?').get(key2),'با شارد قطع، نوشتن باید به D1 اصلی بیفتد');
  /* ── ۵) امضای نادرست (رمز اشتباه) رد می‌شود و تنزل محلی انجام می‌شود ── */
  target2.down=false;
  target2.badSig=true;
  const key3='it:i_fed3';
  const store3=new app.Store(kv,env);
  await store3.set(key3,{id:'i_fed3',title:'امضای خراب'});
  assert(db.sql.prepare('SELECT key FROM filmwork_records WHERE key=?').get(key3),'با رد امضا، نوشتن باید محلی بشود');
  assert(!target2.store.has(key3));
  target2.badSig=false;
  /* ── ۶) سلامت: ۳ شکست پشت‌سرهم → شارد «ناسالم» و بدون fetch تا ۳۰ ثانیه ─ */
  const A2=new app.RemoteShard({id:'a2',url:'https://shard-a.test',secret:SECRET});
  A.down=true;
  for(let i=0;i<3;i++) await assert.rejects(()=>A2.health());
  assert.equal(A2.healthy(),false,'بعد از ۳ شکست، شارد باید ناسالم شود');
  A.down=false;
  A2.lastFail=Date.now()-31000;A2.fails=3;
  assert.equal(A2.healthy(),true,'بعد از ۳۰ ثانیه، شارد دوباره شانس می‌گیرد');
} finally {
  globalThis.fetch=realFetch;
}
console.log('PASS: D1 federation (deterministic hash routing, it:/sub: only, local fallback on shard failure, HMAC rejection, health circuit-breaker).');
