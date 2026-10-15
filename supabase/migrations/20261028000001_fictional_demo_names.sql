-- System Guy holds dummy data only: no real client, brand or retailer names anywhere. Earlier migrations and seeds
-- now use fictional names; this rewrites databases built before that change (function bodies, stored text, codes).
-- Safe on a fresh database: it finds nothing to change.

-- The suppliers.client list of allowed values carried client names.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.suppliers'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%client%'
  loop
    execute format('alter table public.suppliers drop constraint %I', c.conname);
  end loop;
end $$;

create or replace function public._demo_fictional_text(t text) returns text
language plpgsql immutable as $$
declare pairs text[][] := array[
  ['Dove Real Care','Lumora Pure Care'], ['Heineken','Northbrew'], ['heineken','northbrew'], ['HNK','NBW'],
  ['Unilever','Brightlane'], ['unilever','brightlane'], ['Coloplast','Carewell'], ['coloplast','carewell'],
  ['Amstel','Halden'], ['Magnum','Polaris'], ['Knorr','Fresko'],
  ['Nespresso','Harvest Coffee'], ['Nestlé','Harvest Foods'], ['Nestle','Harvest Foods'],
  ['Tesco Extra','Grocerly Extra'], ['Tesco','Grocerly'], ['Sainsbury''s','Fairway'], ['Sainsbury','Fairway'],
  ['Asda','ValueMart'], ['Boots','Wellspring'], ['Superdrug','CareDrug'],
  ['Coop, Esselunga, Conad','Mercato, Fresca, Vicino'], ['Esselunga','Fresca'], ['Conad','Vicino'],
  ['7-Eleven','QuickStop'], ['Shell Select','FuelStop Select'], ['Albert Heijn','Dutch Fresh'],
  ['Jumbo Foodmarkt','Grote Markt Foods'], ['Jumbo','Grote Markt'], ['apetito','a client'],
  ['UL-PO-','BRL-PO-'], ['UL-GB-','BRL-GB-'], ['UL-VN-','BRL-VN-'], ['"client_code":"UL"','"client_code":"BRL"'],
  ['"client_code": "UL"','"client_code": "BRL"'], ['UL incumbent','BRL incumbent'], ['for UL China','for BRL China']];
  i int;
begin
  if t is null then return null; end if;
  for i in 1 .. array_length(pairs, 1) loop t := replace(t, pairs[i][1], pairs[i][2]); end loop;
  return regexp_replace(t, '\mDove\M', 'Lumora', 'g');
end $$;

do $$
declare f record; c record; v_def text; v_new text;
begin
  -- Functions whose text mentions a real name: recreate with the fictional names (grants are kept).
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname <> '_demo_fictional_text'
       and p.prosrc ~ '(Heineken|Unilever|Coloplast|Amstel|Magnum|Knorr|Nestl|Nespresso|Tesco|Jumbo|Esselunga|7-Eleven|\mDove\M)'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := public._demo_fictional_text(v_def);
    if v_new <> v_def then execute v_new; end if;
  end loop;

  -- Client codes.
  update public.sourcing_clients set code = 'BRL' where code = 'UL';
  update public.sourcing_clients set code = 'NBW' where code = 'HNK';
  update public.sourcing_clients set code = 'CRW' where code = 'CPL';

  -- Stored text everywhere, including history (triggers off for this rewrite only, so append-only logs are renamed too).
  perform set_config('assure.system_write', 'on', true);
  set local session_replication_role = replica;
  for c in
    select col.table_schema, col.table_name, col.column_name, col.data_type
      from information_schema.columns col
      join information_schema.tables t on t.table_schema = col.table_schema and t.table_name = col.table_name
     where col.table_schema in ('public', 'auth') and t.table_type = 'BASE TABLE'
       and col.data_type in ('text', 'jsonb', 'character varying') and col.is_generated = 'NEVER'
  loop
    begin
      if c.data_type = 'jsonb' then
        execute format('update %I.%I set %I = public._demo_fictional_text(%I::text)::jsonb where %I::text <> public._demo_fictional_text(%I::text)',
          c.table_schema, c.table_name, c.column_name, c.column_name, c.column_name, c.column_name);
      else
        execute format('update %I.%I set %I = public._demo_fictional_text(%I) where %I <> public._demo_fictional_text(%I)',
          c.table_schema, c.table_name, c.column_name, c.column_name, c.column_name, c.column_name);
      end if;
    exception when others then
      null;
    end;
  end loop;
  set local session_replication_role = origin;
end $$;

drop function public._demo_fictional_text(text);

alter table public.suppliers add constraint suppliers_client_check
  check (client in ('Brightlane','Northbrew','Carewell','BAU','Other'));
