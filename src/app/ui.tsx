"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PaymentDTO, Rank, Role, UserDTO, DashboardDTO } from "@/lib/types";
import { MN, ST, STC, STATUS_VAR, brl, brlk, dd, openAttachment } from "./client";

/* ---------- toast ---------- */
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div id="msg" style={{ display: msg ? "block" : "none" }} role="status">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- blocos ---------- */
export function Pill({ p }: { p: Pick<PaymentDTO, "status" | "overdue"> }) {
  const s = p.overdue ? "overdue" : p.status;
  return <span className={`pill ${STC[s]}`}>{ST[s]}</span>;
}
export function Metric({ label, value, sub, tone = "", onClick }: { label: string; value: React.ReactNode; sub: React.ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <div className={`metric ${onClick ? "click" : ""}`} onClick={onClick}>
      <div className="label">{label}</div>
      <strong className={tone}>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
export const Metrics = ({ children }: { children: React.ReactNode }) => <div className="metrics">{children}</div>;
export function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="ptitle">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------- gráficos (sem dependências, só tokens CSS) ---------- */
export function HBars({ list, color = "var(--brand-claro)" }: { list: Rank[]; color?: string }) {
  if (!list.length) return <p className="small">Sem dados.</p>;
  const mx = Math.max(...list.map((x) => x.cents), 1);
  return (
    <>
      {list.map((x) => (
        <div className="bar" key={x.name}>
          <span className="nm" title={x.name}>{x.name}</span>
          <span className="tr"><span className="fl" style={{ display: "block", width: `${(x.cents / mx) * 100}%`, background: color }} /></span>
          <span className="v">{brlk(x.cents)}</span>
        </div>
      ))}
    </>
  );
}

export function BarChart({ m }: { m: DashboardDTO["monthly"] }) {
  const mx = Math.max(...m.flatMap((x) => [x.scheduled_cents, x.paid_cents]), 1);
  const H = 150, W = 560, bw = (W - 70) / m.length;
  return (
    <svg viewBox={`0 0 ${W} 190`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Agendado e pago por mês">
      <g fontSize="10">
        {[0, 1, 2, 3].map((i) => {
          const y = 10 + i * (H / 3);
          return (
            <g key={i}>
              <text x="0" y={y + 3} style={{ fill: "var(--ink-3)" }}>{brlk((mx * (3 - i)) / 3)}</text>
              <line x1="58" x2={W} y1={y} y2={y} style={{ stroke: "var(--line)" }} />
            </g>
          );
        })}
      </g>
      {m.map((x, i) => {
        const a = (x.scheduled_cents / mx) * H, b = (x.paid_cents / mx) * H, X = 64 + i * bw, lab = MN[+x.month.slice(5) - 1];
        return (
          <g key={x.month}>
            <rect x={X} y={160 - a} width={bw / 2 - 4} height={a} rx="3" style={{ fill: "var(--brand-claro)" }}><title>{`Agendado ${lab}: ${brl(x.scheduled_cents)}`}</title></rect>
            <rect x={X + bw / 2 - 2} y={160 - b} width={bw / 2 - 4} height={b} rx="3" style={{ fill: "var(--ok)" }}><title>{`Pago ${lab}: ${brl(x.paid_cents)}`}</title></rect>
            <text x={X + bw / 2 - 2} y="178" textAnchor="middle" fontSize="11" style={{ fill: "var(--ink-3)" }}>{lab}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ items }: { items: DashboardDTO["by_status"] }) {
  const tot = items.reduce((s, x) => s + x.cents, 0);
  if (!tot) return <p className="small">Sem dados.</p>;
  let acc = 0;
  const g = items.filter((x) => x.cents).map((x) => { const a = (acc / tot) * 100; acc += x.cents; return `${STATUS_VAR[x.status]} ${a}% ${(acc / tot) * 100}%`; }).join(",");
  return (
    <div className="donutrow">
      <div style={{ width: 130, height: 130, borderRadius: "50%", background: `conic-gradient(${g})`, display: "grid", placeItems: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", textAlign: "center", fontSize: 11, color: "var(--ink-3)" }}>
          <div><b style={{ fontSize: 14, color: "var(--ink)" }}>{items.reduce((s, x) => s + x.count, 0)}</b><br />agend.</div>
        </div>
      </div>
      <div style={{ fontSize: 12, display: "grid", gap: 7 }}>
        {items.map((x) => (
          <div key={x.status}><i className="dot" style={{ background: STATUS_VAR[x.status] }} />{ST[x.status]}: <b>{x.count}</b> · {brlk(x.cents)}</div>
        ))}
      </div>
    </div>
  );
}

export function WeekChart({ w }: { w: DashboardDTO["weeks"] }) {
  const mx = Math.max(...w.map((x) => x.cents), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130 }}>
      {w.map((x, i) => (
        <div key={x.from} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--ink-3)" }}>
          <div title={brl(x.cents)} style={{ height: Math.max((x.cents / mx) * 100, 2), background: i ? "var(--line-2)" : "var(--brand)", borderRadius: "4px 4px 0 0" }} />
          {dd(x.from).slice(0, 5)}<br /><b style={{ color: "var(--ink)" }}>{brlk(x.cents)}</b>
        </div>
      ))}
    </div>
  );
}

export function AgingChart({ a }: { a: DashboardDTO["aging"] }) {
  return <HBars list={[{ name: "A vencer", cents: a.a_vencer }, { name: "1–30 dias", cents: a["1_30"] }, { name: "31–60", cents: a["31_60"] }, { name: "61–90", cents: a["61_90"] }, { name: "+90", cents: a["90_mais"] }]} />;
}

/* ---------- modal ---------- */
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose}>{open && children}</dialog>;
}

/* ---------- tabela de agendamentos ---------- */
export type RowActions = {
  user: { id: string; role: Role; name: string };
  onEdit: (id: string) => void;
  onPay: (id: string) => void;
  onCancel: (id: string) => void;
  onDecide: (id: string, ok: boolean) => void;
};
function Actions({ p, a }: { p: PaymentDTO; a: RowActions }) {
  const fin = a.user.role === "financeiro" || a.user.role === "admin";
  const apr = a.user.role === "aprovador" || a.user.role === "admin";
  return (
    <>
      {p.has_attachment && <button className="secondary sm" onClick={() => openAttachment(p.id)}>Anexo</button>}{" "}
      {fin && (p.status === "pending" || p.status === "rejected") && <button className="secondary sm" onClick={() => a.onEdit(p.id)}>Editar</button>}{" "}
      {fin && p.status === "approved" && <button className="ok sm" onClick={() => a.onPay(p.id)}>Marcar pago</button>}{" "}
      {fin && p.status !== "paid" && p.status !== "cancelled" && <button className="danger sm" onClick={() => a.onCancel(p.id)}>Cancelar</button>}{" "}
      {apr && p.status === "pending" && p.created_by_id !== a.user.id && (
        <>
          <button className="ok sm" onClick={() => a.onDecide(p.id, true)}>Aprovar</button>{" "}
          <button className="danger sm" onClick={() => a.onDecide(p.id, false)}>Rejeitar</button>
        </>
      )}
    </>
  );
}
export function PaymentsTable({ list, a, selectable, selected, onSelect }: { list: PaymentDTO[]; a: RowActions; selectable?: boolean; selected?: Set<string>; onSelect?: (s: Set<string>) => void }) {
  if (!list.length) return <p className="small">Nenhum agendamento.</p>;
  const mine = (p: PaymentDTO) => p.created_by_id === a.user.id;
  const toggle = (id: string, on: boolean) => { const n = new Set(selected); on ? n.add(id) : n.delete(id); onSelect?.(n); };
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            {selectable && <th><input type="checkbox" onChange={(e) => onSelect?.(new Set(e.target.checked ? list.filter((p) => !mine(p)).map((p) => p.id) : []))} /></th>}
            <th>Data</th><th>CNPJ pagador</th><th>Favorecido</th><th>Descrição</th><th className="n">Valor</th><th>Situação</th><th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              {selectable && <td><input type="checkbox" disabled={mine(p)} title={mine(p) ? "Você criou este agendamento" : undefined} checked={!!selected?.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} /></td>}
              <td>{dd(p.pay_date)}</td>
              <td>{p.company}</td>
              <td>{p.payee}<div className="small">{p.payee_info}</div></td>
              <td>{p.description}<div className="small">{p.cost_center} · por {p.created_by}</div></td>
              <td className="n"><b>{brl(p.amount_cents)}</b></td>
              <td><Pill p={p} /><div className="small">{p.reason}{p.paid_date ? `pago em ${dd(p.paid_date)} (${p.paid_via})` : ""}</div></td>
              <td><Actions p={p} a={a} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { UserDTO };
