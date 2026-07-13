BEGIN;

-- Remove referências atuais para permitir limpar os catálogos sem quebrar FKs.
UPDATE public.workout_exercises
SET
  exercise_catalog_id = NULL,
  exercise_variation_id = NULL,
  equipment_id = NULL,
  grip_footing_id = NULL,
  method_id = NULL;

-- Limpa cache de combinação.
DELETE FROM public.exercise_combo_cache;

-- Limpa base de exercícios exibida na UI (catálogos).
DELETE FROM public.exercise_variations;
DELETE FROM public.exercise_catalog;
DELETE FROM public.equipment_catalog;
DELETE FROM public.grip_footing_catalog;
DELETE FROM public.method_catalog;

COMMIT;
