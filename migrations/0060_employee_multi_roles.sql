-- Phase 8: source-authoritative employee roleIds can hold multiple custom roles.
-- Keep app_users.role as the backwards-compatible primary role and Administrator sentinel.
CREATE TABLE IF NOT EXISTS app_user_roles (
  user_id TEXT NOT NULL,
  role_name TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (user_id, role_name),
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (role_name) REFERENCES app_roles(role_name) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_app_user_roles_role ON app_user_roles(role_name);
INSERT OR IGNORE INTO app_user_roles (user_id, role_name)
SELECT u.user_id, u.role FROM app_users u
JOIN app_roles r ON r.role_name=u.role
WHERE u.role<>'admin';
