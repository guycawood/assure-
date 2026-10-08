-- Assure+ quality: inspections, non-conformance reports (NCRs) and corrective actions.
-- NCR categories come from the Watchtower library 'ncr_categories'.
-- Results, closure and verification are decisions made by staff through functions; the inspector is the signed-in user.
-- Vendors see their own inspections and NCRs (without internal notes), acknowledge or respond to NCRs,
-- and mark their corrective actions done. Only staff verify a corrective action or close an NCR.

create sequence public.quality_inspection_no;
create sequence public.ncr_no;

create table public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  inspection_ref text unique,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  po_reference text,
  product_name text,
  inspection_type text not null default 'final' check (inspection_type in ('incoming_material','in_process','final','pre_shipment','other')),
  inspection_date date not null default current_date,
  inspector uuid references public.profiles(id) on delete set null,
  sample_size int check (sample_size is null or sample_size >= 0),
  defect_count int not null default 0 check (defect_count >= 0),
  defects_found text[] not null default '{}',
  aql_level text,
  -- decision field: set at logging, changed only via assure_set_inspection_result()
  result text not null default 'pending' check (result in ('pass','conditional_pass','fail','pending')),
  corrective_action_required boolean not null default false,
  corrective_action_notes text,
  internal_notes text,
  created_at timestamptz not null default now()
);
create index quality_inspections_supplier_idx on public.quality_inspections (supplier_id, inspection_date desc);
create trigger quality_inspections_region before insert on public.quality_inspections
  for each row execute function public._assure_fill_region_market();

create or replace function public._inspection_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.inspector := auth.uid();
  new.inspection_ref := 'QI-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.quality_inspection_no')::text, 5, '0');
  return new;
end $$;
create trigger quality_inspections_before before insert on public.quality_inspections
  for each row execute function public._inspection_before();

create or replace function public._inspection_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._assure_log(new.supplier_id, 'inspection', new.id, 'logged', null, new.result,
    'Inspection logged: ' || new.inspection_ref, coalesce(new.product_name, new.po_reference));
  return null;
end $$;
create trigger quality_inspections_after after insert on public.quality_inspections
  for each row execute function public._inspection_after();

alter table public.quality_inspections enable row level security;
create policy qi_read on public.quality_inspections for select to authenticated using (public.is_internal());
create policy qi_insert on public.quality_inspections for insert to authenticated with check (public.is_internal());
revoke update, delete on public.quality_inspections from authenticated, anon;

create or replace function public.assure_set_inspection_result(p_id uuid, p_result text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.quality_inspections;
begin
  perform public._assure_require_internal();
  if p_result not in ('pass','conditional_pass','fail','pending') then raise exception 'Unknown result %', p_result; end if;
  select * into q from public.quality_inspections where id = p_id for update;
  if not found then raise exception 'Inspection not found'; end if;
  if q.result = p_result then return; end if;
  if q.result <> 'pending' and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why the result is changing'; end if;
  update public.quality_inspections set result = p_result,
    corrective_action_required = corrective_action_required or p_result = 'fail' where id = p_id;
  perform public._assure_log(q.supplier_id, 'inspection', p_id, 'result_changed', q.result, p_result, 'Inspection result: ' || q.inspection_ref, nullif(trim(p_note), ''));
end $$;

create view public.vendor_quality_inspections as
  select id, inspection_ref, supplier_id, po_reference, product_name, inspection_type, inspection_date, sample_size,
         defect_count, defects_found, aql_level, result, corrective_action_required, corrective_action_notes, created_at
    from public.quality_inspections where supplier_id = public.my_supplier_id();
revoke all on public.vendor_quality_inspections from anon;
grant select on public.vendor_quality_inspections to authenticated;

-- ---------------------------------------------------------------------------
-- NCRs
-- ---------------------------------------------------------------------------
create table public.ncrs (
  id uuid primary key default gen_random_uuid(),
  ncr_ref text unique,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  inspection_id uuid references public.quality_inspections(id) on delete set null,
  category_id uuid not null references public.library_records(id),
  region text,
  market text,
  severity text not null default 'major' check (severity in ('critical','major','minor')),
  title text not null check (length(trim(title)) > 0),
  description text,
  po_reference text,
  -- decision fields
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  acknowledgement_status text not null default 'pending' check (acknowledgement_status in ('pending','acknowledged','responded','disputed')),
  supplier_response text,
  root_cause text,
  acknowledged_at timestamptz,
  responded_at timestamptz,
  due_date date,
  raised_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  close_note text,
  internal_notes text,
  created_at timestamptz not null default now()
);
create index ncrs_supplier_idx on public.ncrs (supplier_id, created_at desc);
create index ncrs_open_idx on public.ncrs (status) where status = 'open';
create trigger ncrs_region before insert on public.ncrs for each row execute function public._assure_fill_region_market();

create or replace function public._ncr_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.library_records where id = new.category_id and library_key = 'ncr_categories') then
    raise exception 'Choose a category from the non-conformance categories library';
  end if;
  new.raised_by := auth.uid();
  new.ncr_ref := 'NCR-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.ncr_no')::text, 5, '0');
  new.status := 'open'; new.acknowledgement_status := 'pending';
  new.supplier_response := null; new.root_cause := null; new.acknowledged_at := null; new.responded_at := null;
  new.closed_by := null; new.closed_at := null; new.close_note := null;
  if new.due_date is null then new.due_date := current_date + case new.severity when 'critical' then 7 when 'major' then 14 else 30 end; end if;
  return new;
end $$;
create trigger ncrs_before before insert on public.ncrs for each row execute function public._ncr_before();

create or replace function public._ncr_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.library_refs (record_id, ref_table, ref_id) values (new.category_id, 'ncrs', new.id::text) on conflict do nothing;
  perform public._assure_log(new.supplier_id, 'ncr', new.id, 'raised', null, 'open', 'NCR raised: ' || new.ncr_ref, new.title);
  return null;
end $$;
create trigger ncrs_after after insert on public.ncrs for each row execute function public._ncr_after();

alter table public.ncrs enable row level security;
create policy ncr_read on public.ncrs for select to authenticated using (public.is_internal());
create policy ncr_insert on public.ncrs for insert to authenticated with check (public.is_internal());
revoke update, delete on public.ncrs from authenticated, anon;

create view public.vendor_ncrs as
  select n.id, n.ncr_ref, n.supplier_id, n.inspection_id, lr.name as category_name, n.severity, n.title, n.description, n.po_reference,
         n.status, n.acknowledgement_status, n.supplier_response, n.root_cause, n.acknowledged_at, n.responded_at, n.due_date,
         n.closed_at, n.close_note, n.created_at
    from public.ncrs n join public.library_records lr on lr.id = n.category_id
   where n.supplier_id = public.my_supplier_id();
revoke all on public.vendor_ncrs from anon;
grant select on public.vendor_ncrs to authenticated;

-- Vendor: acknowledge, respond (root cause + response) or dispute their own NCR.
create or replace function public.assure_ncr_vendor_respond(p_id uuid, p_action text, p_response text, p_root_cause text)
returns void language plpgsql security definer set search_path = public as $$
declare n public.ncrs; v_to text;
begin
  select * into n from public.ncrs where id = p_id for update;
  if not found or public.my_supplier_id() is null or n.supplier_id <> public.my_supplier_id() or public.is_internal() then
    raise exception 'This NCR is not for your company' using errcode = '42501';
  end if;
  if n.status <> 'open' then raise exception 'This NCR is closed'; end if;
  if p_action = 'acknowledge' then
    if n.acknowledgement_status <> 'pending' then raise exception 'Already acknowledged'; end if;
    v_to := 'acknowledged';
  elsif p_action in ('respond','dispute') then
    if nullif(trim(coalesce(p_response, '')), '') is null then raise exception 'Write your response first'; end if;
    v_to := case when p_action = 'respond' then 'responded' else 'disputed' end;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  update public.ncrs set acknowledgement_status = v_to,
    acknowledged_at = coalesce(acknowledged_at, now()),
    responded_at = case when p_action <> 'acknowledge' then now() else responded_at end,
    supplier_response = coalesce(nullif(trim(p_response), ''), supplier_response),
    root_cause = coalesce(nullif(trim(p_root_cause), ''), root_cause)
   where id = p_id;
  perform public._assure_log(n.supplier_id, 'ncr', p_id, 'vendor_' || p_action, n.acknowledgement_status, v_to, n.ncr_ref || ': vendor ' || p_action, nullif(trim(p_response), ''));
end $$;

-- Staff: close (all corrective actions verified) or cancel an NCR; update internal notes.
create or replace function public.assure_ncr_close(p_id uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare n public.ncrs;
begin
  perform public._assure_require_internal();
  if p_outcome not in ('closed','cancelled') then raise exception 'Choose close or cancel'; end if;
  select * into n from public.ncrs where id = p_id for update;
  if not found then raise exception 'NCR not found'; end if;
  if n.status <> 'open' then raise exception 'This NCR is already %', n.status; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Record why the NCR is being %', p_outcome; end if;
  if p_outcome = 'closed' and exists (select 1 from public.ncr_corrective_actions where ncr_id = p_id and status <> 'verified') then
    raise exception 'Verify every corrective action before closing the NCR';
  end if;
  update public.ncrs set status = p_outcome, closed_by = auth.uid(), closed_at = now(), close_note = trim(p_note) where id = p_id;
  perform public._assure_log(n.supplier_id, 'ncr', p_id, p_outcome, 'open', p_outcome, n.ncr_ref || ' ' || p_outcome, trim(p_note));
end $$;

create or replace function public.assure_ncr_set_notes(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  update public.ncrs set internal_notes = p_notes where id = p_id;
  if not found then raise exception 'NCR not found'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Corrective actions
-- ---------------------------------------------------------------------------
create table public.ncr_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references public.ncrs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  owner_side text not null default 'supplier' check (owner_side in ('supplier','internal')),
  due_date date,
  status text not null default 'open' check (status in ('open','done','verified')),
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  done_note text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index nca_ncr_idx on public.ncr_corrective_actions (ncr_id);

alter table public.ncr_corrective_actions enable row level security;
create policy nca_read on public.ncr_corrective_actions for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.ncr_corrective_actions from authenticated, anon;

create or replace function public.assure_ca_add(p_ncr uuid, p_description text, p_owner text, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare n public.ncrs; v_id uuid;
begin
  perform public._assure_require_internal();
  select * into n from public.ncrs where id = p_ncr;
  if not found then raise exception 'NCR not found'; end if;
  if n.status <> 'open' then raise exception 'This NCR is closed'; end if;
  insert into public.ncr_corrective_actions (ncr_id, supplier_id, description, owner_side, due_date, created_by)
  values (p_ncr, n.supplier_id, trim(p_description), coalesce(p_owner, 'supplier'), p_due, auth.uid()) returning id into v_id;
  perform public._assure_log(n.supplier_id, 'ncr', p_ncr, 'corrective_action_added', null, 'open', n.ncr_ref || ': corrective action added', trim(p_description));
  return v_id;
end $$;

-- Mark done: the vendor for supplier-owned actions, staff for internal ones. Verify: staff only, not whoever marked it done.
create or replace function public.assure_ca_set_status(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.ncr_corrective_actions; v_internal boolean := public.is_internal();
begin
  select * into a from public.ncr_corrective_actions where id = p_id for update;
  if not found then raise exception 'Corrective action not found'; end if;
  if not v_internal and (public.my_supplier_id() is null or a.supplier_id <> public.my_supplier_id()) then
    raise exception 'This corrective action is not for your company' using errcode = '42501';
  end if;
  if p_status = 'done' then
    if a.status <> 'open' then raise exception 'Only an open action can be marked done'; end if;
    if not v_internal and a.owner_side <> 'supplier' then raise exception 'adm Indicia completes this action' using errcode = '42501'; end if;
    update public.ncr_corrective_actions set status = 'done', done_by = auth.uid(), done_at = now(), done_note = nullif(trim(p_note), '') where id = p_id;
  elsif p_status = 'verified' then
    if not v_internal then raise exception 'Only adm Indicia staff can verify a corrective action' using errcode = '42501'; end if;
    if a.status <> 'done' then raise exception 'Only a completed action can be verified'; end if;
    if a.done_by = auth.uid() then raise exception 'You completed this action, so someone else must verify it' using errcode = '42501'; end if;
    update public.ncr_corrective_actions set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
  elsif p_status = 'open' then
    if not v_internal then raise exception 'Only adm Indicia staff can reopen an action' using errcode = '42501'; end if;
    if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why the action is being reopened'; end if;
    update public.ncr_corrective_actions set status = 'open', done_by = null, done_at = null, verified_by = null, verified_at = null where id = p_id;
  else
    raise exception 'Unknown status %', p_status;
  end if;
  perform public._assure_log(a.supplier_id, 'ncr', a.ncr_id, 'corrective_action_' || p_status, a.status, p_status, 'Corrective action ' || p_status, nullif(trim(p_note), ''));
end $$;

revoke execute on function public._inspection_before(), public._inspection_after(), public._ncr_before(), public._ncr_after() from public, anon, authenticated;
grant execute on function public.assure_set_inspection_result(uuid, text, text), public.assure_ncr_vendor_respond(uuid, text, text, text),
  public.assure_ncr_close(uuid, text, text), public.assure_ncr_set_notes(uuid, text), public.assure_ca_add(uuid, text, text, date),
  public.assure_ca_set_status(uuid, text, text) to authenticated;
