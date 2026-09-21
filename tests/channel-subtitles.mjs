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
// هاردساب: مثل سافتساب، نوع باید در خط مشخصات دیده شود
const hardCtx=app.parseChannelHeader(header.replace('#نوع دوبله','#نوع هاردساب'),null,origin);
const hardFile='Silo.S01E01.1080p.WEB-DL.6CH.HardSub.mkv';
const hardDetails=app.channelFileDetails({file_name:hardFile,file_size:Math.round(959.5*1048576)},hardCtx,data.get('it:i_silo'));
assert.equal(hardDetails.title,'Rubixfa | 1080p.WEB-DL.6CH.HardSub | 959.5 MB');

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
try {
 const softHeader=header.replace('#نوع دوبله','#نوع سافتساب')+'\n#زیرنویس جدا';
 const soft=filename.replace('Farsi.Dubbed','SoftSub');
 const high=soft.replace('720p','1080p');
 const c=app.parseChannelHeader(softHeader,null,origin);
 assert.equal(c.externalSubtitles,true);
 assert.equal(app.parseChannelHeader('#نسخه Other\n#نوع سافتساب',c,origin).externalSubtitles,false);
 assert.throws(()=>app.parseChannelHeader(header+'\n#زیرنویس جدا',null,origin));
 const subtitle=name=>({file_name:name,file_size:2048,file_unique_id:name});
 await post(1,softHeader);
 await post(2,'',file(high));await post(3,'',file(soft));
 await post(4,'',subtitle(high.replace('.mkv','.srt')));
 await post(5,'',subtitle(high.replace('.mkv','.fa.ass')));
 await post(6,'',subtitle('Persian.srt'),{reply_to_message:{message_id:3,chat:{id:channel}}});
 await tick();
 const variants=()=>data.get('it:i_silo').seasons[0].episodes[0].variants.sub;
 const primary=q=>variants()[q].files[0];
 assert.equal(variants()['1080'].files.length,1);
 assert.equal(primary('1080').title,'Rubixfa | 1080p.WEBRip.x265.10bit.2CH.PSA.SoftSub | 332 MB'); // نوع سافتساب در خط مشخصات
assert.equal(primary('720').title,'Rubixfa | 720p.WEBRip.x265.10bit.2CH.PSA.SoftSub | 332 MB');
 assert.equal(primary('1080').sizeBytes,332*1048576);
 assert.deepEqual(primary('1080').source.parts.map(p=>p.msgId),['2','4','5']);
 assert.deepEqual(primary('720').source.parts.map(p=>p.msgId),['3','6']);
 assert.equal(data.get('src:c:'+channel+'/4'),'i_silo');
 assert.deepEqual(tgCalls.filter(c=>c.method==='copyMessage'&&c.body.chat_id===targetA).map(c=>c.body.message_id),[1,2,3,4,5,6]);
 // Duplicate delivery does not make a second attachment or a second version.
 await post(4,'',subtitle(high.replace('.mkv','.srt')));await tick();
 assert.equal(primary('1080').source.parts.length,3);
 // A known wrong episode/quality cannot be overridden by reply.
 await post(7,'',subtitle('Silo.S01E02.1080p.srt'),{reply_to_message:{message_id:2}});await tick();
 assert.equal(primary('1080').source.parts.length,3);
 assert(stores.get('channel:'+channel).values.has('failed:'+String(7).padStart(16,'0')));
 // Duplicate video filenames are ambiguous unless the subtitle replies to one.
 await post(8,'',file(high));await post(9,'',subtitle(high.replace('.mkv','.vtt')));await tick();
 assert.equal(variants()['1080'].files.length,2);
 assert(stores.get('channel:'+channel).values.has('failed:'+String(9).padStart(16,'0')));
 await post(10,'',subtitle('English.vtt'),{reply_to_message:{message_id:8}});await tick();
 assert.deepEqual(variants()['1080'].files[1].source.parts.map(p=>p.msgId),['8','10']);
 // Same episode/quality from another provider stays isolated.
 await post(11,softHeader.replace('Rubixfa','Kingmovie'));
 await post(12,'',file(high));await post(13,'',subtitle(high.replace('.mkv','.srt')));await tick();
 assert.deepEqual(variants()['1080'].files[2].source.parts.map(p=>p.msgId),['12','13']);
 assert.deepEqual(primary('1080').source.parts.map(p=>p.msgId),['2','4','5']);
 await post(14,'',subtitle('Persian.srt'),{reply_to_message:{message_id:2}});await tick();
 assert(stores.get('channel:'+channel).values.has('failed:'+String(14).padStart(16,'0')));
 // Header opt-out blocks subtitle import but doesn't break channel mirroring.
 await post(15,'#زیرنویس داخلی');await post(16,'',subtitle(high.replace('.mkv','.ass')));await tick();
 assert.equal(variants()['1080'].files[2].source.parts.length,2);
 // Movie support, with full matching stem and no season/episode guess.
 data.set('it:i_movie',{id:'i_movie',title:'Arrival',type:'movie',updatedAt:1,variants:{sub:{},dub:{}}});
 await post(17,'#اثر i_movie\n#نسخه Rubixfa\n#نوع سافتساب\n#نام Arrival\n#زیرنویس جدا');
 await post(18,'',file('Arrival.2016.1080p.WEBRip.mkv'));
 await post(19,'',subtitle('Arrival.2016.1080p.WEBRip.srt'));await tick();
 assert.deepEqual(data.get('it:i_movie').variants.sub['1080'].files[0].source.parts.map(p=>p.msgId),['18','19']);
 // Unrelated, unnamed subtitle is never attached to "the latest movie".
 await post(20,'',subtitle('Random.srt'));await tick();
 assert.equal(data.get('it:i_movie').variants.sub['1080'].files[0].source.parts.length,2);
} finally {globalThis.fetch=oldFetch;}
console.log('PASS: external subtitle headers, exact file matching, reply association, multiple subtitles, quality/provider isolation, movie support, replay safety and ordered mirroring.');
