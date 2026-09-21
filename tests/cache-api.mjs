import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {Store,catRev,bumpCatRev};').toString('base64'));
/* ── کش جعلی Cache API ── */
const cacheMap=new Map();let putCount=0,lastPutTtl=0;
const fakeCache={
  async match(key){const e=cacheMap.get(key);return e?new Response(e.text,{status:e.status,headers:e.headers}):null;},
  async put(key,resp,opts){putCount++;lastPutTtl=opts?.expirationTtl ?? 0;
    cacheMap.set(key,{text:await resp.text(),status:resp.status,headers:[...resp.headers]});},
  async delete(key){cacheMap.delete(key);},
};
globalThis.caches={default:fakeCache};
const env={KV:null};
const get=path=>app.default.fetch(new Request('https://test'+path),env,{});

/* ── ۱) صفحهٔ اصلی: MISS سپس HIT ── */
{
  const r1=await get('/');
  assert.equal(r1.status,200);
  assert.equal(r1.headers.get('x-cache'),'MISS');
  const body1=await r1.text();
  assert(body1.includes('<html') || body1.includes('<!doctype'));
  const r2=await get('/');
  assert.equal(r2.headers.get('x-cache'),'HIT');
  assert.equal(await r2.text(),body1);
  assert(lastPutTtl===60,'کش صفحه باید ۶۰ ثانیه باشد');
}

/* ── ۲) فهرست عمومی: MISS سپس HIT، و بی‌اعتبارسازی با catrev ── */
{
  const c1=await get('/api/catalog');
  assert.equal(c1.status,200);
  assert.equal(c1.headers.get('x-cache'),'MISS');
  await c1.json();
  const c2=await get('/api/catalog');
  assert.equal(c2.headers.get('x-cache'),'HIT');
  await c2.json();
  // تغییر محتوا → catrev جلو می‌رود → کلید کش جدید → MISS
  const store=new app.Store(null,env);
  const revBefore=await app.catRev(store);
  await app.bumpCatRev(store);
  const revAfter=await app.catRev(store);
  assert.equal(revAfter,revBefore+1);
  const c3=await get('/api/catalog');
  assert.equal(c3.headers.get('x-cache'),'MISS','پس از تغییر محتوا، کش فهرست باید بی‌اعتبار باشد');
  await c3.json();
  const c4=await get('/api/catalog');
  assert.equal(c4.headers.get('x-cache'),'HIT');
  await c4.json();
}

/* ── ۳) پاسخ‌های خصوصی (کاربری) کش نمی‌شوند ── */
{
  const m1=await get('/api/me');
  await m1.json();
  assert.equal(m1.headers.get('x-cache'),null,'API کاربری نباید x-cache داشته باشد');
  const m2=await get('/api/me');
  await m2.json();
  assert.equal(m2.headers.get('x-cache'),null);
}

/* ── ۴) صفحه‌های غیرعمومی (مثلاً /storage-migration) کش نمی‌شوند ── */
{
  const s1=await get('/storage-migration');
  assert.equal(s1.status,200);
  assert.equal(s1.headers.get('x-cache'),null);
  await s1.text();
}

assert(putCount>=3,'چند کلید عمومی باید در Cache API ذخیره شده باشد');
console.log('PASS: Cache API (60s page+catalog cache with HIT/MISS, catrev invalidation, private APIs never cached).');
