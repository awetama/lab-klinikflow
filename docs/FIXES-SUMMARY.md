# Ringkasan Perbaikan Keamanan — KlinikFlow

Satu PR ini menggabungkan seluruh hasil audit keamanan pada `main@3c00cb0`.
Dokumen rinci: [`threat-model.md`](threat-model.md), [`findings.md`](findings.md),
dan per modul di [`fixes/`](fixes/).

## Isi PR

| Area | Berkas | Temuan |
|---|---|---|
| `bun-api` (gateway) | `src/auth.ts`, `src/config.ts`, `src/middleware/guard.ts`, `src/services.ts`, `src/staff.ts`, `src/patients.ts`, `src/visits.ts`, `src/invoices.ts`, `src/proxy.ts`, `src/index.ts` | F-01, F-02, F-03, F-04, F-09 (server), F-11, F-12, F-13, F-14, F-15, F-19, F-21, F-22 |
| `php-api` (legacy) | `src/lib/jwt.php`, `src/lib/auth.php`, `src/export_report.php`, `src/reports.php`, `src/claims.php`, `src/attachments.php`, `src/config/db.php`, `src/helpers/response.php`, `src/index.php`, `tests/jwt_verify_test.php` | F-05, F-06, F-07, F-08, F-10 (server), F-12, F-13 |
| `web` (frontend) | `src/views/Patients.vue`, `src/views/Reports.vue`, `src/views/Login.vue`, `nginx.conf` | F-09 (render), F-10 (render), F-16, F-18 (UI) |
| Infra & DB | `docker-compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `database/03_audit.sql`, `README.md`, `bun-api/Dockerfile` | F-12, F-17, F-18, F-20, F-21 |
| Dokumen & PoC | `docs/`, `security/poc/` | — |

## Tiga temuan Critical

1. **F-06 — RCE tanpa autentikasi.** `php-api/src/export_report.php` menyusun perintah shell dari
   `php://input` → `POST /api/reports/export {"filter":"; id;"}` mengeksekusi perintah di container.
   **Perbaikan:** `shell_exec()` dihapus; tipe/format di-whitelist; ekspor dibangun dari query berparameter.

2. **F-05 — Identitas bisa dipalsukan.** `php-api` mempercayai header `X-User-Role` / `X-Clinic-Id`.
   **Perbaikan:** verifikasi JWT HS256 di PHP (`lib/jwt.php`), identitas dan `clinic_id` diambil dari klaim token.

3. **F-04 + F-22 — Takeover akun staf.** `GET /api/staff/invitations` terbuka tanpa auth (token undangan
   bocor) dan `accept-invitation` memakai `role` dari payload klien.
   **Perbaikan:** daftar undangan wajib `admin`/`manager` + scoped klini; role diambil dari baris undangan;
   token sekali pakai dalam transaksi `FOR UPDATE`.

## Bukti yang dijalankan

| Uji | Perintah | Hasil |
|---|---|---|
| Build gateway | `cd bun-api && bun build src/index.ts --target=bun` | bundle 1.51 MB, sukses |
| Lint PHP | `php -l` pada 10 berkas | semua `No syntax errors` |
| Uji unit JWT | `php php-api/tests/jwt_verify_test.php` | 6/6 PASS |
| Build frontend | `cd web && bun run build` | 46 modul, sukses |
| Sink XSS | `grep -rn "v-html\|innerHTML" web/src` | tidak ada |
| Compose | `Bun.YAML.parse(docker-compose.yml)` | valid |
| Artefak ter-track | `git ls-files \| grep -cE "node_modules/\|^web/dist/"` | 0 |
| Shell di php-api | `grep -rn "shell_exec\|exec(\|system(" php-api/src` | hanya komentar |

PoC manual ada di `security/poc/` dan dijalankan pada lab Docker:

```bash
cp .env.example .env   # isi MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, JWT_SECRET
docker compose up -d --build
BASE=http://localhost:8080 ./security/poc/02_unauth_pii.sh   # harapan: 401
BASE=http://localhost:8080 ./security/poc/03_rce_export.sh   # harapan: tanpa eksekusi shell
BASE=http://localhost:8080 ./security/poc/05_priv_esc_invite.sh
```

## Catatan penerapan

- `.env` sekarang **wajib** (Compose memakai `${VAR:?}`); tidak ada kredensial di repo.
- Gateway hanya bisa diakses lewat nginx (`/api`); port `3000` tidak lagi dipublish.
- Kontrak internal berubah: `bun-api` meneruskan `Authorization`, `php-api` memverifikasi JWT —
  kedua sisi sudah ada di PR ini, jadi tidak ada langkah manual.
- Database lama (volume sudah ada): terapkan `database/03_audit.sql` manual, karena
  `docker-entrypoint-initdb.d` hanya berjalan pada volume kosong.
- Token masih di `localStorage`; CSP ketat sudah dipasang, migrasi ke cookie `HttpOnly`
  disarankan sebagai pekerjaan lanjutan (butuh perubahan kontrak API).
