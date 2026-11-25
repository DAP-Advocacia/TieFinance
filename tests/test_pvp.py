"""Uso: python tests/test_pvp.py  (usa banco temporario, dados ficticios)"""
import os
import sys
import tempfile
from pathlib import Path

tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = tmp
os.environ["ERP_ADMIN_EMAIL"] = "admin@teste.com"
os.environ["ERP_ADMIN_PASSWORD"] = "SenhaAdmin#12345"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def login(c, email, pw):
    r = c.post("/api/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


with TestClient(app) as c:
    assert c.get("/api/payments").status_code == 401
    adm = login(c, "admin@teste.com", "SenhaAdmin#12345")
    for name, mail, role in [("Mariana", "mariana@t.com", "financeiro"), ("Dr Bruno", "bruno@t.com", "aprovador"),
                             ("Thyago", "thyago@t.com", "auditoria")]:
        assert c.post("/api/users", headers=adm, json=dict(name=name, email=mail, password="SenhaForte#1234", role=role)).status_code == 200
    assert c.post("/api/users", headers=adm, json=dict(name="x", email="x@t.com", password="curta", role="admin")).status_code == 422
    co = c.post("/api/companies", headers=adm, json=dict(name="DAP Advocacia", cnpj="00.000.000/0001-00")).json()["id"]
    mar, bru, thy = (login(c, m, "SenhaForte#1234") for m in ("mariana@t.com", "bruno@t.com", "thyago@t.com"))

    # permissoes
    assert c.post("/api/companies", headers=mar, json=dict(name="x")).status_code == 403
    assert c.get("/api/audit", headers=mar).status_code == 403
    py = c.post("/api/payees", headers=mar, json=dict(name="Papelaria Central Ltda", document="1", payment_info="PIX x")).json()["id"]
    assert c.post("/api/payees", headers=thy, json=dict(name="x")).status_code == 403

    def mk(amount, date, desc="Material"):
        return c.post("/api/payments", headers=mar, data=dict(company_id=co, payee_id=py, description=desc,
                      amount=amount, pay_date=date), files={"file": ("boleto.pdf", b"%PDF-1.4 x", "application/pdf")})

    assert c.post("/api/payments", headers=thy, data=dict(company_id=co, payee_id=py, description="x", amount="1", pay_date="2026-12-01")).status_code == 403
    assert mk("0", "2026-12-01").status_code == 422
    assert mk("10.555", "2026-12-01").status_code == 422
    p1 = mk("1500.00", "2026-12-10").json()["id"]
    p2 = mk("200.50", "2026-12-11").json()["id"]
    p3 = mk("999.00", "2026-12-12").json()["id"]
    assert c.get(f"/api/payments/{p1}/attachment", headers=bru).status_code == 200
    assert next(p for p in c.get("/api/payments", headers=bru).json() if p["id"] == p1)["amount_cents"] == 150000

    # aprovacao
    assert c.post(f"/api/payments/{p1}/approve", headers=mar).status_code == 403
    assert c.post(f"/api/payments/{p3}/reject", headers=bru, json={"reason": ""}).status_code == 422
    assert c.post(f"/api/payments/{p3}/reject", headers=bru, json={"reason": "valor errado"}).status_code == 200
    r = c.post("/api/payments/approve-batch", headers=bru, json={"ids": [p1, p2, p3]}).json()
    assert len(r["approved"]) == 2 and len(r["errors"]) == 1  # p3 ja rejeitado
    assert c.post(f"/api/payments/{p1}/approve", headers=bru).status_code == 409
    # aprovado nao pode ser editado
    ed = dict(company_id=co, payee_id=py, description="x", amount="1.00", pay_date="2026-12-01")
    assert c.put(f"/api/payments/{p1}", headers=mar, data=ed).status_code == 409
    # rejeitado volta para pendente ao editar
    assert c.put(f"/api/payments/{p3}", headers=mar, data={**ed, "amount": "990.00"}).status_code == 200
    assert next(p for p in c.get("/api/payments", headers=bru).json() if p["id"] == p3)["status"] == "pending"

    # conciliacao por extrato
    csv_txt = ("Data;Descricao;Valor\n"
               "10/12/2026;PIX ENVIADO PAPELARIA CENTRAL;-1.500,00\n"
               "11/12/2026;TARIFA;-15,90\n"
               "11/12/2026;PIX RECEBIDO CLIENTE;3.000,00\n")
    assert c.post("/api/reconcile/preview", headers=mar, files={"file": ("e.csv", csv_txt.encode())}).status_code == 403
    pv = c.post("/api/reconcile/preview", headers=thy, files={"file": ("e.csv", csv_txt.encode())}).json()
    res = [l["result"] for l in pv["lines"]]
    assert res == ["match", "unmatched", "ignored"], res
    items = [dict(payment_id=l["payment"]["id"], paid_date=l["date"], ref=f"linha {l['line']}") for l in pv["lines"] if l["result"] == "match"]
    cf = c.post("/api/reconcile/confirm", headers=thy, json={"items": items, "file": "e.csv"}).json()
    assert cf["paid"] == [p1] and not cf["errors"]
    again = c.post("/api/reconcile/confirm", headers=thy, json={"items": items, "file": "e.csv"}).json()
    assert len(again["errors"]) == 1  # nao baixa duas vezes
    # baixa manual
    assert c.post(f"/api/payments/{p2}/pay", headers=mar, json={}).status_code == 200
    assert c.post(f"/api/payments/{p2}/cancel", headers=mar, json={"reason": "teste"}).status_code == 409

    # auditoria e exportacao
    acts = {a["action"] for a in c.get("/api/audit", headers=thy).json()}
    for a in ("login", "payment.create", "payment.edit", "payment.approve", "payment.reject", "payment.pay", "reconcile.confirm"):
        assert a in acts, a
    assert c.get("/api/export/audit", headers=thy).status_code == 200
    assert "Papelaria" in c.get("/api/export/payments", headers=thy).text

    # perfis
    uid = next(x["id"] for x in c.get("/api/users", headers=adm).json() if x["email"] == "thyago@t.com")
    assert c.post(f"/api/users/{uid}/role", headers=mar, json={"role": "admin"}).status_code == 403
    assert c.post(f"/api/users/{uid}/role", headers=adm, json={"role": "xx"}).status_code == 422
    assert c.post(f"/api/users/{uid}/role", headers=adm, json={"role": "financeiro"}).status_code == 200
    assert c.get("/api/me", headers=thy).status_code == 401
    assert c.post(f"/api/users/{uid}/role", headers=adm, json={"role": "auditoria"}).status_code == 200
    thy = login(c, "thyago@t.com", "SenhaForte#1234")
    # dashboard
    dsh = c.get("/api/dashboard", headers=bru).json()
    assert dsh["kpis"]["paid_month"]["count"] + dsh["kpis"]["pending"]["count"] >= 1
    assert len(dsh["monthly"]) == 8 and len(dsh["weeks"]) == 8 and dsh["recent_audit"] == []
    assert c.get("/api/dashboard", headers=thy).json()["recent_audit"]
    assert c.get("/api/dashboard").status_code == 401
    assert c.get("/api/payments?status=overdue", headers=bru).status_code == 200
    # senha e backup
    assert c.post("/api/me/password", headers=bru, json={"current": "errada", "new": "NovaSenha#12345"}).status_code == 403
    assert c.post("/api/me/password", headers=thy, json={"current": "SenhaForte#1234", "new": "curta"}).status_code == 422
    assert c.get("/api/backup", headers=thy).status_code == 403
    bk = c.get("/api/backup", headers=adm)
    assert bk.status_code == 200 and bk.content[:2] == b"PK"
    assert c.post("/api/me/password", headers=mar, json={"current": "SenhaForte#1234", "new": "NovaSenha#12345"}).status_code == 200
    login(c, "mariana@t.com", "NovaSenha#12345")
    # limite de tentativas
    for _ in range(5):
        c.post("/api/login", json={"email": "bruno@t.com", "password": "errada"})
    assert c.post("/api/login", json={"email": "bruno@t.com", "password": "SenhaForte#1234"}).status_code == 429
    # logout
    assert c.post("/api/logout", headers=thy).status_code == 200
    assert c.get("/api/me", headers=thy).status_code == 401
print("OK - todos os testes passaram")
