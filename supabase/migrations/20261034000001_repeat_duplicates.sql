-- Repeat orders: duplicate a brief or a spec. The copy starts as a draft, keeps a link to the original
-- (repeat_of_*), and a spec copy can land on another job. spec_repeat_context() shows what was bought last time
-- (supplier, unit price, PO, verified packaging data) so a repeat can be priced from history, not from scratch.

alter table public.briefs add column if not exists repeat_of_brief_id uuid references public.briefs(id) on delete set null;
alter table public.job_specs add column if not exists repeat_of_spec_id uuid references public.job_specs(id) on delete set null;
create index if not exists job_specs_repeat_idx on public.job_specs (repeat_of_spec_id) where repeat_of_spec_id is not null;

-- Brief: same content as a new draft, authored by the person duplicating it. Market and title can change;
-- the launch date is left blank because a repeat needs its own date. Approval and ideation are not copied.
create or replace function public.brief_duplicate(p_brief uuid, p_market text default null, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_id uuid; v_region text;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief;
  if b.id is null then raise exception 'Brief not found'; end if;
  v_region := b.region;
  if nullif(trim(p_market), '') is not null and p_market is distinct from b.market then
    select region_code into v_region from public.markets where code = upper(trim(p_market)) or lower(name) = lower(trim(p_market)) limit 1;
    if v_region is null then raise exception 'Market "%" is not in the market list', p_market; end if;
  end if;
  insert into public.briefs (campaign_id, region, market, client, client_id, brand, division, title, objective, brief_text,
    target_outlets, budget_low, budget_high, currency, target_launch, product_category, sustainability_targets,
    min_recycled_pct, require_fsc, status, created_by, repeat_of_brief_id)
  values (b.campaign_id, v_region, coalesce(nullif(trim(p_market), ''), b.market), b.client, b.client_id, b.brand, b.division,
    coalesce(nullif(trim(p_title), ''), b.title), b.objective, b.brief_text, b.target_outlets, b.budget_low, b.budget_high,
    b.currency, null, b.product_category, b.sustainability_targets, b.min_recycled_pct, b.require_fsc, 'draft', auth.uid(), b.id)
  returning id into v_id;
  perform public._brief_event(v_id, 'duplicated', null, 'draft', 'Repeat of ' || b.brief_code);
  perform public._brief_event(b.id, 'repeated', b.status, b.status, 'Duplicated for a repeat order');
  return v_id;
end $$;

-- Spec: every product column is copied (so columns added later are copied too), then versions and the bill of
-- materials. Not copied: the RFQ, quotes, triage route, estimates, POs, QA/QC plans and data sheets; revision
-- history starts again. On another job the spec takes that job's region and market.
create or replace function public.spec_duplicate(p_spec uuid, p_job uuid default null, p_quantity int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.job_specs; j public.jobs; v_cols text; v_id uuid; v record; v_new_version uuid; v_map jsonb := '{}'::jsonb;
  v_versions int;
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only adm Indicia staff can duplicate specs' using errcode = '42501'; end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  select * into j from public.jobs where id = coalesce(p_job, s.job_id);
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status in ('closed', 'cancelled') then raise exception 'Job % is %: choose an open job for the repeat', j.job_number, j.status; end if;
  if p_quantity is not null and p_quantity <= 0 then raise exception 'Quantity must be above zero'; end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'job_specs' and is_generated = 'NEVER'
     and column_name not in ('id','job_id','spec_no','created_by','created_at','updated_at','revision','revised_at',
                             'repeat_of_spec_id','is_draft','brief_id','region','market');
  execute format('insert into public.job_specs (%s, job_id, created_by, repeat_of_spec_id, is_draft, brief_id, region, market)
                  select %s, $1, auth.uid(), $2, true, $3, $4, $5 from public.job_specs where id = $2 returning id', v_cols, v_cols)
    into v_id using j.id, s.id, case when j.id = s.job_id then s.brief_id end,
                    case when j.id = s.job_id then s.region else j.region end,
                    case when j.id = s.job_id then s.market else j.market end;

  select count(*) into v_versions from public.spec_versions where spec_id = s.id;
  for v in select * from public.spec_versions where spec_id = s.id order by sort loop
    insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width, item_code, unit_weight_grams, sort)
    values (v_id, v.name, case when p_quantity is not null and v_versions = 1 then p_quantity else v.quantity end,
            v.finished_length, v.finished_width, v.item_code, v.unit_weight_grams, v.sort)
    returning id into v_new_version;
    v_map := v_map || jsonb_build_object(v.id::text, v_new_version);
  end loop;
  insert into public.spec_components (spec_id, version_id, component_name, component_type, is_packaging, substrate_id, quantity_per_unit,
    area_length_cm, area_width_cm, direct_weight_grams, thickness_mm_override, grammage_gsm_override, derived_weight_grams, notes, sort)
  select v_id, nullif(v_map->>c.version_id::text, '')::uuid, c.component_name, c.component_type, c.is_packaging, c.substrate_id, c.quantity_per_unit,
         c.area_length_cm, c.area_width_cm, c.direct_weight_grams, c.thickness_mm_override, c.grammage_gsm_override, c.derived_weight_grams, c.notes, c.sort
    from public.spec_components c where c.spec_id = s.id;

  perform public._sourcing_event(j.id, 'spec', v_id, 'spec_duplicated',
    jsonb_build_object('repeat_of', s.id, 'from_job', s.job_id, 'quantity', p_quantity));
  return v_id;
end $$;

-- What was bought last time for this spec or anything it repeats (walks back up to 5 generations):
-- supplier, unit price, quantity, currency, estimate, PO and date, plus a verified packaging data sheet if any.
create or replace function public.spec_repeat_context(p_spec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_chain uuid[] := array[]::uuid[]; v_cur uuid := p_spec; v_next uuid; i int := 0; v_last jsonb; v_sheet jsonb; v_orig record;
begin
  if auth.uid() is null or not public.is_internal() then return null; end if;
  loop
    select repeat_of_spec_id into v_next from public.job_specs where id = v_cur;
    exit when v_next is null or i >= 5 or v_next = any (v_chain);
    v_chain := v_chain || v_next; v_cur := v_next; i := i + 1;
  end loop;
  if cardinality(v_chain) = 0 then return null; end if;
  select s.id, s.spec_no, s.title, j.job_number into v_orig
    from public.job_specs s join public.jobs j on j.id = s.job_id where s.id = v_chain[cardinality(v_chain)];
  select jsonb_build_object('spec_id', el.spec_id, 'supplier_id', e.supplier_id, 'supplier_name', sp.name,
           'unit_cost', el.unit_cost, 'quantity', el.quantity, 'currency', e.currency, 'estimate_number', e.estimate_number,
           'approved_at', e.approved_at,
           'po_number', (select po.po_number from public.purchase_orders po where po.estimate_id = e.id and po.status in ('issued','accepted') order by po.po_date desc limit 1))
    into v_last
    from public.estimate_lines el join public.estimates e on e.id = el.estimate_id left join public.suppliers sp on sp.id = e.supplier_id
   where el.spec_id = any (v_chain) and e.status = 'approved'
   order by e.approved_at desc nulls last limit 1;
  begin
    execute $q$ select jsonb_build_object('sheet_ref', t.sheet_ref, 'supplier_name', t.supplier_name)
                  from public.v_tech_sheets t where t.spec_id = any ($1) and t.status = 'verified' order by t.updated_at desc nulls last limit 1 $q$
      into v_sheet using v_chain;
  exception when others then v_sheet := null;
  end;
  return jsonb_build_object('original', jsonb_build_object('spec_id', v_orig.id, 'spec_no', v_orig.spec_no, 'title', v_orig.title, 'job_number', v_orig.job_number),
                            'generations', cardinality(v_chain), 'last_purchase', v_last, 'verified_sheet', v_sheet);
end $$;

revoke all on function public.brief_duplicate(uuid, text, text), public.spec_duplicate(uuid, uuid, int), public.spec_repeat_context(uuid) from public, anon;
grant execute on function public.brief_duplicate(uuid, text, text), public.spec_duplicate(uuid, uuid, int), public.spec_repeat_context(uuid) to authenticated;
