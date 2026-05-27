import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { registerEvolutionWebhookRoute } from "./routes/webhooks/evolution.js";
import { registerPersonalApiRoutes } from "./routes/api/personal.js";
import { registerAdminApiRoutes } from "./routes/api/admin.js";
import {
  runSessionCleanup,
  scheduleSessionCleanup,
} from "./cron/session-cleanup.js";

type BuildAppOptions = {
  enableCleanupScheduler?: boolean;
};

function getAllowedOrigins(): string[] {
  const origins = new Set<string>();

  if (env.FRONTEND_URL) {
    origins.add(env.FRONTEND_URL);
  }

  // Localhost para desenvolvimento
  origins.add("http://localhost:3000");
  origins.add("http://localhost:3333");
  origins.add("http://localhost:5173");

  // URL de produção
  origins.add("https://project-pxgam.vercel.app");

  return Array.from(origins);
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  const allowedOrigins = getAllowedOrigins();

  await app.register(sensible);

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/",
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Log para debug
      app.log.info({ origin }, "CORS request");

      if (!origin) {
        callback(null, true);
        return;
      }

      // Permitir localhost em qualquer porta (desenvolvimento)
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        callback(null, true);
        return;
      }

      // Verificar origens permitidas
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Permitir apenas domínios Vercel específicos do projeto
      if (/^https:\/\/repzfit-[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
        callback(null, true);
        return;
      }

      app.log.warn({ origin, allowedOrigins }, "CORS origin denied");
      callback(new Error("CORS origin denied"), false);
    },
    credentials: true,
  });

  app.get("/health", async () => {
    return { ok: true, service: "repz-fit-backend" };
  });

  app.post("/api/internal/session-cleanup", async (request, reply) => {
    if (env.CRON_SECRET) {
      const authHeader = request.headers.authorization;
      const expected = `Bearer ${env.CRON_SECRET}`;

      if (authHeader !== expected) {
        throw app.httpErrors.unauthorized("Invalid cron secret");
      }
    }

    await runSessionCleanup(app);
    return reply.send({ ok: true });
  });

  await app.register(registerEvolutionWebhookRoute, { prefix: "/webhooks" });
  await app.register(registerPersonalApiRoutes, { prefix: "/api" });
  await app.register(registerAdminApiRoutes, { prefix: "/api" });

  if (options.enableCleanupScheduler ?? true) {
    app.addHook("onReady", async () => {
      scheduleSessionCleanup(app);
    });
  }

  return app;
}
