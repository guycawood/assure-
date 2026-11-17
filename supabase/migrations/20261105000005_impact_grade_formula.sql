-- Impact Grade formula (5 Nov 2026), from "Impact Grade.xlsx" (ImpactGrade sheet).
--
-- Impact Grade (0-100, letter A-E) = weighted sub-scores: circular design (durability, reusability, repairability,
-- recyclability), resource use (resource efficiency, substances of concern, recycled content) and the PEF score
-- (50%), with Promo weights for promo/merch. The PEF score is scaled against a governed reference: the 95th
-- percentile of our own PEF results. src/lib/impact-grade.ts is the engine; these libraries hold every rule.
--
-- pef_results holds PEF scores as they are calculated (per spec), so the reference can be recalculated from real
-- results; a new reference is a new version of the parameter and needs a second person to approve it.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('ig_subscores', 'impact-grade', 'Impact Grade sub-scores and weights', 'Each sub-score, how it is scored (0-100) and its weight, standard and Promo. Weights add up to 100.', true, 7),
  ('ig_impact_levels', 'impact-grade', 'Impact levels', 'Impact level 0 (no impact) to 5 (very high) and the score each gives (100 to 0).', true, 8),
  ('ig_option_scores', 'impact-grade', 'Scored options', 'Inks, varnish, finishing, finish type, material accreditation, activation period and electronics, each with its impact level.', true, 9),
  ('ig_substrates', 'impact-grade', 'Substrates for Impact Grade', 'Sourcing Hub substrates with their category and whether they are plastic or harmful (PVC, BPA ...).', true, 9),
  ('ig_parameters', 'impact-grade', 'Impact Grade parameters', 'The PEF reference (95th percentile of our PEF scores), Promo spec types and the minimum data coverage for a confirmed grade.', true, 9),
  ('ig_open_items', 'impact-grade', 'Impact Grade open items', 'Decisions still to make on the Impact Grade formula.', false, 9)
on conflict (key) do nothing;

create table public.pef_results (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid references public.job_specs(id) on delete cascade,
  source text not null default 'spec' check (source in ('spec', 'worked_example', 'calculator')),
  single_score_mpt numeric not null check (single_score_mpt >= 0),
  climate_kgco2e numeric,
  functional_unit text not null default 'order line',
  inputs jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  calculated_by uuid references public.profiles(id) on delete set null,
  calculated_at timestamptz not null default now()
);
create index pef_results_spec_idx on public.pef_results (spec_id, calculated_at desc);
alter table public.pef_results enable row level security;
create policy pef_results_read on public.pef_results for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.pef_results from authenticated, anon;

/** The reference the Watchtower proposes: the chosen percentile of the latest PEF score per spec (or worked example). */
create or replace function public.ig_pef_reference_suggestion() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pct numeric; v_ref numeric; v_n int;
begin
  if not public.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select coalesce((data->>'value')::numeric, 95) into v_pct from public.library_records
   where library_key = 'ig_parameters' and code = 'pef_reference_percentile' and status = 'active';
  v_pct := coalesce(v_pct, 95);
  with latest as (
    select distinct on (coalesce(spec_id::text, id::text)) single_score_mpt from public.pef_results
     order by coalesce(spec_id::text, id::text), calculated_at desc
  ), ex as (
    select (data->'expected'->>'singleScoreMpt')::numeric v from public.library_records where library_key = 'pef_worked_examples' and status = 'active'
  ), allv as (select single_score_mpt v from latest union all select v from ex where not exists (select 1 from latest))
  select percentile_cont(v_pct / 100) within group (order by v), count(*) into v_ref, v_n from allv;
  return jsonb_build_object('percentile', v_pct, 'reference_mpt', v_ref, 'results', v_n,
    'basis', case when exists (select 1 from public.pef_results) then 'pef_results' else 'worked_examples' end);
end $$;
grant execute on function public.ig_pef_reference_suggestion() to authenticated;
