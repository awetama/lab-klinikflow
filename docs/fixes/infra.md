# Perbaikan Infrastruktur & Higiene Repo

Branch: `fix/infra-hardening` · Basis: `main@3c00cb0`

| Temuan | Perubahan | File |
|---|---|---|
| F-17 | Rahasia tidak lagi hardcoded; wajib dari `.env` (`:?` gagal-cepat di Compose) | `docker-compose.yml`, `.env.example` |
| F-18 | Seed password didokumentasikan di README sebagai dummy; UI sudah tidak menampilkannya (PR web) | `README.md` |
| F-20 | `node_modules/`, `dist/` berhenti dilacak git + `.gitignore` + `.dockerignore` | `.gitignore`, `*/.dockerignore` |
| F-21 | CORS origin dikonfigurasi lewat env (`CORS_ORIGINS`) | `docker-compose.yml` |
| F-12 | Migrasi `audit_logs` ikut dijalankan saat inisialisasi DB | `docker-compose.yml` → `database/03_audit.sql` |
| — | Port gateway `3000` tidak lagi dipublish ke host; container bun-api `read_only` + `cap_drop: ALL`, user non-root | `docker-compose.yml`, `bun-api/Dockerfile` |

---

## 1. F-17 — Rahasia dipindahkan ke `.env`

**Sebelum** (`docker-compose.yml`)
```yaml
environment:
  MYSQL_ROOT_PASSWORD: root_password_klinikflow
  MYSQL_PASSWORD: klinikflow_pass
  JWT_SECRET: klinikflow-super-secret-jwt-key-2026
```

**Sesudah**
```yaml
environment:
  MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD wajib di-set di .env}
  MYSQL_PASSWORD: ${MYSQL_PASSWORD:?MYSQL_PASSWORD wajib di-set di .env}
  JWT_SECRET: ${JWT_SECRET:?JWT_SECRET wajib di-set di .env}
```
Sintaks `${VAR:?pesan}` membuat Compose **menolak start** bila nilainya kosong, jadi
tidak ada lagi fallback diam-diam ke kredensial yang ter-commit.

`.env.example` menyertakan instruksi pembuatan: `openssl rand -hex 32` untuk `JWT_SECRET`.

**Bukti statis (branch ini)** — tidak ada lagi rahasia di file Compose:
```
$ grep -n "klinikflow_pass\|root_password_klinikflow\|super-secret-jwt-key" docker-compose.yml
(tidak ada hasil)
```
Fallback kredensial di **kode** (`bun-api/src/auth.ts`, `bun-api/src/db.ts`,
`php-api/src/config/db.php`) dihapus pada PR modul terkait (F-01/F-17 → `fix/bun-api-access-control`,
`fix/php-api-injection`). Karena itu PR ini tidak menyentuh file tersebut agar tidak bentrok.

---

## 2. F-20 — Artefak build berhenti dilacak

- `.gitignore`: `node_modules/`, `dist/`, `.env`, log
- `.dockerignore` per service: build context tidak lagi mengirim `node_modules`
- `git rm -r --cached bun-api/node_modules web/node_modules web/dist` → 1.405 berkas
  keluar dari index (berkas lokal tetap ada untuk dev/build)

Efek: ukuran clone turun drastis, `git status` bersih setelah build, dan tidak ada lagi
dependensi pihak ketiga yang "membeku" di dalam repo.

---

## 3. Hardening container & jaringan

| Perubahan | Alasan |
|---|---|
| `ports: 3000` dihapus dari `bun-api`, diganti `expose` | Sebelumnya gateway bisa dipanggil langsung, melewati nginx (tidak ada rate limit/header) |
| `read_only: true` + `tmpfs: /tmp` pada `bun-api` | Batasi penulisan filesystem bila proses dikompromikan |
| `cap_drop: ALL` pada `bun-api` | Gateway tidak butuh capability Linux apa pun |
| `security_opt: no-new-privileges` di semua service | Cegah eskalasi via setuid |
| `USER bun` di Dockerfile bun-api | Proses tidak berjalan sebagai root |
| MySQL tidak punya `ports:` | DB hanya terjangkau di network internal |
| `healthcheck` bun-api memanggil `/api/health` | Compose bisa menunggu kesiapan nyata |
| `database/03_audit.sql` dipasang di initdb | Tabel audit tersedia sejak awal |

---

## 4. README

- Langkah menjalankan kini menyertakan `cp .env.example .env` + pengisian rahasia
- Menegaskan API hanya diekspos lewat nginx (`/api`), port 3000 tidak dipublish
- Menautkan dokumen keamanan (`docs/threat-model.md`, `docs/findings.md`, `docs/fixes/`, `security/poc/`)

---

## 5. Verifikasi

**YAML valid** (parser YAML Bun):
```
$ bun -e 'Bun.YAML.parse(await Bun.file("docker-compose.yml").text())'
compose valid, services: mysql, php-api, bun-api, web
```

**Tidak ada rahasia di file Compose**
```
$ grep -n "klinikflow_pass\|root_password_klinikflow\|super-secret-jwt-key" docker-compose.yml
(tidak ada hasil)
```

**Artefak tidak lagi dilacak**
```
$ git ls-files | grep -cE "node_modules/|^web/dist/"
0
```

---

## 6. Catatan operasional

- `docker compose up` sekarang **butuh** `.env`; ini disengaja (fail-fast).
- Untuk database yang sudah berjalan (volume lama), terapkan migrasi audit manual:
  `docker compose exec -T mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" klinikflow_db < database/03_audit.sql`
- Password seed `password123` tetap ada di `database/02_seed.sql` karena ini lab lokal;
  untuk lingkungan nyata ganti dengan password acak per akun dan hapus komentar yang menyebutkannya.
