-- Reorder from an approved rate card. The price list is the awards of approved programmes that are in date, accepted by the vendor, and
-- still with an eligible vendor. A buyer picks an item and a quantity inside its tier; the order goes to the awarded vendor at its buy
-- price with no RFQ. For an item shared between vendors the suggestion is the vendor furthest below its share of the volume ordered so
-- far; choosing another vendor needs a reason. The reorder creates the job line, an Adopt triage decision and a draft estimate, so the
-- client estimate, the client PO and the supplier PO approvals carry on exactly as they do for any job.

create table public.rate_card_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rate_card_items(id),
  award_id uuid references public.rate_card_awards(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_label text not null,
  quantity int not null check (quantity > 0),
  buy_price numeric not null,
  sell_price numeric not null,
  currency text not null,
  job_id uuid references public.jobs(id) on delete set null,
  spec_id uuid references public.job_specs(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  suggested_supplier uuid references public.suppliers(id) on delete set null,
  override_reason text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index rate_card_orders_item_idx on public.rate_card_orders (item_id, supplier_id);
alter table public.rate_card_orders enable row level security;
create policy rco_read on public.rate_card_orders for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_orders from authenticated, anon;

-- The awards a buyer can order against today.
create or replace function public._rcp_live_awards() returns table (award_id uuid, item_id uuid, programme_id uuid, supplier_id uuid, supplier_label text, share_percent numeric, buy_price numeric, sell_price numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.item_id, i.programme_id, a.supplier_id, a.supplier_label, a.share_percent, a.buy_price, a.sell_price
    from public.rate_card_awards a
    join public.rate_card_items i on i.id = a.item_id
    join public.rate_card_programmes g on g.id = i.programme_id
    join public.rate_card_acceptances ac on ac.programme_id = g.id and ac.supplier_id = a.supplier_id and ac.status = 'accepted'
    join public.suppliers s on s.id = a.supplier_id
   where g.status in ('approved', 'published') and g.valid_from <= current_date and g.valid_to >= current_date
     and s.active and not s.purchasing_blocked;
$$;
revoke execute on function public._rcp_live_awards() from public, anon, authenticated;

-- Share of the volume each live vendor has had so far against the share it was awarded; the largest shortfall is the suggestion.
create or replace function public._rcp_allocation(p_item uuid) returns table (supplier_id uuid, ordered bigint, deficit numeric, suggested boolean)
language sql stable security definer set search_path = public as $$
  with live as (select * from public._rcp_live_awards() where item_id = p_item),
       o as (select l.supplier_id, coalesce(sum(r.quantity), 0) as q from live l left join public.rate_card_orders r on r.item_id = p_item and r.supplier_id = l.supplier_id group by l.supplier_id),
       t as (select nullif(sum(q), 0) as total from o),
       d as (select l.supplier_id, o.q, l.share_percent, l.share_percent / 100 - coalesce(o.q::numeric / t.total, 0) as deficit from live l join o on o.supplier_id = l.supplier_id cross join t)
  select d.supplier_id, d.q::bigint, round(d.deficit, 4), d.supplier_id = (select d2.supplier_id from d d2 order by d2.deficit desc, d2.share_percent desc, d2.supplier_id limit 1) from d;
$$;
revoke execute on function public._rcp_allocation(uuid) from public, anon, authenticated;

create or replace function public.rate_card_price_list(p_search text default null, p_programme uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see the rate card price list' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(rec order by rec->>'programme_code', (rec->>'sort')::int), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'item_id', i.id, 'sort', i.sort, 'programme_id', g.id, 'programme_code', g.code, 'programme_name', g.name, 'valid_from', g.valid_from, 'valid_to', g.valid_to,
      'currency', g.currency, 'subcode', i.subcode, 'product_type', i.product_type, 'product_code', i.product_code, 'channel', i.channel, 'category', i.category,
      'uom', i.uom, 'qty_min', i.qty_min, 'qty_max', i.qty_max, 'spec_detail', i.spec_detail, 'fee_percent', g.fee_percent,
      'awards', (select jsonb_agg(jsonb_build_object('supplier_id', l.supplier_id, 'supplier', l.supplier_label, 'share', l.share_percent, 'buy', l.buy_price, 'sell', l.sell_price,
                   'ordered', al.ordered, 'deficit', al.deficit, 'suggested', al.suggested) order by l.share_percent desc, l.supplier_label)
                   from public._rcp_live_awards() l join public._rcp_allocation(i.id) al on al.supplier_id = l.supplier_id where l.item_id = i.id)
    ) as rec
    from public.rate_card_items i join public.rate_card_programmes g on g.id = i.programme_id
   where (p_programme is null or g.id = p_programme)
     and exists (select 1 from public._rcp_live_awards() l where l.item_id = i.id)
     and (nullif(trim(p_search), '') is null or lower(i.product_type || ' ' || i.subcode || ' ' || coalesce(i.product_code, '') || ' ' || coalesce(i.category, '')) like '%' || lower(trim(p_search)) || '%')
   limit 1500
  ) x;
  return v_out;
end $$;

create or replace function public._rcp_spec_type(p_category text) returns text language sql immutable as $$
  select case when lower(coalesce(p_category, '')) like '%display%' then '3d'
              when lower(coalesce(p_category, '')) like '%custom%' or lower(coalesce(p_category, '')) like '%service%' then 'custom_goods_services'
              when lower(coalesce(p_category, '')) like '%design%' then 'design' else '2d' end;
$$;
revoke execute on function public._rcp_spec_type(text) from public, anon, authenticated;

-- Reorder. Into an existing job (p_job), or a new one (p_client, p_market, p_title).
create or replace function public.rate_card_reorder(p_item uuid, p_quantity int, p_job uuid default null, p_supplier uuid default null, p_reason text default null,
  p_client uuid default null, p_market text default null, p_title text default null, p_delivery date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.rate_card_items; g public.rate_card_programmes; l record; v_sug uuid; v_sup uuid; j public.jobs; c public.sourcing_clients; mk public.markets;
  v_spec uuid; v_est uuid; v_tri uuid; v_live int; v_name text;
begin
  if not public.is_internal() then raise exception 'Only internal staff can reorder from a rate card' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Give the quantity to order'; end if;
  select * into i from public.rate_card_items where id = p_item;
  if i.id is null then raise exception 'Rate card item not found'; end if;
  select * into g from public.rate_card_programmes where id = i.programme_id;
  select count(*) into v_live from public._rcp_live_awards() where item_id = p_item;
  if v_live = 0 then raise exception 'This item is not live: it needs an approved programme in date and an accepted award with an eligible vendor'; end if;
  if (i.qty_min is not null and p_quantity < i.qty_min) or (i.qty_max is not null and p_quantity > i.qty_max) then
    raise exception 'The quantity must be within this tier: % to %', coalesce(i.qty_min::text, '1'), coalesce(i.qty_max::text, 'no limit');
  end if;

  select al.supplier_id into v_sug from public._rcp_allocation(p_item) al where al.suggested limit 1;
  v_sup := coalesce(p_supplier, v_sug);
  select * into l from public._rcp_live_awards() where item_id = p_item and supplier_id = v_sup;
  if l.award_id is null then raise exception 'That vendor does not hold a live award on this item'; end if;
  if v_sup is distinct from v_sug and coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'The system suggests another vendor to keep to the awarded shares. Say why you are choosing this one';
  end if;
  if not public.supplier_is_eligible(v_sup) then raise exception 'That vendor is not eligible in SRM'; end if;

  if p_job is not null then
    select * into j from public.jobs where id = p_job;
    if j.id is null then raise exception 'Job not found'; end if;
    if j.status not in ('open', 'quoting') then raise exception 'Choose a job that is still open'; end if;
    if j.currency <> g.currency then raise exception 'The job is in % but this rate card is in %', j.currency, g.currency; end if;
  else
    if p_client is null or coalesce(trim(p_title), '') = '' or coalesce(trim(p_market), '') = '' then raise exception 'Choose a job, or give a client, market and title for a new one'; end if;
    select * into c from public.sourcing_clients where id = p_client;
    if c.id is null then raise exception 'Client not found'; end if;
    select * into mk from public.markets where code = upper(trim(p_market));
    if mk.code is null then raise exception 'Choose a market'; end if;
    insert into public.jobs (title, client_id, region, market, currency, target_delivery_date, notes)
    values (trim(p_title), c.id, mk.region_code, mk.name, g.currency, p_delivery, 'Reordered from rate card ' || g.code || '.') returning * into j;
  end if;
  select * into c from public.sourcing_clients where id = j.client_id;

  insert into public.job_specs (job_id, title, spec_type, size_unit, description, spec_data)
  values (j.id, left(i.product_type || ' ' || i.subcode, 200), public._rcp_spec_type(i.category), 'mm',
          concat_ws(E'\n', 'Reordered from rate card ' || g.code || ' (' || g.name || '), item ' || i.subcode || '.', nullif(i.spec_detail, '')),
          jsonb_build_object('seeded_from', jsonb_build_object('rate_card_programme', g.code, 'rate_card_item', i.subcode, 'unit', i.uom)))
  returning id into v_spec;
  insert into public.spec_versions (spec_id, name, quantity) values (v_spec, 'Main', p_quantity);

  v_tri := public._triage_insert(v_spec, 'adopt', 'Reordered from rate card ' || g.code || ' (' || i.subcode || ') at the awarded price', 1, null, l.buy_price, g.currency, p_quantity, v_sup, 'override');

  insert into public.estimates (job_id, supplier_id, source, currency, base_cost, benchmark_source, pricing_mode, pricing_percent, savings_target_percent, selection_reason, region, market, created_by)
  values (j.id, v_sup, 'adopt', g.currency, 0, 'rate_card', 'markup', round(g.fee_percent, 2), c.savings_target_percent, 'Reordered from rate card ' || g.code, j.region, j.market, auth.uid())
  returning id into v_est;
  insert into public.estimate_lines (estimate_id, spec_id, triage_id, quantity, unit_cost, line_cost, benchmark_unit)
  values (v_est, v_spec, v_tri, p_quantity, l.buy_price, round(l.buy_price * p_quantity, 2), l.buy_price);
  update public.estimates set base_cost = round(l.buy_price * p_quantity, 2), benchmark_value = round(l.buy_price * p_quantity, 2), savings_vs_benchmark = 0 where id = v_est;

  insert into public.rate_card_orders (item_id, award_id, supplier_id, supplier_label, quantity, buy_price, sell_price, currency, job_id, spec_id, estimate_id, suggested_supplier, override_reason)
  values (p_item, l.award_id, v_sup, l.supplier_label, p_quantity, l.buy_price, l.sell_price, g.currency, j.id, v_spec, v_est, v_sug, case when v_sup is distinct from v_sug then trim(p_reason) end);
  select name into v_name from public.suppliers where id = v_sup;
  perform public._sourcing_event(j.id, 'estimate', v_est, 'created', jsonb_build_object('source', 'rate_card', 'programme', g.code, 'item', i.subcode, 'supplier', v_name, 'quantity', p_quantity, 'buy', l.buy_price));
  return jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'spec_id', v_spec, 'estimate_id', v_est, 'supplier', v_name, 'buy', l.buy_price, 'sell', l.sell_price, 'quantity', p_quantity, 'currency', g.currency);
end $$;

revoke execute on function public.rate_card_price_list(text, uuid), public.rate_card_reorder(uuid, int, uuid, uuid, text, uuid, text, text, date) from public, anon;
grant execute on function public.rate_card_price_list(text, uuid), public.rate_card_reorder(uuid, int, uuid, uuid, text, uuid, text, text, date) to authenticated;
