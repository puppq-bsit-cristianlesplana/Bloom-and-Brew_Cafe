<?php
require_once __DIR__ . '/config.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function json_out($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function read_json_body() {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return null;
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) json_out(['error' => 'Invalid JSON body'], 400);
    return $data;
}

set_exception_handler(function (Throwable $e) {
    error_log($e);
    $msg = $e instanceof PDOException
        ? 'Database error — is MySQL running and has database/schema.sql been imported?'
        : 'Server error';
    json_out(['error' => $msg, 'detail' => $e->getMessage()], 500);
});
