/**
 * Konfigurasi terpusat + validasi environment.
 *
 * Prinsip: fail-fast. Aplikasi menolak start kalau secret belum di-set,
 * supaya tidak diam-diam jatuh ke nilai default yang bisa ditebak penyerang.
 */

function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[config] Environment variable ${name} wajib di-set`);
  }
  if (value.trim().length < minLength) {
    throw new Error(`[config] ${name} terlalu pendek (minimal ${minLength} karakter)`);
  }
  return value;
}

export const JWT_SECRET: string = required('JWT_SECRET', 32);
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_EXPIRES_IN = '24h';

/** Daftar origin yang diizinkan (dipisah koma). Wajib eksplisit, bukan '*'. */
export const CORS_ORIGINS: string[] = required('CORS_ORIGINS')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Pesan error untuk client — jangan pernah bocorkan detail internal. */
export const GENERIC_ERROR = 'Terjadi kesalahan pada server';

/**
 * Catat detail error ke log server, tapi kirim pesan generik ke client.
 * Detail seperti SQL error / stack trace tidak boleh sampai ke browser.
 */
export function logAndGeneric(context: string, error: unknown): string {
  console.error(`[error] ${context}:`, error instanceof Error ? error.stack ?? error.message : error);
  return GENERIC_ERROR;
}
