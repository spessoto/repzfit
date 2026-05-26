-- Add start_date and valid_until to workouts table
alter table public.workouts
  add column if not exists start_date date not null default current_date,
  add column if not exists valid_until date;

-- Add comment for clarity
comment on column public.workouts.start_date is 'Data de início do treino';
comment on column public.workouts.valid_until is 'Data de validade do treino (opcional)';

-- Add muscle_group to exercises for better organization
alter table public.exercises
  add column if not exists muscle_group text;

comment on column public.exercises.muscle_group is 'Grupo muscular do exercício (Peito, Costas, Pernas, etc)';
