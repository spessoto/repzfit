import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  EVOLUTION_BASE_URL: z.url().default("https://evolution.pododesk.com.br"),
  EVOLUTION_GLOBAL_KEY: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1),
  EVOLUTION_UNIFIED_INSTANCE_NAME: z.string().min(1),
    FRONTEND_URL: z.url().optional(),
  PASSWORD_RECOVERY_REDIRECT_URL: z.url().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  REST_TIMER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  OPENAI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),

  ADMIN_PANEL_EMAIL: z.string().email().default("agencia@stagesix.com.br"),
  ADMIN_PANEL_PASSWORD: z.string().min(1).default("123456"),
  ADMIN_TOKEN_SECRET: z
    .string()
    .min(16)
    .default("repzfit_admin_secret_change_me_2026"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${formatted}`);
}

export const env = parsed.data;

// Avisos de segurança — exibidos em qualquer ambiente
const DEFAULT_PASSWORD = "123456";
const DEFAULT_TOKEN_SECRET = "repzfit_admin_secret_change_me_2026";

if (env.ADMIN_PANEL_PASSWORD === DEFAULT_PASSWORD) {
  console.warn(
    "[security] ADMIN_PANEL_PASSWORD está com o valor padrão inseguro. Defina uma senha forte antes de expor o serviço.",
  );
}

if (env.ADMIN_TOKEN_SECRET === DEFAULT_TOKEN_SECRET) {
  console.warn(
    "[security] ADMIN_TOKEN_SECRET está com o valor padrão. Defina um segredo forte (mín. 32 chars) antes de expor o serviço.",
  );
}

if (env.NODE_ENV === "production" && !env.CRON_SECRET) {
  console.warn(
    "[security] CRON_SECRET não definido em produção. O endpoint /api/internal/session-cleanup ficará desprotegido.",
  );
}
