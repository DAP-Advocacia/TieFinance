-- Schema completo do TieFinance (equivale a migracoes 0001 + 0002 + 0003).
-- Use em um banco novo. O projeto Supabase atual ja possui 0001 e 0002; falta apenas aplicar db/migrations/0003_*.sql.
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
  paid_ref VARCHAR(300)
);
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
