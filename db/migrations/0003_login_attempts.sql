-- Limite de tentativas de login persistente (serverless nao guarda memoria entre requisicoes)
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  ts TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() at time zone 'utc')
);
CREATE INDEX IF NOT EXISTS ix_login_attempts_email_ts ON login_attempts (email, ts);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
