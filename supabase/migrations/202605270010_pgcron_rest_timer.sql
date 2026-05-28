-- Habilita pg_cron e registra o job de polling do rest timer (a cada 3 segundos).
-- Requer plano Pro ou superior no Supabase.
-- Se pg_cron nao estiver disponivel, o bloco falha silenciosamente sem
-- bloquear migrations futuras.

do $ext$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron nao disponivel neste plano (habilite manualmente no Dashboard): %', sqlerrm;
end;
$ext$;

do $job$
begin
  -- Verifica se pg_cron foi habilitado com sucesso
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron nao encontrado — pulando configuracao do cron job.';
    return;
  end if;

  -- Remove job anterior para evitar duplicatas (idempotente)
  begin
    perform cron.unschedule('repzfit-rest-timer-poll');
  exception
    when others then null; -- job nao existia, ok
  end;

  -- Registra: chama /api/internal/rest-timer/poll a cada 3 segundos
  perform cron.schedule(
    'repzfit-rest-timer-poll',
    '3 seconds',
    $$
      select net.http_post(
        url     := 'https://app.repz.fit/api/internal/rest-timer/poll',
        body    := '{}'::jsonb,
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
    $$
  );

  raise notice 'Cron job repzfit-rest-timer-poll registrado com sucesso (polling a cada 3 segundos).';
end;
$job$;
