# HANDOFF — TieFinance

Atualizado em 2026-11-26. **Em produção** na Vercel (https://tie-finance.vercel.app, região `gru1`) com banco no Supabase (sa-east-1). Há dados fictícios `[DEMO]` carregados: não usar com dados reais antes de fechar "Antes de dados reais" (seção 6). O plano dos próximos módulos está em [PLANO.md](PLANO.md).

## 1. O que é e para quem
Sistema web da **DAP Advocacia** para agendar pagamentos, aprovar e auditar, com dashboard analítico. Origem: documentação ERP Finance v0.2 do Thyago (auditoria), em `docs/`, planejada no ChatGPT. O código v0.2 original não existia; o PVP foi reconstruído a partir da especificação.

| Pessoa | Perfil | Papel |
|---|---|---|
| Mariana | `financeiro` | Agenda pagamentos, cadastra favorecidos, marca pago manual |
| Dr. Bruno (presidente) | `aprovador` | Aprova/rejeita agendamentos (inclusive em lote) |
| Thyago (auditoria) | `auditoria` | Concilia por extrato, trilha de auditoria, exportações |
| Administrador | `admin` | Tudo (inclusive usuários, CNPJs, contas bancárias) |

Uma empresa (DAP Advocacia) com vários **CNPJs pagadores**, cada um com várias **contas bancárias**. Notificação ao presidente: **em standby** por decisão do usuário.

## 2. Linha do tempo (o que foi feito)
1. Leitura da documentação do Thyago e definição do recorte do PVP (agendamento → aprovação → baixa, com auditoria).
2. **v1 em Python** (FastAPI + SQLAlchemy + SQLite): fluxo completo, conciliação por extrato CSV/XLSX, auditoria, testes. Publicada no Fly.io Sprites (Chicago).
3. Melhorias na v1: troca de senha, exportação, Alembic, perfis editáveis, redesign com dashboard (visual do protótipo + tokens da marca), login com a identidade TieFinance (kit em `TieFinance_Kit/`).
4. **Supabase** (Postgres em São Paulo): tabelas criadas via MCP, RLS ligado sem policies; anexos movidos para o banco (4 MB).
5. Diagnóstico de lentidão (Chicago ↔ São Paulo, ~500 ms por requisição) → decisão de **migrar para Next.js na Vercel** (`gru1`). Reescrita completa (API + telas), mesmas regras, 20 grupos de teste em Postgres real.
6. Deploy na Vercel; **Sprite desligado** (2026-11-26). Dados demo no Supabase.
7. Camada visual: marca em texto vetorial nítido, fundo animado do login, transições de página, revelação ao rolar, gráficos animados, listas suspensas próprias.
8. **Contas bancárias por CNPJ** (migração 0004): agendamento escolhe a conta, conciliação por conta, dashboard/exportação por conta, histórico de extratos importados. Postgres local descartável para testes (`tools/local-db/`). Correção de um erro grave que derrubava a tela ao abrir listas suspensas (React #185).

9. **Contas a Receber** (migração 0005, aplicada no Supabase e publicada em 2026-11-26): clientes (`customers`) e recebíveis (`receivables`) por CNPJ e conta de destino; tipos honorários/manutenção/avulso; recorrência mensal (1–60, dia mantido, ajusta fim de mês) com `request_key` idempotente; baixa manual e cancelamento com motivo; atraso calculado (aberto e vencido); aging, inadimplência e maiores devedores; CSV; auditoria. **Conciliação de entradas:** o extrato (créditos) casa com recebíveis em aberto da mesma conta, por valor exato e CPF/CNPJ do cliente no histórico (parcela mais antiga) ou por vencimento ±3 dias; baixa `via extrato`. O leitor acha o cabeçalho sozinho nas 25 primeiras linhas (Santander traz agência/conta antes) e só lê a **1ª aba** do XLSX: enviar um arquivo por conta. Extratos reais não vão ao git (`.gitignore`). Lança/baixa: financeiro e admin; os demais perfis só leem. Telas em `src/app/receber.tsx`, regras em `src/lib/receivables.ts`.

Commits principais na `main`: `9926169` (v1) → `475d8b5` (Next.js) → `8f23a0a` (visual) → `60dd11d` (contas bancárias).

## 3. Arquitetura
- **Next.js 16 (App Router) + React 19 + TypeScript.** Telas em `src/app/` (client components: `page.tsx`, `views.tsx`, `ui.tsx`, `select.tsx`, `reveal.ts`, `login-fx.tsx`, `symbol.tsx`); API em `src/app/api/**/route.ts`.
- `src/lib/http.ts`: `route(roles, fn)` envolve cada handler: checagem de origem (CSRF), autenticação por cookie, autorização por perfil e erros `{detail}`.
- **Auth:** senha scrypt (`salt_hex$hash_hex`, compatível com o hash do Python). Token aleatório em cookie `HttpOnly; SameSite=Lax; Secure`; guarda-se o SHA-256 em `sessions`; expira em 8 h. Limite de 5 falhas/15 min **persistido em `login_attempts`**.
- **Dados:** Drizzle ORM sobre postgres.js, `prepare:false` (pooler em modo transação). Valores em **centavos**; datas ISO; timestamps UTC sem fuso. Auditoria na mesma transação da operação.
- **Anexos** em `attachments` (bytea), máx. 4 MB (limite de corpo da Vercel); servidos com `nosniff` e CSP `sandbox`.
- **Gráficos** em SVG/CSS puro com tokens. Extratos: CSV (`;`/`,`, UTF-8/Latin-1) ou XLSX. Exportações CSV e zip (`fflate`).
- Estrutura: `src/lib/` (regras: `auth`, `payments`, `dashboard`, `reconcile`, `audit`, `core`, `types`), `src/db/` (Drizzle), `db/` (schema e migrações SQL), `tests/run.mjs`, `tools/`, `legacy-python/` (v1), `docs/`, `TieFinance_Kit/`.

### Regras de negócio
- Pendente → Aprovado/Rejeitado (aprovador/admin **diferente do criador**; rejeição exige motivo) → Pago (somente aprovado). Decisão/baixa usam `UPDATE … WHERE status = …` (sem decisão dupla).
- Aprovado não edita. Pendente/rejeitado editam; editar rejeitado volta a pendente. Cancelar exige motivo; pago não cancela. "Atrasado" é derivado (aprovado com data vencida sem baixa).
- **Conta bancária:** cada CNPJ tem N contas (`bank_accounts`: Santander, Bradesco, Nubank, Asaas, Luna Pay, EFI Bank, Outro). `kind` = `api` (Asaas/Luna Pay/EFI; integração automática **ainda não implementada**, hoje por extrato) ou `extrato`. O agendamento exige a conta e ela deve pertencer ao CNPJ (validado no servidor). Pagamentos antigos podem ter `NULL`.
- **Conciliação:** o Thyago escolhe a conta do extrato; cruza saídas só com agendamentos **aprovados naquela conta** (valor exato + data ±3 dias + nome do favorecido); só baixa após confirmação e só pagamentos da conta; `statement_imports` guarda o hash do arquivo e avisa se o mesmo extrato for reenviado.
- Auditoria: login (e falha), CRUD, aprovação/rejeição, pagamento, conciliação, anexo visto, exportações, troca de perfil/senha, contas bancárias.

### Endpoints
`/api/login|logout|me`, `/api/me/password`, `/api/users` (+ `/[id]/role|password|active`), `/api/companies`, `/api/bank-accounts` (+ `/[id]/active`), `/api/payees`, `/api/payments` (+ `/[id]`, `/approve`, `/reject`, `/cancel`, `/pay`, `/attachment`, `approve-batch`), `/api/dashboard`, `/api/pending-count`, `/api/reconcile/preview|confirm`, `/api/audit`, `/api/export/payments|audit`, `/api/backup` (exportação de dados).

### Camada visual
- Tokens no `:root` de `src/app/globals.css` (azul `#08245d`, ouro `#d4af37`, Plus Jakarta Sans via `next/font`). Regras: só tokens (sem hex solto), ouro em no máximo 1–2 pontos por tela, estados em pares texto escuro/fundo suave, `tabular-nums` em valores. Tudo respeita `prefers-reduced-motion`.
- `select.tsx`: lista suspensa própria (`<Select>` aceita `<option>`); **não usar `<select>` nativo**. O menu é renderizado em portal (dentro do `<dialog>` se houver, senão no `<body>`).
- `reveal.ts` (`useReveal`): revela `.metric/.panel/.filters/.notice` ao entrar na tela; gráficos animam depois disso.
- `login-fx.tsx` + `symbol.tsx`: marca em texto vetorial, fundo animado (orbes, anéis, feixe, poeira em canvas), brilho do símbolo.
- `AGENTS.md` (gerado pelo `next dev`): esta versão do Next tem mudanças; consultar `node_modules/next/dist/docs/` antes de alterar convenções.

## 4. Banco (Supabase)
- Projeto **TieFinance** (`tcmiwjijrovoyspiurup`, sa-east-1). Schema `public`, RLS ligado **sem policies** (a API REST pública não enxerga nada; só o app acessa direto pelo Postgres). Migrações **0001–0005** aplicadas e **0005** (`db/schema.sql` = banco novo completo; `db/migrations/` = incrementais).
- Tabelas: `users, sessions, companies, bank_accounts, payees, payments, attachments, statement_imports, audit, login_attempts` (+ `alembic_version` herdada da v1, inofensiva).
- Conteúdo: admin `admin@dap.local`; usuário `thyago@demo.local` (admin, criado à mão por terceiros); **dados demo** de `tools/seed-demo.sql` (60 agendamentos, 3 CNPJs × 2 contas, 10 favorecidos, `demo-mariana@demo.local` e `demo-bruno@demo.local`). Remoção: `DELETE`s comentados no fim do arquivo.
- O backup real é o do Supabase (a "exportação de dados" do app é só para consulta).

## 5. Deploy e operação
- **Vercel:** projeto `tie-finance`, branch `main` (produção), `vercel.json` fixa `gru1`. Variáveis: `DATABASE_URL` (Transaction pooler, porta **6543**), `ERP_ADMIN_EMAIL`, `ERP_ADMIN_PASSWORD`. Cada push na `main` faz deploy. Rollback: *Deployments → Promote* ou reverter o commit. Hobby: funções 10 s, corpo 4,5 MB.
- **Medido:** respostas leves 30–60 ms; login 90–190 ms (antes, no Sprite: ~500 ms).
- **Teste local sem tocar em produção:** `tools/local-db/` sobe Postgres descartável (`embedded-postgres`, sem Docker):
  ```
  cd tools/local-db && npm install && node start.mjs     # imprime a DATABASE_URL local
  node newdb.mjs tf_fresh                                 # banco vazio com db/schema.sql
  # app: DATABASE_URL=... ERP_ADMIN_EMAIL=admin@teste.com ERP_ADMIN_PASSWORD=SenhaAdmin#12345 npm run build && npm start -- -p 3300
  BASE_URL=http://127.0.0.1:3300 npm test                 # 22 grupos, em banco VAZIO
  node seed.mjs                                           # opcional: dados demo
  ```
- **Capturas/verificação visual no Windows:** Edge headless via DevTools. Dica: **não usar `--disable-gpu`** ao capturar telas com `<dialog>`/animações (a captura trava); ver erros reais com `Runtime.exceptionThrown`.

## 6. Pendências e cuidados
**Antes de dados reais:** política de dados do escritório (servidor fora da rede da DAP); trocar a senha do admin (a inicial circulou em chat); conferir backup/PITR do Supabase; remover dados demo e desativar usuários `*@demo.local` (senha demo conhecida no histórico); revisar o usuário `thyago@demo.local` (admin) que não foi criado por este projeto.

Cuidados:
- Nunca commitar `.env*`, senhas ou strings de conexão. `tests/run.mjs` escreve dados: rodar **apenas** em banco vazio de teste, nunca no `public` de produção.
- **Sempre abrir as telas logadas no navegador após mexer em UI.** Lição: um ajuste em `select.tsx` (medição + `setPos` em `useLayoutEffect`) causou "Maximum update depth" (React #185) e derrubava a tela ao abrir qualquer lista; ficou em produção até ser percebido. Build, tipos e testes de API **não** pegam isso.
- Rollback da arquitetura: o código da v1 Python segue em `legacy-python/` (Sprite e checkpoints não existem mais).

Pendências técnicas: extrato **real** do Thyago (leitor espera Data/Descrição/Valor; OFX não suportado); MFA e recuperação de senha; testes de UI (Playwright) e CI; anexos >4 MB via Supabase Storage; notificação ao presidente (standby); permissões granulares (alçada por valor, escopo por CNPJ).

## 7. Próximos passos
Ver **[PLANO.md](PLANO.md)** (ordem aprovada: Contas a Receber → Tesouraria → integrações Asaas/Luna Pay/EFI → Controladoria e Orçamento → Comissionamento → Relatórios). O roadmap original do Thyago está em `docs/ERP_Finance_Documentacao_v0.2.md`.
