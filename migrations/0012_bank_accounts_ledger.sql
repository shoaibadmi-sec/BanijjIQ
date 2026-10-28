-- Bank Accounts + Bank Ledger + Manual Entry + Transfers
-- Ported from BankAccounts.gs / BankBook.gs / BankLedger.gs / bank.html

ALTER TABLE bank_book ADD COLUMN bank_account_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_book ADD COLUMN balance REAL NOT NULL DEFAULT 0;
ALTER TABLE bank_book ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_book ADD COLUMN status TEXT NOT NULL DEFAULT 'Active';
ALTER TABLE bank_book ADD COLUMN reversal_of TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_book ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_book ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bank_book ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bank_book ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS bank_transfers (
  transfer_id TEXT PRIMARY KEY,
  transfer_date TEXT NOT NULL,
  from_account_id TEXT NOT NULL,
  from_account_name TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  to_account_name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_book_account_date ON bank_book(bank_account_id, date, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_book_status ON bank_book(bank_account_id, status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_bank_book_reversal ON bank_book(reversal_of);
CREATE INDEX IF NOT EXISTS idx_bank_transfers_date ON bank_transfers(transfer_date DESC, created_at DESC);

UPDATE bank_book
SET bank_account_name = COALESCE((SELECT account_name FROM bank_accounts b WHERE b.bank_account_id = bank_book.bank_account_id), '')
WHERE bank_account_name = '';
