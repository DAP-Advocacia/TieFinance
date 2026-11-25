# TieFinance — PVP de agendamento de pagamentos

Aplicação web para a **DAP Advocacia** agendar pagamentos, aprovar e auditar, com dashboard analítico.
Stack: FastAPI + SQLAlchemy + Alembic, front em HTML/CSS/JS puro (um arquivo), SQLite (dev/teste) ou PostgreSQL.

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
| `admin` | Tudo (agendar, aprovar, pagar, cancelar, conciliar, auditoria, usuários, CNPJs, backup) |
| `financeiro` | Favorecidos, agendar/editar/cancelar, marcar pago |
| `aprovador` | Aprovar/rejeitar (inclusive em lote) |
| `auditoria` | Leitura, conciliação por extrato, trilha de auditoria, exportações |

Regra transversal: **ninguém decide sobre o próprio agendamento**. Autorização sempre no servidor.

## Rodar localmente

```powershell
pip install -r requirements.txt
$env:ERP_ADMIN_EMAIL="admin@exemplo.com"; $env:ERP_ADMIN_PASSWORD="<12+ caracteres>"
uvicorn app.main:app --port 8000
```
Abra http://127.0.0.1:8000. O admin só é criado se o banco estiver vazio **e** a senha tiver 12+ caracteres (senão o console avisa).

PostgreSQL via Docker: crie `.env` com `ERP_ADMIN_EMAIL`, `ERP_ADMIN_PASSWORD`, `DB_PASSWORD` e rode `docker compose up --build`.

Dados fictícios para ver o dashboard: `python tools/seed_demo.py` (cria usuários `*@demo.local`, senha `DemoSenha#2026` — **nunca em produção**).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `ERP_ADMIN_EMAIL` / `ERP_ADMIN_PASSWORD` | — | Admin inicial (banco vazio) |
| `DATABASE_URL` | SQLite em `DATA_DIR/pvp.db` | Ex.: `postgresql+psycopg://user:pass@host/db` |
| `DATA_DIR` | `./data` | Banco SQLite e anexos (`uploads/`) |
| `RECONCILE_TOLERANCE_DAYS` | `3` | Janela de data na conciliação |

## Testes

`python tests/test_pvp.py` — usa banco temporário e dados fictícios (permissões, fluxo, conciliação, auditoria, senha, backup, perfis, dashboard).

## Estrutura

```
app/main.py        API, modelos, regras (arquivo único)
app/index.html     Front completo (login animado, dashboard, telas)
app/static/        Logo/favicon servidos em /assets
migrations/        Alembic (0001 = baseline); roda sozinho no startup
tests/             Teste de ponta a ponta (script)
tools/seed_demo.py Dados fictícios
TieFinance_Kit/    Kit de identidade visual (logo, símbolo animado, login v4)
docs/              Documentação de origem e protótipo de layout
HANDOFF.md         Estado atual, decisões, deploy e pendências
```

## Identidade visual
Tokens no `:root` de `app/index.html` (azul `#08245d`, ouro `#d4af37`, Plus Jakarta Sans). Regra: só tokens, ouro em no máximo 1–2 pontos por tela, estados em pares texto escuro/fundo suave, `tabular-nums` em valores.

## Documentação
- [HANDOFF.md](HANDOFF.md) — leia antes de continuar o projeto.
- [docs/ERP_Finance_Documentacao_v0.2.md](docs/ERP_Finance_Documentacao_v0.2.md) — visão de produto/roadmap (planejamento do Thyago, v0.2).
