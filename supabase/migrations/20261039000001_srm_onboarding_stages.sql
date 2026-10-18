-- SRM supplier onboarding (1 of 3): the nine-stage standard ("Global Vendor Onboarding: combined best-practice process flow").
--   * onboarding_stages: the nine controlled stages, each with an owner and an exit criterion.
--   * every gate belongs to a stage; fifteen gates are added so each stage's controls are evidenced
--     (intake, triage, sanctions, client requirements, risk review, PSA/SSA, Finance approval, the three system IDs,
--     groups/panels, welcome pack, training, owner, review cadence). Gates with verifier_role 'system' are only ever set by
--     the stage workflow functions (migration 2), never by hand.
--   * the supplier carries its current stage, whether it is released, a status in the onboarding taxonomy and the reason
--     purchasing is blocked. All are computed by recompute_supplier_compliance (wrapped here; the old body is
--     _core_recompute_supplier_compliance and still computes RAG, tiers and the legacy critical-gate block).
--   * purchasing_blocked stays the single order-block signal every Sourcing check reads. Standard path: blocked until all
--     nine stages are complete. Exception path: an approved fast-track lifts the block within its scope until any remediation
--     item is overdue (closure gate: no further orders).
--   * suppliers approved before the standard are carried over ("legacy" baseline: their new gates are recorded as carried
--     over and the old critical-gate rule keeps applying); suppliers still in flight move onto the standard.
--   * the tables for cases, documented gaps, risk reviews, Finance and system IDs, activation, fast-track and remediation
--     are created here; their functions are in migration 2.

-- ===========================================================================
-- Roles: Procurement Director, and scoped roles (Local Finance by market/region, Category Manager, Quality)
-- ===========================================================================
alter table public.profiles drop constraint profiles_srt_role_check;
alter table public.profiles add constraint profiles_srt_role_check
  check (srt_role in ('agent','lead','finance','procurement','head','director'));

create table public.srm_role_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('local_finance','category_manager','quality')),
  region text,
  market text,
  category text,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique nulls not distinct (user_id, role, region, market, category)
);
alter table public.srm_role_scopes enable row level security;
create policy srs_read on public.srm_role_scopes for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.srm_role_scopes from authenticated, anon;

-- Approval roles gain procurement_director, local_finance and category_manager. For local_finance the second argument is
-- the market (code or name) the decision is for; a scope with no market or region covers every market.
alter function public.approval_user_has_role(uuid, text, text) rename to _core_approval_user_has_role;
create function public.approval_user_has_role(p_user uuid, p_role text, p_module text default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; v_market text; v_region text;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or not (p.is_admin or p.user_type = 'internal') then return false; end if;
  case p_role
    when 'procurement_director' then return p.is_admin or p.srt_role = 'director';
    when 'local_finance' then
      v_market := public._market_code(p_module);
      select m.region_code into v_region from public.markets m where m.code = v_market;
      return p.is_admin or exists (select 1 from public.srm_role_scopes s where s.user_id = p_user and s.role = 'local_finance'
        and (s.market is null or public._market_code(s.market) = v_market) and (s.region is null or s.region = v_region));
    when 'category_manager' then
      return p.is_admin or coalesce(p.srt_role, '') in ('head','director')
        or exists (select 1 from public.srm_role_scopes s where s.user_id = p_user and s.role = 'category_manager');
    when 'procurement' then
      return p.srt_role = 'director' or coalesce(public._core_approval_user_has_role(p_user, p_role, p_module), false);
    when 'quality' then
      return exists (select 1 from public.srm_role_scopes s where s.user_id = p_user and s.role = 'quality')
        or coalesce(public._core_approval_user_has_role(p_user, p_role, p_module), false);
    else return coalesce(public._core_approval_user_has_role(p_user, p_role, p_module), false);
  end case;
end $$;

alter function public.approval_role_label(text) rename to _core_approval_role_label;
create function public.approval_role_label(p_role text) returns text
language sql immutable as $$
  select case p_role
    when 'procurement_director' then 'Procurement Director'
    when 'local_finance' then 'Local Finance (for the supplier''s market)'
    when 'category_manager' then 'Category Manager (Procurement head, Procurement Director or named category manager)'
    else public._core_approval_role_label(p_role) end;
$$;
revoke execute on function public._core_approval_user_has_role(uuid, text, text), public.approval_user_has_role(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.approval_role_label(text), public._core_approval_role_label(text) to authenticated;

-- Admin grants and removes scoped roles.
create or replace function public.srm_set_role_scope(p_user uuid, p_role text, p_region text, p_market text, p_category text, p_grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change SRM role scopes' using errcode = '42501'; end if;
  if p_role not in ('local_finance','category_manager','quality') then raise exception 'Unknown role %', p_role; end if;
  if not exists (select 1 from public.profiles where id = p_user and (user_type = 'internal' or is_admin)) then
    raise exception 'Choose an internal person';
  end if;
  if p_grant then
    insert into public.srm_role_scopes (user_id, role, region, market, category, granted_by)
    values (p_user, p_role, nullif(trim(p_region), ''), public._market_code(p_market), nullif(trim(p_category), ''), auth.uid())
    on conflict do nothing;
  else
    delete from public.srm_role_scopes where user_id = p_user and role = p_role
      and region is not distinct from nullif(trim(p_region), '') and market is not distinct from public._market_code(p_market)
      and category is not distinct from nullif(trim(p_category), '');
  end if;
end $$;

-- ===========================================================================
-- The nine stages
-- ===========================================================================
create table public.onboarding_stages (
  key text primary key,
  stage_no int not null unique check (stage_no between 1 and 9),
  label text not null,
  owner_label text not null,
  owner_roles text[] not null default '{}',
  controls text not null,
  exit_criterion text not null,
  vendor_text text not null,
  vendor_action text
);
insert into public.onboarding_stages (key, stage_no, label, owner_label, owner_roles, controls, exit_criterion, vendor_text, vendor_action) values
  ('need', 1, 'Business need', 'Requester', '{internal}',
   'Business case: why this supplier is needed, for which client and market.',
   'Business case recorded.', 'adm Indicia is confirming why a new supplier is needed.', null),
  ('intake', 2, 'Intake', 'Requester / SRT', '{internal,srt_agent}',
   'Supplier type, category, client, market, urgency and estimated spend. No supplier information request outside this route.',
   'Complete request.', 'adm Indicia is preparing your onboarding request.', null),
  ('triage', 3, 'Triage', 'Procurement', '{procurement}',
   'Duplicate and existing-supplier check; incumbent or strategic; standard or exception route.',
   'Procurement approves the need and the route.', 'adm Indicia Procurement is reviewing the request.', null),
  ('due_diligence', 4, 'Due diligence', 'Supplier / SRT', '{srt_agent}',
   'Information request, company and VAT, bank, financial, capability, quality (QMS), environment (EMS), CSR, sanctions and client requirements.',
   'Evidence complete, or a documented gap (reason, owner, due date) approved by a second person.',
   'Complete the information request and upload your company documents and certificates.', 'Complete your information request and upload evidence'),
  ('risk', 5, 'Risk gates', 'Category Manager / Quality', '{category_manager,quality}',
   'Category fit, competitiveness and NTI, quality, sustainability, audit need and client-specific requirements.',
   'Category Manager and Quality approval where the rules require it.', 'adm Indicia is reviewing the evidence you provided.', null),
  ('contracts', 6, 'Contracts', 'SRT / Legal', '{srt_agent}',
   'NDA, Code of Conduct, MSA or terms and conditions, PSA / SSA and the schedules or addenda that apply.',
   'Signed agreement set stored.', 'Sign the agreements adm Indicia has sent you.', 'Sign your agreements'),
  ('finance', 7, 'Finance approval', 'Local Finance', '{local_finance}',
   'Finance validates bank details, tax registration and the set-up.',
   'Local Finance approval recorded.', 'adm Indicia Finance is checking your bank and tax details.', null),
  ('systems', 8, 'System enablement', 'ERP / SRT', '{srt_agent,finance}',
   'Supplier IDs in StockTool, NAV / ERP and Sourcing Hub; required groups and panels.',
   'IDs reconciled and status synchronised.', 'adm Indicia is setting you up in its systems.', null),
  ('activate', 9, 'Activate & govern', 'Procurement', '{procurement}',
   'Welcome pack, training, named owner, evidence location, expiry dates and review cadence.',
   'Supplier released for use and visible in reporting.', 'Complete your onboarding training. You will then be ready to receive work.', 'Complete your onboarding training');

alter table public.onboarding_stages enable row level security;
create policy os_read on public.onboarding_stages for select to authenticated using (public.is_internal());
create policy os_admin on public.onboarding_stages for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert, delete on public.onboarding_stages from authenticated, anon;

-- ===========================================================================
-- Gates: every gate belongs to a stage
-- ===========================================================================
alter table public.gate_definitions
  add column if not exists stage_key text references public.onboarding_stages(key),
  add column if not exists standard_gate boolean not null default false,
  add column if not exists vendor_facing boolean not null default false,
  add column if not exists vendor_label text,
  add column if not exists allows_gap boolean not null default false;
comment on column public.gate_definitions.standard_gate is 'Added by the nine-stage standard (carried over for suppliers approved before it).';
comment on column public.gate_definitions.allows_gap is 'Due-diligence evidence that may be covered by an approved documented gap.';

alter table public.gate_definitions drop constraint gate_definitions_verifier_role_check;
alter table public.gate_definitions add constraint gate_definitions_verifier_role_check
  check (verifier_role in ('srt','finance','quality','category','head','procurement','system'));

update public.gate_definitions g set stage_key = x.stage, sort = x.sort, stage = s.label, vendor_facing = x.vf, vendor_label = x.vl, allows_gap = x.gap,
  label = coalesce(x.new_label, g.label)
  from (values
    ('request',        'need',           110, false, null, false, 'Business need and business case'),
    ('rfi',            'due_diligence',  410, true,  'Information request (company, contacts, capabilities)', false, null),
    ('registration',   'due_diligence',  420, true,  'Company registration and VAT documents', false, null),
    ('financial',      'due_diligence',  430, true,  'Financial statements or credit check', true, null),
    ('capability',     'due_diligence',  440, true,  'Capability information (sites, equipment, capacity)', true, null),
    ('quality',        'due_diligence',  450, true,  'Quality management certificate (for example ISO 9001)', true, null),
    ('environment',    'due_diligence',  460, true,  'Environmental certificate (for example ISO 14001, FSC, PEFC)', true, null),
    ('sustainability', 'due_diligence',  470, true,  'Ethical and social audit (for example SMETA or EcoVadis)', true, null),
    ('nda',            'contracts',      610, true,  'Non-disclosure agreement (NDA)', false, null),
    ('coc',            'contracts',      620, true,  'Supplier Code of Conduct', false, null),
    ('msa',            'contracts',      630, true,  'Master services agreement or terms and conditions', false, 'MSA / terms and conditions signed'),
    ('bank',           'finance',        710, true,  'Bank details', false, null),
    ('setup',          'systems',        810, false, null, false, 'Supplier IDs reconciled and status synchronised'),
    ('approval',       'activate',       950, false, null, false, 'Onboarding approval: released for use')
  ) as x(key, stage, sort, vf, vl, gap, new_label)
  join public.onboarding_stages s on s.key = x.stage
 where g.key = x.key;

insert into public.gate_definitions (key, label, stage, critical, has_expiry, verifier_role, sort, stage_key, standard_gate, vendor_facing, vendor_label, allows_gap) values
  ('intake',              'Complete onboarding request',                                        'Intake',            false, false, 'system',   210, 'intake',        true, false, null, false),
  ('triage',              'Procurement triage: need and route approved',                        'Triage',            true,  false, 'system',   310, 'triage',        true, false, null, false),
  ('sanctions',           'Sanctions and watch-list screening',                                 'Due diligence',     true,  true,  'srt',      480, 'due_diligence', true, false, null, false),
  ('client_requirements', 'Client-specific requirements evidenced',                             'Due diligence',     false, false, 'srt',      490, 'due_diligence', true, true,  'Documents your adm Indicia client asks for', true),
  ('risk_review',         'Risk gate review (category fit, competitiveness, quality, sustainability, audit, client)', 'Risk gates', true, false, 'system', 510, 'risk', true, false, null, false),
  ('psa',                 'PSA / SSA and schedules or addenda signed',                          'Contracts',         false, false, 'srt',      640, 'contracts',     true, true,  'Product or service supply agreement and schedules', false),
  ('finance_approval',    'Finance approval (Local Finance)',                                   'Finance approval',  true,  false, 'system',   720, 'finance',       true, false, null, false),
  ('id_stocktool',        'StockTool supplier ID',                                              'System enablement', false, false, 'system',   820, 'systems',       true, false, null, false),
  ('id_erp',              'NAV / ERP vendor ID',                                                'System enablement', false, false, 'system',   830, 'systems',       true, false, null, false),
  ('id_hub',              'Sourcing Hub supplier ID',                                           'System enablement', false, false, 'system',   840, 'systems',       true, false, null, false),
  ('panels',              'Groups and panels allocated',                                        'System enablement', false, false, 'system',   850, 'systems',       true, false, null, false),
  ('welcome_pack',        'Welcome pack sent',                                                  'Activate & govern', false, false, 'system',   910, 'activate',      true, false, null, false),
  ('training',            'Supplier training assigned or completed',                            'Activate & govern', false, false, 'system',   920, 'activate',      true, true,  'Onboarding training', false),
  ('owner',               'Named procurement owner assigned',                                   'Activate & govern', false, false, 'system',   930, 'activate',      true, false, null, false),
  ('review_cadence',      'Review cadence, evidence location and expiry dates confirmed',       'Activate & govern', false, false, 'system',   940, 'activate',      true, false, null, false)
on conflict (key) do nothing;
alter table public.gate_definitions alter column stage_key set not null;

-- ===========================================================================
-- Supplier: stage, release, taxonomy status, block reason (computed; guarded)
-- ===========================================================================
alter table public.suppliers
  add column if not exists onboarding_baseline text not null default 'standard' check (onboarding_baseline in ('standard','legacy')),
  add column if not exists onboarding_carried_over_at timestamptz,
  add column if not exists onboarding_stage int not null default 1 check (onboarding_stage between 1 and 9),
  add column if not exists onboarding_stage_since timestamptz not null default now(),
  add column if not exists onboarding_released boolean not null default false,
  add column if not exists onboarding_state text not null default 'in_review'
    check (onboarding_state in ('submitted','in_review','approved','declined','exception','on_hold')),
  add column if not exists onboarding_block_reason text,
  add column if not exists next_review_due date,
  add column if not exists ids_synced_at timestamptz;
comment on column public.suppliers.onboarding_baseline is 'legacy = approved before the nine-stage standard (carried over); standard = onboarded through the nine stages.';
comment on column public.suppliers.onboarding_state is 'Onboarding status taxonomy: submitted, in_review, approved (released), declined, exception (fast-track), on_hold.';

alter table public.supplier_profiles add column if not exists vat_number text;
comment on column public.supplier_profiles.uen_number is 'Company registration number (the local name depends on the country: UEN in Singapore, Companies House number in the UK, NIT in Colombia, ...).';

-- Users can't write the computed onboarding fields or choose the baseline.
create or replace function public.trg_supplier_guard_onboarding() returns trigger
language plpgsql as $$
begin
  if current_setting('assure.system_write', true) = 'on' or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.onboarding_baseline := 'standard'; new.onboarding_carried_over_at := null; new.onboarding_stage := 1; new.onboarding_stage_since := now();
    new.onboarding_released := false; new.onboarding_state := 'in_review'; new.onboarding_block_reason := null; new.ids_synced_at := null;
  else
    new.onboarding_baseline := old.onboarding_baseline; new.onboarding_carried_over_at := old.onboarding_carried_over_at;
    new.onboarding_stage := old.onboarding_stage; new.onboarding_stage_since := old.onboarding_stage_since;
    new.onboarding_released := old.onboarding_released; new.onboarding_state := old.onboarding_state;
    new.onboarding_block_reason := old.onboarding_block_reason; new.ids_synced_at := old.ids_synced_at; new.next_review_due := old.next_review_due;
  end if;
  return new;
end $$;
create trigger suppliers_guard_onboarding before insert or update on public.suppliers
  for each row execute function public.trg_supplier_guard_onboarding();

-- ===========================================================================
-- Onboarding records
-- ===========================================================================
-- The onboarding case: one per request (new supplier) or revalidation.
create table public.onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  case_no bigint generated always as identity unique,
  kind text not null default 'new' check (kind in ('new','revalidation')),
  status text not null default 'submitted'
    check (status in ('submitted','in_onboarding','released','declined','duplicate','withdrawn','on_hold')),
  business_case text not null check (length(trim(business_case)) > 0),
  supplier_type text not null check (supplier_type in ('manufacturer','distributor','service_provider','raw_material','logistics')),
  category text not null,
  tax_category_id uuid,
  client text check (client in ('Brightlane','Northbrew','Carewell','BAU','Other')),
  market text not null,
  region text,
  urgency text not null default 'standard' check (urgency in ('standard','urgent')),
  urgency_reason text,
  client_need text,
  required_date date,
  estimated_spend numeric(14,2) check (estimated_spend is null or estimated_spend >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  proposed_name text not null check (length(trim(proposed_name)) > 0),
  proposed_email text,
  proposed_contact text,
  proposed_website text,
  proposed_vat text,
  proposed_registration text,
  duplicate_matches jsonb not null default '[]'::jsonb,
  duplicate_confirmed boolean not null default false,
  linked_supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  ticket_id uuid references public.srt_tickets(id) on delete set null,
  route text check (route in ('standard','exception')),
  relationship text check (relationship in ('incumbent','strategic','tactical')),
  triage_note text,
  decline_reason text,
  trigger_event text check (trigger_event in ('scheduled','material_change','client_request','adverse_finding')),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  triaged_by uuid references public.profiles(id) on delete set null,
  triaged_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Accountability rule: nobody self-requests, self-approves and self-activates the same supplier.
  constraint onboarding_cases_sod_triage check (triaged_by is null or requested_by is null or triaged_by <> requested_by),
  constraint onboarding_cases_sod_activate check (activated_by is null or triaged_by is null or activated_by <> triaged_by),
  check (urgency = 'standard' or (nullif(trim(urgency_reason), '') is not null and nullif(trim(client_need), '') is not null and required_date is not null))
);
create index onboarding_cases_supplier_idx on public.onboarding_cases (supplier_id);
create index onboarding_cases_status_idx on public.onboarding_cases (status, requested_at);

-- Everything that happens on a case or supplier's onboarding (the evidence trail; also the domain events).
create table public.onboarding_events (
  id bigint generated always as identity primary key,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  case_id uuid references public.onboarding_cases(id) on delete cascade,
  kind text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  vendor_visible boolean not null default false,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index onboarding_events_supplier_idx on public.onboarding_events (supplier_id, at desc);
create index onboarding_events_case_idx on public.onboarding_events (case_id, at desc);

-- Due diligence: a documented gap is a valid exit when a second person approves it and it is not past due.
create table public.onboarding_gaps (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  gate_key text not null references public.gate_definitions(key),
  reason text not null check (length(trim(reason)) > 0),
  owner uuid references public.profiles(id) on delete set null,
  owner_type text not null default 'internal' check (owner_type in ('internal','vendor')),
  due_date date not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','closed')),
  raised_by uuid references public.profiles(id) on delete set null,
  raised_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  closed_at timestamptz,
  constraint onboarding_gaps_second_person check (decided_by is null or raised_by is null or decided_by <> raised_by)
);
create unique index onboarding_gaps_one_open on public.onboarding_gaps (supplier_id, gate_key) where status in ('proposed','approved');

-- Risk gates: one combined review per supplier; CM and Quality approve where the rules require it.
create table public.onboarding_risk_reviews (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  case_id uuid references public.onboarding_cases(id) on delete set null,
  category_fit text not null,
  competitiveness text,
  nti_percent numeric(5,2) check (nti_percent is null or nti_percent between 0 and 100),
  quality text,
  sustainability text,
  audit_needed boolean not null default false,
  audit_notes text,
  client_requirements text,
  needs_cm boolean not null default true,
  needs_quality boolean not null default false,
  rules_applied text[] not null default '{}',
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  cm_decision text check (cm_decision in ('approved','rejected')),
  cm_by uuid references public.profiles(id) on delete set null,
  cm_at timestamptz,
  cm_note text,
  quality_decision text check (quality_decision in ('approved','rejected')),
  quality_by uuid references public.profiles(id) on delete set null,
  quality_at timestamptz,
  quality_note text,
  constraint onboarding_risk_cm_second check (cm_by is null or submitted_by is null or cm_by <> submitted_by),
  constraint onboarding_risk_quality_second check (quality_by is null or submitted_by is null or quality_by <> submitted_by)
);

-- Contracts: which onboarding document a contract in the register is (NDA, Code of Conduct, MSA, PSA/SSA or a schedule).
alter table public.contracts add column if not exists onboarding_doc text check (onboarding_doc in ('nda','coc','msa','psa','schedule'));

-- System enablement: IDs returned by each system, and groups/panels.
create table public.supplier_system_ids (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  system text not null check (system in ('stocktool','erp','sourcing_hub')),
  external_id text not null check (length(trim(external_id)) > 0),
  name_in_system text,
  vat_in_system text,
  reconciled boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (supplier_id, system)
);
create unique index supplier_system_ids_unique_ext on public.supplier_system_ids (system, upper(trim(external_id)));

create table public.supplier_panels (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  panel text not null check (length(trim(panel)) > 0),
  allocated_by uuid references public.profiles(id) on delete set null,
  allocated_at timestamptz not null default now(),
  primary key (supplier_id, panel)
);

-- Activation pack.
create table public.onboarding_activations (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  case_id uuid references public.onboarding_cases(id) on delete set null,
  owner uuid not null references public.profiles(id),
  welcome_pack_sent_at timestamptz not null,
  training text not null check (training in ('assigned','completed','not_required')),
  evidence_location text not null,
  expiry_confirmed boolean not null check (expiry_confirmed),
  review_cadence text not null check (review_cadence in ('quarterly','semi_annual','annual','biennial')),
  next_review_due date not null,
  note text,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz not null default now()
);

-- Fast-track: an exception route, not a bypass.
create table public.onboarding_fast_tracks (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  case_id uuid references public.onboarding_cases(id) on delete set null,
  urgency_reason text not null check (length(trim(urgency_reason)) > 0),
  client_need text not null check (length(trim(client_need)) > 0),
  required_date date not null,
  scope_jobs uuid[] not null default '{}',
  scope_value_cap numeric(14,2) check (scope_value_cap is null or scope_value_cap > 0),
  scope_currency text not null default 'EUR',
  scope_systems text[] not null default '{}',
  scope_note text,
  close_by date not null,
  min_pack jsonb not null default '{}'::jsonb,
  status text not null default 'requested' check (status in ('requested','approved','rejected','closed','cancelled')),
  director_approved_by uuid references public.profiles(id) on delete set null,
  director_approved_at timestamptz,
  finance_approved_by uuid references public.profiles(id) on delete set null,
  finance_approved_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  closed_at timestamptz,
  close_note text,
  constraint onboarding_ft_director_not_requester check (director_approved_by is null or requested_by is null or director_approved_by <> requested_by),
  constraint onboarding_ft_finance_not_requester check (finance_approved_by is null or requested_by is null or finance_approved_by <> requested_by),
  check (cardinality(scope_jobs) > 0 or scope_value_cap is not null)
);
create unique index onboarding_fast_tracks_one_open on public.onboarding_fast_tracks (supplier_id) where status in ('requested','approved');

create table public.onboarding_remediation_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  fast_track_id uuid references public.onboarding_fast_tracks(id) on delete cascade,
  gate_key text references public.gate_definitions(key),
  item text not null,
  owner_type text not null default 'internal' check (owner_type in ('vendor','internal')),
  owner uuid references public.profiles(id) on delete set null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','done','waived')),
  done_at timestamptz,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index onboarding_remediation_supplier_idx on public.onboarding_remediation_items (supplier_id, status, due_date);

-- Review cadence tasks (weekly / monthly / quarterly / annual / event-based).
create table public.srm_review_tasks (
  id uuid primary key default gen_random_uuid(),
  cadence text not null check (cadence in ('weekly','monthly','quarterly','annual','event')),
  scope text not null,
  title text not null,
  detail text,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  case_id uuid references public.onboarding_cases(id) on delete set null,
  period_key text not null,
  due_date date not null,
  owner_role text,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  outcome text,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (scope, period_key, supplier_id)
);

-- RLS: internal staff read; writes only through the functions. Vendors see their own vendor-facing pieces.
alter table public.onboarding_cases enable row level security;
alter table public.onboarding_events enable row level security;
alter table public.onboarding_gaps enable row level security;
alter table public.onboarding_risk_reviews enable row level security;
alter table public.supplier_system_ids enable row level security;
alter table public.supplier_panels enable row level security;
alter table public.onboarding_activations enable row level security;
alter table public.onboarding_fast_tracks enable row level security;
alter table public.onboarding_remediation_items enable row level security;
alter table public.srm_review_tasks enable row level security;
create policy oc_read on public.onboarding_cases for select to authenticated using (public.is_internal());
create policy oe_read on public.onboarding_events for select to authenticated
  using (public.is_internal() or (vendor_visible and supplier_id = public.my_supplier_id()));
create policy og_read on public.onboarding_gaps for select to authenticated
  using (public.is_internal() or (owner_type = 'vendor' and supplier_id = public.my_supplier_id()));
create policy orr_read on public.onboarding_risk_reviews for select to authenticated using (public.is_internal());
create policy ssi_read on public.supplier_system_ids for select to authenticated using (public.is_internal());
create policy sp_panels_read on public.supplier_panels for select to authenticated using (public.is_internal());
create policy oa_read on public.onboarding_activations for select to authenticated using (public.is_internal());
create policy oft_read on public.onboarding_fast_tracks for select to authenticated using (public.is_internal());
create policy ori_read on public.onboarding_remediation_items for select to authenticated
  using (public.is_internal() or (owner_type = 'vendor' and supplier_id = public.my_supplier_id()));
create policy srt_review_read on public.srm_review_tasks for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.onboarding_cases, public.onboarding_events, public.onboarding_gaps, public.onboarding_risk_reviews,
  public.supplier_system_ids, public.supplier_panels, public.onboarding_activations, public.onboarding_fast_tracks,
  public.onboarding_remediation_items, public.srm_review_tasks from authenticated, anon;

-- ===========================================================================
-- Governed settings (SRM Watchtower): the deck's four decisions
-- ===========================================================================
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('onboarding_settings', 'assure', 'Onboarding standard and exceptions',
   'Decisions 1, 3 and 4: the nine-stage flow is the global baseline (APAC, EMEA, NAM) with local legal and tax requirements per region; SRM is the system of record for status and evidence; fast-track approver roles, scope limits, remediation and escalation days, order blocking.',
   true, 10),
  ('onboarding_evidence_sets', 'assure', 'Minimum evidence sets',
   'Decision 2: the global minimum evidence set and how it varies by region, market, client and supplier type (which gates, contracts and systems are not required).',
   true, 11),
  ('onboarding_risk_rules', 'assure', 'Risk gate rules',
   'When the Category Manager and Quality must approve the risk gate, by category, client and estimated spend.',
   true, 12),
  ('onboarding_review_cadence', 'assure', 'Review cadence',
   'Weekly open cases and exceptions, monthly overdue evidence and expiring controls, quarterly sample audit and access review, revalidation by risk, event-based reviews.',
   true, 13)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from, notes) values
  ('onboarding_settings', 'GLOBAL', 'Global baseline',
   '{"region":null,"baseline_flow":"nine_stage","local_requirements":[],"system_of_record":"SRM holds onboarding status and evidence. StockTool, NAV / ERP and Sourcing Hub hold the supplier IDs and link back to SRM.","required_systems":["stocktool","erp","sourcing_hub"],"ft_director_role":"procurement_director","ft_finance_role":"local_finance","ft_max_days":60,"ft_value_cap_max":50000,"remediation_days":30,"escalation_days":5,"block_orders_when_overdue":true,"cm_always":true}',
   'active', '2026-10-01', 'Decision 1, 3 and 4 as approved with the onboarding standard.'),
  ('onboarding_settings', 'APAC', 'APAC',
   '{"region":"APAC","local_requirements":["China: business licence (unified social credit code) and fapiao capability","India: GST registration and PAN","Singapore: ACRA business profile (UEN)"]}', 'active', '2026-10-01', null),
  ('onboarding_settings', 'EMEA', 'EMEA',
   '{"region":"EMEA","local_requirements":["EU: VAT number checked in VIES","UK: Companies House number and HMRC VAT","Modern slavery statement where turnover requires it"]}', 'active', '2026-10-01', null),
  ('onboarding_settings', 'NAM', 'NAM',
   '{"region":"Americas","local_requirements":["US: W-9 and EIN","Canada: GST/HST registration","Mexico: RFC and CFDI capability"]}', 'active', '2026-10-01', null),
  ('onboarding_evidence_sets', 'EV-GLOBAL', 'Global minimum evidence set',
   '{"not_required_gates":["psa","client_requirements"],"notes":"Every gate is required except a PSA / SSA and client-specific requirements, which a client or supplier-type set adds."}', 'active', '2026-10-01', null),
  ('onboarding_evidence_sets', 'EV-SERVICES', 'Service providers',
   '{"supplier_type":"service_provider","not_required_gates":["psa","client_requirements","environment","id_stocktool"],"notes":"Services are not stocked; an environmental certificate is not required."}', 'active', '2026-10-01', null),
  ('onboarding_evidence_sets', 'EV-BRIGHTLANE', 'Brightlane suppliers',
   '{"client":"Brightlane","not_required_gates":[],"notes":"Brightlane requires a PSA and its own supplier requirements pack."}', 'active', '2026-10-01', null),
  ('onboarding_risk_rules', 'RR-PHYSICAL', 'Physical goods need Quality',
   '{"categories":["Print","POSM","Packaging","Fixtures","Signage","Components"],"needs_quality":true,"audit_required":false}', 'active', '2026-10-01', null),
  ('onboarding_risk_rules', 'RR-SPEND', 'High spend needs Quality and an audit',
   '{"min_spend":100000,"needs_quality":true,"audit_required":true}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'W-OPEN', 'Weekly: open onboarding cases', '{"cadence":"weekly","scope":"open_cases","owner_role":"srt_lead"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'W-EXC', 'Weekly: exceptions (fast-track)', '{"cadence":"weekly","scope":"exceptions","owner_role":"procurement_director"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'M-EVID', 'Monthly: overdue evidence', '{"cadence":"monthly","scope":"overdue_evidence","owner_role":"srt_lead"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'M-EXP', 'Monthly: expiring controls', '{"cadence":"monthly","scope":"expiring_controls","owner_role":"srt_lead"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'Q-AUDIT', 'Quarterly: sample audit', '{"cadence":"quarterly","scope":"sample_audit","owner_role":"procurement_head","sample_size":5}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'Q-ACCESS', 'Quarterly: access review', '{"cadence":"quarterly","scope":"access_review","owner_role":"admin"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'A-HIGH', 'Revalidation: high and critical risk every 12 months', '{"cadence":"annual","scope":"revalidation","risk_levels":["high","critical"],"interval_months":12,"owner_role":"srt_agent"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'A-MEDIUM', 'Revalidation: medium risk every 24 months', '{"cadence":"annual","scope":"revalidation","risk_levels":["medium"],"interval_months":24,"owner_role":"srt_agent"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'A-LOW', 'Revalidation: low risk every 36 months', '{"cadence":"annual","scope":"revalidation","risk_levels":["low"],"interval_months":36,"owner_role":"srt_agent"}', 'active', '2026-10-01', null),
  ('onboarding_review_cadence', 'E-EVENT', 'Event-based revalidation', '{"cadence":"event","scope":"revalidation","events":["material_change","client_request","adverse_finding"],"owner_role":"srt_lead"}', 'active', '2026-10-01', null);

-- The setting that applies to a region: the GLOBAL record overlaid by the region's record (Americas = NAM).
create or replace function public._onb_setting(p_region text) returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"required_systems":["stocktool","erp","sourcing_hub"],"ft_director_role":"procurement_director","ft_finance_role":"local_finance","ft_max_days":60,"remediation_days":30,"escalation_days":5,"block_orders_when_overdue":true,"cm_always":true}'::jsonb
    || coalesce((public.library_effective('onboarding_settings', 'GLOBAL', current_date)).data, '{}'::jsonb)
    || coalesce((public.library_effective('onboarding_settings', case p_region when 'Americas' then 'NAM' else coalesce(p_region, '-') end, current_date)).data, '{}'::jsonb);
$$;

-- ===========================================================================
-- Gate state per stage, and the recompute wrapper
-- ===========================================================================
create or replace function public._onb_gate_states(p_supplier uuid)
returns table (gate_key text, label text, stage_no int, stage_key text, critical boolean, vendor_facing boolean, vendor_label text,
  allows_gap boolean, verifier_role text, status text, expiry_date date, expired boolean, gap_id uuid, gap_due date, clear boolean,
  updated_at timestamptz, note text, rejection_reason text)
language sql stable security definer set search_path = public as $$
  select d.key, d.label, st.stage_no, st.key, d.critical, d.vendor_facing, coalesce(d.vendor_label, d.label), d.allows_gap, d.verifier_role,
         coalesce(sg.status, 'missing'), sg.expiry_date,
         coalesce(sg.status in ('verified','received') and sg.expiry_date is not null and sg.expiry_date < current_date, false),
         gp.id, gp.due_date,
         ((coalesce(sg.status, 'missing') = 'not_required')
           or (sg.status = 'verified' and not (sg.expiry_date is not null and sg.expiry_date < current_date))
           or gp.id is not null),
         sg.updated_at, sg.note, sg.rejection_reason
    from public.gate_definitions d
    join public.onboarding_stages st on st.key = d.stage_key
    left join public.supplier_gates sg on sg.supplier_id = p_supplier and sg.gate_key = d.key
    left join lateral (select g.id, g.due_date from public.onboarding_gaps g
                        where d.allows_gap and g.supplier_id = p_supplier and g.gate_key = d.key and g.status = 'approved' and g.due_date >= current_date
                        order by g.due_date limit 1) gp on true
   where d.active
   order by st.stage_no, d.sort;
$$;

-- True when every gate of stages 1..p_upto is clear.
create or replace function public._onb_stages_complete(p_supplier uuid, p_upto int) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public._onb_gate_states(p_supplier) g where g.stage_no <= p_upto and not g.clear);
$$;

alter function public.recompute_supplier_compliance(uuid) rename to _core_recompute_supplier_compliance;
create function public.recompute_supplier_compliance(p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.suppliers; c public.onboarding_cases; ft public.onboarding_fast_tracks;
  v_first int; v_stage int; v_released boolean; v_blocked boolean; v_exception boolean := false; v_overdue int; v_state text; v_reason text;
  v_label text; v_block_overdue boolean;
begin
  perform public._core_recompute_supplier_compliance(p_supplier);
  select * into s from public.suppliers where id = p_supplier;
  if not found then return; end if;

  select min(g.stage_no) into v_first from public._onb_gate_states(p_supplier) g where not g.clear;
  v_stage := coalesce(v_first, 9);
  if s.onboarding_baseline = 'legacy' then
    v_released := not s.purchasing_blocked;         -- carried over: the old critical-gate rule applies
    v_blocked := s.purchasing_blocked;
  else
    v_released := v_first is null;                  -- standard path: released only when all nine stages are complete
    v_blocked := not v_released;
  end if;

  -- Exception path: an approved fast-track lifts the block (within its scope, enforced by Sourcing) until close-by.
  select * into ft from public.onboarding_fast_tracks where supplier_id = p_supplier and status = 'approved' order by requested_at desc limit 1;
  if ft.id is not null and not v_released and s.fast_track_approved_by is not null and current_date <= ft.close_by then
    v_blocked := false; v_exception := true;
  end if;

  -- Closure gate: any overdue remediation item stops further orders.
  select count(*) into v_overdue from public.onboarding_remediation_items where supplier_id = p_supplier and status = 'open' and due_date < current_date;
  v_block_overdue := coalesce((public._onb_setting(s.region)->>'block_orders_when_overdue')::boolean, true);
  if v_overdue > 0 and v_block_overdue then v_blocked := true; end if;

  select label into v_label from public.onboarding_stages where stage_no = v_stage;
  v_reason := case
    when v_overdue > 0 and v_block_overdue then format('Fast-track remediation overdue (%s item%s): no further orders until it is closed', v_overdue, case when v_overdue = 1 then '' else 's' end)
    when v_exception then 'Fast-track exception: only the approved jobs and value until onboarding is complete'
    when v_blocked and s.onboarding_baseline = 'legacy' then 'A critical onboarding gate is open'
    when v_blocked then format('Onboarding not complete: stage %s of 9 (%s)', v_stage, v_label)
    else null end;

  select * into c from public.onboarding_cases where supplier_id = p_supplier order by (kind = 'new') desc, requested_at desc limit 1;
  v_state := case
    when s.status in ('suspended','offboarded','inactive') or c.status = 'on_hold' then 'on_hold'
    when v_released then 'approved'
    when v_exception then 'exception'
    when c.id is not null and c.status in ('declined','duplicate','withdrawn') then 'declined'
    else 'in_review' end;

  perform set_config('assure.system_write', 'on', true);
  if v_released then
    update public.onboarding_fast_tracks set status = 'closed', closed_at = now(), close_note = 'Onboarding complete: exception closed'
     where supplier_id = p_supplier and status = 'approved';
  end if;
  update public.suppliers set
         purchasing_blocked = v_blocked, onboarding_released = v_released, onboarding_state = v_state, onboarding_block_reason = v_reason,
         onboarding_stage = v_stage,
         onboarding_stage_since = case when onboarding_stage is distinct from v_stage then now() else onboarding_stage_since end
   where id = p_supplier
     and (purchasing_blocked, onboarding_released, onboarding_state, onboarding_block_reason, onboarding_stage)
         is distinct from (v_blocked, v_released, v_state, v_reason, v_stage);
  perform set_config('assure.system_write', 'off', true);
end $$;
revoke execute on function public._core_recompute_supplier_compliance(uuid), public.recompute_supplier_compliance(uuid) from public, anon, authenticated;

-- Remediation items and documented gaps change the result too.
create or replace function public.trg_onb_recompute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_supplier_compliance(coalesce(new.supplier_id, old.supplier_id));
  return null;
end $$;
create trigger onboarding_gaps_recompute after insert or update or delete on public.onboarding_gaps
  for each row execute function public.trg_onb_recompute();
create trigger onboarding_remediation_recompute after insert or update or delete on public.onboarding_remediation_items
  for each row execute function public.trg_onb_recompute();
create trigger onboarding_fast_tracks_recompute after insert or update on public.onboarding_fast_tracks
  for each row execute function public.trg_onb_recompute();

-- New gates for every supplier that already exists (one recompute per supplier at the end, not one per gate row).
alter table public.supplier_gates disable trigger gate_changed;
insert into public.supplier_gates (supplier_id, gate_key)
  select s.id, d.key from public.suppliers s cross join public.gate_definitions d where d.active
  on conflict do nothing;

-- ===========================================================================
-- Carry-over: suppliers approved before the standard keep working; in-flight ones move onto it
-- ===========================================================================
create or replace function public._onb_carry_over(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare s record; v_open int; v_ok boolean; n int := 0;
begin
  for s in select * from public.suppliers where id = any (p_ids) and onboarding_carried_over_at is null loop
    insert into public.supplier_gates (supplier_id, gate_key) select s.id, key from public.gate_definitions where active on conflict do nothing;
    -- The rule that applied before the standard: every original critical gate clear (or an approved fast-track in date).
    select count(*) into v_open
      from public.gate_definitions d left join public.supplier_gates g on g.supplier_id = s.id and g.gate_key = d.key
     where d.active and d.critical and not d.standard_gate
       and not (coalesce(g.status, 'missing') in ('verified','not_required')
                and not (g.status in ('verified','received') and g.expiry_date is not null and g.expiry_date < current_date));
    v_ok := v_open = 0 or (s.onboarding_route = 'fast_track' and s.fast_track_approved_by is not null and s.fast_track_close_by >= current_date);
    perform set_config('assure.system_write', 'on', true);
    if v_ok then
      insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note)
        select s.id, g.gate_key, g.status, 'verified', 'Carried over: supplier approved before the nine-stage standard'
          from public.supplier_gates g join public.gate_definitions d on d.key = g.gate_key
         where g.supplier_id = s.id and d.standard_gate and g.status <> 'verified';
      update public.supplier_gates g set status = 'verified', verified_at = coalesce(g.verified_at, now()), updated_at = now(),
             note = 'Carried over: supplier approved before the nine-stage standard', expiry_date = null, rejection_reason = null
        from public.gate_definitions d where d.key = g.gate_key and g.supplier_id = s.id and d.standard_gate;
      update public.suppliers set onboarding_baseline = 'legacy', onboarding_carried_over_at = now() where id = s.id;
    else
      update public.supplier_gates g set status = case when g.gate_key in ('intake','triage') then 'verified' else 'missing' end,
             verified_at = case when g.gate_key in ('intake','triage') then now() end, verified_by = null, expiry_date = null, rejection_reason = null,
             note = case when g.gate_key in ('intake','triage') then 'Carried over: requested before the nine-stage standard' end, updated_at = now()
        from public.gate_definitions d where d.key = g.gate_key and g.supplier_id = s.id and d.standard_gate;
      insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note)
        select s.id, k, null, 'verified', 'Carried over: requested before the nine-stage standard' from unnest(array['intake','triage']) k;
      update public.suppliers set onboarding_baseline = 'standard', onboarding_carried_over_at = now() where id = s.id;
    end if;
    perform set_config('assure.system_write', 'off', true);
    perform public.recompute_supplier_compliance(s.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._onb_carry_over(uuid[]), public._onb_gate_states(uuid), public._onb_stages_complete(uuid, int),
  public._onb_setting(text), public.trg_onb_recompute(), public.trg_supplier_guard_onboarding() from public, anon, authenticated;

select public._onb_carry_over(array(select id from public.suppliers));
alter table public.supplier_gates enable trigger gate_changed;
