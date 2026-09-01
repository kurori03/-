<?php
/*
 * 回送・納車依頼ボード — 社内サーバー（PHP版）
 *
 * index.html と同じフォルダに置くだけで動きます。
 * データは同じフォルダの data.json に保存されます。
 * このフォルダに書き込み権限が必要です。
 */
declare(strict_types=1);

/* =========================================================
 *  管理者の設定  ここを書き換えれば管理者とパスワードを変更できます
 * ========================================================= */
const ADMIN_PASSWORD = 'suzuki01';                                  // 管理者共通のパスワード
const ADMIN_NAMES    = ['黒田', '稲垣', '深沢', '岩田', '野口'];      // 管理者として承認できる人
const TOKEN_DAYS     = 30;                                          // ログインを保持する日数
/* ======================================================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dataFile = __DIR__ . '/data.json';
$bakFile  = __DIR__ . '/data.bak.json';
$path     = isset($_GET['path']) ? (string)$_GET['path'] : '';
$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ---------- 管理者の認証 ---------- */
function secretKey(): string {
    return hash('sha256', 'dispatch-board|' . ADMIN_PASSWORD);
}
function b64u(string $s): string {
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}
function b64ud(string $s): string {
    $r = base64_decode(strtr($s, '-_', '+/'), true);
    return $r === false ? '' : $r;
}
function makeToken(string $name): string {
    $payload = b64u((string)json_encode(
        ['n' => $name, 'e' => (time() + TOKEN_DAYS * 86400) * 1000],
        JSON_UNESCAPED_UNICODE
    ));
    return $payload . '.' . hash_hmac('sha256', $payload, secretKey());
}
function tokenName(string $token): ?string {
    if ($token === '' || strpos($token, '.') === false) return null;
    [$payload, $sig] = explode('.', $token, 2);
    if (!hash_equals(hash_hmac('sha256', $payload, secretKey()), $sig)) return null;
    $j = json_decode(b64ud($payload), true);
    if (!is_array($j) || !isset($j['n'], $j['e'])) return null;
    if ((int)$j['e'] < time() * 1000) return null;                 // 期限切れ
    if (!in_array($j['n'], ADMIN_NAMES, true)) return null;        // 管理者から外された
    return (string)$j['n'];
}
function requireAdmin(): string {
    $token = (string)($_SERVER['HTTP_X_AUTH'] ?? '');
    $name  = tokenName($token);
    if ($name === null)
        fail('この操作には管理者のパスワードが必要です。右上の「自分の情報」から入力してください。', 401);
    return $name;
}

function fail(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function readStore(string $file): array {
    $empty = ['version' => 0, 'settings' => null, 'requests' => []];
    if (!is_file($file)) return $empty;
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return $empty;
    $j = json_decode($raw, true);
    if (!is_array($j)) return $empty;
    return [
        'version'  => isset($j['version']) ? (int)$j['version'] : 0,
        'settings' => (isset($j['settings']['staff']) && is_array($j['settings']['staff'])) ? $j['settings'] : null,
        'requests' => (isset($j['requests']) && is_array($j['requests'])) ? $j['requests'] : [],
    ];
}

function writeStore(string $file, string $bak, array $store): array {
    $store['version'] = ((int)$store['version']) + 1;
    if (empty($store['requests'])) $store['requests'] = new stdClass();
    $json = json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) fail('データを保存できませんでした（変換エラー）', 500);
    if (is_file($file)) @copy($file, $bak);
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false)
        fail('データを保存できませんでした。フォルダの書き込み権限を確認してください。', 500);
    if (!@rename($tmp, $file))
        fail('データを保存できませんでした（置き換えに失敗）', 500);
    return $store;
}

function bodyJson(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') fail('本文がありません');
    if (strlen($raw) > 524288) fail('データが大きすぎます');
    $j = json_decode($raw, true);
    if (!is_array($j)) fail('本文の形式が正しくありません');
    return $j;
}

function respond(array $store): void {
    if (empty($store['requests'])) $store['requests'] = new stdClass();
    $store['admins'] = ADMIN_NAMES;   // 画面の案内に使うだけ（パスワードは送りません）
    echo json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($path === 'login' && $method === 'POST') {
    $b    = bodyJson();
    $name = trim((string)($b['name'] ?? ''));
    $pw   = (string)($b['password'] ?? '');
    if (!in_array($name, ADMIN_NAMES, true)) {
        usleep(300000);
        fail('「' . $name . '」は管理者として登録されていません。登録名: ' . implode('・', ADMIN_NAMES), 403);
    }
    if (!hash_equals(ADMIN_PASSWORD, $pw)) {
        usleep(300000);
        fail('パスワードが違います。', 403);
    }
    echo json_encode(['token' => makeToken($name), 'name' => $name], JSON_UNESCAPED_UNICODE);
    exit;
}

$store = readStore($dataFile);

if ($path === 'state' && $method === 'GET') {
    respond($store);
}

if ($path === 'request' && $method === 'PUT') {
    $r = bodyJson();
    if (!isset($r['id']) || $r['id'] === '') fail('id がありません');
    $status = (string)($r['status'] ?? '');
    if ($status === 'approved' || $status === 'rejected') requireAdmin();   // 承認・差戻しは管理者のみ
    $store['requests'][(string)$r['id']] = $r;
    respond(writeStore($dataFile, $bakFile, $store));
}

if ($path === 'request' && $method === 'DELETE') {
    requireAdmin();                                                        // 削除は管理者のみ
    $id = isset($_GET['id']) ? (string)$_GET['id'] : '';
    if ($id === '') fail('id がありません');
    unset($store['requests'][$id]);
    respond(writeStore($dataFile, $bakFile, $store));
}

if ($path === 'settings' && $method === 'PUT') {
    requireAdmin();                                                        // スタッフ設定の変更は管理者のみ
    $b = bodyJson();
    if (!isset($b['staff']) || !is_array($b['staff'])) fail('staff がありません');
    $store['settings'] = ['staff' => $b['staff']];
    respond(writeStore($dataFile, $bakFile, $store));
}

fail('不明なAPIです', 404);
