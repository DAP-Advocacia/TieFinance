"""ERP Finance PVP - agendamento de pagamentos com aprovacao e auditoria."""
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import time
import unicodedata
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import (BigInteger, Boolean, Date, DateTime, ForeignKey, Integer,
                        String, Text, create_engine, select)
from sqlalchemy.orm import (DeclarativeBase, Mapped, Session, mapped_column,
                            relationship, sessionmaker)

BASE = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv("DATA_DIR", BASE / "data"))
UPLOADS = DATA / "uploads"
UPLOADS.mkdir(parents=True, exist_ok=True)
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA / 'pvp.db').as_posix()}")
SESSION_SECONDS = 8 * 3600
MAX_UPLOAD = 10 * 1024 * 1024
ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg"}
DATE_TOLERANCE_DAYS = int(os.getenv("RECONCILE_TOLERANCE_DAYS", "3"))

ROLES = {"admin", "financeiro", "aprovador", "auditoria"}
STATUS = {"pending", "approved", "rejected", "paid", "cancelled"}

engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def now() -> datetime:
    return datetime.utcnow()


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True)
    password: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserSession(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 do token
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires: Mapped[int] = mapped_column(BigInteger)


class Company(Base):
    """CNPJ pagador (variacoes dentro da DAP Advocacia)."""
    __tablename__ = "companies"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160))
    cnpj: Mapped[str] = mapped_column(String(20), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Payee(Base):
    __tablename__ = "payees"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160))
    document: Mapped[str] = mapped_column(String(20), default="")
    payment_info: Mapped[str] = mapped_column(String(300), default="")  # PIX / conta
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"))
    payee_id: Mapped[str] = mapped_column(ForeignKey("payees.id"))
    description: Mapped[str] = mapped_column(String(300))
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    pay_date: Mapped[date] = mapped_column(Date)
    cost_center: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(12), default="pending")
    attachment: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    attachment_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    decided_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)  # rejeicao/cancelamento
    paid_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    paid_via: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)  # manual | extrato
    paid_ref: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    company: Mapped[Company] = relationship()
    payee: Mapped[Payee] = relationship()
    creator: Mapped[User] = relationship(foreign_keys=[created_by])
    decider: Mapped[Optional[User]] = relationship(foreign_keys=[decided_by])


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    actor: Mapped[str] = mapped_column(String(160))
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity: Mapped[str] = mapped_column(String(30), default="")
    entity_id: Mapped[str] = mapped_column(String(32), default="")
    detail: Mapped[str] = mapped_column(Text, default="")


# ---------- utilidades ----------
def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + "$" + h.hex()


def check_password(pw: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


def sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def to_cents(value: str) -> int:
    try:
        d = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        raise HTTPException(422, "Valor invalido")
    if d <= 0 or d != d.quantize(Decimal("0.01")):
        raise HTTPException(422, "Valor deve ser positivo, com ate 2 casas decimais")
    return int(d * 100)


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except Exception:
        raise HTTPException(422, "Data invalida (use AAAA-MM-DD)")


def log(db: Session, user: Optional[User], action: str, entity: str = "", entity_id: str = "", detail=None):
    db.add(Audit(actor_id=user.id if user else None,
                 actor=user.email if user else "-",
                 action=action, entity=entity, entity_id=entity_id,
                 detail=json.dumps(detail, ensure_ascii=False, default=str) if detail is not None else ""))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Nao autenticado")
    s = db.get(UserSession, sha(authorization[7:]))
    if not s or s.expires < time.time():
        raise HTTPException(401, "Sessao invalida ou expirada")
    u = db.get(User, s.user_id)
    if not u or not u.active:
        raise HTTPException(401, "Usuario inativo")
    return u


def require(*roles):
    def dep(u: User = Depends(current_user)) -> User:
        if u.role not in roles:
            raise HTTPException(403, "Sem permissao")
        return u
    return dep


# ---------- app ----------
app = FastAPI(title="TieFinance")
app.add_middleware(GZipMiddleware, minimum_size=500)
_fails: dict = {}


@app.on_event("startup")
def startup():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect
    cfg = Config(str(BASE / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE / "migrations"))
    tables = inspect(engine).get_table_names()
    if "users" in tables and "alembic_version" not in tables:
        command.stamp(cfg, "0001")  # banco criado antes das migracoes
    command.upgrade(cfg, "head")
    with SessionLocal() as db:
        if db.scalar(select(User).limit(1)) is None:
            email = os.getenv("ERP_ADMIN_EMAIL", "").strip().lower()
            pw = os.getenv("ERP_ADMIN_PASSWORD", "")
            if email and len(pw) >= 12:
                db.add(User(name="Administrador", email=email, password=hash_password(pw), role="admin"))
                db.commit()
            else:
                print("AVISO: admin NAO criado. Defina ERP_ADMIN_EMAIL e ERP_ADMIN_PASSWORD (minimo 12 caracteres).")


class LoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/login")
def login(d: LoginIn, db: Session = Depends(get_db)):
    email = d.email.strip().lower()
    recent = [t for t in _fails.get(email, []) if t > time.time() - 900]
    if len(recent) >= 5:
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos.")
    u = db.scalar(select(User).where(User.email == email))
    if not u or not u.active or not check_password(d.password, u.password):
        _fails[email] = recent + [time.time()]
        log(db, None, "login.fail", "user", "", {"email": email})
        db.commit()
        raise HTTPException(401, "Credenciais invalidas")
    _fails.pop(email, None)
    token = secrets.token_urlsafe(32)
    db.add(UserSession(id=sha(token), user_id=u.id, expires=int(time.time()) + SESSION_SECONDS))
    log(db, u, "login")
    db.commit()
    return {"token": token, "user": {"id": u.id, "name": u.name, "email": u.email, "role": u.role}}


@app.post("/api/logout")
def logout(authorization: str = Header(default=""), u: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(UserSession, sha(authorization[7:]))
    if s:
        db.delete(s)
    log(db, u, "logout")
    db.commit()
    return {"ok": True}


@app.get("/api/me")
def me(u: User = Depends(current_user)):
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role}


class PasswordIn(BaseModel):
    current: str
    new: str


@app.post("/api/me/password")
def change_password(d: PasswordIn, authorization: str = Header(default=""), u: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    if not check_password(d.current, u.password):
        raise HTTPException(403, "Senha atual incorreta")
    if len(d.new) < 12:
        raise HTTPException(422, "Nova senha com pelo menos 12 caracteres")
    u.password = hash_password(d.new)
    keep = sha(authorization[7:])
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
        if s.id != keep:
            db.delete(s)
    log(db, u, "user.password")
    db.commit()
    return {"ok": True}


@app.get("/api/backup")
def backup(u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    """Zip com copia consistente do banco SQLite + anexos."""
    import sqlite3
    import tempfile
    import zipfile
    if not DB_URL.startswith("sqlite"):
        raise HTTPException(501, "Backup via app so para SQLite; use pg_dump no PostgreSQL")
    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as td:
        copy = Path(td) / "pvp.db"
        src = sqlite3.connect(DATA / "pvp.db")
        dst = sqlite3.connect(copy)
        src.backup(dst)
        src.close()
        dst.close()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(copy, "pvp.db")
            for f in UPLOADS.iterdir():
                z.write(f, f"uploads/{f.name}")
    log(db, u, "backup.download")
    db.commit()
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="backup-{date.today()}.zip"'})


# ----- usuarios / empresas (admin) -----
class UserIn(BaseModel):
    name: str
    email: str
    password: str
    role: str


@app.get("/api/users")
def users(u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    return [dict(id=x.id, name=x.name, email=x.email, role=x.role, active=x.active)
            for x in db.scalars(select(User).order_by(User.name))]


@app.post("/api/users")
def create_user(d: UserIn, u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    email = d.email.strip().lower()
    if d.role not in ROLES:
        raise HTTPException(422, "Perfil invalido")
    if len(d.password) < 12:
        raise HTTPException(422, "Senha com pelo menos 12 caracteres")
    if "@" not in email or db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "E-mail invalido ou ja cadastrado")
    x = User(name=d.name.strip(), email=email, password=hash_password(d.password), role=d.role)
    db.add(x)
    log(db, u, "user.create", "user", x.id, {"email": email, "role": d.role})
    db.commit()
    return {"id": x.id}


class RoleIn(BaseModel):
    role: str


@app.post("/api/users/{uid}/role")
def set_role(uid: str, d: RoleIn, u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x:
        raise HTTPException(404, "Usuario nao encontrado")
    if d.role not in ROLES:
        raise HTTPException(422, "Perfil invalido")
    if x.id == u.id:
        raise HTTPException(409, "Nao e possivel alterar o proprio perfil")
    before = x.role
    x.role = d.role
    for s in db.scalars(select(UserSession).where(UserSession.user_id == x.id)):
        db.delete(s)  # forca novo login com o novo perfil
    log(db, u, "user.role", "user", x.id, {"from": before, "to": d.role})
    db.commit()
    return {"ok": True}


class ResetIn(BaseModel):
    password: str


@app.post("/api/users/{uid}/password")
def reset_password(uid: str, d: ResetIn, u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x:
        raise HTTPException(404, "Usuario nao encontrado")
    if len(d.password) < 12:
        raise HTTPException(422, "Senha com pelo menos 12 caracteres")
    x.password = hash_password(d.password)
    for s in db.scalars(select(UserSession).where(UserSession.user_id == x.id)):
        db.delete(s)
    log(db, u, "user.password_reset", "user", x.id)
    db.commit()
    return {"ok": True}


@app.post("/api/users/{uid}/active")
def toggle_user(uid: str, active: bool, u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x:
        raise HTTPException(404, "Usuario nao encontrado")
    if x.id == u.id:
        raise HTTPException(409, "Nao e possivel desativar a si mesmo")
    x.active = active
    if not active:
        for s in db.scalars(select(UserSession).where(UserSession.user_id == x.id)):
            db.delete(s)
    log(db, u, "user.active", "user", x.id, {"active": active})
    db.commit()
    return {"ok": True}


class CompanyIn(BaseModel):
    name: str
    cnpj: str = ""


@app.get("/api/companies")
def companies(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [dict(id=c.id, name=c.name, cnpj=c.cnpj, active=c.active)
            for c in db.scalars(select(Company).order_by(Company.name))]


@app.post("/api/companies")
def create_company(d: CompanyIn, u: User = Depends(require("admin")), db: Session = Depends(get_db)):
    if not d.name.strip():
        raise HTTPException(422, "Nome obrigatorio")
    c = Company(name=d.name.strip(), cnpj=d.cnpj.strip())
    db.add(c)
    log(db, u, "company.create", "company", c.id, {"name": c.name, "cnpj": c.cnpj})
    db.commit()
    return {"id": c.id}


# ----- favorecidos -----
class PayeeIn(BaseModel):
    name: str
    document: str = ""
    payment_info: str = ""


@app.get("/api/payees")
def payees(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [dict(id=p.id, name=p.name, document=p.document, payment_info=p.payment_info, active=p.active)
            for p in db.scalars(select(Payee).order_by(Payee.name))]


@app.post("/api/payees")
def create_payee(d: PayeeIn, u: User = Depends(require("financeiro", "admin")), db: Session = Depends(get_db)):
    if not d.name.strip():
        raise HTTPException(422, "Nome obrigatorio")
    p = Payee(name=d.name.strip(), document=d.document.strip(), payment_info=d.payment_info.strip())
    db.add(p)
    log(db, u, "payee.create", "payee", p.id, {"name": p.name})
    db.commit()
    return {"id": p.id}


# ----- pagamentos -----
def pay_dict(p: Payment) -> dict:
    return dict(id=p.id, company_id=p.company_id, company=p.company.name, cnpj=p.company.cnpj,
                payee_id=p.payee_id, payee=p.payee.name, payee_info=p.payee.payment_info,
                description=p.description, amount_cents=p.amount_cents, pay_date=p.pay_date.isoformat(),
                cost_center=p.cost_center, status=p.status, has_attachment=bool(p.attachment),
                attachment_name=p.attachment_name, created_by=p.creator.name,
                created_at=p.created_at.isoformat() + "Z",
                decided_by=p.decider.name if p.decider else None,
                decided_at=p.decided_at.isoformat() + "Z" if p.decided_at else None,
                reason=p.reason, paid_date=p.paid_date.isoformat() if p.paid_date else None,
                paid_via=p.paid_via, paid_ref=p.paid_ref,
                overdue=p.status == "approved" and p.pay_date < date.today())


def snap(p: Payment) -> dict:
    return dict(company=p.company.name, payee=p.payee.name, description=p.description,
                amount_cents=p.amount_cents, pay_date=p.pay_date.isoformat(),
                cost_center=p.cost_center, status=p.status)


def save_upload(f: Optional[UploadFile]):
    if not f or not f.filename:
        return None, None
    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, "Anexo deve ser PDF, PNG ou JPG")
    content = f.file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(422, "Anexo acima de 10 MB")
    name = new_id() + ext
    (UPLOADS / name).write_bytes(content)
    return name, Path(f.filename).name[:200]


def list_query(db, status, company_id, q, date_from, date_to):
    stmt = select(Payment).join(Payee).order_by(Payment.pay_date, Payment.created_at)
    if status == "overdue":
        stmt = stmt.where(Payment.status == "approved", Payment.pay_date < date.today())
    elif status:
        stmt = stmt.where(Payment.status == status)
    if company_id:
        stmt = stmt.where(Payment.company_id == company_id)
    if date_from:
        stmt = stmt.where(Payment.pay_date >= parse_date(date_from))
    if date_to:
        stmt = stmt.where(Payment.pay_date <= parse_date(date_to))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Payee.name.ilike(like) | Payment.description.ilike(like))
    return list(db.scalars(stmt))


def _sum(items):
    return {"count": len(items), "cents": sum(p.amount_cents for p in items)}


def _ranking(items, key, limit=8):
    acc: dict = {}
    for p in items:
        k = key(p) or "(sem informacao)"
        acc[k] = acc.get(k, 0) + p.amount_cents
    return [{"name": k, "cents": v} for k, v in sorted(acc.items(), key=lambda x: -x[1])[:limit]]


@app.get("/api/dashboard")
def dashboard(company_id: str = "", u: User = Depends(current_user), db: Session = Depends(get_db)):
    today = date.today()
    stmt = select(Payment)
    if company_id:
        stmt = stmt.where(Payment.company_id == company_id)
    allp = list(db.scalars(stmt))
    live = [p for p in allp if p.status in ("pending", "approved", "paid")]  # compromissos validos
    by = lambda s: [p for p in allp if p.status == s]  # noqa: E731
    approved = by("approved")
    month_key = today.strftime("%Y-%m")
    paid_month = [p for p in by("paid") if p.paid_date and p.paid_date.strftime("%Y-%m") == month_key]
    overdue = [p for p in approved if p.pay_date < today]
    next7 = [p for p in live if p.status != "paid" and today <= p.pay_date <= today + timedelta(days=7)]
    decided = [p for p in allp if p.decided_at and p.status in ("approved", "paid")]
    avg_h = round(sum((p.decided_at - p.created_at).total_seconds() for p in decided) / len(decided) / 3600, 1) if decided else None

    # serie mensal: 5 meses atras ate 2 a frente
    months = []
    y, m = today.year, today.month
    for off in range(-5, 3):
        mm = m + off
        yy = y + (mm - 1) // 12
        mm = (mm - 1) % 12 + 1
        months.append(f"{yy}-{mm:02d}")
    monthly = [{"month": k,
                "scheduled_cents": sum(p.amount_cents for p in live if p.pay_date.strftime("%Y-%m") == k),
                "paid_cents": sum(p.amount_cents for p in by("paid") if p.paid_date and p.paid_date.strftime("%Y-%m") == k)}
               for k in months]

    def bucket(p):
        d = (today - p.pay_date).days
        return ("a_vencer" if d <= 0 else "1_30" if d <= 30 else "31_60" if d <= 60 else "61_90" if d <= 90 else "90_mais")
    aging = {k: 0 for k in ("a_vencer", "1_30", "31_60", "61_90", "90_mais")}
    for p in approved:
        aging[bucket(p)] += p.amount_cents

    weeks = []
    for i in range(8):
        a, b = today + timedelta(days=7 * i), today + timedelta(days=7 * i + 6)
        weeks.append({"from": a.isoformat(), "cents": sum(p.amount_cents for p in live
                                                         if p.status != "paid" and a <= p.pay_date <= b)})
    upcoming = sorted([p for p in live if p.status != "paid" and p.pay_date >= today], key=lambda p: p.pay_date)[:8]
    out = {
        "kpis": {"pending": _sum(by("pending")), "approved_open": _sum(approved), "paid_month": _sum(paid_month),
                 "overdue": _sum(overdue), "rejected": _sum(by("rejected")), "next7": _sum(next7),
                 "avg_approval_hours": avg_h,
                 "pending_for_me": sum(1 for p in by("pending") if p.created_by != u.id), "total_live": _sum(live)},
        "monthly": monthly,
        "by_status": [{"status": s, **_sum(by(s))} for s in ("pending", "approved", "paid", "rejected", "cancelled")],
        "by_company": _ranking(live, lambda p: p.company.name),
        "by_cost_center": _ranking(live, lambda p: p.cost_center),
        "top_payees": _ranking(live, lambda p: p.payee.name, 8),
        "aging": aging, "weeks": weeks,
        "upcoming": [pay_dict(p) for p in upcoming],
        "recent_audit": [],
    }
    if u.role in ("admin", "auditoria"):
        out["recent_audit"] = [audit_dict(a) for a in db.scalars(select(Audit).order_by(Audit.id.desc()).limit(8))]
    return out


@app.get("/api/payments")
def list_payments(status: str = "", company_id: str = "", q: str = "", date_from: str = "", date_to: str = "",
                  u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [pay_dict(p) for p in list_query(db, status, company_id, q, date_from, date_to)]


@app.post("/api/payments")
def create_payment(company_id: str = Form(...), payee_id: str = Form(...), description: str = Form(...),
                   amount: str = Form(...), pay_date: str = Form(...), cost_center: str = Form(""),
                   file: Optional[UploadFile] = File(None),
                   u: User = Depends(require("financeiro", "admin")), db: Session = Depends(get_db)):
    if not db.get(Company, company_id) or not db.get(Payee, payee_id):
        raise HTTPException(404, "CNPJ ou favorecido inexistente")
    att, att_name = save_upload(file)
    p = Payment(company_id=company_id, payee_id=payee_id, description=description.strip()[:300],
                amount_cents=to_cents(amount), pay_date=parse_date(pay_date), cost_center=cost_center.strip()[:80],
                attachment=att, attachment_name=att_name, created_by=u.id)
    db.add(p)
    db.flush()
    db.refresh(p)
    log(db, u, "payment.create", "payment", p.id, snap(p))
    db.commit()
    return {"id": p.id}


@app.put("/api/payments/{pid}")
def edit_payment(pid: str, company_id: str = Form(...), payee_id: str = Form(...), description: str = Form(...),
                 amount: str = Form(...), pay_date: str = Form(...), cost_center: str = Form(""),
                 file: Optional[UploadFile] = File(None),
                 u: User = Depends(require("financeiro", "admin")), db: Session = Depends(get_db)):
    p = db.get(Payment, pid)
    if not p:
        raise HTTPException(404, "Agendamento nao encontrado")
    if p.status not in ("pending", "rejected"):
        raise HTTPException(409, "Somente pendentes ou rejeitados podem ser editados")
    if not db.get(Company, company_id) or not db.get(Payee, payee_id):
        raise HTTPException(404, "CNPJ ou favorecido inexistente")
    before = snap(p)
    att, att_name = save_upload(file)
    p.company_id, p.payee_id = company_id, payee_id
    p.description, p.amount_cents = description.strip()[:300], to_cents(amount)
    p.pay_date, p.cost_center = parse_date(pay_date), cost_center.strip()[:80]
    if att:
        p.attachment, p.attachment_name = att, att_name
    p.status, p.reason, p.decided_by, p.decided_at = "pending", None, None, None
    db.flush()
    db.refresh(p)
    log(db, u, "payment.edit", "payment", p.id, {"before": before, "after": snap(p)})
    db.commit()
    return {"ok": True}


def decide(db, u, pid, approve: bool, reason: Optional[str]):
    p = db.get(Payment, pid)
    if not p:
        raise HTTPException(404, "Agendamento nao encontrado")
    if p.created_by == u.id:
        raise HTTPException(403, "Nao e permitido decidir sobre o proprio agendamento")
    if p.status != "pending":
        raise HTTPException(409, "Agendamento nao esta pendente")
    if not approve and not (reason and len(reason.strip()) >= 3):
        raise HTTPException(422, "Informe o motivo da rejeicao")
    p.status = "approved" if approve else "rejected"
    p.decided_by, p.decided_at = u.id, now()
    p.reason = None if approve else reason.strip()[:300]
    log(db, u, "payment.approve" if approve else "payment.reject", "payment", p.id,
        {"amount_cents": p.amount_cents, "reason": p.reason})


class BatchIn(BaseModel):
    ids: list[str]


class ReasonIn(BaseModel):
    reason: str = ""


@app.post("/api/payments/approve-batch")
def approve_batch(d: BatchIn, u: User = Depends(require("aprovador", "admin")), db: Session = Depends(get_db)):
    done, errors = [], []
    for pid in d.ids:
        try:
            with db.begin_nested():
                decide(db, u, pid, True, None)
            done.append(pid)
        except HTTPException as e:
            errors.append({"id": pid, "error": e.detail})
    db.commit()
    return {"approved": done, "errors": errors}


@app.post("/api/payments/{pid}/approve")
def approve(pid: str, u: User = Depends(require("aprovador", "admin")), db: Session = Depends(get_db)):
    decide(db, u, pid, True, None)
    db.commit()
    return {"ok": True}


@app.post("/api/payments/{pid}/reject")
def reject(pid: str, d: ReasonIn, u: User = Depends(require("aprovador", "admin")), db: Session = Depends(get_db)):
    decide(db, u, pid, False, d.reason)
    db.commit()
    return {"ok": True}


@app.post("/api/payments/{pid}/cancel")
def cancel(pid: str, d: ReasonIn, u: User = Depends(require("financeiro", "admin")), db: Session = Depends(get_db)):
    p = db.get(Payment, pid)
    if not p:
        raise HTTPException(404, "Agendamento nao encontrado")
    if p.status in ("paid", "cancelled"):
        raise HTTPException(409, "Agendamento ja pago ou cancelado")
    if len(d.reason.strip()) < 3:
        raise HTTPException(422, "Informe o motivo do cancelamento")
    prev = p.status
    p.status, p.reason = "cancelled", d.reason.strip()[:300]
    log(db, u, "payment.cancel", "payment", p.id, {"from": prev, "reason": p.reason})
    db.commit()
    return {"ok": True}


class PayIn(BaseModel):
    paid_date: Optional[str] = None


def mark_paid(db, u, p: Payment, paid_date: date, via: str, ref: Optional[str]):
    if p.status != "approved":
        raise HTTPException(409, "Somente agendamentos aprovados podem ser pagos")
    p.status, p.paid_date, p.paid_via, p.paid_ref = "paid", paid_date, via, ref
    log(db, u, "payment.pay", "payment", p.id, {"via": via, "paid_date": paid_date, "ref": ref})


@app.post("/api/payments/{pid}/pay")
def pay(pid: str, d: PayIn, u: User = Depends(require("financeiro", "admin")), db: Session = Depends(get_db)):
    p = db.get(Payment, pid)
    if not p:
        raise HTTPException(404, "Agendamento nao encontrado")
    mark_paid(db, u, p, parse_date(d.paid_date) if d.paid_date else date.today(), "manual", None)
    db.commit()
    return {"ok": True}


@app.get("/api/payments/{pid}/attachment")
def attachment(pid: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Payment, pid)
    if not p or not p.attachment:
        raise HTTPException(404, "Sem anexo")
    log(db, u, "attachment.view", "payment", p.id)
    db.commit()
    return FileResponse(UPLOADS / p.attachment, filename=p.attachment_name)


# ----- conciliacao por extrato -----
def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def parse_amount(v) -> int:
    if isinstance(v, (int, float, Decimal)):
        return int((Decimal(str(v)) * 100).to_integral_value())
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if not s:
        raise ValueError("vazio")
    neg = s.startswith("-") or s.endswith("-") or (s.startswith("(") and s.endswith(")")) or s.upper().endswith("D")
    s = s.strip("()-+").rstrip("DdCc")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    c = int((Decimal(s) * 100).to_integral_value())
    return -abs(c) if neg else c


def parse_stmt_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()[:10]
    for f in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            pass
    raise ValueError("data")


DATE_COLS = {"data", "date", "data pagamento", "data lancamento", "dt"}
AMOUNT_COLS = {"valor", "amount", "valor (r$)", "valor r$", "debito"}
DESC_COLS = {"descricao", "historico", "favorecido", "beneficiario", "memo", "lancamento", "complemento", "nome"}


def read_statement(name: str, raw: bytes) -> list[dict]:
    if name.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        first = text.splitlines()[0] if text else ""
        delim = ";" if first.count(";") >= first.count(",") else ","
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        raise HTTPException(422, "Arquivo vazio")
    head = [norm(h) for h in rows[0]]
    di = next((i for i, h in enumerate(head) if h in DATE_COLS), None)
    ai = next((i for i, h in enumerate(head) if h in AMOUNT_COLS), None)
    ci = [i for i, h in enumerate(head) if h in DESC_COLS]
    if di is None or ai is None:
        raise HTTPException(422, "Cabecalho precisa ter colunas de data e valor (ex.: Data; Descricao; Valor)")
    out = []
    for n, r in enumerate(rows[1:], start=2):
        if not r or all(c in (None, "") for c in r):
            continue
        desc = " ".join(str(r[i]) for i in ci if i < len(r) and r[i] not in (None, ""))
        item = {"line": n, "description": desc}
        try:
            item["date"] = parse_stmt_date(r[di])
            item["cents"] = parse_amount(r[ai])
        except Exception:
            item["error"] = "Linha ilegivel (data ou valor)"
        out.append(item)
    return out


@app.post("/api/reconcile/preview")
def reconcile_preview(file: UploadFile = File(...), u: User = Depends(require("auditoria", "admin")),
                      db: Session = Depends(get_db)):
    raw = file.file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(422, "Arquivo acima de 10 MB")
    lines = read_statement(file.filename or "", raw)
    valid = [l for l in lines if "error" not in l]
    has_debits = any(l["cents"] < 0 for l in valid)
    approved = list(db.scalars(select(Payment).where(Payment.status == "approved")))
    claimed: dict = {}
    result = []
    for l in lines:
        row = {"line": l["line"], "description": l["description"]}
        if "error" in l:
            result.append({**row, "result": "error", "note": l["error"]})
            continue
        row["date"], row["amount_cents"] = l["date"].isoformat(), abs(l["cents"])
        if has_debits and l["cents"] >= 0:
            result.append({**row, "result": "ignored", "note": "Entrada/credito ignorado"})
            continue
        cands = [p for p in approved if p.amount_cents == abs(l["cents"])
                 and abs((p.pay_date - l["date"]).days) <= DATE_TOLERANCE_DAYS]
        if len(cands) > 1:
            d = norm(l["description"])
            scored = [(sum(1 for t in norm(p.payee.name).split() if len(t) >= 3 and t in d), p) for p in cands]
            top = max(s for s, _ in scored)
            best = [p for s, p in scored if s == top and top > 0]
            cands = best if best else cands
        if len(cands) == 1 and cands[0].id not in claimed:
            claimed[cands[0].id] = l["line"]
            result.append({**row, "result": "match", "payment": pay_dict(cands[0])})
        elif len(cands) >= 1:
            result.append({**row, "result": "ambiguous", "note": "Mais de um candidato ou ja usado em outra linha",
                           "candidates": [pay_dict(p) for p in cands]})
        else:
            result.append({**row, "result": "unmatched", "note": "Nenhum agendamento aprovado correspondente"})
    log(db, u, "reconcile.preview", "statement", "", {"file": file.filename, "lines": len(lines),
                                                     "matches": len(claimed)})
    db.commit()
    return {"lines": result, "tolerance_days": DATE_TOLERANCE_DAYS}


class ConfirmItem(BaseModel):
    payment_id: str
    paid_date: str
    ref: str = ""


class ConfirmIn(BaseModel):
    items: list[ConfirmItem]
    file: str = ""


@app.post("/api/reconcile/confirm")
def reconcile_confirm(d: ConfirmIn, u: User = Depends(require("auditoria", "admin")),
                      db: Session = Depends(get_db)):
    done, errors = [], []
    for it in d.items:
        p = db.get(Payment, it.payment_id)
        try:
            if not p:
                raise HTTPException(404, "Agendamento nao encontrado")
            with db.begin_nested():
                mark_paid(db, u, p, parse_date(it.paid_date), "extrato", f"{d.file} {it.ref}".strip()[:300])
            done.append(it.payment_id)
        except HTTPException as e:
            errors.append({"id": it.payment_id, "error": e.detail})
    log(db, u, "reconcile.confirm", "statement", "", {"file": d.file, "paid": len(done), "errors": len(errors)})
    db.commit()
    return {"paid": done, "errors": errors}


# ----- auditoria / exportacao -----
def audit_dict(a: Audit) -> dict:
    return dict(id=a.id, ts=a.ts.isoformat() + "Z", actor=a.actor, action=a.action, entity=a.entity,
                entity_id=a.entity_id, detail=a.detail)


@app.get("/api/audit")
def audit(action: str = "", actor: str = "", entity_id: str = "", limit: int = 500,
          u: User = Depends(require("admin", "auditoria")), db: Session = Depends(get_db)):
    stmt = select(Audit).order_by(Audit.id.desc()).limit(min(limit, 5000))
    if action:
        stmt = stmt.where(Audit.action.like(f"{action}%"))
    if actor:
        stmt = stmt.where(Audit.actor.ilike(f"%{actor}%"))
    if entity_id:
        stmt = stmt.where(Audit.entity_id == entity_id)
    return [audit_dict(a) for a in db.scalars(stmt)]


def csv_response(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    csv.writer(buf, delimiter=";").writerows(rows)
    return Response(("﻿" + buf.getvalue()).encode("utf-8"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def brl(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}".replace(".", ",")


LABEL = {"pending": "Pendente", "approved": "Aprovado", "rejected": "Rejeitado", "paid": "Pago",
         "cancelled": "Cancelado"}


@app.get("/api/export/payments")
def export_payments(status: str = "", company_id: str = "", q: str = "", date_from: str = "", date_to: str = "",
                    u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = [["CNPJ pagador", "CNPJ", "Favorecido", "Descricao", "Centro de custos", "Valor", "Data agendada",
             "Situacao", "Criado por", "Decidido por", "Motivo", "Data pagamento", "Forma baixa"]]
    for p in list_query(db, status, company_id, q, date_from, date_to):
        rows.append([p.company.name, p.company.cnpj, p.payee.name, p.description, p.cost_center,
                     brl(p.amount_cents), p.pay_date.strftime("%d/%m/%Y"), LABEL[p.status], p.creator.name,
                     p.decider.name if p.decider else "", p.reason or "",
                     p.paid_date.strftime("%d/%m/%Y") if p.paid_date else "", p.paid_via or ""])
    log(db, u, "export.payments")
    db.commit()
    return csv_response(rows, "pagamentos.csv")


@app.get("/api/export/audit")
def export_audit(u: User = Depends(require("admin", "auditoria")), db: Session = Depends(get_db)):
    rows = [["Data/hora (UTC)", "Usuario", "Acao", "Entidade", "ID", "Detalhe"]]
    for a in db.scalars(select(Audit).order_by(Audit.id)):
        rows.append([a.ts.isoformat(sep=" ", timespec="seconds"), a.actor, a.action, a.entity, a.entity_id, a.detail])
    log(db, u, "export.audit")
    db.commit()
    return csv_response(rows, "auditoria.csv")


app.mount("/assets", StaticFiles(directory=Path(__file__).parent / "static"), name="assets")


@app.get("/", response_class=HTMLResponse)
def index():
    return (Path(__file__).parent / "index.html").read_text(encoding="utf-8")
