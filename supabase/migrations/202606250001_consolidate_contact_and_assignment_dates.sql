-- ============================================================
-- Migration: consolidar contatos do personal e centralizar datas de atribuicao
-- ============================================================

-- 1) Backfill do contato do personal para usar uma unica coluna canônica.
ALTER TABLE public.personals
ADD COLUMN IF NOT EXISTS phone text;

UPDATE public.personals
SET phone = NULLIF(trim(COALESCE(NULLIF(phone, ''), NULLIF(whatsapp_number, ''), '')), '')
WHERE phone IS NULL
  AND COALESCE(NULLIF(whatsapp_number, ''), '') <> '';

CREATE INDEX IF NOT EXISTS idx_personals_phone
  ON public.personals (phone);

-- 2) Centralizar datas de atribuicao em student_workouts (fonte canônica).
UPDATE public.student_workouts sw
SET start_date = COALESCE(sw.start_date, w.start_date, CURRENT_DATE)
FROM public.workouts w
WHERE sw.workout_id = w.id
  AND sw.start_date IS NULL
  AND w.start_date IS NOT NULL;

UPDATE public.student_workouts sw
SET valid_until = COALESCE(sw.valid_until, w.valid_until)
FROM public.workouts w
WHERE sw.workout_id = w.id
  AND sw.valid_until IS NULL
  AND w.valid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_workouts_dates
  ON public.student_workouts (student_id, start_date, valid_until);

-- 3) Melhorias de leitura para sessões e logs de treino.
CREATE INDEX IF NOT EXISTS idx_daily_sessions_student_date_status
  ON public.daily_sessions (student_id, date, status);

CREATE INDEX IF NOT EXISTS idx_set_logs_session_set
  ON public.set_logs (session_id, set_number);

-- 4) Remover a coluna duplicada de contatos do personal.
ALTER TABLE public.personals
DROP COLUMN IF EXISTS whatsapp_number;
