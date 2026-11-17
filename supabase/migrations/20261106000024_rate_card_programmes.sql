-- Rate card programmes: building a year's rate cards in Sourcing, the way the manual pricing file does it.
--   items    product type, client code and sub-code, quantity tier, channel, spec, unit, last year's price and volume
--   bids     each supplier's price per item
--   analysis lowest and selected bid -> buy price (rounded down) -> sell price (buy plus fee, rounded up), saving against last
--            year's price (or against the market average with outliers capped), the price-falls-with-quantity check, winners,
--            coverage of the programme against the minimum.
-- Publishing the cards to the library, and the review and approval steps, come next. Money rounding is set per programme
-- (0 decimals for VND, 2 for EUR) so a rate card never loses cents it should keep.

create sequence public.rate_card_programme_no;

create table public.rate_card_programmes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RCP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rate_card_programme_no')::text, 3, '0')),
  name text not null check (length(trim(name)) > 0),
  year int not null check (year between 2000 and 2100),
  market text,
  currency text not null default 'EUR' check (length(currency) = 3),
  fee_percent numeric(6,3) not null default 5 check (fee_percent >= 0 and fee_percent <= 100),
  cap_percent numeric(6,2) not null default 50 check (cap_percent > 0 and cap_percent <= 1000),
  winner_band_percent numeric(6,2) not null default 5 check (winner_band_percent >= 0 and winner_band_percent <= 100),
  min_coverage_percent numeric(6,2) not null default 61 check (min_coverage_percent between 0 and 100),
  saving_high_percent numeric(6,2) not null default 40 check (saving_high_percent between 0 and 100),
  price_decimals int not null default 2 check (price_decimals between 0 and 4),
  status text not null default 'draft' check (status in ('draft', 'bidding', 'review', 'approved', 'published')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rate_card_items (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.rate_card_programmes(id) on delete cascade,
  product_type text not null check (length(trim(product_type)) > 0),
  product_code text,
  subcode text not null check (length(trim(subcode)) > 0),
  channel text not null default 'Both' check (channel in ('DT', 'MT', 'Both')),
  category text,
  spec_detail text,
  uom text,
  qty_min numeric check (qty_min is null or qty_min >= 0),
  qty_max numeric check (qty_max is null or qty_max >= 0),
  baseline_price numeric check (baseline_price is null or baseline_price >= 0),
  baseline_match text check (baseline_match in ('PY', 'Similar', 'Exact')),
  baseline_qty numeric not null default 0 check (baseline_qty >= 0),
  selected_bid uuid,
  selection_reason text,
  sort int not null default 0,
  unique (programme_id, subcode),
  check (qty_min is null or qty_max is null or qty_max >= qty_min)
);
create index rate_card_items_prog_idx on public.rate_card_items (programme_id, sort);

create table public.rate_card_bids (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rate_card_items(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_label text not null check (length(trim(supplier_label)) > 0),
  price numeric not null check (price > 0),
  note text,
  created_at timestamptz not null default now(),
  unique (item_id, supplier_label)
);
alter table public.rate_card_items add constraint rate_card_items_selected_fk foreign key (selected_bid) references public.rate_card_bids(id) on delete set null;

alter table public.rate_card_programmes enable row level security;
alter table public.rate_card_items enable row level security;
alter table public.rate_card_bids enable row level security;
create policy rcp_read on public.rate_card_programmes for select to authenticated using (public.is_internal());
create policy rci_read on public.rate_card_items for select to authenticated using (public.is_internal());
create policy rcb_read on public.rate_card_bids for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_programmes, public.rate_card_items, public.rate_card_bids from authenticated, anon;

create or replace function public._rcp_require_builder() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only internal staff can build rate cards' using errcode = '42501'; end if;
  if not public.sourcing_is_lead() then raise exception 'Only a sourcing lead can build rate cards' using errcode = '42501'; end if;
end $$;

create or replace function public._rcp_open(p_prog uuid) returns public.rate_card_programmes
language plpgsql stable security definer set search_path = public as $$
declare r public.rate_card_programmes;
begin
  select * into r from public.rate_card_programmes where id = p_prog;
  if r.id is null then raise exception 'Programme not found'; end if;
  if r.status in ('approved', 'published') then raise exception 'This programme is % and can''t be changed', r.status; end if;
  return r;
end $$;

create or replace function public.rate_card_programme_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._rcp_require_builder();
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name the programme'; end if;
  insert into public.rate_card_programmes (name, year, market, currency, fee_percent, cap_percent, winner_band_percent, min_coverage_percent, saving_high_percent, price_decimals, notes)
  values (trim(p->>'name'), coalesce(nullif(p->>'year', '')::int, extract(year from now())::int + 1), nullif(upper(trim(p->>'market')), ''),
          upper(coalesce(nullif(trim(p->>'currency'), ''), 'EUR')), coalesce(nullif(p->>'fee_percent', '')::numeric, 5), coalesce(nullif(p->>'cap_percent', '')::numeric, 50),
          coalesce(nullif(p->>'winner_band_percent', '')::numeric, 5), coalesce(nullif(p->>'min_coverage_percent', '')::numeric, 61),
          coalesce(nullif(p->>'saving_high_percent', '')::numeric, 40), coalesce(nullif(p->>'price_decimals', '')::int, 2), nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.rate_card_programme_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._rcp_require_builder();
  perform public._rcp_open(p_id);
  update public.rate_card_programmes set
    name = coalesce(nullif(trim(p->>'name'), ''), name), year = coalesce(nullif(p->>'year', '')::int, year),
    market = case when p ? 'market' then nullif(upper(trim(p->>'market')), '') else market end,
    currency = coalesce(nullif(upper(trim(p->>'currency')), ''), currency),
    fee_percent = coalesce(nullif(p->>'fee_percent', '')::numeric, fee_percent), cap_percent = coalesce(nullif(p->>'cap_percent', '')::numeric, cap_percent),
    winner_band_percent = coalesce(nullif(p->>'winner_band_percent', '')::numeric, winner_band_percent),
    min_coverage_percent = coalesce(nullif(p->>'min_coverage_percent', '')::numeric, min_coverage_percent),
    saving_high_percent = coalesce(nullif(p->>'saving_high_percent', '')::numeric, saving_high_percent),
    price_decimals = coalesce(nullif(p->>'price_decimals', '')::int, price_decimals),
    notes = case when p ? 'notes' then nullif(trim(p->>'notes'), '') else notes end, updated_at = now()
  where id = p_id;
end $$;

-- draft -> bidding -> review, and back while nothing is approved.
create or replace function public.rate_card_programme_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_programmes;
begin
  perform public._rcp_require_builder();
  r := public._rcp_open(p_id);
  if p_status not in ('draft', 'bidding', 'review') then raise exception 'Choose draft, bidding or review'; end if;
  if p_status in ('bidding', 'review') and not exists (select 1 from public.rate_card_items where programme_id = p_id) then raise exception 'Add items first'; end if;
  if p_status = 'review' and not exists (select 1 from public.rate_card_bids b join public.rate_card_items i on i.id = b.item_id where i.programme_id = p_id) then raise exception 'Add supplier bids before review'; end if;
  update public.rate_card_programmes set status = p_status, updated_at = now() where id = p_id;
end $$;

create or replace function public._rcp_num(p text) returns numeric language sql immutable as $$
  select case when nullif(trim(replace(coalesce(p, ''), ',', '')), '') ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(replace(p, ',', ''))::numeric end;
$$;

-- Items from rows: {product_type, product_code, subcode, channel, category, spec_detail, uom, qty_min, qty_max, baseline_price, baseline_match, baseline_qty}.
-- An existing sub-code is updated. Rows with a problem are skipped and reported, with their position.
create or replace function public.rate_card_items_import(p_prog uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; v_new int := 0; v_upd int := 0; v_err jsonb := '[]'::jsonb; v_sub text; v_ch text; v_min numeric; v_max numeric; v_bp numeric; v_match text; v_id uuid; v_sort int;
begin
  perform public._rcp_require_builder();
  perform public._rcp_open(p_prog);
  select coalesce(max(sort), 0) into v_sort from public.rate_card_items where programme_id = p_prog;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1;
    v_sub := nullif(trim(x->>'subcode'), '');
    v_ch := case lower(trim(coalesce(x->>'channel', ''))) when 'dt' then 'DT' when 'mt' then 'MT' when '' then 'Both' when 'both' then 'Both' else null end;
    v_min := public._rcp_num(x->>'qty_min'); v_max := public._rcp_num(x->>'qty_max'); v_bp := public._rcp_num(x->>'baseline_price');
    v_match := case lower(trim(coalesce(x->>'baseline_match', ''))) when 'py' then 'PY' when 'similar' then 'Similar' when 'exact' then 'Exact' else null end;
    if v_sub is null then v_err := v_err || jsonb_build_object('row', n, 'problem', 'No sub-code'); continue; end if;
    if nullif(trim(x->>'product_type'), '') is null then v_err := v_err || jsonb_build_object('row', n, 'subcode', v_sub, 'problem', 'No product type'); continue; end if;
    if v_ch is null then v_err := v_err || jsonb_build_object('row', n, 'subcode', v_sub, 'problem', 'Channel must be DT, MT or Both'); continue; end if;
    if v_min is not null and v_max is not null and v_max < v_min then v_err := v_err || jsonb_build_object('row', n, 'subcode', v_sub, 'problem', 'Largest quantity is below the smallest'); continue; end if;
    select id into v_id from public.rate_card_items where programme_id = p_prog and subcode = v_sub;
    if v_id is null then
      v_sort := v_sort + 1;
      insert into public.rate_card_items (programme_id, product_type, product_code, subcode, channel, category, spec_detail, uom, qty_min, qty_max, baseline_price, baseline_match, baseline_qty, sort)
      values (p_prog, trim(x->>'product_type'), nullif(trim(x->>'product_code'), ''), v_sub, v_ch, nullif(trim(x->>'category'), ''), nullif(trim(x->>'spec_detail'), ''), nullif(trim(x->>'uom'), ''),
              v_min, v_max, v_bp, v_match, coalesce(public._rcp_num(x->>'baseline_qty'), 0), v_sort);
      v_new := v_new + 1;
    else
      update public.rate_card_items set product_type = trim(x->>'product_type'), product_code = nullif(trim(x->>'product_code'), ''), channel = v_ch,
        category = nullif(trim(x->>'category'), ''), spec_detail = nullif(trim(x->>'spec_detail'), ''), uom = nullif(trim(x->>'uom'), ''),
        qty_min = v_min, qty_max = v_max, baseline_price = v_bp, baseline_match = v_match, baseline_qty = coalesce(public._rcp_num(x->>'baseline_qty'), 0)
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
  end loop;
  update public.rate_card_programmes set updated_at = now() where id = p_prog;
  return jsonb_build_object('added', v_new, 'updated', v_upd, 'skipped', jsonb_array_length(v_err), 'problems', v_err);
end $$;

-- Bids from rows: {subcode, supplier, price, note}. The supplier is matched to SRM by code or name. A supplier that is not in SRM is kept
-- by the name given and reported, so the analysis still works and someone can onboard them.
create or replace function public.rate_card_bids_import(p_prog uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; v_new int := 0; v_upd int := 0; v_err jsonb := '[]'::jsonb; v_not_srm jsonb := '[]'::jsonb;
        v_item uuid; v_sup uuid; v_label text; v_price numeric; v_bid uuid;
begin
  perform public._rcp_require_builder();
  perform public._rcp_open(p_prog);
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1;
    v_label := nullif(trim(x->>'supplier'), ''); v_price := public._rcp_num(x->>'price');
    select id into v_item from public.rate_card_items where programme_id = p_prog and subcode = nullif(trim(x->>'subcode'), '');
    if v_item is null then v_err := v_err || jsonb_build_object('row', n, 'subcode', x->>'subcode', 'problem', 'No item with this sub-code in the programme'); continue; end if;
    if v_label is null then v_err := v_err || jsonb_build_object('row', n, 'subcode', x->>'subcode', 'problem', 'No supplier'); continue; end if;
    if v_price is null or v_price <= 0 then v_err := v_err || jsonb_build_object('row', n, 'subcode', x->>'subcode', 'problem', 'Price must be above zero'); continue; end if;
    select id into v_sup from public.suppliers where lower(supplier_code) = lower(v_label) or lower(name) = lower(v_label) limit 1;
    if v_sup is null and not v_not_srm @> to_jsonb(v_label) then v_not_srm := v_not_srm || to_jsonb(v_label); end if;
    select id into v_bid from public.rate_card_bids where item_id = v_item and lower(supplier_label) = lower(v_label);
    if v_bid is null then
      insert into public.rate_card_bids (item_id, supplier_id, supplier_label, price, note) values (v_item, v_sup, v_label, v_price, nullif(trim(x->>'note'), ''));
      v_new := v_new + 1;
    else
      update public.rate_card_bids set price = v_price, supplier_id = coalesce(v_sup, supplier_id), note = nullif(trim(x->>'note'), '') where id = v_bid;
      v_upd := v_upd + 1;
    end if;
  end loop;
  update public.rate_card_programmes set updated_at = now() where id = p_prog;
  return jsonb_build_object('added', v_new, 'updated', v_upd, 'skipped', jsonb_array_length(v_err), 'problems', v_err, 'not_in_srm', v_not_srm);
end $$;

-- Choose which bid prices an item (the buyer's judgement). A bid that is not the lowest needs a reason. null resets to the lowest bid.
create or replace function public.rate_card_item_select_bid(p_item uuid, p_bid uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.rate_card_items; v_low numeric; v_price numeric;
begin
  perform public._rcp_require_builder();
  select * into i from public.rate_card_items where id = p_item;
  if i.id is null then raise exception 'Item not found'; end if;
  perform public._rcp_open(i.programme_id);
  if p_bid is null then
    update public.rate_card_items set selected_bid = null, selection_reason = null where id = p_item;
    return;
  end if;
  select price into v_price from public.rate_card_bids where id = p_bid and item_id = p_item;
  if v_price is null then raise exception 'That bid is not on this item'; end if;
  select min(price) into v_low from public.rate_card_bids where item_id = p_item;
  if v_price > v_low and coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are not taking the lowest bid'; end if;
  update public.rate_card_items set selected_bid = p_bid, selection_reason = case when v_price > v_low then trim(p_reason) else null end where id = p_item;
end $$;

-- The analysis: one row per item with the prices, savings and flags, and a summary. Read only.
create or replace function public.rate_card_programme_analysis(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.rate_card_programmes; v_rows jsonb; v_sum jsonb; v_scale numeric;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card programmes' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.id is null then raise exception 'Programme not found'; end if;
  v_scale := power(10, g.price_decimals);


  with b as (
    select i.id as item_id, count(x.id) as n, min(x.price) as lowest, avg(x.price) as ref_avg
      from public.rate_card_items i left join public.rate_card_bids x on x.item_id = i.id where i.programme_id = p_prog group by i.id
  ), capped as (
    select b.item_id, avg(x.price) as capped_avg
      from b join public.rate_card_bids x on x.item_id = b.item_id
     where x.price between b.ref_avg * (1 - g.cap_percent / 100) and b.ref_avg * (1 + g.cap_percent / 100) group by b.item_id
  ), base as (
    select i.*, b.n, b.lowest, b.ref_avg, c.capped_avg, sb.price as chosen_price, sb.supplier_label as chosen_supplier,
           coalesce(sb.price, b.lowest) as use_price
      from public.rate_card_items i join b on b.item_id = i.id left join capped c on c.item_id = i.id
      left join public.rate_card_bids sb on sb.id = i.selected_bid
     where i.programme_id = p_prog
  ), priced as (
    select base.*,
           case when use_price is not null then floor(use_price * v_scale) / v_scale end as buy,
           case when use_price is not null then ceil(floor(use_price * v_scale) / v_scale * (1 + g.fee_percent / 100) * v_scale) / v_scale end as sell
      from base
  ), scored as (
    select priced.*,
           case when baseline_price is not null and baseline_price > 0 and sell is not null then 'ref'
                when capped_avg is not null and buy is not null then 'market' end as saving_type,
           lag(sell) over (partition by coalesce(product_code, product_type) order by qty_min nulls first, sort) as prev_sell
      from priced
  ), final as (
    select scored.*,
           case saving_type when 'ref' then (baseline_price - sell) / baseline_price * 100
                            when 'market' then (capped_avg - buy) / capped_avg * 100 end as saving_pct,
           case saving_type when 'ref' then (baseline_price - sell) * baseline_qty
                            when 'market' then (capped_avg - buy) * baseline_qty end as saving_amount
      from scored
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'subcode', f.subcode, 'product_type', f.product_type, 'product_code', f.product_code, 'channel', f.channel, 'category', f.category,
      'uom', f.uom, 'qty_min', f.qty_min, 'qty_max', f.qty_max, 'spec_detail', f.spec_detail, 'baseline_price', f.baseline_price, 'baseline_match', f.baseline_match, 'baseline_qty', f.baseline_qty,
      'bids', f.n, 'lowest', f.lowest, 'market_avg', round(f.ref_avg, 4), 'market_avg_capped', round(f.capped_avg, 4),
      'selected_bid', f.selected_bid, 'selected_supplier', f.chosen_supplier, 'selection_reason', f.selection_reason,
      'bid_list', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'supplier', x.supplier_label, 'price', x.price, 'in_srm', x.supplier_id is not null) order by x.price, x.supplier_label)
                              from public.rate_card_bids x where x.item_id = f.id), '[]'::jsonb),
      'buy', f.buy, 'sell', f.sell, 'saving_type', f.saving_type, 'saving_pct', round(f.saving_pct, 1), 'saving_amount', round(f.saving_amount, 2),
      'winners', coalesce((select jsonb_agg(x.supplier_label order by x.price) from public.rate_card_bids x where x.item_id = f.id and f.use_price is not null and x.price <= f.use_price * (1 + g.winner_band_percent / 100)), '[]'::jsonb),
      'flags', to_jsonb(array_remove(array[
        case when f.n = 0 then 'no_bids' end,
        case when f.n = 1 then 'single_bid' end,
        case when f.saving_type = 'ref' and f.sell > f.baseline_price then 'price_up' end,
        case when f.saving_pct > g.saving_high_percent then 'saving_high' end,
        case when f.prev_sell is not null and f.sell is not null and f.sell > f.prev_sell then 'tier_check' end,
        case when f.chosen_price is not null and f.chosen_price > f.lowest then 'not_lowest' end,
        case when f.baseline_price is null and f.n > 0 then 'no_baseline' end], null))
    ) order by f.sort) from final f), '[]'::jsonb),
    (select jsonb_build_object(
      'items', count(*), 'with_bids', count(*) filter (where n > 0), 'with_price', count(*) filter (where sell is not null),
      'baseline_spend', coalesce(sum(baseline_price * baseline_qty), 0),
      'covered_spend', coalesce(sum(baseline_price * baseline_qty) filter (where sell is not null), 0),
      'saving_amount', coalesce(round(sum(saving_amount), 2), 0),
      'no_bids', count(*) filter (where n = 0), 'single_bid', count(*) filter (where n = 1),
      'price_up', count(*) filter (where saving_type = 'ref' and sell > baseline_price),
      'saving_high', count(*) filter (where saving_pct > g.saving_high_percent),
      'tier_check', count(*) filter (where prev_sell is not null and sell is not null and sell > prev_sell),
      'not_lowest', count(*) filter (where chosen_price is not null and chosen_price > lowest)
    ) from final)
  into v_rows, v_sum;

  v_sum := v_sum || jsonb_build_object(
    'coverage_percent', case when (v_sum->>'baseline_spend')::numeric > 0 then round((v_sum->>'covered_spend')::numeric / (v_sum->>'baseline_spend')::numeric * 100, 1)
                             when (v_sum->>'items')::int > 0 then round((v_sum->>'with_price')::numeric / (v_sum->>'items')::numeric * 100, 1) else 0 end,
    'coverage_basis', case when (v_sum->>'baseline_spend')::numeric > 0 then 'spend' else 'items' end);
  v_sum := v_sum || jsonb_build_object('meets_coverage', (v_sum->>'coverage_percent')::numeric >= g.min_coverage_percent, 'min_coverage', g.min_coverage_percent);
  return jsonb_build_object('rows', v_rows, 'summary', v_sum);
end $$;

revoke execute on function public._rcp_require_builder(), public._rcp_open(uuid), public._rcp_num(text) from public, anon, authenticated;
revoke execute on function public.rate_card_programme_create(jsonb), public.rate_card_programme_update(uuid, jsonb), public.rate_card_programme_set_status(uuid, text),
  public.rate_card_items_import(uuid, jsonb), public.rate_card_bids_import(uuid, jsonb), public.rate_card_item_select_bid(uuid, uuid, text),
  public.rate_card_programme_analysis(uuid) from public, anon;
grant execute on function public.rate_card_programme_create(jsonb), public.rate_card_programme_update(uuid, jsonb), public.rate_card_programme_set_status(uuid, text),
  public.rate_card_items_import(uuid, jsonb), public.rate_card_bids_import(uuid, jsonb), public.rate_card_item_select_bid(uuid, uuid, text),
  public.rate_card_programme_analysis(uuid) to authenticated;
