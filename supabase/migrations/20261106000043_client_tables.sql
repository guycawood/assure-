-- Uploaded tables for a client's savings checks: fee schedules (a lookup of key to value, with optional dates on each row) and exception lists
-- (a plain list of values, for example job references). A table has versions. An upload waits as a pending version; a different person who governs CRM
-- approves it, and it becomes the live version that check runs read. The earlier live version is kept. The approver can see what changed.

create table public.crm_client_tables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind text not null check (kind in ('list', 'lookup')),
  title text not null check (length(trim(title)) between 1 and 120),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (client_id, key)
);

create table public.crm_client_table_versions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.crm_client_tables(id) on delete cascade,
  version int not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'retired')),
  rows jsonb not null,
  row_count int not null,
  added int not null default 0, removed int not null default 0, changed int not null default 0,
  note text, file_name text,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(), uploaded_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null, decided_at timestamptz, decision_note text, published_at timestamptz,
  unique (table_id, version)
);
create unique index crm_ctv_one_pending on public.crm_client_table_versions (table_id) where status = 'pending';
create unique index crm_ctv_one_published on public.crm_client_table_versions (table_id) where status = 'published';

alter table public.crm_client_tables enable row level security;
alter table public.crm_client_table_versions enable row level security;
create policy crm_ct_read on public.crm_client_tables for select to authenticated using (public.is_internal());
create policy crm_ctv_read on public.crm_client_table_versions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_client_tables, public.crm_client_table_versions from authenticated, anon;

-- Shape of the rows: a list is strings; a lookup is {key, value, from?, to?}.
create or replace function public._ct_check_rows(p_kind text, p_rows jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; n int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'The table must be a list of rows'; end if;
  n := jsonb_array_length(p_rows);
  if n = 0 then raise exception 'The table has no rows'; end if;
  if n > 50000 then raise exception 'A table can have at most 50,000 rows'; end if;
  if length(p_rows::text) > 5000000 then raise exception 'The table is too large'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if p_kind = 'list' then
      if jsonb_typeof(r) <> 'string' or length(r #>> '{}') not between 1 and 120 then raise exception 'List values are text of up to 120 characters'; end if;
    else
      if jsonb_typeof(r) <> 'object' or coalesce(trim(r->>'key'), '') = '' or length(r->>'key') > 120 then raise exception 'Every lookup row needs a key of up to 120 characters'; end if;
      if jsonb_typeof(r->'value') <> 'number' then raise exception 'Every lookup row needs a numeric value'; end if;
      if (r->>'from') is not null and (r->>'from') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Dates are written YYYY-MM-DD'; end if;
      if (r->>'to') is not null and (r->>'to') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Dates are written YYYY-MM-DD'; end if;
    end if;
  end loop;
  return p_rows;
end $$;
revoke execute on function public._ct_check_rows(text, jsonb) from public, anon, authenticated;

-- Identity of a row for comparing versions: the value for a list, key and start date for a lookup.
create or replace function public._ct_identity(p_kind text, r jsonb) returns text
language sql immutable as $$
  select case when p_kind = 'list' then lower(trim(r #>> '{}')) else lower(trim(r->>'key')) || '|' || coalesce(r->>'from', '') end;
$$;
revoke execute on function public._ct_identity(text, jsonb) from public, anon, authenticated;

create or replace function public._ct_diff(p_kind text, p_old jsonb, p_new jsonb) returns jsonb
language plpgsql immutable as $$
declare v_added jsonb; v_removed jsonb; v_changed jsonb;
begin
  with o as (select public._ct_identity(p_kind, x) id, x from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) x),
       n as (select public._ct_identity(p_kind, x) id, x from jsonb_array_elements(p_new) x)
  select coalesce((select jsonb_agg(n.x) from n where not exists (select 1 from o where o.id = n.id)), '[]'::jsonb),
         coalesce((select jsonb_agg(o.x) from o where not exists (select 1 from n where n.id = o.id)), '[]'::jsonb),
         case when p_kind = 'lookup' then coalesce((select jsonb_agg(jsonb_build_object('key', n.x->>'key', 'from', n.x->>'from', 'was', o.x->'value', 'now', n.x->'value'))
                                                      from n join o on o.id = n.id where (o.x->'value') is distinct from (n.x->'value')), '[]'::jsonb) else '[]'::jsonb end
    into v_added, v_removed, v_changed;
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'changed', v_changed);
end $$;
revoke execute on function public._ct_diff(text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.crm_table_upload(p_client uuid, p_key text, p_title text, p_kind text, p_rows jsonb, p_note text, p_file text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.crm_client_tables; v_ver int; v_id uuid; pub public.crm_client_table_versions; d jsonb;
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'Name the table with letters, digits and underscores (for example fee_by_country)'; end if;
  if p_kind not in ('list', 'lookup') then raise exception 'Choose a list or a lookup'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what this upload is and where it comes from'; end if;
  perform public._ct_check_rows(p_kind, p_rows);
  select * into t from public.crm_client_tables where client_id = p_client and key = p_key for update;
  if t.id is null then
    if coalesce(trim(p_title), '') = '' then raise exception 'Give the new table a title'; end if;
    insert into public.crm_client_tables (client_id, key, kind, title) values (p_client, p_key, p_kind, trim(p_title)) returning * into t;
  elsif t.kind <> p_kind then raise exception 'This table is a % and the upload is a %', t.kind, p_kind;
  end if;
  if exists (select 1 from public.crm_client_table_versions where table_id = t.id and status = 'pending') then
    raise exception 'An earlier upload of this table is still waiting for approval. Withdraw it or have it decided first';
  end if;
  select * into pub from public.crm_client_table_versions where table_id = t.id and status = 'published';
  select coalesce(max(version), 0) + 1 into v_ver from public.crm_client_table_versions where table_id = t.id;
  d := public._ct_diff(t.kind, pub.rows, p_rows);
  insert into public.crm_client_table_versions (table_id, version, rows, row_count, added, removed, changed, note, file_name)
  values (t.id, v_ver, p_rows, jsonb_array_length(p_rows), jsonb_array_length(d->'added'), jsonb_array_length(d->'removed'), jsonb_array_length(d->'changed'), trim(p_note), left(p_file, 255)) returning id into v_id;
  perform public._crm_event(p_client, 'client_table', v_id::text, 'table_uploaded', jsonb_build_object('table', p_key, 'version', v_ver, 'rows', jsonb_array_length(p_rows)));
  perform public.notify(m.user_id, 'crm', 'A client table is waiting for approval', t.title || ': ' || jsonb_array_length(p_rows) || ' rows', '/crm/clients/' || p_client || '?tab=rules')
    from public.module_owners m where m.module = 'crm' and m.user_id is distinct from auth.uid();
  return v_id;
end $$;

create or replace function public.crm_table_decide(p_version uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.crm_client_table_versions; t public.crm_client_tables;
begin
  perform public._crm_require();
  if not public.can_govern('crm') then raise exception 'Only the CRM owners can approve a table' using errcode = '42501'; end if;
  select * into v from public.crm_client_table_versions where id = p_version for update;
  if v.id is null or v.status <> 'pending' then raise exception 'That upload is not waiting for approval'; end if;
  if v.uploaded_by = auth.uid() then raise exception 'A different person must approve what you uploaded'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why it is sent back'; end if;
  select * into t from public.crm_client_tables where id = v.table_id;
  if p_approve then
    update public.crm_client_table_versions set status = 'retired' where table_id = v.table_id and status = 'published';
    update public.crm_client_table_versions set status = 'published', published_at = now(), decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_version;
  else
    update public.crm_client_table_versions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_version;
  end if;
  perform public._crm_event(t.client_id, 'client_table', p_version::text, case when p_approve then 'table_published' else 'table_rejected' end, jsonb_build_object('table', t.key, 'version', v.version));
  perform public.notify(v.uploaded_by, 'crm', case when p_approve then 'Your table is live' else 'Your table was sent back' end, t.title || coalesce(': ' || nullif(trim(p_note), ''), ''), '/crm/clients/' || t.client_id || '?tab=rules');
end $$;

create or replace function public.crm_table_withdraw(p_version uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.crm_client_table_versions;
begin
  perform public._crm_require();
  select * into v from public.crm_client_table_versions where id = p_version for update;
  if v.id is null or v.status <> 'pending' then raise exception 'That upload is not waiting for approval'; end if;
  if v.uploaded_by <> auth.uid() and not public.can_govern('crm') then raise exception 'Only the person who uploaded it can withdraw it' using errcode = '42501'; end if;
  delete from public.crm_client_table_versions where id = p_version;
end $$;

-- The client's tables, with the live version and anything waiting. No rows except a short sample of the live version.
create or replace function public.crm_client_tables(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', t.id, 'key', t.key, 'kind', t.kind, 'title', t.title,
    'live', (select jsonb_build_object('id', v.id, 'version', v.version, 'row_count', v.row_count, 'published_at', v.published_at, 'note', v.note, 'file_name', v.file_name,
               'uploaded_by', coalesce(nullif(p.full_name, ''), p.email), 'sample', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v.rows) x limit 8) s))
               from public.crm_client_table_versions v left join public.profiles p on p.id = v.uploaded_by where v.table_id = t.id and v.status = 'published'),
    'pending', (select jsonb_build_object('id', v.id, 'version', v.version, 'row_count', v.row_count, 'added', v.added, 'removed', v.removed, 'changed', v.changed, 'note', v.note, 'file_name', v.file_name,
               'uploaded_by', v.uploaded_by, 'uploaded_by_name', coalesce(nullif(p.full_name, ''), p.email), 'uploaded_at', v.uploaded_at)
               from public.crm_client_table_versions v left join public.profiles p on p.id = v.uploaded_by where v.table_id = t.id and v.status = 'pending'),
    'versions', (select count(*) from public.crm_client_table_versions v where v.table_id = t.id)) order by t.title)
    from public.crm_client_tables t where t.client_id = p_client), '[]'::jsonb);
end $$;

create or replace function public.crm_table_diff(p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.crm_client_table_versions; t public.crm_client_tables; pub public.crm_client_table_versions; d jsonb;
begin
  perform public._crm_require();
  select * into v from public.crm_client_table_versions where id = p_version;
  if v.id is null then raise exception 'Upload not found'; end if;
  select * into t from public.crm_client_tables where id = v.table_id;
  select * into pub from public.crm_client_table_versions where table_id = v.table_id and status = 'published' and id <> v.id;
  d := public._ct_diff(t.kind, pub.rows, v.rows);
  return jsonb_build_object('kind', t.kind, 'added', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(d->'added') x limit 25) s),
    'removed', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(d->'removed') x limit 25) s),
    'changed', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(d->'changed') x limit 25) s),
    'added_total', jsonb_array_length(d->'added'), 'removed_total', jsonb_array_length(d->'removed'), 'changed_total', jsonb_array_length(d->'changed'));
end $$;

-- What a check run reads: the live rows of each table, by name.
create or replace function public.crm_client_tables_published(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  return coalesce((select jsonb_object_agg(t.key, jsonb_build_object('kind', t.kind, 'version', v.version, 'rows', v.rows))
    from public.crm_client_tables t join public.crm_client_table_versions v on v.table_id = t.id and v.status = 'published' where t.client_id = p_client), '{}'::jsonb);
end $$;

revoke execute on function public.crm_table_upload(uuid, text, text, text, jsonb, text, text), public.crm_table_decide(uuid, boolean, text), public.crm_table_withdraw(uuid),
  public.crm_client_tables(uuid), public.crm_table_diff(uuid), public.crm_client_tables_published(uuid) from public, anon;
grant execute on function public.crm_table_upload(uuid, text, text, text, jsonb, text, text), public.crm_table_decide(uuid, boolean, text), public.crm_table_withdraw(uuid),
  public.crm_client_tables(uuid), public.crm_table_diff(uuid), public.crm_client_tables_published(uuid) to authenticated;
