import { extractAuthUser } from './auth';
import pool from './db';

// Handler Katalog Layanan Klinik
export async function handleListServices(req: Request): Promise<Response> {
  const [rows] = await pool.query<any[]>(
    `SELECT s.*, c.name as clinic_name 
     FROM services s
     JOIN clinics c ON s.clinic_id = c.id
     WHERE s.is_active = 1
     ORDER BY s.id ASC`
  );

  return Response.json({ success: true, data: rows });
}

// Celah IDOR (Perubahan Biaya Layanan / Harga):
// Endpoint perubahan biaya layanan menerima identifier layanan 'id' dan nominal baru 'fee' dari request client.
// Endpoint tidak memverifikasi apakah pemanggil memiliki hak manajer/admin keuangan,
// sehingga staf biasa, kasir, atau pasien dapat mengubah tarif tindakan/layanan secara permanen di database!
export async function handleUpdateServiceFee(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user) {
    return Response.json({ success: false, error: 'Akses ditolak: Belum terautentikasi' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const serviceId = parseInt(body.id, 10);
    const newFee = parseFloat(body.fee);

    if (isNaN(serviceId) || isNaN(newFee) || newFee < 0) {
      return Response.json({ success: false, error: 'ID layanan dan tarif biaya baru tidak valid' }, { status: 400 });
    }

    // IDOR Flaw: Langsung memperbarui tabel services tanpa validasi otorisasi role
    const [prevRows] = await pool.query<any[]>('SELECT * FROM services WHERE id = ?', [serviceId]);
    if (prevRows.length === 0) {
      return Response.json({ success: false, error: 'Layanan tidak ditemukan' }, { status: 404 });
    }

    const prevService = prevRows[0];

    await pool.query('UPDATE services SET fee = ? WHERE id = ?', [newFee, serviceId]);

    const [updatedRows] = await pool.query<any[]>('SELECT * FROM services WHERE id = ?', [serviceId]);

    return Response.json({
      success: true,
      message: `Tarif layanan ${prevService.name} berhasil diperbarui menjadi Rp ${newFee.toLocaleString('id-ID')}`,
      data: updatedRows[0],
      previous_fee: parseFloat(prevService.fee),
      updated_fee: newFee,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

