<?php
// Generic data API used by db.js.
//   GET  store.php?store=orders            -> all rows
//   GET  store.php?store=orders&key=ORD-1  -> one row (or null)
//   POST store.php?store=orders  {action:"put",    value:{...}}
//   POST store.php?store=orders  {action:"putAll", values:[...]}
//   POST store.php?store=orders  {action:"delete", key:"ORD-1"}
//   POST store.php?store=orders  {action:"clear"}
require_once __DIR__ . '/db.php';

// JS field => [column, type].  Fields not listed are kept in the "extra" JSON column.
const STORES = [
    'menuItems' => [
        'table' => 'menu_items', 'key' => 'id', 'extra' => true,
        'fields' => [
            'id' => ['id', 'str'], 'name' => ['name', 'str'], 'price' => ['price', 'num'],
            'cat' => ['category', 'str'], 'image' => ['image', 'str'],
            'maxDaily' => ['max_daily', 'int'], 'ingredients' => ['ingredients', 'json'],
        ],
    ],
    'inventory' => [
        'table' => 'inventory', 'key' => 'name', 'extra' => true,
        'fields' => [
            'name' => ['name', 'str'], 'category' => ['category', 'str'], 'stock' => ['stock', 'num'],
            'unit' => ['unit', 'str'], 'lowThreshold' => ['low_threshold', 'num'],
        ],
    ],
    'orders' => [
        'table' => 'orders', 'key' => 'id', 'extra' => true,
        'fields' => [
            'id' => ['id', 'str'], 'items' => ['items', 'json'],
            'subtotal' => ['subtotal', 'num'], 'tax' => ['tax', 'num'], 'total' => ['total', 'num'],
            'payment' => ['payment', 'json'], 'table' => ['table_label', 'str'],
            'orderType' => ['order_type', 'str'], 'cashier' => ['cashier', 'str'],
            'status' => ['status', 'str'], 'createdAt' => ['created_at', 'datetime'],
            'timeLabel' => ['time_label', 'str'],
        ],
    ],
    'approvals' => [
        'table' => 'approvals', 'key' => 'id', 'extra' => true,
        'fields' => [
            'id' => ['id', 'str'], 'type' => ['type', 'str'], 'ingredient' => ['ingredient', 'str'],
            'stock' => ['stock', 'num'], 'unit' => ['unit', 'str'], 'time' => ['time', 'str'],
            'status' => ['status', 'str'], 'approvedAt' => ['approved_at', 'str'],
        ],
    ],
    'meta' => [
        'table' => 'meta', 'key' => 'key', 'extra' => false,
        'fields' => ['key' => ['key', 'str'], 'value' => ['value', 'json']],
    ],
];

$storeName = $_GET['store'] ?? '';
if (!isset(STORES[$storeName])) json_out(['error' => 'Unknown store'], 400);
$S = STORES[$storeName];
$table = '`' . $S['table'] . '`';
$keyCol = '`' . $S['fields'][$S['key']][0] . '`';

function to_db(array $S, array $obj): array {
    $row = [];
    $extra = [];
    foreach ($obj as $field => $val) {
        if (!isset($S['fields'][$field])) { $extra[$field] = $val; continue; }
        [$col, $type] = $S['fields'][$field];
        if ($val === null) { $row[$col] = null; continue; }
        switch ($type) {
            case 'json':     $row[$col] = json_encode($val, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION); break;
            case 'num':      $row[$col] = (float)$val; break;
            case 'int':      $row[$col] = (int)$val; break;
            case 'datetime': $row[$col] = (new DateTime($val))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v'); break;
            default:         $row[$col] = (string)$val;
        }
    }
    if ($S['extra']) $row['extra'] = $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null;
    return $row;
}

function from_db(array $S, array $row): array {
    $obj = [];
    foreach ($S['fields'] as $field => [$col, $type]) {
        if (!array_key_exists($col, $row)) continue;
        $val = $row[$col];
        if ($val === null) { if ($type !== 'json') $obj[$field] = null; continue; }
        switch ($type) {
            case 'json':     $obj[$field] = json_decode($val, true); break;
            case 'num':      $obj[$field] = (float)$val; break;
            case 'int':      $obj[$field] = (int)$val; break;
            case 'datetime': $obj[$field] = (new DateTime($val, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); break;
            default:         $obj[$field] = $val;
        }
    }
    if ($S['extra'] && !empty($row['extra'])) {
        $extra = json_decode($row['extra'], true);
        if (is_array($extra)) $obj = $obj + $extra;
    }
    return $obj;
}

function upsert(PDO $pdo, string $table, array $S, array $obj): void {
    $row = to_db($S, $obj);
    $cols = array_keys($row);
    $quoted = array_map(fn($c) => "`$c`", $cols);
    $updates = array_map(fn($c) => "$c = VALUES($c)", $quoted);
    $sql = "INSERT INTO $table (" . implode(',', $quoted) . ') VALUES (' .
        implode(',', array_fill(0, count($cols), '?')) . ') ON DUPLICATE KEY UPDATE ' . implode(',', $updates);
    $pdo->prepare($sql)->execute(array_values($row));
}

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['key'])) {
        $stmt = $pdo->prepare("SELECT * FROM $table WHERE $keyCol = ?");
        $stmt->execute([$_GET['key']]);
        $row = $stmt->fetch();
        json_out($row ? from_db($S, $row) : null);
    }
    $rows = $pdo->query("SELECT * FROM $table")->fetchAll();
    json_out(array_map(fn($r) => from_db($S, $r), $rows));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['error' => 'Method not allowed'], 405);

$body = read_json_body() ?? [];
$action = $body['action'] ?? '';

switch ($action) {
    case 'put':
        if (!is_array($body['value'] ?? null)) json_out(['error' => 'Missing value'], 400);
        upsert($pdo, $table, $S, $body['value']);
        json_out(['ok' => true]);
    case 'putAll':
        if (!is_array($body['values'] ?? null)) json_out(['error' => 'Missing values'], 400);
        $pdo->beginTransaction();
        foreach ($body['values'] as $v) upsert($pdo, $table, $S, $v);
        $pdo->commit();
        json_out(['ok' => true]);
    case 'delete':
        $pdo->prepare("DELETE FROM $table WHERE $keyCol = ?")->execute([$body['key'] ?? '']);
        json_out(['ok' => true]);
    case 'clear':
        $pdo->exec("DELETE FROM $table");
        json_out(['ok' => true]);
    default:
        json_out(['error' => 'Unknown action'], 400);
}
