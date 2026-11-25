import { extractAuthUser } from './auth';

const PHP_API_BASE = process.env.PHP_API_URL || 'http://php-api';

/** Skrip PHP yang boleh dipanggil — mencegah path injection ke skrip lain. */
const ALLOWED_SCRIPTS = new Set(['export_report.php', 'reports.php', 'claims.php', 'attachments.php']);

export async function proxyToPhp(
  req: Request,
  targetScript: string,
  actionOverride?: string,
  extraParams?: Record<string, string>
): Promise<Response> {
  if (!ALLOWED_SCRIPTS.has(targetScript)) {
    return Response.json({ success: false, error: 'Target layanan tidak dikenal' }, { status: 400 });
  }

  const url = new URL(req.url);
  const user = extractAuthUser(req);
  if (!user) {
    return Response.json({ success: false, error: 'Sesi tidak valid atau telah berakhir' }, { status: 401 });
  }

  const targetUrl = new URL(`${PHP_API_BASE}/${targetScript}`);
  url.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val);
  });

  if (actionOverride) {
    targetUrl.searchParams.set('action', actionOverride);
  }

  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      targetUrl.searchParams.set(k, v);
    }
  }

  const headers = new Headers();
  headers.set('Content-Type', req.headers.get('Content-Type') || 'application/json');

  // PERBAIKAN: teruskan JWT asli; php-api memverifikasi tanda tangannya sendiri.
  // Header X-User-Id/X-User-Role/X-Clinic-Id tidak lagi dikirim karena bisa dipalsukan.
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    headers.set('Authorization', authHeader);
  }

  const method = req.method;
  let body: any = undefined;

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    try {
      body = await req.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const phpRes = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
    });

    const resBody = await phpRes.text();
    const contentType = phpRes.headers.get('Content-Type') || 'application/json';

    return new Response(resBody, {
      status: phpRes.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    return Response.json({
      success: false,
      error: `Gagal meneruskan request ke PHP legacy service: ${error.message}`,
    }, { status: 502 });
  }
}

