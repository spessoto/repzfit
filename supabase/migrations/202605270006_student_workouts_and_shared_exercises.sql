-- ============================================================
-- Migration: Atribuicao N:N de treinos e exercicios compartilhados
-- ============================================================

-- 1) Relacao treino <-> aluno com validade por atribuicao
CREATE TABLE IF NOT EXISTS public.student_workouts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workout_id uuid REFERENCES public.workouts(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  start_date date DEFAULT current_date NOT NULL,
  valid_until date,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_workout_student UNIQUE (workout_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_workouts_student_id
  ON public.student_workouts(student_id);
CREATE INDEX IF NOT EXISTS idx_student_workouts_workout_id
  ON public.student_workouts(workout_id);

-- Backfill do modelo antigo (1 treino -> 1 aluno)
INSERT INTO public.student_workouts (workout_id, student_id, start_date, valid_until)
SELECT w.id, w.student_id, COALESCE(w.start_date, current_date), w.valid_until
FROM public.workouts w
WHERE w.student_id IS NOT NULL
ON CONFLICT (workout_id, student_id) DO NOTHING;

ALTER TABLE public.student_workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals gerem atribuicoes de treinos" ON public.student_workouts;
CREATE POLICY "Personals gerem atribuicoes de treinos"
  ON public.student_workouts FOR ALL
  USING (
    workout_id IN (
      SELECT id
      FROM public.workouts
      WHERE personal_id = auth.uid()
    )
    AND student_id IN (
      SELECT id
      FROM public.students
      WHERE personal_id = auth.uid()
    )
  )
  WITH CHECK (
    workout_id IN (
      SELECT id
      FROM public.workouts
      WHERE personal_id = auth.uid()
    )
    AND student_id IN (
      SELECT id
      FROM public.students
      WHERE personal_id = auth.uid()
    )
  );

-- 2) Exercicios compartilhados (base) + exercicios privados do personal
ALTER TABLE public.exercises
ALTER COLUMN personal_id DROP NOT NULL;

DROP POLICY IF EXISTS "Personals gerem os seus proprios exercicios" ON public.exercises;
DROP POLICY IF EXISTS "Personals leem exercicios base e proprios" ON public.exercises;
DROP POLICY IF EXISTS "Personals inserem exercicios proprios" ON public.exercises;
DROP POLICY IF EXISTS "Personals atualizam exercicios proprios" ON public.exercises;
DROP POLICY IF EXISTS "Personals removem exercicios proprios" ON public.exercises;

CREATE POLICY "Personals leem exercicios base e proprios"
  ON public.exercises FOR SELECT
  USING (personal_id = auth.uid() OR personal_id IS NULL);

CREATE POLICY "Personals inserem exercicios proprios"
  ON public.exercises FOR INSERT
  WITH CHECK (personal_id = auth.uid());

CREATE POLICY "Personals atualizam exercicios proprios"
  ON public.exercises FOR UPDATE
  USING (personal_id = auth.uid())
  WITH CHECK (personal_id = auth.uid());

CREATE POLICY "Personals removem exercicios proprios"
  ON public.exercises FOR DELETE
  USING (personal_id = auth.uid());
