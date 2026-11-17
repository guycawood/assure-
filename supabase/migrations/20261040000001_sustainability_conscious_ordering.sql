-- Sustainability: the conscious ordering programme (ordered vs delivered vs used).
--   * stock_counts: warehouse, vendor or market stock levels per order line (PO + spec). Append-only: every count is
--     kept, the latest count per location is the stock on hand. Written only through ordering_record_stock_count().
--   * conscious_ordering_lines(): one row per order line with what was ordered, delivered (verified proof of
--     delivery), installed (Execution deployments) and held in stock, and what is left unaccounted for.
--       untracked   = no deployments and no stock count: nothing is known about where the units went;
--       in_progress = nothing delivered yet, or installs still open: too early to judge;
--       reconciled  = everything tracked has landed: surplus = delivered - installed, split into stock on hand and
--                     unaccounted. Unaccounted units, and stock older than the governed age, are presumed wasted.
--   * Rules (utilisation target, minimum orders for a pattern, stock age, contingency allowance, default surplus rate)
--     and spend-based emission factors are Watchtower libraries, not constants.
-- Region and market on a stock count come from the PO. Money is reported in EUR through _fx_eur().

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('conscious_ordering_rules', 'watchtower', 'Conscious ordering rules', 'Thresholds for the conscious ordering programme: utilisation target, how many orders make a pattern, when stock counts as wasted, the contingency allowance and the default surplus rate.', true, 30),
  ('spend_emission_factors', 'watchtower', 'Spend-based emission factors', 'kgCO2e per EUR of spend by product type, used only where a spec has no measured footprint. The least accurate method: figures built on it are labelled estimated.', true, 31)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'conscious_ordering_rules', x.code, x.name, x.data::jsonb, 'active', date '2025-01-01', 'Starting value; change it in the Watchtower'
  from (values
    ('COR-TARGET', 'Utilisation target', '{"value":85,"unit":"%","description":"Share of ordered units that should end up installed. A brand and market below this, on enough orders, is flagged as over-ordering."}'),
    ('COR-MIN-ORDERS', 'Orders that make a pattern', '{"value":3,"unit":"orders","description":"A brand and market is only flagged once this many of its order lines have been reconciled, so one bad campaign does not label a market."}'),
    ('COR-STOCK-AGE', 'Stock age before it counts as wasted', '{"value":12,"unit":"months","description":"Stock on hand whose last count is older than this is presumed wasted."}'),
    ('COR-ALLOWANCE', 'Contingency allowance', '{"value":5,"unit":"%","description":"Spare units allowed on top of the need when a suggested quantity is worked out."}'),
    ('COR-DEFAULT-RATE', 'Default surplus rate', '{"value":15,"unit":"%","description":"Surplus rate assumed for untracked orders until enough orders of that product type have been reconciled to measure one."}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'conscious_ordering_rules' and r.code = x.code);

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'spend_emission_factors', x.code, x.name, jsonb_build_object('spec_type', x.spec_type, 'factor_kgco2e_per_eur', x.factor, 'verification_status', 'indicative',
         'source', 'Indicative starting value; replace with a licensed spend-based factor set before reporting'), 'active', date '2025-01-01', 'Indicative; verify before reporting'
  from (values ('SEF-2D', 'Print', '2d', 0.45), ('SEF-3D', 'Retail display', '3d', 0.55), ('SEF-PROMO', 'Promo & merch', 'promo_merch', 0.60),
               ('SEF-GOODS', 'Goods & services', 'custom_goods_services', 0.30), ('SEF-DESIGN', 'Design', 'design', 0.10)) x(code, name, spec_type, factor)
 where not exists (select 1 from public.library_records r where r.library_key = 'spend_emission_factors' and r.code = x.code);

create or replace function public._cor_rule(p_code text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(e.data->>'value', '')::numeric from public.library_effective('conscious_ordering_rules', p_code, current_date) e where e.id is not null), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Stock counts
-- ---------------------------------------------------------------------------
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id),
  spec_id uuid not null references public.job_specs(id),
  quantity int not null check (quantity >= 0),
  counted_on date not null default current_date,
  location text not null check (length(trim(location)) > 0),
  source text not null default 'warehouse' check (source in ('warehouse','vendor','market')),
  region text not null,
  market text not null,
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_counts_line_idx on public.stock_counts (po_id, spec_id, counted_on desc);

alter table public.stock_counts enable row level security;
create policy stock_counts_read on public.stock_counts for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.stock_counts from authenticated, anon;

-- Record a stock count for one order line. A count of 0 says the location is empty. The total held across locations
-- can never be more than was ordered.
create or replace function public.ordering_record_stock_count(p_po uuid, p_spec uuid, p_quantity int, p_counted_on date, p_location text,
  p_source text default 'warehouse', p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; v_ordered int; v_elsewhere int; v_loc text := trim(coalesce(p_location, '')); v_id uuid;
begin
  if not public.is_internal() or public.my_supplier_id() is not null then
    raise exception 'Only adm Indicia staff can record a stock count' using errcode = '42501';
  end if;
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null then raise exception 'That purchase order doesn''t exist'; end if;
  if p.status not in ('issued','accepted') then raise exception 'Stock can only be counted against an issued purchase order'; end if;
  select sum(el.quantity)::int into v_ordered from public.estimate_lines el where el.estimate_id = p.estimate_id and el.spec_id = p_spec;
  if v_ordered is null then raise exception 'That spec isn''t on this purchase order'; end if;
  if p_quantity is null or p_quantity < 0 then raise exception 'Enter the quantity counted (0 if there is none left)'; end if;
  if v_loc = '' then raise exception 'Enter where the stock is held'; end if;
  if p_counted_on is null or p_counted_on > current_date then raise exception 'The count date can''t be in the future'; end if;
  if coalesce(p_source, 'warehouse') not in ('warehouse','vendor','market') then raise exception 'Choose who holds the stock: warehouse, vendor or market'; end if;

  select coalesce(sum(l.quantity), 0)::int into v_elsewhere from (
    select distinct on (lower(c.location)) c.quantity from public.stock_counts c
     where c.po_id = p_po and c.spec_id = p_spec and lower(c.location) <> lower(v_loc)
     order by lower(c.location), c.counted_on desc, c.created_at desc) l;
  if v_elsewhere + p_quantity > v_ordered then
    raise exception 'That would put % in stock, but only % were ordered', v_elsewhere + p_quantity, v_ordered;
  end if;

  insert into public.stock_counts (po_id, spec_id, quantity, counted_on, location, source, region, market, notes, recorded_by)
  values (p_po, p_spec, p_quantity, p_counted_on, v_loc, coalesce(p_source, 'warehouse'), p.region, p.market, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Reconciliation: one row per order line
-- ---------------------------------------------------------------------------
create or replace function public.conscious_ordering_lines()
returns table (
  po_id uuid, po_number text, po_date date, job_id uuid, job_number text, client_id uuid, client_name text, brand text, region text, market text,
  spec_id uuid, spec_title text, spec_type text, currency text, unit_cost numeric, unit_cost_eur numeric,
  ordered int, delivered int, install_planned int, installed int, open_installs int, in_stock int, aged_stock int, last_count date,
  status text, surplus int, unaccounted int, wasted int, co2e_kg_per_unit numeric, co2e_basis text)
language plpgsql stable security definer set search_path = public as $$
declare v_age int := public._cor_rule('COR-STOCK-AGE', 12)::int;
begin
  if not public.is_internal() or public.my_supplier_id() is not null then
    raise exception 'Only adm Indicia staff can see the ordering reconciliation' using errcode = '42501';
  end if;
  return query
  with ord as (
    select p.id as po_id, el.spec_id, sum(el.quantity)::int as ordered, round(sum(el.line_cost) / nullif(sum(el.quantity), 0), 4) as unit_cost
      from public.purchase_orders p join public.estimate_lines el on el.estimate_id = p.estimate_id
     where p.status in ('issued','accepted') group by p.id, el.spec_id
  ), del as (
    select d.po_id, d.spec_id, sum(s.quantity_shipped)::int as delivered
      from public.deliveries d join public.shipments s on s.delivery_id = d.id
     where s.pod_status = 'verified' group by d.po_id, d.spec_id
  ), dep as (
    select x.po_id, x.spec_id, sum(x.quantity)::int as planned,
           coalesce(sum(x.installed_quantity) filter (where x.stage in ('installed','audited','rejected')), 0)::int as installed,
           (count(*) filter (where x.stage in ('planned','in_transit','delivered')))::int as open_installs
      from public.deployments x group by x.po_id, x.spec_id
  ), latest as (
    select distinct on (c.po_id, c.spec_id, lower(c.location)) c.po_id, c.spec_id, c.quantity, c.counted_on
      from public.stock_counts c order by c.po_id, c.spec_id, lower(c.location), c.counted_on desc, c.created_at desc
  ), stk as (
    select l.po_id, l.spec_id, sum(l.quantity)::int as held,
           coalesce(sum(l.quantity) filter (where l.counted_on < current_date - make_interval(months => v_age)), 0)::int as aged,
           max(l.counted_on) as last_count
      from latest l group by l.po_id, l.spec_id
  ), base as (
    select o.po_id, o.spec_id, o.ordered, o.unit_cost, coalesce(dl.delivered, 0) as delivered, coalesce(dp.planned, 0) as planned,
           coalesce(dp.installed, 0) as installed, coalesce(dp.open_installs, 0) as open_installs, coalesce(st.held, 0) as held,
           coalesce(st.aged, 0) as aged, st.last_count,
           case when dp.po_id is null and st.po_id is null then 'untracked'
                when coalesce(dl.delivered, 0) = 0 or coalesce(dp.open_installs, 0) > 0 then 'in_progress'
                else 'reconciled' end as status
      from ord o
      left join del dl on dl.po_id = o.po_id and dl.spec_id = o.spec_id
      left join dep dp on dp.po_id = o.po_id and dp.spec_id = o.spec_id
      left join stk st on st.po_id = o.po_id and st.spec_id = o.spec_id
  ), calc as (
    select b.*, case when b.status = 'reconciled' then greatest(b.delivered - b.installed, 0) else 0 end as surplus from base b
  ), fin as (
    -- Stock can only explain surplus that exists; aged stock is the old part of what is held.
    select c.*, least(c.held, c.surplus) as stock_in_surplus, least(c.aged, least(c.held, c.surplus)) as aged_in_surplus from calc c
  )
  select p.id, p.po_number, p.po_date, j.id, j.job_number, j.client_id, cl.name, coalesce(nullif(trim(j.brand), ''), 'No brand'), j.region, j.market,
         sp.id, sp.title, sp.spec_type, p.currency, f.unit_cost, round(f.unit_cost * public._fx_eur(p.currency), 4),
         f.ordered, f.delivered, f.planned, f.installed, f.open_installs, f.stock_in_surplus, f.aged_in_surplus, f.last_count,
         f.status, f.surplus, f.surplus - f.stock_in_surplus, f.surplus - f.stock_in_surplus + f.aged_in_surplus,
         coalesce(sp.co2e_kg_per_unit, round(f.unit_cost * public._fx_eur(p.currency) * sef.factor, 5)),
         case when sp.co2e_kg_per_unit is not null then 'spec' when sef.factor is not null and public._fx_eur(p.currency) is not null then 'spend' end
    from fin f
    join public.purchase_orders p on p.id = f.po_id
    join public.jobs j on j.id = p.job_id
    join public.sourcing_clients cl on cl.id = j.client_id
    join public.job_specs sp on sp.id = f.spec_id
    left join lateral (
      select nullif(r.data->>'factor_kgco2e_per_eur', '')::numeric as factor from public.library_records r
       where r.library_key = 'spend_emission_factors' and r.status = 'active' and r.effective_from <= current_date and r.data->>'spec_type' = sp.spec_type
       order by r.version desc limit 1) sef on true
   order by p.po_date desc, p.po_number, sp.title;
end $$;

revoke execute on function public._cor_rule(text, numeric) from public, anon, authenticated;
grant execute on function public.conscious_ordering_lines(), public.ordering_record_stock_count(uuid, uuid, int, date, text, text, text) to authenticated;
