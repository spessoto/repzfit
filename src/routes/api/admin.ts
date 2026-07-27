import crypto from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { normalizeBrazilWhatsappNumber } from "../../utils/whatsapp.js";
import { buildWebhookUrlFromRequest } from "../../utils/request.js";
import {
  ensureEvolutionWebhook,
  ensureEvolutionInstance,
  getEvolutionConnectionStatus,
  getEvolutionQrCode,
  getUnifiedEvolutionInstanceName,
  logoutEvolutionInstance,
} from "../../services/evolution-service.js";

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AdminPersonalCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  email: z.string().email().max(255).trim(),
  password: z.string().min(6).max(128),
  phone: z
    .string()
    .min(8)
    .max(30)
    .regex(/^[0-9+\s()-]+$/)
    .optional(),
  evolution_instance_name: z.string().min(1).max(255).trim().optional(),
});

const AdminPersonalPatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    email: z.string().email().max(255).trim().optional(),
    password: z.string().min(6).max(128).optional(),
    phone: z
      .union([
        z
          .string()
          .min(8)
          .max(30)
          .regex(/^[0-9+\s()-]+$/),
        z.literal(""),
        z.null(),
      ])
      .optional(),
    evolution_instance_name: z.string().min(1).max(255).trim().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const PersonalPublicSignupSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  email: z.string().email().max(255).trim(),
  whatsapp: z
    .string()
    .min(8)
    .max(30)
    .regex(/^[0-9+\s()-]+$/),
  password: z.string().min(8).max(128),
  source: z.string().max(120).trim().optional(),
});

const PersonalPasswordRecoverySchema = z.object({
  email: z.string().email().max(255).trim(),
  redirect_to: z.string().url().optional(),
});

const AdminPersonalSourceReportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

const AdminBotAnomalyLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  severity: z.enum(["info", "warn", "error"]).optional(),
  category: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(160).optional(),
  unresolved_only: z.string().max(10).optional(),
  student_id: z.string().uuid().optional(),
  whatsapp_number: z.string().min(6).max(30).optional(),
});

type AdminTokenPayload = {
  email: string;
  exp: number;
};



function toB64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function parseB64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payloadPart: string): string {
  return crypto
    .createHmac("sha256", env.ADMIN_TOKEN_SECRET)
    .update(payloadPart)
    .digest("base64url");
}

function createAdminToken(email: string): string {
  const payload: AdminTokenPayload = {
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
  };

  const payloadPart = toB64Url(JSON.stringify(payload));
  const signature = signPayload(payloadPart);

  return `${payloadPart}.${signature}`;
}

function verifyAdminToken(token: string): AdminTokenPayload | null {
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) {
    return null;
  }

  const expected = signPayload(payloadPart);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (signatureBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(parseB64Url(payloadPart)) as AdminTokenPayload;
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp <= now) {
      return null;
    }

    if (payload.email.toLowerCase() !== env.ADMIN_PANEL_EMAIL.toLowerCase()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw request.server.httpErrors.unauthorized("Missing bearer token");
  }

  return header.slice("Bearer ".length).trim();
}

function ensureAdminAuth(request: FastifyRequest) {
  const token = extractBearerToken(request);
  const payload = verifyAdminToken(token);

  if (!payload) {
    throw request.server.httpErrors.unauthorized("Invalid admin token");
  }

  return payload;
}

function isStrongPassword(password: string): boolean {
  return (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
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

export async function registerAdminApiRoutes(app: FastifyInstance) {
  app.post("/public/personals/signup", async (request) => {
    const parsed = PersonalPublicSignupSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const input = parsed.data;
    const normalizedWhatsapp = normalizeBrazilWhatsappNumber(input.whatsapp);

    if (!normalizedWhatsapp) {
      throw app.httpErrors.badRequest(
        "WhatsApp inválido. Use no formato 55DDDNUMERO.",
      );
    }

    if (!isStrongPassword(input.password)) {
      throw app.httpErrors.badRequest(
        "Senha fraca. Use pelo menos 8 caracteres com letra maiúscula, minúscula, número e símbolo.",
      );
    }

    const { data: authUserData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });

    if (authError || !authUserData.user) {
      throw app.httpErrors.badRequest(
        authError?.message || "Não foi possível criar o usuário",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("personals")
      .insert({
        id: authUserData.user.id,
        name: input.name,
        email: input.email,
        phone: normalizedWhatsapp,
        signup_source: input.source || null,
      })
      .select("id,name,email,phone,evolution_instance_name,created_at")
      .single();

    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(authUserData.user.id);
      throw app.httpErrors.badRequest(error.message);
    }

    app.log.info(
      {
        personalId: data.id,
        email: data.email,
        source: input.source || "embed",
      },
      "Public personal signup completed",
    );

    return {
      message: "Cadastro realizado com sucesso",
      personal: data,
    };
  });

  app.post("/public/personals/password-recovery", async (request) => {
    const parsed = PersonalPasswordRecoverySchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const { email, redirect_to: redirectTo } = parsed.data;
    const finalRedirectTo = redirectTo || env.PASSWORD_RECOVERY_REDIRECT_URL;

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      ...(finalRedirectTo ? { redirectTo: finalRedirectTo } : {}),
    });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return {
      message:
        "Se o e-mail existir, você receberá um link para redefinir a senha.",
    };
  });

  app.post("/admin/login", async (request) => {
    const parsed = AdminLoginSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

        const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    const emailMatch =
      email === env.ADMIN_PANEL_EMAIL.toLowerCase();
    const passwordMatch = crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(env.ADMIN_PANEL_PASSWORD),
    );

    if (!emailMatch || !passwordMatch) {
      throw app.httpErrors.unauthorized("Invalid admin credentials");
    }

    return {
      token: createAdminToken(email),
      admin_email: env.ADMIN_PANEL_EMAIL,
      expires_in_seconds: 60 * 60 * 12,
    };
  });

  app.get("/admin/whatsapp/connection/qrcode", async (request) => {
    ensureAdminAuth(request);

    const instanceName = getUnifiedEvolutionInstanceName();

    await ensureEvolutionInstance(instanceName);
    await ensureEvolutionWebhookForRequest(app, request, instanceName);
    const qr = await getEvolutionQrCode(instanceName);

    return {
      instance: instanceName,
      ...qr,
    };
  });

  app.get("/admin/whatsapp/connection/status", async (request) => {
    ensureAdminAuth(request);

    const instanceName = getUnifiedEvolutionInstanceName();

    await ensureEvolutionInstance(instanceName);
    await ensureEvolutionWebhookForRequest(app, request, instanceName);

    const status = await getEvolutionConnectionStatus(instanceName);
    const instanceData = (status as any).instance || status;

    return {
      instance: instanceName,
      state: instanceData.state || instanceData.status,
      ...instanceData,
    };
  });

  app.delete("/admin/whatsapp/connection/logout", async (request) => {
    ensureAdminAuth(request);

    const instanceName = getUnifiedEvolutionInstanceName();
    await logoutEvolutionInstance(instanceName);

    return {
      instance: instanceName,
      message: "Unified instance logged out successfully",
    };
  });

  app.get("/admin/personals", async (request) => {
    ensureAdminAuth(request);

    const { data, error } = await supabaseAdmin
      .from("personals")
      .select("id,name,email,phone,evolution_instance_name,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data ?? [];
  });

  app.post("/admin/personals", async (request) => {
    ensureAdminAuth(request);

    const parsed = AdminPersonalCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const input = parsed.data;
    const normalizedPhone = input.phone
      ? normalizeBrazilWhatsappNumber(input.phone)
      : null;

    if (input.phone && !normalizedPhone) {
      throw app.httpErrors.badRequest(
        "WhatsApp inválido. Use no formato 55DDDNUMERO.",
      );
    }

    const { data: authUserData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });

    if (authError || !authUserData.user) {
      throw app.httpErrors.badRequest(
        authError?.message || "Failed to create user",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("personals")
      .insert({
        id: authUserData.user.id,
        name: input.name,
        email: input.email,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(input.evolution_instance_name
          ? { evolution_instance_name: input.evolution_instance_name }
          : {}),
      })
      .select("id,name,email,phone,evolution_instance_name,created_at")
      .single();

    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(authUserData.user.id);
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  app.patch("/admin/personals/:id", async (request) => {
    ensureAdminAuth(request);

    const parsed = AdminPersonalPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    if (parsed.data.email || parsed.data.password) {
      const authPatch: Record<string, string> = {};
      if (parsed.data.email) authPatch.email = parsed.data.email;
      if (parsed.data.password) authPatch.password = parsed.data.password;

      const { error: authUpdateError } =
        await supabaseAdmin.auth.admin.updateUserById(id, authPatch);

      if (authUpdateError) {
        throw app.httpErrors.badRequest(authUpdateError.message);
      }
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.email !== undefined) patch.email = parsed.data.email;
    if (parsed.data.phone !== undefined) {
      if (parsed.data.phone === "" || parsed.data.phone === null) {
        patch.phone = null;
      } else {
        const normalizedPhone = normalizeBrazilWhatsappNumber(
          parsed.data.phone,
        );
        if (!normalizedPhone) {
          throw app.httpErrors.badRequest(
            "WhatsApp inválido. Use no formato 55DDDNUMERO.",
          );
        }
        patch.phone = normalizedPhone;
      }
    }
    if (parsed.data.evolution_instance_name !== undefined) {
      patch.evolution_instance_name = parsed.data.evolution_instance_name;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("personals")
        .update(patch)
        .eq("id", id);

      if (updateError) {
        throw app.httpErrors.badRequest(updateError.message);
      }
    }

    const { data, error } = await supabaseAdmin
      .from("personals")
      .select("id,name,email,phone,evolution_instance_name,created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Personal not found");
    }

    return data;
  });

  app.delete("/admin/personals/:id", async (request) => {
    ensureAdminAuth(request);

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    // First fetch the personal to get the auth user id (same as row id in Supabase)
    const { data: personal, error: fetchError } = await supabaseAdmin
      .from("personals")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      throw app.httpErrors.badRequest(fetchError.message);
    }

    if (!personal) {
      throw app.httpErrors.notFound("Personal not found");
    }

    // Delete the row from personals table first
    const { error: deleteRowError } = await supabaseAdmin
      .from("personals")
      .delete()
      .eq("id", id);

    if (deleteRowError) {
      throw app.httpErrors.badRequest(deleteRowError.message);
    }

    // Delete the auth user (best-effort — ignore if already gone)
    await supabaseAdmin.auth.admin.deleteUser(id);

    return { success: true };
  });

  app.get("/admin/personals/source-report", async (request) => {
    ensureAdminAuth(request);

    const parsedQuery = AdminPersonalSourceReportQuerySchema.safeParse(
      request.query,
    );

    if (!parsedQuery.success) {
      throw app.httpErrors.badRequest(parsedQuery.error.message);
    }

    const days = parsedQuery.data.days ?? 30;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19);

    const { data, error } = await supabaseAdmin
      .from("personals")
      .select("signup_source,created_at")
      .gte("created_at", fromDate);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    const buckets = new Map<string, { source: string; count: number }>();

    for (const row of data ?? []) {
      const source =
        typeof row.signup_source === "string" && row.signup_source.trim()
          ? row.signup_source.trim()
          : "sem-origem";
      const prev = buckets.get(source);
      if (prev) {
        prev.count += 1;
      } else {
        buckets.set(source, { source, count: 1 });
      }
    }

    const report = Array.from(buckets.values()).sort(
      (a, b) => b.count - a.count,
    );

    return {
      days,
      total_signups: (data ?? []).length,
      sources: report,
    };
  });

  app.get("/admin/bot/anomaly-logs", async (request) => {
    ensureAdminAuth(request);

    const parsedQuery = AdminBotAnomalyLogsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      throw app.httpErrors.badRequest(parsedQuery.error.message);
    }

    const page = parsedQuery.data.page ?? 1;
    const limit = parsedQuery.data.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const unresolvedOnlyRaw =
      parsedQuery.data.unresolved_only?.trim().toLowerCase() ?? "";
    const unresolvedOnly =
      unresolvedOnlyRaw === "1" ||
      unresolvedOnlyRaw === "true" ||
      unresolvedOnlyRaw === "yes";

    let query = supabaseAdmin
      .from("bot_anomaly_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (parsedQuery.data.severity) {
      query = query.eq("severity", parsedQuery.data.severity);
    }

    if (parsedQuery.data.category) {
      query = query.eq("category", parsedQuery.data.category.trim());
    }

    if (parsedQuery.data.code) {
      query = query.eq("code", parsedQuery.data.code.trim());
    }

    if (parsedQuery.data.student_id) {
      query = query.eq("student_id", parsedQuery.data.student_id);
    }

    if (parsedQuery.data.whatsapp_number) {
      query = query.eq(
        "whatsapp_number",
        parsedQuery.data.whatsapp_number.trim(),
      );
    }

    if (unresolvedOnly) {
      query = query.eq("resolved", false);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return {
      data: data ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      filters: {
        severity: parsedQuery.data.severity ?? null,
        category: parsedQuery.data.category ?? null,
        code: parsedQuery.data.code ?? null,
        unresolved_only: unresolvedOnly,
        student_id: parsedQuery.data.student_id ?? null,
        whatsapp_number: parsedQuery.data.whatsapp_number ?? null,
      },
    };
  });

  // Admin: Get students of a specific personal
  app.get("/admin/personals/:id/students", async (request) => {
    ensureAdminAuth(request);

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { data, error } = await supabaseAdmin
      .from("students")
      .select(
        "id,personal_id,name,whatsapp_number,email,blood_type,weight_kg,height_cm,is_active,created_at",
      )
      .eq("personal_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data ?? [];
  });

  // Admin: Create a student for a personal
  const AdminStudentCreateSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    whatsapp_number: z
      .string()
      .min(8)
      .max(30)
      .regex(/^[0-9+\s()-]+$/),
    email: z.string().email().max(255).trim().optional(),
    blood_type: z.enum(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]).optional(),
    weight_kg: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
  });

  app.post("/admin/personals/:id/students", async (request) => {
    ensureAdminAuth(request);

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const parsed = AdminStudentCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const input = parsed.data;
    const normalizedPhone = normalizeBrazilWhatsappNumber(input.whatsapp_number);

    if (!normalizedPhone) {
      throw app.httpErrors.badRequest(
        "WhatsApp inválido. Use no formato 55DDDNUMERO.",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert({
        personal_id: id,
        name: input.name,
        whatsapp_number: normalizedPhone,
        ...(input.email ? { email: input.email } : {}),
        ...(input.blood_type ? { blood_type: input.blood_type } : {}),
        ...(input.weight_kg ? { weight_kg: input.weight_kg } : {}),
        ...(input.height_cm ? { height_cm: input.height_cm } : {}),
      })
      .select(
        "id,personal_id,name,whatsapp_number,email,blood_type,weight_kg,height_cm,is_active,created_at",
      )
      .single();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    return data;
  });

  // Admin: Update a student
  const AdminStudentPatchSchema = z
    .object({
      name: z.string().min(1).max(255).trim().optional(),
      email: z.string().email().max(255).trim().optional(),
      whatsapp_number: z
        .union([
          z
            .string()
            .min(8)
            .max(30)
            .regex(/^[0-9+\s()-]+$/),
          z.literal(""),
          z.null(),
        ])
        .optional(),
      blood_type: z
        .union([z.enum(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]), z.literal("")])
        .optional(),
      weight_kg: z.union([z.number().positive(), z.null()]).optional(),
      height_cm: z.union([z.number().positive(), z.null()]).optional(),
      is_active: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field must be provided",
    });

  app.patch("/admin/students/:id", async (request) => {
    ensureAdminAuth(request);

    const parsed = AdminStudentPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      throw app.httpErrors.badRequest(parsed.error.message);
    }

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.email !== undefined) patch.email = parsed.data.email;
    if (parsed.data.whatsapp_number !== undefined) {
      if (parsed.data.whatsapp_number === "" || parsed.data.whatsapp_number === null) {
        patch.whatsapp_number = null;
      } else {
        const normalizedPhone = normalizeBrazilWhatsappNumber(
          parsed.data.whatsapp_number,
        );
        if (!normalizedPhone) {
          throw app.httpErrors.badRequest(
            "WhatsApp inválido. Use no formato 55DDDNUMERO.",
          );
        }
        patch.whatsapp_number = normalizedPhone;
      }
    }
    if (parsed.data.blood_type !== undefined) {
      patch.blood_type = parsed.data.blood_type || null;
    }
    if (parsed.data.weight_kg !== undefined) patch.weight_kg = parsed.data.weight_kg;
    if (parsed.data.height_cm !== undefined) patch.height_cm = parsed.data.height_cm;
    if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active;

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("students")
        .update(patch)
        .eq("id", id);

      if (updateError) {
        throw app.httpErrors.badRequest(updateError.message);
      }
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .select(
        "id,personal_id,name,whatsapp_number,email,blood_type,weight_kg,height_cm,is_active,created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw app.httpErrors.badRequest(error.message);
    }

    if (!data) {
      throw app.httpErrors.notFound("Student not found");
    }

    return data;
  });

  // Admin: Delete a student
  app.delete("/admin/students/:id", async (request) => {
    ensureAdminAuth(request);

    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: string }).id);

    const { error: deleteError } = await supabaseAdmin
      .from("students")
      .delete()
      .eq("id", id);

    if (deleteError) {
      throw app.httpErrors.badRequest(deleteError.message);
    }

    return { success: true };
  });
}

