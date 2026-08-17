/**
 * system-logger.ts
 *
 * Helper centralizado para registrar erros e eventos de ações da plataforma
 * na tabela `system_action_logs`.
 *
 * Uso:
 *   import { logAction } from "../utils/system-logger.js";
 *
 *   await logAction(app, {
 *     area: "workout",
 *     action: "create_workout",
 *     message: "Erro ao criar treino: " + error.message,
 *     personalId,
 *     resourceId: workoutId,
 *     resourceType: "workout",
 *     errorCode: String(error?.code ?? ""),
 *     context: { payload: parsed.data },
 *   });
 */

import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../config/supabase.js";

// Circuit-breaker: desativa persistência se a tabela não existir
let systemLogTableUnavailable = false;

export interface SystemLogInput {
  severity?: "info" | "warn" | "error";
  area: string;
  action: string;
  message: string;
  personalId?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
  errorCode?: string | null;
  context?: Record<string, unknown>;
}

/**
 * Registra um evento na tabela system_action_logs.
 * Nunca lança exceção — erros de persistência são logados e ignorados.
 */
export async function logAction(
  app: FastifyInstance,
  input: SystemLogInput,
): Promise<void> {
  const severity = input.severity ?? "error";

  const payload = {
    severity,
    area: input.area,
    action: input.action,
    message: input.message,
    personal_id: input.personalId ?? null,
    resource_id: input.resourceId ?? null,
    resource_type: input.resourceType ?? null,
    error_code: input.errorCode ?? null,
    context: input.context ?? {},
  };

  // Espelha no logger do Fastify (pino)
  if (severity === "error") {
    app.log.error({ syslog: payload }, `[syslog] ${input.area}/${input.action}: ${input.message}`);
  } else if (severity === "warn") {
    app.log.warn({ syslog: payload }, `[syslog] ${input.area}/${input.action}: ${input.message}`);
  } else {
    app.log.info({ syslog: payload }, `[syslog] ${input.area}/${input.action}: ${input.message}`);
  }

  if (systemLogTableUnavailable) return;

  try {
    const { error } = await supabaseAdmin
      .from("system_action_logs")
      .insert(payload);

    if (error) {
      // Se a tabela ainda não existir (migration não aplicada), desativa silenciosamente
      const msg = String(error.message ?? "").toLowerCase();
      if (msg.includes("system_action_logs") && msg.includes("relation")) {
        systemLogTableUnavailable = true;
        app.log.warn("system_action_logs table not found; log persistence disabled");
      } else {
        app.log.error({ error }, "Failed to persist system action log");
      }
    }
  } catch (err) {
    app.log.error({ err }, "Unexpected error persisting system action log");
  }
}

/**
 * Extrai uma mensagem de erro legível de qualquer tipo de exceção.
 */
export function extractErrorMessage(err: unknown): string {
  if (!err) return "Erro desconhecido";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const asAny = err as any;
  return String(asAny?.message ?? asAny?.error?.message ?? JSON.stringify(err));
}
