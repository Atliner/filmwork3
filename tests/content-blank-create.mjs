import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const app = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {Store,adminUpsertItem};').toString('base64'));

const data = new Map();
const kv = {
  get: async k => structuredClone(data.get(k) ?? null),
  put: async (k, v) => data.set(k, JSON.parse(v)),
  delete: async k => data.delete(k),
  list: async ({ prefix }) => ({ keys: [...data.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
};
const env = { KV: kv };
const store = () => new app.Store(kv, env);
const set = {};

// ── ۱) ساخت محتوای خالی، بدون هیچ لینکی ──
const created = await app.adminUpsertItem(store(), set, {}, null);
assert(created.item, 'محتوای خالی باید ساخته شود');
const it = created.item;
assert.equal(it.posterOverride, '', 'لینک پوستر نباید خودکار پر شود');
assert.equal(it.source, null, 'منبع نباید خودکار تنظیم شود');
assert.deepEqual(it.variants, { sub: {}, dub: {} }, 'هیچ کیفیت زیرنویس/دوبله‌ای نباید خودکار ساخته شود');
assert.equal(Object.keys(it.variants.sub).length, 0, 'کیفیت زیرنویس باید خالی باشد');

// ── ۲) تنظیم دستی لینک منبع، سپس پاک‌کردن آن باید ذخیره شود ──
globalThis.fetch = async () => Response.json({ ok: true, result: {} });
const withSrc = await app.adminUpsertItem(store(), set, { sourceUrl: 'https://t.me/kanal/12345' }, it);
assert(withSrc.item.source, 'لینک منبع باید تنظیم شود');

// حالا خالی می‌کنیم — باید پاک شود (باگ «حتی پاک هم نمی‌شه»)
const cleared = await app.adminUpsertItem(store(), set, { sourceUrl: '' }, withSrc.item);
assert.equal(cleared.item.source, null, 'خالی‌کردن لینک فایل تلگرام باید منبع را پاک کند');

// ── ۳) رابط کاربری: دکمهٔ سادهٔ افزودن به‌جای فیلد لینک ──
assert(source.includes('افزودن محتوای جدید'), 'دکمهٔ افزودن محتوای جدید باید وجود داشته باشد');
assert(!source.includes('افزودن از لینک پست تلگرام'), 'باکس افزودن از لینک باید حذف شده باشد');
assert(!source.includes('adm-url'), 'فیلد لینک افزودن نباید باقی بماند');
assert(source.includes("api('/admin/item', { method: 'POST', body: {} })"), 'دکمه باید محتوای خالی بسازد');

console.log('PASS: blank content creation, no auto-fill, clearable source link, simple add button.');
