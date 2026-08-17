import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { getUnifiedEvolutionInstanceName } from "../../services/evolution-service.js";
import { processIncomingMessage } from "../../services/bot-engine.js";
import { sendAlertEmail, getAlertRecipients } from "../../services/email-service.js";
import { logAction } from "../../utils/system-logger.js";

// Emergency circuit breaker — set to true to pause bot instantly in production.
const EMERGENCY_BOT_PAUSE = false;
const RECENT_MESSAGE_TTL_MS = 2 * 60 * 1000;
const recentMessageFingerprints = new Map<string, number>();

// Anti-spam para e-mail de desconexão via webhook
// (o cron já tem o próprio estado; este é independente para reação imediata)
let webhookDisconnectEmailSent = false;

const EvolutionWebhookSchema = z.object({
  // Evolution API can send the event as "messages.upsert" or "MESSAGES_UPSERT"
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: z.object({
      id: z.string().optional(),
      remoteJid: z.string(),
      fromMe: z.boolean(),
    }),
    // Accept any messageType string — filter for supported ones at runtime
    messageType: z.string(),
    messageTimestamp: z.number().optional(),
    message: z
      .object({
        conversation: z.string().optional(),
        extendedTextMessage: z
          .object({
            text: z.string(),
          })
          .optional(),
        buttonsResponseMessage: z
          .object({
            selectedButtonId: z.string(),
          })
          .optional(),
      })
      .optional(),
    audioMessage: z
      .object({
        url: z.string().optional(),
      })
      .optional(),
  }),
});

type EvolutionWebhook = z.infer<typeof EvolutionWebhookSchema>;

function purgeOldFingerprints(nowMs: number) {
  for (const [key, ts] of recentMessageFingerprints.entries()) {
    if (nowMs - ts > RECENT_MESSAGE_TTL_MS) {
      recentMessageFingerprints.delete(key);
    }
  }
}

function buildMessageFingerprint(
  payload: EvolutionWebhook,
  extracted: { text?: string; buttonId?: string; audioUrl?: string },
): string {
  const msgId = payload.data.key.id ?? "no-id";
  const ts = payload.data.messageTimestamp ?? 0;
  const normalizedText = (extracted.text ?? "").trim().toLowerCase();
  return [
    payload.instance,
    payload.data.key.remoteJid,
    msgId,
    String(ts),
    payload.data.messageType,
    extracted.buttonId ?? "",
    extracted.audioUrl ?? "",
    normalizedText,
  ].join("|");
}

function isDuplicateWebhookMessage(
  payload: EvolutionWebhook,
  extracted: { text?: string; buttonId?: string; audioUrl?: string },
): boolean {
  const nowMs = Date.now();
  purgeOldFingerprints(nowMs);
  const fingerprint = buildMessageFingerprint(payload, extracted);
  const lastSeen = recentMessageFingerprints.get(fingerprint);
  if (lastSeen && nowMs - lastSeen <= RECENT_MESSAGE_TTL_MS) {
    return true;
  }
  recentMessageFingerprints.set(fingerprint, nowMs);
  return false;
}

/**
 * Persistent deduplication using Supabase.
 * Protects against duplicate webhook delivery across Vercel instances / cold-start resets.
 * Returns true if the fingerprint was already processed (duplicate).
 */
async function isDbDuplicate(
  fingerprint: string,
  app: FastifyInstance,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("processed_webhook_events")
    .insert({ fingerprint });

  if (error) {
    if (error.code === "23505") {
      // Already processed — genuine duplicate
      return true;
    }
    // Unexpected DB error — log but allow processing to avoid blocking
    app.log.error(
      { error, fingerprint },
      "DB dedup insert error; allowing processing",
    );
    return false;
  }

  // Async cleanup of entries older than 10 minutes (fire-and-forget)
  void supabaseAdmin
    .from("processed_webhook_events")
    .delete()
    .lt("processed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  return false;
}

function extractInput(payload: EvolutionWebhook): {
  text?: string;
  buttonId?: string;
  audioUrl?: string;
} {
  const text =
    payload.data.message?.conversation ??
    payload.data.message?.extendedTextMessage?.text;

  const buttonId =
    payload.data.message?.buttonsResponseMessage?.selectedButtonId;
  const audioUrl = payload.data.audioMessage?.url;

  return { text, buttonId, audioUrl };
}

/**
 * Trata eventos de mudança de estado de conexão enviados pela Evolution API.
 * Dispara e-mail imediato se a conexão cair (complementa o cron de polling).
 */
async function handleConnectionUpdateWebhook(
  app: FastifyInstance,
  payload: any,
): Promise<void> {
  // A Evolution envia o estado em payload.data.state (ou payload.data.status)
  const data = payload?.data ?? {};
  const state = String(data.state || data.status || "unknown").toLowerCase();
  const instanceName = payload.instance ?? getUnifiedEvolutionInstanceName();

  app.log.info({ state, instanceName }, "[webhook] connection.update recebido");

  const isDisconnected = state === "close" || state === "closed" || state === "logout";
  const isConnected    = state === "open";

  if (isDisconnected && !webhookDisconnectEmailSent) {
    webhookDisconnectEmailSent = true;

    await logAction(app, {
      severity: "error",
      area: "connection",
      action: "whatsapp_disconnected_webhook",
      message: `WhatsApp desconectado via webhook — estado: ${state}`,
      context: { instanceName, state, source: "webhook" },
    });

    const now = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });

    void sendAlertEmail({
      to: getAlertRecipients(),
      subject: `⚠️ WhatsApp Desconectado — EZ Personal (${instanceName})`,
      html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700;">⚠️ ALERTA DE DESCONEXÃO</span>
    <h1 style="font-size: 22px; color: #111827; margin: 16px 0 8px;">WhatsApp Desconectado</h1>
    <p style="color: #6b7280; margin: 0 0 24px;">O bot do EZ Personal foi desconectado do WhatsApp e pode estar fora do ar.</p>
    <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px;">
      <tr><td style="padding: 12px 16px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Instância</td><td style="padding: 12px 16px; color: #1f2937; border-bottom: 1px solid #e5e7eb;">${instanceName}</td></tr>
      <tr><td style="padding: 12px 16px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Estado</td><td style="padding: 12px 16px; color: #dc2626; font-weight: 700; border-bottom: 1px solid #e5e7eb;">${state}</td></tr>
      <tr><td style="padding: 12px 16px; font-weight: 600; color: #374151;">Horário (BRT)</td><td style="padding: 12px 16px; color: #1f2937;">${now}</td></tr>
    </table>
    <div style="margin-top: 24px; padding: 16px; background: #fffbeb; border-radius: 8px; border: 1px solid #fde68a;">
      <p style="margin: 0; color: #92400e; font-size: 14px;"><strong>Ação necessária:</strong> Acesse <a href="https://app.ezpersonal.com.br" style="color: #d97706;">app.ezpersonal.com.br</a> e reconecte escaneando o QR code.</p>
    </div>
  </div>
</body>
</html>`,
      text: `WhatsApp desconectado (${state}) às ${now}. Acesse app.ezpersonal.com.br para reconectar.`,
    });
  }

  if (isConnected && webhookDisconnectEmailSent) {
    webhookDisconnectEmailSent = false;

    await logAction(app, {
      severity: "info",
      area: "connection",
      action: "whatsapp_reconnected_webhook",
      message: "WhatsApp reconectado via webhook",
      context: { instanceName, state, source: "webhook" },
    });

    const now = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });

    void sendAlertEmail({
      to: getAlertRecipients(),
      subject: `✅ WhatsApp Reconectado — EZ Personal (${instanceName})`,
      html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700;">✅ RECONECTADO</span>
    <h1 style="font-size: 22px; color: #111827; margin: 16px 0 8px;">WhatsApp Reconectado</h1>
    <p style="color: #6b7280; margin: 0 0 16px;">O bot do EZ Personal voltou a ficar online às ${now}.</p>
    <p style="color: #374151; font-size: 14px;">Instância: <strong>${instanceName}</strong></p>
  </div>
</body>
</html>`,
      text: `WhatsApp reconectado (${state}) às ${now}.`,
    });
  }
}

export async function registerEvolutionWebhookRoute(app: FastifyInstance) {
  app.post("/evolution", async (request, reply) => {
    if (EMERGENCY_BOT_PAUSE) {
      app.log.warn("Bot processing paused by emergency circuit breaker");
      return reply.code(200).send({ ignored: true, paused: true });
    }

    const signature = request.headers["x-webhook-secret"];
    if (signature !== env.EVOLUTION_WEBHOOK_SECRET) {
      app.log.warn("Invalid webhook secret");
      return reply.code(200).send({ ignored: true });
    }

    const parsed = EvolutionWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      app.log.warn(
        { issues: parsed.error.issues, body: request.body },
        "Invalid webhook payload — raw body logged for debugging",
      );
      return reply.code(200).send({ ignored: true });
    }

    const payload = parsed.data;
    const unifiedInstance = getUnifiedEvolutionInstanceName();

    if (payload.instance !== unifiedInstance) {
      app.log.info(
        {
          receivedInstance: payload.instance,
          expectedInstance: unifiedInstance,
        },
        "Webhook instance ignored",
      );
      return reply.code(200).send({ ignored: true });
    }

    // Accept both "messages.upsert" and "MESSAGES_UPSERT" formats
    const eventNorm = payload.event.toLowerCase().replace(/_/g, ".");

    // ── Handler: connection.update ───────────────────────────────────────────
    if (eventNorm === "connection.update") {
      await handleConnectionUpdateWebhook(app, payload);
      return reply.code(200).send({ ok: true });
    }

    if (eventNorm !== "messages.upsert") {
      app.log.info({ event: payload.event }, "Webhook event ignored");
      return reply.code(200).send({ ignored: true });
    }

    if (payload.data.key.fromMe) {
      return reply.code(200).send({ ignored: true });
    }

    // Ignorar grupos, broadcasts e JIDs fora do padrão usuário->usuário
    if (!payload.data.key.remoteJid.endsWith("@s.whatsapp.net")) {
      app.log.info(
        { remoteJid: payload.data.key.remoteJid },
        "Non-user JID ignored",
      );
      return reply.code(200).send({ ignored: true });
    }

    // Rejeitar mensagens sem timestamp ou com mais de 5 minutos
    // (previne reprocessamento de fila acumulada do WhatsApp)
    const msgTs = payload.data.messageTimestamp;
    const ageSeconds = msgTs ? Date.now() / 1000 - msgTs : Infinity;
    if (ageSeconds > 300) {
      app.log.info(
        { msgTs, ageSeconds },
        "Message too old or missing timestamp, ignoring",
      );
      return reply.code(200).send({ ignored: true });
    }

    const { text, buttonId, audioUrl } = extractInput(payload);

    // Ignorar eventos sem conteúdo acionável
    if (!text && !buttonId && !audioUrl) {
      app.log.info(
        { messageType: payload.data.messageType },
        "Empty/unsupported message payload ignored",
      );
      return reply.code(200).send({ ignored: true });
    }

    // Suprimir duplicatas recentes para evitar loop por reentrega do webhook
    if (isDuplicateWebhookMessage(payload, { text, buttonId, audioUrl })) {
      app.log.info(
        {
          remoteJid: payload.data.key.remoteJid,
          messageType: payload.data.messageType,
          messageId: payload.data.key.id,
        },
        "Duplicate webhook message ignored",
      );
      return reply.code(200).send({ ignored: true, duplicate: true });
    }

    // Persistent deduplication (cross-instance / cold-start safe)
    const fingerprint = buildMessageFingerprint(payload, {
      text,
      buttonId,
      audioUrl,
    });
    if (await isDbDuplicate(fingerprint, app)) {
      app.log.info(
        { fingerprint, remoteJid: payload.data.key.remoteJid },
        "DB-level duplicate webhook ignored",
      );
      return reply.code(200).send({ ignored: true, duplicate: true });
    }

    try {
      await processIncomingMessage({
        app,
        instance: payload.instance,
        remoteJid: payload.data.key.remoteJid,
        inputText: text,
        buttonId,
        audioUrl,
      });
    } catch (error) {
      app.log.error(
        error,
        "processIncomingMessage uncaught error — returning 200 to prevent webhook retry loop",
      );
    }

    return reply.code(200).send({ ok: true });
  });
}
