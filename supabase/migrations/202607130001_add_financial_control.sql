-- ============================================================
-- Migration: Controle financeiro por aluno
-- Campos de mensalidade e dia de pagamento + registros mensais de recebimento
-- ============================================================

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS monthly_fee numeric(10,2);

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS payment_day integer
  CHECK (payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31));

CREATE TABLE IF NOT EXISTS public.student_payment_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  received boolean NOT NULL DEFAULT false,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT student_payment_records_reference_month_start
    CHECK (date_trunc('month', reference_month)::date = reference_month),
  CONSTRAINT student_payment_records_unique
    UNIQUE (student_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_student_payment_records_student_month
  ON public.student_payment_records(student_id, reference_month);

ALTER TABLE public.student_payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personals gerem pagamentos mensais dos seus alunos" ON public.student_payment_records;
CREATE POLICY "Personals gerem pagamentos mensais dos seus alunos"
  ON public.student_payment_records FOR ALL
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
