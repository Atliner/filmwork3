import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {contentChannelRules,parseChannelHeader,channelFileDetails,Store};').toString('base64'));
const origin='https://site.test', channel='-1001234567890', targetA='-1008888888888',targetB='-1009999999999';
const data=new Map([
 ['set',{vaultChatId:'-1007777777777',publicUrl:origin,siteName:'Test',secret:'test'}],
 ['tg:42','tg42'],['u:tg42',{username:'tg42',tgId:'42',role:'admin'}],
 ['it:i_silo',{id:'i_silo',title:'سیلو | Silo',type:'series',updatedAt:1,seasons:[],episodes:[],variants:{sub:{},dub:{}}}]
]);
const kv={get:async k=>structuredClone(data.get(k)??null),put:async(k,v)=>data.set(k,JSON.parse(v)),delete:async k=>data.delete(k),list:async()=>({keys:[],list_complete:true})};
const env={KV:kv,CONTENT_BOT_TOKEN:'fake',CONTENT_WEBHOOK_SECRET:'secret',CONTENT_ADMIN_IDS:'42',SITE_PUBLIC_ORIGIN:origin,
 CONTENT_CHANNEL_RULES:JSON.stringify({[channel]:{adminId:'42',targets:[targetA,targetB]}})};
assert.deepEqual(app.contentChannelRules(env)[channel].targets,[targetA,targetB]);
assert.throws(()=>app.contentChannelRules({...env,CONTENT_CHANNEL_RULES:JSON.stringify({[channel]:{adminId:'42',targets:[channel]}})}));
assert.throws(()=>app.contentChannelRules({...env,CONTENT_CHANNEL_RULES:JSON.stringify({[channel]:{adminId:'666',targets:[]}})}));
const header='#اثر '+origin+'/#/item/i_silo\n#نسخه Rubixfa\n#نوع دوبله\n#نام Silo';
let ctx=app.parseChannelHeader(header,null,origin);
assert.equal(ctx.kind,'dub');
assert.equal(app.parseChannelHeader('#نسخه Kingmovie\n#نوع دوبله',ctx,origin).version,'Kingmovie');
assert.throws(()=>app.parseChannelHeader('#نسخه Valamovie',ctx,origin));
assert.throws(()=>app.parseChannelHeader('#نوع زیرنویس',ctx,origin));
assert(app.parseChannelHeader('#پایان',ctx,origin).stopped);
const filename='Silo.S01E01.720p.WEBRip.x265.10bit.2CH.PSA.Farsi.Dubbed.mkv';
const details=app.channelFileDetails({file_name:filename,file_size:332*1048576},ctx,data.get('it:i_silo'));
assert.equal(details.title,'Rubixfa | 720p.WEBRip.x265.10bit.2CH.PSA | 332 MB');
assert.equal(details.episode,1); assert.equal(details.season,1); assert.equal(details.quality,'720');
assert.throws(()=>app.channelFileDetails({file_name:filename.replace('Silo','SiloOther')},ctx,data.get('it:i_silo')));
assert.throws(()=>app.channelFileDetails({file_name:filename.replace('Farsi.Dubbed','HardSub')},ctx,data.get('it:i_silo')));
function storageContext() {
 const values=new Map(); let alarm=null;
 return {values,storage:{get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),
 list:async({prefix,limit=1000})=>new Map([...values.entries()].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)])),
 getAlarm:async()=>alarm,setAlarm:async n=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}}};
}
const sessions=new Map(), stores=new Map();
env.EDITOR={idFromName:n=>n,get:n=>{
 if(!sessions.has(n)) {const c=storageContext();stores.set(n,c);sessions.set(n,new app.EditorSession(c,env));}
 return sessions.get(n);
}};
const tgCalls=[]; let failTarget='';
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 const method=String(url).split('/').at(-1),body=JSON.parse(init.body);tgCalls.push({method,body});
 if(method==='copyMessage' && body.chat_id===failTarget) return Response.json({ok:false,description:'missing rights'});
 return Response.json({ok:true,result:{message_id:5000+tgCalls.length}});
};
async function post(id,text,media) {
 const msg={message_id:id,chat:{id:channel,type:'channel'},text,...(media?{document:media}:{}),forward_origin:{type:'channel',chat:{id:'-1001111111111'},message_id:99}};
 return app.default.fetch(new Request(origin+'/api/tg/content-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify({update_id:id,channel_post:msg})}),env,{});
}
async function tick() {await sessions.get('channel:'+channel).alarm();}
const file=(name=filename)=>({file_name:name,file_size:332*1048576,file_unique_id:name});
try {
 assert.equal((await post(1,header)).status,200);
 await post(2,'',file());
 await post(3,'#نسخه Kingmovie\n#نوع دوبله');
 await post(4,'',file(filename.replace('WEBRip.x265.10bit.2CH.PSA','WEB-DL.KIMO').replace('Farsi.Dubbed','DUBLE')));
 for(let n=0;n<4;n++) await tick();
 const item=data.get('it:i_silo');
 const versions=item.seasons[0].episodes[0].variants.dub['720'].files;
 assert.equal(versions.length,2);
 assert.match(versions[0].title,/^Rubixfa \|/); assert.match(versions[1].title,/^Kingmovie \|/);
 assert.equal(versions[0].source.chatId,channel); assert.equal(versions[0].source.msgId,'2'); // never forwarded origin
 assert.equal(data.get('src:c:'+channel+'/2'),'i_silo');
 assert.deepEqual(tgCalls.filter(x=>x.method==='copyMessage' && x.body.chat_id===targetA).map(x=>x.body.message_id),[1,2,3,4]);
 const count=tgCalls.length;
 await post(2,'',file());await tick();assert.equal(tgCalls.length,count);assert.equal(data.get('it:i_silo').seasons[0].episodes[0].variants.dub['720'].files.length,2);
 // Ambiguous text pauses import; following file is kept in failures, not guessed.
 await post(5,'Valamovie زیرنویس');await post(6,'',file());await tick();await tick();
 assert.equal(data.get('it:i_silo').seasons[0].episodes[0].variants.dub['720'].files.length,2);
 assert(stores.get('channel:'+channel).values.has('failed:'+String(6).padStart(16,'0')));
 await post(7,header);await tick();
 const session=sessions.get('channel:'+channel);
 const retried=await session.fetch(new Request('https://internal/channel-retry',{method:'POST',body:JSON.stringify({id:6})}));
 assert.equal(retried.status,200);await tick();
 assert.equal(data.get('it:i_silo').seasons[0].episodes[0].variants.dub['720'].files.length,3);
 assert.equal(tgCalls.filter(x=>x.method==='copyMessage' && x.body.message_id===6 && x.body.chat_id===targetA).length,1);
 // Per-destination progress: partial relay failure blocks newer posts and doesn't repeat successful copies.
 failTarget=targetB;
 await post(8,'#پایان');await post(9,'test');await tick();
 assert(!tgCalls.some(x=>x.method==='copyMessage' && x.body.message_id===9));
 failTarget='';await tick();await tick();
 assert.equal(tgCalls.filter(x=>x.method==='copyMessage'&&x.body.message_id===8&&x.body.chat_id===targetA).length,1);
 const status=await (await session.fetch(new Request('https://internal/channel-status',{method:'POST',body:'{}'}))).json();
 assert.match(status.message,/آخرین پیام پردازش‌شده: 9/);
 // Burst: stale KV reads must not cause 409 or overwrite earlier episodes.
 const get=kv.get, put=kv.put, stale=structuredClone(data.get('it:i_silo'));
 kv.get=async k=>k==='it:i_silo'?structuredClone(stale):get(k);
 let itemWrites=0;
 kv.put=async(k,v)=>{if(k==='it:i_silo') itemWrites++; return put(k,v);};
 await post(10,header);
 for(let n=11;n<=15;n++) await post(n,'',file(filename.replace('E01','E'+String(n-9).padStart(2,'0'))));
 await tick();
 assert.equal(itemWrites,1,'five files should be one item write');
 for(let n=2;n<=6;n++) assert(data.get('it:i_silo').seasons[0].episodes.some(e=>e.n===n));
 assert.equal([...stores.get('channel:'+channel).values.keys()].filter(k=>k.startsWith('failed:')).length,0);
 // A second burst still reads old KV, but the coordinator merges its durable snapshot.
 await post(16,'',file(filename.replace('E01','E07'))); await tick();
 for(let n=1;n<=7;n++) assert(data.get('it:i_silo').seasons[0].episodes.some(e=>e.n===n));
 // A failed KV write survives coordinator restart and is replayed automatically.
 let failWrite=true;
 kv.put=async(k,v)=>{if(k==='it:i_silo' && failWrite){failWrite=false;throw new Error('temporary KV failure');}return put(k,v);};
 await post(17,'',file(filename.replace('E01','E08'))); await tick();
 assert(stores.get('publication-coordinator').values.has('pending-item'));
 sessions.set('publication-coordinator',new app.EditorSession(stores.get('publication-coordinator'),env));
 await tick();
 assert(data.get('it:i_silo').seasons[0].episodes.some(e=>e.n===8));
 kv.get=get;kv.put=put;
 // Old stale-revision failures are recovered by one status request, not /retry per file.
 const failedPost={message_id:18,chat:{id:channel,type:'channel'},document:file(filename.replace('E01','E09'))};
 const fd=app.channelFileDetails(failedPost.document,ctx,data.get('it:i_silo'));
 const failedEvent={post:failedPost,copies:[targetA,targetB],attempts:0,importDone:true,error:'اثر در سایت تغییر کرده؛ مشخصات را تازه کنید و دوباره پیش‌نمایش بگیرید',
 importJob:{actorId:'42',itemId:'i_silo',expectedUpdatedAt:1,jobId:'e'.repeat(32),files:[{...fd,key:'e'.repeat(16),kind:'dub',chatId:channel,msgId:18,channelImport:true}]}};
 await stores.get('channel:'+channel).storage.put('failed:'+String(18).padStart(16,'0'),failedEvent);
 await session.fetch(new Request('https://internal/channel-status',{method:'POST',body:'{}'}));await tick();
 assert(data.get('it:i_silo').seasons[0].episodes.some(e=>e.n===9));
 assert(!stores.get('channel:'+channel).values.has('failed:'+String(18).padStart(16,'0')));
 assert(!tgCalls.some(x=>x.method==='copyMessage'&&x.body.message_id===18));
 // Private confirmation explicitly queues relay, without a channel webhook.
 data.get('set').vaultChatId=channel;
 // Clear the settings cache by importing a fresh module instance.
 const fresh=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// relay integration instance').toString('base64'));
 const privateCtx=storageContext(), admin=new fresh.EditorSession(privateCtx,env);
 let update=100;
 async function message(text,extra={}) {
   return admin.fetch(new Request('https://internal/update',{method:'POST',body:JSON.stringify({update_id:++update,message:{message_id:update,from:{id:42},chat:{id:42,type:'private'},text,...extra}})}));
 }
 await message(origin+'/#/item/i_silo');
 await message('نسخه Rubixfa');
 const bytes=Math.round(599.5*1048576);
 await message('',{document:{file_name:'Silo.S01E10.1080p.WEBRip.x265.10bit.6CH.PSA.Farsi.Dubbed.mkv',file_size:bytes,file_unique_id:'private-10'},caption:'Silo.S01E10.mkv🌭 @HotDogRobot'});
 const draft=privateCtx.values.get('draft'), privateId=draft.files[0].msgId;
 assert.equal(draft.files[0].title,'Rubixfa | 1080p.WEBRip.x265.10bit.6CH.PSA | 599.5 MB');
 assert.equal(draft.files[0].sizeBytes,bytes);
 assert(!tgCalls.some(x=>x.method==='copyMessage'&&x.body.message_id===privateId));
 await message('/review'); await message('/confirm');
 assert(!privateCtx.values.has('draft'));
 failTarget=targetB; await tick();
 assert.equal(tgCalls.filter(x=>x.method==='copyMessage'&&x.body.message_id===privateId&&x.body.chat_id===targetA).length,1);
 failTarget='';await tick();
 // Lost handoff response/repeated confirm cannot mirror twice.
 await session.fetch(new Request('https://internal/channel-relay',{method:'POST',body:JSON.stringify({channel,actorId:'42',files:draft.files})})); await tick();
 assert.equal(tgCalls.filter(x=>x.method==='copyMessage'&&x.body.message_id===privateId&&x.body.chat_id===targetA).length,1);
 const finalFile=data.get('it:i_silo').seasons[0].episodes.find(e=>e.n===10).variants.dub['1080'].files[0];
 assert.equal(finalFile.title,draft.files[0].title);assert.equal(finalFile.sizeBytes,bytes);
 // Existing namespace is used; the source files were never copied back into the source channel.
 assert.equal(tgCalls.filter(x=>x.method==='copyMessage'&&x.body.chat_id===channel).length,1); // only the private draft staging copy
} finally {globalThis.fetch=oldFetch;}
console.log('PASS: stale KV burst batching, durable restart recovery, legacy conflict recovery, private title/size parity and idempotent relay handoff.');
console.log('PASS: channel templates, contextual versions, technical titles/sizes, actual source links, season grouping, durable queues, retries, relay ordering and loop prevention.');
