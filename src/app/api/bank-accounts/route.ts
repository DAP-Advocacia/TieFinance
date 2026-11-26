import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError, newId } from "@/lib/core";
import { body, route } from "@/lib/http";
import { BANKS, type BankAccountDTO } from "@/lib/types";

const { bankAccounts, companies } = schema;

export const GET = route("any", async () => {
  const rows = await getDb()
    .select({ b: bankAccounts, company: companies.name })
    .from(bankAccounts)
    .innerJoin(companies, eq(companies.id, bankAccounts.companyId))
    .orderBy(asc(companies.name), asc(bankAccounts.bank), asc(bankAccounts.nickname));
  return rows.map(({ b, company }): BankAccountDTO => ({ id: b.id, company_id: b.companyId, company, bank: b.bank, kind: b.kind as BankAccountDTO["kind"], nickname: b.nickname, agency: b.agency, account: b.account, active: b.active }));
});

export const POST = route(["admin"], async ({ req, user }) => {
  const d = await body(
    req,
    z.object({ company_id: z.string(), bank: z.string(), nickname: z.string().default(""), agency: z.string().default(""), account: z.string().default("") }),
  );
  const bank = BANKS.find((b) => b.name === d.bank);
  if (!bank) throw new HttpError(422, "Banco invalido");
  const id = newId();
  await getDb().transaction(async (tx) => {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, d.company_id)).limit(1);
    if (!c) throw new HttpError(404, "CNPJ pagador inexistente");
    await tx.insert(bankAccounts).values({
      id,
      companyId: d.company_id,
      bank: bank.name,
      kind: bank.kind,
      nickname: (d.nickname.trim() || bank.name).slice(0, 80),
      agency: d.agency.trim().slice(0, 20),
      account: d.account.trim().slice(0, 30),
      active: true,
    });
    await log(tx, user, "bank_account.create", "bank_account", id, { bank: bank.name, company_id: d.company_id });
  });
  return { id };
});
