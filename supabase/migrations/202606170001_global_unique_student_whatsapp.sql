-- ============================================================
-- Migration: WhatsApp de aluno com unicidade global
-- Objetivo: evitar ambiguidade de roteamento no bot unificado
-- ============================================================

-- Remove a regra antiga de unicidade por personal.
ALTER TABLE public.students
DROP CONSTRAINT IF EXISTS unique_whatsapp_per_personal;

-- Garante que cada WhatsApp pertença a no maximo um aluno na plataforma.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_whatsapp_unique_global
  ON public.students (whatsapp_number);
