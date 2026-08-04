import type { FastifyInstance } from "fastify";

import { supabaseAdmin } from "../config/supabase.js";
import { normalizeBrazilWhatsappNumber } from "../utils/whatsapp.js";
import {
  encrypt,
  decrypt,
  encryptNumber,
  decryptNumber,
  hmacHash,
} from "../utils/encryption.js";
import {
  getUnifiedEvolutionInstanceName,
  sendTextMessage,
} from "./evolution-service.js";
import {
  generateFallbackReply,
  generateBotResponse,
  COACH_SYSTEM_PROMPT,
} from "./gemini-service.js";
import { transcribeAudioFromUrl } from "./openai-service.js";
import { resolvePersonalWhatsAppNumber } from "./personal-contact.js";

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
  last_activity_at: string | null;
};

type WorkoutExercise = {
  id: string;
  exercise_id: string | null;
  exercise_catalog_id?: string | null;
  exercise_variation_id?: string | null;
  equipment_id?: string | null;
  grip_footing_id?: string | null;
  method_id?: string | null;
  exercise_name: string;
  variation_name?: string | null;
  muscle_group: string | null;
  equipment: string | null;
  equipment_name?: string | null;
  grip_footing_name?: string | null;
  method_name?: string | null;
  description: string | null;
  custom_description: string | null;
  target_sets: number;
  target_reps: number;
  target_weight: number | null;
  order_index: number;
  rest_seconds: number | null;
  biset_group_id?: string | null;
};

type AssignedWorkout = {
  id: string;
  name: string;
};

type BotAnomalySeverity = "info" | "warn" | "error";

type BotAnomalyInput = {
  severity?: BotAnomalySeverity;
  category: string;
  code: string;
  message: string;
  whatsapp_number?: string | null;
  student_id?: string | null;
  session_id?: string | null;
  current_state?: string | null;
  input_excerpt?: string | null;
  context?: Record<string, unknown>;
};

let botAnomalyLogTableUnavailable = false;

export function buildSetRestTransitionMessage(params: {
  currentSet: number;
  targetSets: number;
  restSeconds?: number | null;
  remainingSeconds?: number | null;
  state: "started" | "already_started" | "expired" | "no_rest";
}): string {
  const base = `🔥 Série ${params.currentSet}/${params.targetSets} concluída!`;

  if (params.state === "already_started") {
    const remaining = params.remainingSeconds ?? 0;
    return `${base}\n\n⏱ Descanso em andamento: faltam ~*${remaining}s*. Quando terminar, seguimos para a próxima repetição.`;
  }

  if (params.state === "expired") {
    return `${base}\n\n✅ Descanso encerrado. Bora pra próxima repetição.`;
  }

  if (params.state === "no_rest") {
    return `${base}\n\nBora pra próxima repetição.`;
  }

  if (params.restSeconds && params.restSeconds > 0) {
    return `${base}\n\n⏱ Descanso iniciado: *${params.restSeconds}s*. Quando terminar, seguimos para a próxima repetição.`;
  }

  return `${base}\n\nVamos para a próxima repetição.`;
}

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
  return /^(feito|terminei|pronto|ok|sim|s|1|done|acabei|fiz|✅|conclu|bora|boa|vlw|valeu|foi|top|show|beleza|ótimo|otimo|👍|💪|🔥|yes|yep|claro|pode|vamo|vamos|já|ja)/.test(
    n,
  );
}

function isTrainingDoneIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(encerrar|encerra|encerro|encerr[aei] treino|finali[zs]ar|finali[zs]a treino|finali[zs]ei|terminei o treino|acabei o treino|treino finalizado|treino concluido|treino concluído|fim do treino)/.test(
    n,
  );
}

function isPauseTrainingIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(parar|para|pausar|pausa|pause|interromper|interrompe|dar um tempo)$/.test(
    n,
  );
}

function isStrictTrainingStartRequest(msg: string): boolean {
  const normalized = msg
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
    "treinar",
    "treina",
    "vamo treina",
    "vamo treinar",
    "vamos treina",
    "vamos treinar",
    "bora treina",
    "bora treinar",
    "partiu treina",
    "partiu treinar",
    "partiu treino",
    "start",
    "start treino",
    "start workout",
  ]);

  return allowed.has(normalized);
}

async function isTrainingStartIntent(
  app: FastifyInstance,
  msg: string,
): Promise<boolean> {
  const normalized = msg
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[!?.;,]+/g, " ")
    .replace(/\s+/g, " ");
  const auditMessage = normalized.slice(0, 120);

  if (isStrictTrainingStartRequest(msg)) {
    app.log.info(
      { source: "strict", decision: true, message: auditMessage },
      "training start intent classified",
    );
    return true;
  }

  const hasNegation = /\b(nao|não|n|agora nao|agora não|depois)\b/.test(
    normalized,
  );
  const hasTrainingVerb =
    /\b(treina|treinar|treino|malhar|workout|academia|exercicio|exercitar)\b/.test(
      normalized,
    ) || /\b(start)\b/.test(normalized);
  const hasStartCue =
    /\b(vamo|vamos|bora|partiu|quero|iniciar|inicia|comecar|comecar|start|hoje)\b/.test(
      normalized,
    ) || /^(treinar|treina|start)$/.test(normalized);

  const heuristicStart = hasTrainingVerb && hasStartCue && !hasNegation;
  if (heuristicStart) {
    app.log.info(
      {
        source: "heuristic",
        decision: true,
        message: auditMessage,
        hasTrainingVerb,
        hasStartCue,
        hasNegation,
      },
      "training start intent classified",
    );
    return true;
  }

  if (!hasTrainingVerb) {
    app.log.info(
      { source: "no-training-signal", decision: false, message: auditMessage },
      "training start intent classified",
    );
    return false;
  }

  try {
    const verdict = await generateBotResponse({
      systemPrompt:
        "Você é um classificador de intenção para um bot de treino. Responda APENAS com START ou OTHER.",
      userMessage: `Mensagem do aluno: "${msg}"\n\nRetorne START se a intenção principal for iniciar treino agora. Caso contrário, OTHER.`,
    });

    const parsed = verdict.trim().toUpperCase();
    const aiDecision = parsed.startsWith("START") || parsed.startsWith("SIM");
    app.log.info(
      {
        source: "ai",
        decision: aiDecision,
        message: auditMessage,
        aiVerdict: parsed.slice(0, 24),
      },
      "training start intent classified",
    );
    return aiDecision;
  } catch (error) {
    app.log.warn(
      error,
      "AI start-intent classifier unavailable; using fallback",
    );
    app.log.info(
      {
        source: "fallback",
        decision: heuristicStart,
        message: auditMessage,
        hasTrainingVerb,
        hasStartCue,
        hasNegation,
      },
      "training start intent classified",
    );
    return heuristicStart;
  }
}

function formatExerciseDetails(ex: WorkoutExercise): string {
  const lines: string[] = [];
  if (ex.muscle_group) lines.push(`💪 Músculo: ${ex.muscle_group}`);
  if (ex.variation_name) lines.push(`🎯 Execução: ${ex.variation_name}`);
  if (ex.equipment_name || ex.equipment)
    lines.push(`🏋️ Equipamento: ${ex.equipment_name ?? ex.equipment}`);
  if (ex.grip_footing_name)
    lines.push(`🤲 Pegada/Pisada: ${ex.grip_footing_name}`);
  if (ex.method_name) lines.push(`🧩 Método: ${ex.method_name}`);
  if (ex.description) lines.push(`📝 ${ex.description}`);
  const weight = ex.target_weight ? ` com ${ex.target_weight}kg` : "";
  lines.push(`📊 Meta: ${ex.target_sets}x${ex.target_reps}${weight}`);
  if (ex.rest_seconds && ex.rest_seconds > 0)
    lines.push(`⏱ Descanso: ${ex.rest_seconds}s`);
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

function buildFriendlyStartPrompt(studentName: string): string {
  return `Oi ${studentName}! Tudo bem? 💪\n\nQuer começar seu treino agora?\n1️⃣ *Sim, bora treinar!*\n2️⃣ *Deixar para depois*`;
}

async function promptWorkoutSelection(params: {
  app: FastifyInstance;
  instanceName: string;
  whatsapp: string;
  student: { id: string; name: string };
  includeGreeting?: boolean;
  introText?: string;
}) {
  const workouts = await getStudentAssignedWorkouts(params.student.id);

  if (!workouts.length) {
    await logBotAnomaly(params.app, {
      severity: "warn",
      category: "configuration",
      code: "student_without_assigned_workout_on_start",
      message: "Aluno tentou iniciar treino mas não possui treino atribuído.",
      whatsapp_number: params.whatsapp,
      student_id: params.student.id,
      current_state: "IDLE",
    });

    const response = await safeCoachReply(
      params.app,
      `O aluno ${params.student.name} quer treinar mas não tem treino atribuído. Responda de forma motivadora mas explique que ele precisa falar com o personal para atribuir um treino.`,
      "Não encontrei treino atribuído para você agora. Fala com seu personal que eu te ajudo assim que ele liberar! 🔥",
    );

    await sendTextMessage({
      instanceName: params.instanceName,
      number: params.whatsapp,
      text: response,
    });

    await updateState(params.whatsapp, {
      current_state: "IDLE",
      last_input_attempt: null,
    });
    return;
  }

  const optionsText = workouts
    .map((workout, index) => `${index + 1}️⃣ *${workout.name}*`)
    .join("\n");

  const lastWorkout = await getLastCompletedWorkout(params.student.id);
  const lastText = lastWorkout
    ? `\n\nÚltimo treino executado: *${lastWorkout.workoutName}* (${new Date(lastWorkout.date + "T00:00:00").toLocaleDateString("pt-BR")})`
    : "";

  let greeting = "";
  if (params.includeGreeting) {
    greeting = await safeCoachReply(
      params.app,
      `Cumprimente o aluno ${params.student.name} em 1 linha, com tom motivador e direto, sem enrolação.`,
      `Fala, ${params.student.name}! Bora treinar hoje? 💪`,
    );
  }

  const intro =
    params.introText ??
    "Você tem estes treinos cadastrados. Qual deles você quer iniciar?";

  const parts = [
    greeting,
    intro,
    `${optionsText}${lastText}`,
    "Responda com o *número* do treino.",
  ].filter(Boolean);

  await sendTextMessage({
    instanceName: params.instanceName,
    number: params.whatsapp,
    text: parts.join("\n\n"),
  });

  await updateState(params.whatsapp, {
    current_state: "AWAITING_WORKOUT_SELECTION",
    last_input_attempt: `workout_options:${workouts
      .map((workout) => workout.id)
      .join("|")}`,
  });
}

function toInputExcerpt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 220);
}

async function logBotAnomaly(app: FastifyInstance, input: BotAnomalyInput) {
  if (botAnomalyLogTableUnavailable) {
    return;
  }

  const severity = input.severity ?? "warn";
  const payload = {
    severity,
    category: input.category,
    code: input.code,
    message: input.message,                                           // texto hardcoded do sistema — não criptografar
    whatsapp_number: input.whatsapp_number ?? null,
    student_id: input.student_id ?? null,
    session_id: input.session_id ?? null,
    current_state: input.current_state ?? null,
    input_excerpt: encrypt(toInputExcerpt(input.input_excerpt ?? null)), // texto livre do aluno — criptografar
    context: input.context ?? {},
  };

  try {
    const { error } = await supabaseAdmin.from("bot_anomaly_logs").insert(payload);
    if (error) {
      if (
        String(error.message || "")
          .toLowerCase()
          .includes("relation") &&
        String(error.message || "")
          .toLowerCase()
          .includes("bot_anomaly_logs")
      ) {
        botAnomalyLogTableUnavailable = true;
        app.log.warn(
          "bot_anomaly_logs table not found; anomaly persistence disabled until migration is applied",
        );
        return;
      }

      app.log.error({ error, payload }, "failed to persist bot anomaly log");
      return;
    }
  } catch (error) {
    app.log.error({ error, payload }, "unexpected error while persisting bot anomaly log");
    return;
  }

  if (severity === "error") {
    app.log.error({ anomaly: payload }, "bot anomaly recorded");
  } else if (severity === "info") {
    app.log.info({ anomaly: payload }, "bot anomaly recorded");
  } else {
    app.log.warn({ anomaly: payload }, "bot anomaly recorded");
  }
}

async function getStudentByWhatsapp(whatsapp: string) {
  // Fase 3: usar whatsapp_hash para lookup (evita comparação de texto criptografado)
  const hash = hmacHash(whatsapp);
  let data: any = null;
  let error: any = null;

  if (hash) {
    // Busca via hash determinístico quando FIELD_HMAC_SECRET está configurado
    const result = await supabaseAdmin
      .from("students")
      .select("id,name,personal_id,whatsapp_number,is_active,personals!inner(id)")
      .eq("whatsapp_hash", hash)
      .eq("is_active", true)
      .maybeSingle();
    data = result.data;
    error = result.error;
  } else {
    // Fallback: busca plaintext (antes da migração de dados ou sem chave HMAC)
    const result = await supabaseAdmin
      .from("students")
      .select("id,name,personal_id,whatsapp_number,is_active,personals!inner(id)")
      .eq("whatsapp_number", whatsapp)
      .eq("is_active", true)
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  if (error) {
    throw error;
  }

  if (data) {
    data = {
      ...data,
      name: decrypt(data.name) ?? data.name,
      whatsapp_number: decrypt(data.whatsapp_number) ?? data.whatsapp_number,
    };
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
    if (existing.student_id !== studentId) {
      const { data: migrated, error: migrateError } = await supabaseAdmin
        .from("bot_state")
        .update({
          student_id: studentId,
          current_state: "IDLE",
          current_session_id: null,
          current_workout_exercise_id: null,
          current_set_number: 1,
          last_input_attempt: null,
          rest_end_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("whatsapp_number", whatsapp)
        .select(
          "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt,rest_end_at",
        )
        .single();

      if (migrateError) {
        throw migrateError;
      }

      return migrated as BotStateRow;
    }

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
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("bot_state")
    .update({ ...patch, updated_at: now, last_activity_at: now })
    .eq("whatsapp_number", whatsapp);

  if (error) {
    throw error;
  }
}

async function getPersonalWhatsapp(personalId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("personals")
    .select("phone")
    .eq("id", personalId)
    .maybeSingle();

  if (error) {
    return null;
  }

  // Descriptografar phone antes de usar como destino de mensagem
  const decryptedData = data
    ? { ...data, phone: decrypt((data as any).phone) ?? (data as any).phone }
    : null;

  return resolvePersonalWhatsAppNumber(decryptedData as any);
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
      exercise_catalog_id,
      exercise_variation_id,
      equipment_id,
      grip_footing_id,
      method_id,
      target_sets,
      target_reps,
      target_weight,
      order_index,
      rest_seconds,
      custom_description,
      biset_group_id,
      exercise_catalog ( name, muscle_groups ( name ) ),
      exercise_variations ( name ),
      equipment_catalog ( name ),
      grip_footing_catalog ( name ),
      method_catalog ( name ),
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

  return (data ?? []).map((item: any) => mapWorkoutExerciseRow(item));
}

// Adaptador de shape para manter compatibilidade do restante do bot.
function mapWorkoutExerciseRow(item: any): WorkoutExercise {
  const catalog = Array.isArray(item.exercise_catalog)
    ? item.exercise_catalog[0]
    : item.exercise_catalog;
  const variation = Array.isArray(item.exercise_variations)
    ? item.exercise_variations[0]
    : item.exercise_variations;
  const equipment = Array.isArray(item.equipment_catalog)
    ? item.equipment_catalog[0]
    : item.equipment_catalog;
  const gripFooting = Array.isArray(item.grip_footing_catalog)
    ? item.grip_footing_catalog[0]
    : item.grip_footing_catalog;
  const method = Array.isArray(item.method_catalog)
    ? item.method_catalog[0]
    : item.method_catalog;

  const baseName = catalog?.name ?? item.exercises?.name ?? "Exercício";
  const variationName = variation?.name ?? null;
  const exerciseName = variationName
    ? `${baseName} - ${variationName}`
    : baseName;
  const catalogMuscleGroup = Array.isArray(catalog?.muscle_groups)
    ? catalog?.muscle_groups[0]
    : catalog?.muscle_groups;

  return {
    id: item.id,
    exercise_id: item.exercise_id,
    exercise_catalog_id: item.exercise_catalog_id ?? null,
    exercise_variation_id: item.exercise_variation_id ?? null,
    equipment_id: item.equipment_id ?? null,
    grip_footing_id: item.grip_footing_id ?? null,
    method_id: item.method_id ?? null,
    exercise_name: exerciseName,
    variation_name: variationName,
    muscle_group: catalogMuscleGroup?.name ?? item.exercises?.muscle_group ?? null,
    equipment: equipment?.name ?? item.exercises?.equipment ?? null,
    equipment_name: equipment?.name ?? null,
    grip_footing_name: gripFooting?.name ?? null,
    method_name: method?.name ?? null,
    description: item.custom_description ?? item.exercises?.description ?? null,
    custom_description: item.custom_description ?? null,
    target_sets: item.target_sets,
    target_reps: item.target_reps,
    target_weight: item.target_weight,
    order_index: item.order_index,
    rest_seconds: item.rest_seconds ?? null,
    biset_group_id: item.biset_group_id ?? null,
  };
}

/**
 * Cria uma nova sessão de treino
 */
async function createDailySession(studentId: string, workoutId: string) {
  const today = new Date().toISOString().split("T")[0];

  const { data: activeSession, error: activeError } = await supabaseAdmin
    .from("daily_sessions")
    .select("id,date,workout_id,status")
    .eq("student_id", studentId)
    .eq("status", "started")
    .maybeSingle();

  if (activeError) {
    throw activeError;
  }

  if (activeSession) {
    if (
      activeSession.date === today &&
      activeSession.workout_id === workoutId
    ) {
      return activeSession.id as string;
    }

    if (activeSession.date !== today) {
      await supabaseAdmin
        .from("daily_sessions")
        .update({ status: "abandoned" })
        .eq("id", activeSession.id)
        .eq("status", "started");
    } else {
      const conflict = new Error("ACTIVE_SESSION_CONFLICT");
      (conflict as any).code = "ACTIVE_SESSION_CONFLICT";
      (conflict as any).activeSessionId = activeSession.id;
      (conflict as any).activeWorkoutId = activeSession.workout_id;
      throw conflict;
    }
  }

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
    // Unique constraint violation: another concurrent request created a session.
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from("daily_sessions")
        .select("id,date,workout_id,status")
        .eq("student_id", studentId)
        .eq("status", "started")
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (existing) {
        if (existing.date === today && existing.workout_id === workoutId) {
          return existing.id as string;
        }

        if (existing.date !== today) {
          await supabaseAdmin
            .from("daily_sessions")
            .update({ status: "abandoned" })
            .eq("id", existing.id)
            .eq("status", "started");

          const retry = await supabaseAdmin
            .from("daily_sessions")
            .insert({
              student_id: studentId,
              workout_id: workoutId,
              status: "started",
              date: today,
            })
            .select("id")
            .single();

          if (retry.error) throw retry.error;
          return retry.data.id;
        }

        const conflict = new Error("ACTIVE_SESSION_CONFLICT");
        (conflict as any).code = "ACTIVE_SESSION_CONFLICT";
        (conflict as any).activeSessionId = existing.id;
        (conflict as any).activeWorkoutId = existing.workout_id;
        throw conflict;
      }
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
  pseScore: number | null;
}) {
  const { error } = await supabaseAdmin.from("set_logs").insert({
    session_id: params.sessionId,
    workout_exercise_id: params.workoutExerciseId,
    set_number: params.setNumber,
    reps_done: encryptNumber(params.repsDone),
    weight_used: encryptNumber(params.weightUsed),
    rpe_score: encryptNumber(params.pseScore),
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
async function buildWorkoutSummary(
  sessionId: string,
  tracking?: SessionTrackingData | null,
): Promise<string> {
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("daily_sessions")
    .select("date,workout_id,status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !sessionRow) return "";

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
        target_sets,
        exercise_catalog ( name ),
        exercise_variations ( name ),
        exercises ( name )
      )
    `,
    )
    .eq("session_id", sessionId)
    .order("set_number", { ascending: true });

  if (error) return "";

  // Agrupar sets por exercício
  const exerciseMap = new Map<
    string,
    { name: string; order: number; targetSets: number; sets: typeof logs }
  >();
  for (const log of logs ?? []) {
    const we = log.workout_exercises as any;
    const catalog = Array.isArray(we?.exercise_catalog)
      ? we.exercise_catalog[0]
      : we?.exercise_catalog;
    const variation = Array.isArray(we?.exercise_variations)
      ? we.exercise_variations[0]
      : we?.exercise_variations;
    const base = catalog?.name ?? we?.exercises?.name ?? "Exercício";
    const name = variation?.name ? `${base} - ${variation.name}` : base;
    const order = we?.order_index ?? 0;
    const targetSets = we?.target_sets ?? 0;
    if (!exerciseMap.has(log.workout_exercise_id)) {
      exerciseMap.set(log.workout_exercise_id, { name, order, targetSets, sets: [] });
    }
    exerciseMap.get(log.workout_exercise_id)!.sets.push(log);
  }

  const sorted = Array.from(exerciseMap.values()).sort(
    (a, b) => a.order - b.order,
  );

  const today = new Date(`${sessionRow.date}T00:00:00`).toLocaleDateString(
    "pt-BR",
  );
  const lines: string[] = [`📊 *EXTRATO DO TREINO — ${today}*`, ""];

  sorted.forEach((ex, i) => {
    const doneCount = ex.sets.length;
    const isPartial = ex.targetSets > 0 && doneCount < ex.targetSets;
    const label = isPartial
      ? `*${i + 1}. ${ex.name}* _(${doneCount}/${ex.targetSets} séries)_`
      : `*${i + 1}. ${ex.name}*`;
    lines.push(label);
    for (const s of ex.sets as any[]) {
      const reps   = decryptNumber(s.reps_done)   ?? Number(s.reps_done ?? 0);
      const weight = decryptNumber(s.weight_used) ?? Number(s.weight_used ?? 0);
      const pse    = decryptNumber(s.rpe_score)   ?? (s.rpe_score != null ? Number(s.rpe_score) : null);
      lines.push(
        `   Série ${s.set_number}: ${reps} reps × ${weight}kg | PSE ${pse ?? "-"}`,
      );
    }
    lines.push("");
  });

  // Exercícios não tocados (presentes no tracking mas sem nenhum set_log)
  if (tracking) {
    const touchedIds = new Set(exerciseMap.keys());
    const notStarted = (tracking.remaining_ids ?? []).filter(
      (id) => !touchedIds.has(id) && !(tracking.done ?? []).some((d) => d.id === id),
    );
    if (notStarted.length > 0) {
      lines.push("*Não realizados:*");
      for (const id of notStarted) {
        const det = tracking.exercise_details?.[id];
        if (det) lines.push(`   ❌ ${det.name}`);
      }
      lines.push("");
    }
  }

  const totalSets = logs?.length ?? 0;
  const totalExercises = sorted.length;
  lines.push(
    `✅ ${totalExercises} exercício${
      totalExercises !== 1 ? "s" : ""
    } | ${totalSets} série${totalSets !== 1 ? "s" : ""} registradas`,
  );

  return lines.join("\n").trimEnd();
}

/**
 * Lê o tracking_mode configurado pelo personal para o par aluno+treino.
 * Retorna 'per_exercise' como fallback (per_rep foi descontinuado).
 */
async function getStudentWorkoutTrackingMode(
  studentId: string,
  workoutId: string,
): Promise<"per_rep" | "per_exercise" | "per_workout" | "none"> {
  const { data } = await supabaseAdmin
    .from("student_workouts")
    .select("tracking_mode")
    .eq("student_id", studentId)
    .eq("workout_id", workoutId)
    .maybeSingle();

  const mode = (data as any)?.tracking_mode;
  if (
    mode === "per_rep" ||
    mode === "per_exercise" ||
    mode === "per_workout" ||
    mode === "none"
  ) {
    // per_rep legado: tratar como per_exercise
    return mode === "per_rep" ? "per_exercise" : mode;
  }
  return "per_exercise";
}

/**
 * Monta extrato simples com lista de exercícios concluídos (sem dados de série).
 * Usado pelos modos per_workout e none.
 */
function buildSimpleExerciseList(
  tracking: SessionTrackingData,
  overallPse?: number,
  currentExerciseId?: string | null,
): string {
  const today = new Date().toLocaleDateString("pt-BR");
  const sorted = [...(tracking.done ?? [])].sort(
    (a, b) => a.exec_order - b.exec_order,
  );

  const lines: string[] = [`📋 *EXERCÍCIOS REALIZADOS — ${today}*`, ""];

  if (sorted.length === 0 && (tracking.remaining_ids ?? []).length === 0) {
    lines.push("Nenhum exercício registrado.");
  } else {
    // Exercícios concluídos
    for (const ex of sorted) {
      lines.push(`✅ ${ex.exec_order}. ${ex.name}`);
    }

    // Exercício em andamento no momento do encerramento (séries parciais)
    if (currentExerciseId && tracking.exercise_details?.[currentExerciseId]) {
      const det = tracking.exercise_details[currentExerciseId];
      const alreadyDone = sorted.some((d) => d.id === currentExerciseId);
      if (!alreadyDone) {
        lines.push(`⏳ ${sorted.length + 1}. ${det.name} *(em andamento)*`);
      }
    }

    // Exercícios não iniciados (remaining, excluindo o atual)
    const remaining = (tracking.remaining_ids ?? []).filter(
      (id) => id !== currentExerciseId && !sorted.some((d) => d.id === id),
    );
    if (remaining.length > 0) {
      lines.push("");
      lines.push("*Não realizados:*");
      for (const id of remaining) {
        const det = tracking.exercise_details?.[id];
        if (det) lines.push(`❌ ${det.name}`);
      }
    }
  }

  lines.push("");
  if (overallPse !== undefined) {
    lines.push(
      `Total: ${sorted.length} exercício${sorted.length !== 1 ? "s" : ""} concluído${sorted.length !== 1 ? "s" : ""} | Esforço geral (PSE): ${overallPse}/10`,
    );
  } else {
    lines.push(
      `Total: ${sorted.length} exercício${sorted.length !== 1 ? "s" : ""} concluído${sorted.length !== 1 ? "s" : ""}`,
    );
  }

  return lines.join("\n").trimEnd();
}

/**
 * Monta o menu de seleção de exercícios, sempre com [0] Encerrar treino no final.
 * Pares de bi-set (mesmo biset_group_id) são exibidos como UMA entrada numerada:
 *   N️⃣ *Exercício A* + *Exercício B*  [BI-SET] (Músculo) — Nx(RepsA + RepsB)
 * O aluno seleciona o número e o bot inicia o 1º exercício do par automaticamente.
 */
function buildExerciseSelectionMenu(
  tracking: SessionTrackingData,
  headerText: string,
): string {
  const seenGroups = new Set<string>();
  const items: string[] = [];
  let counter = 1;

  for (const id of tracking.remaining_ids) {
    const det = tracking.exercise_details[id];
    const groupId = det.biset_group_id;

    // Se é 2º exercício de um bi-set já processado, pula (já foi incluído no 1º)
    if (groupId && seenGroups.has(groupId)) continue;

    if (groupId) {
      // Encontra o parceiro do bi-set nos remaining_ids
      const partnerId = tracking.remaining_ids.find(
        (pid) =>
          pid !== id &&
          tracking.exercise_details[pid]?.biset_group_id === groupId,
      );
      const partner = partnerId ? tracking.exercise_details[partnerId] : null;

      if (partner && partnerId) {
        seenGroups.add(groupId);
        const muscle = det.muscle ? ` (${det.muscle})` : "";
        const extraA = [
          det.execution ? `Exec.: ${det.execution}` : null,
          det.equipment ? `Equip.: ${det.equipment}` : null,
        ].filter(Boolean).join(" | ");
        const extraB = [
          partner.execution ? `Exec.: ${partner.execution}` : null,
          partner.equipment ? `Equip.: ${partner.equipment}` : null,
        ].filter(Boolean).join(" | ");

        items.push(
          `${counter}️⃣ *[BI-SET]*${muscle} — ${det.sets}×série\n` +
          `   🅐 *${det.name}* — ${det.reps} reps${extraA ? ` | ${extraA}` : ""}\n` +
          `   🅑 *${partner.name}* — ${partner.reps} reps${extraB ? ` | ${extraB}` : ""}`,
        );
        counter += 1;
        continue;
      }
    }

    // Exercício individual (sem bi-set ou parceiro não encontrado)
    const muscle = det.muscle ? ` (${det.muscle})` : "";
    const extra = [
      det.execution ? `Execução: ${det.execution}` : null,
      det.equipment ? `Equip.: ${det.equipment}` : null,
      det.grip_footing ? `Peg./Pis.: ${det.grip_footing}` : null,
      det.method ? `Método: ${det.method}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    items.push(
      `${counter}️⃣ *${det.name}*${muscle} — ${det.sets}×${det.reps}${extra ? `\n   ${extra}` : ""}`,
    );
    counter += 1;
  }

  return `${headerText}\n\n${items.join("\n")}\n0️⃣ *[Encerrar treino]*\n\nResponda com o *número*.`;
}

type SessionTrackingData = {
  type: "tracking";
  mode: "monitored_free" | "unmonitored" | null;
  tracking_mode: "per_rep" | "per_exercise" | "per_workout" | "none" | null;
  session_date: string | null;
  all_ids: string[];
  remaining_ids: string[];
  done: Array<{ id: string; name: string; exec_order: number }>;
  exercise_details: Record<
    string,
    {
      name: string;
      muscle: string | null;
      equipment: string | null;
      execution: string | null;
      grip_footing: string | null;
      method: string | null;
      description: string | null;
      sets: number;
      reps: number;
      weight: number | null;
      rest: number | null;
      biset_group_id?: string | null;
    }
  >;
};

function buildPersonalReport(
  studentName: string,
  tracking: SessionTrackingData | null,
  monitoredSummary: string,
): string {
  const today = tracking?.session_date
    ? new Date(`${tracking.session_date}T00:00:00`).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");
  const trackingMode = tracking?.tracking_mode ?? "per_exercise";

  const modeLabel: Record<string, string> = {
    per_rep: "Série por série",
    per_exercise: "A cada exercício",
    per_workout: "A cada treino (PSE geral)",
    none: "Sem acompanhamento",
  };

  const lines: string[] = [
    `📊 *RELATÓRIO DE TREINO — ${studentName}*`,
    `📅 ${today}`,
    `🎯 Modo: ${modeLabel[trackingMode] ?? "Monitorado"}`,
    "",
  ];

  if (trackingMode === "none" || trackingMode === "per_workout") {
    if (tracking) {
      lines.push(buildSimpleExerciseList(tracking));
    }
  } else {
    // per_rep ou per_exercise — mostrar exercícios e sets/detalhes
    if (tracking?.done?.length) {
      lines.push("*Ordem de execução:*");
      const sorted = [...tracking.done].sort(
        (a, b) => a.exec_order - b.exec_order,
      );
      for (const ex of sorted) {
        lines.push(`  ${ex.exec_order}. ${ex.name}`);
      }
    } else if (tracking?.all_ids?.length) {
      lines.push("*Exercícios do treino (ordem padrão):*");
      for (let i = 0; i < tracking.all_ids.length; i++) {
        const det = tracking.exercise_details[tracking.all_ids[i]];
        if (det) lines.push(`  ${i + 1}. ${det.name}`);
      }
    }
    if (monitoredSummary) {
      lines.push("", monitoredSummary);
    }
  }

  return lines.join("\n");
}

async function sendReportToPersonal(params: {
  app: FastifyInstance;
  instanceName: string;
  personalId: string;
  studentName: string;
  tracking: SessionTrackingData | null;
  monitoredSummary: string;
}): Promise<void> {
  const personalWhatsapp = await getPersonalWhatsapp(params.personalId);
  if (!personalWhatsapp) {
    params.app.log.warn(
      { personalId: params.personalId },
      "sendReportToPersonal: personal has no whatsapp_number configured",
    );
    return;
  }

  const fallbackExtract = buildSimpleExerciseList(
    params.tracking ?? {
      type: "tracking",
      mode: "unmonitored",
      tracking_mode: "none",
      session_date: null,
      all_ids: [],
      remaining_ids: [],
      done: [],
      exercise_details: {},
    },
  );

  const workoutExtract =
    params.monitoredSummary?.trim() ||
    fallbackExtract ||
    "Sem extrato disponível.";

  try {
    await sendTextMessage({
      instanceName: params.instanceName,
      number: personalWhatsapp,
      text: `O aluno ${params.studentName} terminou o treino de hoje! veja o extrato do treino dele:\n${workoutExtract}`,
    });
    params.app.log.info(
      { personalId: params.personalId, studentName: params.studentName },
      "sendReportToPersonal: report sent to personal",
    );
  } catch (err) {
    params.app.log.error(err, "sendReportToPersonal: failed to send message");
  }
}

async function sendTrainingStartedToPersonal(params: {
  app: FastifyInstance;
  instanceName: string;
  personalId: string;
  studentName: string;
}): Promise<void> {
  const personalWhatsapp = await getPersonalWhatsapp(params.personalId);
  if (!personalWhatsapp) {
    params.app.log.warn(
      { personalId: params.personalId },
      "sendTrainingStartedToPersonal: personal has no whatsapp_number configured",
    );
    return;
  }

  try {
    await sendTextMessage({
      instanceName: params.instanceName,
      number: personalWhatsapp,
      text: `O aluno ${params.studentName} iniciou o treino.`,
    });
    params.app.log.info(
      { personalId: params.personalId, studentName: params.studentName },
      "sendTrainingStartedToPersonal: start notification sent to personal",
    );
  } catch (err) {
    params.app.log.error(
      err,
      "sendTrainingStartedToPersonal: failed to send message",
    );
  }
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

async function getSessionTrackingData(
  sessionId: string | null,
): Promise<SessionTrackingData | null> {
  if (!sessionId) return null;

  const { data: sessionRow } = await supabaseAdmin
    .from("daily_sessions")
    .select("summary")
    .eq("id", sessionId)
    .maybeSingle();

  try {
    const parsed = JSON.parse((sessionRow as any)?.summary ?? "null");
    if (parsed?.type === "tracking") return parsed as SessionTrackingData;
  } catch {}

  return null;
}

async function advanceAfterSetLog(params: {
  app: FastifyInstance;
  instanceName: string;
  whatsapp: string;
  student: { name: string; personal_id: string };
  state: BotStateRow;
}): Promise<void> {
  const { app, instanceName, whatsapp, student, state } = params;

  const exerciseResult = await supabaseAdmin
    .from("workout_exercises")
    .select(
      "target_sets,exercise_id,rest_seconds,exercise_catalog(name),exercise_variations(name),exercises(name)",
    )
    .eq("id", state.current_workout_exercise_id!)
    .single();

  if (exerciseResult.error || !exerciseResult.data) {
    app.log.error(
      exerciseResult.error,
      "advanceAfterSetLog: failed to fetch exercise data",
    );
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: "Ocorreu um erro ao registrar a série. Tente novamente! 😅",
    });
    await updateState(whatsapp, {
      current_state: "EXECUTING_SET",
      last_input_attempt: null,
      rest_end_at: null,
    });
    return;
  }

  const catalog = Array.isArray((exerciseResult.data as any).exercise_catalog)
    ? (exerciseResult.data as any).exercise_catalog[0]
    : (exerciseResult.data as any).exercise_catalog;
  const variation = Array.isArray((exerciseResult.data as any).exercise_variations)
    ? (exerciseResult.data as any).exercise_variations[0]
    : (exerciseResult.data as any).exercise_variations;
  const baseExerciseName = catalog?.name ?? (Array.isArray(exerciseResult.data.exercises)
    ? exerciseResult.data.exercises[0]?.name
    : ((exerciseResult.data.exercises as any)?.name ?? "Exercício"));

  const targetSets = exerciseResult.data.target_sets;
  const exerciseName = variation?.name
    ? `${baseExerciseName} - ${variation.name}`
    : baseExerciseName;
  const restSeconds: number | null =
    (exerciseResult.data as any).rest_seconds ?? null;
  const nextSet = state.current_set_number + 1;
  const isCollectingState =
    state.current_state === "COLLECTING_REPS" ||
    state.current_state === "COLLECTING_WEIGHT" ||
    state.current_state === "COLLECTING_RPE";

  if (nextSet <= targetSets) {
    if (restSeconds && restSeconds > 0) {
      const nowMs = Date.now();
      const startedRestEndMs = state.rest_end_at
        ? new Date(state.rest_end_at).getTime()
        : 0;

      if (startedRestEndMs > nowMs) {
        const remaining = Math.ceil((startedRestEndMs - nowMs) / 1000);
        await updateState(whatsapp, {
          current_state: "RESTING",
          rest_end_at: new Date(startedRestEndMs).toISOString(),
          last_input_attempt: `rest:next_set:${nextSet}`,
        });

        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: buildSetRestTransitionMessage({
            currentSet: state.current_set_number,
            targetSets,
            remainingSeconds: remaining,
            state: "already_started",
          }),
        });
      } else if (startedRestEndMs > 0) {
        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: buildSetRestTransitionMessage({
            currentSet: state.current_set_number,
            targetSets,
            state: "expired",
          }),
        });

        await updateState(whatsapp, {
          current_state: "EXECUTING_SET",
          current_set_number: nextSet,
          last_input_attempt: null,
          rest_end_at: null,
        });
      } else if (isCollectingState) {
        // No modo por repetição, o descanso pode expirar em background durante a coleta.
        // Nesse caso, não reinicia descanso ao concluir o log da série.
        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: buildSetRestTransitionMessage({
            currentSet: state.current_set_number,
            targetSets,
            state: "expired",
          }),
        });

        await updateState(whatsapp, {
          current_state: "EXECUTING_SET",
          current_set_number: nextSet,
          last_input_attempt: null,
          rest_end_at: null,
        });
      } else {
        const restEndAt = new Date(nowMs + restSeconds * 1000).toISOString();
        await updateState(whatsapp, {
          current_state: "RESTING",
          rest_end_at: restEndAt,
          last_input_attempt: `rest:next_set:${nextSet}`,
        });

        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: buildSetRestTransitionMessage({
            currentSet: state.current_set_number,
            targetSets,
            restSeconds,
            state: "started",
          }),
        });
      }
    } else {
      await sendTextMessage({
        instanceName,
        number: whatsapp,
        text: buildSetRestTransitionMessage({
          currentSet: state.current_set_number,
          targetSets,
          state: "no_rest",
        }),
      });

      await updateState(whatsapp, {
        current_state: "EXECUTING_SET",
        current_set_number: nextSet,
        last_input_attempt: null,
        rest_end_at: null,
      });
    }
    return;
  }

  // Exercício completo! Verificar modo de execução
  // Checar se estamos em modo de ordem livre
  let exerciseTracking: SessionTrackingData | null = null;
  if (state.current_session_id) {
    const { data: sessionRow } = await supabaseAdmin
      .from("daily_sessions")
      .select("summary")
      .eq("id", state.current_session_id)
      .maybeSingle();
    try {
      const parsed = JSON.parse((sessionRow as any)?.summary ?? "null");
      if (parsed?.type === "tracking") exerciseTracking = parsed;
    } catch {}
  }

  if (exerciseTracking && state.current_workout_exercise_id) {
    const alreadyDone = (exerciseTracking.done ?? []).some(
      (d) => d.id === state.current_workout_exercise_id,
    );
    if (!alreadyDone) {
      const done = exerciseTracking.done ?? [];
      done.push({
        id: state.current_workout_exercise_id,
        name: exerciseName,
        exec_order: done.length + 1,
      });
      exerciseTracking.done = done;
    }

    exerciseTracking.remaining_ids = (
      exerciseTracking.remaining_ids ?? []
    ).filter((id) => id !== state.current_workout_exercise_id);

    await supabaseAdmin
      .from("daily_sessions")
      .update({ summary: JSON.stringify(exerciseTracking) })
      .eq("id", state.current_session_id!);
  }

  if (exerciseTracking?.mode === "monitored_free") {
    const remaining = exerciseTracking.remaining_ids ?? [];

    if (remaining.length === 0) {
      // Todos os exercícios concluídos!
      let workoutSummary = "";
      try {
        workoutSummary = await buildWorkoutSummary(state.current_session_id!, exerciseTracking);
      } catch (err) {
        app.log.error(err, "Failed to build workout summary");
      }

      const finalReport = buildPersonalReport(
        student.name,
        exerciseTracking,
        workoutSummary,
      );
      await completeSession(state.current_session_id!, finalReport);

      const congratsMessage = await safeCoachReply(
        app,
        `O aluno ${student.name} acabou de completar o treino! Parabenize de forma entusiasmada e motivadora (2-3 linhas). Celebre a conquista!`,
        "Parabéns! Treino concluído com sucesso. Você mandou muito bem hoje! 🔥💪",
      );

      await sendTextMessage({
        instanceName,
        number: whatsapp,
        text: `🎉 TREINO CONCLUÍDO!\n\n${congratsMessage}`,
      });

      if (workoutSummary) {
        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: workoutSummary,
        });
      }

      await sendReportToPersonal({
        app,
        instanceName,
        personalId: student.personal_id,
        studentName: student.name,
        tracking: exerciseTracking,
        monitoredSummary: workoutSummary,
      });

      await updateState(whatsapp, {
        current_state: "IDLE",
        current_session_id: null,
        current_workout_exercise_id: null,
        current_set_number: 1,
        last_input_attempt: null,
        rest_end_at: null,
      });
      return;
    }

    // ── Bi-set: verificar se o exercício concluído tem um parceiro pendente ──
    const completedDet =
      state.current_workout_exercise_id
        ? exerciseTracking.exercise_details[state.current_workout_exercise_id]
        : null;
    const completedBisetGroup = completedDet?.biset_group_id ?? null;

    if (completedBisetGroup) {
      // Procura o parceiro do bi-set nos exercícios AINDA remaining (após remover o atual)
      const bisetPartnerId = remaining.find(
        (pid) =>
          exerciseTracking!.exercise_details[pid]?.biset_group_id ===
          completedBisetGroup,
      );

      if (bisetPartnerId) {
        // Existe parceiro: ir direto para ele, SEM descanso, SEM menu
        const partnerDet = exerciseTracking.exercise_details[bisetPartnerId];

        const partnerExercise: WorkoutExercise = {
          id: bisetPartnerId,
          exercise_id: bisetPartnerId,
          exercise_name: partnerDet.name,
          variation_name: partnerDet.execution ?? null,
          muscle_group: partnerDet.muscle,
          equipment: partnerDet.equipment,
          equipment_name: partnerDet.equipment,
          grip_footing_name: partnerDet.grip_footing ?? null,
          method_name: partnerDet.method ?? null,
          description: partnerDet.description,
          custom_description: null,
          target_sets: partnerDet.sets,
          target_reps: partnerDet.reps,
          target_weight: partnerDet.weight,
          order_index: 0,
          rest_seconds: partnerDet.rest,
          biset_group_id: completedBisetGroup,
        };

        await updateState(whatsapp, {
          current_state: "EXECUTING_SET",
          current_workout_exercise_id: bisetPartnerId,
          current_set_number: 1,
          last_input_attempt: null,
          rest_end_at: null,
        });

        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text:
            `🔁 *Bi-set!* Sem descanso — próximo exercício:\n\n` +
            `🔥 *${partnerDet.name}*\n${formatExerciseDetails(partnerExercise)}\n\nQuando terminar, manda *feito*.`,
        });
        return;
      }
    }

    // Ainda há exercícios restantes (sem bi-set pendente)
    await updateState(whatsapp, {
      current_state: "AWAITING_EXERCISE_ORDER_SELECTION",
      current_workout_exercise_id: null,
      current_set_number: 1,
      last_input_attempt: null,
      rest_end_at: null,
    });

    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: buildExerciseSelectionMenu(
        exerciseTracking,
        `✅ *${exerciseName}* concluído! Boa! 💪\n\n*Qual exercício quer fazer agora?*`,
      ),
    });
    return;
  }

  // Modo fixo (legado ou sem tracking): buscar próximo exercício na ordem
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
      const restEndAt = new Date(Date.now() + restSeconds * 1000).toISOString();

      await updateState(whatsapp, {
        current_state: "RESTING",
        rest_end_at: restEndAt,
        last_input_attempt: `rest:next_exercise:${nextExercise.id}`,
      });

      await sendTextMessage({
        instanceName,
        number: whatsapp,
        text: `✅ ${exerciseName} concluído!\n\n⏱ Iniciando descanso de *${restSeconds}s*. Vou te avisar quando acabar! 💪`,
      });
    } else {
      await sendTextMessage({
        instanceName,
        number: whatsapp,
        text: `✅ ${exerciseName} concluído!\n\n🔸 Próximo: *${nextExercise.exercise_name}*\n${formatExerciseDetails(nextExercise)}`,
      });

      await updateState(whatsapp, {
        current_state: "EXECUTING_SET",
        current_workout_exercise_id: nextExercise.id,
        current_set_number: 1,
        last_input_attempt: null,
        rest_end_at: null,
      });
    }
    return;
  }

  if (exerciseTracking?.tracking_mode === "per_workout") {
    await updateState(whatsapp, {
      current_state: "COLLECTING_SESSION_RPE",
      current_workout_exercise_id: null,
      current_set_number: 1,
      last_input_attempt: null,
      rest_end_at: null,
    });
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: "💪 Todos os exercícios concluídos!\n\nQual foi o PSE geral do treino?\n\nResponda com um número de *1 a 10*:\n1-5 - Leve\n6-7 - Moderado\n8-9 - Intenso\n10 - Máximo 🔥",
    });
    return;
  }

  if (exerciseTracking?.tracking_mode === "none") {
    const simpleSummary = buildSimpleExerciseList(exerciseTracking);
    await completeSession(
      state.current_session_id!,
      simpleSummary || undefined,
    );

    const congratsMessage = await safeCoachReply(
      app,
      `O aluno ${student.name} acabou de completar o treino! Parabenize de forma entusiasmada e motivadora (2-3 linhas). Celebre a conquista!`,
      "Parabéns! Treino concluído com sucesso. Você mandou muito bem hoje! 🔥💪",
    );

    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: `🎉 TREINO CONCLUÍDO!\n\n${congratsMessage}`,
    });

    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: simpleSummary,
    });

    await sendReportToPersonal({
      app,
      instanceName,
      personalId: student.personal_id,
      studentName: student.name,
      tracking: exerciseTracking,
      monitoredSummary: simpleSummary,
    });

    await updateState(whatsapp, {
      current_state: "IDLE",
      current_session_id: null,
      current_workout_exercise_id: null,
      current_set_number: 1,
      last_input_attempt: null,
      rest_end_at: null,
    });
    return;
  }

  // Treino completo! (modo fixo)
  let workoutSummary = "";
  if (state.current_session_id) {
    try {
      workoutSummary = await buildWorkoutSummary(state.current_session_id);
    } catch (err) {
      app.log.error(err, "Failed to build workout summary");
    }
    await completeSession(
      state.current_session_id,
      workoutSummary || undefined,
    );
  }

  const congratsMessage = await safeCoachReply(
    app,
    `O aluno ${student.name} acabou de completar o treino! Parabenize de forma entusiasmada e motivadora (2-3 linhas). Celebre a conquista!`,
    "Parabéns! Treino concluído com sucesso. Você mandou muito bem hoje! 🔥💪",
  );

  await sendTextMessage({
    instanceName,
    number: whatsapp,
    text: `🎉 TREINO CONCLUÍDO!\n\n${congratsMessage}`,
  });

  if (workoutSummary) {
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: workoutSummary,
    });
  }

  await sendReportToPersonal({
    app,
    instanceName,
    personalId: student.personal_id,
    studentName: student.name,
    tracking: exerciseTracking,
    monitoredSummary: workoutSummary,
  });

  await updateState(whatsapp, {
    current_state: "IDLE",
    current_session_id: null,
    current_workout_exercise_id: null,
    current_set_number: 1,
    last_input_attempt: null,
    rest_end_at: null,
  });
}

async function finishTrainingEarly(params: {
  app: FastifyInstance;
  instanceName: string;
  whatsapp: string;
  student: { name: string; personal_id: string };
  state: BotStateRow;
  trigger?: "explicit_command" | "menu_option" | "system_fallback";
  inputExcerpt?: string;
}): Promise<void> {
  const {
    app,
    instanceName,
    whatsapp,
    student,
    state,
    trigger = "system_fallback",
    inputExcerpt,
  } = params;
  const sessionId = state.current_session_id;

  if (trigger === "system_fallback") {
    await logBotAnomaly(app, {
      severity: "warn",
      category: "session",
      code: "early_finish_without_explicit_trigger",
      message:
        "Treino encerrado antecipadamente sem trigger explícito do usuário.",
      whatsapp_number: whatsapp,
      student_id: state.student_id,
      session_id: sessionId,
      current_state: state.current_state,
      input_excerpt: inputExcerpt,
    });
  }

  if (!sessionId) {
    await logBotAnomaly(app, {
      severity: "warn",
      category: "state",
      code: "early_finish_without_session",
      message:
        "Solicitação de encerramento antecipado recebida sem sessão ativa no bot_state.",
      whatsapp_number: whatsapp,
      student_id: state.student_id,
      current_state: state.current_state,
      input_excerpt: inputExcerpt,
    });

    await updateState(whatsapp, {
      current_state: "IDLE",
      current_session_id: null,
      current_workout_exercise_id: null,
      current_set_number: 1,
      last_input_attempt: null,
      rest_end_at: null,
    });
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: "Treino encerrado. Quando quiser voltar, me manda *1* para começar de novo! 💪",
    });
    return;
  }

  let tracking: SessionTrackingData | null = null;
  const { data: sessionRow } = await supabaseAdmin
    .from("daily_sessions")
    .select("summary")
    .eq("id", sessionId)
    .maybeSingle();

  try {
    const parsed = JSON.parse((sessionRow as any)?.summary ?? "null");
    if (parsed?.type === "tracking") tracking = parsed;
  } catch {
    await logBotAnomaly(app, {
      severity: "warn",
      category: "session",
      code: "invalid_session_summary_json",
      message: "Falha ao parsear summary da sessão durante encerramento antecipado.",
      whatsapp_number: whatsapp,
      student_id: state.student_id,
      session_id: sessionId,
      current_state: state.current_state,
      input_excerpt: inputExcerpt,
    });
  }

  const trackingMode = tracking?.tracking_mode ?? "none";

  if (trackingMode === "per_workout") {
    await updateState(whatsapp, {
      current_state: "COLLECTING_SESSION_RPE",
      last_input_attempt: null,
    });
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: "Treino encerrado! Antes de finalizar, qual foi o PSE geral do treino?\n\nResponda com um número de *1 a 10*:\n1-5 - Leve\n6-7 - Moderado\n8-9 - Intenso\n10 - Máximo 🔥",
    });
    return;
  }

  let extrato = "";
  if (trackingMode === "per_rep" || trackingMode === "per_exercise") {
    try {
      extrato = await buildWorkoutSummary(sessionId, tracking);
    } catch (err) {
      app.log.warn(err, "Failed to build monitored summary on early finish");
    }
  }

  if (!extrato) {
    extrato = buildSimpleExerciseList(
      tracking ?? {
        type: "tracking",
        mode: "unmonitored",
        tracking_mode: "none",
        session_date: null,
        all_ids: [],
        remaining_ids: [],
        done: [],
        exercise_details: {},
      },
      undefined,
      state.current_workout_exercise_id,
    );
  }

  const congratsMessage = await safeCoachReply(
    app,
    `O aluno ${student.name} encerrou o treino antecipadamente. Parabenize pelo esforço de forma breve (1-2 linhas).`,
    `Treino encerrado! Ótimo esforço hoje, ${student.name}! Continue assim! 💪`,
  );

  const personalReport = buildPersonalReport(student.name, tracking, extrato);
  await completeSession(sessionId, personalReport);

  await sendTextMessage({
    instanceName,
    number: whatsapp,
    text: `🎉 ${congratsMessage}`,
  });

  if (trackingMode !== "none" || (tracking?.done?.length ?? 0) > 0) {
    await sendTextMessage({
      instanceName,
      number: whatsapp,
      text: extrato,
    });
  }

  await sendReportToPersonal({
    app,
    instanceName,
    personalId: student.personal_id,
    studentName: student.name,
    tracking,
    monitoredSummary: extrato,
  });

  await updateState(whatsapp, {
    current_state: "IDLE",
    current_session_id: null,
    current_workout_exercise_id: null,
    current_set_number: 1,
    last_input_attempt: null,
    rest_end_at: null,
  });
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
  const inputExcerpt = toInputExcerpt(effectiveInput);

  if (!effectiveInput) {
    return;
  }

  // Comando global: pausar treino com variações
  if (isPauseTrainingIntent(effectiveInput.trim())) {
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
          rest_end_at: null,
        });
      }
    }
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Bot pausado. Quando quiser retomar, me responde com:\n1️⃣ *Sim, bora treinar!*\n2️⃣ *Deixar para depois* 💪",
    });
    return;
  }

  // Comando global: encerrar treino com variações, sem depender da IA.
  if (isTrainingDoneIntent(effectiveInput.trim())) {
    const student = await getStudentByWhatsapp(whatsapp);
    if (!student) {
      return;
    }

    const state = await getOrCreateState(whatsapp, student.id);
    if (state.current_state === "IDLE") {
      await logBotAnomaly(input.app, {
        severity: "info",
        category: "intent",
        code: "finish_requested_without_active_session",
        message:
          "Usuário tentou encerrar treino, mas o estado atual já estava IDLE.",
        whatsapp_number: whatsapp,
        student_id: student.id,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Você não tem treino em andamento agora.\n\nQuer começar?\n1️⃣ *Sim, bora treinar!*\n2️⃣ *Deixar para depois* 💪",
      });
      return;
    }

    await finishTrainingEarly({
      app: input.app,
      instanceName: input.instance,
      whatsapp,
      student,
      state,
      trigger: "explicit_command",
      inputExcerpt: effectiveInput,
    });
    return;
  }

  // 2. Verificar se é uma mensagem de início de treino — interpretação híbrida (regex + IA)
  const wantsToStartTraining = await isTrainingStartIntent(
    input.app,
    effectiveInput,
  );

  if (wantsToStartTraining) {
    const student = await getStudentByWhatsapp(whatsapp);

    if (!student) {
      const response = await safeCoachReply(
        input.app,
        `O usuário tentou iniciar um treino mas não está cadastrado ou não está vinculado a um personal no sistema. Explique de forma amigável e breve (2 linhas) que ele precisa procurar o personal trainer para cadastro/vinculação antes de usar o sistema.`,
        "Não encontrei seu cadastro vinculado a um personal trainer. Procure seu personal para ativar seu acesso e eu te ajudo a iniciar o treino! 💪",
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: response,
      });

      await logBotAnomaly(input.app, {
        severity: "warn",
        category: "linkage",
        code: "start_requested_by_unlinked_whatsapp",
        message:
          "Tentativa de iniciar treino por WhatsApp sem aluno vinculado/ativo.",
        whatsapp_number: whatsapp,
        current_state: null,
        input_excerpt: inputExcerpt,
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
      await promptWorkoutSelection({
        app: input.app,
        instanceName: input.instance,
        whatsapp,
        student: { id: student.id, name: student.name },
        includeGreeting: true,
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

  if (state.current_state === "IDLE") {
    await promptWorkoutSelection({
      app: input.app,
      instanceName: input.instance,
      whatsapp,
      student: { id: student.id, name: student.name },
      includeGreeting: true,
    });
    return;
  }

  // === FLUXO DE ESTADOS ===

  // Estado: AWAITING_WORKOUT_SELECTION
  if (state.current_state === "AWAITING_WORKOUT_SELECTION") {
    const optionsRaw = state.last_input_attempt?.startsWith("workout_options:")
      ? state.last_input_attempt.replace("workout_options:", "")
      : "";
    const optionIds = optionsRaw
      .split("|")
      .map((id) => id.trim())
      .filter(Boolean);

    if (optionIds.length === 0) {
      await logBotAnomaly(input.app, {
        severity: "error",
        category: "state",
        code: "workout_selection_options_missing",
        message:
          "Estado AWAITING_WORKOUT_SELECTION sem opções de treino válidas em last_input_attempt.",
        whatsapp_number: whatsapp,
        student_id: student.id,
        session_id: state.current_session_id,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });

      await updateState(whatsapp, {
        current_state: "IDLE",
        last_input_attempt: null,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Tive um problema ao carregar as opções de treino. Me manda *1* e eu te mostro de novo. 💪",
      });
      return;
    }

    // Verifica seleção por número ANTES de isCancelIntent
    // (isCancelIntent também captura "2", que é uma opção válida de treino)
    const selectedNumber = parseInt(effectiveInput.trim(), 10);
    if (
      !Number.isNaN(selectedNumber) &&
      selectedNumber >= 1 &&
      selectedNumber <= optionIds.length
    ) {
      // número válido — segue para seleção abaixo
    } else if (isCancelIntent(effectiveInput)) {
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
    } else {
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
      await logBotAnomaly(input.app, {
        severity: "warn",
        category: "state",
        code: "selected_workout_not_found",
        message:
          "ID selecionado não foi encontrado entre os treinos atualmente atribuídos ao aluno.",
        whatsapp_number: whatsapp,
        student_id: student.id,
        session_id: state.current_session_id,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Esse treino não está mais disponível. Me manda *1* para eu listar os treinos novamente. 💪",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        last_input_attempt: null,
      });
      return;
    }

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: `Treino escolhido: *${selectedWorkout.name}* ✅\n\nConfirma?\n1️⃣ *Sim, bora!*\n2️⃣ *Trocar treino*`,
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

      // Buscar exercícios do treino antes de criar sessão
      const exercises = await getWorkoutExercises(workout.id);

      if (exercises.length === 0) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Esse treino não tem exercícios cadastrados ainda. Avise seu personal! 📋",
        });
        await updateState(whatsapp, {
          current_state: "IDLE",
          last_input_attempt: null,
        });
        return;
      }

      // Criar sessão de treino
      let sessionId: string;
      try {
        sessionId = await createDailySession(student.id, workout.id);
      } catch (error) {
        if ((error as any)?.code === "ACTIVE_SESSION_CONFLICT") {
          await sendTextMessage({
            instanceName: input.instance,
            number: whatsapp,
            text: "Você já tem um treino ativo para hoje. Finalize ou cancele a sessão atual antes de iniciar outro treino para evitar mistura de informações.",
          });
          await updateState(whatsapp, {
            current_state: "IDLE",
            current_session_id: null,
            current_workout_exercise_id: null,
            current_set_number: 1,
            last_input_attempt: null,
            rest_end_at: null,
          });
          return;
        }
        throw error;
      }
      const sessionDate = new Date().toISOString().split("T")[0];

      // Carregar modo de acompanhamento configurado pelo personal
      const trackingMode = await getStudentWorkoutTrackingMode(
        student.id,
        workout.id,
      );

      // Inicializar tracking de ordem de execução na sessão
      const trackingData: SessionTrackingData = {
        type: "tracking",
        mode:
          trackingMode === "per_rep" || trackingMode === "per_exercise"
            ? "monitored_free"
            : "unmonitored",
        tracking_mode: trackingMode,
        session_date: sessionDate,
        all_ids: exercises.map((e) => e.id),
        remaining_ids: exercises.map((e) => e.id),
        done: [],
        exercise_details: Object.fromEntries(
          exercises.map((e) => [
            e.id,
            {
              name: e.exercise_name,
              muscle: e.muscle_group,
              equipment: e.equipment,
              execution: e.variation_name ?? null,
              grip_footing: e.grip_footing_name ?? null,
              method: e.method_name ?? null,
              description: e.description,
              sets: e.target_sets,
              reps: e.target_reps,
              weight: e.target_weight,
              rest: e.rest_seconds,
              biset_group_id: e.biset_group_id ?? null,
            },
          ]),
        ),
      };

      await supabaseAdmin
        .from("daily_sessions")
        .update({ summary: JSON.stringify(trackingData) })
        .eq("id", sessionId);

      await updateState(whatsapp, {
        current_state: "AWAITING_EXERCISE_ORDER_SELECTION",
        current_session_id: sessionId,
        last_input_attempt: null,
        rest_end_at: null,
      });

      await sendTrainingStartedToPersonal({
        app: input.app,
        instanceName: input.instance,
        personalId: student.personal_id,
        studentName: student.name,
      });

      const menuText = buildExerciseSelectionMenu(
        trackingData,
        `🏋️ *${workout.name}*\n\n*Escolha por qual exercício quer começar:*\n\n💡 Você pode mandar *parar* para pausar o treino ou *encerrar* para finalizar antes da hora.`,
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: menuText,
      });
      return;
    }

    if (isCancelIntent(effectiveInput)) {
      await promptWorkoutSelection({
        app: input.app,
        instanceName: input.instance,
        whatsapp,
        student: { id: student.id, name: student.name },
        includeGreeting: false,
        introText: "Perfeito! Vamos trocar de treino. Qual você quer iniciar?",
      });
      return;
    }
  }
  // Estado: AWAITING_EXERCISE_ORDER_SELECTION
  if (state.current_state === "AWAITING_EXERCISE_ORDER_SELECTION") {
    const sessionId = state.current_session_id;
    if (!sessionId) {
      await logBotAnomaly(input.app, {
        severity: "error",
        category: "state",
        code: "exercise_selection_without_session",
        message:
          "Estado AWAITING_EXERCISE_ORDER_SELECTION detectado sem current_session_id.",
        whatsapp_number: whatsapp,
        student_id: student.id,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });

      await updateState(whatsapp, { current_state: "IDLE" });
      return;
    }

    const { data: sessionRow } = await supabaseAdmin
      .from("daily_sessions")
      .select("summary")
      .eq("id", sessionId)
      .maybeSingle();

    let tracking: SessionTrackingData | null = null;
    try {
      const parsed = JSON.parse((sessionRow as any)?.summary ?? "null");
      if (parsed?.type === "tracking") tracking = parsed;
    } catch {}

    if (!tracking || !tracking.remaining_ids?.length) {
      await logBotAnomaly(input.app, {
        severity: "error",
        category: "session",
        code: "invalid_tracking_on_exercise_selection",
        message:
          "Summary/tracking inválido no estado AWAITING_EXERCISE_ORDER_SELECTION.",
        whatsapp_number: whatsapp,
        student_id: student.id,
        session_id: sessionId,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Ocorreu um erro ao carregar os exercícios. Me manda *1* para tentar de novo. 😅",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        current_session_id: null,
      });
      return;
    }

    const selectedNumber = parseInt(effectiveInput.trim(), 10);

    // Opção 0 = Encerrar treino
    if (selectedNumber === 0) {
      await finishTrainingEarly({
        app: input.app,
        instanceName: input.instance,
        whatsapp,
        student,
        state,
        trigger: "menu_option",
        inputExcerpt: effectiveInput,
      });
      return;
    }

    // Reconstruir o mapeamento número→exercícioId igual ao buildExerciseSelectionMenu
    // (bi-sets aparecem como uma única entrada numerada)
    const seenGroups = new Set<string>();
    const menuIdMap: string[] = []; // índice 0 = opção 1, índice 1 = opção 2, etc.
    for (const id of tracking.remaining_ids) {
      const det = tracking.exercise_details[id];
      const groupId = det?.biset_group_id;
      if (groupId && seenGroups.has(groupId)) continue; // 2º do par já foi incluído
      if (groupId) seenGroups.add(groupId);
      menuIdMap.push(id);
    }

    if (
      Number.isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > menuIdMap.length
    ) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: buildExerciseSelectionMenu(
          tracking,
          `Responda com o número do exercício (1 a ${menuIdMap.length}) ou 0 para encerrar:`,
        ),
      });
      return;
    }

    const selectedExerciseId = menuIdMap[selectedNumber - 1];
    const det = tracking.exercise_details[selectedExerciseId];

    // Montar WorkoutExercise a partir do tracking para exibir detalhes
    const selectedExercise: WorkoutExercise = {
      id: selectedExerciseId,
      exercise_id: selectedExerciseId,
      exercise_name: det.name,
      variation_name: det.execution ?? null,
      muscle_group: det.muscle,
      equipment: det.equipment,
      equipment_name: det.equipment,
      grip_footing_name: det.grip_footing ?? null,
      method_name: det.method ?? null,
      description: det.description,
      custom_description: null,
      target_sets: det.sets,
      target_reps: det.reps,
      target_weight: det.weight,
      order_index: 0,
      rest_seconds: det.rest,
      biset_group_id: det.biset_group_id ?? null,
    };

    await updateState(whatsapp, {
      current_state: "EXECUTING_SET",
      current_workout_exercise_id: selectedExerciseId,
      current_set_number: 1,
      last_input_attempt: null,
    });

    // Se é bi-set, avisar que virá o 2º exercício em seguida
    const isBisetEntry = !!(det.biset_group_id && tracking.remaining_ids.find(
      (pid) => pid !== selectedExerciseId && tracking!.exercise_details[pid]?.biset_group_id === det.biset_group_id,
    ));
    const bisetHint = isBisetEntry
      ? `\n\n⚡ *Bi-set:* ao terminar, o próximo exercício virá automaticamente sem descanso.`
      : "";

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: `🔥 *${det.name}*\n${formatExerciseDetails(selectedExercise)}${bisetHint}\n\nQuando terminar a série, manda *feito*.`,
    });
    return;
  }

  // Estado: UNMONITORED_TRAINING
  if (state.current_state === "UNMONITORED_TRAINING") {
    if (isTrainingDoneIntent(effectiveInput)) {
      const sessionId = state.current_session_id;

      let tracking: SessionTrackingData | null = null;
      if (sessionId) {
        const { data: sessionRow } = await supabaseAdmin
          .from("daily_sessions")
          .select("summary")
          .eq("id", sessionId)
          .maybeSingle();
        try {
          const parsed = JSON.parse((sessionRow as any)?.summary ?? "null");
          if (parsed?.type === "tracking") tracking = parsed;
        } catch {}
      }

      const personalReport = buildPersonalReport(student.name, tracking, "");

      if (sessionId) {
        await completeSession(sessionId, personalReport);
      }

      const congratsMessage = await safeCoachReply(
        input.app,
        `O aluno ${student.name} finalizou o treino sem monitoramento. Parabenize de forma breve e motivadora (1-2 linhas).`,
        `Treino finalizado! Parabéns, ${student.name}! Continue assim! 🔥💪`,
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🎉 ${congratsMessage}`,
      });

      // Enviar relatório ao personal
      await sendReportToPersonal({
        app: input.app,
        instanceName: input.instance,
        personalId: student.personal_id,
        studentName: student.name,
        tracking,
        monitoredSummary: "",
      });

      await updateState(whatsapp, {
        current_state: "IDLE",
        current_session_id: null,
        current_workout_exercise_id: null,
        current_set_number: 1,
        last_input_attempt: null,
      });
      return;
    }

    // Mensagem desconhecida no treino livre — lembrete amigável
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Pode continuar treinando! Quando finalizar, manda *finalizei* ou *terminei o treino*. 💪",
    });
    return;
  }

  // Estado: COLLECTING_SESSION_RPE (modo per_workout — coleta PSE geral ao final)
  if (state.current_state === "COLLECTING_SESSION_RPE") {
    const pse = parseInt(effectiveInput.trim(), 10);

    if (Number.isNaN(pse) || pse < 1 || pse > 10) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Me manda um número de 1 a 10 para registrar o PSE do treino! 😊",
      });
      return;
    }

    const sessionId = state.current_session_id;

    let sessionTracking: SessionTrackingData | null = null;
    if (sessionId) {
      const { data: sr } = await supabaseAdmin
        .from("daily_sessions")
        .select("summary")
        .eq("id", sessionId)
        .maybeSingle();
      try {
        const parsed = JSON.parse((sr as any)?.summary ?? "null");
        if (parsed?.type === "tracking") sessionTracking = parsed;
      } catch {}
    }

    const extrato = buildSimpleExerciseList(
      sessionTracking ?? {
        type: "tracking",
        mode: "unmonitored",
        tracking_mode: "per_workout",
        session_date: null,
        all_ids: [],
        remaining_ids: [],
        done: [],
        exercise_details: {},
      },
      pse,
      state.current_workout_exercise_id,
    );

    const personalReport = buildPersonalReport(
      student.name,
      sessionTracking,
      extrato,
    );

    if (sessionId) {
      await completeSession(sessionId, personalReport);
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

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: extrato,
    });

    await sendReportToPersonal({
      app: input.app,
      instanceName: input.instance,
      personalId: student.personal_id,
      studentName: student.name,
      tracking: sessionTracking,
      monitoredSummary: extrato,
    });

    await updateState(whatsapp, {
      current_state: "IDLE",
      current_session_id: null,
      current_workout_exercise_id: null,
      current_set_number: 1,
      last_input_attempt: null,
    });
    return;
  }

  // Estado: EXECUTING_SET
  if (state.current_state === "EXECUTING_SET") {
    if (isSetDoneIntent(effectiveInput)) {
      const tracking = await getSessionTrackingData(state.current_session_id);
      const trackingMode = tracking?.tracking_mode ?? "per_exercise";

      if (trackingMode === "per_workout" || trackingMode === "none") {
        // Sem coleta de reps/carga por série: só progressão e descanso.
        await advanceAfterSetLog({
          app: input.app,
          instanceName: input.instance,
          whatsapp,
          student,
          state,
        });
        return;
      }

      if (
        trackingMode === "per_exercise" &&
        state.current_workout_exercise_id
      ) {
        const { data: exRow } = await supabaseAdmin
          .from("workout_exercises")
          .select("target_sets")
          .eq("id", state.current_workout_exercise_id)
          .maybeSingle();
        const targetSets = Number((exRow as any)?.target_sets ?? 1);

        if (state.current_set_number < targetSets) {
          // Ainda há séries: segue sem perguntar reps/carga agora.
          await advanceAfterSetLog({
            app: input.app,
            instanceName: input.instance,
            whatsapp,
            student,
            state,
          });
          return;
        }

        // Última série do exercício: coleta batch de reps e carga no final do exercício.
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `✅ Exercício concluído!\n\nMe manda as repetições de cada série no formato *12 11 10* (${targetSets} séries).`,
        });
        await updateState(whatsapp, {
          current_state: "COLLECTING_REPS",
          last_input_attempt: `exercise_reps_batch:${targetSets}`,
        });
        return;
      }

      // per_rep: pergunta reps e carga por série.
      let restStartNotice = "";
      if (state.current_workout_exercise_id) {
        const { data: exRow } = await supabaseAdmin
          .from("workout_exercises")
          .select("target_sets,rest_seconds")
          .eq("id", state.current_workout_exercise_id)
          .maybeSingle();

        const targetSets = Number((exRow as any)?.target_sets ?? 0);
        const restSeconds = Number((exRow as any)?.rest_seconds ?? 0);
        const nextSet = state.current_set_number + 1;

        if (nextSet <= targetSets && restSeconds > 0) {
          const restEndAt = new Date(
            Date.now() + restSeconds * 1000,
          ).toISOString();
          await updateState(whatsapp, {
            current_state: "COLLECTING_REPS",
            rest_end_at: restEndAt,
          });
          restStartNotice = `\n\n⏱ Descanso iniciado: *${restSeconds}s*.`;
        }
      }

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🔥 Me manda as repetições desta série.${restStartNotice}`,
      });

      if (!restStartNotice) {
        await updateState(whatsapp, { current_state: "COLLECTING_REPS" });
      }
      return;
    } else {
      // Input não reconhecido em EXECUTING_SET — orientar o aluno sem cair no fallback genérico
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `💪 Quando terminar a série, é só mandar *feito* (ou ok, pronto, sim, done...). Para pausar o treino, manda *parar*.`,
      });
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
      // Timer vencido — transição inline, funciona mesmo sem pg_cron configurado
      await fireExpiredRest(input.app, state, input.instance);
    }
    return;
  }

  // Estado: COLLECTING_REPS
  if (state.current_state === "COLLECTING_REPS") {
    if (state.last_input_attempt?.startsWith("exercise_reps_batch:")) {
      const targetSets = Number(
        state.last_input_attempt.replace("exercise_reps_batch:", ""),
      );
      const repsList = effectiveInput
        .trim()
        .replace(/[,;]+/g, " ")
        .split(/\s+/)
        .map((v) => parseInt(v, 10));

      if (
        !Number.isFinite(targetSets) ||
        targetSets < 1 ||
        repsList.length !== targetSets ||
        repsList.some((r) => Number.isNaN(r) || r <= 0 || r > 1000)
      ) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `Me manda exatamente ${targetSets} números de repetições, um por série.\nExemplo: *12 11 10*`,
        });
        return;
      }

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Perfeito! Agora me manda a carga usada em kg.",
      });

      await updateState(whatsapp, {
        current_state: "COLLECTING_WEIGHT",
        last_input_attempt: `exercise_reps_values:${repsList.join(",")}`,
      });
      return;
    }

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
      text: `${reps} repetições anotadas! 💪\n\nAgora me manda a carga usada em kg.`,
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

    if (state.last_input_attempt?.startsWith("exercise_reps_values:")) {
      // Modo per_exercise: verifica se deve pedir PSE (só se trackingMode suportar)
      let tMode: string = "per_exercise";
      if (state.current_session_id) {
        const { data: srPE } = await supabaseAdmin
          .from("daily_sessions")
          .select("summary")
          .eq("id", state.current_session_id)
          .maybeSingle();
        try {
          const parsedPE = JSON.parse((srPE as any)?.summary ?? "null");
          if (parsedPE?.type === "tracking" && parsedPE?.tracking_mode) {
            tMode = parsedPE.tracking_mode;
          }
        } catch {}
      }

      if (tMode === "per_exercise") {
        // PSE ao final do exercício (comportamento correto para per_exercise)
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Ótimo! Agora me manda o PSE desse exercício (de *1 a 10*).",
        });
        await updateState(whatsapp, {
          current_state: "COLLECTING_RPE",
          last_input_attempt: `${state.last_input_attempt}|${weight}`,
        });
        return;
      }

      // Modos per_workout, none, per_rep: salva sem PSE e avança
      const packed = state.last_input_attempt.replace("exercise_reps_values:", "");
      const csvReps = packed.split("|")[0];
      const repsList = csvReps
        .split(",")
        .map((v) => parseInt(v, 10))
        .filter((v) => Number.isFinite(v));
      if (state.current_session_id && state.current_workout_exercise_id) {
        for (let i = 0; i < repsList.length; i++) {
          await saveSetLog({
            sessionId: state.current_session_id,
            workoutExerciseId: state.current_workout_exercise_id,
            setNumber: i + 1,
            repsDone: repsList[i],
            weightUsed: weight,
            pseScore: null,
          });
        }
      }
      await advanceAfterSetLog({
        app: input.app,
        instanceName: input.instance,
        whatsapp,
        student,
        state,
      });
      return;
    }

    const [repsStr] = (state.last_input_attempt ?? "0").split("|");
    const reps = parseInt(repsStr, 10);

    let trackingMode: "per_rep" | "per_exercise" | "per_workout" | "none" =
      "per_exercise";
    if (state.current_session_id) {
      const { data: sr } = await supabaseAdmin
        .from("daily_sessions")
        .select("summary")
        .eq("id", state.current_session_id)
        .maybeSingle();
      try {
        const parsed = JSON.parse((sr as any)?.summary ?? "null");
        if (parsed?.type === "tracking" && parsed?.tracking_mode) {
          trackingMode = parsed.tracking_mode;
        }
      } catch {}
    }

    // PSE por modo de acompanhamento:
    // - per_rep: registra reps+peso por série, SEM PSE (PSE seria excessivo por série)
    // - per_exercise: PSE apenas na última série do exercício
    // - per_workout: PSE apenas ao final do treino completo (nunca por série)
    // - none: sem PSE
    let collectPseNow = false;
    if (trackingMode === "per_exercise" && state.current_workout_exercise_id) {
      const { data: exRow } = await supabaseAdmin
        .from("workout_exercises")
        .select("target_sets")
        .eq("id", state.current_workout_exercise_id)
        .maybeSingle();
      const targetSets = Number((exRow as any)?.target_sets ?? 1);
      collectPseNow = state.current_set_number >= targetSets;
    }

    if (collectPseNow) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Perfeito! Agora me manda o PSE deste exercício (de *1 a 10*).",
      });

      await updateState(whatsapp, {
        current_state: "COLLECTING_RPE",
        last_input_attempt: `${state.last_input_attempt}|${weight}`,
      });
      return;
    }

    if (state.current_session_id && state.current_workout_exercise_id) {
      await saveSetLog({
        sessionId: state.current_session_id,
        workoutExerciseId: state.current_workout_exercise_id,
        setNumber: state.current_set_number,
        repsDone: reps,
        weightUsed: weight,
        pseScore: null,
      });
    }

    await advanceAfterSetLog({
      app: input.app,
      instanceName: input.instance,
      whatsapp,
      student,
      state,
    });
    return;
  }

  // Estado: COLLECTING_RPE
  if (state.current_state === "COLLECTING_RPE") {
    const pse = parseInt(effectiveInput.trim(), 10);

    if (Number.isNaN(pse) || pse < 1 || pse > 10) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Me manda um número de 1 a 10 para registrar o PSE! 😊",
      });
      return;
    }

    if (state.last_input_attempt?.startsWith("exercise_reps_values:")) {
      const packed = state.last_input_attempt.replace(
        "exercise_reps_values:",
        "",
      );
      const [csvReps, weightStr] = packed.split("|");
      const repsList = csvReps
        .split(",")
        .map((v) => parseInt(v, 10))
        .filter((v) => Number.isFinite(v));
      const weight = parseFloat(weightStr);

      if (state.current_session_id && state.current_workout_exercise_id) {
        for (let i = 0; i < repsList.length; i++) {
          await saveSetLog({
            sessionId: state.current_session_id,
            workoutExerciseId: state.current_workout_exercise_id,
            setNumber: i + 1,
            repsDone: repsList[i],
            weightUsed: weight,
            pseScore: pse,
          });
        }
      }

      await advanceAfterSetLog({
        app: input.app,
        instanceName: input.instance,
        whatsapp,
        student,
        state,
      });
      return;
    }

    // Recuperar reps e weight
    const [repsStr, weightStr] = (state.last_input_attempt ?? "0|0").split("|");
    const reps = parseInt(repsStr, 10);
    const weight = parseFloat(weightStr);

    if (state.current_session_id && state.current_workout_exercise_id) {
      await saveSetLog({
        sessionId: state.current_session_id,
        workoutExerciseId: state.current_workout_exercise_id,
        setNumber: state.current_set_number,
        repsDone: reps,
        weightUsed: weight,
        pseScore: pse,
      });
    }

    await advanceAfterSetLog({
      app: input.app,
      instanceName: input.instance,
      whatsapp,
      student,
      state,
    });
    return;
  }

  // Bot responde a qualquer mensagem recebida com uma resposta amigável
  if (student) {
    if (state.current_state !== "IDLE") {
      await logBotAnomaly(input.app, {
        severity: "warn",
        category: "state",
        code: "unexpected_fallback_in_non_idle_state",
        message:
          "Fluxo caiu no fallback final mesmo com estado não-IDLE (possível transição não tratada).",
        whatsapp_number: whatsapp,
        student_id: student.id,
        session_id: state.current_session_id,
        current_state: state.current_state,
        input_excerpt: inputExcerpt,
      });
    }

    const reply = await safeCoachReply(
      input.app,
      `O aluno ${student.name} enviou a mensagem: "${effectiveInput}". Responda brevemente (1-2 linhas) de forma amigável e motivadora, convidando para iniciar com opções: 1 para começar treino agora e 2 para deixar para depois.`,
      buildFriendlyStartPrompt(student.name),
    );

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: reply,
    });
  }
  return;
}

/**
 * Processa a transição de RESTING para EXECUTING_SET para um único aluno.
 * Chamado tanto inline (quando o aluno envia mensagem com timer vencido)
 * quanto por polling (scheduler interno e/ou pg_cron) via processExpiredRestTimers.
 */
async function fireExpiredRest(
  app: FastifyInstance,
  state: BotStateRow,
  instanceName: string,
): Promise<void> {
  const hint = state.last_input_attempt ?? "";

  if (hint.startsWith("rest:next_set:")) {
    const nextSet = parseInt(hint.replace("rest:next_set:", ""), 10);

    const { data: exRow } = await supabaseAdmin
      .from("workout_exercises")
      .select(
        "target_sets,exercise_catalog(name),exercise_variations(name),exercises(name)",
      )
      .eq("id", state.current_workout_exercise_id!)
      .single();

    const exCatalog = Array.isArray((exRow as any)?.exercise_catalog)
      ? (exRow as any).exercise_catalog[0]
      : (exRow as any)?.exercise_catalog;
    const exVariation = Array.isArray((exRow as any)?.exercise_variations)
      ? (exRow as any).exercise_variations[0]
      : (exRow as any)?.exercise_variations;
    const legacyExercise = Array.isArray((exRow as any)?.exercises)
      ? (exRow as any).exercises[0]
      : (exRow as any)?.exercises;
    const exerciseBaseName =
      exCatalog?.name ?? legacyExercise?.name ?? "Exercício";
    const exerciseName = exVariation?.name
      ? `${exerciseBaseName} - ${exVariation.name}`
      : exerciseBaseName;
    const targetSets = (exRow as any)?.target_sets ?? nextSet;

    await updateState(state.whatsapp_number, {
      current_state: "EXECUTING_SET",
      current_set_number: nextSet,
      rest_end_at: null,
      last_input_attempt: null,
    });

    await sendTextMessage({
      instanceName,
      number: state.whatsapp_number,
      text: `✅ Fim do descanso! Vamos lá? 💪\n\n*${exerciseName}* — Série ${nextSet}/${targetSets}`,
    });
  } else if (hint.startsWith("rest:next_exercise:")) {
    const nextExerciseId = hint.replace("rest:next_exercise:", "");

    const { data: exRow } = await supabaseAdmin
      .from("workout_exercises")
      .select(
        "target_sets,target_reps,target_weight,order_index,exercise_id,exercise_catalog_id,exercise_variation_id,equipment_id,grip_footing_id,method_id,custom_description,exercise_catalog(name,muscle_groups(name)),exercise_variations(name),equipment_catalog(name),grip_footing_catalog(name),method_catalog(name),exercises(name,muscle_group,equipment,description)",
      )
      .eq("id", nextExerciseId)
      .single();

    if (!exRow) {
      app.log.warn(
        { nextExerciseId },
        "fireExpiredRest: next exercise not found, clearing RESTING state",
      );
      // Limpa o estado RESTING para não deixar o aluno travado
      await updateState(state.whatsapp_number, {
        current_state: "EXECUTING_SET",
        rest_end_at: null,
        last_input_attempt: null,
      });
      await sendTextMessage({
        instanceName,
        number: state.whatsapp_number,
        text: "✅ Descanso concluído! Continue com o próximo exercício do seu treino. 💪",
      });
      return;
    }

    const ex = exRow as any;
    const catalog = Array.isArray(ex.exercise_catalog)
      ? ex.exercise_catalog[0]
      : ex.exercise_catalog;
    const variation = Array.isArray(ex.exercise_variations)
      ? ex.exercise_variations[0]
      : ex.exercise_variations;
    const equipment = Array.isArray(ex.equipment_catalog)
      ? ex.equipment_catalog[0]
      : ex.equipment_catalog;
    const gripFooting = Array.isArray(ex.grip_footing_catalog)
      ? ex.grip_footing_catalog[0]
      : ex.grip_footing_catalog;
    const method = Array.isArray(ex.method_catalog)
      ? ex.method_catalog[0]
      : ex.method_catalog;
    const exercise = Array.isArray(ex.exercises)
      ? ex.exercises[0]
      : ex.exercises;

    const baseName = catalog?.name ?? exercise?.name ?? "Exercício";
    const variationName = variation?.name ?? null;
    const exerciseName = variationName
      ? `${baseName} - ${variationName}`
      : baseName;
    const catalogMuscleGroup = Array.isArray(catalog?.muscle_groups)
      ? catalog?.muscle_groups[0]
      : catalog?.muscle_groups;

    const nextExercise: WorkoutExercise = {
      id: nextExerciseId,
      exercise_id: ex.exercise_id,
      exercise_catalog_id: ex.exercise_catalog_id ?? null,
      exercise_variation_id: ex.exercise_variation_id ?? null,
      equipment_id: ex.equipment_id ?? null,
      grip_footing_id: ex.grip_footing_id ?? null,
      method_id: ex.method_id ?? null,
      exercise_name: exerciseName,
      variation_name: variationName,
      muscle_group: catalogMuscleGroup?.name ?? exercise?.muscle_group ?? null,
      equipment: equipment?.name ?? exercise?.equipment ?? null,
      equipment_name: equipment?.name ?? null,
      grip_footing_name: gripFooting?.name ?? null,
      method_name: method?.name ?? null,
      description: ex.custom_description ?? exercise?.description ?? null,
      custom_description: ex.custom_description ?? null,
      target_sets: ex.target_sets,
      target_reps: ex.target_reps,
      target_weight: ex.target_weight ?? null,
      order_index: ex.order_index,
      rest_seconds: null,
    };

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
      text: `✅ Fim do descanso! Próximo exercício:\n\n*${nextExercise.exercise_name}*\n${formatExerciseDetails(nextExercise)}`,
    });
  } else {
    // hint desconhecido — limpa o estado para não ficar travado
    app.log.warn(
      { hint, whatsapp: state.whatsapp_number },
      "fireExpiredRest: unknown hint, resetting to EXECUTING_SET",
    );
    await updateState(state.whatsapp_number, {
      current_state: "EXECUTING_SET",
      rest_end_at: null,
      last_input_attempt: null,
    });
    await sendTextMessage({
      instanceName,
      number: state.whatsapp_number,
      text: "✅ Descanso concluído! Pode continuar com a próxima série. 💪",
    });
  }
}

/**
 * Gerencia inatividade de sessões em andamento.
 *
 * Regras:
 * - 60 min sem atividade → envia mensagem de check-in ("Você ainda está aí?")
 *   Sinaliza com last_input_attempt = "inactivity:warned:<timestamp>"
 * - 90 min sem atividade (ou 30 min após o aviso) → encerra o treino automaticamente
 *
 * Chamado pelo polling do rest-timer a cada ciclo (pg_cron 3s).
 */
export async function processInactiveTrainingSessions(
  app: FastifyInstance,
): Promise<void> {
  const now = Date.now();
  const WARN_AFTER_MS  = 60 * 60 * 1000; // 60 minutos
  const CLOSE_AFTER_MS = 90 * 60 * 1000; // 90 minutos

  // Busca estados com sessão ativa e last_activity_at disponível
  const { data: activeStates, error } = await supabaseAdmin
    .from("bot_state")
    .select(
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt,rest_end_at,last_activity_at",
    )
    .not("current_session_id", "is", null)
    .not("last_activity_at", "is", null);

  if (error) {
    app.log.error(error, "processInactiveTrainingSessions: query failed");
    return;
  }

  if (!activeStates || activeStates.length === 0) return;

  const instanceName = getUnifiedEvolutionInstanceName();

  for (const raw of activeStates) {
    const state = raw as BotStateRow;

    // Ignorar estados que não representam treino ativo
    if (
      state.current_state === "IDLE" ||
      state.current_state === "AWAITING_WORKOUT_SELECTION" ||
      state.current_state === "AWAITING_TRAINING_START"
    ) {
      continue;
    }

    const lastActivity = new Date(state.last_activity_at!).getTime();
    const elapsedMs = now - lastActivity;

    // Verificar se já foi encerrado (aviso já emitido e ainda inativo)
    const alreadyWarned = (state.last_input_attempt ?? "").startsWith(
      "inactivity:warned:",
    );

    if (elapsedMs >= CLOSE_AFTER_MS) {
      // 90 minutos — encerrar treino automaticamente
      app.log.info(
        { whatsapp: state.whatsapp_number, elapsedMin: Math.round(elapsedMs / 60000) },
        "processInactiveTrainingSessions: auto-closing session after 90min inactivity",
      );

      const student = await getStudentByWhatsapp(state.whatsapp_number);
      if (!student) {
        // Sem aluno — só limpa o estado
        await supabaseAdmin
          .from("bot_state")
          .update({
            current_state: "IDLE",
            current_session_id: null,
            current_workout_exercise_id: null,
            current_set_number: 1,
            last_input_attempt: null,
            rest_end_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("whatsapp_number", state.whatsapp_number);
        continue;
      }

      try {
        // Mensagem de encerramento automático
        await sendTextMessage({
          instanceName,
          number: state.whatsapp_number,
          text: "Pelo visto seu treino já deve ter terminado. Vou encerrar aqui. Bom descanso. 💤",
        });

        // Encerrar treino (gera extrato e notifica personal)
        await finishTrainingEarly({
          app,
          instanceName,
          whatsapp: state.whatsapp_number,
          student: { name: student.name, personal_id: student.personal_id },
          state,
          trigger: "explicit_command",
        });
      } catch (err) {
        app.log.error(
          err,
          `processInactiveTrainingSessions: failed to close session for ${state.whatsapp_number}`,
        );
      }

    } else if (elapsedMs >= WARN_AFTER_MS && !alreadyWarned) {
      // 60 minutos — enviar check-in (apenas uma vez)
      app.log.info(
        { whatsapp: state.whatsapp_number, elapsedMin: Math.round(elapsedMs / 60000) },
        "processInactiveTrainingSessions: sending 60min inactivity check-in",
      );

      try {
        await sendTextMessage({
          instanceName,
          number: state.whatsapp_number,
          text: "Oi! Você ainda está aí? 👀",
        });

        // Marcar que o aviso foi enviado (sem alterar last_activity_at)
        await supabaseAdmin
          .from("bot_state")
          .update({
            last_input_attempt: `inactivity:warned:${new Date().toISOString()}`,
            updated_at: new Date().toISOString(),
            // NÃO atualizar last_activity_at aqui para não resetar o contador
          })
          .eq("whatsapp_number", state.whatsapp_number);
      } catch (err) {
        app.log.error(
          err,
          `processInactiveTrainingSessions: failed to send check-in for ${state.whatsapp_number}`,
        );
      }
    }
  }
}


/**
 * Dispara timers de descanso vencidos.
 * Chamado por polling em segundo plano (scheduler interno ou pg_cron).
 * Retorna a quantidade de timers processados.
 */
export async function processExpiredRestTimers(
  app: FastifyInstance,
): Promise<number> {
  const { data: expiredStates, error } = await supabaseAdmin
    .from("bot_state")
    .select(
      "whatsapp_number,student_id,current_state,current_set_number,current_workout_exercise_id,current_session_id,last_input_attempt,rest_end_at",
    )
    .in("current_state", [
      "RESTING",
      "COLLECTING_REPS",
      "COLLECTING_WEIGHT",
      "COLLECTING_RPE",
    ])
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
      const { data: studentRow } = await supabaseAdmin
        .from("students")
        .select("id")
        .eq("id", state.student_id)
        .single();

      if (!studentRow) continue;

      const instanceName = getUnifiedEvolutionInstanceName();

      if (state.current_state === "RESTING") {
        await fireExpiredRest(app, state, instanceName);
      } else {
        // No per_rep, o descanso pode terminar enquanto o aluno ainda informa reps/carga/PSE.
        // Apenas limpa rest_end_at para evitar repetição em cada poll.
        await updateState(state.whatsapp_number, {
          rest_end_at: null,
        });
      }
      processed++;
    } catch (err) {
      app.log.error(
        err,
        `processExpiredRestTimers: failed for ${state.whatsapp_number}`,
      );
    }
  }

  return processed;
}
