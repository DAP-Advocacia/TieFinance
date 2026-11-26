"use client";
import { useCallback, useEffect, useState } from "react";
import type { AuditDTO, CompanyDTO, DashboardDTO, PayeeDTO, PaymentDTO, ReconcileLine, Role, UserDTO } from "@/lib/types";
import { RL, ST, api, brl, dd, dt, download, J, todayLocal } from "./client";
import { Select } from "./select";
import { AgingChart, BarChart, Donut, HBars, Metric, Metrics, Modal, Panel, PaymentsTable, WeekChart, useToast, type RowActions } from "./ui";

export type Me = { id: string; name: string; email: string; role: Role };
export type Ctx = { me: Me; companies: CompanyDTO[]; payees: PayeeDTO[]; reloadRefs: () => Promise<void>; go: (t: string) => void; refresh: () => void };

const can = (me: Me, ...r: Role[]) => r.includes(me.role);

/** Ações de linha compartilhadas (editar/pagar/cancelar/aprovar/rejeitar). */
function useRowActions(c: Ctx, onDone: () => void, onEdit: (id: string) => void): RowActions {
  const toast = useToast();
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); onDone(); c.refresh(); } catch (e) { toast((e as Error).message); }
  };
  return {
    user: c.me,
    onEdit,
    onPay: (id) => { const d = prompt("Data do pagamento (AAAA-MM-DD):", todayLocal()); if (d) run(() => J(`/payments/${id}/pay`, { method: "POST", json: { paid_date: d } })); },
    onCancel: (id) => { const m = prompt("Motivo do cancelamento:"); if (m) run(() => J(`/payments/${id}/cancel`, { method: "POST", json: { reason: m } })); },
    onDecide: (id, ok) => {
      if (ok) { if (confirm("Aprovar este agendamento?")) run(() => J(`/payments/${id}/approve`, { method: "POST" })); }
      else { const m = prompt("Motivo da rejeição:"); if (m) run(() => J(`/payments/${id}/reject`, { method: "POST", json: { reason: m } })); }
    },
  };
}

/* ---------- formulário (modal) ---------- */
export function PaymentFormModal({ c, editId, open, onClose, onSaved }: { c: Ctx; editId: string | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<PaymentDTO | null>(null);
  useEffect(() => {
    setP(null);
    if (open && editId) J<PaymentDTO[]>("/payments").then((l) => setP(l.find((x) => x.id === editId) ?? null)).catch((e) => toast(e.message));
    if (open) c.reloadRefs();
  }, [open, editId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!(f.get("file") as File)?.name) f.delete("file");
    try {
      await api("/payments" + (editId ? "/" + editId : ""), { method: editId ? "PUT" : "POST", body: f });
      toast("Salvo"); onClose(); onSaved(); c.refresh();
    } catch (er) { toast((er as Error).message); }
  };
  if (editId && !p) return <Modal open={open} onClose={onClose}><p className="small">Carregando…</p></Modal>;
  const active = <T extends { id: string; active: boolean }>(a: T[], keep?: string) => a.filter((x) => x.active || x.id === keep);
  return (
    <Modal open={open} onClose={onClose}>
      <h2>{p ? "Editar agendamento" : "Novo agendamento"}</h2>
      {p?.reason && <div className="notice">Rejeitado: {p.reason}. Ao salvar, volta para aprovação.</div>}
      <form onSubmit={save}>
        <div className="fg">
          <label>CNPJ pagador<Select name="company_id" defaultValue={p?.company_id}>{active(c.companies, p?.company_id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.cnpj ? " · " + x.cnpj : ""}</option>)}</Select></label>
          <label>Favorecido<Select name="payee_id" defaultValue={p?.payee_id}>{active(c.payees, p?.payee_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
          <label>Valor (R$)<input name="amount" required placeholder="1500.00" defaultValue={p ? (p.amount_cents / 100).toFixed(2) : ""} /></label>
          <label>Data do pagamento<input type="date" name="pay_date" required defaultValue={p?.pay_date} /></label>
          <label className="wide">Descrição<input name="description" required maxLength={300} defaultValue={p?.description} /></label>
          <label>Centro de custos<input name="cost_center" defaultValue={p?.cost_center} /></label>
          <label>Anexo (PDF, PNG, JPG · até 4 MB)<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" /></label>
        </div>
        <div className="actions"><button className="primary">{p ? "Salvar e reenviar" : "Agendar"}</button><button type="button" className="secondary" onClick={onClose}>Fechar</button></div>
      </form>
    </Modal>
  );
}

/* ---------- dashboard ---------- */
export function Dashboard({ c, tick, onBadge }: { c: Ctx; tick: number; onBadge: (n: number) => void }) {
  const toast = useToast();
  const [co, setCo] = useState("");
  const [d, setD] = useState<DashboardDTO | null>(null);
  const [pend, setPend] = useState<PaymentDTO[]>([]);
  const [edit, setEdit] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    J<DashboardDTO>("/dashboard" + (co ? `?company_id=${co}` : "")).then((x) => { setD(x); onBadge(x.kpis.pending_for_me); })
      .catch((e) => toast(e.message));
    if (can(c.me, "aprovador", "admin")) J<PaymentDTO[]>("/payments?status=pending").then((l) => setPend(l.slice(0, 5)));
  }, [co, tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const a = useRowActions(c, () => setN((x) => x + 1), (id) => setEdit(id));
  if (!d) return <p className="small">Carregando…</p>;
  const k = d.kpis;
  return (
    <>
      <div className="filters">
        <label>CNPJ pagador<Select value={co} onChange={setCo}><option value="">Todos os CNPJs</option>{c.companies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
      </div>
      <Metrics>
        <Metric label="Aguardando aprovação" value={brl(k.pending.cents)} sub={`${k.pending.count} agendamento(s)`} tone="amber" onClick={() => c.go(can(c.me, "aprovador", "admin") ? "pend" : "pay")} />
        <Metric label="Aprovado a pagar" value={brl(k.approved_open.cents)} sub={`${k.approved_open.count} aprovado(s) em aberto`} tone="blue" />
        <Metric label="Pago no mês" value={brl(k.paid_month.cents)} sub={`${k.paid_month.count} baixa(s)`} tone="green" />
        <Metric label="Atrasados" value={brl(k.overdue.cents)} sub={`${k.overdue.count} aprovado(s) vencido(s) sem baixa`} tone="red" />
      </Metrics>
      <Metrics>
        <Metric label="Próximos 7 dias" value={brl(k.next7.cents)} sub={`${k.next7.count} pagamento(s) a sair`} />
        <Metric label="Total comprometido" value={brl(k.total_live.cents)} sub="Pendentes + aprovados + pagos" />
        <Metric label="Tempo médio de aprovação" value={k.avg_approval_hours == null ? "—" : `${k.avg_approval_hours} h`} sub="Do agendamento à decisão" />
        <Metric label="Rejeitados" value={k.rejected.count} sub={`${brl(k.rejected.cents)} devolvidos ao financeiro`} />
      </Metrics>
      {pend.length > 0 && <Panel title="Aguardando sua decisão" sub='Os 5 mais próximos · veja todos em "Para aprovar"'><PaymentsTable list={pend} a={a} /></Panel>}
      <div className="grid2">
        <Panel title="Agendado × pago por mês" sub="Agendado pela data do pagamento; pago pela data da baixa">
          <div className="legend"><span><i className="dot" style={{ background: "var(--brand-claro)" }} />Agendado</span><span><i className="dot" style={{ background: "var(--ok)" }} />Pago</span></div>
          <BarChart m={d.monthly} />
        </Panel>
        <Panel title="Situação dos agendamentos" sub="Quantidade e valor por situação"><Donut items={d.by_status} /></Panel>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <Panel title="Saídas previstas — próximas 8 semanas" sub="Pendentes + aprovados ainda não pagos, por semana"><WeekChart w={d.weeks} /></Panel>
        <Panel title="Aging dos aprovados em aberto" sub="Atraso em relação à data agendada"><AgingChart a={d.aging} /></Panel>
      </div>
      <div className="grid3" style={{ marginTop: 16 }}>
        <Panel title="Por CNPJ pagador" sub="Total comprometido"><HBars list={d.by_company} /></Panel>
        <Panel title="Por centro de custos" sub="Total comprometido"><HBars list={d.by_cost_center} color="var(--brand)" /></Panel>
        <Panel title="Maiores favorecidos" sub="Total comprometido"><HBars list={d.top_payees} color="var(--ok)" /></Panel>
      </div>
      <div style={{ marginTop: 16 }}><Panel title="Próximos pagamentos" sub="Agenda dos próximos vencimentos"><PaymentsTable list={d.upcoming} a={a} /></Panel></div>
      {d.recent_audit.length > 0 && (
        <Panel title="Atividade recente" sub="Últimos eventos da auditoria">
          <div className="tw"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th></tr></thead><tbody>{d.recent_audit.map((x) => <tr key={x.id}><td>{dt(x.ts)}</td><td>{x.actor}</td><td>{x.action}</td></tr>)}</tbody></table></div>
        </Panel>
      )}
      <PaymentFormModal c={c} editId={edit} open={edit !== null} onClose={() => setEdit(null)} onSaved={() => setN((x) => x + 1)} />
    </>
  );
}

/* ---------- agendamentos ---------- */
export function PaymentsView({ c, tick }: { c: Ctx; tick: number }) {
  const toast = useToast();
  const [f, setF] = useState({ status: "", company_id: "", date_from: "", date_to: "", q: "" });
  const [list, setList] = useState<PaymentDTO[]>([]);
  const [edit, setEdit] = useState<string | null>(null);
  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const load = useCallback(() => { J<PaymentDTO[]>("/payments?" + qs()).then(setList).catch((e) => toast(e.message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const a = useRowActions(c, load, (id) => setEdit(id));
  const sum = (fn: (p: PaymentDTO) => boolean) => list.filter(fn).reduce((s, p) => s + p.amount_cents, 0);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const setS = (k: string) => (v: string) => setF({ ...f, [k]: v });
  return (
    <>
      <div className="filters">
        <label>Situação<Select value={f.status} onChange={setS("status")}><option value="">Todas</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label>CNPJ pagador<Select value={f.company_id} onChange={setS("company_id")}><option value="">Todos</option>{c.companies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label>De<input type="date" value={f.date_from} onChange={set("date_from")} /></label>
        <label>Até<input type="date" value={f.date_to} onChange={set("date_to")} /></label>
        <label>Busca<input value={f.q} onChange={set("q")} placeholder="favorecido ou descrição" /></label>
        <button className="primary" onClick={load}>Filtrar</button>
        <button className="secondary" onClick={() => download("/export/payments?" + qs(), "pagamentos.csv").catch((e) => toast(e.message))}>Exportar Excel (CSV)</button>
      </div>
      <Metrics>
        <Metric label="Resultados" value={list.length} sub="agendamento(s) no filtro" />
        <Metric label="Valor total" value={brl(sum(() => true))} sub="soma do filtro" tone="blue" />
        <Metric label="Pendentes" value={brl(sum((p) => p.status === "pending"))} sub="aguardando aprovação" tone="amber" />
        <Metric label="Pagos" value={brl(sum((p) => p.status === "paid"))} sub="baixados" tone="green" />
      </Metrics>
      <Panel title="Resultados"><PaymentsTable list={list} a={a} /></Panel>
      <PaymentFormModal c={c} editId={edit} open={edit !== null} onClose={() => setEdit(null)} onSaved={load} />
    </>
  );
}

/* ---------- para aprovar ---------- */
export function PendingView({ c, tick }: { c: Ctx; tick: number }) {
  const toast = useToast();
  const [list, setList] = useState<PaymentDTO[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const load = useCallback(() => { setSel(new Set()); J<PaymentDTO[]>("/payments?status=pending").then(setList).catch((e) => toast(e.message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const a = useRowActions(c, load, () => {});
  const mine = list.filter((p) => p.created_by_id !== c.me.id);
  const batch = async () => {
    if (!sel.size) return toast("Selecione ao menos um");
    if (!confirm(`Aprovar ${sel.size} agendamento(s)?`)) return;
    try {
      const r = await J<{ approved: string[]; errors: unknown[] }>("/payments/approve-batch", { method: "POST", json: { ids: [...sel] } });
      toast(`${r.approved.length} aprovado(s)` + (r.errors.length ? `, ${r.errors.length} com erro` : ""));
      load(); c.refresh();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <Metrics>
        <Metric label="Pendentes" value={list.length} sub="aguardando decisão" tone="amber" />
        <Metric label="Valor pendente" value={brl(list.reduce((s, p) => s + p.amount_cents, 0))} sub="total a aprovar" tone="blue" />
        <Metric label="Você pode decidir" value={mine.length} sub="os seus próprios ficam bloqueados" />
        <Metric label="Mais antigo" value={list.length ? dd(list[0].pay_date) : "—"} sub="menor data de pagamento" />
      </Metrics>
      <Panel title="Aguardando aprovação" sub="Selecione e aprove em lote, ou decida um a um">
        <div className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }}><button className="ok" onClick={batch}>Aprovar selecionados</button></div>
        <PaymentsTable list={list} a={a} selectable selected={sel} onSelect={setSel} />
      </Panel>
    </>
  );
}

/* ---------- favorecidos ---------- */
export function PayeesView({ c }: { c: Ctx }) {
  const toast = useToast();
  const canEdit = can(c.me, "financeiro", "admin");
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try { await J("/payees", { method: "POST", json: Object.fromEntries(new FormData(form)) }); form.reset(); await c.reloadRefs(); } catch (er) { toast((er as Error).message); }
  };
  return (
    <>
      {canEdit && (
        <Panel title="Novo favorecido">
          <form className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }} onSubmit={save}>
            <label>Nome<input name="name" required /></label><label>CPF/CNPJ<input name="document" /></label>
            <label>PIX / conta<input name="payment_info" style={{ width: 260 }} /></label><button className="primary">Cadastrar</button>
          </form>
        </Panel>
      )}
      <Panel title="Favorecidos" sub={`${c.payees.length} cadastrado(s)`}>
        <div className="tw"><table><thead><tr><th>Nome</th><th>Documento</th><th>Dados de pagamento</th></tr></thead><tbody>{c.payees.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.document}</td><td>{p.payment_info}</td></tr>)}</tbody></table></div>
      </Panel>
    </>
  );
}

/* ---------- conciliação ---------- */
const RES: Record<string, [string, string]> = { match: ["Conciliado", "good"], ambiguous: ["Ambíguo", "warn"], unmatched: ["Sem agendamento", "bad"], error: ["Erro", "bad"], ignored: ["Ignorado", ""] };
export function ReconcileView({ c }: { c: Ctx }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [rc, setRc] = useState<{ lines: ReconcileLine[]; file: string } | null>(null);
  const prev = async () => {
    if (!file) return toast("Escolha o arquivo");
    const fd = new FormData(); fd.append("file", file);
    try { const r = await J<{ lines: ReconcileLine[] }>("/reconcile/preview", { method: "POST", body: fd }); setRc({ ...r, file: file.name }); } catch (e) { toast((e as Error).message); }
  };
  const ok = async () => {
    if (!rc) return;
    const items = rc.lines.filter((l) => l.result === "match").map((l) => ({ payment_id: l.payment!.id, paid_date: l.date!, ref: "linha " + l.line }));
    if (!confirm(`Marcar ${items.length} agendamento(s) como pagos?`)) return;
    try {
      const r = await J<{ paid: string[]; errors: unknown[] }>("/reconcile/confirm", { method: "POST", json: { items, file: rc.file } });
      toast(`${r.paid.length} baixados` + (r.errors.length ? `, ${r.errors.length} erros` : "")); setRc(null); c.refresh();
    } catch (e) { toast((e as Error).message); }
  };
  const n = (k: string) => rc?.lines.filter((l) => l.result === k).length ?? 0;
  return (
    <Panel title="Enviar extrato" sub="CSV ou XLSX com colunas Data, Descrição e Valor (até 4 MB)">
      <div className="notice">Saídas são cruzadas com agendamentos <b>aprovados</b> por valor exato, data (±3 dias) e nome do favorecido. Nada é baixado até você confirmar.</div>
      <div className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }}>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><button className="primary" onClick={prev}>Analisar extrato</button>
      </div>
      {rc && (
        <>
          <div style={{ marginTop: 14 }}>
            <Metrics>
              <Metric label="Linhas" value={rc.lines.length} sub="no extrato" />
              <Metric label="Conciliáveis" value={n("match")} sub="prontos para baixa" tone="green" />
              <Metric label="Ambíguos / sem par" value={n("ambiguous") + n("unmatched")} sub="revisar manualmente" tone="amber" />
              <Metric label="Ignorados / erro" value={n("ignored") + n("error")} sub="entradas ou linhas ilegíveis" />
            </Metrics>
          </div>
          {n("match") > 0 && <button className="ok" onClick={ok}>Confirmar baixa dos {n("match")} conciliados</button>}
          <div className="tw" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Linha</th><th>Data</th><th>Descrição</th><th className="n">Valor</th><th>Resultado</th><th>Agendamento</th></tr></thead>
              <tbody>
                {rc.lines.map((l) => (
                  <tr key={l.line}>
                    <td>{l.line}</td><td>{dd(l.date)}</td><td>{l.description}</td><td className="n">{l.amount_cents != null ? brl(l.amount_cents) : ""}</td>
                    <td><span className={`pill ${RES[l.result][1]}`}>{RES[l.result][0]}</span><div className="small">{l.note}</div></td>
                    <td>{l.payment && <>{l.payment.payee} · {l.payment.company}<div className="small">{l.payment.description}</div></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- auditoria ---------- */
export function AuditView() {
  const toast = useToast();
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [list, setList] = useState<AuditDTO[]>([]);
  const load = useCallback(() => { J<AuditDTO[]>("/audit?" + new URLSearchParams({ action, actor })).then(setList).catch((e) => toast(e.message)); }, [action, actor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="filters">
        <label>Ação (prefixo)<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="payment." /></label>
        <label>Usuário<input value={actor} onChange={(e) => setActor(e.target.value)} /></label>
        <button className="primary" onClick={load}>Filtrar</button>
        <button className="secondary" onClick={() => download("/export/audit", "auditoria.csv").catch((e) => toast(e.message))}>Exportar Excel (CSV)</button>
      </div>
      <Panel title="Eventos" sub="Mais recentes primeiro">
        <div className="tw"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>ID</th><th>Detalhe</th></tr></thead>
          <tbody>{list.map((a) => <tr key={a.id}><td>{dt(a.ts)}</td><td>{a.actor}</td><td>{a.action}</td><td className="small">{a.entity_id}</td><td className="small">{a.detail}</td></tr>)}</tbody></table></div>
      </Panel>
    </>
  );
}

/* ---------- administração ---------- */
export function AdminView({ c }: { c: Ctx }) {
  const toast = useToast();
  const [users, setUsers] = useState<UserDTO[]>([]);
  const load = useCallback(() => { J<UserDTO[]>("/users").then(setUsers).catch((e) => toast(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); load(); } catch (e) { toast((e as Error).message); load(); } };
  const submit = (path: string, after?: () => Promise<void>) => async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    await act(async () => { await J(path, { method: "POST", json: Object.fromEntries(new FormData(form)) }); form.reset(); await after?.(); });
  };
  return (
    <>
      <Panel title="Exportar dados" sub="Zip com CSV das tabelas e os anexos (o banco tem backup próprio no Supabase)">
        <button className="primary" onClick={() => download("/backup", "exportacao.zip").catch((e) => toast(e.message))}>Exportar dados</button>
      </Panel>
      <Panel title="CNPJs pagadores" sub="Variações da DAP Advocacia">
        <form className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }} onSubmit={submit("/companies", c.reloadRefs)}>
          <label>Nome<input name="name" required /></label><label>CNPJ<input name="cnpj" /></label><button className="primary">Adicionar</button>
        </form>
        <ul>{c.companies.map((x) => <li key={x.id}>{x.name} · {x.cnpj}</li>)}</ul>
      </Panel>
      <Panel title="Usuários">
        <form className="filters" style={{ border: 0, padding: 0, boxShadow: "none" }} onSubmit={submit("/users")}>
          <label>Nome<input name="name" required /></label><label>E-mail<input name="email" type="email" required /></label>
          <label>Senha (12+)<input name="password" type="password" minLength={12} required /></label>
          <label>Perfil<Select name="role" defaultValue="financeiro">{Object.entries(RL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          <button className="primary">Criar</button>
        </form>
        <div className="tw"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th></th></tr></thead>
          <tbody>
            {users.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td><td>{x.email}</td>
                <td>
                  {x.id === c.me.id ? RL[x.role] : (
                    <Select value={x.role} onChange={(v) => { if (confirm("Alterar o perfil? O usuário precisará entrar novamente.")) act(() => J(`/users/${x.id}/role`, { method: "POST", json: { role: v } }), "Perfil alterado"); }}>
                      {Object.entries(RL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  )}
                  {!x.active && <> <span className="pill bad">inativo</span></>}
                </td>
                <td>
                  {x.id !== c.me.id && (
                    <>
                      <button className="secondary sm" onClick={() => { const p = prompt("Nova senha (12+ caracteres):"); if (p) act(() => J(`/users/${x.id}/password`, { method: "POST", json: { password: p } }), "Senha redefinida"); }}>Redefinir senha</button>{" "}
                      <button className="secondary sm" onClick={() => act(() => J(`/users/${x.id}/active`, { method: "POST", json: { active: !x.active } }))}>{x.active ? "Desativar" : "Reativar"}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table></div>
      </Panel>
    </>
  );
}
