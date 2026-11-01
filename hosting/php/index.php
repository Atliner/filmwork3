<?php
/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  آینهٔ سایت روی هاست اشتراکی PHP (cPanel / DirectAdmin) — بدون Node
 * ═══════════════════════════════════════════════════════════════════════════
 *  کار: هر درخواستی که به این فایل/دامنه برسد، به همان مسیر روی سایت اصلی
 *  (Cloudflare Worker یا هر دامنهٔ دیگری) پاس می‌شود و پاسخ — با پشتیبانی کامل
 *  Range برای ویدیو — به کاربر برمی‌گردد. کاربر فقط IP هاست ایرانی را می‌بیند و
 *  دامنه/IP کلادفلر پنهان می‌ماند.
 *
 *  نصب (۵ دقیقه):
 *    ۱) این فایل را در public_html بگذار (مثلاً index.php).
 *    ۲) مقدار UPSTREAM را با آدرس سایت اصلی عوض کن (بدون / انتهایی).
 *    ۳) اگر هاست از HTTPS پشتیبانی می‌کند، SSL دامنه را روشن کن (AutoSSL).
 *    ۴) .htaccess نمونه (همین پوشه) را کپی کن تا مسیرهای بدون پسوند هم به
 *       index.php برسند (مهم: /sv/… برای پخش، /api/… برای پلیر).
 *
 *  نکته: اگر دامنه فیلتر شد، فقط یک دامنه/ساب‌دامنهٔ تازه به همین هاست وصل کن؛
 *  IP هاست عوض نمی‌شود و سایت بدون تغییر در سمت کلادفلر برمی‌گردد.
 * ═══════════════════════════════════════════════════════════════════════════
 */

declare(strict_types=1);

/* ── تنظیمات ─────────────────────────────────────────────────────────────── */
const UPSTREAM      = 'https://REPLACE-WITH-YOUR-SITE.workers.dev';
const CONNECT_TIMEOUT = 15;      // ثانیه
const MAX_BODY      = 12 * 1024 * 1024; // سقف بدنهٔ درخواست (آپلود نداریم)
/* اگر می‌خواهی فقط از ایران در دسترس باشد، این را true کن (نیاز به GeoIP ندارد؛
   فقط IPهای ایران را از یک لیست ساده چک می‌کند). پیش‌فرض: خاموش. */
const IRAN_ONLY     = false;

/* ── ابزار ───────────────────────────────────────────────────────────────── */
function upstream_url(): string {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $query = $_SERVER['QUERY_STRING'] ?? '';
    return rtrim(UPSTREAM, '/') . $path . ($query !== '' ? '?' . $query : '');
}

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) {
            $ip = trim(explode(',', (string)$_SERVER[$k])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
        }
    }
    return '0.0.0.0';
}

function is_iran_ip(string $ip): bool {
    /* بازه‌های اصلی ایران (نمونه و قابل تکمیل). برای دقت کامل از GeoIP استفاده کن. */
    $ranges = ['2.144.0.0/13','5.22.0.0/16','5.23.0.0/16','5.52.0.0/16','5.53.0.0/16',
               '5.56.128.0/17','5.57.32.0/19','5.72.0.0/14','5.144.128.0/17','31.2.0.0/16',
               '31.7.64.0/18','37.32.0.0/13','37.98.0.0/17','37.130.192.0/19','46.100.0.0/16',
               '62.60.128.0/17','77.36.128.0/17','78.38.0.0/15','79.127.0.0/17','80.191.0.0/16',
               '81.12.0.0/17','81.28.32.0/19','83.120.0.0/14','85.133.128.0/17','85.185.0.0/16',
               '85.198.0.0/18','86.55.0.0/16','87.107.0.0/16','89.144.128.0/18','91.98.0.0/15',
               '93.110.0.0/16','94.182.0.0/15','95.38.0.0/16','151.232.0.0/14','176.65.192.0/18',
               '178.131.0.0/16','185.8.172.0/22','185.55.224.0/22','188.136.128.0/18','217.218.0.0/15'];
    $long = ip2long($ip);
    if ($long === false) return false;
    foreach ($ranges as $cidr) {
        [$net, $bits] = explode('/', $cidr);
        $mask = -1 << (32 - (int)$bits);
        if (($long & $mask) === (ip2long($net) & $mask)) return true;
    }
    return false;
}

if (IRAN_ONLY && !is_iran_ip(client_ip())) {
    http_response_code(403);
    header('content-type: text/plain; charset=utf-8');
    echo 'دسترسی از این منطقه مجاز نیست.';
    exit;
}

/* آدرس سایت اصلی نباید جای دیگری تنظیم شده باشد */
if (strpos(UPSTREAM, 'REPLACE-WITH') !== false) {
    http_response_code(503);
    header('content-type: text/plain; charset=utf-8');
    echo 'آینه پیکربندی نشده است: مقدار UPSTREAM را در index.php بگذارید.';
    exit;
}

/* ── ساخت درخواست ───────────────────────────────────────────────────────── */
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$headers = [];
foreach ($_SERVER as $k => $v) {
    if (strpos($k, 'HTTP_') !== 0) continue;
    $name = str_replace('_', '-', substr($k, 5));
    $low = strtolower($name);
    if (in_array($low, ['host', 'connection', 'content-length', 'accept-encoding', 'cf-connecting-ip', 'x-forwarded-for'], true)) continue;
    $headers[] = $name . ': ' . $v;
}
$headers[] = 'X-Forwarded-For: ' . client_ip();
$headers[] = 'X-Forwarded-Proto: ' . ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
$headers[] = 'Accept-Encoding: identity';

$body = null;
if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY);
    if ($raw !== false && $raw !== '') $body = $raw;
}

$respHeaders = [];
$statusCode = 200;

$ch = curl_init(upstream_url());
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HEADER         => false,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => CONNECT_TIMEOUT,
    CURLOPT_TIMEOUT        => 0,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_ENCODING       => '',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders, &$statusCode) {
        $len = strlen($line);
        $trim = trim($line);
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $trim, $m)) { $statusCode = (int)$m[1]; return $len; }
        if ($trim === '') return $len;
        $pos = strpos($trim, ':');
        if ($pos === false) return $len;
        $name = strtolower(trim(substr($trim, 0, $pos)));
        $value = trim(substr($trim, $pos + 1));
        if (in_array($name, ['connection', 'transfer-encoding', 'content-length', 'content-encoding'], true)) return $len;
        if ($name === 'set-cookie') {
            /* کوکی سایت اصلی نباید به دامنهٔ اصلی بچسبد؛ دامنه حذف می‌شود */
            $value = preg_replace('/;\s*domain=[^;]*/i', '', $value);
            $respHeaders[] = 'Set-Cookie: ' . $value;
            return $len;
        }
        if ($name === 'location') {
            $value = preg_replace('#^' . preg_quote(rtrim(UPSTREAM, '/'), '#') . '#', '', $value);
            if ($value === '') $value = '/';
        }
        $respHeaders[$name] = $value;
        return $len;
    },
    CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$respHeaders) {
        static $started = false;
        if (!$started) {
            $started = true;
            foreach ($respHeaders as $name => $value) {
                if (is_int($name)) header($value); else header($name . ': ' . $value, true);
            }
            /* آدرس مبدأ توکن‌های پخش/کوکی‌ها نباید لو برود */
            header_remove('X-Powered-By');
        }
        echo $chunk;
        @ob_flush();
        @flush();
        return strlen($chunk);
    },
]);

if (!empty($_SERVER['HTTP_RANGE'])) {
    curl_setopt($ch, CURLOPT_RANGE, preg_replace('/[^0-9\-,]/', '', (string)$_SERVER['HTTP_RANGE']));
}
if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
if ($method === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);

@set_time_limit(0);
while (ob_get_level() > 0) @ob_end_flush();
ignore_user_abort(false);

$ok = curl_exec($ch);
if ($ok === false) {
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 502;
    http_response_code($code >= 400 ? $code : 502);
    header('content-type: text/plain; charset=utf-8');
    header('cache-control: no-store');
    echo 'ارتباط با سرور اصلی برقرار نشد: ' . curl_error($ch);
} else {
    http_response_code($statusCode ?: 200);
}
curl_close($ch);
