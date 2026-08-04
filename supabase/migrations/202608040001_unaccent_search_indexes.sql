-- Migration: habilitar extensão unaccent e criar índices funcionais para busca tolerante a acentos
-- Permite buscas como "abducao" encontrarem "Abdução", "exercicio" encontrar "Exercício", etc.

-- 1. Habilitar extensão unaccent (disponível por padrão no Supabase)
create extension if not exists unaccent with schema extensions;

-- 2. Criar função imutável para normalização (necessário para uso em índice)
create or replace function public.normalize_search(text text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select lower(extensions.unaccent(text));
$$;

-- 3. Índices funcionais nas tabelas de catálogo
create index if not exists idx_exercise_catalog_name_search
  on public.exercise_catalog using gin (to_tsvector('simple', public.normalize_search(name)));

create index if not exists idx_exercise_variations_name_search
  on public.exercise_variations using gin (to_tsvector('simple', public.normalize_search(name)));

create index if not exists idx_equipment_catalog_name_search
  on public.equipment_catalog using gin (to_tsvector('simple', public.normalize_search(name)));

create index if not exists idx_grip_footing_catalog_name_search
  on public.grip_footing_catalog using gin (to_tsvector('simple', public.normalize_search(name)));

create index if not exists idx_method_catalog_name_search
  on public.method_catalog using gin (to_tsvector('simple', public.normalize_search(name)));

-- 4. Índices btree para ilike com normalize_search (busca por prefixo/substring)
create index if not exists idx_exercise_catalog_name_lower
  on public.exercise_catalog (public.normalize_search(name));

create index if not exists idx_exercise_variations_name_lower
  on public.exercise_variations (public.normalize_search(name));

create index if not exists idx_equipment_catalog_name_lower
  on public.equipment_catalog (public.normalize_search(name));

create index if not exists idx_grip_footing_catalog_name_lower
  on public.grip_footing_catalog (public.normalize_search(name));

create index if not exists idx_method_catalog_name_lower
  on public.method_catalog (public.normalize_search(name));
