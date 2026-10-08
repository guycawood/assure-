-- DUMMY DATA for trying out Assure+. Every supplier name and code here is made up.
-- Run in the Supabase SQL Editor AFTER the migrations. Safe to run twice (it clears old demo rows first).
-- Remove it all later with:  delete from public.suppliers where supplier_code like 'DEMO-%';
--                            delete from public.srt_tickets where source_ref = 'demo';

delete from public.srt_tickets where source_ref = 'demo';
delete from public.suppliers where supplier_code like 'DEMO-%';

-- 30 fictional suppliers across clients, markets and spend levels.
with names(n, name, market, region, client, category, spend, route, strategic) as (
  values
  (1,  'Northwind Print Co',        'China',          'APAC',     'Unilever',  'Print',      412000, 'fast_track', true),
  (2,  'Lotus Display Works',       'China',          'APAC',     'Unilever',  'POSM',       268000, 'fast_track', false),
  (3,  'Jade River Packaging',      'China',          'APAC',     'Heineken',  'Packaging',  155000, 'fast_track', false),
  (4,  'Harbourline Logistics',     'Hong Kong',      'APAC',     'Unilever',  'Logistics',   98000, 'standard',   false),
  (5,  'Saigon Craft Displays',     'Vietnam',        'APAC',     'Heineken',  'POSM',        76000, 'fast_track', false),
  (6,  'Mekong Board Products',     'Vietnam',        'APAC',     'Unilever',  'Packaging',   43000, 'standard',   false),
  (7,  'Bangkok Signage Studio',    'Thailand',       'APAC',     'Heineken',  'Signage',    121000, 'fast_track', false),
  (8,  'Klang Valley Fixtures',     'Malaysia',       'APAC',     'Unilever',  'Fixtures',   188000, 'standard',   true),
  (9,  'Manila Bay Printworks',     'Philippines',    'APAC',     'Unilever',  'Print',       35000, 'fast_track', false),
  (10, 'Garuda Merchandising',      'Indonesia',      'APAC',     'Heineken',  'Premiums',    22000, 'standard',   false),
  (11, 'Southern Cross Shopfit',    'Australia',      'APAC',     'Coloplast', 'Fixtures',    64000, 'standard',   false),
  (12, 'Pune Metal Displays',       'India',          'APAC',     'Unilever',  'Fixtures',   143000, 'fast_track', false),
  (13, 'Thameside Litho',           'United Kingdom', 'EMEA',     'BAU',       'Print',      231000, 'standard',   true),
  (14, 'Midlands Point-of-Sale',    'United Kingdom', 'EMEA',     'Coloplast', 'POSM',        87000, 'standard',   false),
  (15, 'Rhine Valley Kartonagen',   'Germany',        'EMEA',     'Heineken',  'Packaging',  176000, 'standard',   false),
  (16, 'Hanseatic Displays',        'Germany',        'EMEA',     'Unilever',  'POSM',        54000, 'standard',   false),
  (17, 'Lyon Atelier Vitrine',      'France',         'EMEA',     'BAU',       'Fixtures',    29000, 'standard',   false),
  (18, 'Tagus Print & Pack',        'Portugal',       'EMEA',     'Unilever',  'Print',       91000, 'fast_track', false),
  (19, 'Vistula Woodcraft',         'Poland',         'EMEA',     'Heineken',  'Fixtures',   112000, 'standard',   false),
  (20, 'Danube Plastics',           'Slovakia',       'EMEA',     'BAU',       'Components',  47000, 'standard',   false),
  (21, 'Bosphorus Signage',         'Turkey',         'EMEA',     'Heineken',  'Signage',         0, 'standard',   false),
  (22, 'Nordic Fibre Board',        'Sweden',         'EMEA',     'Coloplast', 'Packaging',   38000, 'standard',   false),
  (23, 'Lakeshore Fixtures Inc',    'United States',  'Americas', 'BAU',       'Fixtures',   204000, 'standard',   false),
  (24, 'Prairie Print Group',       'United States',  'Americas', 'Unilever',  'Print',       69000, 'standard',   false),
  (25, 'Sierra Display Co',         'Mexico',         'Americas', 'Heineken',  'POSM',        58000, 'fast_track', false),
  (26, 'Andes Packaging SA',        'Colombia',       'Americas', 'Unilever',  'Packaging',   17000, 'standard',   false),
  (27, 'Rio Merch Solutions',       'Brazil',         'Americas', 'BAU',       'Premiums',        0, 'standard',   false),
  (28, 'Maple Leaf Shopfitters',    'Canada',         'Americas', 'Coloplast', 'Fixtures',    41000, 'standard',   false),
  (29, 'Global Freight Partners',   'Singapore',      'GSC',      'BAU',       'Logistics',  322000, 'standard',   true),
  (30, 'Straits Component Supply',  'Singapore',      'GSC',      'Unilever',  'Components',  83000, 'standard',   false)
)
insert into public.suppliers (supplier_code, name, market, region, client, category, ytd_spend, onboarding_route, strategic,
                              primary_contact_email, active, notes)
select 'DEMO-' || lpad(n::text, 3, '0'), name, market, region, client, category, spend, route, strategic,
       'vendor' || n || '@example.com', spend > 0 or n % 2 = 0,
       'Dummy supplier for testing'
  from names;

-- Give each demo supplier a different mix of gate statuses.
-- Profiles: 0 = fully compliant, 1 = nearly there, 2 = missing contract docs,
--           3 = early stage, 4 = fast-track gaps, 5 = mixed with an expiring cert.
update public.supplier_gates g
   set status = case
         when p.profile = 0 then 'verified'
         when p.profile = 1 then case when g.gate_key in ('setup', 'environment') then 'received' else 'verified' end
         when p.profile = 2 then case when g.gate_key in ('msa', 'coc') then 'missing'
                                      when g.gate_key = 'nda' then 'requested' else 'verified' end
         when p.profile = 3 then case when g.gate_key in ('request', 'rfi') then 'verified'
                                      when g.gate_key in ('registration', 'financial') then 'received'
                                      when g.gate_key = 'bank' then 'requested' else 'missing' end
         when p.profile = 4 then case when g.gate_key in ('request', 'registration', 'bank', 'setup') then 'verified'
                                      when g.gate_key in ('capability', 'sustainability', 'msa') then 'missing'
                                      when g.gate_key = 'coc' then 'requested' else 'received' end
         else case when g.gate_key in ('sustainability', 'quality') then 'verified'
                   when g.gate_key in ('capability', 'approval') then 'requested'
                   when g.gate_key = 'environment' then 'not_required' else 'verified' end
       end,
       expiry_date = case
         when g.gate_key = 'financial'       then current_date + 300
         when g.gate_key = 'quality'         then current_date + (case when p.profile = 5 then 12 else 240 end)
         when g.gate_key = 'environment'     then current_date + 400
         when g.gate_key = 'sustainability'  then current_date + (case when p.profile = 1 then 25 else 180 end)
       end,
       note = 'Dummy data',
       updated_at = now()
  from (
    select s.id,
           case when s.onboarding_route = 'fast_track' then (array[4, 2, 3, 4])[1 + (row_number() over (order by s.supplier_code))::int % 4]
                else (array[0, 1, 5, 0, 2, 3])[1 + (row_number() over (order by s.supplier_code))::int % 6] end as profile
      from public.suppliers s where s.supplier_code like 'DEMO-%'
  ) p
 where g.supplier_id = p.id;

-- Expiry dates only belong on gates that take them.
update public.supplier_gates g set expiry_date = null
  from public.gate_definitions d
 where d.key = g.gate_key and not d.has_expiry and g.note = 'Dummy data';

-- One supplier with an already expired sustainability certificate.
update public.supplier_gates set expiry_date = current_date - 5
 where gate_key = 'sustainability'
   and supplier_id = (select id from public.suppliers where supplier_code = 'DEMO-013');

-- A spread of tickets in different states.
insert into public.srt_tickets (type, title, description, supplier_id, gate_key, priority, status, due_date, source, source_ref, client, market)
select t.type, t.title || ': ' || s.name, t.description, s.id, t.gate_key, t.priority, t.status,
       current_date + t.due_in, 'manual', 'demo', s.client, s.market
  from (values
    ('DEMO-001', 'remediation',          'MSA signature outstanding',            'Vendor says signed copy is with their legal team.', 'msa',            'high',   'waiting_vendor',  3),
    ('DEMO-001', 'remediation',          'Capability assessment not completed', null,                                                 'capability',     'high',   'in_progress',     5),
    ('DEMO-002', 'missing_document',     'Code of Conduct not returned',        null,                                                 'coc',            'normal', 'triage',          4),
    ('DEMO-003', 'remediation',          'Sedex membership not evidenced',      'Fast-tracked UL incumbent.',                         'sustainability', 'normal', 'new',             8),
    ('DEMO-005', 'document_verification','Check uploaded ISO 9001 certificate', null,                                                 'quality',        'normal', 'new',             2),
    ('DEMO-007', 'bank_change',          'Bank details changed by vendor',      'New account in Bangkok; needs callback verification.', 'bank',          'urgent', 'waiting_finance', 1),
    ('DEMO-009', 'missing_document',     'Company registration documents',      null,                                                 'registration',   'normal', 'waiting_vendor', -2),
    ('DEMO-012', 'remediation',          'MSA not signed',                      null,                                                 'msa',            'high',   'in_progress',    -1),
    ('DEMO-013', 'certificate_renewal',  'Sustainability certificate expired',  'SMETA audit due for renewal.',                       'sustainability', 'high',   'triage',          0),
    ('DEMO-015', 'query',                'Clarify plant list for second site',   null,                                                 null,             'low',    'new',             2),
    ('DEMO-018', 'remediation',          'Financial check outstanding',          null,                                                 'financial',      'normal', 'in_progress',     6),
    ('DEMO-021', 'deactivation',         'No spend in 12 months: confirm need',  null,                                                 null,             'low',    'new',             5),
    ('DEMO-025', 'remediation',          'Capability assessment',                null,                                                 'capability',     'normal', 'resolved',       -4)
  ) as t(code, type, title, description, gate_key, priority, status, due_in)
  join public.suppliers s on s.supplier_code = t.code;

-- A new-vendor request that isn't a supplier yet.
insert into public.srt_tickets (type, title, prospect_name, client, market, priority, status, source, source_ref)
values ('new_onboarding', 'New supplier request: Coastal Foam Inserts', 'Coastal Foam Inserts', 'Unilever', 'Vietnam', 'normal', 'new', 'manual', 'demo');
