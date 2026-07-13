-- Expande o cache de combinações de exercícios para carregar as opções
-- exatas da planilha original e permitir o filtro em cascata no editor de treino.

ALTER TABLE public.exercise_combo_cache
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grip_footing_id uuid REFERENCES public.grip_footing_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS method_id uuid REFERENCES public.method_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_combo_cache_equipment
  ON public.exercise_combo_cache(equipment_id);

CREATE INDEX IF NOT EXISTS idx_exercise_combo_cache_grip_footing
  ON public.exercise_combo_cache(grip_footing_id);

CREATE INDEX IF NOT EXISTS idx_exercise_combo_cache_method
  ON public.exercise_combo_cache(method_id);