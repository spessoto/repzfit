-- ============================================================
-- Bot hardening: persistent dedup + idempotency constraints
-- ============================================================

-- 1. Persistent webhook deduplication table
--    Protects against duplicate webhook delivery across Vercel instances
--    and cold-start resets (in-memory dedup alone is not enough).
create table if not exists public.processed_webhook_events (
  fingerprint text primary key,
  processed_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.processed_webhook_events enable row level security;
-- Service role bypasses RLS. No explicit policy = regular/anon users cannot access.

-- 2. Idempotency: prevent duplicate set_logs for the same set attempt
--    If a webhook is delivered twice while bot is in COLLECTING_RPE,
--    the second insert will hit this constraint instead of creating a ghost log.
create unique index if not exists uq_set_logs_session_exercise_set
  on public.set_logs (session_id, workout_exercise_id, set_number);

-- 3. Idempotency: only one active ("started") session per student at a time
--    Prevents race conditions where two concurrent webhook events both
--    try to create a new daily_session for the same student.
create unique index if not exists uq_daily_sessions_one_active_per_student
  on public.daily_sessions (student_id)
  where status = 'started';
