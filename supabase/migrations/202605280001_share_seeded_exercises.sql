-- Compartilha a base de exercícios importada com o usuário de teste
-- para que todos os personals visualizem via RLS (personal_id IS NULL).

do $mig$
declare
  v_personal_id uuid;
  v_updated integer := 0;
begin
  select id
    into v_personal_id
    from public.personals
   where lower(email) = 'personal.teste@repzfit.com'
   limit 1;

  if v_personal_id is null then
    raise notice 'Personal de teste não encontrado; nenhuma linha alterada.';
    return;
  end if;

  update public.exercises
     set personal_id = null
   where personal_id = v_personal_id;

  get diagnostics v_updated = row_count;
  raise notice 'Exercícios compartilhados (personal_id -> NULL): %', v_updated;
end;
$mig$;
