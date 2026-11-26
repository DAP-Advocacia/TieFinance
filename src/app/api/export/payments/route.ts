import { getDb } from "@/db";
import { log } from "@/lib/audit";
import { STATUS_LABEL, brl, fmtDateBR } from "@/lib/core";
import { csv, route } from "@/lib/http";
import { listPayments } from "@/lib/payments";

export const GET = route("any", async ({ req, user }) => {
  const sp = new URL(req.url).searchParams;
  const db = getDb();
  const list = await listPayments(db, {
    status: sp.get("status") ?? "",
    company_id: sp.get("company_id") ?? "",
    bank_account_id: sp.get("bank_account_id") ?? "",
    q: sp.get("q") ?? "",
    date_from: sp.get("date_from") ?? "",
    date_to: sp.get("date_to") ?? "",
  });
  const rows: (string | number | null)[][] = [
    ["CNPJ pagador", "CNPJ", "Conta bancaria", "Favorecido", "Descricao", "Centro de custos", "Valor", "Data agendada", "Situacao", "Criado por", "Decidido por", "Motivo", "Data pagamento", "Forma baixa"],
    ...list.map((p) => [
      p.company,
      p.cnpj,
      p.bank,
      p.payee,
      p.description,
      p.cost_center,
      brl(p.amount_cents),
      fmtDateBR(p.pay_date),
      STATUS_LABEL[p.status],
      p.created_by,
      p.decided_by ?? "",
      p.reason ?? "",
      fmtDateBR(p.paid_date),
      p.paid_via ?? "",
    ]),
  ];
  await log(db, user, "export.payments");
  return csv(rows, "pagamentos.csv");
});
