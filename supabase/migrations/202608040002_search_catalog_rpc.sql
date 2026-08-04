-- Migration: funções RPC para busca tolerante a acentos nos catálogos
-- Usa normalize_search() (unaccent + lower) para comparar termo buscado contra nome no banco
-- Aproveita os índices btree criados em 202608040001_unaccent_search_indexes.sql

-- Busca no exercise_catalog com normalize_search
create or replace function public.search_exercise_catalog(
  p_search      text,
  p_personal_id uuid,
  p_muscle_group_id uuid default null,
  p_limit       int  default 200
)
returns table (
  id              uuid,
  name            text,
  notes           text,
  muscle_group_id uuid,
  personal_id     uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ec.id,
    ec.name,
    ec.notes,
    ec.muscle_group_id,
    ec.personal_id
  from exercise_catalog ec
  where
    (ec.personal_id is null or ec.personal_id = p_personal_id)
    and (
      p_search is null
      or p_search = ''
      or public.normalize_search(ec.name) like '%' || public.normalize_search(p_search) || '%'
    )
    and (
      p_muscle_group_id is null
      or ec.muscle_group_id = p_muscle_group_id
    )
  order by ec.name
  limit p_limit;
$$;

-- Busca no exercise_variations
create or replace function public.search_exercise_variations(
  p_search      text,
  p_personal_id uuid,
  p_limit       int default 200
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ev.id, ev.name
  from exercise_variations ev
  where
    (ev.personal_id is null or ev.personal_id = p_personal_id)
    and (
      p_search is null
      or p_search = ''
      or public.normalize_search(ev.name) like '%' || public.normalize_search(p_search) || '%'
    )
  order by ev.name
  limit p_limit;
$$;

-- Busca no equipment_catalog
create or replace function public.search_equipment_catalog(
  p_search text,
  p_limit  int default 200
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ec.id, ec.name
  from equipment_catalog ec
  where
    p_search is null
    or p_search = ''
    or public.normalize_search(ec.name) like '%' || public.normalize_search(p_search) || '%'
  order by ec.name
  limit p_limit;
$$;

-- Busca no grip_footing_catalog
create or replace function public.search_grip_footing_catalog(
  p_search text,
  p_limit  int default 200
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select gf.id, gf.name
  from grip_footing_catalog gf
  where
    p_search is null
    or p_search = ''
    or public.normalize_search(gf.name) like '%' || public.normalize_search(p_search) || '%'
  order by gf.name
  limit p_limit;
$$;

-- Busca no method_catalog
create or replace function public.search_method_catalog(
  p_search text,
  p_limit  int default 200
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select mc.id, mc.name
  from method_catalog mc
  where
    p_search is null
    or p_search = ''
    or public.normalize_search(mc.name) like '%' || public.normalize_search(p_search) || '%'
  order by mc.name
  limit p_limit;
$$;

-- Grant de execução para o role anon e authenticated (usados pelo service_role via supabaseAdmin)
grant execute on function public.search_exercise_catalog(text, uuid, uuid, int) to service_role;
grant execute on function public.search_exercise_variations(text, uuid, int) to service_role;
grant execute on function public.search_equipment_catalog(text, int) to service_role;
grant execute on function public.search_grip_footing_catalog(text, int) to service_role;
grant execute on function public.search_method_catalog(text, int) to service_role;
