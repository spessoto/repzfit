create extension if not exists "uuid-ossp";

create table if not exists public.personals (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  email text unique not null,
  evolution_instance_name text unique not null,
  evolution_api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.personals enable row level security;

drop policy if exists "Personals podem ler e atualizar apenas os seus próprios dados" on public.personals;
create policy "Personals podem ler e atualizar apenas os seus próprios dados"
  on public.personals for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.students (
  id uuid default uuid_generate_v4() primary key,
  personal_id uuid references public.personals(id) on delete cascade not null,
  name text not null,
  whatsapp_number text not null,
  is_active boolean default true,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  constraint unique_whatsapp_per_personal unique (personal_id, whatsapp_number)
);

alter table public.students enable row level security;

drop policy if exists "Personals gerem apenas os seus próprios alunos" on public.students;
create policy "Personals gerem apenas os seus próprios alunos"
  on public.students for all
  using (personal_id = auth.uid())
  with check (personal_id = auth.uid());

create table if not exists public.exercises (
  id uuid default uuid_generate_v4() primary key,
  personal_id uuid references public.personals(id) on delete cascade not null,
  name text not null,
  description text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.exercises enable row level security;

drop policy if exists "Personals gerem os seus próprios exercícios" on public.exercises;
create policy "Personals gerem os seus próprios exercícios"
  on public.exercises for all
  using (personal_id = auth.uid())
  with check (personal_id = auth.uid());

create table if not exists public.workouts (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references public.students(id) on delete cascade not null,
  name text not null,
  day_of_week integer[],
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.workouts enable row level security;

drop policy if exists "Personals gerem treinos dos seus alunos" on public.workouts;
create policy "Personals gerem treinos dos seus alunos"
  on public.workouts for all
  using (student_id in (select id from public.students where personal_id = auth.uid()))
  with check (student_id in (select id from public.students where personal_id = auth.uid()));

create table if not exists public.workout_exercises (
  id uuid default uuid_generate_v4() primary key,
  workout_id uuid references public.workouts(id) on delete cascade not null,
  exercise_id uuid references public.exercises(id) on delete cascade not null,
  target_sets integer not null,
  target_reps integer not null,
  target_weight numeric(5,2),
  order_index integer not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.workout_exercises enable row level security;

drop policy if exists "Personals gerem itens das fichas de treino" on public.workout_exercises;
create policy "Personals gerem itens das fichas de treino"
  on public.workout_exercises for all
  using (
    workout_id in (
      select id
      from public.workouts
      where student_id in (
        select id from public.students where personal_id = auth.uid()
      )
    )
  )
  with check (
    workout_id in (
      select id
      from public.workouts
      where student_id in (
        select id from public.students where personal_id = auth.uid()
      )
    )
  );

create table if not exists public.daily_sessions (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references public.students(id) on delete cascade not null,
  workout_id uuid references public.workouts(id) on delete cascade not null,
  status text default 'started'::text check (status in ('started', 'completed', 'abandoned')) not null,
  date date default current_date not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.daily_sessions enable row level security;

drop policy if exists "Personals acedem às sessões dos seus alunos" on public.daily_sessions;
create policy "Personals acedem às sessões dos seus alunos"
  on public.daily_sessions for all
  using (student_id in (select id from public.students where personal_id = auth.uid()))
  with check (student_id in (select id from public.students where personal_id = auth.uid()));

create table if not exists public.set_logs (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.daily_sessions(id) on delete cascade not null,
  workout_exercise_id uuid references public.workout_exercises(id) on delete cascade not null,
  set_number integer not null,
  reps_done integer not null,
  weight_used numeric(5,2) not null,
  rpe_score integer check (rpe_score >= 1 and rpe_score <= 10) not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.set_logs enable row level security;

drop policy if exists "Personals acedem aos logs de treino" on public.set_logs;
create policy "Personals acedem aos logs de treino"
  on public.set_logs for all
  using (
    session_id in (
      select id
      from public.daily_sessions
      where student_id in (
        select id from public.students where personal_id = auth.uid()
      )
    )
  )
  with check (
    session_id in (
      select id
      from public.daily_sessions
      where student_id in (
        select id from public.students where personal_id = auth.uid()
      )
    )
  );

create table if not exists public.bot_state (
  whatsapp_number text primary key,
  student_id uuid references public.students(id) on delete cascade not null,
  current_state text default 'IDLE'::text not null,
  current_session_id uuid references public.daily_sessions(id) on delete set null,
  current_workout_exercise_id uuid references public.workout_exercises(id) on delete set null,
  current_set_number integer default 1,
  last_input_attempt text,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists idx_students_whatsapp on public.students(whatsapp_number);
create index if not exists idx_bot_state_lookup on public.bot_state(whatsapp_number);
create index if not exists idx_daily_sessions_timeout on public.daily_sessions(status, updated_at) where status = 'started';
