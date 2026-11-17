-- Rate card programmes go out to vendors like an RFQ. The sourcing team sets a deadline and invites eligible vendors; each vendor is notified,
-- opens the programme in its own portal, and prices its items and quantity tiers. Bids are sealed: the team sees vendor prices only once the
-- deadline has passed or every invited vendor has responded, and a vendor never sees last year's price or anyone else's bid.

alter table public.rate_card_programmes add column bid_deadline timestamptz;
alter table public.rate_card_bids add column source text not null default 'import' check (source in ('import', 'vendor'));

create table public.rate_card_invites (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.rate_card_programmes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'viewed', 'submitted', 'declined')),
  invited_by uuid references public.profiles(id) on delete set null default auth.uid(),
  invited_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  decline_reason text,
  unique (programme_id, supplier_id)
);
alter table public.rate_card_invites enable row level security;
create policy rcinv_read on public.rate_card_invites for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_invites from authenticated, anon;

-- Vendor bids are visible to the team once the deadline has passed, once every invited vendor has responded, or when nobody was invited.
create or replace function public._rcp_bids_open(p_prog uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.rate_card_invites where programme_id = p_prog)
      or coalesce((select bid_deadline <= now() from public.rate_card_programmes where id = p_prog), false)
      or not exists (select 1 from public.rate_card_invites where programme_id = p_prog and status in ('invited', 'viewed'));
$$;
revoke execute on function public._rcp_bids_open(uuid) from public, anon, authenticated;

create or replace function public.rate_card_programme_set_deadline(p_prog uuid, p_deadline timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._rcp_require_builder();
  perform public._rcp_open(p_prog);
  if p_deadline is not null and p_deadline <= now() then raise exception 'The deadline must be in the future'; end if;
  update public.rate_card_programmes set bid_deadline = p_deadline, updated_at = now() where id = p_prog;
end $$;

-- Invite eligible vendors. Draft becomes bidding. Each vendor is told in the portal and by email.
create or replace function public.rate_card_programme_invite(p_prog uuid, p_suppliers uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare g public.rate_card_programmes; s public.suppliers; v uuid; n int := 0; v_items int;
begin
  perform public._rcp_require_builder();
  g := public._rcp_open(p_prog);
  select count(*) into v_items from public.rate_card_items where programme_id = p_prog;
  if v_items = 0 then raise exception 'Add items before inviting vendors'; end if;
  if g.bid_deadline is null or g.bid_deadline <= now() then raise exception 'Set a deadline in the future before inviting vendors'; end if;
  if coalesce(array_length(p_suppliers, 1), 0) = 0 then raise exception 'Choose at least one vendor'; end if;
  foreach v in array p_suppliers loop
    select * into s from public.suppliers where id = v;
    if s.id is null then raise exception 'Supplier not found'; end if;
    if not s.active or s.purchasing_blocked then raise exception '% is not eligible in SRM (inactive or blocked for purchasing)', s.name; end if;
    if exists (select 1 from public.rate_card_invites where programme_id = p_prog and supplier_id = v) then continue; end if;
    insert into public.rate_card_invites (programme_id, supplier_id) values (p_prog, v);
    perform public.notify_supplier(v, 'vendor', 'Rate card pricing requested: ' || g.name, 'Please price ' || v_items || ' items by ' || to_char(g.bid_deadline, 'DD Mon YYYY HH24:MI') || '.', '/vendor/rate-cards');
    if s.primary_contact_email is not null then
      insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
      values (s.primary_contact_email, 'Rate card pricing requested: ' || g.name,
              format('You have been invited to price the %s rate card (%s items). Prices are sealed and due by %s. Open your vendor portal to respond.', g.name, v_items, to_char(g.bid_deadline, 'DD Mon YYYY HH24:MI')), s.id, auth.uid());
    end if;
    n := n + 1;
  end loop;
  update public.rate_card_programmes set status = 'bidding', updated_at = now() where id = p_prog and status = 'draft';
  return n;
end $$;

create or replace function public.rate_card_invites_list(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card programmes' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', i.supplier_id, 'supplier_name', s.name, 'status', i.status, 'invited_at', i.invited_at, 'viewed_at', i.viewed_at,
      'responded_at', i.responded_at, 'decline_reason', i.decline_reason,
      'priced', (select count(*) from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = p_prog and b.supplier_id = i.supplier_id and b.source = 'vendor')
    ) order by s.name), '[]'::jsonb) into v_out
    from public.rate_card_invites i join public.suppliers s on s.id = i.supplier_id where i.programme_id = p_prog;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The vendor's side
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vendor_rate_card_programmes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'code', g.code, 'name', g.name, 'year', g.year, 'market', g.market, 'currency', g.currency, 'deadline', g.bid_deadline,
      'invite_status', i.status, 'closed', (g.status <> 'bidding' or g.bid_deadline <= now()),
      'items', (select count(*) from public.rate_card_items it where it.programme_id = g.id),
      'priced', (select count(*) from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = g.id and b.supplier_id = v_sup)
    ) order by g.bid_deadline desc nulls last), '[]'::jsonb) into v_out
    from public.rate_card_invites i join public.rate_card_programmes g on g.id = i.programme_id
   where i.supplier_id = v_sup and g.status in ('bidding', 'review', 'approved', 'published');
  return v_out;
end $$;

-- The items to price, with the vendor's own price only. Opening it marks the invitation as viewed.
create or replace function public.vendor_rate_card_items(p_prog uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); g public.rate_card_programmes; i public.rate_card_invites; v_items jsonb;
begin
  select * into i from public.rate_card_invites where programme_id = p_prog and supplier_id = v_sup;
  if i.id is null then raise exception 'Rate card programme not found' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  if i.status = 'invited' then update public.rate_card_invites set status = 'viewed', viewed_at = now() where id = i.id; i.status := 'viewed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', it.id, 'subcode', it.subcode, 'product_type', it.product_type, 'product_code', it.product_code, 'channel', it.channel, 'category', it.category,
      'uom', it.uom, 'qty_min', it.qty_min, 'qty_max', it.qty_max, 'spec_detail', it.spec_detail,
      'price', (select b.price from public.rate_card_bids b where b.item_id = it.id and b.supplier_id = v_sup)
    ) order by it.sort), '[]'::jsonb) into v_items
    from public.rate_card_items it where it.programme_id = p_prog;
  return jsonb_build_object('programme', jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'year', g.year, 'market', g.market, 'currency', g.currency,
    'deadline', g.bid_deadline, 'decimals', g.price_decimals, 'closed', (g.status <> 'bidding' or g.bid_deadline <= now())), 'invite_status', i.status, 'decline_reason', i.decline_reason, 'items', v_items);
end $$;

-- Save prices. p_prices: [{item_id, price}]; an empty price removes the vendor's price on that item. A final submission tells the team.
create or replace function public.vendor_rate_card_submit(p_prog uuid, p_prices jsonb, p_final boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); g public.rate_card_programmes; i public.rate_card_invites; s public.suppliers; x jsonb;
        v_item uuid; v_price numeric; v_saved int := 0; v_cleared int := 0; v_total int;
begin
  select * into i from public.rate_card_invites where programme_id = p_prog and supplier_id = v_sup for update;
  if i.id is null then raise exception 'Rate card programme not found' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.status <> 'bidding' or g.bid_deadline <= now() then raise exception 'Pricing for this programme has closed'; end if;
  if i.status = 'declined' then raise exception 'You have declined this request'; end if;
  select * into s from public.suppliers where id = v_sup;
  for x in select * from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    select id into v_item from public.rate_card_items where id = nullif(x->>'item_id', '')::uuid and programme_id = p_prog;
    if v_item is null then raise exception 'A price refers to an item that is not in this programme'; end if;
    v_price := public._rcp_num(x->>'price');
    if v_price is null then
      delete from public.rate_card_bids where item_id = v_item and supplier_id = v_sup;
      v_cleared := v_cleared + 1;
    else
      if v_price <= 0 then raise exception 'Prices must be above zero'; end if;
      update public.rate_card_bids set price = v_price, source = 'vendor', supplier_label = s.name where item_id = v_item and supplier_id = v_sup;
      if not found then
        insert into public.rate_card_bids (item_id, supplier_id, supplier_label, price, source) values (v_item, v_sup, s.name, v_price, 'vendor')
        on conflict (item_id, supplier_label) do update set price = excluded.price, supplier_id = excluded.supplier_id, source = 'vendor';
      end if;
      v_saved := v_saved + 1;
    end if;
  end loop;
  select count(*) into v_total from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = p_prog and b.supplier_id = v_sup;
  if p_final then
    if v_total = 0 then raise exception 'Price at least one item before you send'; end if;
    update public.rate_card_invites set status = 'submitted', responded_at = now() where id = i.id;
    perform public.notify(g.created_by, 'sourcing', s.name || ' sent prices for ' || g.name, v_total || ' items priced.', '/sourcing/rate-cards/programmes/' || g.id || '?tab=vendors');
  end if;
  return jsonb_build_object('saved', v_saved, 'cleared', v_cleared, 'priced', v_total, 'submitted', p_final);
end $$;

create or replace function public.vendor_rate_card_decline(p_prog uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); g public.rate_card_programmes; i public.rate_card_invites; s public.suppliers;
begin
  select * into i from public.rate_card_invites where programme_id = p_prog and supplier_id = v_sup for update;
  if i.id is null then raise exception 'Rate card programme not found' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.status <> 'bidding' or g.bid_deadline <= now() then raise exception 'Pricing for this programme has closed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are declining'; end if;
  select * into s from public.suppliers where id = v_sup;
  update public.rate_card_invites set status = 'declined', responded_at = now(), decline_reason = trim(p_reason) where id = i.id;
  delete from public.rate_card_bids b using public.rate_card_items it where b.item_id = it.id and it.programme_id = p_prog and b.supplier_id = v_sup and b.source = 'vendor';
  perform public.notify(g.created_by, 'sourcing', s.name || ' declined to price ' || g.name, left(trim(p_reason), 140), '/sourcing/rate-cards/programmes/' || g.id || '?tab=vendors');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The team's analysis, with vendor bids sealed until they open. Same analysis as before; the summary also says how many are sealed.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.rate_card_item_select_bid(p_item uuid, p_bid uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.rate_card_items; v_low numeric; v_price numeric; v_source text; v_open boolean;
begin
  perform public._rcp_require_builder();
  select * into i from public.rate_card_items where id = p_item;
  if i.id is null then raise exception 'Item not found'; end if;
  perform public._rcp_open(i.programme_id);
  v_open := public._rcp_bids_open(i.programme_id);
  if p_bid is null then
    update public.rate_card_items set selected_bid = null, selection_reason = null where id = p_item;
    return;
  end if;
  select price, source into v_price, v_source from public.rate_card_bids where id = p_bid and item_id = p_item;
  if v_price is null then raise exception 'That bid is not on this item'; end if;
  if v_source = 'vendor' and not v_open then raise exception 'Vendor prices are sealed until the deadline or until every vendor has responded'; end if;
  select min(price) into v_low from public.rate_card_bids where item_id = p_item and (source = 'import' or v_open);
  if v_price > v_low and coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are not taking the lowest bid'; end if;
  update public.rate_card_items set selected_bid = p_bid, selection_reason = case when v_price > v_low then trim(p_reason) else null end where id = p_item;
end $$;

create or replace function public.rate_card_programme_analysis(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.rate_card_programmes; v_rows jsonb; v_sum jsonb; v_scale numeric; v_open boolean; v_sealed int;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card programmes' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.id is null then raise exception 'Programme not found'; end if;
  v_scale := power(10, g.price_decimals);
  v_open := public._rcp_bids_open(p_prog);
  select count(*) into v_sealed from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = p_prog and b.source = 'vendor' and not v_open;

  with bx as (
    select x.* from public.rate_card_bids x join public.rate_card_items it on it.id = x.item_id
     where it.programme_id = p_prog and (x.source = 'import' or v_open)
  ), b as (
    select i.id as item_id, count(x.id) as n, min(x.price) as lowest, avg(x.price) as ref_avg
      from public.rate_card_items i left join bx x on x.item_id = i.id where i.programme_id = p_prog group by i.id
  ), capped as (
    select b.item_id, avg(x.price) as capped_avg
      from b join bx x on x.item_id = b.item_id
     where x.price between b.ref_avg * (1 - g.cap_percent / 100) and b.ref_avg * (1 + g.cap_percent / 100) group by b.item_id
  ), base as (
    select i.*, b.n, b.lowest, b.ref_avg, c.capped_avg, sb.price as chosen_price, sb.supplier_label as chosen_supplier,
           coalesce(sb.price, b.lowest) as use_price
      from public.rate_card_items i join b on b.item_id = i.id left join capped c on c.item_id = i.id
      left join bx sb on sb.id = i.selected_bid
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
      'bid_list', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'supplier', x.supplier_label, 'price', x.price, 'in_srm', x.supplier_id is not null, 'source', x.source) order by x.price, x.supplier_label)
                              from bx x where x.item_id = f.id), '[]'::jsonb),
      'buy', f.buy, 'sell', f.sell, 'saving_type', f.saving_type, 'saving_pct', round(f.saving_pct, 1), 'saving_amount', round(f.saving_amount, 2),
      'winners', coalesce((select jsonb_agg(x.supplier_label order by x.price) from bx x where x.item_id = f.id and f.use_price is not null and x.price <= f.use_price * (1 + g.winner_band_percent / 100)), '[]'::jsonb),
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
  v_sum := v_sum || jsonb_build_object('meets_coverage', (v_sum->>'coverage_percent')::numeric >= g.min_coverage_percent, 'min_coverage', g.min_coverage_percent,
    'bids_open', v_open, 'sealed_bids', v_sealed, 'deadline', g.bid_deadline);
  return jsonb_build_object('rows', v_rows, 'summary', v_sum);
end $$;

revoke execute on function public.rate_card_programme_set_deadline(uuid, timestamptz), public.rate_card_programme_invite(uuid, uuid[]), public.rate_card_invites_list(uuid),
  public.vendor_rate_card_programmes(), public.vendor_rate_card_items(uuid), public.vendor_rate_card_submit(uuid, jsonb, boolean), public.vendor_rate_card_decline(uuid, text) from public, anon;
grant execute on function public.rate_card_programme_set_deadline(uuid, timestamptz), public.rate_card_programme_invite(uuid, uuid[]), public.rate_card_invites_list(uuid),
  public.vendor_rate_card_programmes(), public.vendor_rate_card_items(uuid), public.vendor_rate_card_submit(uuid, jsonb, boolean), public.vendor_rate_card_decline(uuid, text) to authenticated;
