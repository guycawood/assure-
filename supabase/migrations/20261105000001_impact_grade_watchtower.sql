-- Impact Grade section, step 1: its own Watchtower over the PEF (Product Environmental Footprint) methodology.
--
-- The Anthesis "PEF Logic" model becomes governed libraries: every mapping table, the ecoinvent factors it uses,
-- EF 3.1 normalisation and weighting, the constants the maths uses, the documented rules and the open review
-- issues. All of them use the standard library framework (versioned, effective-dated, audited; the ones that move
-- results need a second person to approve). The calculation itself is src/lib/pef.ts, which reads only these
-- libraries. Records are seeded from supabase/seed/m99_impact_grade.sql (generated from the workbook).
--
-- impact_grade_dimensions moves from the master Watchtower to this section: the PEF single score now drives the
-- grade, and the eight-part wheel is the way results are presented.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('pef_impact_categories', 'impact-grade', 'Impact categories', 'The 16 EF 3.1 impact categories with their normalisation and weighting factors. These turn the footprint into the single score.', true, 1),
  ('pef_grade_bands', 'impact-grade', 'Grade letters', 'Letters A-E for the 0-100 Impact Grade score. Provisional until confirmed.', true, 2),
  ('pef_parameters', 'impact-grade', 'Calculation parameters', 'The constants the maths uses: default distances, truck class, geography fallbacks, size gate and coverage.', true, 3),
  ('pef_methodology', 'impact-grade', 'Methodology rules', 'The documented rule behind every step of the calculation, stage by stage (Anthesis LCA database documentation).', true, 4),
  ('pef_open_issues', 'impact-grade', 'Open issues', 'Consistency review findings to resolve before the model is approved, with how the model treats each today.', false, 5),
  ('pef_virgin_materials', 'impact-grade', 'Virgin materials (1-1)', 'Sourcing Hub substrate to ecoinvent activity for virgin material, with forming process and raw material.', true, 10),
  ('pef_recycled_materials', 'impact-grade', 'Recycled materials (1-2)', 'Substrate to ecoinvent activity for recycled content, whether recycled content is allowed, and the default %.', true, 11),
  ('pef_coatings', 'impact-grade', 'Coatings (1-3)', 'Coating to ecoinvent activity or custom factor, with the unit (kg or m2) it is measured in.', true, 12),
  ('pef_custom_factors', 'impact-grade', 'Custom factors (1-4)', 'Factors built from several ecoinvent activities (e.g. aluminium = primary production + metal working). Every row of a factor is added.', true, 13),
  ('pef_process_energy', 'impact-grade', 'Process energy (2-1)', 'Electricity, natural gas, other heat and steam per reference unit for each forming, printing and branding process.', true, 20),
  ('pef_process_labels', 'impact-grade', 'Printing and branding labels (2-1)', 'Sourcing Hub printing and branding labels mapped to the process energy activities.', true, 21),
  ('pef_energy_activities', 'impact-grade', 'Manufacturing energy by country (2-2)', 'The ecoinvent activity for each energy carrier in each manufacturing country, including renewable electricity.', true, 22),
  ('pef_process_efficiency', 'impact-grade', 'Process efficiency (2-3)', 'Material efficiency of forming processes; net weight is divided by it to get gross input when forming is modelled.', true, 23),
  ('pef_transport_activities', 'impact-grade', 'Transport activities (3)', 'The ecoinvent freight activity per country, mode, truck class and flight range.', true, 30),
  ('pef_countries', 'impact-grade', 'Countries and routes', 'Country codes and names, road feeder distances, default mode between countries and sea distances between ports.', true, 31),
  ('pef_use_electricity', 'impact-grade', 'Use-phase electricity (4)', 'Low-voltage electricity activity per country of use.', true, 40),
  ('pef_usage_periods', 'impact-grade', 'Usage periods', 'Activation period to total usage hours.', true, 41),
  ('pef_eol_materials', 'impact-grade', 'End-of-life classification (5-1)', 'Substrate to end-of-life material category and classification, and whether it is technically recyclable.', true, 50),
  ('pef_eol_fate', 'impact-grade', 'End-of-life fate rates (5-2)', 'Recycling, incineration and landfill rates per material classification and country.', true, 51),
  ('pef_eol_treatment', 'impact-grade', 'End-of-life treatment (5-3)', 'The ecoinvent incineration and landfill activity per substrate.', true, 52),
  ('pef_ecoinvent', 'impact-grade', 'ecoinvent factors', 'ecoinvent 3.12 (cut-off) results for the activities the mapping tables use, all 16 EF 3.1 categories per reference unit. Licensed data.', true, 60),
  ('pef_worked_examples', 'impact-grade', 'Worked examples', 'The worked examples from the Anthesis workbook with the results Excel gives. The Watchtower recalculates them to prove the system matches.', true, 70)
on conflict (key) do nothing;

-- Watchtower health: is the methodology complete and approved enough to publish grades?
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
  union all select 'impact-grade', 'grade_bands_unconfirmed', 'Grade bands not yet confirmed', bands.n, 0, case when bands.n = 0 then 'ok' else 'warn' end from bands
  union all select 'impact-grade', 'high_issues_open', 'High-severity review issues open', hi.n, 0, case when hi.n = 0 then 'ok' when hi.n <= 3 then 'warn' else 'bad' end from hi
  union all select 'impact-grade', 'changes_awaiting_approval', 'Methodology changes awaiting approval', pend.n, 0, case when pend.n = 0 then 'ok' else 'warn' end from pend
  ) h where public.is_internal();
grant select on public.watchtower_health_impact_grade to authenticated;

update public.library_definitions
   set module = 'impact-grade', sort = 6,
       description = 'The eight-part Impact Grade wheel used to present results by theme. The grade itself comes from the PEF single score. Active weights must total 100%.'
 where key = 'impact_grade_dimensions';
