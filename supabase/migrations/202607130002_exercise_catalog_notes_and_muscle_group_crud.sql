-- ============================================================
-- Migration: Adiciona coluna notes em exercise_catalog e abre
-- permissão de CRUD para muscle_groups ao personal autenticado.
-- ============================================================

ALTER TABLE public.exercise_catalog
ADD COLUMN IF NOT EXISTS notes text;

-- Permite que personais autenticados criem, editem e removam grupos musculares.
DROP POLICY IF EXISTS "Personals insert muscle groups" ON public.muscle_groups;
CREATE POLICY "Personals insert muscle groups"
  ON public.muscle_groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals delete own muscle groups" ON public.muscle_groups;
CREATE POLICY "Personals delete own muscle groups"
  ON public.muscle_groups FOR DELETE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Personals update muscle groups" ON public.muscle_groups;
CREATE POLICY "Personals update muscle groups"
  ON public.muscle_groups FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
