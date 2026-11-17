-- Carbon intensity KPIs beside the Impact Grade (5 Nov 2026), as defined in Impact Grade.xlsx (Outputs sheet):
--   Economic Carbon Intensity = kg CO2e per EUR spent
--   Physical Carbon Intensity = kg CO2e per kg of material
-- Reported, not scored: the PEF score inside the Impact Grade already covers climate change.
--
-- Per spec: CO2e is the spec's material CO2e estimate (job_specs.co2e_total_kg; the full PEF climate figure is stored
-- per spec once the functional unit is settled). Spend is purchase spend (supplier cost) on the spec's estimate,
-- the approved one first, then the one with the client, then the latest draft; converted to EUR with the governed
-- reporting FX rates. Weight is unit plus packaging weight times the total quantity of its versions.
-- Roll-ups (client, supplier, job) are totals divided by totals, never averages of ratios.

create or replace function public.spec_carbon_intensity(p_spec_ids uuid[] default null, p_client uuid default null, p_supplier uuid default null, p_job uuid default null)
returns table (spec_id uuid, job_id uuid, client_id uuid, supplier_id uuid, estimate_id uuid, co2e_kg numeric, weight_kg numeric, spend_eur numeric,
  economic_intensity numeric, physical_intensity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  with per as (
    select el.spec_id as sid, e.id as eid, e.supplier_id as sup, e.status, e.created_at, sum(el.line_cost) * public._fx_eur(e.currency) as eur
      from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
     where e.status <> 'declined'
     group by el.spec_id, e.id, e.supplier_id, e.status, e.created_at, e.currency
  ), pick as (
    select distinct on (per.sid) * from per order by per.sid, (per.status = 'approved') desc, (per.status = 'sent') desc, per.created_at desc
  ), qty as (select v.spec_id as sid, sum(v.quantity)::numeric q from public.spec_versions v group by v.spec_id)
  select s.id, s.job_id, j.client_id, pick.sup, pick.eid, s.co2e_total_kg,
         case when s.unit_weight_grams is not null and coalesce(qty.q, 0) > 0 then (s.unit_weight_grams + coalesce(s.packaging_weight_grams, 0)) * qty.q / 1000 end,
         pick.eur,
         case when pick.eur > 0 and s.co2e_total_kg is not null then s.co2e_total_kg / pick.eur end,
         case when s.unit_weight_grams > 0 and coalesce(qty.q, 0) > 0 and s.co2e_total_kg is not null
              then s.co2e_total_kg / ((s.unit_weight_grams + coalesce(s.packaging_weight_grams, 0)) * qty.q / 1000) end
    from public.job_specs s
    join public.jobs j on j.id = s.job_id
    left join qty on qty.sid = s.id
    left join pick on pick.sid = s.id
   where (p_spec_ids is null or s.id = any (p_spec_ids))
     and (p_client is null or j.client_id = p_client)
     and (p_job is null or s.job_id = p_job)
     and (p_supplier is null or pick.sup = p_supplier);
end $$;
grant execute on function public.spec_carbon_intensity(uuid[], uuid, uuid, uuid) to authenticated;
