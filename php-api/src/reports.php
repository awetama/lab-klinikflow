<?php
// KlinikFlow - Financial & Visit Report Generation
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-User-Role, X-Clinic-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$currentClinicId = $_SERVER['HTTP_X_CLINIC_ID'] ?? null;
$currentUserRole = $_SERVER['HTTP_X_USER_ROLE'] ?? 'staff';
$filterQuery = $_GET['filter'] ?? $_GET['search'] ?? '';

// Ambil ringkasan laporan tagihan dan kunjungan
$query = "SELECT i.*, p.full_name as patient_name, p.mrn, c.name as clinic_name, v.doctor_name, v.visit_date
          FROM invoices i
          JOIN patients p ON i.patient_id = p.id
          JOIN clinics c ON i.clinic_id = c.id
          JOIN visits v ON i.visit_id = v.id
          WHERE 1=1";
$params = [];

if ($currentUserRole !== 'admin' && !empty($currentClinicId)) {
    $query .= " AND i.clinic_id = ?";
    $params[] = $currentClinicId;
}

if (!empty($filterQuery)) {
    $query .= " AND (p.full_name LIKE ? OR i.invoice_number LIKE ?)";
    $params[] = "%$filterQuery%";
    $params[] = "%$filterQuery%";
}

$query .= " ORDER BY i.id DESC";
$stmt = $pdo->prepare($query);
$stmt->execute($params);
$records = $stmt->fetchAll();

$summaryMessage = !empty($filterQuery) 
    ? "Menampilkan arsip laporan transaksi untuk kata kunci: " . $filterQuery 
    : "Menampilkan seluruh arsip laporan operasional klinik";

sendJson([
    'success' => true,
    'filter' => $filterQuery,
    'summary_html' => $summaryMessage,
    'total_records' => count($records),
    'data' => $records
]);

