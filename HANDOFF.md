# HANDOFF — TieFinance

Atualizado em 2026-11-26. Estado: **reescrita em Next.js concluída e testada em Postgres real; ainda não publicada na Vercel.** Não usar com dados reais antes de fechar os itens de "Antes de dados reais".

## 1. Contexto
Base: documentação ERP Finance v0.2 do Thyago (auditoria) em `docs/`. O PVP foi construído a partir dela, reduzido ao essencial:

- **Mariana** (financeiro) agenda pagamentos; **Dr. Bruno** (presidente/aprovador) aprova; **Thyago** (auditoria) audita e concilia por extrato.
- Uma empresa (DAP Advocacia) com vários **CNPJs pagadores** (tabela `companies`).
- Baixa: manual (Mariana) ou por upload de extrato (Thyago).
- Notificação ao presidente: **em standby** por decisão do usuário.

Histórico: v1 em FastAPI (branch `main`, hoje em `legacy-python/`), rodando no Fly.io Sprites; reescrita em Next.js nesta branch para hospedar na Vercel, perto do banco (São Paulo) e eliminar a latência (o Sprite fica em Chicago).

## 2. Arquitetura
- **Next.js 16 (App Router) + React 19 + TypeScript.** Telas em `src/app/` (client components); API em `src/app/api/**/route.ts` (route handlers).
- `src/lib/http.ts`: `route(roles, fn)` envolve cada handler: checagem de origem (CSRF), autenticação por cookie, autorização por perfil e erros padronizados (`{detail}`).
- **Auth:** senha scrypt (formato `salt_hex$hash_hex`, **compatível com o hash do Python**: o admin criado na v1 continua entrando). Token de sessão aleatório em cookie `HttpOnly; SameSite=Lax; Secure`; guarda-se o SHA-256 em `sessions`; expira em 8 h. Limite de 5 falhas/15 min **persistido na tabela `login_attempts`** (serverless não guarda memória).
- **Dados:** Drizzle ORM sobre `postgres` (postgres.js), `prepare:false` (compatível com o pooler em modo transação). Valores em **centavos**; datas ISO; timestamps UTC sem fuso. Auditoria gravada na mesma transação da operação.
- **Anexos** na tabela `attachments` (bytea), máx. 4 MB; servidos com `nosniff` e CSP `sandbox`.
- **Gráficos** do dashboard em SVG/CSS puro, só com tokens (sem biblioteca).
- Extrato: CSV (`;`/`,`, UTF-8/Latin-1) ou XLSX (`read-excel-file`). Exportações CSV e zip (`fflate`).

### Regras de negócio
- Pendente → Aprovado/Rejeitado (aprovador/admin, diferente do criador; rejeição exige motivo) → Pago (somente aprovado). Decisão e baixa usam `UPDATE ... WHERE status = ...` (sem decisão dupla em concorrência).
- Aprovado não edita. Pendente/rejeitado editam; editar rejeitado volta a pendente. Cancelar exige motivo, não vale para pago.
- Conciliação: cruza saídas com **aprovados** por valor exato + data ±3 dias + nome do favorecido; só baixa após confirmação; nunca baixa duas vezes.
- Auditoria: login (e falha), CRUD, aprovação/rejeição, pagamento, conciliação, visualização de anexo, exportações, troca de perfil/senha.

### Endpoints
`/api/login|logout|me`, `/api/me/password`, `/api/users` (+ `/[id]/role|password|active`), `/api/companies`, `/api/payees`, `/api/payments` (+ `/[id]`, `/approve`, `/reject`, `/cancel`, `/pay`, `/attachment`, `approve-batch`), `/api/dashboard`, `/api/pending-count`, `/api/reconcile/preview|confirm`, `/api/audit`, `/api/export/payments|audit`, `/api/backup` (exportação de dados).

## 3. Banco (Supabase)
- Projeto **TieFinance** (`tcmiwjijrovoyspiurup`, região sa-east-1). Tabelas no schema `public` com RLS ligado e sem policies; migrações 0001–0003 aplicadas.
- Conteúdo atual: 1 usuário (admin `admin@dap.local`, criado pela v1) e nada mais.
- Schemas `tf_test` e `tf_ts` foram criados **só para testes** (dados fictícios) e **ainda existem**; podem ser apagados: `DROP SCHEMA tf_test CASCADE; DROP SCHEMA tf_ts CASCADE;`.
- O backup real é o do Supabase (a exportação do app é apenas para consulta).

## 4. Deploy na Vercel (passo a passo — ação do usuário)
1. Em vercel.com → *Add New → Project* → importar `DAP-Advocacia/TieFinance`; escolher a branch **`nextjs`** (ou fazer o merge na `main` depois de validar).
2. Framework: Next.js (detectado). `vercel.json` já fixa a região `gru1` (São Paulo).
3. *Environment Variables* (Production):
   - `DATABASE_URL` = string do **Transaction pooler** do Supabase (Connect → Transaction pooler, porta **6543**), no formato `postgresql://postgres.tcmiwjijrovoyspiurup:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`.
   - `ERP_ADMIN_EMAIL` e `ERP_ADMIN_PASSWORD` (12+ caracteres) — só valem se a tabela `users` estiver vazia.
4. *Deploy*. Depois: login com o admin, **trocar a senha**, cadastrar CNPJs, favorecidos e os usuários reais.
5. Validar a latência. Se estiver boa, desligar o Sprite (`sprite destroy -s rp-financeiro`, só com decisão do usuário).

Atenção: o plano Hobby da Vercel limita funções a 10 s e corpo a 4,5 MB. As operações do app cabem nisso; se o dashboard ficar lento com muitos dados, mover agregações para SQL.

## 5. Pendências
**Antes de dados reais:** política de dados do escritório (servidor fora da rede da DAP); HTTPS (a Vercel já fornece); trocar a senha do admin (a inicial circulou em chat); conferir backup/PITR do plano do Supabase; apagar os schemas de teste.
1. Extrato **real** do banco do Thyago para ajustar o leitor (hoje espera Data/Descrição/Valor; OFX não suportado).
2. Validação visual em navegador: as telas foram verificadas por build, tipos e testes de API, **não** por teste de interface. Conferir o login animado, dashboard, formulários e o layout mobile.
3. MFA e recuperação de senha por e-mail.
4. Notificação ao presidente (e-mail/WhatsApp) — standby.
5. Permissões granulares (alçada por valor, escopo por CNPJ) — hoje perfis fixos.
6. Testes de interface (Playwright) e CI (GitHub Actions rodando `npm run build` + `tests/run.mjs` em schema isolado).
7. Anexos acima de 4 MB: upload direto ao Supabase Storage.
8. Roadmap v0.3+ (parcelas, competência, plano de contas, fluxo de caixa, DRE, orçamento) está em `docs/` e **não** faz parte do PVP.

## 6. Cuidados
- Nunca commitar `.env*`, senhas ou strings de conexão. `.env.example` só tem placeholders.
- `tests/run.mjs` escreve dados fictícios: rode **apenas** em banco/schema vazio de teste (`DB_SCHEMA`), nunca no `public` de produção.
- Edições de CSS: usar tokens (`var(--brand)` etc.); não introduzir hex solto.
- Rollback: a v1 Python continua em `legacy-python/` e no Sprite (`rp-financeiro`, checkpoints `sprite checkpoint list`).
