<?php
// KlinikFlow - Insurance Claims Handler
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/lib/auth.php';

// PERBAIKAN F-05/F-07/F-08: identitas dari JWT (bukan header X-User-*),
// seluruh query dibatasi clinic_id, approval khusus manajemen & sekali pakai.
$user = kf_require_auth();
$clinicId = kf_clinic_id($user);
$isManagement = kf_is_management($user);

$action = $_GET['action'] ?? 'list';

switch ($action) {
    case 'list':
        handleListClaims($pdo, $clinicId);
        break;

    case 'approve':
        handleApproveClaim($pdo, $user, $clinicId, $isManagement);
        break;

    case 'detail':
        handleClaimDetail($pdo, $clinicId);
        break;

    default:
        sendError('Aksi klaim tidak valid', 404);
}

function handleListClaims(PDO $pdo, int $clinicId): void
{
    $query = "SELECT c.*, cl.name as clinic_name, i.invoice_number, p.full_name as patient_name
              FROM claims c
              JOIN clinics cl ON c.clinic_id = cl.id
              JOIN invoices i ON c.invoice_id = i.id
              JOIN patients p ON i.patient_id = p.id
              WHERE c.clinic_id = ?
              ORDER BY c.id DESC
              LIMIT 500";
    $stmt = $pdo->prepare($query);
    $stmt->execute([$clinicId]);

    sendJson([
        'success' => true,
        'data' => $stmt->fetchAll()
    ]);
}

function handleClaimDetail(PDO $pdo, int $clinicId): void
{
    $claimId = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
    if ($claimId === false || $claimId === null || $claimId <= 0) {
        sendError('Parameter id klaim diperlukan', 400);
    }

    // clinic_id ikut di WHERE: klaim milik klini lain tidak bisa diintip.
    $stmt = $pdo->prepare("SELECT c.*, cl.name as clinic_name, i.invoice_number, p.full_name as patient_name
                           FROM claims c
                           JOIN clinics cl ON c.clinic_id = cl.id
                           JOIN invoices i ON c.invoice_id = i.id
                           JOIN patients p ON i.patient_id = p.id
                           WHERE c.id = ? AND c.clinic_id = ?");
    $stmt->execute([$claimId, $clinicId]);
    $claim = $stmt->fetch();

    if (!$claim) {
        sendError('Data klaim tidak ditemukan', 404);
    }

    $attStmt = $pdo->prepare("SELECT * FROM claim_attachments WHERE claim_id = ?");
    $attStmt->execute([$claimId]);
    $claim['attachments'] = $attStmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $claim
    ]);
}

function handleApproveClaim(PDO $pdo, array $user, int $clinicId, bool $isManagement): void
{
    if (!$isManagement) {
        sendError('Akses ditolak: hanya admin atau manager yang dapat menyetujui klaim', 403);
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        $input = $_POST;
    }
    $claimId = filter_var($input['claim_id'] ?? $_GET['claim_id'] ?? null, FILTER_VALIDATE_INT);
    if ($claimId === false || $claimId === null || $claimId <= 0) {
        sendError('Parameter claim_id wajib disertakan', 400);
    }

    $pdo->beginTransaction();
    try {
        // Kunci baris klaim agar tidak bisa di-approve ganda secara bersamaan.
        $stmt = $pdo->prepare("SELECT * FROM claims WHERE id = ? AND clinic_id = ? FOR UPDATE");
        $stmt->execute([$claimId, $clinicId]);
        $claim = $stmt->fetch();

        if (!$claim) {
            $pdo->rollBack();
            sendError('Klaim tidak ditemukan', 404);
        }
        if ($claim['status'] !== 'submitted') {
            $pdo->rollBack();
            sendError("Klaim berstatus '{$claim['status']}' tidak dapat disetujui", 409);
        }

        $updateStmt = $pdo->prepare("UPDATE claims SET status = 'approved', approved_at = NOW() WHERE id = ? AND status = 'submitted'");
        $updateStmt->execute([$claimId]);
        if ($updateStmt->rowCount() !== 1) {
            $pdo->rollBack();
            sendError('Klaim sudah diproses oleh permintaan lain', 409);
        }

        $invStmt = $pdo->prepare("UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ? AND clinic_id = ?");
        $invStmt->execute([$claim['invoice_id'], $clinicId]);

        // Jejak audit (abaikan bila tabel belum diterapkan pada database lama).
        try {
            $audit = $pdo->prepare("INSERT INTO audit_logs (clinic_id, user_id, action, entity, entity_id, detail)
                                    VALUES (?, ?, 'claim.approve', 'claims', ?, ?)");
            $audit->execute([
                $clinicId,
                (int) $user['id'],
                (string) $claimId,
                json_encode(['amount' => $claim['amount'], 'previous_status' => $claim['status']]),
            ]);
        } catch (Throwable $auditError) {
            error_log('[audit] gagal mencatat approval klaim: ' . $auditError->getMessage());
        }

        $pdo->commit();

        sendJson([
            'success' => true,
            'message' => "Klaim {$claim['claim_number']} berhasil disetujui untuk pencairan Rp " . number_format((float) $claim['amount'], 0, ',', '.'),
            'claim_id' => $claimId,
            'claim_number' => $claim['claim_number'],
            'amount' => floatval($claim['amount']),
            'previous_status' => $claim['status'],
            'current_status' => 'approved'
        ]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[claims] approval gagal: ' . $e->getMessage());
        sendError('Gagal memproses approval klaim', 500);
    }
}
