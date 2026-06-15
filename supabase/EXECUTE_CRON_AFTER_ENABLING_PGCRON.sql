-- Execute este SQL no Supabase SQL Editor APOS habilitar pg_cron
-- Dashboard > Database > Extensions > pg_cron (toggle ON)

select cron.schedule('repzfit-rest-timer-poll','3 seconds',$q$select net.http_post(url := 'https://app.ezpersonal.com.br/api/internal/rest-timer/poll', body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb);$q$);