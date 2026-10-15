-- CRM stage 2 (1 of 3): taking over from HubSpot (docs/CRM_HUBSPOT_REPLACEMENT.md).
--   * Governed CRM libraries: services, stakeholder matrix (influence x decision -> Inform / Establish / Maintain / Grow,
--     default mapping flagged "to confirm"), matrix quadrants, owner roles, next steps, settings, survey templates and
--     email templates.
--   * Stakeholder mapping on contacts (owner and owner role, department, relationship RAG, last contacted, contact
--     frequency, influence and decision-maker levels, services offered / declined, induction, receive survey, legal basis
--     for processing, email opt-out, left, quarterly review), edited cell by cell through crm_contact_set_field (audited).
--   * Performance Tracker on opportunities: contact, service, next steps, CS lead, SME, budget, probability, weighted
--     budget, "needs updating" after N days (crm_settings PERF_STALE_DAYS).
--   * hubspot_id on clients, contacts and opportunities for traceability of imported rows.

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('crm_services', 'crm', 'Services', 'The services adm Indicia offers clients. Used for services offered / declined on contacts, the Performance Tracker and survey awareness questions.', true, 5),
  ('crm_stakeholder_quadrants', 'crm', 'Stakeholder matrix quadrants', 'Inform, Establish, Maintain and Grow: the engagement strategy and suggested actions for each.', true, 6),
  ('crm_stakeholder_matrix', 'crm', 'Stakeholder matrix grid', 'Which quadrant each influence x decision-maker combination falls in. The default grid is marked to confirm.', true, 7),
  ('crm_owner_roles', 'crm', 'Contact owner roles', 'Roles of the adm Indicia person who owns a client contact (CP, BD, AM, MAM, RAD, TL, PM).', false, 8),
  ('crm_next_steps', 'crm', 'Next steps', 'Next-step categories for the Performance Tracker.', false, 9),
  ('crm_settings', 'crm', 'CRM settings', 'Numbers CRM works with: when an opportunity needs updating, how often stakeholders are reviewed.', true, 10),
  ('crm_survey_templates', 'crm', 'Survey templates', 'Customer satisfaction survey questions (1-5 by section), NPS and the open questions.', true, 11),
  ('crm_email_templates', 'crm', 'Email templates', 'Subject and body for CRM email sends. Placeholders: {{first_name}}, {{owner_name}}, {{client_name}}, {{link}}, {{unsubscribe}}.', false, 12)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from)
select x.k, x.code, x.name, x.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('crm_services', 'POSM', 'POS and display production', '{"order":1}'),
    ('crm_services', 'PERM', 'Permanent fixtures', '{"order":2}'),
    ('crm_services', 'PREMIUMS', 'Premiums and promotional merchandise', '{"order":3}'),
    ('crm_services', 'PACK', 'Packaging', '{"order":4}'),
    ('crm_services', 'INSTALL', 'Installation and field services', '{"order":5}'),
    ('crm_services', 'LOGISTICS', 'Logistics and warehousing', '{"order":6}'),
    ('crm_services', 'SUSTAIN', 'Sustainability consulting and reporting', '{"order":7}'),
    ('crm_services', 'SHOPPER', 'Shopper insight and effectiveness', '{"order":8}'),
    ('crm_services', 'CREATIVE', 'Creative and design', '{"order":9}'),
    ('crm_services', 'TECH', 'Technology platforms and reporting', '{"order":10}'),
    ('crm_stakeholder_quadrants', 'INFORM', 'Inform', '{"order":1,"strategy":"Keep informed with light-touch, regular updates.","actions":"Newsletters and case studies; invite to events; add to survey list."}'),
    ('crm_stakeholder_quadrants', 'ESTABLISH', 'Establish', '{"order":2,"strategy":"Build the relationship: influential but not yet deciding.","actions":"Regular meetings; introduce SMEs; understand their agenda; ask for introductions to decision makers."}'),
    ('crm_stakeholder_quadrants', 'MAINTAIN', 'Maintain', '{"order":3,"strategy":"Keep satisfied: they decide, so protect delivery and trust.","actions":"QBRs; proactive performance reporting; quick issue resolution."}'),
    ('crm_stakeholder_quadrants', 'GROW', 'Grow', '{"order":4,"strategy":"Partner closely and grow the account together.","actions":"Joint account plan; senior sponsor contact; share innovation first; propose new services."}'),
    ('crm_stakeholder_matrix', 'H-H', 'High influence, high decision', '{"influence":"high","decision":"high","quadrant":"GROW","confirmed":false}'),
    ('crm_stakeholder_matrix', 'H-M', 'High influence, medium decision', '{"influence":"high","decision":"medium","quadrant":"GROW","confirmed":false}'),
    ('crm_stakeholder_matrix', 'H-L', 'High influence, low decision', '{"influence":"high","decision":"low","quadrant":"ESTABLISH","confirmed":false}'),
    ('crm_stakeholder_matrix', 'M-H', 'Medium influence, high decision', '{"influence":"medium","decision":"high","quadrant":"MAINTAIN","confirmed":false}'),
    ('crm_stakeholder_matrix', 'M-M', 'Medium influence, medium decision', '{"influence":"medium","decision":"medium","quadrant":"MAINTAIN","confirmed":false}'),
    ('crm_stakeholder_matrix', 'M-L', 'Medium influence, low decision', '{"influence":"medium","decision":"low","quadrant":"INFORM","confirmed":false}'),
    ('crm_stakeholder_matrix', 'L-H', 'Low influence, high decision', '{"influence":"low","decision":"high","quadrant":"MAINTAIN","confirmed":false}'),
    ('crm_stakeholder_matrix', 'L-M', 'Low influence, medium decision', '{"influence":"low","decision":"medium","quadrant":"INFORM","confirmed":false}'),
    ('crm_stakeholder_matrix', 'L-L', 'Low influence, low decision', '{"influence":"low","decision":"low","quadrant":"INFORM","confirmed":false}'),
    ('crm_owner_roles', 'CP', 'Client partner', '{"order":1}'),
    ('crm_owner_roles', 'BD', 'Business development', '{"order":2}'),
    ('crm_owner_roles', 'AM', 'Account manager', '{"order":3}'),
    ('crm_owner_roles', 'MAM', 'Market account manager', '{"order":4}'),
    ('crm_owner_roles', 'RAD', 'Regional account director', '{"order":5}'),
    ('crm_owner_roles', 'TL', 'Team lead', '{"order":6}'),
    ('crm_owner_roles', 'PM', 'Project manager', '{"order":7}'),
    ('crm_next_steps', 'MEETING', 'Meeting to book', '{"order":1}'),
    ('crm_next_steps', 'BRIEF', 'Waiting for brief', '{"order":2}'),
    ('crm_next_steps', 'PROPOSAL', 'Proposal to send', '{"order":3}'),
    ('crm_next_steps', 'FOLLOW_UP', 'Follow up proposal', '{"order":4}'),
    ('crm_next_steps', 'AWAITING_CLIENT', 'Waiting for client decision', '{"order":5}'),
    ('crm_next_steps', 'ON_HOLD', 'On hold', '{"order":6}'),
    ('crm_settings', 'PERF_STALE_DAYS', 'Opportunity needs updating after (days)', '{"value":14}'),
    ('crm_settings', 'STAKEHOLDER_REVIEW_DAYS', 'Stakeholder review due after (days)', '{"value":90}'),
    ('crm_email_templates', 'SURVEY-INVITE', 'Customer satisfaction survey invitation',
     '{"subject":"How are we doing, {{first_name}}?","body":"Dear {{first_name}},\n\nWe would value ten minutes of your time to tell us how adm Indicia is doing for {{client_name}}. Your answers go straight to the team and shape our plan for the year.\n\nTake the survey: {{link}}\n\nThank you,\n{{owner_name}}\nadm Indicia\n\nNo longer want these emails? {{unsubscribe}}"}'),
    ('crm_email_templates', 'NEWSLETTER', 'Client update',
     '{"subject":"News from adm Indicia","body":"Dear {{first_name}},\n\nHere is our latest update.\n\n{{link}}\n\nBest regards,\n{{owner_name}}\nadm Indicia\n\nNo longer want these emails? {{unsubscribe}}"}'),
    ('crm_email_templates', 'INTERNAL', 'Internal communication',
     '{"subject":"Update from the Client Services team","body":"Hello {{first_name}},\n\n{{link}}\n\nThanks,\n{{owner_name}}"}'),
    ('crm_survey_templates', 'CSS-STANDARD', 'Customer satisfaction survey (standard)', $json${
      "scale": "1 = poor, 5 = excellent",
      "comment_at_or_below": 3,
      "sections": [
        {"key": "strategy", "label": "Strategy", "questions": [
          {"code": "Q01", "text": "We understand your business objectives and shopper marketing strategy."},
          {"code": "Q02", "text": "Our recommendations support your brand and category plans."}]},
        {"key": "solutions", "label": "Solutions", "questions": [
          {"code": "Q03", "text": "Our solutions meet your briefs in quality and fitness for purpose."},
          {"code": "Q04", "text": "We offer value for money."}]},
        {"key": "knowledge", "label": "Knowledge and expertise", "questions": [
          {"code": "Q05", "text": "Our team has the expertise your projects need."},
          {"code": "Q06", "text": "We share market and retail knowledge that helps you."}]},
        {"key": "processes", "label": "Processes and time to market", "questions": [
          {"code": "Q07", "text": "We deliver on time."},
          {"code": "Q08", "text": "Our processes are easy to work with."}]},
        {"key": "relationships", "label": "Relationships", "questions": [
          {"code": "Q09", "text": "We are easy to do business with."},
          {"code": "Q10", "text": "We act as a partner rather than a supplier."}]},
        {"key": "communication", "label": "Communication", "questions": [
          {"code": "Q11", "text": "We keep you informed about progress and issues."},
          {"code": "Q12", "text": "We respond quickly to your requests."}]},
        {"key": "people", "label": "People", "questions": [
          {"code": "Q13", "text": "Our people are professional and proactive."},
          {"code": "Q14", "text": "You have the right level of contact with our team."}]},
        {"key": "structure", "label": "Organisational structures", "questions": [
          {"code": "Q15", "text": "Our team structure works well across your markets."}]},
        {"key": "technology", "label": "Technology and systems", "questions": [
          {"code": "Q16", "text": "Our systems and reporting give you the visibility you need."},
          {"code": "Q17", "text": "Our technology makes working with us easier."}]},
        {"key": "creativity", "label": "Creativity and innovation", "questions": [
          {"code": "Q18", "text": "We bring you new ideas and innovation."}]},
        {"key": "sustainability", "label": "Sustainability", "questions": [
          {"code": "Q19", "text": "We help you meet your sustainability goals."}]}
      ],
      "tools": ["Client Portal", "Spend and savings reporting", "Shopper IQ effectiveness", "Sustainability reporting (CO2e)", "Order tracking and proof of delivery"]
    }$json$)
  ) x(k, code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = x.k and r.code = x.code);

-- A number from crm_settings (effective today), or the default.
create or replace function public.crm_setting(p_code text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(e.data->>'value', '')::numeric from public.library_effective('crm_settings', p_code, current_date) e where e.id is not null), p_default);
$$;

-- Quadrant code (INFORM / ESTABLISH / MAINTAIN / GROW) for influence x decision, from the governed grid.
create or replace function public.crm_stakeholder_quadrant(p_influence text, p_decision text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_influence is null or p_decision is null then null else
    (select e.data->>'quadrant' from public.library_effective('crm_stakeholder_matrix', upper(left(p_influence, 1)) || '-' || upper(left(p_decision, 1)), current_date) e
      where e.id is not null) end;
$$;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.sourcing_clients
  add column if not exists domain text,
  add column if not exists hubspot_id text;
create unique index if not exists sourcing_clients_hubspot_uidx on public.sourcing_clients (hubspot_id) where hubspot_id is not null;

alter table public.crm_contacts
  add column if not exists owner uuid references public.profiles(id) on delete set null,
  add column if not exists owner_role_id uuid references public.library_records(id),
  add column if not exists department text check (department is null or department in ('marketing','procurement','other')),
  add column if not exists relationship_rag text check (relationship_rag is null or relationship_rag in ('green','amber','red')),
  add column if not exists last_contacted_on date,
  add column if not exists contact_frequency text check (contact_frequency is null or contact_frequency in ('weekly','fortnightly','monthly','quarterly','half_yearly','yearly')),
  add column if not exists influence_level text check (influence_level is null or influence_level in ('high','medium','low')),
  add column if not exists decision_level text check (decision_level is null or decision_level in ('high','medium','low')),
  add column if not exists services_offered uuid[] not null default '{}',
  add column if not exists services_declined uuid[] not null default '{}',
  add column if not exists induction_required boolean not null default false,
  add column if not exists receive_survey boolean not null default false,
  add column if not exists legal_basis text not null default 'legitimate_interest_existing'
    check (legal_basis in ('legitimate_interest_existing','legitimate_interest_prospect','consent','contract','none')),
  add column if not exists email_opt_out boolean not null default false,
  add column if not exists opted_out_at timestamptz,
  add column if not exists left_at timestamptz,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists hubspot_id text;
create unique index if not exists crm_contacts_hubspot_uidx on public.crm_contacts (hubspot_id) where hubspot_id is not null;
create index if not exists crm_contacts_email_idx on public.crm_contacts (lower(email));
create index if not exists crm_contacts_owner_idx on public.crm_contacts (owner);
create trigger crm_contacts_role_check before insert or update of owner_role_id on public.crm_contacts
  for each row execute function public.trg_sourcing_library_ref('owner_role_id', 'crm_owner_roles', 'CRM contact');
create trigger crm_contacts_role_sync after insert or update of owner_role_id or delete on public.crm_contacts
  for each row execute function public.trg_sourcing_library_ref('owner_role_id', 'crm_owner_roles', 'CRM contact');

alter table public.crm_opportunities
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null,
  add column if not exists service_id uuid references public.library_records(id),
  add column if not exists next_step_id uuid references public.library_records(id),
  add column if not exists next_steps text,
  add column if not exists cs_lead uuid references public.profiles(id) on delete set null,
  add column if not exists sme uuid references public.profiles(id) on delete set null,
  add column if not exists hubspot_id text;
create unique index if not exists crm_opportunities_hubspot_uidx on public.crm_opportunities (hubspot_id) where hubspot_id is not null;
create trigger crm_opportunities_service_check before insert or update of service_id on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('service_id', 'crm_services', 'CRM opportunity');
create trigger crm_opportunities_service_sync after insert or update of service_id or delete on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('service_id', 'crm_services', 'CRM opportunity');
create trigger crm_opportunities_next_check before insert or update of next_step_id on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('next_step_id', 'crm_next_steps', 'CRM opportunity');
create trigger crm_opportunities_next_sync after insert or update of next_step_id or delete on public.crm_opportunities
  for each row execute function public.trg_sourcing_library_ref('next_step_id', 'crm_next_steps', 'CRM opportunity');

-- Services on contacts are arrays of library ids: check them and keep library_refs (usage guard) in step.
create or replace function public.trg_crm_contact_services() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid; v_all uuid[];
begin
  if tg_when = 'BEFORE' then
    foreach v in array (coalesce(new.services_offered, '{}') || coalesce(new.services_declined, '{}')) loop
      if not exists (select 1 from public.library_records where id = v and library_key = 'crm_services' and status = 'active') then
        raise exception 'Choose services from the Watchtower services library';
      end if;
    end loop;
    if new.services_offered && new.services_declined then raise exception 'A service can''t be both offered and declined'; end if;
    return new;
  end if;
  delete from public.library_refs where ref_table = 'crm_contacts_services' and ref_id = coalesce(new.id, old.id)::text;
  if tg_op <> 'DELETE' then
    v_all := array(select distinct unnest(coalesce(new.services_offered, '{}') || coalesce(new.services_declined, '{}')));
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
    select x, 'crm_contacts_services', new.id::text, 'CRM contact ' || new.id from unnest(v_all) x on conflict do nothing;
  end if;
  return null;
end $$;
create trigger crm_contacts_services_check before insert or update of services_offered, services_declined on public.crm_contacts
  for each row execute function public.trg_crm_contact_services();
create trigger crm_contacts_services_sync after insert or update of services_offered, services_declined or delete on public.crm_contacts
  for each row execute function public.trg_crm_contact_services();

-- ---------------------------------------------------------------------------
-- Why a contact can't be emailed (null = can be). Used by every send.
-- ---------------------------------------------------------------------------
create or replace function public.crm_contact_send_block(c public.crm_contacts) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.left_at is not null or not c.active then 'Has left or is inactive'
    when c.email is null then 'No email address'
    when c.email_opt_out then 'Opted out of email'
    when c.legal_basis = 'none' then 'No legal basis for processing'
    when c.legal_basis = 'consent' and not c.consent then 'Legal basis is consent but no consent is recorded'
    else null end;
$$;

-- ---------------------------------------------------------------------------
-- Stakeholder editing (cell by cell), bulk owner changes, leavers, quarterly review
-- ---------------------------------------------------------------------------
create or replace function public.crm_contact_set_field(p_id uuid, p_field text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.crm_contacts; v_text text := nullif(trim(p_value #>> '{}'), ''); v_before jsonb; v_ids uuid[];
begin
  perform public._crm_require();
  select * into c from public.crm_contacts where id = p_id for update;
  if c.id is null then raise exception 'Contact not found'; end if;
  v_before := to_jsonb(c) -> p_field;
  -- Mandatory stakeholder fields can be changed but not cleared.
  if p_field in ('owner','owner_role_id','department','relationship_rag','influence_level','decision_level','legal_basis','full_name') and v_text is null
     and jsonb_typeof(coalesce(p_value, 'null'::jsonb)) <> 'array' then
    raise exception '% is required', replace(p_field, '_', ' ');
  end if;
  case p_field
    when 'full_name' then update public.crm_contacts set full_name = v_text where id = p_id;
    when 'job_title' then update public.crm_contacts set job_title = v_text where id = p_id;
    when 'email' then
      if v_text is not null and v_text !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
      update public.crm_contacts set email = lower(v_text) where id = p_id;
    when 'phone' then update public.crm_contacts set phone = v_text where id = p_id;
    when 'market' then
      if v_text is not null and not exists (select 1 from public.markets where code = public._market_code(v_text)) then raise exception 'Choose a market from the market master'; end if;
      update public.crm_contacts set market = public._market_code(v_text) where id = p_id;
    when 'decision_role' then update public.crm_contacts set decision_role = v_text where id = p_id;
    when 'owner' then
      if not exists (select 1 from public.profiles where id = v_text::uuid and (is_admin or user_type = 'internal')) then raise exception 'The owner must be someone at adm Indicia'; end if;
      update public.crm_contacts set owner = v_text::uuid where id = p_id;
    when 'owner_role_id' then update public.crm_contacts set owner_role_id = v_text::uuid where id = p_id;
    when 'department' then update public.crm_contacts set department = v_text where id = p_id;
    when 'relationship_rag' then update public.crm_contacts set relationship_rag = v_text where id = p_id;
    when 'last_contacted_on' then
      if v_text::date > current_date then raise exception 'Last contacted can''t be in the future'; end if;
      update public.crm_contacts set last_contacted_on = v_text::date where id = p_id;
    when 'contact_frequency' then update public.crm_contacts set contact_frequency = v_text where id = p_id;
    when 'influence_level' then update public.crm_contacts set influence_level = v_text where id = p_id;
    when 'decision_level' then update public.crm_contacts set decision_level = v_text where id = p_id;
    when 'services_offered', 'services_declined' then
      if jsonb_typeof(coalesce(p_value, '[]'::jsonb)) <> 'array' then raise exception 'Services are a list'; end if;
      select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb)) x;
      if p_field = 'services_offered' then update public.crm_contacts set services_offered = v_ids where id = p_id;
      else update public.crm_contacts set services_declined = v_ids where id = p_id; end if;
    when 'induction_required' then update public.crm_contacts set induction_required = coalesce(v_text::boolean, false) where id = p_id;
    when 'receive_survey' then update public.crm_contacts set receive_survey = coalesce(v_text::boolean, false) where id = p_id;
    when 'consent' then update public.crm_contacts set consent = coalesce(v_text::boolean, false),
      consent_at = case when coalesce(v_text::boolean, false) then coalesce(consent_at, now()) end where id = p_id;
    when 'legal_basis' then update public.crm_contacts set legal_basis = v_text where id = p_id;
    when 'email_opt_out' then update public.crm_contacts set email_opt_out = coalesce(v_text::boolean, false),
      opted_out_at = case when coalesce(v_text::boolean, false) then coalesce(opted_out_at, now()) end where id = p_id;
    else raise exception 'The field % can''t be edited here', p_field;
  end case;
  perform public._crm_event(c.client_id, 'contact', p_id::text, 'field_changed',
    jsonb_build_object('field', p_field, 'before', v_before, 'after', (select to_jsonb(x) -> p_field from public.crm_contacts x where x.id = p_id)));
end $$;

create or replace function public.crm_contacts_reassign(p_ids uuid[], p_owner uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; r record;
begin
  perform public._crm_require();
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Choose at least one contact'; end if;
  if not exists (select 1 from public.profiles where id = p_owner and (is_admin or user_type = 'internal')) then raise exception 'The new owner must be someone at adm Indicia'; end if;
  for r in select id, client_id, owner from public.crm_contacts where id = any (p_ids) and owner is distinct from p_owner loop
    perform public._crm_event(r.client_id, 'contact', r.id::text, 'owner_reassigned', jsonb_build_object('before', r.owner, 'after', p_owner, 'note', nullif(trim(p_note), '')));
  end loop;
  update public.crm_contacts set owner = p_owner where id = any (p_ids) and owner is distinct from p_owner;
  get diagnostics n = row_count;
  return n;
end $$;

-- A client contact who has left: kept for history, no longer contacted or surveyed.
create or replace function public.crm_contact_mark_left(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.crm_contacts;
begin
  perform public._crm_require();
  select * into c from public.crm_contacts where id = p_id for update;
  if c.id is null then raise exception 'Contact not found'; end if;
  if c.left_at is not null then raise exception '% is already marked as left', c.full_name; end if;
  update public.crm_contacts set left_at = now(), active = false, receive_survey = false where id = p_id;
  perform public._crm_event(c.client_id, 'contact', p_id::text, 'marked_left', jsonb_build_object('note', nullif(trim(p_note), '')));
end $$;

create or replace function public.crm_contacts_mark_reviewed(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._crm_require();
  update public.crm_contacts set last_reviewed_at = now() where id = any (p_ids) and left_at is null;
  get diagnostics n = row_count;
  insert into public.crm_events (client_id, entity_type, entity_id, action, actor)
  select client_id, 'contact', id::text, 'reviewed', auth.uid() from public.crm_contacts where id = any (p_ids) and left_at is null;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Performance Tracker
-- ---------------------------------------------------------------------------
-- Create (p_id null) or update an opportunity with its Performance Tracker fields. The contact is required here.
create or replace function public.crm_performance_save(p_id uuid, p_client uuid, p_contact uuid, p_service uuid, p_title text, p_stage text,
  p_next_step uuid, p_next_steps text, p_cs_lead uuid, p_sme uuid, p_budget numeric, p_currency text, p_probability int, p_expected_close date)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.crm_opportunities; v_id uuid := p_id; v_client uuid := p_client; v_account uuid;
begin
  perform public._crm_require();
  if p_id is not null then
    select * into o from public.crm_opportunities where id = p_id for update;
    if o.id is null then raise exception 'Opportunity not found'; end if;
    v_client := o.client_id;
  end if;
  if p_contact is null then raise exception 'Choose the client contact this opportunity is with'; end if;
  if not exists (select 1 from public.crm_contacts where id = p_contact and client_id = v_client) then raise exception 'The contact must belong to the same client'; end if;
  if not public._crm_internal_person(p_cs_lead) or not public._crm_internal_person(p_sme) then raise exception 'CS lead and SME must be people at adm Indicia'; end if;
  perform public._crm_lib(p_service, 'crm_services', 'service');
  perform public._crm_lib(p_next_step, 'crm_next_steps', 'next step');
  if p_id is null then
    select account_id into v_account from public.crm_contacts where id = p_contact;
    v_id := public.crm_opportunity_create(v_client, v_account, p_title, p_budget, p_currency, p_expected_close, coalesce(p_stage, 'lead'), null, null);
    update public.crm_opportunities set contact_id = p_contact, service_id = p_service, next_step_id = p_next_step, next_steps = nullif(trim(p_next_steps), ''),
      cs_lead = p_cs_lead, sme = p_sme, probability = coalesce(p_probability, probability) where id = v_id;
  else
    perform public.crm_opportunity_update(p_id, p_title, p_budget, p_currency, p_probability, p_expected_close, o.description);
    update public.crm_opportunities set contact_id = p_contact, service_id = p_service, next_step_id = p_next_step, next_steps = nullif(trim(p_next_steps), ''),
      cs_lead = p_cs_lead, sme = p_sme where id = p_id;
    perform public._crm_event(v_client, 'opportunity', p_id::text, 'performance_updated', jsonb_build_object('next_steps', nullif(trim(p_next_steps), '')));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
-- Performance Tracker view (opportunities with their tracker fields and the "needs updating" flag).
create view public.crm_performance_v with (security_invoker = true) as
  select o.id, o.opp_code, o.client_id, c.name as client_name, o.contact_id, ct.full_name as contact_name, ct.email as contact_email,
         o.title, o.stage, o.value as total_budget, o.currency, o.probability, round(o.value * o.probability / 100.0, 2) as weighted_budget,
         o.service_id, s.name as service_name, o.next_step_id, ns.name as next_step_name, o.next_steps,
         o.cs_lead, coalesce(nullif(cl.full_name, ''), cl.email) as cs_lead_name, o.sme, coalesce(nullif(sm.full_name, ''), sm.email) as sme_name,
         o.owner, coalesce(nullif(ow.full_name, ''), ow.email) as owner_name, o.market, o.expected_close, o.created_at, o.updated_at, o.hubspot_id,
         (o.stage not in ('won','lost') and o.updated_at < now() - make_interval(days => public.crm_setting('PERF_STALE_DAYS', 14)::int)) as needs_updating,
         (current_date - o.updated_at::date) as days_since_update
    from public.crm_opportunities o
    join public.sourcing_clients c on c.id = o.client_id
    left join public.crm_contacts ct on ct.id = o.contact_id
    left join public.library_records s on s.id = o.service_id
    left join public.library_records ns on ns.id = o.next_step_id
    left join public.profiles cl on cl.id = o.cs_lead
    left join public.profiles sm on sm.id = o.sme
    left join public.profiles ow on ow.id = o.owner;
revoke insert, update, delete on public.crm_performance_v from authenticated, anon;
revoke all on public.crm_performance_v from anon;

revoke execute on function public.trg_crm_contact_services() from public, anon, authenticated;
revoke execute on function public.crm_contact_send_block(public.crm_contacts) from public, anon;
grant execute on function public.crm_contact_send_block(public.crm_contacts) to authenticated;
revoke execute on function public.crm_setting(text, numeric), public.crm_stakeholder_quadrant(text, text), public.crm_contact_set_field(uuid, text, jsonb),
  public.crm_contacts_reassign(uuid[], uuid, text), public.crm_contact_mark_left(uuid, text), public.crm_contacts_mark_reviewed(uuid[]),
  public.crm_performance_save(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid, uuid, numeric, text, int, date) from public, anon;
grant execute on function public.crm_setting(text, numeric), public.crm_stakeholder_quadrant(text, text), public.crm_contact_set_field(uuid, text, jsonb),
  public.crm_contacts_reassign(uuid[], uuid, text), public.crm_contact_mark_left(uuid, text), public.crm_contacts_mark_reviewed(uuid[]),
  public.crm_performance_save(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid, uuid, numeric, text, int, date) to authenticated;
-- "Last updated" drives the Performance Tracker's needs-updating flag. Bulk system fixes (demo seeds, data repairs) can keep
-- it with crm.keep_updated_at = 'on'; every normal edit still stamps it.
create or replace function public.trg_crm_market_region() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.market is not null then new.region := coalesce(public._crm_region(new.market), new.region); end if;
  if tg_op = 'UPDATE' and to_jsonb(new) ? 'updated_at' and coalesce(current_setting('crm.keep_updated_at', true), '') <> 'on' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_at', now()));
  end if;
  return new;
end $$;
revoke execute on function public.trg_crm_market_region() from public, anon, authenticated;