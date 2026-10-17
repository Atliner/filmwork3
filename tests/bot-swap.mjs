import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { miniAppUrl, webhookStale, maybeSetWebhook, ensureCurrentOrigin, htmlPage, sendDlNotice, getSettings, bustSettings, Store, CONFIG };').toString('base64'));
const { miniAppUrl, webhookStale, maybeSetWebhook, ensureCurrentOrigin, htmlPage, sendDlNotice, getSettings, bustSettings, Store, CONFIG } = mod;

/* ── ۱) لینک مینی‌اپ از یوزرنیم فعلی ربات ساخته می‌شود، نه ربات قدیمیِ ثابت ── */
assert.equal(miniAppUrl({ botUsername: 'new_login_bot' }), 'https://t.me/new_login_bot/directlink');
assert.equal(miniAppUrl({ botUsername: '@new_login_bot' }), 'https://t.me/new_login_bot/directlink');
assert.equal(miniAppUrl({ botUsername: '' }), CONFIG.MINI_APP_URL);
assert.equal(miniAppUrl({}), CONFIG.MINI_APP_URL);
assert.equal(miniAppUrl(null), CONFIG.MINI_APP_URL);
const page = htmlPage({ siteName: 'تست', tagline: '', botUsername: 'new_login_bot' });
const pageHtml = await page.text();
assert.ok(pageHtml.includes('https://t.me/new_login_bot/directlink'), 'HTML باید لینک ربات جدید را داشته باشد');
assert.ok(!pageHtml.includes('movie_shatelup_bot'), 'هیچ لینکی نباید به ربات قدیمی برود');
console.log('PASS: mini-app links derive from the current bot username (bot + web buttons/share links)');

/* ── ۲) تشخیص «وبهوک قدیمی/جاافتاده» بعد از عوض‌شدن توکن ربات ── */
assert.equal(webhookStale(null), false);
assert.equal(webhookStale({}), false);
assert.equal(webhookStale({ botToken: '111:A' }), true, 'بدون وبهوک ثبت‌شده → تازه‌سازی لازم است');
assert.equal(webhookStale({ botToken: '111:A', botId: 111, webhookOk: true, webhookBotId: 111 }), false, 'همان رباتِ ثبت‌شده → تازه‌سازی لازم نیست');
assert.equal(webhookStale({ botToken: '222:B', botId: 222, webhookOk: true, webhookBotId: 111 }), true, 'ربات جدید (توکن عوض شده) → باید دوباره ثبت شود');
assert.equal(webhookStale({ botToken: '222:B', botId: 222, webhookOk: true }), true, 'پرچم قدیمی بدون ثبتِ آیدی → خودترمیمی');
assert.equal(webhookStale({ botToken: '111:A', botId: 111, webhookOk: true, webhookBotId: 111, deliveryBotToken: '333:C', fileWebhookBotId: 222 }), true, 'فقط ربات ارسال عوض شده → وبهوک فایل باید تازه شود');
assert.equal(webhookStale({ botToken: '111:A', botId: 111, webhookOk: true, webhookBotId: 111, deliveryBotToken: '333:C', fileWebhookBotId: 333 }), false, 'هر دو وبهوک به‌روز → کاری لازم نیست');
console.log('PASS: webhookStale detects swapped main/delivery bots and missing registrations');

/* ── ۳) maybeSetWebhook برای هر دو ربات وبهوک ثبت می‌کند و آیدی‌ها را می‌نویسد ── */
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/setWebhook')) return { ok: true, json: async () => ({ ok: true, result: true }) };
  if (u.includes('/getMe')) {
    const token = u.match(/bot([^/]+)\//)[1];
    const username = token === '111:AAA' ? 'new_login_bot' : 'new_file_bot';
    return { ok: true, json: async () => ({ ok: true, result: { id: Number(token.split(':')[0]), username } }) };
  }
  return { ok: true, json: async () => ({ ok: true, result: {} }) };
};
try {
  const set = {
    botToken: '111:AAA', botUsername: 'new_login_bot', botUserFromEnv: true,
    deliveryBotToken: '222:BBB', deliveryBotUsername: 'new_file_bot', deliveryUserFromEnv: true,
    webhookSecret: 's3cr3t', publicUrl: 'https://site.example',
  };
  await maybeSetWebhook({}, set, 'https://site.example');
  const hooks = calls.filter(c => c.url.includes('/setWebhook'));
  assert.equal(hooks.length, 2, 'هم ربات ورود و هم ربات ارسال باید وبهوک بگیرند');
  assert.ok(hooks.some(c => c.url.includes('bot111:AAA/setWebhook') && c.body.url === 'https://site.example/api/tg/webhook'));
  assert.ok(hooks.some(c => c.url.includes('bot222:BBB/setWebhook') && c.body.url === 'https://site.example/api/tg/file-webhook'));
  assert.ok(hooks.every(c => c.body.secret_token === 's3cr3t'));
  assert.equal(set.webhookOk, true);
  assert.equal(set.fileWebhookOk, true);
  assert.equal(set.webhookBotId, 111, 'آیدی رباتی که وبهوک برایش ثبت شد باید ذخیره شود');
  assert.equal(set.fileWebhookBotId, 222);
  assert.equal(webhookStale(set), false, 'بعد از ثبت موفق، دیگر تازه‌سازی لازم نیست');

  // تعویض توکن → stale → ثبت دوباره با توکن جدید
  calls.length = 0;
  const swapped = Object.assign({}, set, { botToken: '333:CCC', botId: 333, botUserFromEnv: true, botUsername: 'newer_bot' });
  assert.equal(webhookStale(swapped), true);
  await maybeSetWebhook({}, swapped, 'https://site.example');
  assert.ok(calls.some(c => c.url.includes('bot333:CCC/setWebhook')), 'وبهوک باید با توکن جدید ثبت شود');
  assert.equal(swapped.webhookBotId, 333);
  assert.equal(webhookStale(swapped), false);
} finally {
  globalThis.fetch = realFetch;
}
console.log('PASS: maybeSetWebhook registers both bots and records which bot the webhooks belong to');

/* ── ۴) دکمهٔ اعلان دانلود هم به مینی‌اپِ ربات فعلی می‌رود ── */
{
  const sent = [];
  const rf = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  try {
    const store = new Store(null, {});
    bustSettings(store);
    await store.set('set', {
      secret: 'x', botToken: '111:AAA', deliveryBotToken: '222:BBB',
      botUsername: 'new_login_bot', deliveryBotUsername: 'new_file_bot',
      dlLimitNotify: true,
    });
    const set = await getSettings(store);
    const out = await sendDlNotice(store, { tgId: '555', itemId: 'i_film9' });
    assert.equal(out.ok, true);
    const btn = sent[0].body.reply_markup.inline_keyboard[0][0];
    assert.equal(btn.url, 'https://t.me/new_login_bot/directlink?startapp=item_i_film9');
  } finally {
    globalThis.fetch = rf;
  }
  console.log('PASS: download-limit notice button opens the mini app of the current bot');
}

console.log('PASS: bot swap via Runtime variables — mini-app links and webhook re-registration follow the new bots');

/* ── ۵) جابه‌جایی دامنه (فیلتر/تغییر نام ورکر یا ساب‌دامنهٔ کلودفلر):
      publicUrl و وبهوک ربات‌ها با اولین درخواست از آدرس جدید، خودکار دنبال می‌روند ── */
{
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/setWebhook')) return { ok: true, json: async () => ({ ok: true, result: true }) };
    if (u.includes('/getMe')) return { ok: true, json: async () => ({ ok: true, result: { id: 111, username: 'new_login_bot' } }) };
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  try {
    const m = new Map();
    const kv = { put: async (k, v) => { m.set(k, v); }, get: async (k, o) => { const v = m.get(k); return v == null ? null : (o === 'json' || (o && o.type === 'json') ? JSON.parse(v) : v); }, delete: async k => { m.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
    const env = { KV: kv };
    const store = new Store(kv, env);
    bustSettings();
    await store.set('set', { secret: 'migration-secret-0123456789abcdef', publicUrl: 'https://film.filmbazha.workers.dev', botToken: '111:AAA', botId: 111, webhookOk: true, webhookBotId: 111 });
    const req = new Request('https://film1.filmbazha.workers.dev/');
    assert.equal(await ensureCurrentOrigin(store, await getSettings(store), req, null), true, 'مبدأ جدید باید مهاجرت کند');
    assert.equal((await getSettings(store)).publicUrl, 'https://film1.filmbazha.workers.dev', 'آدرس عمومی دنبال آدرس جدید می‌رود');
    assert.ok(calls.some(c => c.url.includes('/setWebhook') && c.body.url === 'https://film1.filmbazha.workers.dev/api/tg/webhook'), 'وبهوک باید به آدرس جدید ثبت شود');
    calls.length = 0;
    assert.equal(await ensureCurrentOrigin(store, await getSettings(store), new Request('https://film1.filmbazha.workers.dev/api/me'), null), false, 'همان مبدأ = بدون کار اضافه');
    assert.equal(calls.length, 0, 'درخواست تکراری نباید دوباره وبهوک بزند');
    const req2 = new Request('https://film.filmbazha2.workers.dev/');
    assert.equal(await ensureCurrentOrigin(store, await getSettings(store), req2, null), true, 'جابه‌جایی دوباره (ساب‌دامنهٔ جدید) هم کار می‌کند');
    assert.equal((await getSettings(store)).publicUrl, 'https://film.filmbazha2.workers.dev');
    env.SITE_PUBLIC_ORIGIN = 'https://film.filmbazha2.workers.dev';
    assert.equal(await ensureCurrentOrigin(store, await getSettings(store), new Request('https://other.example.dev/'), null), false, 'با SITE_PUBLIC_ORIGIN آدرس قفل است');
    assert.equal((await getSettings(store)).publicUrl, 'https://film.filmbazha2.workers.dev', 'آدرس قفل‌شده تغییر نمی‌کند');
  } finally {
    globalThis.fetch = realFetch;
    bustSettings();
  }
}
console.log('PASS: moving the site to a new domain (worker rename / account prefix change) auto-migrates publicUrl and re-registers bot webhooks');
