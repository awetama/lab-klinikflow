import pool from './db';

// Handler Kunjungan & Pemeriksaan Pasien
export async function handleListVisits(req: Request): Promise<Response> {
  const [rows] = await pool.query<any[]>(
    `SELECT v.*, p.full_name as patient_name, p.mrn, c.name as clinic_name
     FROM visits v
     JOIN patients p ON v.patient_id = p.id
     JOIN clinics c ON v.clinic_id = c.id
     ORDER BY v.id DESC`
  );

  return Response.json({ success: true, data: rows });
}

export async function handleCreateVisit(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { clinic_id = 1, patient_id, doctor_name = 'dr. Aris Wibowo', visit_date, notes } = body;

    if (!patient_id) {
      return Response.json({ success: false, error: 'Pasien wajib dipilih' }, { status: 400 });
    }

    const [countRows] = await pool.query<any[]>('SELECT COUNT(*) as total FROM visits');
    const visitUuid = `vis-${Math.random().toString(36).substring(2, 6)}-${String(countRows[0].total + 1).padStart(4, '0')}`;

    const [res] = await pool.query<any>(
      `INSERT INTO visits (visit_uuid, clinic_id, patient_id, doctor_name, visit_date, status, notes)
       VALUES (?, ?, ?, ?, COALESCE(?, CURDATE()), 'registered', ?)`,
      [visitUuid, clinic_id, patient_id, doctor_name, visit_date || null, notes || '']
    );

    return Response.json({
      success: true,
      message: 'Jadwal kunjungan baru berhasil dicatat',
      visit_id: res.insertId,
      visit_uuid: visitUuid,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function handleGetVisitByUuid(uuid: string): Promise<Response> {
  const [rows] = await pool.query<any[]>(
    `SELECT v.*, p.full_name as patient_name, p.mrn, p.phone as patient_phone, p.address as patient_address, c.name as clinic_name
     FROM visits v
     JOIN patients p ON v.patient_id = p.id
     JOIN clinics c ON v.clinic_id = c.id
     WHERE v.visit_uuid = ?`,
    [uuid]
  );

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Kunjungan tidak ditemukan' }, { status: 404 });
  }

  return Response.json({ success: true, data: rows[0] });
}

