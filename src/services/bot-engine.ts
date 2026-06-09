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

function isTrainingDoneIntent(msg: string): boolean {
  const n = msg.toLowerCase().trim();
  return /^(finali[zs]ei|terminei o treino|acabei o treino|treino finalizado|treino concluido|treino concluído|fim do treino)/.test(
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

async function getPersonalWhatsapp(personalId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("personals")
    .select("whatsapp_number")
    .eq("id", personalId)
    .maybeSingle();
  return (data as any)?.whatsapp_number ?? null;
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
    reps_done: params.repsDone,
    weight_used: params.weightUsed,
    rpe_score: params.pseScore,
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

  const today = new Date(`${sessionRow.date}T00:00:00`).toLocaleDateString(
    "pt-BR",
  );
  const lines: string[] = [`📊 *EXTRATO DO TREINO — ${today}*`, ""];

  sorted.forEach((ex, i) => {
    lines.push(`*${i + 1}. ${ex.name}*`);
    for (const s of ex.sets as any[]) {
      lines.push(
        `   Série ${s.set_number}: ${s.reps_done} reps × ${s.weight_used}kg | PSE ${s.rpe_score ?? "-"}`,
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
 * Lê o tracking_mode configurado pelo personal para o par aluno+treino.
 * Retorna 'per_rep' como fallback (compatibilidade retroativa).
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
    return mode;
  }
  return "per_rep";
}

/**
 * Monta extrato simples com lista de exercícios concluídos (sem dados de série).
 * Usado pelos modos per_workout e none.
 */
function buildSimpleExerciseList(
  tracking: SessionTrackingData,
  overallPse?: number,
): string {
  const today = new Date().toLocaleDateString("pt-BR");
  const sorted = [...(tracking.done ?? [])].sort(
    (a, b) => a.exec_order - b.exec_order,
  );

  const lines: string[] = [`📋 *EXERCÍCIOS REALIZADOS — ${today}*`, ""];

  if (sorted.length === 0) {
    lines.push("Nenhum exercício registrado.");
  } else {
    for (const ex of sorted) {
      lines.push(`✅ ${ex.exec_order}. ${ex.name}`);
    }
  }

  lines.push("");
  if (overallPse !== undefined) {
    lines.push(
      `Total: ${sorted.length} exercício${sorted.length !== 1 ? "s" : ""} | Esforço geral (PSE): ${overallPse}/10`,
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
 */
function buildExerciseSelectionMenu(
  tracking: SessionTrackingData,
  headerText: string,
): string {
  const list = tracking.remaining_ids
    .map((id, i) => {
      const det = tracking.exercise_details[id];
      return `${i + 1}️⃣ *${det.name}*${det.muscle ? ` (${det.muscle})` : ""} — ${det.sets}×${det.reps}`;
    })
    .join("\n");

  return `${headerText}\n\n${list}\n0️⃣ *[Encerrar treino]*\n\nResponda com o *número*.`;
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
      description: string | null;
      sets: number;
      reps: number;
      weight: number | null;
      rest: number | null;
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
  const trackingMode = tracking?.tracking_mode ?? "per_rep";

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

  const report = buildPersonalReport(
    params.studentName,
    params.tracking,
    params.monitoredSummary,
  );

  try {
    await sendTextMessage({
      instanceName: params.instanceName,
      number: personalWhatsapp,
      text: `📬 *Relatório automático — ${params.studentName}*\n\n${report}`,
    });
  } catch (err) {
    params.app.log.error(err, "sendReportToPersonal: failed to send message");
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
    .select("target_sets,exercise_id,rest_seconds,exercises(name)")
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

  const targetSets = exerciseResult.data.target_sets;
  const exerciseName = Array.isArray(exerciseResult.data.exercises)
    ? exerciseResult.data.exercises[0]?.name
    : ((exerciseResult.data.exercises as any)?.name ?? "Exercício");
  const restSeconds: number | null =
    (exerciseResult.data as any).rest_seconds ?? null;
  const nextSet = state.current_set_number + 1;

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
          text: `🔥 Série ${state.current_set_number}/${targetSets} concluída! Boa!\n\n⏱ Descanso já em andamento: faltam ~*${remaining}s*. Vou te avisar quando acabar! 💪`,
        });
      } else if (startedRestEndMs > 0) {
        await sendTextMessage({
          instanceName,
          number: whatsapp,
          text: `🔥 Série ${state.current_set_number}/${targetSets} concluída!\n\n✅ O descanso já terminou. Bora para a próxima série! Quando terminar a série ${nextSet}, me manda *feito* ✅`,
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
          text: `🔥 Série ${state.current_set_number}/${targetSets} concluída! Boa!\n\n⏱ Iniciando descanso de *${restSeconds}s*. Vou te avisar quando acabar! 💪`,
        });
      }
    } else {
      await sendTextMessage({
        instanceName,
        number: whatsapp,
        text: `🔥 Série ${state.current_set_number}/${targetSets} concluída!\n\nDescanso e vamos para a próxima! Quando terminar a série ${nextSet}, me manda *feito* ✅`,
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

  if (exerciseTracking?.mode === "monitored_free") {
    // Modo livre: atualizar tracking e voltar para seleção de exercício
    const done = exerciseTracking.done ?? [];
    done.push({
      id: state.current_workout_exercise_id!,
      name: exerciseName,
      exec_order: done.length + 1,
    });
    const remaining = exerciseTracking.remaining_ids.filter(
      (id) => id !== state.current_workout_exercise_id,
    );
    exerciseTracking.done = done;
    exerciseTracking.remaining_ids = remaining;

    if (remaining.length === 0) {
      // Todos os exercícios concluídos!
      let workoutSummary = "";
      try {
        workoutSummary = await buildWorkoutSummary(state.current_session_id!);
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

    // Ainda há exercícios restantes
    await supabaseAdmin
      .from("daily_sessions")
      .update({ summary: JSON.stringify(exerciseTracking) })
      .eq("id", state.current_session_id!);

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
        text: `✅ ${exerciseName} concluído!\n\n🔸 Próximo: *${nextExercise.exercise_name}*\n${formatExerciseDetails(nextExercise)}\n\nQuando estiver pronto, me manda *feito* ✅`,
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
          rest_end_at: null,
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
    const optionsRaw = state.last_input_attempt?.startsWith("workout_options:")
      ? state.last_input_attempt.replace("workout_options:", "")
      : "";
    const optionIds = optionsRaw
      .split("|")
      .map((id) => id.trim())
      .filter(Boolean);

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
              description: e.description,
              sets: e.target_sets,
              reps: e.target_reps,
              weight: e.target_weight,
              rest: e.rest_seconds,
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

      const menuText = buildExerciseSelectionMenu(
        trackingData,
        `🏋️ *${workout.name}*\n\n*Escolha por qual exercício quer começar:*`,
      );

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: menuText,
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

  // Estado: AWAITING_MONITORING_CHOICE
  if (state.current_state === "AWAITING_MONITORING_CHOICE") {
    const sessionId = state.current_session_id;
    if (!sessionId) {
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

    if (!tracking) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Ocorreu um erro ao carregar o treino. Tente *iniciar treino* novamente. 😅",
      });
      await updateState(whatsapp, {
        current_state: "IDLE",
        current_session_id: null,
      });
      return;
    }

    if (isConfirmIntent(effectiveInput)) {
      // Monitoramento ativo — fluxo de ordem livre
      tracking.mode = "monitored_free";
      await supabaseAdmin
        .from("daily_sessions")
        .update({ summary: JSON.stringify(tracking) })
        .eq("id", sessionId);

      const remainingList = tracking.remaining_ids
        .map((id, i) => {
          const det = tracking!.exercise_details[id];
          return `${i + 1}️⃣ *${det.name}*${det.muscle ? ` (${det.muscle})` : ""} — ${det.sets}×${det.reps}`;
        })
        .join("\n");

      await updateState(whatsapp, {
        current_state: "AWAITING_EXERCISE_ORDER_SELECTION",
        last_input_attempt: null,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `✅ Ótimo! Vamos monitorar cada série!\n\n*Escolha por qual exercício quer começar:*\n\n${remainingList}\n\nResponda com o *número* do exercício.`,
      });
      return;
    }

    if (isCancelIntent(effectiveInput)) {
      // Sem monitoramento — modo passivo
      tracking.mode = "unmonitored";
      await supabaseAdmin
        .from("daily_sessions")
        .update({ summary: JSON.stringify(tracking) })
        .eq("id", sessionId);

      await updateState(whatsapp, {
        current_state: "UNMONITORED_TRAINING",
        last_input_attempt: null,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Entendido! Me avise quando finalizar o treino. 💪\n\nQuando terminar, manda *finalizei* ou *terminei o treino*.",
      });
      return;
    }

    // Resposta inválida
    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Responda *1* para monitorar em tempo real ou *2* para treinar sem monitoramento.",
    });
    return;
  }

  // Estado: AWAITING_EXERCISE_ORDER_SELECTION
  if (state.current_state === "AWAITING_EXERCISE_ORDER_SELECTION") {
    const sessionId = state.current_session_id;
    if (!sessionId) {
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
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Ocorreu um erro ao carregar os exercícios. Tente *iniciar treino* novamente. 😅",
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
      const trackingMode = tracking.tracking_mode ?? "per_rep";
      if (trackingMode === "per_workout") {
        // Pedir PSE geral do treino
        await updateState(whatsapp, {
          current_state: "COLLECTING_SESSION_RPE",
          last_input_attempt: null,
        });
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Treino encerrado! Antes de finalizar, qual foi o PSE geral do treino?\n\nResponda com um número de *1 a 10*:\n1-5 - Leve\n6-7 - Moderado\n8-9 - Intenso\n10 - Máximo 🔥",
        });
        return;
      }

      // per_rep, per_exercise ou none: finalizar com extrato imediato
      const extrato = buildSimpleExerciseList(tracking);
      const congratsMessage = await safeCoachReply(
        input.app,
        `O aluno ${student.name} encerrou o treino antecipadamente. Parabenize pelo esforço de forma breve (1-2 linhas).`,
        `Treino encerrado! Ótimo esforço hoje, ${student.name}! Continue assim! 💪`,
      );

      const personalReport = buildPersonalReport(student.name, tracking, "");
      await completeSession(sessionId, personalReport);

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🎉 ${congratsMessage}`,
      });

      if (trackingMode !== "none" || tracking.done.length > 0) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: extrato,
        });
      }

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

    if (
      Number.isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > tracking.remaining_ids.length
    ) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: buildExerciseSelectionMenu(
          tracking,
          `Responda com o número do exercício (1 a ${tracking.remaining_ids.length}) ou 0 para encerrar:`,
        ),
      });
      return;
    }

    const selectedExerciseId = tracking.remaining_ids[selectedNumber - 1];
    const det = tracking.exercise_details[selectedExerciseId];

    // Montar WorkoutExercise a partir do tracking para exibir detalhes
    const selectedExercise: WorkoutExercise = {
      id: selectedExerciseId,
      exercise_id: selectedExerciseId,
      exercise_name: det.name,
      muscle_group: det.muscle,
      equipment: det.equipment,
      description: det.description,
      target_sets: det.sets,
      target_reps: det.reps,
      target_weight: det.weight,
      order_index: 0,
      rest_seconds: det.rest,
    };

    await updateState(whatsapp, {
      current_state: "EXECUTING_SET",
      current_workout_exercise_id: selectedExerciseId,
      current_set_number: 1,
      last_input_attempt: null,
    });

    await sendTextMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: `🔥 *${det.name}*\n${formatExerciseDetails(selectedExercise)}\n\nVamos começar! Quando terminar a série, me manda *feito* ✅`,
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

  // Estado: EXECUTING_SET
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
          restStartNotice = `\n\n⏱ O descanso de *${restSeconds}s* já começou agora. Enquanto isso, me passa os dados desta série.`;
        }
      }

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🔥 Boa! Quantas repetições você conseguiu fazer?${restStartNotice}`,
      });

      if (!restStartNotice) {
        await updateState(whatsapp, { current_state: "COLLECTING_REPS" });
      }
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

    const [repsStr] = (state.last_input_attempt ?? "0").split("|");
    const reps = parseInt(repsStr, 10);

    let trackingMode: "per_rep" | "per_exercise" | "per_workout" | "none" =
      "per_rep";
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

    let collectPseNow = trackingMode === "per_rep";
    if (trackingMode === "per_exercise" && state.current_workout_exercise_id) {
      const { data: exRow } = await supabaseAdmin
        .from("workout_exercises")
        .select("target_sets")
        .eq("id", state.current_workout_exercise_id)
        .maybeSingle();
      const targetSets = Number((exRow as any)?.target_sets ?? 1);
      collectPseNow = state.current_set_number >= targetSets;
    }
    if (trackingMode === "per_workout" || trackingMode === "none") {
      collectPseNow = false;
    }

    if (collectPseNow) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Perfeito! Agora me diz: qual foi o PSE desta série?\n\nResponda com um número de *1 a 10*:\n1-5 - Leve\n6-7 - Moderado\n8-9 - Intenso\n10 - Máximo 🔥",
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

  // Mensagens fora dos fluxos esperados são ignoradas para evitar disparos indevidos.
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
      .select("target_sets,exercises(name)")
      .eq("id", state.current_workout_exercise_id!)
      .single();

    const exerciseName = Array.isArray((exRow as any)?.exercises)
      ? (exRow as any).exercises[0]?.name
      : ((exRow as any)?.exercises?.name ?? "Exercício");
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
      text: `✅ Fim do descanso! Vamos lá? 💪\n\n*${exerciseName}* — Série ${nextSet}/${targetSets}\nQuando terminar, me manda *feito* ✅`,
    });
  } else if (hint.startsWith("rest:next_exercise:")) {
    const nextExerciseId = hint.replace("rest:next_exercise:", "");

    const { data: exRow } = await supabaseAdmin
      .from("workout_exercises")
      .select(
        "target_sets,target_reps,target_weight,order_index,exercise_id,exercises(name,muscle_group,equipment,description)",
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

      await fireExpiredRest(app, state, instanceName);
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
