-- KlinikFlow - Audit log untuk aksi sensitif (F-12)
-- Jalankan setelah 01_schema.sql. Pada docker-entrypoint-initdb.d file ini
-- hanya dieksekusi saat volume MySQL masih kosong; untuk database yang sudah
-- berjalan, terapkan manual:
--   docker compose exec -T mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" klinikflow_db < database/03_audit.sql

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    clinic_id INT NULL,
    user_id INT NULL,
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NULL,
    entity_id VARCHAR(64) NULL,
    detail JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_clinic_time (clinic_id, created_at),
    INDEX idx_audit_action (action, created_at),
    CONSTRAINT fk_audit_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aplikasi sebaiknya memakai user DB dengan hak terbatas (INSERT/SELECT/UPDATE/DELETE),
-- bukan DDL. Contoh pembatasan (jalankan sebagai root):
--   REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'klinikflow_user'@'%';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON klinikflow_db.* TO 'klinikflow_user'@'%';
--   FLUSH PRIVILEGES;
