<?php
// KlinikFlow - Insurance Claims Handler
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-User-Role, X-Clinic-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? 'list';
$currentClinicId = $_SERVER['HTTP_X_CLINIC_ID'] ?? null;
$currentUserRole = $_SERVER['HTTP_X_USER_ROLE'] ?? 'staff';

switch ($action) {
    case 'list':
        handleListClaims($pdo, $currentClinicId, $currentUserRole);
        break;

    case 'approve':
        handleApproveClaim($pdo);
        break;

    case 'detail':
        handleClaimDetail($pdo);
        break;

    default:
        sendError('Aksi klaim tidak valid', 404);
}

function handleListClaims($pdo, $clinicId, $role) {
    $query = "SELECT c.*, cl.name as clinic_name, i.invoice_number, p.full_name as patient_name
              FROM claims c
              JOIN clinics cl ON c.clinic_id = cl.id
              JOIN invoices i ON c.invoice_id = i.id
              JOIN patients p ON i.patient_id = p.id
              WHERE 1=1";
    $params = [];

    if ($role !== 'admin' && !empty($clinicId)) {
        $query .= " AND c.clinic_id = ?";
        $params[] = $clinicId;
    }

    $query .= " ORDER BY c.id DESC";
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $claims = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $claims
    ]);
}

function handleClaimDetail($pdo) {
    $claimId = $_GET['id'] ?? null;
    if (!$claimId) {
        sendError('Parameter id klaim diperlukan', 400);
    }

    $stmt = $pdo->prepare("SELECT c.*, cl.name as clinic_name, i.invoice_number, p.full_name as patient_name
                           FROM claims c
                           JOIN clinics cl ON c.clinic_id = cl.id
                           JOIN invoices i ON c.invoice_id = i.id
                           JOIN patients p ON i.patient_id = p.id
                           WHERE c.id = ?");
    $stmt->execute([$claimId]);
    $claim = $stmt->fetch();

    if (!$claim) {
        sendError('Data klaim tidak ditemukan', 404);
    }

    // Ambil lampiran berkas klaim
    $attStmt = $pdo->prepare("SELECT * FROM claim_attachments WHERE claim_id = ?");
    $attStmt->execute([$claimId]);
    $claim['attachments'] = $attStmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $claim
    ]);
}

function handleApproveClaim($pdo) {
    $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $claimId = $input['claim_id'] ?? $_GET['claim_id'] ?? null;

    if (!$claimId) {
        sendError('Parameter claim_id wajib disertakan', 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM claims WHERE id = ?");
    $stmt->execute([$claimId]);
    $claim = $stmt->fetch();

    if (!$claim) {
        sendError('Klaim tidak ditemukan', 404);
    }

    $updateStmt = $pdo->prepare("UPDATE claims SET status = 'approved', approved_at = NOW() WHERE id = ?");
    $updateStmt->execute([$claimId]);

    // Update status invoice terkait
    $invStmt = $pdo->prepare("UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ?");
    $invStmt->execute([$claim['invoice_id']]);

    sendJson([
        'success' => true,
        'message' => "Klaim {$claim['claim_number']} berhasil disetujui untuk pencairan Rp " . number_format($claim['amount'], 0, ',', '.'),
        'claim_id' => $claimId,
        'claim_number' => $claim['claim_number'],
        'amount' => floatval($claim['amount']),
        'previous_status' => $claim['status'],
        'current_status' => 'approved'
    ]);
}

