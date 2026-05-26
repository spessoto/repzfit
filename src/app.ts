import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

import { env } from "./config/env.js";
import { registerEvolutionWebhookRoute } from "./routes/webhooks/evolution.js";
import { registerPersonalApiRoutes } from "./routes/api/personal.js";
import { scheduleSessionCleanup } from "./cron/session-cleanup.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
});

await app.register(sensible);
await app.register(cors, {
  origin: true,
});

app.get("/health", async () => {
  return { ok: true, service: "repz-fit-backend" };
});

await app.register(registerEvolutionWebhookRoute, { prefix: "/v1/webhooks" });
await app.register(registerPersonalApiRoutes, { prefix: "/api" });

app.addHook("onReady", async () => {
  scheduleSessionCleanup(app);
});

const closeSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of closeSignals) {
  process.on(signal, async () => {
    app.log.info({ signal }, "Shutting down server");
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error, "Failed to start server");
  process.exit(1);
}
