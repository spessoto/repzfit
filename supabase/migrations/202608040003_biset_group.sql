-- Migration: adicionar suporte a Bi-set em workout_exercises
-- Bi-set: dois (ou mais) exercícios executados em sequência sem descanso.
-- Exercícios com o mesmo biset_group_id pertencem ao mesmo bi-set.
-- NULL = exercício independente (sem bi-set).

alter table public.workout_exercises
  add column if not exists biset_group_id uuid default null;

-- Índice para queries "me dê todos os exercícios deste bi-set"
create index if not exists idx_workout_exercises_biset_group
  on public.workout_exercises (biset_group_id)
  where biset_group_id is not null;

comment on column public.workout_exercises.biset_group_id is
  'UUID compartilhado entre exercícios do mesmo bi-set. NULL = exercício independente.';
