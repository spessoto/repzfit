import type { FastifyRequest } from "fastify";

import { env } from "../config/env.js";

/**
 * Monta a URL base do webhook a partir dos headers da requisição.
 * Usa x-forwarded-proto / x-forwarded-host para funcionar corretamente
 * atrás de proxies (Vercel, nginx, etc.).
 * Usa FRONTEND_URL como fallback de produção caso os headers não estejam presentes.
 */
export function buildWebhookUrlFromRequest(request: FastifyRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const hostHeader =
    request.headers["x-forwarded-host"] || request.headers.host;

  const protocol =
    typeof protoHeader === "string" && protoHeader.trim()
      ? protoHeader.split(",")[0].trim()
      : "https";

  const host =
    typeof hostHeader === "string" && hostHeader.trim()
      ? hostHeader.split(",")[0].trim()
      : null;

  if (host) {
    return `${protocol}://${host}/webhooks/evolution`;
  }

  // Fallback: usa FRONTEND_URL se disponível, senão URL canônica de produção.
  const base = env.FRONTEND_URL?.replace(/\/+$/, "") ?? "https://app.ezpersonal.com.br";
  return `${base}/webhooks/evolution`;
}
