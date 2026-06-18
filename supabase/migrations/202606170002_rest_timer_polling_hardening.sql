-- Hardening do disparo automatico do timer de descanso.
-- Objetivo: garantir que o polling continue ativo via pg_cron + pg_net
-- mesmo apos ajustes de deploy/configuracao.

-- 1) Tenta habilitar extensoes necessarias sem quebrar migration.
do $ext$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron nao disponivel neste plano/ambiente: %', sqlerrm;
end;
$ext$;

do $ext$
begin
  create extension if not exists pg_net;
exception
  when others then
    raise notice 'pg_net nao disponivel neste plano/ambiente: %', sqlerrm;
end;
$ext$;

-- 2) Reconfigura o job de polling, se pg_cron estiver disponivel.
do $job$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron nao encontrado; pulando reconfiguracao do rest timer poll.';
    return;
  end if;

  -- Limpa jobs antigos (idempotente)
  begin
    perform cron.unschedule('repzfit-rest-timer-poll');
  exception
    when others then null;
  end;

  begin
    perform cron.unschedule('repzfit-rest-timer-poll-v2');
  exception
    when others then null;
  end;

  -- Registra novamente o polling frequente (3s)
  perform cron.schedule(
    'repzfit-rest-timer-poll-v2',
    '3 seconds',
    $$
      select net.http_post(
        url     := 'https://app.ezpersonal.com.br/api/internal/rest-timer/poll',
        body    := '{}'::jsonb,
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
    $$
  );

  raise notice 'Cron job repzfit-rest-timer-poll-v2 registrado com sucesso (a cada 3s).';
end;
$job$;
