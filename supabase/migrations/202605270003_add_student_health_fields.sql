-- ============================================================
-- Migration: Adicionar dados complementares do aluno
-- Campos para ficha de aluno no painel de edição
-- ============================================================

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS blood_type text;

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS weight_kg numeric(6,2);

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS height_cm numeric(5,2);
