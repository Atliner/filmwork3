import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {Store,resolveMirrorSource,deliverWithMirrorFallback,mirrorFailureEligible};').toString('base64'));
const from='-1004430176383', a='-1004267831906',b='-1003243453503';
const data=new Map([
 ['mirror:'+from+'/13/'+a,{chatId:a,msgId:208}],
 ['mirror:'+from+'/13/'+b,{chatId:b,msgId:912}],
 ['mirror:'+from+'/14/'+b,{chatId:b,msgId:917}],
 ['mirror-pair:'+from+'/'+a,true]
]);
const kv={get:async k=>structuredClone(data.get(k)??null),put:async(k,v)=>data.set(k,JSON.parse(v)),delete:async k=>data.delete(k),
 list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).sort().map(name=>({name})),list_complete:true})};
const env={KV:kv,CONTENT_ADMIN_IDS:'42',CONTENT_CHANNEL_RULES:JSON.stringify({[from]:{adminId:'42',targets:[a,b]}})};
const objects=new Map();
env.EDITOR={idFromName:n=>n,get:n=>{
 if (!objects.has(n)) {
  const values=new Map();
  const ctx={storage:{get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),
    list:async({prefix,limit=1000})=>new Map([...values].filter(([k])=>k.startsWith(prefix)).slice(0,limit))}};
  objects.set(n,{session:new app.EditorSession(ctx,env),values});
 }
 return objects.get(n).session;
}};
const active=()=>objects.get('channel:'+from)?.values.get('mirror-active');
const store=()=>new app.Store(kv,env);
let kvWrites=0;const originalPut=kv.put;kv.put=async(...args)=>{kvWrites++;return originalPut(...args);};
const originalFetch=globalThis.fetch,calls=[];let live=new Set([a,b]),forceError='';
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);calls.push(body);
 const ok=live.has(String(body.from_chat_id)) && !forceError;
 return Response.json(ok?{ok:true,result:{message_id:500}}:{ok:false,error_code:400,description:forceError || 'Bad Request: message to copy not found'});
};
const deliver=(id=13,set={})=>app.deliverWithMirrorFallback(store(),'fake',42,{chatId:from,msgId:String(id)},'',{set});
try {
 assert((await deliver()).ok);
 assert(calls.some(c=>String(c.from_chat_id)===a&&c.message_id===208));
 assert(!calls.some(c=>String(c.from_chat_id)===a&&c.message_id===13));
 assert.equal(active().chatId,a);
 calls.length=0;assert((await deliver()).ok);
 assert.equal(String(calls[0].from_chat_id),a,'remember the working backup');
 assert.equal(calls.length,1);
 // The preferred backup fails later; choose another actual copy.
 live=new Set([b]);calls.length=0;assert((await deliver()).ok);
 assert(calls.some(c=>String(c.from_chat_id)===b&&c.message_id===912));
 assert.equal(active().chatId,b);
 // Each subtitle/file has its own mapping, not a constant offset.
 calls.length=0;assert((await deliver(14)).ok);
 assert.equal(calls[0].message_id,917);
 // A manually chosen destination with no mapping isn't assigned source ID 13.
 calls.length=0;assert((await deliver(13,{vaultRewrite:from+' -1004305938506'})).ok);
 assert(!calls.some(c=>String(c.from_chat_id)==='-1004305938506'));
 // Removed ingestion settings don't erase already-known backups.
 env.CONTENT_CHANNEL_RULES='';calls.length=0;
 assert((await deliver()).ok);
 // Never guess a destination ID for an old unmapped file.
 calls.length=0;assert.equal((await deliver(999)).ok,false);
 assert(calls.every(c=>String(c.from_chat_id)===from));
 for(const error of ['Too Many Requests: retry after 12','Forbidden: bot was blocked by the user','network timeout']) {
   assert.equal(app.mirrorFailureEligible({ok:false,description:error}),false);
 }
 forceError='Forbidden: bot was blocked by the user';calls.length=0;
 assert.equal((await deliver()).ok,false);
 assert(calls.every(c=>String(c.from_chat_id)===b));
 // A source->same source override bypasses the remembered preference.
 const reset=await app.resolveMirrorSource(store(),{chatId:from,msgId:'13'},{vaultRewrite:from+' '+from});
 assert.equal(reset.chatId,from);
 forceError=''; live=new Set([b]); calls.length=0;
 objects.get('channel:'+from).values.set('mirror-file:13',{[b]:{chatId:b,msgId:9999}});
 kv.put=async()=>{throw new Error('KV quota exhausted');};
 assert((await deliver()).ok);
 assert.equal(calls[0].message_id,9999,'DO mapping must override an older KV mapping');
 assert.equal(kvWrites,0,'failover routing hints must never write to KV');
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: automatic vault failover, actual message IDs, remembered preference, per-file/subtitle routing, old-map discovery and safe failures.');
