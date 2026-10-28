-- V28 Users + Roles / RBAC
-- Built-in Administrator remains represented internally by app_users.role='admin'.
-- Custom roles live here and are referenced by name from app_users.role.
CREATE TABLE IF NOT EXISTS app_roles (
  role_id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  allowed_modules TEXT NOT NULL DEFAULT '',
  permissions_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_roles_status_name
ON app_roles(status, role_name);

ALTER TABLE app_users ADD COLUMN created_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_app_users_role_status
ON app_users(role, status);
