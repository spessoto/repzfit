import type { FastifyInstance } from "fastify";

import { supabaseAdmin } from "../config/supabase.js";

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const ABANDON_AFTER_HOURS = 4;

async function runSessionCleanup(app: FastifyInstance) {
  const threshold = new Date(
    Date.now() - ABANDON_AFTER_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: staleStates, error } = await supabaseAdmin
    .from("bot_state")
    .select("whatsapp_number,current_session_id")
    .lt("updated_at", threshold)
    .not("current_session_id", "is", null);

  if (error) {
    app.log.error(error, "Failed to query stale bot states");
    return;
  }

  for (const row of staleStates ?? []) {
    const sessionId = row.current_session_id;
    if (!sessionId) {
      continue;
    }

    const { error: sessionError } = await supabaseAdmin
      .from("daily_sessions")
      .update({ status: "abandoned" })
      .eq("id", sessionId)
      .eq("status", "started");

    if (sessionError) {
      app.log.error(
        { sessionId, sessionError },
        "Failed to mark session as abandoned",
      );
      continue;
    }

    const { error: stateError } = await supabaseAdmin
      .from("bot_state")
      .update({
        current_state: "IDLE",
        current_session_id: null,
        current_workout_exercise_id: null,
        current_set_number: 1,
        updated_at: new Date().toISOString(),
      })
      .eq("whatsapp_number", row.whatsapp_number);

    if (stateError) {
      app.log.error(
        { whatsapp: row.whatsapp_number, stateError },
        "Failed to reset bot state",
      );
    }
  }

  if ((staleStates?.length ?? 0) > 0) {
    app.log.info(
      { count: staleStates?.length ?? 0 },
      "Session cleanup finished",
    );
  }
}

export function scheduleSessionCleanup(app: FastifyInstance) {
  const timer = setInterval(() => {
    void runSessionCleanup(app);
  }, CLEANUP_INTERVAL_MS);

  timer.unref();
}
