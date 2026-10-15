-- Approval gaps (2 of 3): the approval steps docs/APPROVALS.md listed as missing, for every module except Briefing+.
--
-- How each existing function is changed (no old migration is edited and no large body is copied): the function is renamed
-- to public._core_<name> (execute revoked from everyone) and a wrapper with the same name, parameters, defaults and return
-- type checks the new approval rule first and then calls the core. To change the logic later, replace public._core_<name>.
--
-- Enforcement:
--   * Policy-driven (like the Briefing+ concept gate): the step applies when an active approval_policies record of that type
--     exists for the item (client, market, value); its approver_role and maker_checker are used. Request -> approve steps
--     apply when that policy is maker-checker. The demo seed m16_approvals_gaps.sql adds or tightens these policies.
--   * Always on (no existing flow depends on the old behaviour): PO rejection under DOA, an internally logged quote can't be
--     finance-approved by whoever logged it, Finance can't review an estimate they created, cancelling a sent client bill
--     and changing Sourcing settings need a second person, Shopper IQ results recorded in the app are verified before
--     clients see them, assets added in the app need a rights/brand sign-off.

-- ===========================================================================
-- New columns
-- ===========================================================================
alter table public.rfqs
  add column if not exists rate_card_exception_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists rate_card_exception_approved_at timestamptz;
alter table public.purchase_orders
  add column if not exists etender_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists etender_approved_at timestamptz,
  add column if not exists etender_note text;
alter table public.contracts
  add column if not exists internal_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists internal_approved_at timestamptz;
alter table public.siq_effectiveness
  add column if not exists verification_status text not null default 'verified' check (verification_status in ('pending','verified','rejected')),
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text;
alter table public.siq_assets
  add column if not exists rights_status text not null default 'approved' check (rights_status in ('pending','approved','rejected')),
  add column if not exists rights_by uuid references public.profiles(id) on delete set null,
  add column if not exists rights_at timestamptz,
  add column if not exists rights_note text;
comment on column public.siq_effectiveness.verification_status is
  'Rows recorded in the app start pending and are verified by a second person before clients see them; rows loaded directly (imports, seeds) count as verified source data.';
comment on column public.siq_assets.rights_status is
  'Assets added in the app need a rights/brand sign-off before Briefing+ can reuse them; rows loaded directly count as approved.';

-- ===========================================================================
-- Watchtower
-- ===========================================================================
-- Scorecard methodology: activation becomes request -> approve (SCORECARD policy, maker-checker).
alter function public.scorecard_activate(uuid, text) rename to _core_scorecard_activate;
create function public.scorecard_activate(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pol record; m public.scorecard_methodologies; v_sum numeric;
begin
  if public._approval_applying('SCORECARD', p_id::text) then perform public._core_scorecard_activate(p_id, p_note); return; end if;
  select * into pol from public._approval_policy('SCORECARD', null, null, null);
  if pol.record_id is null or not pol.maker_checker then perform public._core_scorecard_activate(p_id, p_note); return; end if;
  perform public._scorecard_require_admin();
  select * into m from public.scorecard_methodologies where id = p_id;
  if m.id is null or m.status <> 'draft' then raise exception 'Only a draft can be activated'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what changed and why before activating'; end if;
  select sum(weight) into v_sum from public.scorecard_pillars where methodology_id = p_id;
  if v_sum <> 100 then raise exception 'Pillar weights add up to %, not 100', v_sum; end if;
  perform public._approval_request_open('watchtower', 'SCORECARD', 'scorecard_methodology', p_id::text, 'v' || m.version,
    'Make scorecard methodology v' || m.version || ' live', jsonb_build_object('note', trim(p_note)), p_note, null, null, null, null, null,
    '/assure/watchtower', 'module_owner', 'assure', 'requester');
end $$;

-- User access: request -> second admin (ACCESS_USER policy, maker-checker).
alter function public.admin_set_user_access(uuid, text, text, boolean, uuid) rename to _core_admin_set_user_access;
create function public.admin_set_user_access(p_user uuid, p_user_type text, p_srt_role text, p_is_admin boolean, p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pol record; p public.profiles;
begin
  if public._approval_applying('ACCESS_USER', p_user::text) then
    perform public._core_admin_set_user_access(p_user, p_user_type, p_srt_role, p_is_admin, p_supplier); return;
  end if;
  select * into pol from public._approval_policy('ACCESS_USER', null, null, null);
  if pol.record_id is null or not pol.maker_checker then
    perform public._core_admin_set_user_access(p_user, p_user_type, p_srt_role, p_is_admin, p_supplier); return;
  end if;
  if not public.is_admin() then raise exception 'Only admins can change user access' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_is_admin = false then raise exception 'You cannot remove your own admin access'; end if;
  select * into p from public.profiles where id = p_user;
  if p.id is null then raise exception 'Person not found'; end if;
  perform public._approval_request_open('watchtower', 'ACCESS_USER', 'profile', p_user::text, p.email,
    'User access for ' || coalesce(nullif(p.full_name, ''), p.email) || ': ' || p_user_type || coalesce(', ' || nullif(p_srt_role, ''), '') ||
      case when p_is_admin then ', admin' else '' end,
    jsonb_build_object('user_type', p_user_type, 'srt_role', p_srt_role, 'is_admin', p_is_admin, 'supplier_id', p_supplier,
      'before', jsonb_build_object('user_type', p.user_type, 'srt_role', p.srt_role, 'is_admin', p.is_admin)),
    null, null, null, null, null, null, '/assure/admin/users', 'admin', null, 'requester');
end $$;

-- Sourcing access and DOA levels: request -> approve (ACCESS_SOURCING policy, maker-checker).
alter function public.sourcing_set_access(uuid, boolean, boolean, int) rename to _core_sourcing_set_access;
create function public.sourcing_set_access(p_user uuid, p_is_lead boolean, p_is_finance boolean, p_doa_level int) returns void
language plpgsql security definer set search_path = public as $$
declare pol record; p public.profiles; a public.sourcing_user_access;
begin
  if public._approval_applying('ACCESS_SOURCING', p_user::text) then
    perform public._core_sourcing_set_access(p_user, p_is_lead, p_is_finance, p_doa_level); return;
  end if;
  select * into pol from public._approval_policy('ACCESS_SOURCING', null, null, null);
  if pol.record_id is null or not pol.maker_checker then
    perform public._core_sourcing_set_access(p_user, p_is_lead, p_is_finance, p_doa_level); return;
  end if;
  if not public.can_govern('sourcing') then raise exception 'Only admins and Sourcing owners can change Sourcing access' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user and (user_type = 'internal' or is_admin);
  if p.id is null then raise exception 'Choose an internal person'; end if;
  select * into a from public.sourcing_user_access where user_id = p_user;
  perform public._approval_request_open('sourcing', 'ACCESS_SOURCING', 'profile', p_user::text, p.email,
    'Sourcing access for ' || coalesce(nullif(p.full_name, ''), p.email) || ': ' ||
      concat_ws(', ', case when p_is_lead then 'sourcing lead' end, case when p_is_finance then 'finance' end,
        case when p_doa_level is not null then 'DOA level ' || p_doa_level else 'no DOA' end),
    jsonb_build_object('is_lead', coalesce(p_is_lead, false), 'is_finance', coalesce(p_is_finance, false), 'doa_level', p_doa_level,
      'before', jsonb_build_object('is_lead', a.is_lead, 'is_finance', a.is_finance, 'doa_level', a.doa_level)),
    null, null, null, null, null, null, '/sourcing/admin', 'admin', null, 'requester');
end $$;

-- Client Portal approver rights: confirmed by a second admin (CLIENT_ACCESS policy, maker-checker). Viewer grants stay direct.
alter function public.client_access_grant(uuid, uuid, text) rename to _core_client_access_grant;
create function public.client_access_grant(p_user uuid, p_client uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare pol record; p public.profiles; c public.sourcing_clients;
begin
  if p_role is distinct from 'approver' or public._approval_applying('CLIENT_ACCESS', p_user::text || ':' || p_client::text)
     or exists (select 1 from public.client_users where user_id = p_user and client_id = p_client and role = 'approver') then
    perform public._core_client_access_grant(p_user, p_client, p_role); return;
  end if;
  select * into pol from public._approval_policy('CLIENT_ACCESS', p_client, null, null);
  if pol.record_id is null or not pol.maker_checker then perform public._core_client_access_grant(p_user, p_client, p_role); return; end if;
  if not public.is_admin() then raise exception 'Only admins can change client access' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  if p.id is null then raise exception 'Person not found'; end if;
  if p.is_admin or p.user_type = 'internal' then raise exception 'adm Indicia staff can preview the Client Portal; they can''t be given client access'; end if;
  if p.supplier_id is not null then raise exception 'This person is linked to a vendor company; unlink them in User access first'; end if;
  select * into c from public.sourcing_clients where id = p_client;
  if c.id is null or not c.active then raise exception 'Choose an active client'; end if;
  perform public._approval_request_open('watchtower', 'CLIENT_ACCESS', 'client_user', p_user::text || ':' || p_client::text, c.code,
    'Client approver rights for ' || coalesce(nullif(p.full_name, ''), p.email) || ' at ' || c.name,
    jsonb_build_object('user_id', p_user, 'client_id', p_client, 'role', 'approver'), null, null, null, p_client, null, null,
    '/watchtower/client-access', 'admin', null, 'requester');
end $$;

-- ===========================================================================
-- RFQ+ (module key 'rfq')
-- ===========================================================================
-- Who may award: the RFQ_AWARD policy role (sourcing lead, or DOA level by awarded value) and never the RFQ creator.
create or replace function public._rfq_award_block(p_rfq uuid, p_value numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.rfqs; j public.jobs; pol record; v_lvl int;
begin
  select * into r from public.rfqs where id = p_rfq;
  select * into j from public.jobs where id = r.job_id;
  select * into pol from public._approval_policy('RFQ_AWARD', j.client_id, public._market_code(r.market), p_value);
  if pol.record_id is null or pol.approver_role is null then return null; end if;
  if pol.maker_checker and r.created_by = auth.uid() then return 'You created this RFQ, so someone else must award it (approval policy ' || pol.code || ')'; end if;
  if pol.approver_role = 'doa' then
    select d.level into v_lvl from public.doa_required_level(coalesce(p_value, 0), r.currency, current_date) d;
    if coalesce(public.sourcing_doa_level(), -1) < v_lvl then
      return format('An award of this value needs DOA level %s or above (approval policy %s)', v_lvl, pol.code);
    end if;
  elsif not public.approval_has_role(pol.approver_role, 'rfq') then
    return format('Awards need a %s (approval policy %s)', lower(public.approval_role_label(pol.approver_role)), pol.code);
  end if;
  return null;
end $$;

create or replace function public.rfq_can_award(p_rfq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal() and public._rfq_award_block(p_rfq,
    (select min(q.total_value) from public.rfq_responses q where q.rfq_id = p_rfq and q.status = 'submitted' and q.finance_status = 'approved')) is null;
$$;

alter function public.rfq_award(uuid, uuid, text, text) rename to _core_rfq_award;
create function public.rfq_award(p_rfq uuid, p_response uuid, p_reason text, p_bypass_code text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; q public.rfq_responses; j public.jobs; v_valid int; v_byp public.library_records; bp record; v_block text;
begin
  select * into r from public.rfqs where id = p_rfq;
  select * into q from public.rfq_responses where id = p_response and rfq_id = p_rfq;
  if r.id is null or q.id is null then return public._core_rfq_award(p_rfq, p_response, p_reason, p_bypass_code); end if;
  select * into j from public.jobs where id = r.job_id;
  -- Bypass reasons flagged needs_approval: a sourcing lead approves the award (RFQ_BYPASS policy).
  if nullif(trim(p_bypass_code), '') is not null and not public._approval_applying('RFQ_BYPASS', p_rfq::text) then
    select count(*) into v_valid from public.rfq_responses where rfq_id = p_rfq and status = 'submitted';
    if v_valid < coalesce(r.min_quotes_required, 1) then
      select * into v_byp from public.library_records where library_key = 'bypass_reasons' and code = trim(p_bypass_code) and status = 'active';
      if v_byp.id is not null and coalesce((v_byp.data->>'needs_approval')::boolean, false) then
        select * into bp from public._approval_policy('RFQ_BYPASS', j.client_id, public._market_code(r.market), q.total_value);
        if bp.record_id is not null then
          if not public.is_internal() then raise exception 'Only internal staff can award RFQs' using errcode = '42501'; end if;
          if r.status <> 'sent' then raise exception 'Only an open RFQ can be awarded'; end if;
          if q.status <> 'submitted' then raise exception 'Only a submitted quote can be awarded'; end if;
          if q.finance_status <> 'approved' then raise exception 'Finance has not approved this quote yet'; end if;
          if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this supplier was chosen'; end if;
          perform public._approval_request_open('rfq', 'RFQ_BYPASS', 'rfq', p_rfq::text, r.rfq_number,
            'Bypass award on ' || r.title || ' (' || v_byp.name || ')',
            jsonb_build_object('response_id', p_response, 'reason', trim(p_reason), 'bypass_code', v_byp.code), trim(p_reason),
            q.total_value, q.currency, j.client_id, r.market, r.region, '/rfq/' || p_rfq, 'sourcing_lead', 'rfq', 'approver', array[r.created_by],
            format('%s valid quote(s), %s needed; reason %s', v_valid, r.min_quotes_required, v_byp.code));
          return null;
        end if;
      end if;
    end if;
  end if;
  v_block := public._rfq_award_block(p_rfq, q.total_value);
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  return public._core_rfq_award(p_rfq, p_response, p_reason, p_bypass_code);
end $$;

-- Rate-card exception on an RFQ: a sourcing lead approves it before the RFQ goes out (RATE_CARD_EXCEPTION policy).
alter function public.rfq_send(uuid) rename to _core_rfq_send;
create function public.rfq_send(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; j public.jobs; pol record;
begin
  select * into r from public.rfqs where id = p_rfq;
  if r.id is not null and r.status = 'draft' and r.rate_card_exception and r.rate_card_exception_approved_at is null then
    select * into j from public.jobs where id = r.job_id;
    select * into pol from public._approval_policy('RATE_CARD_EXCEPTION', j.client_id, public._market_code(r.market), r.estimated_value);
    if pol.record_id is not null then
      if not public.is_internal() then raise exception 'Only internal staff can send RFQs' using errcode = '42501'; end if;
      if exists (select 1 from public.approval_requests where approval_type = 'RATE_CARD_EXCEPTION' and entity_id = p_rfq::text and status = 'pending') then
        raise exception 'The rate-card exception is waiting for a sourcing lead to approve it; send the RFQ once it is approved';
      end if;
      perform public._approval_request_open('rfq', 'RATE_CARD_EXCEPTION', 'rfq', p_rfq::text, r.rfq_number,
        'Rate-card exception on ' || r.title, jsonb_build_object('reason', r.rate_card_exception_reason), r.rate_card_exception_reason,
        r.estimated_value, r.currency, j.client_id, r.market, r.region, '/rfq/' || p_rfq, 'sourcing_lead', 'rfq', 'none');
      return;
    end if;
  end if;
  perform public._core_rfq_send(p_rfq);
end $$;

-- A quote a finance user logged on the supplier's behalf is approved by a different finance user.
alter function public.rfq_finance_decide(uuid, boolean, text) rename to _core_rfq_finance_decide;
create function public.rfq_finance_decide(p_response uuid, p_approve boolean, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.rfq_responses;
begin
  select * into q from public.rfq_responses where id = p_response;
  if q.source = 'internal_entry' and q.submitted_by = auth.uid() then
    raise exception 'You logged this quote, so a different finance user must review it' using errcode = '42501';
  end if;
  perform public._core_rfq_finance_decide(p_response, p_approve, p_notes);
end $$;

-- ===========================================================================
-- Sourcing+ (module key 'sourcing')
-- ===========================================================================
-- Overrides that skip the RFQ become request -> sourcing lead approves (TRIAGE_OVERRIDE policy, maker-checker).
alter function public.spec_triage_override(uuid, text, text) rename to _core_spec_triage_override;
create function public.spec_triage_override(p_spec uuid, p_route text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.spec_triage; s public.job_specs; j public.jobs; pol record;
begin
  if p_route is distinct from 'create' and not public._approval_applying('TRIAGE_OVERRIDE', p_spec::text) then
    select * into s from public.job_specs where id = p_spec;
    select * into j from public.jobs where id = s.job_id;
    select * into t from public.spec_triage where spec_id = p_spec and is_current;
    select * into pol from public._approval_policy('TRIAGE_OVERRIDE', j.client_id, public._market_code(j.market), t.unit_price * t.quantity);
    if pol.record_id is not null and pol.maker_checker then
      if not public.is_internal() then raise exception 'Only internal staff can triage specs' using errcode = '42501'; end if;
      if p_route not in ('adopt','adapt','push') then raise exception 'Unknown route'; end if;
      if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the override'; end if;
      if t.id is null then raise exception 'Run triage on this spec first'; end if;
      if t.rate_card_id is null or t.unit_price is null then raise exception 'There is no rate-card price to apply; this line needs an RFQ'; end if;
      perform public._approval_request_open('sourcing', 'TRIAGE_OVERRIDE', 'spec', p_spec::text, j.job_number || '/' || s.spec_no,
        'Route ' || s.title || ' to ' || initcap(p_route) || ' (skips the RFQ)', jsonb_build_object('route', p_route, 'reason', trim(p_reason)), trim(p_reason),
        round(t.unit_price * t.quantity, 2), t.currency, j.client_id, j.market, j.region, '/sourcing/specs/' || p_spec, 'sourcing_lead', 'sourcing', 'approver');
      return null;
    end if;
  end if;
  return public._core_spec_triage_override(p_spec, p_route, p_reason);
end $$;

-- Module settings always need a second person (SOURCING_SETTINGS; default: admin or Sourcing owner, maker-checker).
alter function public.sourcing_update_settings(numeric, numeric, numeric, int, text) rename to _core_sourcing_update_settings;
create function public.sourcing_update_settings(p_tolerance numeric, p_push_threshold numeric, p_instant_limit numeric, p_respond_days int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.sourcing_settings;
begin
  if public._approval_applying('SOURCING_SETTINGS', 'settings') then
    perform public._core_sourcing_update_settings(p_tolerance, p_push_threshold, p_instant_limit, p_respond_days, p_reason); return;
  end if;
  if not public.can_govern('sourcing') then raise exception 'Only admins and Sourcing owners can change Sourcing settings' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the change'; end if;
  select * into o from public.sourcing_settings where id;
  perform public._approval_request_open('sourcing', 'SOURCING_SETTINGS', 'sourcing_settings', 'settings', 'Settings', 'Sourcing settings change',
    jsonb_build_object('tolerance', p_tolerance, 'push_threshold', p_push_threshold, 'instant_limit', p_instant_limit, 'respond_days', p_respond_days,
      'reason', trim(p_reason), 'before', jsonb_build_object('tolerance', o.triage_tolerance_percent, 'push_threshold', o.push_confidence_threshold,
      'instant_limit', o.instant_price_limit, 'respond_days', o.push_respond_days)),
    trim(p_reason), null, null, null, null, null, '/sourcing/admin', 'module_owner', 'sourcing', 'requester',
    '{}', format('Tolerance %s%%, push threshold %s, instant price limit %s, respond within %s days', p_tolerance, p_push_threshold, p_instant_limit, p_respond_days));
end $$;

-- ===========================================================================
-- Order Management+ (module key 'orders')
-- ===========================================================================
-- Estimates that need a Finance review can't go to the client until Finance approves (when an ESTIMATE_FINANCE policy exists).
alter function public.estimate_send(uuid) rename to _core_estimate_send;
create function public.estimate_send(p_estimate uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fe record; pol record;
begin
  select * into fe from public.v_finance_estimates where id = p_estimate;
  if fe.id is not null then
    select * into pol from public._approval_policy('ESTIMATE_FINANCE', (select client_id from public.jobs where id = fe.job_id), public._market_code(fe.market), fe.sell_price);
    if pol.record_id is not null then
      if fe.needs_review then
        raise exception 'Finance must review this estimate before it goes to the client (%)', array_to_string(fe.review_triggers, '; ');
      end if;
      if fe.review_status = 'declined' and not fe.review_stale then raise exception 'Finance declined this estimate: %', coalesce(fe.review_reason, 'see the review'); end if;
    end if;
  end if;
  perform public._core_estimate_send(p_estimate);
end $$;

-- Confirming a client approval: a client decision or client PO is on record, and the job manager (or the policy role)
-- confirms, never the estimate creator (ESTIMATE_CONFIRM policy).
create or replace function public._estimate_confirm_block(p_estimate uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; j public.jobs; pol record;
begin
  select * into e from public.estimates where id = p_estimate;
  select * into j from public.jobs where id = e.job_id;
  select * into pol from public._approval_policy('ESTIMATE_CONFIRM', j.client_id, public._market_code(e.market), e.sell_price);
  if pol.record_id is null then return null; end if;
  if pol.maker_checker and e.created_by = auth.uid() then return 'You created this estimate, so the job manager or a sourcing lead must confirm the client''s approval'; end if;
  if not (j.manager = auth.uid() or public.approval_has_role(coalesce(pol.approver_role, 'sourcing_lead'), 'orders')) then
    return format('Only the job manager or a %s can confirm the client''s approval (approval policy %s)', lower(public.approval_role_label(coalesce(pol.approver_role, 'sourcing_lead'))), pol.code);
  end if;
  return null;
end $$;

create or replace function public.estimate_can_confirm(p_estimate uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal() and public._estimate_confirm_block(p_estimate) is null;
$$;

alter function public.estimate_approve(uuid, text) rename to _core_estimate_approve;
create function public.estimate_approve(p_estimate uuid, p_client_order_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; pol record; v_block text; d public.client_decisions; v_ref text := nullif(trim(p_client_order_ref), '');
begin
  select * into e from public.estimates where id = p_estimate;
  if e.id is null or e.status <> 'sent' then perform public._core_estimate_approve(p_estimate, p_client_order_ref); return; end if;
  select * into j from public.jobs where id = e.job_id;
  select * into pol from public._approval_policy('ESTIMATE_CONFIRM', j.client_id, public._market_code(e.market), e.sell_price);
  if pol.record_id is null then perform public._core_estimate_approve(p_estimate, p_client_order_ref); return; end if;
  if not public.is_internal() then raise exception 'Only internal staff can record a client approval' using errcode = '42501'; end if;
  v_block := public._estimate_confirm_block(p_estimate);
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  select * into d from public.client_decisions where estimate_id = e.id and decided_at >= coalesce(e.sent_at, e.created_at) order by decided_at desc limit 1;
  if d.id is not null and d.decision = 'decline' then raise exception 'The client declined this estimate in the Client Portal'; end if;
  if d.id is null and v_ref is null then
    raise exception 'Record the client''s decision first: the client approves in the Client Portal, or enter the client''s PO number';
  end if;
  perform public._core_estimate_approve(p_estimate, coalesce(v_ref, d.client_order_ref));
  perform public._sourcing_event(e.job_id, 'estimate', e.id, 'client_approval_confirmed', jsonb_build_object(
    'basis', case when d.id is not null then 'client_portal' else 'client_po' end, 'decision_id', d.id, 'client_order_ref', coalesce(v_ref, d.client_order_ref), 'policy', pol.code));
end $$;

-- PO rejection follows the same DOA rule as approval (always).
alter function public.po_reject(uuid, text) rename to _core_po_reject;
create function public.po_reject(p_po uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; v_level int := public.sourcing_doa_level();
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.id is not null and p.status = 'pending_approval' then
    if p.created_by = auth.uid() then raise exception 'A different person must decide the PO you raised' using errcode = '42501'; end if;
    if v_level is null then raise exception 'You have no delegated approval authority in Sourcing' using errcode = '42501'; end if;
    if v_level < p.required_doa_level then
      raise exception 'This PO needs DOA level % to decide; your level is %', p.required_doa_level, v_level using errcode = '42501';
    end if;
  end if;
  perform public._core_po_reject(p_po, p_reason);
end $$;

-- POs above the client's e-tender threshold need the Procurement head first (PO_ETENDER policy).
create or replace function public.po_etender_pending(p_po uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p.exceeds_e_tender and p.etender_approved_at is null and p.status = 'pending_approval'
     and exists (select 1 from public._approval_policy('PO_ETENDER', j.client_id, public._market_code(p.market), p.total_value))
    from public.purchase_orders p join public.jobs j on j.id = p.job_id where p.id = p_po;
$$;

create or replace function public.po_etender_can_decide(p_po uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p public.purchase_orders; pol record;
begin
  select * into p from public.purchase_orders where id = p_po;
  if not coalesce(public.po_etender_pending(p_po), false) or not public.is_internal() then return false; end if;
  select * into pol from public._approval_policy('PO_ETENDER', (select client_id from public.jobs where id = p.job_id), public._market_code(p.market), p.total_value);
  return public.approval_has_role(coalesce(pol.approver_role, 'procurement_head'), 'orders') and not (coalesce(pol.maker_checker, true) and p.created_by = auth.uid());
end $$;

create or replace function public.po_etender_decide(p_po uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; pol record;
begin
  if not public.is_internal() then raise exception 'Only internal staff can decide purchase orders' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.status <> 'pending_approval' then raise exception 'This PO is not waiting for approval'; end if;
  if not coalesce(public.po_etender_pending(p_po), false) then raise exception 'This PO does not need an e-tender approval'; end if;
  select * into pol from public._approval_policy('PO_ETENDER', (select client_id from public.jobs where id = p.job_id), public._market_code(p.market), p.total_value);
  if coalesce(pol.maker_checker, true) and p.created_by = auth.uid() then raise exception 'A different person must decide the PO you raised' using errcode = '42501'; end if;
  if not public.approval_has_role(coalesce(pol.approver_role, 'procurement_head'), 'orders') then
    raise exception 'POs over the e-tender threshold need the % approval (approval policy %)', lower(public.approval_role_label(coalesce(pol.approver_role, 'procurement_head'))), pol.code using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the PO is rejected'; end if;
  if p_approve then
    update public.purchase_orders set etender_approved_by = auth.uid(), etender_approved_at = now(), etender_note = nullif(trim(p_note), '') where id = p_po;
  else
    update public.purchase_orders set status = 'rejected', rejected_reason = 'E-tender: ' || trim(p_note), etender_note = trim(p_note) where id = p_po;
  end if;
  perform public._approval_decision('orders', 'PO_ETENDER', 'purchase_order', p_po::text, case when p_approve then 'approved' else 'rejected' end, p_note, pol.record_id);
  perform public._sourcing_event(p.job_id, 'po', p_po, case when p_approve then 'etender_approved' else 'etender_rejected' end,
    jsonb_build_object('note', nullif(trim(p_note), ''), 'policy', pol.code, 'total', p.total_value));
  perform public.notify(p.created_by, 'orders', case when p_approve then 'E-tender approval given: ' else 'PO rejected at e-tender: ' end || p.po_number,
    nullif(trim(p_note), ''), '/orders/purchase-orders/' || p_po);
end $$;

alter function public.po_approve(uuid, text) rename to _core_po_approve;
create function public.po_approve(p_po uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.po_etender_pending(p_po), false) then
    raise exception 'This PO is over the client''s e-tender threshold: the Procurement head must approve it before DOA approval';
  end if;
  perform public._core_po_approve(p_po, p_note);
end $$;

-- PSA line manager: must hold the PSA_LINE_MANAGER policy role (line manager) when the policy names one.
alter function public.psa_submit(uuid, uuid) rename to _core_psa_submit;
create function public.psa_submit(p_id uuid, p_line_manager uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions; pol record;
begin
  select * into v from public.psa_exceptions where id = p_id;
  if v.id is not null then
    select * into pol from public._approval_policy('PSA_LINE_MANAGER', (select client_id from public.jobs where id = v.job_id), public._market_code(v.market), v.fee);
    if pol.approver_role is not null and pol.approver_role not in ('named_person','internal')
       and not public.approval_user_has_role(p_line_manager, pol.approver_role, 'orders') then
      raise exception 'Choose a line manager: the person must be a % (approval policy %)', lower(public.approval_role_label(pol.approver_role)), pol.code;
    end if;
  end if;
  perform public._core_psa_submit(p_id, p_line_manager);
end $$;

alter function public.psa_line_manager_decide(uuid, boolean, text) rename to _core_psa_line_manager_decide;
create function public.psa_line_manager_decide(p_id uuid, p_approve boolean, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions; pol record;
begin
  select * into v from public.psa_exceptions where id = p_id;
  if v.id is not null and v.line_manager = auth.uid() then
    select * into pol from public._approval_policy('PSA_LINE_MANAGER', (select client_id from public.jobs where id = v.job_id), public._market_code(v.market), v.fee);
    if pol.approver_role is not null and pol.approver_role not in ('named_person','internal') and not public.approval_has_role(pol.approver_role, 'orders') then
      raise exception 'You no longer hold the line-manager role for this request (approval policy %)', pol.code using errcode = '42501';
    end if;
  end if;
  perform public._core_psa_line_manager_decide(p_id, p_approve, p_notes);
end $$;

-- PSA line-manager picker: people holding the policy role, or every internal person when the policy doesn't name one.
create or replace function public.psa_line_manager_options(p_id uuid default null) returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
declare v public.psa_exceptions; pol record;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  if p_id is not null then select * into v from public.psa_exceptions where id = p_id; end if;
  select * into pol from public._approval_policy('PSA_LINE_MANAGER', (select client_id from public.jobs where id = v.job_id), public._market_code(v.market), v.fee);
  return query select p.id, coalesce(nullif(p.full_name, ''), p.email) from public.profiles p
    where (p.is_admin or p.user_type = 'internal') and p.id is distinct from auth.uid()
      and (pol.approver_role is null or pol.approver_role in ('named_person','internal') or public.approval_user_has_role(p.id, pol.approver_role, 'orders'))
    order by 2;
end $$;

-- ===========================================================================
-- Finance+ (module key 'finance')
-- ===========================================================================
create or replace function public._invoice_doa_block(p_invoice uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare i public.supplier_invoices; pol record; v_lvl int;
begin
  select * into i from public.supplier_invoices where id = p_invoice;
  select * into pol from public._approval_policy('INVOICE_APPROVE', (select client_id from public.jobs where id = i.job_id), public._market_code(i.market), i.gross_amount);
  if pol.approver_role is distinct from 'doa' then return null; end if;
  select d.level into v_lvl from public.doa_required_level(coalesce(i.gross_amount, 0), i.currency, current_date) d;
  if coalesce(public.sourcing_doa_level(), -1) < v_lvl then
    return format('Invoices of this value need DOA level %s or above to approve (approval policy %s)', v_lvl, pol.code);
  end if;
  return null;
end $$;

alter function public.finance_approve_invoice(uuid, text) rename to _core_finance_approve_invoice;
create function public.finance_approve_invoice(p_invoice uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_block text := public._invoice_doa_block(p_invoice);
begin
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  perform public._core_finance_approve_invoice(p_invoice, p_note);
end $$;

-- Payment release (scheduling) by a different finance user than the one who approved the invoice (PAYMENT_RELEASE policy).
alter function public.finance_schedule_payment(uuid, jsonb) rename to _core_finance_schedule_payment;
create function public.finance_schedule_payment(p_invoice uuid, p_items jsonb default null) returns int
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices; pol record;
begin
  select * into i from public.supplier_invoices where id = p_invoice;
  if i.id is not null then
    select * into pol from public._approval_policy('PAYMENT_RELEASE', (select client_id from public.jobs where id = i.job_id), public._market_code(i.market), i.gross_amount);
    if pol.record_id is not null and pol.maker_checker and i.approved_by = auth.uid() then
      raise exception 'You approved this invoice, so a different finance user must release the payment' using errcode = '42501';
    end if;
  end if;
  return public._core_finance_schedule_payment(p_invoice, p_items);
end $$;

-- Cancelling a sent client bill (a credit) needs a second finance user (always; BILL_CANCEL policy sets the role).
alter function public.finance_bill_cancel(uuid, text) rename to _core_finance_bill_cancel;
create function public.finance_bill_cancel(p_bill uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.client_bills;
begin
  select * into b from public.client_bills where id = p_bill;
  if b.id is not null and b.status = 'sent' and not public._approval_applying('BILL_CANCEL', p_bill::text) then
    perform public._finance_require();
    if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the bill is cancelled'; end if;
    perform public._approval_request_open('finance', 'BILL_CANCEL', 'client_bill', p_bill::text, b.bill_number,
      'Cancel sent bill ' || b.bill_number, jsonb_build_object('reason', trim(p_reason)), trim(p_reason),
      b.gross_amount, b.currency, b.client_id, b.market, b.region, '/finance/billing/' || p_bill, 'finance', 'finance', 'approver');
    return;
  end if;
  perform public._core_finance_bill_cancel(p_bill, p_reason);
end $$;

-- Finance reviewer is never the estimate creator (always).
alter function public.finance_estimate_decide(uuid, boolean, text) rename to _core_finance_estimate_decide;
create function public.finance_estimate_decide(p_estimate uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.estimates where id = p_estimate and created_by = auth.uid()) then
    raise exception 'You created this estimate, so another finance user must review it' using errcode = '42501';
  end if;
  perform public._core_finance_estimate_decide(p_estimate, p_approve, p_reason);
end $$;

-- ===========================================================================
-- Logistics+
-- ===========================================================================
-- Marked delivered only with a verified POD, or by a logistics lead with an override reason (DELIVERY_CONFIRM policy).
alter function public.logistics_mark_delivered(uuid, date, text) rename to _core_logistics_mark_delivered;
create function public.logistics_mark_delivered(p_delivery uuid, p_delivered_on date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; pol record; v_client uuid;
begin
  select * into d from public.deliveries where id = p_delivery;
  if d.id is not null and not exists (select 1 from public.shipments where delivery_id = p_delivery and pod_status = 'verified') then
    select j.client_id into v_client from public.jobs j where j.id = d.job_id;
    select * into pol from public._approval_policy('DELIVERY_CONFIRM', v_client, public._market_code(d.market), null);
    if pol.record_id is not null then
      if not public.approval_has_role(coalesce(pol.approver_role, 'logistics_lead'), 'logistics') then
        raise exception 'There is no verified proof of delivery yet. Verify the POD first, or ask a % to mark it delivered with an override reason',
          lower(public.approval_role_label(coalesce(pol.approver_role, 'logistics_lead'))) using errcode = '42501';
      end if;
      if coalesce(trim(p_note), '') = '' then raise exception 'There is no verified proof of delivery: give the override reason'; end if;
      perform public._core_logistics_mark_delivered(p_delivery, p_delivered_on, 'Delivered without a verified POD: ' || trim(p_note));
      perform public._logistics_event(p_delivery, null, 'delivered_without_pod', jsonb_build_object('reason', trim(p_note), 'policy', pol.code));
      perform public._approval_decision('logistics', 'DELIVERY_CONFIRM', 'delivery', p_delivery::text, 'override', p_note, pol.record_id);
      return;
    end if;
  end if;
  perform public._core_logistics_mark_delivered(p_delivery, p_delivered_on, p_note);
end $$;

-- ===========================================================================
-- Execution+
-- ===========================================================================
-- Quality gates: the QUALITY_GATE policy role (quality) and never the check-sheet uploader.
create or replace function public._quality_gate_block(p_job uuid, p_gate text) returns text
language plpgsql stable security definer set search_path = public as $$
declare j public.jobs; pol record; v_up uuid;
begin
  select * into j from public.jobs where id = p_job;
  select * into pol from public._approval_policy('QUALITY_GATE', j.client_id, public._market_code(j.market), null);
  if pol.record_id is null then return null; end if;
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'execution') then
    return format('Quality gates are signed off by a %s (approval policy %s)', lower(public.approval_role_label(pol.approver_role)), pol.code);
  end if;
  select f.uploaded_by into v_up from public.files f where f.entity_type = 'job_quality_gate' and f.entity_id = p_job::text || ':' || p_gate order by f.created_at desc limit 1;
  if pol.maker_checker and v_up = auth.uid() then return 'You uploaded the check sheet, so someone else must sign this gate off'; end if;
  return null;
end $$;

alter function public.execution_gate_sign_off(uuid, text, boolean, text) rename to _core_execution_gate_sign_off;
create function public.execution_gate_sign_off(p_job uuid, p_gate text, p_passed boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_block text := public._quality_gate_block(p_job, p_gate);
begin
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  perform public._core_execution_gate_sign_off(p_job, p_gate, p_passed, p_notes);
end $$;

-- Closing with overridden soft checks: request -> sourcing lead approves (JOB_CLOSE policy, maker-checker).
alter function public.execution_close_job(uuid, text) rename to _core_execution_close_job;
create function public.execution_close_job(p_job uuid, p_override_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs; pol record; c jsonb; v_hard text; v_soft text;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is not null and coalesce(trim(p_override_reason), '') <> '' and not public._approval_applying('JOB_CLOSE', p_job::text)
     and j.status in ('ordered','in_production','delivered') then
    select * into pol from public._approval_policy('JOB_CLOSE', j.client_id, public._market_code(j.market), null);
    if pol.record_id is not null and pol.maker_checker then
      c := public.job_close_check(p_job);
      select string_agg(x->>'label', '; ') into v_hard from jsonb_array_elements(c->'checks') x where not (x->>'ok')::boolean and not (x->>'overridable')::boolean;
      select string_agg(x->>'label', '; ') into v_soft from jsonb_array_elements(c->'checks') x where not (x->>'ok')::boolean and (x->>'overridable')::boolean;
      if v_hard is null and v_soft is not null then
        perform public._execution_require_internal();
        perform public._approval_request_open('execution', 'JOB_CLOSE', 'job', p_job::text, j.job_number, 'Close ' || j.title || ' with overrides',
          jsonb_build_object('reason', trim(p_override_reason), 'overrides', v_soft), trim(p_override_reason), null, null, j.client_id, j.market, j.region,
          '/execution/jobs/' || p_job, 'sourcing_lead', 'execution', 'approver', '{}', 'Not done: ' || v_soft);
        return;
      end if;
    end if;
  end if;
  perform public._core_execution_close_job(p_job, p_override_reason);
end $$;

-- Production-ready recces need a second person's sign-off (RECCE_READY policy, maker-checker).
alter function public.execution_recce_set_status(uuid, text) rename to _core_execution_recce_set_status;
create function public.execution_recce_set_status(p_recce uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.recces; j public.jobs; pol record;
begin
  select * into r from public.recces where id = p_recce;
  if r.id is not null and p_status = 'production_ready' and r.status <> 'production_ready' and not public._approval_applying('RECCE_READY', p_recce::text) then
    select * into j from public.jobs where id = r.job_id;
    select * into pol from public._approval_policy('RECCE_READY', j.client_id, public._market_code(r.market), null);
    if pol.record_id is not null and pol.maker_checker then
      perform public._execution_require_internal();
      if r.units_fit is null then raise exception 'Measure the available space and the unit size first'; end if;
      if r.recommended_width_cm is null or r.recommended_height_cm is null then
        raise exception 'Set the recommended finished size before marking the recce production ready';
      end if;
      perform public._approval_request_open('execution', 'RECCE_READY', 'recce', p_recce::text, r.recce_code,
        'Production-ready recce ' || r.recce_code || coalesce(' · ' || r.product_name, ''),
        jsonb_build_object('width_cm', r.recommended_width_cm, 'height_cm', r.recommended_height_cm, 'depth_cm', r.recommended_depth_cm), null,
        null, null, j.client_id, r.market, r.region, '/execution/recces/' || p_recce, 'internal', 'execution', 'approver', '{}',
        format('Recommended size %s x %s cm', r.recommended_width_cm, r.recommended_height_cm));
      return;
    end if;
  end if;
  perform public._core_execution_recce_set_status(p_recce, p_status);
end $$;

-- ===========================================================================
-- SRM (internal) and the SRT desk
-- ===========================================================================
-- Critical onboarding gates: the verifier is never who requested or supplied the evidence (gate policy maker-checker).
create or replace function public._gate_requester(p_supplier uuid, p_gate text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    (select g.updated_by from public.supplier_gates g where g.supplier_id = p_supplier and g.gate_key = p_gate and g.status in ('requested','received')),
    (select l.actor from public.gate_audit_log l where l.supplier_id = p_supplier and l.gate_key = p_gate and l.to_status in ('requested','received')
      order by l.created_at desc limit 1)], null);
$$;

create or replace function public._gate_mc_applies(p_supplier uuid, p_gate text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d public.gate_definitions; s public.suppliers; pol record;
begin
  select * into d from public.gate_definitions where key = p_gate;
  if d.key is null or not d.critical then return false; end if;
  select * into s from public.suppliers where id = p_supplier;
  select * into pol from public._approval_policy(case d.verifier_role when 'head' then 'SRT_ONBOARDING_APPROVAL' when 'finance' then 'SRT_BANK' else 'SRT_GATE' end,
    null, public._market_code(s.market), null);
  return pol.record_id is not null and pol.maker_checker;
end $$;

alter function public.update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid) rename to _core_update_supplier_gate;
create function public.update_supplier_gate(
  p_supplier uuid, p_gate text, p_status text default null, p_expiry date default null,
  p_clear_expiry boolean default false, p_note text default null, p_rejection_reason text default null,
  p_ticket uuid default null
) returns public.supplier_gates
language plpgsql security definer set search_path = public as $$
begin
  if p_status in ('verified','rejected')
     and exists (select 1 from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate and status is distinct from p_status)
     and public._gate_mc_applies(p_supplier, p_gate) and auth.uid() = any (public._gate_requester(p_supplier, p_gate)) then
    raise exception 'You requested or supplied the evidence on this critical gate, so someone else must verify it' using errcode = '42501';
  end if;
  return public._core_update_supplier_gate(p_supplier, p_gate, p_status, p_expiry, p_clear_expiry, p_note, p_rejection_reason, p_ticket);
end $$;

-- Fast-track: request (anyone at adm Indicia) -> SRT lead approves, never for a supplier they created (FAST_TRACK policy).
alter function public.approve_fast_track(uuid, text, date) rename to _core_approve_fast_track;
create function public.approve_fast_track(p_supplier uuid, p_justification text, p_close_by date) returns void
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; pol record;
begin
  if public._approval_applying('FAST_TRACK', p_supplier::text) then perform public._core_approve_fast_track(p_supplier, p_justification, p_close_by); return; end if;
  select * into s from public.suppliers where id = p_supplier;
  select * into pol from public._approval_policy('FAST_TRACK', null, public._market_code(s.market), null);
  if s.id is null or pol.record_id is null or not pol.maker_checker then
    perform public._core_approve_fast_track(p_supplier, p_justification, p_close_by); return;
  end if;
  if not public.is_internal() then raise exception 'Only adm Indicia staff can ask for a fast-track' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_justification, '')), '') is null then raise exception 'A justification is required'; end if;
  if p_close_by is null or p_close_by < current_date then raise exception 'Choose a close-by date in the future'; end if;
  if s.fast_track_approved_at is not null and s.onboarding_route = 'fast_track' then raise exception 'This supplier is already on the fast track'; end if;
  perform public._approval_request_open('assure', 'FAST_TRACK', 'supplier', p_supplier::text, s.supplier_code, 'Fast-track onboarding for ' || s.name,
    jsonb_build_object('justification', trim(p_justification), 'close_by', p_close_by), trim(p_justification), null, null, null, s.market, s.region,
    '/assure/suppliers/' || p_supplier, 'srt_lead', 'assure', 'approver', array[s.created_by], 'Close by ' || to_char(p_close_by, 'DD Mon YYYY'));
end $$;

-- Moving a suspended or offboarded supplier back to active needs a second person (SUPPLIER_REACTIVATE policy).
alter function public.assure_set_supplier_status(uuid[], text, text) rename to _core_assure_set_supplier_status;
create function public.assure_set_supplier_status(p_suppliers uuid[], p_status text, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare pol record; s record; v_rest uuid[] := '{}'; v_req int := 0;
begin
  if p_status is distinct from 'active' or (cardinality(p_suppliers) = 1 and public._approval_applying('SUPPLIER_REACTIVATE', p_suppliers[1]::text)) then
    return public._core_assure_set_supplier_status(p_suppliers, p_status, p_reason);
  end if;
  select * into pol from public._approval_policy('SUPPLIER_REACTIVATE', null, null, null);
  if pol.record_id is null or not pol.maker_checker then return public._core_assure_set_supplier_status(p_suppliers, p_status, p_reason); end if;
  perform public._assure_require_internal();
  if not (public.is_admin() or coalesce(public.my_srt_role(), '') in ('lead','head')) then
    raise exception 'Only an SRT lead, the Procurement head or an admin can change supplier status' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for the status change'; end if;
  for s in select id, name, supplier_code, status, market, region from public.suppliers where id = any(p_suppliers) loop
    if s.status in ('suspended','offboarded') then
      perform public._approval_request_open('assure', 'SUPPLIER_REACTIVATE', 'supplier', s.id::text, s.supplier_code,
        'Reactivate ' || s.name || ' (' || s.status || ')', jsonb_build_object('reason', trim(p_reason), 'from', s.status), trim(p_reason),
        null, null, null, s.market, s.region, '/assure/suppliers/' || s.id, 'srt_lead', 'assure', 'approver');
      v_req := v_req + 1;
    else
      v_rest := v_rest || s.id;
    end if;
  end loop;
  if cardinality(v_rest) = 0 then return 0; end if;
  return public._core_assure_set_supplier_status(v_rest, p_status, p_reason);
end $$;

-- Contracts are approved internally (Procurement head; legal/admin above a value) before they go to the vendor
-- (CONTRACT_APPROVE policy). Approval unlocks Send.
alter function public.assure_contract_action(uuid, text, text) rename to _core_assure_contract_action;
create function public.assure_contract_action(p_id uuid, p_action text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.contracts; pol record;
begin
  if p_action = 'send' then
    select * into c from public.contracts where id = p_id;
    if c.id is not null and c.status = 'draft' and c.internal_approved_at is null then
      select * into pol from public._approval_policy('CONTRACT_APPROVE', null, public._market_code(c.market), c.value);
      if pol.record_id is not null then
        perform public._assure_require_internal();
        if not exists (select 1 from public.contract_parties where contract_id = p_id and role = 'signer') then
          raise exception 'Add at least one signer before sending';
        end if;
        if exists (select 1 from public.approval_requests where approval_type = 'CONTRACT_APPROVE' and entity_id = p_id::text and status = 'pending') then
          raise exception 'This contract is waiting for internal approval; send it once it is approved';
        end if;
        perform public._approval_request_open('assure', 'CONTRACT_APPROVE', 'contract', p_id::text, c.contract_ref, 'Approve contract before sending: ' || c.title,
          jsonb_build_object('note', nullif(trim(p_note), '')), p_note, c.value, c.currency, null, c.market, c.region, '/assure/contracts/' || p_id,
          'procurement_head', 'assure', 'none', array[c.created_by]);
        return p_id;
      end if;
    end if;
  end if;
  return public._core_assure_contract_action(p_id, p_action, p_note);
end $$;

-- Changing an inspection result away from fail needs a second person (INSPECTION_CHANGE policy).
alter function public.assure_set_inspection_result(uuid, text, text) rename to _core_assure_set_inspection_result;
create function public.assure_set_inspection_result(p_id uuid, p_result text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quality_inspections; pol record;
begin
  select * into q from public.quality_inspections where id = p_id;
  if q.id is not null and q.result = 'fail' and p_result in ('pass','conditional_pass') and not public._approval_applying('INSPECTION_CHANGE', p_id::text) then
    select * into pol from public._approval_policy('INSPECTION_CHANGE', null, public._market_code(q.market), null);
    if pol.record_id is not null and pol.maker_checker then
      perform public._assure_require_internal();
      if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why the result is changing'; end if;
      perform public._approval_request_open('assure', 'INSPECTION_CHANGE', 'inspection', p_id::text, q.inspection_ref,
        'Change inspection ' || q.inspection_ref || ' from fail to ' || replace(p_result, '_', ' '), jsonb_build_object('result', p_result, 'note', trim(p_note)),
        trim(p_note), null, null, null, q.market, q.region, '/assure/quality', 'quality', 'assure', 'approver');
      return;
    end if;
  end if;
  perform public._core_assure_set_inspection_result(p_id, p_result, p_note);
end $$;

-- NCR close: quality role, never who raised it (NCR_CLOSE policy).
create or replace function public._ncr_close_block(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare n public.ncrs; pol record;
begin
  select * into n from public.ncrs where id = p_id;
  select * into pol from public._approval_policy('NCR_CLOSE', null, public._market_code(n.market), null);
  if pol.record_id is null then return null; end if;
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'assure') then
    return format('NCRs are closed by %s (approval policy %s)', lower(public.approval_role_label(pol.approver_role)), pol.code);
  end if;
  if pol.maker_checker and n.raised_by = auth.uid() then return 'You raised this NCR, so someone else must close it'; end if;
  return null;
end $$;

alter function public.assure_ncr_close(uuid, text, text) rename to _core_assure_ncr_close;
create function public.assure_ncr_close(p_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_block text;
begin
  if p_outcome = 'closed' then
    v_block := public._ncr_close_block(p_id);
    if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  end if;
  perform public._core_assure_ncr_close(p_id, p_outcome, p_note);
end $$;

-- Survey review: never the person who launched the survey (SURVEY_REVIEW policy maker-checker).
create or replace function public._survey_review_block(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.survey_responses; pol record;
begin
  select * into r from public.survey_responses where id = p_id;
  select * into pol from public._approval_policy('SURVEY_REVIEW', null, public._market_code(r.market), null);
  if pol.record_id is null then return null; end if;
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'assure') then
    return format('Survey responses are reviewed by %s (approval policy %s)', lower(public.approval_role_label(pol.approver_role)), pol.code);
  end if;
  if pol.maker_checker and r.launched_by = auth.uid() then return 'You launched this survey, so someone else must review the response'; end if;
  return null;
end $$;

alter function public.assure_survey_review(uuid, text, text, text) rename to _core_assure_survey_review;
create function public.assure_survey_review(p_id uuid, p_decision text, p_notes text, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare v_block text;
begin
  if p_decision in ('approve','reject') then
    v_block := public._survey_review_block(p_id);
    if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  end if;
  perform public._core_assure_survey_review(p_id, p_decision, p_notes, p_feedback);
end $$;

-- Performance issue resolution: never the supplier's SRT owner (ISSUE_RESOLVE policy maker-checker).
create or replace function public._issue_resolve_block(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare i public.performance_issues; s public.suppliers; pol record;
begin
  select * into i from public.performance_issues where id = p_id;
  select * into s from public.suppliers where id = i.supplier_id;
  select * into pol from public._approval_policy('ISSUE_RESOLVE', null, public._market_code(coalesce(i.market, s.market)), null);
  if pol.record_id is null then return null; end if;
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'assure') then
    return format('Issues are resolved by %s (approval policy %s)', lower(public.approval_role_label(pol.approver_role)), pol.code);
  end if;
  if pol.maker_checker and s.srt_owner = auth.uid() then return 'You own this supplier, so someone else must confirm the issue is resolved'; end if;
  return null;
end $$;

alter function public.assure_issue_resolve(uuid, text) rename to _core_assure_issue_resolve;
create function public.assure_issue_resolve(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_block text := public._issue_resolve_block(p_id);
begin
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  perform public._core_assure_issue_resolve(p_id, p_note);
end $$;

-- Non-standard payment terms from a pre-assessment go to Finance before they are sent (PAYMENT_TERMS policy;
-- standard = at least standard_payment_days on the policy record, default 60).
alter function public.assure_pa_transition(uuid, text, text, text, jsonb) rename to _core_assure_pa_transition;
create function public.assure_pa_transition(p_id uuid, p_action text, p_notes text, p_feedback text, p_terms jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.vendor_pre_assessments; s public.suppliers; pol record; v_std int; v_days int;
begin
  if p_action = 'send_terms' and not public._approval_applying('PAYMENT_TERMS', p_id::text) then
    select * into r from public.vendor_pre_assessments where id = p_id;
    select * into s from public.suppliers where id = r.supplier_id;
    select * into pol from public._approval_policy('PAYMENT_TERMS', null, public._market_code(coalesce(r.market, s.market)),
      nullif(p_terms->>'annual_spend_forecast', '')::numeric);
    if r.id is not null and pol.record_id is not null then
      v_std := coalesce(nullif(public._approval_policy_data(pol.record_id)->>'standard_payment_days', '')::int, 60);
      v_days := nullif(p_terms->>'payment_terms_days', '')::int;
      if v_days is null or v_days < v_std then
        if not public.assure_is_procurement() then
          raise exception 'Only procurement (in-market procurement or the Procurement head) can act at this stage' using errcode = '42501';
        end if;
        if r.status <> 'procurement_review' then raise exception 'Terms can only be sent during procurement review'; end if;
        if p_terms is null or p_terms->>'payment_terms' is null or p_terms->>'tier' is null then raise exception 'Enter the proposed payment terms and tier'; end if;
        perform public._approval_request_open('assure', 'PAYMENT_TERMS', 'pre_assessment', p_id::text, s.supplier_code,
          'Non-standard payment terms for ' || r.company_name || ': ' || coalesce(p_terms->>'payment_terms', '') || coalesce(' (' || v_days || ' days)', ''),
          jsonb_build_object('notes', p_notes, 'feedback', p_feedback, 'terms', p_terms), p_notes,
          nullif(p_terms->>'annual_spend_forecast', '')::numeric, null, null, coalesce(r.market, s.market), coalesce(r.region, s.region),
          '/assure/pre-assessments/' || p_id, 'finance', 'assure', 'requester', '{}',
          format('Standard is %s days or more; proposed %s', v_std, coalesce(v_days::text || ' days', 'no day count')));
        return r.status;
      end if;
    end if;
  end if;
  return public._core_assure_pa_transition(p_id, p_action, p_notes, p_feedback, p_terms);
end $$;

-- ===========================================================================
-- Shopper IQ
-- ===========================================================================
alter function public.siq_record_effectiveness(jsonb) rename to _core_siq_record_effectiveness;
create function public.siq_record_effectiveness(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public._core_siq_record_effectiveness(p);
begin
  update public.siq_effectiveness set verification_status = 'pending' where id = v_id;
  return v_id;
end $$;

alter function public.siq_add_asset(jsonb) rename to _core_siq_add_asset;
create function public.siq_add_asset(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public._core_siq_add_asset(p);
begin
  update public.siq_assets set rights_status = 'pending' where id = v_id;
  return v_id;
end $$;

create or replace function public.siq_effectiveness_can_verify(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e public.siq_effectiveness; pol record;
begin
  if not public.is_internal() then return false; end if;
  select * into e from public.siq_effectiveness where id = p_id;
  if e.id is null or e.verification_status <> 'pending' then return false; end if;
  select * into pol from public._approval_policy('SIQ_EFFECTIVENESS', (select client_id from public.campaigns where id = e.campaign_id), public._market_code(e.market), null);
  return public.approval_has_role(coalesce(pol.approver_role, 'internal'), 'shopper-iq') and not (coalesce(pol.maker_checker, true) and e.created_by = auth.uid());
end $$;

create or replace function public.siq_verify_effectiveness(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.siq_effectiveness; pol record;
begin
  perform public._briefing_require_internal();
  select * into e from public.siq_effectiveness where id = p_id for update;
  if e.id is null then raise exception 'Result not found'; end if;
  if e.verification_status <> 'pending' then raise exception 'This result is already %', e.verification_status; end if;
  select * into pol from public._approval_policy('SIQ_EFFECTIVENESS', (select client_id from public.campaigns where id = e.campaign_id), public._market_code(e.market), null);
  if coalesce(pol.maker_checker, true) and e.created_by = auth.uid() then raise exception 'You recorded this result, so someone else must verify it' using errcode = '42501'; end if;
  if not public.approval_has_role(coalesce(pol.approver_role, 'internal'), 'shopper-iq') then
    raise exception 'Results are verified by %', lower(public.approval_role_label(pol.approver_role)) using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose verify or reject'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say what is wrong with the figures'; end if;
  update public.siq_effectiveness set verification_status = case when p_approve then 'verified' else 'rejected' end, verified_by = auth.uid(), verified_at = now(),
    verification_note = nullif(trim(p_note), '') where id = p_id;
  perform public._approval_decision('shopper-iq', 'SIQ_EFFECTIVENESS', 'siq_effectiveness', p_id::text, case when p_approve then 'approved' else 'rejected' end, p_note, pol.record_id);
  if e.created_by is not null then
    perform public.notify(e.created_by, 'shopper-iq', case when p_approve then 'Result verified' else 'Result rejected' end, nullif(trim(p_note), ''), '/shopper-iq/campaigns');
  end if;
end $$;

create or replace function public.siq_asset_can_signoff(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare a public.siq_assets; pol record;
begin
  if not public.is_internal() then return false; end if;
  select * into a from public.siq_assets where id = p_id;
  if a.id is null or a.rights_status <> 'pending' then return false; end if;
  select * into pol from public._approval_policy('SIQ_ASSET', (select client_id from public.campaigns where id = a.campaign_id), public._market_code(a.market), null);
  return public.approval_has_role(coalesce(pol.approver_role, 'internal'), 'shopper-iq') and not (coalesce(pol.maker_checker, true) and a.created_by = auth.uid());
end $$;

create or replace function public.siq_asset_signoff(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.siq_assets; pol record;
begin
  perform public._briefing_require_internal();
  select * into a from public.siq_assets where id = p_id for update;
  if a.id is null then raise exception 'Asset not found'; end if;
  if a.rights_status <> 'pending' then raise exception 'This asset is already %', a.rights_status; end if;
  select * into pol from public._approval_policy('SIQ_ASSET', (select client_id from public.campaigns where id = a.campaign_id), public._market_code(a.market), null);
  if coalesce(pol.maker_checker, true) and a.created_by = auth.uid() then raise exception 'You added this asset, so someone else must sign off its rights' using errcode = '42501'; end if;
  if not public.approval_has_role(coalesce(pol.approver_role, 'internal'), 'shopper-iq') then
    raise exception 'Asset rights are signed off by %', lower(public.approval_role_label(pol.approver_role)) using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the asset can''t be reused'; end if;
  update public.siq_assets set rights_status = case when p_approve then 'approved' else 'rejected' end, rights_by = auth.uid(), rights_at = now(),
    rights_note = nullif(trim(p_note), '') where id = p_id;
  perform public._approval_decision('shopper-iq', 'SIQ_ASSET', 'siq_asset', p_id::text, case when p_approve then 'approved' else 'rejected' end, p_note, pol.record_id);
end $$;

-- Views pick up the new columns (they were created with e.* / a.*).
drop view if exists public.siq_effectiveness_v;
create view public.siq_effectiveness_v with (security_invoker = true) as
  select e.*, c.name as campaign_name, c.campaign_code, c.client, c.brands, c.campaign_type, c.activation_objective,
    tp.code as touchpoint_code, tp.name as touchpoint_name, st.code as p2p_stage_code, st.name as p2p_stage_name,
    public.siq_effectiveness_can_verify(e.id) as can_verify
  from public.siq_effectiveness e
  join public.campaigns c on c.id = e.campaign_id
  join public.library_records tp on tp.id = e.touchpoint_id
  left join public.library_records st on st.id = e.p2p_stage_id;
drop view if exists public.siq_assets_v;
create view public.siq_assets_v with (security_invoker = true) as
  select a.*, c.name as campaign_name, c.client, tp.name as touchpoint_name, st.name as p2p_stage_name,
    public.siq_asset_can_signoff(a.id) as can_signoff
  from public.siq_assets a
  left join public.campaigns c on c.id = a.campaign_id
  left join public.library_records tp on tp.id = a.touchpoint_id
  left join public.library_records st on st.id = a.p2p_stage_id;
-- What Briefing+ may reuse: assets with a rights/brand sign-off.
create or replace view public.siq_assets_available with (security_invoker = true) as
  select * from public.siq_assets_v where rights_status = 'approved';
revoke insert, update, delete on public.siq_effectiveness_v, public.siq_assets_v, public.siq_assets_available from authenticated, anon;

-- Client Portal: only verified results.
create or replace function public.client_portal_effectiveness(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'campaign_id', c.id, 'campaign_name', c.name, 'campaign_code', c.campaign_code,
      'region', e.region, 'market', e.market, 'touchpoint', tp.name, 'p2p_stage', st.name, 'channel', e.channel,
      'period_start', e.period_start, 'period_end', e.period_end, 'spend', e.spend, 'currency', e.currency, 'units', e.units,
      'execution_score', e.execution_score, 'uplift_pct', e.uplift_pct, 'uplift_source', e.uplift_source)
      order by c.name, e.market, tp.name), '[]'::jsonb)
    from public.siq_effectiveness e join public.campaigns c on c.id = e.campaign_id
    join public.library_records tp on tp.id = e.touchpoint_id left join public.library_records st on st.id = e.p2p_stage_id
   where c.client_id = any (v) and e.verification_status = 'verified');
end $$;

create or replace function public.client_portal_report(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); v_sus jsonb;
begin
  with x2 as (
    select s.id, s.market, max(s.co2e_total_kg) co2e, sum(el.quantity) qty
      from public.estimate_lines el join public.estimates e on e.id = el.estimate_id join public.jobs j on j.id = e.job_id
      join public.job_specs s on s.id = el.spec_id
     where j.client_id = any (v) and e.status = 'approved'
     group by s.id, s.market
  )
  select jsonb_build_object('specs', count(*), 'specs_with_co2e', count(*) filter (where co2e is not null),
      'co2e_kg', coalesce(round(sum(co2e), 1), 0), 'units', coalesce(sum(qty), 0),
      'by_market', coalesce((select jsonb_agg(jsonb_build_object('market', mk, 'co2e_kg', kg, 'specs', n) order by kg desc)
                               from (select market mk, round(sum(co2e), 1) kg, count(*) n from x2 where co2e is not null group by market) y), '[]'::jsonb))
    into v_sus from x2;
  return jsonb_build_object(
    'sustainability', v_sus,
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'currency', currency, 'spend', spend, 'savings', savings, 'estimates', n) order by m, currency), '[]'::jsonb)
      from (select to_char(date_trunc('month', e.approved_at), 'YYYY-MM') m, e.currency, sum(e.sell_price) spend, sum(coalesce(e.savings_vs_benchmark, 0)) savings, count(*) n
              from public.estimates e join public.jobs j on j.id = e.job_id
             where j.client_id = any (v) and e.status = 'approved' and e.approved_at >= date_trunc('month', now()) - interval '11 months'
             group by 1, 2) s),
    'by_market', (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'market', market, 'currency', currency, 'spend', spend, 'savings', savings, 'estimates', n) order by spend desc), '[]'::jsonb)
      from (select e.region, e.market, e.currency, sum(e.sell_price) spend, sum(coalesce(e.savings_vs_benchmark, 0)) savings, count(*) n
              from public.estimates e join public.jobs j on j.id = e.job_id
             where j.client_id = any (v) and e.status = 'approved' group by 1, 2, 3) s),
    'effectiveness', (select coalesce(jsonb_agg(jsonb_build_object('touchpoint', tp, 'rows', n, 'avg_execution', ex, 'avg_uplift', up, 'measured', measured) order by ex desc nulls last), '[]'::jsonb)
      from (select tp.name tp, count(*) n, round(avg(e.execution_score), 1) ex, round(avg(e.uplift_pct) filter (where e.uplift_source <> 'not_measured'), 1) up,
                   count(*) filter (where e.uplift_source <> 'not_measured') measured
              from public.siq_effectiveness e join public.campaigns c on c.id = e.campaign_id join public.library_records tp on tp.id = e.touchpoint_id
             where c.client_id = any (v) and e.verification_status = 'verified' group by tp.name) s)
  );
end $$;

-- ===========================================================================
-- Grants: cores are never callable directly; wrappers keep the old access.
-- ===========================================================================
revoke execute on function
  public._core_scorecard_activate(uuid, text), public._core_admin_set_user_access(uuid, text, text, boolean, uuid),
  public._core_sourcing_set_access(uuid, boolean, boolean, int), public._core_client_access_grant(uuid, uuid, text),
  public._core_rfq_award(uuid, uuid, text, text), public._core_rfq_send(uuid), public._core_rfq_finance_decide(uuid, boolean, text),
  public._core_spec_triage_override(uuid, text, text), public._core_sourcing_update_settings(numeric, numeric, numeric, int, text),
  public._core_estimate_send(uuid), public._core_estimate_approve(uuid, text), public._core_po_reject(uuid, text), public._core_po_approve(uuid, text),
  public._core_psa_submit(uuid, uuid), public._core_psa_line_manager_decide(uuid, boolean, text),
  public._core_finance_approve_invoice(uuid, text), public._core_finance_schedule_payment(uuid, jsonb), public._core_finance_bill_cancel(uuid, text),
  public._core_finance_estimate_decide(uuid, boolean, text), public._core_logistics_mark_delivered(uuid, date, text),
  public._core_execution_gate_sign_off(uuid, text, boolean, text), public._core_execution_close_job(uuid, text), public._core_execution_recce_set_status(uuid, text),
  public._core_update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid), public._core_approve_fast_track(uuid, text, date),
  public._core_assure_set_supplier_status(uuid[], text, text), public._core_assure_contract_action(uuid, text, text),
  public._core_assure_set_inspection_result(uuid, text, text), public._core_assure_ncr_close(uuid, text, text),
  public._core_assure_survey_review(uuid, text, text, text), public._core_assure_issue_resolve(uuid, text),
  public._core_assure_pa_transition(uuid, text, text, text, jsonb), public._core_siq_record_effectiveness(jsonb), public._core_siq_add_asset(jsonb),
  public._rfq_award_block(uuid, numeric), public._estimate_confirm_block(uuid),
  public._invoice_doa_block(uuid), public._quality_gate_block(uuid, text),
  public._gate_requester(uuid, text), public._gate_mc_applies(uuid, text), public._ncr_close_block(uuid), public._survey_review_block(uuid),
  public._issue_resolve_block(uuid)
from public, anon, authenticated;

revoke execute on function
  public.scorecard_activate(uuid, text), public.admin_set_user_access(uuid, text, text, boolean, uuid), public.sourcing_set_access(uuid, boolean, boolean, int),
  public.client_access_grant(uuid, uuid, text), public.rfq_award(uuid, uuid, text, text), public.rfq_send(uuid), public.rfq_finance_decide(uuid, boolean, text),
  public.rfq_can_award(uuid), public.spec_triage_override(uuid, text, text), public.sourcing_update_settings(numeric, numeric, numeric, int, text),
  public.estimate_send(uuid), public.estimate_approve(uuid, text), public.estimate_can_confirm(uuid), public.po_reject(uuid, text), public.po_approve(uuid, text),
  public.po_etender_pending(uuid), public.po_etender_can_decide(uuid), public.po_etender_decide(uuid, boolean, text),
  public.psa_submit(uuid, uuid), public.psa_line_manager_decide(uuid, boolean, text), public.psa_line_manager_options(uuid),
  public.finance_approve_invoice(uuid, text), public.finance_schedule_payment(uuid, jsonb), public.finance_bill_cancel(uuid, text),
  public.finance_estimate_decide(uuid, boolean, text), public.logistics_mark_delivered(uuid, date, text),
  public.execution_gate_sign_off(uuid, text, boolean, text), public.execution_close_job(uuid, text), public.execution_recce_set_status(uuid, text),
  public.update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid), public.approve_fast_track(uuid, text, date),
  public.assure_set_supplier_status(uuid[], text, text), public.assure_contract_action(uuid, text, text), public.assure_set_inspection_result(uuid, text, text),
  public.assure_ncr_close(uuid, text, text), public.assure_survey_review(uuid, text, text, text), public.assure_issue_resolve(uuid, text),
  public.assure_pa_transition(uuid, text, text, text, jsonb), public.siq_record_effectiveness(jsonb), public.siq_add_asset(jsonb),
  public.siq_effectiveness_can_verify(uuid), public.siq_verify_effectiveness(uuid, boolean, text), public.siq_asset_can_signoff(uuid),
  public.siq_asset_signoff(uuid, boolean, text)
from public, anon;
grant execute on function
  public.scorecard_activate(uuid, text), public.admin_set_user_access(uuid, text, text, boolean, uuid), public.sourcing_set_access(uuid, boolean, boolean, int),
  public.client_access_grant(uuid, uuid, text), public.rfq_award(uuid, uuid, text, text), public.rfq_send(uuid), public.rfq_finance_decide(uuid, boolean, text),
  public.rfq_can_award(uuid), public.spec_triage_override(uuid, text, text), public.sourcing_update_settings(numeric, numeric, numeric, int, text),
  public.estimate_send(uuid), public.estimate_approve(uuid, text), public.estimate_can_confirm(uuid), public.po_reject(uuid, text), public.po_approve(uuid, text),
  public.po_etender_pending(uuid), public.po_etender_can_decide(uuid), public.po_etender_decide(uuid, boolean, text),
  public.psa_submit(uuid, uuid), public.psa_line_manager_decide(uuid, boolean, text), public.psa_line_manager_options(uuid),
  public.finance_approve_invoice(uuid, text), public.finance_schedule_payment(uuid, jsonb), public.finance_bill_cancel(uuid, text),
  public.finance_estimate_decide(uuid, boolean, text), public.logistics_mark_delivered(uuid, date, text),
  public.execution_gate_sign_off(uuid, text, boolean, text), public.execution_close_job(uuid, text), public.execution_recce_set_status(uuid, text),
  public.update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid), public.approve_fast_track(uuid, text, date),
  public.assure_set_supplier_status(uuid[], text, text), public.assure_contract_action(uuid, text, text), public.assure_set_inspection_result(uuid, text, text),
  public.assure_ncr_close(uuid, text, text), public.assure_survey_review(uuid, text, text, text), public.assure_issue_resolve(uuid, text),
  public.assure_pa_transition(uuid, text, text, text, jsonb), public.siq_record_effectiveness(jsonb), public.siq_add_asset(jsonb),
  public.siq_effectiveness_can_verify(uuid), public.siq_verify_effectiveness(uuid, boolean, text), public.siq_asset_can_signoff(uuid),
  public.siq_asset_signoff(uuid, boolean, text)
to authenticated;
