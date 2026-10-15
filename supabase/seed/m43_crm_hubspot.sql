-- DUMMY DATA for CRM stage 2 (the HubSpot replacement). Every person, email, score and comment is made up.
-- Loaded after m42_crm.sql (accounts, contacts, opportunities and the _demo_crm_people claim mechanism). Safe to run on an
-- existing demo database: fixed ids, "on conflict do nothing" / "where not exists".

-- ---------------------------------------------------------------------------
-- Send approval policies (demo settings)
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'approval_policies', x.code, x.name, x.data::jsonb, 'active', '2026-01-01'::date, 'Demo policy (CRM sends)'
from (values
  ('AP-CRM-SEND-LARGE', 'CRM send to many contacts', '{"module":"crm","approval_type":"CRM_SEND","approver_role":"module_owner","min_value":25,"maker_checker":true,"sla_days":2,"description":"Survey waves and emails to more than 25 contacts wait for a CRM owner before they go.","decided_in":"crm_survey_wave_send, crm_email_send, approval_request_decide","where_in_ui":"/crm/surveys, /crm/emails"}'),
  ('AP-CRM-SEND-EXTERNAL', 'CRM email to an external list', '{"module":"crm","approval_type":"CRM_SEND_EXTERNAL","approver_role":"module_owner","maker_checker":true,"sla_days":2,"description":"Emails to client contact lists (marketing) are signed off by a CRM owner before they go. Internal staff lists send straight away.","decided_in":"crm_email_send, approval_request_decide","where_in_ui":"/crm/emails/<email>"}')
) x(code, name, data)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- More client contacts (fictional)
-- ---------------------------------------------------------------------------
insert into public.crm_contacts (id, client_id, account_id, full_name, job_title, email, phone, market, decision_role, consent, created_at)
select x.id::uuid, a.client_id, a.id, x.name, x.title, x.email, null, a.market, x.role, false, now() - interval '120 days'
  from (values
    ('43c00000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'Katrin Vogel', 'Category manager, beer', 'katrin.vogel@northbrew.example', 'user'),
    ('43c00000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', 'Felix Braun', 'Procurement manager', 'felix.braun@northbrew.example', 'buyer'),
    ('43c00000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000002', 'Sanne Bakker', 'Global brand manager', 'sanne.bakker@northbrew.example', 'sponsor'),
    ('43c00000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000002', 'Daan Visser', 'Sustainability lead', 'daan.visser@northbrew.example', 'user'),
    ('43c00000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000003', 'Grace Lewis', 'Trade marketing manager', 'grace.lewis@northbrew.example', 'approver'),
    ('43c00000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000004', 'Priya Shah', 'Head of procurement, marketing', 'priya.shah@brightlane.example', 'buyer'),
    ('43c00000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000004', 'Martin Cole', 'Brand manager, Polaris', 'martin.cole@brightlane.example', 'user'),
    ('43c00000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000004', 'Hannah Price', 'Shopper insight manager', 'hannah.price@brightlane.example', 'user'),
    ('43c00000-0000-4000-8000-000000000009', '42a00000-0000-4000-8000-000000000005', 'Minh Nguyen', 'Trade marketing lead', 'minh.nguyen@brightlane.example', 'approver'),
    ('43c00000-0000-4000-8000-000000000010', '42a00000-0000-4000-8000-000000000006', 'Camille Laurent', 'Customer marketing manager', 'camille.laurent@brightlane.example', 'user'),
    ('43c00000-0000-4000-8000-000000000011', '42a00000-0000-4000-8000-000000000007', 'Jordan Miller', 'Field marketing director', 'jordan.miller@carewell.example', 'sponsor'),
    ('43c00000-0000-4000-8000-000000000012', '42a00000-0000-4000-8000-000000000007', 'Ava Thompson', 'Purchasing specialist', 'ava.thompson@carewell.example', 'buyer'),
    ('43c00000-0000-4000-8000-000000000013', '42a00000-0000-4000-8000-000000000008', 'Sofie Jensen', 'Brand manager, Nordics', 'sofie.jensen@carewell.example', 'user'),
    ('43c00000-0000-4000-8000-000000000014', '42a00000-0000-4000-8000-000000000009', 'Daniel Lim', 'Store development manager', 'daniel.lim@bauclient.example', 'approver'),
    ('43c00000-0000-4000-8000-000000000015', '42a00000-0000-4000-8000-000000000001', 'Lukas Schmidt', 'Former activation manager', 'lukas.schmidt@northbrew.example', 'user')
  ) x(id, account, name, title, email, role)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Stakeholder mapping on every demo contact (seed writes go straight to the table)
-- ---------------------------------------------------------------------------
update public.crm_contacts ct set
    owner_role_id = (select id from public.library_records where library_key = 'crm_owner_roles' and code = x.role_code and status = 'active'),
    department = x.dept, relationship_rag = x.rag, last_contacted_on = current_date - x.last_days, contact_frequency = x.freq,
    influence_level = x.inf, decision_level = x.dec, induction_required = x.induct, receive_survey = x.survey, legal_basis = x.basis,
    email_opt_out = x.optout, opted_out_at = case when x.optout then now() - interval '40 days' end,
    services_offered = array(select id from public.library_records where library_key = 'crm_services' and status = 'active' and code = any (string_to_array(x.offered, ','))),
    services_declined = array(select id from public.library_records where library_key = 'crm_services' and status = 'active' and code = any (string_to_array(x.declined, ','))),
    last_reviewed_at = case when x.reviewed then now() - interval '20 days' end,
    left_at = case when x.gone then now() - interval '30 days' end, active = not x.gone
  from (values
    ('42c00000-0000-4000-8000-000000000001', 'AM', 'marketing', 'green', 2, 'weekly', 'high', 'medium', false, true, 'legitimate_interest_existing', false, 'POSM,PERM', '', true, false),
    ('42c00000-0000-4000-8000-000000000002', 'CP', 'marketing', 'green', 18, 'monthly', 'high', 'high', false, true, 'legitimate_interest_existing', false, 'POSM,PERM,SUSTAIN', '', true, false),
    ('42c00000-0000-4000-8000-000000000003', 'RAD', 'procurement', 'amber', 6, 'monthly', 'medium', 'high', false, true, 'legitimate_interest_existing', false, 'LOGISTICS', 'CREATIVE', true, false),
    ('42c00000-0000-4000-8000-000000000004', 'CP', 'marketing', 'green', 12, 'monthly', 'high', 'high', false, true, 'legitimate_interest_existing', false, 'POSM,SUSTAIN,SHOPPER', '', true, false),
    ('42c00000-0000-4000-8000-000000000005', 'AM', 'marketing', 'green', 27, 'fortnightly', 'medium', 'medium', false, true, 'legitimate_interest_existing', false, 'POSM,INSTALL', '', false, false),
    ('42c00000-0000-4000-8000-000000000006', 'MAM', 'marketing', 'amber', 35, 'monthly', 'low', 'low', true, false, 'legitimate_interest_existing', false, 'PREMIUMS', '', false, false),
    ('42c00000-0000-4000-8000-000000000007', 'AM', 'marketing', 'red', 15, 'fortnightly', 'medium', 'high', false, true, 'legitimate_interest_existing', false, 'PERM,INSTALL', 'TECH', true, false),
    ('42c00000-0000-4000-8000-000000000008', 'BD', 'procurement', 'amber', 40, 'quarterly', 'low', 'medium', true, true, 'legitimate_interest_prospect', false, '', '', false, false),
    ('42c00000-0000-4000-8000-000000000009', 'PM', 'other', 'green', 75, 'quarterly', 'low', 'low', false, false, 'legitimate_interest_existing', false, 'POSM', '', false, false),
    ('42c00000-0000-4000-8000-000000000010', 'MAM', 'marketing', 'amber', 4, 'monthly', 'medium', 'low', false, true, 'legitimate_interest_existing', false, '', '', true, false),
    ('43c00000-0000-4000-8000-000000000001', 'AM', 'marketing', 'green', 10, 'monthly', 'medium', 'medium', false, true, 'legitimate_interest_existing', false, 'POSM', '', true, false),
    ('43c00000-0000-4000-8000-000000000002', 'RAD', 'procurement', 'amber', 22, 'quarterly', 'low', 'high', false, true, 'legitimate_interest_existing', false, '', 'SHOPPER', false, false),
    ('43c00000-0000-4000-8000-000000000003', 'CP', 'marketing', 'green', 8, 'monthly', 'high', 'high', false, true, 'legitimate_interest_existing', false, 'PERM,CREATIVE', '', true, false),
    ('43c00000-0000-4000-8000-000000000004', 'BD', 'other', 'green', 30, 'quarterly', 'high', 'low', true, true, 'consent', false, 'SUSTAIN', '', false, false),
    ('43c00000-0000-4000-8000-000000000005', 'AM', 'marketing', 'amber', 14, 'fortnightly', 'medium', 'medium', false, true, 'legitimate_interest_existing', false, 'POSM,INSTALL', '', true, false),
    ('43c00000-0000-4000-8000-000000000006', 'CP', 'procurement', 'red', 50, 'monthly', 'high', 'high', false, true, 'legitimate_interest_existing', false, '', 'LOGISTICS', false, false),
    ('43c00000-0000-4000-8000-000000000007', 'AM', 'marketing', 'green', 5, 'fortnightly', 'medium', 'low', false, true, 'legitimate_interest_existing', true, 'PREMIUMS', '', true, false),
    ('43c00000-0000-4000-8000-000000000008', 'BD', 'marketing', 'amber', 60, 'quarterly', 'low', 'low', false, false, 'none', false, '', '', false, false),
    ('43c00000-0000-4000-8000-000000000009', 'MAM', 'marketing', 'green', 9, 'monthly', 'medium', 'high', false, true, 'legitimate_interest_existing', false, 'PREMIUMS,LOGISTICS', '', true, false),
    ('43c00000-0000-4000-8000-000000000010', 'BD', 'marketing', 'amber', 45, 'quarterly', 'low', 'medium', true, false, 'legitimate_interest_prospect', false, '', '', false, false),
    ('43c00000-0000-4000-8000-000000000011', 'RAD', 'marketing', 'amber', 16, 'monthly', 'high', 'high', false, true, 'legitimate_interest_existing', false, 'PERM,INSTALL', '', true, false),
    ('43c00000-0000-4000-8000-000000000012', 'PM', 'procurement', 'green', 25, 'monthly', 'low', 'medium', false, true, 'contract', false, 'INSTALL', '', false, false),
    ('43c00000-0000-4000-8000-000000000013', 'AM', 'marketing', 'green', 38, 'quarterly', 'medium', 'medium', false, true, 'legitimate_interest_existing', false, '', '', false, false),
    ('43c00000-0000-4000-8000-000000000014', 'PM', 'other', 'green', 80, 'half_yearly', 'low', 'low', false, false, 'legitimate_interest_existing', false, 'POSM', '', false, false),
    ('43c00000-0000-4000-8000-000000000015', 'AM', 'marketing', 'red', 120, 'monthly', 'medium', 'low', false, false, 'legitimate_interest_existing', false, '', '', false, true)
  ) x(id, role_code, dept, rag, last_days, freq, inf, dec, induct, survey, basis, optout, offered, declined, reviewed, gone)
 where ct.id = x.id::uuid and ct.owner_role_id is null;

-- Contact owners (claimed by email when the demo users exist).
insert into public._demo_crm_people (tbl, row_id, col, email)
select 'crm_contacts', ct.id, 'owner', coalesce(p.email, 'lena.lead@adm-indicia.com') from public.crm_contacts ct
  left join public._demo_crm_people p on p.tbl = 'crm_accounts' and p.row_id = ct.account_id and p.col = 'account_lead'
 where ct.id::text like '42c00000-%' or ct.id::text like '43c00000-%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Performance Tracker fields on the demo opportunities (some left untouched for weeks to show "needs updating")
-- ---------------------------------------------------------------------------
select set_config('crm.keep_updated_at', 'on', false);
update public.crm_opportunities o set
    contact_id = x.contact::uuid,
    service_id = (select id from public.library_records where library_key = 'crm_services' and code = x.svc and status = 'active'),
    next_step_id = (select id from public.library_records where library_key = 'crm_next_steps' and code = x.step and status = 'active'),
    next_steps = x.note, updated_at = now() - make_interval(days => x.stale)
  from (values
    ('42d00000-0000-4000-8000-000000000001', '42c00000-0000-4000-8000-000000000002', 'POSM', null, 'Delivered; case study in progress.', 60),
    ('42d00000-0000-4000-8000-000000000002', '42c00000-0000-4000-8000-000000000001', 'POSM', 'AWAITING_CLIENT', 'Client deciding between two concepts by Friday.', 3),
    ('42d00000-0000-4000-8000-000000000003', '42c00000-0000-4000-8000-000000000003', 'PERM', 'FOLLOW_UP', 'Answer the index-linked pricing questions.', 6),
    ('42d00000-0000-4000-8000-000000000004', '42c00000-0000-4000-8000-000000000010', 'POSM', 'PROPOSAL', 'Send two stand options with lead times.', 21),
    ('42d00000-0000-4000-8000-000000000005', '42c00000-0000-4000-8000-000000000004', 'PERM', 'MEETING', 'Book a store walk with the sustainability team.', 12),
    ('42d00000-0000-4000-8000-000000000006', '43c00000-0000-4000-8000-000000000007', 'POSM', 'BRIEF', 'Waiting for the 2027 tender brief.', 30),
    ('42d00000-0000-4000-8000-000000000007', '42c00000-0000-4000-8000-000000000006', 'PREMIUMS', null, 'Won; delivery booked for December.', 35),
    ('42d00000-0000-4000-8000-000000000009', '42c00000-0000-4000-8000-000000000007', 'INSTALL', 'AWAITING_CLIENT', 'Site list confirmed; waiting for PO.', 15),
    ('42d00000-0000-4000-8000-000000000010', '42c00000-0000-4000-8000-000000000008', 'PERM', 'ON_HOLD', 'Budget moved to Q1.', 40),
    ('42d00000-0000-4000-8000-000000000011', '43c00000-0000-4000-8000-000000000014', 'INSTALL', 'MEETING', 'Opening calendar call.', 2)
  ) x(id, contact, svc, step, note, stale)
 where o.id = x.id::uuid and o.contact_id is null;
select set_config('crm.keep_updated_at', 'off', false);

insert into public._demo_crm_people (tbl, row_id, col, email)
select 'crm_opportunities', x.id::uuid, x.col, x.email from (values
  ('42d00000-0000-4000-8000-000000000002', 'cs_lead', 'lena.lead@adm-indicia.com'), ('42d00000-0000-4000-8000-000000000002', 'sme', 'arjun.agent@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000003', 'cs_lead', 'hana.head@adm-indicia.com'), ('42d00000-0000-4000-8000-000000000003', 'sme', 'pedro.procurement@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000004', 'cs_lead', 'pedro.procurement@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000005', 'cs_lead', 'lena.lead@adm-indicia.com'), ('42d00000-0000-4000-8000-000000000005', 'sme', 'hana.head@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000006', 'cs_lead', 'lena.lead@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000009', 'cs_lead', 'hana.head@adm-indicia.com'), ('42d00000-0000-4000-8000-000000000009', 'sme', 'arjun.agent@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000010', 'cs_lead', 'arjun.agent@adm-indicia.com'),
  ('42d00000-0000-4000-8000-000000000011', 'cs_lead', 'pedro.procurement@adm-indicia.com')
) x(id, col, email)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A survey wave with responses (one with scores of 3 or lower and comments)
-- ---------------------------------------------------------------------------
insert into public.crm_survey_waves (id, name, template_id, period_label, status, closes_on, recipient_count, excluded_count, created_at, sent_at)
select '43a00000-0000-4000-8000-000000000001', 'Half-year survey October 2026', t.id, 'H1 2026/27', 'sent', current_date + 14, 6, 1, now() - interval '12 days', now() - interval '10 days'
  from public.library_records t where t.library_key = 'crm_survey_templates' and t.code = 'CSS-STANDARD' and t.status = 'active'
on conflict do nothing;

insert into public.crm_survey_recipients (id, wave_id, contact_id, client_id, status, excluded_reason, sent_at, opened_at, responded_at)
select x.id::uuid, '43a00000-0000-4000-8000-000000000001', ct.id, ct.client_id, x.status, x.reason,
       case when x.status <> 'excluded' then now() - interval '10 days' end,
       case when x.status in ('opened','responded') then now() - interval '9 days' end,
       case when x.status = 'responded' then now() - make_interval(days => x.d) end
  from (values
    ('43b00000-0000-4000-8000-000000000001', '42c00000-0000-4000-8000-000000000002', 'responded', null, 8),
    ('43b00000-0000-4000-8000-000000000002', '42c00000-0000-4000-8000-000000000004', 'responded', null, 7),
    ('43b00000-0000-4000-8000-000000000003', '42c00000-0000-4000-8000-000000000007', 'responded', null, 5),
    ('43b00000-0000-4000-8000-000000000004', '43c00000-0000-4000-8000-000000000003', 'responded', null, 4),
    ('43b00000-0000-4000-8000-000000000005', '42c00000-0000-4000-8000-000000000001', 'opened', null, 0),
    ('43b00000-0000-4000-8000-000000000006', '43c00000-0000-4000-8000-000000000011', 'sent', null, 0),
    ('43b00000-0000-4000-8000-000000000007', '43c00000-0000-4000-8000-000000000007', 'excluded', 'Opted out of email', 0)
  ) x(id, contact, status, reason, d)
  join public.crm_contacts ct on ct.id = x.contact::uuid
on conflict do nothing;

with t as (select data from public.library_records where library_key = 'crm_survey_templates' and code = 'CSS-STANDARD' and status = 'active'),
q as (select s->>'key' as sec, qq->>'code' as code from t, jsonb_array_elements(t.data->'sections') s, jsonb_array_elements(s->'questions') qq),
resp(id, rec, base, low, nps, start_t, cont_t, stop_t, testimonial) as (values
  ('43d00000-0000-4000-8000-000000000001', '43b00000-0000-4000-8000-000000000001', 5, null, 9, 'Bring us more in-store innovation from other markets.', 'The football programme team was outstanding.', null, true),
  ('43d00000-0000-4000-8000-000000000002', '43b00000-0000-4000-8000-000000000002', 4, null, 8, 'Quarterly sustainability numbers per campaign.', 'Proactive account management.', null, false),
  ('43d00000-0000-4000-8000-000000000003', '43b00000-0000-4000-8000-000000000003', 3, 'processes', 5, 'Sharing install photos the same day.', 'Quality of the fixtures.', 'Late changes to delivery dates without warning.', false),
  ('43d00000-0000-4000-8000-000000000004', '43b00000-0000-4000-8000-000000000004', 4, null, 10, null, 'Creative thinking on the bar fixtures.', null, true)),
scored as (
  select r.id, q.sec, q.code,
         case when r.low is not null and q.sec = r.low then 2 when r.base = 3 and q.code in ('Q01','Q09','Q13') then 4 else r.base end as score
    from resp r cross join q)
insert into public.crm_survey_responses (id, recipient_id, wave_id, client_id, contact_id, market, nps, scores, comments, section_scores, overall,
  start_doing, continue_doing, stop_doing, services_aware, services_interested, valuable_tools, testimonial_opt_in, created_at)
select r.id::uuid, sr.id, sr.wave_id, sr.client_id, sr.contact_id, coalesce(a.market, ct.market), r.nps,
       (select jsonb_object_agg(s.code, s.score) from scored s where s.id = r.id),
       case when r.low = 'processes' then '{"Q07":"Two deliveries in Texas arrived after the install date.","Q08":"Too many handovers between teams; one contact would help."}'::jsonb
            when r.base = 3 then '{"Q03":"Some fixtures needed rework on site.","Q04":"Pricing on wave 2 felt high."}'::jsonb else '{}'::jsonb end
         || case when r.base = 3 then '{"Q05":"Expertise varies between markets.","Q06":"We would like more retail insight.","Q10":"Feels transactional at times.","Q11":"Updates are not always proactive.","Q12":"Replies can take days.","Q14":"Not enough senior contact.","Q15":"Market teams do not always talk to each other.","Q16":"Reporting is hard to find.","Q17":"Portal access was slow to set up.","Q18":"Few new ideas this year.","Q19":"Sustainability data came late.","Q02":"Recommendations not always tied to our plans."}'::jsonb else '{}'::jsonb end,
       (select jsonb_object_agg(sec, avg) from (select s.sec, round(avg(s.score), 2) avg from scored s where s.id = r.id group by s.sec) z),
       (select round(avg(s.score), 2) from scored s where s.id = r.id),
       r.start_t, r.cont_t, r.stop_t,
       array(select id from public.library_records where library_key = 'crm_services' and code in ('POSM','PERM','INSTALL')),
       array(select id from public.library_records where library_key = 'crm_services' and code in ('SUSTAIN','SHOPPER')),
       array['Client Portal','Sustainability reporting (CO2e)'], r.testimonial, sr.responded_at
  from resp r join public.crm_survey_recipients sr on sr.id = r.rec::uuid join public.crm_contacts ct on ct.id = sr.contact_id
  left join public.crm_accounts a on a.id = ct.account_id
on conflict do nothing;

insert into public.crm_feedback (client_id, account_id, contact_id, market, score, source, created_at)
select r.client_id, ct.account_id, r.contact_id, r.market, r.nps, 'survey', r.created_at
  from public.crm_survey_responses r join public.crm_contacts ct on ct.id = r.contact_id
 where r.id::text like '43d00000-%' and not exists (select 1 from public.crm_feedback f where f.contact_id = r.contact_id and f.source = 'survey' and f.created_at = r.created_at);

insert into public._demo_crm_people (tbl, row_id, col, email)
select 'crm_survey_recipients', sr.id, 'owner', p.email from public.crm_survey_recipients sr
  join public._demo_crm_people p on p.tbl = 'crm_contacts' and p.row_id = sr.contact_id and p.col = 'owner'
 where sr.id::text like '43b00000-%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- An event registration form with submissions (fictional people)
-- ---------------------------------------------------------------------------
insert into public.crm_forms (id, name, description, fields, consent_text, client_id, active, created_at)
values ('43e00000-0000-4000-8000-000000000001', 'Innovation workshop registration (demo)',
  'Register for the in-store innovation workshop. Choose a session; we will send the joining details.',
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"email","label":"Work email","type":"email","required":true},
    {"key":"company","label":"Company","type":"text","required":true},{"key":"job_title","label":"Job title","type":"text"},
    {"key":"session","label":"Session","type":"select","options":["Morning (10:00)","Afternoon (14:00)"],"required":true},
    {"key":"dietary","label":"Dietary needs","type":"textarea"}]'::jsonb,
  'I agree that adm Indicia may email me about future workshops and events.', null, true, now() - interval '25 days')
on conflict do nothing;

insert into public.crm_form_submissions (id, form_id, data, email, full_name, contact_id, contact_created, consent, consent_text, created_at)
select x.id::uuid, '43e00000-0000-4000-8000-000000000001', x.data::jsonb, x.email, x.name,
       (select id from public.crm_contacts where lower(email) = x.email limit 1), false, x.consent,
       case when x.consent then 'I agree that adm Indicia may email me about future workshops and events.' end, now() - make_interval(days => x.d)
  from (values
    ('43f00000-0000-4000-8000-000000000001', 'elena.rossi@foodco.example', 'Elena Rossi', '{"full_name":"Elena Rossi","email":"elena.rossi@foodco.example","company":"FoodCo (demo)","job_title":"Shopper marketing lead","session":"Morning (10:00)"}', true, 20),
    ('43f00000-0000-4000-8000-000000000002', 'marc.dubois@foodco.example', 'Marc Dubois', '{"full_name":"Marc Dubois","email":"marc.dubois@foodco.example","company":"FoodCo (demo)","session":"Afternoon (14:00)","dietary":"Vegetarian"}', false, 18),
    ('43f00000-0000-4000-8000-000000000003', 'katrin.vogel@northbrew.example', 'Katrin Vogel', '{"full_name":"Katrin Vogel","email":"katrin.vogel@northbrew.example","company":"Northbrew","session":"Morning (10:00)"}', true, 15),
    ('43f00000-0000-4000-8000-000000000004', 'tom.ito@foodco.example', 'Tom Ito', '{"full_name":"Tom Ito","email":"tom.ito@foodco.example","company":"FoodCo (demo)","job_title":"Category manager","session":"Afternoon (14:00)"}', true, 9)
  ) x(id, email, name, data, consent, d)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A list and a sent campaign with simulated tracking events
-- ---------------------------------------------------------------------------
insert into public.crm_lists (id, name, description, kind, audience, filters, created_at)
values ('43f10000-0000-4000-8000-000000000001', 'Sustainability report 2026 (signed off)', 'Marketing and sustainability contacts signed off for the annual report.', 'static', 'external', '{}', now() - interval '20 days'),
       ('43f10000-0000-4000-8000-000000000002', 'Northbrew stakeholders to grow', 'Dynamic: Northbrew contacts in the Grow quadrant.', 'dynamic', 'external',
        '{"client_id":"c5000000-0000-4000-8000-000000000002","quadrant":"GROW"}', now() - interval '5 days')
on conflict do nothing;

insert into public.crm_list_members (list_id, contact_id, added_at)
select '43f10000-0000-4000-8000-000000000001', x::uuid, now() - interval '20 days' from unnest(array[
  '42c00000-0000-4000-8000-000000000002','42c00000-0000-4000-8000-000000000004','42c00000-0000-4000-8000-000000000005','43c00000-0000-4000-8000-000000000003',
  '43c00000-0000-4000-8000-000000000004','43c00000-0000-4000-8000-000000000007','43c00000-0000-4000-8000-000000000008','43c00000-0000-4000-8000-000000000011']) x
 where exists (select 1 from public.crm_contacts where id = x::uuid)
on conflict do nothing;

insert into public.crm_emails (id, name, list_id, template_id, subject, body, link, status, recipient_count, excluded_count, created_at, sent_at)
select '43f20000-0000-4000-8000-000000000001', 'Sustainability report 2026', '43f10000-0000-4000-8000-000000000001', t.id,
       'Our 2026 sustainability report', E'Dear {{first_name}},\n\nOur 2026 sustainability report is out: what we cut, what we measured and what comes next.\n\n{{link}}\n\nBest regards,\n{{owner_name}}\nadm Indicia\n\nNo longer want these emails? {{unsubscribe}}',
       'https://example.com/adm-indicia-sustainability-2026', 'sent', 6, 2, now() - interval '15 days', now() - interval '14 days'
  from public.library_records t where t.library_key = 'crm_email_templates' and t.code = 'NEWSLETTER' and t.status = 'active'
on conflict do nothing;

insert into public.crm_email_recipients (id, email_id, contact_id, email, full_name, status, excluded_reason, sent_at)
select md5('43f3' || ct.id::text)::uuid, '43f20000-0000-4000-8000-000000000001', ct.id, ct.email, ct.full_name,
       case when public.crm_contact_send_block(ct) is null then 'sent' else 'excluded' end, public.crm_contact_send_block(ct),
       case when public.crm_contact_send_block(ct) is null then now() - interval '14 days' end
  from public.crm_list_members m join public.crm_contacts ct on ct.id = m.contact_id
 where m.list_id = '43f10000-0000-4000-8000-000000000001' and exists (select 1 from public.crm_emails where id = '43f20000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into public.email_events (email_id, recipient_id, event, url, simulated, at)
select r.email_id, r.id, x.ev, case when x.ev = 'click' then 'https://example.com/adm-indicia-sustainability-2026' end, true, r.sent_at + make_interval(mins => x.m)
  from public.crm_email_recipients r
  cross join lateral (values ('delivered', 1, true), ('open', 95, abs(hashtext(r.id::text)) % 100 < 70), ('click', 130, abs(hashtext(r.id::text)) % 100 < 35)) x(ev, m, keep)
 where r.email_id = '43f20000-0000-4000-8000-000000000001' and r.status = 'sent' and x.keep
   and not exists (select 1 from public.email_events e where e.email_id = r.email_id);

-- ---------------------------------------------------------------------------
-- One HubSpot import already run (log only)
-- ---------------------------------------------------------------------------
insert into public.crm_import_logs (id, kind, file_name, mapping, row_count, created_count, updated_count, skipped_count, duplicates, warnings, created_at)
values ('43f40000-0000-4000-8000-000000000001', 'contacts', 'hubspot-contacts-export-2026-09.csv',
  '{"Record ID":"hubspot_id","First Name":"first_name","Last Name":"last_name","Email":"email","Associated Company":"company","Job Title":"job_title","Legal basis for processing contact''s data":"legal_basis"}',
  42, 15, 0, 27, '[{"row":3,"reason":"email","match":"Claire Martin <claire.martin@northbrew.example>"}]', '[]', now() - interval '6 days')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Client business reviews and actions
-- ---------------------------------------------------------------------------
-- Carewell's accounts have been tiered for a while with no review yet, so it shows as overdue by cadence.
update public.crm_accounts set created_at = now() - interval '200 days' where client_id = 'c5000000-0000-4000-8000-000000000003' and created_at > now() - interval '200 days';

insert into public.crm_reviews (id, client_id, account_id, review_type, title, scheduled_on, status, agenda, contact_attendees, client_visible, outcomes, notes, held_at, closed_at, created_at)
select x.id::uuid, a.client_id, a.id, x.typ, x.title, current_date + x.d, x.status, string_to_array(x.agenda, '|'),
       array(select c::uuid from unnest(string_to_array(x.contacts, ',')) c where c <> ''), true, x.outcomes, x.notes,
       case when x.status in ('held','closed') then now() + make_interval(days => x.d) end, case when x.status = 'closed' then now() + make_interval(days => x.d + 2) end,
       now() + make_interval(days => x.d - 30)
  from (values
    ('43aa0000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'qbr', 'Northbrew Germany Q3 business review', -18, 'closed',
     'Tournament results|Estimate turnaround|Christmas gifting proposal|Sustainability numbers', '42c00000-0000-4000-8000-000000000001,42c00000-0000-4000-8000-000000000002',
     'Tournament kit landed on time in 97% of stores. Agreed a 48-hour estimate turnaround target and a Christmas gifting proposal by month end. Client wants quarterly CO2e per campaign.',
     'Good energy; Jonas keen to extend the on-trade programme.'),
    ('43aa0000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', 'qbr', 'Northbrew Germany Q4 business review', 40, 'planned',
     'Q4 delivery|Estimate turnaround progress|2027 planning', '42c00000-0000-4000-8000-000000000002', null, null),
    ('43aa0000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000004', 'half_year', 'Brightlane UK half-year review', 12, 'planned',
     'Survey results|Refill pilot|Polaris 2027 tender', '42c00000-0000-4000-8000-000000000004,42c00000-0000-4000-8000-000000000005', null, null),
    ('43aa0000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000002', 'annual', 'Northbrew global annual review', 75, 'planned',
     'Framework performance|Bar fixture framework|Sustainability roadmap', '42c00000-0000-4000-8000-000000000003', null, null),
    ('43aa0000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000009', 'ad_hoc', 'BAU Singapore opening debrief', -3, 'held',
     'Orchard Road opening|Install photos', '43c00000-0000-4000-8000-000000000014', null, 'Outcomes to write up.')
  ) x(id, account, typ, title, d, status, agenda, contacts, outcomes, notes)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

insert into public.crm_actions (id, client_id, account_id, source, review_id, title, detail, due_date, status, client_visible, done_at, created_at)
select x.id::uuid, a.client_id, a.id, x.src, x.review::uuid, x.title, x.detail, current_date + x.due, x.status, x.visible,
       case when x.status = 'done' then now() - interval '5 days' end, now() - interval '17 days'
  from (values
    ('43ab0000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'review', '43aa0000-0000-4000-8000-000000000001', 'Send the Christmas gifting proposal', 'Three concepts with costs and lead times.', -8, 'done', true),
    ('43ab0000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', 'review', '43aa0000-0000-4000-8000-000000000001', 'Agree the 48-hour estimate turnaround with Sourcing', 'Service level and how we report it each month.', -3, 'in_progress', true),
    ('43ab0000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000001', 'review', '43aa0000-0000-4000-8000-000000000001', 'Quarterly CO2e report per campaign', 'First report covers the tournament programme.', 10, 'open', true),
    ('43ab0000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000001', 'review', '43aa0000-0000-4000-8000-000000000001', 'Internal: check margin on the on-trade extension', null, 5, 'open', false),
    ('43ab0000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000007', 'ad_hoc', null, 'Replace the two damaged clinic stands', 'Agreed with Rachel on the call.', -6, 'open', true),
    ('43ab0000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000007', 'ad_hoc', null, 'Share install photos for the ten missing sites', null, -20, 'done', true),
    ('43ab0000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000004', 'ad_hoc', null, 'Book the refill pilot store walk', null, 7, 'open', false),
    ('43ab0000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000009', 'review', '43aa0000-0000-4000-8000-000000000005', 'Write up the opening debrief outcomes', null, 2, 'open', false),
    ('43ab0000-0000-4000-8000-000000000009', '42a00000-0000-4000-8000-000000000005', 'ad_hoc', null, 'Confirm Tet hamper warehouse slots', null, -1, 'cancelled', false)
  ) x(id, account, src, review, title, detail, due, status, visible)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

insert into public._demo_crm_people (tbl, row_id, col, email)
select x.tbl, x.id::uuid, x.col, x.email from (values
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000001', 'created_by', 'lena.lead@adm-indicia.com'),
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000001', 'closed_by', 'lena.lead@adm-indicia.com'),
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000002', 'created_by', 'lena.lead@adm-indicia.com'),
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000003', 'created_by', 'lena.lead@adm-indicia.com'),
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000004', 'created_by', 'hana.head@adm-indicia.com'),
  ('crm_reviews', '43aa0000-0000-4000-8000-000000000005', 'created_by', 'pedro.procurement@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000001', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000002', 'owner', 'arjun.agent@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000003', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000004', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000005', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000006', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000007', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000008', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_actions', '43ab0000-0000-4000-8000-000000000009', 'owner', 'arjun.agent@adm-indicia.com')
) x(tbl, id, col, email)
on conflict do nothing;
-- Claiming people later (when the demo users are created) must not reset "last updated" on the demo opportunities.
create or replace function public._demo_crm_claim_for(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform set_config('crm.keep_updated_at', 'on', true);
  for r in select * from public._demo_crm_people where lower(email) = lower(p_email) loop
    execute format('update public.%I set %I = $1 where id = $2 and %I is null', r.tbl, r.col, r.col) using p_id, r.row_id;
  end loop;
  update public.crm_contacts set created_by = p_id where id::text like '42c00000-%' and created_by is null and lower(p_email) = 'lena.lead@adm-indicia.com';
  if lower(p_email) = 'lena.lead@adm-indicia.com' then
    update public.crm_actions set owner = p_id where owner is null and source = 'survey';
    update public.crm_reviews set internal_attendees = array[p_id] where id::text like '43aa0000-%' and internal_attendees = '{}';
  end if;
  if lower(p_email) = 'hana.head@adm-indicia.com' then
    insert into public.module_owners (module, user_id) values ('crm', p_id) on conflict do nothing;
  end if;
  perform set_config('crm.keep_updated_at', 'off', true);
end $$;
revoke execute on function public._demo_crm_claim_for(uuid, text) from public, anon, authenticated;

-- Existing demo database: claim the new people rows now (profiles already exist).
select public._demo_crm_claim_for(p.id, p.email) from public.profiles p
 where lower(p.email) in (select distinct lower(email) from public._demo_crm_people);
