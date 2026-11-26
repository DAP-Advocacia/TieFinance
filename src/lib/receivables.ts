import { and, asc, eq, gte, ilike, lt, lte, or, type SQL } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/db";
import { HttpError, addDays, diffDays, newId, nowUtc, parseDate, toCents, todaySP } from "./core";
import { log } from "./audit";
import type { SessionUser } from "./auth";
import type { CustomerDTO, DashboardDTO, Rank, ReceivableDTO, ReceivablesSummaryDTO, RecvKind, Sum } from "./types";

const { receivables, customers, companies, bankAccounts, users } = schema;
const KINDS: RecvKind[] = ["honorario", "manutencao", "avulso"];
export const MAX_INSTALLMENTS = 60;

function base(db: Db | Tx) {
  return db
    .select({ r: receivables, customerName: customers.name, customerDoc: customers.document, companyName: companies.name, bankName: bankAccounts.bank, bankNick: bankAccounts.nickname, creatorName: users.name })
    .from(receivables)
    .innerJoin(customers, eq(customers.id, receivables.customerId))
    .innerJoin(companies, eq(companies.id, receivables.companyId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, receivables.bankAccountId))
    .innerJoin(users, eq(users.id, receivables.createdBy));
}
type Row = Awaited<ReturnType<ReturnType<typeof base>["limit"]>>[number];

function toDTO(x: Row, today = todaySP()): ReceivableDTO {
  const r = x.r;
  const overdue = r.status === "open" && r.dueDate < today;
  return {
    id: r.id,
    company_id: r.companyId,
    company: x.companyName,
    bank_account_id: r.bankAccountId,
    bank: `${x.bankName} · ${x.bankNick}`,
    customer_id: r.customerId,
    customer: x.customerName,
    customer_document: x.customerDoc,
    kind: r.kind as RecvKind,
    description: r.description,
    amount_cents: r.amountCents,
    due_date: r.dueDate,
    status: r.status as ReceivableDTO["status"],
    overdue,
    days_late: overdue ? diffDays(today, r.dueDate) : 0,
    installment: r.installment,
    installments: r.installments,
    created_by: x.creatorName,
    received_date: r.receivedDate,
    received_via: r.receivedVia,
    received_ref: r.receivedRef,
    reason: r.reason,
  };
}

export type RecvFilters = { status?: string; company_id?: string; customer_id?: string; kind?: string; q?: string; date_from?: string; date_to?: string };

export async function listReceivables(db: Db | Tx, f: RecvFilters = {}): Promise<ReceivableDTO[]> {
  const today = todaySP();
  const cond: (SQL | undefined)[] = [];
  if (f.status === "overdue") cond.push(and(eq(receivables.status, "open"), lt(receivables.dueDate, today)));
  else if (f.status) cond.push(eq(receivables.status, f.status));
  if (f.company_id) cond.push(eq(receivables.companyId, f.company_id));
  if (f.customer_id) cond.push(eq(receivables.customerId, f.customer_id));
  if (f.kind) cond.push(eq(receivables.kind, f.kind));
  if (f.date_from) cond.push(gte(receivables.dueDate, parseDate(f.date_from)));
  if (f.date_to) cond.push(lte(receivables.dueDate, parseDate(f.date_to)));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    cond.push(or(ilike(customers.name, like), ilike(receivables.description, like)));
  }
  const rows = await base(db).where(and(...cond)).orderBy(asc(receivables.dueDate), asc(receivables.createdAt));
  return rows.map((x) => toDTO(x, today));
}

export async function getReceivable(db: Db | Tx, id: string): Promise<ReceivableDTO | null> {
  const rows = await base(db).where(eq(receivables.id, id)).limit(1);
  return rows[0] ? toDTO(rows[0]) : null;
}

/** Soma `n` meses mantendo o dia (ajusta para o ultimo dia do mes quando nao existe, ex.: 31 -> 30). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export type ReceivableInput = {
  company_id: string;
  bank_account_id: string;
  customer_id: string;
  kind: string;
  description: string;
  amount: string;
  due_date: string;
  installments?: number;
  request_key?: string | null;
};

export async function createReceivables(user: SessionUser, f: ReceivableInput): Promise<{ ids: string[]; duplicate: boolean }> {
  if (!KINDS.includes(f.kind as RecvKind)) throw new HttpError(422, "Tipo de recebivel invalido");
  const description = f.description.trim().slice(0, 300);
  if (!description) throw new HttpError(422, "Descricao obrigatoria");
  const n = f.installments ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS) throw new HttpError(422, `Parcelas/recorrencia: de 1 a ${MAX_INSTALLMENTS}`);
  if (n > 1 && f.kind === "avulso") throw new HttpError(422, "Recebivel avulso nao se repete: use honorarios ou manutencao");
  const cents = toCents(f.amount);
  const first = parseDate(f.due_date);
  const key = f.request_key?.trim().slice(0, 64) || null;
  return getDb().transaction(async (tx) => {
    if (key) {
      const prior = await tx.select({ id: receivables.id }).from(receivables).where(eq(receivables.requestKey, key)).orderBy(asc(receivables.installment));
      if (prior.length) return { ids: prior.map((x) => x.id), duplicate: true }; // reenvio do mesmo lancamento
    }
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, f.company_id)).limit(1);
    const [cu] = await tx.select().from(customers).where(eq(customers.id, f.customer_id)).limit(1);
    if (!c || !cu) throw new HttpError(404, "CNPJ ou cliente inexistente");
    if (!cu.active) throw new HttpError(422, "Cliente inativo");
    const [b] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, f.bank_account_id)).limit(1);
    if (!b) throw new HttpError(404, "Conta bancaria inexistente");
    if (b.companyId !== f.company_id) throw new HttpError(422, "A conta bancaria nao pertence ao CNPJ selecionado");
    if (!b.active) throw new HttpError(422, "Conta bancaria inativa");
    const ids: string[] = [];
    const at = nowUtc();
    for (let i = 0; i < n; i++) {
      const id = newId();
      ids.push(id);
      await tx.insert(receivables).values({
        id,
        companyId: f.company_id,
        bankAccountId: f.bank_account_id,
        customerId: f.customer_id,
        kind: f.kind,
        description,
        amountCents: cents,
        dueDate: addMonths(first, i),
        status: "open",
        requestKey: key,
        installment: i + 1,
        installments: n,
        createdBy: user.id,
        createdAt: at,
      });
    }
    await log(tx, user, "receivable.create", "receivable", ids[0], { customer: cu.name, kind: f.kind, amount_cents: cents, first_due: first, installments: n, ids });
    return { ids, duplicate: false };
  });
}

/** Baixa: somente em aberto -> recebido. Chamado dentro de transacao (manual; extrato no futuro). */
export async function markReceived(tx: Tx, user: SessionUser, id: string, receivedDate: string, via: "manual" | "extrato", ref: string | null) {
  const rows = await tx
    .update(receivables)
    .set({ status: "received", receivedDate, receivedVia: via, receivedRef: ref, receivedBy: user.id })
    .where(and(eq(receivables.id, id), eq(receivables.status, "open")))
    .returning({ id: receivables.id });
  if (!rows.length) throw new HttpError(409, "Somente recebiveis em aberto podem ser baixados");
  await log(tx, user, "receivable.receive", "receivable", id, { via, received_date: receivedDate, ref });
}

export async function receiveManual(user: SessionUser, id: string, receivedDate?: string, ref?: string) {
  await getDb().transaction(async (tx) => {
    if (!(await getReceivable(tx, id))) throw new HttpError(404, "Recebivel nao encontrado");
    const d = receivedDate ? parseDate(receivedDate) : todaySP();
    if (d > todaySP()) throw new HttpError(422, "Data do recebimento nao pode ser futura");
    await markReceived(tx, user, id, d, "manual", ref?.trim().slice(0, 300) || null);
  });
}

export async function cancelReceivable(user: SessionUser, id: string, reason: string) {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new HttpError(422, "Informe o motivo do cancelamento");
  await getDb().transaction(async (tx) => {
    const r = await getReceivable(tx, id);
    if (!r) throw new HttpError(404, "Recebivel nao encontrado");
    const rows = await tx
      .update(receivables)
      .set({ status: "cancelled", reason: why })
      .where(and(eq(receivables.id, id), eq(receivables.status, "open")))
      .returning({ id: receivables.id });
    if (!rows.length) throw new HttpError(409, "Somente recebiveis em aberto podem ser cancelados");
    await log(tx, user, "receivable.cancel", "receivable", id, { amount_cents: r.amount_cents, reason: why });
  });
}

/* ---------- clientes ---------- */
const cdto = (c: typeof customers.$inferSelect): CustomerDTO => ({ id: c.id, name: c.name, document: c.document, contact: c.contact, active: c.active });
export async function listCustomers(db: Db | Tx): Promise<CustomerDTO[]> {
  return (await db.select().from(customers).orderBy(asc(customers.name))).map(cdto);
}
export async function createCustomer(user: SessionUser, d: { name: string; document: string; contact: string }): Promise<string> {
  const name = d.name.trim().slice(0, 160);
  if (!name) throw new HttpError(422, "Nome obrigatorio");
  const id = newId();
  await getDb().transaction(async (tx) => {
    await tx.insert(customers).values({ id, name, document: d.document.trim().slice(0, 20), contact: d.contact.trim().slice(0, 300), active: true });
    await log(tx, user, "customer.create", "customer", id, { name });
  });
  return id;
}

/* ---------- indicadores ---------- */
const sum = (l: ReceivableDTO[]): Sum => ({ count: l.length, cents: l.reduce((s, r) => s + r.amount_cents, 0) });

export async function receivablesSummary(companyId?: string): Promise<ReceivablesSummaryDTO> {
  const today = todaySP();
  const all = await listReceivables(getDb(), { company_id: companyId || undefined });
  const open = all.filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.overdue);
  const aging: DashboardDTO["aging"] = { a_vencer: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_mais": 0 };
  for (const r of open) {
    const d = diffDays(today, r.due_date);
    aging[d <= 0 ? "a_vencer" : d <= 30 ? "1_30" : d <= 60 ? "31_60" : d <= 90 ? "61_90" : "90_mais"] += r.amount_cents;
  }
  const acc = new Map<string, number>();
  for (const r of overdue) acc.set(r.customer, (acc.get(r.customer) ?? 0) + r.amount_cents);
  const by_customer: Rank[] = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, cents]) => ({ name, cents }));
  const openCents = sum(open).cents;
  return {
    open: sum(open),
    overdue: sum(overdue),
    received_month: sum(all.filter((r) => r.status === "received" && r.received_date?.slice(0, 7) === today.slice(0, 7))),
    next30: sum(open.filter((r) => r.due_date >= today && r.due_date <= addDays(today, 30))),
    default_rate: openCents ? Math.round((sum(overdue).cents / openCents) * 1000) / 10 : 0,
    aging,
    by_customer,
  };
}
