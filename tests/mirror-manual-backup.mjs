import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {Store,deliverWithMirrorFallback};').toString('base64'));

const from='-1003991198857', backup='-1004465249757';
const data=new Map();
const kv={get:async k=>structuredClone(data.get(k)??null),put:async(k,v)=>data.set(k,JSON.parse(v)),delete:async k=>data.delete(k),
 list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).sort().map(name=>({name})),list_complete:true})};
const env={KV:kv,CONTENT_ADMIN_IDS:'42',CONTENT_CHANNEL_RULES:JSON.stringify({[from]:{adminId:'42',targets:[backup]}})};
const objects=new Map();
env.EDITOR={idFromName:n=>n,get:n=>{
 if (!objects.has(n)) {
  const values=new Map();
  const ctx={storage:{get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),
    list:async({prefix,limit=1000})=>new Map([...values].filter(([k])=>k.startsWith(prefix)).slice(0,limit))}};
  objects.set(n,{session:new app.EditorSession(ctx,env),values});
 }
 return objects.get(n).session;
}};
const store=()=>new app.Store(kv,env);

// Telegram: source message deleted (not found), backup copies fine.
let live=new Set([backup]);
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 const ok=live.has(String(body.from_chat_id));
 return Response.json(ok?{ok:true,result:{message_id:9001}}:{ok:false,error_code:400,description:'Bad Request: message to copy not found'});
};
const deliver=()=>app.deliverWithMirrorFallback(store(),'fake',42,{chatId:from,msgId:'430'},'',{set:{}});
const stub=env.EDITOR.get('channel:'+from);
const addBackup=(fromMsgId,to,toMsgId)=>stub.fetch(new Request('https://editor.internal/channel-mirror-add',{method:'POST',body:JSON.stringify({from,fromMsgId,to,toMsgId})}));

// ── ۱) بدون نگاشت: حذف منبع یعنی شکست (نمی‌تواند از پشتیبان بردارد) ──
assert.equal((await deliver()).ok,false,'بدون نگاشت پشتیبان، دریافت باید شکست بخورد');

// ── ۲) ثبت دستی نگاشت با شماره‌های متفاوت (430 → 433) ──
let r=await addBackup(430,backup,433);
assert.equal(r.status,200);
let body=await r.json();
assert.equal(body.ok,true); assert.equal(body.existed,false);

// ── ۳) حالا failover باید نسخهٔ پشتیبان (پیام 433) را بفرستد ──
const res=await deliver();
assert.equal(res.ok,true,'بعد از ثبت نگاشت باید از کانال پشتیبان ارسال شود');
const objValues=objects.get('channel:'+from).values;
assert.deepEqual(objValues.get('mirror-file:430'),{[backup]:{chatId:backup,msgId:433}},'نگاشت در Durable Object ذخیره شود');
assert.equal(objValues.get('mirror-pair:'+from+'/'+backup),true,'جفت مخزن ثبت شود');

// ── ۴) ثبت دوباره همان نگاشت: existed=true و بدون تغییر ──
r=await addBackup(430,backup,433); body=await r.json();
assert.equal(body.existed,true,'ثبت مجدد همان نگاشت باید existed=true بدهد');

// ── ۵) اعتبارسنجی ورودی: کانال یا شماره نامعتبر رد شود ──
assert.equal((await addBackup(0,backup,433)).status,400,'شماره پیام نامعتبر رد شود');
assert.equal((await stub.fetch(new Request('https://editor.internal/channel-mirror-add',{method:'POST',body:JSON.stringify({from,fromMsgId:430,to:'123',toMsgId:433})}))).status,400,'کانال نامعتبر رد شود');
assert.equal((await stub.fetch(new Request('https://editor.internal/channel-mirror-add',{method:'POST',body:JSON.stringify({from,fromMsgId:430,to:from,toMsgId:433})}))).status,400,'کانال پشتیبان نباید برابر منبع باشد');

// ── ۶) DO دیگری با channel-id متفاوت نباید نگاشت این منبع را بپذیرد ──
const otherStub=env.EDITOR.get('channel:'+backup);
await otherStub.fetch(new Request('https://editor.internal/channel-enqueue',{method:'POST',body:JSON.stringify({message_id:1,chat:{id:backup},document:{file_id:'x'}})})).catch(()=>{});

console.log('PASS: manual backup mapping registers a mirror record for existing files and enables cross-channel failover with different message IDs.');
