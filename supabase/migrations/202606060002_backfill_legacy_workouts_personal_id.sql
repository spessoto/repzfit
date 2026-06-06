-- ============================================================
-- Migration: Backfill de personal_id em treinos legados
-- ============================================================

-- 1) Treinos antigos que ainda tinham student_id direto
UPDATE public.workouts w
SET personal_id = s.personal_id
FROM public.students s
WHERE w.personal_id IS NULL
  AND w.student_id = s.id
  AND s.personal_id IS NOT NULL;

-- 2) Treinos modelo/compartilhados vinculados por student_workouts
WITH owner_candidates AS (
  SELECT
    sw.workout_id,
    MIN(s.personal_id::text)::uuid AS personal_id
  FROM public.student_workouts sw
  JOIN public.students s ON s.id = sw.student_id
  WHERE s.personal_id IS NOT NULL
  GROUP BY sw.workout_id
)
UPDATE public.workouts w
SET personal_id = oc.personal_id
FROM owner_candidates oc
WHERE w.id = oc.workout_id
  AND w.personal_id IS NULL;
