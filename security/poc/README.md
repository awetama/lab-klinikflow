# PoC Reproduksi — KlinikFlow

Semua skrip menembak gateway BFF (`bun-api`) di `BASE` (default `http://localhost:3000`).
Jalankan **hanya** di lab lokal: `docker compose up -d --build`.

```bash
chmod +x security/poc/*.sh

# tanpa autentikasi
BASE=http://localhost:3000 ./security/poc/02_unauth_pii.sh   # F-03
BASE=http://localhost:3000 ./security/poc/03_rce_export.sh   # F-06
BASE=http://localhost:3000 ./security/poc/05_priv_esc_invite.sh  # F-22 + F-04

# dengan token
TOKEN=<jwt kasir> BASE=http://localhost:3000 ./security/poc/04_idor_fee.sh   # F-02
TOKEN=<jwt staf>  BASE=http://localhost:3000 ./security/poc/06_xss.sh        # F-09, F-10

# tanpa perlu login sama sekali
BASE=http://localhost:3000 ./security/poc/01_jwt_forge.sh    # F-01
```

Akun seed: `admin@klinikmentari.test` / `password123` (lihat `database/02_seed.sql`).

## Ekspektasi

| Skrip | Sebelum patch | Sesudah patch |
|---|---|---|
| `01_jwt_forge.sh` | 200 + statistik dashboard | 401 `invalid token` |
| `02_unauth_pii.sh` | 200 + data pasien | 401 seluruhnya |
| `03_rce_export.sh` | output `id`/`uname` | 400 validasi / 200 tanpa eksekusi shell |
| `04_idor_fee.sh` | 200, tarif berubah jadi 0 | 403 `forbidden` |
| `05_priv_esc_invite.sh` | 200, `assigned_role: admin` | 401 (daftar) / role tetap `staff` |
| `06_xss.sh` | payload tersimpan & dirender | tersimpan sebagai teks, tidak dieksekusi |

Catat status code aktual ke `docs/fixes/<modul>.md` saat verifikasi.
