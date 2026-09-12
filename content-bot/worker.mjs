/* Independent editorial bot. No movie files pass through this Worker. */
const STAGES = ['dub', 'hardsub', 'softsub', 'original'];
const LABELS = {dub:'دوبله فارسی',hardsub:'زیرنویس چسبیده (هاردساب)',softsub:'زیرنویس سافت‌ساب',original:'زبان اصلی بدون زیرنویس'};
const DAY = 86400000;
export function parseFilename(name) {
  const text = String(name || '').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  const match = text.match(/(?:^|[ ._\-])s(\d{1,3})[ ._\-]*e(\d{1,4})(?!\d)/i) || text.match(/(?:^|[ ._\-])(\d{1,3})x(\d{1,4})(?!\d)/i);
  const q = text.match(/(?:^|[ ._\-\[(])(2160|1080|720|480)p?(?=$|[ ._\-\])])/i) || text.match(/(?:^|[ ._\-])(4k)(?=$|[ ._\-])/i);
  // Multi-episode packs must be assigned explicitly; never guess one episode.
  const multi = /e\d+(?:e\d+|[- ]e?\d+)/i.test(text);
  return {season:match && !multi ? Number(match[1]) : null,episode:match && !multi ? Number(match[2]) : null,
    quality:q ? (/2160|4k/i.test(q[1]) ? '4k' : q[1]) : null,
    detectedTitle:match ? text.slice(0,match.index).replace(/[._]/g,' ').trim() : text.replace(/\.(mkv|mp4|avi)$/i,'')};
}
export function itemIdFromLink(text, origin) {
  try {
    const u = new URL(text.trim());
    if (u.origin !== new URL(origin).origin) return '';
    return /^#\/item\/(i_[a-z0-9]+)$/.exec(u.hash)?.[1] || '';
  } catch { return ''; }
}
function sourceLink(text) {
  const m = /^https:\/\/t\.me\/(?:c\/(\d+)|([a-zA-Z0-9_]+))\/(\d+)\/?$/.exec(text.trim());
  return m ? {chatId:m[1] ? '-100'+m[1] : '@'+m[2],msgId:Number(m[3])} : null;
}
const hex = bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
async function keyFor(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).slice(0,16); }
const randomJob = ()=>hex(crypto.getRandomValues(new Uint8Array(16)));
async function tg(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot'+env.CONTENT_BOT_TOKEN+'/'+method, {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.description || 'ارتباط با تلگرام ناموفق بود');
  return data.result;
}
async function site(env, action, body) {
  const request = new Request('https://site.internal/api/content-bot/'+action, {
    method:'POST',headers:{'content-type':'application/json','x-content-bot-secret':env.CONTENT_BOT_SECRET},
    body:JSON.stringify(body)
  });
  const r = await env.SITE.fetch(request);
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error || 'خطای سایت'); e.status = r.status; throw e; }
  return data;
}
function adminAllowed(env,id) { return String(env.CONTENT_ADMIN_IDS || '').split(',').map(x=>x.trim()).includes(String(id)); }
export default {
  async fetch(request,env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ok:true,service:'content-bot'});
    if (path !== '/webhook' || request.method !== 'POST') return new Response('Not found',{status:404});
    if (!env.CONTENT_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.CONTENT_WEBHOOK_SECRET) return new Response('Forbidden',{status:403});
    const raw = await request.text();
    if (raw.length > 128*1024) return new Response('Too large',{status:413});
    let update; try { update=JSON.parse(raw); } catch { return new Response('Invalid JSON',{status:400}); }
    const msg = update.message;
    // Channel posts, other bots, edits and group conversations cannot change a draft.
    if (!msg || msg.chat?.type !== 'private' || msg.from?.is_bot || !adminAllowed(env,msg.from?.id)) return Response.json({ok:true});
    const stub = env.EDITOR.get(env.EDITOR.idFromName('admin:'+msg.from.id));
    return stub.fetch(new Request('https://editor.internal/update',{method:'POST',body:JSON.stringify(update)}));
  }
};
export class EditorSession {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; this.tail=Promise.resolve(); }
  fetch(request) {
    // Serialize messages across all awaits; concurrent Telegram deliveries must not lose draft files.
    const result = this.tail.then(()=>this.dispatch(request));
    this.tail = result.catch(()=>{});
    return result;
  }
  async dispatch(request) {
    // All publications from this bot are routed through a single durable coordinator.
    if (new URL(request.url).pathname === '/publish') {
      const data = await request.json();
      try { return Response.json(await site(this.env,'publish',data)); }
      catch(e) { return Response.json({error:e.message},{status:e.status || 502}); }
    }
    const update=await request.json(), msg=update.message, actor=String(msg.from.id);
    const seen=await this.ctx.storage.get('seen') || [];
    if (seen.includes(update.update_id)) return Response.json({ok:true});
    try {
      await site(this.env,'whoami',{actorId:actor}); // Check current site role, not just an allowlist.
      await this.process(msg,actor);
      await this.ctx.storage.put('seen',[...seen,update.update_id].slice(-100));
    } catch(e) {
      // Do not log tokens or Telegram message payloads.
      try { await this.say(msg.chat.id,'⚠️ '+e.message+'\nبرای راهنما /help را بفرستید.'); } catch { return new Response('Retry',{status:503}); }
    }
    return Response.json({ok:true});
  }
  say(chat,text) { return tg(this.env,'sendMessage',{chat_id:chat,text}); }
  async save(draft) {
    draft.touchedAt=Date.now();
    await this.ctx.storage.put('draft',draft);
    await this.ctx.storage.setAlarm(Date.now()+DAY);
  }
  stageText(d) {
    return 'اثر: '+d.item.title+'\nاکنون فایل‌های '+LABELS[STAGES[d.stage]]+' را بفرستید (خود فایل یا فوروارد). عنوان نسخه را می‌توانید در کپشن بنویسید.\n/next مرحله بعد (ردکردن مرحله)\n/review پیش‌نمایش\n/cancel لغو';
  }
  async process(msg,actor) {
    const text=String(msg.text || '').trim(), chat=msg.chat.id;
    let d=await this.ctx.storage.get('draft');
    if (text === '/help' || text === '/start') return this.say(chat,
      'لینک صفحه فیلم یا سریال در سایت را بفرستید. اثر باید از قبل در سایت ساخته شده باشد.\nفایل‌ها از روی نام مانند Silo.S02E03.1080p.mkv دسته‌بندی می‌شوند.\n/next مرحله بعد\n/accept تأیید فایل مبهم\n/assign 2 3 1080 اصلاح فصل، قسمت و کیفیت فایل منتظر (برای فیلم: 1 1 1080)\n/skip ردکردن فایل منتظر\n/review خلاصه\n/remove 2 حذف فایل دوم از پیش‌نویس\n/confirm انتشار پس از پیش‌نمایش\n/refresh تازه‌کردن مشخصات اثر\n/cancel لغو پیش‌نویس\nحداکثر ۲۰ فایل در هر پیش‌نویس؛ پس از ثبت می‌توانید دسته بعدی را شروع کنید.');
    if (d?.phase === 'publishing' && !['/confirm','/review'].includes(text)) return this.say(chat,'نتیجه انتشار هنوز قطعی نیست. ابتدا /confirm را دوباره بفرستید؛ لغو یا حذف فایل در این وضعیت مجاز نیست.');
    if (text === '/cancel') {
      if (d) await this.discard(d);
      return this.say(chat,'پیش‌نویس لغو شد. لینک اثر را بفرستید.');
    }
    const itemId=itemIdFromLink(text,this.env.SITE_PUBLIC_ORIGIN);
    if (itemId) {
      if (d) return this.say(chat,'ابتدا پیش‌نویس فعلی را با /confirm ثبت یا با /cancel لغو کنید.');
      const data=await site(this.env,'item',{actorId:actor,itemId});
      if (!['movie','series'].includes(data.item.type)) return this.say(chat,'این اثر فیلم یا سریال نیست.');
      d={actor,chat,jobId:randomJob(),item:data.item,vault:data.vault,stage:0,files:[],pending:null,phase:'collect'};
      await this.save(d);
      return this.say(chat,'🎬 '+data.item.title+' — '+(data.item.year || '')+'\n'+data.item.description.slice(0,700)+'\n\n'+this.stageText(d));
    }
    if (!d) return this.say(chat,'ابتدا لینک صفحه فیلم یا سریال در همین سایت را بفرستید.');
    if (text === '/refresh') {
      const data=await site(this.env,'item',{actorId:actor,itemId:d.item.id});
      if (data.vault !== d.vault) return this.say(chat,'مخزن تغییر کرده است؛ این پیش‌نویس را لغو و دوباره شروع کنید.');
      d.item=data.item; d.phase='collect'; await this.save(d); return this.review(d);
    }
    if (text === '/skip') { d.pending=null; d.phase='collect'; await this.save(d); return this.say(chat,'فایل منتظر رد شد.\n'+this.stageText(d)); }
    if (text === '/next') {
      if (d.pending) return this.say(chat,'ابتدا فایل منتظر را با /assign یا /accept تعیین تکلیف کنید؛ برای ردکردن /skip.');
      if (d.stage === STAGES.length-1) return this.review(d);
      d.stage++; d.phase='collect'; await this.save(d); return this.say(chat,this.stageText(d));
    }
    if (text === '/review') return this.review(d);
    if (text === '/confirm') {
      if (!['review','publishing'].includes(d.phase) || d.pending || !d.files.length) return this.say(chat,'ابتدا /review را بفرستید و موارد مبهم را تکمیل کنید.');
      const retrying = d.phase === 'publishing';
      d.phase='publishing'; await this.save(d);
      const coordinator=this.env.EDITOR.get(this.env.EDITOR.idFromName('publication-coordinator'));
      const r=await coordinator.fetch(new Request('https://editor.internal/publish',{method:'POST',body:JSON.stringify({actorId:actor,itemId:d.item.id,expectedUpdatedAt:d.item.updatedAt,jobId:d.jobId,files:d.files})}));
      const result=await r.json();
      if (!r.ok) {
        if (!retrying && [400,403,404,409].includes(r.status)) { d.phase='collect'; await this.save(d); }
        throw new Error((result.error || 'انتشار ناموفق')+(r.status===409 ? '\n/refresh سپس /review و /confirm' : ''));
      }
      await this.ctx.storage.delete('draft'); await this.ctx.storage.deleteAlarm();
      return this.say(chat,'✅ '+result.count+' فایل به '+d.item.title+' اضافه شد.\n'+this.env.SITE_PUBLIC_ORIGIN+'/#/item/'+d.item.id);
    }
    if (/^\/remove \d+$/.test(text)) {
      const index=Number(text.split(' ')[1])-1;
      if (!d.files[index]) return this.say(chat,'شماره فایل در پیش‌نویس وجود ندارد.');
      const file=d.files[index];
      await tg(this.env,'deleteMessage',{chat_id:d.vault,message_id:file.msgId});
      d.files.splice(index,1); d.phase='collect'; await this.save(d); return this.say(chat,'فایل از پیش‌نویس و مخزن حذف شد؛ برای خلاصه /review.');
    }
    if (text === '/accept' || text.startsWith('/assign ')) {
      if (!d.pending) return this.say(chat,'فایل منتظری وجود ندارد.');
      if (text.startsWith('/assign ')) {
        const m=/^\/assign (\d+) (\d+) (480|720|1080|2160|4k)$/.exec(text);
        if (!m) return this.say(chat,'مثال: /assign 2 3 1080');
        Object.assign(d.pending,{season:Number(m[1]),episode:Number(m[2]),quality:m[3]==='2160'?'4k':m[3]});
      }
      return this.stageFile(d,d.pending,true);
    }
    if (d.pending) return this.say(chat,'یک فایل منتظر تأیید است. /accept یا /assign یا /skip را بفرستید.');
    const media=msg.document || msg.video || msg.audio;
    const link=sourceLink(text);
    if (!media && !link) return this.say(chat,this.stageText(d));
    if (d.files.length>=20) return this.say(chat,'پیش‌نویس به سقف ۲۰ فایل رسیده؛ /review را بفرستید.');
    const parsed=parseFilename(media?.file_name || msg.caption || '');
    const file={...parsed,kind:STAGES[d.stage],title:String(msg.caption || '').slice(0,100),sizeBytes:media?.file_size || null,
      inputChat:link?.chatId || chat,inputMessage:link?.msgId || msg.message_id,
      key:await keyFor((media?.file_unique_id || (link ? link.chatId+':'+link.msgId : chat+':'+msg.message_id))+':'+STAGES[d.stage])};
    return this.stageFile(d,file,false);
  }
  async stageFile(d,file,accepted) {
    if (d.files.some(x=>x.key===file.key)) { d.pending=null; await this.save(d); return this.say(d.chat,'این فایل قبلاً در همین پیش‌نویس دریافت شده است.'); }
    const validQuality=['480','720','1080','4k'].includes(file.quality);
    const validEpisode=d.item.type!=='series' || (Number.isInteger(file.season)&&file.season>=1&&file.season<=200&&Number.isInteger(file.episode)&&file.episode>=1&&file.episode<=10000);
    const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
    const english=d.item.title.split('|').find(t=>/[a-z]{2}/i.test(t));
    const uncertainName=!english || !norm(file.detectedTitle).includes(norm(english.trim()));
    if (!validQuality || !validEpisode || (!accepted && uncertainName)) {
      d.pending=file; d.phase='collect'; await this.save(d);
      return this.say(d.chat,'نیاز به بررسی: '+(file.detectedTitle || 'نام نامشخص')+'\nفصل '+(file.season ?? '؟')+'، قسمت '+(file.episode ?? '؟')+'، کیفیت '+(file.quality || '؟')+'\nاثر مقصد: '+d.item.title+'\nبرای اصلاح: /assign 1 2 1080\nاگر اطلاعات درست است: /accept\nردکردن: /skip');
    }
    const copied=await tg(this.env,'copyMessage',{chat_id:d.vault,from_chat_id:file.inputChat,message_id:file.inputMessage});
    d.files.push({key:file.key,kind:file.kind,title:file.title,season:d.item.type==='series'?file.season:1,episode:d.item.type==='series'?file.episode:1,
      quality:file.quality,sizeBytes:file.sizeBytes,chatId:d.vault,msgId:copied.message_id});
    d.pending=null; d.phase='collect'; await this.save(d);
    return this.say(d.chat,'📥 فایل '+d.files.length+' در پیش‌نویس: '+LABELS[file.kind]+' | '+file.quality+(d.item.type==='series'?' | S'+file.season+'E'+file.episode:'')+'\nفایل بعدی را بفرستید؛ /next یا /review. هنوز در سایت منتشر نشده است.');
  }
  async review(d) {
    if (d.pending) return this.say(d.chat,'ابتدا فایل منتظر را تعیین تکلیف کنید: /assign یا /accept یا /skip.');
    if (!d.files.length) return this.say(d.chat,'پیش‌نویس خالی است.\n'+this.stageText(d));
    if (d.phase!=='publishing') { d.phase='review'; await this.save(d); }
    return this.say(d.chat,'پیش‌نمایش '+d.item.title+'\n'+d.files.map((f,i)=>(i+1)+'. '+LABELS[f.kind]+' | '+f.quality+(d.item.type==='series'?' | S'+f.season+'E'+f.episode:'')+(f.title?' | '+f.title:'')).join('\n')+'\n\n/confirm تأیید و انتشار\n/remove 2 حذف فایل دوم\n/cancel لغو');
  }
  async discard(d) {
    if (d.phase==='publishing') return;
    if (d.files.length) await tg(this.env,'deleteMessages',{chat_id:d.vault,message_ids:d.files.map(f=>f.msgId)});
    await this.ctx.storage.delete('draft'); await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const run=this.tail.then(async()=>{
      const d=await this.ctx.storage.get('draft');
      if (!d) return;
      if (d.phase==='publishing') { await this.ctx.storage.setAlarm(Date.now()+DAY); return; } // Never delete possibly published files.
      if (Date.now()-d.touchedAt<DAY) { await this.ctx.storage.setAlarm(d.touchedAt+DAY); return; }
      await this.discard(d);
      try { await this.say(d.chat,'پیش‌نویس بدون فعالیت پس از ۲۴ ساعت لغو شد.'); } catch {}
    });
    this.tail=run.catch(()=>{}); return run;
  }
}
