-- Normalize exercise data model for 3-step composition:
-- exercise_catalog -> exercise_variations -> equipment_catalog
-- Also adds per-workout exercise custom description and GIF support.

-- 1) New catalog tables
CREATE TABLE IF NOT EXISTS public.muscle_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.exercise_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id uuid REFERENCES public.personals(id) ON DELETE CASCADE,
  name text NOT NULL,
  legacy_exercise_id uuid UNIQUE REFERENCES public.exercises(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_personal_name
  ON public.exercise_catalog(personal_id, name);

CREATE TABLE IF NOT EXISTS public.exercise_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id uuid REFERENCES public.personals(id) ON DELETE CASCADE,
  exercise_catalog_id uuid NOT NULL REFERENCES public.exercise_catalog(id) ON DELETE CASCADE,
  name text NOT NULL,
  short_description text,
  ai_default_description text,
  ai_default_muscle_group_id uuid REFERENCES public.muscle_groups(id) ON DELETE SET NULL,
  gif_storage_path text,
  gif_url text,
  legacy_exercise_id uuid UNIQUE REFERENCES public.exercises(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_exercise_variations_catalog
  ON public.exercise_variations(exercise_catalog_id);

CREATE INDEX IF NOT EXISTS idx_exercise_variations_personal_name
  ON public.exercise_variations(personal_id, name);

CREATE TABLE IF NOT EXISTS public.equipment_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.exercise_variation_equipments (
  exercise_variation_id uuid NOT NULL REFERENCES public.exercise_variations(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment_catalog(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (exercise_variation_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_variation_equipments_equipment_id
  ON public.exercise_variation_equipments(equipment_id);

-- 2) Extend current tables for compatibility and overrides
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS gif_url text,
  ADD COLUMN IF NOT EXISTS gif_storage_path text;

ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS exercise_variation_id uuid REFERENCES public.exercise_variations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_description text;

CREATE INDEX IF NOT EXISTS idx_workout_exercises_variation_id
  ON public.workout_exercises(exercise_variation_id);

-- 3) Backfill muscle groups
INSERT INTO public.muscle_groups(name)
SELECT DISTINCT btrim(e.muscle_group)
FROM public.exercises e
WHERE e.muscle_group IS NOT NULL
  AND btrim(e.muscle_group) <> ''
ON CONFLICT (name) DO NOTHING;

-- 4) Backfill normalized exercise catalog and variations
INSERT INTO public.exercise_catalog(personal_id, name, legacy_exercise_id)
SELECT e.personal_id, e.name, e.id
FROM public.exercises e
ON CONFLICT (legacy_exercise_id) DO NOTHING;

INSERT INTO public.exercise_variations(
  personal_id,
  exercise_catalog_id,
  name,
  short_description,
  ai_default_description,
  ai_default_muscle_group_id,
  legacy_exercise_id
)
SELECT
  c.personal_id,
  c.id,
  e.name,
  e.description,
  e.description,
  mg.id,
  e.id
FROM public.exercises e
JOIN public.exercise_catalog c
  ON c.legacy_exercise_id = e.id
LEFT JOIN LATERAL (
  SELECT id
  FROM public.muscle_groups
  WHERE lower(name) = lower(e.muscle_group)
  ORDER BY created_at ASC, id ASC
  LIMIT 1
) mg ON true
ON CONFLICT (legacy_exercise_id) DO UPDATE
SET
  ai_default_description = EXCLUDED.ai_default_description,
  short_description = EXCLUDED.short_description,
  ai_default_muscle_group_id = EXCLUDED.ai_default_muscle_group_id;

-- 5) Backfill equipment and relationship using comma-separated source values
INSERT INTO public.equipment_catalog(name)
SELECT DISTINCT btrim(parts.part)
FROM public.exercises e
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(e.equipment, ''), ',') AS parts(part)
WHERE btrim(parts.part) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.exercise_variation_equipments(exercise_variation_id, equipment_id)
SELECT DISTINCT
  v.id,
  ec.id
FROM public.exercises e
JOIN public.exercise_variations v
  ON v.legacy_exercise_id = e.id
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(e.equipment, ''), ',') AS parts(part)
JOIN public.equipment_catalog ec
  ON lower(ec.name) = lower(btrim(parts.part))
WHERE btrim(parts.part) <> ''
ON CONFLICT (exercise_variation_id, equipment_id) DO NOTHING;

-- 6) Backfill workout item variation references to preserve history
UPDATE public.workout_exercises we
SET exercise_variation_id = v.id
FROM public.exercise_variations v
WHERE we.exercise_id = v.legacy_exercise_id
  AND we.exercise_variation_id IS NULL;

-- 7) RLS for new tables
ALTER TABLE public.muscle_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_variation_equipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals read muscle groups" ON public.muscle_groups;
CREATE POLICY "Personals read muscle groups"
  ON public.muscle_groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals read equipment catalog" ON public.equipment_catalog;
CREATE POLICY "Personals read equipment catalog"
  ON public.equipment_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals read exercise catalog base and own" ON public.exercise_catalog;
CREATE POLICY "Personals read exercise catalog base and own"
  ON public.exercise_catalog FOR SELECT
  USING (personal_id = auth.uid() OR personal_id IS NULL);

DROP POLICY IF EXISTS "Personals insert own exercise catalog" ON public.exercise_catalog;
CREATE POLICY "Personals insert own exercise catalog"
  ON public.exercise_catalog FOR INSERT
  WITH CHECK (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals update own exercise catalog" ON public.exercise_catalog;
CREATE POLICY "Personals update own exercise catalog"
  ON public.exercise_catalog FOR UPDATE
  USING (personal_id = auth.uid())
  WITH CHECK (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals delete own exercise catalog" ON public.exercise_catalog;
CREATE POLICY "Personals delete own exercise catalog"
  ON public.exercise_catalog FOR DELETE
  USING (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals read exercise variations base and own" ON public.exercise_variations;
CREATE POLICY "Personals read exercise variations base and own"
  ON public.exercise_variations FOR SELECT
  USING (personal_id = auth.uid() OR personal_id IS NULL);

DROP POLICY IF EXISTS "Personals insert own exercise variations" ON public.exercise_variations;
CREATE POLICY "Personals insert own exercise variations"
  ON public.exercise_variations FOR INSERT
  WITH CHECK (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals update own exercise variations" ON public.exercise_variations;
CREATE POLICY "Personals update own exercise variations"
  ON public.exercise_variations FOR UPDATE
  USING (personal_id = auth.uid())
  WITH CHECK (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals delete own exercise variations" ON public.exercise_variations;
CREATE POLICY "Personals delete own exercise variations"
  ON public.exercise_variations FOR DELETE
  USING (personal_id = auth.uid());

DROP POLICY IF EXISTS "Personals read variation equipments" ON public.exercise_variation_equipments;
CREATE POLICY "Personals read variation equipments"
  ON public.exercise_variation_equipments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.exercise_variations v
      WHERE v.id = exercise_variation_id
        AND (v.personal_id = auth.uid() OR v.personal_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Personals insert variation equipments" ON public.exercise_variation_equipments;
CREATE POLICY "Personals insert variation equipments"
  ON public.exercise_variation_equipments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.exercise_variations v
      WHERE v.id = exercise_variation_id
        AND v.personal_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Personals delete variation equipments" ON public.exercise_variation_equipments;
CREATE POLICY "Personals delete variation equipments"
  ON public.exercise_variation_equipments FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.exercise_variations v
      WHERE v.id = exercise_variation_id
        AND v.personal_id = auth.uid()
    )
  );
