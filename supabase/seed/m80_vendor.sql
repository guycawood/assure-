-- DUMMY DATA for the Supplier Engagement layer (vendor portal). Every value here is made up.
-- Demo vendor users (src/lib/demo/config.ts) are linked by handle_new_user through each supplier's primary contact
-- email (vendorN@example.com); the team rows below become active when those users are created.
-- Runs in one transaction; the system-write flag is transaction-local.

begin;
select set_config('assure.system_write', 'on', true);

create temporary view demo_v as
  select s.id, s.name, s.primary_contact_email as email, substring(s.supplier_code from 6)::int as n
    from public.suppliers s where s.supplier_code like 'DEMO-%';

-- ---------------------------------------------------------------------------
-- Portal teams: the primary contact is admin; a few colleagues invited at other levels (still pending).
-- ---------------------------------------------------------------------------
insert into public.supplier_team_members (supplier_id, email, permission_level, status)
select d.id, d.email, 'admin', 'pending' from demo_v d where d.n in (1, 19, 30)
on conflict (supplier_id, email) do nothing;

insert into public.supplier_team_members (supplier_id, email, permission_level, status)
select d.id, x.email, x.lvl, 'pending'
  from demo_v d join (values (19, 'olek.nowak@vistula.example', 'standard'), (19, 'ewa.lis@vistula.example', 'viewer'),
                             (30, 'mei.tan@straits.example', 'standard')) x(n, email, lvl) on x.n = d.n
on conflict (supplier_id, email) do nothing;

-- ---------------------------------------------------------------------------
-- Subscriptions (set by adm Indicia only)
-- ---------------------------------------------------------------------------
insert into public.supplier_subscriptions (supplier_id, tier, status, renewal_date)
select d.id, x.tier, 'active', current_date + x.days
  from demo_v d join (values (1, 'gold', 140), (19, 'silver', 60), (13, 'platinum', 220), (29, 'diamond', 300)) x(n, tier, days) on x.n = d.n
on conflict (supplier_id) do nothing;

-- ---------------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------------
insert into public.supplier_sites (supplier_id, name, site_type, address_line1, city, postcode, country_alpha2, locode, latitude, longitude,
                                   contact_name, is_default_dispatch)
select d.id, x.name, x.type, x.addr, x.city, x.pc, x.cc, x.locode, x.lat, x.lon, x.contact, x.dflt
  from demo_v d join (values
    (19, 'Poznań joinery works', 'manufacturing', 'ul. Przemysłowa 12', 'Poznań', '61-001', 'PL', 'PLPOZ', 52.406374, 16.925168, 'Olek Nowak', true),
    (19, 'Gdańsk export warehouse', 'warehouse', 'ul. Portowa 3', 'Gdańsk', '80-001', 'PL', 'PLGDN', 54.352025, 18.646638, null, false),
    (30, 'Jurong assembly plant', 'manufacturing', '8 Jurong Port Road', 'Singapore', '619093', 'SG', 'SGSIN', 1.307400, 103.720400, 'Mei Tan', true),
    (1,  'Dongguan print plant', 'manufacturing', '88 Industrial Avenue', 'Dongguan', '523000', 'CN', 'CNDGG', 23.020536, 113.751765, null, true)
  ) x(n, name, type, addr, city, pc, cc, locode, lat, lon, contact, dflt) on x.n = d.n;

-- ---------------------------------------------------------------------------
-- An issued purchase order waiting for Straits Component Supply (DEMO-030) to accept.
-- ---------------------------------------------------------------------------
insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level,
  doa_record_id, doa_basis, exceeds_e_tender, approver_doa_level, approved_at, region, market, notes)
select 'f5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000003', d.id,
       'EUR', 1260, current_date - 1, current_date + 18, 'issued', 1,
       (select id from public.library_records where library_key = 'doa_levels' and code = 'L1' and status = 'active'),
       'Up to £25,000 from the DOA matrix in force', false, 1, now() - interval '1 day', 'APAC', 'Singapore', 'Dummy PO for the vendor portal demo'
  from demo_v d where d.n = 30
   and exists (select 1 from public.estimates where id = 'e5000000-0000-4000-8000-000000000003')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A supply agreement out for signature with Vistula Woodcraft (DEMO-019): the vendor signs first, then adm Indicia.
-- ---------------------------------------------------------------------------
insert into public.contracts (id, contract_ref, supplier_id, title, document_type, status, content_summary, value, currency, start_date, end_date,
                              due_date, sent_at, internal_notes)
select 'c8000000-0000-4000-8000-000000000019', 'CT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.contract_no')::text, 5, '0'),
       d.id, 'Fixtures supply agreement 2027', 'contract', 'sent',
       'Two-year agreement for back-bar and display fixtures across EMEA, with quality and delivery service levels.',
       120000, 'EUR', current_date + 30, current_date + 760, current_date + 14, now() - interval '2 days', 'Dummy contract'
  from demo_v d where d.n = 19;

insert into public.contract_parties (contract_id, name, email, role, signing_order, is_internal, status)
values ('c8000000-0000-4000-8000-000000000019', 'Priya Patel', 'vendor19@example.com', 'signer', 1, false, 'sent'),
       ('c8000000-0000-4000-8000-000000000019', 'Hana Head', 'hana.head@adm-indicia.com', 'signer', 2, true, 'sent');

insert into public.contract_activity (contract_id, event_type, description)
values ('c8000000-0000-4000-8000-000000000019', 'created', 'Contract created'),
       ('c8000000-0000-4000-8000-000000000019', 'sent', 'Sent for signature');

-- ---------------------------------------------------------------------------
-- Public applications waiting for procurement
-- ---------------------------------------------------------------------------
insert into public.vendor_applications (application_ref, company_name, contact_name, contact_email, country, major_category, data, created_at)
values ('APP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.vendor_application_no')::text, 5, '0'),
        'Baltic Board & Print', 'Jonas Petraitis', 'jonas@balticboard.example', 'Lithuania', 'Packaging',
        '{"supplier":{"total_employees":"140","annual_turnover":"EUR 9,000,000"},"capabilities":{"manufacture_capabilities":["Litho printing","Die cutting"]}}', now() - interval '2 days'),
       ('APP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.vendor_application_no')::text, 5, '0'),
        'Andalucía Display Studio', 'Lucía Romero', 'lucia@andaluciadisplay.example', 'Spain', 'POS',
        '{"supplier":{"total_employees":"35"}}', now() - interval '5 hours');

commit;
