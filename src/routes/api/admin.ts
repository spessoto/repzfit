import crypto from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";
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

type AdminTokenPayload = {
  email: string;
  exp: number;
};

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

    if (
      email !== env.ADMIN_PANEL_EMAIL.toLowerCase() ||
      password !== env.ADMIN_PANEL_PASSWORD
    ) {
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
}
