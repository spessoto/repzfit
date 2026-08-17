import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import XLSX from "xlsx";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { normalizeBrazilWhatsappNumber } from "../../utils/whatsapp.js";
import { buildWebhookUrlFromRequest } from "../../utils/request.js";
import {
  encrypt,
  decrypt,
  encryptNumber,
  decryptNumber,
  hmacHash,
} from "../../utils/encryption.js";
import {
  getAuthenticatedPersonal,
  extractBearerToken,
  invalidateAuthCache,
} from "../../utils/auth-cache.js";
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

const NullablePaymentDayInput = z.union([
  z.number().int().min(1).max(31),
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
    monthly_fee: NullableNumberInput.optional(),
    payment_day: NullablePaymentDayInput.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const StudentPaymentUpdateSchema = z.object({
  received: z.boolean(),
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

const ExerciseCatalogImportXlsSchema = z.object({
  filename: z.string().max(255).optional(),
  file_base64: z.string().min(30),
  reset_existing: z.boolean().optional(),
});

const ExerciseCatalogResetSchema = z.object({
  confirm: z.boolean(),
});

const NullableUuidInput = z.union([z.string().uuid(), z.null()]);

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
          exercise_variation_id: NullableUuidInput.optional(),
          exercise_catalog_id: NullableUuidInput.optional(),
          equipment_id: NullableUuidInput.optional(),
          grip_footing_id: NullableUuidInput.optional(),
          method_id: NullableUuidInput.optional(),
          custom_description: z
            .union([z.string().max(2000), z.null(), z.literal("")])
            .optional(),
          target_sets: z.number().int().positive().max(100),
          target_reps: z.number().int().positive().max(1000),
          target_weight: z.union([z.number().nonnegative().max(1000), z.null()]).optional(),
          order_index: z.number().int().nonnegative().max(100),
          rest_seconds: z
            .number()
            .int()
            .nonnegative()
            .max(3600)
            .nullable()
            .optional(),
          biset_group_id: z.string().uuid().nullable().optional(),
        })
        .refine(
          (value) =>
            Boolean(
              value.exercise_id ||
                value.exercise_variation_id ||
                value.exercise_catalog_id,
            ),
          {
            message:
              "exercise_id, exercise_variation_id or exercise_catalog_id must be provided",
          },
        ),
    )
    .max(50)
    .optional(),
});

const WorkoutExerciseCreateSchema = z.object({
  exercise_id: z.string().uuid().optional(),
  exercise_variation_id: NullableUuidInput.optional(),
  exercise_catalog_id: NullableUuidInput.optional(),
  equipment_id: NullableUuidInput.optional(),
  grip_footing_id: NullableUuidInput.optional(),
  method_id: NullableUuidInput.optional(),
  target_sets: z.number().int().positive().max(100),
  target_reps: z.number().int().positive().max(1000),
  target_weight: z.union([z.number().nonnegative().max(1000), z.null()]).optional(),
  order_index: z.number().int().nonnegative().max(100),
  rest_seconds: z.number().int().nonnegative().max(3600).nullable().optional(),
  custom_description: z
    .union([z.string().max(2000), z.null(), z.literal("")])
    .optional(),
  biset_group_id: z.string().uuid().nullable().optional(),
}).refine(
  (value) =>
    Boolean(
      value.exercise_id || value.exercise_variation_id || value.exercise_catalog_id,
    ),
  {
    message:
      "exercise_id, exercise_variation_id or exercise_catalog_id must be provided",
  },
);

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
    grip_footing_id: z.union([z.string().uuid(), z.null()]).optional(),
    method_id: z.union([z.string().uuid(), z.null()]).optional(),
    custom_description: z
      .union([z.string().max(2000), z.null(), z.literal("")])
      .optional(),
    biset_group_id: z.string().uuid().nullable().optional(),
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
  "id,personal_id,name,email,whatsapp_number,blood_type,weight_kg,height_cm,monthly_fee,payment_day,is_active,created_at";
const STUDENTS_SELECT_BASE =
  "id,personal_id,name,whatsapp_number,is_active,created_at";
const PERSONAL_SELECT_FULL =
  "id,name,email,evolution_instance_name,phone,crf_registration,created_at";
const PERSONAL_SELECT_BASE = "id,name,email,evolution_instance_name,created_at";

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
    const catalogRow = Array.isArray(workoutExercise?.exercise_catalog)
      ? workoutExercise.exercise_catalog[0]
      : workoutExercise?.exercise_catalog;
    const variationRow = Array.isArray(workoutExercise?.exercise_variations)
      ? workoutExercise.exercise_variations[0]
      : workoutExercise?.exercise_variations;
    const exerciseRow = Array.isArray(workoutExercise?.exercises)
      ? workoutExercise.exercises[0]
      : workoutExercise?.exercises;
    const baseExerciseName = String(
      catalogRow?.name ?? exerciseRow?.name ?? "Exercício",
    );
    const exerciseName = variationRow?.name
      ? `${baseExerciseName} - ${variationRow.name}`
      : baseExerciseName;
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
      const repsDone = decryptNumber(setLog?.reps_done) ?? Number(setLog?.reps_done ?? 0);
      const weightUsed = decryptNumber(setLog?.weight_used) ?? Number(setLog?.weight_used ?? 0);
      const pseScore =
        setLog?.rpe_score == null ? "-" : (decryptNumber(setLog.rpe_score) ?? Number(setLog.rpe_score));
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
    msg.includes("height_cm") ||
    msg.includes("monthly_fee") ||
    msg.includes("payment_day")
  );
}

function isMissingStudentPaymentsTableError(error: any): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  const code = String(error?.code ?? "");
  return code === "42p01" || msg.includes("student_payment_records");
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
  if (!row) return row;
  return {
    ...row,
    name: decrypt(row?.name) ?? row?.name ?? null,
    email: decrypt(row?.email) ?? null,
    whatsapp_number: decrypt(row?.whatsapp_number) ?? row?.whatsapp_number ?? null,
    blood_type: decrypt(row?.blood_type) ?? null,
    weight_kg: decryptNumber(row?.weight_kg) ?? null,
    height_cm: decryptNumber(row?.height_cm) ?? null,
    monthly_fee: decryptNumber(row?.monthly_fee) ?? null,
    payment_day: decryptNumber(row?.payment_day) != null ? Math.round(decryptNumber(row?.payment_day)!) : null,
  };
}

function formatMonthReference(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthReferenceDate(date: Date): string {
  return `${formatMonthReference(date)}-01`;
}

function parseMonthReference(raw: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(raw)) {
    return null;
  }

  const [yearRaw, monthRaw] = raw.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  return new Date(year, month - 1, 1);
}

function buildStudentPaymentMonthWindow(
  studentCreatedAt: string | null | undefined,
  limitMonths = 5,
): Date[] {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const createdDate = studentCreatedAt ? new Date(studentCreatedAt) : null;
  const createdMonth =
    createdDate && !Number.isNaN(createdDate.getTime())
      ? new Date(createdDate.getFullYear(), createdDate.getMonth(), 1)
      : currentMonth;

  const startMonth = createdMonth <= currentMonth ? createdMonth : currentMonth;
  const months: Date[] = [];

  const cursor = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  while (cursor <= currentMonth) {
    months.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (months.length <= limitMonths) {
    return months;
  }

  return months.slice(months.length - limitMonths);
}

function buildDueDate(referenceMonthDate: Date, paymentDay: number): Date {
  const year = referenceMonthDate.getFullYear();
  const month = referenceMonthDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const dueDay = Math.max(1, Math.min(lastDay, Number(paymentDay) || 1));
  return new Date(year, month, dueDay);
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function diffInDays(from: Date, to: Date): number {
  const fromMidnight = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  );
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((toMidnight.getTime() - fromMidnight.getTime()) / msPerDay);
}

type StudentPaymentHistoryRow = {
  reference_month: string;
  due_date: string | null;
  received: boolean;
  received_at: string | null;
};

async function buildStudentPaymentHistory(
  client: ReturnType<typeof getRlsClient>,
  studentId: string,
  paymentDay: number | null | undefined,
  studentCreatedAt: string | null | undefined,
): Promise<StudentPaymentHistoryRow[]> {
  const monthDates = buildStudentPaymentMonthWindow(studentCreatedAt, 5);
  if (monthDates.length === 0) {
    return [];
  }
  const referenceMonthDates = monthDates.map(formatMonthReferenceDate);

  const { data: records, error } = await client
    .from("student_payment_records")
    .select("reference_month,received,received_at")
    .eq("student_id", studentId)
    .in("reference_month", referenceMonthDates);

  if (error) {
    if (isMissingStudentPaymentsTableError(error)) {
      return monthDates.map((monthDate) => ({
        reference_month: formatMonthReference(monthDate),
        due_date:
          typeof paymentDay === "number" && paymentDay > 0
            ? toDateOnlyString(buildDueDate(monthDate, paymentDay))
            : null,
        received: false,
        received_at: null,
      }));
    }

    throw error;
  }

  const byReference = new Map<
    string,
    {
      received: boolean;
      received_at: string | null;
    }
  >();

  for (const record of records ?? []) {
    const referenceMonth = String(record?.reference_month ?? "").slice(0, 7);
    if (!referenceMonth) continue;

    byReference.set(referenceMonth, {
      received: Boolean(record?.received),
      received_at:
        typeof record?.received_at === "string" ? record.received_at : null,
    });
  }

  return monthDates.map((monthDate) => {
    const referenceMonth = formatMonthReference(monthDate);
    const record = byReference.get(referenceMonth);

    return {
      reference_month: referenceMonth,
      due_date:
        typeof paymentDay === "number" && paymentDay > 0
          ? toDateOnlyString(buildDueDate(monthDate, paymentDay))
          : null,
      received: record?.received ?? false,
      received_at: record?.received_at ?? null,
    };
  });
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
  if (!row) return row;
  return {
    ...row,
    phone: decrypt(row?.phone) ?? null,
    crf_registration: decrypt(row?.crf_registration) ?? null,
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

function decodeBase64Payload(input: string): Buffer {
  const trimmed = String(input || "").trim();
  const dataPart = trimmed.includes(",") ? trimmed.split(",").slice(-1)[0] : trimmed;
  return Buffer.from(dataPart, "base64");
}

function extractExerciseNameFromRow(row: Record<string, unknown>): string {
  const aliases = [
    "Exercício",
    "Exercicio",
    "Nome Exercício",
    "Nome do Exercício",
    "Nome",
    "exercise",
    "name",
  ];

  for (const alias of aliases) {
    if (row[alias] == null) continue;
    const value = String(row[alias] ?? "").trim();
    if (value) return value;
  }

  return "";
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
  exerciseVariationId?: string | null;
  exerciseCatalogId?: string | null;
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

    let resolvedExerciseId = variation.legacy_exercise_id ?? null;

    if (!resolvedExerciseId && exerciseCatalogId) {
      const { data: catalog, error: catalogErr } = await supabaseAdmin
        .from("exercise_catalog")
        .select("legacy_exercise_id")
        .eq("id", exerciseCatalogId)
        .maybeSingle();

      if (!catalogErr && (catalog as any)?.legacy_exercise_id) {
        resolvedExerciseId = (catalog as any).legacy_exercise_id as string;
      }
    }

    if (exerciseId && resolvedExerciseId && exerciseId !== resolvedExerciseId) {
      throw app.httpErrors.badRequest(
        "exercise_id does not match provided exercise_variation_id",
      );
    }

    return {
      exerciseId: resolvedExerciseId ?? exerciseId ?? null,
      exerciseVariationId,
    };
  }

  if (exerciseCatalogId) {
    const { data: catalog, error: catalogError } = await supabaseAdmin
      .from("exercise_catalog")
      .select("id,personal_id,legacy_exercise_id")
      .eq("id", exerciseCatalogId)
      .maybeSingle();

    if (catalogError) {
      throw app.httpErrors.badRequest(catalogError.message);
    }

    if (!catalog) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    if (catalog.personal_id && catalog.personal_id !== personalId) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    const resolvedExerciseId = catalog.legacy_exercise_id ?? null;

    if (exerciseId && resolvedExerciseId && exerciseId !== resolvedExerciseId) {
      throw app.httpErrors.badRequest(
        "exercise_id does not match provided exercise_catalog_id",
      );
    }

    return {
      exerciseId: resolvedExerciseId ?? exerciseId ?? null,
      exerciseVariationId: null,
    };
  }

  if (!exerciseId) {
    throw app.httpErrors.badRequest(
      "exercise_id, exercise_variation_id or exercise_catalog_id must be provided",
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

async function resetPersonalExerciseBase(personalId: string) {
  const { data: workouts, error: workoutsError } = await supabaseAdmin
    .from("workouts")
    .select("id")
    .eq("personal_id", personalId);
  if (workoutsError) throw workoutsError;

  const workoutIds = (workouts ?? []).map((row: any) => row.id).filter(Boolean);

  if (workoutIds.length > 0) {
    const { error: clearWorkoutRefsError } = await supabaseAdmin
      .from("workout_exercises")
      .update({
        exercise_catalog_id: null,
        exercise_variation_id: null,
        equipment_id: null,
        grip_footing_id: null,
        method_id: null,
      })
      .in("workout_id", workoutIds);

    if (clearWorkoutRefsError) {
      throw clearWorkoutRefsError;
    }
  }

  const { data: ownCatalogRows, error: ownCatalogRowsError } = await supabaseAdmin
    .from("exercise_catalog")
    .select("id")
    .eq("personal_id", personalId);
  if (ownCatalogRowsError) {
    throw ownCatalogRowsError;
  }

  const ownCatalogIds = (ownCatalogRows ?? []).map((row: any) => row.id).filter(Boolean);

  if (ownCatalogIds.length > 0) {
    const { error: clearComboByCatalogError } = await supabaseAdmin
      .from("exercise_combo_cache")
      .delete()
      .in("exercise_catalog_id", ownCatalogIds);
    if (clearComboByCatalogError) {
      throw clearComboByCatalogError;
    }
  }

  const { data: ownVariationRows, error: ownVariationRowsError } = await supabaseAdmin
    .from("exercise_variations")
    .select("id")
    .eq("personal_id", personalId);
  if (ownVariationRowsError) {
    throw ownVariationRowsError;
  }

  const ownVariationIds = (ownVariationRows ?? []).map((row: any) => row.id).filter(Boolean);

  if (ownVariationIds.length > 0) {
    const { error: clearComboByVariationError } = await supabaseAdmin
      .from("exercise_combo_cache")
      .delete()
      .in("exercise_variation_id", ownVariationIds);
    if (clearComboByVariationError) {
      throw clearComboByVariationError;
    }
  }

  const { error: deleteOwnVariationsError } = await supabaseAdmin
    .from("exercise_variations")
    .delete()
    .eq("personal_id", personalId);
  if (deleteOwnVariationsError) {
    throw deleteOwnVariationsError;
  }

  const { error: deleteOwnCatalogError } = await supabaseAdmin
    .from("exercise_catalog")
    .delete()
    .eq("personal_id", personalId);
  if (deleteOwnCatalogError) {
    throw deleteOwnCatalogError;
  }

  const { error: deleteOwnLegacyExercisesError } = await supabaseAdmin
    .from("exercises")
    .delete()
    .eq("personal_id", personalId);
  if (deleteOwnLegacyExercisesError) {
    throw deleteOwnLegacyExercisesError;
  }

  return {
    removed_catalog_count: ownCatalogIds.length,
    removed_variations_count: ownVariationIds.length,
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
      payload.phone = encrypt(normalizedPhone);
      payload.phone_hash = hmacHash(normalizedPhone);
    }

    if (payload.crf_registration != null) {
      payload.crf_registration = encrypt(payload.crf_registration as string);
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

    // Invalidar cache de autenticação para forçar re-leitura do perfil atualizado
    invalidateAuthCache(token);

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
    const normalizedWhatsapp = normalizeBrazilWhatsappNumber(parsed.data.whatsapp_number) ?? parsed.data.whatsapp_number;
    const payload = {
      personal_id: personalId,
      name: encrypt(parsed.data.name),
      whatsapp_number: encrypt(normalizedWhatsapp),
      whatsapp_hash: hmacHash(normalizedWhatsapp),
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

  /**
   * GET /students/list — listagem leve com paginação (apenas campos visíveis na tabela).
   * Substitui GET /students para a tela de listagem de alunos.
   * Retorna: id, name, whatsapp_number, is_active, payment_day, last_session_date, payment_status + metadados de paginação.
   */
  app.get("/students/list", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    const query = request.query as { page?: string; limit?: string; search?: string };
    const page  = Math.max(1, parseInt(query.page  ?? "1",  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    // Select com campos para a tabela de listagem enriquecida
    const STUDENTS_SELECT_LIST = "id,name,whatsapp_number,is_active,payment_day,created_at";

    let result: any = await client
      .from("students")
      .select(STUDENTS_SELECT_LIST, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (result.error && isMissingStudentFieldError(result.error)) {
      result = await client
        .from("students")
        .select("id,name,whatsapp_number,is_active", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) throw app.httpErrors.badRequest(error.message);

    const studentIds = (data ?? []).map((r: any) => r.id).filter(Boolean);

    // Buscar última sessão completada de cada aluno (uma query única)
    let lastSessionsMap: Map<string, { date: string; created_at: string }> = new Map();
    if (studentIds.length > 0) {
      try {
        const { data: sessions } = await client
          .from("daily_sessions")
          .select("student_id,date,created_at")
          .in("student_id", studentIds)
          .eq("status", "completed")
          .order("date", { ascending: false });
        // Pega apenas a mais recente por aluno
        for (const s of sessions ?? []) {
          if (s.student_id && !lastSessionsMap.has(s.student_id)) {
            lastSessionsMap.set(s.student_id, { date: s.date, created_at: s.created_at });
          }
        }
      } catch (_) { /* ignora se tabela não existe */ }
    }

    // Buscar registros de pagamento do mês atual
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthDate = `${currentMonth}-01`;
    let paymentRecordsMap: Map<string, boolean> = new Map();
    if (studentIds.length > 0) {
      try {
        const { data: payRecs } = await client
          .from("student_payment_records")
          .select("student_id,received")
          .in("student_id", studentIds)
          .eq("reference_month", currentMonthDate);
        for (const pr of payRecs ?? []) {
          if (pr.student_id) paymentRecordsMap.set(pr.student_id, Boolean(pr.received));
        }
      } catch (_) { /* ignora se tabela não existe */ }
    }

    const students = (data ?? []).map((row: any) => {
      const paymentDay = decryptNumber(row.payment_day) != null ? Math.round(decryptNumber(row.payment_day)!) : null;
      const lastSession = lastSessionsMap.get(row.id) ?? null;

      // Calcular payment_status com base no payment_day e no registro do mês atual
      let paymentStatus: "pago" | "pendente" | "atrasado" = "pendente";
      const received = paymentRecordsMap.get(row.id);
      if (received === true) {
        paymentStatus = "pago";
      } else if (paymentDay != null) {
        const dueDay = paymentDay;
        const today = now.getDate();
        if (today > dueDay) {
          paymentStatus = "atrasado";
        } else {
          paymentStatus = "pendente";
        }
      }

      return {
        id:               row.id,
        name:             decrypt(row.name) ?? row.name ?? null,
        whatsapp_number:  decrypt(row.whatsapp_number) ?? row.whatsapp_number ?? null,
        is_active:        row.is_active,
        payment_day:      paymentDay,
        last_session_date: lastSession?.date ?? null,
        last_session_created_at: lastSession?.created_at ?? null,
        payment_status:   paymentStatus,
      };
    });

    return {
      data: students,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    };
  });

  /**
   * GET /students/:id/profile — dados do perfil do aluno (formulário de edição).
   * Substitui a seção "student" de /students/:id/details.
   */
  app.get("/students/:id/profile", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z.string().uuid().parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    let result: any = await client
      .from("students")
      .select(STUDENTS_SELECT_FULL)
      .eq("id", id)
      .maybeSingle();

    if (result.error && isMissingStudentFieldError(result.error)) {
      result = await client
        .from("students")
        .select(STUDENTS_SELECT_BASE)
        .eq("id", id)
        .maybeSingle();
    }

    const { data, error } = result;
    if (error) throw app.httpErrors.badRequest(error.message);
    if (!data)  throw app.httpErrors.notFound("Student not found");

    const student = normalizeStudentRow(data);

    const paymentHistory = await buildStudentPaymentHistory(
      client, id, student.payment_day, student.created_at,
    );

    return { student, payment_history: paymentHistory };
  });

  /**
   * GET /students/:id/workouts — treinos atribuídos ao aluno (aba Treinos do editor).
   * Substitui as seções "workouts" e "available_workouts" de /students/:id/details.
   * available_workouts removido: o frontend busca via GET /workouts quando necessário.
   */
  app.get("/students/:id/workouts", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z.string().uuid().parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const { data: assignments, error: workoutsError } = await client
      .from("student_workouts")
      .select(
        "id,workout_id,student_id,start_date,valid_until,tracking_mode,created_at," +
        "workouts(id,name,day_of_week,created_at," +
          "workout_exercises(id,exercise_id,exercise_catalog_id,exercise_variation_id," +
            "target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description," +
            "exercise_catalog(name),exercise_variations(name)," +
            "exercises(id,name)))",
      )
      .eq("student_id", id)
      .order("created_at", { ascending: false });

    if (workoutsError) throw app.httpErrors.badRequest(workoutsError.message);

    const workouts = (assignments ?? []).map((assignment: any) => {
      const workout = Array.isArray(assignment.workouts)
        ? assignment.workouts[0] : assignment.workouts;
      const rawEx: any[] = Array.isArray(workout?.workout_exercises)
        ? workout.workout_exercises : [];
      const normalisedEx = rawEx.map((we: any) => {
        const cat = Array.isArray(we.exercise_catalog) ? we.exercise_catalog[0] : we.exercise_catalog;
        const vari = Array.isArray(we.exercise_variations) ? we.exercise_variations[0] : we.exercise_variations;
        const leg  = Array.isArray(we.exercises) ? we.exercises[0] : we.exercises;
        const base = cat?.name ?? leg?.name ?? "Exercicio";
        return { ...we, _display_name: vari?.name ? `${base} - ${vari.name}` : base };
      });
      return {
        ...(workout ?? {}),
        workout_exercises: normalisedEx,
        assignment_id: assignment.id,
        assignment_start_date: assignment.start_date,
        assignment_valid_until: assignment.valid_until,
        assignment_tracking_mode: assignment.tracking_mode === "per_rep" ? "per_exercise" : (assignment.tracking_mode ?? "per_exercise"),
      };
    });

    return { workouts };
  });

  /**
   * GET /students/:id/sessions — histórico de sessões completadas (aba Histórico do editor).
   * Substitui a seção "completed_sessions" de /students/:id/details.
   * Suporta paginação via ?page= e ?limit=.
   */
  app.get("/students/:id/sessions", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const id = z.string().uuid().parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

    const query  = request.query as { page?: string; limit?: string };
    const page   = Math.max(1, parseInt(query.page  ?? "1",  10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const from   = (page - 1) * limit;
    const to     = from + limit - 1;

    let sessionsResult: any = await client
      .from("daily_sessions")
      .select(
        "id,date,status,created_at,updated_at,summary,workout_id,workouts(name)," +
        "set_logs(set_number,reps_done,weight_used,rpe_score,workout_exercise_id," +
          "workout_exercises(order_index,exercise_catalog(name),exercise_variations(name),exercises(name)))",
        { count: "exact" },
      )
      .eq("student_id", id)
      .eq("status", "completed")
      .order("date", { ascending: false })
      .range(from, to);

    if (sessionsResult.error && isMissingStudentFieldError(sessionsResult.error)) {
      sessionsResult = await client
        .from("daily_sessions")
        .select("id,date,status,created_at,updated_at,workout_id,workouts(name)", { count: "exact" })
        .eq("student_id", id)
        .eq("status", "completed")
        .order("date", { ascending: false })
        .range(from, to);
    }

    const { data: sessions, error: sessionsError, count } = sessionsResult;
    if (sessionsError) throw app.httpErrors.badRequest(sessionsError.message);

    const completed_sessions = (sessions ?? []).map((s: any) => {
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
        workout_name: Array.isArray(s.workouts) ? s.workouts[0]?.name : s.workouts?.name,
      };
    });

    return {
      data: completed_sessions,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    };
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
    if (payload.monthly_fee === "") payload.monthly_fee = null;
    if (payload.payment_day === "") payload.payment_day = null;

    // Preservar valor numérico do peso antes de criptografar (usado no upsert de weight_log abaixo)
    const weightKgNumeric: number | null =
      typeof payload.weight_kg === "number" && Number.isFinite(payload.weight_kg) && (payload.weight_kg as number) > 0
        ? (payload.weight_kg as number)
        : null;

    // Criptografar campos sensíveis antes de gravar
    if (payload.name != null) payload.name = encrypt(payload.name as string);
    if (payload.email != null) payload.email = encrypt(payload.email as string);
    if (payload.blood_type != null) payload.blood_type = encrypt(payload.blood_type as string);
    if (payload.height_cm != null) payload.height_cm = encryptNumber(payload.height_cm as number);
    if (payload.monthly_fee != null) payload.monthly_fee = encryptNumber(payload.monthly_fee as number);
    if (payload.payment_day != null) payload.payment_day = encryptNumber(payload.payment_day as number);
    if (payload.weight_kg != null) payload.weight_kg = encryptNumber(payload.weight_kg as number);
    if (payload.whatsapp_number != null) {
      const normalizedWa = normalizeBrazilWhatsappNumber(payload.whatsapp_number as string) ?? (payload.whatsapp_number as string);
      payload.whatsapp_number = encrypt(normalizedWa);
      payload.whatsapp_hash = hmacHash(normalizedWa);
    }

    if (
      Object.keys(payload).some((k) =>
        [
          "email",
          "blood_type",
          "weight_kg",
          "height_cm",
          "monthly_fee",
          "payment_day",
        ].includes(k),
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
        delete payload.monthly_fee;
        delete payload.payment_day;
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

    if (weightKgNumeric != null) {
      const today = new Date().toISOString().slice(0, 10);
      const { error: weightLogError } = await client
        .from("student_weight_logs")
        .upsert(
          {
            student_id: id,
            date: today,
            weight_kg: encryptNumber(weightKgNumeric),
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

  app.get("/students/:id/payments", async (request) => {
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

    try {
      const history = await buildStudentPaymentHistory(
        client,
        id,
        student.payment_day,
        student.created_at,
      );

      return {
        student: {
          id: student.id,
          monthly_fee: student.monthly_fee,
          payment_day: student.payment_day,
        },
        history,
      };
    } catch (error: any) {
      throw app.httpErrors.badRequest(error?.message || "Erro ao carregar pagamentos");
    }
  });

  app.patch("/students/:id/payments/:referenceMonth", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = StudentPaymentUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const referenceMonthRaw = String(
      (request.params as { referenceMonth?: string }).referenceMonth ?? "",
    );
    const referenceMonthDate = parseMonthReference(referenceMonthRaw);

    if (!referenceMonthDate) {
      throw app.httpErrors.badRequest(
        "referenceMonth must follow YYYY-MM format",
      );
    }

    const client = getRlsClient(token);
    const { data: student, error: studentError } = await client
      .from("students")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (studentError) {
      throw app.httpErrors.badRequest(studentError.message);
    }

    if (!student) {
      throw app.httpErrors.notFound("Student not found");
    }

    const upsertPayload = {
      student_id: id,
      reference_month: formatMonthReferenceDate(referenceMonthDate),
      received: parsed.data.received,
      received_at: parsed.data.received ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await client
      .from("student_payment_records")
      .upsert(upsertPayload, {
        onConflict: "student_id,reference_month",
        ignoreDuplicates: false,
      });

    if (upsertError) {
      if (isMissingStudentPaymentsTableError(upsertError)) {
        throw app.httpErrors.badRequest(
          "A tabela de pagamentos ainda não foi criada. Aplique as migrations financeiras.",
        );
      }

      throw app.httpErrors.badRequest(upsertError.message);
    }

    return {
      student_id: id,
      reference_month: formatMonthReference(referenceMonthDate),
      received: parsed.data.received,
      received_at: upsertPayload.received_at,
    };
  });

  app.get("/finance/dashboard", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    let studentsResult: any = await client
      .from("students")
      .select(STUDENTS_SELECT_FULL)
      .order("created_at", { ascending: false }); // ORDER BY name removed: name is encrypted

    if (studentsResult.error && isMissingStudentFieldError(studentsResult.error)) {
      studentsResult = await client
        .from("students")
        .select(STUDENTS_SELECT_BASE)
        .order("created_at", { ascending: false });
    }

    const { data: studentsData, error: studentsError } = studentsResult;
    if (studentsError) {
      throw app.httpErrors.badRequest(studentsError.message);
    }

    const students = (studentsData ?? [])
      .map(normalizeStudentRow)
      .sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR"));
    const activeStudents = students.filter((student: any) => student.is_active !== false);
    const billableStudents = activeStudents.filter(
      (student: any) =>
        Number(student.monthly_fee) > 0 &&
        Number.isInteger(Number(student.payment_day)) &&
        Number(student.payment_day) >= 1 &&
        Number(student.payment_day) <= 31,
    );

    const now = new Date();
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthReference = formatMonthReference(currentMonthDate);

    const studentIds = billableStudents
      .map((student: any) => String(student.id || ""))
      .filter(Boolean);

    const paymentMap = new Map<
      string,
      {
        received: boolean;
        received_at: string | null;
      }
    >();

    if (studentIds.length > 0) {
      const { data: records, error: recordsError } = await client
        .from("student_payment_records")
        .select("student_id,reference_month,received,received_at")
        .eq("reference_month", formatMonthReferenceDate(currentMonthDate))
        .in("student_id", studentIds);

      if (recordsError && !isMissingStudentPaymentsTableError(recordsError)) {
        throw app.httpErrors.badRequest(recordsError.message);
      }

      for (const record of records ?? []) {
        const studentId = String(record?.student_id ?? "");
        if (!studentId) continue;

        paymentMap.set(studentId, {
          received: Boolean(record?.received),
          received_at:
            typeof record?.received_at === "string" ? record.received_at : null,
        });
      }
    }

    let earnedAmount = 0;
    const overdueStudents: any[] = [];
    const pendingStudents: any[] = [];
    const upcomingDueStudents: any[] = [];

    for (const student of billableStudents) {
      const studentId = String(student.id);
      const monthlyFee = Number(student.monthly_fee || 0);
      const paymentDay = Number(student.payment_day || 1);
      const dueDate = buildDueDate(currentMonthDate, paymentDay);
      const dueDateString = toDateOnlyString(dueDate);
      const record = paymentMap.get(studentId);

      if (record?.received) {
        earnedAmount += monthlyFee;
        continue;
      }

      const daysUntilDue = diffInDays(now, dueDate);
      const studentSummary = {
        id: studentId,
        name: student.name,
        whatsapp_number: student.whatsapp_number,
        monthly_fee: Number(monthlyFee.toFixed(2)),
        payment_day: paymentDay,
        due_date: dueDateString,
      };

      pendingStudents.push({
        ...studentSummary,
        days_until_due: daysUntilDue,
      });

      if (daysUntilDue < 0) {
        overdueStudents.push({
          ...studentSummary,
          days_overdue: Math.abs(daysUntilDue),
        });
        continue;
      }

      if (daysUntilDue <= 7) {
        upcomingDueStudents.push({
          ...studentSummary,
          days_until_due: daysUntilDue,
        });
      }
    }

    overdueStudents.sort((a, b) => b.days_overdue - a.days_overdue);
    pendingStudents.sort((a, b) => a.days_until_due - b.days_until_due);
    upcomingDueStudents.sort((a, b) => a.days_until_due - b.days_until_due);

    return {
      reference_month: currentMonthReference,
      indicators: {
        earned_amount: Number(earnedAmount.toFixed(2)),
        students_count: activeStudents.length,
        pending_count: pendingStudents.length,
        overdue_count: overdueStudents.length,
        upcoming_due_count: upcomingDueStudents.length,
      },
      overdue_students: overdueStudents,
      upcoming_due_students: upcomingDueStudents,
      pending_students: pendingStudents,
    };
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
    const paymentHistory = await buildStudentPaymentHistory(
      client,
      id,
      student.payment_day,
      student.created_at,
    );

    const { data: assignments, error: workoutsError } = await client
      .from("student_workouts")
      .select(
        "id,workout_id,student_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,exercise_id,exercise_catalog_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,exercise_catalog(name),exercise_variations(name),exercises(id,name,description,muscle_group,equipment,gif_url)))",
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

      const rawEx: any[] = Array.isArray(workout?.workout_exercises) ? workout.workout_exercises : [];
      const normalisedEx = rawEx.map((we: any) => {
        const cat = Array.isArray(we.exercise_catalog) ? we.exercise_catalog[0] : we.exercise_catalog;
        const vari = Array.isArray(we.exercise_variations) ? we.exercise_variations[0] : we.exercise_variations;
        const leg = Array.isArray(we.exercises) ? we.exercises[0] : we.exercises;
        const base = cat?.name ?? leg?.name ?? "Exercicio";
        return { ...we, _display_name: vari?.name ? base + " - " + vari.name : base };
      });
      return {
        ...(workout ?? {}),
        workout_exercises: normalisedEx,
        assignment_id: assignment.id,
        assignment_start_date: assignment.start_date,
        assignment_valid_until: assignment.valid_until,
        assignment_tracking_mode: assignment.tracking_mode === "per_rep" ? "per_exercise" : (assignment.tracking_mode ?? "per_exercise"),
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
        "id,date,status,created_at,updated_at,summary,workout_id,workouts(name),set_logs(set_number,reps_done,weight_used,rpe_score,workout_exercise_id,workout_exercises(order_index,exercise_catalog(name),exercise_variations(name),exercises(name)))",
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
      payment_history: paymentHistory,
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
        .limit(200); // reduzido de 500 — cobre ~6 meses de treino diário

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
        .limit(5000); // reduzido de 20000 — 200 sessões × ~25 sets = 5000

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
        .limit(2000); // reduzido de 10000

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

      const usedWeight = decryptNumber(log?.weight_used) ?? Number(log?.weight_used ?? 0);
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
        const weight = decryptNumber(row?.weight_kg) ?? Number(row?.weight_kg ?? 0);
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

    if (weightTimeline.length === 0 && (decryptNumber((student as any).weight_kg) ?? Number((student as any).weight_kg)) > 0) {
      const fallbackDate = new Date().toISOString().slice(0, 10);
      const fallbackWeight = decryptNumber((student as any).weight_kg) ?? Number(Number((student as any).weight_kg).toFixed(2));
      weightTimeline.push({
        date: fallbackDate,
        weight_kg: Number(fallbackWeight.toFixed(2)),
      });
    }

    return {
      student: {
        id: student.id,
        name: decrypt((student as any).name) ?? (student as any).name,
        current_weight_kg:
          (student as any).weight_kg == null ? null : (decryptNumber((student as any).weight_kg) ?? Number((student as any).weight_kg)),
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
    const query = request.query as {
      search?: string;
      limit?: string;
      muscle_group_id?: string;
    };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      1000,
    );
    const muscleGroupId = (query.muscle_group_id ?? "").trim() || null;

    // Usa RPC search_exercise_catalog que aplica normalize_search (unaccent+lower) na coluna,
    // permitindo buscar "bulgaro" e encontrar "búlgaro", "abducao" → "Abdução", etc.
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "search_exercise_catalog",
      {
        p_search: search || null,
        p_personal_id: personalId,
        p_muscle_group_id: muscleGroupId || null,
        p_limit: limit,
      },
    );
    if (rpcError) throw app.httpErrors.badRequest(rpcError.message);

    // Enriquecer com muscle_group_name via join manual (a RPC não retorna o nome do grupo)
    const rows = rpcData ?? [];
    const uniqueGroupIds = [
      ...new Set(rows.map((r: any) => r.muscle_group_id).filter(Boolean)),
    ];
    let groupNameMap: Record<string, string> = {};
    if (uniqueGroupIds.length > 0) {
      const { data: groups } = await supabaseAdmin
        .from("muscle_groups")
        .select("id,name")
        .in("id", uniqueGroupIds);
      groupNameMap = Object.fromEntries(
        (groups ?? []).map((g: any) => [g.id, g.name]),
      );
    }

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      notes: row.notes,
      muscle_group_id: row.muscle_group_id ?? null,
      muscle_group_name: groupNameMap[row.muscle_group_id] ?? null,
    }));
  });

  app.post("/exercise-catalog", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as {
      name?: string;
      notes?: string | null;
      muscle_group_id?: string | null;
    };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());
    const notes = body?.notes?.trim() || null;
    const muscleGroupId = NullableUuidInput.optional().parse(
      body?.muscle_group_id ?? null,
    );

    const { data, error } = await supabaseAdmin
      .from("exercise_catalog")
      .insert({
        name,
        notes,
        personal_id: personalId,
        muscle_group_id: muscleGroupId ?? null,
      })
      .select("id,name,notes,personal_id,muscle_group_id,muscle_groups(name)")
      .single();

    if (error) throw app.httpErrors.badRequest(error.message);
    return {
      id: (data as any).id,
      name: (data as any).name,
      notes: (data as any).notes,
      personal_id: (data as any).personal_id,
      muscle_group_id: (data as any).muscle_group_id ?? null,
      muscle_group_name: (data as any).muscle_groups?.name ?? null,
    };
  });

  // ── Muscle groups CRUD ───────────────────────────────────────────────────────

  app.get("/muscle-groups", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      1000,
    );

    let q = supabaseAdmin
      .from("muscle_groups")
      .select("id,name")
      .order("name", { ascending: true });

    if (search) {
      q = q.ilike("name", `%${search}%`);
    }

    const { data, error } = await q.limit(limit);
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/muscle-groups", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(1).max(120).parse((body?.name ?? "").trim());

    const { data, error } = await supabaseAdmin
      .from("muscle_groups")
      .insert({ name })
      .select("id,name")
      .single();

    if (error) throw app.httpErrors.badRequest(error.message);
    return data;
  });

  app.delete("/muscle-groups/:id", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { error } = await supabaseAdmin
      .from("muscle_groups")
      .delete()
      .eq("id", id);

    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.delete("/exercise-catalog/:id", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("exercise_catalog")
      .select("id,personal_id")
      .eq("id", id)
      .or(`personal_id.is.null,personal_id.eq.${personalId}`)
      .maybeSingle();
    if (existingErr) throw app.httpErrors.badRequest(existingErr.message);
    if (!existing) throw app.httpErrors.notFound("Exercise not found");

    // Referências em workout_exercises (e caches associados) perdem o vínculo
    // automaticamente via ON DELETE SET NULL/CASCADE, então não é preciso
    // bloquear a exclusão quando o exercício já foi usado em algum treino.
    const { error } = await supabaseAdmin
      .from("exercise_catalog")
      .delete()
      .eq("id", id)
      .or(`personal_id.is.null,personal_id.eq.${personalId}`);

    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.patch("/exercise-catalog/:id/notes", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const body = request.body as {
      notes?: string | null;
      muscle_group_id?: string | null;
    };
    const update: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "notes")) {
      update.notes = body?.notes?.trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "muscle_group_id")) {
      update.muscle_group_id = NullableUuidInput.optional().parse(
        body?.muscle_group_id ?? null,
      );
    }

    const { data, error } = await supabaseAdmin
      .from("exercise_catalog")
      .update(update)
      .eq("id", id)
      .or(`personal_id.is.null,personal_id.eq.${personalId}`)
      .select("id,name,notes,muscle_group_id,muscle_groups(name)")
      .maybeSingle();

    if (error) throw app.httpErrors.badRequest(error.message);
    if (!data) throw app.httpErrors.notFound("Exercise not found");
    return {
      id: (data as any).id,
      name: (data as any).name,
      notes: (data as any).notes,
      muscle_group_id: (data as any).muscle_group_id ?? null,
      muscle_group_name: (data as any).muscle_groups?.name ?? null,
    };
  });

  app.post("/exercise-catalog/reset-base", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = ExerciseCatalogResetSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    if (!parsed.data.confirm) {
      throw app.httpErrors.badRequest("Confirmação obrigatória para resetar a base.");
    }

    let result;
    try {
      result = await resetPersonalExerciseBase(personalId);
    } catch (error: any) {
      throw app.httpErrors.badRequest(error?.message || "Erro ao resetar base");
    }

    return {
      success: true,
      removed_catalog_count: result.removed_catalog_count,
      removed_variations_count: result.removed_variations_count,
    };
  });

  app.post("/exercise-catalog/import-xls", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const parsed = ExerciseCatalogImportXlsSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    if (parsed.data.reset_existing) {
      try {
        await resetPersonalExerciseBase(personalId);
      } catch (error: any) {
        throw app.httpErrors.badRequest(error?.message || "Erro ao resetar base");
      }
    }

    let rows: Record<string, unknown>[] = [];
    try {
      const fileBuffer = decodeBase64Payload(parsed.data.file_base64);
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error("A planilha não possui abas válidas.");
      }

      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: "",
      });
    } catch (error: any) {
      throw app.httpErrors.badRequest(
        error?.message || "Arquivo XLS/XLSX inválido.",
      );
    }

    const seen = new Set<string>();
    const names: string[] = [];

    for (const row of rows) {
      const name = extractExerciseNameFromRow(row);
      if (!name) continue;
      const key = normalizeSearchComparable(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }

    if (names.length === 0) {
      throw app.httpErrors.badRequest(
        "Nenhum exercício válido encontrado. Use colunas como 'Nome' ou 'Exercício'.",
      );
    }

    const { data: existingRows, error: existingRowsError } = await supabaseAdmin
      .from("exercise_catalog")
      .select("id,name")
      .eq("personal_id", personalId);
    if (existingRowsError) {
      throw app.httpErrors.badRequest(existingRowsError.message);
    }

    const existingSet = new Set(
      (existingRows ?? []).map((row: any) => normalizeSearchComparable(row.name)),
    );

    const toInsert = names.filter(
      (name) => !existingSet.has(normalizeSearchComparable(name)),
    );

    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("exercise_catalog")
        .insert(toInsert.map((name) => ({ name, personal_id: personalId })));

      if (insertError) {
        throw app.httpErrors.badRequest(insertError.message);
      }
    }

    return {
      success: true,
      file: parsed.data.filename || null,
      total_rows: rows.length,
      imported_count: toInsert.length,
      skipped_existing_count: names.length - toInsert.length,
      reset_existing: Boolean(parsed.data.reset_existing),
    };
  });

  app.get("/exercise-catalog/import-template", async (request, reply) => {
    await getAuthenticatedPersonal(app, request);

    const workbook = XLSX.utils.book_new();
    const sampleRows = [
      {
        Nome: "Supino Reto",
        "Grupo muscular (opcional)": "Peito",
        "Observações (opcional)": "Priorizar execução controlada",
      },
      {
        Nome: "Leg Press",
        "Grupo muscular (opcional)": "Pernas",
        "Observações (opcional)": "Amplitude completa sem tirar o quadril do banco",
      },
      {
        Nome: "Puxada Frente",
        "Grupo muscular (opcional)": "Costas",
        "Observações (opcional)": "Evitar balanço do tronco",
      },
      {
        Nome: "Desenvolvimento Ombros",
        "Grupo muscular (opcional)": "Ombros",
        "Observações (opcional)": "Manter core ativo durante toda a série",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Exercicios");

    const instructionsRows = [
      {
        Campo: "Nome",
        Obrigatorio: "Sim",
        Regras: "Informe o nome do exercício. Ex.: Supino Reto",
      },
      {
        Campo: "Grupo muscular (opcional)",
        Obrigatorio: "Não",
        Regras: "Campo opcional para organização interna.",
      },
      {
        Campo: "Observações (opcional)",
        Obrigatorio: "Não",
        Regras: "Campo opcional com dicas de execução ou notas.",
      },
    ];
    const instructionsSheet = XLSX.utils.json_to_sheet(instructionsRows);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instrucoes");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    reply
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "Content-Disposition",
        'attachment; filename="modelo-importacao-exercicios.xlsx"',
      );

    return reply.send(buffer);
  });

  app.get("/exercise-variations", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      1000,
    );

    const { data, error } = await supabaseAdmin.rpc(
      "search_exercise_variations",
      { p_search: search || null, p_personal_id: personalId, p_limit: limit },
    );
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/exercise-variations", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());

    const { data, error } = await supabaseAdmin
      .from("exercise_variations")
      .insert({ name, personal_id: personalId })
      .select("id,name,personal_id")
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
      1000,
    );

    const { data, error } = await supabaseAdmin.rpc(
      "search_equipment_catalog",
      { p_search: search || null, p_limit: limit },
    );
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

  app.get("/grip-footing-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      1000,
    );

    const { data, error } = await supabaseAdmin.rpc(
      "search_grip_footing_catalog",
      { p_search: search || null, p_limit: limit },
    );
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/grip-footing-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("grip_footing_catalog")
      .insert({ name })
      .select("id,name")
      .maybeSingle();

    if (!insertErr && inserted) return inserted;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("grip_footing_catalog")
      .select("id,name")
      .eq("name", name)
      .maybeSingle();

    if (existingErr) throw app.httpErrors.badRequest(existingErr.message);
    if (existing) return existing;
    if (insertErr) throw app.httpErrors.badRequest(insertErr.message);
    throw app.httpErrors.badRequest("Unable to create grip/footing item");
  });

  app.delete("/grip-footing-catalog/:id", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: used, error: usedErr } = await supabaseAdmin
      .from("workout_exercises")
      .select("id")
      .eq("grip_footing_id", id)
      .limit(1);
    if (usedErr) throw app.httpErrors.badRequest(usedErr.message);
    if ((used ?? []).length > 0) {
      throw app.httpErrors.badRequest(
        "Grip/footing item is already used in workouts and cannot be removed.",
      );
    }

    const { error } = await supabaseAdmin
      .from("grip_footing_catalog")
      .delete()
      .eq("id", id);
    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.get("/method-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const query = request.query as { search?: string; limit?: string };
    const search = (query.search ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "20", 10) || 20, 1),
      1000,
    );

    const { data, error } = await supabaseAdmin.rpc(
      "search_method_catalog",
      { p_search: search || null, p_limit: limit },
    );
    if (error) throw app.httpErrors.badRequest(error.message);
    return data ?? [];
  });

  app.post("/method-catalog", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const body = request.body as { name?: string };
    const name = z.string().min(2).max(120).parse((body?.name ?? "").trim());

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("method_catalog")
      .insert({ name })
      .select("id,name")
      .maybeSingle();

    if (!insertErr && inserted) return inserted;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("method_catalog")
      .select("id,name")
      .eq("name", name)
      .maybeSingle();

    if (existingErr) throw app.httpErrors.badRequest(existingErr.message);
    if (existing) return existing;
    if (insertErr) throw app.httpErrors.badRequest(insertErr.message);
    throw app.httpErrors.badRequest("Unable to create method item");
  });

  app.delete("/method-catalog/:id", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data: used, error: usedErr } = await supabaseAdmin
      .from("workout_exercises")
      .select("id")
      .eq("method_id", id)
      .limit(1);
    if (usedErr) throw app.httpErrors.badRequest(usedErr.message);
    if ((used ?? []).length > 0) {
      throw app.httpErrors.badRequest(
        "Method is already used in workouts and cannot be removed.",
      );
    }

    const { error } = await supabaseAdmin
      .from("method_catalog")
      .delete()
      .eq("id", id);
    if (error) throw app.httpErrors.badRequest(error.message);
    return { success: true };
  });

  app.post("/exercise-combos/generate-description", async (request) => {
    const { personalId } = await getAuthenticatedPersonal(app, request);
    const body = request.body as {
      exercise_catalog_id?: string;
      exercise_variation_id?: string | null;
      equipment_id?: string | null;
      grip_footing_id?: string | null;
      method_id?: string | null;
    };

    const exerciseCatalogId = z
      .string()
      .uuid()
      .parse((body as any)?.exercise_catalog_id);
    const variationId = NullableUuidInput.optional().parse(
      (body as any)?.exercise_variation_id ?? null,
    );
    const equipmentId = NullableUuidInput.optional().parse(
      (body as any)?.equipment_id ?? null,
    );
    const gripFootingId = NullableUuidInput.optional().parse(
      (body as any)?.grip_footing_id ?? null,
    );
    const methodId = NullableUuidInput.optional().parse(
      (body as any)?.method_id ?? null,
    );

    // Check combo cache first (only possible when a variation is selected)
    if (variationId) {
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
    }

    // Fetch exercise name, optional related names, and muscle groups in parallel
    const [catalogRes, variationRes, equipmentRes, gripRes, methodRes, muscleGroupsRes] =
      await Promise.all([
        supabaseAdmin
          .from("exercise_catalog")
          .select("name")
          .eq("id", exerciseCatalogId)
          .or(`personal_id.is.null,personal_id.eq.${personalId}`)
          .maybeSingle(),
        variationId
          ? supabaseAdmin
              .from("exercise_variations")
              .select("name")
              .eq("id", variationId)
              .or(`personal_id.is.null,personal_id.eq.${personalId}`)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        equipmentId
          ? supabaseAdmin.from("equipment_catalog").select("name").eq("id", equipmentId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        gripFootingId
          ? supabaseAdmin.from("grip_footing_catalog").select("name").eq("id", gripFootingId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        methodId
          ? supabaseAdmin.from("method_catalog").select("name").eq("id", methodId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin.from("muscle_groups").select("id,name").order("name"),
      ]);

    if (catalogRes.error) throw app.httpErrors.badRequest(catalogRes.error.message);
    if (variationRes.error) throw app.httpErrors.badRequest((variationRes.error as any).message);
    if (equipmentRes.error) throw app.httpErrors.badRequest((equipmentRes.error as any).message);
    if (gripRes.error) throw app.httpErrors.badRequest((gripRes.error as any).message);
    if (methodRes.error) throw app.httpErrors.badRequest((methodRes.error as any).message);
    if (!catalogRes.data) throw app.httpErrors.notFound("Exercise not found");
    if (variationId && !variationRes.data) throw app.httpErrors.notFound("Variation not found");

    const result = await generateExerciseDescription({
      exerciseName: (catalogRes.data as any).name,
      variationName: (variationRes.data as any)?.name ?? null,
      equipmentName: (equipmentRes.data as any)?.name ?? null,
      gripFootingName: (gripRes.data as any)?.name ?? null,
      methodName: (methodRes.data as any)?.name ?? null,
      muscleGroups: (muscleGroupsRes.data ?? []).map((mg: any) => ({
        id: mg.id,
        name: mg.name,
      })),
    });

    // Save to combo cache (only possible when a variation is selected)
    if (variationId) {
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
    }

    return {
      description: normalizeExerciseAIDescription(result.description),
      muscle_group_name: result.muscleGroupName,
      cached: false,
    };
  });

  app.get("/exercise-combos/tree", async (request) => {
    await getAuthenticatedPersonal(app, request);
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(parseInt(query.limit ?? "5000", 10) || 5000, 1),
      5000,
    );

    const [combosRes, muscleGroupsRes, catalogsRes, variationsRes, equipmentsRes, gripsRes, methodsRes] = await Promise.all([
      supabaseAdmin
        .from("exercise_combo_options")
        .select("muscle_group_id,exercise_catalog_id,exercise_variation_id,equipment_id,grip_footing_id,method_id,description")
        .order("created_at", { ascending: true })
        .limit(limit),
      supabaseAdmin.from("muscle_groups").select("id,name").order("name"),
      supabaseAdmin.from("exercise_catalog").select("id,name,notes").order("name"),
      supabaseAdmin.from("exercise_variations").select("id,name").order("name"),
      supabaseAdmin.from("equipment_catalog").select("id,name").order("name"),
      supabaseAdmin.from("grip_footing_catalog").select("id,name").order("name"),
      supabaseAdmin.from("method_catalog").select("id,name").order("name"),
    ]);

    if (combosRes.error) throw app.httpErrors.badRequest(combosRes.error.message);
    if (muscleGroupsRes.error) throw app.httpErrors.badRequest(muscleGroupsRes.error.message);
    if (catalogsRes.error) throw app.httpErrors.badRequest(catalogsRes.error.message);
    if (variationsRes.error) throw app.httpErrors.badRequest(variationsRes.error.message);
    if (equipmentsRes.error) throw app.httpErrors.badRequest(equipmentsRes.error.message);
    if (gripsRes.error) throw app.httpErrors.badRequest(gripsRes.error.message);
    if (methodsRes.error) throw app.httpErrors.badRequest(methodsRes.error.message);

    const muscleGroupMap = new Map<string, string>();
    for (const row of muscleGroupsRes.data ?? []) {
      muscleGroupMap.set(String((row as any).id), String((row as any).name));
    }

    const catalogMap = new Map<string, { name: string; notes: string | null }>();
    for (const row of catalogsRes.data ?? []) {
      catalogMap.set(String((row as any).id), {
        name: String((row as any).name),
        notes: (row as any).notes ?? null,
      });
    }

    const variationMap = new Map<string, string>();
    for (const row of variationsRes.data ?? []) {
      variationMap.set(String((row as any).id), String((row as any).name));
    }

    const equipmentMap = new Map<string, string>();
    for (const row of equipmentsRes.data ?? []) {
      equipmentMap.set(String((row as any).id), String((row as any).name));
    }

    const gripMap = new Map<string, string>();
    for (const row of gripsRes.data ?? []) {
      gripMap.set(String((row as any).id), String((row as any).name));
    }

    const methodMap = new Map<string, string>();
    for (const row of methodsRes.data ?? []) {
      methodMap.set(String((row as any).id), String((row as any).name));
    }

    return (combosRes.data ?? []).map((row: any) => {
      const catalog = catalogMap.get(String(row.exercise_catalog_id));
      return {
        exercise_catalog_id: row.exercise_catalog_id,
        exercise_catalog_name: catalog?.name ?? null,
        exercise_notes: catalog?.notes ?? null,
        exercise_variation_id: row.exercise_variation_id,
        exercise_variation_name: variationMap.get(String(row.exercise_variation_id)) ?? null,
        muscle_group_id: row.muscle_group_id,
        muscle_group_name: muscleGroupMap.get(String(row.muscle_group_id)) ?? null,
        equipment_id: row.equipment_id,
        equipment_name: row.equipment_id ? equipmentMap.get(String(row.equipment_id)) ?? null : null,
        grip_footing_id: row.grip_footing_id,
        grip_footing_name: row.grip_footing_id ? gripMap.get(String(row.grip_footing_id)) ?? null : null,
        method_id: row.method_id,
        method_name: row.method_id ? methodMap.get(String(row.method_id)) ?? null : null,
        description: row.description ?? null,
      };
    });
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
          grip_footing_id: (ex as any).grip_footing_id ?? null,
          method_id: (ex as any).method_id ?? null,
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_weight: ex.target_weight ?? null,
          order_index: ex.order_index,
          rest_seconds: ex.rest_seconds ?? null,
          custom_description: (ex as any).custom_description === "" ? null : ((ex as any).custom_description ?? null),
          biset_group_id: (ex as any).biset_group_id ?? null,
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

    // Inclui exercícios no join para eliminar o N+1 do frontend
    // (antes: 1 GET /workouts + N GET /workouts/:id/exercises)
    const { data, error } = await client
      .from("workouts")
      .select(
        "id,name,day_of_week,start_date,created_at," +
        "student_workouts(student_id,students(name))," +
        "workout_exercises(id,order_index," +
          "target_sets,target_reps,target_weight,rest_seconds,custom_description," +
          "exercise_catalog_id,exercise_variation_id,exercise_id,biset_group_id," +
          "exercise_catalog(name)," +
          "exercise_variations(name)," +
          "exercises(id,name,description))",
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return (data ?? []).map((workout: any) => {
      // Normalizar exercícios para o mesmo formato de GET /workouts/:id/exercises
      const rawEx: any[] = Array.isArray(workout.workout_exercises)
        ? workout.workout_exercises : [];
      const exercises = rawEx
        .map((we: any) => {
          const cat  = Array.isArray(we.exercise_catalog) ? we.exercise_catalog[0] : we.exercise_catalog;
          const vari = Array.isArray(we.exercise_variations) ? we.exercise_variations[0] : we.exercise_variations;
          const leg  = Array.isArray(we.exercises) ? we.exercises[0] : we.exercises;
          const baseName = cat?.name ?? leg?.name ?? "Exercício";
          return {
            workout_exercise_id: we.id,
            name:               vari?.name ? `${baseName} - ${vari.name}` : baseName,
            order_index:        we.order_index,
            target_sets:        we.target_sets,
            target_reps:        we.target_reps,
            target_weight:      we.target_weight ?? null,
            rest_seconds:       we.rest_seconds ?? null,
            custom_description: we.custom_description ?? null,
            description:        leg?.description ?? null,
            description_default: leg?.description ?? null,
            biset_group_id:     we.biset_group_id ?? null,
          };
        })
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));

      const studentWorkouts = Array.isArray(workout.student_workouts)
        ? workout.student_workouts : [];

      return {
        id:               workout.id,
        name:             workout.name,
        day_of_week:      workout.day_of_week,
        start_date:       workout.start_date,
        created_at:       workout.created_at,
        assignments_count: studentWorkouts.length,
        assigned_students: studentWorkouts
          .map((a: any) => {
            const s = Array.isArray(a.students) ? a.students[0] : a.students;
            return decrypt(s?.name) ?? s?.name ?? null;
          })
          .filter(Boolean),
        exercises,
      };
    });
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
        grip_footing_id: parsed.data.grip_footing_id ?? null,
        method_id: parsed.data.method_id ?? null,
        target_sets: parsed.data.target_sets,
        target_reps: parsed.data.target_reps,
        target_weight: parsed.data.target_weight ?? null,
        order_index: parsed.data.order_index,
        rest_seconds: parsed.data.rest_seconds ?? null,
        custom_description:
          parsed.data.custom_description === ""
            ? null
            : (parsed.data.custom_description ?? null),
        biset_group_id: parsed.data.biset_group_id ?? null,
      })
      .select(
        "id,workout_id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,grip_footing_id,method_id,biset_group_id,created_at",
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
    if (payload.start_date === "" || payload.start_date == null) delete payload.start_date;
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
          "id,workout_id,exercise_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,grip_footing_id,method_id,biset_group_id,exercises(id,name)",
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

  // Batch reorder exercises within a workout
  app.patch("/workouts/:workout_id/exercises/reorder", async (request, reply) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { workout_id?: string }).workout_id);
    const items = z
      .array(z.object({ id: z.string().uuid(), order_index: z.number().int().nonnegative() }))
      .parse(request.body);
    const client = getRlsClient(token);

    await Promise.all(
      items.map(({ id, order_index }) =>
        client
          .from("workout_exercises")
          .update({ order_index })
          .eq("id", id)
          .eq("workout_id", workoutId),
      ),
    );

    return reply.code(204).send();
  });

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
        "id,student_id,workout_id,start_date,valid_until,tracking_mode,created_at,workouts(id,name,day_of_week,created_at,workout_exercises(id,workout_id,exercise_id,exercise_catalog_id,exercise_variation_id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,grip_footing_id,method_id,created_at,exercise_catalog(name),exercise_variations(name),exercises(id,name))),"
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

      // Normalise workout_exercises so the frontend always has a resolved name
      const rawExercises: any[] = Array.isArray(workout?.workout_exercises)
        ? workout.workout_exercises
        : [];
      const normalisedExercises = rawExercises.map((we: any) => {
        const catalog = Array.isArray(we.exercise_catalog)
          ? we.exercise_catalog[0]
          : we.exercise_catalog;
        const variation = Array.isArray(we.exercise_variations)
          ? we.exercise_variations[0]
          : we.exercise_variations;
        const legacy = Array.isArray(we.exercises) ? we.exercises[0] : we.exercises;
        const baseName = catalog?.name ?? legacy?.name ?? "Exercicio";
        const fullName = variation?.name ? (baseName + " - " + variation.name) : baseName;
        return { ...we, _display_name: fullName };
      });

      return {
        ...(workout ?? {}),
        workout_exercises: normalisedExercises,
        assignment_start_date: assignment.start_date,
        assignment_valid_until: assignment.valid_until,
        assignment_tracking_mode: assignment.tracking_mode === "per_rep" ? "per_exercise" : (assignment.tracking_mode ?? "per_exercise"),
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
        "id,target_sets,target_reps,target_weight,order_index,rest_seconds,custom_description,exercise_catalog_id,equipment_id,grip_footing_id,method_id,exercise_variation_id,biset_group_id,exercise_catalog(name),exercise_variations(name),equipment_catalog(name),grip_footing_catalog(name),method_catalog(name),exercises(id,name,description,muscle_group,equipment,gif_url)",
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
      const gripFooting = Array.isArray((we as any).grip_footing_catalog)
        ? (we as any).grip_footing_catalog[0]
        : (we as any).grip_footing_catalog;
      const method = Array.isArray((we as any).method_catalog)
        ? (we as any).method_catalog[0]
        : (we as any).method_catalog;

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
        grip_footing_id: (we as any).grip_footing_id ?? null,
        method_id: (we as any).method_id ?? null,
        biset_group_id: (we as any).biset_group_id ?? null,
        name: displayName,
        exercise_name: displayBaseName,
        variation_name: variation?.name ?? null,
        equipment_name: equipment?.name ?? null,
        grip_footing_name: gripFooting?.name ?? null,
        method_name: method?.name ?? null,
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
    // Descriptografar nome do aluno e valores de set_logs
    const rowsDecrypted = rows.map((row: any) => ({
      ...row,
      students: row.students
        ? { ...(Array.isArray(row.students) ? row.students[0] : row.students), name: decrypt((Array.isArray(row.students) ? row.students[0] : row.students)?.name) }
        : null,
      set_logs: (row.set_logs ?? []).map((log: any) => ({
        ...log,
        reps_done: decryptNumber(log.reps_done) ?? Number(log.reps_done ?? 0),
        weight_used: decryptNumber(log.weight_used) ?? Number(log.weight_used ?? 0),
      })),
    }));

    const totalVolume = rowsDecrypted.reduce((acc: number, row: any) => {
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
        total_sessions: rowsDecrypted.length,
        completed_sessions: rowsDecrypted.filter((row: any) => row.status === "completed")
          .length,
        total_volume: totalVolume,
      },
      sessions: rowsDecrypted,
    };
  });
}

