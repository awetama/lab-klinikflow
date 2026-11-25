import pool from './db';

// Handler Manajemen Data Pasien
export async function handleListPatients(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';

  let query = `SELECT p.*, c.name as clinic_name 
               FROM patients p
               JOIN clinics c ON p.clinic_id = c.id
               WHERE 1=1`;
  const params: any[] = [];

  if (search) {
    query += ` AND (p.full_name LIKE ? OR p.mrn LIKE ? OR p.phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY p.id ASC`;

  const [rows] = await pool.query<any[]>(query, params);

  return Response.json({ success: true, data: rows });
}

export async function handleCreatePatient(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { clinic_id = 1, full_name, birth_date, gender, phone, address } = body;

    if (!full_name || !birth_date || !gender || !phone) {
      return Response.json({ success: false, error: 'Data identitas pasien wajib diisi lengkap' }, { status: 400 });
    }

    const [countRows] = await pool.query<any[]>('SELECT COUNT(*) as total FROM patients');
    const mrn = `MRN-2026-${String(countRows[0].total + 1).padStart(3, '0')}`;

    // Nama pasien disimpan tanpa sanitasi (XSS sink ketika ditampilkan di tabel web)
    const [res] = await pool.query<any>(
      `INSERT INTO patients (clinic_id, mrn, full_name, birth_date, gender, phone, address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clinic_id, mrn, full_name, birth_date, gender, phone, address || '']
    );

    return Response.json({
      success: true,
      message: 'Registrasi pasien baru berhasil',
      patient_id: res.insertId,
      mrn,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

