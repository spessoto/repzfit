-- Correções do sistema de rest timer:
-- 1) Índice composto em bot_state para a query de polling de timers expirados.
-- 2) Reconfigura o job pg_cron com header Authorization (usa app.cron_secret se disponível).

-- 1) Índice parcial para acelerar a query de polling
--    WHERE current_state IN (...) AND rest_end_at <= now()
create index if not exists idx_bot_state_rest_timer
  on public.bot_state (current_state, rest_end_at)
  where rest_end_at is not null;

-- 2) Reconfigura pg_cron com Authorization header (robusto a CRON_SECRET futura)
do $job$
declare
  v_secret text;
  v_auth_header text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron nao encontrado; pulando reconfiguracao.';
    return;
  end if;

  -- Lê CRON_SECRET se configurado como parâmetro de banco (app.cron_secret)
  begin
    v_secret := current_setting('app.cron_secret', true);
  exception
    when others then
      v_secret := null;
  end;

  if v_secret is not null and v_secret <> '' then
    v_auth_header := '{"Content-Type":"application/json","Authorization":"Bearer ' || v_secret || '"}';
  else
    v_auth_header := '{"Content-Type":"application/json"}';
  end if;

  -- Remove versões anteriores (idempotente)
  begin perform cron.unschedule('repzfit-rest-timer-poll');    exception when others then null; end;
  begin perform cron.unschedule('repzfit-rest-timer-poll-v2'); exception when others then null; end;
  begin perform cron.unschedule('repzfit-rest-timer-poll-v3'); exception when others then null; end;

  -- Registra job v3 com header de autenticação dinâmico
  perform cron.schedule(
    'repzfit-rest-timer-poll-v3',
    '3 seconds',
    format(
      $sql$
        select net.http_post(
          url     := 'https://app.ezpersonal.com.br/api/internal/rest-timer/poll',
          body    := '{}'::jsonb,
          headers := %L::jsonb
        );
      $sql$,
      v_auth_header
    )
  );

  raise notice 'Cron job repzfit-rest-timer-poll-v3 registrado (a cada 3s, auth: %).', 
    case when v_secret is not null then 'Bearer ***' else 'sem autenticacao' end;
end;
$job$;
