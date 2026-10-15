-- Briefing → Sourcing: accepting a concept hand-off also seeds a draft spec from the concept, so the buyer no longer
-- re-keys it and triage / AAC rules can route it once it is finished.
--   * Title = concept name; spec type from suggested_spec_type (a type we don't recognise falls back to Custom goods
--     & services on the Ideation spec form, where suppliers propose the spec). Recognised types use the Open form:
--     the concept's dimensions are an indicative creative suggestion, not measured.
--   * Dimensions and unit, the brief's minimum recycled content and FSC requirement, and the concept's creative
--     direction carry over. The substrate the concept named (a Watchtower library record) becomes the body
--     component, so weight, CO2e and Impact Grade can be computed. The taxonomy trigger classifies it as usual.
--   * One seeded spec per hand-off (brief_handoffs.seeded_spec_id). Accepting an already accepted hand-off returns
--     its job and creates nothing.

alter table public.brief_handoffs
  add column if not exists seeded_spec_id uuid references public.job_specs(id) on delete set null;
create unique index if not exists brief_handoffs_seeded_spec_idx on public.brief_handoffs (seeded_spec_id) where seeded_spec_id is not null;

-- A plain positive number from free text ("300", " 120.5 "), else null.
create or replace function public._num_or_null(p text) returns numeric language sql immutable as $$
  select case when trim(coalesce(p, '')) ~ '^[0-9]+(\.[0-9]+)?$' and trim(p)::numeric > 0 then trim(p)::numeric end;
$$;

-- Draft spec on p_job from the hand-off's concept. Returns the spec id (the existing one if already seeded).
create or replace function public._spec_seed_from_handoff(p_handoff uuid, p_job uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  h public.brief_handoffs; b public.briefs; c jsonb; v_type text; v_form text; v_unit text; v_to_cm numeric;
  v_len numeric; v_wid numeric; v_dep numeric; v_sub public.library_records; v_spec uuid; v_size text; v_fsc boolean;
begin
  select * into h from public.brief_handoffs where id = p_handoff for update;
  if h.id is null then raise exception 'Hand-off not found'; end if;
  if h.seeded_spec_id is not null then return h.seeded_spec_id; end if;
  select * into b from public.briefs where id = h.brief_id;
  c := coalesce(h.payload->'concept', '{}'::jsonb);

  v_type := lower(trim(coalesce(c->>'suggested_spec_type', '')));
  if v_type in ('2d','3d','custom_goods_services','design','promo_merch') then
    v_form := 'open';
  else
    v_type := 'custom_goods_services'; v_form := 'ideation';
  end if;

  v_unit := lower(trim(coalesce(c->>'suggested_unit', '')));
  if v_unit not in ('mm','cm','in') then v_unit := null; end if;
  v_to_cm := case v_unit when 'mm' then 0.1 when 'cm' then 1 when 'in' then 2.54 end;
  v_len := public._num_or_null(c->>'suggested_length');
  v_wid := public._num_or_null(c->>'suggested_width');
  v_dep := public._num_or_null(c->>'suggested_depth');
  v_size := nullif(concat_ws(' × ', v_len::text, v_wid::text, v_dep::text), '');
  if v_size is not null then v_size := v_size || coalesce(' ' || v_unit, '') || ' (indicative, from the concept)'; end if;
  v_fsc := coalesce((h.payload->'brief'->>'require_fsc')::boolean, b.require_fsc, false);

  -- The concept's substrate, or the active version of the same library code if that record has since been superseded.
  select * into v_sub from public.library_records
   where library_key = 'substrates' and status = 'active'
     and (id = nullif(h.payload->'substrate'->>'record_id', '')::uuid or code = h.payload->'substrate'->>'code')
   order by (id = nullif(h.payload->'substrate'->>'record_id', '')::uuid) desc, version desc
   limit 1;

  insert into public.job_specs (job_id, title, spec_type, spec_form, is_draft, brief_id, description, size_unit, size_description,
    substrate_id, material, product_category, recycled_content_percent, spec_data)
  values (p_job, left(coalesce(nullif(trim(c->>'name'), ''), b.title), 200), v_type, v_form, true, h.brief_id,
    concat_ws(E'\n',
      'From ideation concept "' || coalesce(nullif(trim(c->>'name'), ''), 'concept') || '" (Briefing ' || coalesce(b.brief_code, '') || ').',
      nullif(trim(c->>'creative_direction'), ''),
      nullif(trim(c->>'rationale'), ''),
      'Seeded as a draft: check the sizes, add quantities and finish the spec before triage.'),
    v_unit, v_size, v_sub.id,
    nullif(concat_ws(' ', coalesce(v_sub.name, nullif(trim(c->>'suggested_substrate_name'), '')), case when v_fsc then '(FSC certified required)' end), ''),
    b.product_category,
    case when (h.payload->'brief'->>'min_recycled_pct')::numeric between 0 and 100 then (h.payload->'brief'->>'min_recycled_pct')::numeric end,
    jsonb_strip_nulls(jsonb_build_object(
      'seeded_from', jsonb_build_object('handoff_id', h.id, 'brief_id', h.brief_id, 'brief_code', b.brief_code,
        'concept_id', h.concept_id, 'concept_name', c->>'name'),
      'suggested_dimensions', jsonb_strip_nulls(jsonb_build_object('length', v_len, 'width', v_wid, 'depth', v_dep, 'unit', v_unit)),
      'require_fsc', v_fsc,
      'min_recycled_pct', (h.payload->'brief'->>'min_recycled_pct')::numeric,
      'eco', c->'eco',
      'basis', 'indicative creative suggestion, not measured')))
  returning id into v_spec;

  if v_sub.id is not null then
    insert into public.spec_components (spec_id, component_name, component_type, substrate_id, quantity_per_unit, area_length_cm, area_width_cm, notes)
    values (v_spec, left(v_sub.name, 200), 'body', v_sub.id, 1,
      case when v_to_cm is not null then round(v_len * v_to_cm, 2) end,
      case when v_to_cm is not null then round(v_wid * v_to_cm, 2) end,
      'From the ideation concept: indicative size, check before quoting.');
  end if;

  update public.brief_handoffs set seeded_spec_id = v_spec where id = h.id;
  perform public._sourcing_event(p_job, 'spec', v_spec, 'spec_seeded_from_concept',
    jsonb_build_object('handoff_id', h.id, 'brief_id', h.brief_id, 'brief_code', b.brief_code, 'concept', c->>'name',
      'spec_type', v_type, 'spec_form', v_form, 'substrate', v_sub.code));
  return v_spec;
end $$;

-- Accept a pending hand-off into a new job (client chosen by the buyer) with a draft spec seeded from the concept.
-- Region, market, brand and title come from the brief. Accepting it again returns the same job.
create or replace function public.job_create_from_handoff(p_handoff uuid, p_client uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h public.brief_handoffs; b public.briefs; v_job uuid;
begin
  if not public.is_internal() then raise exception 'Internal users only' using errcode = '42501'; end if;
  select * into h from public.brief_handoffs where id = p_handoff for update;
  if h.id is null then raise exception 'Hand-off not found'; end if;
  if h.status <> 'pending' then
    if h.job_id is not null then return h.job_id; end if;
    raise exception 'This hand-off has already been accepted';
  end if;
  select * into b from public.briefs where id = h.brief_id;
  insert into public.jobs (title, client_id, region, market, brief_id, brand, campaign_name, currency, target_delivery_date, notes)
  values (coalesce(nullif(h.payload->'concept'->>'name', ''), b.title), p_client,
          coalesce(b.region, 'EMEA'), coalesce(b.market, 'Unknown'), b.id, b.brand, b.title, coalesce(b.currency, 'EUR'), b.target_launch,
          'From Briefing+ ' || coalesce(b.brief_code, '') || ': ' || coalesce(h.payload->'concept'->>'creative_direction', ''))
  returning id into v_job;
  update public.brief_handoffs set job_id = v_job where id = h.id;
  perform public._spec_seed_from_handoff(h.id, v_job);
  perform public.brief_handoff_accept(h.id, v_job);
  return v_job;
end $$;

revoke execute on function public._spec_seed_from_handoff(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.job_create_from_handoff(uuid, uuid) from public, anon;
grant execute on function public.job_create_from_handoff(uuid, uuid) to authenticated;
