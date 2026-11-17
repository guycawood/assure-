-- Client method and savings-check rules (CRM client watchtower).
-- Each client has a versioned rule set: its sourcing and savings method (savings types and how each is counted, fee model, thresholds,
-- exchange-rate policy, owner map, regions), its check rules, and the map from its own file columns to the standard fields. One version
-- holds all of that so a check run is always reproducible against "version N". A change is drafted by CRM staff, proposed, and published
-- only when a different person who governs CRM approves it. Check runs keep the summary only, never the uploaded rows (they hold prices).

create table public.crm_ruleset_versions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'published', 'retired')),
  doc jsonb not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  proposed_by uuid references public.profiles(id) on delete set null, proposed_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null, decided_at timestamptz, decision_note text,
  published_at timestamptz,
  unique (client_id, version)
);
create unique index crm_ruleset_one_open on public.crm_ruleset_versions (client_id) where status in ('draft', 'pending');
create unique index crm_ruleset_one_published on public.crm_ruleset_versions (client_id) where status = 'published';
alter table public.crm_ruleset_versions enable row level security;
create policy crm_rs_read on public.crm_ruleset_versions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_ruleset_versions from authenticated, anon;

create table public.crm_check_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  ruleset_id uuid not null references public.crm_ruleset_versions(id),
  run_by uuid references public.profiles(id) on delete set null default auth.uid(),
  file_name text not null check (length(file_name) between 1 and 255),
  file_hash text,
  rows_checked int not null check (rows_checked >= 0),
  summary jsonb not null,
  created_at timestamptz not null default now()
);
create index crm_check_runs_client_idx on public.crm_check_runs (client_id, created_at desc);
alter table public.crm_check_runs enable row level security;
create policy crm_cr_read on public.crm_check_runs for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_check_runs from authenticated, anon;

-- Shape check only. The rule logic itself is validated by the engine in the app before it is saved.
create or replace function public._crm_ruleset_check(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; v_ids text[] := '{}'; v_id text; v_n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The rule set must be an object'; end if;
  if length(p::text) > 400000 then raise exception 'The rule set is too large'; end if;
  if jsonb_typeof(coalesce(p->'rules', '[]'::jsonb)) <> 'array' then raise exception 'Rules must be a list'; end if;
  v_n := jsonb_array_length(coalesce(p->'rules', '[]'::jsonb));
  if v_n > 200 then raise exception 'A rule set can have at most 200 rules'; end if;
  for r in select * from jsonb_array_elements(coalesce(p->'rules', '[]'::jsonb)) loop
    v_id := r->>'id';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'Every rule needs a short id (letters, digits, underscores)'; end if;
    if v_id = any (v_ids) then raise exception 'Two rules share the id %', v_id; end if;
    v_ids := v_ids || v_id;
    if coalesce(trim(r->>'name'), '') = '' or length(r->>'name') > 120 then raise exception 'Rule % needs a name of up to 120 characters', v_id; end if;
    if r->>'outcome' not in ('issue', 'confirm', 'hold') then raise exception 'Rule % outcome must be issue, confirm or hold', v_id; end if;
    if r->>'kind' not in ('condition', 'expected_value') then raise exception 'Rule % has an unknown kind', v_id; end if;
    if length(coalesce(r->>'comment', '')) = 0 or length(r->>'comment') > 400 then raise exception 'Rule % needs a comment of up to 400 characters', v_id; end if;
  end loop;
  if p ? 'column_map' and jsonb_typeof(p->'column_map') <> 'object' then raise exception 'The column map must be an object'; end if;
  if p ? 'regions' and jsonb_typeof(p->'regions') <> 'array' then raise exception 'Regions must be a list'; end if;
  return p;
end $$;
revoke execute on function public._crm_ruleset_check(jsonb) from public, anon, authenticated;

create or replace function public._crm_ruleset_counts(p jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('rules', jsonb_array_length(coalesce(p->'rules', '[]'::jsonb)),
    'enabled', (select count(*) from jsonb_array_elements(coalesce(p->'rules', '[]'::jsonb)) x where coalesce((x->>'enabled')::boolean, true)),
    'mapped_columns', (select count(*) from jsonb_object_keys(coalesce(p->'column_map', '{}'::jsonb))));
$$;
revoke execute on function public._crm_ruleset_counts(jsonb) from public, anon, authenticated;

-- Draft: any CRM staff member. A reason is required. One open draft per client.
create or replace function public.crm_ruleset_draft_save(p_client uuid, p_doc jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.crm_ruleset_versions; v_next int; v_doc jsonb;
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why (what changed and where the rule comes from)'; end if;
  v_doc := public._crm_ruleset_check(p_doc);
  select * into d from public.crm_ruleset_versions where client_id = p_client and status in ('draft', 'pending') for update;
  if d.status = 'pending' then raise exception 'A change is already waiting for approval. Withdraw it first to edit'; end if;
  if d.id is null then
    select coalesce(max(version), 0) + 1 into v_next from public.crm_ruleset_versions where client_id = p_client;
    insert into public.crm_ruleset_versions (client_id, version, doc, reason) values (p_client, v_next, v_doc, trim(p_reason)) returning * into d;
  else
    update public.crm_ruleset_versions set doc = v_doc, reason = trim(p_reason) where id = d.id;
  end if;
  return d.id;
end $$;

create or replace function public.crm_ruleset_discard(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._crm_require();
  delete from public.crm_ruleset_versions where client_id = p_client and status = 'draft';
end $$;

-- Send the draft for approval. It must differ from the published version.
create or replace function public.crm_ruleset_propose(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.crm_ruleset_versions; p public.crm_ruleset_versions;
begin
  perform public._crm_require();
  select * into d from public.crm_ruleset_versions where id = p_id for update;
  if d.id is null or d.status <> 'draft' then raise exception 'Only a draft can be sent for approval'; end if;
  select * into p from public.crm_ruleset_versions where client_id = d.client_id and status = 'published';
  if p.id is not null and p.doc = d.doc then raise exception 'Nothing has changed from the published rule set'; end if;
  update public.crm_ruleset_versions set status = 'pending', proposed_by = auth.uid(), proposed_at = now() where id = p_id;
  perform public._crm_event(d.client_id, 'ruleset', p_id::text, 'ruleset_proposed', jsonb_build_object('version', d.version, 'reason', d.reason) || public._crm_ruleset_counts(d.doc));
end $$;

create or replace function public.crm_ruleset_withdraw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.crm_ruleset_versions;
begin
  perform public._crm_require();
  select * into d from public.crm_ruleset_versions where id = p_id for update;
  if d.id is null or d.status <> 'pending' then raise exception 'That is not waiting for approval'; end if;
  if d.proposed_by <> auth.uid() and not public.can_govern('crm') then raise exception 'Only the person who proposed it can withdraw it' using errcode = '42501'; end if;
  update public.crm_ruleset_versions set status = 'draft', proposed_by = null, proposed_at = null where id = p_id;
end $$;

-- Approve or reject. Needs someone who governs CRM, and never the person who proposed it.
create or replace function public.crm_ruleset_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.crm_ruleset_versions;
begin
  perform public._crm_require();
  if not public.can_govern('crm') then raise exception 'Only the CRM owners can approve rule changes' using errcode = '42501'; end if;
  select * into d from public.crm_ruleset_versions where id = p_id for update;
  if d.id is null or d.status <> 'pending' then raise exception 'That is not waiting for approval'; end if;
  if d.proposed_by = auth.uid() then raise exception 'A different person must approve what you proposed'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
  if p_approve then
    update public.crm_ruleset_versions set status = 'retired' where client_id = d.client_id and status = 'published';
    update public.crm_ruleset_versions set status = 'published', published_at = now(), decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  else
    update public.crm_ruleset_versions set status = 'draft', proposed_by = null, proposed_at = null, decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
  end if;
  perform public._crm_event(d.client_id, 'ruleset', p_id::text, case when p_approve then 'ruleset_published' else 'ruleset_rejected' end,
    jsonb_build_object('version', d.version, 'note', nullif(trim(coalesce(p_note, '')), '')) || public._crm_ruleset_counts(d.doc));
end $$;

create or replace function public.crm_rulesets(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'doc', v.doc, 'reason', v.reason, 'created_at', v.created_at,
      'created_by', (select full_name from public.profiles where id = v.created_by), 'proposed_by', v.proposed_by, 'proposed_by_name', (select full_name from public.profiles where id = v.proposed_by),
      'proposed_at', v.proposed_at, 'decided_by_name', (select full_name from public.profiles where id = v.decided_by), 'decided_at', v.decided_at, 'decision_note', v.decision_note,
      'published_at', v.published_at) order by v.version desc)
    from public.crm_ruleset_versions v where v.client_id = p_client), '[]'::jsonb);
end $$;

-- Record a finished check run: the summary only, never the uploaded rows.
create or replace function public.crm_check_run_save(p_client uuid, p_ruleset uuid, p_file_name text, p_file_hash text, p_rows int, p_summary jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._crm_require();
  if not exists (select 1 from public.crm_ruleset_versions where id = p_ruleset and client_id = p_client and status = 'published') then
    raise exception 'Checks run on the published rule set of this client';
  end if;
  if length(coalesce(p_summary::text, '')) > 50000 then raise exception 'The summary is too large to keep'; end if;
  insert into public.crm_check_runs (client_id, ruleset_id, file_name, file_hash, rows_checked, summary)
  values (p_client, p_ruleset, left(trim(p_file_name), 255), p_file_hash, greatest(coalesce(p_rows, 0), 0), p_summary) returning id into v_id;
  perform public._crm_event(p_client, 'check_run', v_id::text, 'savings_check_run', jsonb_build_object('file', left(trim(p_file_name), 255), 'rows', p_rows));
  return v_id;
end $$;

create or replace function public.crm_check_runs_list(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'version', v.version, 'file_name', r.file_name, 'rows_checked', r.rows_checked, 'summary', r.summary,
      'run_by', (select full_name from public.profiles where id = r.run_by), 'created_at', r.created_at) order by r.created_at desc)
    from (select * from public.crm_check_runs where client_id = p_client order by created_at desc limit 50) r join public.crm_ruleset_versions v on v.id = r.ruleset_id), '[]'::jsonb);
end $$;

revoke execute on function public.crm_ruleset_draft_save(uuid, jsonb, text), public.crm_ruleset_discard(uuid), public.crm_ruleset_propose(uuid), public.crm_ruleset_withdraw(uuid),
  public.crm_ruleset_decide(uuid, boolean, text), public.crm_rulesets(uuid), public.crm_check_run_save(uuid, uuid, text, text, int, jsonb), public.crm_check_runs_list(uuid) from public, anon;
grant execute on function public.crm_ruleset_draft_save(uuid, jsonb, text), public.crm_ruleset_discard(uuid), public.crm_ruleset_propose(uuid), public.crm_ruleset_withdraw(uuid),
  public.crm_ruleset_decide(uuid, boolean, text), public.crm_rulesets(uuid), public.crm_check_run_save(uuid, uuid, text, text, int, jsonb), public.crm_check_runs_list(uuid) to authenticated;
