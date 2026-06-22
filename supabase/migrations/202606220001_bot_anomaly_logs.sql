-- Logs de anomalias do bot para auditoria e melhoria contínua.

create table if not exists public.bot_anomaly_logs (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'error')),
  category text not null,
  code text not null,
  message text not null,
  whatsapp_number text,
  student_id uuid references public.students(id) on delete set null,
  session_id uuid references public.daily_sessions(id) on delete set null,
  current_state text,
  input_excerpt text,
  context jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by text,
  resolution_notes text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_bot_anomaly_logs_created_at
  on public.bot_anomaly_logs(created_at desc);

create index if not exists idx_bot_anomaly_logs_unresolved_created
  on public.bot_anomaly_logs(resolved, created_at desc);

create index if not exists idx_bot_anomaly_logs_code_created
  on public.bot_anomaly_logs(code, created_at desc);

create index if not exists idx_bot_anomaly_logs_student
  on public.bot_anomaly_logs(student_id);

create index if not exists idx_bot_anomaly_logs_session
  on public.bot_anomaly_logs(session_id);

alter table if exists public.bot_anomaly_logs enable row level security;
alter table if exists public.bot_anomaly_logs force row level security;

revoke all on table public.bot_anomaly_logs from anon;
revoke all on table public.bot_anomaly_logs from authenticated;
grant all on table public.bot_anomaly_logs to service_role;
