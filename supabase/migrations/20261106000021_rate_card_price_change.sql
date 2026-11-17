-- A price change on a rate card, from Sourcing. It is a new version of the governed library record (a different governor approves it,
-- the old version ends the day before it starts). The Impact Grade does not depend on the price, so the card's grade and review carry over
-- to the new version and it can be chosen as soon as it is approved.

create or replace function public.rate_card_change_price(p_card uuid, p_price numeric, p_from date default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.library_records; v_new uuid;
begin
  select * into r from public.library_records where id = p_card and library_key = 'rate_cards';
  if r.id is null then raise exception 'Rate card not found'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Give the new unit price'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why the price changes'; end if;
  v_new := public.library_supersede(p_card, r.name, jsonb_set(r.data, '{unit_price}', to_jsonb(p_price)), coalesce(p_from, current_date + 1), trim(p_note));
  insert into public.rate_card_grades (card_id, score, letter, coverage, confidence, range_low, range_high, pef_mpt, supplier_score,
    inputs, tiers, sub_scores, warnings, review_status, reviewed_by, reviewed_at, review_note, updated_by)
  select v_new, score, letter, coverage, confidence, range_low, range_high, pef_mpt, supplier_score,
         inputs, tiers, sub_scores, warnings, review_status, reviewed_by, reviewed_at, review_note, updated_by
    from public.rate_card_grades where card_id = p_card;
  return v_new;
end $$;
revoke execute on function public.rate_card_change_price(uuid, numeric, date, text) from public, anon;
grant execute on function public.rate_card_change_price(uuid, numeric, date, text) to authenticated;
