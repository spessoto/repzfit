import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
import { processExpiredRestTimers } from "../services/bot-engine.js";

const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 60_000;

function getPollIntervalMs() {
  return Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(MIN_POLL_INTERVAL_MS, env.REST_TIMER_POLL_INTERVAL_MS),
  );
}

export function scheduleRestTimerPoll(app: FastifyInstance) {
  const intervalMs = getPollIntervalMs();
  let inFlight = false;

  const timer = setInterval(async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      const processed = await processExpiredRestTimers(app);
      if (processed > 0) {
        app.log.info(
          { processed, intervalMs },
          "Rest timer poll processed expired states",
        );
      }
    } catch (error) {
      app.log.error(error, "Rest timer poll failed");
    } finally {
      inFlight = false;
    }
  }, intervalMs);

  timer.unref();

  app.log.info(
    { intervalMs },
    "Rest timer scheduler enabled (in-process polling)",
  );
}
