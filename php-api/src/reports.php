<?php
// KlinikFlow - Financial & Visit Report Generation
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/lib/auth.php';

// PERBAIKAN F-05/F-10:
// - identitas diambil dari JWT yang diverifikasi (bukan header X-User-* yang bisa dipalsukan)
// - filter tidak lagi direfleksikan mentah ke HTML; output HTML di-escape
$user = kf_require_auth();
$clinicId = kf_clinic_id($user);
$isManagement = kf_is_management($user);

$filterQuery = (string) ($_GET['filter'] ?? $_GET['search'] ?? '');
$filterQuery = mb_substr($filterQuery, 0, 100);

$query = "SELECT i.*, p.full_name as patient_name, p.mrn, c.name as clinic_name, v.doctor_name, v.visit_date
          FROM invoices i
          JOIN patients p ON i.patient_id = p.id
          JOIN clinics c ON i.clinic_id = c.id
          JOIN visits v ON i.visit_id = v.id
          WHERE 1=1";
$params = [];

// Isolasi tenant: semua role dibatasi ke klini sendiri (admin pun hanya melihat
// klini yang diminta secara eksplisit lewat ?clinic_id=).
$query .= " AND i.clinic_id = ?";
$params[] = $clinicId;

if ($filterQuery !== '') {
    $query .= " AND (p.full_name LIKE ? OR i.invoice_number LIKE ?)";
    $params[] = "%$filterQuery%";
    $params[] = "%$filterQuery%";
}

$query .= " ORDER BY i.id DESC LIMIT 500";
$stmt = $pdo->prepare($query);
$stmt->execute($params);
$records = $stmt->fetchAll();

$summaryMessage = $filterQuery !== ''
    ? "Menampilkan arsip laporan transaksi untuk kata kunci: " . $filterQuery
    : "Menampilkan seluruh arsip laporan operasional klinik";

sendJson([
    'success' => true,
    'filter' => $filterQuery,
    // Field teks biasa untuk ditampilkan (FE wajib memakai interpolasi teks).
    'summary' => $summaryMessage,
    // Dipertahankan untuk kompatibilitas, tetapi sudah di-escape.
    'summary_html' => htmlspecialchars($summaryMessage, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
    'total_records' => count($records),
    'data' => $records
]);
