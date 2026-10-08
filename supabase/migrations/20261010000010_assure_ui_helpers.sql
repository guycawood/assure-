-- Assure+ UI helpers: JSON-in wrappers so the app can save records with array fields in one call.
-- These run as the caller (security invoker), so row-level security and the field guards still apply.

create or replace function public.assure_review_save(p_id uuid, p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
  arr_agenda text[] := array(select trim(x) from jsonb_array_elements_text(coalesce(p->'agenda_items', '[]')) x where trim(x) <> '');
  arr_int text[] := array(select trim(x) from jsonb_array_elements_text(coalesce(p->'internal_attendees', '[]')) x where trim(x) <> '');
  arr_ven text[] := array(select trim(x) from jsonb_array_elements_text(coalesce(p->'vendor_attendees', '[]')) x where trim(x) <> '');
begin
  if cardinality(arr_agenda) = 0 then raise exception 'Add at least one agenda item'; end if;
  if p_id is null then
    insert into public.business_reviews (supplier_id, title, description, review_type, meeting_date, status, internal_attendees, vendor_attendees,
      agenda_items, shared_with_vendor, key_outcomes, discussion_notes, overall_sentiment, next_review_date)
    values ((p->>'supplier_id')::uuid, p->>'title', nullif(p->>'description', ''), coalesce(p->>'review_type', 'qbr'), (p->>'meeting_date')::date,
      'scheduled', arr_int, arr_ven, arr_agenda, coalesce((p->>'shared_with_vendor')::boolean, false), nullif(p->>'key_outcomes', ''),
      nullif(p->>'discussion_notes', ''), nullif(p->>'overall_sentiment', ''), nullif(p->>'next_review_date', '')::date)
    returning id into v_id;
  else
    update public.business_reviews set title = p->>'title', description = nullif(p->>'description', ''), review_type = coalesce(p->>'review_type', review_type),
      meeting_date = (p->>'meeting_date')::date, status = coalesce(p->>'status', status), internal_attendees = arr_int, vendor_attendees = arr_ven,
      agenda_items = arr_agenda, shared_with_vendor = coalesce((p->>'shared_with_vendor')::boolean, false), key_outcomes = nullif(p->>'key_outcomes', ''),
      discussion_notes = nullif(p->>'discussion_notes', ''), overall_sentiment = nullif(p->>'overall_sentiment', ''),
      next_review_date = nullif(p->>'next_review_date', '')::date
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Review not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.assure_log_inspection(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into public.quality_inspections (supplier_id, po_reference, product_name, inspection_type, inspection_date, sample_size, defect_count,
    defects_found, aql_level, result, corrective_action_required, corrective_action_notes, internal_notes)
  values ((p->>'supplier_id')::uuid, nullif(p->>'po_reference', ''), nullif(p->>'product_name', ''), coalesce(p->>'inspection_type', 'final'),
    coalesce(nullif(p->>'inspection_date', '')::date, current_date), nullif(p->>'sample_size', '')::int, coalesce(nullif(p->>'defect_count', '')::int, 0),
    array(select trim(x) from jsonb_array_elements_text(coalesce(p->'defects_found', '[]')) x where trim(x) <> ''),
    nullif(p->>'aql_level', ''), coalesce(p->>'result', 'pending'), coalesce((p->>'corrective_action_required')::boolean, false),
    nullif(p->>'corrective_action_notes', ''), nullif(p->>'internal_notes', ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.assure_set_supplier_status_json(p_ids jsonb, p_status text, p_reason text)
returns int language sql security invoker set search_path = public as $$
  select public.assure_set_supplier_status(array(select (x)::uuid from jsonb_array_elements_text(p_ids) x), p_status, p_reason);
$$;

create or replace function public.assure_training_assign_json(p_module uuid, p_users jsonb, p_due date)
returns int language sql security invoker set search_path = public as $$
  select public.assure_training_assign(p_module, array(select (x)::uuid from jsonb_array_elements_text(p_users) x), p_due);
$$;

grant execute on function public.assure_review_save(uuid, jsonb), public.assure_log_inspection(jsonb),
  public.assure_set_supplier_status_json(jsonb, text, text), public.assure_training_assign_json(uuid, jsonb, date) to authenticated;
