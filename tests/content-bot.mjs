import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const main=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport { Store, contentBotAction, ingestChannelMessage, setupContentWebhook, contentSetupStatus };').toString('base64'));
const {EditorSession,parseFilename,itemIdFromLink} = main;
const bot = main.default;
assert.deepEqual(parseFilename('Silo.S02E03.1080p.mkv'),{season:2,episode:3,quality:'1080',detectedTitle:'Silo'});
assert.equal(parseFilename('Silo.2x03.2160p.mkv').quality,'4k');
assert.equal(parseFilename('Silo.S01E01-E02.720p.mkv').episode,null);
assert.equal(parseFilename('unknown.mkv').quality,null);
assert.equal(itemIdFromLink('https://site.test/#/item/i_abc','https://site.test'),'i_abc');
assert.equal(itemIdFromLink('https://evil.test/#/item/i_abc','https://site.test'),'');
assert.equal(itemIdFromLink('https://site.test/#/admin','https://site.test'),'');
const data=new Map([
  ['set',{vaultChatId:'-1001234567890',secret:'testing',siteName:'Test'}],
  ['tg:42','tg42'], ['u:tg42',{username:'tg42',tgId:'42',role:'admin'}],
  ['it:i_abc',{id:'i_abc',type:'series',title:'سیلو | Silo',updatedAt:1,genres:[],episodes:[],seasons:[],variants:{sub:{},dub:{}}}]
]);
const kv={
  get:async k=>structuredClone(data.get(k)??null),
  put:async(k,v)=>data.set(k,JSON.parse(v)),
  delete:async k=>data.delete(k),
  list:async()=>({keys:[],list_complete:true})
};
const mainEnv={CONTENT_BOT_TOKEN:'fake',CONTENT_ADMIN_IDS:'42'};
function call(action,body) {
  return main.contentBotAction(new main.Store(kv,mainEnv),body,action);
}
assert.equal((await call('whoami',{actorId:'43'})).status,403);
assert.equal((await call('whoami',{actorId:'42'})).status,200);
const file={key:'1'.repeat(16),kind:'softsub',quality:'1080',season:2,episode:3,chatId:'-1001234567890',msgId:101,title:'نسخه اول'};
const job={actorId:'42',itemId:'i_abc',expectedUpdatedAt:1,jobId:'1'.repeat(32),files:[file]};
assert.equal((await call('publish',{...job,files:[{...file,quality:'unknown'}]})).status,400);
assert.equal(data.get('it:i_abc').updatedAt,1);
assert.equal((await call('publish',{...job,files:[{...file,chatId:'-1009999999999'}]})).status,400);
assert.equal((await call('publish',{...job,expectedUpdatedAt:2})).status,409);
{const r=await call('publish',job); assert.equal(r.status,200,JSON.stringify(await r.json()));}
let published=data.get('it:i_abc');
assert.equal(published.seasons[0].n,2);
assert.equal(published.seasons[0].episodes[0].n,3);
assert.equal(published.seasons[0].episodes[0].variants.sub['1080'].files.length,1);
assert.match(published.seasons[0].episodes[0].variants.sub['1080'].files[0].title,/سافت/);
assert.equal(data.get('src:c:-1001234567890/101'),'i_abc');
assert.equal((await (await call('publish',job)).json()).replayed,true);
assert.equal(data.get('it:i_abc').seasons[0].episodes[0].variants.sub['1080'].files.length,1);
assert.equal((await call('publish',{...job,files:[{...file,msgId:102}]})).status,409);
assert.deepEqual(await main.ingestChannelMessage(new main.Store(kv,mainEnv),{chat:{id:-1001234567890},message_id:777,document:{file_name:'Silo.S02E03.mkv'}},[]),{skipped:true});
function context() {
  const entries=new Map(); let alarm;
  return {storage:{get:async k=>structuredClone(entries.get(k)),put:async(k,v)=>entries.set(k,structuredClone(v)),delete:async k=>entries.delete(k),setAlarm:async v=>{alarm=v;},deleteAlarm:async()=>{alarm=null;}},entries};
}
const calls=[]; let nextMessage=200;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  const method=String(url).split('/').at(-1), body=JSON.parse(init.body);
  calls.push({method,body});
  return Response.json({ok:true,result:method==='copyMessage'?{message_id:nextMessage++}:{message_id:900}});
};
try {
  const env={CONTENT_BOT_TOKEN:'fake',CONTENT_WEBHOOK_SECRET:'webhook-test',CONTENT_ADMIN_IDS:'42',SITE_PUBLIC_ORIGIN:'https://site.test',
    KV:kv};
  const setupEnv={...env,CONTENT_WEBHOOK_SECRET:'w'.repeat(48),EDITOR:{}};
  const setup = await main.setupContentWebhook(new main.Store(kv,setupEnv));
  assert.equal(setup.status,200);
  const webhook = calls.find(c=>c.method==='setWebhook');
  assert.equal(webhook.body.url,'https://site.test/api/tg/content-webhook');
  assert.equal(webhook.body.drop_pending_updates,false);
  const coordinator=new EditorSession(context(),env);
  env.EDITOR={idFromName:n=>n,get:()=>coordinator};
  const ctx=context(), session=new EditorSession(ctx,env);
  let updateId=0;
  async function message(text,extras={},id=++updateId) {
    return session.fetch(new Request('https://editor.internal/update',{method:'POST',body:JSON.stringify({update_id:id,message:{message_id:id,from:{id:42},chat:{id:42,type:'private'},text,...extras}})}));
  }
  assert.equal((await bot.fetch(new Request('https://bot.test/api/tg/content-webhook',{method:'POST',body:'{}'}),env)).status,403);
  const retired = await bot.fetch(new Request('https://site.test/api/content-bot/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(job)}),env,{});
  assert.equal(retired.status,404);
  const noBindings = await bot.fetch(new Request('https://site.test/api/tg/content-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'webhook-test'},body:'{}'}),{CONTENT_WEBHOOK_SECRET:'webhook-test'},{});
  assert.equal(noBindings.status,503);
  const emptyUpdate = await bot.fetch(new Request('https://site.test/api/tg/content-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'webhook-test'},body:'{}'}),env,{});
  assert.equal(emptyUpdate.status,200);
  const html = await bot.fetch(new Request('https://site.test/'),{KV:kv},{});
  assert.equal(html.status,200); assert.match(await html.text(), /سینما|Test/);
  await message('https://site.test/#/item/i_abc');
  assert.equal(ctx.entries.get('draft').stage,0);
  await message('',{document:{file_name:'Silo.S02E04.720p.mkv',file_unique_id:'new-file',file_size:123},caption:'نسخه آزمایشی'});
  assert.equal(ctx.entries.get('draft').files.length,1);
  assert.equal(ctx.entries.get('draft').files[0].kind,'dub');
  assert(!data.get('it:i_abc').seasons[0].episodes.some(e=>e.n===4)); // still only a draft
  const copyCount=calls.filter(c=>c.method==='copyMessage').length;
  await message('',{document:{file_name:'Silo.S02E04.720p.mkv',file_unique_id:'new-file'}},updateId);
  assert.equal(calls.filter(c=>c.method==='copyMessage').length,copyCount); // replayed update
  await message('مرحله بعد'); assert.equal(ctx.entries.get('draft').stage,1);
  await message('',{document:{file_name:'Mystery.mkv',file_unique_id:'unknown-file'}});
  assert(ctx.entries.get('draft').pending);
  await message('/accept'); assert(ctx.entries.get('draft').pending); // not enough metadata
  await message('اصلاح فصل و کیفیت');
  await message('۲ ۵ ۱۰۸۰');
  assert.equal(ctx.entries.get('draft').files[1].kind,'hardsub');
  assert.equal(ctx.entries.get('draft').files[1].episode,5);
  await message('/confirm'); assert(ctx.entries.get('draft')); // explicit preview required
  await message('پیش‌نمایش'); assert.equal(ctx.entries.get('draft').phase,'review');
  await message('/confirm'); assert(!ctx.entries.has('draft'));
  assert.equal(data.get('it:i_abc').seasons[0].episodes.find(e=>e.n===4).variants.dub['720'].files.length,1);
  assert.equal(data.get('it:i_abc').seasons[0].episodes.find(e=>e.n===5).variants.sub['1080'].files.length,1);
  await message('https://site.test/#/item/i_abc');
  await message('',{document:{file_name:'Silo.S02E06.480p.mkv',file_unique_id:'cancel-me'}});
  await message('لغو پیش‌نویس'); assert(ctx.entries.has('draft'));
  await message('تأیید لغو'); assert(!ctx.entries.has('draft'));
  assert(calls.some(c=>c.method==='deleteMessages'));
  // Pending publication must survive expiration; no potentially published media is removed.
  await ctx.storage.put('draft',{phase:'publishing',touchedAt:0,files:[],chat:42});
  await session.alarm(); assert(ctx.entries.has('draft'));
  data.get('u:tg42').role='free';
  assert.equal((await call('whoami',{actorId:'42'})).status,403);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: integrated editorial filename parsing, role checks, validation, series grouping, replay safety, private draft workflow, manual assignment, review gate, cancellation and pending-publication protection.');

const missing=await main.contentSetupStatus(new main.Store(kv,{}),{tgId:'42'});
assert.equal(missing.ready,false);
assert(missing.steps.some(x=>!x.ok && x.title.includes('حافظه')));
const configured=await main.contentSetupStatus(new main.Store(kv,{...mainEnv,KV:kv,EDITOR:{},CONTENT_WEBHOOK_SECRET:'w'.repeat(48),SITE_PUBLIC_ORIGIN:'https://site.test'}),{tgId:'42'});
assert(configured.ready);
assert.equal(configured.adminId,'42');
assert(!JSON.stringify(configured).includes('w'.repeat(48)));
const sampleConfig=await main.contentSetupStatus(new main.Store(kv,{...mainEnv,CONTENT_CHANNEL_RULES:JSON.stringify({'-1001111111111':{adminId:'42',targets:[]}})}));
assert(sampleConfig.steps.some(x=>!x.ok && x.help.includes('نمونه')));
console.log('PASS: Persian menu actions, cancellation confirmation, setup readiness, secret redaction and sample channel warnings.');
