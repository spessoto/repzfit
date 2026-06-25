import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
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
});

const ExercisePatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(2000).optional(),
    muscle_group: z.string().max(100).optional(),
    equipment: z.string().max(500).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const WorkoutCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  start_date: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .optional(),
  day_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  exercises: z
    .array(
      z.object({
        exercise_id: z.string().uuid(),
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
      }),
    )
    .max(50)
    .optional(),
});

const WorkoutExerciseCreateSchema = z.object({
  exercise_id: z.string().uuid(),
  target_sets: z.number().int().positive().max(100),
  target_reps: z.number().int().positive().max(1000),
  target_weight: z.number().nonnegative().max(1000).optional(),
  order_index: z.number().int().nonnegative().max(100),
  rest_seconds: z.number().int().nonnegative().max(3600).nullable().optional(),
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
        "id,workout_id,student_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,exercise_id,target_sets,target_reps,target_weight,order_index,rest_seconds,exercises(id,name,description,muscle_group,equipment)))",
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
        "id,personal_id,name,description,muscle_group,equipment,tags,created_at",
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

    const { data, error } = await client
      .from("exercises")
      .update(parsed.data)
      .eq("id", id)
      .select("id,personal_id,name,description,created_at")
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    return data;
  });

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
      const exercisesData = parsed.data.exercises.map((ex) => ({
        workout_id: data.id,
        exercise_id: ex.exercise_id,
        target_sets: ex.target_sets,
        target_reps: ex.target_reps,
        target_weight: ex.target_weight ?? null,
        order_index: ex.order_index,
        rest_seconds: ex.rest_seconds ?? null,
      }));

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

    const { data: exercise, error: exerciseError } = await client
      .from("exercises")
      .select("id")
      .eq("id", parsed.data.exercise_id)
      .maybeSingle();

    if (exerciseError) {
      throw app.httpErrors.badRequest(exerciseError.message);
    }

    if (!exercise) {
      const { data: exerciseFallback, error: exerciseFallbackError } =
        await supabaseAdmin
          .from("exercises")
          .select("id,personal_id")
          .eq("id", parsed.data.exercise_id)
          .maybeSingle();

      if (exerciseFallbackError) {
        throw app.httpErrors.badRequest(exerciseFallbackError.message);
      }

      if (
        !exerciseFallback ||
        (exerciseFallback.personal_id &&
          exerciseFallback.personal_id !== personalId)
      ) {
        throw app.httpErrors.notFound("Exercise not found");
      }
    }

    const { data, error } = await supabaseAdmin
      .from("workout_exercises")
      .insert({
        workout_id: workoutId,
        exercise_id: parsed.data.exercise_id,
        target_sets: parsed.data.target_sets,
        target_reps: parsed.data.target_reps,
        target_weight: parsed.data.target_weight ?? null,
        order_index: parsed.data.order_index,
        rest_seconds: parsed.data.rest_seconds ?? null,
      })
      .select(
        "id,workout_id,exercise_id,target_sets,target_reps,target_weight,order_index,rest_seconds,created_at",
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

      const { data, error } = await client
        .from("workout_exercises")
        .update(payload)
        .eq("id", workoutExerciseId)
        .eq("workout_id", workoutId)
        .select(
          "id,workout_id,exercise_id,target_sets,target_reps,target_weight,order_index,exercises(id,name)",
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
        "id,student_id,workout_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,workout_id,exercise_id,target_sets,target_reps,target_weight,order_index,created_at))",
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
        "id,target_sets,target_reps,target_weight,order_index,rest_seconds,exercises!inner(id,name,description,muscle_group)",
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
      return {
        workout_exercise_id: we.id,
        id: exercise?.id,
        name: exercise?.name,
        description: exercise?.description,
        muscle_group: exercise?.muscle_group,
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
