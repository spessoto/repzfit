-- ============================================================
-- Migration: Adiciona número WhatsApp do personal para envio de relatórios
-- ============================================================

ALTER TABLE public.personals
ADD COLUMN IF NOT EXISTS whatsapp_number text;

COMMENT ON COLUMN public.personals.whatsapp_number IS
  'Número WhatsApp do personal (formato internacional sem +, ex: 5511999999999) usado para receber relatórios de treino dos alunos.';
