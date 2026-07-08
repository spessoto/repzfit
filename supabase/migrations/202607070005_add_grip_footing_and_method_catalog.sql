-- Add Grip/Footing and Method catalogs, and link them to workout exercises.

CREATE TABLE IF NOT EXISTS public.grip_footing_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.method_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS grip_footing_id uuid REFERENCES public.grip_footing_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS method_id uuid REFERENCES public.method_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_exercises_grip_footing_id
  ON public.workout_exercises(grip_footing_id);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_method_id
  ON public.workout_exercises(method_id);

ALTER TABLE public.grip_footing_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.method_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals read grip footing catalog" ON public.grip_footing_catalog;
CREATE POLICY "Personals read grip footing catalog"
  ON public.grip_footing_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals insert grip footing catalog" ON public.grip_footing_catalog;
CREATE POLICY "Personals insert grip footing catalog"
  ON public.grip_footing_catalog FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals update grip footing catalog" ON public.grip_footing_catalog;
CREATE POLICY "Personals update grip footing catalog"
  ON public.grip_footing_catalog FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals delete grip footing catalog" ON public.grip_footing_catalog;
CREATE POLICY "Personals delete grip footing catalog"
  ON public.grip_footing_catalog FOR DELETE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals read method catalog" ON public.method_catalog;
CREATE POLICY "Personals read method catalog"
  ON public.method_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals insert method catalog" ON public.method_catalog;
CREATE POLICY "Personals insert method catalog"
  ON public.method_catalog FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals update method catalog" ON public.method_catalog;
CREATE POLICY "Personals update method catalog"
  ON public.method_catalog FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals delete method catalog" ON public.method_catalog;
CREATE POLICY "Personals delete method catalog"
  ON public.method_catalog FOR DELETE
  USING (auth.uid() IS NOT NULL);
