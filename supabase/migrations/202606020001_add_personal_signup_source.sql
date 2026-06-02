-- ============================================================
-- Migration: Origem de cadastro do personal (landing/embed)
-- ============================================================

ALTER TABLE public.personals
ADD COLUMN IF NOT EXISTS signup_source text;

CREATE INDEX IF NOT EXISTS idx_personals_signup_source
ON public.personals (signup_source);
