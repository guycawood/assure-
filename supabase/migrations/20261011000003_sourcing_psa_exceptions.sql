-- Variable PSA exceptions (Order Management+): request -> line manager -> procurement SME -> delegated approver -> applied by FSSC/CST.
-- Rebuilt from the prototype PsaException workflow; every step is a security-definer function that checks the person and the stage.

create sequence public.psa_number_seq;

create table public.psa_exceptions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  title text not null check (length(trim(title)) > 0),
  stage text not null default 'draft' check (stage in ('draft','line_manager','procurement','approver','to_apply','applied','resolved','rejected')),
  supplier_id uuid references public.suppliers(id),
  job_id uuid references public.jobs(id),
  po_id uuid references public.purchase_orders(id),
  fee numeric(14,2) not null check (fee >= 0),
  currency text not null default 'EUR',
  business_reason text not null check (length(trim(business_reason)) > 0),
  region text check (region in ('APAC','EMEA','Americas','GSC')),
  market text,
  requester uuid not null references public.profiles(id),
  submitted_at timestamptz,
  line_manager uuid references public.profiles(id),
  lm_notes text,
  lm_decided_at timestamptz,
  outcome text check (outcome in ('supplier_cooperation','alternative_supplier','exception_confirmed')),
  assessed_by uuid references public.profiles(id),
  assess_notes text,
  value_impact numeric(14,2),
  assessed_at timestamptz,
  required_doa_level int,
  approver uuid references public.profiles(id),
  approver_level int,
  approver_notes text,
  approved_at timestamptz,
  applied_by uuid references public.profiles(id),
  applied_at timestamptz,
  follow_up_actions text,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index psa_exceptions_stage_idx on public.psa_exceptions (stage, created_at desc);

create or replace function public._psa_event(p public.psa_exceptions, p_event text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  select public._sourcing_event(p.job_id, 'psa', p.id, p_event, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('reference', p.reference));
$$;

create or replace function public.psa_create(p_title text, p_supplier uuid, p_job uuid, p_po uuid, p_fee numeric, p_currency text,
  p_business_reason text, p_region text, p_market text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions; j public.jobs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can raise PSA exceptions' using errcode = '42501'; end if;
  if p_fee is null or p_fee < 0 then raise exception 'Enter the fee'; end if;
  if p_job is not null then select * into j from public.jobs where id = p_job; end if;
  insert into public.psa_exceptions (reference, title, supplier_id, job_id, po_id, fee, currency, business_reason, region, market, requester)
  values ('PSA-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.psa_number_seq')::text, 5, '0'), trim(p_title), p_supplier, p_job, p_po,
          p_fee, coalesce(nullif(p_currency, ''), 'EUR'), trim(p_business_reason), coalesce(j.region, p_region), coalesce(j.market, p_market), auth.uid())
  returning * into v;
  perform public._psa_event(v, 'created', jsonb_build_object('fee', p_fee));
  return v.id;
end $$;

create or replace function public.psa_submit(p_id uuid, p_line_manager uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions;
begin
  select * into v from public.psa_exceptions where id = p_id for update;
  if v.id is null or v.requester <> auth.uid() then raise exception 'Only the requester can submit this request' using errcode = '42501'; end if;
  if v.stage <> 'draft' then raise exception 'This request has already been submitted'; end if;
  if p_line_manager = auth.uid() then raise exception 'Choose your line manager, not yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_line_manager and (user_type = 'internal' or is_admin)) then raise exception 'Choose an internal line manager'; end if;
  update public.psa_exceptions set stage = 'line_manager', line_manager = p_line_manager, submitted_at = now(), updated_at = now() where id = p_id returning * into v;
  perform public._psa_event(v, 'submitted', '{}'::jsonb);
end $$;

create or replace function public.psa_line_manager_decide(p_id uuid, p_approve boolean, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions;
begin
  select * into v from public.psa_exceptions where id = p_id for update;
  if v.id is null or v.stage <> 'line_manager' then raise exception 'This request is not waiting for a line manager'; end if;
  if v.line_manager is distinct from auth.uid() then raise exception 'Only the named line manager can verify this request' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_notes), '') = '' then raise exception 'Say why it is rejected'; end if;
  update public.psa_exceptions set stage = case when p_approve then 'procurement' else 'rejected' end, lm_notes = p_notes, lm_decided_at = now(),
    rejected_reason = case when p_approve then null else p_notes end, updated_at = now() where id = p_id returning * into v;
  perform public._psa_event(v, case when p_approve then 'line_manager_approved' else 'line_manager_rejected' end, jsonb_build_object('notes', p_notes));
end $$;

create or replace function public.psa_assess(p_id uuid, p_outcome text, p_notes text, p_value_impact numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions; v_req int;
begin
  if not (public.my_srt_role() = 'procurement' or public.sourcing_is_lead()) then
    raise exception 'Only a regional procurement SME or sourcing lead can assess PSA requests' using errcode = '42501';
  end if;
  select * into v from public.psa_exceptions where id = p_id for update;
  if v.id is null or v.stage <> 'procurement' then raise exception 'This request is not waiting for procurement'; end if;
  if v.requester = auth.uid() then raise exception 'You can''t assess your own request'; end if;
  if p_outcome not in ('supplier_cooperation','alternative_supplier','exception_confirmed') then raise exception 'Choose an outcome'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Record what procurement did'; end if;
  if p_outcome = 'exception_confirmed' then
    select level into v_req from public.doa_required_level(v.fee, v.currency, current_date);
  end if;
  update public.psa_exceptions set outcome = p_outcome, assess_notes = p_notes, value_impact = p_value_impact, assessed_by = auth.uid(), assessed_at = now(),
    stage = case when p_outcome = 'exception_confirmed' then 'approver' else 'resolved' end, required_doa_level = v_req, updated_at = now()
   where id = p_id returning * into v;
  perform public._psa_event(v, 'assessed', jsonb_build_object('outcome', p_outcome, 'value_impact', p_value_impact));
end $$;

create or replace function public.psa_approve(p_id uuid, p_approve boolean, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions; v_level int := public.sourcing_doa_level();
begin
  select * into v from public.psa_exceptions where id = p_id for update;
  if v.id is null or v.stage <> 'approver' then raise exception 'This request is not waiting for a delegated approver'; end if;
  if v.requester = auth.uid() then raise exception 'You can''t approve your own request'; end if;
  if v_level is null then raise exception 'You have no delegated approval authority in Sourcing+' using errcode = '42501'; end if;
  if v_level < v.required_doa_level then raise exception 'This exception needs DOA level % approval; your level is %', v.required_doa_level, v_level using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_notes), '') = '' then raise exception 'Say why it is rejected'; end if;
  update public.psa_exceptions set stage = case when p_approve then 'to_apply' else 'rejected' end, approver = auth.uid(), approver_level = v_level,
    approver_notes = p_notes, approved_at = now(), rejected_reason = case when p_approve then null else p_notes end, updated_at = now()
   where id = p_id returning * into v;
  perform public._psa_event(v, case when p_approve then 'approved' else 'rejected' end, jsonb_build_object('notes', p_notes, 'level', v_level));
end $$;

create or replace function public.psa_apply(p_id uuid, p_follow_up text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.psa_exceptions;
begin
  if not public.sourcing_is_finance() then raise exception 'Only Finance (FSSC / CST) can apply a fee exception' using errcode = '42501'; end if;
  select * into v from public.psa_exceptions where id = p_id for update;
  if v.id is null or v.stage <> 'to_apply' then raise exception 'This exception is not ready to apply'; end if;
  update public.psa_exceptions set stage = 'applied', applied_by = auth.uid(), applied_at = now(), follow_up_actions = p_follow_up, updated_at = now()
   where id = p_id returning * into v;
  perform public._psa_event(v, 'applied', jsonb_build_object('follow_up', p_follow_up));
end $$;

create view public.v_psa_exceptions with (security_invoker = true) as
  select x.*, s.name as supplier_name, j.job_number, po.po_number,
         rq.full_name as requester_name, lm.full_name as line_manager_name
    from public.psa_exceptions x
    left join public.suppliers s on s.id = x.supplier_id
    left join public.jobs j on j.id = x.job_id
    left join public.purchase_orders po on po.id = x.po_id
    left join public.profiles rq on rq.id = x.requester
    left join public.profiles lm on lm.id = x.line_manager;

alter table public.psa_exceptions enable row level security;
create policy psa_read on public.psa_exceptions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.psa_exceptions, public.v_psa_exceptions from authenticated, anon;
revoke execute on function public._psa_event(public.psa_exceptions, text, jsonb) from public, anon, authenticated;
