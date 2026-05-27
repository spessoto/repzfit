import crypto from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../config/supabase.js";

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AdminPersonalCreateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  email: z.string().email().max(255).trim(),
  password: z.string().min(6).max(128),
  evolution_instance_name: z.string().min(1).max(255).trim().optional(),
});

const AdminPersonalPatchSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    email: z.string().email().max(255).trim().optional(),
    password: z.string().min(6).max(128).optional(),
    evolution_instance_name: z.string().min(1).max(255).trim().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
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

export async function registerAdminApiRoutes(app: FastifyInstance) {
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

  app.get("/admin/personals", async (request) => {
    ensureAdminAuth(request);

    const { data, error } = await supabaseAdmin
      .from("personals")
      .select("id,name,email,evolution_instance_name,created_at")
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
        ...(input.evolution_instance_name
          ? { evolution_instance_name: input.evolution_instance_name }
          : {}),
      })
      .select("id,name,email,evolution_instance_name,created_at")
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
      .select("id,name,email,evolution_instance_name,created_at")
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
}
