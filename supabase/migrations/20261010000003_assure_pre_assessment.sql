-- Assure+ vendor pre-assessment and its two-stage review.
-- Status flow (legal transitions only, enforced in assure_pa_transition):
--   draft -> submitted (vendor) -> under_review (vendor manager) -> vm_approved | vm_rejected
--   vm_approved -> procurement_review (procurement) -> negotiation -> onboarded | rejected
-- The questionnaire (vendor's answers) lives on vendor_pre_assessments. Everything the reviewers write
-- (notes, proposed and agreed NTI and payment terms, tier) lives on the internal-only review table.
-- Separation of duties: whoever approved at the vendor-manager stage cannot confirm onboarding.

create table public.vendor_pre_assessments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  company_name text not null check (length(trim(company_name)) > 0),
  contact_name text,
  contact_email text not null,
  major_category text,
  head_office_country text,
  data jsonb not null default '{}'::jsonb,
  -- decision fields: only via the functions below
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','vm_approved','vm_rejected','procurement_review','negotiation','onboarded','rejected')),
  workflow_stage text not null default 'vendor_manager' check (workflow_stage in ('vendor_manager','procurement_lead','complete')),
  feedback_to_vendor text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vpa_supplier_idx on public.vendor_pre_assessments (supplier_id);
create index vpa_status_idx on public.vendor_pre_assessments (status);
create trigger vpa_region before insert on public.vendor_pre_assessments
  for each row execute function public._assure_fill_region_market();

create table public.vendor_pre_assessment_reviews (
  assessment_id uuid primary key references public.vendor_pre_assessments(id) on delete cascade,
  vm_notes text,
  vm_reviewed_by uuid references public.profiles(id) on delete set null,
  vm_reviewed_at timestamptz,
  procurement_notes text,
  nti_proposed numeric(5,2),
  payment_terms_proposed text check (payment_terms_proposed is null or payment_terms_proposed in ('immediate','net_7','net_15','net_30','net_45','net_60','net_90','custom')),
  payment_terms_days_proposed int,
  annual_spend_forecast numeric(14,2),
  proposed_tier text check (proposed_tier is null or proposed_tier in ('strategic','preferred','approved','transactional','tail')),
  nti_agreed numeric(5,2),
  payment_terms_agreed text,
  payment_terms_days_agreed int,
  tier_agreed text,
  procurement_reviewed_by uuid references public.profiles(id) on delete set null,
  procurement_reviewed_at timestamptz,
  onboarded_by uuid references public.profiles(id) on delete set null,
  onboarded_at timestamptz
);

alter table public.vendor_pre_assessments enable row level security;
alter table public.vendor_pre_assessment_reviews enable row level security;
-- Vendors read their own questionnaire (no internal fields live on it); staff read everything.
create policy vpa_read on public.vendor_pre_assessments for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.vendor_pre_assessments from authenticated, anon;
create policy vpar_read on public.vendor_pre_assessment_reviews for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.vendor_pre_assessment_reviews from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Vendor side: save a draft and submit
-- ---------------------------------------------------------------------------
create or replace function public.assure_pa_save(p_id uuid, p_company text, p_contact_name text, p_contact_email text,
  p_category text, p_country text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); r public.vendor_pre_assessments; v_id uuid;
begin
  if v_sup is null or public.is_internal() then raise exception 'Only a vendor user can fill in a pre-assessment' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.vendor_pre_assessments (supplier_id, company_name, contact_name, contact_email, major_category, head_office_country, data, created_by)
    values (v_sup, trim(p_company), p_contact_name, lower(trim(p_contact_email)), p_category, p_country, coalesce(p_data, '{}'::jsonb), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into r from public.vendor_pre_assessments where id = p_id for update;
  if not found or r.supplier_id <> v_sup then raise exception 'This pre-assessment is not for your company' using errcode = '42501'; end if;
  if r.status not in ('draft','under_review') then raise exception 'This pre-assessment is with adm Indicia and can''t be changed now'; end if;
  update public.vendor_pre_assessments set company_name = trim(p_company), contact_name = p_contact_name, contact_email = lower(trim(p_contact_email)),
    major_category = p_category, head_office_country = p_country, data = coalesce(p_data, '{}'::jsonb), updated_at = now()
   where id = p_id;
  return p_id;
end $$;

create or replace function public.assure_pa_submit(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); r public.vendor_pre_assessments;
begin
  select * into r from public.vendor_pre_assessments where id = p_id for update;
  if not found or v_sup is null or r.supplier_id <> v_sup or public.is_internal() then
    raise exception 'This pre-assessment is not for your company' using errcode = '42501';
  end if;
  if r.status not in ('draft','under_review') then raise exception 'This pre-assessment has already been submitted'; end if;
  update public.vendor_pre_assessments set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now() where id = p_id;
  perform public._assure_log(r.supplier_id, 'pre_assessment', p_id, 'submitted', r.status, 'submitted', 'Pre-assessment submitted by the vendor', null);
end $$;

-- ---------------------------------------------------------------------------
-- Staff side: one transition function, legal moves only, with role checks and audit
-- p_terms: {nti, payment_terms, payment_terms_days, annual_spend_forecast, tier}
-- ---------------------------------------------------------------------------
create or replace function public.assure_pa_transition(p_id uuid, p_action text, p_notes text, p_feedback text, p_terms jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare r public.vendor_pre_assessments; rv public.vendor_pre_assessment_reviews; v_to text; v_stage text;
begin
  perform public._assure_require_internal();
  select * into r from public.vendor_pre_assessments where id = p_id for update;
  if not found then raise exception 'Pre-assessment not found'; end if;
  insert into public.vendor_pre_assessment_reviews (assessment_id) values (p_id) on conflict do nothing;
  select * into rv from public.vendor_pre_assessment_reviews where assessment_id = p_id for update;
  v_stage := r.workflow_stage;

  if p_action in ('start_review','request_info','vm_approve','vm_reject') then
    if not public.assure_is_vendor_manager() then
      raise exception 'Only a vendor manager (SRT agent or lead) can review at this stage' using errcode = '42501';
    end if;
    if r.status not in ('submitted','under_review') then raise exception 'This pre-assessment is %; the vendor-manager review is not open', r.status; end if;
    if p_action = 'start_review' then
      if r.status <> 'submitted' then raise exception 'The review has already started'; end if;
      v_to := 'under_review';
    elsif p_action = 'request_info' then
      if nullif(trim(coalesce(p_feedback, '')), '') is null then raise exception 'Tell the vendor what information you need'; end if;
      v_to := 'under_review';
    elsif p_action = 'vm_approve' then
      v_to := 'vm_approved'; v_stage := 'procurement_lead';
    else
      if nullif(trim(coalesce(p_feedback, '')), '') is null then raise exception 'Give the vendor a reason for declining'; end if;
      v_to := 'vm_rejected';
    end if;
    update public.vendor_pre_assessment_reviews set vm_notes = coalesce(nullif(trim(p_notes), ''), vm_notes),
      vm_reviewed_by = auth.uid(), vm_reviewed_at = now() where assessment_id = p_id;

  elsif p_action in ('start_procurement','send_terms','confirm_onboarding','reject') then
    if not public.assure_is_procurement() then
      raise exception 'Only procurement (in-market procurement or the Procurement head) can act at this stage' using errcode = '42501';
    end if;
    if p_action = 'start_procurement' then
      if r.status <> 'vm_approved' then raise exception 'Procurement review starts after vendor-manager approval'; end if;
      v_to := 'procurement_review';
    elsif p_action = 'send_terms' then
      if r.status <> 'procurement_review' then raise exception 'Terms can only be sent during procurement review'; end if;
      if p_terms is null or p_terms->>'payment_terms' is null or p_terms->>'tier' is null then
        raise exception 'Enter the proposed payment terms and tier';
      end if;
      update public.vendor_pre_assessment_reviews set
        nti_proposed = (p_terms->>'nti')::numeric, payment_terms_proposed = p_terms->>'payment_terms',
        payment_terms_days_proposed = (p_terms->>'payment_terms_days')::int,
        annual_spend_forecast = (p_terms->>'annual_spend_forecast')::numeric, proposed_tier = p_terms->>'tier'
       where assessment_id = p_id;
      v_to := 'negotiation';
    elsif p_action = 'confirm_onboarding' then
      if r.status <> 'negotiation' then raise exception 'Onboarding can only be confirmed after terms have been sent'; end if;
      if rv.vm_reviewed_by = auth.uid() then
        raise exception 'You approved this vendor at the vendor-manager stage, so someone else must confirm onboarding' using errcode = '42501';
      end if;
      -- Agreed terms are what was proposed unless procurement records a negotiated change now.
      update public.vendor_pre_assessment_reviews set
        nti_agreed = coalesce((p_terms->>'nti')::numeric, nti_proposed),
        payment_terms_agreed = coalesce(p_terms->>'payment_terms', payment_terms_proposed),
        payment_terms_days_agreed = coalesce((p_terms->>'payment_terms_days')::int, payment_terms_days_proposed),
        tier_agreed = coalesce(p_terms->>'tier', proposed_tier),
        onboarded_by = auth.uid(), onboarded_at = now()
       where assessment_id = p_id
       returning * into rv;
      -- Carry the agreed terms onto the supplier record.
      update public.supplier_profiles set payment_terms = coalesce(rv.payment_terms_agreed, payment_terms),
        payment_terms_days = coalesce(rv.payment_terms_days_agreed, payment_terms_days), nti_rate = coalesce(rv.nti_agreed, nti_rate)
       where supplier_id = r.supplier_id;
      update public.suppliers set tier = case when rv.tier_agreed in ('strategic','preferred','approved','conditional','transactional','tail') then rv.tier_agreed else tier end
       where id = r.supplier_id;
      v_to := 'onboarded'; v_stage := 'complete';
    else
      if r.status not in ('procurement_review','negotiation') then raise exception 'Only a vendor in procurement review or negotiation can be rejected here'; end if;
      if nullif(trim(coalesce(p_feedback, '')), '') is null then raise exception 'Give the vendor a reason'; end if;
      v_to := 'rejected'; v_stage := 'complete';
    end if;
    update public.vendor_pre_assessment_reviews set procurement_notes = coalesce(nullif(trim(p_notes), ''), procurement_notes),
      procurement_reviewed_by = auth.uid(), procurement_reviewed_at = now() where assessment_id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  update public.vendor_pre_assessments set status = v_to, workflow_stage = v_stage,
    feedback_to_vendor = coalesce(nullif(trim(p_feedback), ''), feedback_to_vendor), updated_at = now()
   where id = p_id;
  perform public._assure_log(r.supplier_id, 'pre_assessment', p_id, p_action, r.status, v_to,
    'Pre-assessment: ' || replace(p_action, '_', ' '), nullif(trim(p_notes), ''));
  return v_to;
end $$;

grant execute on function public.assure_pa_save(uuid, text, text, text, text, text, jsonb), public.assure_pa_submit(uuid),
  public.assure_pa_transition(uuid, text, text, text, jsonb) to authenticated;
