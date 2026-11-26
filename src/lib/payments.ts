import { and, asc, eq, gte, ilike, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema, type Db, type Tx } from "@/db";
import { ALLOWED_EXT, HttpError, MAX_UPLOAD, newId, nowUtc, parseDate, toCents, todaySP, toIso } from "./core";
import { log } from "./audit";
import type { SessionUser } from "./auth";
import type { PaymentDTO } from "./types";

const { payments, companies, payees, users, attachments, bankAccounts } = schema;
const creator = alias(users, "creator");
const decider = alias(users, "decider");

function base(db: Db | Tx) {
  return db
    .select({
      p: payments,
      companyName: companies.name,
      cnpj: companies.cnpj,
      payeeName: payees.name,
      payeeInfo: payees.paymentInfo,
      creatorName: creator.name,
      deciderName: decider.name,
      bankName: bankAccounts.bank,
      bankNick: bankAccounts.nickname,
    })
    .from(payments)
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .innerJoin(payees, eq(payees.id, payments.payeeId))
    .innerJoin(creator, eq(creator.id, payments.createdBy))
    .leftJoin(decider, eq(decider.id, payments.decidedBy))
    .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId));
}
type Row = Awaited<ReturnType<ReturnType<typeof base>["limit"]>>[number];

export function toDTO(r: Row, today = todaySP()): PaymentDTO {
  const p = r.p;
  return {
    id: p.id,
    company_id: p.companyId,
    company: r.companyName,
    cnpj: r.cnpj,
    payee_id: p.payeeId,
    payee: r.payeeName,
    payee_info: r.payeeInfo,
    description: p.description,
    amount_cents: p.amountCents,
    pay_date: p.payDate,
    cost_center: p.costCenter,
    status: p.status as PaymentDTO["status"],
    has_attachment: !!p.attachment,
    attachment_name: p.attachmentName,
    created_by: r.creatorName,
    created_by_id: p.createdBy,
    created_at: toIso(p.createdAt),
    decided_by: r.deciderName,
    decided_at: toIso(p.decidedAt),
    reason: p.reason,
    paid_date: p.paidDate,
    paid_via: p.paidVia,
    paid_ref: p.paidRef,
    overdue: p.status === "approved" && p.payDate < today,
    bank_account_id: p.bankAccountId,
    bank: r.bankName ? `${r.bankName} · ${r.bankNick}` : "",
  };
}

export type Filters = { status?: string; company_id?: string; bank_account_id?: string; q?: string; date_from?: string; date_to?: string };

export async function listPayments(db: Db | Tx, f: Filters = {}): Promise<PaymentDTO[]> {
  const today = todaySP();
  const cond: (SQL | undefined)[] = [];
  if (f.status === "overdue") cond.push(and(eq(payments.status, "approved"), lt(payments.payDate, today)));
  else if (f.status) cond.push(eq(payments.status, f.status));
  if (f.company_id) cond.push(eq(payments.companyId, f.company_id));
  if (f.bank_account_id) cond.push(eq(payments.bankAccountId, f.bank_account_id));
  if (f.date_from) cond.push(gte(payments.payDate, parseDate(f.date_from)));
  if (f.date_to) cond.push(lte(payments.payDate, parseDate(f.date_to)));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    cond.push(or(ilike(payees.name, like), ilike(payments.description, like)));
  }
  const rows = await base(db)
    .where(and(...cond))
    .orderBy(asc(payments.payDate), asc(payments.createdAt));
  return rows.map((r) => toDTO(r, today));
}

export async function getPayment(db: Db | Tx, id: string): Promise<PaymentDTO | null> {
  const rows = await base(db).where(eq(payments.id, id)).limit(1);
  return rows[0] ? toDTO(rows[0]) : null;
}

const snap = (p: PaymentDTO) => ({
  company: p.company,
  payee: p.payee,
  description: p.description,
  amount_cents: p.amount_cents,
  pay_date: p.pay_date,
  cost_center: p.cost_center,
  bank: p.bank,
  status: p.status,
});

async function saveUpload(tx: Tx, f: File | null): Promise<{ id: string; name: string } | null> {
  if (!f || !f.name) return null;
  const ext = (/\.[^.]+$/.exec(f.name)?.[0] ?? "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw new HttpError(422, "Anexo deve ser PDF, PNG ou JPG");
  if (f.size > MAX_UPLOAD) throw new HttpError(422, "Anexo acima de 4 MB");
  const id = newId() + ext;
  await tx.insert(attachments).values({ id, data: Buffer.from(await f.arrayBuffer()) });
  return { id, name: f.name.split(/[\\/]/).pop()!.slice(0, 200) };
}

export type PaymentForm = {
  company_id: string;
  bank_account_id: string;
  payee_id: string;
  description: string;
  amount: string;
  pay_date: string;
  cost_center: string;
  file: File | null;
};

export function readForm(fd: FormData): PaymentForm {
  const s = (k: string) => String(fd.get(k) ?? "");
  const req = (k: string) => {
    const v = s(k).trim();
    if (!v) throw new HttpError(422, `Campo obrigatorio: ${k}`);
    return v;
  };
  const f = fd.get("file");
  return {
    company_id: req("company_id"),
    bank_account_id: req("bank_account_id"),
    payee_id: req("payee_id"),
    description: req("description").slice(0, 300),
    amount: req("amount"),
    pay_date: req("pay_date"),
    cost_center: s("cost_center").trim().slice(0, 80),
    file: f instanceof File && f.name ? f : null,
  };
}

async function assertRefs(tx: Tx, companyId: string, payeeId: string, bankId: string, currentBankId?: string | null) {
  const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const [p] = await tx.select({ id: payees.id }).from(payees).where(eq(payees.id, payeeId)).limit(1);
  if (!c || !p) throw new HttpError(404, "CNPJ ou favorecido inexistente");
  const [b] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, bankId)).limit(1);
  if (!b) throw new HttpError(404, "Conta bancaria inexistente");
  if (b.companyId !== companyId) throw new HttpError(422, "A conta bancaria nao pertence ao CNPJ pagador selecionado");
  if (!b.active && b.id !== currentBankId) throw new HttpError(422, "Conta bancaria inativa");
}

export async function createPayment(user: SessionUser, f: PaymentForm): Promise<string> {
  return getDb().transaction(async (tx) => {
    await assertRefs(tx, f.company_id, f.payee_id, f.bank_account_id);
    const cents = toCents(f.amount);
    const date = parseDate(f.pay_date);
    const att = await saveUpload(tx, f.file);
    const id = newId();
    await tx.insert(payments).values({
      id,
      companyId: f.company_id,
      payeeId: f.payee_id,
      bankAccountId: f.bank_account_id,
      description: f.description,
      amountCents: cents,
      payDate: date,
      costCenter: f.cost_center,
      status: "pending",
      attachment: att?.id ?? null,
      attachmentName: att?.name ?? null,
      createdBy: user.id,
      createdAt: nowUtc(),
    });
    await log(tx, user, "payment.create", "payment", id, snap((await getPayment(tx, id))!));
    return id;
  });
}

export async function editPayment(user: SessionUser, id: string, f: PaymentForm) {
  await getDb().transaction(async (tx) => {
    const cur = await getPayment(tx, id);
    if (!cur) throw new HttpError(404, "Agendamento nao encontrado");
    if (cur.status !== "pending" && cur.status !== "rejected") throw new HttpError(409, "Somente pendentes ou rejeitados podem ser editados");
    await assertRefs(tx, f.company_id, f.payee_id, f.bank_account_id, cur.bank_account_id);
    const cents = toCents(f.amount);
    const date = parseDate(f.pay_date);
    const att = await saveUpload(tx, f.file);
    await tx
      .update(payments)
      .set({
        companyId: f.company_id,
        payeeId: f.payee_id,
        bankAccountId: f.bank_account_id,
        description: f.description,
        amountCents: cents,
        payDate: date,
        costCenter: f.cost_center,
        ...(att ? { attachment: att.id, attachmentName: att.name } : {}),
        status: "pending",
        reason: null,
        decidedBy: null,
        decidedAt: null,
      })
      .where(eq(payments.id, id));
    await log(tx, user, "payment.edit", "payment", id, { before: snap(cur), after: snap((await getPayment(tx, id))!) });
  });
}

export async function decide(user: SessionUser, id: string, approve: boolean, reason?: string) {
  await getDb().transaction(async (tx) => {
    const p = await getPayment(tx, id);
    if (!p) throw new HttpError(404, "Agendamento nao encontrado");
    if (p.created_by_id === user.id) throw new HttpError(403, "Nao e permitido decidir sobre o proprio agendamento");
    if (!approve && !(reason && reason.trim().length >= 3)) throw new HttpError(422, "Informe o motivo da rejeicao");
    const why = approve ? null : reason!.trim().slice(0, 300);
    // atualizacao condicional: evita decisao dupla em concorrencia
    const rows = await tx
      .update(payments)
      .set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decidedAt: nowUtc(), reason: why })
      .where(and(eq(payments.id, id), eq(payments.status, "pending")))
      .returning({ id: payments.id });
    if (!rows.length) throw new HttpError(409, "Agendamento nao esta pendente");
    await log(tx, user, approve ? "payment.approve" : "payment.reject", "payment", id, { amount_cents: p.amount_cents, reason: why });
  });
}

export async function cancelPayment(user: SessionUser, id: string, reason: string) {
  await getDb().transaction(async (tx) => {
    const p = await getPayment(tx, id);
    if (!p) throw new HttpError(404, "Agendamento nao encontrado");
    if (p.status === "paid" || p.status === "cancelled") throw new HttpError(409, "Agendamento ja pago ou cancelado");
    if (reason.trim().length < 3) throw new HttpError(422, "Informe o motivo do cancelamento");
    const why = reason.trim().slice(0, 300);
    const rows = await tx
      .update(payments)
      .set({ status: "cancelled", reason: why })
      .where(and(eq(payments.id, id), sql`${payments.status} not in ('paid','cancelled')`))
      .returning({ id: payments.id });
    if (!rows.length) throw new HttpError(409, "Agendamento ja pago ou cancelado");
    await log(tx, user, "payment.cancel", "payment", id, { from: p.status, reason: why });
  });
}

/** Baixa: somente aprovado -> pago. Chamado dentro de transacao (manual ou conciliacao). */
export async function markPaid(tx: Tx, user: SessionUser, id: string, paidDate: string, via: "manual" | "extrato", ref: string | null) {
  const rows = await tx
    .update(payments)
    .set({ status: "paid", paidDate, paidVia: via, paidRef: ref })
    .where(and(eq(payments.id, id), eq(payments.status, "approved")))
    .returning({ id: payments.id });
  if (!rows.length) throw new HttpError(409, "Somente agendamentos aprovados podem ser pagos");
  await log(tx, user, "payment.pay", "payment", id, { via, paid_date: paidDate, ref });
}

export async function payManual(user: SessionUser, id: string, paidDate?: string) {
  await getDb().transaction(async (tx) => {
    if (!(await getPayment(tx, id))) throw new HttpError(404, "Agendamento nao encontrado");
    await markPaid(tx, user, id, paidDate ? parseDate(paidDate) : todaySP(), "manual", null);
  });
}
