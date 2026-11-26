import { bigint, boolean, customType, date, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Timestamps sao "timestamp without time zone" guardados em UTC; lidos como string 'YYYY-MM-DD HH:MM:SS[.fff]'.
const ts = (name: string) => timestamp(name, { mode: "string" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const users = pgTable("users", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  password: varchar("password", { length: 300 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  active: boolean("active").notNull(),
});

export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  expires: bigint("expires", { mode: "number" }).notNull(),
});

export const companies = pgTable("companies", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }).notNull(),
  active: boolean("active").notNull(),
});

export const payees = pgTable("payees", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  document: varchar("document", { length: 20 }).notNull(),
  paymentInfo: varchar("payment_info", { length: 300 }).notNull(),
  active: boolean("active").notNull(),
});

export const bankAccounts = pgTable("bank_accounts", {
  id: varchar("id", { length: 32 }).primaryKey(),
  companyId: varchar("company_id", { length: 32 }).notNull().references(() => companies.id),
  bank: varchar("bank", { length: 60 }).notNull(),
  kind: varchar("kind", { length: 10 }).notNull(),
  nickname: varchar("nickname", { length: 80 }).notNull(),
  agency: varchar("agency", { length: 20 }).notNull(),
  account: varchar("account", { length: 30 }).notNull(),
  active: boolean("active").notNull(),
});

export const payments = pgTable("payments", {
  id: varchar("id", { length: 32 }).primaryKey(),
  companyId: varchar("company_id", { length: 32 }).notNull().references(() => companies.id),
  payeeId: varchar("payee_id", { length: 32 }).notNull().references(() => payees.id),
  description: varchar("description", { length: 300 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  payDate: date("pay_date", { mode: "string" }).notNull(),
  costCenter: varchar("cost_center", { length: 80 }).notNull(),
  status: varchar("status", { length: 12 }).notNull(),
  attachment: varchar("attachment", { length: 120 }),
  attachmentName: varchar("attachment_name", { length: 200 }),
  createdBy: varchar("created_by", { length: 32 }).notNull().references(() => users.id),
  createdAt: ts("created_at").notNull(),
  decidedBy: varchar("decided_by", { length: 32 }).references(() => users.id),
  decidedAt: ts("decided_at"),
  reason: varchar("reason", { length: 300 }),
  paidDate: date("paid_date", { mode: "string" }),
  paidVia: varchar("paid_via", { length: 12 }),
  paidRef: varchar("paid_ref", { length: 300 }),
  bankAccountId: varchar("bank_account_id", { length: 32 }).references(() => bankAccounts.id),
});

export const statementImports = pgTable("statement_imports", {
  id: serial("id").primaryKey(),
  bankAccountId: varchar("bank_account_id", { length: 32 }).notNull().references(() => bankAccounts.id),
  filename: varchar("filename", { length: 200 }).notNull(),
  fileHash: varchar("file_hash", { length: 64 }).notNull(),
  importedBy: varchar("imported_by", { length: 32 }).references(() => users.id),
  importedAt: ts("imported_at").notNull(),
  lines: integer("lines").notNull(),
  paid: integer("paid").notNull(),
});

export const attachments = pgTable("attachments", {
  id: varchar("id", { length: 40 }).primaryKey(),
  data: bytea("data").notNull(),
});

export const audit = pgTable(
  "audit",
  {
    id: serial("id").primaryKey(),
    ts: ts("ts").notNull(),
    actorId: varchar("actor_id", { length: 32 }),
    actor: varchar("actor", { length: 160 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    entity: varchar("entity", { length: 30 }).notNull(),
    entityId: varchar("entity_id", { length: 32 }).notNull(),
    detail: text("detail").notNull(),
  },
  (t) => [index("ix_audit_ts").on(t.ts), index("ix_audit_action").on(t.action)],
);

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 160 }).notNull(),
  ts: ts("ts").notNull(),
});
