<?php
// POST {username, password} -> {user: {username, name, role}} or 401
require_once __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['error' => 'Method not allowed'], 405);

$body = read_json_body() ?? [];
$username = strtolower(trim((string)($body['username'] ?? '')));
$password = (string)($body['password'] ?? '');

if ($username === '' || $password === '') {
    json_out(['error' => 'Please enter your username and password.'], 400);
}

$stmt = db()->prepare('SELECT username, password_hash, full_name, role FROM users WHERE username = ?');
$stmt->execute([$username]);
$row = $stmt->fetch();

if (!$row || !password_verify($password, $row['password_hash'])) {
    json_out(['error' => 'Incorrect username or password.'], 401);
}

json_out(['user' => ['username' => $row['username'], 'name' => $row['full_name'], 'role' => $row['role']]]);
