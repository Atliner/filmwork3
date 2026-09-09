import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { APP_HTML, apiAuthTicket, signupBonusOf, telegramDisplayName, createTgUser, bustSettings, parseStarPacks };').toString('base64'));
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

assert.deepEqual(mod.parseStarPacks('50 | 500\n۱۰۰ | ۱۱۰۰\n٢٥٠ | ٣٠٠٠'), [
  {stars:50,units:500}, {stars:100,units:1100}, {stars:250,units:3000}
]);
assert.deepEqual(mod.parseStarPacks([{stars:75,units:900}]), [{stars:75,units:900}]);
assert.deepEqual(mod.parseStarPacks(' 10 | 20 \n\n'), [{stars:10,units:20}]);
for (const invalid of ['', '0 | 20', '-5 | 20', '1.5 | 20', '20 | 0', '20 | 1.5', '20 | 30 | 40', 'abc | 20', '10001 | 20', '10 | 9007199254740992', Array(9).fill({stars:1,units:1}), [null], [{stars:true,units:1}]]) {
  assert.throws(() => mod.parseStarPacks(invalid));
}
assert(mod.APP_HTML.includes('id="set-star-packs"'));
assert(mod.APP_HTML.includes("starPacksText: $('#set-star-packs').value"));
console.log('PASS: Stars package editor; Persian/Arabic digits; valid custom prices; invalid and oversized lists rejected.');
