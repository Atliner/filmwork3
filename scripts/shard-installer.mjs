/**
 * 🧩 نصب خودکار shard-proxy روی اکانت دیگر Cloudflare
 * فقط روی ترمینال کامپیوتر خودتان اجرا شود — هرگز از مرورگر سایت.
 *
 * این نصب‌کننده یک Worker جدید می‌سازد (هرگز روی Worker موجودی پوشش نمی‌دهد)،
 * D1 مقصد را انتخاب/می‌سازد، یک رمز تصادفی SHARD_SECRET تولید می‌کند و
 * آدرس + رمز را چاپ می‌کند تا در پنل سایت (تنظیمات ← ذخیره‌سازی) وارد شود.
 *
 * اجرا: node scripts/shard-installer.mjs
 */
import {readFile} from 'node:fs/promises';
import {mkdtemp, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {randomBytes} from 'node:crypto';
import {createCloudflareClient} from './editor-installer.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';
const COMPAT_DATE = '2026-09-01';

function validateWorkerName(value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) throw new Error('نام Worker نامعتبر است؛ فقط حروف کوچک، عدد، خط تیره/زیرمیان (مثل shard-1).');
  return value;
}
function newSecret() {
  return randomBytes(32).toString('hex');
}
async function listD1(api, account) {
  const base = '/accounts/' + account + '/d1/database';
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await api(base + '?per_page=50&page=' + page);
    if (!Array.isArray(res.result)) throw new Error('فهرست دیتابیس‌های D1 قابل خواندن نیست.');
    out.push(...res.result);
    const total = res.result_info?.total_pages;
    if ((total && page >= total) || (!total && res.result.length < 50)) break;
  }
  return out;
}
async function createD1(api, account, name) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('نام دیتابیس D1 نامعتبر است.');
  const res = await api('/accounts/' + account + '/d1/database', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name})});
  if (!res.result?.id) throw new Error('ساخت D1 انجام نشد.');
  return res.result;
}
async function workerExists(api, account, worker) {
  try {
    await api('/accounts/' + account + '/workers/scripts/' + worker + '/settings');
    return true;
  } catch (e) {
    if (String(e.message).includes('HTTP 400') || String(e.message).includes('HTTP 404')) return false;
    throw e;
  }
}
async function deploy(api, account, worker, d1, secret, code) {
  if (await workerExists(api, account, worker)) throw new Error('Worker با این نام از قبل وجود دارد؛ برای جلوگیری از پوشش‌دادن، نصب متوقف شد. نام دیگر انتخاب کنید.');
  if (!code.includes('export default')) throw new Error('فایل shard-proxy-worker.js کامل نیست.');
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPAT_DATE,
    bindings: [
      {name: 'SHARD_DB', type: 'd1_database', database_id: d1.id, database_name: d1.name},
      {name: 'SHARD_SECRET', type: 'secret_text', text: secret},
    ],
  };
  const body = new FormData();
  body.set('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
  body.set('worker.js', new Blob([code], {type: 'application/javascript+module'}), 'worker.js');
  await api('/accounts/' + account + '/workers/scripts/' + worker, {method: 'PUT', body});
  if (!(await workerExists(api, account, worker))) throw new Error('درخواست پذیرفته شد ولی Worker ثبت نشده؛ داشبورد را بررسی کنید.');
}
async function cli() {
  if (!process.stdin.isTTY) throw new Error('نصب‌کننده باید در ترمینال تعاملی کامپیوتر خودتان اجرا شود.');
  const rl = createInterface({input: process.stdin, output: process.stdout});
  const privateDir = await mkdtemp(path.join(tmpdir(), 'filmwork-shard-'));
  await chmod(privateDir, 0o700).catch(() => {});
  const childEnv = {...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(privateDir, 'wrangler.log')};
  async function wrangler(args, capture = false) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.131.1', ...args], {
        cwd: ROOT, env: childEnv, shell: process.platform === 'win32', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      });
      let output = '';
      if (capture) { child.stdout.on('data', c => { output += c; }); child.stderr.on('data', () => {}); }
      child.on('error', () => reject(new Error('اجرای ابزار Cloudflare ممکن نشد. Node.js و اتصال اینترنت را بررسی کنید.')));
      child.on('close', code => code === 0 ? resolve(output) : reject(new Error('ورود/دریافت اطلاعات حساب Cloudflare ناموفق بود.')));
    });
  }
  try {
    console.log('\n🧩 نصب خودکار shard-proxy — روی اکانت دیگر Cloudflare\nتوکن یا رمز تلگرام لازم نیست. فقط Worker جدید می‌سازد؛ Worker موجودی را دست نمی‌زند.\n');
    console.log('مرورگر برای ورود رسمی Cloudflare باز می‌شود؛ حساب «دیگر» (شارد) را انتخاب کنید.');
    await wrangler(['login']);
    let identity;
    try { identity = JSON.parse(await wrangler(['whoami', '--json'], true)); } catch { throw new Error('اطلاعات حساب از ابزار Cloudflare قابل دریافت نیست.'); }
    const accounts = identity.accounts || [];
    if (!accounts.length) throw new Error('حساب Cloudflare در دسترس پیدا نشد.');
    accounts.forEach((a, i) => console.log((i + 1) + '. ' + a.name));
    const choice = accounts.length === 1 ? 1 : Number(await rl.question('شماره اکانت شارد: '));
    if (!Number.isInteger(choice) || !accounts[choice - 1]) throw new Error('حساب انتخاب‌شده نامعتبر است.');
    const account = accounts[choice - 1].id;
    let workersDomain = '';
    try { workersDomain = (identity.users || []).map(u => u.workersDomain).filter(Boolean)[0] || ''; } catch {}
    let credentials;
    try { credentials = JSON.parse(await wrangler(['auth', 'token', '--json'], true)); } catch { throw new Error('مجوز ورود به‌صورت امن قابل دریافت نیست؛ دوباره ورود مرورگری را انجام دهید.'); }
    await rm(path.join(privateDir, 'wrangler.log'), {force: true});
    if (!['oauth', 'api_token'].includes(credentials.type)) throw new Error('لطفاً از ورود مرورگری Cloudflare استفاده کنید، نه Global API Key.');
    const api = createCloudflareClient(credentials.token);

    const worker = validateWorkerName((await rl.question('نام Worker شارد [shard-1]: ')).trim() || 'shard-1');
    if (await workerExists(api, account, worker)) throw new Error('Worker با این نام از قبل وجود دارد؛ نام دیگری انتخاب کنید.');

    const dbs = await listD1(api, account);
    let d1;
    if (dbs.length) {
      dbs.forEach((d, i) => console.log((i + 1) + '. ' + d.name + '  (' + d.id + ')'));
      const ans = String(await rl.question('شماره D1 مقصد (یا 0 = ساخت D1 تازه): ')).trim();
      if (ans === '0' || ans === '') {
        const name = (await rl.question('نام D1 تازه [filmwork-shard]: ')).trim() || 'filmwork-shard';
        d1 = await createD1(api, account, name);
      } else {
        const i = Number(ans) - 1;
        if (!Number.isInteger(i) || !dbs[i]) throw new Error('انتخاب D1 نامعتبر است.');
        d1 = dbs[i];
      }
    } else {
      const name = (await rl.question('نام D1 [filmwork-shard]: ')).trim() || 'filmwork-shard';
      d1 = await createD1(api, account, name);
    }
    const secret = newSecret();
    console.log('\nWorker مقصد: ' + worker + '\nD1 مقصد: ' + d1.name + '\nیک رمز تصادفی ۶۴ نویسه‌ای ساخته شد (فقط اینجا نمایش داده می‌شود).');
    const confirmation = (await rl.question('برای اجازه انتشار، نام Worker را دوباره بنویسید (انصراف: Enter): ')).trim();
    if (confirmation !== worker) { console.log('لغو شد؛ هیچ تغییری در کلودفلر انجام نشد.'); return; }
    const code = await readFile(path.join(ROOT, 'scripts', 'shard-proxy-worker.js'), 'utf8');
    await deploy(api, account, worker, d1, secret, code);
    const url = 'https://' + worker + (workersDomain ? '.' + workersDomain : '…') + '/';
    console.log('\n✅ shard-proxy منتشر و بررسی شد.\n');
    console.log('حالا این دو مقدار را در پنل سایت بگذارید (تنظیمات ← ذخیره‌سازی و فدراسیون D1):');
    console.log('\n  آدرس shard-proxy : ' + url);
    console.log('  رمز اشتراک        : ' + secret);
    console.log('\nنکته: اگر دامنهٔ workers.dev حساب متفاوت بود، آدرس دقیق را از داشبورد Worker (Overview) کپی کنید. رمز را جای دیگری ذخیره نکنید؛ در پنل سایت ذخیره می‌شود.');
  } finally { rl.close(); await rm(privateDir, {recursive: true, force: true}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(e => { console.error('\n❌ ' + e.message); process.exitCode = 1; });
}
