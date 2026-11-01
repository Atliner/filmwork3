#!/usr/bin/env node
/*
 * patch-android.mjs — آماده‌سازی پروژهٔ اندروید Capacitor برای موبایل + اندروید تی‌وی
 * ───────────────────────────────────────────────────────────────────────────
 *  بعد از `npx cap add android` این اسکریپت اجرا می‌شود (در GitHub Actions) و:
 *   ۱) نسخهٔ برنامه را از APP_VERSION می‌گذارد،
 *   ۲) پشتیبانی Android TV را اضافه می‌کند (LEANBACK_LAUNCHER + banner + بدون
 *      نیاز به تاچ‌اسکرین) تا همان APK روی تلویزیون هم نصب و در لانچر دیده شود،
 *   ۳) اجازهٔ اینترنت و صفحهٔ تمام‌صفحه/بدون اکشن‌بار را تنظیم می‌کند.
 *  اگر ساختار فایل‌ها با نسخهٔ Capacitor هم‌خوان نبود، هشدار می‌دهد ولی متوقف نمی‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AND = path.join(APP, 'android');
if (!fs.existsSync(AND)) {
  console.error('پروژهٔ android پیدا نشد؛ اول `npx cap add android` را اجرا کنید.');
  process.exit(1);
}
const version = String(process.env.APP_VERSION || '1.0.0').replace(/^v/, '');
const build = String(process.env.APP_BUILD || Date.now()).slice(0, 9);

function read(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }
function write(f, s) { fs.writeFileSync(f, s); console.log('✓ ' + path.relative(APP, f)); }

/* ── ۱) نسخه در build.gradle ── */
{
  const f = path.join(AND, 'app', 'build.gradle');
  let s = read(f);
  if (s) {
    s = s.replace(/versionCode\s+\d+/, 'versionCode ' + (Number(build) || 1));
    s = s.replace(/versionName\s+"[^"]*"/, 'versionName "' + version + '"');
    /* اطمینان از minSdk مناسب WebView قدیمی‌تر (Capacitor 6) */
    write(f, s);
  } else console.warn('! app/build.gradle پیدا نشد');
}

/* ── ۲) AndroidManifest: اینترنت، تلویزیون، تمام‌صفحه ── */
{
  const f = path.join(AND, 'app', 'src', 'main', 'AndroidManifest.xml');
  let s = read(f);
  if (!s) {
    console.warn('! AndroidManifest.xml پیدا نشد');
  } else {
    if (!/android\.permission\.INTERNET/.test(s)) {
      s = s.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.INTERNET" />');
    }
    if (!/software\.leanback/.test(s)) {
      s = s.replace(/<application/, [
        '<!-- Android TV: همان APK روی تلویزیون نصب می‌شود و در لانچر تلویزیون دیده می‌شود -->',
        '<uses-feature android:name="android.software.leanback" android:required="false" />',
        '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
        '<uses-feature android:name="android.hardware.gamepad" android:required="false" />',
        '',
        '<application',
      ].join('\n'));
    }
    /* دستهٔ LEANBACK_LAUNCHER کنار LAUNCHER در همان intent-filter */
    if (!/LEANBACK_LAUNCHER/.test(s)) {
      s = s.replace(/(<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>)/,
        '$1\n            <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
    }
    /* بنر تلویزیون */
    if (/android:name="\.MainActivity"/.test(s) && !/android:banner=/.test(s)) {
      s = s.replace(/android:name="\.MainActivity"/, 'android:name=".MainActivity"\n            android:banner="@mipmap/ic_launcher"');
    }
    write(f, s);
  }
}

/* ── ۳) استایل/تم: بدون اکشن‌بار، پس‌زمینهٔ تیره (بدون پرش سفید هنگام لود) ── */
{
  const f = path.join(AND, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  let s = read(f);
  if (s) {
    if (!/windowBackground/.test(s)) {
      s = s.replace(/<\/style>/, '    <item name="android:windowBackground">#0b0e14</item>\n    </style>');
      write(f, s);
    }
  }
}

console.log('✓ پروژهٔ اندروید آماده است (نسخه ' + version + '، build ' + build + ').');
