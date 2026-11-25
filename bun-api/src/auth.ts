import jwt from 'jsonwebtoken';
import pool from './db';
import { JWT_ALGORITHM, JWT_EXPIRES_IN, JWT_SECRET, logAndGeneric } from './config';

/**
 * Hash dummy (bcrypt) untuk menyamakan waktu respons saat email tidak terdaftar,
 * sehingga penyerang tidak bisa membedakan "email tidak ada" vs "password salah".
 */
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** Pembatas percobaan login: 5 kali per 15 menit per IP+email. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginKey(req: Request, email: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return `${ip}:${email.toLowerCase()}`;
}

function isRateLimited(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailure(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
  if (loginAttempts.size > 10_000) {
    for (const [k, v] of loginAttempts) if (now > v.resetAt) loginAttempts.delete(k);
  }
}

export interface UserPayload {
  id: number;
  clinic_id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'cashier' | 'patient';
  phone?: string;
  clinic_name?: string;
}

export function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      clinic_id: user.clinic_id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      clinic_name: user.clinic_name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM }
  );
}

export function verifyToken(token: string): UserPayload | null {
  try {
    // Pin algoritma: mencegah token dengan header alg berbeda (mis. alg=none).
    return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as UserPayload;
  } catch {
    return null;
  }
}

export function extractAuthUser(req: Request): UserPayload | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyToken(token);
}

export async function handleLogin(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return Response.json({ success: false, error: 'Email dan password wajib diisi' }, { status: 400 });
    }

    const key = loginKey(req, email);
    if (isRateLimited(key)) {
      return Response.json(
        { success: false, error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
        { status: 429 }
      );
    }

    const [rows] = await pool.query<any[]>(
      `SELECT u.*, c.name as clinic_name 
       FROM users u 
       JOIN clinics c ON u.clinic_id = c.id 
       WHERE u.email = ?`,
      [email]
    );

    const user = rows[0];
    // Selalu jalankan verifikasi (dengan hash dummy bila user tidak ada)
    // agar waktu respons tidak membocorkan apakah email terdaftar.
    const hashToCheck = user?.password ?? DUMMY_HASH;
    let isPasswordValid = false;
    try {
      isPasswordValid = await Bun.password.verify(password, hashToCheck);
    } catch {
      isPasswordValid = false;
    }

    if (!user || !isPasswordValid) {
      registerFailure(key);
      return Response.json({ success: false, error: 'Kredensial login klinik tidak valid' }, { status: 401 });
    }

    const payload: UserPayload = {
      id: user.id,
      clinic_id: user.clinic_id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      clinic_name: user.clinic_name,
    };

    const token = generateToken(payload);

    return Response.json({
      success: true,
      message: 'Login berhasil',
      token,
      user: payload,
    });
  } catch (error) {
    return Response.json({ success: false, error: logAndGeneric('login', error) }, { status: 500 });
  }
}

export async function handleGetMe(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Sesi tidak valid atau telah berakhir' }, { status: 401 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.clinic_id, u.name, u.email, u.role, u.phone, c.name as clinic_name
     FROM users u
     JOIN clinics c ON u.clinic_id = c.id
     WHERE u.id = ?`,
    [currentUser.id]
  );

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Pengguna tidak ditemukan' }, { status: 404 });
  }

  return Response.json({ success: true, user: rows[0] });
}

