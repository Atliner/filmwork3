/* بخش اختیاری «🎬 لینک پخش آنلاین» در ربات سوم: ورود به بخش، انتخاب اثر، ارسال چند خط،
   پیش‌نمایش، ثبت از طریق هماهنگ‌کنندهٔ انتشار، فهرست، حذف، خروج؛ و اینکه پیش‌نویس فایل‌ها خراب نشود. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const main = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { Store };').toString('base64'));
const { EditorSession } = main;

const data = new Map([
  ['set', { vaultChatId: '-1001234567890', secret: 'testing', siteName: 'Test' }],
  ['tg:42', 'tg42'], ['u:tg42', { username: 'tg42', tgId: '42', role: 'admin' }],
  ['it:i_abc', { id: 'i_abc', type: 'series', title: 'سیلو | Silo', updatedAt: 1, genres: [], episodes: [], seasons: [{ n: 1, title: 'فصل ۱', episodes: [{ id: 'e_one', n: 1, title: 'قسمت ۱', variants: { sub: {}, dub: {} } }] }], variants: { sub: {}, dub: {} } }],
]);
const kv = {
  get: async k => structuredClone(data.get(k) ?? null),
  put: async (k, v) => data.set(k, JSON.parse(v)),
  delete: async k => data.delete(k),
  list: async () => ({ keys: [], list_complete: true }),
};
function context() {
  const entries = new Map();
  return { storage: { get: async k => structuredClone(entries.get(k)), put: async (k, v) => entries.set(k, structuredClone(v)), delete: async k => entries.delete(k), list: async () => new Map(), setAlarm: async () => { }, getAlarm: async () => null, deleteAlarm: async () => { } }, entries };
}
const sent = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').at(-1), body = JSON.parse(init.body);
  sent.push({ method, body });
  return Response.json({ ok: true, result: { message_id: 900 } });
};
try {
  const env = { CONTENT_BOT_TOKEN: 'fake', CONTENT_WEBHOOK_SECRET: 'webhook-test', CONTENT_ADMIN_IDS: '42', SITE_PUBLIC_ORIGIN: 'https://site.test', KV: kv };
  const coordinator = new EditorSession(context(), env);
  env.EDITOR = { idFromName: n => n, get: () => coordinator };
  const ctx = context(), session = new EditorSession(ctx, env);
  let updateId = 0;
  const say = async (text, extras = {}) => {
    const id = ++updateId;
    await session.fetch(new Request('https://editor.internal/update', { method: 'POST', body: JSON.stringify({ update_id: id, message: { message_id: id, from: { id: 42 }, chat: { id: 42, type: 'private' }, text, ...extras } }) }));
    return sent.at(-1);
  };
  let last = await say('/help');
  assert.ok(last.body.reply_markup.keyboard.flat().includes('🎬 لینک پخش آنلاین'), 'دکمهٔ بخش جدید در منوی اصلی');
  last = await say('🎬 لینک پخش آنلاین');
  assert.match(last.body.text, /لینک صفحهٔ فیلم یا سریال/);
  assert.deepEqual(last.body.reply_markup.keyboard[0], ['ثبت لینک‌های پخش', 'پیش‌نمایش پخش']);
  assert.equal(ctx.entries.get('stream').phase, 'item');
  last = await say('سلام'); // متن نامرتبط در مرحلهٔ انتخاب اثر
  assert.match(last.body.text, /لینک صفحهٔ فیلم یا سریال/);
  last = await say('https://site.test/#/item/i_abc');
  assert.equal(ctx.entries.get('stream').phase, 'collect');
  assert.match(last.body.text, /S01E05 720 دوبله/);
  assert.ok(!ctx.entries.has('draft'), 'لینک اثر در بخش پخش، پیش‌نویس فایل نمی‌سازد');
  last = await say('S01E01 720 دوبله https://cdn.example.com/silo-s01e01-720.mp4\nS01E01 1080 زیرنویس https://cdn.example.com/silo-s01e01-1080.mp4 | WEB-DL\nS01E02 720 دوبله https://cdn.example.com/silo-s01e02-720.mkv\nS01E01 زیرنویس https://cdn.example.com/silo-s01e01.fa.srt\nS01E03 https://cdn.example.com/bad.mp4');
  assert.match(last.body.text, /📥 4 لینک/);
  assert.match(last.body.text, /خط 5/);
  assert.match(last.body.text, /MKV/);
  assert.equal(ctx.entries.get('stream').entries.length, 4);
  last = await say('S01E01 720 دوبله https://cdn.example.com/silo-s01e01-720.mp4');
  assert.equal(ctx.entries.get('stream').entries.length, 4, 'خط تکراری دوباره اضافه نمی‌شود');
  last = await say('پیش‌نمایش پخش');
  assert.match(last.body.text, /S01E01 \| دوبله \| 720p \| MP4/);
  assert.match(last.body.text, /cdn\.example\.com\/…\/silo-s01e01-720\.mp4/);
  assert.equal(data.get('it:i_abc').seasons[0].episodes[0].streams, undefined, 'پیش از ثبت، چیزی در سایت تغییر نکرده');
  last = await say('ثبت لینک‌های پخش');
  assert.match(last.body.text, /✅ لینک‌های پخش/);
  assert.match(last.body.text, /جدید: 4/);
  assert.match(last.body.text, /قسمت تازه: 1/);
  const item = data.get('it:i_abc');
  const e1 = item.seasons[0].episodes.find(e => e.n === 1), e2 = item.seasons[0].episodes.find(e => e.n === 2);
  assert.equal(e1.streams.length, 2); assert.equal(e1.streamSubs.length, 1); assert.equal(e2.streams[0].fmt, 'mkv');
  assert.equal(ctx.entries.get('stream').entries.length, 0);
  last = await say('لینک‌های پخش فعلی');
  assert.match(last.body.text, /\(4\)/);
  last = await say('حذف S01E02');
  assert.match(last.body.text, /1 حذف/);
  last = await say('ثبت لینک‌های پخش');
  assert.match(last.body.text, /حذف‌شده: 1/);
  assert.equal(data.get('it:i_abc').seasons[0].episodes.find(e => e.n === 2).streams, undefined);
  /* دستورهای اصلی در بخش پخش هم کار می‌کنند و بخش فایل‌ها دست نمی‌خورد */
  last = await say('/help');
  assert.match(last.body.text, /شناسه تلگرام شما/);
  last = await say('خروج از بخش پخش');
  assert.ok(!ctx.entries.has('stream'));
  assert.ok(last.body.reply_markup.keyboard.flat().includes('🎬 لینک پخش آنلاین'));
  last = await say('https://site.test/#/item/i_abc');
  assert.ok(ctx.entries.has('draft'), 'بعد از خروج، لینک اثر دوباره پیش‌نویس فایل می‌سازد');
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: content bot online-stream section (menu, item pick, multi-line staging with errors/warnings, dedupe, preview, coordinated save, list, delete, exit) without touching file drafts.');
