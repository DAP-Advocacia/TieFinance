# PLANO — próximos módulos do TieFinance

Aprovado pelo usuário em 2026-11-26. Base: menu planejado pelo Thyago (auditoria) no ChatGPT. Hoje existe só a parte de **Contas a Pagar** completa, mais partes de Conciliação, Auditoria, Administração e Dashboard (ver [HANDOFF.md](HANDOFF.md)).

## Situação do menu do Thyago
| Módulo | Situação |
|---|---|
| Dashboard Executivo | Parcial: indicadores de pagamentos. Faltam receitas, saldos, inadimplência, EBITDA |
| Contas a Receber | Não iniciado |
| Contas a Pagar | **Feito** (falta alçada por valor) |
| Tesouraria | Não iniciado |
| Conciliação Bancária | Parcial: extrato por conta (Santander/Bradesco/Nubank). Faltam integrações Asaas, Luna Pay, EFI |
| Controladoria (DRE, DFC, EBITDA, centros de custos) | Não iniciado |
| Orçamento Empresarial | Não iniciado |
| Comissionamento | Não iniciado |
| Auditoria Interna | Parcial: trilha e exportação. Faltam validações/inconsistências automáticas |
| Relatórios Gerenciais (Excel/PDF) | Não iniciado |
| Administração | Parcial: usuários, perfis fixos, CNPJs, contas. Faltam filiais e permissões granulares |

## Ordem aprovada
1. **Contas a Receber** — honorários, manutenção, recebimentos e inadimplência.
2. **Tesouraria** — saldos por conta bancária e fluxo de caixa (usa `bank_accounts`).
3. **Integrações bancárias** — Asaas, Luna Pay, EFI Bank (extrato/recebimentos automáticos).
4. **Controladoria + Orçamento** — DRE, DFC, EBITDA, centros de custos, orçado × realizado.
5. **Comissionamento** — apuração e validação.
6. **Relatórios gerenciais** — Excel e PDF; Auditoria Interna automática; alçadas por valor.

Cada módulo segue o mesmo ritual: migração SQL (`db/migrations/000N`) → atualizar `db/schema.sql` e `src/db/schema.ts` → regras em `src/lib/` → rotas em `src/app/api/` → telas → testes em `tests/run.mjs` (banco local vazio) → **abrir as telas no navegador** → aplicar migração no Supabase → push (deploy) → conferir em produção.

## 1. Contas a Receber
Escopo: cadastro de **clientes** (parte de `payees` ou nova tabela `customers`), **recebíveis** (honorários, manutenção/recorrência, avulsos) por CNPJ e conta bancária de destino, vencimento, situação (a vencer, recebido, vencido, cancelado), **baixa** manual e por extrato (entradas), **inadimplência/aging** (a vencer, 1–30, 31–60, 61–90, +90). Recorrência com chave de idempotência (sem duplicar). Dashboard: a receber, recebido no mês, inadimplência. Exportação CSV. Auditoria.
Decisões necessárias: quem lança e quem aprova recebíveis (perfis); juros/multa; se honorários vêm do Bitrix/Asaas (importação futura).
Perguntas: tipos de recebível (lista); recorrência mensal fixa ou por contrato?

## 2. Tesouraria
Escopo: saldo por conta bancária (saldo inicial + entradas − saídas realizadas), saldo projetado (a receber − a pagar aprovados por semana), fluxo de caixa realizado × previsto por CNPJ/conta, transferências entre contas (sem inflar receitas/despesas). Evitar dupla contagem de títulos já baixados.
Depende de: Contas a Receber (entradas). Decisão: como obter o saldo inicial (manual por conta) e a data-base.

## 3. Integrações Asaas, Luna Pay, EFI Bank
- Hoje essas contas têm `kind = 'api'` mas funcionam por extrato exportado. A integração real exige **tokens de sandbox e produção**, documentação/webhooks de cada provedor e decisão sobre onde guardar segredos (variáveis de ambiente da Vercel; **nunca** no banco em texto simples nem no git).
- Entregas: sincronização de lançamentos/recebimentos por conta, conciliação automática com recebíveis e pagamentos, webhooks (Vercel Functions, limite 10 s no Hobby → fila/Cron se necessário).
- Pendências do usuário: tokens, escopo de cada API (cobranças, extrato, pagamentos), quais contas.

## 4. Controladoria + Orçamento
Escopo: plano de contas gerencial hierárquico, **competência** nos títulos (não usar vencimento como competência), centros de custos estruturados (hoje é texto livre), **DRE** por competência, **DFC**, **EBITDA gerencial**, orçamento mensal por conta/centro com versões e desvio (nominal e %), fechamento de período com reabertura auditada.
Depende de: **plano de contas validado pelo contador** e definição de competência/rateios. Sem isso, não implementar.

## 5. Comissionamento
Apuração e validação de comissões. Depende das **regras de cálculo** (base, percentuais, gatilhos de pagamento, quem recebe) — não levantadas. Provável dependência de Contas a Receber (comissão sobre recebimento).

## 6. Relatórios, Auditoria Interna e alçadas
- Relatórios em Excel (XLSX) e PDF com filtros, data-base e totais reconciliáveis.
- Auditoria Interna: validações automáticas (pagamento duplicado, favorecido repetido com dado diferente, baixa sem comprovante, aprovação fora de horário/valor atípico, conta divergente), painel de inconsistências.
- Alçadas por valor (faixas, aprovação múltipla), escopo de permissão por CNPJ/filial, MFA, recuperação de senha, notificação ao presidente (WhatsApp/e-mail; standby).

## Pendências do usuário (para destravar)
1. Extrato **real** de cada banco (Santander, Bradesco, Nubank) exportado pelo Thyago, para ajustar o leitor (colunas, OFX).
2. Tokens/sandbox: Asaas, Luna Pay, EFI Bank.
3. Plano de contas (contador) e centros de custos oficiais.
4. Regras de comissão.
5. Decisões: política de dados do escritório (dados fora da rede da DAP), troca da senha do admin, remoção dos dados demo antes do uso real, e como tratar o usuário `thyago@demo.local`.

## Riscos e lições
- UI: **sempre abrir as telas logadas no navegador**; build e testes de API não detectam quedas de tela (ver lição no HANDOFF).
- Vercel Hobby: 10 s por função, 4,5 MB por corpo; agregações pesadas do dashboard devem migrar para SQL quando houver volume.
- Dados reais só depois de: senha do admin trocada, dados demo removidos, backup/PITR do Supabase conferido.
