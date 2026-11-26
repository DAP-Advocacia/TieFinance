-- Contas bancarias por CNPJ pagador + historico de extratos importados + conta no agendamento.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id VARCHAR(32) PRIMARY KEY,
  company_id VARCHAR(32) NOT NULL REFERENCES companies (id),
  bank VARCHAR(60) NOT NULL,
  kind VARCHAR(10) NOT NULL,            -- 'extrato' (arquivo exportado) | 'api' (Asaas, Luna Pay, EFI: integracao futura)
  nickname VARCHAR(80) NOT NULL,
  agency VARCHAR(20) NOT NULL,
  account VARCHAR(30) NOT NULL,
  active BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bank_accounts_company ON bank_accounts (company_id);

CREATE TABLE IF NOT EXISTS statement_imports (
  id SERIAL PRIMARY KEY,
  bank_account_id VARCHAR(32) NOT NULL REFERENCES bank_accounts (id),
  filename VARCHAR(200) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  imported_by VARCHAR(32) REFERENCES users (id),
  imported_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  lines INTEGER NOT NULL,
  paid INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_statement_imports_hash ON statement_imports (bank_account_id, file_hash);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(32) REFERENCES bank_accounts (id);
CREATE INDEX IF NOT EXISTS ix_payments_bank ON payments (bank_account_id);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_imports ENABLE ROW LEVEL SECURITY;
