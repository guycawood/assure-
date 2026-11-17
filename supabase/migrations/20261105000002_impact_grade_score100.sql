-- Impact Grade becomes a 0-100 score shown as a letter A-E (decision 5 Nov 2026).
--
-- Three sources used three scales: specs held 0-10, the System X deck shows letters A-E with a range that narrows as
-- confidence grows, and the ShopperIQ Design Effectiveness model's criterion S11 reads 0-100. The score is now 0-100
-- everywhere; the letter is derived from it (pef_grade_bands). Existing spec grades are rescaled (x 10), and the
-- balanced-scorecard KPI that averages them moves to the 0-100 unit with its default target scaled the same way.

alter table public.job_specs drop constraint if exists job_specs_impact_grade_check;
update public.job_specs set impact_grade = impact_grade * 10 where impact_grade is not null and impact_grade <= 10;
alter table public.job_specs add constraint job_specs_impact_grade_check check (impact_grade between 0 and 100);
comment on column public.job_specs.impact_grade is 'Impact Grade 0-100 (higher is better) from the PEF model in the Impact Grade Watchtower; shown as a letter A-E (pef_grade_bands).';

update public.library_records
   set data = data || '{"unit":"score100","default_target":60,"definition":"Average Impact Grade (0-100) of the specs ordered, from the PEF model in the Impact Grade Watchtower."}'::jsonb
 where library_key = 'scorecard_kpis' and code = 'SUSTAINABILITY_SCORE' and data->>'unit' = 'score10';
-- Any client or market targets for this KPI were set on the 0-10 scale.
update public.library_records
   set data = jsonb_set(data, '{target}', to_jsonb(((data->>'target')::numeric * 10)))
 where library_key = 'scorecard_targets' and data->>'kpi_code' = 'SUSTAINABILITY_SCORE' and (data->>'target')::numeric <= 10;

update public.library_definitions
   set description = 'Letters A-E for the 0-100 Impact Grade score. The Impact Grade uses the PEF score as an input; its formula is still to be defined. Provisional until confirmed.'
 where key = 'pef_grade_bands';

-- Health: a grade letter is unconfirmed until its band is approved.
create or replace view public.watchtower_health_impact_grade with (security_invoker = true) as
  with w as (select coalesce(sum((data->>'weighting_factor')::numeric), 0) * 100 v from public.library_records
              where library_key = 'pef_impact_categories' and status = 'active'),
  bands as (select count(*)::numeric n from public.library_records
             where library_key = 'pef_grade_bands' and status = 'active' and coalesce((data->>'confirmed')::boolean, false) = false),
  hi as (select count(*)::numeric n from public.library_records
          where library_key = 'pef_open_issues' and status = 'active' and data->>'severity' = 'high' and coalesce(data->>'status', 'open') = 'open'),
  pend as (select count(*)::numeric n from public.library_records r join public.library_definitions d on d.key = r.library_key
            where d.module = 'impact-grade' and r.status = 'pending_approval')
  select * from (
  select 'impact-grade'::text as module, 'ef_weighting_total'::text as metric, 'EF 3.1 weighting adds up to'::text as label, round(w.v, 2) as value, 100::numeric as target,
         case when abs(w.v - 100) < 0.01 then 'ok' else 'bad' end as status from w
  union all select 'impact-grade', 'grade_bands_unconfirmed', 'Grade letters not yet confirmed', bands.n, 0, case when bands.n = 0 then 'ok' else 'warn' end from bands
  union all select 'impact-grade', 'high_issues_open', 'High-severity review issues open', hi.n, 0, case when hi.n = 0 then 'ok' when hi.n <= 3 then 'warn' else 'bad' end from hi
  union all select 'impact-grade', 'changes_awaiting_approval', 'Methodology changes awaiting approval', pend.n, 0, case when pend.n = 0 then 'ok' else 'warn' end from pend
  ) h where public.is_internal();
