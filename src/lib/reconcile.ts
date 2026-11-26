import { readSheet } from "read-excel-file/node";
import { getDb } from "@/db";
import { HttpError, MAX_UPLOAD, diffDays, parseDate } from "./core";
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

export async function previewStatement(user: SessionUser, file: File) {
  if (file.size > MAX_UPLOAD) throw new HttpError(422, "Arquivo acima de 4 MB");
  const lines = await readStatement(file.name, Buffer.from(await file.arrayBuffer()));
  const db = getDb();
  const valid = lines.filter((l) => !l.error);
  const hasDebits = valid.some((l) => l.cents! < 0);
  const approved = await listPayments(db, { status: "approved" });
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
      result.push({ ...r2, result: "unmatched", note: "Nenhum agendamento aprovado correspondente" });
    }
  }
  await log(db, user, "reconcile.preview", "statement", "", { file: file.name, lines: lines.length, matches: claimed.size });
  return { lines: result, tolerance_days: tol };
}

export async function confirmReconcile(user: SessionUser, items: { payment_id: string; paid_date: string; ref: string }[], file: string) {
  const db = getDb();
  const paid: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const it of items) {
    try {
      await db.transaction(async (tx) => {
        if (!(await getPayment(tx, it.payment_id))) throw new HttpError(404, "Agendamento nao encontrado");
        await markPaid(tx, user, it.payment_id, parseDate(it.paid_date), "extrato", `${file} ${it.ref}`.trim().slice(0, 300));
      });
      paid.push(it.payment_id);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      errors.push({ id: it.payment_id, error: e.detail });
    }
  }
  await log(db, user, "reconcile.confirm", "statement", "", { file, paid: paid.length, errors: errors.length });
  return { paid, errors };
}
