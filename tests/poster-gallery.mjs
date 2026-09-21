import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const app = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {Store, posterUrlFor, galleryPosterOf, signToken};').toString('base64'));

const IMG1 = 'https://www.impawards.com/2024/posters/p07209485.jpg';
const IMG2 = 'https://www.impawards.com/2024/posters/p07209486.jpg';
const TME = 'https://t.me/c/1111111111/222';

/* ── ۱) سرور: وقتی لینک پوستر خالی است، پوستر = اولین تصویر گالری IMP Awards،
   نه لینک منبع t.me (که برای فایل‌های document تصویر ندارد) ── */
{
  // فقط لینک منبع t.me (وضعیت قدیمی: پوستر خالی/۴۰ می‌ماند)
  assert.equal(app.posterUrlFor({ posterSrc: TME }), '/img?src=' + encodeURIComponent(TME));
  // گالری + لینک منبع → گالری برنده است
  assert.equal(app.posterUrlFor({ posterSrc: TME, galleryPoster: IMG1 }), '/img?url=' + encodeURIComponent(IMG1));
  // هیچ‌کدام → خالی
  assert.equal(app.posterUrlFor({}), '');
}

/* ── ۲) سرور: لینک پوستر صریح (ادمن) همیشه اولویت دارد ── */
{
  const explicit = 'https://example.com/p.jpg';
  assert.equal(app.posterUrlFor({ posterOverride: explicit, galleryPoster: IMG1, posterSrc: TME }), '/img?url=' + encodeURIComponent(explicit));
  const tmeOverride = 'https://t.me/somechan/77';
  assert.equal(app.posterUrlFor({ posterOverride: tmeOverride, galleryPoster: IMG1 }), '/img?src=' + encodeURIComponent(tmeOverride));
}

/* ── ۳) galleryPosterOf: اولین تصویر معتبر گالری؛ نامعتبرها رد می‌شوند ── */
{
  assert.equal(app.galleryPosterOf({ galleryImages: [{ url: IMG1 }, { url: IMG2 }] }), IMG1);
  assert.equal(app.galleryPosterOf({ galleryImages: ['not-a-url', { url: IMG2 }] }), IMG2);
  assert.equal(app.galleryPosterOf({ galleryImages: [] }), '');
  // سازگاری با گالری قدیمی imdb
  assert.equal(app.galleryPosterOf({ imdbImages: [{ url: 'https://imdb.example/x.jpg' }] }), 'https://imdb.example/x.jpg');
}

/* ── ۴) کلاینت: posterSlidesForView — اولین تصویر گالری پوستر می‌شود ── */
{
  const start = source.indexOf('function posterSrc (it) {');
  const end = source.indexOf('function posterCarouselSource (it) {');
  assert.ok(start > 0 && end > start, 'client block not found');
  const mod = new vm.Script('(function(){' + source.slice(start, end) + '\nreturn { posterSlidesForView };})()');
  const { posterSlidesForView } = mod.runInNewContext({});
  const proxied = u => '/img?url=' + encodeURIComponent(u);

  // لینک پوستر خالی + منبع t.me + گالری → اولین تصویر گالری پوستر است
  let slides = posterSlidesForView({
    poster: TME, posterOverride: '', source: { tmeUrl: TME },
    galleryImages: [{ url: IMG1, caption: '' }, { url: IMG2, caption: 'توضیح' }], galleryLimit: 6,
  });
  assert.equal(slides[0].url, proxied(IMG1), 'اولین تصویر گالری باید پوستر باشد');
  assert.equal(slides[0].main, true);
  assert.equal(slides[1].url, proxied(IMG2));

  // بدون گالری → همان رفتار قدیمی (لینک منبع)
  slides = posterSlidesForView({ poster: TME, posterOverride: '', source: { tmeUrl: TME }, galleryImages: [] });
  assert.equal(slides[0].url, '/img?src=' + encodeURIComponent(TME));

  // لینک پوستر صریحِ مدیر (t.me) → به انتخاب مدیر احترام می‌شود
  slides = posterSlidesForView({
    poster: TME, posterOverride: TME,
    galleryImages: [{ url: IMG1, caption: '' }], galleryLimit: 6,
  });
  assert.equal(slides[0].url, '/img?src=' + encodeURIComponent(TME), 'پوستر صریح مدیر نباید با گالری عوض شود');

  // لینک پوستر صریحِ سایت دیگر → اولویت
  slides = posterSlidesForView({
    poster: '', posterOverride: 'https://example.com/p.jpg',
    galleryImages: [{ url: IMG1, caption: '' }], galleryLimit: 6,
  });
  assert.equal(slides[0].url, '/img?url=' + encodeURIComponent('https://example.com/p.jpg'));
}

/* ── ۵) سر به سر: آیتم واردشده از فایل document (بدون تصویر) + گالری
   → پوستر فهرست/هریس = اولین تصویر گالری ── */
{
  const SECRET = 'supersecret123';
  const item = {
    id: 'i_p', title: 'تست | Test', type: 'movie', year: 2024, quality: '1080',
    access: 'free', featured: false, addedAt: 1, genres: [], description: '',
    poster: TME, posterOverride: '',
    source: { tmeUrl: TME, chatId: null, fileId: '', mediaType: 'document' },
    galleryUrl: 'https://www.impawards.com/2024/p07209485.html',
    galleryImages: [{ url: IMG1, caption: '' }],
    galleryImagesUpdatedAt: 1, galleryLimit: 6,
    seasons: [], variants: { sub: {}, dub: {} },
  };
  const data = new Map([
    ['set', { siteName: 'تست', secret: SECRET, botToken: '123:xyz' }],
    ['u:adm', { username: 'adm', role: 'admin', tgId: '1' }],
    ['it:i_p', item],
  ]);
  const kv = {
    get: async k => data.get(k) ?? null,
    put: async (k, v) => data.set(k, typeof v === 'string' ? JSON.parse(v) : v),
    delete: async k => data.delete(k),
    list: async ({ prefix = '' }) => ({ keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  };
  const env = { KV: kv };
  const token = await app.signToken({ u: 'adm', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const save = await app.default.fetch(new Request('https://test/api/admin/item/i_p', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: 'تست | Test' }),
  }), env, {});
  assert.equal(save.status, 200, 'admin save باید موفق باشد');
  const cat = await app.default.fetch(new Request('https://test/api/catalog'), env, {});
  const j = await cat.json();
  assert.equal(j.items.length, 1);
  assert.equal(j.items[0].poster, '/img?url=' + encodeURIComponent(IMG1), 'پوستر فهرست باید اولین تصویر گالری باشد');
  // صفحهٔ جزئیات (کاربر عادی) هم تصویر گالری را می‌گیرد
  const view = await app.default.fetch(new Request('https://test/api/item/i_p'), env, {});
  const vj = await view.json();
  assert.equal(vj.item.poster, '/img?url=' + encodeURIComponent(IMG1));
}

console.log('PASS: poster fallback (empty poster link → first IMP Awards gallery image, server + client, admin override respected).');
