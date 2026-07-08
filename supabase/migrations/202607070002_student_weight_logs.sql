-- Histórico de peso por aluno para relatórios temporais.

CREATE TABLE IF NOT EXISTS public.student_weight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  weight_kg numeric(6,2) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT student_weight_logs_positive_weight CHECK (weight_kg > 0 AND weight_kg <= 500),
  CONSTRAINT student_weight_logs_source_check CHECK (source IN ('manual', 'import', 'bot')),
  CONSTRAINT student_weight_logs_unique_student_date UNIQUE (student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_student_weight_logs_student_date
  ON public.student_weight_logs(student_id, date DESC);

ALTER TABLE public.student_weight_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals gerem historico de peso dos seus alunos" ON public.student_weight_logs;
CREATE POLICY "Personals gerem historico de peso dos seus alunos"
  ON public.student_weight_logs FOR ALL
  USING (
    student_id IN (
      SELECT id
      FROM public.students
      WHERE personal_id = auth.uid()
    )
  )
  WITH CHECK (
    student_id IN (
      SELECT id
      FROM public.students
      WHERE personal_id = auth.uid()
    )
  );

INSERT INTO public.student_weight_logs (student_id, date, weight_kg, source)
SELECT s.id, current_date, s.weight_kg, 'import'
FROM public.students s
WHERE s.weight_kg IS NOT NULL
ON CONFLICT (student_id, date) DO NOTHING;
