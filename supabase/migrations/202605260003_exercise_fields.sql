-- ============================================================
-- Migration: Ajustar estrutura da tabela exercises
-- Adicionar campos: equipment, tags
-- Renomear description para execution_description
-- ============================================================

-- 1. Adicionar campo equipment (equipamentos)
ALTER TABLE public.exercises 
ADD COLUMN IF NOT EXISTS equipment text;

-- 2. Adicionar campo tags
ALTER TABLE public.exercises 
ADD COLUMN IF NOT EXISTS tags text[];

-- 3. Verificar estrutura
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'exercises'
ORDER BY ordinal_position;
