-- Approval gaps (1 of 3): the shared request -> approve machinery and helpers every module's new approval steps use.
--   * approval_requests: one row per "this needs a second person" request (scorecard activation, access changes, bypass
--     awards, fast-track, contract approval, ...). Who may decide comes from approval_policy_for() at request time
--     (approver_role, maker_checker, DOA level by value); the default role applies when no policy exists.
--   * approval_request_decide(): maker-checker (never the requester, nor anyone in excluded_users), the policy role, then
--     the approved action is applied in the same transaction. run_as says whose rights apply the action:
--       'approver'  the approver performs it (e.g. a sourcing lead applies a triage override),
--       'requester' it runs with the requester's identity (they held the right to do it; the second person confirms),
--       'none'      approval only unlocks the next step (e.g. a contract may now be sent).
--     The gated public function recognises an approved request by its status 'applying', so nothing can skip the gate.
--   * approval_request_events and approval_decisions: append-only audit of requests and of direct decisions.
--   * approval roles gain quality, logistics_lead and line_manager (mapped onto existing roles until a people directory exists).
--   * _market_code / _market_name normalise market codes or names to the market master (DE / Germany -> DE, Germany).

-- ---------------------------------------------------------------------------
-- Market master helpers
-- ---------------------------------------------------------------------------
create or replace function public._market_code(p text) returns text
language sql stable security definer set search_path = public as $$
  select case when nullif(trim(p), '') is null then null else coalesce(
    (select m.code from public.markets m where m.code = upper(trim(p))),
    (select m.code from public.markets m where lower(m.name) = lower(trim(p)) order by m.code limit 1),
    (case upper(trim(p)) when 'UK' then 'GB' when 'ENGLAND' then 'GB' when 'GREAT BRITAIN' then 'GB' when 'USA' then 'US' end),
    upper(trim(p))) end;
$$;
create or replace function public._market_name(p text) returns text
language sql stable security definer set search_path = public as $$
  select case when nullif(trim(p), '') is null then null
    else coalesce((select m.name from public.markets m where m.code = public._market_code(p)), trim(p)) end;
$$;
grant execute on function public._market_code(text), public._market_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Approval roles: three more names, mapped onto roles that exist today
-- ---------------------------------------------------------------------------
create or replace function public.approval_user_has_role(p_user uuid, p_role text, p_module text default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; a public.sourcing_user_access;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or not (p.is_admin or p.user_type = 'internal') then return false; end if;
  select * into a from public.sourcing_user_access where user_id = p_user;
  return case coalesce(p_role, 'internal')
    when 'internal' then true
    when 'named_person' then true                       -- the function checks the named person itself
    when 'admin' then p.is_admin
    when 'srt_agent' then p.is_admin or coalesce(p.srt_role, '') in ('agent','lead')
    when 'srt_lead' then p.is_admin or p.srt_role = 'lead'
    when 'finance' then p.is_admin or p.srt_role = 'finance' or coalesce(a.is_finance, false)
    when 'procurement' then p.is_admin or coalesce(p.srt_role, '') in ('procurement','head')
    when 'procurement_head' then p.is_admin or p.srt_role = 'head'
    when 'sourcing_lead' then p.is_admin or coalesce(a.is_lead, false)
    when 'doa' then a.doa_level is not null              -- delegated authority is never implied by admin
    when 'module_owner' then p.is_admin or exists (select 1 from public.module_owners mo where mo.user_id = p_user and (p_module is null or mo.module = p_module))
    when 'briefing_lead' then p.is_admin or coalesce(a.is_lead, false) or coalesce(p.srt_role, '') in ('lead','head')
                              or exists (select 1 from public.module_owners mo where mo.user_id = p_user and mo.module = 'briefing')
    -- Quality: SRT lead, Procurement head, sourcing lead, or an owner of Assure+ / Execution+.
    when 'quality' then p.is_admin or coalesce(p.srt_role, '') in ('lead','head') or coalesce(a.is_lead, false)
                        or exists (select 1 from public.module_owners mo where mo.user_id = p_user and mo.module in ('assure','execution'))
    -- Logistics lead: sourcing lead or a Logistics+ owner.
    when 'logistics_lead' then p.is_admin or coalesce(a.is_lead, false)
                               or exists (select 1 from public.module_owners mo where mo.user_id = p_user and mo.module = 'logistics')
    -- Line manager: SRT lead, Procurement head or sourcing lead.
    when 'line_manager' then p.is_admin or coalesce(p.srt_role, '') in ('lead','head') or coalesce(a.is_lead, false)
    else false                                           -- client_approver / vendor are external roles
  end;
end $$;

create or replace function public.approval_role_label(p_role text) returns text
language sql immutable as $$
  select case p_role
    when 'admin' then 'Admin' when 'internal' then 'Anyone at adm Indicia' when 'named_person' then 'The named person'
    when 'srt_agent' then 'SRT agent or lead' when 'srt_lead' then 'SRT lead' when 'finance' then 'Finance'
    when 'procurement' then 'Procurement or Procurement head' when 'procurement_head' then 'Procurement head'
    when 'sourcing_lead' then 'Sourcing lead' when 'doa' then 'Delegated authority (DOA level)' when 'module_owner' then 'Admin or module owner'
    when 'briefing_lead' then 'Briefing lead (sourcing lead, SRT lead, Procurement head or Briefing+ owner)'
    when 'quality' then 'Quality (SRT lead, Procurement head, sourcing lead or module owner)'
    when 'logistics_lead' then 'Logistics lead (sourcing lead or Logistics+ owner)'
    when 'line_manager' then 'Line manager (SRT lead, Procurement head or sourcing lead)'
    when 'client_approver' then 'Client approver (Client Portal)' when 'vendor' then 'The vendor (vendor portal)'
    else coalesce(p_role, 'Not set') end;
$$;

-- People who hold an approval role (for pickers such as the PSA line manager).
create or replace function public.approval_role_people(p_role text, p_module text default null)
returns table (id uuid, name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  return query select p.id, coalesce(nullif(p.full_name, ''), p.email), p.email from public.profiles p
    where (p.is_admin or p.user_type = 'internal') and public.approval_user_has_role(p.id, p_role, p_module)
    order by 2;
end $$;

-- The policy record's own data (extra settings such as standard_payment_days).
create or replace function public._approval_policy_data(p_record uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.library_records where id = p_record), '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- Requests and their audit
-- ---------------------------------------------------------------------------
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_no bigint generated always as identity unique,
  module text not null,
  approval_type text not null,
  entity_type text not null,
  entity_id text not null,
  ref text,
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  amount numeric,
  currency text,
  client_id uuid references public.sourcing_clients(id) on delete set null,
  market text,
  region text,
  href text,
  policy_record_id uuid references public.library_records(id),
  approver_role text not null,
  approver_module text,
  required_doa_level int,
  maker_checker boolean not null default true,
  excluded_users uuid[] not null default '{}',
  run_as text not null default 'approver' check (run_as in ('approver','requester','none')),
  status text not null default 'pending' check (status in ('pending','applying','approved','rejected','cancelled')),
  reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text
);
create unique index if not exists approval_requests_one_open on public.approval_requests (approval_type, entity_id) where status in ('pending','applying');
create index if not exists approval_requests_entity_idx on public.approval_requests (entity_type, entity_id, requested_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists ar_read on public.approval_requests;
create policy ar_read on public.approval_requests for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.approval_requests from authenticated, anon;

create table if not exists public.approval_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  action text not null check (action in ('requested','approved','rejected','cancelled')),
  note text,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists approval_request_events_req_idx on public.approval_request_events (request_id, at);
alter table public.approval_request_events enable row level security;
drop policy if exists are_read on public.approval_request_events;
create policy are_read on public.approval_request_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.approval_request_events from authenticated, anon;
drop trigger if exists approval_request_events_no_update on public.approval_request_events;
create trigger approval_request_events_no_update before update on public.approval_request_events for each row execute function public.trg_client_append_only();

-- Direct decisions made under a policy without a request (e-tender approval, Shopper IQ verification, rights sign-off, ...).
create table if not exists public.approval_decisions (
  id bigint generated always as identity primary key,
  module text not null,
  approval_type text not null,
  entity_type text not null,
  entity_id text not null,
  decision text not null check (decision in ('approved','rejected','override')),
  note text,
  policy_record_id uuid references public.library_records(id),
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists approval_decisions_entity_idx on public.approval_decisions (entity_type, entity_id, at);
alter table public.approval_decisions enable row level security;
drop policy if exists ad_read on public.approval_decisions;
create policy ad_read on public.approval_decisions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.approval_decisions from authenticated, anon;
drop trigger if exists approval_decisions_no_update on public.approval_decisions;
create trigger approval_decisions_no_update before update on public.approval_decisions for each row execute function public.trg_client_append_only();

create or replace function public._approval_decision(p_module text, p_type text, p_entity_type text, p_entity text, p_decision text, p_note text, p_policy uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.approval_decisions (module, approval_type, entity_type, entity_id, decision, note, policy_record_id, actor)
  values (p_module, p_type, p_entity_type, p_entity, p_decision, nullif(trim(p_note), ''), p_policy, auth.uid());
$$;

-- True while an approved request for this item is being applied (the gated function then runs its normal logic).
create or replace function public._approval_applying(p_type text, p_entity text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.approval_requests where approval_type = p_type and entity_id = p_entity and status = 'applying');
$$;

-- Open a request. The policy (by type, client, market, value) sets the approver role, maker-checker and DOA level.
create or replace function public._approval_request_open(
  p_module text, p_type text, p_entity_type text, p_entity text, p_ref text, p_title text, p_payload jsonb, p_reason text,
  p_amount numeric, p_currency text, p_client uuid, p_market text, p_region text, p_href text,
  p_default_role text, p_role_module text, p_run_as text, p_exclude uuid[] default '{}', p_summary text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pol record; v_id uuid; v_role text; v_lvl int; v_market text := public._market_code(p_market); v_no bigint;
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only adm Indicia staff can ask for approval' using errcode = '42501'; end if;
  select request_no into v_no from public.approval_requests where approval_type = p_type and entity_id = p_entity and status in ('pending','applying');
  if v_no is not null then raise exception 'This is already waiting for approval (request #%)', v_no; end if;
  select * into pol from public._approval_policy(p_type, p_client, v_market, p_amount);
  v_role := coalesce(pol.approver_role, p_default_role);
  if v_role = 'doa' then
    select d.level into v_lvl from public.doa_required_level(coalesce(p_amount, 0), coalesce(p_currency, 'GBP'), current_date) d;
  end if;
  insert into public.approval_requests (module, approval_type, entity_type, entity_id, ref, title, summary, payload, amount, currency, client_id,
    market, region, href, policy_record_id, approver_role, approver_module, required_doa_level, maker_checker, excluded_users, run_as, reason, requested_by)
  values (p_module, p_type, p_entity_type, p_entity, p_ref, p_title, p_summary, coalesce(p_payload, '{}'::jsonb), p_amount, p_currency, p_client,
    v_market, p_region, p_href, pol.record_id, v_role, p_role_module, v_lvl, coalesce(pol.maker_checker, true),
    coalesce(array_remove(p_exclude, null), '{}'), p_run_as, nullif(trim(p_reason), ''), auth.uid())
  returning id into v_id;
  insert into public.approval_request_events (request_id, action, note, actor) values (v_id, 'requested', nullif(trim(p_reason), ''), auth.uid());
  perform public._approval_notify(v_role, p_role_module, p_module, 'Approval needed: ' || p_title,
    coalesce(nullif(trim(p_reason), ''), 'Waiting for a second person to approve.'), coalesce(p_href, '/watchtower/approvals'), auth.uid());
  return v_id;
end $$;

create or replace function public.approval_request_can_decide(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.approval_requests;
begin
  if auth.uid() is null or not public.is_internal() then return false; end if;
  select * into r from public.approval_requests where id = p_id;
  if r.id is null or r.status <> 'pending' then return false; end if;
  if r.maker_checker and r.requested_by is not distinct from auth.uid() then return false; end if;
  if auth.uid() = any (r.excluded_users) then return false; end if;
  if not public.approval_has_role(r.approver_role, r.approver_module) then return false; end if;
  if r.approver_role = 'doa' and coalesce(public.sourcing_doa_level(), -1) < coalesce(r.required_doa_level, 0) then return false; end if;
  return true;
end $$;

-- Applies an approved request: calls the gated function, which recognises status 'applying'.
create or replace function public._approval_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := current_setting('request.jwt.claim.sub', true); p jsonb := r.payload;
begin
  if r.run_as = 'requester' then
    if r.requested_by is null then raise exception 'The person who asked no longer exists, so this can''t be applied'; end if;
    perform set_config('request.jwt.claim.sub', r.requested_by::text, true);
  end if;
  case r.approval_type
    when 'SCORECARD' then perform public.scorecard_activate(r.entity_id::uuid, p->>'note');
    when 'ACCESS_USER' then perform public.admin_set_user_access(r.entity_id::uuid, p->>'user_type', nullif(p->>'srt_role', ''), (p->>'is_admin')::boolean, nullif(p->>'supplier_id', '')::uuid);
    when 'ACCESS_SOURCING' then perform public.sourcing_set_access(r.entity_id::uuid, (p->>'is_lead')::boolean, (p->>'is_finance')::boolean, nullif(p->>'doa_level', '')::int);
    when 'CLIENT_ACCESS' then perform public.client_access_grant((p->>'user_id')::uuid, (p->>'client_id')::uuid, p->>'role');
    when 'RFQ_BYPASS' then perform public.rfq_award(r.entity_id::uuid, (p->>'response_id')::uuid, p->>'reason', p->>'bypass_code');
    when 'RATE_CARD_EXCEPTION' then
      update public.rfqs set rate_card_exception_approved_by = r.decided_by, rate_card_exception_approved_at = now() where id = r.entity_id::uuid;
      perform public._sourcing_event(job_id, 'rfq', id, 'rate_card_exception_approved', jsonb_build_object('request', r.request_no, 'reason', rate_card_exception_reason))
        from public.rfqs where id = r.entity_id::uuid;
    when 'TRIAGE_OVERRIDE' then perform public.spec_triage_override(r.entity_id::uuid, p->>'route', p->>'reason');
    when 'SOURCING_SETTINGS' then perform public.sourcing_update_settings((p->>'tolerance')::numeric, (p->>'push_threshold')::numeric,
      (p->>'instant_limit')::numeric, (p->>'respond_days')::int, p->>'reason');
    when 'BILL_CANCEL' then perform public.finance_bill_cancel(r.entity_id::uuid, p->>'reason');
    when 'JOB_CLOSE' then perform public.execution_close_job(r.entity_id::uuid, p->>'reason');
    when 'RECCE_READY' then perform public.execution_recce_set_status(r.entity_id::uuid, 'production_ready');
    when 'FAST_TRACK' then perform public.approve_fast_track(r.entity_id::uuid, p->>'justification', (p->>'close_by')::date);
    when 'SUPPLIER_REACTIVATE' then perform public.assure_set_supplier_status(array[r.entity_id::uuid], 'active', p->>'reason');
    when 'CONTRACT_APPROVE' then
      perform set_config('assure.system_write', 'on', true);
      update public.contracts set internal_approved_by = r.decided_by, internal_approved_at = now() where id = r.entity_id::uuid;
      perform set_config('assure.system_write', 'off', true);
      perform public._assure_log(c.supplier_id, 'contract', c.id, 'internally_approved', c.status, c.status, 'Contract approved internally: ' || c.title, r.decision_note)
        from public.contracts c where c.id = r.entity_id::uuid and c.supplier_id is not null;
    when 'INSPECTION_CHANGE' then perform public.assure_set_inspection_result(r.entity_id::uuid, p->>'result', p->>'note');
    when 'PAYMENT_TERMS' then perform public.assure_pa_transition(r.entity_id::uuid, 'send_terms', p->>'notes', p->>'feedback', p->'terms');
    else raise exception 'Unknown approval type %', r.approval_type;
  end case;
  if r.run_as = 'requester' then perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true); end if;
end $$;

create or replace function public.approval_request_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.approval_requests;
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only adm Indicia staff can decide approvals' using errcode = '42501'; end if;
  select * into r from public.approval_requests where id = p_id for update;
  if r.id is null then raise exception 'Approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %', r.status; end if;
  if r.maker_checker and r.requested_by = auth.uid() then raise exception 'You asked for this, so someone else must approve it' using errcode = '42501'; end if;
  if auth.uid() = any (r.excluded_users) then raise exception 'You are involved in this item, so someone else must decide it' using errcode = '42501'; end if;
  if not public.approval_has_role(r.approver_role, r.approver_module) then
    raise exception 'This needs a % to decide it%', lower(public.approval_role_label(r.approver_role)),
      coalesce(' (approval policy ' || (select code from public.library_records where id = r.policy_record_id) || ')', '') using errcode = '42501';
  end if;
  if r.approver_role = 'doa' and coalesce(public.sourcing_doa_level(), -1) < coalesce(r.required_doa_level, 0) then
    raise exception 'This needs DOA level % or above; yours is %', r.required_doa_level, coalesce(public.sourcing_doa_level()::text, 'not set') using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
    update public.approval_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    insert into public.approval_request_events (request_id, action, note, actor) values (p_id, 'rejected', trim(p_note), auth.uid());
    perform public.notify(r.requested_by, r.module, 'Not approved: ' || r.title, trim(p_note), coalesce(r.href, '/watchtower/approvals'));
    return;
  end if;
  update public.approval_requests set status = 'applying', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id returning * into r;
  insert into public.approval_request_events (request_id, action, note, actor) values (p_id, 'approved', nullif(trim(p_note), ''), auth.uid());
  perform public._approval_request_apply(r);
  update public.approval_requests set status = 'approved' where id = p_id;
  if r.requested_by is not null then
    perform public.notify(r.requested_by, r.module, 'Approved: ' || r.title, nullif(trim(p_note), ''), coalesce(r.href, '/watchtower/approvals'));
  end if;
end $$;

create or replace function public.approval_request_cancel(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_id for update;
  if r.id is null then raise exception 'Approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %', r.status; end if;
  if r.requested_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the person who asked can withdraw this request' using errcode = '42501'; end if;
  update public.approval_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  insert into public.approval_request_events (request_id, action, note, actor) values (p_id, 'cancelled', nullif(trim(p_note), ''), auth.uid());
end $$;

-- What the app reads (security invoker: internal staff only through RLS).
create or replace view public.approval_requests_v with (security_invoker = true) as
  select r.*, coalesce(nullif(rp.full_name, ''), rp.email) as requested_by_name, coalesce(nullif(dp.full_name, ''), dp.email) as decided_by_name,
         sc.name as client_name, public.approval_role_label(r.approver_role) as approver_label,
         (select code from public.library_records where id = r.policy_record_id) as policy_code,
         public.approval_request_can_decide(r.id) as can_decide
    from public.approval_requests r
    left join public.profiles rp on rp.id = r.requested_by
    left join public.profiles dp on dp.id = r.decided_by
    left join public.sourcing_clients sc on sc.id = r.client_id;
revoke insert, update, delete on public.approval_requests_v from authenticated, anon;

revoke execute on function public._approval_policy_data(uuid), public._approval_decision(text, text, text, text, text, text, uuid),
  public._approval_applying(text, text),
  public._approval_request_open(text, text, text, text, text, text, jsonb, text, numeric, text, uuid, text, text, text, text, text, text, uuid[], text),
  public._approval_request_apply(public.approval_requests) from public, anon, authenticated;
revoke execute on function public.approval_request_decide(uuid, boolean, text), public.approval_request_cancel(uuid, text),
  public.approval_request_can_decide(uuid), public.approval_role_people(text, text) from public, anon;
grant execute on function public.approval_request_decide(uuid, boolean, text), public.approval_request_cancel(uuid, text),
  public.approval_request_can_decide(uuid), public.approval_role_people(text, text), public.approval_role_label(text) to authenticated;
