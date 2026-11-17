-- Vendor capability profile for the demo vendor (DEMO-001): capabilities, machines and tooling. Dummy data only.
with s as (select id from public.suppliers where supplier_code = 'DEMO-001'),
p as (select code, id from public.library_records where library_key = 'srm_processes')
insert into public.supplier_capabilities (supplier_id, process_id, in_house, materials, max_width_mm, max_height_mm, max_depth_mm, min_run, max_run,
  monthly_capacity, lead_time_days, colours, notes, evidence_status, verified_at, verification_note)
select s.id, p.id, x.in_house, x.materials, x.w, x.h, x.d, x.min_run, x.max_run, x.cap, x.lead, x.colours, x.notes, x.status,
       case when x.status = 'verified' then now() - interval '40 days' end, case when x.status = 'verified' then 'Seen on site visit (demo)' end
from s, (values
  ('PRT-DIGITAL', true, array['Foamex','Correx','Board','Vinyl'], 3200, 2000, null::numeric, 1, 5000, 25000, 7, 6, 'UV flatbed and roll-to-roll', 'verified'),
  ('PRT-OFFSET', true, array['Board','Paper'], 1020, 720, null, 1000, 200000, 1500000, 10, 5, null, 'verified'),
  ('CNV-DIECUT', true, array['Board','Corrugated'], 1450, 1050, null, 500, 100000, 400000, 10, null, null, 'declared'),
  ('PLS-INJECT', false, array['PP','ABS'], 600, 400, 300, 5000, 500000, 200000, 35, null, 'Subcontracted to a partner moulder', 'declared'),
  ('ASM-KIT', true, array[]::text[], null, null, null, 100, 50000, 80000, 5, null, 'Kitting by store pack', 'verified')
) as x(code, in_house, materials, w, h, d, min_run, max_run, cap, lead, colours, notes, status)
join p on p.code = x.code
where not exists (select 1 from public.supplier_capabilities c where c.supplier_id = s.id);

with s as (select id from public.suppliers where supplier_code = 'DEMO-001'),
m as (select code, id from public.library_records where library_key = 'srm_machine_types')
insert into public.supplier_machines (supplier_id, machine_type_id, make, model, year_built, quantity, max_width_mm, max_height_mm, colours_stations, speed, speed_unit, condition, evidence_status)
select s.id, m.id, x.make, x.model, x.yr, x.qty, x.w, x.h, x.cs, x.speed, x.unit, x.cond, x.status
from s, (values
  ('MC-FLATBED', 'Durst', 'P5 350', 2021, 1, 3500, 2000, 6, 320, 'm2/h', 'good', 'verified'),
  ('MC-ROLL', 'HP', 'Latex 800W', 2022, 2, 1625, null::numeric, 6, 50, 'm2/h', 'good', 'declared'),
  ('MC-OFFSET', 'Heidelberg', 'Speedmaster XL 106', 2016, 1, 1060, 750, 5, 18000, 'sheets/h', 'fair', 'verified'),
  ('MC-DIGICUT', 'Zund', 'G3 L-3200', 2019, 1, 3200, 3200, null, null, null, 'good', 'declared')
) as x(code, make, model, yr, qty, w, h, cs, speed, unit, cond, status)
join m on m.code = x.code
where not exists (select 1 from public.supplier_machines c where c.supplier_id = s.id);

with s as (select id from public.suppliers where supplier_code = 'DEMO-001'),
t as (select code, id from public.library_records where library_key = 'srm_tooling_types'),
c as (select id from public.sourcing_clients where code = 'NBW')
insert into public.supplier_tooling (supplier_id, tooling_type_id, description, owner, owner_client_id, material, cavities, dimensions, made_year, last_used,
  lifetime, used, storage_cost_month, currency, insured, status, evidence_status)
select s.id, t.id, x.descr, x.owner, case when x.owner = 'client' then (select id from c) end, x.material, x.cav, x.dims, x.yr, x.last_used::date,
  x.life, x.used, x.cost, 'EUR', x.insured, x.status, x.ev
from s, (values
  ('TL-CUT-FORME', 'Counter-top unit cutting forme', 'adm_indicia', 'Steel rule on plywood', null::int, '1020 x 720 mm', 2025, '2026-09-12', 200000, 64000, 15, false, 'active', 'verified'),
  ('TL-INJ-MOULD', 'Shelf wobbler base, 4-cavity', 'client', 'P20 steel', 4, '450 x 380 x 300 mm', 2024, '2026-07-02', 500000, 410000, 40, true, 'active', 'declared'),
  ('TL-SCREEN', 'Gondola header screen set (4 colours)', 'supplier', 'Aluminium frame', null, '1300 x 900 mm', 2023, '2025-11-20', 5000, 4700, null, false, 'retired', 'verified')
) as x(code, descr, owner, material, cav, dims, yr, last_used, life, used, cost, insured, status, ev)
join t on t.code = x.code
where not exists (select 1 from public.supplier_tooling c where c.supplier_id = s.id)
  and (x.owner <> 'client' or exists (select 1 from c));
