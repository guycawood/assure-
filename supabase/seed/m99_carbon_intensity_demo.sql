-- Demo CO2e for the "(demo)" specs that have none, so the carbon intensity KPIs have something to show. Dummy data
-- only, clearly marked in co2e_detail: kg CO2e = purchase spend in EUR × an indicative factor per spec type
-- (2D 0.30, 3D 0.45, promo/merch 0.80, other 0.25) with ±30% spread. Never used for real reporting.
with spend as (
  select el.spec_id, sum(el.line_cost * coalesce(public._fx_eur(e.currency), 1)) eur
    from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
   where e.status <> 'declined' group by el.spec_id
)
update public.job_specs s
   set co2e_total_kg = round((sp.eur * case s.spec_type when '2d' then 0.30 when '3d' then 0.45 when 'promo_merch' then 0.80 else 0.25 end
                       * (0.7 + (abs(hashtext(s.id::text)) % 600) / 1000.0))::numeric, 3),
       co2e_detail = jsonb_build_object('basis', 'demo', 'note', 'Indicative demo value from spend; not a calculation'),
       co2e_computed_at = now()
  from spend sp
 where sp.spec_id = s.id and s.co2e_total_kg is null and s.title like '%(demo)%' and sp.eur > 0;
