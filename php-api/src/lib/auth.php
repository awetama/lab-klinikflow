<?php
/**
 * Helper otorisasi php-api.
 *
 * Aturan: identitas HANYA dari JWT yang diverifikasi; clinic_id selalu dari token
 * (kecuali role admin yang boleh menyebut clinic_id secara eksplisit).
 */

require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/../helpers/response.php';

const KF_MANAGEMENT_ROLES = ['admin', 'manager'];
const KF_ALL_ROLES = ['admin', 'manager', 'staff', 'cashier', 'patient'];

/** Kembalikan payload pengguna atau hentikan request dengan 401. */
function kf_require_auth(): array
{
    $payload = kf_verify_jwt();
    if ($payload === null) {
        sendError('Sesi tidak valid atau telah berakhir', 401);
    }
    return $payload;
}

/** Pastikan role pengguna termasuk daftar yang diizinkan, jika tidak 403. */
function kf_require_role(array $user, array $allowed): array
{
    if (!in_array($user['role'] ?? '', $allowed, true)) {
        sendError('Akses ditolak: role tidak memiliki izin untuk aksi ini', 403);
    }
    return $user;
}

/** clinic_id efektif: dari token, atau dari ?clinic_id= bila pemanggil admin. */
function kf_clinic_id(array $user): int
{
    $requested = $_GET['clinic_id'] ?? null;
    if (($user['role'] ?? '') === 'admin' && $requested !== null && $requested !== '') {
        $parsed = filter_var($requested, FILTER_VALIDATE_INT);
        if ($parsed === false || $parsed <= 0) {
            sendError('clinic_id tidak valid', 400);
        }
        return (int) $parsed;
    }
    return (int) $user['clinic_id'];
}

/** Pengguna dianggap manajemen bila role-nya admin/manager. */
function kf_is_management(array $user): bool
{
    return in_array($user['role'] ?? '', KF_MANAGEMENT_ROLES, true);
}
