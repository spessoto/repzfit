-- ============================================================
-- Migration: Adicionar campo summary na tabela daily_sessions
-- Armazena o extrato completo do treino ao final da sessão
-- ============================================================

ALTER TABLE public.daily_sessions
ADD COLUMN IF NOT EXISTS summary text;
