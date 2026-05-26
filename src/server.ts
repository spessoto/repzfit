import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp({ enableCleanupScheduler: true });

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
