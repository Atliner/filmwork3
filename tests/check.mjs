import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { APP_HTML, apiAuthTicket, signupBonusOf, telegramDisplayName, createTgUser, bustSettings };').toString('base64'));
const scripts = [...mod.APP_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
for (const script of scripts) new vm.Script(script);
assert(!mod.APP_HTML.includes('id="hdr-back"'));
assert(mod.APP_HTML.includes('.hero-desc{display:none}'));
assert(mod.APP_HTML.includes('.detail-posters .dp-carousel{position:relative'));
assert(source.includes("infoCard + '<section class=\"d-sec detail-posters\""));
const ready = await mod.apiAuthTicket({get: async () => ({status:'ready', token:'test', user:{username:'test'}, createdAt:Date.now()})}, 'ticket');
assert.equal((await ready.json()).token, 'test');
const expired = await mod.apiAuthTicket({get: async () => ({status:'pending', createdAt:1})}, 'ticket');
assert.equal(expired.status, 404);
const missing = await mod.apiAuthTicket({get: async () => null}, 'ticket');
assert.equal(missing.status, 404);
console.log('PASS: generated browser scripts parse; header, mobile banner, gallery placement, ready/expired/missing tickets.');

assert.equal(mod.signupBonusOf({}), 50);
assert.equal(mod.signupBonusOf({signupBonus:0}), 0);
assert.equal(mod.signupBonusOf({signupBonus:125}), 125);
for (const value of [-1, 1.5, Infinity, 'bad']) assert.equal(mod.signupBonusOf({signupBonus:value}), 50);
assert.equal(mod.telegramDisplayName({id:1,first_name:'علی',last_name:'رضایی'}), 'علی رضایی');
assert.equal(mod.telegramDisplayName({id:1,username:'ali'}), 'ali');
assert(!source.includes("st.mode = 'wait_name'"));
assert(!source.includes('لطفاً نام و نام خانوادگی خود را وارد کنید'));
for (const bonus of [0, 125]) {
  const data = new Map([['set', {signupBonus:bonus}]]);
  const store = {kv:{}, env:{}, get:async k=>data.get(k) ?? null, set:async(k,v)=>data.set(k,structuredClone(v)), list:async prefix=>[...data.keys()].filter(k=>k.startsWith(prefix))};
  const user = await mod.createTgUser(store, {tgId:'1234', tgName:'Test',phone:'09123456789'});
  assert.equal(user.wallet, bonus);
  assert.equal(user.signupBonusGranted, bonus);
  const returning = await mod.createTgUser(store, {tgId:'1234',tgName:'Test'});
  assert.equal(returning.wallet, bonus);
}
console.log('PASS: Telegram names; default/custom/zero signup gifts; no repeated gift on return.');
