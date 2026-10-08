-- DUMMY DATA for Shopper IQ: taxonomy value sets (Watchtower libraries), campaign effectiveness and the asset library.
-- Figures are invented for the demo. Uplift is only filled in where a source is named.

-- touchpoint_types and p2p_stages are seeded by m10_watchtower.sql; each record below is only added if its code is missing
-- (the extras TP-CHILLER and TP-SAMPLING, or everything when m10 is not present).
insert into public.library_records (library_key, code, name, data, status, effective_from)
select x.library_key, x.code, x.name, x.data::jsonb, x.status, x.effective_from::date from (values
  ('touchpoint_types', 'TP-DISPLAY', 'Display', '{"permanence":"temporary","typical_spec_type":"3d","job_to_be_done":"Disrupt"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-DUMPBIN', 'Dumpbin', '{"permanence":"temporary","typical_spec_type":"3d","job_to_be_done":"Communicate offer"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-FSU', 'Floor-standing unit', '{"permanence":"temporary","typical_spec_type":"3d","job_to_be_done":"Disrupt"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-GWP', 'Gift with purchase', '{"permanence":"temporary","typical_spec_type":"promo_merch","job_to_be_done":"Communicate offer"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-HANGSELL', 'Hang-sell', '{"permanence":"temporary","typical_spec_type":"2d","job_to_be_done":"Communicate benefit"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-HEADER', 'Header board', '{"permanence":"temporary","typical_spec_type":"2d","job_to_be_done":"Navigate"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-POSTER', 'Poster', '{"permanence":"temporary","typical_spec_type":"2d","job_to_be_done":"Inspire"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-SHELF', 'Shelf talker', '{"permanence":"temporary","typical_spec_type":"2d","job_to_be_done":"Educate"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-CHILLER', 'Fridge and chiller branding', '{"permanence":"permanent","typical_spec_type":"2d","job_to_be_done":"Navigate"}', 'active', '2026-01-01'),
  ('touchpoint_types', 'TP-SAMPLING', 'Sampling unit', '{"permanence":"temporary","typical_spec_type":"3d","job_to_be_done":"Educate"}', 'active', '2026-01-01'),
  ('p2p_stages', 'P2P-CONNECT', 'Connect', '{"sequence":1,"framework":"Connect / Engage / Sell","alias":"Connect"}', 'active', '2026-01-01'),
  ('p2p_stages', 'P2P-ENGAGE', 'Engage', '{"sequence":2,"framework":"Connect / Engage / Sell","alias":"Guide"}', 'active', '2026-01-01'),
  ('p2p_stages', 'P2P-SELL', 'Sell', '{"sequence":3,"framework":"Connect / Engage / Sell","alias":"Convert"}', 'active', '2026-01-01')
) x(library_key, code, name, data, status, effective_from)
where not exists (select 1 from public.library_records r where r.library_key = x.library_key and r.code = x.code);

delete from public.siq_effectiveness where campaign_id in (select id from public.campaigns where campaign_code between 'CMP-2026-00001' and 'CMP-2026-00099');
delete from public.siq_assets where asset_code between 'AS-2026-00001' and 'AS-2026-00099';

insert into public.siq_effectiveness (campaign_id, region, market, touchpoint_id, p2p_stage_id, channel, period_start, period_end,
  spend, currency, units, execution_score, uplift_pct, uplift_source, notes)
select c.id, e.region, e.market, tp.id, st.id, e.channel, e.ps::date, e.pe::date, e.spend, e.cur, e.units, e.score, e.uplift, e.src, e.notes
from (values
  ('CMP-2026-00001', 'EMEA', 'GB', 'TP-DISPLAY', 'P2P-SELL', 'Off-trade', '2026-05-15', '2026-07-31', 42000, 'EUR', 50, 86, 12.5, 'retailer_data', 'Gondola ends in top 50 stores'),
  ('CMP-2026-00001', 'EMEA', 'GB', 'TP-SHELF', 'P2P-ENGAGE', 'Off-trade', '2026-05-15', '2026-07-31', 6500, 'EUR', 1200, 64, null, 'not_measured', null),
  ('CMP-2026-00001', 'EMEA', 'GB', 'TP-POSTER', 'P2P-CONNECT', 'On-trade', '2026-05-15', '2026-07-31', 9800, 'EUR', 600, 71, null, 'not_measured', null),
  ('CMP-2026-00001', 'EMEA', 'IT', 'TP-CHILLER', 'P2P-CONNECT', 'On-trade', '2026-05-20', '2026-07-31', 31000, 'EUR', 300, 79, 6.0, 'client_reported', 'Chiller wraps in bars'),
  ('CMP-2026-00001', 'EMEA', 'IT', 'TP-DISPLAY', 'P2P-SELL', 'Off-trade', '2026-05-20', '2026-07-31', 27000, 'EUR', 40, 58, 3.1, 'client_reported', 'Late install in 40% of stores'),
  ('CMP-2026-00001', 'EMEA', 'NL', 'TP-HEADER', 'P2P-ENGAGE', 'Off-trade', '2026-06-01', '2026-07-31', 8200, 'EUR', 120, 82, null, 'not_measured', null),
  ('CMP-2026-00001', 'EMEA', 'NL', 'TP-SAMPLING', 'P2P-ENGAGE', 'Off-trade', '2026-06-01', '2026-07-15', 15500, 'EUR', 30, 88, 18.0, 'retailer_data', 'Heineken 0.0 sampling'),
  ('CMP-2026-00002', 'EMEA', 'GB', 'TP-SHELF', 'P2P-ENGAGE', 'Off-trade', '2026-01-10', '2026-06-30', 11000, 'EUR', 3200, 74, 2.4, 'panel_data', null),
  ('CMP-2026-00002', 'EMEA', 'GB', 'TP-FSU', 'P2P-SELL', 'Off-trade', '2026-03-01', '2026-04-30', 24000, 'EUR', 300, 81, 7.9, 'retailer_data', 'Boots secondary placement'),
  ('CMP-2026-00002', 'EMEA', 'DE', 'TP-FSU', 'P2P-SELL', 'Off-trade', '2026-03-01', '2026-04-30', 19500, 'EUR', 250, 77, 5.2, 'client_reported', null),
  ('CMP-2026-00002', 'EMEA', 'DE', 'TP-HANGSELL', 'P2P-ENGAGE', 'Off-trade', '2026-02-01', '2026-05-31', 4800, 'EUR', 2000, 52, null, 'not_measured', 'Hang-sells often missing at audit'),
  ('CMP-2026-00002', 'EMEA', 'FR', 'TP-SHELF', 'P2P-ENGAGE', 'Off-trade', '2026-01-10', '2026-06-30', 7200, 'EUR', 1800, 69, null, 'not_measured', null),
  ('CMP-2026-00002', 'Americas', 'US', 'TP-DISPLAY', 'P2P-SELL', 'Off-trade', '2026-04-01', '2026-05-31', 38000, 'EUR', 150, 72, 4.4, 'retailer_data', null),
  ('CMP-2026-00002', 'Americas', 'US', 'TP-POSTER', 'P2P-CONNECT', 'E-commerce', '2026-04-01', '2026-05-31', 5200, 'EUR', null, 60, null, 'not_measured', 'Retail media tiles'),
  ('CMP-2026-00003', 'EMEA', 'IT', 'TP-DUMPBIN', 'P2P-SELL', 'Off-trade', '2026-04-15', '2026-08-31', 36000, 'EUR', 1200, 83, 9.6, 'retailer_data', 'Dumpbin wraps'),
  ('CMP-2026-00003', 'EMEA', 'IT', 'TP-HEADER', 'P2P-CONNECT', 'Impulse', '2026-04-15', '2026-08-31', 12500, 'EUR', 900, 66, null, 'not_measured', null),
  ('CMP-2026-00003', 'EMEA', 'ES', 'TP-DUMPBIN', 'P2P-SELL', 'Off-trade', '2026-05-01', '2026-08-31', 29000, 'EUR', 800, 76, 7.1, 'client_reported', null),
  ('CMP-2026-00003', 'EMEA', 'ES', 'TP-GWP', 'P2P-SELL', 'Off-trade', '2026-06-01', '2026-07-31', 21000, 'EUR', 15000, 61, 3.8, 'client_reported', 'Branded spoon with multipack'),
  ('CMP-2026-00003', 'APAC', 'SG', 'TP-CHILLER', 'P2P-CONNECT', 'Impulse', '2026-04-01', '2026-09-30', 14500, 'EUR', 450, 70, null, 'not_measured', null),
  ('CMP-2026-00003', 'APAC', 'SG', 'TP-POSTER', 'P2P-CONNECT', 'Impulse', '2026-04-01', '2026-09-30', 3900, 'EUR', 450, 55, null, 'not_measured', null)
) e(code, region, market, tp, st, channel, ps, pe, spend, cur, units, score, uplift, src, notes)
join public.campaigns c on c.campaign_code = e.code
join public.library_records tp on tp.library_key = 'touchpoint_types' and tp.code = e.tp and tp.status = 'active'
left join public.library_records st on st.library_key = 'p2p_stages' and st.code = e.st and st.status = 'active';

insert into public.siq_assets (asset_code, title, asset_type, campaign_id, brief_id, region, market, brand, touchpoint_id, p2p_stage_id,
  file_name, file_url, metadata, metadata_source)
select a.code, a.title, a.type, c.id, b.id, a.region, a.market, a.brand, tp.id, st.id, a.file, null, a.meta::jsonb, a.src
from (values
  ('AS-2026-00001', 'Heineken 0.0 gondola end, Tesco Extra Watford', 'executional_image', 'CMP-2026-00001', 'BR-2026-00001', 'EMEA', 'GB', 'Heineken 0.0', 'TP-DISPLAY', 'P2P-SELL', 'HNK0-GB-gondola-watford.jpg', '{"headline":"Zero alcohol. Full football.","theme":"Tournament","format":"Gondola end","visual_elements":["QR code","Tournament ball","Green brand block"]}', 'job'),
  ('AS-2026-00002', 'Heineken 0.0 gondola end, 3D render', 'render_3d', 'CMP-2026-00001', 'BR-2026-00001', 'EMEA', 'GB', 'Heineken 0.0', 'TP-DISPLAY', 'P2P-SELL', 'HNK0-GB-gondola-render.png', '{"headline":"Zero alcohol. Full football.","format":"Gondola end","visual_elements":["Header","Shelf strips"]}', 'job'),
  ('AS-2026-00003', 'Chiller wrap artwork, Italy on-trade', 'production_art', 'CMP-2026-00001', 'BR-2026-00002', 'EMEA', 'IT', 'Heineken', 'TP-CHILLER', 'P2P-CONNECT', 'HNK-IT-chiller-wrap-v3.pdf', '{"headline":"La partita si gioca fresca","theme":"Tournament","format":"Door wrap"}', 'job'),
  ('AS-2026-00004', 'Sampling stand, Jumbo Foodmarkt Amsterdam', 'executional_image', 'CMP-2026-00001', null, 'EMEA', 'NL', 'Heineken 0.0', 'TP-SAMPLING', 'P2P-ENGAGE', 'HNK0-NL-sampling-ams.jpg', '{"theme":"Tournament","format":"Sampling stand","visual_elements":["Promoter","Cooler"]}', 'ai_extracted'),
  ('AS-2026-00005', 'Dove Real Care FSU, Boots Oxford Street', 'executional_image', 'CMP-2026-00002', null, 'EMEA', 'GB', 'Dove', 'TP-FSU', 'P2P-SELL', 'DOVE-GB-fsu-boots.jpg', '{"headline":"Real care for real skin","format":"Floor-standing unit","visual_elements":["Model portrait","Range block"]}', 'ai_extracted'),
  ('AS-2026-00006', 'Dove shelf talker artwork', 'production_art', 'CMP-2026-00002', 'BR-2026-00003', 'EMEA', 'GB', 'Dove', 'TP-SHELF', 'P2P-ENGAGE', 'DOVE-GB-talker-v2.pdf', '{"headline":"New Real Care","format":"Shelf talker"}', 'job'),
  ('AS-2026-00007', 'Dove Real Care playbook (EMEA)', 'playbook', 'CMP-2026-00002', null, 'EMEA', null, 'Dove', null, null, 'DOVE-EMEA-playbook.pdf', '{"theme":"Always-on","format":"Toolkit"}', 'manual'),
  ('AS-2026-00008', 'Magnum dumpbin wrap, Esselunga Milano', 'executional_image', 'CMP-2026-00003', 'BR-2026-00005', 'EMEA', 'IT', 'Magnum', 'TP-DUMPBIN', 'P2P-SELL', 'MAG-IT-dumpbin-milano.jpg', '{"headline":"Take pleasure home","format":"Dumpbin wrap","visual_elements":["Gold foil","Multipack"]}', 'ai_extracted'),
  ('AS-2026-00009', 'Magnum freezer topper render', 'render_3d', 'CMP-2026-00003', 'BR-2026-00005', 'EMEA', 'IT', 'Magnum', 'TP-HEADER', 'P2P-CONNECT', 'MAG-IT-topper-render.png', '{"format":"Freezer topper"}', 'job'),
  ('AS-2026-00010', 'Magnum spoon GWP pack shot', 'production_art', 'CMP-2026-00003', null, 'EMEA', 'ES', 'Magnum', 'TP-GWP', 'P2P-SELL', 'MAG-ES-spoon-gwp.png', '{"headline":"Un regalo de oro","format":"Gift with purchase"}', 'job'),
  ('AS-2026-00011', 'Magnum cabinet branding, 7-Eleven Orchard', 'executional_image', 'CMP-2026-00003', null, 'APAC', 'SG', 'Magnum', 'TP-CHILLER', 'P2P-CONNECT', 'MAG-SG-cabinet-orchard.jpg', '{"format":"Cabinet branding","visual_elements":["Gold frame"]}', 'ai_extracted')
) a(code, title, type, campaign, brief, region, market, brand, tp, st, file, meta, src)
left join public.campaigns c on c.campaign_code = a.campaign
left join public.briefs b on b.brief_code = a.brief
left join public.library_records tp on tp.library_key = 'touchpoint_types' and tp.code = a.tp and tp.status = 'active'
left join public.library_records st on st.library_key = 'p2p_stages' and st.code = a.st and st.status = 'active';
select setval('public.siq_asset_no', greatest(100, (select last_value from public.siq_asset_no)));

-- Usage guard for the taxonomy records the demo rows reference.
insert into public.library_refs (record_id, ref_table, ref_id)
select touchpoint_id, 'siq_effectiveness', id::text from public.siq_effectiveness
union select p2p_stage_id, 'siq_effectiveness', id::text from public.siq_effectiveness where p2p_stage_id is not null
union select touchpoint_id, 'siq_assets', id::text from public.siq_assets where touchpoint_id is not null
on conflict do nothing;
