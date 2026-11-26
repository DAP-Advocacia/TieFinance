# TieFinance — agendamento de pagamentos

Aplicação web da **DAP Advocacia** para agendar pagamentos, aprovar e auditar, com dashboard analítico.

**Stack:** Next.js (App Router) + React + TypeScript · API em *route handlers* · Drizzle ORM · PostgreSQL (Supabase) · deploy na Vercel (`gru1`, São Paulo).

> A versão anterior (FastAPI + SQLite/Postgres) está preservada em [`legacy-python/`](legacy-python/) e na branch `main`. Esta branch (`nextjs`) é a reescrita completa, com as mesmas regras de negócio.

## Fluxo

```
Mariana (financeiro) agenda -> Pendente -> Presidente (aprovador) aprova -> Aprovado -> Pago
                                         \-> rejeita (motivo) -> Rejeitado -> Mariana corrige e reenvia
Thyago (auditoria) sobe extrato CSV/XLSX -> conciliação automática -> baixa como Pago (após confirmação)
```

Situações: `pending`, `approved`, `rejected`, `paid`, `cancelled`. "Atrasado" é derivado (aprovado com data vencida e sem baixa).

## Perfis

| Perfil | Pode |
|---|---|
| `admin` | Tudo (agendar, aprovar, pagar, cancelar, conciliar, auditoria, usuários, CNPJs, exportação de dados) |
| `financeiro` | Favorecidos, agendar/editar/cancelar, marcar pago |
| `aprovador` | Aprovar/rejeitar (inclusive em lote) |
| `auditoria` | Leitura, conciliação por extrato, trilha de auditoria, exportações |

Regra transversal: **ninguém decide sobre o próprio agendamento** (inclusive admin). Autorização sempre no servidor.

## Rodar localmente

Requisitos: Node 20.9+ e um PostgreSQL com o schema aplicado (`db/schema.sql`).

```bash
npm install
cp .env.example .env.local      # preencha DATABASE_URL e ERP_ADMIN_*
npm run dev                     # http://localhost:3000
```

O admin inicial é criado no **primeiro login** com `ERP_ADMIN_EMAIL`, se a tabela `users` estiver vazia e a senha tiver 12+ caracteres.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Postgres. Na Vercel use o **Transaction pooler** do Supabase (porta 6543) |
| `ERP_ADMIN_EMAIL` / `ERP_ADMIN_PASSWORD` | Admin inicial (banco sem usuários) |
| `RECONCILE_TOLERANCE_DAYS` | Janela de data na conciliação (padrão 3) |
| `DB_SCHEMA` | Só para testes: isola em um schema próprio |

## Banco de dados

- Schema completo: [`db/schema.sql`](db/schema.sql). Migrações incrementais em `db/migrations/` (aplicar na ordem; o projeto Supabase atual já tem 0001–0003).
- RLS ligado **sem policies** em todas as tabelas: a API REST pública do Supabase não enxerga nada; só o app acessa, direto pelo Postgres.
- Contas bancárias por CNPJ em `bank_accounts`; agendamentos e conciliação são por conta. Migrações 0001–0004.
- Anexos ficam na tabela `attachments` (limite de 4 MB por arquivo, por causa do limite de corpo da Vercel).

## Dados fictícios
`tools/seed-demo.sql` popula o dashboard (tudo marcado `[DEMO]`, com instruções de remoção no fim do arquivo).

## Testes

Teste de ponta a ponta da API contra um servidor rodando em um **banco/schema vazio** (para ter um Postgres local descartável, veja `tools/local-db/` e a seção 8 do HANDOFF):

```bash
npm run build && npm start &
BASE_URL=http://127.0.0.1:3000 npm test
```
O servidor precisa de `ERP_ADMIN_EMAIL=admin@teste.com` e `ERP_ADMIN_PASSWORD=SenhaAdmin#12345`. Cobre permissões, fluxo completo, autoaprovação, anexos, conciliação, dashboard, senha, exportações, auditoria e limite de login (21 grupos de verificação). **Nunca aponte para o schema `public` em produção.**

## Estrutura

```
src/app/            Telas React (page.tsx, views.tsx, ui.tsx) e route handlers (api/**)
src/lib/            Regras: auth, payments, dashboard, reconcile, audit, http, core
src/db/             Drizzle (schema + conexão)
db/                 schema.sql e migrações SQL
tests/run.mjs       Teste e2e da API
legacy-python/      Versão anterior (FastAPI) — referência e rollback
TieFinance_Kit/     Kit de identidade visual
docs/               Documentação de origem e protótipo de layout
HANDOFF.md          Estado atual, decisões, deploy e pendências
```

## Identidade visual
Tokens no `:root` de `src/app/globals.css` (azul `#08245d`, ouro `#d4af37`, Plus Jakarta Sans). Regra: só tokens, ouro em no máximo 1–2 pontos por tela, estados em pares texto escuro/fundo suave, `tabular-nums` em valores.

## Documentação
- [HANDOFF.md](HANDOFF.md) — leia antes de continuar o projeto (inclui o passo a passo do deploy na Vercel).
- [docs/ERP_Finance_Documentacao_v0.2.md](docs/ERP_Finance_Documentacao_v0.2.md) — visão de produto/roadmap (planejamento do Thyago, v0.2).
