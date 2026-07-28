-- Adiciona coluna last_activity_at ao bot_state para controle granular de inatividade.
-- Diferente de updated_at (atualizado em qualquer mudança de estado, incluindo
-- operações internas), last_activity_at representa exclusivamente a última interação
-- real do aluno (mensagem recebida ou transição de estado por ação do aluno).
-- Isso permite detectar inatividade real sem falsos positivos de operações internas.

alter table public.bot_state
  add column if not exists last_activity_at timestamptz default null;

-- Backfill: usa updated_at como proxy para sessões já em andamento
update public.bot_state
  set last_activity_at = updated_at
  where last_activity_at is null;

-- Índice para a query de polling de inatividade:
-- WHERE current_session_id IS NOT NULL AND last_activity_at IS NOT NULL
create index if not exists idx_bot_state_inactivity
  on public.bot_state (last_activity_at)
  where current_session_id is not null and last_activity_at is not null;
