/* ردیف «ادامهٔ تماشا» در صفحهٔ خانه — همان کدی که در مرورگر اجرا می‌شود
   (از داخل قالب APP_HTML بیرون کشیده و با localStorage جعلی اجرا می‌شود).

   اگر این تست سبز باشد:
     ۱) پلیر وضعیت تماشا را در mvx_resume می‌نویسد و صفحهٔ خانه از آن ردیف می‌سازد،
     ۲) درصد پیشرفت و «دقیقهٔ مانده» درست حساب می‌شود،
     ۳) عنوان‌ها escape می‌شوند (XSS از نام فایل/محتوا ممکن نیست)،
     ۴) ردیف کهنه (بیش از ۹۰ روز) و فایل تمام‌شده نمایش داده نمی‌شود،
     ۵) دکمهٔ «پاک کردن فهرست» واقعاً حذف می‌کند. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = (await import('data:text/javascript;base64,' + Buffer.from(source +
  `\nexport { APP_HTML };`).toString('base64'))).APP_HTML;

const a = html.indexOf('function resumeItems');
const b = html.indexOf('function adminEmptyGuide');
assert.ok(a > 0 && b > a, 'بلوک «ادامهٔ تماشا» در قالب صفحه هست');
const block = html.slice(a, b);

/* ── پیش‌نیازهای همان محیط مرورگر (فقط برای این بلوک) ── */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const typeLabel = (t) => (t === 'series' ? 'سریال' : t === 'movie' ? 'فیلم' : 'محتوا');

function makeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}
function load(storage) {
  const made = [];
  const $ = (sel) => {
    const el = {
      sel, listeners: {}, parentNode: null,
      addEventListener(e, f) { this.listeners[e] = f; },
      click() { this.listeners.click && this.listeners.click(); },
      removeChild() { this.removed = true; }
    };
    made.push(el);
    return el;
  };
  const f = new Function('localStorage', 'esc', 'faNum', 'typeLabel', '$',
    block + '\nreturn { resumeItems: resumeItems, resumeCardHtml: resumeCardHtml, resumeRowHtml: resumeRowHtml, bindResumeRow: bindResumeRow };');
  return { api: f(storage, esc, faNum, typeLabel, $), made, $ };
}

const DAY = 86400000;
const now = Date.now();
const rec = (over) => Object.assign({ id: 'i_abc123', ep: '', title: 'فیلم تست', poster: '/img/p1', type: 'movie', t: 1200, d: 6000, at: now }, over);

/* ── ۱. فهرست خالی: هیچ ردیفی رندر نمی‌شود ── */
{
  const { api } = load(makeStorage());
  assert.equal(api.resumeRowHtml(), '', 'بدون سابقه، ردیف ساخته نمی‌شود');
  assert.deepEqual(api.resumeItems(), []);
}

/* ── ۲. یک فایل نیمه‌تماشاشده ── */
{
  const st = makeStorage({ mvx_resume: JSON.stringify([rec()]) });
  const { api } = load(st);
  const row = api.resumeRowHtml();
  assert.ok(row.indexOf('id="row-rsm"') > 0, 'ردیف ساخته شد');
  assert.ok(row.indexOf('ادامهٔ تماشا') > 0, 'عنوان ردیف');
  assert.ok(row.indexOf('href="#/item/i_abc123"') > 0, 'لینک به صفحهٔ اثر');
  assert.ok(row.indexOf('style="width:20%"') > 0, 'پیشرفت = ۱۲۰۰/۶۰۰۰ = ۲۰٪');
  assert.ok(row.indexOf('ادامه ۲۰٪') > 0, 'برچسب درصد با رقم فارسی');
  assert.ok(row.indexOf('۸۰ دقیقه مانده') > 0, 'زمان باقی‌مانده');
  assert.ok(row.indexOf('فیلم تست') > 0, 'عنوان');
  assert.ok(row.indexOf('id="rsm-clear"') > 0, 'دکمهٔ پاک کردن');
}

/* ── ۳. سریال: برچسب فصل/قسمت به‌جای نوع ── */
{
  const { api } = load(makeStorage({ mvx_resume: JSON.stringify([rec({ ep: 'e_1', epT: 'فصل ۲ · قسمت ۵', type: 'series' })]) }));
  const row = api.resumeRowHtml();
  assert.ok(row.indexOf('فصل ۲ · قسمت ۵') > 0, 'برچسب قسمت');
  assert.ok(row.indexOf('href="#/item/i_abc123"') > 0, 'لینک اثر (قسمت در صفحه انتخاب می‌شود)');
}

/* ── ۴. عنوان خطرناک باید escape شود ── */
{
  const evil = rec({ title: '<img src=x onerror="alert(1)">' });
  const { api } = load(makeStorage({ mvx_resume: JSON.stringify([evil]) }));
  const row = api.resumeRowHtml();
  assert.ok(row.indexOf('<img src=x') < 0, 'تگ تزریق‌شده در HTML نمی‌آید');
  assert.ok(row.indexOf('&lt;img src=x') > 0, 'نسخهٔ escape‌شده');
  assert.ok(row.indexOf('onerror=') < 0 || row.indexOf('&quot;') > 0, 'attribute injection ممکن نیست');
}

/* ── ۵. ورودی‌های بی‌اعتبار/کهنه/تمام‌شده فیلتر می‌شوند ── */
{
  const list = [
    rec({ id: 'i_old', at: now - 120 * DAY }),                       // کهنه
    rec({ id: 'i_done', t: 6000 }),                                   // تمام‌شده (۱۰۰٪)
    rec({ id: 'i_zero', t: 0 }),                                      // شروع‌نشده
    rec({ id: 'i_ok', t: 600, d: 1200, at: now - 2 * DAY }),          // معتبر
    { title: 'بی‌شناسه', t: 100, d: 200 },                            // بدون id
    null
  ];
  const { api } = load(makeStorage({ mvx_resume: JSON.stringify(list) }));
  const items = api.resumeItems();
  assert.equal(items.length, 1, 'فقط رکورد معتبر می‌ماند (' + items.map((x) => x.id).join(',') + ')');
  assert.equal(items[0].id, 'i_ok');
  const row = api.resumeRowHtml();
  assert.ok(row.indexOf('i_ok') > 0);
  assert.ok(row.indexOf('i_old') < 0 && row.indexOf('i_done') < 0 && row.indexOf('i_zero') < 0);
}

/* ── ۶. JSON خراب: خطا نمی‌دهد، فقط ردیف خالی ── */
{
  const { api } = load(makeStorage({ mvx_resume: '{not json' }));
  assert.deepEqual(api.resumeItems(), [], 'JSON خراب نادیده گرفته می‌شود');
  assert.equal(api.resumeRowHtml(), '');
}

/* ── ۷. سقف ۱۲ کارت ── */
{
  const list = Array.from({ length: 20 }, (_, i) => rec({ id: 'i_' + String(i).padStart(6, '0'), t: 100 + i }));
  const { api } = load(makeStorage({ mvx_resume: JSON.stringify(list) }));
  assert.equal(api.resumeItems().length, 12, 'حداکثر ۱۲ مورد');
}

/* ── ۸. دکمهٔ «پاک کردن فهرست» ── */
{
  const st = makeStorage({ mvx_resume: JSON.stringify([rec()]) });
  const { api, made } = load(st);
  // $ برای هر شناسه یک المنت می‌سازد؛ ترتیب: #rsm-clear سپس #row-rsm
  let btn = null, row = null;
  const fake$ = (sel) => {
    const el = { sel, listeners: {}, parentNode: { removeChild() { el.removed = true; } }, addEventListener(e, f) { this.listeners[e] = f; }, click() { this.listeners.click && this.listeners.click(); } };
    if (sel === '#rsm-clear') btn = el; else row = el;
    return el;
  };
  const fn = new Function('localStorage', 'esc', 'faNum', 'typeLabel', '$',
    block + '\nreturn { bindResumeRow: bindResumeRow };');
  const api2 = fn(st, esc, faNum, typeLabel, fake$);
  api2.bindResumeRow();
  assert.ok(btn && btn.listeners.click, 'شنوندهٔ کلیک وصل شد');
  btn.click();
  assert.equal(st.getItem('mvx_resume'), null, 'فهرست از localStorage پاک شد');
  assert.ok(row && row.removed, 'ردیف از DOM حذف شد');
}

console.log('PASS: «ادامهٔ تماشا» — خواندن mvx_resume، درصد/زمان باقی‌مانده، escape عنوان، فیلتر کهنه و تمام‌شده، سقف ۱۲ و پاک‌کردن فهرست.');
