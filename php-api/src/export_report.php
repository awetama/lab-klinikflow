<?php
// KlinikFlow - Report Export (tanpa shell, input di-whitelist)
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/lib/auth.php';

// PERBAIKAN F-06: seluruh pemrosesan dilakukan di PHP. Tidak ada shell_exec(),
// exec(), system(), atau backtick — sehingga tidak ada command injection.
// Sebelumnya: shell_exec("echo ... " . $filter) dengan input mentah dari klien.

$user = kf_require_role(kf_require_auth(), KF_MANAGEMENT_ROLES);
$clinicId = kf_clinic_id($user);

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendError('Metode tidak didukung', 405);
}

$rawInput = file_get_contents('php://input');
$jsonInput = json_decode($rawInput, true);
if (!is_array($jsonInput)) {
    $jsonInput = [];
}

// Whitelist nilai: tidak ada string bebas yang masuk ke perintah/output mentah.
$allowedTypes = ['daily_financial', 'monthly_financial', 'visits', 'claims'];
$allowedFormats = ['csv', 'json'];

$reportType = $jsonInput['type'] ?? $_GET['type'] ?? 'daily_financial';
if (!in_array($reportType, $allowedTypes, true)) {
    sendError('Tipe laporan tidak dikenal', 400);
}

$format = $jsonInput['format'] ?? $_GET['format'] ?? 'csv';
if (!in_array($format, $allowedFormats, true)) {
    sendError('Format laporan tidak dikenal', 400);
}

// Filter hanya boleh teks pendek yang aman (dipakai sebagai parameter LIKE).
$filterRaw = (string) ($jsonInput['filter'] ?? $_GET['filter'] ?? '');
$filter = preg_replace('/[^\p{L}\p{N} \-_.@]/u', '', $filterRaw) ?? '';
$filter = mb_substr($filter, 0, 64);

$sql = "SELECT i.invoice_number, p.full_name AS patient_name, p.mrn,
               i.amount, i.status, i.issued_at, c.name AS clinic_name
        FROM invoices i
        JOIN patients p ON i.patient_id = p.id
        JOIN clinics c ON i.clinic_id = c.id
        WHERE i.clinic_id = ?";
$params = [$clinicId];

if ($filter !== '') {
    $sql .= " AND (p.full_name LIKE ? OR i.invoice_number LIKE ?)";
    $params[] = '%' . $filter . '%';
    $params[] = '%' . $filter . '%';
}

if ($reportType === 'daily_financial') {
    $sql .= " AND DATE(i.issued_at) = CURDATE()";
} elseif ($reportType === 'monthly_financial') {
    $sql .= " AND DATE_FORMAT(i.issued_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
}

$sql .= " ORDER BY i.id DESC LIMIT 1000";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$output = '';
if ($format === 'csv') {
    $output = "invoice_number,patient_name,mrn,amount,status,issued_at,clinic_name\n";
    foreach ($rows as $row) {
        $output .= implode(',', array_map(static function ($value) {
            $text = str_replace('"', '""', (string) $value);
            return '"' . $text . '"';
        }, [
            $row['invoice_number'],
            $row['patient_name'],
            $row['mrn'],
            $row['amount'],
            $row['status'],
            $row['issued_at'],
            $row['clinic_name'],
        ])) . "\n";
    }
} else {
    $output = json_encode($rows, JSON_UNESCAPED_UNICODE);
}

sendJson([
    'success' => true,
    'type' => $reportType,
    'format' => $format,
    'filter' => $filter,
    'rows' => count($rows),
    'generated_at' => date('Y-m-d H:i:s'),
    'output' => $output
]);
