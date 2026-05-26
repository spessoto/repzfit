import type { FastifyInstance } from "fastify";

import { supabaseAdmin } from "../config/supabase.js";
import { sendButtonsMessage, sendTextMessage } from "./evolution-service.js";
import {
  generateFallbackReply,
  generateBotResponse,
  isTrainingStartIntent,
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
};

type BotStateRow = {
  whatsapp_number: string;
  student_id: string;
  current_state: string;
  current_session_id: string | null;
  current_workout_exercise_id: string | null;
  current_set_number: number;
  last_input_attempt: string | null;
};

type WorkoutExercise = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  target_sets: number;
  target_reps: number;
  target_weight: number | null;
  order_index: number;
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
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt",
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
      "whatsapp_number,student_id,current_state,current_session_id,current_workout_exercise_id,current_set_number,last_input_attempt",
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
 * Busca treinos ativos do aluno para hoje
 */
async function getTodayWorkouts(studentId: string) {
  const today = new Date().getDay(); // 0 = domingo, 6 = sábado

  const { data, error } = await supabaseAdmin
    .from("workouts")
    .select("id,name,day_of_week,start_date,valid_until")
    .eq("student_id", studentId);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Filtrar treinos válidos para hoje
  const validWorkouts = data.filter((workout) => {
    // Verificar data de validade
    const now = new Date();
    if (workout.start_date) {
      const startDate = new Date(workout.start_date);
      if (startDate > now) {
        return false;
      }
    }
    if (workout.valid_until) {
      const validUntil = new Date(workout.valid_until);
      if (validUntil < now) {
        return false;
      }
    }

    // Verificar dia da semana
    if (workout.day_of_week && workout.day_of_week.length > 0) {
      return workout.day_of_week.includes(today);
    }

    return true;
  });

  return validWorkouts.length > 0 ? validWorkouts[0] : null;
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
      exercises (
        name
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
    target_sets: item.target_sets,
    target_reps: item.target_reps,
    target_weight: item.target_weight,
    order_index: item.order_index,
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
    throw error;
  }
}

/**
 * Marca sessão como concluída
 */
async function completeSession(sessionId: string) {
  const { error } = await supabaseAdmin
    .from("daily_sessions")
    .update({ status: "completed" })
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

  // 2. Verificar se é uma mensagem de início de treino ANTES de validar cadastro
  if (isTrainingStartIntent(effectiveInput)) {
    // Verificar se o aluno está cadastrado
    const student = await getStudentByWhatsapp(whatsapp);

    if (!student) {
      // Aluno não cadastrado - enviar mensagem amigável
      const response = await generateBotResponse({
        systemPrompt: COACH_SYSTEM_PROMPT,
        userMessage: `O usuário tentou iniciar um treino mas não está cadastrado no sistema. Explique de forma amigável e breve (2 linhas) que ele precisa ser cadastrado pelo personal trainer antes de usar o sistema.`,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: response,
      });
      return;
    }

    // Aluno cadastrado - buscar treino do dia
    const workout = await getTodayWorkouts(student.id);

    if (!workout) {
      // Sem treino para hoje
      const response = await generateBotResponse({
        systemPrompt: COACH_SYSTEM_PROMPT,
        userMessage: `O aluno ${student.name} quer treinar mas não tem treino programado para hoje. Responda de forma motivadora mas explique que ele precisa falar com o personal para definir um treino.`,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: response,
      });
      return;
    }

    // Tem treino! Iniciar fluxo
    const state = await getOrCreateState(whatsapp, student.id);

    const welcomeMessage = await generateBotResponse({
      systemPrompt: COACH_SYSTEM_PROMPT,
      userMessage: `Saude o aluno ${student.name} de forma animada (1 linha) e pergunte se ele está pronto para começar o treino "${workout.name}". Seja breve e motivador.`,
    });

    await sendButtonsMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: welcomeMessage,
      buttons: [
        { id: "START_TRAINING", text: "💪 Bora começar!" },
        { id: "CANCEL", text: "Agora não" },
      ],
    });

    await updateState(whatsapp, {
      current_state: "AWAITING_TRAINING_START",
    });
    return;
  }

  // 3. A partir daqui, precisa estar cadastrado
  const student = await getStudentByWhatsapp(whatsapp);

  if (!student) {
    input.app.log.info({ whatsapp }, "Unknown student, ignoring message");
    return;
  }

  const state = await getOrCreateState(whatsapp, student.id);

  // === FLUXO DE ESTADOS ===

  // Estado: AWAITING_TRAINING_START
  if (state.current_state === "AWAITING_TRAINING_START") {
    if (effectiveInput === "START_TRAINING") {
      const workout = await getTodayWorkouts(student.id);

      if (!workout) {
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Ops! Parece que o treino não está mais disponível. Fale com seu personal! 😅",
        });
        await updateState(whatsapp, { current_state: "IDLE" });
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
      const targetWeight = firstExercise.target_weight
        ? ` com ${firstExercise.target_weight}kg`
        : "";

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🔥 Sessão iniciada!\n\n*${firstExercise.exercise_name}*\n📊 Meta: ${firstExercise.target_sets}x${firstExercise.target_reps}${targetWeight}\n\nVamos começar a primeira série!`,
      });

      await sendButtonsMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Avise quando terminar a série:",
        buttons: [{ id: "SET_DONE", text: "✅ Terminei!" }],
      });

      await updateState(whatsapp, {
        current_state: "EXECUTING_SET",
        current_session_id: sessionId,
        current_workout_exercise_id: firstExercise.id,
        current_set_number: 1,
      });
      return;
    }

    if (effectiveInput === "CANCEL") {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Sem problemas! Quando quiser treinar, é só me chamar! 💪",
      });
      await updateState(whatsapp, { current_state: "IDLE" });
      return;
    }
  }

  // Estado: EXECUTING_SET
  if (state.current_state === "EXECUTING_SET") {
    if (effectiveInput === "SET_DONE") {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "🔥 Boa! Quantas repetições você conseguiu fazer?",
      });

      await updateState(whatsapp, { current_state: "COLLECTING_REPS" });
      return;
    }
  }

  // Estado: COLLECTING_REPS
  if (state.current_state === "COLLECTING_REPS") {
    const reps = parseInt(effectiveInput, 10);

    if (Number.isNaN(reps) || reps <= 0 || reps > 1000) {
      const fallback = await generateFallbackReply({
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
      const fallback = await generateFallbackReply({
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
    await sendButtonsMessage({
      instanceName: input.instance,
      number: whatsapp,
      text: "Perfeito! Agora me diz: qual foi a dificuldade? (RPE de 1 a 10)",
      buttons: [
        { id: "RPE_6", text: "6 - Fácil" },
        { id: "RPE_7", text: "7 - Tranquilo" },
        { id: "RPE_8", text: "8 - Moderado" },
        { id: "RPE_9", text: "9 - Difícil" },
        { id: "RPE_10", text: "10 - Máximo" },
      ],
    });

    await updateState(whatsapp, {
      current_state: "COLLECTING_RPE",
      last_input_attempt: `${state.last_input_attempt}|${weight}`, // reps|weight
    });
    return;
  }

  // Estado: COLLECTING_RPE
  if (state.current_state === "COLLECTING_RPE") {
    const rpeMatch = effectiveInput.match(/^RPE_(\d+)$/);
    const rpe = rpeMatch ? parseInt(rpeMatch[1], 10) : parseInt(effectiveInput, 10);

    if (Number.isNaN(rpe) || rpe < 1 || rpe > 10) {
      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: "Use os botões acima para escolher o RPE de 1 a 10! 😊",
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
      .select("target_sets,exercise_id,exercises(name)")
      .eq("id", state.current_workout_exercise_id!)
      .single();

    if (exerciseResult.data) {
      const targetSets = exerciseResult.data.target_sets;
      const exerciseName = Array.isArray(exerciseResult.data.exercises) 
        ? exerciseResult.data.exercises[0]?.name 
        : (exerciseResult.data.exercises as any)?.name ?? "Exercício";
      const nextSet = state.current_set_number + 1;

      if (nextSet <= targetSets) {
        // Ainda tem séries para fazer
        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `🔥 Série ${state.current_set_number}/${targetSets} concluída!\n\nDescanso e vamos para a próxima!`,
        });

        await sendButtonsMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `Série ${nextSet}/${targetSets} - Avise quando terminar:`,
          buttons: [{ id: "SET_DONE", text: "✅ Terminei!" }],
        });

        await updateState(whatsapp, {
          current_state: "EXECUTING_SET",
          current_set_number: nextSet,
          last_input_attempt: null,
        });
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
        const targetWeight = nextExercise.target_weight
          ? ` com ${nextExercise.target_weight}kg`
          : "";

        await sendTextMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: `✅ ${exerciseName} concluído!\n\n🔸 Próximo: *${nextExercise.exercise_name}*\n📊 Meta: ${nextExercise.target_sets}x${nextExercise.target_reps}${targetWeight}`,
        });

        await sendButtonsMessage({
          instanceName: input.instance,
          number: whatsapp,
          text: "Quando estiver pronto para começar:",
          buttons: [{ id: "SET_DONE", text: "✅ Começar!" }],
        });

        await updateState(whatsapp, {
          current_state: "EXECUTING_SET",
          current_workout_exercise_id: nextExercise.id,
          current_set_number: 1,
          last_input_attempt: null,
        });
        return;
      }

      // Treino completo!
      if (state.current_session_id) {
        await completeSession(state.current_session_id);
      }

      const congratsMessage = await generateBotResponse({
        systemPrompt: COACH_SYSTEM_PROMPT,
        userMessage: `O aluno ${student.name} acabou de completar o treino! Parabenize de forma entusiasmada e motivadora (2-3 linhas). Celebre a conquista!`,
      });

      await sendTextMessage({
        instanceName: input.instance,
        number: whatsapp,
        text: `🎉 TREINO CONCLUÍDO!\n\n${congratsMessage}`,
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
  }

  // Fallback: mensagem não reconhecida
  const fallbackMessage = await generateBotResponse({
    systemPrompt: COACH_SYSTEM_PROMPT,
    userMessage: `O aluno disse "${effectiveInput}" mas não está em um contexto de treino ativo. Responda de forma amigável (1 linha) e sugira que ele diga "iniciar treino" quando quiser começar.`,
  });

  await sendTextMessage({
    instanceName: input.instance,
    number: whatsapp,
    text: fallbackMessage,
  });
}
