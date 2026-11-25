/**
 * Helper otorisasi terpusat.
 *
 * Aturan emas: setiap handler yang menyentuh data harus (1) terautentikasi,
 * (2) memeriksa role, dan (3) memfilter berdasarkan clinic_id milik pemanggil.
 * Jangan pernah mempercayai clinic_id dari body/query klien.
 */
import { extractAuthUser, type UserPayload } from '../auth';
import { logAndGeneric } from '../config';

export type Role = UserPayload['role'];

/** Role yang boleh mengubah data konfigurasi/finansial. */
export const MANAGEMENT_ROLES: Role[] = ['admin', 'manager'];
/** Superadmin lintas klini (untuk kebutuhan pelaporan pusat). */
export const ALL_ROLES: Role[] = ['admin', 'manager', 'staff', 'cashier', 'patient'];

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Ambil user dari header Authorization; lempar 401 kalau tidak valid. */
export function requireAuth(req: Request): UserPayload {
  const user = extractAuthUser(req);
  if (!user) throw new HttpError(401, 'Sesi tidak valid atau telah berakhir');
  return user;
}

/** Pastikan user memiliki salah satu role yang diizinkan. */
export function requireRole(user: UserPayload, allowed: Role[]): UserPayload {
  if (!allowed.includes(user.role)) {
    throw new HttpError(403, 'Akses ditolak: role tidak memiliki izin untuk aksi ini');
  }
  return user;
}

/**
 * Tentukan clinic_id efektif untuk query.
 * Admin boleh melihat klini lain hanya bila secara eksplisit meminta
 * `clinic_id` yang valid; selain itu selalu kembali ke klini pemanggil.
 */
export function resolveClinicId(user: UserPayload, requested?: string | number | null): number {
  if (user.role === 'admin' && requested !== undefined && requested !== null && `${requested}` !== '') {
    const parsed = Number(requested);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, 'clinic_id tidak valid');
    return parsed;
  }
  return Number(user.clinic_id);
}

/** Validasi panjang/karakter teks bebas sebelum disimpan. */
export function sanitizeText(value: unknown, field: string, maxLength = 150): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} wajib berupa teks`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, `${field} tidak boleh kosong`);
  if (trimmed.length > maxLength) throw new HttpError(400, `${field} maksimal ${maxLength} karakter`);
  // Buang karakter kontrol (termasuk NUL) yang tidak pernah valid pada nama/alamat.
  return trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
}

/** Paginasi dengan batas atas agar endpoint daftar tidak bisa dipakai DoS. */
export function parsePagination(url: URL, defaultLimit = 50, maxLimit = 200) {
  const rawLimit = Number(url.searchParams.get('limit') ?? defaultLimit);
  const rawOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  return { limit, offset };
}

/**
 * Ubah error menjadi Response. HttpError dikirim apa adanya;
 * error lain di-log di server dan diganti pesan generik (anti information disclosure).
 */
export function errorResponse(error: unknown, context: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ success: false, error: error.message }, { status: error.status });
  }
  return Response.json({ success: false, error: logAndGeneric(context, error) }, { status: 500 });
}
