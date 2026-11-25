# Perbaikan Modul `php-api` (Layanan Legacy)

Branch: `fix/php-api-injection` · Basis: `main@3c00cb0`

| Temuan | Perubahan | File |
|---|---|---|
| F-06 | `shell_exec()` dihapus; tipe/format laporan di-whitelist; ekspor dibangun di PHP | `src/export_report.php` |
| F-05 | Identitas dari JWT yang diverifikasi (HS256), bukan header `X-User-*` | `src/lib/jwt.php`, `src/lib/auth.php` |
| F-07 | Semua query klaim & lampiran dibatasi `clinic_id` | `src/claims.php`, `src/attachments.php` |
| F-08 | Approval klaim hanya `admin`/`manager`, status harus `submitted`, transaksi `FOR UPDATE` | `src/claims.php` |
| F-10 | `filter` tidak lagi direfleksikan mentah; `summary_html` di-escape + field `summary` teks | `src/reports.php` |
| F-13 | Pesan exception PDO tidak lagi dikirim ke klien | `src/config/db.php` |
| F-21 | Header CORS wildcard dihapus (layanan internal, CORS ditangani gateway) | `src/index.php`, semua handler |
| F-12 | Catatan audit saat approval klaim | `src/claims.php` |

---

## 1. F-06 — Command injection / RCE dihapus

**Sebelum** (`src/export_report.php:15-23`)
```php
$rawInput = file_get_contents('php://input');
$jsonInput = json_decode($rawInput, true) ?: [];
$reportType = $jsonInput['type'] ?? $_REQUEST['type'] ?? 'daily_financial';
$filter = $jsonInput['filter'] ?? $_REQUEST['filter'] ?? 'all';
$cmd = "echo [REPORT EXPORT ENGINE] Tipe: " . $reportType . " Filter: " . $filter . " Format: " . $format;
$rawOutput = shell_exec($cmd);
```

**Sesudah**
```php
$user = kf_require_role(kf_require_auth(), KF_MANAGEMENT_ROLES);
$reportType = $jsonInput['type'] ?? 'daily_financial';
if (!in_array($reportType, ['daily_financial','monthly_financial','visits','claims'], true)) {
    sendError('Tipe laporan tidak dikenal', 400);
}
$filter = preg_replace('/[^\p{L}\p{N} \-_.@]/u', '', $filterRaw) ?? '';
...
$stmt = $pdo->prepare($sql);   // data dari DB, bukan dari string perintah
```

Tidak ada lagi `shell_exec`, `exec`, `system`, `passthru`, atau backtick di seluruh `php-api`.

**Verifikasi statis**
```
$ grep -rnE "shell_exec|exec\(|system\(|passthru|`" php-api/src
(tidak ada hasil)
```

**Ekspektasi PoC `03_rce_export.sh`**
- sebelum: respons memuat output `id`, `uname -a`, isi `/etc/hostname`
- sesudah: `{"success":false,"error":"Tipe laporan tidak dikenal"}` atau CSV laporan tanpa eksekusi shell

---

## 2. F-05 — Identitas dari JWT, bukan header yang bisa dipalsukan

**Sebelum** (`src/reports.php:15-16`, `claims.php:16-17`, `attachments.php:16`)
```php
$currentClinicId = $_SERVER['HTTP_X_CLINIC_ID'] ?? null;
$currentUserRole = $_SERVER['HTTP_X_USER_ROLE'] ?? 'staff';
```

**Sesudah** (`src/lib/jwt.php`, `src/lib/auth.php`)
```php
$user = kf_require_auth();          // verifikasi HS256 + exp
$clinicId = kf_clinic_id($user);    // dari klaim JWT, bukan header
$isManagement = kf_is_management($user);
```

`bun-api` meneruskan header `Authorization` asli (lihat PR bun-api), sehingga klaim
`role`/`clinic_id` tidak bisa dipalsukan meski penyerang bisa menjangkau `php-api` langsung.

---

## 3. F-07 — Isolasi tenant pada klaim & lampiran

**Sebelum**
```php
// detail klaim
WHERE c.id = ?                       // UUID/ID apa pun bisa dibaca
// daftar lampiran
$pdo->query("SELECT ... FROM claim_attachments ...")   // tanpa filter klini
```

**Sesudah**
```php
WHERE c.id = ? AND c.clinic_id = ?
...
WHERE a.attachment_uuid = ? AND c.clinic_id = ?
```
Daftar lampiran juga dibatasi `c.clinic_id = ?` + `LIMIT 500`.

---

## 4. F-08 — Approval klaim: role, status, dan idempotensi

**Sebelum** (`src/claims.php:91-123`): siapa pun bisa approve; status tidak diperiksa;
invoice langsung ditandai `paid`.

**Sesudah**
```php
if (!$isManagement) sendError('Akses ditolak: hanya admin atau manager ...', 403);
$stmt = $pdo->prepare("SELECT * FROM claims WHERE id = ? AND clinic_id = ? FOR UPDATE");
if ($claim['status'] !== 'submitted') sendError("Klaim berstatus '{$claim['status']}' tidak dapat disetujui", 409);
```
Approval kedua atas klaim yang sama akan ditolak `409`.

---

## 5. F-10 — Reflected XSS pada ringkasan laporan

**Sebelum**
```php
$summaryMessage = "Menampilkan arsip laporan transaksi untuk kata kunci: " . $filterQuery;
sendJson(['summary_html' => $summaryMessage, ...]);
```

**Sesudah**
```php
'summary' => $summaryMessage,                                                  // teks biasa
'summary_html' => htmlspecialchars($summaryMessage, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
```
Frontend (branch `fix/web-xss`) berhenti memakai `v-html`, sehingga payload dirender sebagai teks.

---

## 6. Bukti pengujian yang dijalankan

**Lint seluruh berkas PHP**
```
$ php -l <setiap file php-api/src/**.php>
No syntax errors detected in ... (9 berkas)
```

**Uji unit verifikasi JWT** (`php-api/tests/jwt_verify_test.php`, tanpa Docker/MySQL)
```
token sah                        PASS
signature salah ditolak          PASS
alg=none ditolak                 PASS
token kedaluwarsa ditolak        PASS
tanpa Authorization ditolak      PASS
tanpa clinic_id ditolak          PASS

Semua uji lulus
```

---

## 7. Catatan merge

PR ini mengubah kontrak internal: `php-api` **mewajibkan** header `Authorization` berisi JWT
yang valid. Gateway pada branch `fix/bun-api-access-control` sudah meneruskannya.
Merge berurutan: **bun-api → php-api** (jika php-api di-merge duluan, seluruh panggilan
laporan/klaim akan 401 sampai PR bun-api masuk).

Environment baru yang dipakai: `JWT_SECRET` (wajib, ≥32 karakter, sama dengan bun-api).
