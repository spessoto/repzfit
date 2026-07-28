-- ============================================================
-- LGPD Field Encryption — Schema Changes
-- ============================================================
-- Prepara o schema para criptografia por campo (AES-256-GCM)
-- aplicada na camada de aplicação (Node.js).
--
-- Alterações de tipo:
--   students.height_cm     : numeric(5,2)  → text
--   students.weight_kg     : numeric(6,2)  → text
--   students.monthly_fee   : numeric(10,2) → text
--   students.payment_day   : integer       → text
--   students.blood_type    : text          → text  (sem alteração de tipo, mas comentado)
--   students.email         : text          → text  (idem)
--   set_logs.rpe_score     : integer       → text
--   set_logs.reps_done     : integer       → text
--   set_logs.weight_used   : numeric(5,2)  → text
--   student_weight_logs.weight_kg : numeric(6,2) → text
--
-- Colunas de hash adicionadas (HMAC-SHA256 determinístico para lookup):
--   students.whatsapp_hash       : text (índice único para substituir lookup direto)
--   personals.phone_hash         : text (índice para lookup do bot)
--
-- NOTA: Os valores existentes permanecem em plaintext até o script de
-- migração de dados ser executado. O código de decrypt() lida com isso
-- via fallback: strings sem prefixo "v1:" são retornadas como-estão.
-- ============================================================

-- --------------------------------------------------------
-- 1. Remover CHECK constraints que validam os tipos antigos
-- --------------------------------------------------------
alter table public.students
  drop constraint if exists students_weight_kg_check,
  drop constraint if exists students_height_cm_check,
  drop constraint if exists students_monthly_fee_check,
  drop constraint if exists students_payment_day_check;

alter table public.student_weight_logs
  drop constraint if exists student_weight_logs_weight_kg_check,
  drop constraint if exists student_weight_logs_positive_weight;

alter table public.set_logs
  drop constraint if exists set_logs_rpe_score_check,
  drop constraint if exists set_logs_reps_done_check,
  drop constraint if exists set_logs_weight_used_check;

-- --------------------------------------------------------
-- 2. Alterar colunas numéricas para text
--    (conversão implícita: numeric/integer → text via CAST)
-- --------------------------------------------------------

-- students
alter table public.students
  alter column height_cm  type text using (height_cm::text),
  alter column weight_kg  type text using (weight_kg::text),
  alter column monthly_fee type text using (monthly_fee::text),
  alter column payment_day type text using (payment_day::text);

-- set_logs
alter table public.set_logs
  alter column rpe_score   type text using (rpe_score::text),
  alter column reps_done   type text using (reps_done::text),
  alter column weight_used type text using (weight_used::text);

-- student_weight_logs
alter table public.student_weight_logs
  alter column weight_kg type text using (weight_kg::text);

-- --------------------------------------------------------
-- 3. Adicionar colunas de hash HMAC para lookup (Fase 3)
-- --------------------------------------------------------

-- Hash do whatsapp_number em students (para substituir lookup por plaintext)
alter table public.students
  add column if not exists whatsapp_hash text;

-- Índice único: garante unicidade via hash (substitui eventual conflito de plaintext)
create unique index if not exists idx_students_whatsapp_hash
  on public.students (whatsapp_hash)
  where whatsapp_hash is not null;

-- Hash do phone em personals
alter table public.personals
  add column if not exists phone_hash text;

create index if not exists idx_personals_phone_hash
  on public.personals (phone_hash)
  where phone_hash is not null;

-- --------------------------------------------------------
-- 4. Comentários de documentação nas colunas
-- --------------------------------------------------------
comment on column public.students.blood_type    is 'AES-256-GCM encrypted. LGPD Art.11 sensitive data.';
comment on column public.students.height_cm     is 'AES-256-GCM encrypted. LGPD Art.11 health data.';
comment on column public.students.weight_kg     is 'AES-256-GCM encrypted. LGPD Art.11 health data.';
comment on column public.students.monthly_fee   is 'AES-256-GCM encrypted. Financial data.';
comment on column public.students.payment_day   is 'AES-256-GCM encrypted. Financial data.';
comment on column public.students.email         is 'AES-256-GCM encrypted. Personal identification data.';
comment on column public.students.name          is 'AES-256-GCM encrypted. Personal identification data.';
comment on column public.students.whatsapp_number is 'AES-256-GCM encrypted. Use whatsapp_hash for lookups.';
comment on column public.students.whatsapp_hash   is 'HMAC-SHA256 of whatsapp_number. Used for exact-match lookups.';
comment on column public.personals.crf_registration is 'AES-256-GCM encrypted. Professional registration data.';
comment on column public.personals.phone        is 'AES-256-GCM encrypted. Use phone_hash for lookups.';
comment on column public.personals.phone_hash   is 'HMAC-SHA256 of phone. Used for exact-match lookups.';
comment on column public.set_logs.rpe_score     is 'AES-256-GCM encrypted. LGPD Art.11 biometric data.';
comment on column public.set_logs.reps_done     is 'AES-256-GCM encrypted. LGPD Art.11 physical performance data.';
comment on column public.set_logs.weight_used   is 'AES-256-GCM encrypted. LGPD Art.11 physical performance data.';
comment on column public.student_weight_logs.weight_kg is 'AES-256-GCM encrypted. LGPD Art.11 health data.';
