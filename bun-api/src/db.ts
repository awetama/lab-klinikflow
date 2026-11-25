import mysql from 'mysql2/promise';

/**
 * Kredensial TIDAK boleh punya nilai default: aplikasi harus gagal start
 * kalau env belum diisi, bukan diam-diam memakai password yang ada di repo.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[db] Environment variable ${name} wajib di-set`);
  return value;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASS'),
  database: process.env.DB_NAME || 'klinikflow_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Batasi waktu query agar tidak ada query menggantung tanpa batas.
  connectTimeout: 10_000,
});

export default pool;

