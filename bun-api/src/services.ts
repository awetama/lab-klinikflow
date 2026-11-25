import { requireAuth, requireRole, resolveClinicId, errorResponse, MANAGEMENT_ROLES } from './middleware/guard';
import pool from './db';

// Handler Katalog Layanan Klinik (dibatasi ke klini pemanggil)
export async function handleListServices(req: Request): Promise<Response> {
  try {
    const user = requireAuth(req);
    const clinicId = resolveClinicId(user);

    const [rows] = await pool.query<any[]>(
      `SELECT s.*, c.name as clinic_name
       FROM services s
       JOIN clinics c ON s.clinic_id = c.id
       WHERE s.is_active = 1 AND s.clinic_id = ?
       ORDER BY s.id ASC`,
      [clinicId]
    );

    return Response.json({ success: true, data: rows });
  } catch (err) {
    return errorResponse(err, 'list-services');
  }
}

// Perubahan tarif layanan: hanya admin/manager, dan hanya untuk klini sendiri.
// (sebelumnya: siapa pun yang login bisa mengubah tarif klini mana pun — IDOR)
export async function handleUpdateServiceFee(req: Request): Promise<Response> {
  try {
    const user = requireRole(requireAuth(req), MANAGEMENT_ROLES);
    const clinicId = resolveClinicId(user);

    const body = await req.json();
    const serviceId = parseInt(body.id, 10);
    const newFee = parseFloat(body.fee);

    if (isNaN(serviceId) || isNaN(newFee) || newFee < 0) {
      return Response.json({ success: false, error: 'ID layanan dan tarif biaya baru tidak valid' }, { status: 400 });
    }
    if (newFee > 1_000_000_000) {
      return Response.json({ success: false, error: 'Tarif melebihi batas wajar' }, { status: 400 });
    }

    // Scope clinic_id ikut di WHERE: layanan milik klini lain tidak akan tersentuh.
    const [prevRows] = await pool.query<any[]>(
      'SELECT * FROM services WHERE id = ? AND clinic_id = ?',
      [serviceId, clinicId]
    );
    if (prevRows.length === 0) {
      return Response.json({ success: false, error: 'Layanan tidak ditemukan' }, { status: 404 });
    }

    const prevService = prevRows[0];

    await pool.query('UPDATE services SET fee = ? WHERE id = ? AND clinic_id = ?', [newFee, serviceId, clinicId]);

    await pool.query(
      `INSERT INTO audit_logs (clinic_id, user_id, action, entity, entity_id, detail)
       VALUES (?, ?, 'service.fee.update', 'services', ?, ?)`,
      [clinicId, user.id, String(serviceId), JSON.stringify({ from: Number(prevService.fee), to: newFee })]
    ).catch((e) => console.error('[audit] gagal mencatat perubahan tarif:', e.message));

    const [updatedRows] = await pool.query<any[]>('SELECT * FROM services WHERE id = ?', [serviceId]);

    return Response.json({
      success: true,
      message: `Tarif layanan ${prevService.name} berhasil diperbarui menjadi Rp ${newFee.toLocaleString('id-ID')}`,
      data: updatedRows[0],
      previous_fee: parseFloat(prevService.fee),
      updated_fee: newFee,
    });
  } catch (err) {
    return errorResponse(err, 'update-service-fee');
  }
}

