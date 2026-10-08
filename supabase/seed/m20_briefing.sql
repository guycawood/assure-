-- DUMMY DATA for Briefing+: campaigns, briefs in every state, approval and revision history. Everything here is made up.
-- Watchtower library records (substrates, brief_fields, touchpoint_types, p2p_stages) are seeded by m10_watchtower.sql.
-- The BRF-* fallback below only runs when that library is empty, so the demo still has materials without m10.

delete from public.briefs where brief_code between 'BR-2026-00001' and 'BR-2026-00099';
delete from public.campaigns where campaign_code between 'CMP-2026-00001' and 'CMP-2026-00099';

insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'substrates', x.code, x.name, x.data::jsonb, 'active', '2026-01-01'::date
from (values
  ('BRF-FBB-350', 'Folding box board 350gsm (recycled)', '{"substrate_type":"board","measurement_basis":"grammage","grammage_gsm":350,"recycled_content_percent":90,"fsc_certified":true,"verification_status":"indicative"}'),
  ('BRF-CORR-EB', 'Corrugated board E/B flute (kraft)', '{"substrate_type":"corrugated","measurement_basis":"grammage","grammage_gsm":680,"recycled_content_percent":85,"fsc_certified":true,"verification_status":"indicative"}'),
  ('BRF-SBS-300', 'Solid bleached board 300gsm', '{"substrate_type":"board","measurement_basis":"grammage","grammage_gsm":300,"recycled_content_percent":0,"fsc_certified":true,"verification_status":"indicative"}'),
  ('BRF-PVC-FOAM', 'Foamed PVC board 5mm', '{"substrate_type":"plastic","measurement_basis":"thickness_density","thickness_mm":5,"density_kg_per_m3":550,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"indicative"}'),
  ('BRF-ACRY-3', 'Acrylic sheet 3mm', '{"substrate_type":"plastic","measurement_basis":"thickness_density","thickness_mm":3,"density_kg_per_m3":1190,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"indicative"}'),
  ('BRF-PAPER-170', 'Uncoated recycled paper 170gsm', '{"substrate_type":"paper","measurement_basis":"grammage","grammage_gsm":170,"recycled_content_percent":100,"fsc_certified":true,"verification_status":"indicative"}')
) x(code, name, data)
where not exists (select 1 from public.library_records where library_key = 'substrates' and status = 'active');

insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'brief_fields', x.code, x.name, x.data::jsonb, 'active', '2026-01-01'::date
from (values
  ('BF-OBJECTIVE', 'Objective', '{"drives":["quality"],"required":true}'),
  ('BF-BUDGET', 'Budget range', '{"drives":["price"],"required":false}'),
  ('BF-SUSTAIN', 'Sustainability targets', '{"drives":["compliance","quality"],"required":false}')
) x(code, name, data)
where not exists (select 1 from public.library_records where library_key = 'brief_fields');
-- ---------------------------------------------------------------------------
-- Campaigns (central) and their markets
-- ---------------------------------------------------------------------------
insert into public.campaigns (campaign_code, name, client, brands, division, brand_tier, objective, campaign_type, activation_objective,
  channels, store_types, p2p_stages, start_date, end_date, status, created_at) values
  ('CMP-2026-00001', 'Summer of Football', 'Heineken', '{Heineken,"Heineken 0.0"}', 'Beer', 'Premium',
   'Drive trial of Heineken 0.0 and lift summer volume around the tournament.', 'seasonal', 'trial',
   '{Off-trade,On-trade}', '{Hypermarket,Supermarket,Convenience}', '{Connect,Engage,Sell}', '2026-05-15', '2026-07-31', 'live', now() - interval '60 days'),
  ('CMP-2026-00002', 'Dove Real Care always-on', 'Unilever', '{Dove}', 'Personal care', 'Core',
   'Keep Dove top of mind at shelf and grow loyalty with repeat buyers.', 'always_on', 'loyalty',
   '{Off-trade,E-commerce}', '{Supermarket,Drugstore}', '{Engage,Sell}', '2026-01-01', '2026-12-31', 'live', now() - interval '120 days'),
  ('CMP-2026-00003', 'Magnum Pleasure Store', 'Unilever', '{Magnum}', 'Ice cream', 'Premium',
   'Trade shoppers up to Magnum multipacks in impulse and take-home freezers.', 'seasonal', 'trade_up',
   '{Off-trade,Impulse}', '{Supermarket,Convenience,Petrol}', '{Connect,Sell}', '2026-04-01', '2026-09-30', 'live', now() - interval '90 days'),
  ('CMP-2026-00004', 'Amstel Christmas Gifting', 'Heineken', '{Amstel}', 'Beer', 'Core',
   'Lift basket value with gift packs over the Christmas trading weeks.', 'tactical', 'basket_value',
   '{Off-trade}', '{Hypermarket,Supermarket}', '{Engage,Sell}', '2026-11-15', '2026-12-31', 'planning', now() - interval '20 days');
select setval('public.campaign_no', greatest(100, (select last_value from public.campaign_no)));

insert into public.campaign_markets (campaign_id, region, market)
select c.id, m.region, m.market from public.campaigns c
join (values
  ('CMP-2026-00001', 'EMEA', 'GB'), ('CMP-2026-00001', 'EMEA', 'IT'), ('CMP-2026-00001', 'EMEA', 'NL'),
  ('CMP-2026-00002', 'EMEA', 'GB'), ('CMP-2026-00002', 'EMEA', 'DE'), ('CMP-2026-00002', 'EMEA', 'FR'), ('CMP-2026-00002', 'Americas', 'US'),
  ('CMP-2026-00003', 'EMEA', 'IT'), ('CMP-2026-00003', 'EMEA', 'ES'), ('CMP-2026-00003', 'APAC', 'SG'),
  ('CMP-2026-00004', 'EMEA', 'NL'), ('CMP-2026-00004', 'EMEA', 'DE')
) m(code, region, market) on m.code = c.campaign_code;

-- ---------------------------------------------------------------------------
-- Briefs (one per market) in every state
-- ---------------------------------------------------------------------------
insert into public.briefs (brief_code, campaign_id, region, market, client, brand, division, title, objective, brief_text, target_outlets,
  budget_low, budget_high, currency, target_launch, product_category, sustainability_targets, min_recycled_pct, require_fsc,
  status, approval_status, revision_count, submitted_at, reviewed_at, approval_comments, created_at)
select b.code, c.id, b.region, b.market, b.client, b.brand, b.division, b.title, b.objective, b.brief_text, b.outlets,
  b.lo, b.hi, b.cur, b.launch::date, b.cat, b.sust, b.rec, b.fsc, b.status, b.appr, b.revs,
  case when b.sub_days is null then null else now() - make_interval(days => b.sub_days) end,
  case when b.rev_days is null then null else now() - make_interval(days => b.rev_days) end,
  b.comments, now() - make_interval(days => b.created_days)
from (values
  ('BR-2026-00001', 'CMP-2026-00001', 'EMEA', 'GB', 'Heineken', 'Heineken 0.0', 'Beer', 'Gondola end for Heineken 0.0 football trial',
   'Drive trial of Heineken 0.0 in the top 50 GB stores during the tournament.',
   'We need a gondola-end display that holds 4-packs and 10-packs of Heineken 0.0, carries the tournament creative and a QR code to the match-day promotion. It has to be quick to build in store (under 10 minutes, no tools) and survive six weeks. Retailers want it shelf-ready where possible.',
   'Top 50 GB stores (Tesco Extra, Sainsbury''s superstores, Asda)', 18000, 26000, 'GBP', '2026-11-20', 'Display',
   'At least 80% recycled content, fully recyclable at end of life, no PVC.', 80, true, 'in_ideation', 'approved', 1, 34, 31, 'Clear and well scoped. Go ahead.', 40),
  ('BR-2026-00002', 'CMP-2026-00001', 'EMEA', 'IT', 'Heineken', 'Heineken', 'Beer', 'Fridge and chiller branding for on-trade Italy',
   'Build visibility for Heineken in bars and cafes showing the matches.',
   'Chiller branding kits (door wrap, header, wobblers) for 300 bars across Milan, Rome and Naples, installed by our field team. Needs to look premium and be removable without residue.',
   '300 on-trade outlets in Milan, Rome and Naples', 22000, 30000, 'EUR', '2026-12-01', 'Fridge branding',
   'Prefer recyclable films; avoid PVC.', 50, false, 'submitted', 'pending', 0, 2, null, null, 6),
  ('BR-2026-00003', 'CMP-2026-00002', 'EMEA', 'GB', 'Unilever', 'Dove', 'Personal care', 'Dove shelf talkers for drugstores',
   'Highlight the new Dove Real Care range at shelf.',
   'Shelf talkers and a small header for the Real Care range in Boots and Superdrug. Draft: waiting on final range list.',
   'Boots and Superdrug, 800 stores', 6000, 9000, 'GBP', '2027-01-15', 'Shelf talker', null, null, false, 'draft', null, 0, null, null, null, 3),
  ('BR-2026-00004', 'CMP-2026-00002', 'EMEA', 'DE', 'Unilever', 'Dove', 'Personal care', 'Dove Real Care floor-standing unit Germany',
   'Win secondary placement for the Real Care range in dm and Rossmann.',
   'A floor-standing unit holding 4 SKUs x 24 facings with a header and side panels. Must ship flat and pass dm''s cardboard-first rule.',
   'dm and Rossmann, 400 stores', 15000, 21000, 'EUR', '2027-02-01', 'Floor-standing unit',
   'Cardboard first; FSC certified board; recyclable.', 70, true, 'submitted', 'pending', 0, 1, null, null, 4),
  ('BR-2026-00005', 'CMP-2026-00003', 'EMEA', 'IT', 'Unilever', 'Magnum', 'Ice cream', 'Magnum freezer topper and dumpbin wrap Italy',
   'Trade shoppers up to Magnum multipacks in take-home freezers.',
   'Freezer toppers and dumpbin wraps for 1,200 supermarkets. Needs to cope with condensation and cold. Gold finish is part of the brand look.',
   '1,200 supermarkets (Coop, Esselunga, Conad)', 30000, 45000, 'EUR', '2026-12-10', 'Dumpbin',
   'Reduce plastic versus last year by 30%.', 40, false, 'in_ideation', 'approved', 0, 20, 18, null, 25),
  ('BR-2026-00006', 'CMP-2026-00003', 'APAC', 'SG', 'Unilever', 'Magnum', 'Ice cream', 'Magnum impulse cabinet branding Singapore',
   'Grow impulse sales in convenience and petrol.',
   'Cabinet branding for 7-Eleven and petrol forecourts.',
   '7-Eleven and Shell Select, 450 stores', 12000, 16000, 'SGD', '2027-01-05', 'Display', null, null, false, 'draft', 'changes_requested', 0, 9, 7,
   'Please add the store count per banner and the install window. The budget looks low for 450 cabinets.', 10),
  ('BR-2026-00007', 'CMP-2026-00004', 'EMEA', 'NL', 'Heineken', 'Amstel', 'Beer', 'Amstel gift pack sleeve',
   'Christmas gift pack.', 'Gift sleeve for a 6-pack plus glass. Replaced by the central gifting brief.', 'Albert Heijn, Jumbo', 8000, 12000, 'EUR',
   '2026-11-25', 'Gift with purchase', null, null, false, 'archived', null, 0, null, null, null, 15),
  ('BR-2026-00008', 'CMP-2026-00001', 'EMEA', 'NL', 'Heineken', 'Heineken', 'Beer', 'Pallet wrap and header for Dutch hypermarkets',
   'Make the tournament pallet drop unmissable in Dutch hypermarkets.',
   'Full pallet wraps plus a header board for 120 hypermarkets, one-week life, recycled board preferred.',
   'Albert Heijn XL and Jumbo Foodmarkt, 120 stores', 9000, 14000, 'EUR', '2026-11-28', 'Header board',
   'Recycled board only.', 90, true, 'in_ideation', 'approved', 0, 12, 11, 'Approved.', 14)
) b(code, campaign, region, market, client, brand, division, title, objective, brief_text, outlets, lo, hi, cur, launch, cat, sust, rec, fsc,
    status, appr, revs, sub_days, rev_days, comments, created_days)
join public.campaigns c on c.campaign_code = b.campaign;
select setval('public.brief_no', greatest(100, (select last_value from public.brief_no)));

-- Approval history (append-only)
insert into public.brief_approvals (brief_id, decision, comments, decided_at)
select b.id, a.decision, a.comments, now() - make_interval(days => a.days)
from (values
  ('BR-2026-00001', 'approved', 'Clear and well scoped. Go ahead.', 31),
  ('BR-2026-00005', 'approved', null, 18),
  ('BR-2026-00006', 'changes_requested', 'Please add the store count per banner and the install window. The budget looks low for 450 cabinets.', 7),
  ('BR-2026-00008', 'approved', 'Approved.', 11)
) a(code, decision, comments, days)
join public.briefs b on b.brief_code = a.code;

-- One revision made after submission (append-only, with the previous version)
insert into public.brief_revisions (brief_id, version, changes, previous_version, revised_at)
select b.id, 1,
  '[{"field":"Budget to","before":"22000","after":"26000"},{"field":"Sustainability targets","before":"Recyclable where possible.","after":"At least 80% recycled content, fully recyclable at end of life, no PVC."}]'::jsonb,
  '[{"field":"Campaign","value":"Summer of Football"},{"field":"Region","value":"EMEA"},{"field":"Market","value":"GB"},{"field":"Client","value":"Heineken"},{"field":"Brand","value":"Heineken 0.0"},{"field":"Title","value":"Gondola end for Heineken 0.0 football trial"},{"field":"Budget from","value":"18000"},{"field":"Budget to","value":"22000"},{"field":"Currency","value":"GBP"},{"field":"Sustainability targets","value":"Recyclable where possible."}]'::jsonb,
  now() - interval '33 days'
from public.briefs b where b.brief_code = 'BR-2026-00001';

-- Lifecycle events
insert into public.brief_events (brief_id, event, from_status, to_status, note, at)
select b.id, e.event, e.f, e.t, e.note, now() - make_interval(days => e.days)
from (values
  ('BR-2026-00001', 'created', null, 'draft', null, 40), ('BR-2026-00001', 'submitted', 'draft', 'submitted', null, 34),
  ('BR-2026-00001', 'revised', 'submitted', 'submitted', 'v1', 33), ('BR-2026-00001', 'approved', 'submitted', 'in_ideation', 'Clear and well scoped. Go ahead.', 31),
  ('BR-2026-00002', 'created', null, 'draft', null, 6), ('BR-2026-00002', 'submitted', 'draft', 'submitted', null, 2),
  ('BR-2026-00003', 'created', null, 'draft', null, 3),
  ('BR-2026-00004', 'created', null, 'draft', null, 4), ('BR-2026-00004', 'submitted', 'draft', 'submitted', null, 1),
  ('BR-2026-00005', 'created', null, 'draft', null, 25), ('BR-2026-00005', 'submitted', 'draft', 'submitted', null, 20),
  ('BR-2026-00005', 'approved', 'submitted', 'in_ideation', null, 18),
  ('BR-2026-00006', 'created', null, 'draft', null, 10), ('BR-2026-00006', 'submitted', 'draft', 'submitted', null, 9),
  ('BR-2026-00006', 'changes_requested', 'submitted', 'draft', 'Please add the store count per banner and the install window.', 7),
  ('BR-2026-00007', 'created', null, 'draft', null, 15), ('BR-2026-00007', 'archived', 'draft', 'archived', 'Replaced by the central gifting brief.', 12),
  ('BR-2026-00008', 'created', null, 'draft', null, 14), ('BR-2026-00008', 'submitted', 'draft', 'submitted', null, 12),
  ('BR-2026-00008', 'approved', 'submitted', 'in_ideation', 'Approved.', 11)
) e(code, event, f, t, note, days)
join public.briefs b on b.brief_code = e.code;

-- ---------------------------------------------------------------------------
-- Demo people. Demo users are created after the seed (src/lib/demo/db.ts), so authorship is claimed by email
-- when each profile appears. Demo-only: this table and trigger exist only in the seeded demo database.
-- ---------------------------------------------------------------------------
create table if not exists public._demo_briefing_people (code text primary key, author_email text, reviewer_email text);
alter table public._demo_briefing_people enable row level security;
revoke all on public._demo_briefing_people from authenticated, anon;
insert into public._demo_briefing_people values
  ('CMP-2026-00001', 'pedro.procurement@adm-indicia.com', null), ('CMP-2026-00002', 'lena.lead@adm-indicia.com', null),
  ('CMP-2026-00003', 'lena.lead@adm-indicia.com', null), ('CMP-2026-00004', 'pedro.procurement@adm-indicia.com', null),
  ('BR-2026-00001', 'pedro.procurement@adm-indicia.com', 'hana.head@adm-indicia.com'),
  ('BR-2026-00002', 'pedro.procurement@adm-indicia.com', null),
  ('BR-2026-00003', 'arjun.agent@adm-indicia.com', null),
  ('BR-2026-00004', 'lena.lead@adm-indicia.com', null),
  ('BR-2026-00005', 'lena.lead@adm-indicia.com', 'ada.admin@adm-indicia.com'),
  ('BR-2026-00006', 'pedro.procurement@adm-indicia.com', 'hana.head@adm-indicia.com'),
  ('BR-2026-00007', 'pedro.procurement@adm-indicia.com', null),
  ('BR-2026-00008', 'arjun.agent@adm-indicia.com', 'lena.lead@adm-indicia.com')
on conflict (code) do nothing;

create or replace function public._demo_briefing_claim() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text := lower(new.email);
begin
  update public.campaigns c set created_by = new.id from public._demo_briefing_people p where p.code = c.campaign_code and lower(p.author_email) = e;
  update public.briefs b set created_by = new.id from public._demo_briefing_people p where p.code = b.brief_code and lower(p.author_email) = e;
  update public.briefs b set reviewed_by = new.id from public._demo_briefing_people p where p.code = b.brief_code and lower(p.reviewer_email) = e;
  update public.brief_approvals a set decided_by = new.id from public.briefs b, public._demo_briefing_people p
    where a.brief_id = b.id and p.code = b.brief_code and lower(p.reviewer_email) = e;
  update public.brief_revisions r set revised_by = new.id from public.briefs b, public._demo_briefing_people p
    where r.brief_id = b.id and p.code = b.brief_code and lower(p.author_email) = e;
  update public.brief_events v set actor = new.id from public.briefs b, public._demo_briefing_people p
    where v.brief_id = b.id and p.code = b.brief_code
      and ((lower(p.author_email) = e and v.event in ('created','submitted','revised','archived'))
        or (lower(p.reviewer_email) = e and v.event in ('approved','changes_requested')));
  return new;
end $$;
drop trigger if exists demo_briefing_claim on public.profiles;
create trigger demo_briefing_claim after insert on public.profiles for each row execute function public._demo_briefing_claim();
