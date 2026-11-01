/*
 * main.cjs — نسخهٔ ویندوز (Electron) برای سایت سینماگرام
 * ─────────────────────────────────────────────────────────
 *  آدرس سایت از یکی از این‌ها خوانده می‌شود (به ترتیب):
 *    ۱) پارامتر اجرا:  Filmwork.exe --site=https://example.com
 *    ۲) متغیر محیطی:   SITE_URL
 *    ۳) فایل site-url.txt کنار برنامه (در بیلد گیت‌هاب نوشته می‌شود)
 *  اگر هیچ‌کدام نبود، صفحهٔ «آدرس سایت را وارد کنید» باز می‌شود و آدرس در
 *  localStorage همان پنجره ذخیره می‌ماند.
 */
'use strict';
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV = process.argv.includes('--dev');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function siteFromConfig() {
  const arg = (process.argv.find((a) => /^--site=/.test(a)) || '').split('=')[1] || '';
  let fromFile = '';
  try { fromFile = fs.readFileSync(path.join(__dirname, 'site-url.txt'), 'utf8').trim(); } catch (e) { }
  let url = String(arg || process.env.SITE_URL || fromFile || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { return new URL(url).origin; } catch (e) { return ''; }
}

const SITE = siteFromConfig();

function isInternal(url) {
  if (!SITE) return false;
  try { return new URL(url).origin === SITE; } catch (e) { return false; }
}

function openExternal(url) {
  try { if (/^https?:\/\//i.test(url) || /^tg:\/\//i.test(url)) shell.openExternal(url); } catch (e) { }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'Filmwork',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);

  /* کاربر انتظار دارد لینک‌های تلگرام/خارجی در مرورگر باز شوند، نه داخل برنامه */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url) && !url.startsWith('http://localhost')) {
      e.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.control && input.key.toLowerCase() === 'f')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
    if (input.control && input.key.toLowerCase() === 'q') { app.quit(); e.preventDefault(); }
    if (input.key === 'F12') { if (DEV) win.webContents.toggleDevTools(); e.preventDefault(); }
    if (input.control && (input.key === '+' || input.key === '=')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault(); }
    if (input.control && input.key === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault(); }
    if (input.control && input.key === '0') { win.webContents.setZoomLevel(0); e.preventDefault(); }
  });

  if (SITE) win.loadURL(SITE);
  else win.loadFile(path.join(__dirname, 'www', 'index.html'));
  return win;
}

/* یک نمونه در هر زمان؛ لینک‌های دوم در همان پنجره باز شوند */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    /* UA پیش‌فرض Electron بعضی سایت‌ها را حساس می‌کند؛ مثل Chrome معرفی می‌شویم */
    const ua = session.defaultSession.getUserAgent()
      .replace(/\sElectron\/[\d.]+/i, '')
      .replace(/\sfilmwork-desktop\/[\d.]+/i, '');
    session.defaultSession.setUserAgent(ua + ' FilmworkDesktop/1.0');
    try {
      session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        cb(['fullscreen', 'clipboard-sanitized-write', 'notifications'].includes(permission));
      });
    } catch (e) { }
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
