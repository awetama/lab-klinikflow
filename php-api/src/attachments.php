<?php
// KlinikFlow - Claim Attachment & Document Service
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-User-Role, X-Clinic-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? 'get';
$currentClinicId = $_SERVER['HTTP_X_CLINIC_ID'] ?? null;

switch ($action) {
    case 'get':
        handleGetAttachment($pdo);
        break;

    case 'list':
        handleListAttachments($pdo);
        break;

    default:
        sendError('Aksi lampiran tidak valid', 404);
}

function handleGetAttachment($pdo) {
    $uuid = $_GET['uuid'] ?? null;
    if (!$uuid) {
        sendError('Parameter attachment uuid diperlukan', 400);
    }

    $stmt = $pdo->prepare("SELECT a.*, c.claim_number, c.insurance_name, c.amount as claim_amount, c.clinic_id, cl.name as clinic_name
                           FROM claim_attachments a
                           JOIN claims c ON a.claim_id = c.id
                           JOIN clinics cl ON c.clinic_id = cl.id
                           WHERE a.attachment_uuid = ?");
    $stmt->execute([$uuid]);
    $attachment = $stmt->fetch();

    if (!$attachment) {
        sendError('Dokumen lampiran tidak ditemukan', 404);
    }

    sendJson([
        'success' => true,
        'data' => $attachment
    ]);
}

function handleListAttachments($pdo) {
    $stmt = $pdo->query("SELECT a.id, a.attachment_uuid, a.file_name, a.file_type, a.uploaded_at, c.claim_number, cl.name as clinic_name
                         FROM claim_attachments a
                         JOIN claims c ON a.claim_id = c.id
                         JOIN clinics cl ON c.clinic_id = cl.id
                         ORDER BY a.id ASC");
    $attachments = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $attachments
    ]);
}

