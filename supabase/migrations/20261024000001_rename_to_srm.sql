-- The supplier relationship section is called SRM (no longer Assure+). Earlier migrations and seeds now say SRM,
-- but databases built before the rename still carry the old name in function messages and stored text.
-- This rewrites both in place. Safe to run on a fresh database (it finds nothing to change).

do $$
declare f record; c record; v_def text;
begin
  -- Functions whose messages mention the old name: recreate them with the new name (grants are kept).
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%Assure+%'
  loop
    v_def := replace(pg_get_functiondef(f.oid), 'Assure+', 'SRM');
    execute v_def;
  end loop;

  -- Stored text (help articles, library notes, policy descriptions, notifications). System write so governed
  -- tables accept the change; append-only tables that refuse updates are left as they are.
  perform set_config('assure.system_write', 'on', true);
  for c in
    select t.table_name, col.column_name, col.data_type
      from information_schema.tables t
      join information_schema.columns col on col.table_schema = t.table_schema and col.table_name = t.table_name
     where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and col.data_type in ('text', 'jsonb') and col.is_generated = 'NEVER'
  loop
    begin
      if c.data_type = 'jsonb' then
        execute format('update public.%I set %I = replace(%I::text, %L, %L)::jsonb where %I::text like %L',
          c.table_name, c.column_name, c.column_name, 'Assure+', 'SRM', c.column_name, '%Assure+%');
      else
        execute format('update public.%I set %I = replace(%I, %L, %L) where %I like %L',
          c.table_name, c.column_name, c.column_name, 'Assure+', 'SRM', c.column_name, '%Assure+%');
      end if;
    exception when others then
      null; -- append-only or otherwise protected history stays as recorded
    end;
  end loop;
end $$;
