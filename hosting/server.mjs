#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  سینماگرام روی هاست اشتراکی — اجراکنندهٔ همان worker.js بدون Cloudflare
 * ═══════════════════════════════════════════════════════════════════════════
 *  چرا؟ چون workers.dev در ایران فیلتر است و IP سرور ممکن است بسته شود.
 *  این فایل همان تک‌فایلِ worker.js را روی Node (هاست cPanel/DirectAdmin یا VPS)
 *  اجرا می‌کند و D1/KV/Durable Object را با SQLite شبیه‌سازی می‌کند.
 *
 *  اجرا:
 *     node hosting/server.mjs
 *  پیکربندی:
 *     hosting/config.json  (کنار همین فایل؛ توکن‌ها را اینجا بگذار — در گیت نباشد)
 *     یا متغیرهای محیطی: PORT, HOST, BOT_TOKEN, BOT_USERNAME, ...
 *  حالت آینه (پروکسی به Cloudflare برای مواقع فیلتر شدن Worker):
 *     "UPSTREAM_SITE": "https://site.example.workers.dev"
 *     هر درخواستی که به این سرور بیاید به همان مسیر در Cloudflare پاس می‌شود؛
 *     دامنهٔ ایران روی هاست می‌ماند و IP کلادفلر دیده نمی‌شود.
 *
 *  نکته: زیرساخت داده (D1/KV) اینجا فایل SQLite است؛ با Cloudflare یکی نیست.
 *  اگر می‌خواهی داده‌ها مشترک باشند، UPSTREAM_SITE را روشن کن (حالت آینه).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeD1, makeKV, makeDurableObjects, makeCache } from './shims.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(HERE, 'data');
const WORKER = path.join(ROOT, 'worker.js');

/* ── پیکربندی ───────────────────────────────────────────────────────────── */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}
const config = Object.assign(
  {},
  readJson(path.join(HERE, 'config.json')),
  readJson(path.join(HERE, 'config.local.json')),
);

function cfg(name, dflt) {
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
  if (config[name] !== undefined && config[name] !== '') return config[name];
  return dflt;
}

const PORT = Number(cfg('PORT', 8080));
const HOST = String(cfg('HOST', '0.0.0.0'));
const UPSTREAM = String(cfg('UPSTREAM_SITE', '')).replace(/\/+$/, '');
const STORAGE_BACKEND = String(cfg('STORAGE_BACKEND', 'd1')).toLowerCase();
const USE_KV = String(cfg('USE_KV', '0')) === '1' || STORAGE_BACKEND === 'kv' || STORAGE_BACKEND === 'hybrid';
const DATA_DIR = path.resolve(cfg('DATA_DIR', DATA));

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ── بارگذاری worker.js به‌صورت ESM (بدون نیاز به package.json در ریشه) ── */
async function loadWorker() {
  const src = fs.readFileSync(WORKER, 'utf8');
  const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
  const cacheDir = path.join(DATA_DIR, '.runtime');
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, 'worker-' + hash + '.mjs');
  if (!fs.existsSync(target)) fs.writeFileSync(target, src);
  return await import(pathToFileURL(target).href + '?v=' + hash);
}

/* ── ساخت env (همان نام‌های Cloudflare) ─────────────────────────────────── */
function buildEnv(mod) {
  const env = {};
  const STRINGS = [
    'BOT_TOKEN', 'BOT_USERNAME', 'DELIVERY_BOT_TOKEN', 'DELIVERY_BOT_USERNAME', 'CONTENT_BOT_TOKEN',
    'CONTENT_WEBHOOK_SECRET', 'CONTENT_ADMIN_IDS', 'CONTENT_CHANNEL_RULES', 'VAULT_REWRITE', 'VAULT_CHAT_ID',
    'K2K_SECRET', 'ADNET_SECRET', 'AD_NET_SECRET', 'ADS_PUBLIC_ORIGIN', 'SITE_PUBLIC_ORIGIN',
    'SITE_NAME', 'STORAGE_MAINTENANCE', 'D1_AUTO_BOOTSTRAP', 'TZ', 'CRON_TOKEN',
  ];
  for (const k of STRINGS) { const v = cfg(k, ''); if (v !== '' && v !== undefined) env[k] = String(v); }
  env.STORAGE_BACKEND = STORAGE_BACKEND;
  env.D1_AUTO_BOOTSTRAP = String(cfg('D1_AUTO_BOOTSTRAP', '1'));

  /* D1: فایل SQLite اصلی سایت (کلیدهای u:, it:, set, …) */
  env.DB = makeD1(path.join(DATA_DIR, 'site.sqlite'));

  /* D1 دوم برای محتوا روی «اکانت دیگر»: روی Cloudflare این کار با شارد
     (scripts/shard-proxy-worker.js) انجام می‌شود. روی هاست اشتراکی، شاردِ همسایه
     می‌تواند همین سرور دیگری باشد؛ آدرس و رمزش را در پنل ← ذخیره‌سازی اضافه کن. */

  /* KV فقط اگر خودت بخواهی بایند شود (سازگاری با نصب‌های قدیمی) */
  if (USE_KV) env.KV = makeKV(path.join(DATA_DIR, 'kv.sqlite'));
  env.CACHE_KV = makeKV(path.join(DATA_DIR, 'cache.sqlite'));

  /* Durable Object شبیه‌سازی‌شده (صف انتشار، mirror، آلارم‌ها) */
  const doDb = new DatabaseSync(path.join(DATA_DIR, 'durable.sqlite'));
  const runtime = { env, EditorSession: mod.EditorSession, doDb };
  const dobj = makeDurableObjects(runtime);
  env.EDITOR = dobj.namespace;
  env.__shutdown = () => { try { doDb.close(); } catch (e) { } };
  return { env, alarms: dobj.startAlarms };
}

/* ── Cache API و گلوبال‌های Cloudflare ──────────────────────────────────── */
if (!globalThis.caches) globalThis.caches = makeCache();
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
if (!globalThis.btoa) globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

/* ── Node request → Fetch Request ──────────────────────────────────────── */
async function toRequest(req, origin) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  if (!headers.has('cf-connecting-ip')) {
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (ip) headers.set('cf-connecting-ip', ip.replace(/^::ffff:/, ''));
  }
  const url = origin + (req.url || '/');
  const init = { method: req.method || 'GET', headers };
  if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
  return new Request(url, init);
}

/* ── Fetch Response → Node response ────────────────────────────────────── */
async function sendResponse(res, out, method) {
  out.statusCode = res.status;
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() === 'set-cookie') continue;
    try { out.setHeader(k, v); } catch (e) { }
  }
  if (setCookies.length) out.setHeader('set-cookie', setCookies);
  if (method === 'HEAD' || !res.body) { out.end(); return; }
  try {
    Readable.fromWeb(res.body).pipe(out);
  } catch (e) {
    const buf = Buffer.from(await res.arrayBuffer());
    out.end(buf);
  }
}

/* ── حالت آینه: پاس‌دادن درخواست به Cloudflare ─────────────────────────── */
async function proxy(req, res, origin) {
  const target = UPSTREAM + (req.url || '/');
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  headers.set('x-forwarded-host', req.headers.host || '');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const init = { method: req.method, headers, redirect: 'manual' };
  if (chunks.length && req.method !== 'GET' && req.method !== 'HEAD') init.body = Buffer.concat(chunks);
  try {
    const up = await fetch(target, init);
    await sendResponse(up, res, req.method);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('پل به سرور اصلی برقرار نشد: ' + (e && e.message));
  }
}

/* ── سرور ──────────────────────────────────────────────────────────────── */
const mod = await loadWorker();
const built = buildEnv(mod);
const env = built.env;
built.alarms();

/* کرون ۳۰ دقیقه‌ای (وبهوک ربات، همگام‌سازی کانال، بنرها) */
const cron = setInterval(() => {
  Promise.resolve()
    .then(() => mod.default.fetch(null, env, { waitUntil: (p) => Promise.resolve(p).catch(() => { }) }))
    .catch((e) => console.error('[cron]', e && e.message));
}, 30 * 60 * 1000);
cron.unref?.();

const server = http.createServer(async (req, res) => {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT));
  const origin = proto + '://' + host;

  if (req.url === '/_health' || req.url === '/_ping') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({
      ok: true,
      node: process.version,
      mode: UPSTREAM ? 'mirror' : 'standalone',
      storage: STORAGE_BACKEND,
      kv: USE_KV,
      uptime: Math.round(process.uptime()),
    }));
  }

  try {
    if (UPSTREAM) return await proxy(req, res, origin);
    const request = await toRequest(req, origin);
    const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }), passThroughOnException: () => { } };
    const response = await mod.default.fetch(request, env, ctx);
    await sendResponse(response, res, req.method);
  } catch (e) {
    console.error('[http]', req.method, req.url, e && (e.stack || e.message));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'خطای سرور: ' + (e && e.message) }));
    } else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log('🎬 سینماگرام روی هاست اشتراکی');
  console.log('   • آدرس:  http://' + HOST + ':' + PORT);
  console.log('   • حالت:  ' + (UPSTREAM ? ('آینه → ' + UPSTREAM) : 'مستقل (SQLite)'));
  console.log('   • داده:  ' + DATA_DIR);
  console.log('   • Node:  ' + process.version);
});

function shutdown() {
  console.log('\nدر حال خاموش‌شدن…');
  clearInterval(cron);
  server.close(() => {
    try { env.__shutdown && env.__shutdown(); } catch (e) { }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
