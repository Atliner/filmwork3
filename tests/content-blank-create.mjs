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

// ── ۲) تنظیم دستی لینک منبع نباید هیچ کیفیت/واریانتی (مثلاً 1080p) بسازد ──
globalThis.fetch = async () => Response.json({ ok: true, result: {} });
const withSrc = await app.adminUpsertItem(store(), set, { sourceUrl: 'https://t.me/c/3981503084/368' }, it);
assert(withSrc.item.source, 'لینک منبع باید تنظیم شود');
assert.equal(Object.keys(withSrc.item.variants.sub).length, 0, 'تنظیم لینک منبع نباید کیفیت زیرنویس بسازد');
assert.equal(Object.keys(withSrc.item.variants.dub).length, 0, 'تنظیم لینک منبع نباید کیفیت دوبله بسازد');

// ── ۳) کیفیت 1080p که ادمین دستی می‌سازد، با ذخیرهٔ مجدد فرم برنگردد (باگ ریورت) ──
const manual = JSON.parse(JSON.stringify(withSrc.item));
manual.variants.sub['1080'] = { source: { chatId: '3981503084', msgId: '371' }, sizeBytes: null, files: [] };
const resaved = await app.adminUpsertItem(store(), set, { sourceUrl: 'https://t.me/c/3981503084/368' }, manual);
assert.equal(resaved.item.variants.sub['1080'].source.msgId, '371', 'ذخیرهٔ فرم نباید کیفیت 1080p دستی را به لینک منبع برگرداند');

// ── ۴) خالی‌کردن لینک منبع باید ذخیره شود (باگ «حتی پاک هم نمی‌شه») ──
const cleared = await app.adminUpsertItem(store(), set, { sourceUrl: '' }, withSrc.item);
assert.equal(cleared.item.source, null, 'خالی‌کردن لینک فایل تلگرام باید منبع را پاک کند');

// ── ۵) رابط کاربری: عنوان کیفیت باید قابل ویرایش/ذخیره باشد ──
assert(source.includes("$all('[data-ql]', root)"), 'ورودی عنوان کیفیت باید هندلر ذخیره داشته باشد');
assert(source.includes('qualityLabel: lab, setLabel: true'), 'تغییر عنوان کیفیت باید به سرور ارسال شود');
assert(source.includes('body.setLabel'), 'سرور باید پرچم setLabel را برای پاک‌کردن عنوان پشتیبانی کند');

// ── ۶) دکمهٔ «ثبت» نسخه حذف شده و عنوان/لینک با خارج‌شدن از فیلد ذخیره می‌شود ──
assert(!source.includes('data-vf='), 'دکمهٔ ثبت نسخه باید حذف شده باشد');
assert(!source.includes('vf-new-go'), 'دکمهٔ ثبت افزودن نسخه باید حذف شده باشد');
assert(source.includes("$all('[data-vt]', root)") && source.includes("$all('[data-vu2]', root)"),
  'عنوان و لینک نسخه باید هندلر change (ذخیره با خروج از فیلد) داشته باشند');
assert(source.includes("addEventListener('change', function () { saveVarRow(el); })"),
  'ذخیرهٔ خودکار نسخه باید روی رویداد change باشد');

// ── ۳) رابط کاربری: دکمهٔ سادهٔ افزودن به‌جای فیلد لینک ──
assert(source.includes('افزودن محتوای جدید'), 'دکمهٔ افزودن محتوای جدید باید وجود داشته باشد');
assert(!source.includes('افزودن از لینک پست تلگرام'), 'باکس افزودن از لینک باید حذف شده باشد');
assert(!source.includes('adm-url'), 'فیلد لینک افزودن نباید باقی بماند');
assert(source.includes("api('/admin/item', { method: 'POST', body: {} })"), 'دکمه باید محتوای خالی بسازد');

console.log('PASS: blank content creation, no auto-fill, clearable source link, simple add button.');
