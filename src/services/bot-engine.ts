import type { FastifyInstance } from "fastify";

import { supabaseAdmin } from "../config/supabase.js";
import { sendButtonsMessage, sendTextMessage } from "./evolution-service.js";
import {
  generateFallbackReply,
  transcribeAudioFromUrl,
} from "./openai-service.js";

type IncomingMessage = {
  app: FastifyInstance;
  instance: string;
  remoteJid: string;
  inputText?: string;
  buttonId?: string;
  audioUrl?: string;
};

type BotStateRow = {
  whatsapp_number: string;
  student_id: string;
  current_state: string;
  current_session_id: string | null;
  current_workout_exercise_id: string | null;
  current_set_number: number;
};

const NUMERIC_STATES = new Set(["COLLECTING_REPS", "COLLECTING_WEIGHT"]);

function normalizeWhatsapp(remoteJid: string): string {
  return remoteJid.replace(/@.*/, "");
}

async function getStudentByWhatsapp(whatsapp: string) {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("id,name,personal_id,whatsapp_number,is_active")
    .eq("whatsapp_number", whatsapp)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getOrCreateState(
  whatsapp: string,
  studentId: string,
): Promise<BotStateRow> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("bot_state")
    .select(
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number",
    )
    .eq("whatsapp_number", whatsapp)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing as BotStateRow;
  }

  const seed: Partial<BotStateRow> = {
    whatsapp_number: whatsapp,
    student_id: studentId,
    current_state: "IDLE",
    current_set_number: 1,
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("bot_state")
    .insert(seed)
    .select(
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number",
    )
    .single();

  if (insertError) {
    throw insertError;
  }

  return inserted as BotStateRow;
}

async function updateState(whatsapp: string, patch: Partial<BotStateRow>) {
  const { error } = await supabaseAdmin
    .from("bot_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("whatsapp_number", whatsapp);

  if (error) {
    throw error;
  }
}

export async function processIncomingMessage(input: IncomingMessage) {
  const whatsapp = normalizeWhatsapp(input.remoteJid);
  const student = await getStudentByWhatsapp(whatsapp);

  if (!student) {
    input.app.log.info({ whatsapp }, "Unknown student, ignoring message");
    return;
  }

  const state = await getOrCreateState(whatsapp, student.id);

  let text = input.inputText?.trim() ?? "";
  if (!text && input.audioUrl) {
    try {
      text = (await transcribeAudioFromUrl(input.audioUrl)).trim();
    } catch (error) {
      input.app.log.error(error, "Audio transcription failed");
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Nao consegui entender o audio. Pode repetir em texto?",
      });
      return;
    }
  }

  const effectiveInput = input.buttonId ?? text;

  if (!effectiveInput) {
    return;
  }

  if (state.current_state === "IDLE") {
    await sendButtonsMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Bora treinar? To pronto para iniciar sua sessao de hoje.",
      buttons: [{ id: "START_TRAINING", text: "Sim, comecar" }],
    });

    await updateState(whatsapp, { current_state: "AWAITING_TRAINING_START" });
    return;
  }

  if (
    state.current_state === "AWAITING_TRAINING_START" &&
    effectiveInput === "START_TRAINING"
  ) {
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Sessao iniciada. Agora eu vou te guiar exercicio por exercicio.",
    });

    await updateState(whatsapp, {
      current_state: "SELECTING_EXERCISE",
      current_set_number: 1,
    });
    return;
  }

  if (
    NUMERIC_STATES.has(state.current_state) &&
    Number.isNaN(Number(effectiveInput))
  ) {
    const fallback = await generateFallbackReply({
      studentName: student.name,
      state: state.current_state,
      input: effectiveInput,
    });

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: fallback,
    });

    return;
  }

  await sendTextMessage({
    instanceName: input.instance,
    number: whatsapp,
    text: "Recebido. Fluxo principal em implementacao nesta etapa inicial do backend.",
  });
}
