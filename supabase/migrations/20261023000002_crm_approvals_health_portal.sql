-- CRM (2 of 2): approvals, guards on the client master, health for the Watchtower, and the Client Portal pieces.
--   Approval types (approval_requests, policy-driven through approval_policies; inbox view approvals_crm):
--     CRM_CLIENT_SETUP  new client set-up (credit / KYC check). With an active policy, a client created by a person starts
--                       'pending' and can't be used on jobs until Finance (default role) approves. Without a policy: as before.
--     CRM_TERMS         commercial terms change (markup, GSC commission, rebate, payment terms). Always a request; default
--                       approver: admin or CRM owner (account director), maker-checker. Applied to sourcing_clients on approval,
--                       so Sourcing, Orders and Finance+ read the new values. Direct edits of these columns are refused.
--     CRM_CONTRACT      contract signature or renewal at or above the policy value (default approver admin).
--     CRM_OPP_WON       opportunity marked won at or above the policy value; a sales lead (admin or CRM owner) confirms.
--   Health: watchtower_health_crm (standard shape). Client Portal: client_portal_account_team, client_feedback_submit,
--   client_portal_feedback (client-safe fields only, scoped with _client_scope / _client_actor).

-- ---------------------------------------------------------------------------
-- Platform fix found while wiring CRM approvals: approval_user_has_role() returns NULL (not false) for an internal user
-- without an SRT role (e.g. 'finance' -> is_admin or NULL = 'finance' ...), and approval_request_decide /
-- approval_request_can_decide test "if not approval_has_role(...)", which lets NULL through. approval_has_role now
-- always answers true or false.
-- ---------------------------------------------------------------------------
create or replace function public.approval_has_role(p_role text, p_module text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.approval_user_has_role(auth.uid(), p_role, p_module), false);
$$;

-- ---------------------------------------------------------------------------
-- Client master guards
-- ---------------------------------------------------------------------------
-- Commercial terms and the set-up status change only through CRM's approved requests (crm.system_write) or by seeds and
-- system jobs (no signed-in user). New clients created by a person start pending when a CRM_CLIENT_SETUP policy applies.
create or replace function public.trg_crm_client_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sys boolean := coalesce(current_setting('crm.system_write', true), '') = 'on' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    if not v_sys then
      new.setup_approved_by := null; new.setup_approved_at := null;
      new.crm_setup_status := case when exists (select 1 from public._approval_policy('CRM_CLIENT_SETUP', null, public._market_code(new.hq_market), new.credit_limit))
                                   then 'pending' else 'approved' end;
    end if;
    return new;
  end if;
  if v_sys then return new; end if;
  if new.default_markup_percent is distinct from old.default_markup_percent
     or new.gsc_commission_percent is distinct from old.gsc_commission_percent
     or new.year_end_rebate_percent is distinct from old.year_end_rebate_percent
     or new.payment_terms_days is distinct from old.payment_terms_days then
    raise exception 'Commercial terms (markup, GSC commission, rebate, payment terms) change through CRM: use Request change on the client''s contract and terms so a second person approves it'
      using errcode = '42501';
  end if;
  if new.crm_setup_status is distinct from old.crm_setup_status or new.setup_approved_by is distinct from old.setup_approved_by
     or new.setup_approved_at is distinct from old.setup_approved_at then
    raise exception 'The new client set-up is approved by Finance in the approvals inbox' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sourcing_clients_crm_guard on public.sourcing_clients;
create trigger sourcing_clients_crm_guard before insert or update on public.sourcing_clients for each row execute function public.trg_crm_client_guard();

create or replace function public._crm_open_setup_request(c public.sourcing_clients, p_note text) returns uuid
language sql security definer set search_path = public as $$
  select public._approval_request_open('crm', 'CRM_CLIENT_SETUP', 'client', c.id::text, c.code, 'New client set-up: ' || c.name,
    jsonb_build_object('credit_limit', c.credit_limit, 'hq_market', c.hq_market, 'sector', c.sector), coalesce(nullif(trim(p_note), ''), c.crm_setup_note),
    c.credit_limit, c.default_currency, c.id, c.hq_market, public._crm_region(c.hq_market), '/crm/clients/' || c.id, 'finance', null, 'approver', '{}'::uuid[],
    'Credit and KYC check before ' || c.name || ' can be used on jobs' || coalesce(' (credit limit ' || c.default_currency || ' ' || to_char(c.credit_limit, 'FM999,999,999,990') || ')', ''));
$$;

create or replace function public.trg_crm_client_setup_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.crm_setup_status = 'pending' and auth.uid() is not null and public.is_internal()
     and not exists (select 1 from public.approval_requests where approval_type = 'CRM_CLIENT_SETUP' and entity_id = new.id::text and status in ('pending','applying')) then
    perform public._crm_open_setup_request(new, null);
    insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
    values (new.id, 'client', new.id::text, 'setup_requested', jsonb_build_object('credit_limit', new.credit_limit), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists sourcing_clients_crm_setup on public.sourcing_clients;
create trigger sourcing_clients_crm_setup after insert on public.sourcing_clients for each row execute function public.trg_crm_client_setup_request();

-- A client still waiting for (or refused) its set-up approval can't be used on jobs.
create or replace function public.trg_crm_job_client_ready() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients;
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return new; end if;
  select * into c from public.sourcing_clients where id = new.client_id;
  if c.id is not null and c.crm_setup_status <> 'approved' then
    raise exception '% can''t be used on jobs yet: Finance has to approve the new client set-up (credit and KYC check) first', c.name using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists jobs_crm_client_ready on public.jobs;
create trigger jobs_crm_client_ready before insert or update of client_id on public.jobs for each row execute function public.trg_crm_job_client_ready();

-- Client bills take the client's agreed payment terms (when set) for the due date; otherwise Finance's FR-CLIENT-TERMS.
create or replace function public.trg_crm_bill_terms() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  if new.status = 'sent' and old.status = 'draft' then
    select payment_terms_days into v_days from public.sourcing_clients where id = new.client_id;
    if v_days is not null then new.due_date := coalesce(new.issue_date, current_date) + v_days; end if;
  end if;
  return new;
end $$;
drop trigger if exists client_bills_crm_terms on public.client_bills;
create trigger client_bills_crm_terms before update of status on public.client_bills for each row execute function public.trg_crm_bill_terms();

-- ---------------------------------------------------------------------------
-- New client set-up from CRM
-- ---------------------------------------------------------------------------
create or replace function public.crm_client_create(p_code text, p_name text, p_currency text, p_hq_market text, p_sector text,
  p_credit_limit numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text := public._market_code(p_hq_market);
begin
  perform public._crm_require();
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'Enter a client code and name'; end if;
  if exists (select 1 from public.sourcing_clients where lower(code) = lower(trim(p_code))) then raise exception 'Client code % is already in use', upper(trim(p_code)); end if;
  if v_market is not null and not exists (select 1 from public.markets where code = v_market) then raise exception 'Choose a market from the market master'; end if;
  if p_credit_limit is not null and p_credit_limit < 0 then raise exception 'The credit limit can''t be negative'; end if;
  insert into public.sourcing_clients (code, name, default_currency, hq_market, sector, credit_limit, crm_setup_note)
  values (upper(trim(p_code)), trim(p_name), coalesce(nullif(upper(trim(p_currency)), ''), 'EUR'), v_market, nullif(trim(p_sector), ''), p_credit_limit, nullif(trim(p_note), ''))
  returning id into v_id;
  perform public._crm_event(v_id, 'client', v_id::text, 'created', jsonb_build_object('code', upper(trim(p_code)), 'credit_limit', p_credit_limit,
    'setup_status', (select crm_setup_status from public.sourcing_clients where id = v_id)));
  return v_id;
end $$;

-- Ask again after a rejected (or withdrawn) set-up request.
create or replace function public.crm_client_setup_resubmit(p_client uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients; v_id uuid;
begin
  perform public._crm_require();
  select * into c from public.sourcing_clients where id = p_client;
  if c.id is null then raise exception 'Client not found'; end if;
  if c.crm_setup_status = 'approved' then raise exception '% is already approved', c.name; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what changed since the last check'; end if;
  v_id := public._crm_open_setup_request(c, p_note);
  perform public._crm_event(p_client, 'client', p_client::text, 'setup_requested', jsonb_build_object('note', trim(p_note)));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Commercial terms change (always a request; applied on approval)
-- ---------------------------------------------------------------------------
create or replace function public.crm_terms_request(p_client uuid, p_markup numeric, p_commission numeric, p_rebate numeric,
  p_payment_terms_days int, p_reason text, p_contract uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients; v_changes text[] := '{}';
begin
  perform public._crm_require();
  select * into c from public.sourcing_clients where id = p_client;
  if c.id is null then raise exception 'Client not found'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the terms are changing'; end if;
  if p_markup is null or p_markup < 0 or p_markup > 500 then raise exception 'Markup is a percentage from 0 to 500'; end if;
  if p_commission is null or p_commission < 0 or p_commission > 50 then raise exception 'GSC commission is a percentage from 0 to 50'; end if;
  if p_rebate is null or p_rebate < 0 or p_rebate > 50 then raise exception 'Rebate is a percentage from 0 to 50'; end if;
  if p_payment_terms_days is not null and (p_payment_terms_days < 0 or p_payment_terms_days > 365) then raise exception 'Payment terms are 0 to 365 days'; end if;
  if p_contract is not null and not exists (select 1 from public.crm_contracts where id = p_contract and client_id = p_client) then
    raise exception 'The contract must belong to the same client';
  end if;
  if p_markup is distinct from c.default_markup_percent then v_changes := v_changes || ('markup ' || c.default_markup_percent || '% -> ' || p_markup || '%'); end if;
  if p_commission is distinct from c.gsc_commission_percent then v_changes := v_changes || ('GSC commission ' || c.gsc_commission_percent || '% -> ' || p_commission || '%'); end if;
  if p_rebate is distinct from c.year_end_rebate_percent then v_changes := v_changes || ('rebate ' || c.year_end_rebate_percent || '% -> ' || p_rebate || '%'); end if;
  if p_payment_terms_days is distinct from c.payment_terms_days then
    v_changes := v_changes || ('payment terms ' || coalesce(c.payment_terms_days || ' days', 'Finance default') || ' -> ' || coalesce(p_payment_terms_days || ' days', 'Finance default'));
  end if;
  if cardinality(v_changes) = 0 then raise exception 'Nothing changes: these are the current terms'; end if;
  perform public._crm_event(p_client, 'client', p_client::text, 'terms_change_requested', jsonb_build_object('changes', to_jsonb(v_changes), 'reason', trim(p_reason)));
  return public._approval_request_open('crm', 'CRM_TERMS', 'client_terms', p_client::text, c.code, 'Commercial terms change: ' || c.name,
    jsonb_build_object('markup', p_markup, 'commission', p_commission, 'rebate', p_rebate, 'payment_terms_days', p_payment_terms_days, 'contract_id', p_contract,
      'before', jsonb_build_object('markup', c.default_markup_percent, 'commission', c.gsc_commission_percent, 'rebate', c.year_end_rebate_percent,
        'payment_terms_days', c.payment_terms_days)),
    p_reason, null, c.default_currency, c.id, c.hq_market, public._crm_region(c.hq_market), '/crm/clients/' || c.id || '?tab=contract',
    'module_owner', 'crm', 'approver', '{}'::uuid[], array_to_string(v_changes, '; '));
end $$;

-- ---------------------------------------------------------------------------
-- Contract signature and renewal (CRM_CONTRACT policy by value)
-- ---------------------------------------------------------------------------
create or replace function public.crm_contract_sign(p_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare k public.crm_contracts; v_applying boolean := public._approval_applying('CRM_CONTRACT', p_id::text); v_by uuid;
begin
  perform public._crm_require();
  select * into k from public.crm_contracts where id = p_id for update;
  if k.id is null then raise exception 'Contract not found'; end if;
  if k.status <> 'draft' then raise exception 'This contract is already %', k.status; end if;
  if k.start_date is null then raise exception 'Enter the start date before signing'; end if;
  if not v_applying and exists (select 1 from public._approval_policy('CRM_CONTRACT', k.client_id, null, k.value)) then
    perform public._approval_request_open('crm', 'CRM_CONTRACT', 'contract', p_id::text, k.contract_code, 'Sign contract: ' || k.title,
      jsonb_build_object('action', 'sign', 'note', nullif(trim(p_note), '')), p_note, k.value, k.currency, k.client_id, null, null,
      '/crm/contracts?contract=' || p_id, 'admin', null, 'requester', '{}'::uuid[], upper(k.contract_type) || ' signature');
    perform public._crm_event(k.client_id, 'contract', p_id::text, 'signature_requested', jsonb_build_object('value', k.value));
    return 'pending';
  end if;
  if v_applying then
    select decided_by into v_by from public.approval_requests where approval_type = 'CRM_CONTRACT' and entity_id = p_id::text and status = 'applying';
  end if;
  update public.crm_contracts set status = 'signed', signed_at = now(), signed_by = auth.uid(), approved_by = v_by,
    renewal_date = coalesce(renewal_date, end_date) where id = p_id;
  perform public._crm_event(k.client_id, 'contract', p_id::text, 'signed', jsonb_build_object('approved_by', v_by, 'note', nullif(trim(p_note), '')));
  return 'signed';
end $$;

create or replace function public.crm_contract_renew(p_id uuid, p_end date, p_value numeric, p_renewal date default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare k public.crm_contracts; v_applying boolean := public._approval_applying('CRM_CONTRACT', p_id::text); v_by uuid;
begin
  perform public._crm_require();
  select * into k from public.crm_contracts where id = p_id for update;
  if k.id is null then raise exception 'Contract not found'; end if;
  if k.status <> 'signed' then raise exception 'Only a signed contract can be renewed'; end if;
  if p_end is null or (k.end_date is not null and p_end <= k.end_date) then raise exception 'The new end date must be after the current one'; end if;
  if p_value is not null and p_value < 0 then raise exception 'The value can''t be negative'; end if;
  if not v_applying and exists (select 1 from public._approval_policy('CRM_CONTRACT', k.client_id, null, coalesce(p_value, k.value))) then
    perform public._approval_request_open('crm', 'CRM_CONTRACT', 'contract', p_id::text, k.contract_code, 'Renew contract: ' || k.title,
      jsonb_build_object('action', 'renew', 'end_date', p_end, 'renewal_date', p_renewal, 'value', p_value, 'note', nullif(trim(p_note), '')), p_note,
      coalesce(p_value, k.value), k.currency, k.client_id, null, null, '/crm/contracts?contract=' || p_id, 'admin', null, 'requester', '{}'::uuid[],
      'Renewal to ' || to_char(p_end, 'DD Mon YYYY'));
    perform public._crm_event(k.client_id, 'contract', p_id::text, 'renewal_requested', jsonb_build_object('end_date', p_end, 'value', p_value));
    return 'pending';
  end if;
  if v_applying then
    select decided_by into v_by from public.approval_requests where approval_type = 'CRM_CONTRACT' and entity_id = p_id::text and status = 'applying';
  end if;
  update public.crm_contracts set end_date = p_end, renewal_date = coalesce(p_renewal, p_end), value = coalesce(p_value, value),
    renewal_count = renewal_count + 1, approved_by = coalesce(v_by, approved_by) where id = p_id;
  perform public._crm_event(k.client_id, 'contract', p_id::text, 'renewed', jsonb_build_object('end_date', jsonb_build_array(k.end_date, p_end),
    'value', jsonb_build_array(k.value, coalesce(p_value, k.value)), 'approved_by', v_by));
  return 'renewed';
end $$;

-- ---------------------------------------------------------------------------
-- Applying approved CRM requests. The shared apply function is wrapped (renamed, same signature) so the other modules'
-- approval types keep working unchanged.
-- ---------------------------------------------------------------------------
create or replace function public._crm_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := current_setting('request.jwt.claim.sub', true); p jsonb := r.payload; c public.sourcing_clients;
begin
  if r.run_as = 'requester' then
    if r.requested_by is null then raise exception 'The person who asked no longer exists, so this can''t be applied'; end if;
    perform set_config('request.jwt.claim.sub', r.requested_by::text, true);
  end if;
  case r.approval_type
    when 'CRM_CLIENT_SETUP' then
      perform set_config('crm.system_write', 'on', true);
      update public.sourcing_clients set crm_setup_status = 'approved', setup_approved_by = r.decided_by, setup_approved_at = now()
       where id = r.entity_id::uuid returning * into c;
      perform set_config('crm.system_write', 'off', true);
      insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
      values (c.id, 'client', c.id::text, 'setup_approved', jsonb_build_object('request', r.request_no, 'note', r.decision_note), r.decided_by);
    when 'CRM_TERMS' then
      perform set_config('crm.system_write', 'on', true);
      update public.sourcing_clients set default_markup_percent = (p->>'markup')::numeric, gsc_commission_percent = (p->>'commission')::numeric,
        year_end_rebate_percent = (p->>'rebate')::numeric, payment_terms_days = nullif(p->>'payment_terms_days', '')::int
       where id = r.entity_id::uuid returning * into c;
      perform set_config('crm.system_write', 'off', true);
      if nullif(p->>'contract_id', '') is not null then
        update public.crm_contracts set markup_percent = (p->>'markup')::numeric, gsc_commission_percent = (p->>'commission')::numeric,
          rebate_percent = (p->>'rebate')::numeric, payment_terms_days = nullif(p->>'payment_terms_days', '')::int, updated_at = now()
         where id = (p->>'contract_id')::uuid and client_id = c.id;
      end if;
      insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
      values (c.id, 'client', c.id::text, 'terms_changed', p || jsonb_build_object('request', r.request_no, 'requested_by', r.requested_by), r.decided_by);
    when 'CRM_CONTRACT' then
      if p->>'action' = 'renew' then
        perform public.crm_contract_renew(r.entity_id::uuid, (p->>'end_date')::date, nullif(p->>'value', '')::numeric, nullif(p->>'renewal_date', '')::date, p->>'note');
      else
        perform public.crm_contract_sign(r.entity_id::uuid, p->>'note');
      end if;
    when 'CRM_OPP_WON' then
      perform public.crm_opportunity_move(r.entity_id::uuid, 'won', p->>'note', null);
    else raise exception 'Unknown approval type %', r.approval_type;
  end case;
  if r.run_as = 'requester' then perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true); end if;
end $$;

alter function public._approval_request_apply(public.approval_requests) rename to _approval_request_apply_before_crm;
create function public._approval_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
begin
  if r.approval_type like 'CRM\_%' then perform public._crm_request_apply(r);
  else perform public._approval_request_apply_before_crm(r);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Approvals inbox: pending CRM requests in the standard shape (incl. market, market_name and can_decide)
-- ---------------------------------------------------------------------------
create or replace view public.approvals_crm with (security_invoker = true) as
  select * from public.approval_requests_pending_v where module = 'crm';
revoke all on public.approvals_crm from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Watchtower health (standard shape)
-- ---------------------------------------------------------------------------
create view public.watchtower_health_crm with (security_invoker = true) as
  with red as (select count(*)::numeric n from public.crm_client_health where active and rag = 'red'),
  ren as (select count(*)::numeric n from public.crm_contracts where status = 'signed'
            and coalesce(renewal_date, end_date) between current_date and current_date + 90),
  pipe as (select coalesce(sum(value * probability / 100.0), 0)::numeric v from public.crm_opportunities where stage not in ('won','lost')),
  tgt as (select coalesce(sum(growth_target), 0)::numeric t from public.crm_account_plans where status = 'active'),
  bills as (select count(*)::numeric n from public.client_bills where status = 'sent' and due_date < current_date),
  quiet as (select count(*)::numeric n from public.sourcing_clients c
             where c.active and exists (select 1 from public.crm_accounts a where a.client_id = c.id and a.status in ('active','prospect'))
               and not exists (select 1 from public.crm_interactions i where i.client_id = c.id and i.occurred_at >= now() - interval '60 days'))
  select * from (
  select 'crm'::text as module, 'accounts_red'::text as metric, 'Clients at red health'::text as label, red.n as value, 0::numeric as target,
         case when red.n = 0 then 'ok' when red.n <= 1 then 'warn' else 'bad' end as status from red
  union all select 'crm', 'renewals_due_90d', 'Contract renewals due in the next 90 days', ren.n, 0, case when ren.n = 0 then 'ok' else 'warn' end from ren
  union all select 'crm', 'pipeline_vs_target', 'Weighted pipeline against account plan growth targets', round(pipe.v, 0), round(tgt.t, 0),
         case when pipe.v >= tgt.t then 'ok' when pipe.v >= tgt.t * 0.7 then 'warn' else 'bad' end from pipe, tgt
  union all select 'crm', 'overdue_client_bills', 'Client bills overdue', bills.n, 0, case when bills.n = 0 then 'ok' when bills.n <= 2 then 'warn' else 'bad' end from bills
  union all select 'crm', 'clients_no_activity_60d', 'Clients with no activity in 60 days', quiet.n, 0, case when quiet.n = 0 then 'ok' when quiet.n <= 2 then 'warn' else 'bad' end from quiet
  ) h where public.is_internal();   -- internal staff only (the counts would otherwise show as zeros to others)
revoke insert, update, delete on public.watchtower_health_crm from authenticated, anon;
revoke all on public.watchtower_health_crm from anon;

-- ---------------------------------------------------------------------------
-- Client Portal: account team and feedback (client-safe fields only)
-- ---------------------------------------------------------------------------
-- Who looks after the client: the account lead per market (name and work email only).
create or replace function public.client_portal_account_team(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('client_name', c.name, 'market', a.market, 'market_name', m.name,
      'lead_name', coalesce(nullif(p.full_name, ''), p.email), 'lead_email', p.email) order by c.name, m.name), '[]'::jsonb)
    from public.crm_accounts a join public.sourcing_clients c on c.id = a.client_id
    join public.profiles p on p.id = a.account_lead left join public.markets m on m.code = a.market
   where a.client_id = any (v) and a.status in ('active','prospect'));
end $$;

-- A client user (approver or viewer) rates adm Indicia 0-10 with an optional comment, for one of their own accounts.
create or replace function public.client_feedback_submit(p_client uuid, p_score int, p_comment text default null, p_market text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text := public._market_code(p_market); v_account uuid; v_name text; c public.sourcing_clients;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if public.is_internal() then raise exception 'Preview is read-only: capture feedback for the client in CRM' using errcode = '42501'; end if;
  if p_client is null or public.my_client_role(p_client) is null then raise exception 'You do not have access to that account' using errcode = '42501'; end if;
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'Choose a score from 0 to 10'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  if v_market is not null then
    select id into v_account from public.crm_accounts where client_id = p_client and market = v_market;
    if v_account is null then v_market := null; end if;
  end if;
  if exists (select 1 from public.crm_feedback where client_id = p_client and submitted_by = auth.uid() and source = 'client_portal' and created_at > now() - interval '1 minute') then
    raise exception 'Thanks, we already have your feedback. Try again in a minute if you want to add more.';
  end if;
  insert into public.crm_feedback (client_id, account_id, market, score, comment, source, submitted_by)
  values (p_client, v_account, v_market, p_score, nullif(trim(p_comment), ''), 'client_portal', auth.uid())
  returning id into v_id;
  insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
  values (p_client, 'feedback', v_id::text, 'submitted_in_portal', jsonb_build_object('score', p_score), auth.uid());
  select * into c from public.sourcing_clients where id = p_client;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public.notify(u, 'crm', format('%s rated adm Indicia %s/10', v_name, p_score), coalesce(left(nullif(trim(p_comment), ''), 140), c.name), '/crm/feedback')
    from (select distinct a.account_lead u from public.crm_accounts a where a.client_id = p_client and a.account_lead is not null
           and (v_account is null or a.id = v_account)) t;
  return v_id;
end $$;

-- The client's own portal feedback history (their account(s) only).
create or replace function public.client_portal_feedback(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'client_name', c.name, 'market', f.market, 'score', f.score, 'comment', f.comment,
      'created_at', f.created_at, 'author_name', coalesce(nullif(p.full_name, ''), p.email, 'Client'), 'followed_up', f.followed_up_at is not null)
      order by f.created_at desc), '[]'::jsonb)
    from public.crm_feedback f join public.sourcing_clients c on c.id = f.client_id left join public.profiles p on p.id = f.submitted_by
   where f.client_id = any (v) and f.source = 'client_portal');
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.trg_crm_client_guard(), public.trg_crm_client_setup_request(), public.trg_crm_job_client_ready(), public.trg_crm_bill_terms(),
  public._crm_open_setup_request(public.sourcing_clients, text), public._crm_request_apply(public.approval_requests),
  public._approval_request_apply(public.approval_requests), public._approval_request_apply_before_crm(public.approval_requests)
  from public, anon, authenticated;
revoke execute on function public.crm_client_create(text, text, text, text, text, numeric, text), public.crm_client_setup_resubmit(uuid, text),
  public.crm_terms_request(uuid, numeric, numeric, numeric, int, text, uuid), public.crm_contract_sign(uuid, text),
  public.crm_contract_renew(uuid, date, numeric, date, text), public.client_portal_account_team(uuid), public.client_feedback_submit(uuid, int, text, text),
  public.client_portal_feedback(uuid) from public, anon;
grant execute on function public.crm_client_create(text, text, text, text, text, numeric, text), public.crm_client_setup_resubmit(uuid, text),
  public.crm_terms_request(uuid, numeric, numeric, numeric, int, text, uuid), public.crm_contract_sign(uuid, text),
  public.crm_contract_renew(uuid, date, numeric, date, text), public.client_portal_account_team(uuid), public.client_feedback_submit(uuid, int, text, text),
  public.client_portal_feedback(uuid) to authenticated;
