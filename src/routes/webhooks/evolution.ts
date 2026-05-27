import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { processIncomingMessage } from "../../services/bot-engine.js";

const EvolutionWebhookSchema = z.object({
  // Evolution API can send the event as "messages.upsert" or "MESSAGES_UPSERT"
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: z.object({
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

    // Accept both "messages.upsert" and "MESSAGES_UPSERT" formats
    const eventNorm = payload.event.toLowerCase().replace(/_/g, ".");
    if (eventNorm !== "messages.upsert") {
      app.log.info({ event: payload.event }, "Webhook event ignored");
      return reply.code(200).send({ ignored: true });
    }

    if (payload.data.key.fromMe) {
      return reply.code(200).send({ ignored: true });
    }

    // Ignorar mensagens com mais de 2 minutos (evita reprocessar fila acumulada)
    const msgTs = payload.data.messageTimestamp;
    if (msgTs && Date.now() / 1000 - msgTs > 120) {
      app.log.info({ msgTs }, "Message too old, ignoring");
      return reply.code(200).send({ ignored: true });
    }

    const { text, buttonId, audioUrl } = extractInput(payload);

    await processIncomingMessage({
      app,
      instance: payload.instance,
      remoteJid: payload.data.key.remoteJid,
      inputText: text,
      buttonId,
      audioUrl,
    });

    return reply.code(200).send({ ok: true });
  });
}
