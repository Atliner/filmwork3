/*
 * shims.mjs — جایگزین‌های سبک Cloudflare برای اجرای همان worker.js روی هاست اشتراکی
 * ─────────────────────────────────────────────────────────────────────────────
 *  هیچ وابستگی بیرونی ندارد؛ فقط Node ≥ ۲۰ (ترجیحاً ۲۲) با ماژول توکار node:sqlite.
 *
 *  D1      → یک فایل SQLite (همان SQL، همان رفتار prepare/bind/first/all/run/batch)
 *  KV      → یک فایل SQLite با TTL (فقط اگر خودت بخواهی؛ سایت بدون KV هم کار می‌کند)
 *  EDITOR  → Durable Object شبیه‌سازی‌شده روی SQLite + آلارم
 *  Cache   → کش درون‌حافظه‌ای با TTL (همان caches.default.match/put/delete)
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/* ── D1 ─────────────────────────────────────────────────────────────────── */
export function makeD1(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  try { sql.exec('PRAGMA journal_mode=WAL'); } catch (e) { }
  try { sql.exec('PRAGMA busy_timeout=8000'); } catch (e) { }

  function prepare(text) {
    const make = (params) => ({
      bind: (...p) => make(p),
      first: async () => sql.prepare(text).get(...params) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...params) }),
      run: async () => {
        const r = sql.prepare(text).run(...params);
        return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
      },
      text,
      params,
    });
    return make([]);
  }

  const db = {
    prepare,
    /** D1 batch = همه یا هیچ (تراکنش واقعی) */
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (const st of statements) {
          if (!st || typeof st.text !== 'string') throw new Error('batch: statement نامعتبر');
          out.push({ success: true, meta: sql.prepare(st.text).run(...(st.params || [])) });
        }
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        try { sql.exec('ROLLBACK'); } catch (x) { }
        throw e;
      }
    },
    withSession() { return db; },
    exec(script) { sql.exec(script); },
    /** فقط برای اسکریپت‌های نگه‌داری/پشتیبان‌گیری */
    raw: sql,
  };
  return db;
}

/* ── KV (اختیاری) ───────────────────────────────────────────────────────── */
export function makeKV(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  try { sql.exec('PRAGMA journal_mode=WAL'); } catch (e) { }
  sql.exec('CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)');
  sql.exec('CREATE INDEX IF NOT EXISTS kv_exp ON kv(expires_at)');
  const now = () => Math.floor(Date.now() / 1000);
  const gc = () => { try { sql.prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at<=?').run(now()); } catch (e) { } };
  return {
    async get(key, opts) {
      const row = sql.prepare('SELECT value FROM kv WHERE key=? AND (expires_at IS NULL OR expires_at>?)').get(key, now());
      if (!row) return null;
      const type = typeof opts === 'string' ? opts : (opts && opts.type);
      if (type === 'json') { try { return JSON.parse(row.value); } catch (e) { return null; } }
      return row.value;
    },
    async put(key, value, opts) {
      const o = opts || {};
      const exp = o.expiration ? Number(o.expiration) : (o.expirationTtl ? now() + Math.max(60, Math.ceil(Number(o.expirationTtl))) : null);
      sql.prepare('INSERT INTO kv(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at')
        .run(key, String(value), exp);
    },
    async delete(key) { sql.prepare('DELETE FROM kv WHERE key=?').run(key); },
    async list(opts) {
      gc();
      const o = opts || {};
      const prefix = o.prefix || '';
      const limit = Math.max(1, Math.min(1000, Number(o.limit) || 1000));
      let after = '';
      if (o.cursor) { try { after = Buffer.from(String(o.cursor), 'base64url').toString('utf8'); } catch (e) { after = ''; } }
      const rows = sql.prepare('SELECT key,expires_at FROM kv WHERE key>=? AND key<? AND key>? AND (expires_at IS NULL OR expires_at>?) ORDER BY key LIMIT ?')
        .all(prefix, prefix + '\u{10ffff}', after, now(), limit + 1);
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        keys: page.map((r) => ({ name: r.key, ...(r.expires_at ? { expiration: r.expires_at } : {}) })),
        list_complete: !more,
        cursor: more ? Buffer.from(page[page.length - 1].key, 'utf8').toString('base64url') : undefined,
      };
    },
  };
}

/* ── Durable Object (EDITOR) روی SQLite ─────────────────────────────────── */
export function makeDurableObjects(runtime) {
  const sql = runtime.doDb;
  sql.exec('CREATE TABLE IF NOT EXISTS do_kv(do_name TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY(do_name,key))');
  sql.exec('CREATE TABLE IF NOT EXISTS do_alarm(do_name TEXT PRIMARY KEY, at INTEGER)');
  const nowSec = () => Math.floor(Date.now() / 1000);
  const instances = new Map();

  function storageFor(name) {
    const sel = 'SELECT value FROM do_kv WHERE do_name=? AND key=? AND (expires_at IS NULL OR expires_at>?)';
    return {
      async get(key) {
        if (Array.isArray(key)) {
          const out = new Map();
          for (const k of key) { const v = await this.get(k); if (v !== undefined) out.set(k, v); }
          return out;
        }
        const row = sql.prepare(sel).get(name, String(key), nowSec());
        if (!row) return undefined;
        try { return JSON.parse(row.value); } catch (e) { return undefined; }
      },
      async put(key, value, opts) {
        if (key && typeof key === 'object') {
          for (const [k, v] of Object.entries(key)) await this.put(k, v, value);
          return;
        }
        const o = opts || {};
        const exp = o.expiration ? Number(o.expiration) : (o.expirationTtl ? nowSec() + Math.ceil(Number(o.expirationTtl)) : null);
        sql.prepare('INSERT INTO do_kv(do_name,key,value,expires_at) VALUES(?,?,?,?) ON CONFLICT(do_name,key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at')
          .run(name, String(key), JSON.stringify(value), exp);
      },
      async delete(key) {
        if (Array.isArray(key)) { for (const k of key) await this.delete(k); return true; }
        sql.prepare('DELETE FROM do_kv WHERE do_name=? AND key=?').run(name, String(key));
        return true;
      },
      async list(opts) {
        const o = opts || {};
        const prefix = o.prefix || '';
        const limit = Math.max(1, Math.min(1000, Number(o.limit) || 1000));
        const rows = sql.prepare('SELECT key,value FROM do_kv WHERE do_name=? AND key>=? AND key<? AND (expires_at IS NULL OR expires_at>?) ORDER BY key LIMIT ?')
          .all(name, prefix, prefix + '\u{10ffff}', nowSec(), limit);
        const out = new Map();
        for (const r of rows) { try { out.set(r.key, JSON.parse(r.value)); } catch (e) { } }
        return out;
      },
      async setAlarm(at) {
        const t = at instanceof Date ? Math.floor(at.getTime() / 1000) : Math.floor(Number(at) / 1000);
        sql.prepare('INSERT INTO do_alarm(do_name,at) VALUES(?,?) ON CONFLICT(do_name) DO UPDATE SET at=excluded.at').run(name, t);
      },
      async deleteAlarm() { sql.prepare('DELETE FROM do_alarm WHERE do_name=?').run(name); },
      async getAlarm() {
        const row = sql.prepare('SELECT at FROM do_alarm WHERE do_name=?').get(name);
        return row ? new Date(Number(row.at) * 1000) : null;
      },
    };
  }

  function instance(name) {
    let rec = instances.get(name);
    if (rec) return rec;
    const storage = storageFor(name);
    const ctx = {
      storage,
      waitUntil(p) { Promise.resolve(p).catch(() => { }); },
      blockConcurrencyWhile(fn) { return fn(); },
    };
    rec = { obj: new runtime.EditorSession(ctx, runtime.env), ctx, touched: Date.now() };
    instances.set(name, rec);
    return rec;
  }

  const ns = {
    idFromName: (n) => String(n),
    idFromString: (n) => String(n),
    newUniqueId: () => 'do_' + crypto.randomUUID(),
    get: (id) => ({
      id: String(id),
      fetch: (req) => instance(String(id)).obj.fetch(req),
    }),
  };

  /** هر ۵ ثانیه: آلارم‌های سررسیده را اجرا کن (همان کاری که Cloudflare می‌کند) */
  function startAlarms() {
    setInterval(async () => {
      const t = nowSec();
      let rows = [];
      try { rows = sql.prepare('SELECT do_name,at FROM do_alarm WHERE at<=? LIMIT 20').all(t); } catch (e) { return; }
      for (const row of rows) {
        try { sql.prepare('DELETE FROM do_alarm WHERE do_name=? AND at<=?').run(row.do_name, t); } catch (e) { }
        const rec = instance(row.do_name);
        if (typeof rec.obj.alarm === 'function') {
          try { await rec.obj.alarm(); } catch (e) { console.error('[do alarm]', row.do_name, e && e.message); }
        }
      }
    }, 5000).unref?.();
  }

  return { namespace: ns, startAlarms, instances };
}

/* ── Cache API (فقط برای صفحه/فهرست عمومی) ─────────────────────────────── */
export function makeCache(maxBytes = 48 * 1024 * 1024) {
  const map = new Map();
  let bytes = 0;
  const keyOf = (req) => {
    try { return typeof req === 'string' ? req : (req && req.url) || String(req); } catch (e) { return String(req); }
  };
  const c = {
    async match(req) {
      const hit = map.get(keyOf(req));
      if (!hit) return undefined;
      if (hit.exp && hit.exp <= Date.now()) { map.delete(keyOf(req)); bytes -= hit.size; return undefined; }
      return new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
    },
    async put(req, res) {
      try {
        const buf = Buffer.from(await res.clone().arrayBuffer());
        if (!buf.length || buf.length > 8 * 1024 * 1024) return;
        const k = keyOf(req);
        const old = map.get(k);
        if (old) bytes -= old.size;
        const cc = String(res.headers.get('cache-control') || '');
        const m = /max-age=(\d+)/.exec(cc);
        const ttl = Math.max(15, Math.min(600, m ? Number(m[1]) : 60)) * 1000;
        map.set(k, { body: buf, status: res.status, headers: Object.fromEntries(res.headers), size: buf.length, exp: Date.now() + ttl });
        bytes += buf.length;
        while (bytes > maxBytes && map.size) { const [fk, fv] = map.entries().next().value; map.delete(fk); bytes -= fv.size; }
      } catch (e) { }
    },
    async delete(req) { const old = map.get(keyOf(req)); if (old) bytes -= old.size; return map.delete(keyOf(req)); },
  };
  return { default: c, _size: () => bytes };
}
