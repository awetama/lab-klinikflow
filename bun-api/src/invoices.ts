import { errorResponse, parsePagination, requireAuth, requireRole, resolveClinicId } from './middleware/guard';
import pool from './db';

// Semua endpoint tagihan wajib login dan dibatasi ke klini pemanggil.
export async function handleListInvoices(req: Request): Promise<Response> {
  try {
    const user = requireAuth(req);
    const url = new URL(req.url);
    const clinicId = resolveClinicId(user, url.searchParams.get('clinic_id'));
    const { limit, offset } = parsePagination(url);

    const [rows] = await pool.query<any[]>(
      `SELECT i.*, p.full_name as patient_name, p.mrn, c.name as clinic_name, v.doctor_name, v.visit_date
       FROM invoices i
       JOIN patients p ON i.patient_id = p.id
       JOIN clinics c ON i.clinic_id = c.id
       JOIN visits v ON i.visit_id = v.id
       WHERE i.clinic_id = ?
       ORDER BY i.id DESC
       LIMIT ? OFFSET ?`,
      [clinicId, limit, offset]
    );

    return Response.json({ success: true, data: rows, pagination: { limit, offset } });
  } catch (err) {
    return errorResponse(err, 'list-invoices');
  }
}

export async function handleGetInvoiceDetail(req: Request, invoiceId: number): Promise<Response> {
  try {
    const user = requireAuth(req);
    const clinicId = resolveClinicId(user);

    const [invRows] = await pool.query<any[]>(
      `SELECT i.*, p.full_name as patient_name, p.mrn, p.phone, p.address, c.name as clinic_name, c.code as clinic_code,
              v.doctor_name, v.visit_date
       FROM invoices i
       JOIN patients p ON i.patient_id = p.id
       JOIN clinics c ON i.clinic_id = c.id
       JOIN visits v ON i.visit_id = v.id
       WHERE i.id = ? AND i.clinic_id = ?`,
      [invoiceId, clinicId]
    );

    if (invRows.length === 0) {
      return Response.json({ success: false, error: 'Tagihan tidak ditemukan' }, { status: 404 });
    }

    const invoice = invRows[0];

    const [items] = await pool.query<any[]>(
      `SELECT ii.*, s.name as service_name, s.code as service_code, s.category
       FROM invoice_items ii
       JOIN services s ON ii.service_id = s.id
       WHERE ii.invoice_id = ?`,
      [invoiceId]
    );
    invoice.items = items;

    const [payments] = await pool.query<any[]>(
      `SELECT * FROM payments WHERE invoice_id = ? ORDER BY id DESC`,
      [invoiceId]
    );
    invoice.payments = payments;

    return Response.json({ success: true, data: invoice });
  } catch (err) {
    return errorResponse(err, 'get-invoice');
  }
}

/**
 * Proses pembayaran tagihan.
 *
 * Perbaikan atas "settlement replay":
 * - hanya kasir/admin/manager,
 * - tagihan harus milik klini pemanggil,
 * - baris invoice dikunci (SELECT ... FOR UPDATE) di dalam transaksi,
 * - tagihan yang sudah lunas ditolak (409),
 * - nominal tidak boleh melebihi sisa tagihan,
 * - referensi pembayaran dibuat acak kriptografis.
 */
export async function handleProcessPayment(req: Request): Promise<Response> {
  const conn = await pool.getConnection();
  try {
    const user = requireRole(requireAuth(req), ['admin', 'manager', 'cashier']);
    const clinicId = resolveClinicId(user);

    const body = await req.json();
    const { invoice_id, method = 'qris' } = body;
    const amount = parseFloat(body.amount);

    if (!invoice_id || !Number.isFinite(amount) || amount <= 0) {
      return Response.json({ success: false, error: 'ID tagihan dan nominal pembayaran wajib diisi' }, { status: 400 });
    }
    const allowedMethods = ['cash', 'qris', 'bank_transfer', 'insurance'];
    if (!allowedMethods.includes(method)) {
      return Response.json({ success: false, error: 'Metode pembayaran tidak valid' }, { status: 400 });
    }

    await conn.beginTransaction();

    const [invRows] = await conn.query<any[]>(
      'SELECT * FROM invoices WHERE id = ? AND clinic_id = ? FOR UPDATE',
      [invoice_id, clinicId]
    );

    if (invRows.length === 0) {
      await conn.rollback();
      return Response.json({ success: false, error: 'Tagihan tidak ditemukan' }, { status: 404 });
    }

    const invoice = invRows[0];
    if (invoice.status === 'paid') {
      await conn.rollback();
      return Response.json({ success: false, error: 'Tagihan ini sudah lunas' }, { status: 409 });
    }
    if (invoice.status === 'cancelled') {
      await conn.rollback();
      return Response.json({ success: false, error: 'Tagihan sudah dibatalkan' }, { status: 409 });
    }

    // Sisa tagihan = total invoice dikurangi pembayaran yang sudah tercatat.
    const [paidRows] = await conn.query<any[]>(
      'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?',
      [invoice_id]
    );
    const alreadyPaid = Number(paidRows[0].paid);
    const outstanding = Number(invoice.amount) - alreadyPaid;

    if (amount > outstanding + 0.001) {
      await conn.rollback();
      return Response.json(
        { success: false, error: `Nominal melebihi sisa tagihan (sisa Rp ${outstanding.toLocaleString('id-ID')})` },
        { status: 400 }
      );
    }

    const paymentRef = `PAY-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

    const [payRes] = await conn.query<any>(
      `INSERT INTO payments (payment_ref, invoice_id, amount, method, settlement_status, paid_at)
       VALUES (?, ?, ?, ?, 'settled', NOW())`,
      [paymentRef, invoice_id, amount, method]
    );

    const fullyPaid = alreadyPaid + amount >= Number(invoice.amount) - 0.001;
    await conn.query(
      `UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?`,
      [fullyPaid ? 'paid' : 'partially_paid', fullyPaid ? new Date() : null, invoice_id]
    );

    await conn.query(
      `INSERT INTO audit_logs (clinic_id, user_id, action, entity, entity_id, detail)
       VALUES (?, ?, 'invoice.payment.process', 'payments', ?, ?)`,
      [clinicId, user.id, String(payRes.insertId), JSON.stringify({ invoice_id, amount, method })]
    ).catch(() => undefined);

    await conn.commit();

    return Response.json({
      success: true,
      message: `Pembayaran sebesar Rp ${amount.toLocaleString('id-ID')} berhasil diproses`,
      payment_id: payRes.insertId,
      payment_ref: paymentRef,
      invoice_number: invoice.invoice_number,
      previous_status: invoice.status,
      current_status: fullyPaid ? 'paid' : 'partially_paid',
      outstanding_after: Math.max(outstanding - amount, 0),
    });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    return errorResponse(err, 'process-payment');
  } finally {
    conn.release();
  }
}

