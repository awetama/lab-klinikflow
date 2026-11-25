<?php
/**
 * Verifikasi JWT (HS256) tanpa dependensi eksternal.
 *
 * php-api sebelumnya menerima identitas dari header X-User-Id / X-User-Role /
 * X-Clinic-Id yang bisa dipalsukan siapa pun. Sekarang identitas diambil dari
 * JWT yang ditandatangani bun-api dengan JWT_SECRET yang sama.
 */

function kf_base64url_decode(string $value): string|false
{
    $remainder = strlen($value) % 4;
    if ($remainder) {
        $value .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($value, '-_', '+/'), true);
}

function kf_base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

/** Ambil token dari header Authorization: Bearer <token>. */
function kf_bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }
    if (!preg_match('/^Bearer\s+(.+)$/i', trim($header), $m)) {
        return null;
    }
    return trim($m[1]);
}

/**
 * Verifikasi tanda tangan + masa berlaku token.
 * Mengembalikan array payload, atau null bila tidak valid.
 */
function kf_verify_jwt(): ?array
{
    $secret = getenv('JWT_SECRET');
    if (!$secret || strlen($secret) < 32) {
        // Konfigurasi salah: jangan pernah fallback ke secret default.
        error_log('[auth] JWT_SECRET tidak di-set atau terlalu pendek');
        return null;
    }

    $token = kf_bearer_token();
    if (!$token) {
        return null;
    }

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }
    [$headerB64, $payloadB64, $signatureB64] = $parts;

    $headerJson = kf_base64url_decode($headerB64);
    $payloadJson = kf_base64url_decode($payloadB64);
    $signature = kf_base64url_decode($signatureB64);
    if ($headerJson === false || $payloadJson === false || $signature === false) {
        return null;
    }

    $header = json_decode($headerJson, true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256') {
        return null; // hanya HS256; tolak alg=none atau algoritma lain
    }

    $expected = hash_hmac('sha256', $headerB64 . '.' . $payloadB64, $secret, true);
    if (!hash_equals($expected, $signature)) {
        return null;
    }

    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        return null;
    }
    if (isset($payload['exp']) && time() >= (int) $payload['exp']) {
        return null;
    }
    if (empty($payload['id']) || empty($payload['clinic_id'])) {
        return null;
    }

    return $payload;
}
