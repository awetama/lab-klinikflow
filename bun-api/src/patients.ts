import {
  errorResponse,
  parsePagination,
  requireAuth,
  requireRole,
  resolveClinicId,
  sanitizeText,
} from './middleware/guard';
import pool from './db';

// Semua endpoint pasien wajib login dan dibatasi ke klini pemanggil.
export async function handleListPatients(req: Request): Promise<Response> {
  try {
    const user = requireAuth(req);
    const url = new URL(req.url);
    const clinicId = resolveClinicId(user, url.searchParams.get('clinic_id'));
    const search = (url.searchParams.get('search') || '').slice(0, 100);
    const { limit, offset } = parsePagination(url);

    let query = `SELECT p.*, c.name as clinic_name
                 FROM patients p
                 JOIN clinics c ON p.clinic_id = c.id
                 WHERE p.clinic_id = ?`;
    const params: any[] = [clinicId];

    if (search) {
      query += ` AND (p.full_name LIKE ? OR p.mrn LIKE ? OR p.phone LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    query += ` ORDER BY p.id ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await pool.query<any[]>(query, params);

    return Response.json({ success: true, data: rows, pagination: { limit, offset } });
  } catch (err) {
    return errorResponse(err, 'list-patients');
  }
}

export async function handleCreatePatient(req: Request): Promise<Response> {
  try {
    const user = requireRole(requireAuth(req), ['admin', 'manager', 'staff', 'cashier']);
    // clinic_id dari token, bukan dari body — mencegah penulisan lintas tenant.
    const clinicId = resolveClinicId(user);

    const body = await req.json();
    const full_name = sanitizeText(body.full_name, 'Nama pasien', 150);
    const phone = sanitizeText(body.phone, 'Telepon', 30);
    const address = sanitizeText(body.address ?? '-', 'Alamat', 255);
    const birth_date = typeof body.birth_date === 'string' ? body.birth_date : '';
    const gender = body.gender === 'L' || body.gender === 'P' ? body.gender : '';

    if (!birth_date || !gender) {
      return Response.json({ success: false, error: 'Data identitas pasien wajib diisi lengkap' }, { status: 400 });
    }

    // MRN berbasis urutan global aman dari tabrakan karena dihitung dalam transaksi.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [countRows] = await conn.query<any[]>('SELECT COUNT(*) as total FROM patients FOR UPDATE');
      const mrn = `MRN-2026-${String(countRows[0].total + 1).padStart(3, '0')}`;

      const [res] = await conn.query<any>(
        `INSERT INTO patients (clinic_id, mrn, full_name, birth_date, gender, phone, address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [clinicId, mrn, full_name, birth_date, gender, phone, address]
      );
      await conn.commit();

      return Response.json({
        success: true,
        message: 'Registrasi pasien baru berhasil',
        patient_id: res.insertId,
        mrn,
      });
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    return errorResponse(err, 'create-patient');
  }
}

