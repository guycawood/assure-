-- Opportunities now keep different sizes apart. On the demo data the same title covered very different sizes, so the price range
-- looked far wider than it was. The group key now includes a size band (about 25 percent apart in area), taken from the spec's first
-- version. Specs with no size stay together.

create or replace function public.rate_card_opportunities(p_months int default 12, p_min_orders int default 3, p_search text default null, p_include_dismissed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card opportunities' using errcode = '42501'; end if;
  if p_months is null or p_months < 1 or p_months > 60 then raise exception 'Choose between 1 and 60 months'; end if;
  with lines as (
    select s.spec_type, s.substrate_id,
           coalesce(nullif(trim(regexp_replace(regexp_replace(lower(trim(s.title)), '\([^)]*\)|\S*[0-9]\S*', '', 'g'), '\s+', ' ', 'g')), ''), '(untitled)') as tkey,
           s.title, el.estimate_id, e.job_id, j.client_id, e.supplier_id, el.quantity, el.unit_cost, el.line_cost, e.created_at, e.benchmark_source = 'rate_card' as via_card, e.currency,
           sz.len_mm, sz.wid_mm,
           case when sz.len_mm > 0 and sz.wid_mm > 0 then round(ln(sz.len_mm * sz.wid_mm) / ln(1.25))::int end as size_band
      from public.estimate_lines el
      join public.estimates e on e.id = el.estimate_id
      join public.job_specs s on s.id = el.spec_id
      join public.jobs j on j.id = e.job_id
      left join lateral (
        select v.finished_length * f.mm as len_mm, v.finished_width * f.mm as wid_mm
          from public.spec_versions v
          cross join lateral (select case coalesce(s.size_unit, s.spec_data->>'size_unit') when 'cm' then 10 when 'in' then 25.4 else 1 end as mm) f
         where v.spec_id = s.id order by v.sort, v.created_at limit 1
      ) sz on true
     where e.status <> 'declined' and el.unit_cost > 0 and e.created_at >= now() - make_interval(months => p_months)
  ), g as (
    select spec_type, substrate_id, tkey, currency, size_band, min(title) as example,
           count(distinct estimate_id) as orders, count(distinct job_id) as jobs, count(distinct client_id) as clients, count(distinct supplier_id) as suppliers,
           sum(quantity) as qty, min(quantity) as qty_min, max(quantity) as qty_max, round(sum(line_cost), 2) as spend,
           round(avg(unit_cost), 4) as avg_cost, min(unit_cost) as min_cost, max(unit_cost) as max_cost, max(created_at) as last_at,
           count(*) filter (where via_card) as card_lines, count(*) as lines,
           round(avg(len_mm)) as len_mm, round(avg(wid_mm)) as wid_mm
      from lines group by spec_type, substrate_id, tkey, currency, size_band
  ), k as (
    select g.*, g.spec_type || '|' || coalesce(g.substrate_id::text, '') || '|' || g.tkey || '|' || g.currency || '|' || coalesce(g.size_band::text, '') as key from g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', k.key, 'example', k.example, 'title_key', k.tkey, 'spec_type', k.spec_type, 'substrate', sub.name, 'substrate_code', sub.code, 'currency', k.currency,
      'len_mm', k.len_mm, 'wid_mm', k.wid_mm,
      'orders', k.orders, 'jobs', k.jobs, 'clients', k.clients, 'suppliers', k.suppliers, 'qty', k.qty, 'qty_min', k.qty_min, 'qty_max', k.qty_max, 'spend', k.spend,
      'avg_cost', k.avg_cost, 'min_cost', k.min_cost, 'max_cost', k.max_cost,
      'spread_pct', round((k.max_cost - k.min_cost) / nullif(k.min_cost, 0) * 100, 1), 'last_at', k.last_at,
      'card_share_pct', round(k.card_lines::numeric / k.lines * 100, 0),
      'open_request', exists (select 1 from public.rate_card_requests r where r.status in ('requested', 'taken', 'pricing', 'drafted') and lower(r.title) like '%' || k.tkey || '%' and k.tkey <> '(untitled)'),
      'dismissed', d.key is not null, 'dismissed_reason', d.reason
    ) order by k.spend desc), '[]'::jsonb) into v_out
    from k
    left join public.library_records sub on sub.id = k.substrate_id
    left join public.rate_card_opportunity_dismissals d on d.key = k.key
   where k.orders >= coalesce(p_min_orders, 1)
     and k.card_lines::numeric / k.lines < 0.8
     and (p_include_dismissed or d.key is null)
     and (nullif(trim(p_search), '') is null or lower(k.example || ' ' || k.tkey || ' ' || coalesce(sub.name, '')) like '%' || lower(trim(p_search)) || '%');
  return v_out;
end $$;
