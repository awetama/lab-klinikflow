import { handleGetMe, handleLogin } from './auth';
import { handleListServices, handleUpdateServiceFee } from './services';
import { handleAcceptInvitation, handleListInvitations, handleListStaff } from './staff';
import { handleCreatePatient, handleListPatients } from './patients';
import { handleCreateVisit, handleGetVisitByUuid, handleListVisits } from './visits';
import { handleGetInvoiceDetail, handleListInvoices, handleProcessPayment } from './invoices';
import { proxyToPhp } from './proxy';
import { CORS_ORIGINS, logAndGeneric } from './config';
import { requireAuth, resolveClinicId } from './middleware/guard';
import pool from './db';

const PORT = parseInt(process.env.PORT || '3000', 10);

/** Endpoint yang memang boleh diakses tanpa token. */
const PUBLIC_ROUTES: Array<{ path: string; method: string }> = [
  { path: '/api/auth/login', method: 'POST' },
  { path: '/api/health', method: 'GET' },
];

function isPublic(path: string, method: string): boolean {
  return PUBLIC_ROUTES.some((route) => route.path === path && route.method === method);
}

/**
 * CORS: hanya origin yang terdaftar di env CORS_ORIGINS.
 * Tidak ada lagi wildcard '*'.
 */
function setCorsHeaders(req: Request, resHeaders: Headers): void {
  const origin = req.headers.get('Origin');
  if (origin && CORS_ORIGINS.includes(origin)) {
    resHeaders.set('Access-Control-Allow-Origin', origin);
    resHeaders.set('Vary', 'Origin');
    resHeaders.set('Access-Control-Allow-Credentials', 'true');
  }
  resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  resHeaders.set('Access-Control-Max-Age', '600');
}

/** Header keamanan dasar untuk semua respons. */
function setSecurityHeaders(resHeaders: Headers): void {
  resHeaders.set('X-Content-Type-Options', 'nosniff');
  resHeaders.set('X-Frame-Options', 'DENY');
  resHeaders.set('Referrer-Policy', 'no-referrer');
  resHeaders.set('Cache-Control', 'no-store');
}

Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') {
      const headers = new Headers();
      setCorsHeaders(req, headers);
      return new Response(null, { status: 204, headers });
    }

    try {
      // Gerbang autentikasi: semua route non-publik wajib punya token valid.
      if (!isPublic(path, method)) {
        requireAuth(req);
      }

      let response: Response;

      if (path === '/api/health' && method === 'GET') {
        response = Response.json({ success: true, service: 'klinikflow-bff', status: 'ok' });
      }

      // 1. Auth routes
      else if (path === '/api/auth/login' && method === 'POST') {
        response = await handleLogin(req);
      } else if (path === '/api/auth/me' && method === 'GET') {
        response = await handleGetMe(req);
      } else if (path === '/api/auth/logout' && method === 'POST') {
        response = Response.json({ success: true, message: 'Logout berhasil' });
      }

      // 2. Services catalog & Fee adjustment (khusus admin/manager, scoped klini)
      else if (path === '/api/services' && method === 'GET') {
        response = await handleListServices(req);
      } else if ((path === '/api/services/fee' || path === '/api/services/update-fee') && (method === 'POST' || method === 'PUT')) {
        response = await handleUpdateServiceFee(req);
      }

      // 3. Staff & Invitation routes (admin/manager, scoped klini)
      else if (path === '/api/staff' && method === 'GET') {
        response = await handleListStaff(req);
      } else if (path === '/api/staff/invitations' && method === 'GET') {
        response = await handleListInvitations(req);
      } else if (path === '/api/staff/accept-invitation' && method === 'POST') {
        response = await handleAcceptInvitation(req);
      }

      // 4. Patients routes
      else if (path === '/api/patients' && method === 'GET') {
        response = await handleListPatients(req);
      } else if (path === '/api/patients' && method === 'POST') {
        response = await handleCreatePatient(req);
      }

      // 5. Visits routes
      else if (path === '/api/visits' && method === 'GET') {
        response = await handleListVisits(req);
      } else if (path === '/api/visits' && method === 'POST') {
        response = await handleCreateVisit(req);
      } else if (path.startsWith('/api/visits/') && method === 'GET') {
        const uuid = path.split('/')[3];
        if (!uuid) {
          response = Response.json({ success: false, error: 'UUID kunjungan tidak valid' }, { status: 400 });
        } else {
          response = await handleGetVisitByUuid(req, uuid);
        }
      }

      // 6. Invoices & Payments
      else if (path === '/api/invoices' && method === 'GET') {
        response = await handleListInvoices(req);
      } else if (path.startsWith('/api/invoices/') && method === 'GET') {
        const invId = parseInt(path.split('/')[3], 10);
        if (!Number.isInteger(invId) || invId <= 0) {
          response = Response.json({ success: false, error: 'ID tagihan tidak valid' }, { status: 400 });
        } else {
          response = await handleGetInvoiceDetail(req, invId);
        }
      } else if (path === '/api/payments/process' && method === 'POST') {
        response = await handleProcessPayment(req);
      }

      // 7. Dashboard Stats (scoped klini)
      else if (path === '/api/dashboard/stats' && method === 'GET') {
        response = await handleDashboardStats(req);
      }

      // 8. PHP legacy service proxy (identitas diteruskan lewat JWT, bukan header X-User-*)
      else if (path === '/api/reports/export') {
        response = await proxyToPhp(req, 'export_report.php');
      } else if (path === '/api/reports' && method === 'GET') {
        response = await proxyToPhp(req, 'reports.php');
      } else if (path === '/api/claims' && method === 'GET') {
        response = await proxyToPhp(req, 'claims.php', 'list');
      } else if (path === '/api/claims/approve' && method === 'POST') {
        response = await proxyToPhp(req, 'claims.php', 'approve');
      } else if (path.startsWith('/api/claims/') && method === 'GET') {
        const claimId = path.split('/')[3];
        response = await proxyToPhp(req, 'claims.php', 'detail', { id: claimId });
      } else if (path === '/api/attachments' && method === 'GET') {
        response = await proxyToPhp(req, 'attachments.php', 'list');
      } else if (path.startsWith('/api/attachments/') && method === 'GET') {
        const attUuid = path.split('/')[3];
        response = await proxyToPhp(req, 'attachments.php', 'get', { uuid: attUuid });
      }

      // 404
      else {
        response = Response.json({ success: false, error: 'Endpoint KlinikFlow tidak ditemukan' }, { status: 404 });
      }

      const headers = new Headers(response.headers);
      setCorsHeaders(req, headers);
      setSecurityHeaders(headers);

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (err) {
      const headers = new Headers();
      setCorsHeaders(req, headers);
      setSecurityHeaders(headers);
      const status = (err as any)?.status ?? 500;
      const message = status === 500 ? logAndGeneric('gateway', err) : (err as Error).message;
      return Response.json({ success: false, error: message }, { status, headers });
    }
  },
});

console.log(`[KlinikFlow BFF] Gateway berjalan di port ${PORT}`);

async function handleDashboardStats(req: Request): Promise<Response> {
  const user = requireAuth(req);
  const clinicId = resolveClinicId(user, new URL(req.url).searchParams.get('clinic_id'));

  const [patientCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM patients WHERE clinic_id = ?', [clinicId]);
  const [visitCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM visits WHERE clinic_id = ?', [clinicId]);
  const [invoiceCount] = await pool.query<any[]>(
    'SELECT COUNT(*) as count FROM invoices WHERE status = "unpaid" AND clinic_id = ?',
    [clinicId]
  );
  const [claimCount] = await pool.query<any[]>(
    'SELECT COUNT(*) as count FROM claims WHERE status = "submitted" AND clinic_id = ?',
    [clinicId]
  );

  const [recentVisits] = await pool.query<any[]>(
    `SELECT v.*, p.full_name as patient_name, c.name as clinic_name
     FROM visits v
     JOIN patients p ON v.patient_id = p.id
     JOIN clinics c ON v.clinic_id = c.id
     WHERE v.clinic_id = ?
     ORDER BY v.id DESC LIMIT 5`,
    [clinicId]
  );

  return Response.json({
    success: true,
    data: {
      total_patients: patientCount[0].count,
      total_visits: visitCount[0].count,
      unpaid_invoices: invoiceCount[0].count,
      pending_claims: claimCount[0].count,
      recent_visits: recentVisits,
    },
  });
}
