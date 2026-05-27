-- ============================================================
-- Migration: Treinos modelo (sem aluno obrigatório)
-- ============================================================

-- 1) Permite vincular o treino diretamente ao personal
ALTER TABLE public.workouts
ADD COLUMN IF NOT EXISTS personal_id uuid REFERENCES public.personals(id) ON DELETE CASCADE;

-- 2) Preenche personal_id com base no aluno já vinculado
UPDATE public.workouts w
SET personal_id = s.personal_id
FROM public.students s
WHERE w.student_id = s.id
  AND w.personal_id IS NULL;

-- 3) Após migração dos dados, torna personal_id obrigatório
ALTER TABLE public.workouts
ALTER COLUMN personal_id SET NOT NULL;

-- 4) Agora treino pode existir sem aluno atribuído
ALTER TABLE public.workouts
ALTER COLUMN student_id DROP NOT NULL;

-- 5) Atualiza política de RLS para ownership por personal
DROP POLICY IF EXISTS "Personals gerem treinos dos seus alunos" ON public.workouts;
CREATE POLICY "Personals gerem seus treinos"
  ON public.workouts FOR ALL
  USING (personal_id = auth.uid())
  WITH CHECK (personal_id = auth.uid());

-- 6) Atualiza RLS de itens de treino baseado no treino do personal
DROP POLICY IF EXISTS "Personals gerem itens das fichas de treino" ON public.workout_exercises;
CREATE POLICY "Personals gerem itens dos seus treinos"
  ON public.workout_exercises FOR ALL
  USING (
    workout_id IN (
      SELECT id
      FROM public.workouts
      WHERE personal_id = auth.uid()
    )
  )
  WITH CHECK (
    workout_id IN (
      SELECT id
      FROM public.workouts
      WHERE personal_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_workouts_personal_id ON public.workouts(personal_id);
CREATE INDEX IF NOT EXISTS idx_workouts_student_id ON public.workouts(student_id);
