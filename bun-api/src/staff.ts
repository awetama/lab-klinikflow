import { requireAuth, requireRole, resolveClinicId, errorResponse, sanitizeText, MANAGEMENT_ROLES } from './middleware/guard';
import pool from './db';

// Handler Manajemen & Undangan Staf Klinik (selalu dibatasi ke klini pemanggil)
export async function handleListStaff(req: Request): Promise<Response> {
  try {
    const user = requireRole(requireAuth(req), MANAGEMENT_ROLES);
    const clinicId = resolveClinicId(user);

    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.name, u.email, u.role, u.phone, c.name as clinic_name, u.created_at
       FROM users u
       JOIN clinics c ON u.clinic_id = c.id
       WHERE u.clinic_id = ? AND u.role IN ('admin', 'manager', 'staff', 'cashier')
       ORDER BY u.id ASC`,
      [clinicId]
    );

    return Response.json({ success: true, data: rows });
  } catch (err) {
    return errorResponse(err, 'list-staff');
  }
}

// Daftar undangan: wajib login + role manajemen + hanya klini sendiri.
// (sebelumnya terbuka tanpa autentikasi sehingga token undangan bisa dipanen
//  lalu dipakai untuk membuat akun admin — lihat F-22 & F-04)
export async function handleListInvitations(req: Request): Promise<Response> {
  try {
    const user = requireRole(requireAuth(req), MANAGEMENT_ROLES);
    const clinicId = resolveClinicId(user);

    const [rows] = await pool.query<any[]>(
      `SELECT si.id, si.email, si.role, si.is_accepted, si.created_at, c.name as clinic_name
       FROM staff_invitations si
       JOIN clinics c ON si.clinic_id = c.id
       WHERE si.clinic_id = ? AND si.is_accepted = 0
       ORDER BY si.id DESC`,
      [clinicId]
    );
    return Response.json({ success: true, data: rows });
  } catch (err) {
    return errorResponse(err, 'list-invitations');
  }
}

// Penerimaan undangan: role SELALU dari baris undangan, tidak pernah dari payload klien.
export async function handleAcceptInvitation(req: Request): Promise<Response> {
  const conn = await pool.getConnection();
  try {
    const body = await req.json();
    const { token, password, phone } = body;
    const name = sanitizeText(body.name, 'Nama', 150);

    if (typeof token !== 'string' || !token || !password || typeof password !== 'string') {
      return Response.json({ success: false, error: 'Token undangan, nama, dan password wajib diisi' }, { status: 400 });
    }
    if (password.length < 12) {
      return Response.json({ success: false, error: 'Password minimal 12 karakter' }, { status: 400 });
    }

    await conn.beginTransaction();

    // Kunci baris undangan supaya token tidak bisa dipakai dua kali secara bersamaan.
    const [invRows] = await conn.query<any[]>(
      `SELECT * FROM staff_invitations WHERE token = ? AND is_accepted = 0 FOR UPDATE`,
      [token]
    );

    if (invRows.length === 0) {
      await conn.rollback();
      return Response.json({ success: false, error: 'Token undangan tidak valid atau sudah digunakan' }, { status: 404 });
    }

    const invitation = invRows[0];
    const hashedPassword = await Bun.password.hash(password);

    // PERBAIKAN: role diambil dari undangan, bukan dari body request.
    const assignedRole = invitation.role || 'staff';
    const allowedInviteRoles = ['staff', 'cashier', 'manager'];
    if (!allowedInviteRoles.includes(assignedRole)) {
      await conn.rollback();
      return Response.json({ success: false, error: 'Role undangan tidak valid' }, { status: 400 });
    }

    const [userRes] = await conn.query<any>(
      `INSERT INTO users (clinic_id, name, email, password, role, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invitation.clinic_id, name, invitation.email, hashedPassword, assignedRole, phone || null]
    );

    await conn.query(`UPDATE staff_invitations SET is_accepted = 1 WHERE id = ?`, [invitation.id]);

    await conn.query(
      `INSERT INTO audit_logs (clinic_id, user_id, action, entity, entity_id, detail)
       VALUES (?, ?, 'staff.invitation.accept', 'users', ?, ?)`,
      [invitation.clinic_id, userRes.insertId, String(userRes.insertId), JSON.stringify({ role: assignedRole })]
    ).catch(() => undefined);

    await conn.commit();

    return Response.json({
      success: true,
      message: `Akun staf berhasil didaftarkan dengan hak akses [${assignedRole}]`,
      user_id: userRes.insertId,
      assigned_role: assignedRole,
      clinic_id: invitation.clinic_id,
    });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    return errorResponse(err, 'accept-invitation');
  } finally {
    conn.release();
  }
}

