# HANDOFF — TieFinance PVP

Data: 2026-11-25. Estado: PVP funcional em teste com dados fictícios. **Não usar com dados reais ainda** (ver Pendências).

## 1. Contexto
Base: documentação ERP Finance v0.2 do Thyago (auditoria) em `docs/`. O código v0.2 original não estava disponível; o PVP foi **reconstruído** a partir da especificação, reduzido ao essencial:

- **Mariana** (financeiro) agenda pagamentos; **Dr. Bruno** (presidente/aprovador) aprova; **Thyago** (auditoria) audita e concilia por extrato.
- Uma empresa (DAP Advocacia) com vários **CNPJs pagadores** (cadastro `companies`).
- Baixa: manual (Mariana) ou por upload de extrato (Thyago).
- Notificação ao presidente: **em standby** por decisão do usuário.

## 2. Arquitetura
- Monólito FastAPI (`app/main.py`): modelos SQLAlchemy, rotas, regras, exportações. Front em `app/index.html` (JS puro, sem build).
- Auth: senha scrypt; token de sessão aleatório (guarda-se o SHA-256), expira em 8 h; limite de 5 falhas/15 min por e-mail (**em memória**).
- Valores em **centavos** (inteiro). Datas ISO. Auditoria na mesma transação da operação.
- Migrações: Alembic. `0001` = baseline. No startup: se existe `users` sem `alembic_version`, faz `stamp 0001` (adota bancos antigos) e depois `upgrade head`.
- Tabelas: `users, sessions, companies, payees, payments, audit`.

### Regras de negócio
- Pendente → Aprovado/Rejeitado (aprovador/admin, diferente do criador; rejeição exige motivo) → Pago (somente aprovado).
- Aprovado não edita. Rejeitado/pendente editam; editar rejeitado volta a pendente. Cancelar exige motivo, não vale para pago.
- Conciliação (`/api/reconcile/*`): lê CSV (`;`/`,`) ou XLSX com colunas Data/Valor/Descrição; cruza saídas com **aprovados** por valor exato + data ±3 dias + nome do favorecido; só baixa após confirmação; nunca baixa duas vezes.
- Auditoria registra: login (e falha), CRUD, aprovação/rejeição, pagamento, conciliação, visualização de anexo, exportações, backup, troca de perfil/senha.

### Endpoints principais
`/api/login|logout|me`, `/api/me/password`, `/api/users` (+ `/role`, `/password`, `/active`), `/api/companies`, `/api/payees`, `/api/payments` (+ `/approve`, `/reject`, `/cancel`, `/pay`, `/attachment`, `approve-batch`), `/api/dashboard`, `/api/reconcile/preview|confirm`, `/api/audit`, `/api/export/payments|audit`, `/api/backup`. Docs interativas em `/docs`.

## 3. Deploy atual (teste)
- **Fly.io Sprites**, org `gabriel-alves-532`, sprite `rp-financeiro`. URL: https://rp-financeiro-b6xnv.sprites.app (URL pública; proteção = login do app).
- App em `/home/sprite/erp` (venv), dados em `/home/sprite/erp-data` (SQLite + uploads). Serviço `web` na porta 8080, gerido por `sprite-env services`; script de start `/home/sprite/erp/run.sh` (contém as variáveis do admin — **fora do git**).
- Publicar: empacotar `app migrations alembic.ini requirements.txt tools`, enviar com `sprite exec --file`, extrair e `sprite-env services restart web`. Criar checkpoint antes (`sprite checkpoint create`; voltar com `sprite restore vN`).
- O plano Free tem US$ 1 de crédito por 7 dias; depois exige cartão. O arquivo `.sprite` local aponta para o sprite (está no `.gitignore`).
- Observado: ~400–600 ms por requisição (latência até o Sprite, fora do Brasil).

## 4. Vercel — viabilidade
**Não recomendado como está.** O app depende de disco persistente (SQLite + anexos) e de estado em memória (limite de login), e o Vercel é serverless com filesystem efêmero. Funcionaria com: PostgreSQL externo (Neon/Supabase) via `DATABASE_URL`, anexos em storage de objetos (Vercel Blob/S3) no lugar de `uploads/`, rate limit de login no banco, backup via `pg_dump`, e adaptação de entrypoint (`api/index.py` expondo `app`) e migrações fora do cold start. Alternativas sem refatoração: VPS pequena/Fly.io (volume) ou Railway.

## 5. Pendências (ordem sugerida)
1. **Antes de dados reais:** política de dados do escritório (servidor fora da rede da DAP), HTTPS garantido, backup automático (hoje só manual em Administração → Backup; Sprite tem checkpoints), desativar usuários `*@demo.local`, trocar a senha do admin (a inicial circulou em chat).
2. Extrato **real** do banco do Thyago para ajustar o leitor (hoje espera Data/Descrição/Valor; OFX não suportado).
3. Rate limit de login persistente (hoje em memória/por processo); MFA; recuperação de senha por e-mail.
4. Hospedagem próxima (São Paulo) se a latência incomodar; avaliar Postgres.
5. Notificação ao presidente (e-mail/WhatsApp) — standby.
6. Permissões granulares (alçada por valor, escopo por CNPJ) — hoje perfis fixos.
7. Testes: hoje um script e2e em SQLite; falta rodar em PostgreSQL, testes de UI e conversão para pytest/CI.
8. Divisão de `main.py` em módulos e do front em componentes quando crescer.
9. Itens do roadmap v0.3+ (parcelas, competência, plano de contas, fluxo de caixa, DRE, orçamento) estão em `docs/` e **não** fazem parte do PVP.

## 6. Cuidados
- Nunca commitar `.env`, `data/`, `run.sh` ou senhas. Credenciais do admin ficam só no servidor.
- Tela e gráficos nunca foram conferidos por automação de navegador; só testes de API e checagem de sintaxe do JS. Validar visualmente após mudanças.
- Edições no `index.html` usam tokens CSS; não introduzir hex solto.
