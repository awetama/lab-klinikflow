<?php
// KlinikFlow - Report Export & Document Processing Utility
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-User-Role, X-Clinic-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$rawInput = file_get_contents('php://input');
$jsonInput = json_decode($rawInput, true) ?: [];

$reportType = $jsonInput['type'] ?? $_REQUEST['type'] ?? 'daily_financial';
$format = $jsonInput['format'] ?? $_REQUEST['format'] ?? 'csv';
$filter = $jsonInput['filter'] ?? $_REQUEST['filter'] ?? 'all';

$cmd = "echo [REPORT EXPORT ENGINE] Tipe: " . $reportType . " Filter: " . $filter . " Format: " . $format;
$rawOutput = shell_exec($cmd);

sendJson([
    'success' => true,
    'type' => $reportType,
    'format' => $format,
    'filter' => $filter,
    'generated_at' => date('Y-m-d H:i:s'),
    'output' => trim($rawOutput)
]);

