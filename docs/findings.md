# Hasil Analisis Keamanan — KlinikFlow

Commit yang diaudit: `3c00cb0` (main). Metode: review kode manual + penelusuran alur data
(lihat `docs/threat-model.md`). Setiap temuan punya rujukan `file:line`, jalur eksploitasi,
dan nama branch perbaikannya.

| ID | Temuan | CWE | Severity | Modul |
|---|---|---|---|---|
| F-01 | `JWT_SECRET` punya fallback hardcoded | CWE-798 | Critical | bun-api |
| F-02 | IDOR perubahan tarif layanan | CWE-639 | High | bun-api |
| F-03 | Endpoint pasien/kunjungan/tagihan tanpa autentikasi | CWE-306 | High | bun-api |
| F-04 | Privilege escalation saat menerima undangan staf | CWE-269 | Critical | bun-api |
| F-05 | Identitas dari header `X-User-*` dipercaya mentah | CWE-290 | Critical | php-api |
| F-06 | RCE lewat `shell_exec()` pada ekspor laporan | CWE-78 | Critical | php-api |
| F-07 | BOLA pada detail klaim & lampiran | CWE-639 | High | php-api |
| F-08 | Approval klaim tanpa cek role / status | CWE-862 | High | php-api |
| F-09 | Stored XSS nama pasien (`v-html`) | CWE-79 | High | bun-api + web |
| F-10 | Reflected XSS `summary_html` laporan | CWE-79 | High | php-api + web |
| F-11 | Replay pembayaran & approval klaim | CWE-837 | Medium | bun-api + php-api |
| F-12 | Tidak ada audit trail aksi sensitif | CWE-778 | Medium | semua |
| F-13 | Pesan error membocorkan detail internal | CWE-209 | Medium | bun-api + php-api |
| F-14 | Login tanpa rate limit | CWE-307 | Medium | bun-api |
| F-15 | Endpoint daftar tanpa paginasi | CWE-770 | Low | bun-api |
| F-16 | Tidak ada CSP / security header | CWE-693 | Low | web |
| F-17 | Kredensial DB default & user DB berhak penuh | CWE-1392 | Medium | infra |
| F-18 | Password seed seragam `password123` | CWE-521 | Medium | database + web |
| F-19 | Identifier bisnis dari `Math.random()` | CWE-338 | Low | bun-api |
| F-20 | `node_modules/` & `dist/` ter-commit, tanpa `.gitignore` | CWE-1059 | Low | infra |
| F-21 | CORS `Access-Control-Allow-Origin: *` | CWE-942 | Medium | bun-api + php-api |
| F-22 | Daftar undangan staf dapat dibaca tanpa auth | CWE-306 | High | bun-api |

---

## Detail temuan

### F-01 — `JWT_SECRET` fallback hardcoded (Critical)

`bun-api/src/auth.ts:4`
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'klinikflow-super-secret-jwt-key-2026';
```
Bila env tidak di-set, secret jatuh ke nilai yang ada di repo. Penyerang bisa menandatangani
token sendiri dengan `role: "admin"` dan `clinic_id` mana pun.

**PoC**
```bash
node -e "console.log(require('jsonwebtoken').sign({id:1,clinic_id:1,role:'admin'},'klinikflow-super-secret-jwt-key-2026'))"
curl -s localhost:3000/api/dashboard/stats -H "Authorization: Bearer <token>"
```
**Perbaikan:** `fix/bun-api-access-control` — secret wajib dari env (min 32 char), verifikasi dipin ke `HS256`.

---

### F-02 — IDOR perubahan tarif (High)

`bun-api/src/services.ts:36-46` — `POST /api/services/fee` hanya memeriksa login, tidak memeriksa role
maupun `clinic_id` layanan.

**PoC** (token kasir)
```bash
curl -s -X POST localhost:3000/api/services/fee -H "Authorization: Bearer $KASIR" \
  -H 'Content-Type: application/json' -d '{"id":1,"fee":0}'
```
**Perbaikan:** role `admin|manager` + layanan harus milik klini pemanggil.

---

### F-03 — Endpoint tanpa autentikasi (High)

`bun-api/src/index.ts` (routing `/api/patients`, `/api/visits`, `/api/invoices`) tidak memanggil
`extractAuthUser`; handler di `patients.ts`, `visits.ts`, `invoices.ts` juga tidak.

**PoC**
```bash
curl -s localhost:3000/api/patients | jq '.data[0] | {full_name, mrn, phone, address}'
```
**Perbaikan:** guard auth global di gateway + scoping `clinic_id` di setiap query.

---

### F-04 — Privilege escalation undangan staf (Critical)

`bun-api/src/staff.ts:58`
```ts
const assignedRole = role || invitation.role || 'staff';
```
Role dari payload klien menang atas role undangan.

**PoC**
```bash
curl -s -X POST localhost:3000/api/staff/accept-invitation -H 'Content-Type: application/json' \
  -d '{"token":"<token undangan staff>","name":"x","password":"x","role":"admin"}'
```
**Perbaikan:** role **hanya** dari `invitation.role`; token undangan sekali pakai dalam transaksi.

---

### F-05 — Identitas dari header dipercaya mentah (Critical)

`php-api/src/reports.php:15-16`, `claims.php:16-17`, `attachments.php:16` membaca
`X-Clinic-Id`/`X-User-Role` tanpa verifikasi apa pun. Siapa pun yang bisa menjangkau `php-api`
(jaringan Docker atau port yang di-publish) bisa mengaku admin.

**PoC** (dari container lain di network yang sama)
```bash
curl -s "http://php-api/claims.php?action=list" -H 'X-User-Role: admin'
```
**Perbaikan:** verifikasi JWT `HS256` di PHP dari header `Authorization`, turunkan role/clinic dari klaim.

---

### F-06 — RCE `shell_exec()` (Critical)

`php-api/src/export_report.php:20-23`
```php
$cmd = "echo [REPORT EXPORT ENGINE] Tipe: " . $reportType . " Filter: " . $filter . " Format: " . $format;
$rawOutput = shell_exec($cmd);
```
Input `php://input` masuk langsung ke shell; `filter` memungkinkan `; id` / `$(...)`.

**PoC**
```bash
curl -s -X POST localhost:3000/api/reports/export -H 'Content-Type: application/json' \
  -d '{"filter":"; id; uname -a;"}'
```
**Perbaikan:** `shell_exec` dihapus total; nilai di-whitelist (`enum`) dan output dibangun di PHP.

---

### F-07 — BOLA klaim & lampiran (High)

`php-api/src/claims.php:60-100` (`handleClaimDetail`) dan `attachments.php:28-100`
(`handleGetAttachment`, `handleListAttachments`) tidak memfilter `clinic_id`.

**PoC**
```bash
curl -s "localhost:3000/api/attachments/<uuid-lampiran-klini-lain>"
```
**Perbaikan:** scoping `clinic_id` di semua query + filter pada daftar lampiran.

---

### F-08 — Approval klaim tanpa otorisasi (High)

`php-api/src/claims.php:103-140` — `handleApproveClaim` tidak memeriksa role dan tidak memeriksa
status klaim; klaim yang sudah `approved` dapat di-approve ulang dan invoice ikut ditandai `paid`.

**Perbaikan:** role `admin|manager`, tolak status selain `submitted`, catat `approved_by`.

---

### F-09 — Stored XSS nama pasien (High)

`bun-api/src/patients.ts:38` menyimpan `full_name` apa adanya; `web/src/views/Patients.vue:39`
merendernya dengan `v-html`.

**PoC**
```bash
curl -s -X POST localhost:3000/api/patients -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"full_name":"<img src=x onerror=alert(document.domain)>","birth_date":"2000-01-01","gender":"L","phone":"08"}'
```
**Perbaikan:** server memvalidasi panjang/karakter, FE memakai interpolasi teks (auto-escape).

---

### F-10 — Reflected XSS laporan (High)

`php-api/src/reports.php:44-50` mengembalikan `summary_html` yang dibangun dari `?filter=`,
lalu `web/src/views/Reports.vue:24` merendernya dengan `v-html`.

**PoC**
```bash
curl -s "localhost:3000/api/reports?filter=<img src=x onerror=alert(1)>" | jq -r .summary_html
```
**Perbaikan:** respons memakai field teks (`summary`) + `htmlspecialchars`, FE tidak lagi `v-html`.

---

### F-11 — Replay pembayaran & approval (Medium)

`bun-api/src/invoices.ts:54-100` tidak memeriksa `invoices.status`/nominal; `claims.php` tidak
memeriksa status klaim. Pembayaran/approval dapat diulang berkali-kali.

**Perbaikan:** transaksi `SELECT ... FOR UPDATE`, tolak invoice `paid`, validasi nominal ≤ sisa tagihan.

---

### F-12 — Tanpa audit trail (Medium)

Tidak ada pencatatan siapa mengubah tarif, memproses pembayaran, atau menyetujui klaim.

**Perbaikan:** tabel `audit_logs` + pencatatan pada aksi sensitif (lihat `database/03_audit.sql`).

---

### F-13 — Error membocorkan detail internal (Medium)

`php-api/src/config/db.php:24` mengembalikan `$e->getMessage()` (host/user DB);
handler bun mengembalikan `err.message` mentah (`patients.ts:52`, `services.ts:56`, dst).

**Perbaikan:** pesan generik ke client, detail hanya ke log server.

---

### F-14 — Login tanpa rate limit (Medium)

`bun-api/src/auth.ts:44` — tidak ada pembatasan percobaan.

**Perbaikan:** pembatas sederhana per IP+email (5 percobaan / 15 menit) + jeda verifikasi.

---

### F-15 — Daftar tanpa paginasi (Low)

Query daftar pasien/kunjungan/tagihan mengembalikan seluruh baris.

**Perbaikan:** parameter `limit`/`offset` dengan batas atas.

---

### F-16 — Security header & CSP (Low)

`web/nginx.conf` tidak mengirim CSP, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`. Risiko XSS meningkat karena token ada di `localStorage`.

**Perbaikan:** header ditambahkan di nginx (CSP tanpa `unsafe-inline` untuk script).

---

### F-17 — Kredensial DB default (Medium)

`bun-api/src/db.ts:5-7`, `php-api/src/config/db.php:3-7`, `docker-compose.yml`
— password default `klinikflow_pass` dan aplikasi memakai user DB dengan hak penuh.

**Perbaikan:** kredensial wajib dari env, contoh `.env.example`, user aplikasi dibatasi DML.

---

### F-18 — Password seed seragam (Medium)

`database/02_seed.sql:9` mendokumentasikan `password123`; `web/src/views/Login.vue:49` bahkan
menampilkannya di UI.

**Perbaikan:** seed memakai password acak dari env, catatan kredensial dihapus dari UI.

---

### F-19 — Identifier dari `Math.random()` (Low)

`bun-api/src/visits.ts:26`, `invoices.ts:71` — UUID kunjungan & referensi pembayaran dapat diprediksi.

**Perbaikan:** `crypto.randomUUID()`.

---

### F-20 — Artefak build ter-commit (Low)

`web/node_modules` (909 file), `bun-api/node_modules` (479 file), `web/dist` ikut repo; tidak ada
`.gitignore`.

**Perbaikan:** `.gitignore` + `git rm --cached` artefak.

---

### F-21 — CORS wildcard (Medium)

`bun-api/src/index.ts:11-14`, `php-api/src/index.php:3`, `proxy.ts` — `Access-Control-Allow-Origin: *`
pada semua respons, termasuk endpoint ber-token.

**Perbaikan:** allowlist origin dari env.

---

### F-22 — Daftar undangan tanpa auth (High)

`bun-api/src/staff.ts:24-34` — `GET /api/staff/invitations` tidak memanggil `extractAuthUser`,
sehingga token undangan (yang bisa dipakai untuk F-04) terbaca publik.

**Perbaikan:** wajib login + role `admin|manager` + scoping klini.

---

## Pemetaan perbaikan → branch

| Branch | Temuan |
|---|---|
| `fix/bun-api-access-control` | F-01, F-02, F-03, F-04, F-09 (server), F-11, F-13, F-14, F-15, F-19, F-21, F-22 |
| `fix/php-api-injection` | F-05, F-06, F-07, F-08, F-10 (server), F-13 (php) |
| `fix/web-xss` | F-09 (render), F-10 (render), F-16 |
| `fix/infra-hardening` | F-12 (audit), F-17, F-18, F-20 |
