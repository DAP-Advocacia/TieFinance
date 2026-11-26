import { getDb } from "@/db";
import { log } from "@/lib/audit";
import { brl, fmtDateBR } from "@/lib/core";
import { csv, route } from "@/lib/http";
import { listReceivables } from "@/lib/receivables";
import { RECV_KINDS } from "@/lib/types";

const SITUACAO: Record<string, string> = { open: "Em aberto", received: "Recebido", cancelled: "Cancelado" };

export const GET = route("any", async ({ req, user }) => {
  const sp = new URL(req.url).searchParams;
  const g = (k: string) => sp.get(k) ?? "";
  const db = getDb();
  const list = await listReceivables(db, { status: g("status"), company_id: g("company_id"), customer_id: g("customer_id"), kind: g("kind"), q: g("q"), date_from: g("date_from"), date_to: g("date_to") });
  const rows: (string | number | null)[][] = [
    ["CNPJ", "Conta de destino", "Cliente", "Tipo", "Descricao", "Parcela", "Valor", "Vencimento", "Situacao", "Dias de atraso", "Data recebimento", "Forma baixa", "Referencia", "Motivo", "Lancado por"],
    ...list.map((r) => [
      r.company,
      r.bank,
      r.customer,
      RECV_KINDS.find((k) => k.id === r.kind)?.label ?? r.kind,
      r.description,
      `${r.installment}/${r.installments}`,
      brl(r.amount_cents),
      fmtDateBR(r.due_date),
      r.overdue ? "Vencido" : SITUACAO[r.status],
      r.days_late || "",
      fmtDateBR(r.received_date),
      r.received_via ?? "",
      r.received_ref ?? "",
      r.reason ?? "",
      r.created_by,
    ]),
  ];
  await log(db, user, "export.receivables");
  return csv(rows, "recebiveis.csv");
});
