-- ============================================================
--  Seed admin user: admin@gmail.com / Admin@12345
--  Uses pgcrypto to generate a bcrypt hash (compatible with Go's bcrypt).
--  Run with:
--    docker exec -i angkor_postgres psql -U angkor -d angkorsearch < postgres/seed_admin.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (email, username, password_hash, role_id, email_verified, is_active)
VALUES (
    'admin@gmail.com',
    'admin',
    crypt('Admin@12345', gen_salt('bf', 12)),
    2,
    TRUE,
    TRUE
)
ON CONFLICT (email) DO UPDATE SET
    role_id        = 2,
    email_verified = TRUE,
    is_active      = TRUE,
    password_hash  = crypt('Admin@12345', gen_salt('bf', 12));
