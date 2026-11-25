import { errorResponse, parsePagination, requireAuth, requireRole, resolveClinicId } from './middleware/guard';
import pool from './db';

// Semua endpoint kunjungan wajib login dan dibatasi ke klini pemanggil.
export async function handleListVisits(req: Request): Promise<Response> {
  try {
    const user = requireAuth(req);
    const url = new URL(req.url);
    const clinicId = resolveClinicId(user, url.searchParams.get('clinic_id'));
    const { limit, offset } = parsePagination(url);

    const [rows] = await pool.query<any[]>(
      `SELECT v.*, p.full_name as patient_name, p.mrn, c.name as clinic_name
       FROM visits v
       JOIN patients p ON v.patient_id = p.id
       JOIN clinics c ON v.clinic_id = c.id
       WHERE v.clinic_id = ?
       ORDER BY v.id DESC
       LIMIT ? OFFSET ?`,
      [clinicId, limit, offset]
    );

    return Response.json({ success: true, data: rows, pagination: { limit, offset } });
  } catch (err) {
    return errorResponse(err, 'list-visits');
  }
}

export async function handleCreateVisit(req: Request): Promise<Response> {
  try {
    const user = requireRole(requireAuth(req), ['admin', 'manager', 'staff', 'cashier']);
    const clinicId = resolveClinicId(user);

    const body = await req.json();
    const { patient_id, visit_date, notes } = body;
    const doctor_name = typeof body.doctor_name === 'string' && body.doctor_name.trim()
      ? body.doctor_name.trim().slice(0, 120)
      : 'dr. Aris Wibowo';

    if (!patient_id) {
      return Response.json({ success: false, error: 'Pasien wajib dipilih' }, { status: 400 });
    }

    // Pastikan pasien memang milik klini pemanggil (cegah kunjungan lintas tenant).
    const [patRows] = await pool.query<any[]>(
      'SELECT id FROM patients WHERE id = ? AND clinic_id = ?',
      [patient_id, clinicId]
    );
    if (patRows.length === 0) {
      return Response.json({ success: false, error: 'Pasien tidak ditemukan' }, { status: 404 });
    }

    // Identifier acak kriptografis (bukan Math.random yang bisa diprediksi).
    const visitUuid = `vis-${crypto.randomUUID().slice(0, 8)}`;

    const [res] = await pool.query<any>(
      `INSERT INTO visits (visit_uuid, clinic_id, patient_id, doctor_name, visit_date, status, notes)
       VALUES (?, ?, ?, ?, COALESCE(?, CURDATE()), 'registered', ?)`,
      [visitUuid, clinicId, patient_id, doctor_name, visit_date || null, (notes ?? '').slice(0, 1000)]
    );

    return Response.json({
      success: true,
      message: 'Jadwal kunjungan baru berhasil dicatat',
      visit_id: res.insertId,
      visit_uuid: visitUuid,
    });
  } catch (err) {
    return errorResponse(err, 'create-visit');
  }
}

export async function handleGetVisitByUuid(req: Request, uuid: string): Promise<Response> {
  try {
    const user = requireAuth(req);
    const clinicId = resolveClinicId(user);

    const [rows] = await pool.query<any[]>(
      `SELECT v.*, p.full_name as patient_name, p.mrn, p.phone as patient_phone, p.address as patient_address, c.name as clinic_name
       FROM visits v
       JOIN patients p ON v.patient_id = p.id
       JOIN clinics c ON v.clinic_id = c.id
       WHERE v.visit_uuid = ? AND v.clinic_id = ?`,
      [uuid, clinicId]
    );

    if (rows.length === 0) {
      return Response.json({ success: false, error: 'Kunjungan tidak ditemukan' }, { status: 404 });
    }

    return Response.json({ success: true, data: rows[0] });
  } catch (err) {
    return errorResponse(err, 'get-visit');
  }
}

