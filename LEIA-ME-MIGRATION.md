# 🚀 INSTRUÇÕES PARA EXECUTAR MIGRATION

## ⚠️ IMPORTANTE

Execute estes comandos SQL ANTES de testar a criação de treinos na plataforma.

## 📝 Passo a Passo

### 1. Acesse o Supabase SQL Editor

Abra: https://supabase.com/dashboard/project/ofergzualxqqovktyxwu/sql/new

### 2. Copie e cole o SQL abaixo:

```sql
-- ============================================================
-- Migration: Adicionar campos de data e grupo muscular
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
```

### 3. Clique em "RUN" no canto inferior direito

### 4. Verifique o resultado

Você deve ver a mensagem "Success. No rows returned" - isso está correto!

### 5. (Opcional) Confirme que as colunas foram criadas:

```sql
-- Ver estrutura da tabela workouts
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'workouts'
ORDER BY ordinal_position;

-- Ver estrutura da tabela exercises
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'exercises'
ORDER BY ordinal_position;
```

## ✅ Após executar a migration

A plataforma estará pronta para:

- ✅ Criar treinos com data de início e validade
- ✅ Adicionar múltiplos exercícios por treino
- ✅ Definir séries, repetições e peso para cada exercício
- ✅ Agrupar exercícios por grupo muscular (peito, costas, pernas, etc.)

## 🎯 Teste no Frontend

1. Acesse: http://localhost:3333
2. Vá para a aba "Treinos"
3. Preencha:
   - Aluno
   - Nome do treino
   - Data de início (obrigatório)
   - Data de validade (opcional)
4. Clique em "+ Adicionar Exercício"
5. Para cada exercício, preencha:
   - Exercício (selecione da lista)
   - Séries (ex: 3)
   - Repetições (ex: 12)
   - Peso (opcional, ex: 20 kg)
6. Clique em "Criar Treino"

---

## 🔒 Lembre-se

**NÃO FAZER DEPLOY NA VERCEL** - apenas trabalho local conforme solicitado.
