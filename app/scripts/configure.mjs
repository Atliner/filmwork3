#!/usr/bin/env node
/*
 * configure.mjs — نوشتن آدرس سایت داخل capacitor.config.json
 *   SITE_URL=https://site.example.com node app/scripts/configure.mjs
 * اگر SITE_URL خالی باشد، برنامه با صفحهٔ «آدرس سایت را وارد کنید» بالا می‌آید
 * (کاربر یک‌بار آدرس را می‌زند و ذخیره می‌شود).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(APP, 'capacitor.config.json');
const conf = JSON.parse(fs.readFileSync(file, 'utf8'));

let url = String(process.env.SITE_URL || process.env.MVX_SITE_URL || '').trim().replace(/\/+$/, '');
if (url) {
  if (!/^https:\/\//i.test(url)) {
    console.error('SITE_URL باید با https:// شروع شود (اندروید اجازهٔ http نمی‌دهد):', url);
    process.exit(1);
  }
  conf.server = Object.assign({}, conf.server, { url });
  console.log('✓ آدرس سایت داخل برنامه: ' + url);
} else {
  if (conf.server) delete conf.server.url;
  console.log('! SITE_URL خالی است — برنامه با انتخابگر آدرس ساخته می‌شود.');
}
if (process.env.APP_NAME) conf.appName = String(process.env.APP_NAME);
if (process.env.APP_ID) conf.appId = String(process.env.APP_ID);
fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n');
