import { extractAuthUser, handleGetMe, handleLogin } from './auth';
import { handleListServices, handleUpdateServiceFee } from './services';
import { handleAcceptInvitation, handleListInvitations, handleListStaff } from './staff';
import { handleCreatePatient, handleListPatients } from './patients';
import { handleCreateVisit, handleGetVisitByUuid, handleListVisits } from './visits';
import { handleGetInvoiceDetail, handleListInvoices, handleProcessPayment } from './invoices';
import { proxyToPhp } from './proxy';
import pool from './db';

const PORT = parseInt(process.env.PORT || '3000', 10);

function setCorsHeaders(resHeaders: Headers): void {
  resHeaders.set('Access-Control-Allow-Origin', '*');
  resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') {
      const headers = new Headers();
      setCorsHeaders(headers);
      return new Response(null, { status: 204, headers });
    }

    try {
      let response: Response;

      // 1. Auth routes
      if (path === '/api/auth/login' && method === 'POST') {
        response = await handleLogin(req);
      } else if (path === '/api/auth/me' && method === 'GET') {
        response = await handleGetMe(req);
      } else if (path === '/api/auth/logout' && method === 'POST') {
        response = Response.json({ success: true, message: 'Logout berhasil' });
      }

      // 2. Services catalog & Fee adjustment (IDOR Perubahan Biaya/Harga)
      else if (path === '/api/services' && method === 'GET') {
        response = await handleListServices(req);
      } else if ((path === '/api/services/fee' || path === '/api/services/update-fee') && (method === 'POST' || method === 'PUT')) {
        response = await handleUpdateServiceFee(req);
      }

      // 3. Staff & Invitation routes (Privilege Escalation)
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
        response = await handleGetVisitByUuid(uuid);
      }

      // 6. Invoices & Payments (Business Logic settlement replay)
      else if (path === '/api/invoices' && method === 'GET') {
        response = await handleListInvoices(req);
      } else if (path.startsWith('/api/invoices/') && method === 'GET') {
        const invId = parseInt(path.split('/')[3], 10);
        response = await handleGetInvoiceDetail(invId);
      } else if (path === '/api/payments/process' && method === 'POST') {
        response = await handleProcessPayment(req);
      }

      // 7. Dashboard Stats
      else if (path === '/api/dashboard/stats' && method === 'GET') {
        response = await handleDashboardStats(req);
      }

      // 8. PHP Legacy Service Proxy Routes
      // Report export (RCE)
      else if (path === '/api/reports/export') {
        response = await proxyToPhp(req, 'export_report.php');
      }
      // Report viewing (Reflected XSS)
      else if (path === '/api/reports' && method === 'GET') {
        response = await proxyToPhp(req, 'reports.php');
      }
      // Claims (Business Logic Replay & BOLA)
      else if (path === '/api/claims' && method === 'GET') {
        response = await proxyToPhp(req, 'claims.php', 'list');
      } else if (path === '/api/claims/approve' && method === 'POST') {
        response = await proxyToPhp(req, 'claims.php', 'approve');
      } else if (path.startsWith('/api/claims/') && method === 'GET') {
        const claimId = path.split('/')[3];
        response = await proxyToPhp(req, 'claims.php', 'detail', { id: claimId });
      }
      // Attachments (BOLA UUID)
      else if (path === '/api/attachments' && method === 'GET') {
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
      setCorsHeaders(headers);

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (err: any) {
      const headers = new Headers();
      setCorsHeaders(headers);
      return Response.json({ success: false, error: err.message }, { status: 500, headers });
    }
  },
});

console.log(`[KlinikFlow BFF] Gateway berjalan di port ${PORT}`);

async function handleDashboardStats(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  const [patientCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM patients');
  const [visitCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM visits');
  const [invoiceCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM invoices WHERE status = "unpaid"');
  const [claimCount] = await pool.query<any[]>('SELECT COUNT(*) as count FROM claims WHERE status = "submitted"');

  const [recentVisits] = await pool.query<any[]>(
    `SELECT v.*, p.full_name as patient_name, c.name as clinic_name
     FROM visits v
     JOIN patients p ON v.patient_id = p.id
     JOIN clinics c ON v.clinic_id = c.id
     ORDER BY v.id DESC LIMIT 5`
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

