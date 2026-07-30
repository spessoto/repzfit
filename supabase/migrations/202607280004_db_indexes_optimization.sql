-- ============================================================
-- DB Optimization 1: Índices críticos faltando + remover redundantes
-- ============================================================
-- Problema 1: FKs sem índice causam seq-scan em consultas frequentes.
-- Problema 2: Dois índices redundantes desperdiçam espaço e escrita.
-- ============================================================

-- ─── REMOVER ÍNDICES REDUNDANTES ────────────────────────────

-- idx_bot_state_lookup indexa whatsapp_number, que JÁ É a PK da tabela.
-- PK já cria índice B-tree automaticamente — este índice é 100% inútil.
DROP INDEX IF EXISTS public.idx_bot_state_lookup;

-- idx_students_whatsapp foi o índice original (202605260001).
-- Em 202606170001 foi criado idx_students_whatsapp_unique_global (UNIQUE)
-- na mesma coluna whatsapp_number. O índice simples é agora redundante.
DROP INDEX IF EXISTS public.idx_students_whatsapp;

-- ─── ÍNDICES CRÍTICOS (FKs sem índice) ──────────────────────

-- CRÍTICO: workout_exercises.workout_id
-- Toda listagem de exercícios de um treino (GET /workouts, GET /workouts/:id/exercises)
-- faz seq-scan em workout_exercises. Com crescimento de treinos, impacto cresce linearmente.
CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_id
  ON public.workout_exercises(workout_id);

-- CRÍTICO: set_logs.workout_exercise_id
-- Gráficos de evolução de carga por exercício (GET /students/:id/report) fazem JOIN
-- em set_logs filtrando por workout_exercise_id — sem índice é seq-scan em toda a tabela.
CREATE INDEX IF NOT EXISTS idx_set_logs_workout_exercise_id
  ON public.set_logs(workout_exercise_id);

-- ─── ÍNDICES MÉDIOS ──────────────────────────────────────────

-- MÉDIO: daily_sessions.workout_id
-- Queries de histórico de sessões agrupadas por treino.
CREATE INDEX IF NOT EXISTS idx_daily_sessions_workout_id
  ON public.daily_sessions(workout_id);

-- MÉDIO: bot_state.student_id
-- Lookup inverso aluno → estado do bot (cleanup, queries de diagnóstico).
CREATE INDEX IF NOT EXISTS idx_bot_state_student_id
  ON public.bot_state(student_id);

-- MÉDIO: exercises.personal_id
-- Tabela legada ainda consultada ativamente como fallback.
-- Toda query de leitura de exercícios privados por personal faz seq-scan hoje.
CREATE INDEX IF NOT EXISTS idx_exercises_personal_id
  ON public.exercises(personal_id);

-- ─── ÍNDICES BAIXA PRIORIDADE ────────────────────────────────

-- BAIXO: exercise_variations.ai_default_muscle_group_id (FK não indexada)
CREATE INDEX IF NOT EXISTS idx_exercise_variations_muscle_group_id
  ON public.exercise_variations(ai_default_muscle_group_id)
  WHERE ai_default_muscle_group_id IS NOT NULL;

-- BAIXO: exercise_combo_cache.muscle_group_id (FK não indexada)
CREATE INDEX IF NOT EXISTS idx_exercise_combo_cache_muscle_group_id
  ON public.exercise_combo_cache(muscle_group_id)
  WHERE muscle_group_id IS NOT NULL;
