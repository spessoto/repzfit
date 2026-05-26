import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { processIncomingMessage } from "../../services/bot-engine.js";

const EvolutionWebhookSchema = z.object({
  event: z.literal("messages.upsert"),
  instance: z.string(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
    }),
    messageType: z.enum([
      "conversation",
      "extendedTextMessage",
      "buttonsResponseMessage",
      "audioMessage",
    ]),
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
      app.log.warn({ issues: parsed.error.issues }, "Invalid webhook payload");
      return reply.code(200).send({ ignored: true });
    }

    const payload = parsed.data;

    if (payload.data.key.fromMe) {
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
