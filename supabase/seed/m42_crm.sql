-- DUMMY DATA for CRM (client relationship management). Every person, contact, number and comment here is made up.
-- Loaded after m40_sourcing.sql (the demo clients) and m20_briefing.sql (campaigns). Safe on an existing demo database:
-- fixed ids with "on conflict do nothing" / "where not exists", so running it again changes nothing.
-- Demo users are created after the seed on a fresh build (src/lib/demo/db.ts), so people are claimed by email when each
-- profile appears (_demo_crm_people + trigger), and straight away when the profiles already exist.

-- ---------------------------------------------------------------------------
-- Client master: CRM fields for the demo clients (seed writes run without a signed-in user, so the CRM guard allows them)
-- ---------------------------------------------------------------------------
update public.sourcing_clients s set hq_market = x.m, sector = x.sector, credit_limit = x.credit, payment_terms_days = coalesce(s.payment_terms_days, x.days)
  from (values ('UL', 'GB', 'Consumer goods', 750000, 60), ('HNK', 'NL', 'Beverages', 900000, 45), ('CPL', 'DK', 'Medical devices', 250000, 30),
               ('BAU', 'SG', 'Mixed (run-rate clients)', 100000, 30)) x(code, m, sector, credit, days)
 where s.code = x.code and s.hq_market is null;

-- A prospect waiting for its new client set-up (credit / KYC check) in the approvals inbox.
insert into public.sourcing_clients (id, code, name, default_currency, default_markup_percent, savings_target_percent, min_quotes_required,
  hq_market, sector, credit_limit, crm_setup_status, crm_setup_note) values
  ('c5000000-0000-4000-8000-000000000042', 'NSF', 'Northstar Foods (demo)', 'EUR', 16, 4, 3, 'DE', 'Food', 150000, 'pending',
   'Credit report and KYC pack attached; parent company guarantee offered.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Approval policies for CRM (demo settings, not adm Indicia policy)
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'approval_policies', x.code, x.name, x.data::jsonb, 'active', '2026-01-01'::date, 'Demo policy (CRM)'
from (values
  ('AP-CRM-CLIENT-SETUP', 'New client set-up (credit and KYC)', '{"module":"crm","approval_type":"CRM_CLIENT_SETUP","approver_role":"finance","maker_checker":true,"sla_days":3,"description":"A new client is checked by Finance (credit limit, KYC) before it can be used on jobs; never by the person who set it up.","decided_in":"crm_client_create, approval_request_decide","where_in_ui":"/crm/clients/<client>"}'),
  ('AP-CRM-TERMS', 'Client commercial terms change', '{"module":"crm","approval_type":"CRM_TERMS","approver_role":"module_owner","maker_checker":true,"sla_days":3,"description":"Changes to a client''s markup, GSC commission, rebate or payment terms are requested in CRM and applied to the client master when an account director (CRM owner) or admin approves.","decided_in":"crm_terms_request, approval_request_decide","where_in_ui":"/crm/clients/<client>?tab=contract"}'),
  ('AP-CRM-CONTRACT-HIGH', 'Client contract: high value', '{"module":"crm","approval_type":"CRM_CONTRACT","approver_role":"admin","min_value":100000,"maker_checker":true,"sla_days":5,"description":"Client contracts or renewals worth 100,000 or more are signed only after an admin approves.","decided_in":"crm_contract_sign, crm_contract_renew, approval_request_decide","where_in_ui":"/crm/contracts"}'),
  ('AP-CRM-WON-HIGH', 'Opportunity won: high value', '{"module":"crm","approval_type":"CRM_OPP_WON","approver_role":"module_owner","min_value":50000,"maker_checker":true,"sla_days":2,"description":"Opportunities of 50,000 or more are confirmed as won by a sales lead (CRM owner) or admin before they count.","decided_in":"crm_opportunity_move, approval_request_decide","where_in_ui":"/crm/pipeline"}')
) x(code, name, data)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Accounts per market
-- ---------------------------------------------------------------------------
insert into public.crm_accounts (id, client_id, market, region, tier_id, status, notes, created_at)
select x.id::uuid, x.client::uuid, x.market, m.region_code,
       (select id from public.library_records where library_key = 'crm_account_tiers' and code = x.tier and status = 'active'), x.status, x.notes, now() - interval '200 days'
  from (values
    ('42a00000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 'DE', 'STRATEGIC', 'active', 'Lead market for the on-trade programme.'),
    ('42a00000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 'NL', 'KEY', 'active', 'Global brand team sits here.'),
    ('42a00000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000002', 'GB', 'GROWTH', 'active', null),
    ('42a00000-0000-4000-8000-000000000004', 'c5000000-0000-4000-8000-000000000001', 'GB', 'STRATEGIC', 'active', 'Personal care and ice cream.'),
    ('42a00000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-000000000001', 'VN', 'GROWTH', 'active', 'Tet and Knorr programmes.'),
    ('42a00000-0000-4000-8000-000000000006', 'c5000000-0000-4000-8000-000000000001', 'FR', 'KEY', 'prospect', null),
    ('42a00000-0000-4000-8000-000000000007', 'c5000000-0000-4000-8000-000000000003', 'US', 'KEY', 'active', 'Clinic visibility programme.'),
    ('42a00000-0000-4000-8000-000000000008', 'c5000000-0000-4000-8000-000000000003', 'DK', 'GROWTH', 'active', null),
    ('42a00000-0000-4000-8000-000000000009', 'c5000000-0000-4000-8000-000000000004', 'SG', 'BAU', 'active', 'Store openings on demand.'),
    ('42a00000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000004', 'DE', 'BAU', 'dormant', null)
  ) x(id, client, market, tier, status, notes)
  join public.markets m on m.code = x.market
 where exists (select 1 from public.sourcing_clients c where c.id = x.client::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Contacts (fictional people at the clients)
-- ---------------------------------------------------------------------------
insert into public.crm_contacts (id, client_id, account_id, full_name, job_title, email, phone, market, decision_role, consent, consent_at, created_at)
select x.id::uuid, a.client_id, a.id, x.name, x.title, x.email, x.phone, a.market, x.role, x.consent, case when x.consent then now() - interval '150 days' end, now() - interval '180 days'
  from (values
    ('42c00000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'Claire Martin', 'Shopper marketing manager', 'claire.martin@heineken.example', '+49 30 0000 0101', 'approver', true),
    ('42c00000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', 'Jonas Weber', 'Head of trade marketing', 'jonas.weber@heineken.example', '+49 30 0000 0102', 'sponsor', true),
    ('42c00000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000002', 'Femke de Vries', 'Global procurement lead', 'femke.devries@heineken.example', '+31 20 000 0103', 'buyer', true),
    ('42c00000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000004', 'Olivia Hart', 'Customer development director', 'olivia.hart@unilever.example', '+44 20 0000 0104', 'sponsor', true),
    ('42c00000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000004', 'Sam Okafor', 'In-store activation manager', 'sam.okafor@unilever.example', '+44 20 0000 0105', 'approver', true),
    ('42c00000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000005', 'Linh Tran', 'Brand manager, Knorr', 'linh.tran@unilever.example', '+84 28 0000 0106', 'user', false),
    ('42c00000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000007', 'Rachel Kim', 'Marketing operations', 'rachel.kim@coloplast.example', '+1 612 000 0107', 'approver', true),
    ('42c00000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000008', 'Mads Nielsen', 'Indirect procurement', 'mads.nielsen@coloplast.example', '+45 00 00 01 08', 'buyer', true),
    ('42c00000-0000-4000-8000-000000000009', '42a00000-0000-4000-8000-000000000009', 'Wei Ling Tan', 'Retail projects', 'weiling.tan@bauclient.example', '+65 0000 0109', 'user', false),
    ('42c00000-0000-4000-8000-000000000010', '42a00000-0000-4000-8000-000000000003', 'Tom Ellis', 'Category manager', 'tom.ellis@heineken.example', '+44 20 0000 0110', 'user', true)
  ) x(id, account, name, title, email, phone, role, consent)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Opportunities across the pipeline
-- ---------------------------------------------------------------------------
insert into public.crm_opportunities (id, client_id, account_id, title, description, stage, value, currency, probability, expected_close,
  lost_reason_id, lost_note, won_at, lost_at, market, region, created_at)
select x.id::uuid, a.client_id, a.id, x.title, x.descr, x.stage, x.value, x.cur, public.crm_stage_probability(x.stage), current_date + x.close_in,
       case when x.reason is not null then (select id from public.library_records where library_key = 'crm_lost_reasons' and code = x.reason and status = 'active') end,
       case when x.stage = 'lost' then 'Client chose to run it through their own print partner.' end,
       case when x.stage = 'won' then now() - interval '75 days' end, case when x.stage = 'lost' then now() - interval '20 days' end,
       a.market, a.region, now() - make_interval(days => x.age)
  from (values
    ('42d00000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'Summer of Football in-store kit', 'Tournament POS for off-trade and on-trade.', 'won', 180000, 'EUR', -80, null, 140),
    ('42d00000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', 'Christmas gifting displays 2026', 'Gift pack displays for German hypermarkets.', 'negotiation', 95000, 'EUR', 21, null, 45),
    ('42d00000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000002', 'Global bar fixture framework', 'Three-year framework for permanent bar fixtures.', 'proposal', 420000, 'EUR', 60, null, 30),
    ('42d00000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000003', '0.0 sampling stands', null, 'qualified', 38000, 'GBP', 75, null, 12),
    ('42d00000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000004', 'Dove refill station pilot', 'Refill station fixtures in 40 stores.', 'proposal', 64000, 'GBP', 40, null, 25),
    ('42d00000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000004', 'Magnum freezer toppers 2027', null, 'lead', 120000, 'GBP', 120, null, 6),
    ('42d00000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000005', 'Tet 2027 hampers', 'Premium hampers for modern trade.', 'won', 26000, 'EUR', -30, null, 90),
    ('42d00000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000006', 'France shelf-ready packaging', null, 'lost', 45000, 'EUR', -15, 'INCUMBENT', 70),
    ('42d00000-0000-4000-8000-000000000009', '42a00000-0000-4000-8000-000000000007', 'Clinic display refresh wave 2', 'Second wave of clinic stands, 120 sites.', 'negotiation', 72000, 'EUR', 14, null, 50),
    ('42d00000-0000-4000-8000-000000000010', '42a00000-0000-4000-8000-000000000008', 'Nordic pharmacy counter units', null, 'qualified', 30000, 'EUR', 90, null, 10),
    ('42d00000-0000-4000-8000-000000000011', '42a00000-0000-4000-8000-000000000009', 'Orchard Road opening kits (BAU call-off)', null, 'lead', 9000, 'EUR', 40, null, 3),
    ('42d00000-0000-4000-8000-000000000012', '42a00000-0000-4000-8000-000000000003', 'Pub chalkboards re-print', null, 'lost', 12000, 'GBP', -40, 'PRICE', 95)
  ) x(id, account, title, descr, stage, value, cur, close_in, reason, age)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

-- The won Heineken opportunity is the Summer of Football campaign already in Briefing+ (linked both ways).
update public.campaigns set crm_opportunity_id = '42d00000-0000-4000-8000-000000000001'
 where campaign_code = 'CMP-2026-00001' and crm_opportunity_id is null
   and exists (select 1 from public.crm_opportunities where id = '42d00000-0000-4000-8000-000000000001')
   and not exists (select 1 from public.campaigns where crm_opportunity_id = '42d00000-0000-4000-8000-000000000001');
update public.crm_opportunities o set campaign_id = c.id from public.campaigns c
 where o.id = '42d00000-0000-4000-8000-000000000001' and c.crm_opportunity_id = o.id and o.campaign_id is null;

-- ---------------------------------------------------------------------------
-- Interactions (activity log)
-- ---------------------------------------------------------------------------
insert into public.crm_interactions (id, client_id, account_id, opportunity_id, contact_id, type_id, subject, summary, occurred_at, market, region, created_at)
select x.id::uuid, a.client_id, a.id, x.opp::uuid, x.contact::uuid,
       (select id from public.library_records where library_key = 'crm_interaction_types' and code = x.typ and status = 'active'),
       x.subject, x.summary, now() - make_interval(days => x.ago), a.market, a.region, now() - make_interval(days => x.ago)
  from (values
    ('42e00000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', null, '42c00000-0000-4000-8000-000000000002', 'QBR', 'Q3 business review', 'Reviewed tournament results; asked for a Christmas proposal and faster estimate turnaround.', 18),
    ('42e00000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', '42d00000-0000-4000-8000-000000000002', '42c00000-0000-4000-8000-000000000001', 'MEETING', 'Christmas displays workshop', 'Agreed three concepts and the hypermarket list.', 9),
    ('42e00000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000002', '42d00000-0000-4000-8000-000000000003', '42c00000-0000-4000-8000-000000000003', 'CALL', 'Framework pricing questions', 'Procurement wants index-linked pricing and a 45-day payment term.', 6),
    ('42e00000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000003', '42d00000-0000-4000-8000-000000000004', '42c00000-0000-4000-8000-000000000010', 'EMAIL', 'Sampling stand specs', 'Sent two stand options with lead times.', 4),
    ('42e00000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000004', '42d00000-0000-4000-8000-000000000005', '42c00000-0000-4000-8000-000000000004', 'MEETING', 'Refill pilot scoping', 'Pilot in 40 stores; sustainability team joins next time.', 12),
    ('42e00000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000004', null, '42c00000-0000-4000-8000-000000000005', 'NOTE', 'Activation team reorganised', 'Sam now approves all GB in-store work.', 27),
    ('42e00000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000005', '42d00000-0000-4000-8000-000000000007', '42c00000-0000-4000-8000-000000000006', 'CALL', 'Tet hamper delivery plan', 'Confirmed warehouse slots for December.', 35),
    ('42e00000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000007', '42d00000-0000-4000-8000-000000000009', '42c00000-0000-4000-8000-000000000007', 'MEETING', 'Wave 2 site list', 'Client adds 20 clinics in Texas.', 15),
    ('42e00000-0000-4000-8000-000000000009', '42a00000-0000-4000-8000-000000000008', '42d00000-0000-4000-8000-000000000010', '42c00000-0000-4000-8000-000000000008', 'EMAIL', 'Pharmacy counter brief', 'Requested a budget range by month end.', 40),
    ('42e00000-0000-4000-8000-000000000010', '42a00000-0000-4000-8000-000000000009', null, '42c00000-0000-4000-8000-000000000009', 'CALL', 'Opening calendar', 'Two openings expected in Q1.', 75),
    ('42e00000-0000-4000-8000-000000000011', '42a00000-0000-4000-8000-000000000001', null, '42c00000-0000-4000-8000-000000000001', 'EMAIL', 'Feedback on estimate turnaround', 'Claire flagged estimates taking more than a week.', 2),
    ('42e00000-0000-4000-8000-000000000012', '42a00000-0000-4000-8000-000000000006', '42d00000-0000-4000-8000-000000000008', null, 'NOTE', 'Lost to incumbent', 'Incumbent matched our price and kept the business.', 20),
    ('42e00000-0000-4000-8000-000000000013', '42a00000-0000-4000-8000-000000000004', '42d00000-0000-4000-8000-000000000006', '42c00000-0000-4000-8000-000000000004', 'CALL', 'Magnum 2027 early chat', 'Brand team open to a tender in the new year.', 5),
    ('42e00000-0000-4000-8000-000000000014', '42a00000-0000-4000-8000-000000000002', null, '42c00000-0000-4000-8000-000000000003', 'QBR', 'Global procurement review', 'Scorecard reviewed; on-time delivery 96%.', 48)
  ) x(id, account, opp, contact, typ, subject, summary, ago)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Account plans and actions
-- ---------------------------------------------------------------------------
insert into public.crm_account_plans (id, client_id, account_id, title, period_start, period_end, objectives, growth_target, currency, status, created_at)
select x.id::uuid, a.client_id, a.id, x.title, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
       x.obj, x.target, x.cur, x.status, now() - interval '160 days'
  from (values
    ('42f00000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', 'Heineken Germany growth plan', 'Grow on-trade fixtures; win the Christmas gifting programme; cut estimate turnaround to 48 hours.', 350000, 'EUR', 'active'),
    ('42f00000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000004', 'Unilever UK account plan', 'Land the Dove refill pilot; position for the Magnum 2027 tender; quarterly sustainability reporting.', 250000, 'GBP', 'active'),
    ('42f00000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000007', 'Coloplast US plan', 'Roll out wave 2 clinic displays and open the Nordic pharmacy channel.', 120000, 'EUR', 'draft')
  ) x(id, account, title, obj, target, cur, status)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

insert into public.crm_plan_actions (id, plan_id, action, due_date, status, done_at, created_at)
select x.id::uuid, x.plan::uuid, x.action, current_date + x.due, x.status, case when x.status = 'done' then now() - interval '10 days' end, now() - interval '150 days'
  from (values
    ('42f10000-0000-4000-8000-000000000001', '42f00000-0000-4000-8000-000000000001', 'Send Christmas gifting proposal', -5, 'done'),
    ('42f10000-0000-4000-8000-000000000002', '42f00000-0000-4000-8000-000000000001', 'Agree 48-hour estimate service level with Sourcing', -3, 'open'),
    ('42f10000-0000-4000-8000-000000000003', '42f00000-0000-4000-8000-000000000001', 'Book Q4 business review', 20, 'open'),
    ('42f10000-0000-4000-8000-000000000004', '42f00000-0000-4000-8000-000000000002', 'Refill pilot store survey', 14, 'open'),
    ('42f10000-0000-4000-8000-000000000005', '42f00000-0000-4000-8000-000000000002', 'Share Q3 sustainability report', -20, 'done'),
    ('42f10000-0000-4000-8000-000000000006', '42f00000-0000-4000-8000-000000000003', 'Price wave 2 with two vendors', 30, 'open')
  ) x(id, plan, action, due, status)
 where exists (select 1 from public.crm_account_plans p where p.id = x.plan::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Contracts and commercial terms (one MSA renewal due soon)
-- ---------------------------------------------------------------------------
insert into public.crm_contracts (id, client_id, parent_id, contract_type, title, start_date, end_date, renewal_date, notice_days, auto_renew, value, currency,
  payment_terms_days, markup_percent, min_margin_percent, gsc_commission_percent, rebate_percent, sustainability_commitments, status, signed_at, created_at)
select x.id::uuid, x.client::uuid, x.parent::uuid, x.typ, x.title, current_date + x.s, current_date + x.e, current_date + x.r, x.notice, x.auto, x.value, x.cur,
       x.days, x.markup, x.margin, x.gsc, x.rebate, x.sus, x.status, case when x.status = 'signed' then now() - make_interval(days => -x.s) end, now() - make_interval(days => greatest(-x.s, 0) + 10)
  from (values
    ('42b00000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', null, 'msa', 'Heineken master services agreement', -1050, 45, 45, 90, false, 2400000, 'EUR', 45, 14, 10, 2.0, 1.0, 'FSC board on all 2D POS; 30% recycled content by 2027.', 'signed'),
    ('42b00000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', '42b00000-0000-4000-8000-000000000001', 'sow', 'Summer of Football SOW', -150, 20, null, 30, false, 180000, 'EUR', 45, 14, 10, 2.0, 1.0, null, 'signed'),
    ('42b00000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001', null, 'msa', 'Unilever framework agreement', -400, 330, 240, 120, true, 1800000, 'GBP', 60, 15, 11, 2.5, 1.5, 'Report CO2e per campaign; no PVC.', 'signed'),
    ('42b00000-0000-4000-8000-000000000004', 'c5000000-0000-4000-8000-000000000003', null, 'sow', 'Clinic displays wave 2 SOW', 20, 200, null, 30, false, 72000, 'EUR', 30, 12, 9, 0, 2.0, null, 'draft'),
    ('42b00000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-000000000004', null, 'msa', 'BAU client terms of business', -700, 400, 300, 60, true, 150000, 'EUR', 30, 18, 12, 3.0, 0, null, 'signed')
  ) x(id, client, parent, typ, title, s, e, r, notice, auto, value, cur, days, markup, margin, gsc, rebate, sus, status)
 where exists (select 1 from public.sourcing_clients c where c.id = x.client::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Feedback / NPS (internal capture and the Client Portal)
-- ---------------------------------------------------------------------------
insert into public.crm_feedback (id, client_id, account_id, contact_id, market, region, score, comment, source, followed_up_at, follow_up_note, created_at)
select x.id::uuid, a.client_id, a.id, x.contact::uuid, a.market, a.region, x.score, x.comment, x.src,
       case when x.fu then now() - make_interval(days => x.ago - 3) end, case when x.fu then 'Called the client and agreed a fix.' end, now() - make_interval(days => x.ago)
  from (values
    ('42ff0000-0000-4000-8000-000000000001', '42a00000-0000-4000-8000-000000000001', '42c00000-0000-4000-8000-000000000002', 9, 'Tournament kit landed on time in every store.', 'internal', false, 18),
    ('42ff0000-0000-4000-8000-000000000002', '42a00000-0000-4000-8000-000000000001', null, 6, 'Estimates take too long to come back.', 'client_portal', false, 3),
    ('42ff0000-0000-4000-8000-000000000003', '42a00000-0000-4000-8000-000000000002', '42c00000-0000-4000-8000-000000000003', 8, 'Good scorecard reporting.', 'internal', false, 48),
    ('42ff0000-0000-4000-8000-000000000004', '42a00000-0000-4000-8000-000000000004', '42c00000-0000-4000-8000-000000000004', 10, 'The team really gets our sustainability goals.', 'internal', false, 12),
    ('42ff0000-0000-4000-8000-000000000005', '42a00000-0000-4000-8000-000000000005', '42c00000-0000-4000-8000-000000000006', 7, null, 'internal', false, 35),
    ('42ff0000-0000-4000-8000-000000000006', '42a00000-0000-4000-8000-000000000007', '42c00000-0000-4000-8000-000000000007', 5, 'Installation photos were missing for ten sites.', 'internal', true, 60),
    ('42ff0000-0000-4000-8000-000000000007', '42a00000-0000-4000-8000-000000000007', '42c00000-0000-4000-8000-000000000007', 4, 'Two stands arrived damaged.', 'internal', false, 15),
    ('42ff0000-0000-4000-8000-000000000008', '42a00000-0000-4000-8000-000000000009', '42c00000-0000-4000-8000-000000000009', 8, 'Quick and easy as always.', 'internal', false, 75)
  ) x(id, account, contact, score, comment, src, fu, ago)
  join public.crm_accounts a on a.id = x.account::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Pending approval requests: a commercial terms change (Unilever) and the new client set-up (Northstar Foods)
-- ---------------------------------------------------------------------------
insert into public.approval_requests (id, module, approval_type, entity_type, entity_id, ref, title, summary, payload, amount, currency, client_id, market, region, href,
  policy_record_id, approver_role, approver_module, maker_checker, run_as, reason, requested_at)
select '42ab0000-0000-4000-8000-000000000001', 'crm', 'CRM_TERMS', 'client_terms', c.id::text, c.code, 'Commercial terms change: ' || c.name,
       'markup ' || c.default_markup_percent || '% -> 16%; payment terms ' || coalesce(c.payment_terms_days || ' days', 'Finance default') || ' -> 75 days',
       jsonb_build_object('markup', 16, 'commission', c.gsc_commission_percent, 'rebate', c.year_end_rebate_percent, 'payment_terms_days', 75,
         'contract_id', '42b00000-0000-4000-8000-000000000003',
         'before', jsonb_build_object('markup', c.default_markup_percent, 'commission', c.gsc_commission_percent, 'rebate', c.year_end_rebate_percent, 'payment_terms_days', c.payment_terms_days)),
       null, c.default_currency, c.id, 'GB', 'EMEA', '/crm/clients/' || c.id || '?tab=contract',
       (select id from public.library_records where library_key = 'approval_policies' and code = 'AP-CRM-TERMS' and status = 'active'),
       'module_owner', 'crm', true, 'approver', 'Unilever procurement asked for 75-day terms in exchange for a higher markup on the refill programme.', now() - interval '1 day'
  from public.sourcing_clients c
 where c.code = 'UL'
   and not exists (select 1 from public.approval_requests r where r.approval_type = 'CRM_TERMS' and r.entity_id = c.id::text and r.status in ('pending','applying'))
on conflict do nothing;

insert into public.approval_requests (id, module, approval_type, entity_type, entity_id, ref, title, summary, payload, amount, currency, client_id, market, region, href,
  policy_record_id, approver_role, approver_module, maker_checker, run_as, reason, requested_at)
select '42ab0000-0000-4000-8000-000000000002', 'crm', 'CRM_CLIENT_SETUP', 'client', c.id::text, c.code, 'New client set-up: ' || c.name,
       'Credit and KYC check before ' || c.name || ' can be used on jobs (credit limit EUR 150,000)',
       jsonb_build_object('credit_limit', c.credit_limit, 'hq_market', c.hq_market, 'sector', c.sector), c.credit_limit, c.default_currency, c.id, 'DE', 'EMEA',
       '/crm/clients/' || c.id,
       (select id from public.library_records where library_key = 'approval_policies' and code = 'AP-CRM-CLIENT-SETUP' and status = 'active'),
       'finance', null, true, 'approver', c.crm_setup_note, now() - interval '2 days'
  from public.sourcing_clients c
 where c.code = 'NSF' and c.crm_setup_status = 'pending'
   and not exists (select 1 from public.approval_requests r where r.approval_type = 'CRM_CLIENT_SETUP' and r.entity_id = c.id::text and r.status in ('pending','applying'))
on conflict do nothing;

insert into public.approval_request_events (request_id, action, note, at)
select r.id, 'requested', r.reason, r.requested_at from public.approval_requests r
 where r.id in ('42ab0000-0000-4000-8000-000000000001', '42ab0000-0000-4000-8000-000000000002')
   and not exists (select 1 from public.approval_request_events e where e.request_id = r.id);

-- ---------------------------------------------------------------------------
-- Demo people: account leads, owners, requesters and the CRM owner, claimed by email
-- ---------------------------------------------------------------------------
create table if not exists public._demo_crm_people (tbl text not null, row_id uuid not null, col text not null, email text not null, primary key (tbl, row_id, col));
alter table public._demo_crm_people enable row level security;
revoke all on public._demo_crm_people from authenticated, anon;

insert into public._demo_crm_people (tbl, row_id, col, email)
select x.tbl, x.id::uuid, x.col, x.email from (values
  ('crm_accounts', '42a00000-0000-4000-8000-000000000001', 'account_lead', 'lena.lead@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000002', 'account_lead', 'hana.head@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000003', 'account_lead', 'pedro.procurement@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000004', 'account_lead', 'lena.lead@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000005', 'account_lead', 'arjun.agent@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000006', 'account_lead', 'pedro.procurement@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000007', 'account_lead', 'hana.head@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000008', 'account_lead', 'arjun.agent@adm-indicia.com'),
  ('crm_accounts', '42a00000-0000-4000-8000-000000000009', 'account_lead', 'pedro.procurement@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000001', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000002', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000003', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000004', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000005', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000006', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000007', 'owner', 'arjun.agent@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000008', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000009', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000010', 'owner', 'arjun.agent@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000011', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_opportunities', '42d00000-0000-4000-8000-000000000012', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_account_plans', '42f00000-0000-4000-8000-000000000001', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_account_plans', '42f00000-0000-4000-8000-000000000002', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_account_plans', '42f00000-0000-4000-8000-000000000003', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000001', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000002', 'owner', 'arjun.agent@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000003', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000004', 'owner', 'pedro.procurement@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000005', 'owner', 'lena.lead@adm-indicia.com'),
  ('crm_plan_actions', '42f10000-0000-4000-8000-000000000006', 'owner', 'hana.head@adm-indicia.com'),
  ('crm_contracts', '42b00000-0000-4000-8000-000000000001', 'signed_by', 'ada.admin@adm-indicia.com'),
  ('crm_contracts', '42b00000-0000-4000-8000-000000000002', 'signed_by', 'lena.lead@adm-indicia.com'),
  ('crm_contracts', '42b00000-0000-4000-8000-000000000003', 'signed_by', 'ada.admin@adm-indicia.com'),
  ('crm_contracts', '42b00000-0000-4000-8000-000000000005', 'signed_by', 'hana.head@adm-indicia.com'),
  ('approval_requests', '42ab0000-0000-4000-8000-000000000001', 'requested_by', 'lena.lead@adm-indicia.com'),
  ('approval_requests', '42ab0000-0000-4000-8000-000000000002', 'requested_by', 'pedro.procurement@adm-indicia.com')
) x(tbl, id, col, email)
on conflict do nothing;

-- Interactions and internal feedback: who had them / captured them.
insert into public._demo_crm_people (tbl, row_id, col, email)
select 'crm_interactions', i.id, 'owner', p.email from public.crm_interactions i
  join public._demo_crm_people p on p.tbl = 'crm_accounts' and p.row_id = i.account_id and p.col = 'account_lead'
 where i.id::text like '42e00000-%'
on conflict do nothing;
insert into public._demo_crm_people (tbl, row_id, col, email)
select 'crm_feedback', f.id, 'submitted_by', p.email from public.crm_feedback f
  join public._demo_crm_people p on p.tbl = 'crm_accounts' and p.row_id = f.account_id and p.col = 'account_lead'
 where f.id::text like '42ff0000-%' and f.source = 'internal'
on conflict do nothing;

create or replace function public._demo_crm_claim_for(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from public._demo_crm_people where lower(email) = lower(p_email) loop
    execute format('update public.%I set %I = $1 where id = $2 and %I is null', r.tbl, r.col, r.col) using p_id, r.row_id;
  end loop;
  update public.crm_contacts set created_by = p_id where id::text like '42c00000-%' and created_by is null and lower(p_email) = 'lena.lead@adm-indicia.com';
  -- Hana Head is the demo CRM owner (account director / sales lead): she approves terms changes and confirms big wins.
  if lower(p_email) = 'hana.head@adm-indicia.com' then
    insert into public.module_owners (module, user_id) values ('crm', p_id) on conflict do nothing;
  end if;
end $$;
revoke execute on function public._demo_crm_claim_for(uuid, text) from public, anon, authenticated;

create or replace function public._demo_crm_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public._demo_crm_claim_for(new.id, new.email);
  exception when others then
    raise warning 'demo CRM claim skipped for %: %', new.email, sqlerrm;   -- never block a sign-up over demo data
  end;
  return null;
end $$;
revoke execute on function public._demo_crm_claim() from public, anon, authenticated;
drop trigger if exists demo_crm_claim on public.profiles;
create trigger demo_crm_claim after insert on public.profiles for each row execute function public._demo_crm_claim();

-- Existing demo database: the people are already there.
select public._demo_crm_claim_for(p.id, p.email) from public.profiles p
 where lower(p.email) in (select distinct lower(email) from public._demo_crm_people) or lower(p.email) = 'hana.head@adm-indicia.com';
