"""Dados FICTICIOS para ver o dashboard. Uso: python tools/seed_demo.py  (respeita DATA_DIR/DATABASE_URL)
Cria usuarios demo (mariana/bruno/thyago @demo.local, senha DemoSenha#2026) - nao usar em producao."""
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sqlalchemy import select  # noqa: E402
from app.main import (Audit, Company, Payee, Payment, SessionLocal, User, hash_password, startup)  # noqa: E402

startup()
random.seed(7)
with SessionLocal() as db:
    if db.scalar(select(Payment).limit(1)):
        sys.exit("Ja existem agendamentos; seed cancelado.")
    users = {}
    for name, mail, role in [("Mariana", "mariana@demo.local", "financeiro"), ("Dr. Bruno", "bruno@demo.local", "aprovador"),
                             ("Thyago", "thyago@demo.local", "auditoria")]:
        u = db.scalar(select(User).where(User.email == mail)) or User(name=name, email=mail, role=role, password=hash_password("DemoSenha#2026"))
        db.add(u)
        users[role] = u
    cos = [Company(name=n, cnpj=c) for n, c in [("DAP Advocacia", "00.000.000/0001-01"), ("DAP Consultoria", "00.000.000/0002-02"),
                                                  ("DAP Participacoes", "00.000.000/0003-03")]]
    pys = [Payee(name=n, document="", payment_info="PIX demo") for n in
           ["Papelaria Central", "Imobiliaria Exemplo", "Tech Software Ltda", "Cartorio 1o Oficio", "Limpeza Brilho", "Contabilidade Alfa",
            "Energia SA", "Telecom Beta"]]
    db.add_all(cos + pys)
    db.flush()
    ccs = ["Administrativo", "Juridico", "Tecnologia", "Predial", ""]
    today = date.today()
    for i in range(60):
        d = today + timedelta(days=random.randint(-120, 50))
        st = random.choices(["pending", "approved", "paid", "rejected", "cancelled"], [15, 15, 50, 8, 7])[0]
        if st == "pending":
            d = today + timedelta(days=random.randint(0, 20))
        created = datetime.utcnow() - timedelta(days=max((today - d).days, 0) + 3)
        p = Payment(company_id=random.choice(cos).id, payee_id=random.choice(pys).id, description=f"Pagamento demo {i + 1}",
                    amount_cents=random.randint(15000, 1800000), pay_date=d, cost_center=random.choice(ccs), status=st,
                    created_by=users["financeiro"].id, created_at=created)
        if st in ("approved", "paid", "rejected"):
            p.decided_by, p.decided_at = users["aprovador"].id, created + timedelta(hours=random.randint(2, 30))
        if st == "rejected":
            p.reason = "Valor divergente"
        if st == "cancelled":
            p.reason = "Duplicado"
        if st == "paid":
            p.paid_date, p.paid_via = d, random.choice(["manual", "extrato"])
        db.add(p)
        db.flush()
        db.add(Audit(actor=users["financeiro"].email, action="payment.create", entity="payment", entity_id=p.id))
    db.commit()
print("Dados demo criados. Logins: mariana/bruno/thyago@demo.local, senha DemoSenha#2026")
