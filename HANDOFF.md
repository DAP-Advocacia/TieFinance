# HANDOFF — TieFinance

Atualizado em 2026-11-26. Estado: **em produção na Vercel** (https://tie-finance.vercel.app, região `gru1`) com banco no Supabase (sa-east-1). A versão FastAPI/Sprite foi desligada. Há dados fictícios `[DEMO]` carregados; não usar com dados reais antes de fechar os itens de "Antes de dados reais".

## 1. Contexto
Base: documentação ERP Finance v0.2 do Thyago (auditoria) em `docs/`. O PVP foi construído a partir dela, reduzido ao essencial:

- **Mariana** (financeiro) agenda pagamentos; **Dr. Bruno** (presidente/aprovador) aprova; **Thyago** (auditoria) audita e concilia por extrato.
- Uma empresa (DAP Advocacia) com vários **CNPJs pagadores** (tabela `companies`).
- Baixa: manual (Mariana) ou por upload de extrato (Thyago).
- Notificação ao presidente: **em standby** por decisão do usuário.

Histórico: v1 em FastAPI (hoje em `legacy-python/`) rodou no Fly.io Sprites e foi **desligada** (sprite destruído em 2026-11-26). A reescrita em Next.js foi para a Vercel, perto do banco (São Paulo), eliminando a latência (o Sprite ficava em Chicago: ~500 ms por requisição contra ~40 ms agora).

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
- Conteúdo atual: o admin `admin@dap.local`, um usuário `thyago@demo.local` (admin, criado manualmente) e os **dados fictícios** de `tools/seed-demo.sql` (60 agendamentos, 3 CNPJs, 10 favorecidos e os usuários `demo-mariana@demo.local` e `demo-bruno@demo.local`). Para remover os dados demo, rode os `DELETE` comentados no fim de `tools/seed-demo.sql`.
- Os schemas de teste `tf_test` e `tf_ts` já foram apagados.
- O backup real é o do Supabase (a exportação do app é apenas para consulta).

## 4. Deploy (Vercel)
- Projeto `tie-finance` importado de `DAP-Advocacia/TieFinance`, branch `main` (produção). `vercel.json` fixa `gru1`.
- Variáveis (Production): `DATABASE_URL` (Transaction pooler do Supabase, porta 6543), `ERP_ADMIN_EMAIL`, `ERP_ADMIN_PASSWORD`.
- Cada push na `main` gera um novo deploy. Rollback: *Deployments → Promote* de um deploy anterior, ou reverter o commit.
- Limites do plano Hobby: funções 10 s, corpo 4,5 MB (anexo limitado a 4 MB). Se o dashboard ficar lento com muitos dados, mover agregações para SQL.
- Medido em 2026-11-26: respostas leves 30–60 ms; login (toca o banco) 90–190 ms.

## 5. Pendências
**Antes de dados reais:** política de dados do escritório (servidor fora da rede da DAP); trocar a senha do admin se ainda não foi trocada (a inicial circulou em chat); conferir backup/PITR do plano do Supabase; remover os dados demo e desativar os usuários `*@demo.local`.
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
- Rollback: o código da v1 Python segue em `legacy-python/` (o Sprite e seus checkpoints não existem mais).
