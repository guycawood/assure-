-- Choosing a rate card on a spec line (Sourcing+). The triage rule still proposes the nearest card.
-- A sourcing lead can look at every card that could fit the line and pick another one, with a reason.
-- Picking runs through the existing governed override, so the second-lead approval policy still applies.

-- Every live rate card that fits the spec's type, material, currency and client, with the price it would give this line,
-- the route it would take, and whether its supplier can be bought from.
create or replace function public.spec_triage_cards(p_spec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.job_specs; j public.jobs; c public.sourcing_clients; cfg public.sourcing_settings;
  v_sub uuid; v_sub_code text; v_qty int; v_len numeric; v_wid numeric; v_unit text; v_mm numeric; v_area numeric; v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate-card choices' using errcode = '42501'; end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  select * into j from public.jobs where id = s.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into cfg from public.sourcing_settings where id;
  v_sub := coalesce(s.substrate_id, (select substrate_id from public.spec_components
                                     where spec_id = p_spec and not is_packaging and substrate_id is not null
                                     order by sort, created_at limit 1));
  select code into v_sub_code from public.library_records where id = v_sub;
  select coalesce(sum(quantity), 0) into v_qty from public.spec_versions where spec_id = p_spec;
  select finished_length, finished_width into v_len, v_wid from public.spec_versions where spec_id = p_spec order by sort, created_at limit 1;
  v_unit := coalesce(s.size_unit, s.spec_data->>'size_unit');
  v_mm := case v_unit when 'mm' then 1 when 'cm' then 10 when 'in' then 25.4 end;
  v_area := case when v_len is not null and v_wid is not null and v_mm is not null then (v_len * v_mm) * (v_wid * v_mm) end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'code', q.code, 'name', q.name, 'supplier_id', q.supplier_id, 'supplier_name', q.supplier_name,
      'eligible', q.eligible, 'graded', q.graded, 'grade_score', q.g_score, 'grade_letter', q.g_letter, 'grade_confidence', q.g_conf,
      'client_specific', q.client_specific, 'card_price', q.card_price, 'unit_price', q.price,
      'currency', j.currency, 'size_dev', round(q.size_dev, 1), 'qty_ok', q.qty_ok, 'quantity', v_qty,
      'route', case when not q.eligible then null
                    when q.size_dev <= 0.5 and q.qty_ok then 'adopt'
                    when q.size_dev <= cfg.triage_tolerance_percent and q.qty_ok and q.price * v_qty <= cfg.instant_price_limit then 'adapt'
                    else 'push' end
    ) order by q.eligible desc, q.size_dev, q.qty_ok desc, q.client_specific desc, q.price), '[]'::jsonb)
    into v_out
    from (
      select r.id, r.code, r.name, sup.id as supplier_id, sup.name as supplier_name,
             (sup.id is not null and sup.active and not sup.purchasing_blocked) as eligible,
             coalesce(g.review_status = 'reviewed', false) as graded, g.score as g_score, g.letter as g_letter, g.confidence as g_conf,
             (r.data->>'client_code') is not null as client_specific,
             coalesce((r.data->>'unit_price')::numeric, 0) as card_price,
             round(coalesce((r.data->>'unit_price')::numeric, 0) * case when v_area is not null and ca.area is not null and ca.area > 0 then v_area / ca.area else 1 end, 4) as price,
             case when ca.area is null and v_area is null then 0
                  when ca.area is null or v_area is null then 100
                  else abs(v_area - ca.area) / ca.area * 100 end as size_dev,
             (v_qty >= coalesce((r.data->>'min_qty')::int, 0) and (r.data->>'max_qty' is null or v_qty <= (r.data->>'max_qty')::int)) as qty_ok
        from public.library_records r
        cross join lateral (select (r.data->>'finished_length_mm')::numeric * (r.data->>'finished_width_mm')::numeric as area) ca
        left join public.suppliers sup on sup.supplier_code = r.data->>'supplier_code'
        left join public.rate_card_grades g on g.card_id = r.id
       where r.library_key = 'rate_cards' and r.status = 'active'
         and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
         and r.data->>'spec_type' = s.spec_type
         and (r.data->>'client_code' is null or r.data->>'client_code' = c.code)
         and (r.data->>'substrate_code' is null or r.data->>'substrate_code' = v_sub_code)
         and coalesce(r.data->>'currency', j.currency) = j.currency
    ) q;
  return v_out;
end $$;
revoke execute on function public.spec_triage_cards(uuid) from public, anon;
grant execute on function public.spec_triage_cards(uuid) to authenticated;

-- Pick a card. The line is first parked at Create with that card's price, then routed away through spec_triage_override,
-- which applies the sourcing-lead rule and, where the policy says so, opens a second-lead approval. Until it is approved
-- the line stays at Create with the chosen card attached.
create or replace function public.spec_triage_pick_card(p_spec uuid, p_card uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.spec_triage; x jsonb; j public.jobs; v_name text; v_route text;
begin
  if not public.is_internal() then raise exception 'Only internal staff can triage specs' using errcode = '42501'; end if;
  if not public.sourcing_is_lead() then raise exception 'Only a sourcing lead can choose a rate card' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this card is the right one'; end if;
  select * into t from public.spec_triage where spec_id = p_spec and is_current;
  if t.id is null then raise exception 'Run triage on this spec first'; end if;
  if t.route = 'push' and t.push_status = 'accepted' then raise exception 'The supplier has accepted the pushed price; it can''t be changed'; end if;
  select e into x from jsonb_array_elements(public.spec_triage_cards(p_spec)) e where (e->>'id')::uuid = p_card;
  if x is null then raise exception 'That rate card does not fit this spec (type, material, size, currency or client)'; end if;
  if not (x->>'eligible')::boolean then raise exception 'The rate-card supplier is not eligible in SRM; this line needs an RFQ'; end if;
  if not (x->>'graded')::boolean then raise exception 'This rate card has no reviewed Impact Grade yet, so it cannot be chosen'; end if;
  if t.rate_card_id = p_card and t.route <> 'create' then raise exception 'That rate card is already applied to this line'; end if;
  select j2.* into j from public.jobs j2 join public.job_specs s on s.job_id = j2.id where s.id = p_spec;
  v_name := x->>'name'; v_route := x->>'route';
  perform public._triage_insert(p_spec, 'create', 'Rate card "' || v_name || '" chosen: ' || trim(p_reason), greatest(0, 1 - (x->>'size_dev')::numeric / 100), p_card,
    (x->>'unit_price')::numeric, j.currency, (x->>'quantity')::int, null, 'override');
  return public.spec_triage_override(p_spec, v_route, 'Rate card ' || v_name || ': ' || trim(p_reason));
end $$;
revoke execute on function public.spec_triage_pick_card(uuid, uuid, text) from public, anon;
grant execute on function public.spec_triage_pick_card(uuid, uuid, text) to authenticated;
