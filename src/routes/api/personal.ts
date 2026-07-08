import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import {
  generateExerciseDescription,
  normalizeExerciseAIDescription,
} from "../../services/gemini-service.js";
import {
  ensureEvolutionWebhook,
  ensureEvolutionInstance,
  getEvolutionConnectionStatus,
  getUnifiedEvolutionInstanceName,
} from "../../services/evolution-service.js";

const StudentCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  whatsapp_number: z
    .string()
    .min(8)
    .max(20)
    .regex(/^[0-9+\s()-]+$/),
  is_active: z.boolean().optional(),
});

const NullableNumberInput = z.union([
  z.number().nonnegative(),
  z.null(),
  z.literal(""),
]);

const StudentPatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    email: z
      .union([z.string().email().max(255), z.null(), z.literal("")])
      .optional(),
    whatsapp_number: z
      .string()
      .min(8)
      .max(20)
      .regex(/^[0-9+\s()-]+$/)
      .optional(),
    blood_type: z
      .union([z.string().max(20), z.null(), z.literal("")])
      .optional(),
    weight_kg: NullableNumberInput.optional(),
    height_cm: NullableNumberInput.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const ExerciseCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  muscle_group: z.string().max(100).optional(),
  equipment: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  gif_url: z.union([z.string().url().max(2048), z.literal("")]).optional(),
});

const ExercisePatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(2000).optional(),
    muscle_group: z.string().max(100).optional(),
    equipment: z.string().max(500).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    gif_url: z.union([z.string().url().max(2048), z.literal("")]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const ExerciseGifUploadUrlSchema = z.object({
  filename: z.string().max(255).optional(),
  content_type: z.string().max(120).optional(),
});

const ExerciseGifFinalizeSchema = z.object({
  storage_path: z.string().min(1).max(1024),
});

const WorkoutCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  start_date: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .optional(),
  day_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  exercises: z
    .array(
      z
        .object({
          exercise_id: z.string().uuid().optional(),
          exercise_variation_id: z.string().uuid().optional(),
          exercise_catalog_id: z.string().uuid().optional(),
          equipment_id: z.string().uuid().optional(),
          custom_description: z
            .union([z.string().max(2000), z.null(), z.literal("")])
            .optional(),
          target_sets: z.number().int().positive().max(100),
          target_reps: z.number().int().positive().max(1000),
          target_weight: z.number().nonnegative().max(1000).optional(),
          order_index: z.number().int().nonnegative().max(100),
          rest_seconds: z
            .number()
            .int()
            .nonnegative()
            .max(3600)
            .nullable()
            .optional(),
        })
        .refine(
          (value) => Boolean(value.exercise_id || value.exercise_variation_id),
          {
            message: "exercise_id or exercise_variation_id must be provided",
          },
        ),
    )
    .max(50)
    .optional(),
});

const WorkoutExerciseCreateSchema = z.object({
  exercise_id: z.string().uuid().optional(),
  exercise_variation_id: z.string().uuid().optional(),
  exercise_catalog_id: z.string().uuid().optional(),
  equipment_id: z.string().uuid().optional(),
  target_sets: z.number().int().positive().max(100),
  target_reps: z.number().int().positive().max(1000),
  target_weight: z.number().nonnegative().max(1000).optional(),
  order_index: z.number().int().nonnegative().max(100),
  rest_seconds: z.number().int().nonnegative().max(3600).nullable().optional(),
  custom_description: z
    .union([z.string().max(2000), z.null(), z.literal("")])
    .optional(),
}).refine((value) => Boolean(value.exercise_id || value.exercise_variation_id), {
  message: "exercise_id or exercise_variation_id must be provided",
});

const WorkoutPatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    start_date: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null(), z.literal("")])
      .optional(),
    day_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const TRACKING_MODE_VALUES = [
  "per_rep",
  "per_exercise",
  "per_workout",
  "none",
] as const;
type TrackingMode = (typeof TRACKING_MODE_VALUES)[number];

const StudentWorkoutAssignSchema = z.object({
  valid_until: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null(), z.literal("")])
    .optional(),
  tracking_mode: z.enum(TRACKING_MODE_VALUES).optional(),
});

const StudentWorkoutPatchSchema = z
  .object({
    valid_until: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null(), z.literal("")])
      .optional(),
    tracking_mode: z.enum(TRACKING_MODE_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const WorkoutExercisePatchSchema = z
  .object({
    target_sets: z.number().int().positive().max(100).optional(),
    target_reps: z.number().int().positive().max(1000).optional(),
    target_weight: z
      .union([z.number().nonnegative().max(1000), z.null(), z.literal("")])
      .optional(),
    order_index: z.number().int().nonnegative().max(100).optional(),
    rest_seconds: z
      .union([z.number().int().nonnegative().max(3600), z.null()])
      .optional(),
    custom_description: z
      .union([z.string().max(2000), z.null(), z.literal("")])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const PersonalProfilePatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    email: z
      .union([z.string().email().max(255), z.null(), z.literal("")])
      .optional(),
    phone: z.union([z.string().max(30), z.null(), z.literal("")]).optional(),
    crf_registration: z
      .union([z.string().max(60), z.null(), z.literal("")])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const STUDENTS_SELECT_FULL =
  "id,personal_id,name,email,whatsapp_number,blood_type,weight_kg,height_cm,is_active,created_at";
const STUDENTS_SELECT_BASE =
  "id,personal_id,name,whatsapp_number,is_active,created_at";
const PERSONAL_SELECT_FULL =
  "id,name,email,evolution_instance_name,phone,crf_registration,created_at";
const PERSONAL_SELECT_BASE = "id,name,email,evolution_instance_name,created_at";

function normalizeBrazilWhatsappNumber(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  let digits = String(raw).trim().replace(/\D+/g, "");
  if (!digits) return null;

  while (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13)
  ) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

function buildCompletedSessionSummaryFromLogs(logs: any[]): string | null {
  if (!Array.isArray(logs) || logs.length === 0) {
    return null;
  }

  const byExercise = new Map<
    string,
    { name: string; order: number; sets: any[] }
  >();

  for (const log of logs) {
    const workoutExerciseId = String(log?.workout_exercise_id ?? "");
    if (!workoutExerciseId) {
      continue;
    }

    const workoutExercise = Array.isArray(log?.workout_exercises)
      ? log.workout_exercises[0]
      : log?.workout_exercises;
    const exerciseRow = Array.isArray(workoutExercise?.exercises)
      ? workoutExercise.exercises[0]
      : workoutExercise?.exercises;
    const exerciseName = String(exerciseRow?.name ?? "Exercício");
    const exerciseOrder = Number(workoutExercise?.order_index ?? 0);

    if (!byExercise.has(workoutExerciseId)) {
      byExercise.set(workoutExerciseId, {
        name: exerciseName,
        order: exerciseOrder,
        sets: [],
      });
    }

    byExercise.get(workoutExerciseId)!.sets.push(log);
  }

  const exercises = Array.from(byExercise.values())
    .map((exercise) => ({
      ...exercise,
      sets: exercise.sets
        .slice()
        .sort(
          (a, b) => Number(a?.set_number ?? 0) - Number(b?.set_number ?? 0),
        ),
    }))
    .sort((a, b) => a.order - b.order);

  if (exercises.length === 0) {
    return null;
  }

  const today = new Date().toLocaleDateString("pt-BR");
  const lines: string[] = [`📊 *EXTRATO DO TREINO — ${today}*`, ""];

  exercises.forEach((exercise, index) => {
    lines.push(`*${index + 1}. ${exercise.name}*`);
    for (const setLog of exercise.sets) {
      const repsDone = Number(setLog?.reps_done ?? 0);
      const weightUsed = Number(setLog?.weight_used ?? 0);
      const pseScore =
        setLog?.rpe_score == null ? "-" : Number(setLog.rpe_score);
      lines.push(
        `   Série ${setLog?.set_number}: ${repsDone} reps × ${weightUsed}kg | PSE ${pseScore}`,
      );
    }
    lines.push("");
  });

  const totalSets = exercises.reduce(
    (acc, exercise) => acc + exercise.sets.length,
    0,
  );
  const totalExercises = exercises.length;
  lines.push(
    `✅ ${totalExercises} exercício${
      totalExercises !== 1 ? "s" : ""
    } | ${totalSets} série${totalSets !== 1 ? "s" : ""} completadas`,
  );

  return lines.join("\n").trimEnd();
}

function isMissingStudentFieldError(error: any): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  const code = String(error?.code ?? "");
  return (
    code === "42703" ||
    msg.includes("column") ||
    msg.includes("email") ||
    msg.includes("blood_type") ||
    msg.includes("weight_kg") ||
    msg.includes("height_cm")
  );
}

function isMissingWeightLogsTableError(error: any): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  const code = String(error?.code ?? "");
  return code === "42p01" || msg.includes("student_weight_logs");
}

function isWhatsappUniqueViolation(error: any): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  return (
    code === "23505" &&
    (msg.includes("whatsapp") || details.includes("whatsapp"))
  );
}

function normalizeStudentRow(row: any) {
  return {
    ...row,
    email: row?.email ?? null,
    blood_type: row?.blood_type ?? null,
    weight_kg: row?.weight_kg ?? null,
    height_cm: row?.height_cm ?? null,
  };
}

function isMissingPersonalFieldError(error: any): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  const code = String(error?.code ?? "");
  return (
    code === "42703" ||
    msg.includes("column") ||
    msg.includes("phone") ||
    msg.includes("crf_registration")
  );
}

function normalizePersonalRow(row: any) {
  return {
    ...row,
    phone: row?.phone ?? null,
    crf_registration: row?.crf_registration ?? null,
  };
}

function normalizeSearchTerm(input: string): string {
  return (
    input
      .trim()
      // Evita quebrar expressão PostgREST no .or(...)
      .replace(/[,%()'\"\\]/g, " ")
      .replace(/\s+/g, " ")
  );
}

function normalizeSearchComparable(input: string): string {
  return normalizeSearchTerm(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenizeSearchTerm(input: string): string[] {
  return normalizeSearchComparable(input)
    .split(" ")
    .map((term) => term.trim())
    .filter(Boolean);
}

function resolveExerciseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || "").trim())
      .filter((tag) => tag.length > 0);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  return [];
}

function matchesExerciseSearch(exercise: any, searchTokens: string[]): boolean {
  if (searchTokens.length === 0) return true;

  const haystack = normalizeSearchComparable(
    [
      exercise?.name,
      exercise?.description,
      exercise?.muscle_group,
      exercise?.equipment,
      ...resolveExerciseTags(exercise?.tags),
    ]
      .filter(Boolean)
      .join(" "),
  );

  return searchTokens.every((token) => haystack.includes(token));
}

function scoreExerciseSearch(
  exercise: any,
  searchTokens: string[],
  normalizedQuery: string,
): number {
  const name = normalizeSearchComparable(exercise?.name ?? "");
  const description = normalizeSearchComparable(exercise?.description ?? "");
  const muscleGroup = normalizeSearchComparable(exercise?.muscle_group ?? "");
  const equipment = normalizeSearchComparable(exercise?.equipment ?? "");
  const tags = resolveExerciseTags(exercise?.tags)
    .map((tag) => normalizeSearchComparable(tag))
    .join(" ");

  const combined = [name, description, muscleGroup, equipment, tags]
    .filter(Boolean)
    .join(" ");

  let score = 0;

  if (normalizedQuery) {
    if (name === normalizedQuery) score += 1000;
    else if (name.startsWith(normalizedQuery)) score += 700;
    else if (name.includes(normalizedQuery)) score += 500;

    if (muscleGroup.includes(normalizedQuery)) score += 220;
    if (equipment.includes(normalizedQuery)) score += 180;
    if (tags.includes(normalizedQuery)) score += 160;
    if (description.includes(normalizedQuery)) score += 80;

    if (combined.includes(normalizedQuery)) score += 120;
  }

  for (const token of searchTokens) {
    if (!token) continue;
    if (name.includes(token)) score += 120;
    if (muscleGroup.includes(token)) score += 95;
    if (equipment.includes(token)) score += 80;
    if (tags.includes(token)) score += 70;
    if (description.includes(token)) score += 35;
  }

  return score;
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw request.server.httpErrors.unauthorized("Missing bearer token");
  }

  return header.slice("Bearer ".length).trim();
}

function getRlsClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function getAuthenticatedPersonal(
  app: FastifyInstance,
  request: FastifyRequest,
) {
  const token = extractBearerToken(request);

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    throw app.httpErrors.unauthorized("Invalid or expired token");
  }

  const { data: personal, error: personalError } = await supabaseAdmin
    .from("personals")
    .select("id,name,email,evolution_instance_name")
    .eq("id", user.id)
    .maybeSingle();

  if (personalError) {
    throw app.httpErrors.internalServerError(personalError.message);
  }

  if (!personal) {
    throw app.httpErrors.notFound("Personal profile not found");
  }

  return { token, personalId: user.id, personal };
}

function buildWebhookUrlFromRequest(request: FastifyRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const hostHeader =
    request.headers["x-forwarded-host"] || request.headers.host;

  const protocol =
    typeof protoHeader === "string" && protoHeader.trim()
      ? protoHeader.split(",")[0].trim()
      : "https";

  const host =
    typeof hostHeader === "string" && hostHeader.trim()
      ? hostHeader.split(",")[0].trim()
      : null;

  if (host) {
    return `${protocol}://${host}/webhooks/evolution`;
  }

  // Fallback safe default for production.
  return "https://app.ezpersonal.com.br/webhooks/evolution";
}

function sanitizeFileName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "exercise.gif";
}

async function ensureEvolutionWebhookForRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  instanceName: string,
) {
  const webhookUrl = buildWebhookUrlFromRequest(request);

  try {
    await ensureEvolutionWebhook(instanceName, webhookUrl);
  } catch (error) {
    app.log.warn(
      { error, instanceName, webhookUrl },
      "Failed to auto-configure Evolution webhook",
    );
  }
}

async function assertWorkoutOwnership(
  app: FastifyInstance,
  personalId: string,
  workoutId: string,
) {
  const { data: workout, error: workoutError } = await supabaseAdmin
    .from("workouts")
    .select("id,personal_id,student_id")
    .eq("id", workoutId)
    .maybeSingle();

  if (workoutError) {
    throw app.httpErrors.badRequest(workoutError.message);
  }

  if (!workout) {
    throw app.httpErrors.notFound("Workout not found");
  }

  if (workout.personal_id === personalId) {
    return workout;
  }

  if (workout.personal_id && workout.personal_id !== personalId) {
    throw app.httpErrors.notFound("Workout not found");
  }

  // Compatibilidade com treinos legados sem personal_id.
  let isOwned = false;

  if (workout.student_id) {
    const { data: legacyStudent, error: legacyStudentError } =
      await supabaseAdmin
        .from("students")
        .select("id")
        .eq("id", workout.student_id)
        .eq("personal_id", personalId)
        .maybeSingle();

    if (legacyStudentError) {
      throw app.httpErrors.badRequest(legacyStudentError.message);
    }

    isOwned = Boolean(legacyStudent);
  }

  if (!isOwned) {
    const { data: linkedAssignment, error: linkedAssignmentError } =
      await supabaseAdmin
        .from("student_workouts")
        .select("id,students!inner(id,personal_id)")
        .eq("workout_id", workoutId)
        .eq("students.personal_id", personalId)
        .limit(1)
        .maybeSingle();

    if (linkedAssignmentError) {
      throw app.httpErrors.badRequest(linkedAssignmentError.message);
    }

    isOwned = Boolean(linkedAssignment);
  }

  if (!isOwned) {
    throw app.httpErrors.notFound("Workout not found");
  }

  const { error: claimError } = await supabaseAdmin
    .from("workouts")
    .update({ personal_id: personalId })
    .eq("id", workoutId)
    .is("personal_id", null);

  if (claimError) {
    app.log.warn(
      { workoutId, personalId, error: claimError },
      "Failed to backfill personal_id for legacy workout",
    );
  }

  return workout;
}

async function resolveWorkoutExerciseReference(params: {
  app: FastifyInstance;
  personalId: string;
  exerciseId?: string;
  exerciseVariationId?: string;
  exerciseCatalogId?: string;
}) {
  const { app, personalId, exerciseId, exerciseVariationId, exerciseCatalogId } = params;

  if (exerciseVariationId) {
    const { data: variation, error: variationError } = await supabaseAdmin
      .from("exercise_variations")
      .select("id,personal_id,legacy_exercise_id")
      .eq("id", exerciseVariationId)
      .maybeSingle();

    if (variationError) {
      throw app.httpErrors.badRequest(variationError.message);
    }

    if (!variation) {
      throw app.httpErrors.notFound("Exercise variation not found");
    }

    if (variation.personal_id && variation.personal_id !== personalId) {
      throw app.httpErrors.notFound("Exercise variation not found");
    }

    if (!variation.legacy_exercise_id) {
      // Fallback: use the exercise catalog's legacy exercise link
      if (exerciseCatalogId) {
        const { data: catalog, error: catalogErr } = await supabaseAdmin
          .from("exercise_catalog")
          .select("legacy_exercise_id")
          .eq("id", exerciseCatalogId)
          .maybeSingle();
        if (!catalogErr && (catalog as any)?.legacy_exercise_id) {
          return {
            exerciseId: (catalog as any).legacy_exercise_id as string,
            exerciseVariationId,
          };
        }
      }
      throw app.httpErrors.badRequest(
        "Exercise variation is not linked to a legacy exercise. Please re-import exercises.",
      );
    }

    if (exerciseId && exerciseId !== variation.legacy_exercise_id) {
      throw app.httpErrors.badRequest(
        "exercise_id does not match provided exercise_variation_id",
      );
    }

    return {
      exerciseId: variation.legacy_exercise_id as string,
      exerciseVariationId,
    };
  }

  if (!exerciseId) {
    throw app.httpErrors.badRequest(
      "exercise_id or exercise_variation_id must be provided",
    );
  }

  const { data: exerciseFallback, error: exerciseFallbackError } =
    await supabaseAdmin
      .from("exercises")
      .select("id,personal_id")
      .eq("id", exerciseId)
      .maybeSingle();

  if (exerciseFallbackError) {
    throw app.httpErrors.badRequest(exerciseFallbackError.message);
  }

  if (
    !exerciseFallback ||
    (exerciseFallback.personal_id && exerciseFallback.personal_id !== personalId)
  ) {
    throw app.httpErrors.notFound("Exercise not found");
  }

  const { data: linkedVariation, error: linkedVariationError } = await supabaseAdmin
    .from("exercise_variations")
    .select("id")
    .eq("legacy_exercise_id", exerciseId)
    .or(`personal_id.is.null,personal_id.eq.${personalId}`)
    .limit(1)
    .maybeSingle();

  if (linkedVariationError) {
    throw app.httpErrors.badRequest(linkedVariationError.message);
  }

  return {
    exerciseId,
    exerciseVariationId: linkedVariation?.id ?? null,
  };
}

export async function registerPersonalApiRoutes(app: FastifyInstance) {
  app.get("/personal/connection/qrcode", async (request) => {
    await getAuthenticatedPersonal(app, request);
    throw app.httpErrors.forbidden(
      "Conexão do WhatsApp disponível apenas no painel admin.",
    );
  });

  app.get("/personal/connection/status", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const instanceName = getUnifiedEvolutionInstanceName();

    await ensureEvolutionInstance(instanceName);
    await ensureEvolutionWebhookForRequest(app, request, instanceName);

    const status = await getEvolutionConnectionStatus(instanceName);

    // Evolution API returns {instance: {state: "open", instanceName: "..."}}
    // Extract the nested instance object
    const instanceData = (status as any).instance || status;

    return {
      instance: instanceName,
      state: instanceData.state || instanceData.status,
      ...instanceData,
    };
  });

  app.delete("/personal/connection/logout", async (request) => {
    await getAuthenticatedPersonal(app, request);
    throw app.httpErrors.forbidden(
      "Desconexão do WhatsApp disponível apenas no painel admin.",
    );
  });

  app.get("/personal/profile", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    let queryResult: any = await client
      .from("personals")
      .select(PERSONAL_SELECT_FULL)
      .eq("id", personalId)
      .maybeSingle();

    if (queryResult.error && isMissingPersonalFieldError(queryResult.error)) {
      queryResult = await client
        .from("personals")
        .select(PERSONAL_SELECT_BASE)
        .eq("id", personalId)
        .maybeSingle();
    }

    const { data, error } = queryResult;

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Personal profile not found");
    }

    return normalizePersonalRow(data);
  });

  app.patch("/personal/profile", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = PersonalProfilePatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const client = getRlsClient(token);
    const payload: Record<string, unknown> = { ...parsed.data };

    if (payload.email === "") payload.email = null;
    if (payload.phone === "") payload.phone = null;
    if (payload.crf_registration === "") payload.crf_registration = null;

    if (typeof payload.phone === "string") {
      const normalizedPhone = normalizeBrazilWhatsappNumber(payload.phone);
      if (!normalizedPhone) {
        throw app.httpErrors.badRequest(
          "WhatsApp inválido. Use no formato 55DDDNUMERO.",
        );
      }
      payload.phone = normalizedPhone;
    }

    if (payload.email) {
      const { error: authUpdateError } =
        await supabaseAdmin.auth.admin.updateUserById(personalId, {
          email: String(payload.email),
        });

      if (authUpdateError) {
        throw app.httpErrors.badRequest(authUpdateError.message);
      }
    }

    if (
      Object.keys(payload).some((k) =>
        ["phone", "crf_registration"].includes(k),
      )
    ) {
      const probe = await client.from("personals").select("id,phone").limit(1);
      if (probe.error && isMissingPersonalFieldError(probe.error)) {
        delete payload.phone;
        delete payload.crf_registration;
      }
    }

    const { error: updateError } = await client
      .from("personals")
      .update(payload)
      .eq("id", personalId);

    if (updateError) {
      throw app.httpErrors.badRequest(updateError.message);
    }

    let result: any = await client
      .from("personals")
      .select(PERSONAL_SELECT_FULL)
      .eq("id", personalId)
      .maybeSingle();

    if (result.error && isMissingPersonalFieldError(result.error)) {
      result = await client
        .from("personals")
        .select(PERSONAL_SELECT_BASE)
        .eq("id", personalId)
        .maybeSingle();
    }

    const { data, error } = result;

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Personal profile not found");
    }

    return normalizePersonalRow(data);
  });

  app.post("/students", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = StudentCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const client = getRlsClient(token);
    const payload = {
      personal_id: personalId,
      name: parsed.data.name,
      whatsapp_number: parsed.data.whatsapp_number,
      is_active: parsed.data.is_active ?? true,
    };

    const { data, error } = await client
      .from("students")
      .insert(payload)
      .select(STUDENTS_SELECT_BASE)
      .single();

    if (error) {
      if (isWhatsappUniqueViolation(error)) {
        throw app.httpErrors.conflict(
          "Este WhatsApp já está vinculado a outro aluno. Confirme o número com o personal responsável.",
        );
      }
      throw app.httpErrors.badRequest(error.message);
    }

    return normalizeStudentRow(data);
  });

  app.get("/students", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    let queryResult: any = await client
      .from("students")
      .select(STUDENTS_SELECT_FULL)
      .order("created_at", { ascending: false });

    if (queryResult.error && isMissingStudentFieldError(queryResult.error)) {
      queryResult = await client
        .from("students")
        .select(STUDENTS_SELECT_BASE)
        .order("created_at", { ascending: false });
    }

    const { data, error } = queryResult;

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return (data ?? []).map(normalizeStudentRow);
  });

  app.patch("/students/:id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = StudentPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const payload: Record<string, unknown> = { ...parsed.data };
    if (payload.email === "") payload.email = null;
    if (payload.blood_type === "") payload.blood_type = null;
    if (payload.weight_kg === "") payload.weight_kg = null;
    if (payload.height_cm === "") payload.height_cm = null;

    if (
      Object.keys(payload).some((k) =>
        ["email", "blood_type", "weight_kg", "height_cm"].includes(k),
      )
    ) {
      const { error: writeProbeError } = await client
        .from("students")
        .select("id,email")
        .limit(1);
      if (writeProbeError && isMissingStudentFieldError(writeProbeError)) {
        delete payload.email;
        delete payload.blood_type;
        delete payload.weight_kg;
        delete payload.height_cm;
      }
    }

    let patchResult = await client
      .from("students")
      .update(payload)
      .eq("id", id)
      .select(STUDENTS_SELECT_FULL)
      .maybeSingle();

    if (patchResult.error && isMissingStudentFieldError(patchResult.error)) {
      patchResult = await client
        .from("students")
        .update(payload)
        .eq("id", id)
        .select(STUDENTS_SELECT_BASE)
        .maybeSingle();
    }

    const { data, error } = patchResult;

    if (error) {
      if (isWhatsappUniqueViolation(error)) {
        throw app.httpErrors.conflict(
          "Este WhatsApp já está vinculado a outro aluno. Confirme o número com o personal responsável.",
        );
      }
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Student not found");
    }

    if (
      typeof payload.weight_kg === "number" &&
      Number.isFinite(payload.weight_kg) &&
      Number(payload.weight_kg) > 0
    ) {
      const today = new Date().toISOString().slice(0, 10);
      const { error: weightLogError } = await client
        .from("student_weight_logs")
        .upsert(
          {
            student_id: id,
            date: today,
            weight_kg: Number(payload.weight_kg),
            source: "manual",
          },
          {
            onConflict: "student_id,date",
            ignoreDuplicates: false,
          },
        );

      if (weightLogError && !isMissingWeightLogsTableError(weightLogError)) {
        app.log.warn(
          {
            studentId: id,
            error: weightLogError.message,
          },
          "Falha ao registrar histórico de peso do aluno",
        );
      }
    }

    return normalizeStudentRow(data);
  });

  app.get("/students/:id/details", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    let studentResult = await client
      .from("students")
      .select(STUDENTS_SELECT_FULL)
      .eq("id", id)
      .maybeSingle();

    if (
      studentResult.error &&
      isMissingStudentFieldError(studentResult.error)
    ) {
      studentResult = await client
        .from("students")
        .select(STUDENTS_SELECT_BASE)
        .eq("id", id)
        .maybeSingle();
    }

    const { data: studentRaw, error: studentError } = studentResult;

    if (studentError) {
      throw app.httpErrors.badRequest(studentError.message);
    }

    if (!studentRaw) {
      throw app.httpErrors.notFound("Student not found");
    }

    const student = normalizeStudentRow(studentRaw);

    const { data: assignments, error: workoutsError } = await client
      .from("student_workouts")
      .select(
        "id,workout_id,student_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,exercises(id,name,description,muscle_group,equipment,gif_url)))",
      )
      .eq("student_id", id)
      .order("created_at", { ascending: false });

    if (workoutsError) {
      throw app.httpErrors.badRequest(workoutsError.message);
    }

    const workouts = (assignments ?? []).map((assignment: any) => {
      const workout = Array.isArray(assignment.workouts)
        ? assignment.workouts[0]
        : assignment.workouts;

      return {
        ...(workout ?? {}),
        assignment_id: assignment.id,
        assignment_start_date: assignment.start_date,
        assignment_valid_until: assignment.valid_until,
        assignment_tracking_mode: assignment.tracking_mode ?? "per_rep",
      };
    });

    const assignedWorkoutIds = workouts
      .map((w: any) => w?.id)
      .filter((value: any) => typeof value === "string");

    const { data: availableWorkouts, error: availableWorkoutsError } =
      await client
        .from("workouts")
        .select("id,name,start_date,created_at")
        .order("created_at", { ascending: false });

    if (availableWorkoutsError) {
      throw app.httpErrors.badRequest(availableWorkoutsError.message);
    }

    let sessionsResult: any = await client
      .from("daily_sessions")
      .select(
        "id,date,status,created_at,updated_at,summary,workout_id,workouts(name),set_logs(set_number,reps_done,weight_used,rpe_score,workout_exercise_id,workout_exercises(order_index,exercises(name)))",
      )
      .eq("student_id", id)
      .eq("status", "completed")
      .order("date", { ascending: false })
      .limit(50);

    if (
      sessionsResult.error &&
      isMissingStudentFieldError(sessionsResult.error)
    ) {
      sessionsResult = await client
        .from("daily_sessions")
        .select(
          "id,date,status,created_at,updated_at,workout_id,workouts(name)",
        )
        .eq("student_id", id)
        .eq("status", "completed")
        .order("date", { ascending: false })
        .limit(50);
    }

    const { data: sessions, error: sessionsError } = sessionsResult;

    if (sessionsError) {
      throw app.httpErrors.badRequest(sessionsError.message);
    }

    return {
      student,
      workouts: workouts ?? [],
      available_workouts: (availableWorkouts ?? []).filter(
        (workout: any) => !assignedWorkoutIds.includes(workout.id),
      ),
      completed_sessions: (sessions ?? []).map((s: any) => {
        const runtimeSummary = buildCompletedSessionSummaryFromLogs(
          (s?.set_logs ?? []) as any[],
        );

        return {
          id: s.id,
          date: s.date,
          status: s.status,
          created_at: s.created_at,
          updated_at: s.updated_at,
          summary: runtimeSummary ?? s.summary ?? null,
          workout_id: s.workout_id,
          workout_name: Array.isArray(s.workouts)
            ? s.workouts[0]?.name
            : s.workouts?.name,
        };
      }),
    };
  });

  app.get("/students/:id/report", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id,name,weight_kg,created_at")
      .eq("id", id)
      .maybeSingle();

    if (studentError) {
      throw app.httpErrors.badRequest(studentError.message);
    }

    if (!student) {
      throw app.httpErrors.notFound("Student not found");
    }

    const { data: completedSessions, error: completedSessionsError } =
      await client
        .from("daily_sessions")
        .select("id,date")
        .eq("student_id", id)
        .eq("status", "completed")
        .order("date", { ascending: false })
        .limit(500);

    if (completedSessionsError) {
      throw app.httpErrors.badRequest(completedSessionsError.message);
    }

    const trainedDaySet = new Set<string>();
    const completedSessionIds = (completedSessions ?? [])
      .map((row: any) => {
        const rawDate = String(row?.date ?? "").slice(0, 10);
        if (rawDate) {
          trainedDaySet.add(rawDate);
        }
        return String(row?.id ?? "");
      })
      .filter(Boolean);

    let setLogs: any[] = [];
    if (completedSessionIds.length > 0) {
      const { data: setLogsData, error: setLogsError } = await client
        .from("set_logs")
        .select("session_id,workout_exercise_id,weight_used,daily_sessions(date)")
        .in("session_id", completedSessionIds)
        .limit(20000);

      if (setLogsError) {
        throw app.httpErrors.badRequest(setLogsError.message);
      }

      setLogs = setLogsData ?? [];
    }

    const workoutExerciseIds = Array.from(
      new Set(
        setLogs
          .map((log: any) => String(log?.workout_exercise_id ?? ""))
          .filter(Boolean),
      ),
    );

    const workoutExerciseById = new Map<
      string,
      { targetWeight: number; exerciseName: string; muscleGroup: string }
    >();

    if (workoutExerciseIds.length > 0) {
      let workoutExercisesResult: any = await client
        .from("workout_exercises")
        .select(
          "id,target_weight,exercise_catalog(name),exercise_variations(name,exercise_catalog(name),muscle_groups(name)),exercises(name,muscle_group)",
        )
        .in("id", workoutExerciseIds)
        .limit(10000);

      if (workoutExercisesResult.error) {
        workoutExercisesResult = await client
          .from("workout_exercises")
          .select("id,target_weight,exercises(name,muscle_group)")
          .in("id", workoutExerciseIds)
          .limit(10000);
      }

      const { data: workoutExercises, error: workoutExercisesError } =
        workoutExercisesResult;

      if (workoutExercisesError) {
        throw app.httpErrors.badRequest(workoutExercisesError.message);
      }

      for (const row of workoutExercises ?? []) {
        const variation = Array.isArray(row?.exercise_variations)
          ? row.exercise_variations[0]
          : row?.exercise_variations;
        const catalog = Array.isArray(row?.exercise_catalog)
          ? row.exercise_catalog[0]
          : row?.exercise_catalog;
        const legacyExercise = Array.isArray(row?.exercises)
          ? row.exercises[0]
          : row?.exercises;
        const variationCatalog = Array.isArray(variation?.exercise_catalog)
          ? variation.exercise_catalog[0]
          : variation?.exercise_catalog;
        const variationMuscleGroup = Array.isArray(variation?.muscle_groups)
          ? variation.muscle_groups[0]
          : variation?.muscle_groups;

        const baseName =
          String(
            catalog?.name ?? variationCatalog?.name ?? legacyExercise?.name,
          ).trim() || "Exercício";
        const variationName = String(variation?.name ?? "").trim();
        const exerciseName = variationName
          ? `${baseName} - ${variationName}`
          : baseName;
        const muscleGroup =
          String(
            variationMuscleGroup?.name ?? legacyExercise?.muscle_group ?? "",
          ).trim() || "Não informado";

        workoutExerciseById.set(String(row?.id), {
          targetWeight: Number(row?.target_weight ?? 0),
          exerciseName,
          muscleGroup,
        });
      }
    }

    const muscleGroupCount = new Map<string, number>();
    const overTargetByExercise = new Map<
      string,
      { exercise_name: string; sets: number; total_diff_kg: number }
    >();
    const underTargetByExercise = new Map<
      string,
      { exercise_name: string; sets: number; total_diff_kg: number }
    >();

    for (const log of setLogs) {
      const workoutExerciseId = String(log?.workout_exercise_id ?? "");
      const exerciseMeta = workoutExerciseById.get(workoutExerciseId);
      if (!exerciseMeta) {
        continue;
      }

      const groupName = exerciseMeta.muscleGroup;
      muscleGroupCount.set(groupName, (muscleGroupCount.get(groupName) ?? 0) + 1);

      const usedWeight = Number(log?.weight_used ?? 0);
      const targetWeight = Number(exerciseMeta.targetWeight ?? 0);
      if (!Number.isFinite(usedWeight) || !Number.isFinite(targetWeight) || targetWeight <= 0) {
        continue;
      }

      const delta = usedWeight - targetWeight;
      if (delta > 0) {
        const current = overTargetByExercise.get(exerciseMeta.exerciseName) ?? {
          exercise_name: exerciseMeta.exerciseName,
          sets: 0,
          total_diff_kg: 0,
        };
        current.sets += 1;
        current.total_diff_kg += delta;
        overTargetByExercise.set(exerciseMeta.exerciseName, current);
      } else if (delta < 0) {
        const current = underTargetByExercise.get(exerciseMeta.exerciseName) ?? {
          exercise_name: exerciseMeta.exerciseName,
          sets: 0,
          total_diff_kg: 0,
        };
        current.sets += 1;
        current.total_diff_kg += Math.abs(delta);
        underTargetByExercise.set(exerciseMeta.exerciseName, current);
      }
    }

    const topOverTarget = Array.from(overTargetByExercise.values())
      .map((item) => ({
        ...item,
        avg_diff_kg: item.sets > 0 ? item.total_diff_kg / item.sets : 0,
      }))
      .sort((a, b) => b.total_diff_kg - a.total_diff_kg)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        total_diff_kg: Number(item.total_diff_kg.toFixed(2)),
        avg_diff_kg: Number(item.avg_diff_kg.toFixed(2)),
      }));

    const topUnderTarget = Array.from(underTargetByExercise.values())
      .map((item) => ({
        ...item,
        avg_diff_kg: item.sets > 0 ? item.total_diff_kg / item.sets : 0,
      }))
      .sort((a, b) => b.total_diff_kg - a.total_diff_kg)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        total_diff_kg: Number(item.total_diff_kg.toFixed(2)),
        avg_diff_kg: Number(item.avg_diff_kg.toFixed(2)),
      }));

    const muscleGroups = Array.from(muscleGroupCount.entries())
      .map(([name, sessions]) => ({ name, sessions }))
      .sort((a, b) => b.sessions - a.sessions);

    let weightTimeline: Array<{ date: string; weight_kg: number }> = [];
    const weightLogsResult = await client
      .from("student_weight_logs")
      .select("date,weight_kg,created_at")
      .eq("student_id", id)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(2000);

    if (weightLogsResult.error) {
      if (!isMissingWeightLogsTableError(weightLogsResult.error)) {
        throw app.httpErrors.badRequest(weightLogsResult.error.message);
      }
    } else {
      const byDate = new Map<string, number>();
      for (const row of weightLogsResult.data ?? []) {
        const date = String(row?.date ?? "").slice(0, 10);
        const weight = Number(row?.weight_kg ?? 0);
        if (date && Number.isFinite(weight) && weight > 0) {
          byDate.set(date, weight);
        }
      }

      weightTimeline = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, weight_kg]) => ({
          date,
          weight_kg: Number(weight_kg.toFixed(2)),
        }));
    }

    if (weightTimeline.length === 0 && Number(student.weight_kg) > 0) {
      const fallbackDate = new Date().toISOString().slice(0, 10);
      weightTimeline.push({
        date: fallbackDate,
        weight_kg: Number(Number(student.weight_kg).toFixed(2)),
      });
    }

    return {
      student: {
        id: student.id,
        name: student.name,
        current_weight_kg:
          student.weight_kg == null ? null : Number(student.weight_kg),
      },
      trained_days: Array.from(trainedDaySet).sort((a, b) => a.localeCompare(b)),
      muscle_groups: muscleGroups,
      top_over_target: topOverTarget,
      top_under_target: topUnderTarget,
      weight_timeline: weightTimeline,
    };
  });

  app.delete("/students/:id", async (request, reply) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { error } = await client.from("students").delete().eq("id", id);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return reply.code(204).send();
  });

  app.post("/exercises", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = ExerciseCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const client = getRlsClient(token);
    const payload = {
      personal_id: personalId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      muscle_group: parsed.data.muscle_group ?? null,
      equipment: parsed.data.equipment ?? null,
      tags: parsed.data.tags ?? null,
      gif_url: parsed.data.gif_url ? parsed.data.gif_url : null,
      gif_storage_path: null,
    };

    const { data, error } = await client
      .from("exercises")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.get("/exercises", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    // Parâmetros de paginação
    const queryParams = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };
    const parsedPage = parseInt(queryParams.page || "1", 10);
    const parsedLimit = parseInt(queryParams.limit || "15", 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 15;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = normalizeSearchTerm(queryParams.search || "");
    const normalizedQuery = normalizeSearchComparable(search);
    const searchTokens = tokenizeSearchTerm(search);

    // Query base
    let query = client
      .from("exercises")
      .select(
        "id,personal_id,name,description,muscle_group,equipment,tags,gif_url,created_at",
        { count: "exact" },
      );

    // Busca por termos contendo palavras em vários campos (inclui tags)
    // Ex.: "supino smith" deve encontrar "supino fechado smith".
    if (searchTokens.length >= 1) {
      // Fase 1: filtra no banco via ilike por nome, grupo muscular, equipamento e descrição.
      // Isso evita o truncamento padrão do Supabase/PostgREST que corta resultados
      // após N linhas ordenadas — sem esse filtro, exercícios com letra S em diante
      // podem nunca ser retornados se houver muitos exercícios antes deles.
      const orClauses = searchTokens
        .flatMap((token) => {
          const safe = token.replace(/_/g, "\\_");
          return [
            `name.ilike.%${safe}%`,
            `muscle_group.ilike.%${safe}%`,
            `equipment.ilike.%${safe}%`,
            `description.ilike.%${safe}%`,
          ];
        })
        .join(",");

      const { data: candidates, error: candidatesError } = await query
        .or(orClauses)
        .order("name", { ascending: true });

      if (candidatesError) {
        throw app.httpErrors.badRequest(candidatesError.message);
      }

      // Fase 2: filtragem em memória exigindo TODOS os tokens (inclui tags)
      const filtered = (candidates ?? [])
        .filter((exercise) => matchesExerciseSearch(exercise, searchTokens))
        .map((exercise) => ({
          exercise,
          score: scoreExerciseSearch(exercise, searchTokens, normalizedQuery),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const nameA = String(a.exercise?.name ?? "").toLowerCase();
          const nameB = String(b.exercise?.name ?? "").toLowerCase();
          return nameA.localeCompare(nameB, "pt-BR");
        })
        .map((item) => item.exercise);

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      const paged = filtered.slice(from, to + 1);

      return {
        data: paged,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    }

    // Sem busca: mantém fluxo paginado direto no banco.
    const { data, error, count } = await query
      .order("name", { ascending: true })
      .range(from, to);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    const totalPages = Math.ceil((count || 0) / limit);

    return {
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  });

  app.patch("/exercises/:id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = ExercisePatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);
    const payload: Record<string, unknown> = { ...parsed.data };
    if (payload.gif_url === "") payload.gif_url = null;

    const { data, error } = await client
      .from("exercises")
      .update(payload)
      .eq("id", id)
      .select("id,personal_id,name,description,muscle_group,equipment,tags,gif_url,created_at")
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    return data;
  });

  app.post("/exercises/:id/gif/upload-url", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = ExerciseGifUploadUrlSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { data: exercise, error: exerciseError } = await client
      .from("exercises")
      .select("id,personal_id")
      .eq("id", id)
      .maybeSingle();

    if (exerciseError) {
      throw app.httpErrors.badRequest(exerciseError.message);
    }

    if (!exercise || exercise.personal_id !== personalId) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    const bucketName = "exercise-media";
    const { data: existingBuckets } = await supabaseAdmin.storage.listBuckets();
    const hasBucket = (existingBuckets ?? []).some((bucket) => bucket.name === bucketName);

    if (!hasBucket) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket(
        bucketName,
        {
          public: true,
          fileSizeLimit: 5 * 1024 * 1024,
          allowedMimeTypes: ["image/gif", "image/webp", "image/png", "image/jpeg"],
        },
      );

      if (bucketError && !String(bucketError.message).includes("already exists")) {
        throw app.httpErrors.badRequest(bucketError.message);
      }
    }

    const originalName = parsed.data.filename || "exercise.gif";
    const safeName = sanitizeFileName(originalName);
    const storagePath = `personal/${personalId}/exercise/${id}/${Date.now()}-${safeName}`;

    const { data: signedUpload, error: signedUploadError } =
      await supabaseAdmin.storage.from(bucketName).createSignedUploadUrl(storagePath);

    if (signedUploadError) {
      throw app.httpErrors.badRequest(signedUploadError.message);
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    return {
      bucket: bucketName,
      path: storagePath,
      signed_upload: signedUpload,
      public_url: publicData.publicUrl,
    };
  });

  app.post("/exercises/:id/gif/finalize", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = ExerciseGifFinalizeSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);
    const bucketName = "exercise-media";

    const { data: publicData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(parsed.data.storage_path);

    const { data, error } = await client
      .from("exercises")
      .update({
        gif_storage_path: parsed.data.storage_path,
        gif_url: publicData.publicUrl,
      })
      .eq("id", id)
      .select("id,personal_id,name,gif_url,gif_storage_path,created_at")
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    return data;
  });

  // ── Exercise catalog / variations / equipment cascade ───────────────────────

  app.get("/exercise-catalog", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      50,
    );

    let q = supabaseAdmin
      .from("exercise_catalog")
      .select("id,name")
      .or(`personal_id.is.null,personal_id.eq.${personalId}`)
      .order("name", { ascending: true });

    if (search) {
      q = q.ilike("name", `%${search}%`);
    }

    const { data, error } = await q.limit(limit);
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/exercise-catalog", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());

    const { data, error } = await supabaseAdmin
      .from("exercise_catalog")
      .insert({ name, personal_id: personalId })
      .select("id,name,personal_id")
      .single();

    if (error) throw app.httpErrors.badRequest(error.message);
    return data;
  });

  app.delete("/exercise-catalog/:id", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: used, error: usedErr } = await supabaseAdmin
      .from("workout_exercises")
      .select("id")
      .eq("exercise_catalog_id", id)
      .limit(1);
    if (usedErr) throw app.httpErrors.badRequest(usedErr.message);
    if ((used ?? []).length > 0) {
      throw app.httpErrors.badRequest(
        "Exercise is already used in workouts and cannot be removed.",
      );
    }

    const { error } = await supabaseAdmin
      .from("exercise_catalog")
      .delete()
      .eq("id", id)
      .eq("personal_id", personalId);

    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.get("/exercise-variations", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      50,
    );

    let q = supabaseAdmin
      .from("exercise_variations")
      .select("id,name,gif_url")
      .or(`personal_id.is.null,personal_id.eq.${personalId}`)
      .order("name", { ascending: true });

    if (search) {
      q = q.ilike("name", `%${search}%`);
    }

    const { data, error } = await q.limit(limit);
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/exercise-variations", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string; gif_url?: string | null };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());
    const gifUrl = body?.gif_url?.trim() ? body.gif_url.trim() : null;

    const { data, error } = await supabaseAdmin
      .from("exercise_variations")
      .insert({ name, personal_id: personalId, gif_url: gifUrl })
      .select("id,name,gif_url,personal_id")
      .single();

    if (error) throw app.httpErrors.badRequest(error.message);
    return data;
  });

  app.delete("/exercise-variations/:id", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: variation, error: variationErr } = await supabaseAdmin
      .from("exercise_variations")
      .select("id,personal_id")
      .eq("id", id)
      .maybeSingle();

    if (variationErr) throw app.httpErrors.badRequest(variationErr.message);
    if (!variation) throw app.httpErrors.notFound("Variation not found.");

    // Permite excluir variações próprias e variações base (personal_id null)
    // visíveis para o personal autenticado.
    if (variation.personal_id && variation.personal_id !== personalId) {
      throw app.httpErrors.forbidden(
        "You are not allowed to remove this variation.",
      );
    }

    const { error } = await supabaseAdmin
      .from("exercise_variations")
      .delete()
      .eq("id", id);

    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.get("/equipment-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      50,
    );

    let q = supabaseAdmin
      .from("equipment_catalog")
      .select("id,name")
      .order("name", { ascending: true });

    if (search) {
      q = q.ilike("name", `%${search}%`);
    }

    const { data, error } = await q.limit(limit);
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/equipment-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("equipment_catalog")
      .insert({ name })
      .select("id,name")
      .maybeSingle();

    if (!insertErr && inserted) return inserted;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("equipment_catalog")
      .select("id,name")
      .eq("name", name)
      .maybeSingle();

    if (existingErr) throw app.httpErrors.badRequest(existingErr.message);
    if (existing) return existing;
    if (insertErr) throw app.httpErrors.badRequest(insertErr.message);
    throw app.httpErrors.badRequest("Unable to create equipment");
  });

  app.delete("/equipment-catalog/:id", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: used, error: usedErr } = await supabaseAdmin
      .from("workout_exercises")
      .select("id")
      .eq("equipment_id", id)
      .limit(1);
    if (usedErr) throw app.httpErrors.badRequest(usedErr.message);
    if ((used ?? []).length > 0) {
      throw app.httpErrors.badRequest(
        "Equipment is already used in workouts and cannot be removed.",
      );
    }

    const { error } = await supabaseAdmin
      .from("equipment_catalog")
      .delete()
      .eq("id", id);
    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.post("/exercise-combos/generate-description", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as {
      exercise_catalog_id?: string;
      exercise_variation_id?: string;
    };

    const exerciseCatalogId = z
      .string()
      .uuid()
      .parse((body as any)?.exercise_catalog_id);
    const variationId = z
      .string()
      .uuid()
      .parse((body as any)?.exercise_variation_id);

    // Check combo cache first
    const { data: cached, error: cacheError } = await supabaseAdmin
      .from("exercise_combo_cache")
      .select("description,muscle_group_id,muscle_groups(name)")
      .eq("exercise_catalog_id", exerciseCatalogId)
      .eq("exercise_variation_id", variationId)
      .maybeSingle();

    if (cacheError) throw app.httpErrors.badRequest(cacheError.message);

    if (cached && (cached as any).description) {
      return {
        description: normalizeExerciseAIDescription(
          (cached as any).description as string,
        ),
        muscle_group_name: (cached as any).muscle_groups?.name ?? null,
        cached: true,
      };
    }

    // Fetch exercise name, variation name, and muscle groups in parallel
    const [catalogRes, variationRes, muscleGroupsRes] = await Promise.all([
      supabaseAdmin
        .from("exercise_catalog")
        .select("name")
        .eq("id", exerciseCatalogId)
        .or(`personal_id.is.null,personal_id.eq.${personalId}`)
        .maybeSingle(),
      supabaseAdmin
        .from("exercise_variations")
        .select("name")
        .eq("id", variationId)
        .or(`personal_id.is.null,personal_id.eq.${personalId}`)
        .maybeSingle(),
      supabaseAdmin.from("muscle_groups").select("id,name").order("name"),
    ]);

    if (catalogRes.error) throw app.httpErrors.badRequest(catalogRes.error.message);
    if (variationRes.error) throw app.httpErrors.badRequest(variationRes.error.message);
    if (!catalogRes.data) throw app.httpErrors.notFound("Exercise not found");
    if (!variationRes.data) throw app.httpErrors.notFound("Variation not found");

    const result = await generateExerciseDescription({
      exerciseName: (catalogRes.data as any).name,
      variationName: (variationRes.data as any).name,
      muscleGroups: (muscleGroupsRes.data ?? []).map((mg: any) => ({
        id: mg.id,
        name: mg.name,
      })),
    });

    // Save to combo cache
    const { error: upsertError } = await supabaseAdmin
      .from("exercise_combo_cache")
      .upsert(
        {
          exercise_catalog_id: exerciseCatalogId,
          exercise_variation_id: variationId,
          description: result.description,
          muscle_group_id: result.muscleGroupId,
        },
        { onConflict: "exercise_catalog_id,exercise_variation_id" },
      );

    if (upsertError) {
      app.log.warn(
        { error: upsertError, exerciseCatalogId, variationId },
        "Failed to cache exercise combo description",
      );
    }

    return {
      description: normalizeExerciseAIDescription(result.description),
      muscle_group_name: result.muscleGroupName,
      cached: false,
    };
  });

  // ── Workouts ─────────────────────────────────────────────────────────────────

  app.post("/workouts", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = WorkoutCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const client = getRlsClient(token);

    // Create workout
    const workoutData: any = {
      personal_id: personalId,
      name: parsed.data.name,
      day_of_week: parsed.data.day_of_week ?? null,
    };

    // Add dates if provided
    if (parsed.data.start_date) {
      workoutData.start_date = parsed.data.start_date;
    }

    const { data, error } = await client
      .from("workouts")
      .insert(workoutData)
      .select("*")
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    // Add exercises if provided
    if (parsed.data.exercises && parsed.data.exercises.length > 0) {
      const exercisesData = [] as Record<string, unknown>[];

      for (const ex of parsed.data.exercises) {
        const resolved = await resolveWorkoutExerciseReference({
          app,
          personalId,
          exerciseId: ex.exercise_id,
          exerciseVariationId: ex.exercise_variation_id,
          exerciseCatalogId: (ex as any).exercise_catalog_id,
        });

        exercisesData.push({
          workout_id: data.id,
          exercise_id: resolved.exerciseId,
          exercise_variation_id: resolved.exerciseVariationId,
          exercise_catalog_id: (ex as any).exercise_catalog_id ?? null,
          equipment_id: (ex as any).equipment_id ?? null,
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_weight: ex.target_weight ?? null,
          order_index: ex.order_index,
          rest_seconds: ex.rest_seconds ?? null,
          custom_description: (ex as any).custom_description === "" ? null : ((ex as any).custom_description ?? null),
        });
      }

      const { error: exercisesError } = await client
        .from("workout_exercises")
        .insert(exercisesData);

      if (exercisesError) {
        // Rollback workout if exercises fail
        await client.from("workouts").delete().eq("id", data.id);
        throw app.httpErrors.badRequest(exercisesError.message);
      }

      // Fetch complete workout with exercises
      const { data: completeWorkout, error: fetchError } = await client
        .from("workouts")
        .select(
          `
          *,
          workout_exercises (
            id,
            exercise_id,
            target_sets,
            target_reps,
            target_weight,
            order_index,
            rest_seconds,
            custom_description,
            exercise_variation_id,
            exercises (id, name, description, muscle_group)
          )
        `,
        )
        .eq("id", data.id)
        .single();

      if (fetchError) {
        return data;
      }

      return completeWorkout;
    }

    return data;
  });

  app.get("/workouts", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("workouts")
      .select(
        "id,name,day_of_week,start_date,created_at,student_workouts(student_id,students(name))",
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return (data ?? []).map((workout: any) => ({
      ...workout,
      assignments_count: Array.isArray(workout.student_workouts)
        ? workout.student_workouts.length
        : 0,
      assigned_students: Array.isArray(workout.student_workouts)
        ? workout.student_workouts
            .map((a: any) =>
              Array.isArray(a.students)
                ? a.students[0]?.name
                : a.students?.name,
            )
            .filter(Boolean)
        : [],
    }));
  });

  app.post("/workouts/:id/exercises", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = WorkoutExerciseCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    await assertWorkoutOwnership(app, personalId, workoutId);

    const resolved = await resolveWorkoutExerciseReference({
      app,
      personalId,
      exerciseId: parsed.data.exercise_id,
      exerciseVariationId: parsed.data.exercise_variation_id,
      exerciseCatalogId: parsed.data.exercise_catalog_id,
    });

    const { data, error } = await supabaseAdmin
      .from("workout_exercises")
      .insert({
        workout_id: workoutId,
        exercise_id: resolved.exerciseId,
        exercise_variation_id: resolved.exerciseVariationId,
        exercise_catalog_id: parsed.data.exercise_catalog_id ?? null,
        equipment_id: parsed.data.equipment_id ?? null,
        target_sets: parsed.data.target_sets,
        target_reps: parsed.data.target_reps,
        target_weight: parsed.data.target_weight ?? null,
        order_index: parsed.data.order_index,
        rest_seconds: parsed.data.rest_seconds ?? null,
        custom_description:
          parsed.data.custom_description === ""
            ? null
            : (parsed.data.custom_description ?? null),
      })
      .select(
        "id,workout_id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,created_at",
      )
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.patch("/workouts/:id", async (request) => {
    const { token, personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = WorkoutPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    await assertWorkoutOwnership(app, personalId, workoutId);

    const payload: Record<string, unknown> = { ...parsed.data };
    if (payload.start_date === "") payload.start_date = null;
    const { data, error } = await client
      .from("workouts")
      .update(payload)
      .eq("id", workoutId)
      .select("id,name,day_of_week,start_date,created_at")
      .maybeSingle();

    if (error) {
      // Fallback para treinos legados que ainda não passam pelo RLS esperado.
      const fallback = await supabaseAdmin
        .from("workouts")
        .update(payload)
        .eq("id", workoutId)
        .select("id,name,day_of_week,start_date,created_at")
        .maybeSingle();

      if (fallback.error) {
        throw app.httpErrors.badRequest(fallback.error.message);
      }

      if (!fallback.data) {
        throw app.httpErrors.notFound("Workout not found");
      }

      return fallback.data;
    }

    if (!data) {
      throw app.httpErrors.notFound("Workout not found");
    }

    return data;
  });

  app.delete("/workouts/:id", async (request, reply) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { error } = await client
      .from("workouts")
      .delete()
      .eq("id", workoutId);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return reply.code(204).send();
  });

  app.post("/students/:student_id/workouts/:workout_id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = StudentWorkoutAssignSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const studentId = z
      .string()
      .uuid()
      .parse((request.params as { student_id?: string }).student_id);
    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { workout_id?: string }).workout_id);
    const client = getRlsClient(token);

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id")
      .eq("id", studentId)
      .maybeSingle();

    if (studentError) {
      throw app.httpErrors.badRequest(studentError.message);
    }

    if (!student) {
      throw app.httpErrors.notFound("Student not found");
    }

    const { data: workout, error: workoutError } = await client
      .from("workouts")
      .select("id")
      .eq("id", workoutId)
      .maybeSingle();

    if (workoutError) {
      throw app.httpErrors.badRequest(workoutError.message);
    }

    if (!workout) {
      throw app.httpErrors.notFound("Workout not found");
    }

    const validUntil =
      parsed.data.valid_until === "" ? null : (parsed.data.valid_until ?? null);

    const upsertPayload: Record<string, unknown> = {
      student_id: studentId,
      workout_id: workoutId,
      valid_until: validUntil,
    };
    if (parsed.data.tracking_mode) {
      upsertPayload.tracking_mode = parsed.data.tracking_mode;
    }

    const { data, error } = await client
      .from("student_workouts")
      .upsert(upsertPayload, { onConflict: "workout_id,student_id" })
      .select(
        "id,student_id,workout_id,start_date,valid_until,tracking_mode,created_at",
      )
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.patch("/students/:student_id/workouts/:workout_id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = StudentWorkoutPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const studentId = z
      .string()
      .uuid()
      .parse((request.params as { student_id?: string }).student_id);
    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { workout_id?: string }).workout_id);
    const client = getRlsClient(token);

    const payload: Record<string, unknown> = { ...parsed.data };
    if (payload.valid_until === "") payload.valid_until = null;

    const { data, error } = await client
      .from("student_workouts")
      .update(payload)
      .eq("student_id", studentId)
      .eq("workout_id", workoutId)
      .select(
        "id,student_id,workout_id,start_date,valid_until,tracking_mode,created_at",
      )
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Workout assignment not found");
    }

    return data;
  });

  app.delete(
    "/students/:student_id/workouts/:workout_id",
    async (request, reply) => {
      const { token } = await getAuthenticatedPersonal(app, request);
      const studentId = z
        .string()
        .uuid()
        .parse((request.params as { student_id?: string }).student_id);
      const workoutId = z
        .string()
        .uuid()
        .parse((request.params as { workout_id?: string }).workout_id);
      const client = getRlsClient(token);

      const { error } = await client
        .from("student_workouts")
        .delete()
        .eq("student_id", studentId)
        .eq("workout_id", workoutId);

      if (error) {
        throw app.httpErrors.badRequest(error.message);
      }

      return reply.code(204).send();
    },
  );

  app.patch(
    "/workouts/:workout_id/exercises/:workout_exercise_id",
    async (request) => {
      const { token } = await getAuthenticatedPersonal(app, request);
      const parsed = WorkoutExercisePatchSchema.safeParse(request.body);

      if (!parsed.success) {
        throw app.httpErrors.badRequest(parsed.error.message);
      }

      const workoutId = z
        .string()
        .uuid()
        .parse((request.params as { workout_id?: string }).workout_id);
      const workoutExerciseId = z
        .string()
        .uuid()
        .parse(
          (request.params as { workout_exercise_id?: string })
            .workout_exercise_id,
        );
      const client = getRlsClient(token);

      const payload: Record<string, unknown> = { ...parsed.data };
      if (payload.target_weight === "") payload.target_weight = null;
      if (payload.custom_description === "") payload.custom_description = null;

      const { data, error } = await client
        .from("workout_exercises")
        .update(payload)
        .eq("id", workoutExerciseId)
        .eq("workout_id", workoutId)
        .select(
          "id,workout_id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,exercises(id,name)",
        )
        .maybeSingle();

      if (error) {
        throw app.httpErrors.badRequest(error.message);
      }

      if (!data) {
        throw app.httpErrors.notFound("Workout exercise not found");
      }

      return data;
    },
  );

  app.delete(
    "/workouts/:workout_id/exercises/:workout_exercise_id",
    async (request, reply) => {
      const { token } = await getAuthenticatedPersonal(app, request);
      const workoutId = z
        .string()
        .uuid()
        .parse((request.params as { workout_id?: string }).workout_id);
      const workoutExerciseId = z
        .string()
        .uuid()
        .parse(
          (request.params as { workout_exercise_id?: string })
            .workout_exercise_id,
        );
      const client = getRlsClient(token);

      const { error } = await client
        .from("workout_exercises")
        .delete()
        .eq("id", workoutExerciseId)
        .eq("workout_id", workoutId);

      if (error) {
        throw app.httpErrors.badRequest(error.message);
      }

      return reply.code(204).send();
    },
  );

  app.get("/workouts/student/:student_id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const studentId = z
      .string()
      .uuid()
      .parse((request.params as { student_id?: string }).student_id);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("student_workouts")
      .select(
        "id,student_id,workout_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,workout_id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,created_at))",
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return (data ?? []).map((assignment: any) => {
      const workout = Array.isArray(assignment.workouts)
        ? assignment.workouts[0]
        : assignment.workouts;

      return {
        ...(workout ?? {}),
        assignment_start_date: assignment.start_date,
        assignment_valid_until: assignment.valid_until,
        assignment_tracking_mode: assignment.tracking_mode ?? "per_rep",
      };
    });
  });

  app.get("/workouts/:id/exercises", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("workout_exercises")
      .select(
        "id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,exercise_catalog_id,equipment_id,exercise_variation_id,exercise_catalog(name),exercise_variations(name),equipment_catalog(name),exercises(id,name,description,muscle_group,equipment,gif_url)",
      )
      .eq("workout_id", workoutId)
      .order("order_index", { ascending: true });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    // Flatten the response to have exercise data at root level
    const exercises = (data ?? []).map((we: any) => {
      const exercise = Array.isArray(we.exercises)
        ? we.exercises[0]
        : we.exercises;
      const catalog = Array.isArray(we.exercise_catalog)
        ? we.exercise_catalog[0]
        : we.exercise_catalog;
      const variation = Array.isArray(we.exercise_variations)
        ? we.exercise_variations[0]
        : we.exercise_variations;
      const equipment = Array.isArray(we.equipment_catalog)
        ? we.equipment_catalog[0]
        : we.equipment_catalog;

      const displayBaseName =
        catalog?.name ?? exercise?.name ?? "Exercício";
      const displayName = variation?.name
        ? `${displayBaseName} - ${variation.name}`
        : displayBaseName;

      return {
        workout_exercise_id: we.id,
        id: exercise?.id,
        exercise_catalog_id: we.exercise_catalog_id ?? null,
        exercise_variation_id: we.exercise_variation_id ?? null,
        equipment_id: we.equipment_id ?? null,
        name: displayName,
        exercise_name: displayBaseName,
        variation_name: variation?.name ?? null,
        equipment_name: equipment?.name ?? null,
        description: we.custom_description ?? exercise?.description,
        description_default: exercise?.description,
        custom_description: we.custom_description ?? null,
        muscle_group: exercise?.muscle_group,
        equipment: exercise?.equipment,
        gif_url: exercise?.gif_url,
        target_sets: we.target_sets,
        target_reps: we.target_reps,
        target_weight: we.target_weight,
        order_index: we.order_index,
        rest_seconds: we.rest_seconds ?? null,
      };
    });

    return exercises;
  });

  app.get("/analytics/daily-performance", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const query = request.query as { date?: string };
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("daily_sessions")
      .select(
        "id,status,date,student_id,students(name),set_logs(reps_done,weight_used)",
      )
      .eq("date", date);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    const rows = data ?? [];
    const totalVolume = rows.reduce((acc, row) => {
      const logs = (row.set_logs ?? []) as Array<{
        reps_done: number;
        weight_used: number;
      }>;

      const sessionVolume = logs.reduce(
        (sum, log) => sum + Number(log.reps_done) * Number(log.weight_used),
        0,
      );

      return acc + sessionVolume;
    }, 0);

    return {
      date,
      summary: {
        total_sessions: rows.length,
        completed_sessions: rows.filter((row) => row.status === "completed")
          .length,
        total_volume: totalVolume,
      },
      sessions: rows,
    };
  });
}
