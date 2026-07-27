import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";
import { processExpiredRestTimers } from "../../services/bot-engine.js";

export async function registerRestTimerPollRoute(app: FastifyInstance) {
  // Chamado por pg_cron via pg_net ou pelo scheduler interno.
  // Protegido por CRON_SECRET quando configurado.
  app.post("/api/internal/rest-timer/poll", async (request, reply) => {
    if (env.CRON_SECRET) {
      const authHeader = request.headers.authorization;
      const expected = `Bearer ${env.CRON_SECRET}`;

      if (authHeader !== expected) {
        throw app.httpErrors.unauthorized("Invalid cron secret");
      }
    }

    const processed = await processExpiredRestTimers(app);
    return reply.code(200).send({ ok: true, processed });
  });
}
