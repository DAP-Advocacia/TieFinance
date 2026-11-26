import { ZodError } from "zod";
import { HttpError, type Role } from "./core";
import { tokenFromRequest, userFromToken, type SessionUser } from "./auth";

type Ctx<P> = { req: Request; user: SessionUser; params: P };
type Handler<P> = (c: Ctx<P>) => Promise<Response | unknown>;

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // clientes nao-navegador (testes, curl)
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

function fail(e: unknown): Response {
  if (e instanceof HttpError) return json({ detail: e.detail }, e.status);
  if (e instanceof ZodError) return json({ detail: e.issues[0]?.message ?? "Dados invalidos" }, 422);
  console.error(e);
  return json({ detail: "Erro interno" }, 500);
}

/** Envolve um route handler: CSRF por origem, autenticacao, autorizacao por perfil e tratamento de erros. */
export function route<P = Record<string, never>>(roles: readonly Role[] | "any", fn: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) throw new HttpError(403, "Origem nao permitida");
      const user = await userFromToken(tokenFromRequest(req));
      if (!user) throw new HttpError(401, "Nao autenticado");
      if (roles !== "any" && !roles.includes(user.role)) throw new HttpError(403, "Sem permissao");
      const out = await fn({ req, user, params: await ctx.params });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return fail(e);
    }
  };
}

/** Handler publico (login). */
export function publicRoute(fn: (req: Request) => Promise<Response | unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (!sameOrigin(req)) throw new HttpError(403, "Origem nao permitida");
      const out = await fn(req);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return fail(e);
    }
  };
}

export async function body<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(422, "Corpo invalido");
  }
  return schema.parse(raw);
}

export function csv(rows: (string | number | null)[][], filename: string): Response {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
  return new Response(text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
}
