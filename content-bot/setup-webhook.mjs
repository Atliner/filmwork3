// Run with environment variables, not tokens on the command line.
const {CONTENT_BOT_TOKEN,CONTENT_WEBHOOK_SECRET,CONTENT_BOT_ORIGIN}=process.env;
if (!CONTENT_BOT_TOKEN || !CONTENT_WEBHOOK_SECRET || !CONTENT_BOT_ORIGIN) throw new Error('Set CONTENT_BOT_TOKEN, CONTENT_WEBHOOK_SECRET and CONTENT_BOT_ORIGIN in the environment.');
if (!/^[A-Za-z0-9_-]{32,256}$/.test(CONTENT_WEBHOOK_SECRET)) throw new Error('Webhook secret must contain 32–256 letters, digits, underscores or hyphens.');
const origin=new URL(CONTENT_BOT_ORIGIN);
if(origin.protocol!=='https:') throw new Error('Use an HTTPS bot Worker origin.');
const r=await fetch('https://api.telegram.org/bot'+CONTENT_BOT_TOKEN+'/setWebhook',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({url:origin.origin+'/webhook',secret_token:CONTENT_WEBHOOK_SECRET,allowed_updates:['message'],max_connections:1,drop_pending_updates:false})
});
const result=await r.json();
if(!result.ok) throw new Error('Telegram rejected webhook configuration. Check the bot token and Worker URL privately.');
console.log('Editorial bot webhook configured. Existing login/delivery bot webhooks were not changed.');
