"use client";
import type { Role, Status } from "@/lib/types";

export const ST: Record<string, string> = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado", paid: "Pago", cancelled: "Cancelado", overdue: "Atrasado" };
export const STC: Record<string, string> = { pending: "warn", approved: "info", rejected: "bad", paid: "good", cancelled: "", overdue: "bad" };
export const STATUS_VAR: Record<Status, string> = { pending: "var(--warn)", approved: "var(--brand-claro)", paid: "var(--ok)", rejected: "var(--err)", cancelled: "var(--line-2)" };
export const RL: Record<Role, string> = { admin: "Administrador", financeiro: "Financeiro", aprovador: "Aprovador", auditoria: "Auditoria" };
export const MN = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brlk = (c: number) => {
  const v = c / 100;
  return Math.abs(v) >= 1e6 ? "R$ " + (v / 1e6).toFixed(1).replace(".", ",") + " mi" : Math.abs(v) >= 1e4 ? "R$ " + (v / 1e3).toFixed(0) + " mil" : brl(c);
};
export const dt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "");
export const dd = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "");
export const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** fetch com cookie de sessao; 401 dispara evento para voltar ao login. */
export async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) {
    rest.body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  }
  const r = await fetch("/api" + path, { ...rest, headers, credentials: "same-origin" });
  if (!r.ok) {
    let m = r.statusText;
    try {
      const j = await r.json();
      m = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    if (r.status === 401 && path !== "/login" && path !== "/me") window.dispatchEvent(new Event("tf-unauthorized"));
    throw new ApiError(r.status, m);
  }
  return r;
}
export const J = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => (await api(path, init)).json();

export async function download(path: string, name: string) {
  const r = await api(path);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export async function openAttachment(id: string) {
  const r = await api(`/payments/${id}/attachment`);
  window.open(URL.createObjectURL(await r.blob()));
}
