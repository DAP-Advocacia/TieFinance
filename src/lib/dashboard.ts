import { and, count, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, diffDays, todaySP } from "./core";
import { listPayments } from "./payments";
import { listAudit } from "./audit";
import type { SessionUser } from "./auth";
import type { DashboardDTO, PaymentDTO, Rank, Status, Sum } from "./types";

const sum = (l: PaymentDTO[]): Sum => ({ count: l.length, cents: l.reduce((s, p) => s + p.amount_cents, 0) });

function ranking(items: PaymentDTO[], key: (p: PaymentDTO) => string, limit = 8): Rank[] {
  const acc = new Map<string, number>();
  for (const p of items) {
    const k = key(p) || "(sem informacao)";
    acc.set(k, (acc.get(k) ?? 0) + p.amount_cents);
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, cents]) => ({ name, cents }));
}

export async function getDashboard(user: SessionUser, companyId?: string): Promise<DashboardDTO> {
  const db = getDb();
  const today = todaySP();
  const all = await listPayments(db, { company_id: companyId || undefined });
  const by = (s: Status) => all.filter((p) => p.status === s);
  const live = all.filter((p) => p.status === "pending" || p.status === "approved" || p.status === "paid");
  const approved = by("approved");
  const monthKey = today.slice(0, 7);
  const paidMonth = by("paid").filter((p) => p.paid_date?.slice(0, 7) === monthKey);
  const overdue = approved.filter((p) => p.pay_date < today);
  const open = live.filter((p) => p.status !== "paid");
  const next7 = open.filter((p) => p.pay_date >= today && p.pay_date <= addDays(today, 7));
  const decided = all.filter((p) => p.decided_at && p.created_at && (p.status === "approved" || p.status === "paid"));
  const avg = decided.length
    ? Math.round((decided.reduce((s, p) => s + (Date.parse(p.decided_at!) - Date.parse(p.created_at!)), 0) / decided.length / 3600000) * 10) / 10
    : null;

  const [y, m] = today.split("-").map(Number);
  const months: string[] = [];
  for (let off = -5; off <= 2; off++) {
    const idx = y * 12 + (m - 1) + off;
    months.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  const monthly = months.map((k) => ({
    month: k,
    scheduled_cents: live.filter((p) => p.pay_date.slice(0, 7) === k).reduce((s, p) => s + p.amount_cents, 0),
    paid_cents: by("paid").filter((p) => p.paid_date?.slice(0, 7) === k).reduce((s, p) => s + p.amount_cents, 0),
  }));

  const aging = { a_vencer: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_mais": 0 };
  for (const p of approved) {
    const d = diffDays(today, p.pay_date);
    aging[d <= 0 ? "a_vencer" : d <= 30 ? "1_30" : d <= 60 ? "31_60" : d <= 90 ? "61_90" : "90_mais"] += p.amount_cents;
  }

  const weeks = Array.from({ length: 8 }, (_, i) => {
    const a = addDays(today, 7 * i);
    const b = addDays(today, 7 * i + 6);
    return { from: a, cents: open.filter((p) => p.pay_date >= a && p.pay_date <= b).reduce((s, p) => s + p.amount_cents, 0) };
  });

  return {
    kpis: {
      pending: sum(by("pending")),
      approved_open: sum(approved),
      paid_month: sum(paidMonth),
      overdue: sum(overdue),
      rejected: sum(by("rejected")),
      next7: sum(next7),
      avg_approval_hours: avg,
      pending_for_me: by("pending").filter((p) => p.created_by_id !== user.id).length,
      total_live: sum(live),
    },
    monthly,
    by_status: (["pending", "approved", "paid", "rejected", "cancelled"] as Status[]).map((s) => ({ status: s, ...sum(by(s)) })),
    by_company: ranking(live, (p) => p.company),
    by_bank: ranking(live, (p) => p.bank || "(sem conta)"),
    by_cost_center: ranking(live, (p) => p.cost_center),
    top_payees: ranking(live, (p) => p.payee),
    aging,
    weeks,
    upcoming: open.filter((p) => p.pay_date >= today).slice(0, 8),
    recent_audit: user.role === "admin" || user.role === "auditoria" ? await listAudit(db, { limit: 8 }) : [],
  };
}

/** Contagem leve usada pelo menu lateral (selo de pendencias). */
export async function pendingForMe(user: SessionUser): Promise<number> {
  const P = schema.payments;
  const [r] = await getDb()
    .select({ n: count() })
    .from(P)
    .where(and(eq(P.status, "pending"), ne(P.createdBy, user.id)));
  return r.n;
}
