-- Allow workout items to be created from normalized exercise variations even when
-- there is no legacy exercises.id counterpart to reference.
ALTER TABLE public.workout_exercises
  ALTER COLUMN exercise_id DROP NOT NULL;