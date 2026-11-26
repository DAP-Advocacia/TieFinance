"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BankAccountDTO, CompanyDTO, PayeeDTO } from "@/lib/types";
import { RL, api, J } from "./client";
import { Backdrop, Wordmark, useParallax } from "./login-fx";
import { useReveal } from "./reveal";
import { Symbol } from "./symbol";
import { ToastProvider, useToast } from "./ui";
import { AdminView, AuditView, Dashboard, PayeesView, PaymentFormModal, PaymentsView, PendingView, ReconcileView, type Ctx, type Me } from "./views";

const IC: Record<string, string> = {
  dash: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pay: '<path d="M5 19 19 5M9 5h10v10"/>',
  pend: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  bank: '<path d="M3 9h18L12 3 3 9Zm2 3v6m7-6v6m7-6v6M3 21h18"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3"/>',
};
type Item = [string, string, string];
const NAV: Record<Me["role"], [string, Item[]][]> = {
  admin: [["VISÃO GERAL", [["dash", "Dashboard", "dash"]]], ["PAGAMENTOS", [["pend", "Para aprovar", "pend"], ["pay", "Agendamentos", "pay"], ["payees", "Favorecidos", "users"]]], ["CONTROLE", [["rec", "Conciliação", "bank"], ["aud", "Auditoria", "shield"]]], ["ADMINISTRAÇÃO", [["adm", "Usuários e CNPJs", "set"]]]],
  financeiro: [["VISÃO GERAL", [["dash", "Dashboard", "dash"]]], ["PAGAMENTOS", [["pay", "Agendamentos", "pay"], ["payees", "Favorecidos", "users"]]]],
  aprovador: [["VISÃO GERAL", [["dash", "Dashboard", "dash"]]], ["PAGAMENTOS", [["pend", "Para aprovar", "pend"], ["pay", "Todos os agendamentos", "pay"]]]],
  auditoria: [["VISÃO GERAL", [["dash", "Dashboard", "dash"]]], ["CONTROLE", [["pay", "Agendamentos", "pay"], ["rec", "Conciliação por extrato", "bank"], ["aud", "Auditoria", "shield"]]]],
};
const TITLES: Record<string, [string, string]> = {
  dash: ["Dashboard", "Visão financeira e analítica dos pagamentos"],
  pend: ["Para aprovar", "Agendamentos aguardando decisão"],
  pay: ["Agendamentos", "Todos os pagamentos agendados"],
  payees: ["Favorecidos", "Cadastro de favorecidos e dados de pagamento"],
  rec: ["Conciliação por extrato", "Baixa automática dos pagamentos a partir do extrato bancário"],
  aud: ["Auditoria", "Trilha de eventos do sistema"],
  adm: ["Administração", "Usuários, CNPJs pagadores e exportação"],
};

function Login({ onLogin }: { onLogin: () => void }) {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useParallax(panel);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try { await J("/login", { method: "POST", json: { email: f.get("email"), password: f.get("password") } }); onLogin(); }
    catch (er) { toast((er as Error).message); setBusy(false); }
  };
  return (
    <main id="login">
      <section className="brand-panel" aria-label="TieFinance" ref={panel}>
        <Backdrop />
        <span className="brand-label">Gestão financeira empresarial</span>
        <div className="brand-content">
          <div className="monogram">
            <Symbol />
            <i className="spark s1" /><i className="spark s2" /><i className="spark s3" />
          </div>
          <Wordmark />
          <p className="tagline tag-in">Financial ERP &amp; SaaS Platform</p>
        </div>
        <span className="holding">Uma solução TechTie</span>
      </section>
      <section className="right">
        <div className="box">
          <p className="eyebrow-l">Área de acesso</p>
          <h1>Bem-vindo ao TieFinance</h1>
          <p className="subtitle">Acesse sua conta para gerenciar os pagamentos.</p>
          <form onSubmit={submit}>
            <div className="field"><label htmlFor="le">E-mail</label><input type="email" id="le" name="email" placeholder="nome@empresa.com.br" autoComplete="username" required /></div>
            <div className="field"><label htmlFor="lp">Senha</label>
              <div className="password"><input type={show ? "text" : "password"} id="lp" name="password" placeholder="Sua senha" autoComplete="current-password" required />
                <button type="button" className="show" onClick={() => setShow(!show)}>{show ? "Ocultar" : "Mostrar"}</button></div></div>
            <button className="primary full" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
          </form>
          <p className="small">Acesso por convite. Solicite seu acesso ao administrador.</p>
        </div>
      </section>
    </main>
  );
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState("dash");
  const [menu, setMenu] = useState(false);
  const [tick, setTick] = useState(0);
  const [badge, setBadge] = useState(0);
  const [companies, setCompanies] = useState<CompanyDTO[]>([]);
  const [payees, setPayees] = useState<PayeeDTO[]>([]);
  const [banks, setBanks] = useState<BankAccountDTO[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useReveal(mainRef);
  const reloadRefs = useCallback(async () => {
    const [c, p, b] = await Promise.all([J<CompanyDTO[]>("/companies"), J<PayeeDTO[]>("/payees"), J<BankAccountDTO[]>("/bank-accounts")]);
    setCompanies(c); setPayees(p); setBanks(b);
  }, []);
  useEffect(() => { reloadRefs().catch((e) => toast(e.message)); }, [reloadRefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const go = (t: string) => { setTab(t); setMenu(false); window.scrollTo(0, 0); };
  const c: Ctx = { me, companies, payees, banks, reloadRefs, go, refresh };
  const [h, s] = TITLES[tab];
  const canNew = (me.role === "financeiro" || me.role === "admin") && (tab === "dash" || tab === "pay");
  const chPw = async () => {
    const cur = prompt("Senha atual:"); if (!cur) return;
    const nw = prompt("Nova senha (12+ caracteres):"); if (!nw) return;
    try { await J("/me/password", { method: "POST", json: { current: cur, new: nw } }); toast("Senha alterada"); } catch (e) { toast((e as Error).message); }
  };
  const view = { dash: <Dashboard c={c} tick={tick} onBadge={setBadge} />, pay: <PaymentsView c={c} tick={tick} />, pend: <PendingView c={c} tick={tick} />, payees: <PayeesView c={c} />, rec: <ReconcileView c={c} />, aud: <AuditView />, adm: <AdminView c={c} /> }[tab];
  return (
    <div className={menu ? "menu-open" : ""}>
      <div className="overlay" onClick={() => setMenu(false)} />
      <aside>
        <div className="brand">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/assets/simbolo.svg" alt="" style={{ width: 34, height: "auto" }} /><div><b>TieFinance</b><small>GESTÃO FINANCEIRA</small></div></div>
        <nav>
          {NAV[me.role].map(([g, items]) => (
            <div key={g}>
              <div className="group">{g}</div>
              {items.map(([k, n, i]) => (
                <button key={k} className={`nav ${k === tab ? "active" : ""}`} onClick={() => go(k)}>
                  <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: IC[i] }} />{n}{k === "pend" && badge > 0 && <span className="badge">{badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="shell">
        <header>
          <div className="hl"><button className="mobile-menu" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button><div><div className="eyebrow">Empresa</div><b>DAP Advocacia</b></div></div>
          <div className="hr">
            <button className="secondary sm" onClick={chPw}>Trocar senha</button><button className="secondary sm" onClick={onLogout}>Sair</button>
            <div className="avatar">{me.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</div>
            <div><b style={{ fontSize: 12 }}>{me.name}</b><div className="small">{RL[me.role]}</div></div>
          </div>
        </header>
        <main className="content" ref={mainRef}>
          <div key={tab} className="page">
          <div className="crumb">TieFinance / {h}</div>
          <div className="pagehead"><div><h1>{h}</h1><p>{s}</p></div><div className="actions">{canNew && <button className="primary" onClick={() => setNewOpen(true)}>+ Novo agendamento</button>}</div></div>
          {view}
          </div>
        </main>
      </div>
      <PaymentFormModal c={c} editId={null} open={newOpen} onClose={() => setNewOpen(false)} onSaved={refresh} />
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = useCallback(() => { api("/me").then((r) => r.json()).then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { load(); const h = () => setMe(null); window.addEventListener("tf-unauthorized", h); return () => window.removeEventListener("tf-unauthorized", h); }, [load]);
  const logout = async () => { try { await api("/logout", { method: "POST" }); } catch {} setMe(null); };
  if (me === undefined) return null;
  return me ? <Shell me={me} onLogout={logout} /> : <Login onLogin={load} />;
}

export default function Page() {
  return <ToastProvider><App /></ToastProvider>;
}
