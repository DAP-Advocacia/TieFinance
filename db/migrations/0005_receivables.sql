-- Contas a Receber: clientes e recebiveis (honorarios, manutencao, avulsos).
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
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
