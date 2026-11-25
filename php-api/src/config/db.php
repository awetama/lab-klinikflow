<?php
// KlinikFlow - Database Connection Configuration
$dbHost = getenv('DB_HOST') ?: 'mysql';
$dbPort = getenv('DB_PORT') ?: '3306';
$dbName = getenv('DB_NAME') ?: 'klinikflow_db';
$dbUser = getenv('DB_USER') ?: 'klinikflow_user';
$dbPass = getenv('DB_PASS') ?: 'klinikflow_pass';

try {
    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    // Detail teknis (host/user DB) hanya ke log server, bukan ke klien.
    error_log('[db] Koneksi database gagal: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json');
    header('X-Content-Type-Options: nosniff');
    echo json_encode([
        'success' => false,
        'error' => 'Layanan sedang tidak tersedia'
    ]);
    exit;
}

