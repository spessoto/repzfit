-- ============================================================
-- Migration: Adicionar campos de data e grupo muscular
-- Executar no Supabase SQL Editor
-- https://supabase.com/dashboard/project/ofergzualxqqovktyxwu/sql/new
-- ============================================================

-- 1. Adicionar start_date (data de início) na tabela workouts
ALTER TABLE public.workouts 
ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date;

-- 2. Adicionar valid_until (data de validade) na tabela workouts  
ALTER TABLE public.workouts 
ADD COLUMN IF NOT EXISTS valid_until date;

-- 3. Adicionar muscle_group (grupo muscular) na tabela exercises
ALTER TABLE public.exercises 
ADD COLUMN IF NOT EXISTS muscle_group text;

-- ============================================================
-- Verificação (opcional - execute para confirmar)
-- ============================================================

-- Ver colunas da tabela workouts
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'workouts'
ORDER BY ordinal_position;

-- Ver colunas da tabela exercises  
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'exercises'
ORDER BY ordinal_position;
