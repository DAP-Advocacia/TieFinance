"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RECV_KINDS, type CustomerDTO, type ReceivableDTO, type ReceivablesSummaryDTO } from "@/lib/types";
import { J, brl, brlk, dd, download, todayLocal } from "./client";
import { Select } from "./select";
import { AgingChart, HBars, Metric, Metrics, Modal, Panel, useToast } from "./ui";
import type { Ctx } from "./views";

const KIND = Object.fromEntries(RECV_KINDS.map((k) => [k.id, k.label])) as Record<string, string>;
const SIT: Record<string, string> = { open: "Em aberto", received: "Recebido", cancelled: "Cancelado", overdue: "Vencido" };
const SITC: Record<string, string> = { open: "info", received: "good", cancelled: "", overdue: "bad" };
const canEdit = (c: Ctx) => c.me.role === "financeiro" || c.me.role === "admin";

/* ---------- lançamento (modal) ---------- */
export function ReceivableFormModal({ c, customers, open, onClose, onSaved }: { c: Ctx; customers: CustomerDTO[]; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [co, setCo] = useState<string | null>(null);
  const [kind, setKind] = useState("honorario");
  const key = useRef("");
  useEffect(() => {
    if (open) { setCo(null); setKind("honorario"); key.current = crypto.randomUUID().replace(/-/g, ""); c.reloadRefs(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const companies = c.companies.filter((x) => x.active);
  const coId = co ?? companies[0]?.id ?? "";
  const accs = c.banks.filter((b) => b.company_id === coId && b.active);
  const cust = customers.filter((x) => x.active);
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const r = await J<{ ids: string[]; duplicate: boolean }>("/receivables", {
        method: "POST",
        json: { ...f, installments: kind === "avulso" ? 1 : Number(f.installments || 1), request_key: key.current },
      });
      toast(r.duplicate ? "Lançamento já registrado (reenvio ignorado)" : r.ids.length > 1 ? `${r.ids.length} recebíveis lançados` : "Recebível lançado");
      onClose(); onSaved();
    } catch (er) { toast((er as Error).message); }
  };
  return (
    <Modal open={open} onClose={onClose}>
      <h2>Novo recebível</h2>
      <form onSubmit={save}>
        <div className="fg">
          <label>CNPJ recebedor<Select name="company_id" value={coId} onChange={setCo}>{companies.map((x) => <option key={x.id} value={x.id}>{x.name}{x.cnpj ? " · " + x.cnpj : ""}</option>)}</Select></label>
          <label>Conta de destino<Select key={coId} name="bank_account_id">{accs.map((b) => <option key={b.id} value={b.id}>{b.bank} · {b.nickname}</option>)}</Select>{!accs.length && <span className="small" style={{ color: "var(--err)" }}>Este CNPJ não tem conta bancária. Cadastre em Administração.</span>}</label>
          <label>Cliente<Select name="customer_id">{cust.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>{!cust.length && <span className="small" style={{ color: "var(--err)" }}>Cadastre um cliente antes.</span>}</label>
          <label>Tipo<Select name="kind" value={kind} onChange={setKind}>{RECV_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></label>
          <label>Valor (R$)<input name="amount" required placeholder="1500.00" /></label>
          <label>{kind === "avulso" ? "Vencimento" : "Primeiro vencimento"}<input type="date" name="due_date" required defaultValue={todayLocal()} /></label>
          {kind !== "avulso" && <label>Meses (mensal, mesmo dia)<input type="number" name="installments" min={1} max={60} defaultValue={1} /></label>}
          <label className="wide">Descrição<input name="description" required maxLength={300} /></label>
        </div>
        <div className="actions"><button className="primary" disabled={!accs.length || !cust.length}>Lançar</button><button type="button" className="secondary" onClick={onClose}>Fechar</button></div>
      </form>
    </Modal>
  );
}

/* ---------- tela ---------- */
export function ReceivablesView({ c, tick }: { c: Ctx; tick: number }) {
  const toast = useToast();
  const [f, setF] = useState({ status: "", company_id: "", customer_id: "", kind: "", date_from: "", date_to: "", q: "" });
  const [list, setList] = useState<ReceivableDTO[]>([]);
  const [sm, setSm] = useState<ReceivablesSummaryDTO | null>(null);
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [open, setOpen] = useState(false);
  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const load = useCallback(() => {
    J<ReceivableDTO[]>("/receivables?" + qs()).then(setList).catch((e) => toast(e.message));
    J<ReceivablesSummaryDTO>("/receivables/summary").then(setSm).catch((e) => toast(e.message));
    J<CustomerDTO[]>("/customers").then(setCustomers).catch((e) => toast(e.message));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { toast((e as Error).message); } };
  const receive = (id: string) => { const d = prompt("Data do recebimento (AAAA-MM-DD):", todayLocal()); if (d) run(() => J(`/receivables/${id}/receive`, { method: "POST", json: { received_date: d } })); };
  const cancel = (id: string) => { const m = prompt("Motivo do cancelamento:"); if (m) run(() => J(`/receivables/${id}/cancel`, { method: "POST", json: { reason: m } })); };
  const addCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try { await J("/customers", { method: "POST", json: Object.fromEntries(new FormData(form)) }); form.reset(); load(); } catch (er) { toast((er as Error).message); }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const setS = (k: string) => (v: string) => setF({ ...f, [k]: v });
  const sum = (fn: (r: ReceivableDTO) => boolean) => list.filter(fn).reduce((s, r) => s + r.amount_cents, 0);
  const edit = canEdit(c);
  return (
    <>
      {sm && (
        <Metrics>
          <Metric label="A receber" value={brl(sm.open.cents)} sub={`${sm.open.count} em aberto`} tone="blue" />
          <Metric label="Vencido" value={brl(sm.overdue.cents)} sub={`${sm.overdue.count} título(s) · inadimplência ${sm.default_rate.toLocaleString("pt-BR")}%`} tone="red" onClick={() => setF({ ...f, status: "overdue" })} />
          <Metric label="Recebido no mês" value={brl(sm.received_month.cents)} sub={`${sm.received_month.count} baixa(s)`} tone="green" />
          <Metric label="Próximos 30 dias" value={brl(sm.next30.cents)} sub={`${sm.next30.count} a vencer`} tone="amber" />
        </Metrics>
      )}
      {sm && (
        <div className="grid2">
          <Panel title="Aging da carteira" sub="saldo em aberto por atraso"><AgingChart a={sm.aging} /></Panel>
          <Panel title="Maiores inadimplentes" sub="valor vencido por cliente">{sm.by_customer.length ? <HBars list={sm.by_customer} color="var(--err)" /> : <p className="small">Nenhum título vencido.</p>}</Panel>
        </div>
      )}
      {edit && (
        <Panel title="Novo cliente">
          <form className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }} onSubmit={addCustomer}>
            <label>Nome<input name="name" required /></label><label>CPF/CNPJ<input name="document" /></label>
            <label>Contato<input name="contact" style={{ width: 260 }} placeholder="e-mail / telefone" /></label><button className="primary">Cadastrar</button>
          </form>
        </Panel>
      )}
      <div className="filters">
        <label>Situação<Select value={f.status} onChange={setS("status")}><option value="">Todas</option>{Object.entries(SIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label>CNPJ<Select value={f.company_id} onChange={setS("company_id")}><option value="">Todos</option>{c.companies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label>Cliente<Select value={f.customer_id} onChange={setS("customer_id")}><option value="">Todos</option>{customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label>Tipo<Select value={f.kind} onChange={setS("kind")}><option value="">Todos</option>{RECV_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></label>
        <label>De<input type="date" value={f.date_from} onChange={set("date_from")} /></label>
        <label>Até<input type="date" value={f.date_to} onChange={set("date_to")} /></label>
        <label>Busca<input value={f.q} onChange={set("q")} placeholder="cliente ou descrição" /></label>
        <button className="primary" onClick={load}>Filtrar</button>
        <button className="secondary" onClick={() => download("/export/receivables?" + qs(), "recebiveis.csv").catch((e) => toast(e.message))}>Exportar Excel (CSV)</button>
        {edit && <button className="primary" onClick={() => setOpen(true)}>+ Novo recebível</button>}
      </div>
      <Panel title="Recebíveis" sub={`${list.length} no filtro · em aberto ${brlk(sum((r) => r.status === "open"))}`}>
        <div className="tw">
          <table>
            <thead><tr><th>Vencimento</th><th>Cliente</th><th>Tipo</th><th>Descrição</th><th>Conta de destino</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => {
                const s = r.overdue ? "overdue" : r.status;
                return (
                  <tr key={r.id}>
                    <td>{dd(r.due_date)}{r.overdue && <div className="small" style={{ color: "var(--err)" }}>{r.days_late} dia(s) de atraso</div>}</td>
                    <td>{r.customer}</td>
                    <td>{KIND[r.kind]}{r.installments > 1 && <div className="small">{r.installment}/{r.installments}</div>}</td>
                    <td>{r.description}</td>
                    <td>{r.bank}<div className="small">{r.company}</div></td>
                    <td>{brl(r.amount_cents)}</td>
                    <td><span className={`pill ${SITC[s]}`}>{SIT[s]}</span>{r.received_date && <div className="small">{dd(r.received_date)}</div>}{r.reason && <div className="small">{r.reason}</div>}</td>
                    <td>{edit && r.status === "open" && <span style={{ display: "flex", gap: 6 }}><button className="primary sm" onClick={() => receive(r.id)}>Baixar</button><button className="secondary sm" onClick={() => cancel(r.id)}>Cancelar</button></span>}</td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={8} className="small">Nenhum recebível.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <ReceivableFormModal c={c} customers={customers} open={open} onClose={() => setOpen(false)} onSaved={load} />
    </>
  );
}
