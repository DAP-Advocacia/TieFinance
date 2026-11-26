-- Schema completo do TieFinance (equivale a migracoes 0001 a 0005).
-- Use em um banco novo. O projeto Supabase atual ja possui 0001 e 0002; a 0003 e 0004 ja estao; a 0005 (receber) ainda nao foi aplicada.
-- RLS ligado sem policies: a API REST publica do Supabase nao enxerga nada; o app acessa direto pelo Postgres.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(300) NOT NULL,
  role VARCHAR(20) NOT NULL,
  active BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES users (id),
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  cnpj VARCHAR(20) NOT NULL,
  active BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS payees (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(20) NOT NULL,
  payment_info VARCHAR(300) NOT NULL,
  active BOOLEAN NOT NULL
);
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

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(32) PRIMARY KEY,
  company_id VARCHAR(32) NOT NULL REFERENCES companies (id),
  payee_id VARCHAR(32) NOT NULL REFERENCES payees (id),
  description VARCHAR(300) NOT NULL,
  amount_cents BIGINT NOT NULL,
  pay_date DATE NOT NULL,
  cost_center VARCHAR(80) NOT NULL,
  status VARCHAR(12) NOT NULL,
  attachment VARCHAR(120),
  attachment_name VARCHAR(200),
  created_by VARCHAR(32) NOT NULL REFERENCES users (id),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  decided_by VARCHAR(32) REFERENCES users (id),
  decided_at TIMESTAMP WITHOUT TIME ZONE,
  reason VARCHAR(300),
  paid_date DATE,
  paid_via VARCHAR(12),
  paid_ref VARCHAR(300),
  bank_account_id VARCHAR(32) REFERENCES bank_accounts (id)
);
CREATE INDEX IF NOT EXISTS ix_payments_bank ON payments (bank_account_id);
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


CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(20) NOT NULL,
  contact VARCHAR(300) NOT NULL,
  active BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS receivables (
  id VARCHAR(32) PRIMARY KEY,
  company_id VARCHAR(32) NOT NULL REFERENCES companies (id),
  bank_account_id VARCHAR(32) NOT NULL REFERENCES bank_accounts (id),
  customer_id VARCHAR(32) NOT NULL REFERENCES customers (id),
  kind VARCHAR(12) NOT NULL,             -- 'honorario' | 'manutencao' | 'avulso'
  description VARCHAR(300) NOT NULL,
  amount_cents BIGINT NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL,           -- 'open' | 'received' | 'cancelled' (atraso e calculado: open e vencido)
  request_key VARCHAR(64),               -- idempotencia do lancamento (evita duplicar em duplo clique/reenvio)
  installment INTEGER NOT NULL DEFAULT 1,
  installments INTEGER NOT NULL DEFAULT 1,
  created_by VARCHAR(32) NOT NULL REFERENCES users (id),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  received_date DATE,
  received_via VARCHAR(12),
  received_ref VARCHAR(300),
  received_by VARCHAR(32) REFERENCES users (id),
  reason VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_receivables_due ON receivables (due_date);
CREATE INDEX IF NOT EXISTS ix_receivables_customer ON receivables (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receivables_request ON receivables (request_key, installment) WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachments (
  id VARCHAR(40) PRIMARY KEY,
  data BYTEA NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  actor_id VARCHAR(32),
  actor VARCHAR(160) NOT NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(30) NOT NULL,
  entity_id VARCHAR(32) NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit (ts);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit (action);
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  ts TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() at time zone 'utc')
);
CREATE INDEX IF NOT EXISTS ix_login_attempts_email_ts ON login_attempts (email, ts);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
