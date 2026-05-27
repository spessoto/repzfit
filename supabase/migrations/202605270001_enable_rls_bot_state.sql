-- ============================================================
-- Migration: Security hardening for public.bot_state
-- - Enable RLS
-- - Restrict direct client privileges
-- - Keep backend (service_role) access
-- ============================================================

alter table if exists public.bot_state enable row level security;
alter table if exists public.bot_state force row level security;

-- Remove direct access from client roles.
revoke all on table public.bot_state from anon;
revoke all on table public.bot_state from authenticated;

-- Keep backend/service access (used by server with service key).
grant all on table public.bot_state to service_role;
