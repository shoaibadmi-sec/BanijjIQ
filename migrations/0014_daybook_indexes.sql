-- Day Book / unified transaction centre read-path support.
-- Read-only module: no new posting tables or duplicate business logic.
INSERT OR IGNORE INTO app_settings(setting_key, setting_value)
VALUES ('Day Book Editable Days', '0');

CREATE INDEX IF NOT EXISTS idx_sales_daybook
  ON sales(sale_date, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_daybook
  ON purchases(purchase_date, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_returns_daybook
  ON sales_returns(return_date, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_daybook
  ON purchase_returns(return_date, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_daybook
  ON customer_ledger(date, type, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_daybook
  ON supplier_ledger(date, type, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_daybook
  ON expenses(expense_date, status, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_book_daybook
  ON bank_book(date, is_deleted, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_transfers_daybook
  ON bank_transfers(transfer_date, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_book_running
  ON cash_book(created_at, is_deleted);
CREATE INDEX IF NOT EXISTS idx_stock_movements_daybook
  ON stock_movements(created_at, movement_type);
