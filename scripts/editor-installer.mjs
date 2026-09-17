/** Interactive, local Cloudflare installer. Never run this from the site's browser. */
import {readFile, mkdtemp, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const AUTO_TAG='content-editor-installer-v1';
const API='https://api.cloudflare.com/client/v4';
export function validateWorkerName(value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) throw new Error('نام Worker نامعتبر است؛ فقط نامی مثل film، نه آدرس سایت.');
  return value;
}
export function buildPlan(settings, service, namespaces, worker) {
  validateWorkerName(worker);
  if (!Array.isArray(settings?.bindings)) throw new Error('تنظیمات موجود قابل خواندن نیست؛ هیچ تغییری انجام نشد.');
  const bindings=settings.bindings;
  const kv=bindings.find(b=>b.name==='KV');
  if (!kv || kv.type!=='kv_namespace' || !kv.namespace_id) throw new Error('این Worker به KV فعلی سایت متصل نیست. برای جلوگیری از انتشار روی Worker اشتباه، نصب متوقف شد.');
  const editor=bindings.find(b=>b.name==='EDITOR');
  if (editor && (editor.type!=='durable_object_namespace' || editor.class_name!=='EditorSession' || (editor.script_name && editor.script_name!==worker))) throw new Error('EDITOR از قبل به منبع دیگری متصل است؛ نصب‌کننده آن را جایگزین نمی‌کند.');
  const owned=namespaces.filter(n=>n.script===worker);
  if (owned.some(n=>n.class!=='EditorSession')) throw new Error('این Worker کلاس‌های Durable Object دیگری دارد. نصب خودکار برای حفظ آن‌ها متوقف شد.');
  const found=owned.filter(n=>n.class==='EditorSession');
  if (found.length>1 || (found.length===1 && !found[0].use_sqlite)) throw new Error('حافظه موجود با نصب خودکار سازگار نیست؛ بدون حذف یا تبدیل داده متوقف شد.');
  if (editor && found.length!==1) throw new Error('اتصال EDITOR با فهرست منابع همخوانی ندارد؛ نصب متوقف شد.');
  if (editor?.namespace_id && editor.namespace_id!==found[0]?.id) throw new Error('شناسه حافظه EDITOR ناسازگار است؛ نصب متوقف شد.');
  if (bindings.some(b=>['wasm_module','text_blob','data_blob'].includes(b.type))) throw new Error('Worker فایل‌های جانبی دارد؛ نصب خودکار تک‌فایلی برای این Worker انجام نمی‌شود.');
  const script=service?.default_environment?.script;
  if (!script || !settings.compatibility_date) throw new Error('اطلاعات نسخه فعلی Worker کامل نیست؛ نصب متوقف شد.');
  if (editor) return {action:'ready',worker,kv:kv.namespace_id,bindingCount:bindings.length};
  const metadata={
    main_module:'worker.js',
    // Inherit each existing binding server-side, including secrets. Do not export their values.
    bindings:[...bindings.map(b=>({name:b.name,type:'inherit'})),{name:'EDITOR',type:'durable_object_namespace',class_name:'EditorSession'}],
    compatibility_date:settings.compatibility_date,
    keep_assets:true
  };
  for (const k of ['compatibility_flags','usage_model','limits','placement','logpush','tail_consumers','observability','tags','logfwdrdrs']) {
    if (settings[k]!==undefined) metadata[k]=structuredClone(settings[k]);
  }
  if (!found.length) {
    const old=script.migration_tag;
    if (old===AUTO_TAG) throw new Error('تاریخچه نصب با منابع موجود ناسازگار است؛ نیاز به بررسی دارد.');
    metadata.migrations={...(old?{old_tag:old}:{}),new_tag:AUTO_TAG,steps:[{new_sqlite_classes:['EditorSession']}]};
  }
  return {action:found.length?'bind':'create',worker,kv:kv.namespace_id,bindingCount:bindings.length,metadata};
}
export function createCloudflareClient(token,fetcher=fetch) {
  if (!token || typeof token!=='string') throw new Error('ورود به حساب کلودفلر انجام نشده است.');
  return async function api(route,options={}) {
    let response;
    try { response=await fetcher(API+route,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(90000)}); }
    catch { throw new Error('ارتباط با کلودفلر قطع شد. نتیجه نامشخص است؛ نصب‌کننده را دوباره اجرا کنید تا وضعیت موجود را بررسی کند.'); }
    let data; try { data=await response.json(); } catch { throw new Error('پاسخ کلودفلر قابل خواندن نیست؛ نتیجه را در داشبورد بررسی کنید.'); }
    if (!response.ok || !data.success) {
      // API error messages can contain binding values. Print only status and numeric error codes.
      const codes=(data.errors || []).map(e=>e.code).filter(n=>Number.isInteger(n)).join(',');
      throw new Error('Cloudflare HTTP '+response.status+(codes?' / code '+codes:'')+'. مجوز حساب، نام Worker و وضعیت داشبورد را بررسی کنید.');
    }
    return data;
  };
}
export async function inspect(api,account,worker) {
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('شناسه حساب کلودفلر نامعتبر است.');
  validateWorkerName(worker);
  const base='/accounts/'+account+'/workers';
  const settings=(await api(base+'/scripts/'+worker+'/settings')).result;
  const service=(await api(base+'/services/'+worker)).result;
  const namespaces=[];
  for (let page=1;page<=100;page++) {
    const result=await api(base+'/durable_objects/namespaces?per_page=100&page='+page);
    if (!Array.isArray(result.result)) throw new Error('فهرست حافظه‌های کلودفلر قابل بررسی نیست.');
    namespaces.push(...result.result);
    const total=result.result_info?.total_pages;
    if ((total && page>=total) || (!total && result.result.length<100)) break;
    if (page===100) throw new Error('تعداد منابع بیشتر از محدوده نصب خودکار است.');
  }
  return {settings,service,namespaces,plan:buildPlan(settings,service,namespaces,worker)};
}
function fingerprint(snapshot) { return JSON.stringify([snapshot.settings,snapshot.service,snapshot.namespaces]); }
export async function install(api,account,worker,snapshot,code) {
  if (snapshot.plan.action==='ready') return snapshot.plan;
  if (!code.includes('export class EditorSession') || !code.includes('export default')) throw new Error('فایل worker.js صحیح در کنار نصب‌کننده یافت نشد.');
  const fresh=await inspect(api,account,worker);
  if (fingerprint(fresh)!==fingerprint(snapshot)) throw new Error('تنظیمات Worker از زمان بررسی تغییر کرده است؛ بدون انتشار متوقف شد. دوباره اجرا کنید.');
  const body=new FormData();
  body.set('metadata',new Blob([JSON.stringify(snapshot.plan.metadata)],{type:'application/json'}));
  body.set('worker.js',new Blob([code],{type:'application/javascript+module'}),'worker.js');
  await api('/accounts/'+account+'/workers/scripts/'+worker+'?bindings_inherit=strict',{method:'PUT',body});
  const after=await inspect(api,account,worker);
  const beforeBindings=snapshot.settings.bindings;
  for (const b of beforeBindings) {
    const kept=after.settings.bindings.find(x=>x.name===b.name);
    if (!kept || kept.type!==b.type || (b.type==='kv_namespace' && kept.namespace_id!==b.namespace_id)) throw new Error('انتشار انجام شد ولی بررسی اتصال‌های قبلی کامل نشد؛ داشبورد را بررسی کنید. نصب‌کننده rollback یا حذف داده انجام نمی‌دهد.');
  }
  if (after.plan.action!=='ready') throw new Error('درخواست انتشار پذیرفته شد ولی EDITOR هنوز تأیید نشده؛ کمی بعد نصب‌کننده را دوباره اجرا کنید.');
  return after.plan;
}
async function cli() {
  if (!process.stdin.isTTY) throw new Error('نصب‌کننده باید در ترمینال تعاملی کامپیوتر خودتان اجرا شود.');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  // Wrangler owns its normal OAuth credential storage. Any diagnostic log from the
  // credential retrieval command is kept outside the repository and promptly removed.
  const privateDir=await mkdtemp(path.join(tmpdir(),'filmwork-installer-'));
  await chmod(privateDir,0o700).catch(()=>{});
  const childEnv={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(privateDir,'wrangler.log')};
  async function wrangler(args,capture=false) {
    return new Promise((resolve,reject)=>{
      const child=spawn(process.platform==='win32'?'npx.cmd':'npx',['--yes','wrangler@4.131.1',...args],{
        cwd:ROOT,env:childEnv,shell:process.platform==='win32',stdio:capture?['ignore','pipe','pipe']:'inherit'
      });
      let output='';
      if(capture) { child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',()=>{}); }
      child.on('error',()=>reject(new Error('اجرای ابزار Cloudflare ممکن نشد. Node.js و اتصال اینترنت را بررسی کنید.')));
      child.on('close',code=>code===0?resolve(output):reject(new Error('ورود/دریافت اطلاعات حساب Cloudflare ناموفق بود.')));
    });
  }
  try {
    console.log('\nنصب خودکار EDITOR — فقط روی Worker موجود سایت\nتوکن یا رمز تلگرام لازم نیست. هنگام نصب، در داشبورد استقرار دیگری انجام ندهید.\n');
    const worker=validateWorkerName((await rl.question('نام Worker سایت [film]: ')).trim() || 'film');
    console.log('مرورگر برای ورود رسمی Cloudflare باز می‌شود؛ حساب سایت را انتخاب و اجازه دسترسی بدهید.');
    await wrangler(['login']);
    let identity;
    try { identity=JSON.parse(await wrangler(['whoami','--json'],true)); } catch { throw new Error('اطلاعات حساب از ابزار Cloudflare قابل دریافت نیست.'); }
    const accounts=identity.accounts || [];
    if (!accounts.length) throw new Error('حساب Cloudflare در دسترس پیدا نشد.');
    accounts.forEach((a,i)=>console.log((i+1)+'. '+a.name));
    const choice=accounts.length===1?1:Number(await rl.question('شماره حساب سایت: '));
    if(!Number.isInteger(choice) || !accounts[choice-1]) throw new Error('حساب انتخاب‌شده نامعتبر است.');
    const account=accounts[choice-1].id;
    let credentials;
    try { credentials=JSON.parse(await wrangler(['auth','token','--json'],true)); } catch { throw new Error('مجوز ورود به‌صورت امن قابل دریافت نیست؛ دوباره ورود مرورگری را انجام دهید.'); }
    await rm(path.join(privateDir,'wrangler.log'),{force:true});
    if (!['oauth','api_token'].includes(credentials.type)) throw new Error('لطفاً از ورود مرورگری Cloudflare استفاده کنید، نه Global API Key.');
    const api=createCloudflareClient(credentials.token);
    const snapshot=await inspect(api,account,worker);
    if(snapshot.plan.action==='ready') { console.log('\n✅ EDITOR از قبل آماده است؛ هیچ استقراری انجام نشد.'); return; }
    console.log('\nWorker مقصد: '+worker+'\nتعداد اتصال‌های فعلی که حفظ می‌شوند: '+snapshot.plan.bindingCount+'\nاقدام: '+(snapshot.plan.action==='create'?'ساخت حافظه SQLite و اتصال EDITOR':'اتصال حافظه موجود به EDITOR')+'\nنسخه worker.js همین پوشه منتشر خواهد شد. KV و رمزها حذف یا بازنویسی نمی‌شوند.');
    const confirmation=(await rl.question('برای اجازه انتشار، نام Worker را دوباره بنویسید (انصراف: Enter): ')).trim();
    if(confirmation!==worker) { console.log('لغو شد؛ هیچ تغییری در کلودفلر انجام نشد.'); return; }
    await install(api,account,worker,snapshot,await readFile(path.join(ROOT,'worker.js'),'utf8'));
    console.log('\n✅ EDITOR ساخته/متصل و بررسی شد.\nحالا تنظیمات سایت را تازه کنید و «اتصال ربات به سایت» را بزنید.');
  } finally { rl.close(); await rm(privateDir,{recursive:true,force:true}); }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  cli().catch(e=>{console.error('\n❌ '+e.message);process.exitCode=1;});
}
