# KlinikFlow — Sistem Administrasi Klinik, Tagihan & Klaim Asuransi

> ⚠️ **LOCAL SECURITY TRAINING LAB — DATA DUMMY**  
> Aplikasi ini dibangun khusus untuk latihan pemecahan masalah dan pengujian secure coding dalam lingkungan lokal Docker yang terisolasi. Seluruh catatan kunjungan, tarif layanan, identitas pasien, dan data klaim bersifat sintetis dan fiktif (bukan data medis riil). Dilarang keras mendeploy aplikasi ini ke internet atau lingkungan produksi.

> 🔐 **Dokumen keamanan**: hasil analisis dan perbaikan ada di
> [`docs/threat-model.md`](docs/threat-model.md), [`docs/findings.md`](docs/findings.md),
> `docs/fixes/`, dan skrip reproduksi di [`security/poc/`](security/poc/README.md).

---

## Ringkasan Aplikasi
**KlinikFlow** adalah sistem manajemen administrasi operasional poliklinik dan fasilitas kesehatan primer (contoh tenant: Klinik Mentari dan Klinik Sehat Sentosa). Sistem ini mengintegrasikan fungsi bisnis:
- Pendaftaran dan pencarian rekam medis administratif pasien.
- Penjadwalan serta pencatatan kunjungan poliklinik dan dokter pemeriksa.
- Manajemen katalog tindakan medis, tarif layanan, dan laboratorium.
- Pembuatan faktur tagihan, simulasi kasir pelunasan, dan riwayat transaksi.
- Pengajuan dan verifikasi klaim reimbursement asuransi/penjamin serta lampiran berkas.
- Rekapitulasi laporan operasional harian dan utilitas ekspor data format CLI.
- Manajemen kepegawaian internal dan aktivasi token undangan staf.

## Arsitektur Stack
Aplikasi dirancang sebagai monorepo multi-service:
- **Frontend (`web/`)**: Vue 3 + Vite, antarmuka pengguna responsif berbahasa Indonesia dengan Pico CSS.
- **BFF / API Gateway (`bun-api/`)**: Bun runtime + TypeScript, menangani sesi JWT, katalog layanan, data pasien, kunjungan, tagihan, dan kepegawaian.
- **Legacy Service (`php-api/`)**: PHP 8.3 Apache, menangani rekapitulasi laporan, berkas lampiran klaim, persetujuan asuransi, dan engine ekspor utilitas CLI.
- **Database (`database/`)**: MySQL 8.0 dengan skema relasional terisolasi dan inisialisasi *seed dummy* otomatis.

---

## Prasyarat Menjalankan
- **Docker Engine** (versi 24.0+)
- **Docker Compose** (versi v2.20+)
- Port bebas pada mesin host: `8080` (Web UI & Reverse Proxy API) dan `3000` (Direct Bun Gateway API).

---

## Cara Menjalankan Aplikasi

1. Masuk ke direktori KlinikFlow:
   ```bash
   cd KlinikFlow
   ```

2. Siapkan konfigurasi (rahasia tidak lagi hardcoded di repo):
   ```bash
   cp .env.example .env
   # isi MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, JWT_SECRET (openssl rand -hex 32)
   ```

3. Bangun dan jalankan seluruh container:
   ```bash
   docker compose up -d --build
   ```

4. Periksa status kesiapan seluruh layanan:
   ```bash
   docker compose ps
   ```

5. Buka aplikasi di peramban web:
   - **Aplikasi Web**: [http://localhost:8080](http://localhost:8080)
   - API hanya diekspos lewat nginx: `http://localhost:8080/api`
     (port `3000` gateway tidak lagi dipublish ke host)

---

## Akun Pengguna Dummy Lab
Seluruh akun latihan menggunakan kata sandi seragam: `password123`.

| Email Akun | Peran (Role) | Unit Klinik | Keterangan |
|---|---|---|---|
| `admin@klinikflow.local` | `admin` | Klinik Mentari | Administrator Medis & IT |
| `manager@klinikflow.local` | `manager` | Klinik Mentari | Koordinator Operasional Klinik |
| `staf1@klinikflow.local` | `staff` | Klinik Mentari | Staf Pendaftaran & Administrasi 1 |
| `staf2@klinikflow.local` | `staff` | Klinik Sehat Sentosa | Staf Pendaftaran & Administrasi 2 |
| `kasir1@klinikflow.local` | `cashier` | Klinik Mentari | Kasir Pembayaran 1 |
| `kasir2@klinikflow.local` | `cashier` | Klinik Sehat Sentosa | Kasir Pembayaran 2 |
| `pasien1@pasien.local` | `patient` | Klinik Mentari | Akun Pasien Bambang Susanto |
| `pasien2@pasien.local` | `patient` | Klinik Mentari | Akun Pasien Ratna Sari |
| `pasien3@pasien.local` | `patient` | Klinik Sehat Sentosa | Akun Pasien Agus Haryanto |
| `pasien4@pasien.local` | `patient` | Klinik Sehat Sentosa | Akun Pasien Nurul Hidayah |

> *Catatan: Halaman login menyediakan tombol pemilih akun instan untuk kemudahan pengujian.*

---

## Panduan Penggunaan Fitur

1. **Pasien & Pendaftaran**:
   - Buka menu **Pasien** untuk mencari atau mendaftarkan pasien baru.
   - Masukkan informasi nama, tanggal lahir, gender, nomor telepon, dan domisili.
2. **Kunjungan & Pemeriksaan**:
   - Buka menu **Kunjungan** untuk melihat rekam nomor registrasi UUID kunjungan.
   - Daftarkan kunjungan baru dengan memilih pasien terdaftar dan dokter pemeriksa.
3. **Tarif Tindakan Medis**:
   - Buka menu **Tarif Layanan** untuk meninjau 10 jenis layanan poliklinik.
   - Staf dapat melihat dan memodifikasi biaya tindakan melalui tombol ubah tarif.
4. **Tagihan & Kasir**:
   - Buka menu **Tagihan & Kasir** untuk melihat daftar faktur pasien.
   - Klik tombol **Proses Bayar** untuk memilih metode (QRIS, Tunai, Transfer Bank) dan mencatat pelunasan.
5. **Klaim Asuransi**:
   - Buka menu **Klaim Asuransi** untuk meninjau berkas reimbursement.
   - Gunakan tombol **Setujui** untuk memproses approval klaim, serta tombol pemeriksaan lampiran dokumen.
6. **Laporan & Ekspor**:
   - Buka menu **Laporan** untuk melihat rekapitulasi transaksi harian.
   - Gunakan fitur **Ekspor Dokumen (CLI)** untuk simulasi ekstraksi data.
7. **Staf & Undangan**:
   - Buka menu **Staf & Undangan** untuk melihat kepegawaian aktif atau mengaktifkan token undangan pegawai baru.

---

## Pemantauan Log & Troubleshooting
```bash
# Log seluruh layanan
docker compose logs -f

# Log khusus API Gateway (Bun)
docker compose logs -f bun-api

# Log khusus Legacy Backend (PHP)
docker compose logs -f php-api
```

---

## Cara Reset Data Lab
Untuk membersihkan data transaksi dan mengembalikan seluruh database ke kondisi *seed* awal:
```bash
docker compose down -v
docker compose up -d --build
```

# lab-klinikflow
