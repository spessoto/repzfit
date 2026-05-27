import type { FastifyInstance } from "fastify";

import { supabaseAdmin } from "../config/supabase.js";
import { sendTextMessage } from "./evolution-service.js";
import {
  generateFallbackReply,
  generateBotResponse,
  COACH_SYSTEM_PROMPT,
} from "./gemini-service.js";
import { transcribeAudioFromUrl } from "./openai-service.js";

type IncomingMessage = {
  app: FastifyInstance;
  instance: string;
  remoteJid: string;
  inputText?: string;
  buttonId?: string;
  audioUrl?: string;
  messageTimestamp?: number;
};

type BotStateRow = {
  whatsapp_number: string;
  student_id: string;
  current_state: string;
  current_session_id: string | null;
  current_workout_exercise_id: string | null;
  current_set_number: number;
  last_input_attempt: string | null;
  rest_end_at: string | null;
};

type WorkoutExercise = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  muscle_group: string | null;
  equipment: string | null;
  description: string | null;
  target_sets: number;
  target_reps: number;
  target_weight: number | null;
  order_index: number;
  rest_seconds: number | null;
};

type AssignedWorkout = {
  id: string;
  name: string;
};

const NUMERIC_STATES = new Set(["COLLECTING_REPS", "COLLECTING_WEIGHT"]);

function isConfirmIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(1|sim|bora|come[cç]|start|yes|ok|vamos|quero|s\b)/.test(n);
}

function isCancelIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(2|n[aã]o|cancel|agora n)/.test(n);
}

function isSetDoneIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(feito|terminei|pronto|ok|sim|s|1|done|acabei|fiz|✅|conclu)/.test(
    n,
  );
}

function isStrictTrainingStartRequest(msg: string): boolean {
  const normalized = msg
    .toLowerCase()
    .trim()
    .replace(/[!?.;,]+/g, "")
    .replace(/\s+/g, " ");

  const allowed = new Set([
    "iniciar treino",
    "inicia treino",
    "comecar treino",
    "começar treino",
    "iniciar treinamento",
    "iniciar sessao",
    "iniciar sessão",
    "quero treinar",
    "bora treinar",
    "start treino",
    "start workout",
  ]);

  return allowed.has(normalized);
}

function formatExerciseDetails(ex: WorkoutExercise): string {
  const lines: string[] = [];
  if (ex.muscle_group) lines.push(`💪 Músculo: ${ex.muscle_group}`);
  if (ex.equipment) lines.push(`🏋️ Equipamento: ${ex.equipment}`);
  if (ex.description) lines.push(`📝 ${ex.description}`);
  const weight = ex.target_weight ? ` com ${ex.target_weight}kg` : "";
  lines.push(`📊 Meta: ${ex.target_sets}x${ex.target_reps}${weight}`);
  return lines.join("\n");
}

function normalizeWhatsapp(remoteJid: string): string {
  return remoteJid.replace(/@.*/, "");
}

async function safeCoachReply(
  app: FastifyInstance,
  userMessage: string,
  fallbackText: string,
): Promise<string> {
  try {
    return await generateBotResponse({
      systemPrompt: COACH_SYSTEM_PROMPT,
      userMessage,
    });
  } catch (error) {
    app.log.error(error, "Gemini unavailable, using static coach reply");
    return fallbackText;
  }
}

async function safeInputFallback(
  app: FastifyInstance,
  params: {
    studentName: string;
    currentState: string;
    userInput: string;
    expectedInput: string;
  },
): Promise<string> {
  try {
    return await generateFallbackReply(params);
  } catch (error) {
    app.log.error(error, "Gemini unavailable, using static input fallback");
    return `Não entendi muito bem. Me envie ${params.expectedInput} para continuar. 💪`;
  }
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
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt,rest_end_at",
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
    last_input_attempt: null,
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("bot_state")
    .insert(seed)
    .select(
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt,rest_end_at",
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

/**
 * Busca todos os treinos atribuídos ao aluno (sem filtrar por data)
 */
async function getStudentAssignedWorkouts(
  studentId: string,
): Promise<AssignedWorkout[]> {
  const { data, error } = await supabaseAdmin
    .from("student_workouts")
    .select("workout_id,workouts(id,name)")
    .eq("student_id", studentId);

  if (error) {
    throw error;
  }

  let workouts: AssignedWorkout[] = (data ?? [])
    .map((row: any) => {
      const workout = Array.isArray(row.workouts)
        ? row.workouts[0]
        : row.workouts;
      if (!workout?.id) return null;
      return {
        id: workout.id,
        name: workout.name ?? "Treino",
      };
    })
    .filter(Boolean) as AssignedWorkout[];

  // Fallback legado para bases antigas que ainda usam workouts.student_id
  if (workouts.length === 0) {
    const legacy = await supabaseAdmin
      .from("workouts")
      .select("id,name")
      .eq("student_id", studentId);

    if (legacy.error) {
      throw legacy.error;
    }

    workouts = (legacy.data ?? []).map((w: any) => ({
      id: w.id,
      name: w.name ?? "Treino",
    }));
  }

  // Dedupe por id para evitar duplicidade de vínculo
  const unique = new Map<string, AssignedWorkout>();
  for (const workout of workouts) {
    unique.set(workout.id, workout);
  }

  return Array.from(unique.values());
}

async function getLastCompletedWorkout(studentId: string): Promise<{
  workoutId: string;
  workoutName: string;
  date: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_sessions")
    .select("workout_id,date,workouts(name)")
    .eq("student_id", studentId)
    .eq("status", "completed")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.workout_id) {
    return null;
  }

  const workout = Array.isArray(data.workouts)
    ? data.workouts[0]
    : data.workouts;

  return {
    workoutId: data.workout_id,
    workoutName: workout?.name ?? "Treino",
    date: data.date,
  };
}

/**
 * Busca exercícios de um treino com detalhes
 */
async function getWorkoutExercises(
  workoutId: string,
): Promise<WorkoutExercise[]> {
  const { data, error } = await supabaseAdmin
    .from("workout_exercises")
    .select(
      `
      id,
      exercise_id,
      target_sets,
      target_reps,
      target_weight,
      order_index,
      rest_seconds,
      exercises (
        name,
        muscle_group,
        equipment,
        description
      )
    `,
    )
    .eq("workout_id", workoutId)
    .order("order_index", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((item: any) => ({
    id: item.id,
    exercise_id: item.exercise_id,
    exercise_name: item.exercises?.name ?? "Exercício",
    muscle_group: item.exercises?.muscle_group ?? null,
    equipment: item.exercises?.equipment ?? null,
    description: item.exercises?.description ?? null,
    target_sets: item.target_sets,
    target_reps: item.target_reps,
    target_weight: item.target_weight,
    order_index: item.order_index,
    rest_seconds: item.rest_seconds ?? null,
  }));
}

/**
 * Cria uma nova sessão de treino
 */
async function createDailySession(studentId: string, workoutId: string) {
  const { data, error } = await supabaseAdmin
    .from("daily_sessions")
    .insert({
      student_id: studentId,
      workout_id: workoutId,
      status: "started",
      date: new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation: an active session already exists for this student.
    // Can happen on duplicate webhook delivery — reuse the existing session instead.
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from("daily_sessions")
        .select("id")
        .eq("student_id", studentId)
        .eq("status", "started")
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (existing) return existing.id as string;
    }
    throw error;
  }

  return data.id;
}

/**
 * Salva um set executado pelo aluno
 */
async function saveSetLog(params: {
  sessionId: string;
  workoutExerciseId: string;
  setNumber: number;
  repsDone: number;
  weightUsed: number;
  rpeScore: number;
}) {
  const { error } = await supabaseAdmin.from("set_logs").insert({
    session_id: params.sessionId,
    workout_exercise_id: params.workoutExerciseId,
    set_number: params.setNumber,
    reps_done: params.repsDone,
    weight_used: params.weightUsed,
    rpe_score: params.rpeScore,
  });

  if (error) {
    // Duplicate set log (same set retried on webhook replay) — skip silently
    if (error.code === "23505") return;
    throw error;
  }
}

/**
 * Busca todos os sets de uma sessão e monta o extrato de treino
 */
async function buildWorkoutSummary(sessionId: string): Promise<string> {
  const { data: logs, error } = await supabaseAdmin
    .from("set_logs")
    .select(
      `
      set_number,
      reps_done,
      weight_used,
      rpe_score,
      workout_exercise_id,
      workout_exercises (
        order_index,
        exercises ( name )
      )
    `,
    )
    .eq("session_id", sessionId)
    .order("set_number", { ascending: true });

  if (error || !logs || logs.length === 0) return "";

  // Agrupar sets por exercício
  const exerciseMap = new Map<
    string,
    { name: string; order: number; sets: typeof logs }
  >();
  for (const log of logs) {
    const we = log.workout_exercises as any;
    const name = we?.exercises?.name ?? "Exercício";
    const order = we?.order_index ?? 0;
    if (!exerciseMap.has(log.workout_exercise_id)) {
      exerciseMap.set(log.workout_exercise_id, { name, order, sets: [] });
    }
    exerciseMap.get(log.workout_exercise_id)!.sets.push(log);
  }

  const sorted = Array.from(exerciseMap.values()).sort(
    (a, b) => a.order - b.order,
  );

  const today = new Date().toLocaleDateString("pt-BR");
  const lines: string[] = [`📊 *EXTRATO DO TREINO — ${today}*`, ""];

  sorted.forEach((ex, i) => {
    lines.push(`*${i + 1}. ${ex.name}*`);
    for (const s of ex.sets as any[]) {
      lines.push(
        `   Série ${s.set_number}: ${s.reps_done} reps × ${s.weight_used}kg | RPE ${s.rpe_score}`,
      );
    }
    lines.push("");
  });

  const totalSets = logs.length;
  const totalExercises = sorted.length;
  lines.push(
    `✅ ${totalExercises} exercício${
      totalExercises !== 1 ? "s" : ""
    } | ${totalSets} série${totalSets !== 1 ? "s" : ""} completadas`,
  );

  return lines.join("\n").trimEnd();
}

/**
 * Marca sessão como concluída e salva o extrato
 */
async function completeSession(sessionId: string, summary?: string) {
  const patch: Record<string, unknown> = {
    status: "completed",
    updated_at: new Date().toISOString(),
  };
  if (summary) patch.summary = summary;

  const { error } = await supabaseAdmin
    .from("daily_sessions")
    .update(patch)
    .eq("id", sessionId);

  if (error) {
    throw error;
  }
}

export async function processIncomingMessage(input: IncomingMessage) {
  const whatsapp = normalizeWhatsapp(input.remoteJid);

  // 1. Transcrever áudio se necessário
  let text = input.inputText?.trim() ?? "";
  if (!text && input.audioUrl) {
    try {
      text = (await transcribeAudioFromUrl(input.audioUrl)).trim();
    } catch (error) {
      input.app.log.error(error, "Audio transcription failed");
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Não consegui entender o áudio. Pode repetir em texto? 🎤",
      });
      return;
    }
  }

  const effectiveInput = input.buttonId ?? text;

  if (!effectiveInput) {
    return;
  }

  // Comando global: "parar" encerra qualquer sessão ativa
  if (/^parar$/i.test(effectiveInput.trim())) {
    const student = await getStudentByWhatsapp(whatsapp);
    if (student) {
      const state = await getOrCreateState(whatsapp, student.id);
      if (state.current_state !== "IDLE") {
        await updateState(whatsapp, {
          current_state: "IDLE",
          current_session_id: null,
          current_workout_exercise_id: null,
          current_set_number: 1,
          last_input_attempt: null,
        });
      }
    }
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Bot pausado. Quando quiser retomar, é só mandar *iniciar treino*! 💪",
    });
    return;
  }

  // 2. Verificar se é uma mensagem de início de treino — apenas no estado IDLE
  if (isStrictTrainingStartRequest(effectiveInput)) {
    const student = await getStudentByWhatsapp(whatsapp);

    if (!student) {
      const response = await safeCoachReply(
        input.app,
        `O usuário tentou iniciar um treino mas não está cadastrado no sistema. Explique de forma amigável e breve (2 linhas) que ele precisa ser cadastrado pelo personal trainer antes de usar o sistema.`,
        "Você ainda não está cadastrado no sistema. Peça ao seu personal para concluir seu cadastro e eu te ajudo a iniciar o treino! 💪",
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: response,
      });
      return;
    }

    const currentState = await getOrCreateState(whatsapp, student.id);
    if (currentState.current_state !== "IDLE") {
      if (
        currentState.current_state !== "AWAITING_TRAINING_START" &&
        currentState.current_state !== "AWAITING_WORKOUT_SELECTION"
      ) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Você já tem um treino em andamento! Responda a pergunta anterior ou envie *parar* para encerrar. 💪",
        });
        return;
      }
    } else {
      const workouts = await getStudentAssignedWorkouts(student.id);

      if (!workouts.length) {
        const response = await safeCoachReply(
          input.app,
          `O aluno ${student.name} quer treinar mas não tem treino atribuído. Responda de forma motivadora mas explique que ele precisa falar com o personal para atribuir um treino.`,
          "Não encontrei treino atribuído para você agora. Fala com seu personal que eu te ajudo assim que ele liberar! 🔥",
        );

        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: response,
        });
        return;
      }

      if (workouts.length === 1) {
        const workout = workouts[0];
        const welcomeMessage = await safeCoachReply(
          input.app,
          `Saude o aluno ${student.name} de forma animada (1 linha) e pergunte se ele está pronto para começar o treino "${workout.name}". Seja breve e motivador.`,
          `Bora, ${student.name}! Pronto para começar o treino "${workout.name}"? 💪`,
        );

        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `${welcomeMessage}\n\nResponda:\n1️⃣ *Sim, bora!*\n2️⃣ Agora não`,
        });

        await updateState(whatsapp, {
          current_state: "AWAITING_TRAINING_START",
          last_input_attempt: `selected_workout:${workout.id}`,
        });
        return;
      }

      const lastWorkout = await getLastCompletedWorkout(student.id);
      const optionsText = workouts
        .map((workout, index) => `${index + 1}️⃣ *${workout.name}*`)
        .join("\n");

      const lastText = lastWorkout
        ? `\n\nÚltimo treino executado: *${lastWorkout.workoutName}* (${new Date(lastWorkout.date + "T00:00:00").toLocaleDateString("pt-BR")})`
        : "\n\nAinda não encontrei treino executado anteriormente.";

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `Você tem mais de um treino cadastrado. Qual você quer fazer hoje?\n\n${optionsText}${lastText}\n\nResponda com o *número* do treino.`,
      });

      await updateState(whatsapp, {
        current_state: "AWAITING_WORKOUT_SELECTION",
        last_input_attempt: `workout_options:${workouts
          .map((workout) => workout.id)
          .join("|")}`,
      });
      return;
    }
  }

  // 3. A partir daqui, precisa estar cadastrado
  const student = await getStudentByWhatsapp(whatsapp);

  if (!student) {
    input.app.log.info({ whatsapp }, "Unknown student, ignoring message");
    return;
  }

  const state = await getOrCreateState(whatsapp, student.id);

  // === FLUXO DE ESTADOS ===

  // Estado: AWAITING_WORKOUT_SELECTION
  if (state.current_state === "AWAITING_WORKOUT_SELECTION") {
    if (isCancelIntent(effectiveInput)) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Sem problemas! Quando quiser treinar, é só me chamar! 💪",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        last_input_attempt: null,
      });
      return;
    }

    const optionsRaw = state.last_input_attempt?.startsWith("workout_options:")
      ? state.last_input_attempt.replace("workout_options:", "")
      : "";
    const optionIds = optionsRaw
      .split("|")
      .map((id) => id.trim())
      .filter(Boolean);

    const selectedNumber = parseInt(effectiveInput.trim(), 10);
    if (
      Number.isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > optionIds.length
    ) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `Me responde com o número do treino (1 a ${optionIds.length}).`,
      });
      return;
    }

    const selectedWorkoutId = optionIds[selectedNumber - 1];
    const workouts = await getStudentAssignedWorkouts(student.id);
    const selectedWorkout = workouts.find(
      (workout) => workout.id === selectedWorkoutId,
    );

    if (!selectedWorkout) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Esse treino não está mais disponível. Me manda *iniciar treino* para listar novamente.",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        last_input_attempt: null,
      });
      return;
    }

    const welcomeMessage = await safeCoachReply(
      input.app,
      `Saude o aluno ${student.name} de forma animada (1 linha) e pergunte se ele está pronto para começar o treino "${selectedWorkout.name}". Seja breve e motivador.`,
      `Bora, ${student.name}! Pronto para começar o treino "${selectedWorkout.name}"? 💪`,
    );

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: `${welcomeMessage}\n\nResponda:\n1️⃣ *Sim, bora!*\n2️⃣ Agora não`,
    });

    await updateState(whatsapp, {
      current_state: "AWAITING_TRAINING_START",
      last_input_attempt: `selected_workout:${selectedWorkout.id}`,
    });
    return;
  }

  // Estado: AWAITING_TRAINING_START
  if (state.current_state === "AWAITING_TRAINING_START") {
    if (isConfirmIntent(effectiveInput)) {
      const selectedWorkoutId = state.last_input_attempt?.startsWith(
        "selected_workout:",
      )
        ? state.last_input_attempt.replace("selected_workout:", "")
        : null;

      const workouts = await getStudentAssignedWorkouts(student.id);
      const workout = selectedWorkoutId
        ? (workouts.find((w) => w.id === selectedWorkoutId) ?? null)
        : (workouts[0] ?? null);

      if (!workout) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Ops! Parece que não há treino disponível agora. Fale com seu personal! 😅",
        });
        await updateState(whatsapp, {
          current_state: "IDLE",
          last_input_attempt: null,
        });
        return;
      }

      // Criar sessão de treino
      const sessionId = await createDailySession(student.id, workout.id);

      // Buscar exercícios do treino
      const exercises = await getWorkoutExercises(workout.id);

      if (exercises.length === 0) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Esse treino não tem exercícios cadastrados ainda. Avise seu personal! 📋",
        });
        await updateState(whatsapp, {
          current_state: "IDLE",
          current_session_id: null,
        });
        return;
      }

      // Listar primeiro exercício
      const firstExercise = exercises[0];

      // Persist state BEFORE sending to avoid sending twice if send succeeds
      // but state update fails (webhook retry would then re-create a second session).
      await updateState(whatsapp, {
        current_state: "EXECUTING_SET",
        current_session_id: sessionId,
        current_workout_exercise_id: firstExercise.id,
        current_set_number: 1,
        last_input_attempt: null,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🔥 Sessão iniciada!\n\n*${firstExercise.exercise_name}*\n${formatExerciseDetails(firstExercise)}\n\nVamos começar a primeira série! Quando terminar, me manda *feito* ✅`,
      });
      return;
    }

    if (isCancelIntent(effectiveInput)) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Sem problemas! Quando quiser treinar, é só me chamar! 💪",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        last_input_attempt: null,
      });
      return;
    }
  }

  // Estado: EXECUTING_SET
  if (state.current_state === "EXECUTING_SET") {
    if (isSetDoneIntent(effectiveInput)) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "🔥 Boa! Quantas repetições você conseguiu fazer?",
      });

      await updateState(whatsapp, { current_state: "COLLECTING_REPS" });
      return;
    }
  }

  // Estado: RESTING — aluno enviou mensagem durante o descanso
  if (state.current_state === "RESTING") {
    const restEndAt = state.rest_end_at;
    const remaining = restEndAt
      ? Math.ceil((new Date(restEndAt).getTime() - Date.now()) / 1000)
      : 0;

    if (remaining > 0) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `⏱ Você está em descanso! Ainda restam ~${remaining}s. Vou te avisar quando acabar! 💪`,
      });
    } else {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `⏱ Seu descanso acabou agora! Aguarda um instante, já te envio a próxima série! 💪`,
      });
    }
    return;
  }

  // Estado: COLLECTING_REPS
  if (state.current_state === "COLLECTING_REPS") {
    const reps = parseInt(effectiveInput, 10);

    if (Number.isNaN(reps) || reps <= 0 || reps > 1000) {
      const fallback = await safeInputFallback(input.app, {
        studentName: student.name,
        currentState: "COLLECTING_REPS",
        userInput: effectiveInput,
        expectedInput: "número de repetições (ex: 12)",
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: fallback,
      });
      return;
    }

    // Salvar temporariamente e pedir peso
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: `${reps} repetições, show! 💪\n\nAgora me diz: qual carga você usou? (em kg)`,
    });

    await updateState(whatsapp, {
      current_state: "COLLECTING_WEIGHT",
      last_input_attempt: String(reps), // Guardar reps temporariamente
    });
    return;
  }

  // Estado: COLLECTING_WEIGHT
  if (state.current_state === "COLLECTING_WEIGHT") {
    const weight = parseFloat(effectiveInput.replace(",", "."));

    if (Number.isNaN(weight) || weight < 0 || weight > 1000) {
      const fallback = await safeInputFallback(input.app, {
        studentName: student.name,
        currentState: "COLLECTING_WEIGHT",
        userInput: effectiveInput,
        expectedInput: "carga em kg (ex: 20 ou 20.5)",
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: fallback,
      });
      return;
    }

    // Pedir RPE
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Perfeito! Agora me diz: qual foi a dificuldade?\n\nResponda com um número de *6 a 10*:\n6 - Fácil\n7 - Tranquilo\n8 - Moderado\n9 - Difícil\n10 - Máximo 🔥",
    });

    await updateState(whatsapp, {
      current_state: "COLLECTING_RPE",
      last_input_attempt: `${state.last_input_attempt}|${weight}`, // reps|weight
    });
    return;
  }

  // Estado: COLLECTING_RPE
  if (state.current_state === "COLLECTING_RPE") {
    const rpe = parseInt(effectiveInput.trim(), 10);

    if (Number.isNaN(rpe) || rpe < 1 || rpe > 10) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Me manda um número de 6 a 10 para registrar a dificuldade! 😊",
      });
      return;
    }

    // Recuperar reps e weight
    const [repsStr, weightStr] = (state.last_input_attempt ?? "0|0").split("|");
    const reps = parseInt(repsStr, 10);
    const weight = parseFloat(weightStr);

    // Salvar set_log
    if (state.current_session_id && state.current_workout_exercise_id) {
      await saveSetLog({
        sessionId: state.current_session_id,
        workoutExerciseId: state.current_workout_exercise_id,
        setNumber: state.current_set_number,
        repsDone: reps,
        weightUsed: weight,
        rpeScore: rpe,
      });
    }

    // Verificar se precisa fazer mais séries
    const exerciseResult = await supabaseAdmin
      .from("workout_exercises")
      .select("target_sets,exercise_id,rest_seconds,exercises(name)")
      .eq("id", state.current_workout_exercise_id!)
      .single();

    if (exerciseResult.data) {
      const targetSets = exerciseResult.data.target_sets;
      const exerciseName = Array.isArray(exerciseResult.data.exercises)
        ? exerciseResult.data.exercises[0]?.name
        : ((exerciseResult.data.exercises as any)?.name ?? "Exercício");
      const restSeconds: number | null =
        (exerciseResult.data as any).rest_seconds ?? null;
      const nextSet = state.current_set_number + 1;

      if (nextSet <= targetSets) {
        // Ainda tem séries para fazer
        if (restSeconds && restSeconds > 0) {
          const restEndAt = new Date(
            Date.now() + restSeconds * 1000,
          ).toISOString();

          await updateState(whatsapp, {
            current_state: "RESTING",
            rest_end_at: restEndAt,
            last_input_attempt: `rest:next_set:${nextSet}`,
          });

          await sendTextMessage({
            instanceName: input.instance,
            number: whatsapp,
            text: `🔥 Série ${state.current_set_number}/${targetSets} concluída! Boa!\n\n⏱ Iniciando descanso de *${restSeconds}s*. Vou te avisar quando acabar! 💪`,
          });
        } else {
          await sendTextMessage({
            instanceName: input.instance,
            number: whatsapp,
            text: `🔥 Série ${state.current_set_number}/${targetSets} concluída!\n\nDescanso e vamos para a próxima! Quando terminar a série ${nextSet}, me manda *feito* ✅`,
          });

          await updateState(whatsapp, {
            current_state: "EXECUTING_SET",
            current_set_number: nextSet,
            last_input_attempt: null,
          });
        }
        return;
      }

      // Exercício completo! Buscar próximo exercício
      const allExercises = await getWorkoutExercises(
        (
          await supabaseAdmin
            .from("daily_sessions")
            .select("workout_id")
            .eq("id", state.current_session_id!)
            .single()
        ).data!.workout_id,
      );

      const currentIndex = allExercises.findIndex(
        (ex) => ex.id === state.current_workout_exercise_id,
      );
      const nextExercise = allExercises[currentIndex + 1];

      if (nextExercise) {
        // Próximo exercício
        if (restSeconds && restSeconds > 0) {
          const restEndAt = new Date(
            Date.now() + restSeconds * 1000,
          ).toISOString();

          await updateState(whatsapp, {
            current_state: "RESTING",
            rest_end_at: restEndAt,
            last_input_attempt: `rest:next_exercise:${nextExercise.id}`,
          });

          await sendTextMessage({
            instanceName: input.instance,
            number: whatsapp,
            text: `✅ ${exerciseName} concluído!\n\n⏱ Iniciando descanso de *${restSeconds}s*. Vou te avisar quando acabar! 💪`,
          });
        } else {
          await sendTextMessage({
            instanceName: input.instance,
            number: whatsapp,
            text: `✅ ${exerciseName} concluído!\n\n🔸 Próximo: *${nextExercise.exercise_name}*\n${formatExerciseDetails(nextExercise)}\n\nQuando estiver pronto, me manda *feito* ✅`,
          });

          await updateState(whatsapp, {
            current_state: "EXECUTING_SET",
            current_workout_exercise_id: nextExercise.id,
            current_set_number: 1,
            last_input_attempt: null,
          });
        }
        return;
      }

      // Treino completo!
      let workoutSummary = "";
      if (state.current_session_id) {
        try {
          workoutSummary = await buildWorkoutSummary(state.current_session_id);
        } catch (err) {
          input.app.log.error(err, "Failed to build workout summary");
        }
        await completeSession(
          state.current_session_id,
          workoutSummary || undefined,
        );
      }

      const congratsMessage = await safeCoachReply(
        input.app,
        `O aluno ${student.name} acabou de completar o treino! Parabenize de forma entusiasmada e motivadora (2-3 linhas). Celebre a conquista!`,
        "Parabéns! Treino concluído com sucesso. Você mandou muito bem hoje! 🔥💪",
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🎉 TREINO CONCLUÍDO!\n\n${congratsMessage}`,
      });

      if (workoutSummary) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: workoutSummary,
        });
      }

      await updateState(whatsapp, {
        current_state: "IDLE",
        current_session_id: null,
        current_workout_exercise_id: null,
        current_set_number: 1,
        last_input_attempt: null,
      });
      return;
    }
  }

  // Mensagens fora dos fluxos esperados são ignoradas para evitar disparos indevidos.
  return;
}

/**
 * Dispara timers de descanso vencidos.
 * Chamado pelo pg_cron a cada minuto via pg_net.
 * Retorna a quantidade de timers processados.
 */
export async function processExpiredRestTimers(
  app: FastifyInstance,
): Promise<number> {
  const { data: expiredStates, error } = await supabaseAdmin
    .from("bot_state")
    .select(
      "whatsapp_number,student_id,current_set_number,current_workout_exercise_id,current_session_id,last_input_attempt,rest_end_at",
    )
    .eq("current_state", "RESTING")
    .lte("rest_end_at", new Date().toISOString());

  if (error) {
    app.log.error(error, "processExpiredRestTimers: query failed");
    return 0;
  }

  if (!expiredStates || expiredStates.length === 0) return 0;

  let processed = 0;

  for (const raw of expiredStates) {
    const state = raw as BotStateRow;
    try {
      // Resolver instância: bot_state.student_id → students.personal_id → personals.evolution_instance_name
      const { data: studentRow } = await supabaseAdmin
        .from("students")
        .select("personal_id,name")
        .eq("id", state.student_id)
        .single();

      if (!studentRow) continue;

      const { data: personalRow } = await supabaseAdmin
        .from("personals")
        .select("evolution_instance_name")
        .eq("id", studentRow.personal_id)
        .single();

      if (!personalRow?.evolution_instance_name) continue;

      const instanceName = personalRow.evolution_instance_name as string;
      const hint = state.last_input_attempt ?? "";

      if (hint.startsWith("rest:next_set:")) {
        const nextSet = parseInt(hint.replace("rest:next_set:", ""), 10);

        const { data: exRow } = await supabaseAdmin
          .from("workout_exercises")
          .select("target_sets,exercises(name)")
          .eq("id", state.current_workout_exercise_id!)
          .single();

        const exerciseName = Array.isArray((exRow as any)?.exercises)
          ? (exRow as any).exercises[0]?.name
          : ((exRow as any)?.exercises?.name ?? "Exercício");
        const targetSets = (exRow as any)?.target_sets ?? nextSet;

        // Atualizar estado ANTES de enviar a mensagem
        await updateState(state.whatsapp_number, {
          current_state: "EXECUTING_SET",
          current_set_number: nextSet,
          rest_end_at: null,
          last_input_attempt: null,
        });

        await sendTextMessage({
          instanceName,
          number: state.whatsapp_number,
          text: `✅ Fim do descanso! Vamos lá? 💪\n\n*${exerciseName}* — Série ${nextSet}/${targetSets}\nQuando terminar, me manda *feito* ✅`,
        });

        processed++;
      } else if (hint.startsWith("rest:next_exercise:")) {
        const nextExerciseId = hint.replace("rest:next_exercise:", "");

        const { data: exRow } = await supabaseAdmin
          .from("workout_exercises")
          .select(
            "target_sets,target_reps,target_weight,order_index,exercise_id,exercises(name,muscle_group,equipment,description)",
          )
          .eq("id", nextExerciseId)
          .single();

        if (!exRow) continue;

        const ex = exRow as any;
        const exercise = Array.isArray(ex.exercises)
          ? ex.exercises[0]
          : ex.exercises;

        const nextExercise: WorkoutExercise = {
          id: nextExerciseId,
          exercise_id: ex.exercise_id,
          exercise_name: exercise?.name ?? "Exercício",
          muscle_group: exercise?.muscle_group ?? null,
          equipment: exercise?.equipment ?? null,
          description: exercise?.description ?? null,
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_weight: ex.target_weight ?? null,
          order_index: ex.order_index,
          rest_seconds: null,
        };

        // Atualizar estado ANTES de enviar a mensagem
        await updateState(state.whatsapp_number, {
          current_state: "EXECUTING_SET",
          current_workout_exercise_id: nextExerciseId,
          current_set_number: 1,
          rest_end_at: null,
          last_input_attempt: null,
        });

        await sendTextMessage({
          instanceName,
          number: state.whatsapp_number,
          text: `✅ Fim do descanso! Próximo exercício:\n\n*${nextExercise.exercise_name}*\n${formatExerciseDetails(nextExercise)}\n\nQuando estiver pronto para a 1ª série, me manda *feito* ✅`,
        });

        processed++;
      }
    } catch (err) {
      app.log.error(
        err,
        `processExpiredRestTimers: failed for ${state.whatsapp_number}`,
      );
    }
  }

  return processed;
}
