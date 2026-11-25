import pool from './db';

// Handler Tagihan Medis & Simulasi Pembayaran
export async function handleListInvoices(req: Request): Promise<Response> {
  const [rows] = await pool.query<any[]>(
    `SELECT i.*, p.full_name as patient_name, p.mrn, c.name as clinic_name, v.doctor_name, v.visit_date
     FROM invoices i
     JOIN patients p ON i.patient_id = p.id
     JOIN clinics c ON i.clinic_id = c.id
     JOIN visits v ON i.visit_id = v.id
     ORDER BY i.id DESC`
  );

  return Response.json({ success: true, data: rows });
}

export async function handleGetInvoiceDetail(invoiceId: number): Promise<Response> {
  const [invRows] = await pool.query<any[]>(
    `SELECT i.*, p.full_name as patient_name, p.mrn, p.phone, p.address, c.name as clinic_name, c.code as clinic_code,
            v.doctor_name, v.visit_date
     FROM invoices i
     JOIN patients p ON i.patient_id = p.id
     JOIN clinics c ON i.clinic_id = c.id
     JOIN visits v ON i.visit_id = v.id
     WHERE i.id = ?`,
    [invoiceId]
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
}

// Celah Business Logic: Settlement Replay / Duplicate Payment Processing
// Endpoint memproses transaksi pembayaran tagihan tanpa validasi status awal invoice
// (memungkinkan pembayaran tagihan yang sama diproses berulang kali, menggelembungkan log penerimaan keuangan).
export async function handleProcessPayment(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { invoice_id, amount, method = 'qris' } = body;

    if (!invoice_id || !amount) {
      return Response.json({ success: false, error: 'ID tagihan dan nominal pembayaran wajib diisi' }, { status: 400 });
    }

    const [invRows] = await pool.query<any[]>('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (invRows.length === 0) {
      return Response.json({ success: false, error: 'Tagihan tidak ditemukan' }, { status: 404 });
    }

    const invoice = invRows[0];
    const paymentRef = `PAY-2026-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Business Logic Flaw: Tidak mengecek apakah invoice.status sudah 'paid'
    const [payRes] = await pool.query<any>(
      `INSERT INTO payments (payment_ref, invoice_id, amount, method, settlement_status, paid_at)
       VALUES (?, ?, ?, ?, 'settled', NOW())`,
      [paymentRef, invoice_id, parseFloat(amount), method]
    );

    await pool.query(
      `UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ?`,
      [invoice_id]
    );

    return Response.json({
      success: true,
      message: `Pembayaran sebesar Rp ${Number(amount).toLocaleString('id-ID')} berhasil diproses`,
      payment_id: payRes.insertId,
      payment_ref: paymentRef,
      invoice_number: invoice.invoice_number,
      previous_status: invoice.status,
      current_status: 'paid',
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

