-- Dados FICTICIOS para popular o dashboard (Supabase SQL Editor). Tudo marcado com "[DEMO]" / @demo.local.
-- Pre-requisito: criar em Administracao os usuarios demo-mariana@demo.local (Financeiro) e demo-bruno@demo.local (Aprovador).
-- Remocao: ver o final do arquivo.
SELECT setseed(0.42);

INSERT INTO companies (id,name,cnpj,active) VALUES
(md5('demo-co-1'),'DAP Advocacia [DEMO]','00.000.000/0001-01',true),
(md5('demo-co-2'),'DAP Consultoria [DEMO]','00.000.000/0002-02',true),
(md5('demo-co-3'),'DAP Participacoes [DEMO]','00.000.000/0003-03',true);

INSERT INTO bank_accounts (id,company_id,bank,kind,nickname,agency,account,active) VALUES
(md5('demo-bk-1'),md5('demo-co-1'),'Santander','extrato','Conta principal [DEMO]','0001','11111-1',true),
(md5('demo-bk-2'),md5('demo-co-1'),'Asaas','api','Asaas [DEMO]','','',true),
(md5('demo-bk-3'),md5('demo-co-2'),'Bradesco','extrato','Conta operacional [DEMO]','0002','22222-2',true),
(md5('demo-bk-4'),md5('demo-co-2'),'EFI Bank','api','EFI [DEMO]','','',true),
(md5('demo-bk-5'),md5('demo-co-3'),'Nubank','extrato','Conta PJ [DEMO]','0001','33333-3',true),
(md5('demo-bk-6'),md5('demo-co-3'),'Luna Pay','api','Luna Pay [DEMO]','','',true);

INSERT INTO payees (id,name,document,payment_info,active)
SELECT md5('demo-py-'||i), n||' [DEMO]', '', 'PIX demo', true
FROM unnest(ARRAY['Papelaria Central','Imobiliaria Exemplo','Tech Software Ltda','Cartorio 1o Oficio','Limpeza Brilho','Contabilidade Alfa','Energia SA','Telecom Beta','Condominio Edificio Sede','Seguradora Gama']) WITH ORDINALITY AS t(n,i);

WITH u AS (
  SELECT (SELECT id FROM users WHERE email='demo-mariana@demo.local') AS mar,
         (SELECT id FROM users WHERE email='demo-bruno@demo.local')   AS bru
), base AS (
  SELECT g,
    (ARRAY['pending','pending','approved','approved','paid','paid','paid','paid','paid','paid','rejected','cancelled'])[1+floor(random()*12)::int] AS st,
    1+floor(random()*3)::int AS co, 1+floor(random()*10)::int AS py,
    (15000+floor(random()*1800000))::bigint AS cents,
    (ARRAY['Administrativo','Juridico','Tecnologia','Predial',''])[1+floor(random()*5)::int] AS cc,
    floor(random()*120)::int AS back, floor(random()*20)::int AS fwd, floor(random()*60)::int AS mix,
    2+floor(random()*8)::int AS age_days, 2+floor(random()*40)::int AS dec_hours,
    (random()<0.5) AS manual
  FROM generate_series(1,60) g
), d AS (
  SELECT *, (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today FROM base
), e AS (
  SELECT *,
    CASE st WHEN 'pending' THEN today+fwd WHEN 'approved' THEN today+(mix-25) WHEN 'paid' THEN today-back ELSE today-(back/2) END AS pay,
    ((now() AT TIME ZONE 'utc') - (age_days||' days')::interval) AS created
  FROM d
)
INSERT INTO payments (id,company_id,payee_id,bank_account_id,description,amount_cents,pay_date,cost_center,status,created_by,created_at,decided_by,decided_at,reason,paid_date,paid_via)
SELECT md5('demo-pay-'||g), md5('demo-co-'||co), md5('demo-py-'||py), md5('demo-bk-'||((co-1)*2 + 1 + (g % 2))), '[DEMO] Pagamento '||g, cents, pay, cc, st,
  u.mar, created,
  CASE WHEN st IN ('approved','paid','rejected') THEN u.bru END,
  CASE WHEN st IN ('approved','paid','rejected') THEN created + (dec_hours||' hours')::interval END,
  CASE st WHEN 'rejected' THEN 'Valor divergente' WHEN 'cancelled' THEN 'Duplicado' END,
  CASE WHEN st='paid' THEN pay END,
  CASE WHEN st='paid' THEN CASE WHEN manual THEN 'manual' ELSE 'extrato' END END
FROM e, u;

INSERT INTO audit (ts,actor_id,actor,action,entity,entity_id,detail)
SELECT created_at, created_by, 'demo-mariana@demo.local', 'payment.create', 'payment', id, '{"demo":true}' FROM payments WHERE description LIKE '[DEMO]%'
UNION ALL
SELECT decided_at, decided_by, 'demo-bruno@demo.local', CASE WHEN status='rejected' THEN 'payment.reject' ELSE 'payment.approve' END, 'payment', id, '{"demo":true}'
FROM payments WHERE description LIKE '[DEMO]%' AND decided_at IS NOT NULL;

-- Remover dados demo (a ordem importa por causa das chaves estrangeiras):
-- DELETE FROM audit WHERE detail = '{"demo":true}';
-- DELETE FROM statement_imports WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE nickname LIKE '%[DEMO]');
-- DELETE FROM payments WHERE description LIKE '[DEMO]%';
-- DELETE FROM bank_accounts WHERE nickname LIKE '%[DEMO]';
-- DELETE FROM payees WHERE name LIKE '%[DEMO]';
-- DELETE FROM companies WHERE name LIKE '%[DEMO]';
-- DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'demo-%@demo.local');
-- DELETE FROM users WHERE email LIKE 'demo-%@demo.local';
