-- Rest Timer: colunas necessarias
alter table public.workout_exercises add column if not exists rest_seconds integer default null;
alter table public.bot_state add column if not exists rest_end_at timestamptz default null;
create extension if not exists pg_net with schema extensions;