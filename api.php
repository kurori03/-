<?php
/*
 * 回送・納車依頼ボード — 社内サーバー（PHP版）
 *
 * index.html と同じフォルダに置くだけで動きます。
 * データは同じフォルダの data.json に保存されます。
 * このフォルダに書き込み権限が必要です。
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dataFile = __DIR__ . '/data.json';
$bakFile  = __DIR__ . '/data.bak.json';
$path     = isset($_GET['path']) ? (string)$_GET['path'] : '';
$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';

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
    echo json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$store = readStore($dataFile);

if ($path === 'state' && $method === 'GET') {
    respond($store);
}

if ($path === 'request' && $method === 'PUT') {
    $r = bodyJson();
    if (!isset($r['id']) || $r['id'] === '') fail('id がありません');
    $store['requests'][(string)$r['id']] = $r;
    respond(writeStore($dataFile, $bakFile, $store));
}

if ($path === 'request' && $method === 'DELETE') {
    $id = isset($_GET['id']) ? (string)$_GET['id'] : '';
    if ($id === '') fail('id がありません');
    unset($store['requests'][$id]);
    respond(writeStore($dataFile, $bakFile, $store));
}

if ($path === 'settings' && $method === 'PUT') {
    $b = bodyJson();
    if (!isset($b['staff']) || !is_array($b['staff'])) fail('staff がありません');
    $store['settings'] = ['staff' => $b['staff']];
    respond(writeStore($dataFile, $bakFile, $store));
}

fail('不明なAPIです', 404);
