<?php
/**
 * Uji unit verifikasi JWT php-api tanpa perlu Docker/MySQL.
 * Jalankan: php-api/tests/jwt_verify_test.php
 */

putenv('JWT_SECRET=0123456789abcdef0123456789abcdef'); // 32+ char, hanya untuk uji
require_once __DIR__ . '/../src/lib/jwt.php';

function b64url(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function make_token(array $payload, string $secret, string $alg = 'HS256', ?string $sigOverride = null): string
{
    $header = b64url(json_encode(['alg' => $alg, 'typ' => 'JWT']));
    $body = b64url(json_encode($payload));
    $signature = $sigOverride ?? b64url(hash_hmac('sha256', "$header.$body", $secret, true));
    return "$header.$body.$signature";
}

function verify_with(?string $token): ?array
{
    $_SERVER['HTTP_AUTHORIZATION'] = $token === null ? '' : "Bearer $token";
    return kf_verify_jwt();
}

$secret = getenv('JWT_SECRET');
$future = time() + 3600;
$cases = [];

// 1. Token sah
$cases[] = ['token sah', (bool) verify_with(make_token(['id' => 7, 'clinic_id' => 1, 'role' => 'admin', 'exp' => $future], $secret))];

// 2. Signature salah
$cases[] = ['signature salah ditolak', verify_with(make_token(['id' => 7, 'clinic_id' => 1, 'exp' => $future], 'secret-yang-salah-sekali-1234567890')) === null];

// 3. alg=none ditolak
$cases[] = ['alg=none ditolak', verify_with(make_token(['id' => 7, 'clinic_id' => 1, 'exp' => $future], $secret, 'none', '')) === null];

// 4. Token kedaluwarsa ditolak
$cases[] = ['token kedaluwarsa ditolak', verify_with(make_token(['id' => 7, 'clinic_id' => 1, 'exp' => time() - 10], $secret)) === null];

// 5. Tanpa header Authorization
$cases[] = ['tanpa Authorization ditolak', verify_with(null) === null];

// 6. Klaim wajib (clinic_id) hilang ditolak
$cases[] = ['tanpa clinic_id ditolak', verify_with(make_token(['id' => 7, 'exp' => $future], $secret)) === null];

$failed = 0;
foreach ($cases as [$name, $pass]) {
    printf("%-32s %s\n", $name, $pass ? 'PASS' : 'FAIL');
    if (!$pass) {
        $failed++;
    }
}

echo $failed === 0 ? "\nSemua uji lulus\n" : "\n$failed uji gagal\n";
exit($failed === 0 ? 0 : 1);
