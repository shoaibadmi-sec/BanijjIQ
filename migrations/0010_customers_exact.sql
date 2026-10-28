-- Customer module exact-port support from customers.html / Customer.gs / DeleteEngine.gs
ALTER TABLE customers ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN deleted_at TEXT;

ALTER TABLE customer_ledger ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN bank_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_ledger ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_ledger ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_ledger ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_ledger ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO app_settings(setting_key, setting_value) VALUES ('Delete Confirmation Key', '224411');
INSERT OR IGNORE INTO app_settings(setting_key, setting_value) VALUES ('Currency Symbol', '৳');

CREATE INDEX IF NOT EXISTS idx_customer_ledger_active_customer ON customer_ledger(customer_id, is_deleted, date);
