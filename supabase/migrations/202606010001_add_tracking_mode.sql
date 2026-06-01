-- ============================================================
-- Migration: Adiciona tracking_mode em student_workouts
-- Permite que o personal configure o modo de acompanhamento
-- por atribuição de treino ao aluno.
-- ============================================================

ALTER TABLE public.student_workouts
  ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'per_rep'
  CONSTRAINT student_workouts_tracking_mode_check
  CHECK (tracking_mode IN ('per_rep', 'per_exercise', 'per_workout', 'none'));

COMMENT ON COLUMN public.student_workouts.tracking_mode IS
  'Modo de acompanhamento configurado pelo personal: per_rep = a cada série, per_exercise = a cada exercício, per_workout = a cada treino (RPE geral), none = sem acompanhamento.';
