<?php
// KlinikFlow - Claim Attachment & Document Service
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/lib/auth.php';

// PERBAIKAN F-05/F-07: identitas dari JWT dan semua query dibatasi clinic_id,
// sehingga lampiran klaim klini lain tidak bisa diakses lewat UUID.
$user = kf_require_auth();
$clinicId = kf_clinic_id($user);

$action = $_GET['action'] ?? 'get';

switch ($action) {
    case 'get':
        handleGetAttachment($pdo, $clinicId);
        break;

    case 'list':
        handleListAttachments($pdo, $clinicId);
        break;

    default:
        sendError('Aksi lampiran tidak valid', 404);
}

function handleGetAttachment(PDO $pdo, int $clinicId): void
{
    $uuid = $_GET['uuid'] ?? null;
    if (!is_string($uuid) || !preg_match('/^[A-Za-z0-9\-_]{1,64}$/', $uuid)) {
        sendError('Parameter attachment uuid diperlukan', 400);
    }

    $stmt = $pdo->prepare("SELECT a.*, c.claim_number, c.insurance_name, c.amount as claim_amount, c.clinic_id, cl.name as clinic_name
                           FROM claim_attachments a
                           JOIN claims c ON a.claim_id = c.id
                           JOIN clinics cl ON c.clinic_id = cl.id
                           WHERE a.attachment_uuid = ? AND c.clinic_id = ?");
    $stmt->execute([$uuid, $clinicId]);
    $attachment = $stmt->fetch();

    if (!$attachment) {
        sendError('Dokumen lampiran tidak ditemukan', 404);
    }

    sendJson([
        'success' => true,
        'data' => $attachment
    ]);
}

function handleListAttachments(PDO $pdo, int $clinicId): void
{
    $stmt = $pdo->prepare("SELECT a.id, a.attachment_uuid, a.file_name, a.file_type, a.uploaded_at, c.claim_number, cl.name as clinic_name
                           FROM claim_attachments a
                           JOIN claims c ON a.claim_id = c.id
                           JOIN clinics cl ON c.clinic_id = cl.id
                           WHERE c.clinic_id = ?
                           ORDER BY a.id ASC
                           LIMIT 500");
    $stmt->execute([$clinicId]);

    sendJson([
        'success' => true,
        'data' => $stmt->fetchAll()
    ]);
}
