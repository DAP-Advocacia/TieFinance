// Teste de ponta a ponta da API (equivale a legacy-python/tests/test_pvp.py).
// Uso: BASE_URL=http://127.0.0.1:3000 node tests/run.mjs
// O servidor deve apontar para um banco/schema VAZIO com ERP_ADMIN_EMAIL=admin@teste.com e ERP_ADMIN_PASSWORD=SenhaAdmin#12345.
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PW = "SenhaForte#1234";

class Client {
  cookie = "";
  async req(method, path, { json, form, headers } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (json !== undefined) { body = JSON.stringify(json); h["content-type"] = "application/json"; }
    if (form) body = form;
    const r = await fetch(BASE + "/api" + path, { method, headers: h, body, redirect: "manual" });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.startsWith("tf_session=;") || /Max-Age=0/.test(sc) ? "" : sc.split(";")[0];
    return r;
  }
  get = (p) => this.req("GET", p);
  post = (p, json) => this.req("POST", p, { json });
}
const anon = () => new Client();
async function login(email, pw) {
  const c = new Client();
  const r = await c.post("/login", { email, password: pw });
  assert.equal(r.status, 200, `login ${email}: ${await r.text()}`);
  return c;
}
const status = async (p) => (await p).status;
const j = async (p) => (await p).json();

let BANK = ""; // conta bancaria padrao dos agendamentos (definida depois de criar o CNPJ)
function payForm(co, py, amount, date, desc = "Material", withFile = true) {
  const f = new FormData();
  f.set("company_id", co); if (BANK) f.set("bank_account_id", BANK); f.set("payee_id", py); f.set("description", desc); f.set("amount", amount); f.set("pay_date", date);
  if (withFile) f.set("file", new File([new TextEncoder().encode("%PDF-1.4 x")], "boleto.pdf", { type: "application/pdf" }));
  return f;
}

let n = 0;
const ok = (name) => console.log(`  ok ${++n} ${name}`);

// --- login / sessao ---
assert.equal(await status(anon().get("/payments")), 401); ok("sem sessao -> 401");
assert.equal(await status(anon().post("/login", { email: "admin@teste.com", password: "errada" })), 401); ok("senha errada -> 401");
const adm = await login("admin@teste.com", "SenhaAdmin#12345"); ok("admin bootstrap + login");

// CSRF por origem
{
  const r = await fetch(BASE + "/api/logout", { method: "POST", headers: { cookie: adm.cookie, origin: "https://evil.example" } });
  assert.equal(r.status, 403); ok("origem externa bloqueada");
}

// --- usuarios / empresas ---
for (const [name, email, role] of [["Mariana", "mariana@t.com", "financeiro"], ["Dr Bruno", "bruno@t.com", "aprovador"], ["Thyago", "thyago@t.com", "auditoria"]]) {
  assert.equal(await status(adm.post("/users", { name, email, password: PW, role })), 200);
}
assert.equal(await status(adm.post("/users", { name: "x", email: "x@t.com", password: "curta", role: "admin" })), 422);
assert.equal(await status(adm.post("/users", { name: "x", email: "mariana@t.com", password: PW, role: "admin" })), 409);
assert.equal(await status(adm.post("/users", { name: "x", email: "y@t.com", password: PW, role: "root" })), 422);
ok("criar usuarios + validacoes");
const co = (await j(adm.post("/companies", { name: "DAP Advocacia", cnpj: "00.000.000/0001-00" }))).id;
// --- contas bancarias ---
assert.equal(await status(adm.post("/bank-accounts", { company_id: co, bank: "Banco Inexistente" })), 422);
assert.equal(await status(adm.post("/bank-accounts", { company_id: "x".repeat(32), bank: "Santander" })), 404);
BANK = (await j(adm.post("/bank-accounts", { company_id: co, bank: "Santander", nickname: "Conta principal", agency: "0001", account: "123-4" }))).id;
const BANK2 = (await j(adm.post("/bank-accounts", { company_id: co, bank: "Asaas", nickname: "Asaas recebimentos" }))).id;
const co2 = (await j(adm.post("/companies", { name: "DAP Consultoria", cnpj: "00.000.000/0002-00" }))).id;
const BANK_OTHER = (await j(adm.post("/bank-accounts", { company_id: co2, bank: "Nubank" }))).id;
{
  const l = await j(adm.get("/bank-accounts"));
  assert.equal(l.length, 3);
  assert.equal(l.find((b) => b.id === BANK2).kind, "api");
  assert.equal(l.find((b) => b.id === BANK).kind, "extrato");
}
ok("contas bancarias (criar, tipo api/extrato, validacoes)");
const [mar, bru, thy] = await Promise.all(["mariana@t.com", "bruno@t.com", "thyago@t.com"].map((e) => login(e, PW)));

// --- permissoes ---
assert.equal(await status(mar.post("/companies", { name: "x" })), 403);
assert.equal(await status(mar.post("/bank-accounts", { company_id: co, bank: "Bradesco" })), 403);
assert.equal(await status(mar.get("/audit")), 403);
const py = (await j(mar.post("/payees", { name: "Papelaria Central Ltda", document: "1", payment_info: "PIX x" }))).id;
assert.equal(await status(thy.post("/payees", { name: "x" })), 403);
ok("permissoes por perfil");

const mk = (amount, date, desc) => mar.req("POST", "/payments", { form: payForm(co, py, amount, date, desc) });
assert.equal(await status(thy.req("POST", "/payments", { form: payForm(co, py, "1", "2026-12-01") })), 403);
assert.equal(await status(mk("0", "2026-12-01")), 422);
{
  const noBank = payForm(co, py, "10", "2026-12-01", "x", false); noBank.delete("bank_account_id");
  assert.equal(await status(mar.req("POST", "/payments", { form: noBank })), 422);
  const wrong = payForm(co, py, "10", "2026-12-01", "x", false); wrong.set("bank_account_id", BANK_OTHER);
  assert.equal(await status(mar.req("POST", "/payments", { form: wrong })), 422);
}
assert.equal(await status(mk("10.555", "2026-12-01")), 422);
assert.equal(await status(mk("10", "2026-13-40")), 422);
const p1 = (await j(mk("1500.00", "2026-12-10"))).id;
const p2 = (await j(mk("200.50", "2026-12-11"))).id;
const p3 = (await j(mk("999.00", "2026-12-12"))).id;
ok("criar agendamentos + validacoes de valor/data");

{
  const r = await bru.get(`/payments/${p1}/attachment`);
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.ok((await r.text()).startsWith("%PDF"));
  const list = await j(bru.get("/payments"));
  assert.equal(list.find((p) => p.id === p1).amount_cents, 150000);
  ok("anexo (pdf) + valor em centavos");
}
// anexo invalido / grande
{
  const f = payForm(co, py, "10", "2026-12-01", "x", false);
  f.set("file", new File(["x"], "virus.exe"));
  assert.equal(await status(mar.req("POST", "/payments", { form: f })), 422);
  const big = payForm(co, py, "10", "2026-12-01", "x", false);
  big.set("file", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf"));
  assert.equal(await status(mar.req("POST", "/payments", { form: big })), 422);
  ok("anexo invalido e acima de 4 MB rejeitados");
}

// --- aprovacao ---
assert.equal(await status(mar.post(`/payments/${p1}/approve`)), 403);
assert.equal(await status(bru.post(`/payments/${p3}/reject`, { reason: "" })), 422);
assert.equal(await status(bru.post(`/payments/${p3}/reject`, { reason: "valor errado" })), 200);
{
  const r = await j(bru.post("/payments/approve-batch", { ids: [p1, p2, p3] }));
  assert.equal(r.approved.length, 2); assert.equal(r.errors.length, 1);
}
assert.equal(await status(bru.post(`/payments/${p1}/approve`)), 409);
ok("aprovar/rejeitar/lote, sem decisao dupla");
// autoaprovacao: admin cria e nao aprova o proprio
{
  const own = (await j(adm.req("POST", "/payments", { form: payForm(co, py, "55.00", "2026-12-20", "do admin") }))).id;
  assert.equal(await status(adm.post(`/payments/${own}/approve`)), 403);
  assert.equal(await status(bru.post(`/payments/${own}/approve`)), 200);
  ok("autoaprovacao proibida (admin) e aprovador diferente aprova");
}
// edicao
const ed = () => payForm(co, py, "1.00", "2026-12-01", "x", false);
assert.equal(await status(mar.req("PUT", `/payments/${p1}`, { form: ed() })), 409);
{
  const f = payForm(co, py, "990.00", "2026-12-12", "Material", false);
  assert.equal(await status(mar.req("PUT", `/payments/${p3}`, { form: f })), 200);
  assert.equal((await j(bru.get("/payments"))).find((p) => p.id === p3).status, "pending");
  ok("aprovado nao edita; rejeitado volta a pendente");
}

// --- conciliacao ---
const csv = "Data;Descricao;Valor\n10/12/2026;PIX ENVIADO PAPELARIA CENTRAL;-1.500,00\n11/12/2026;TARIFA;-15,90\n11/12/2026;PIX RECEBIDO CLIENTE;3.000,00\n";
const stmt = (text, name = "e.csv", bank = BANK) => { const f = new FormData(); f.set("file", new File([text], name)); if (bank) f.set("bank_account_id", bank); return f; };
assert.equal(await status(mar.req("POST", "/reconcile/preview", { form: stmt(csv) })), 403);
assert.equal(await status(thy.req("POST", "/reconcile/preview", { form: stmt(csv, "e.csv", "") })), 422);
{
  // extrato de OUTRA conta nao concilia pagamentos desta conta
  const other = await j(thy.req("POST", "/reconcile/preview", { form: stmt(csv, "e.csv", BANK2) }));
  assert.ok(!other.lines.some((l) => l.result === "match"));
  assert.equal(other.account.kind, "api");
}
const pv = await j(thy.req("POST", "/reconcile/preview", { form: stmt(csv) }));
assert.equal(pv.duplicate_of, null); assert.equal(pv.account.bank, "Santander"); assert.ok(pv.file_hash.length === 64);
assert.deepEqual(pv.lines.map((l) => l.result), ["match", "unmatched", "ignored"]);
const items = pv.lines.filter((l) => l.result === "match").map((l) => ({ payment_id: l.payment.id, paid_date: l.date, ref: `linha ${l.line}` }));
const wrongAcc = await j(thy.post("/reconcile/confirm", { items, file: "e.csv", bank_account_id: BANK2 }));
assert.equal(wrongAcc.paid.length, 0); assert.equal(wrongAcc.errors.length, items.length);
const cf = await j(thy.post("/reconcile/confirm", { items, file: "e.csv", bank_account_id: BANK, file_hash: pv.file_hash, total_lines: pv.total_lines }));
assert.deepEqual(cf.paid, [p1]); assert.equal(cf.errors.length, 0);
assert.equal((await j(thy.post("/reconcile/confirm", { items, file: "e.csv", bank_account_id: BANK }))).errors.length, 1);
{
  const again2 = await j(thy.req("POST", "/reconcile/preview", { form: stmt(csv) }));
  assert.ok(again2.duplicate_of && again2.duplicate_of.filename === "e.csv"); // mesmo arquivo ja importado
}
ok("conciliacao por extrato (CSV) e baixa unica");
assert.equal(await status(mar.post(`/payments/${p2}/pay`, {})), 200);
assert.equal(await status(mar.post(`/payments/${p2}/cancel`, { reason: "teste" })), 409);
ok("baixa manual; pago nao cancela");

// --- dashboard ---
{
  const d = await j(bru.get("/dashboard"));
  assert.ok(d.kpis.paid_month.count + d.kpis.pending.count >= 1);
  assert.equal(d.monthly.length, 8); assert.equal(d.weeks.length, 8); assert.deepEqual(d.recent_audit, []);
  assert.ok(d.kpis.pending_for_me >= 0);
  assert.ok(d.by_bank.length >= 1 && d.by_bank[0].name.includes("Santander"));
  assert.ok((await j(thy.get("/dashboard"))).recent_audit.length > 0);
  assert.equal(await status(bru.get("/payments?status=overdue")), 200);
  assert.ok((await j(bru.get("/pending-count"))).n >= 0);
  ok("dashboard");
}

// --- perfis / senha / exportacao ---
{
  const uid = (await j(adm.get("/users"))).find((x) => x.email === "thyago@t.com").id;
  assert.equal(await status(mar.post(`/users/${uid}/role`, { role: "admin" })), 403);
  assert.equal(await status(adm.post(`/users/${uid}/role`, { role: "xx" })), 422);
  assert.equal(await status(adm.post(`/users/${uid}/role`, { role: "financeiro" })), 200);
  assert.equal(await status(thy.get("/me")), 401);
  assert.equal(await status(adm.post(`/users/${uid}/role`, { role: "auditoria" })), 200);
  const thy2 = await login("thyago@t.com", PW);
  Object.assign(thy, { cookie: thy2.cookie });
  ok("alterar perfil derruba sessao");
}
assert.equal(await status(bru.post("/me/password", { current: "errada", new: "NovaSenha#12345" })), 403);
assert.equal(await status(thy.post("/me/password", { current: PW, new: "curta" })), 422);
assert.equal(await status(thy.get("/backup")), 403);
{
  const bk = await adm.get("/backup");
  assert.equal(bk.status, 200);
  const buf = Buffer.from(await bk.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const names = [...buf.toString("latin1").matchAll(/(payments\.csv|users\.csv|anexos\/[0-9a-f]+\.pdf)/g)].map((m) => m[1]);
  assert.ok(names.includes("payments.csv") && names.includes("users.csv") && names.some((x) => x.startsWith("anexos/")));
}
assert.equal(await status(mar.post("/me/password", { current: PW, new: "NovaSenha#12345" })), 200);
await login("mariana@t.com", "NovaSenha#12345");
ok("senha, exportacao de dados");

const acts = new Set((await j(thy.get("/audit"))).map((a) => a.action));
for (const a of ["login", "payment.create", "payment.edit", "payment.approve", "payment.reject", "payment.pay", "reconcile.confirm", "attachment.view", "user.role", "backup.download"]) assert.ok(acts.has(a), a);
assert.equal(await status(thy.get("/export/audit")), 200);
assert.ok((await (await thy.get("/export/payments")).text()).includes("Papelaria"));
ok("auditoria e exportacoes CSV");

// --- limite de tentativas ---
for (let i = 0; i < 5; i++) await anon().post("/login", { email: "bruno@t.com", password: "errada" });
assert.equal(await status(anon().post("/login", { email: "bruno@t.com", password: PW })), 429);
ok("limite de tentativas de login (persistente)");

assert.equal(await status(thy.post("/logout")), 200);
assert.equal(await status(thy.get("/me")), 401);
ok("logout");
console.log(`\nOK - ${n} grupos de verificacao passaram`);
