-- ============================================================
-- DB Optimization 2: Limpeza de dados obsoletos + pg_cron jobs de retenção
-- ============================================================
-- Executa limpeza imediata de dados acumulados e registra jobs
-- de manutenção periódica via pg_cron.
-- ============================================================

-- ─── LIMPEZA IMEDIATA — DADOS SEGUROS PARA REMOVER ──────────

-- 1. processed_webhook_events: entradas com mais de 1 hora (TTL normal é 10min)
--    A limpeza em código é fire-and-forget; acumuladas entre deploys ou períodos inativos.
DELETE FROM public.processed_webhook_events
WHERE processed_at < now() - interval '1 hour';

-- 2. bot_anomaly_logs resolvidos com mais de 90 dias
--    Logs já tratados pela equipe não têm valor operacional após 3 meses.
DELETE FROM public.bot_anomaly_logs
WHERE resolved = true
  AND resolved_at < now() - interval '90 days';

-- 3. bot_anomaly_logs NÃO resolvidos (info/warn) com mais de 6 meses
--    Logs antigos não-tratados de baixa severidade são arqueologicamente inúteis.
DELETE FROM public.bot_anomaly_logs
WHERE resolved = false
  AND severity IN ('info', 'warn')
  AND created_at < now() - interval '6 months';

-- 4. daily_sessions abandonadas com mais de 1 ano
--    Sessões nunca completadas não têm valor para relatórios históricos.
--    ON DELETE CASCADE garante que set_logs vinculados também serão removidos.
DELETE FROM public.daily_sessions
WHERE status = 'abandoned'
  AND date < current_date - interval '1 year';

-- 5. Limpeza de exercises sem uso no novo modelo e sem workout_exercises vinculados
--    (somente remove exercícios completamente órfãos — sem catalog E sem treino)
DELETE FROM public.exercises
WHERE id IN (
  SELECT e.id
  FROM public.exercises e
  LEFT JOIN public.exercise_catalog ec ON ec.legacy_exercise_id = e.id
  LEFT JOIN public.workout_exercises we ON we.exercise_id = e.id
  WHERE ec.id IS NULL AND we.id IS NULL
);

-- ─── pg_cron: JOBS DE MANUTENÇÃO PERIÓDICA ──────────────────

do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não disponível; pulando registro de jobs de manutenção.';
    return;
  end if;

  -- Remover jobs antigos se existirem (idempotente)
  begin perform cron.unschedule('repzfit-cleanup-webhook-events');    exception when others then null; end;
  begin perform cron.unschedule('repzfit-cleanup-anomaly-logs');      exception when others then null; end;
  begin perform cron.unschedule('repzfit-cleanup-abandoned-sessions');exception when others then null; end;

  -- Job 1: Limpar processed_webhook_events com mais de 1 hora — todo dia às 3h
  perform cron.schedule(
    'repzfit-cleanup-webhook-events',
    '0 3 * * *',
    $sql$
      DELETE FROM public.processed_webhook_events
      WHERE processed_at < now() - interval '1 hour';
    $sql$
  );

  -- Job 2: Limpar bot_anomaly_logs resolvidos > 90 dias e não-resolvidos (warn/info) > 6 meses
  --        Roda toda segunda-feira às 3h30
  perform cron.schedule(
    'repzfit-cleanup-anomaly-logs',
    '30 3 * * 1',
    $sql$
      DELETE FROM public.bot_anomaly_logs
      WHERE (resolved = true AND resolved_at < now() - interval '90 days')
         OR (resolved = false AND severity IN ('info','warn') AND created_at < now() - interval '6 months');
    $sql$
  );

  -- Job 3: Limpar daily_sessions abandonadas > 1 ano (cascade remove set_logs vinculados)
  --        Roda no 1º de cada mês às 4h
  perform cron.schedule(
    'repzfit-cleanup-abandoned-sessions',
    '0 4 1 * *',
    $sql$
      DELETE FROM public.daily_sessions
      WHERE status = 'abandoned'
        AND date < current_date - interval '1 year';
    $sql$
  );

  raise notice 'Jobs de manutenção registrados: webhook-events (diário), anomaly-logs (semanal), abandoned-sessions (mensal).';
end;
$cron$;

-- ─── RELATÓRIO DE TAMANHO (diagnóstico) ─────────────────────
-- Registra comentários de documentação nas tabelas de maior crescimento.
comment on table public.set_logs is
  'Maior tabela operacional. Cresce ~187k linhas/ano por 50 alunos ativos. '
  'Sem política de archival ativa — monitorar ao atingir 500k linhas para avaliar particionamento.';

comment on table public.daily_sessions is
  'Cresce ~10k linhas/ano por 50 alunos. Sessões abandoned > 1 ano são limpas mensalmente via pg_cron.';

comment on table public.bot_anomaly_logs is
  'Limpeza automática semanal: resolvidos > 90 dias e não-resolvidos (warn/info) > 6 meses via pg_cron.';

comment on table public.processed_webhook_events is
  'TTL operacional de 10 minutos (código). Safety-net via pg_cron diário remove entradas > 1 hora.';
