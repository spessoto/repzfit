-- ============================================================
-- Limpeza crítica: cron.job_run_details (645 MB = 94,93% do banco)
-- ============================================================
-- O pg_cron acumula o histórico completo de todas as execuções
-- de jobs (rest-timer poll a cada 3s, session-cleanup, etc.) 
-- indefinidamente. Com o rest-timer rodando a cada 3s, isso gera
-- ~28.800 registros/dia — por isso o tamanho explosivo.
--
-- Solução:
-- 1. TRUNCATE imediato para liberar 645 MB
-- 2. Reconfigurar retenção do pg_cron para manter só 1 dia de logs
-- 3. Registrar job de limpeza diária como safety-net
-- ============================================================

-- 1. Truncar o log histórico completo do pg_cron
--    TRUNCATE é instantâneo e retorna o espaço imediatamente
--    (diferente de DELETE que requer VACUUM posterior)
TRUNCATE cron.job_run_details;

-- 3. Também limpar net._http_response (4,59 MB de respostas HTTP do pg_net)
--    Acumulam as respostas das chamadas do pg_cron ao endpoint do bot
TRUNCATE net._http_response;

-- 4. Limpar public.processed_webhook_events que apareceu no ranking (616 KB)
--    Nossa migration 202607280005 já fez isso, mas pode ter acumulado mais
DELETE FROM public.processed_webhook_events
WHERE processed_at < now() - interval '1 hour';

-- 5. Configurar retenção automática do pg_cron:
--    Manter apenas os últimos 7 dias de logs (em vez de acumular para sempre)
do $retention$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não disponível.';
    return;
  end if;

  -- Remover job antigo de limpeza se existir
  begin perform cron.unschedule('repzfit-cleanup-cron-logs'); exception when others then null; end;
  begin perform cron.unschedule('cron-cleanup'); exception when others then null; end;

  -- Job de limpeza diária: manter apenas os últimos 7 dias de histórico do pg_cron
  -- Roda todo dia às 2h30 (antes do session-cleanup às 3h)
  perform cron.schedule(
    'repzfit-cleanup-cron-logs',
    '30 2 * * *',
    $sql$
      DELETE FROM cron.job_run_details
      WHERE end_time < now() - interval '7 days';

      DELETE FROM net._http_response
      WHERE created < now() - interval '7 days';
    $sql$
  );

  -- Também limitar retenção padrão do pg_cron se a configuração existir
  -- (supabase/pg_cron >=0.5.0 suporta cron.log_run_duration)
  begin
    perform set_config('cron.log_run_duration', 'false', false);
  exception when others then null;
  end;

  raise notice 'Job repzfit-cleanup-cron-logs registrado: limpa cron.job_run_details e net._http_response com mais de 7 dias, todo dia às 2h30.';
end;
$retention$;
