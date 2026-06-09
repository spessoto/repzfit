-- Permite registrar série mesmo quando o modo de acompanhamento não coleta PSE por série.
-- Mantém validação de 1..10 quando o valor for informado.

ALTER TABLE public.set_logs
  ALTER COLUMN rpe_score DROP NOT NULL;

ALTER TABLE public.set_logs
  DROP CONSTRAINT IF EXISTS set_logs_rpe_score_check;

ALTER TABLE public.set_logs
  ADD CONSTRAINT set_logs_rpe_score_check
  CHECK (rpe_score IS NULL OR (rpe_score >= 1 AND rpe_score <= 10));
