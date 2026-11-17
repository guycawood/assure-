-- Awarding, approving and locking a rate card programme.
--   Awards   an item can be held by one vendor or split between several by percentage (shares add up to 100). Each awarded vendor is bound
--            to its own buy price; the sell price (buy plus the fee) is for the client.
--   Approval a different sourcing lead from the one who sent it for review approves. It needs validity dates, open (unsealed) bids, coverage at or
--            above the minimum, every priced item awarded, and a note when checks are still open. Approval locks the prices and tells each vendor.
-- The awards of approved programmes are the price list buyers reorder from. Each award carries a contract status for the contract step.

alter table public.rate_card_programmes
  add column valid_from date, add column valid_to date,
  add column submitted_by uuid references public.profiles(id) on delete set null, add column submitted_at timestamptz,
  add column approved_by uuid references public.profiles(id) on delete set null, add column approved_at timestamptz, add column approval_note text;

create table public.rate_card_awards (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rate_card_items(id) on delete cascade,
  bid_id uuid references public.rate_card_bids(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_label text not null,
  share_percent numeric(5,2) not null check (share_percent > 0 and share_percent <= 100),
  buy_price numeric not null check (buy_price > 0),
  sell_price numeric not null check (sell_price > 0),
  contract_status text not null default 'pending' check (contract_status in ('pending', 'agreed')),
  awarded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  awarded_at timestamptz not null default now(),
  unique (item_id, supplier_label)
);
alter table public.rate_card_awards enable row level security;
create policy rca_read on public.rate_card_awards for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_awards from authenticated, anon;

create or replace function public._rcp_buy(p numeric, p_dec int) returns numeric language sql immutable as $$ select floor(p * power(10, p_dec)) / power(10, p_dec); $$;
create or replace function public._rcp_sell(p_buy numeric, p_fee numeric, p_dec int) returns numeric language sql immutable as $$ select ceil(p_buy * (1 + p_fee / 100) * power(10, p_dec)) / power(10, p_dec); $$;
revoke execute on function public._rcp_buy(numeric, int), public._rcp_sell(numeric, numeric, int) from public, anon, authenticated;

-- Sending a programme for review records who sent it, so someone else approves.
create or replace function public.rate_card_programme_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_programmes;
begin
  perform public._rcp_require_builder();
  r := public._rcp_open(p_id);
  if p_status not in ('draft', 'bidding', 'review') then raise exception 'Choose draft, bidding or review'; end if;
  if p_status in ('bidding', 'review') and not exists (select 1 from public.rate_card_items where programme_id = p_id) then raise exception 'Add items first'; end if;
  if p_status = 'review' and not exists (select 1 from public.rate_card_bids b join public.rate_card_items i on i.id = b.item_id where i.programme_id = p_id) then raise exception 'Add supplier bids before review'; end if;
  update public.rate_card_programmes set status = p_status, updated_at = now(),
    submitted_by = case when p_status = 'review' then auth.uid() end, submitted_at = case when p_status = 'review' then now() end where id = p_id;
end $$;

create or replace function public.rate_card_programme_set_validity(p_prog uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._rcp_require_builder();
  perform public._rcp_open(p_prog);
  if p_from is null or p_to is null then raise exception 'Give both the start and the end date'; end if;
  if p_to <= p_from then raise exception 'The end date must be after the start date'; end if;
  update public.rate_card_programmes set valid_from = p_from, valid_to = p_to, updated_at = now() where id = p_prog;
end $$;

-- Awards for one item: [{bid_id, share}], shares adding up to 100. Replaces the item's awards.
create or replace function public.rate_card_item_set_awards(p_item uuid, p_awards jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare i public.rate_card_items; g public.rate_card_programmes; x jsonb; v_total numeric := 0; v_share numeric; b public.rate_card_bids; v_buy numeric;
begin
  perform public._rcp_require_builder();
  select * into i from public.rate_card_items where id = p_item;
  if i.id is null then raise exception 'Item not found'; end if;
  g := public._rcp_open(i.programme_id);
  if not public._rcp_bids_open(i.programme_id) then raise exception 'Vendor prices are sealed until the deadline or until every vendor has responded'; end if;
  if jsonb_array_length(coalesce(p_awards, '[]'::jsonb)) = 0 then delete from public.rate_card_awards where item_id = p_item; return; end if;
  for x in select * from jsonb_array_elements(p_awards) loop
    v_share := public._rcp_num(x->>'share');
    if v_share is null or v_share <= 0 then raise exception 'Each share must be above zero'; end if;
    v_total := v_total + v_share;
  end loop;
  if round(v_total, 2) <> 100 then raise exception 'Shares must add up to 100 percent (they add up to % percent)', round(v_total, 2); end if;
  delete from public.rate_card_awards where item_id = p_item;
  for x in select * from jsonb_array_elements(p_awards) loop
    select * into b from public.rate_card_bids where id = nullif(x->>'bid_id', '')::uuid and item_id = p_item;
    if b.id is null then raise exception 'A chosen bid is not on this item'; end if;
    v_buy := public._rcp_buy(b.price, g.price_decimals);
    if v_buy <= 0 then raise exception 'The price rounds to zero at % decimals', g.price_decimals; end if;
    insert into public.rate_card_awards (item_id, bid_id, supplier_id, supplier_label, share_percent, buy_price, sell_price)
    values (p_item, b.id, b.supplier_id, b.supplier_label, public._rcp_num(x->>'share'), v_buy, public._rcp_sell(v_buy, g.fee_percent, g.price_decimals));
  end loop;
end $$;

-- Award every priced item that has no award yet to its chosen (or lowest) bid at 100 percent. Returns how many.
create or replace function public.rate_card_programme_award_lowest(p_prog uuid) returns int
language plpgsql security definer set search_path = public as $$
declare g public.rate_card_programmes; i record; b public.rate_card_bids; n int := 0; v_buy numeric;
begin
  perform public._rcp_require_builder();
  g := public._rcp_open(p_prog);
  if not public._rcp_bids_open(p_prog) then raise exception 'Vendor prices are sealed until the deadline or until every vendor has responded'; end if;
  for i in select * from public.rate_card_items where programme_id = p_prog and not exists (select 1 from public.rate_card_awards a where a.item_id = rate_card_items.id) order by sort loop
    select * into b from public.rate_card_bids where id = i.selected_bid;
    if b.id is null then select * into b from public.rate_card_bids where item_id = i.id order by price, supplier_label limit 1; end if;
    if b.id is null then continue; end if;
    v_buy := public._rcp_buy(b.price, g.price_decimals);
    if v_buy <= 0 then continue; end if;
    insert into public.rate_card_awards (item_id, bid_id, supplier_id, supplier_label, share_percent, buy_price, sell_price)
    values (i.id, b.id, b.supplier_id, b.supplier_label, 100, v_buy, public._rcp_sell(v_buy, g.fee_percent, g.price_decimals));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.rate_card_programme_awards(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card programmes' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'bid_id', a.bid_id, 'supplier_id', a.supplier_id, 'supplier', a.supplier_label,
      'share', a.share_percent, 'buy', a.buy_price, 'sell', a.sell_price, 'contract_status', a.contract_status) order by a.item_id, a.supplier_label), '[]'::jsonb)
    into v_out from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id where i.programme_id = p_prog;
  return v_out;
end $$;

-- Approve and lock. A different sourcing lead from the one who sent it for review.
create or replace function public.rate_card_programme_approve(p_prog uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.rate_card_programmes; s jsonb; v_missing int; v_open_checks int; v_items int; v_vendors int; v_sup record;
begin
  perform public._rcp_require_builder();
  select * into g from public.rate_card_programmes where id = p_prog for update;
  if g.id is null then raise exception 'Programme not found'; end if;
  if g.status <> 'review' then raise exception 'Move the programme to review before approving it'; end if;
  if g.submitted_by is not distinct from auth.uid() then raise exception 'A different sourcing lead must approve this: you sent it for review' using errcode = '42501'; end if;
  if g.valid_from is null or g.valid_to is null then raise exception 'Set the validity dates before approving'; end if;
  if not public._rcp_bids_open(p_prog) then raise exception 'Vendor prices are still sealed'; end if;
  s := (public.rate_card_programme_analysis(p_prog))->'summary';
  if not (s->>'meets_coverage')::boolean then raise exception 'Coverage is % percent, below the minimum of % percent', s->>'coverage_percent', s->>'min_coverage'; end if;
  select count(*) into v_missing from public.rate_card_items i
   where i.programme_id = p_prog and exists (select 1 from public.rate_card_bids b where b.item_id = i.id) and not exists (select 1 from public.rate_card_awards a where a.item_id = i.id);
  if v_missing > 0 then raise exception '% item(s) have bids but no award', v_missing; end if;
  if exists (select 1 from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id where i.programme_id = p_prog and a.bid_id is null) then
    raise exception 'An awarded bid was withdrawn. Award that item again';
  end if;
  v_open_checks := coalesce((s->>'price_up')::int, 0) + coalesce((s->>'tier_check')::int, 0) + coalesce((s->>'saving_high')::int, 0);
  if v_open_checks > 0 and coalesce(trim(p_note), '') = '' then raise exception '% row(s) still have checks open. Say in the note why the programme can be approved', v_open_checks; end if;
  select count(*) into v_items from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id where i.programme_id = p_prog;
  if v_items = 0 then raise exception 'Nothing has been awarded'; end if;
  -- the prices are fixed from the bids as they stand now
  update public.rate_card_awards a set buy_price = public._rcp_buy(b.price, g.price_decimals), sell_price = public._rcp_sell(public._rcp_buy(b.price, g.price_decimals), g.fee_percent, g.price_decimals)
    from public.rate_card_bids b, public.rate_card_items i where a.bid_id = b.id and i.id = a.item_id and i.programme_id = p_prog;
  update public.rate_card_programmes set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), ''), updated_at = now() where id = p_prog;
  v_vendors := 0;
  for v_sup in select a.supplier_id, count(*) as n from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id
                where i.programme_id = p_prog and a.supplier_id is not null group by a.supplier_id loop
    perform public.notify_supplier(v_sup.supplier_id, 'vendor', 'Awarded on rate card ' || g.name, v_sup.n || ' item(s), valid ' || to_char(g.valid_from, 'DD Mon YYYY') || ' to ' || to_char(g.valid_to, 'DD Mon YYYY') || '.', '/vendor/rate-cards/' || g.id);
    v_vendors := v_vendors + 1;
  end loop;
  perform public.notify(g.submitted_by, 'sourcing', 'Rate card approved: ' || g.name, nullif(trim(p_note), ''), '/sourcing/rate-cards/programmes/' || g.id);
  perform public.notify(g.created_by, 'sourcing', 'Rate card approved: ' || g.name, nullif(trim(p_note), ''), '/sourcing/rate-cards/programmes/' || g.id);
  return jsonb_build_object('awarded', v_items, 'vendors', v_vendors);
end $$;

create or replace function public.rate_card_programme_send_back(p_prog uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.rate_card_programmes;
begin
  perform public._rcp_require_builder();
  select * into g from public.rate_card_programmes where id = p_prog for update;
  if g.id is null then raise exception 'Programme not found'; end if;
  if g.status <> 'review' then raise exception 'Only a programme in review can be sent back'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs to change'; end if;
  update public.rate_card_programmes set status = case when exists (select 1 from public.rate_card_invites where programme_id = p_prog) then 'bidding' else 'draft' end,
    submitted_by = null, submitted_at = null, updated_at = now() where id = p_prog;
  perform public.notify(g.submitted_by, 'sourcing', 'Rate card sent back: ' || g.name, left(trim(p_note), 140), '/sourcing/rate-cards/programmes/' || g.id);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The vendor sees what it has been awarded: its own items, share and buy price, and the validity dates. Nothing about other vendors.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vendor_rate_card_awards(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); g public.rate_card_programmes; v_out jsonb;
begin
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.id is null or g.status not in ('approved', 'published') or not exists (select 1 from public.rate_card_invites where programme_id = p_prog and supplier_id = v_sup) then
    return jsonb_build_object('approved', false, 'awards', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('subcode', i.subcode, 'product_type', i.product_type, 'channel', i.channel, 'uom', i.uom, 'qty_min', i.qty_min, 'qty_max', i.qty_max,
      'share', a.share_percent, 'price', a.buy_price, 'contract_status', a.contract_status) order by i.sort), '[]'::jsonb) into v_out
    from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id where i.programme_id = p_prog and a.supplier_id = v_sup;
  return jsonb_build_object('approved', true, 'valid_from', g.valid_from, 'valid_to', g.valid_to, 'currency', g.currency, 'awards', v_out);
end $$;

-- The vendor's programme list now says whether it has been approved and how many items the vendor was awarded.
create or replace function public.vendor_rate_card_programmes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'code', g.code, 'name', g.name, 'year', g.year, 'market', g.market, 'currency', g.currency, 'deadline', g.bid_deadline,
      'invite_status', i.status, 'closed', (g.status <> 'bidding' or g.bid_deadline <= now()), 'approved', g.status in ('approved', 'published'),
      'items', (select count(*) from public.rate_card_items it where it.programme_id = g.id),
      'priced', (select count(*) from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = g.id and b.supplier_id = v_sup),
      'awarded', case when g.status in ('approved', 'published') then (select count(*) from public.rate_card_awards a join public.rate_card_items it on it.id = a.item_id where it.programme_id = g.id and a.supplier_id = v_sup) else 0 end
    ) order by g.bid_deadline desc nulls last), '[]'::jsonb) into v_out
    from public.rate_card_invites i join public.rate_card_programmes g on g.id = i.programme_id
   where i.supplier_id = v_sup and g.status in ('bidding', 'review', 'approved', 'published');
  return v_out;
end $$;

revoke execute on function public.rate_card_programme_set_validity(uuid, date, date), public.rate_card_item_set_awards(uuid, jsonb), public.rate_card_programme_award_lowest(uuid),
  public.rate_card_programme_awards(uuid), public.rate_card_programme_approve(uuid, text), public.rate_card_programme_send_back(uuid, text), public.vendor_rate_card_awards(uuid) from public, anon;
grant execute on function public.rate_card_programme_set_validity(uuid, date, date), public.rate_card_item_set_awards(uuid, jsonb), public.rate_card_programme_award_lowest(uuid),
  public.rate_card_programme_awards(uuid), public.rate_card_programme_approve(uuid, text), public.rate_card_programme_send_back(uuid, text), public.vendor_rate_card_awards(uuid) to authenticated;
