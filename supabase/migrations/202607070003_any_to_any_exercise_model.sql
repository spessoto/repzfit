-- Reestrutura o modelo de exercícios para any-to-any:
-- exercise_catalog, exercise_variations e equipment_catalog são catálogos independentes.
-- Qualquer exercício pode ser combinado com qualquer variação e qualquer equipamento.
-- Remove a FK exercise_catalog_id de exercise_variations.
-- Remove a coluna method de exercise_variations.
-- Remove a tabela exercise_variation_equipments.
-- Adiciona exercise_catalog_id e equipment_id em workout_exercises.
-- Cria exercise_combo_cache para cache de descrições IA por combinação (exercício, variação).

-- 1. Novos campos em workout_exercises
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS exercise_catalog_id uuid REFERENCES public.exercise_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment_catalog(id) ON DELETE SET NULL;

-- 2. Backfill exercise_catalog_id em workout_exercises a partir da variação antiga
UPDATE public.workout_exercises we
SET exercise_catalog_id = ev.exercise_catalog_id
FROM public.exercise_variations ev
WHERE we.exercise_variation_id = ev.id
  AND we.exercise_catalog_id IS NULL
  AND ev.exercise_catalog_id IS NOT NULL;

-- 3. Deduplicar exercise_variations compartilhadas por nome (manter a mais antiga por nome)

-- 3a. Criar mapeamento temporário de duplicatas → sobrevivente
CREATE TEMP TABLE _var_dedup AS
SELECT
  ev.id AS dup_id,
  (
    SELECT ev2.id
    FROM public.exercise_variations ev2
    WHERE ev2.personal_id IS NULL
      AND lower(trim(ev2.name)) = lower(trim(ev.name))
    ORDER BY ev2.created_at ASC, ev2.id ASC
    LIMIT 1
  ) AS survivor_id
FROM public.exercise_variations ev
WHERE ev.personal_id IS NULL
  AND ev.id <> (
    SELECT ev2.id
    FROM public.exercise_variations ev2
    WHERE ev2.personal_id IS NULL
      AND lower(trim(ev2.name)) = lower(trim(ev.name))
    ORDER BY ev2.created_at ASC, ev2.id ASC
    LIMIT 1
  );

-- 3b. Redirecionar workout_exercises para o sobrevivente
UPDATE public.workout_exercises we
SET exercise_variation_id = d.survivor_id
FROM _var_dedup d
WHERE we.exercise_variation_id = d.dup_id;

-- 3c. Remover duplicatas
DELETE FROM public.exercise_variations
WHERE id IN (SELECT dup_id FROM _var_dedup);

DROP TABLE _var_dedup;

-- 4. Criar tabela de cache de descrições IA por combinação (exercício, variação)
CREATE TABLE IF NOT EXISTS public.exercise_combo_cache (
  exercise_catalog_id uuid NOT NULL REFERENCES public.exercise_catalog(id) ON DELETE CASCADE,
  exercise_variation_id uuid NOT NULL REFERENCES public.exercise_variations(id) ON DELETE CASCADE,
  description text,
  muscle_group_id uuid REFERENCES public.muscle_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (exercise_catalog_id, exercise_variation_id)
);

-- 5. Backfill do cache a partir de descrições já existentes nas variações
INSERT INTO public.exercise_combo_cache (exercise_catalog_id, exercise_variation_id, description, muscle_group_id)
SELECT
  ev.exercise_catalog_id,
  ev.id,
  ev.ai_default_description,
  ev.ai_default_muscle_group_id
FROM public.exercise_variations ev
WHERE ev.exercise_catalog_id IS NOT NULL
  AND ev.ai_default_description IS NOT NULL
ON CONFLICT (exercise_catalog_id, exercise_variation_id) DO NOTHING;

-- 6. Remover exercise_catalog_id e method de exercise_variations
ALTER TABLE public.exercise_variations
  DROP COLUMN IF EXISTS exercise_catalog_id,
  DROP COLUMN IF EXISTS method;

-- 7. Remover tabela exercise_variation_equipments
DROP TABLE IF EXISTS public.exercise_variation_equipments;

-- 8. RLS para exercise_combo_cache
ALTER TABLE public.exercise_combo_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals read exercise combo cache" ON public.exercise_combo_cache;
CREATE POLICY "Personals read exercise combo cache"
  ON public.exercise_combo_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals insert exercise combo cache" ON public.exercise_combo_cache;
CREATE POLICY "Personals insert exercise combo cache"
  ON public.exercise_combo_cache FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals update exercise combo cache" ON public.exercise_combo_cache;
CREATE POLICY "Personals update exercise combo cache"
  ON public.exercise_combo_cache FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 9. Índices
CREATE INDEX IF NOT EXISTS idx_workout_exercises_catalog_id
  ON public.workout_exercises(exercise_catalog_id);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_equipment_id
  ON public.workout_exercises(equipment_id);

CREATE INDEX IF NOT EXISTS idx_exercise_combo_cache_variation
  ON public.exercise_combo_cache(exercise_variation_id);

-- 10. Índices únicos parciais para suporte a upsert por nome (shared exercises)
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_catalog_shared_name
  ON public.exercise_catalog(lower(name)) WHERE personal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_variations_shared_name
  ON public.exercise_variations(lower(name)) WHERE personal_id IS NULL;
