import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {contentChannelRules,parseChannelHeader,channelFileDetails,Store,resolveMirrorSource};').toString('base64'));
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
async function post(id,text,media,extra={}) {
 const msg={message_id:id,chat:{id:channel,type:'channel'},text,...extra,...(media?{document:media}:{}),forward_origin:{type:'channel',chat:{id:'-1001111111111'},message_id:99}};
 return app.default.fetch(new Request(origin+'/api/tg/content-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify({update_id:id,channel_post:msg})}),env,{});
}
async function tick() {await sessions.get('channel:'+channel).alarm();}
const file=(name=filename)=>({file_name:name,file_size:332*1048576,file_unique_id:name});
let base=1000, short=false;
globalThis.fetch=async(url,init)=>{
 const method=String(url).split('/').at(-1),body=JSON.parse(init.body);tgCalls.push({method,body});
 if (method==='copyMessages') return Response.json({ok:true,result:body.message_ids.slice(0,short?1:undefined).map(()=>({message_id:++base}))});
 return Response.json({ok:true,result:{message_id:++base}});
};
try {
 // Destinations already contain messages: IDs intentionally differ from source.
 await post(1,header);await tick();
 await post(2,'',file(),{media_group_id:'album-a'});
 await post(3,'',file(filename.replace('E01','E02')),{media_group_id:'album-a'});
 await tick();
 assert.equal(tgCalls.filter(c=>c.method==='copyMessages').length,0,'wait for late album members');
 const state=stores.get('channel:'+channel);
 await state.storage.put('album-seen:album-a',Date.now()-3000);
 const put=kv.put;let failMapping=true;
 kv.put=async(k,v)=>{if(k==='mirror:'+channel+'/3/'+targetA && failMapping){failMapping=false;throw new Error('KV unavailable');}return put(k,v);};
 await tick();
 assert.equal(tgCalls.filter(c=>c.method==='copyMessages'&&c.body.chat_id===targetA).length,1);
 // Recreate the object after partial KV progress: replay saved response, not copy.
 sessions.set('channel:'+channel,new app.EditorSession(state,env));
 await tick();kv.put=put;
 assert.equal(tgCalls.filter(c=>c.method==='copyMessages'&&c.body.chat_id===targetA).length,1);
 assert.equal(tgCalls.filter(c=>c.method==='copyMessages'&&c.body.chat_id===targetB).length,1);
 assert.deepEqual(tgCalls.find(c=>c.method==='copyMessages').body.message_ids,[2,3]);
 assert(!tgCalls.some(c=>c.method==='copyMessage'&&[2,3].includes(c.body.message_id)));
 const store=new app.Store(kv,env), settings={vaultRewrite:channel+' '+targetA};
 const source={chatId:channel,msgId:'2',tmeUrl:'https://t.me/c/'+channel.slice(4)+'/2'};
 const resolved=await app.resolveMirrorSource(store,source,settings);
 assert.equal(resolved.chatId,targetA);
 assert.equal(resolved.msgId,String(data.get('mirror:'+channel+'/2/'+targetA).msgId));
 assert.notEqual(resolved.msgId,'2');
 assert(resolved.tmeUrl.endsWith('/'+resolved.msgId));
 await assert.rejects(()=>app.resolveMirrorSource(store,{chatId:channel,msgId:'99'},settings),/نگاشت/);
 const legacy=await app.resolveMirrorSource(store,{chatId:'-1006666666666',msgId:'77'},{vaultRewrite:'-1006666666666 -1005555555555'});
 assert.equal(legacy.msgId,'77');
 // Incomplete API results are ambiguous: don't invent a positional mapping.
 short=true;
 await post(4,'',file(),{media_group_id:'album-b'});await post(5,'',file(),{media_group_id:'album-b'});
 await state.storage.put('album-seen:album-b',Date.now()-3000);await tick();await tick();
 assert.equal(tgCalls.filter(c=>c.method==='copyMessages'&&c.body.message_ids[0]===4).length,1);
 assert(!data.has('mirror:'+channel+'/4/'+targetA));
 const session=sessions.get('channel:'+channel);
 await session.fetch(new Request('https://internal/channel-skip-relay',{method:'POST',body:JSON.stringify({id:4})}));
 await tick();
 assert.equal([...state.values.keys()].filter(k=>k.startsWith('queue:')).length,0);
} finally {globalThis.fetch=oldFetch;}
console.log('PASS: album preservation, quiet-window collection, actual destination ID mapping, restart/partial KV recovery, safe incomplete-copy handling and managed-vault fallback.');
