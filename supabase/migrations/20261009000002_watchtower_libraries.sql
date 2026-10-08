-- Watchtower governed libraries, change requests and audit: one framework used by every module's Watchtower.
-- Mechanics follow the Base44 Watchtower (list / filter / create / edit / supersede / deactivate-or-delete with usage guard /
-- history / aliases / CSV import-export / change requests reviewed against core principles), with its gaps closed:
--   * audit is written in the same transaction by these functions and the audit table is append-only;
--   * supersede is one atomic function; superseded versions still answer historical (effective-date) lookups;
--   * optional maker-checker per library (a different person approves);
--   * change requests can link to the library record they are about;
--   * review rules (time spent, every relevant principle checked, legal status transitions) are enforced server-side.

-- Module owners can govern their module's libraries; admins can govern everything.
create table public.module_owners (
  module text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (module, user_id)
);
alter table public.module_owners enable row level security;
create policy mo_read on public.module_owners for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.module_owners from authenticated, anon;

create or replace function public.can_govern(p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.module_owners where module = p_module and user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
create table public.library_definitions (
  key text primary key,
  module text not null,
  label text not null,
  description text,
  requires_approval boolean not null default false,
  sort int not null default 0
);

create table public.library_records (
  id uuid primary key default gen_random_uuid(),
  library_key text not null references public.library_definitions(key),
  code text,
  name text not null check (length(trim(name)) > 0),
  data jsonb not null default '{}'::jsonb,
  version int not null default 1,
  status text not null check (status in ('pending_approval','active','superseded','retired','rejected')),
  effective_from date not null default current_date,
  effective_to date,
  supersedes uuid references public.library_records(id),
  superseded_by uuid references public.library_records(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  check (effective_to is null or effective_to >= effective_from)
);
create index library_records_key_idx on public.library_records (library_key, status);
create unique index library_records_code_version on public.library_records (library_key, code, version) where code is not null;

create table public.library_aliases (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.library_records(id) on delete cascade,
  alias text not null,
  source_system text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (record_id, alias)
);

-- Where a library record is used (the usage guard). Consumers insert rows here when they reference a record.
create table public.library_refs (
  record_id uuid not null references public.library_records(id) on delete restrict,
  ref_table text not null,
  ref_id text not null,
  ref_label text,
  primary key (record_id, ref_table, ref_id)
);

-- Append-only audit for libraries (and change requests, below).
create table public.library_audit (
  id bigint generated always as identity primary key,
  module text not null,
  library_key text,
  record_id uuid,
  record_name text,
  action text not null check (action in ('create','update','supersede','approve','reject','retire','reactivate','delete','import','alias_add','alias_toggle')),
  changes jsonb not null default '[]'::jsonb,
  note text,
  actor uuid references public.profiles(id),
  at timestamptz not null default now()
);
create index library_audit_record_idx on public.library_audit (record_id, at desc);
create index library_audit_module_idx on public.library_audit (module, at desc);

alter table public.library_definitions enable row level security;
alter table public.library_records enable row level security;
alter table public.library_aliases enable row level security;
alter table public.library_refs enable row level security;
alter table public.library_audit enable row level security;
create policy ld_read on public.library_definitions for select to authenticated using (public.is_internal());
create policy lr_read on public.library_records for select to authenticated using (public.is_internal());
create policy la_read on public.library_aliases for select to authenticated using (public.is_internal());
create policy lref_read on public.library_refs for select to authenticated using (public.is_internal());
create policy laud_read on public.library_audit for select to authenticated using (public.is_internal());
-- All writes go through the functions below (security definer), never directly.
revoke insert, update, delete on public.library_definitions, public.library_records, public.library_aliases,
  public.library_refs, public.library_audit from authenticated, anon;

-- Field-level diff of name + data (+ effective dates) between two versions.
create or replace function public._library_diff(o public.library_records, n_name text, n_data jsonb, n_from date, n_to date)
returns jsonb language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; k text;
begin
  if o.name is distinct from n_name then out := out || jsonb_build_object('field','name','before',o.name,'after',n_name); end if;
  if o.effective_from is distinct from n_from then out := out || jsonb_build_object('field','effective_from','before',o.effective_from,'after',n_from); end if;
  if o.effective_to is distinct from n_to then out := out || jsonb_build_object('field','effective_to','before',o.effective_to,'after',n_to); end if;
  for k in select distinct x from (select jsonb_object_keys(o.data) x union select jsonb_object_keys(coalesce(n_data,'{}'::jsonb))) s loop
    if nullif(o.data->>k, '') is distinct from nullif(n_data->>k, '') and (o.data->k) is distinct from (n_data->k) then
      out := out || jsonb_build_object('field', k, 'before', o.data->k, 'after', n_data->k);
    end if;
  end loop;
  return out;
end $$;

create or replace function public._library_def(p_key text) returns public.library_definitions
language plpgsql stable security definer set search_path = public as $$
declare d public.library_definitions;
begin
  select * into d from public.library_definitions where key = p_key;
  if d.key is null then raise exception 'Unknown library %', p_key; end if;
  if not public.can_govern(d.module) then raise exception 'Only admins and % owners can change this library', d.module using errcode = '42501'; end if;
  return d;
end $$;

create or replace function public._library_audit(d public.library_definitions, r public.library_records, p_action text, p_changes jsonb, p_note text)
returns void language sql security definer set search_path = public as $$
  insert into public.library_audit (module, library_key, record_id, record_name, action, changes, note, actor)
  values (d.module, d.key, r.id, r.name, p_action, coalesce(p_changes, '[]'::jsonb), p_note, auth.uid());
$$;

create or replace function public.library_create(p_key text, p_code text, p_name text, p_data jsonb, p_effective_from date, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.library_definitions := public._library_def(p_key); r public.library_records;
begin
  if p_code is not null and exists (select 1 from public.library_records where library_key = p_key and code = p_code and status in ('active','pending_approval')) then
    raise exception 'Code % is already in use in this library', p_code;
  end if;
  insert into public.library_records (library_key, code, name, data, status, effective_from, notes, created_by, updated_by)
  values (p_key, nullif(trim(p_code), ''), trim(p_name), coalesce(p_data, '{}'::jsonb),
          case when d.requires_approval then 'pending_approval' else 'active' end,
          coalesce(p_effective_from, current_date), p_notes, auth.uid(), auth.uid())
  returning * into r;
  perform public._library_audit(d, r, 'create', '[]'::jsonb, p_notes);
  return r.id;
end $$;

-- In-place correction (typos, clarifications). A genuine change of value should be a supersede; a reason is required.
create or replace function public.library_update(p_id uuid, p_name text, p_data jsonb, p_notes text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions; ch jsonb;
begin
  select * into r from public.library_records where id = p_id for update;
  if r.id is null then raise exception 'Record not found'; end if;
  d := public._library_def(r.library_key);
  if r.status not in ('active','pending_approval') then raise exception 'Only current records can be edited; superseded and retired versions are kept as history'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the correction'; end if;
  ch := public._library_diff(r, trim(p_name), coalesce(p_data, '{}'::jsonb), r.effective_from, r.effective_to);
  if jsonb_array_length(ch) = 0 and p_notes is not distinct from r.notes then return; end if;
  update public.library_records set name = trim(p_name), data = coalesce(p_data, '{}'::jsonb), notes = p_notes,
    updated_by = auth.uid(), updated_at = now() where id = p_id returning * into r;
  perform public._library_audit(d, r, 'update', ch, p_reason);
end $$;

-- New version from a date: the old version ends the day before and stays queryable for history. One transaction.
create or replace function public.library_supersede(p_id uuid, p_name text, p_data jsonb, p_effective_from date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.library_records; n public.library_records; d public.library_definitions; v_from date := coalesce(p_effective_from, current_date);
begin
  select * into o from public.library_records where id = p_id for update;
  if o.id is null then raise exception 'Record not found'; end if;
  d := public._library_def(o.library_key);
  if o.status <> 'active' then raise exception 'Only the active version can be superseded'; end if;
  if v_from <= o.effective_from then raise exception 'The new version must start after %', o.effective_from; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what changed and why'; end if;
  insert into public.library_records (library_key, code, name, data, version, status, effective_from, supersedes, notes, created_by, updated_by)
  values (o.library_key, o.code, trim(p_name), coalesce(p_data, '{}'::jsonb), o.version + 1,
          case when d.requires_approval then 'pending_approval' else 'active' end, v_from, o.id, o.notes, auth.uid(), auth.uid())
  returning * into n;
  if not d.requires_approval then
    update public.library_records set status = 'superseded', effective_to = v_from - 1, superseded_by = n.id, updated_by = auth.uid(), updated_at = now() where id = o.id;
  end if;
  perform public._library_audit(d, o, 'supersede', public._library_diff(o, n.name, n.data, n.effective_from, n.effective_to), p_note);
  return n.id;
end $$;

-- Maker-checker: someone other than the author approves (admins may approve their own only if they are the only governor).
create or replace function public.library_approve(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions; o public.library_records;
begin
  select * into r from public.library_records where id = p_id for update;
  if r.id is null or r.status <> 'pending_approval' then raise exception 'Nothing to approve'; end if;
  d := public._library_def(r.library_key);
  if r.created_by = auth.uid() then raise exception 'A different person must approve this change'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
    update public.library_records set status = 'rejected', updated_by = auth.uid(), updated_at = now() where id = p_id;
    perform public._library_audit(d, r, 'reject', '[]'::jsonb, p_note);
    return;
  end if;
  if r.supersedes is not null then
    select * into o from public.library_records where id = r.supersedes for update;
    update public.library_records set status = 'superseded', effective_to = greatest(o.effective_from, r.effective_from - 1), superseded_by = r.id where id = o.id;
  end if;
  update public.library_records set status = 'active', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public._library_audit(d, r, 'approve', '[]'::jsonb, p_note);
end $$;

-- Deactivate: always allowed (references keep working). Delete: only when unused and never superseded.
create or replace function public.library_retire(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions;
begin
  select * into r from public.library_records where id = p_id for update;
  if r.id is null or r.status <> 'active' then raise exception 'Only an active record can be deactivated'; end if;
  d := public._library_def(r.library_key);
  update public.library_records set status = 'retired', effective_to = coalesce(effective_to, greatest(effective_from, current_date)), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._library_audit(d, r, 'retire', jsonb_build_array(jsonb_build_object('field','status','before','active','after','retired')), p_note);
end $$;

create or replace function public.library_reactivate(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions;
begin
  select * into r from public.library_records where id = p_id for update;
  if r.id is null or r.status <> 'retired' then raise exception 'Only a deactivated record can be reactivated'; end if;
  d := public._library_def(r.library_key);
  if r.superseded_by is not null then raise exception 'This version was superseded; reactivate the latest version instead'; end if;
  update public.library_records set status = 'active', effective_to = null, updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._library_audit(d, r, 'reactivate', jsonb_build_array(jsonb_build_object('field','status','before','retired','after','active')), p_note);
end $$;

create or replace function public.library_delete(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions;
begin
  select * into r from public.library_records where id = p_id for update;
  if r.id is null then raise exception 'Record not found'; end if;
  d := public._library_def(r.library_key);
  if exists (select 1 from public.library_refs where record_id = p_id) then raise exception 'In use: deactivate it instead'; end if;
  if r.supersedes is not null or r.superseded_by is not null then raise exception 'Part of a version history: deactivate it instead'; end if;
  perform public._library_audit(d, r, 'delete', '[]'::jsonb, p_note);
  delete from public.library_aliases where record_id = p_id;
  delete from public.library_records where id = p_id;
end $$;

-- All-or-nothing import. p_rows: [{code, name, data, effective_from}]. Validation of field types happens in the app first.
create or replace function public.library_import(p_key text, p_rows jsonb, p_note text)
returns int language plpgsql security definer set search_path = public as $$
declare d public.library_definitions := public._library_def(p_key); x jsonb; r public.library_records; n int := 0;
begin
  for x in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(x->>'name'), '') = '' then raise exception 'Row %: name is required', n + 1; end if;
    if nullif(trim(x->>'code'), '') is not null and exists (select 1 from public.library_records where library_key = p_key and code = trim(x->>'code') and status in ('active','pending_approval')) then
      raise exception 'Row %: code % already exists', n + 1, x->>'code';
    end if;
    insert into public.library_records (library_key, code, name, data, status, effective_from, created_by, updated_by)
    values (p_key, nullif(trim(x->>'code'), ''), trim(x->>'name'), coalesce(x->'data', '{}'::jsonb),
            case when d.requires_approval then 'pending_approval' else 'active' end,
            coalesce((x->>'effective_from')::date, current_date), auth.uid(), auth.uid())
    returning * into r;
    perform public._library_audit(d, r, 'import', '[]'::jsonb, p_note);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.library_alias_add(p_record uuid, p_alias text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.library_records; d public.library_definitions;
begin
  select * into r from public.library_records where id = p_record;
  if r.id is null then raise exception 'Record not found'; end if;
  d := public._library_def(r.library_key);
  insert into public.library_aliases (record_id, alias, source_system, created_by) values (p_record, trim(p_alias), nullif(trim(p_source), ''), auth.uid());
  perform public._library_audit(d, r, 'alias_add', jsonb_build_array(jsonb_build_object('field','alias','before',null,'after',trim(p_alias))), p_source);
end $$;

create or replace function public.library_alias_toggle(p_alias uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.library_aliases; r public.library_records; d public.library_definitions;
begin
  select * into a from public.library_aliases where id = p_alias for update;
  if a.id is null then raise exception 'Alias not found'; end if;
  select * into r from public.library_records where id = a.record_id;
  d := public._library_def(r.library_key);
  update public.library_aliases set active = not active where id = p_alias;
  perform public._library_audit(d, r, 'alias_toggle', jsonb_build_array(jsonb_build_object('field', a.alias, 'before', a.active, 'after', not a.active)), null);
end $$;

-- Which version applied on a date (includes superseded versions, so history is reproducible).
create or replace function public.library_effective(p_key text, p_code text, p_date date)
returns public.library_records language sql stable security definer set search_path = public as $$
  select * from public.library_records
  where library_key = p_key and code = p_code and status in ('active','superseded')
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by version desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Change requests ("Suggest a change"), reviewed against the core principles
-- ---------------------------------------------------------------------------
create sequence public.change_request_no;
create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  request_no int not null default nextval('public.change_request_no') unique,
  module text not null,
  source_area text,
  library_key text references public.library_definitions(key),
  record_id uuid references public.library_records(id),
  request_text text not null check (length(trim(request_text)) > 0),
  category text check (category in ('data_integrity','access_control','provenance','governance_ownership','user_experience')),
  impact_level text check (impact_level in ('high','medium','low')),
  status text not null default 'logged' check (status in ('logged','under_review','needs_clarification','approved','rejected','implemented_pending_verification','verified_complete')),
  requested_by uuid references public.profiles(id),
  requester_type text not null default 'internal' check (requester_type in ('internal','vendor','client')),
  requested_at timestamptz not null default now(),
  review_started_at timestamptz,
  review_notes text,
  principles_checked uuid[] not null default '{}',
  conflicts_with_principle boolean not null default false,
  conflicting_principle_ids uuid[] not null default '{}',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_duration_seconds int,
  implementation_notes text,
  implemented_by uuid references public.profiles(id),
  implemented_at timestamptz,
  implementation_check_notes text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz
);
create table public.change_request_events (
  id bigint generated always as identity primary key,
  change_request_id uuid not null references public.change_requests(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  actor uuid references public.profiles(id),
  at timestamptz not null default now()
);
alter table public.change_requests enable row level security;
alter table public.change_request_events enable row level security;
create policy cr_read on public.change_requests for select to authenticated using (public.is_internal() or requested_by = auth.uid());
create policy cre_read on public.change_request_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.change_requests, public.change_request_events from authenticated, anon;

create or replace function public.cr_submit(p_module text, p_source_area text, p_text text, p_category text, p_library text, p_record uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  if auth.uid() is null then raise exception 'Sign in to suggest a change' using errcode = '42501'; end if;
  select case when public.is_internal() then 'internal' when user_type = 'vendor' then 'vendor' else 'client' end into v_type from public.profiles where id = auth.uid();
  insert into public.change_requests (module, source_area, request_text, category, library_key, record_id, requested_by, requester_type)
  values (p_module, p_source_area, trim(p_text), nullif(p_category, ''), nullif(p_library, ''), p_record, auth.uid(), coalesce(v_type, 'internal'))
  returning id into v_id;
  insert into public.change_request_events (change_request_id, to_status, actor) values (v_id, 'logged', auth.uid());
  return v_id;
end $$;

-- Opening the review starts the clock used by the minimum-review-time rule.
create or replace function public.cr_start_review(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.change_requests;
begin
  select * into c from public.change_requests where id = p_id for update;
  if c.id is null then raise exception 'Not found'; end if;
  if not public.can_govern(c.module) then raise exception 'Only admins and module owners review change requests' using errcode = '42501'; end if;
  if c.status in ('logged','needs_clarification','under_review') then
    update public.change_requests set review_started_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.cr_review(p_id uuid, p_status text, p_category text, p_impact text, p_notes text,
  p_principles_checked uuid[], p_conflicts boolean, p_conflicting uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare c public.change_requests; v_required uuid[]; v_secs int;
begin
  select * into c from public.change_requests where id = p_id for update;
  if c.id is null then raise exception 'Not found'; end if;
  if not public.can_govern(c.module) then raise exception 'Only admins and module owners review change requests' using errcode = '42501'; end if;
  if c.status not in ('logged','under_review','needs_clarification') then raise exception 'This request is already %', c.status; end if;
  if p_status not in ('under_review','approved','rejected','needs_clarification') then raise exception 'Invalid review outcome'; end if;
  if p_category is null then raise exception 'Choose a category'; end if;
  v_secs := extract(epoch from (now() - coalesce(c.review_started_at, now())))::int;
  if p_status = 'approved' then
    select coalesce(array_agg(id), '{}') into v_required from public.library_records
      where library_key = 'core_principles' and status = 'active' and data->>'category' = p_category;
    if not (v_required <@ coalesce(p_principles_checked, '{}')) then raise exception 'Check every principle in this category before approving'; end if;
    if v_secs < 20 then raise exception 'Take at least 20 seconds to review the principles before approving'; end if;
  end if;
  update public.change_requests set status = p_status, category = p_category, impact_level = p_impact, review_notes = p_notes,
    principles_checked = coalesce(p_principles_checked, '{}'), conflicts_with_principle = coalesce(p_conflicts, false),
    conflicting_principle_ids = case when coalesce(p_conflicts, false) then coalesce(p_conflicting, '{}') else '{}' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_duration_seconds = case when p_status = 'approved' then v_secs else review_duration_seconds end
  where id = p_id;
  insert into public.change_request_events (change_request_id, from_status, to_status, note, actor) values (p_id, c.status, p_status, p_notes, auth.uid());
end $$;

create or replace function public.cr_mark_implemented(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.change_requests;
begin
  select * into c from public.change_requests where id = p_id for update;
  if c.id is null or c.status <> 'approved' then raise exception 'Only an approved request can be marked implemented'; end if;
  if not public.can_govern(c.module) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.change_requests set status = 'implemented_pending_verification', implementation_notes = p_notes, implemented_by = auth.uid(), implemented_at = now() where id = p_id;
  insert into public.change_request_events (change_request_id, from_status, to_status, note, actor) values (p_id, c.status, 'implemented_pending_verification', p_notes, auth.uid());
end $$;

create or replace function public.cr_verify(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.change_requests;
begin
  select * into c from public.change_requests where id = p_id for update;
  if c.id is null or c.status <> 'implemented_pending_verification' then raise exception 'Only an implemented request can be verified'; end if;
  if not public.can_govern(c.module) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Record what you checked'; end if;
  if c.implemented_by = auth.uid() then raise exception 'A different person must verify the implementation'; end if;
  update public.change_requests set status = 'verified_complete', implementation_check_notes = p_notes, verified_by = auth.uid(), verified_at = now() where id = p_id;
  insert into public.change_request_events (change_request_id, from_status, to_status, note, actor) values (p_id, c.status, 'verified_complete', p_notes, auth.uid());
end $$;

revoke execute on function public._library_def(text), public._library_audit(public.library_definitions, public.library_records, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.library_create(text, text, text, jsonb, date, text), public.library_update(uuid, text, jsonb, text, text),
  public.library_supersede(uuid, text, jsonb, date, text), public.library_approve(uuid, boolean, text), public.library_retire(uuid, text),
  public.library_reactivate(uuid, text), public.library_delete(uuid, text), public.library_import(text, jsonb, text),
  public.library_alias_add(uuid, text, text), public.library_alias_toggle(uuid), public.library_effective(text, text, date),
  public.cr_submit(text, text, text, text, text, uuid), public.cr_start_review(uuid),
  public.cr_review(uuid, text, text, text, text, uuid[], boolean, uuid[]), public.cr_mark_implemented(uuid, text), public.cr_verify(uuid, text),
  public.can_govern(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Library catalogue per module (the records themselves are seeded separately)
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('core_principles', 'watchtower', 'Core principles', 'The principles every change request is reviewed against.', true, 1),
  ('doa_levels', 'watchtower', 'Delegation of authority', 'Approval levels, ceilings and the roles that hold them.', true, 2),
  ('substrates', 'watchtower', 'Substrates', 'Materials specs are made from, with measurement basis and linked emission factors.', false, 3),
  ('material_emission_factors', 'watchtower', 'Material emission factors', 'kgCO2e per kg of raw material. Raw material production only; not a product carbon footprint.', false, 4),
  ('transport_emission_factors', 'watchtower', 'Transport emission factors', 'gCO2e per tonne-km by transport mode, used for delivery emissions.', false, 5),
  ('impact_grade_dimensions', 'watchtower', 'Impact Grade dimensions', 'The dimensions and weights of the Impact Grade methodology. Active weights must total 100%.', true, 6),
  ('certification_types', 'assure', 'Certification types', 'Certificates vendors can hold, how long they last and what they evidence.', false, 1),
  ('order_document_types', 'assure', 'Control document types', 'Documents vendors upload against orders, and which categories require them.', false, 2),
  ('ncr_categories', 'assure', 'Non-conformance categories', 'How quality issues are classified and how severe they are.', false, 3),
  ('sourcing_control_matrix', 'sourcing', 'Sourcing control matrix', 'Minimum sourcing standards by job value: suppliers to invite, strategy owner, price validation.', true, 1),
  ('bypass_reasons', 'sourcing', 'RFQ bypass reasons', 'Accepted reasons for awarding without a competitive RFQ.', false, 2),
  ('carriers', 'logistics', 'Carriers', 'Approved carriers by mode and region.', false, 1),
  ('pod_checklist', 'logistics', 'POD checklist', 'The points a proof of delivery must show before it is verified.', true, 2),
  ('display_scoring', 'execution', 'Display scoring criteria', 'How in-store executions are scored in audits.', true, 1),
  ('touchpoint_types', 'shopper-iq', 'Touchpoint types', 'The POSM touchpoint taxonomy used on specs.', false, 1),
  ('p2p_stages', 'shopper-iq', 'Path-to-purchase stages', 'Stages used to classify campaigns and specs.', false, 2),
  ('brief_fields', 'briefing', 'Brief field library', 'Fields a brief can capture and whether they drive price, quality or compliance.', false, 1);
