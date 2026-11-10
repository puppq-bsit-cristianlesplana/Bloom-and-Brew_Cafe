<?php
// Data API used by db.js. Maps the app's objects onto the normalized (3NF)
// MySQL tables in database/schema.sql.
//
//   GET  store.php?store=orders            -> all records
//   GET  store.php?store=orders&key=ORD-1  -> one record (or null)
//   POST store.php?store=orders  {action:"put",    value:{...}}
//   POST store.php?store=orders  {action:"putAll", values:[...]}
//   POST store.php?store=orders  {action:"delete", key:"ORD-1"}
//   POST store.php?store=orders  {action:"clear"}
//
// Stores: menuItems, inventory, orders, approvals, meta
require_once __DIR__ . '/db.php';

// ===========================================================================
// Helpers
// ===========================================================================
function utc(): DateTimeZone { static $z; return $z ??= new DateTimeZone('UTC'); }
function local_tz(): DateTimeZone { static $z; return $z ??= new DateTimeZone(APP_TIMEZONE); }

/** ISO-8601 string from the browser -> 'Y-m-d H:i:s.v' in UTC for MySQL. */
function iso_to_db(?string $iso): ?string {
    if (!$iso) return null;
    return (new DateTime($iso))->setTimezone(utc())->format('Y-m-d H:i:s.v');
}

/** MySQL UTC datetime -> ISO-8601 string for the browser. */
function db_to_iso(?string $dt): ?string {
    if (!$dt) return null;
    return (new DateTime($dt, utc()))->format('Y-m-d\TH:i:s.v\Z');
}

/** MySQL UTC datetime -> display string in the cafe's local time. */
function db_to_local(?string $dt, string $format): ?string {
    if (!$dt) return null;
    return (new DateTime($dt, utc()))->setTimezone(local_tz())->format($format);
}

/** Returns the id of a lookup-table row, inserting it if new. */
function lookup_id(PDO $pdo, string $table, string $name): int {
    $name = trim($name) === '' ? 'Uncategorized' : trim($name);
    $pdo->prepare("INSERT IGNORE INTO $table (name) VALUES (?)")->execute([$name]);
    $stmt = $pdo->prepare("SELECT category_id FROM $table WHERE name = ?");
    $stmt->execute([$name]);
    return (int)$stmt->fetchColumn();
}

function ingredient_id(PDO $pdo, string $name): int {
    $stmt = $pdo->prepare('SELECT ingredient_id FROM ingredients WHERE name = ?');
    $stmt->execute([$name]);
    $id = $stmt->fetchColumn();
    if ($id === false) throw new RuntimeException("Unknown ingredient: $name");
    return (int)$id;
}

function user_id(PDO $pdo, ?string $username): ?int {
    if (!$username) return null;
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE username = ?');
    $stmt->execute([strtolower($username)]);
    $id = $stmt->fetchColumn();
    return $id === false ? null : (int)$id;
}

/** Same id format db.js uses: "alert-" + name with spaces -> "_", lower-cased. */
function alert_key(string $ingredientName): string {
    return 'alert-' . strtolower(preg_replace('/\s+/', '_', $ingredientName));
}

function num($v): float { return round((float)$v, 3); }

// ===========================================================================
// menuItems  <->  menu_items + menu_categories + menu_item_ingredients
// ===========================================================================
function menu_read(PDO $pdo, ?string $key): array {
    $sql = 'SELECT m.menu_item_id, m.name, m.price, c.name AS category, m.image_path, m.max_daily
            FROM menu_items m JOIN menu_categories c ON c.category_id = m.category_id';
    $params = [];
    if ($key !== null) { $sql .= ' WHERE m.menu_item_id = ?'; $params[] = $key; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $items = [];
    foreach ($stmt as $r) {
        $items[$r['menu_item_id']] = [
            'id' => $r['menu_item_id'], 'name' => $r['name'], 'price' => (float)$r['price'],
            'cat' => $r['category'], 'image' => $r['image_path'], 'maxDaily' => (int)$r['max_daily'],
            'ingredients' => [],
        ];
    }
    if (!$items) return [];

    $in = implode(',', array_fill(0, count($items), '?'));
    $stmt = $pdo->prepare("SELECT mi.menu_item_id, i.name, mi.qty_used
                           FROM menu_item_ingredients mi JOIN ingredients i ON i.ingredient_id = mi.ingredient_id
                           WHERE mi.menu_item_id IN ($in) ORDER BY i.ingredient_id");
    $stmt->execute(array_keys($items));
    foreach ($stmt as $r) {
        $items[$r['menu_item_id']]['ingredients'][] = ['name' => $r['name'], 'use' => num($r['qty_used'])];
    }
    return array_values($items);
}

function menu_write(PDO $pdo, array $v): void {
    $catId = lookup_id($pdo, 'menu_categories', (string)($v['cat'] ?? ''));
    $pdo->prepare('INSERT INTO menu_items (menu_item_id, name, price, category_id, image_path, max_daily)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), category_id = VALUES(category_id),
                                           image_path = VALUES(image_path), max_daily = VALUES(max_daily)')
        ->execute([$v['id'], $v['name'], (float)$v['price'], $catId, $v['image'] ?? null, (int)($v['maxDaily'] ?? 0)]);

    // Replace the recipe rows
    $pdo->prepare('DELETE FROM menu_item_ingredients WHERE menu_item_id = ?')->execute([$v['id']]);
    $ins = $pdo->prepare('INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, qty_used) VALUES (?, ?, ?)
                          ON DUPLICATE KEY UPDATE qty_used = qty_used + VALUES(qty_used)');
    foreach ($v['ingredients'] ?? [] as $ing) {
        $ins->execute([$v['id'], ingredient_id($pdo, $ing['name']), (float)$ing['use']]);
    }
}

// ===========================================================================
// inventory  <->  ingredients + ingredient_categories
// ===========================================================================
function inventory_read(PDO $pdo, ?string $key): array {
    $sql = 'SELECT i.name, c.name AS category, i.stock, i.unit, i.low_threshold
            FROM ingredients i JOIN ingredient_categories c ON c.category_id = i.category_id';
    $params = [];
    if ($key !== null) { $sql .= ' WHERE i.name = ?'; $params[] = $key; }
    $sql .= ' ORDER BY i.ingredient_id';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return array_map(fn($r) => [
        'name' => $r['name'], 'category' => $r['category'], 'stock' => num($r['stock']),
        'unit' => $r['unit'], 'lowThreshold' => num($r['low_threshold']),
    ], $stmt->fetchAll());
}

function inventory_write(PDO $pdo, array $v): void {
    $catId = lookup_id($pdo, 'ingredient_categories', (string)($v['category'] ?? ''));
    $pdo->prepare('INSERT INTO ingredients (name, category_id, stock, unit, low_threshold) VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), stock = VALUES(stock),
                                           unit = VALUES(unit), low_threshold = VALUES(low_threshold)')
        ->execute([$v['name'], $catId, max(0, (float)$v['stock']), (string)$v['unit'], (float)($v['lowThreshold'] ?? 0)]);
}

// ===========================================================================
// orders  <->  orders + order_items + payments + users  (totals are derived)
// ===========================================================================
function orders_read(PDO $pdo, ?string $key): array {
    $sql = 'SELECT o.order_id, o.order_type, o.table_label, o.status, o.tax_amount, o.created_at,
                   u.username, u.full_name, t.subtotal, t.total, t.method, t.amount_tendered, t.change_given
            FROM orders o
            JOIN v_order_totals t ON t.order_id = o.order_id
            LEFT JOIN users u ON u.user_id = o.user_id';
    $params = [];
    if ($key !== null) { $sql .= ' WHERE o.order_id = ?'; $params[] = $key; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $orders = [];
    foreach ($stmt as $r) {
        $orders[$r['order_id']] = [
            'id' => $r['order_id'],
            'items' => [],
            'subtotal' => (float)$r['subtotal'],
            'tax' => (float)$r['tax_amount'],
            'total' => (float)$r['total'],
            'payment' => $r['method'] === null ? null : [
                'method' => $r['method'],
                'tendered' => (float)$r['amount_tendered'],
                'change' => (float)$r['change_given'],
            ],
            'table' => $r['table_label'],
            'orderType' => $r['order_type'],
            'cashier' => $r['full_name'] ?? '',
            'cashierUsername' => $r['username'],
            'status' => $r['status'],
            'createdAt' => db_to_iso($r['created_at']),
            'timeLabel' => db_to_local($r['created_at'], 'g:i A'),
        ];
    }
    if (!$orders) return [];

    $in = implode(',', array_fill(0, count($orders), '?'));
    $stmt = $pdo->prepare("SELECT oi.order_id, oi.menu_item_id, oi.variant, oi.qty, oi.unit_price, m.name
                           FROM order_items oi JOIN menu_items m ON m.menu_item_id = oi.menu_item_id
                           WHERE oi.order_id IN ($in) ORDER BY oi.order_item_id");
    $stmt->execute(array_keys($orders));
    foreach ($stmt as $r) {
        $variant = $r['variant'];
        $orders[$r['order_id']]['items'][] = [
            'id' => $r['menu_item_id'] . ($variant ? '-' . strtolower($variant) : ''),
            'name' => $r['name'] . ($variant ? " ($variant)" : ''),
            'price' => (float)$r['unit_price'],
            'qty' => (int)$r['qty'],
        ];
    }
    return array_values($orders);
}

function orders_write(PDO $pdo, array $v): void {
    // Keep the existing cashier if this update doesn't name one (e.g. status changes)
    $userId = user_id($pdo, $v['cashierUsername'] ?? null);

    $pdo->prepare('INSERT INTO orders (order_id, user_id, order_type, table_label, status, tax_amount, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id),
                       order_type = VALUES(order_type), table_label = VALUES(table_label),
                       status = VALUES(status), tax_amount = VALUES(tax_amount), created_at = VALUES(created_at)')
        ->execute([
            $v['id'], $userId, $v['orderType'] ?? 'Dine In', $v['table'] ?? 'Walk-in',
            $v['status'] ?? 'sent_to_kitchen', round((float)($v['tax'] ?? 0), 2),
            iso_to_db($v['createdAt'] ?? null) ?? gmdate('Y-m-d H:i:s'),
        ]);

    // Replace the order lines
    $pdo->prepare('DELETE FROM order_items WHERE order_id = ?')->execute([$v['id']]);
    $ins = $pdo->prepare('INSERT INTO order_items (order_id, menu_item_id, variant, qty, unit_price) VALUES (?, ?, ?, ?, ?)');
    foreach ($v['items'] ?? [] as $line) {
        // Cart ids look like "m3" or "m3-iced" / "m3-hot"
        $variant = null;
        $menuId = $line['id'];
        if (preg_match('/^(.+)-(iced|hot)$/', $menuId, $m)) { $menuId = $m[1]; $variant = ucfirst($m[2]); }
        $ins->execute([$v['id'], $menuId, $variant, (int)$line['qty'], round((float)$line['price'], 2)]);
    }

    if (!empty($v['payment'])) {
        $p = $v['payment'];
        $pdo->prepare('INSERT INTO payments (order_id, method, amount_tendered) VALUES (?, ?, ?)
                       ON DUPLICATE KEY UPDATE method = VALUES(method), amount_tendered = VALUES(amount_tendered)')
            ->execute([$v['id'], $p['method'] ?? 'Cash', round((float)($p['tendered'] ?? 0), 2)]);
    }
}

// ===========================================================================
// approvals  <->  restock_approvals + ingredients + users  (type/unit derived)
// ===========================================================================
function approvals_read(PDO $pdo, ?string $key): array {
    $rows = $pdo->query('SELECT a.stock_at_alert, a.status, a.created_at, a.approved_at,
                                i.name AS ingredient, i.unit, u.full_name AS approved_by
                         FROM restock_approvals a
                         JOIN ingredients i ON i.ingredient_id = a.ingredient_id
                         LEFT JOIN users u ON u.user_id = a.approved_by
                         ORDER BY a.approval_id')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $id = alert_key($r['ingredient']);
        if ($key !== null && $id !== $key) continue;
        $stock = num($r['stock_at_alert']);
        $out[] = [
            'id' => $id,
            'type' => $stock <= 0 ? 'out' : 'low',
            'ingredient' => $r['ingredient'],
            'stock' => $stock,
            'unit' => $r['unit'],
            'createdAt' => db_to_iso($r['created_at']),
            'time' => db_to_local($r['created_at'], 'M j, Y, g:i A'),
            'status' => $r['status'],
            'approvedAt' => db_to_local($r['approved_at'], 'M j, g:i A'),
            'approvedBy' => $r['approved_by'],
        ];
    }
    return $out;
}

function approvals_write(PDO $pdo, array $v): void {
    $ingId = ingredient_id($pdo, (string)$v['ingredient']);
    $status = ($v['status'] ?? 'needed') === 'approved' ? 'approved' : 'needed';
    // approvedAtIso / approvedByUsername are only sent when the alert is being approved
    $approvedAt = $status === 'approved' ? iso_to_db($v['approvedAtIso'] ?? null) : null;
    $approvedBy = $status === 'approved' ? user_id($pdo, $v['approvedByUsername'] ?? null) : null;

    $pdo->prepare('INSERT INTO restock_approvals (ingredient_id, stock_at_alert, status, created_at, approved_by, approved_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE stock_at_alert = VALUES(stock_at_alert), status = VALUES(status),
                       created_at = VALUES(created_at),
                       approved_by = IF(VALUES(status) = \'approved\', COALESCE(VALUES(approved_by), approved_by), NULL),
                       approved_at = IF(VALUES(status) = \'approved\', COALESCE(VALUES(approved_at), approved_at), NULL)')
        ->execute([
            $ingId, num($v['stock'] ?? 0), $status,
            iso_to_db($v['createdAt'] ?? null) ?? gmdate('Y-m-d H:i:s'),
            $approvedBy, $approvedAt,
        ]);
}

// ===========================================================================
// meta  <->  settings
// ===========================================================================
function meta_read(PDO $pdo, ?string $key): array {
    $sql = 'SELECT setting_key, setting_value FROM settings';
    $params = [];
    if ($key !== null) { $sql .= ' WHERE setting_key = ?'; $params[] = $key; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return array_map(fn($r) => ['key' => $r['setting_key'], 'value' => json_decode($r['setting_value'], true)], $stmt->fetchAll());
}

function meta_write(PDO $pdo, array $v): void {
    if (is_array($v['value'] ?? null)) throw new RuntimeException('Settings must be single values');
    $pdo->prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)')
        ->execute([$v['key'], json_encode($v['value'] ?? null)]);
}

// ===========================================================================
// Store registry
// ===========================================================================
const STORES = [
    'menuItems' => ['read' => 'menu_read',      'write' => 'menu_write',      'table' => 'menu_items',        'key' => 'menu_item_id'],
    'inventory' => ['read' => 'inventory_read', 'write' => 'inventory_write', 'table' => 'ingredients',       'key' => 'name'],
    'orders'    => ['read' => 'orders_read',    'write' => 'orders_write',    'table' => 'orders',            'key' => 'order_id'],
    'approvals' => ['read' => 'approvals_read', 'write' => 'approvals_write', 'table' => 'restock_approvals', 'key' => null],
    'meta'      => ['read' => 'meta_read',      'write' => 'meta_write',      'table' => 'settings',          'key' => 'setting_key'],
];

$storeName = $_GET['store'] ?? '';
if (!isset(STORES[$storeName])) json_out(['error' => 'Unknown store'], 400);
$S = STORES[$storeName];
$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['key'])) {
        $rows = $S['read']($pdo, (string)$_GET['key']);
        json_out($rows[0] ?? null);
    }
    json_out($S['read']($pdo, null));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['error' => 'Method not allowed'], 405);

$body = read_json_body() ?? [];
$action = $body['action'] ?? '';

$pdo->beginTransaction();
switch ($action) {
    case 'put':
        if (!is_array($body['value'] ?? null)) json_out(['error' => 'Missing value'], 400);
        $S['write']($pdo, $body['value']);
        break;

    case 'putAll':
        if (!is_array($body['values'] ?? null)) json_out(['error' => 'Missing values'], 400);
        foreach ($body['values'] as $v) $S['write']($pdo, $v);
        break;

    case 'delete':
        $key = (string)($body['key'] ?? '');
        if ($storeName === 'approvals') {
            // Approval keys are derived from the ingredient name
            foreach ($pdo->query('SELECT a.approval_id, i.name FROM restock_approvals a
                                  JOIN ingredients i ON i.ingredient_id = a.ingredient_id') as $r) {
                if (alert_key($r['name']) === $key) {
                    $pdo->prepare('DELETE FROM restock_approvals WHERE approval_id = ?')->execute([$r['approval_id']]);
                }
            }
        } else {
            $pdo->prepare("DELETE FROM `{$S['table']}` WHERE `{$S['key']}` = ?")->execute([$key]);
        }
        break;

    case 'clear':
        // Child rows go with their parents through ON DELETE CASCADE
        $pdo->exec("DELETE FROM `{$S['table']}`");
        break;

    default:
        json_out(['error' => 'Unknown action'], 400);
}
$pdo->commit();
json_out(['ok' => true]);
