-- ============================================================
--  AngkorSearch v2.3 — Auth Migration
--  Run this against an existing v2.x database to add RBAC + auth tables.
--  Safe to run multiple times (all statements are idempotent).
-- ============================================================

-- ─────────────────────────────────────────
-- Roles
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

INSERT INTO roles (id, name, description) VALUES
    (1, 'user',  'Regular registered user'),
    (2, 'admin', 'Administrator with full system access')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

INSERT INTO permissions (name, description) VALUES
    ('search',           'Search the index'),
    ('bookmark:create',  'Create bookmarks'),
    ('bookmark:read',    'Read own bookmarks'),
    ('bookmark:delete',  'Delete own bookmarks'),
    ('history:read',     'Read own search history'),
    ('history:delete',   'Delete own search history'),
    ('profile:update',   'Update own profile'),
    ('account:delete',   'Delete own account'),
    ('admin:users',      'View and manage all users'),
    ('admin:stats',      'View admin statistics'),
    ('admin:crawl',      'Manage crawl queue')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────
-- Role Permissions (RBAC join table)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- user role: all non-admin permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions WHERE name NOT LIKE 'admin:%'
ON CONFLICT DO NOTHING;

-- admin role: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- Users — add new columns (safe with IF NOT EXISTS)
-- ─────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS username       TEXT        NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url     TEXT        NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio            TEXT        NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS website        TEXT        NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS location       TEXT        NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id      TEXT        UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id      TEXT        UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id        INT         REFERENCES roles(id) DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active      BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login     TIMESTAMPTZ;

-- If users table doesn't exist at all, create it fresh
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    username       TEXT NOT NULL DEFAULT '',
    password_hash  TEXT,
    avatar_url     TEXT NOT NULL DEFAULT '',
    bio            TEXT NOT NULL DEFAULT '',
    website        TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    google_id      TEXT UNIQUE,
    github_id      TEXT UNIQUE,
    role_id        INT NOT NULL REFERENCES roles(id) DEFAULT 1,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    last_login     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id   ON users(role_id);

-- ─────────────────────────────────────────
-- Sessions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id         CHAR(64) PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ─────────────────────────────────────────
-- Email Verifications
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verifications (
    user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token      CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Password Resets
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
    user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token      CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
