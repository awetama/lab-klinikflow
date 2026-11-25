import { extractAuthUser } from './auth';
import pool from './db';

// Handler Manajemen & Undangan Staf Klinik
export async function handleListStaff(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return Response.json({ success: false, error: 'Akses ditolak: Hanya admin atau manager yang diizinkan' }, { status: 403 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.email, u.role, u.phone, c.name as clinic_name, u.created_at
     FROM users u
     JOIN clinics c ON u.clinic_id = c.id
     WHERE u.role IN ('admin', 'manager', 'staff', 'cashier')
     ORDER BY u.id ASC`
  );

  return Response.json({ success: true, data: rows });
}

export async function handleListInvitations(req: Request): Promise<Response> {
  const [rows] = await pool.query<any[]>(
    `SELECT si.*, c.name as clinic_name 
     FROM staff_invitations si
     JOIN clinics c ON si.clinic_id = c.id
     WHERE si.is_accepted = 0`
  );
  return Response.json({ success: true, data: rows });
}

// Celah Privilege Escalation:
// Alur pendaftaran / penerimaan undangan staf mempercayai atribut 'role' dari payload client.
// Pengguna yang diundang sebagai 'staff' atau 'cashier' dapat menyisipkan 'role': 'admin' saat menyelesaikan registrasi,
// sehingga akun yang dibuat langsung memiliki izin admin penuh di sistem backend!
export async function handleAcceptInvitation(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token, name, password, phone, role } = body;

    if (!token || !name || !password) {
      return Response.json({ success: false, error: 'Token undangan, nama, dan password wajib diisi' }, { status: 400 });
    }

    const [invRows] = await pool.query<any[]>(
      `SELECT * FROM staff_invitations WHERE token = ? AND is_accepted = 0`,
      [token]
    );

    if (invRows.length === 0) {
      return Response.json({ success: false, error: 'Token undangan tidak valid atau sudah digunakan' }, { status: 404 });
    }

    const invitation = invRows[0];
    const hashedPassword = await Bun.password.hash(password);

    // Privilege Escalation Flaw: Mengutamakan role dari payload client daripada invitation.role
    const assignedRole = role || invitation.role || 'staff';

    const [userRes] = await pool.query<any>(
      `INSERT INTO users (clinic_id, name, email, password, role, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invitation.clinic_id, name, invitation.email, hashedPassword, assignedRole, phone || null]
    );

    await pool.query(`UPDATE staff_invitations SET is_accepted = 1 WHERE id = ?`, [invitation.id]);

    return Response.json({
      success: true,
      message: `Akun staf berhasil didaftarkan dengan hak akses [${assignedRole}]`,
      user_id: userRes.insertId,
      assigned_role: assignedRole,
      clinic_id: invitation.clinic_id,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

