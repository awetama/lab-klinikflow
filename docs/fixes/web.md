# Perbaikan Modul `web` (Frontend)

Branch: `fix/web-xss` · Basis: `main@3c00cb0`

| Temuan | Perubahan | File |
|---|---|---|
| F-09 | `v-html="p.full_name"` → interpolasi teks (`{{ }}`) sehingga nama pasien di-escape Vue | `src/views/Patients.vue` |
| F-10 | Banner ringkasan laporan tidak lagi `v-html`; memakai field teks `summary` | `src/views/Reports.vue` |
| F-16 | CSP + header keamanan di nginx | `nginx.conf` |
| F-18 | Kredensial demo tidak lagi ditampilkan/di-prefill di UI login | `src/views/Login.vue` |

---

## 1. F-09 — Stored XSS pada tabel pasien

**Sebelum** (`src/views/Patients.vue:39`)
```vue
<td v-html="p.full_name"></td>
```
Nama pasien yang dikirim sebagai `<img src=x onerror=...>` akan dijalankan di browser
setiap staf membuka halaman Pasien.

**Sesudah**
```vue
<td>{{ p.full_name }}</td>
```
Interpolasi `{{ }}` selalu meng-escape HTML; payload tampil sebagai teks.

---

## 2. F-10 — Reflected XSS pada banner laporan

**Sebelum** (`src/views/Reports.vue:24`)
```vue
<div v-if="summaryHtml" class="summary-banner" v-html="summaryHtml"></div>
```

**Sesudah**
```vue
<div v-if="summaryText" class="summary-banner">{{ summaryText }}</div>
```
Script sekarang membaca `res.summary` (teks biasa) dengan fallback `summary_html`
yang sudah di-escape di sisi server.

---

## 3. F-16 — Header keamanan & CSP (`nginx.conf`)

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
server_tokens off;
```
CSP sengaja **tanpa** `script-src 'unsafe-inline'`: bundle Vite memakai file JS terpisah
(diverifikasi: `web/dist/index.html` hanya memuat `<script type="module" src="/assets/...">`),
sehingga XSS inline tidak lagi bisa dieksekusi meski ada sink di masa depan.

---

## 4. F-18 — Kredensial demo tidak lagi ditampilkan

**Sebelum** (`src/views/Login.vue`): UI mencetak `Password seragam semua akun lab: password123`
dan mem-prefill field password dengan nilai itu.

**Sesudah**: hint hanya menunjuk ke `database/02_seed.sql`, field password kosong.
Tombol akun demo tetap ada (lab lokal) tetapi tidak mengisi password otomatis.

---

## 5. Bukti

**Build produksi berhasil** (dijalankan dari `web/`):
```
$ bun run build
vite v6.4.6 building for production...
✓ 46 modules transformed.
dist/index.html                   0.43 kB │ gzip:  0.31 kB
dist/assets/index-BJ5vErvW.css   13.80 kB │ gzip:  3.74 kB
dist/assets/index-Cw0MrjDN.js   138.49 kB │ gzip: 49.16 kB
✓ built in 1.07s
```

**Sink XSS yang tersisa**
```
$ grep -rn "v-html" web/src
(tidak ada hasil)
$ grep -rn "innerHTML" web/src
(tidak ada hasil)
```

## 6. Catatan

- `web/dist/` tidak ikut diubah di PR ini (artefak build). Image Docker tetap melakukan
  `vite build` saat build, jadi bundle produksi selalu mengikuti sumber terbaru.
  Higiene `dist/` di-commit ditangani di branch `fix/infra-hardening`.
- Token masih disimpan di `localStorage`. Dengan XSS yang sudah ditutup + CSP ketat,
  risiko pencurian token turun signifikan. Migrasi ke cookie `HttpOnly` memerlukan
  perubahan kontrak API dan disarankan sebagai pekerjaan lanjutan, bukan bagian PR ini.
