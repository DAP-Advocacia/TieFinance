import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { readSheet } from "read-excel-file/node";
import { getDb, schema } from "@/db";
import { HttpError, MAX_UPLOAD, diffDays, nowUtc, parseDate, toIso } from "./core";
import { log } from "./audit";
import { getPayment, listPayments, markPaid } from "./payments";
import type { SessionUser } from "./auth";
import type { PaymentDTO, ReconcileLine } from "./types";

const TOLERANCE = () => Number(process.env.RECONCILE_TOLERANCE_DAYS ?? 3);

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Parser CSV minimo (RFC 4180): aspas, delimitador e quebras de linha dentro de campos. */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export function parseAmount(v: unknown): number {
  if (typeof v === "number") return Math.round(v * 100);
  let s = String(v ?? "").trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) throw new Error("vazio");
  const neg = s.startsWith("-") || s.endsWith("-") || (s.startsWith("(") && s.endsWith(")")) || /d$/i.test(s);
  s = s.replace(/^[()+-]+|[()+-]+$/g, "").replace(/[dc]$/i, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("valor");
  const c = Math.round(Number(s) * 100);
  return neg ? -Math.abs(c) : c;
}

export function parseStmtDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim().slice(0, 10);
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return parseDate(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return parseDate(s);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (m) return parseDate(`20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  throw new Error("data");
}

const DATE_COLS = new Set(["data", "date", "data pagamento", "data lancamento", "dt"]);
const AMOUNT_COLS = new Set(["valor", "amount", "valor (r$)", "valor r$", "debito"]);
const DESC_COLS = new Set(["descricao", "historico", "favorecido", "beneficiario", "memo", "lancamento", "complemento", "nome"]);

type StmtLine = { line: number; description: string; date?: string; cents?: number; error?: string };

export async function readStatement(name: string, buf: Buffer): Promise<StmtLine[]> {
  let rows: unknown[][];
  if (/\.xlsx?m?$/i.test(name)) {
    if (!/\.xls[xm]$/i.test(name)) throw new HttpError(422, "Use CSV ou XLSX");
    rows = (await readSheet(buf)) as unknown[][];
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
    } catch {
      text = new TextDecoder("latin1").decode(buf);
    }
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    const semis = (first.match(/;/g) ?? []).length;
    const commas = (first.match(/,/g) ?? []).length;
    rows = parseCsv(text, semis >= commas ? ";" : ",");
  }
  if (!rows.length) throw new HttpError(422, "Arquivo vazio");
  const head = rows[0].map(norm);
  const di = head.findIndex((h) => DATE_COLS.has(h));
  const ai = head.findIndex((h) => AMOUNT_COLS.has(h));
  const ci = head.flatMap((h, i) => (DESC_COLS.has(h) ? [i] : []));
  if (di < 0 || ai < 0) throw new HttpError(422, "Cabecalho precisa ter colunas de data e valor (ex.: Data; Descricao; Valor)");
  const out: StmtLine[] = [];
  rows.slice(1).forEach((r, idx) => {
    if (!r.length || r.every((c) => c === null || c === undefined || c === "")) return;
    const description = ci.map((i) => r[i]).filter((c) => c !== null && c !== undefined && c !== "").join(" ");
    const item: StmtLine = { line: idx + 2, description };
    try {
      item.date = parseStmtDate(r[di]);
      item.cents = parseAmount(r[ai]);
    } catch {
      item.error = "Linha ilegivel (data ou valor)";
    }
    out.push(item);
  });
  return out;
}

async function loadAccount(bankAccountId: string) {
  const [acc] = await getDb()
    .select({ id: schema.bankAccounts.id, bank: schema.bankAccounts.bank, kind: schema.bankAccounts.kind, nickname: schema.bankAccounts.nickname, company: schema.companies.name, active: schema.bankAccounts.active })
    .from(schema.bankAccounts)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.bankAccounts.companyId))
    .where(eq(schema.bankAccounts.id, bankAccountId))
    .limit(1);
  if (!acc) throw new HttpError(404, "Conta bancaria inexistente");
  return acc;
}

export async function previewStatement(user: SessionUser, file: File, bankAccountId: string) {
  if (file.size > MAX_UPLOAD) throw new HttpError(422, "Arquivo acima de 4 MB");
  const account = await loadAccount(bankAccountId);
  const raw = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(raw).digest("hex");
  const lines = await readStatement(file.name, raw);
  const db = getDb();
  const [dup] = await db
    .select({ at: schema.statementImports.importedAt, name: schema.statementImports.filename })
    .from(schema.statementImports)
    .where(and(eq(schema.statementImports.bankAccountId, bankAccountId), eq(schema.statementImports.fileHash, fileHash)))
    .orderBy(desc(schema.statementImports.id))
    .limit(1);
  const valid = lines.filter((l) => !l.error);
  const hasDebits = valid.some((l) => l.cents! < 0);
  // so concilia com pagamentos agendados NESTA conta bancaria
  const approved = await listPayments(db, { status: "approved", bank_account_id: bankAccountId });
  const tol = TOLERANCE();
  const claimed = new Map<string, number>();
  const result: ReconcileLine[] = [];

  for (const l of lines) {
    const row = { line: l.line, description: l.description };
    if (l.error) {
      result.push({ ...row, result: "error", note: l.error });
      continue;
    }
    const abs = Math.abs(l.cents!);
    const r2 = { ...row, date: l.date, amount_cents: abs };
    if (hasDebits && l.cents! >= 0) {
      result.push({ ...r2, result: "ignored", note: "Entrada/credito ignorado" });
      continue;
    }
    let cands: PaymentDTO[] = approved.filter((p) => p.amount_cents === abs && Math.abs(diffDays(p.pay_date, l.date!)) <= tol);
    if (cands.length > 1) {
      const d = norm(l.description);
      const scored = cands.map((p) => ({ s: norm(p.payee).split(" ").filter((t) => t.length >= 3 && d.includes(t)).length, p }));
      const top = Math.max(...scored.map((x) => x.s));
      const best = scored.filter((x) => x.s === top && top > 0).map((x) => x.p);
      if (best.length) cands = best;
    }
    if (cands.length === 1 && !claimed.has(cands[0].id)) {
      claimed.set(cands[0].id, l.line);
      result.push({ ...r2, result: "match", payment: cands[0] });
    } else if (cands.length >= 1) {
      result.push({ ...r2, result: "ambiguous", note: "Mais de um candidato ou ja usado em outra linha", candidates: cands });
    } else {
      result.push({ ...r2, result: "unmatched", note: "Nenhum agendamento aprovado correspondente nesta conta" });
    }
  }
  await log(db, user, "reconcile.preview", "statement", bankAccountId, { file: file.name, lines: lines.length, matches: claimed.size, duplicate: !!dup });
  return {
    lines: result,
    tolerance_days: tol,
    account: { id: account.id, bank: account.bank, kind: account.kind, nickname: account.nickname, company: account.company },
    file_hash: fileHash,
    total_lines: lines.length,
    duplicate_of: dup ? { at: toIso(dup.at), filename: dup.name } : null,
  };
}

export async function confirmReconcile(user: SessionUser, items: { payment_id: string; paid_date: string; ref: string }[], file: string, bankAccountId: string, fileHash: string, totalLines: number) {
  const account = await loadAccount(bankAccountId);
  const db = getDb();
  const paid: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const it of items) {
    try {
      await db.transaction(async (tx) => {
        const p = await getPayment(tx, it.payment_id);
        if (!p) throw new HttpError(404, "Agendamento nao encontrado");
        if (p.bank_account_id !== bankAccountId) throw new HttpError(409, "Agendamento pertence a outra conta bancaria");
        await markPaid(tx, user, it.payment_id, parseDate(it.paid_date), "extrato", `${account.bank} ${file} ${it.ref}`.trim().slice(0, 300));
      });
      paid.push(it.payment_id);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      errors.push({ id: it.payment_id, error: e.detail });
    }
  }
  if (paid.length) await db.insert(schema.statementImports).values({ bankAccountId, filename: file.slice(0, 200), fileHash, importedBy: user.id, importedAt: nowUtc(), lines: totalLines || items.length, paid: paid.length });
  await log(db, user, "reconcile.confirm", "statement", bankAccountId, { bank: account.bank, file, paid: paid.length, errors: errors.length });
  return { paid, errors };
}
