-- Phase 8: preserve independent employee profile metadata for the original HisabIQ Team UI.
-- Legacy users have UNKNOWN email/join date; never infer from phone or account created_at.
ALTER TABLE app_users ADD COLUMN email TEXT;
ALTER TABLE app_users ADD COLUMN joined_date TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_unique
  ON app_users(email COLLATE NOCASE)
  WHERE email IS NOT NULL;
