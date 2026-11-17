-- Procurement director overview (Vendor Sys G deck): one read of vendor activity across the pool.
-- The pool by status and onboarding stage, live jobs and payment stages, performance, risk (quality, compliance, ESG), approvals
-- waiting, and the vendors that need attention first. Internal staff with vendor-performance visibility only; money only where allowed.

create or replace function public.srm_director_overview(p_region text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_money boolean; v_out jsonb;
begin
  perform public._assure_require_internal();
  if not public.division_can('assure', 'vendor_performance') then raise exception 'Your level does not include the vendor overview' using errcode = '42501'; end if;
  v_money := public._srm_can_see_money();

  with sup as (select * from public.suppliers where p_region is null or region = p_region),
  jobs as (select * from public.srm_vendor_job_rows where p_region is null or region = p_region),
  latest as (
    select distinct on (pr.supplier_id) pr.supplier_id, pr.period, pr.composite_score, pr.ncr_count
      from public.performance_records pr join sup on sup.id = pr.supplier_id order by pr.supplier_id, pr.period desc),
  certs as (
    select c.supplier_id,
           count(*) filter (where c.expiry_date < current_date) as expired,
           count(*) filter (where c.expiry_date >= current_date and c.expiry_date < current_date + 60) as expiring
      from public.supplier_certificates c join sup on sup.id = c.supplier_id where not c.not_applicable group by c.supplier_id),
  ncr as (select n.supplier_id, count(*) as open_ncrs, count(*) filter (where n.severity = 'critical') as critical
            from public.ncrs n join sup on sup.id = n.supplier_id where n.status = 'open' group by n.supplier_id),
  iss as (select i.supplier_id, count(*) as open_issues from public.performance_issues i join sup on sup.id = i.supplier_id
           where i.acknowledgement_status <> 'resolved' and i.resolved_at is null group by i.supplier_id),
  esg as (select f.supplier_id, count(*) as open_esg from public.vendor_esg_flags f join sup on sup.id = f.supplier_id
           where f.status in ('open', 'decision_pending') group by f.supplier_id),
  late as (select supplier_id, count(*) as overdue from jobs where stage not in ('paid', 'no_invoice') and expected_date is not null and expected_date < current_date group by supplier_id),
  attn as (
    select s.id, s.name, s.region, s.category,
           coalesce(c.expired, 0) as expired_certs, coalesce(n.open_ncrs, 0) as open_ncrs, coalesce(i.open_issues, 0) as open_issues,
           coalesce(e.open_esg, 0) as open_esg, coalesce(l.overdue, 0) as overdue_payments, lt.composite_score
      from sup s left join certs c on c.supplier_id = s.id left join ncr n on n.supplier_id = s.id left join iss i on i.supplier_id = s.id
           left join esg e on e.supplier_id = s.id left join late l on l.supplier_id = s.id left join latest lt on lt.supplier_id = s.id)
  select jsonb_build_object(
    'region', p_region,
    'can_see_money', v_money,
    'pool', jsonb_build_object(
      'total', (select count(*) from sup),
      'released', (select count(*) from sup where onboarding_released),
      'by_status', coalesce((select jsonb_object_agg(k, n) from (select coalesce(status, 'unknown') k, count(*) n from sup group by 1) x), '{}'::jsonb),
      'by_onboarding', coalesce((select jsonb_object_agg(k, n) from (select coalesce(onboarding_status, 'unknown') k, count(*) n from sup group by 1) x), '{}'::jsonb),
      'by_region', coalesce((select jsonb_object_agg(k, n) from (select coalesce(region, 'Unassigned') k, count(*) n from public.suppliers group by 1) x), '{}'::jsonb)),
    'jobs', jsonb_build_object(
      'live', (select count(*) from jobs),
      'by_stage', coalesce((select jsonb_object_agg(k, n) from (select stage k, count(*) n from jobs group by 1) x), '{}'::jsonb),
      'overdue_payments', (select count(*) from jobs where stage not in ('paid', 'no_invoice') and expected_date is not null and expected_date < current_date),
      'top_vendors', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('supplier_id', supplier_id, 'name', name, 'jobs', n, 'value', case when v_money then val end)) order by n desc, name)
                                 from (select supplier_id, supplier_name as name, count(*) n, sum(total_value) val from jobs group by 1, 2 order by count(*) desc, supplier_name limit 8) t), '[]'::jsonb)),
    'performance', jsonb_build_object(
      'scored', (select count(*) from latest where composite_score is not null),
      'average', (select round(avg(composite_score), 1) from latest),
      'below_60', (select count(*) from latest where composite_score < 60),
      'lowest', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', supplier_id, 'name', name, 'score', composite_score, 'period', period) order by composite_score)
                            from (select l.supplier_id, s.name, l.composite_score, l.period from latest l join sup s on s.id = l.supplier_id where l.composite_score is not null order by l.composite_score limit 8) t), '[]'::jsonb)),
    'risk', jsonb_build_object(
      'open_ncrs', (select coalesce(sum(open_ncrs), 0) from ncr), 'critical_ncrs', (select coalesce(sum(critical), 0) from ncr),
      'open_issues', (select coalesce(sum(open_issues), 0) from iss),
      'certs_expired', (select coalesce(sum(expired), 0) from certs), 'certs_expiring', (select coalesce(sum(expiring), 0) from certs),
      'open_esg', (select coalesce(sum(open_esg), 0) from esg),
      'high_esg', (select count(*) from public.vendor_esg_flags f join sup on sup.id = f.supplier_id where f.status in ('open', 'decision_pending') and f.severity = 'high')),
    'approvals', jsonb_build_object(
      'joint_waiting', (select count(*) from public.joint_approvals where status = 'pending'),
      'form_changes', (select count(*) from public.joint_approvals where status = 'pending' and subject_type = 'form_change'),
      'reviews_next_30_days', (select count(*) from public.business_reviews r join sup on sup.id = r.supplier_id where r.status = 'scheduled' and r.meeting_date between current_date and current_date + 30)),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', id, 'name', name, 'region', region, 'category', category, 'expired_certs', expired_certs, 'open_ncrs', open_ncrs,
                              'open_issues', open_issues, 'open_esg', open_esg, 'overdue_payments', overdue_payments, 'score', composite_score,
                              'points', expired_certs + open_ncrs * 2 + open_issues + open_esg * 3 + overdue_payments) order by expired_certs + open_ncrs * 2 + open_issues + open_esg * 3 + overdue_payments desc, name)
                            from (select * from attn where expired_certs + open_ncrs + open_issues + open_esg + overdue_payments > 0
                                  order by expired_certs + open_ncrs * 2 + open_issues + open_esg * 3 + overdue_payments desc, name limit 10) a), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.srm_director_overview(text) from public, anon;
grant execute on function public.srm_director_overview(text) to authenticated;
