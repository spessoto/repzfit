-- Allow exercises to be optionally tagged with a muscle group directly, so the
-- muscle group can act as a simple filter over the full exercise catalog
-- instead of being derived only from pre-seeded combo rows.
ALTER TABLE public.exercise_catalog
  ADD COLUMN IF NOT EXISTS muscle_group_id uuid REFERENCES public.muscle_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_muscle_group
  ON public.exercise_catalog(muscle_group_id);

-- Backfill muscle group for exercises that already have a known combo association
-- (from the original spreadsheet seed), picking the earliest linked group per exercise.
UPDATE public.exercise_catalog ec
SET muscle_group_id = sub.muscle_group_id
FROM (
  SELECT DISTINCT ON (exercise_catalog_id) exercise_catalog_id, muscle_group_id
  FROM public.exercise_combo_options
  WHERE muscle_group_id IS NOT NULL
  ORDER BY exercise_catalog_id, created_at ASC
) sub
WHERE ec.id = sub.exercise_catalog_id
  AND ec.muscle_group_id IS NULL;
