import { randomUUID } from "node:crypto";

export const ROLES = ["admin", "financeiro", "aprovador", "auditoria"] as const;
export type Role = (typeof ROLES)[number];
export const STATUSES = ["pending", "approved", "rejected", "paid", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export const MAX_UPLOAD = 4 * 1024 * 1024; // limite de corpo de requisicao da Vercel: 4,5 MB
export const ALLOWED_EXT = [".pdf", ".png", ".jpg", ".jpeg"];
export const SESSION_SECONDS = 8 * 3600;

export class HttpError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

export const newId = () => randomUUID().replace(/-/g, "");

/** UTC 'YYYY-MM-DD HH:MM:SS.mmm' (formato de timestamp sem fuso do Postgres) */
export const nowUtc = () => new Date().toISOString().replace("T", " ").replace("Z", "");
/** 'YYYY-MM-DD HH:MM:SS' (UTC) -> ISO com Z */
export const toIso = (t: string | null | undefined) => (t ? t.replace(" ", "T") + "Z" : null);

export const TZ = "America/Sao_Paulo";
/** Data de hoje (YYYY-MM-DD) no fuso de Sao Paulo */
export const todaySP = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

export function parseDate(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(s + "T00:00:00Z");
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) return s;
  }
  throw new HttpError(422, "Data invalida (use AAAA-MM-DD)");
}

/** '1500.00' ou '1.500,00' -> centavos. Positivo, ate 2 casas decimais. */
export function toCents(v: unknown): number {
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new HttpError(422, "Valor deve ser positivo, com ate 2 casas decimais");
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  if (cents <= 0 || !Number.isSafeInteger(cents)) throw new HttpError(422, "Valor deve ser positivo, com ate 2 casas decimais");
  return cents;
}

export const brl = (cents: number) => `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
export const fmtDateBR = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  paid: "Pago",
  cancelled: "Cancelado",
};
