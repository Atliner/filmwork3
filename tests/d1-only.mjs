/* نصب «فقط D1» — بدون هیچ KV.
   هدف: سایت با یک D1 خالی بالا بیاید، خودش اسکیما را بسازد، تنظیمات/کاربر/اثر را
   بنویسد و بخواند و هیچ نوشتن KV نخواهد. همین حالت پایهٔ اجرای سایت روی هاست
   اشتراکی (Node + node:sqlite) هم هست. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const app = await import('data:text/javascript;base64,' + Buffer.from(source +
  '\nexport { D1Backend, D1_SCHEMA, Store, storageMode, d1AutoInit, makeStore, mergeSettings };').toString('base64'));

/* همان آداپتور سبک D1 روی SQLite (مثل تست d1-storage) */
function database() {
  const sql = new DatabaseSync(':memory:');
  const db = {
    sql, withSession: () => db,
    prepare(text) {
      const make = (params) => ({
        bind: (...p) => make(p),
        first: async () => sql.prepare(text).get(...params) ?? null,
        all: async () => ({ results: sql.prepare(text).all(...params) }),
        run: async () => ({ success: true, meta: sql.prepare(text).run(...params) }),
        text, params,
      });
      return make([]);
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}

/* ── ۱) حالت پیش‌فرض: فقط DB → d1، بوت‌استرپ روشن ── */
{
  assert.equal(app.storageMode({ DB: {} }), 'd1', 'DB تنها بدون STORAGE_BACKEND → d1');
  assert.equal(app.storageMode({ DB: {}, KV: {} }), 'hybrid', 'DB+KV بدون تنظیم → hybrid');
  assert.equal(app.storageMode({ KV: {} }), 'kv');
  assert.equal(app.storageMode({}), 'kv');
  assert.equal(app.d1AutoInit({ DB: {} }), true, 'بدون KV، ساخت خودکار اسکیما روشن است');
  assert.equal(app.d1AutoInit({ DB: {}, KV: {} }), false, 'با KV (نصب قدیمی) رفتار قبلی: انتقال دستی');
  assert.equal(app.d1AutoInit({ DB: {}, D1_AUTO_BOOTSTRAP: '1' }), true);
  assert.equal(app.d1AutoInit({ DB: {}, D1_AUTO_BOOTSTRAP: '0' }), false);
}

/* ── ۲) D1 خالی: اولین درخواست خودش جدول‌ها را می‌سازد و ready می‌شود ── */
{
  const db = database();
  const env = { DB: db, STORAGE_BACKEND: 'd1' };
  const store = app.makeStore(env);
  assert.equal(store.kv instanceof app.D1Backend, true);
  assert.equal(await store.get('set'), null, 'قبل از بوت‌استرپ هیچ کلیدی نیست');
  const settings = app.mergeSettings({ secret: 'x'.repeat(32), webhookSecret: 'y'.repeat(16), siteName: 'سایت تست' });
  await store.set('set', settings);
  await store.set('u:ali', { username: 'ali', role: 'admin', wallet: 7 });
  await store.set('it:i_1', { id: 'i_1', title: 'فیلم', type: 'movie' });
  assert.deepEqual(await store.get('u:ali'), { username: 'ali', role: 'admin', wallet: 7 });
  assert.deepEqual((await store.list('u:')), ['u:ali']);
  const row = db.sql.prepare('SELECT state FROM filmwork_migration WHERE id=1').get();
  assert.equal(JSON.parse(row.state).phase, 'ready');
  assert.equal(JSON.parse(row.state).auto, true);
  const tables = db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert(tables.includes('filmwork_records') && tables.includes('filmwork_migration'));
  /* TTL روی D1 */
  await store.set('stm:ali', { list: [] }, 60);
  assert(db.sql.prepare('SELECT expires_at FROM filmwork_records WHERE key=?').get('stm:ali').expires_at > Math.floor(Date.now() / 1000));
  db.sql.prepare('UPDATE filmwork_records SET expires_at=1 WHERE key=?').run('stm:ali');
  assert.equal(await app.makeStore(env).get('stm:ali'), null, 'رکورد منقضی خوانده نمی‌شود');
  console.log('PASS: نصب فقط-D1 — اسکیمای خودکار، ready، خواندن/نوشتن/فهرست/TTL بدون هیچ KV.');
}

/* ── ۳) KV بایند شده ولی STORAGE_BACKEND=d1 و D1_AUTO_BOOTSTRAP=1 ── */
{
  let kvWrites = 0;
  const kv = {
    get: async () => { throw new Error('KV نباید خوانده شود'); },
    put: async () => { kvWrites++; throw new Error('KV نباید نوشته شود'); },
    delete: async () => { kvWrites++; throw new Error('KV نباید حذف شود'); },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  };
  const db = database();
  const env = { KV: kv, DB: db, STORAGE_BACKEND: 'd1', D1_AUTO_BOOTSTRAP: '1' };
  const store = app.makeStore(env);
  await store.set('set', { secret: 's'.repeat(32), webhookSecret: 'w'.repeat(16) });
  await store.set('dlc:2026-11-01', { n: 1 });
  assert.equal((await store.get('set')).webhookSecret, 'w'.repeat(16));
  assert.equal(kvWrites, 0, 'در حالت d1 هیچ نوشتن KV انجام نمی‌شود');
  console.log('PASS: حالت d1 با KV بایندشده — صفر نوشتن KV (بوت‌استرپ دستی).');
}

/* ── ۴) بدون DB و بدون KV: خطای روشن، نه سقوط بی‌پیام ── */
{
  assert.throws(() => new app.Store(null, { STORAGE_BACKEND: 'd1' }), /DB/);
  const store = app.makeStore({});
  assert.equal(await store.get('set'), null, 'بدون بک‌اند، حافظهٔ موقت پاسخ می‌دهد');
  console.log('PASS: نبود اتصال D1 پیام روشن می‌دهد و Store بدون بک‌اند نمی‌شکند.');
}
