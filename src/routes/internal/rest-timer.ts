import type { FastifyInstance } from "fastify";

import { processExpiredRestTimers } from "../../services/bot-engine.js";

export async function registerRestTimerPollRoute(app: FastifyInstance) {
  // Chamado pelo pg_cron a cada minuto via pg_net.
  // Não precisa de autenticação — rest_end_at <= NOW() é a guarda de segurança.
  app.post("/api/internal/rest-timer/poll", async (_request, reply) => {
    const processed = await processExpiredRestTimers(app);
    return reply.code(200).send({ ok: true, processed });
  });
}
