-- ============================================================
-- Migration: Campos complementares do personal (perfil)
-- ============================================================

ALTER TABLE public.personals
ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.personals
ADD COLUMN IF NOT EXISTS crf_registration text;
