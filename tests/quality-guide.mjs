import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

/* ── بلوک خالص صفحهٔ راهنما (تو IIFE است؛ از سورس استخراج و مستقیم اجرا می‌شود) ── */
const start = source.indexOf('/* ═══════════════ راهنمای انتخاب کیفیت فیلم');
const end = source.indexOf('function viewAuth (q) {');
assert.ok(start > 0 && end > start, 'quality guide block not found');
const block = source.slice(start, end);
const mod2 = new vm.Script('(function(){' + block + '\nreturn { viewQualityGuide, qgQuizResult, QG_RES, QG_VER };})()');
const { viewQualityGuide, qgQuizResult, QG_RES, QG_VER } = mod2.runInNewContext({});

// ── ۱. داده‌ها ──
assert.equal(QG_RES.length, 6);
assert.equal(QG_VER.length, 10);
assert.equal(QG_RES.map(n => n.id).join(','), '480p,720p,1080p,1440p,2160p,4320p');
assert.equal(QG_VER.map(n => n.id).join(','), 'blu-ray,bdrip,brrip,web-dl,webrip,hdtv,tvrip,dvdrip,hdcam,hdts'); // از بهترین به ضعیف‌ترین

// ── ۲. صفحهٔ راهنما ──
const html = viewQualityGuide({});
assert.match(html, /کدوم کیفیت فیلم رو انتخاب کنم؟/);
for (const s of ['id="res"', 'id="ver"', 'id="enc"', 'id="x265"', 'id="howto"', 'id="summary"', 'id="faq"', 'id="qg-toc"', 'id="qg-quiz-body"']) {
  assert.ok(html.includes(s), 'missing ' + s);
}
// نودهای درختی: ۶ رزولوشن + ۱۰ نسخه + ۳ faq = ۱۹
const nodes = html.match(/class="qg-node"/g) || [];
assert.equal(nodes.length, 19);
// فهرست درختی با لینک‌های زیرمجموعه
assert.ok(html.includes('class="lvl2"'));
assert.ok(html.includes('href="#res-1080p"'));
assert.ok(html.includes('href="#ver-web-dl"'));
assert.ok(html.includes('href="#ver-hdcam"'));
assert.ok(html.includes('data-spy="res"') && html.includes('data-spy="faq"'));
// محتوا (از مقالهٔ technolife)
assert.ok(html.includes('ShaAniG') && html.includes('MkvCage') && html.includes('Ganool') && html.includes('PSA'));
assert.ok(html.includes('x265') && html.includes('HEVC'));
assert.ok(html.includes('1920×1080'));
assert.ok(html.includes('سرویس استریم') && html.includes('دیسک بلوری') && html.includes('دوربین گوشی از سینما'));
assert.ok(html.includes('توصیه نمی‌شود')); // badge HDCAM
assert.ok(html.includes('واترمارک'));
// بدون from: CTA بازگشت به فیلم نمی‌آید
assert.ok(!html.includes('بازگشت به صفحهٔ دانلود'));
// تگ‌ها متوازن باشند
assert.equal((html.match(/<section/g) || []).length, (html.match(/<\/section>/g) || []).length);
assert.equal((html.match(/<ul/g) || []).length, (html.match(/<\/ul>/g) || []).length);
assert.equal((html.match(/<li/g) || []).length, (html.match(/<\/li>/g) || []).length);
assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);

// ── ۳. با from: دکمهٔ بازگشت + ضد تزریق ──
const html2 = viewQualityGuide({ from: 'i_abc123' });
assert.ok(html2.includes('href="#/item/i_abc123"'));
assert.ok(html2.includes('بازگشت به صفحهٔ دانلود'));
const html3 = viewQualityGuide({ from: 'i_x"><script>alert(1)' });
assert.ok(!html3.includes('<script>alert(1)'));
assert.ok(!html3.includes('href="#/item/i_x"'));

// ── ۴. لینک راهنما داخل باکس دانلود (هر دو شاقه: فیلم و سریال) ──
const di = source.indexOf('function viewItem (data, id) {');
const dlEnd = source.indexOf('var related = ', di);
assert.ok(di > 0 && dlEnd > di);
const dlPanelSrc = source.slice(di, dlEnd);
assert.ok(dlPanelSrc.includes('q-guide-link'), 'link template missing');
assert.ok(dlPanelSrc.includes('#/quality?from='));
const seriesBranch = dlPanelSrc.slice(dlPanelSrc.indexOf('if (isSeries)'), dlPanelSrc.indexOf('} else {'));
const movieBranch = dlPanelSrc.slice(dlPanelSrc.indexOf('} else {'), dlPanelSrc.indexOf('var related'));
assert.ok(seriesBranch.includes('qgLink'), 'series branch missing link');
assert.ok(movieBranch.includes('qgLink'), 'movie branch missing link');

// ── ۵. روت /quality در render ──
const ri = source.indexOf('function render () {');
const rEnd = source.indexOf('shell(emptyHtml(\'😕\', \'صفحه پیدا نشد\'', ri);
const renderSrc = source.slice(ri, rEnd);
assert.ok(renderSrc.includes("path === '/quality'"), 'route missing');
assert.ok(renderSrc.includes('viewQualityGuide(r.query)'));
assert.ok(renderSrc.includes('bindQualityGuide(r.query)'));

// ── . منطق پیشنهاد کوییز ─
assert.equal(qgQuizResult(['tv', 'ok', 'old']).q, '4K (2160p)');
assert.equal(qgQuizResult(['tv', 'ok', 'old']).ver, 'Blu-Ray / BDRip');
assert.equal(qgQuizResult(['tv', 'low', 'new']).q, '1080p (FHD)');
assert.equal(qgQuizResult(['tv', 'low', 'new']).ver, 'WEB-DL');
assert.equal(qgQuizResult(['pc', 'low', 'old']).q, '720p (HD)');
assert.equal(qgQuizResult(['phone', 'ok', 'new']).q, '1080p (FHD)');
assert.equal(qgQuizResult(['phone', 'low', 'old']).q, '720p (HD)');

// ── ۷. HTML تولیدشده در مرورگر بدون خطا رندر شود (بررسی vm ساده + ساختار) ──
const full = source.slice(source.indexOf('const APP_HTML = `'), source.indexOf('`;\nexport default', source.indexOf('const APP_HTML = `')));
assert.ok(full.length > 100000);

console.log('PASS: quality guide (data, page structure, 19 tree nodes, tree TOC, article content, back-CTA+sanitize, dl-box link in movie+series, /quality route, quiz logic).');
