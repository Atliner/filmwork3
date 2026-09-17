import assert from 'node:assert/strict';
import {buildPlan,createCloudflareClient,inspect,install,validateWorkerName} from '../scripts/editor-installer.mjs';
const account='a'.repeat(32), worker='film';
const settings={compatibility_date:'2026-09-01',compatibility_flags:['nodejs_compat'],observability:{enabled:true},bindings:[
 {type:'kv_namespace',name:'KV',namespace_id:'b'.repeat(32)},
 {type:'plain_text',name:'CONTENT_ADMIN_IDS',text:'123456789'},
 {type:'plain_text',name:'CONTENT_BOT_TOKEN',text:'DO_NOT_EXPORT'},
 {type:'secret_text',name:'BOT_TOKEN'},
 {type:'r2_bucket',name:'FILES',bucket_name:'existing-bucket'}
]};
const service={default_environment:{script:{migration_tag:'old-v3',etag:'one'}}};
const plan=buildPlan(settings,service,[],worker);
assert.equal(plan.action,'create');
assert.deepEqual(plan.metadata.migrations,{old_tag:'old-v3',new_tag:'content-editor-installer-v1',steps:[{new_sqlite_classes:['EditorSession']}]});
assert(!JSON.stringify(plan.metadata).includes('DO_NOT_EXPORT'));
assert.equal(plan.metadata.bindings.filter(b=>b.type==='inherit').length,5);
assert.equal(plan.metadata.bindings.at(-1).class_name,'EditorSession');
assert.deepEqual(plan.metadata.observability,{enabled:true});
const namespace={id:'c'.repeat(32),script:worker,class:'EditorSession',use_sqlite:true};
assert.equal(buildPlan(settings,service,[namespace],worker).action,'bind');
assert(!buildPlan(settings,service,[namespace],worker).metadata.migrations);
const ready={...settings,bindings:[...settings.bindings,{type:'durable_object_namespace',name:'EDITOR',class_name:'EditorSession',namespace_id:namespace.id}]};
assert.equal(buildPlan(ready,service,[namespace],worker).action,'ready');
for(const name of ['https://film.workers.dev','../film','film;rm','film space','']) assert.throws(()=>validateWorkerName(name));
assert.throws(()=>buildPlan({...settings,bindings:[]},service,[],worker));
assert.throws(()=>buildPlan({...settings,bindings:[...settings.bindings,{name:'EDITOR',type:'plain_text'}]},service,[],worker));
assert.throws(()=>buildPlan(settings,service,[{...namespace,class:'Other'}],worker));
assert.throws(()=>buildPlan(settings,service,[{...namespace,use_sqlite:false}],worker));
assert.throws(()=>buildPlan(settings,{default_environment:{script:{migration_tag:'content-editor-installer-v1'}}},[],worker));
assert.throws(()=>buildPlan({...settings,bindings:[...settings.bindings,{name:'DATA',type:'text_blob'}]},service,[],worker));
let current=structuredClone(settings), currentService=structuredClone(service), namespaces=[], puts=0;
const client=async(route,options={})=>{
 if(options.method==='PUT') {
  puts++;
  assert.match(route,/bindings_inherit=strict$/);
  const metadata=JSON.parse(await options.body.get('metadata').text());
  assert(!JSON.stringify(metadata).includes('DO_NOT_EXPORT'));
  assert.equal(await options.body.get('worker.js').text(),'export class EditorSession {}\nexport default {}');
  current=structuredClone(ready);namespaces=[namespace];currentService.default_environment.script.migration_tag='content-editor-installer-v1';
  return {success:true,result:{}};
 }
 if(route.endsWith('/settings'))return {success:true,result:structuredClone(current)};
 if(route.includes('/services/'))return {success:true,result:structuredClone(currentService)};
 if(route.includes('/namespaces?'))return {success:true,result:structuredClone(namespaces),result_info:{total_pages:1}};
 throw new Error('Unexpected route');
};
const before=await inspect(client,account,worker);
await install(client,account,worker,before,'export class EditorSession {}\nexport default {}');
assert.equal(puts,1);
await install(client,account,worker,await inspect(client,account,worker),'export class EditorSession {}\nexport default {}');
assert.equal(puts,1); // no redeploy or duplicate migration when already configured
assert.equal(current.bindings.find(b=>b.name==='KV').namespace_id,settings.bindings[0].namespace_id);
current=structuredClone(settings);namespaces=[];currentService=structuredClone(service);
const stale=await inspect(client,account,worker);
currentService.default_environment.script.etag='changed';
await assert.rejects(()=>install(client,account,worker,stale,'export class EditorSession {}\nexport default {}'),/تغییر/);
assert.equal(puts,1);
const denied=createCloudflareClient('secret-token',async(_url,opts)=>{
 assert.equal(opts.headers.Authorization,'Bearer secret-token');
 return Response.json({success:false,errors:[{code:10000,message:'sensitive-value'}]},{status:403});
});
await assert.rejects(()=>denied('/test'),e=>e.message.includes('10000')&&!e.message.includes('sensitive-value')&&!e.message.includes('secret-token'));
let pages=0;
await inspect(async route=>{
 if(!route.includes('/namespaces?'))return client(route);
 pages++;
 return {success:true,result:[],result_info:{total_pages:2}};
},account,worker);
assert.equal(pages,2);
console.log('PASS: editor installer migration plan, strict inheritance, secret redaction, existing namespace reuse, repeat safety, concurrent-change guard and pagination. No live deployment was performed.');
