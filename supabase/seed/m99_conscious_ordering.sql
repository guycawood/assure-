-- DUMMY DATA for the conscious ordering programme (Sustainability). Every outlet, install and stock count here is made up.
-- Loaded after m40 (jobs, POs), m50 (deliveries) and m60 (outlets, deployments).
-- About four in ten delivered orders get install evidence, so the page shows both measured and estimated figures.
-- The share installed is fixed per brand and market (a few are deliberately poor), so over-ordering patterns show up.
select set_config('sourcing.system_write', 'on', false);

drop table if exists _cor_lines;
create temporary table _cor_lines as
select p.id as po_id, p.job_id, p.supplier_id, p.delivery_date, p.region, p.market, j.client_id, m.code as market_code, m.region_code,
       el.spec_id, sum(el.quantity)::int as ordered,
       (select d.id from public.deliveries d where d.po_id = p.id and d.spec_id = el.spec_id order by d.created_at limit 1) as delivery_id,
       (select sv.id from public.spec_versions sv where sv.spec_id = el.spec_id order by sv.sort limit 1) as version_id,
       -- 0 to 99, the same for every order of a brand in a market; a quarter of brand-markets install well under target.
       abs(hashtext(j.brand || '|' || j.market)) % 100 as h,
       abs(hashtext(p.po_number)) % 100 as hp
  from public.purchase_orders p
  join public.jobs j on j.id = p.job_id
  join public.markets m on m.name = j.market
  join public.estimate_lines el on el.estimate_id = p.estimate_id
 where p.status = 'accepted' and nullif(trim(j.brand), '') is not null and p.delivery_date < current_date - 30
   and abs(hashtext(p.po_number)) % 100 < 40
   and not exists (select 1 from public.deployments x where x.po_id = p.id)
   and exists (select 1 from public.deliveries d join public.shipments s on s.delivery_id = d.id
                where d.po_id = p.id and d.spec_id = el.spec_id and s.pod_status = 'verified')
 group by p.id, p.job_id, p.supplier_id, p.delivery_date, p.region, p.market, j.client_id, j.brand, j.market, m.code, m.region_code, el.spec_id, p.po_number;

-- Two demo outlets per client and market.
insert into public.outlets (client_id, name, outlet_code, city, region, market, store_type, status, notes)
select distinct l.client_id, mk.name || ' store ' || n.n || ' (demo)', 'COR-' || l.market_code || '-' || n.n, mk.name, l.region_code, l.market_code,
       case n.n when 1 then 'supermarket' else 'convenience' end, 'active', 'Dummy outlet for the conscious ordering demo'
  from _cor_lines l join public.markets mk on mk.code = l.market_code cross join (values (1), (2)) n(n)
on conflict (client_id, outlet_code) do nothing;

-- Installs: the order is split across the two outlets; the share installed follows the brand and market.
insert into public.deployments (outlet_id, po_id, job_id, supplier_id, spec_id, spec_version_id, delivery_id, quantity, planned_date, stage, installation_date,
  installed_quantity, installer_name, installed_by_vendor, audit_status, audit_score, audited_at, region, market, notes)
select o.id, l.po_id, l.job_id, l.supplier_id, l.spec_id, l.version_id, l.delivery_id, q.qty, l.delivery_date + 7, 'audited', least(l.delivery_date + 10, current_date - 1),
       greatest(round(q.qty * least(f.share + (l.hp % 9 - 4) / 100.0, 1))::int, 0), 'Field team (demo)', false, 'passed', 85, now() - interval '5 days',
       l.region_code, l.market_code, 'Dummy install for the conscious ordering demo'
  from _cor_lines l
  cross join lateral (select case when l.h < 25 then 0.55 + l.h * 0.006 else 0.84 + (l.h - 25) * 0.002 end as share) f
  cross join lateral (values (1, (l.ordered + 1) / 2), (2, l.ordered / 2)) q(n, qty)
  join public.outlets o on o.client_id = l.client_id and o.outlet_code = 'COR-' || l.market_code || '-' || q.n
 where q.qty > 0;

-- Stock counts: about half the tracked orders had their leftovers counted in a warehouse; some counts are old.
insert into public.stock_counts (po_id, spec_id, quantity, counted_on, location, source, region, market, notes)
select l.po_id, l.spec_id, round(s.surplus * (0.4 + (l.hp % 5) / 10.0))::int, current_date - (30 + (l.hp * 13) % 520),
       case l.hp % 3 when 0 then 'Central warehouse (demo)' when 1 then 'Vendor store (demo)' else 'Market office (demo)' end,
       case l.hp % 3 when 0 then 'warehouse' when 1 then 'vendor' else 'market' end, l.region, l.market, 'Dummy stock count'
  from _cor_lines l
  cross join lateral (select l.ordered - coalesce((select sum(x.installed_quantity) from public.deployments x where x.po_id = l.po_id and x.spec_id = l.spec_id), 0)::int as surplus) s
 where l.hp % 2 = 0 and s.surplus > 1;

drop table _cor_lines;
select set_config('sourcing.system_write', 'off', false);
