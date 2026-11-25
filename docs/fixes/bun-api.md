# Perbaikan Modul `bun-api` (BFF/Gateway)

Branch: `fix/bun-api-access-control` · Basis: `main@3c00cb0`

Ringkasan: 12 temuan diperbaiki — penguatan autentikasi/otorisasi, isolasi tenant
(`clinic_id`), validasi input, transaksi pembayaran, dan penghapusan kebocoran error.

| Temuan | Perubahan | File |
|---|---|---|
| F-01 | `JWT_SECRET` wajib dari env (min 32 char), tanpa fallback; verifikasi dipin ke `HS256` | `src/config.ts`, `src/auth.ts` |
| F-02 | Perubahan tarif hanya `admin`/`manager` + `clinic_id` ikut di `WHERE` | `src/services.ts` |
| F-03 | Semua route non-publik melewati `requireAuth` di gateway | `src/index.ts` |
| F-04 | Role diambil dari baris undangan (bukan payload), transaksi + `FOR UPDATE` | `src/staff.ts` |
| F-09 | Validasi/batas panjang input teks, buang karakter kontrol | `src/patients.ts`, `src/middleware/guard.ts` |
| F-11 | Pembayaran dalam transaksi, cek status `paid`/`cancelled`, batas nominal sisa | `src/invoices.ts` |
| F-13 | Pesan generik ke klien, detail hanya ke log server | `src/config.ts` (`logAndGeneric`) |
| F-14 | Rate limit login 5×/15 menit per IP+email, verifikasi waktu konstan | `src/auth.ts` |
| F-15 | Paginasi `limit`/`offset` dengan batas atas 200 | `src/middleware/guard.ts` |
| F-19 | `crypto.randomUUID()` untuk UUID kunjungan & referensi pembayaran | `src/visits.ts`, `src/invoices.ts` |
| F-21 | CORS allowlist dari `CORS_ORIGINS` (tidak ada `*`) | `src/index.ts` |
| F-22 | Daftar undangan wajib `admin`/`manager` + scoped klini, token tidak lagi dikirim ke klien | `src/staff.ts` |
| F-12 | Pencatatan `audit_logs` untuk perubahan tarif, pembayaran, penerimaan undangan | `src/*.ts`, `database/03_audit.sql` |

---

## 1. F-01 — JWT secret tidak lagi punya default

**Sebelum** (`src/auth.ts:4`)
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'klinikflow-super-secret-jwt-key-2026';
```

**Sesudah** (`src/config.ts`, `src/auth.ts`)
```ts
export const JWT_SECRET: string = required('JWT_SECRET', 32);
...
return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as UserPayload;
```

Aplikasi sekarang **gagal start** bila `JWT_SECRET` kosong/terlalu pendek, alih-alih
diam-diam memakai secret publik.

**Bukti**: `bun build src/index.ts --target=bun` sukses; menjalankan server tanpa env
menghasilkan `[config] Environment variable JWT_SECRET wajib di-set` (fail-fast).

---

## 2. F-02 — IDOR tarif menjadi khusus manajemen + scoped klini

**Sebelum** (`src/services.ts`)
```ts
const user = extractAuthUser(req);            // hanya cek login
...
await pool.query('UPDATE services SET fee = ? WHERE id = ?', [newFee, serviceId]);
```

**Sesudah**
```ts
const user = requireRole(requireAuth(req), MANAGEMENT_ROLES);   // admin | manager
const clinicId = resolveClinicId(user);
const [prevRows] = await pool.query('SELECT * FROM services WHERE id = ? AND clinic_id = ?', [serviceId, clinicId]);
await pool.query('UPDATE services SET fee = ? WHERE id = ? AND clinic_id = ?', [newFee, serviceId, clinicId]);
```

**Ekspektasi PoC `04_idor_fee.sh`**
- sebelum: `200` + `updated_fee: 0`
- sesudah: `403` untuk token kasir; `404` bila id milik klini lain

---

## 3. F-03 — Autentikasi global di gateway

**Sebelum** (`src/index.ts`): routing langsung memanggil handler; `/api/patients`,
`/api/visits`, `/api/invoices` tidak memeriksa token.

**Sesudah**
```ts
const PUBLIC_ROUTES = [
  { path: '/api/auth/login', method: 'POST' },
  { path: '/api/health', method: 'GET' },
];
...
if (!isPublic(path, method)) requireAuth(req);
```

**Ekspektasi PoC `02_unauth_pii.sh`**: seluruh endpoint balik `401
{"success":false,"error":"Sesi tidak valid atau telah berakhir"}`.

---

## 4. F-04 + F-22 — Privilege escalation & kebocoran token undangan

**Sebelum** (`src/staff.ts:58`)
```ts
const assignedRole = role || invitation.role || 'staff';
```
dan `handleListInvitations` tanpa autentikasi sama sekali.

**Sesudah**
```ts
const user = requireRole(requireAuth(req), MANAGEMENT_ROLES);  // daftar undangan
...
const assignedRole = invitation.role || 'staff';               // role dari DB
if (!allowedInviteRoles.includes(assignedRole)) { ... }
```
`SELECT ... FOR UPDATE` + transaksi memastikan satu token hanya bisa dipakai sekali,
dan daftar undangan kini tidak mengembalikan `token` ke klien.

**Ekspektasi PoC `05_priv_esc_invite.sh`**
- langkah 1 (daftar undangan tanpa token): `401` (sebelum: `200` + token undangan)
- langkah 2 (kirim `role: "admin"`): akun tetap dibuat dengan role dari undangan

---

## 5. F-11 — Settlement replay ditutup

**Sebelum** (`src/invoices.ts`)
```ts
const [invRows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
// tidak ada cek status, tidak ada validasi nominal
await pool.query("INSERT INTO payments ...");
await pool.query("UPDATE invoices SET status = 'paid' ...");
```

**Sesudah**
```ts
await conn.beginTransaction();
const [invRows] = await conn.query('SELECT * FROM invoices WHERE id = ? AND clinic_id = ? FOR UPDATE', ...);
if (invoice.status === 'paid') return 409;
const outstanding = Number(invoice.amount) - alreadyPaid;
if (amount > outstanding + 0.001) return 400;
```
Status akhir mengikuti sisa tagihan (`paid` atau `partially_paid`).

---

## 6. F-13 — Error tidak lagi membocorkan detail internal

Sebelum: `Response.json({ error: err.message }, { status: 500 })` di hampir semua handler
(membocorkan SQL error, nama tabel, dsb).

Sesudah: `errorResponse(err, context)` → `HttpError` diteruskan, error lain menjadi
`"Terjadi kesalahan pada server"` sementara detail lengkap masuk `console.error`.

---

## 7. F-14 — Rate limit login

```ts
if (isRateLimited(key)) {
  return Response.json({ success: false, error: 'Terlalu banyak percobaan login...' }, { status: 429 });
}
```
Kunci = `IP:email`, jendela 15 menit, maksimum 5 percobaan. Ditambah verifikasi
terhadap hash dummy saat email tidak ditemukan agar waktu respons seragam.

---

## 8. F-21 — CORS allowlist

**Sebelum**: `Access-Control-Allow-Origin: *` pada semua respons (termasuk `proxy.ts`).

**Sesudah**:
```ts
const origin = req.headers.get('Origin');
if (origin && CORS_ORIGINS.includes(origin)) {
  resHeaders.set('Access-Control-Allow-Origin', origin);
  resHeaders.set('Vary', 'Origin');
}
```
`CORS_ORIGINS` wajib diisi di env (contoh: `http://localhost:8080`).

---

## 9. Perubahan kontrak internal (penting untuk merge)

`proxy.ts` sekarang **meneruskan header `Authorization`** ke `php-api` dan **tidak lagi**
mengirim `X-User-Id` / `X-User-Role` / `X-Clinic-Id`. `php-api` pada branch
`fix/php-api-injection` memverifikasi JWT itu sendiri. Kedua PR harus di-merge bersamaan;
urutan aman: **bun-api dulu, lalu php-api**.

## 10. Bukti otomatis

```
$ cd bun-api && bun build src/index.ts --target=bun --outfile=/tmp/kf_build.js
Bundled 212 modules in 27ms
  kf_build.js  1.51 MB  (entry point)
```

Variabel env baru yang wajib: `JWT_SECRET`, `CORS_ORIGINS`, `DB_USER`, `DB_PASS`
(lihat `.env.example` pada branch `fix/infra-hardening`).

## 11. Verifikasi manual (dijalankan di lab Docker)

```
docker compose up -d --build
BASE=http://localhost:3000 ./security/poc/02_unauth_pii.sh   # harapan: 401 semua
BASE=http://localhost:3000 ./security/poc/03_rce_export.sh   # harapan: tidak ada output shell
BASE=http://localhost:3000 ./security/poc/05_priv_esc_invite.sh
```
