import type { IncomingMessage, ServerResponse } from "node:http";

import { buildApp } from "../src/app.js";

let appPromise: ReturnType<typeof buildApp> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp({
      enableCleanupScheduler: false,
      enableRestTimerScheduler: false,
    });
  }

  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const app = await getApp();
  await app.ready();
  app.server.emit("request", req, res);
}
