-- Logs de erros de ações da plataforma (criar treino, salvar, excluir, etc.)
-- Tabela separada de bot_anomaly_logs que cobre o bot de WhatsApp.
-- Esta tabela cobre todas as ações do painel do personal trainer.

create table if not exists public.system_action_logs (
  id            uuid        primary key default gen_random_uuid(),
  -- Nível de severidade
  severity      text        not null default 'error'
                            check (severity in ('info', 'warn', 'error')),
  -- Área funcional: 'workout', 'student', 'exercise', 'payment', 'auth', 'connection', 'system'
  area          text        not null,
  -- Ação específica: 'create_workout', 'save_workout', 'add_exercise', etc.
  action        text        not null,
  -- Mensagem legível do erro (texto do sistema, não PII)
  message       text        not null,
  -- ID do personal que executou a ação (nullable em erros de auth)
  personal_id   uuid        references public.personals(id) on delete set null,
  -- Recurso afetado (workout_id, student_id, exercise_id, etc.)
  resource_id   text,
  resource_type text,
  -- Código HTTP ou código de erro interno
  error_code    text,
  -- Contexto extra em JSON (payload, stack parcial, etc.)
  context       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default timezone('utc'::text, now())
);

-- Índices para as consultas mais comuns no painel de admin
create index if not exists idx_system_action_logs_created_at
  on public.system_action_logs(created_at desc);

create index if not exists idx_system_action_logs_severity_created
  on public.system_action_logs(severity, created_at desc);

create index if not exists idx_system_action_logs_area_action
  on public.system_action_logs(area, action, created_at desc);

create index if not exists idx_system_action_logs_personal
  on public.system_action_logs(personal_id, created_at desc);

-- RLS: somente service_role (mesmo padrão de bot_anomaly_logs)
alter table if exists public.system_action_logs enable row level security;
alter table if exists public.system_action_logs force row level security;
revoke all on table public.system_action_logs from anon;
revoke all on table public.system_action_logs from authenticated;
grant all on table public.system_action_logs to service_role;
