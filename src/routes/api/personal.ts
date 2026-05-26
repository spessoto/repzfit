import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import {
  ensureEvolutionInstance,
  getEvolutionConnectionStatus,
  getEvolutionQrCode,
  logoutEvolutionInstance,
} from "../../services/evolution-service.js";

const StudentCreateSchema = z.object({
  name: z.string().min(1),
  whatsapp_number: z.string().min(8),
  is_active: z.boolean().optional(),
});

const StudentPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    whatsapp_number: z.string().min(8).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const ExerciseCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  muscle_group: z.string().optional(),
  equipment: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const ExercisePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    muscle_group: z.string().optional(),
    equipment: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const WorkoutCreateSchema = z.object({
  student_id: z.string().uuid(),
  name: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  day_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  exercises: z
    .array(
      z.object({
        exercise_id: z.string().uuid(),
        target_sets: z.number().int().positive(),
        target_reps: z.number().int().positive(),
        target_weight: z.number().nonnegative().optional(),
        order_index: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

const WorkoutExerciseCreateSchema = z.object({
  exercise_id: z.string().uuid(),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  target_weight: z.number().nonnegative().optional(),
  order_index: z.number().int().nonnegative(),
});

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

export async function registerPersonalApiRoutes(app: FastifyInstance) {
  app.get("/personal/connection/qrcode", async (request) => {
    const { personal } = await getAuthenticatedPersonal(app, request);

    await ensureEvolutionInstance(personal.evolution_instance_name);
    const qr = await getEvolutionQrCode(personal.evolution_instance_name);

    return {
      instance: personal.evolution_instance_name,
      ...qr,
    };
  });

  app.get("/personal/connection/status", async (request) => {
    const { personal } = await getAuthenticatedPersonal(app, request);

    const status = await getEvolutionConnectionStatus(
      personal.evolution_instance_name,
    );

    // Evolution API returns {instance: {state: "open", instanceName: "..."}}
    // Extract the nested instance object
    const instanceData = (status as any).instance || status;

    return {
      instance: personal.evolution_instance_name,
      state: instanceData.state || instanceData.status,
      ...instanceData,
    };
  });

  app.delete("/personal/connection/logout", async (request) => {
    const { personal } = await getAuthenticatedPersonal(app, request);

    await logoutEvolutionInstance(personal.evolution_instance_name);

    return {
      instance: personal.evolution_instance_name,
      message: "Instance logged out successfully",
    };
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
      .select("id,personal_id,name,whatsapp_number,is_active,created_at")
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.get("/students", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("students")
      .select("id,personal_id,name,whatsapp_number,is_active,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data ?? [];
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

    const { data, error } = await client
      .from("students")
      .update(parsed.data)
      .eq("id", id)
      .select("id,personal_id,name,whatsapp_number,is_active,created_at")
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Student not found");
    }

    return data;
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

    const { data, error } = await client
      .from("exercises")
      .select(
        "id,personal_id,name,description,muscle_group,equipment,tags,created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data ?? [];
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
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = WorkoutCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const client = getRlsClient(token);

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id")
      .eq("id", parsed.data.student_id)
      .maybeSingle();

    if (studentError) {
      throw app.httpErrors.badRequest(studentError.message);
    }

    if (!student) {
      throw app.httpErrors.notFound("Student not found");
    }

    // Create workout
    const workoutData: any = {
      student_id: parsed.data.student_id,
      name: parsed.data.name,
      day_of_week: parsed.data.day_of_week ?? null,
    };

    // Add dates if provided
    if (parsed.data.start_date) {
      workoutData.start_date = parsed.data.start_date;
    }
    if (parsed.data.valid_until) {
      workoutData.valid_until = parsed.data.valid_until;
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

  app.post("/workouts/:id/exercises", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const parsed = WorkoutExerciseCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const workoutId = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);
    const client = getRlsClient(token);

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

    const { data: exercise, error: exerciseError } = await client
      .from("exercises")
      .select("id")
      .eq("id", parsed.data.exercise_id)
      .maybeSingle();

    if (exerciseError) {
      throw app.httpErrors.badRequest(exerciseError.message);
    }

    if (!exercise) {
      throw app.httpErrors.notFound("Exercise not found");
    }

    const { data, error } = await client
      .from("workout_exercises")
      .insert({
        workout_id: workoutId,
        exercise_id: parsed.data.exercise_id,
        target_sets: parsed.data.target_sets,
        target_reps: parsed.data.target_reps,
        target_weight: parsed.data.target_weight ?? null,
        order_index: parsed.data.order_index,
      })
      .select(
        "id,workout_id,exercise_id,target_sets,target_reps,target_weight,order_index,created_at",
      )
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.get("/workouts/student/:student_id", async (request) => {
    const { token } = await getAuthenticatedPersonal(app, request);
    const studentId = z
      .string()
      .uuid()
      .parse((request.params as { student_id?: string }).student_id);
    const client = getRlsClient(token);

    const { data, error } = await client
      .from("workouts")
      .select(
        "id,student_id,name,day_of_week,start_date,valid_until,created_at,workout_exercises(id,workout_id,exercise_id,target_sets,target_reps,target_weight,order_index,created_at)",
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data ?? [];
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
        "id,target_sets,target_reps,target_weight,order_index,exercises!inner(id,name,description,muscle_group)",
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
        id: exercise?.id,
        name: exercise?.name,
        description: exercise?.description,
        muscle_group: exercise?.muscle_group,
        target_sets: we.target_sets,
        target_reps: we.target_reps,
        target_weight: we.target_weight,
        order_index: we.order_index,
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
