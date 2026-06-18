import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { getUnifiedEvolutionInstanceName } from "../../services/evolution-service.js";
import { processIncomingMessage } from "../../services/bot-engine.js";

// Emergency circuit breaker — set to true to pause bot instantly in production.
const EMERGENCY_BOT_PAUSE = false;
const RECENT_MESSAGE_TTL_MS = 2 * 60 * 1000;
const recentMessageFingerprints = new Map<string, number>();

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
