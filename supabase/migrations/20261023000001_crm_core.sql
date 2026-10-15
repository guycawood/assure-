-- CRM (client relationship management), module key 'crm': the client-side mirror of SRM.
-- CRM owns the relationship around the existing client master (public.sourcing_clients), which every section keeps using:
--   * accounts per client and market (account lead, tier from the Watchtower library, region/market from the market master),
--   * contacts (client people, decision role, consent), interactions (activity log), opportunities (lead -> won/lost),
--   * account plans with actions, client contracts and commercial terms, feedback / NPS (internal capture and Client Portal),
--   * client health computed from spend, bills, feedback, renewals and activity (view crm_client_health).
-- Rules: every CRM table is internal-only (RLS is_internal()); all writes go through the security definer functions below,
-- which check the caller and write an audit row (crm_events, append-only) in the same transaction. Identity is auth.uid().
-- Commercial terms on sourcing_clients (markup, GSC commission, rebate, payment terms) and the new-client set-up status can
-- only change through CRM's approval requests (see 20261023000002); Sourcing, Orders and Finance+ keep reading the same columns.

-- ---------------------------------------------------------------------------
-- Watchtower libraries (module 'crm'). library_definitions.module has no check constraint, so no constraint change is needed.
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('crm_account_tiers', 'crm', 'Account tiers', 'How much attention a client account gets: strategic, key, growth or business as usual, with the review cadence.', false, 1),
  ('crm_opportunity_stages', 'crm', 'Opportunity stages', 'Pipeline stages from lead to won or lost, with the default probability used for the weighted pipeline.', true, 2),
  ('crm_lost_reasons', 'crm', 'Lost reasons', 'Why an opportunity was lost. Required when an opportunity is marked lost.', false, 3),
  ('crm_interaction_types', 'crm', 'Interaction types', 'Kinds of client activity logged in CRM: meetings, calls, emails, QBRs and notes.', false, 4)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from)
select x.k, x.code, x.name, x.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('crm_account_tiers', 'STRATEGIC', 'Strategic', '{"description":"Global partner accounts with an executive sponsor and a quarterly business review.","review_cadence_days":90,"order":1}'),
    ('crm_account_tiers', 'KEY', 'Key', '{"description":"Large accounts with a named account lead and a yearly account plan.","review_cadence_days":120,"order":2}'),
    ('crm_account_tiers', 'GROWTH', 'Growth', '{"description":"Accounts with clear potential to grow; managed against a growth target.","review_cadence_days":180,"order":3}'),
    ('crm_account_tiers', 'BAU', 'Business as usual', '{"description":"Run-rate accounts served through the standard process.","review_cadence_days":365,"order":4}'),
    ('crm_opportunity_stages', 'lead', 'Lead', '{"default_probability":10,"order":1,"open":true}'),
    ('crm_opportunity_stages', 'qualified', 'Qualified', '{"default_probability":25,"order":2,"open":true}'),
    ('crm_opportunity_stages', 'proposal', 'Proposal', '{"default_probability":50,"order":3,"open":true}'),
    ('crm_opportunity_stages', 'negotiation', 'Negotiation', '{"default_probability":75,"order":4,"open":true}'),
    ('crm_opportunity_stages', 'won', 'Won', '{"default_probability":100,"order":5,"open":false}'),
    ('crm_opportunity_stages', 'lost', 'Lost', '{"default_probability":0,"order":6,"open":false}'),
    ('crm_lost_reasons', 'PRICE', 'Price', '{"description":"Another agency or the client''s own supply chain was cheaper."}'),
    ('crm_lost_reasons', 'TIMING', 'Timing', '{"description":"The client moved the date or could not commit in time."}'),
    ('crm_lost_reasons', 'SCOPE', 'Scope changed or cancelled', '{"description":"The brief was cut, merged or cancelled by the client."}'),
    ('crm_lost_reasons', 'INCUMBENT', 'Incumbent kept', '{"description":"The client stayed with the existing supplier."}'),
    ('crm_lost_reasons', 'CAPABILITY', 'Capability or coverage', '{"description":"We could not cover the market, format or volume."}'),
    ('crm_interaction_types', 'MEETING', 'Meeting', '{"description":"Face-to-face or video meeting.","counts_as_activity":true}'),
    ('crm_interaction_types', 'CALL', 'Call', '{"description":"Phone call.","counts_as_activity":true}'),
    ('crm_interaction_types', 'EMAIL', 'Email', '{"description":"An email exchange worth recording.","counts_as_activity":true}'),
    ('crm_interaction_types', 'QBR', 'Quarterly business review', '{"description":"Formal review of performance, plans and feedback with the client.","counts_as_activity":true}'),
    ('crm_interaction_types', 'NOTE', 'Note', '{"description":"Internal note about the relationship.","counts_as_activity":false}')
  ) x(k, code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = x.k and r.code = x.code);

-- ---------------------------------------------------------------------------
-- Client master: CRM fields (the master itself stays sourcing_clients)
-- ---------------------------------------------------------------------------
alter table public.sourcing_clients
  add column if not exists hq_market text references public.markets(code),
  add column if not exists sector text,
  add column if not exists credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  add column if not exists payment_terms_days int check (payment_terms_days is null or payment_terms_days between 0 and 365),
  -- New client set-up (credit / KYC check). Existing clients are approved; new ones wait for Finance when a policy applies.
  add column if not exists crm_setup_status text not null default 'approved' check (crm_setup_status in ('pending','approved','rejected')),
  add column if not exists crm_setup_note text,
  add column if not exists setup_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists setup_approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  market text not null references public.markets(code),
  region text not null references public.regions(code),       -- from the market master (trigger)
  account_lead uuid references public.profiles(id) on delete set null,
  tier_id uuid references public.library_records(id),
  status text not null default 'active' check (status in ('prospect','active','dormant','closed')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, market)
);
create index crm_accounts_lead_idx on public.crm_accounts (account_lead);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  job_title text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  market text references public.markets(code),
  region text references public.regions(code),
  decision_role text not null default 'user' check (decision_role in ('sponsor','approver','buyer','user')),
  consent boolean not null default false,
  consent_at timestamptz,
  active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_contacts_client_idx on public.crm_contacts (client_id);

create sequence public.crm_opportunity_no;
create table public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  opp_code text not null unique default ('OPP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.crm_opportunity_no')::text, 5, '0')),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  stage text not null default 'lead' check (stage in ('lead','qualified','proposal','negotiation','won','lost')),
  value numeric(14,2) not null default 0 check (value >= 0),
  currency text not null default 'EUR',
  probability int not null default 10 check (probability between 0 and 100),
  expected_close date,
  owner uuid references public.profiles(id) on delete set null,
  lost_reason_id uuid references public.library_records(id),
  lost_note text,
  won_at timestamptz,
  won_confirmed_by uuid references public.profiles(id) on delete set null,
  lost_at timestamptz,
  campaign_id uuid references public.campaigns(id) on delete set null,
  region text references public.regions(code),
  market text references public.markets(code),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_opportunities_client_idx on public.crm_opportunities (client_id, stage);

-- Briefing+ campaigns created from a won opportunity point back to it.
alter table public.campaigns add column if not exists crm_opportunity_id uuid references public.crm_opportunities(id) on delete set null;
create unique index if not exists campaigns_crm_opportunity_uidx on public.campaigns (crm_opportunity_id) where crm_opportunity_id is not null;

create table public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  type_id uuid not null references public.library_records(id),
  subject text not null check (length(trim(subject)) > 0),
  summary text,
  occurred_at timestamptz not null default now(),
  owner uuid references public.profiles(id) on delete set null,      -- who had the interaction
  region text references public.regions(code),
  market text references public.markets(code),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_interactions_client_idx on public.crm_interactions (client_id, occurred_at desc);

create table public.crm_account_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  period_start date not null,
  period_end date not null,
  objectives text,
  growth_target numeric(14,2) check (growth_target is null or growth_target >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft' check (status in ('draft','active','closed')),
  owner uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.crm_plan_actions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.crm_account_plans(id) on delete cascade,
  action text not null check (length(trim(action)) > 0),
  owner uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open','done','dropped')),
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create sequence public.crm_contract_no;
create table public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_code text not null unique default ('CC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.crm_contract_no')::text, 5, '0')),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  parent_id uuid references public.crm_contracts(id) on delete set null,   -- a SOW under its MSA
  contract_type text not null check (contract_type in ('msa','sow','other')),
  title text not null check (length(trim(title)) > 0),
  start_date date,
  end_date date,
  renewal_date date,
  notice_days int check (notice_days is null or notice_days between 0 and 730),
  auto_renew boolean not null default false,
  value numeric(14,2) check (value is null or value >= 0),
  currency text not null default 'EUR',
  -- Commercial terms written into the contract (the live rules are on sourcing_clients and change by approved request).
  payment_terms_days int check (payment_terms_days is null or payment_terms_days between 0 and 365),
  markup_percent numeric(6,2) check (markup_percent is null or markup_percent >= 0),
  min_margin_percent numeric(6,2) check (min_margin_percent is null or min_margin_percent between 0 and 99),
  gsc_commission_percent numeric(6,2) check (gsc_commission_percent is null or gsc_commission_percent between 0 and 50),
  rebate_percent numeric(6,2) check (rebate_percent is null or rebate_percent between 0 and 50),
  sustainability_commitments text,
  status text not null default 'draft' check (status in ('draft','signed','ended')),
  signed_at timestamptz,
  signed_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  renewal_count int not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index crm_contracts_client_idx on public.crm_contracts (client_id, status);

create table public.crm_feedback (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  market text references public.markets(code),
  region text references public.regions(code),
  score int not null check (score between 0 and 10),
  comment text check (comment is null or length(comment) <= 4000),
  source text not null check (source in ('internal','client_portal')),
  submitted_by uuid references public.profiles(id) on delete set null,   -- the client user (portal) or the colleague who captured it
  followed_up_at timestamptz,
  followed_up_by uuid references public.profiles(id) on delete set null,
  follow_up_note text,
  created_at timestamptz not null default now()
);
create index crm_feedback_client_idx on public.crm_feedback (client_id, created_at desc);

-- Append-only audit of every CRM write.
create table public.crm_events (
  id bigint generated always as identity primary key,
  client_id uuid references public.sourcing_clients(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index crm_events_entity_idx on public.crm_events (entity_type, entity_id, at desc);
create index crm_events_client_idx on public.crm_events (client_id, at desc);
create trigger crm_events_no_update before update on public.crm_events for each row execute function public.trg_client_append_only();

-- ---------------------------------------------------------------------------
-- Library references (usage guard) and market -> region
-- ---------------------------------------------------------------------------
create trigger crm_accounts_tier_check before insert or update of tier_id on public.crm_accounts
  for each row execute function public.trg_sourcing_library_ref('tier_id', 'crm_account_tiers', 'CRM account');
create trigger crm_accounts_tier_sync after insert or update of tier_id or delete on public.crm_accounts
  for each row execute function public.trg_sourcing_library_ref('tier_id', 'crm_account_tiers', 'CRM account');
create trigger crm_interactions_type_check before insert or update of type_id on public.crm_interactions
  for each row execute function public.trg_sourcing_library_ref('type_id', 'crm_interaction_types', 'CRM interaction');
create trigger crm_interactions_type_sync after insert or update of type_id or delete on public.crm_interactions
  for each row execute function public.trg_sourcing_library_ref('type_id', 'crm_interaction_types', 'CRM interaction');
create trigger crm_opportunities_lost_check before insert or update of lost_reason_id on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('lost_reason_id', 'crm_lost_reasons', 'CRM opportunity');
create trigger crm_opportunities_lost_sync after insert or update of lost_reason_id or delete on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('lost_reason_id', 'crm_lost_reasons', 'CRM opportunity');

create or replace function public._crm_region(p_market text) returns text
language sql stable security definer set search_path = public as $$
  select region_code from public.markets where code = p_market;
$$;

create or replace function public.trg_crm_market_region() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.market is not null then new.region := coalesce(public._crm_region(new.market), new.region); end if;
  if tg_op = 'UPDATE' and to_jsonb(new) ? 'updated_at' then new := jsonb_populate_record(new, jsonb_build_object('updated_at', now())); end if;
  return new;
end $$;
create trigger crm_accounts_region before insert or update on public.crm_accounts for each row execute function public.trg_crm_market_region();
create trigger crm_contacts_region before insert or update on public.crm_contacts for each row execute function public.trg_crm_market_region();
create trigger crm_opportunities_region before insert or update on public.crm_opportunities for each row execute function public.trg_crm_market_region();
create trigger crm_interactions_region before insert or update on public.crm_interactions for each row execute function public.trg_crm_market_region();
create trigger crm_feedback_region before insert or update on public.crm_feedback for each row execute function public.trg_crm_market_region();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._crm_require() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only adm Indicia staff can do this in CRM' using errcode = '42501'; end if;
end $$;

create or replace function public._crm_event(p_client uuid, p_entity text, p_id text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
  values (p_client, p_entity, p_id, p_action, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

create or replace function public._crm_internal_person(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is null or exists (select 1 from public.profiles where id = p_user and (is_admin or user_type = 'internal'));
$$;

-- Default probability for a stage (Watchtower library, effective today).
create or replace function public.crm_stage_probability(p_stage text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(e.data->>'default_probability', '')::int from public.library_effective('crm_opportunity_stages', p_stage, current_date) e where e.id is not null),
    case p_stage when 'lead' then 10 when 'qualified' then 25 when 'proposal' then 50 when 'negotiation' then 75 when 'won' then 100 else 0 end);
$$;

-- Active library record of the given library (by id), or an error.
create or replace function public._crm_lib(p_id uuid, p_key text, p_label text) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null then return null; end if;
  if not exists (select 1 from public.library_records where id = p_id and library_key = p_key and status = 'active') then
    raise exception 'Choose an active % from the Watchtower library', p_label;
  end if;
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
-- Anyone at adm Indicia can open an account; changing the lead or tier of an existing account takes the current account
-- lead, a CRM owner or an admin.
create or replace function public.crm_account_save(p_id uuid, p_client uuid, p_market text, p_account_lead uuid, p_tier_id uuid,
  p_status text default 'active', p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.crm_accounts; v_market text := public._market_code(p_market); v_id uuid;
begin
  perform public._crm_require();
  if not public._crm_internal_person(p_account_lead) then raise exception 'The account lead must be someone at adm Indicia'; end if;
  perform public._crm_lib(p_tier_id, 'crm_account_tiers', 'account tier');
  if coalesce(p_status, 'active') not in ('prospect','active','dormant','closed') then raise exception 'Choose prospect, active, dormant or closed'; end if;
  if p_id is null then
    if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
    if v_market is null or not exists (select 1 from public.markets where code = v_market) then raise exception 'Choose a market from the market master'; end if;
    if exists (select 1 from public.crm_accounts where client_id = p_client and market = v_market) then raise exception 'This client already has an account in %', public._market_name(v_market); end if;
    insert into public.crm_accounts (client_id, market, region, account_lead, tier_id, status, notes, created_by)
    values (p_client, v_market, public._crm_region(v_market), p_account_lead, p_tier_id, coalesce(p_status, 'active'), nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
    perform public._crm_event(p_client, 'account', v_id::text, 'created', jsonb_build_object('market', v_market, 'account_lead', p_account_lead, 'tier_id', p_tier_id));
    return v_id;
  end if;
  select * into a from public.crm_accounts where id = p_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if (a.account_lead is distinct from p_account_lead or a.tier_id is distinct from p_tier_id)
     and not (public.can_govern('crm') or a.account_lead = auth.uid() or a.account_lead is null) then
    raise exception 'Only the account lead, a CRM owner or an admin can change the lead or tier' using errcode = '42501';
  end if;
  update public.crm_accounts set account_lead = p_account_lead, tier_id = p_tier_id, status = coalesce(p_status, status), notes = nullif(trim(p_notes), '')
   where id = p_id;
  perform public._crm_event(a.client_id, 'account', p_id::text, 'updated', jsonb_build_object(
    'account_lead', jsonb_build_array(a.account_lead, p_account_lead), 'tier_id', jsonb_build_array(a.tier_id, p_tier_id), 'status', jsonb_build_array(a.status, p_status)));
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Contacts (client people)
-- ---------------------------------------------------------------------------
create or replace function public.crm_contact_save(p_id uuid, p_client uuid, p_account uuid, p_full_name text, p_job_title text, p_email text,
  p_phone text, p_market text, p_decision_role text, p_consent boolean, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.crm_contacts; v_id uuid; v_market text := public._market_code(p_market); v_client uuid := p_client;
begin
  perform public._crm_require();
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Enter the contact''s name'; end if;
  if coalesce(p_decision_role, 'user') not in ('sponsor','approver','buyer','user') then raise exception 'Choose sponsor, approver, buyer or user'; end if;
  if v_market is not null and not exists (select 1 from public.markets where code = v_market) then raise exception 'Choose a market from the market master'; end if;
  if p_id is not null then
    select * into c from public.crm_contacts where id = p_id for update;
    if c.id is null then raise exception 'Contact not found'; end if;
    v_client := c.client_id;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if p_account is not null and not exists (select 1 from public.crm_accounts where id = p_account and client_id = v_client) then
    raise exception 'The account must belong to the same client';
  end if;
  if p_id is null then
    insert into public.crm_contacts (client_id, account_id, full_name, job_title, email, phone, market, decision_role, consent, consent_at, active, created_by)
    values (v_client, p_account, trim(p_full_name), nullif(trim(p_job_title), ''), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), v_market,
            coalesce(p_decision_role, 'user'), coalesce(p_consent, false), case when coalesce(p_consent, false) then now() end, coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform public._crm_event(v_client, 'contact', v_id::text, 'created', jsonb_build_object('name', trim(p_full_name), 'consent', coalesce(p_consent, false)));
    return v_id;
  end if;
  update public.crm_contacts set account_id = p_account, full_name = trim(p_full_name), job_title = nullif(trim(p_job_title), ''),
    email = nullif(lower(trim(p_email)), ''), phone = nullif(trim(p_phone), ''), market = v_market, decision_role = coalesce(p_decision_role, decision_role),
    consent = coalesce(p_consent, false),
    consent_at = case when coalesce(p_consent, false) and not c.consent then now() when not coalesce(p_consent, false) then null else consent_at end,
    active = coalesce(p_active, true)
   where id = p_id;
  perform public._crm_event(v_client, 'contact', p_id::text, 'updated', jsonb_build_object('consent', jsonb_build_array(c.consent, coalesce(p_consent, false)),
    'active', jsonb_build_array(c.active, coalesce(p_active, true))));
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Interactions (activity log)
-- ---------------------------------------------------------------------------
create or replace function public.crm_interaction_log(p_client uuid, p_account uuid, p_opportunity uuid, p_type_id uuid, p_subject text,
  p_summary text default null, p_occurred_at timestamptz default null, p_contact uuid default null, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text; v_client uuid := p_client;
begin
  perform public._crm_require();
  if p_opportunity is not null then
    select client_id, coalesce(account_id, p_account) into v_client, p_account from public.crm_opportunities where id = p_opportunity;
    if v_client is null then raise exception 'Opportunity not found'; end if;
    if p_client is not null and p_client <> v_client then raise exception 'The opportunity belongs to another client'; end if;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if p_type_id is null then raise exception 'Choose the type of interaction'; end if;
  perform public._crm_lib(p_type_id, 'crm_interaction_types', 'interaction type');
  if coalesce(trim(p_subject), '') = '' then raise exception 'Say what the interaction was about'; end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '1 day' then raise exception 'Log interactions that have happened; plan future ones as account plan actions'; end if;
  if p_account is not null then
    select market into v_market from public.crm_accounts where id = p_account and client_id = v_client;
    if v_market is null then raise exception 'The account must belong to the same client'; end if;
  end if;
  if p_contact is not null and not exists (select 1 from public.crm_contacts where id = p_contact and client_id = v_client) then raise exception 'The contact must belong to the same client'; end if;
  if not public._crm_internal_person(p_owner) then raise exception 'Who had the interaction must be someone at adm Indicia'; end if;
  insert into public.crm_interactions (client_id, account_id, opportunity_id, contact_id, type_id, subject, summary, occurred_at, owner, market, created_by)
  values (v_client, p_account, p_opportunity, p_contact, p_type_id, trim(p_subject), nullif(trim(p_summary), ''), coalesce(p_occurred_at, now()),
          coalesce(p_owner, auth.uid()), v_market, auth.uid())
  returning id into v_id;
  perform public._crm_event(v_client, 'interaction', v_id::text, 'logged', jsonb_build_object('subject', trim(p_subject), 'opportunity', p_opportunity));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Opportunities
-- ---------------------------------------------------------------------------
create or replace function public.crm_opportunity_create(p_client uuid, p_account uuid, p_title text, p_value numeric, p_currency text,
  p_expected_close date, p_stage text default 'lead', p_description text default null, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text; v_stage text := coalesce(p_stage, 'lead');
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if v_stage not in ('lead','qualified','proposal','negotiation') then raise exception 'New opportunities start at lead, qualified, proposal or negotiation'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the opportunity a title'; end if;
  if p_value is null or p_value < 0 then raise exception 'Enter the expected value'; end if;
  if p_account is not null then
    select market into v_market from public.crm_accounts where id = p_account and client_id = p_client;
    if v_market is null then raise exception 'The account must belong to the same client'; end if;
  end if;
  if not public._crm_internal_person(p_owner) then raise exception 'The owner must be someone at adm Indicia'; end if;
  insert into public.crm_opportunities (client_id, account_id, title, description, stage, value, currency, probability, expected_close, owner, market, created_by)
  values (p_client, p_account, trim(p_title), nullif(trim(p_description), ''), v_stage, p_value,
          coalesce(nullif(upper(trim(p_currency)), ''), (select default_currency from public.sourcing_clients where id = p_client)),
          public.crm_stage_probability(v_stage), p_expected_close, coalesce(p_owner, auth.uid()), v_market, auth.uid())
  returning id into v_id;
  perform public._crm_event(p_client, 'opportunity', v_id::text, 'created', jsonb_build_object('title', trim(p_title), 'stage', v_stage, 'value', p_value));
  return v_id;
end $$;

create or replace function public.crm_opportunity_update(p_id uuid, p_title text, p_value numeric, p_currency text, p_probability int,
  p_expected_close date, p_description text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.crm_opportunities;
begin
  perform public._crm_require();
  select * into o from public.crm_opportunities where id = p_id for update;
  if o.id is null then raise exception 'Opportunity not found'; end if;
  if o.stage in ('won','lost') then raise exception 'This opportunity is closed (%); it can''t be edited', o.stage; end if;
  if exists (select 1 from public.approval_requests where approval_type = 'CRM_OPP_WON' and entity_id = p_id::text and status = 'pending') then
    raise exception 'This opportunity is waiting for its win to be confirmed; withdraw the request to edit it';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the opportunity a title'; end if;
  if p_value is null or p_value < 0 then raise exception 'Enter the expected value'; end if;
  if p_probability is not null and (p_probability < 0 or p_probability > 100) then raise exception 'Probability is between 0 and 100'; end if;
  update public.crm_opportunities set title = trim(p_title), value = p_value, currency = coalesce(nullif(upper(trim(p_currency)), ''), currency),
    probability = coalesce(p_probability, probability), expected_close = p_expected_close, description = nullif(trim(p_description), '')
   where id = p_id;
  perform public._crm_event(o.client_id, 'opportunity', p_id::text, 'updated', jsonb_build_object('value', jsonb_build_array(o.value, p_value),
    'probability', jsonb_build_array(o.probability, coalesce(p_probability, o.probability)), 'expected_close', jsonb_build_array(o.expected_close, p_expected_close)));
end $$;

-- Stage moves. Open stages move freely; won and lost are final. Lost needs a lost reason from the library. Marking an
-- opportunity won can need a sales lead's confirmation (CRM_OPP_WON policy, value threshold; see 20261023000002): the
-- function then returns 'pending' and the move happens when the request is approved.
create or replace function public.crm_opportunity_move(p_id uuid, p_stage text, p_note text default null, p_lost_reason uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare o public.crm_opportunities;
begin
  perform public._crm_require();
  select * into o from public.crm_opportunities where id = p_id for update;
  if o.id is null then raise exception 'Opportunity not found'; end if;
  if p_stage not in ('lead','qualified','proposal','negotiation','won','lost') then raise exception 'Unknown stage %', p_stage; end if;
  if o.stage in ('won','lost') then raise exception 'This opportunity is already %', o.stage; end if;
  if o.stage = p_stage then raise exception 'The opportunity is already at %', p_stage; end if;
  if exists (select 1 from public.approval_requests where approval_type = 'CRM_OPP_WON' and entity_id = p_id::text and status = 'pending') then
    raise exception 'This opportunity is waiting for its win to be confirmed';
  end if;
  if p_stage = 'lost' then
    if p_lost_reason is null then raise exception 'Choose why it was lost'; end if;
    perform public._crm_lib(p_lost_reason, 'crm_lost_reasons', 'lost reason');
  end if;
  -- Policy-driven: a CRM_OPP_WON policy whose value threshold is met turns "won" into a request a sales lead confirms.
  if p_stage = 'won' and not public._approval_applying('CRM_OPP_WON', p_id::text)
     and exists (select 1 from public._approval_policy('CRM_OPP_WON', o.client_id, o.market, o.value)) then
    perform public._approval_request_open('crm', 'CRM_OPP_WON', 'opportunity', p_id::text, o.opp_code,
      'Confirm win: ' || o.title || ' (' || (select name from public.sourcing_clients where id = o.client_id) || ')',
      jsonb_build_object('note', nullif(trim(p_note), ''), 'from', o.stage), p_note, o.value, o.currency, o.client_id, o.market, o.region,
      '/crm/pipeline?opp=' || p_id, 'module_owner', 'crm', 'requester', '{}'::uuid[],
      'Marked won from ' || o.stage || ' at ' || o.currency || ' ' || to_char(o.value, 'FM999,999,999,990'));
    perform public._crm_event(o.client_id, 'opportunity', p_id::text, 'win_requested', jsonb_build_object('value', o.value));
    return 'pending';
  end if;
  update public.crm_opportunities set stage = p_stage, probability = public.crm_stage_probability(p_stage),
    lost_reason_id = case when p_stage = 'lost' then p_lost_reason end, lost_note = case when p_stage = 'lost' then nullif(trim(p_note), '') end,
    won_at = case when p_stage = 'won' then now() end, lost_at = case when p_stage = 'lost' then now() end,
    won_confirmed_by = case when p_stage = 'won' then (select decided_by from public.approval_requests
                              where approval_type = 'CRM_OPP_WON' and entity_id = p_id::text and status = 'applying') end
   where id = p_id;
  perform public._crm_event(o.client_id, 'opportunity', p_id::text, 'stage_changed',
    jsonb_build_object('from', o.stage, 'to', p_stage, 'note', nullif(trim(p_note), ''), 'lost_reason_id', p_lost_reason));
  return 'moved';
end $$;

-- A won opportunity becomes a campaign in Briefing+ (planning), linked both ways. Once only.
create or replace function public.crm_opportunity_to_campaign(p_id uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.crm_opportunities; c public.sourcing_clients; v_id uuid;
begin
  perform public._crm_require();
  select * into o from public.crm_opportunities where id = p_id for update;
  if o.id is null then raise exception 'Opportunity not found'; end if;
  if o.stage <> 'won' then raise exception 'Only a won opportunity can become a campaign'; end if;
  if o.campaign_id is not null or exists (select 1 from public.campaigns where crm_opportunity_id = p_id) then
    raise exception 'This opportunity already has a campaign in Briefing+';
  end if;
  select * into c from public.sourcing_clients where id = o.client_id;
  if c.crm_setup_status <> 'approved' then raise exception '% is waiting for Finance to approve the new client set-up', c.name; end if;
  insert into public.campaigns (name, client, client_id, objective, start_date, status, created_by, crm_opportunity_id)
  values (coalesce(nullif(trim(p_name), ''), o.title), c.name, c.id, o.description, greatest(coalesce(o.expected_close, current_date), current_date),
          'planning', auth.uid(), o.id)
  returning id into v_id;
  if o.market is not null then
    insert into public.campaign_markets (campaign_id, region, market) values (v_id, coalesce(o.region, public._crm_region(o.market)), o.market) on conflict do nothing;
  end if;
  update public.crm_opportunities set campaign_id = v_id where id = p_id;
  perform public._crm_event(o.client_id, 'opportunity', p_id::text, 'campaign_created', jsonb_build_object('campaign_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Account plans
-- ---------------------------------------------------------------------------
create or replace function public.crm_plan_save(p_id uuid, p_client uuid, p_account uuid, p_title text, p_period_start date, p_period_end date,
  p_objectives text, p_growth_target numeric, p_currency text, p_status text default 'draft', p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl public.crm_account_plans; v_id uuid; v_client uuid := p_client;
begin
  perform public._crm_require();
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the plan a title'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Enter a plan period that ends after it starts'; end if;
  if coalesce(p_status, 'draft') not in ('draft','active','closed') then raise exception 'Choose draft, active or closed'; end if;
  if p_growth_target is not null and p_growth_target < 0 then raise exception 'The growth target can''t be negative'; end if;
  if not public._crm_internal_person(p_owner) then raise exception 'The owner must be someone at adm Indicia'; end if;
  if p_id is not null then
    select * into pl from public.crm_account_plans where id = p_id for update;
    if pl.id is null then raise exception 'Plan not found'; end if;
    v_client := pl.client_id;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if p_account is not null and not exists (select 1 from public.crm_accounts where id = p_account and client_id = v_client) then raise exception 'The account must belong to the same client'; end if;
  if p_id is null then
    insert into public.crm_account_plans (client_id, account_id, title, period_start, period_end, objectives, growth_target, currency, status, owner, created_by)
    values (v_client, p_account, trim(p_title), p_period_start, p_period_end, nullif(trim(p_objectives), ''), p_growth_target,
            coalesce(nullif(upper(trim(p_currency)), ''), (select default_currency from public.sourcing_clients where id = v_client)), coalesce(p_status, 'draft'),
            coalesce(p_owner, auth.uid()), auth.uid())
    returning id into v_id;
    perform public._crm_event(v_client, 'plan', v_id::text, 'created', jsonb_build_object('title', trim(p_title), 'growth_target', p_growth_target));
    return v_id;
  end if;
  update public.crm_account_plans set account_id = p_account, title = trim(p_title), period_start = p_period_start, period_end = p_period_end,
    objectives = nullif(trim(p_objectives), ''), growth_target = p_growth_target, currency = coalesce(nullif(upper(trim(p_currency)), ''), currency),
    status = coalesce(p_status, status), owner = coalesce(p_owner, owner)
   where id = p_id;
  perform public._crm_event(v_client, 'plan', p_id::text, 'updated', jsonb_build_object('status', jsonb_build_array(pl.status, p_status),
    'growth_target', jsonb_build_array(pl.growth_target, p_growth_target)));
  return p_id;
end $$;

create or replace function public.crm_plan_action_add(p_plan uuid, p_action text, p_owner uuid, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl public.crm_account_plans; v_id uuid;
begin
  perform public._crm_require();
  select * into pl from public.crm_account_plans where id = p_plan;
  if pl.id is null then raise exception 'Plan not found'; end if;
  if pl.status = 'closed' then raise exception 'This plan is closed'; end if;
  if coalesce(trim(p_action), '') = '' then raise exception 'Describe the action'; end if;
  if not public._crm_internal_person(p_owner) then raise exception 'The owner must be someone at adm Indicia'; end if;
  insert into public.crm_plan_actions (plan_id, action, owner, due_date, created_by) values (p_plan, trim(p_action), coalesce(p_owner, auth.uid()), p_due, auth.uid())
  returning id into v_id;
  perform public._crm_event(pl.client_id, 'plan', p_plan::text, 'action_added', jsonb_build_object('action', trim(p_action), 'due', p_due));
  return v_id;
end $$;

create or replace function public.crm_plan_action_set(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.crm_plan_actions; v_client uuid;
begin
  perform public._crm_require();
  select * into x from public.crm_plan_actions where id = p_id for update;
  if x.id is null then raise exception 'Action not found'; end if;
  if p_status not in ('open','done','dropped') then raise exception 'Choose open, done or dropped'; end if;
  update public.crm_plan_actions set status = p_status, done_at = case when p_status = 'done' then now() end where id = p_id;
  select client_id into v_client from public.crm_account_plans where id = x.plan_id;
  perform public._crm_event(v_client, 'plan', x.plan_id::text, 'action_' || p_status, jsonb_build_object('action', x.action));
end $$;

-- ---------------------------------------------------------------------------
-- Contracts (drafts are edited here; signing and renewal are in 20261023000002, gated by policy)
-- ---------------------------------------------------------------------------
create or replace function public.crm_contract_save(p_id uuid, p_client uuid, p_type text, p_parent uuid, p_title text, p_start date, p_end date,
  p_renewal date, p_notice_days int, p_value numeric, p_currency text, p_payment_terms_days int, p_markup numeric, p_min_margin numeric,
  p_commission numeric, p_rebate numeric, p_auto_renew boolean default false, p_sustainability text default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare k public.crm_contracts; v_id uuid; v_client uuid := p_client;
begin
  perform public._crm_require();
  if p_type not in ('msa','sow','other') then raise exception 'Choose MSA, SOW or other'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the contract a title'; end if;
  if p_end is not null and p_start is not null and p_end < p_start then raise exception 'The end date must be after the start date'; end if;
  if p_id is not null then
    select * into k from public.crm_contracts where id = p_id for update;
    if k.id is null then raise exception 'Contract not found'; end if;
    if k.status <> 'draft' then raise exception 'Only a draft contract can be edited; renew a signed one instead'; end if;
    if exists (select 1 from public.approval_requests where approval_type = 'CRM_CONTRACT' and entity_id = p_id::text and status = 'pending') then
      raise exception 'This contract is waiting for approval; withdraw the request to edit it';
    end if;
    v_client := k.client_id;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if p_parent is not null and not exists (select 1 from public.crm_contracts where id = p_parent and client_id = v_client and contract_type = 'msa') then
    raise exception 'A SOW sits under an MSA of the same client';
  end if;
  if p_id is null then
    insert into public.crm_contracts (client_id, parent_id, contract_type, title, start_date, end_date, renewal_date, notice_days, auto_renew, value, currency,
      payment_terms_days, markup_percent, min_margin_percent, gsc_commission_percent, rebate_percent, sustainability_commitments, notes, created_by)
    values (v_client, p_parent, p_type, trim(p_title), p_start, p_end, p_renewal, p_notice_days, coalesce(p_auto_renew, false), p_value,
      coalesce(nullif(upper(trim(p_currency)), ''), (select default_currency from public.sourcing_clients where id = v_client)),
      p_payment_terms_days, p_markup, p_min_margin, p_commission, p_rebate, nullif(trim(p_sustainability), ''), nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
    perform public._crm_event(v_client, 'contract', v_id::text, 'created', jsonb_build_object('title', trim(p_title), 'type', p_type, 'value', p_value));
    return v_id;
  end if;
  update public.crm_contracts set parent_id = p_parent, contract_type = p_type, title = trim(p_title), start_date = p_start, end_date = p_end, renewal_date = p_renewal,
    notice_days = p_notice_days, auto_renew = coalesce(p_auto_renew, false), value = p_value, currency = coalesce(nullif(upper(trim(p_currency)), ''), currency),
    payment_terms_days = p_payment_terms_days, markup_percent = p_markup, min_margin_percent = p_min_margin, gsc_commission_percent = p_commission,
    rebate_percent = p_rebate, sustainability_commitments = nullif(trim(p_sustainability), ''), notes = nullif(trim(p_notes), '')
   where id = p_id;
  perform public._crm_event(v_client, 'contract', p_id::text, 'updated', jsonb_build_object('value', jsonb_build_array(k.value, p_value)));
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Feedback / NPS (internal capture; the Client Portal path is in 20261023000002)
-- ---------------------------------------------------------------------------
create or replace function public.crm_feedback_capture(p_client uuid, p_account uuid, p_contact uuid, p_score int, p_comment text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text;
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'Give a score from 0 to 10'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  if p_account is not null then
    select market into v_market from public.crm_accounts where id = p_account and client_id = p_client;
    if v_market is null then raise exception 'The account must belong to the same client'; end if;
  end if;
  if p_contact is not null and not exists (select 1 from public.crm_contacts where id = p_contact and client_id = p_client) then raise exception 'The contact must belong to the same client'; end if;
  insert into public.crm_feedback (client_id, account_id, contact_id, market, score, comment, source, submitted_by)
  values (p_client, p_account, p_contact, v_market, p_score, nullif(trim(p_comment), ''), 'internal', auth.uid())
  returning id into v_id;
  perform public._crm_event(p_client, 'feedback', v_id::text, 'captured', jsonb_build_object('score', p_score));
  return v_id;
end $$;

create or replace function public.crm_feedback_follow_up(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.crm_feedback;
begin
  perform public._crm_require();
  select * into f from public.crm_feedback where id = p_id for update;
  if f.id is null then raise exception 'Feedback not found'; end if;
  if f.followed_up_at is not null then raise exception 'This feedback has already been followed up'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what was done about it'; end if;
  update public.crm_feedback set followed_up_at = now(), followed_up_by = auth.uid(), follow_up_note = trim(p_note) where id = p_id;
  perform public._crm_event(f.client_id, 'feedback', p_id::text, 'followed_up', jsonb_build_object('note', trim(p_note)));
end $$;

-- ---------------------------------------------------------------------------
-- Read models (security invoker: internal staff only, through RLS on the base tables)
-- ---------------------------------------------------------------------------
create view public.crm_accounts_v with (security_invoker = true) as
  select a.*, c.code as client_code, c.name as client_name, c.default_currency, m.name as market_name, t.code as tier_code, t.name as tier_name,
         coalesce(nullif(p.full_name, ''), p.email) as account_lead_name, p.email as account_lead_email,
         (select max(i.occurred_at) from public.crm_interactions i where i.account_id = a.id) as last_activity_at,
         (select count(*) from public.crm_opportunities o where o.account_id = a.id and o.stage not in ('won','lost'))::int as open_opportunities
    from public.crm_accounts a
    join public.sourcing_clients c on c.id = a.client_id
    left join public.markets m on m.code = a.market
    left join public.library_records t on t.id = a.tier_id
    left join public.profiles p on p.id = a.account_lead;

create view public.crm_contacts_v with (security_invoker = true) as
  select ct.*, c.name as client_name, c.code as client_code, m.name as market_name, a.market as account_market
    from public.crm_contacts ct
    join public.sourcing_clients c on c.id = ct.client_id
    left join public.markets m on m.code = ct.market
    left join public.crm_accounts a on a.id = ct.account_id;

create view public.crm_opportunities_v with (security_invoker = true) as
  select o.*, c.name as client_name, c.code as client_code, m.name as market_name,
         round(o.value * o.probability / 100.0, 2) as weighted_value,
         coalesce(nullif(p.full_name, ''), p.email) as owner_name, lr.name as lost_reason_name,
         cp.campaign_code, cp.name as campaign_name,
         exists (select 1 from public.approval_requests ar where ar.approval_type = 'CRM_OPP_WON' and ar.entity_id = o.id::text and ar.status = 'pending') as win_pending
    from public.crm_opportunities o
    join public.sourcing_clients c on c.id = o.client_id
    left join public.markets m on m.code = o.market
    left join public.profiles p on p.id = o.owner
    left join public.library_records lr on lr.id = o.lost_reason_id
    left join public.campaigns cp on cp.id = o.campaign_id;

create view public.crm_interactions_v with (security_invoker = true) as
  select i.*, c.name as client_name, c.code as client_code, t.code as type_code, t.name as type_name,
         coalesce(nullif(p.full_name, ''), p.email) as owner_name, ct.full_name as contact_name, o.title as opportunity_title, o.opp_code
    from public.crm_interactions i
    join public.sourcing_clients c on c.id = i.client_id
    join public.library_records t on t.id = i.type_id
    left join public.profiles p on p.id = i.owner
    left join public.crm_contacts ct on ct.id = i.contact_id
    left join public.crm_opportunities o on o.id = i.opportunity_id;

create view public.crm_plans_v with (security_invoker = true) as
  select pl.*, c.name as client_name, c.code as client_code, a.market as account_market,
         coalesce(nullif(p.full_name, ''), p.email) as owner_name,
         (select count(*) from public.crm_plan_actions x where x.plan_id = pl.id)::int as actions_total,
         (select count(*) from public.crm_plan_actions x where x.plan_id = pl.id and x.status = 'done')::int as actions_done,
         (select count(*) from public.crm_plan_actions x where x.plan_id = pl.id and x.status = 'open' and x.due_date < current_date)::int as actions_overdue
    from public.crm_account_plans pl
    join public.sourcing_clients c on c.id = pl.client_id
    left join public.crm_accounts a on a.id = pl.account_id
    left join public.profiles p on p.id = pl.owner;

create view public.crm_plan_actions_v with (security_invoker = true) as
  select x.*, pl.client_id, pl.title as plan_title, coalesce(nullif(p.full_name, ''), p.email) as owner_name
    from public.crm_plan_actions x
    join public.crm_account_plans pl on pl.id = x.plan_id
    left join public.profiles p on p.id = x.owner;

create view public.crm_contracts_v with (security_invoker = true) as
  select k.*, c.name as client_name, c.code as client_code, par.contract_code as parent_code,
         coalesce(k.renewal_date, k.end_date) as next_renewal,
         case when k.status = 'signed' and coalesce(k.renewal_date, k.end_date) is not null
              then coalesce(k.renewal_date, k.end_date) - current_date end as days_to_renewal,
         coalesce(nullif(sp.full_name, ''), sp.email) as signed_by_name,
         exists (select 1 from public.approval_requests ar where ar.approval_type = 'CRM_CONTRACT' and ar.entity_id = k.id::text and ar.status = 'pending') as approval_pending
    from public.crm_contracts k
    join public.sourcing_clients c on c.id = k.client_id
    left join public.crm_contracts par on par.id = k.parent_id
    left join public.profiles sp on sp.id = k.signed_by;

create view public.crm_feedback_v with (security_invoker = true) as
  select f.*, c.name as client_name, c.code as client_code, ct.full_name as contact_name,
         coalesce(nullif(p.full_name, ''), p.email) as submitted_by_name,
         case when f.score >= 9 then 'promoter' when f.score >= 7 then 'passive' else 'detractor' end as nps_group
    from public.crm_feedback f
    join public.sourcing_clients c on c.id = f.client_id
    left join public.crm_contacts ct on ct.id = f.contact_id
    left join public.profiles p on p.id = f.submitted_by;

create view public.crm_events_v with (security_invoker = true) as
  select e.*, coalesce(nullif(p.full_name, ''), p.email) as actor_name from public.crm_events e left join public.profiles p on p.id = e.actor;

-- Client health (computed). Spend and bills in the client's default currency (no FX conversion yet).
-- Red flags (2 points): overdue bills, satisfaction under 6, no activity for 60+ days (or never), renewal within 30 days.
-- Amber flags (1 point): open detractor feedback not followed up, satisfaction under 8, no activity for 31-60 days, renewal within 90 days.
-- RAG: 4+ points red, 2-3 amber, else green.
create view public.crm_client_health with (security_invoker = true) as
  with b as (
    select c.id as client_id, c.code, c.name, c.default_currency as currency, c.active, c.crm_setup_status,
      (select coalesce(sum(e.sell_price), 0) from public.estimates e join public.jobs j on j.id = e.job_id
        where j.client_id = c.id and e.status = 'approved' and e.approved_at >= date_trunc('year', now()) and e.currency = c.default_currency) as spend_ytd,
      (select coalesce(sum(bl.gross_amount), 0) from public.client_bills bl
        where bl.client_id = c.id and bl.status in ('sent','paid') and bl.issue_date >= date_trunc('year', current_date)::date and bl.currency = c.default_currency) as billed_ytd,
      (select count(*) from public.client_bills bl where bl.client_id = c.id and bl.status = 'sent' and bl.due_date < current_date)::int as overdue_bills,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.score <= 6 and f.followed_up_at is null
         and f.created_at >= now() - interval '180 days')::int as open_issues,
      (select round(avg(f.score), 1) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months') as satisfaction,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as feedback_count,
      (select round(100.0 * (count(*) filter (where f.score >= 9) - count(*) filter (where f.score <= 6)) / nullif(count(*), 0))
         from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as nps,
      (select min(coalesce(k.renewal_date, k.end_date)) from public.crm_contracts k
        where k.client_id = c.id and k.status = 'signed' and coalesce(k.renewal_date, k.end_date) >= current_date) as next_renewal,
      (select max(i.occurred_at) from public.crm_interactions i where i.client_id = c.id) as last_activity_at,
      (select count(*) from public.crm_accounts a where a.client_id = c.id)::int as accounts
    from public.sourcing_clients c
  ), f as (
    select b.*, case when b.last_activity_at is null then null else (current_date - b.last_activity_at::date) end as days_since_activity,
           case when b.next_renewal is null then null else b.next_renewal - current_date end as days_to_renewal
      from b
  ), s as (
    select f.*,
      (case when f.overdue_bills > 0 then 2 else 0 end
       + case when f.satisfaction is not null and f.satisfaction < 6 then 2 when f.satisfaction is not null and f.satisfaction < 8 then 1 else 0 end
       + case when f.days_since_activity is null or f.days_since_activity > 60 then 2 when f.days_since_activity > 30 then 1 else 0 end
       + case when f.days_to_renewal is not null and f.days_to_renewal <= 30 then 2 when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 1 else 0 end
       + case when f.open_issues > 0 then 1 else 0 end) as points,
      array_remove(array[
        case when f.overdue_bills > 0 then f.overdue_bills || ' overdue bill(s)' end,
        case when f.satisfaction is not null and f.satisfaction < 8 then 'Satisfaction ' || f.satisfaction || '/10' end,
        case when f.days_since_activity is null then 'No activity logged' when f.days_since_activity > 30 then 'No activity for ' || f.days_since_activity || ' days' end,
        case when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 'Renewal in ' || f.days_to_renewal || ' days' end,
        case when f.open_issues > 0 then f.open_issues || ' open detractor comment(s)' end], null) as reasons
      from f
  )
  select s.*, case when s.points >= 4 then 'red' when s.points >= 2 then 'amber' else 'green' end as rag from s;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.crm_accounts enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_interactions enable row level security;
alter table public.crm_account_plans enable row level security;
alter table public.crm_plan_actions enable row level security;
alter table public.crm_contracts enable row level security;
alter table public.crm_feedback enable row level security;
alter table public.crm_events enable row level security;
create policy crm_accounts_read on public.crm_accounts for select to authenticated using (public.is_internal());
create policy crm_contacts_read on public.crm_contacts for select to authenticated using (public.is_internal());
create policy crm_opportunities_read on public.crm_opportunities for select to authenticated using (public.is_internal());
create policy crm_interactions_read on public.crm_interactions for select to authenticated using (public.is_internal());
create policy crm_plans_read on public.crm_account_plans for select to authenticated using (public.is_internal());
create policy crm_plan_actions_read on public.crm_plan_actions for select to authenticated using (public.is_internal());
create policy crm_contracts_read on public.crm_contracts for select to authenticated using (public.is_internal());
create policy crm_feedback_read on public.crm_feedback for select to authenticated using (public.is_internal());
create policy crm_events_read on public.crm_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_accounts, public.crm_contacts, public.crm_opportunities, public.crm_interactions, public.crm_account_plans,
  public.crm_plan_actions, public.crm_contracts, public.crm_feedback, public.crm_events from authenticated, anon;
revoke all on public.crm_accounts, public.crm_contacts, public.crm_opportunities, public.crm_interactions, public.crm_account_plans,
  public.crm_plan_actions, public.crm_contracts, public.crm_feedback, public.crm_events from anon;
revoke insert, update, delete on public.crm_accounts_v, public.crm_contacts_v, public.crm_opportunities_v, public.crm_interactions_v, public.crm_plans_v,
  public.crm_plan_actions_v, public.crm_contracts_v, public.crm_feedback_v, public.crm_events_v, public.crm_client_health from authenticated, anon;
revoke all on public.crm_accounts_v, public.crm_contacts_v, public.crm_opportunities_v, public.crm_interactions_v, public.crm_plans_v,
  public.crm_plan_actions_v, public.crm_contracts_v, public.crm_feedback_v, public.crm_events_v, public.crm_client_health from anon;
revoke usage on sequence public.crm_opportunity_no, public.crm_contract_no from anon;

revoke execute on function public._crm_region(text), public.trg_crm_market_region(), public._crm_require(), public._crm_event(uuid, text, text, text, jsonb),
  public._crm_internal_person(uuid), public._crm_lib(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.crm_stage_probability(text),
  public.crm_account_save(uuid, uuid, text, uuid, uuid, text, text),
  public.crm_contact_save(uuid, uuid, uuid, text, text, text, text, text, text, boolean, boolean),
  public.crm_interaction_log(uuid, uuid, uuid, uuid, text, text, timestamptz, uuid, uuid),
  public.crm_opportunity_create(uuid, uuid, text, numeric, text, date, text, text, uuid),
  public.crm_opportunity_update(uuid, text, numeric, text, int, date, text),
  public.crm_opportunity_move(uuid, text, text, uuid),
  public.crm_opportunity_to_campaign(uuid, text),
  public.crm_plan_save(uuid, uuid, uuid, text, date, date, text, numeric, text, text, uuid),
  public.crm_plan_action_add(uuid, text, uuid, date), public.crm_plan_action_set(uuid, text),
  public.crm_contract_save(uuid, uuid, text, uuid, text, date, date, date, int, numeric, text, int, numeric, numeric, numeric, numeric, boolean, text, text),
  public.crm_feedback_capture(uuid, uuid, uuid, int, text), public.crm_feedback_follow_up(uuid, text)
  from public, anon;
grant execute on function public.crm_stage_probability(text),
  public.crm_account_save(uuid, uuid, text, uuid, uuid, text, text),
  public.crm_contact_save(uuid, uuid, uuid, text, text, text, text, text, text, boolean, boolean),
  public.crm_interaction_log(uuid, uuid, uuid, uuid, text, text, timestamptz, uuid, uuid),
  public.crm_opportunity_create(uuid, uuid, text, numeric, text, date, text, text, uuid),
  public.crm_opportunity_update(uuid, text, numeric, text, int, date, text),
  public.crm_opportunity_move(uuid, text, text, uuid),
  public.crm_opportunity_to_campaign(uuid, text),
  public.crm_plan_save(uuid, uuid, uuid, text, date, date, text, numeric, text, text, uuid),
  public.crm_plan_action_add(uuid, text, uuid, date), public.crm_plan_action_set(uuid, text),
  public.crm_contract_save(uuid, uuid, text, uuid, text, date, date, date, int, numeric, text, int, numeric, numeric, numeric, numeric, boolean, text, text),
  public.crm_feedback_capture(uuid, uuid, uuid, int, text), public.crm_feedback_follow_up(uuid, text)
  to authenticated;
