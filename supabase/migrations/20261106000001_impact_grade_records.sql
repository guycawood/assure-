-- Impact Grade records (6 Nov 2026): one grade record per spec (and per ideation concept before it becomes a spec),
-- calculated from the spec's real data, with the evidence tier of each input, a confidence % that rises as better
-- evidence arrives (assumed -> estimated -> declared -> measured -> verified) and an indicative grade range that narrows
-- with it (System X). Jobs roll the spec records up; staff can open a record, edit an input (with a reason and its
-- tier) and review it. The supplier sub-score is read from the SRM scorecard at calculation time and stored on the record.
--
-- Writes go through impact_grade_save / impact_grade_review only (security definer, internal staff). The engine is the
-- TypeScript one in src/lib/impact-grade.ts, so the function stores what the engine worked out and keeps the audit trail.

create table public.impact_grade_records (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('spec', 'concept')),
  subject_id uuid not null,
  job_id uuid references public.jobs(id) on delete cascade,
  brief_id uuid,
  supplier_id uuid references public.suppliers(id) on delete set null,
  stage text not null default 'spec' check (stage in ('ideation', 'spec', 'sourcing', 'order', 'logistics', 'execution')),
  score numeric(4,1) check (score is null or score between 0 and 100),
  letter text,
  coverage numeric(5,2) check (coverage is null or coverage between 0 and 100),
  confidence int check (confidence is null or confidence between 0 and 100),
  range_low numeric(4,1),
  range_high numeric(4,1),
  pef_mpt numeric check (pef_mpt is null or pef_mpt >= 0),
  supplier_score numeric(4,1) check (supplier_score is null or supplier_score between 0 and 100),
  inputs jsonb not null default '{}'::jsonb,
  tiers jsonb not null default '{}'::jsonb,
  sub_scores jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed', 'disputed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id)
);
create index impact_grade_records_job_idx on public.impact_grade_records (job_id);
create index impact_grade_records_supplier_idx on public.impact_grade_records (supplier_id);

create table public.impact_grade_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.impact_grade_records(id) on delete cascade,
  action text not null check (action in ('calculate', 'edit', 'review')),
  detail jsonb not null default '{}'::jsonb,
  reason text,
  by uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index impact_grade_events_record_idx on public.impact_grade_events (record_id, at desc);

alter table public.impact_grade_records enable row level security;
alter table public.impact_grade_events enable row level security;
create policy igr_read on public.impact_grade_records for select to authenticated using (public.is_internal());
create policy ige_read on public.impact_grade_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.impact_grade_records, public.impact_grade_events from authenticated, anon;

-- Save a calculation. p carries what the engine worked out:
--   {score, letter, coverage (0-100), confidence (0-100), range_low, range_high, pef_mpt, supplier_score,
--    inputs, tiers, sub_scores, warnings, pef_result?}
-- p_action 'calculate' (recalculated from the spec) or 'edit' (a person changed an input: a reason is required and
-- the record goes back to unreviewed).
create or replace function public.impact_grade_save(p_kind text, p_subject uuid, p_job uuid, p_brief uuid, p_supplier uuid,
  p_stage text, p jsonb, p_action text default 'calculate', p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev numeric; v_score numeric := nullif(p->>'score', '')::numeric;
begin
  if not public.is_internal() then raise exception 'Only staff can save an Impact Grade' using errcode = '42501'; end if;
  if p_kind not in ('spec', 'concept') then raise exception 'Unknown subject'; end if;
  if p_action not in ('calculate', 'edit') then raise exception 'Unknown action'; end if;
  if p_action = 'edit' and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Say why the input changed'; end if;
  if p_kind = 'spec' and not exists (select 1 from public.job_specs where id = p_subject) then raise exception 'Spec not found'; end if;

  select id, score into v_id, v_prev from public.impact_grade_records where subject_kind = p_kind and subject_id = p_subject;
  if v_id is null then
    insert into public.impact_grade_records (subject_kind, subject_id, job_id, brief_id, supplier_id, stage, updated_by)
    values (p_kind, p_subject, p_job, p_brief, p_supplier, coalesce(p_stage, 'spec'), auth.uid()) returning id into v_id;
  end if;

  update public.impact_grade_records set
    job_id = coalesce(p_job, job_id), brief_id = coalesce(p_brief, brief_id), supplier_id = p_supplier,
    stage = coalesce(p_stage, stage), score = v_score, letter = p->>'letter',
    coverage = nullif(p->>'coverage', '')::numeric, confidence = nullif(p->>'confidence', '')::int,
    range_low = nullif(p->>'range_low', '')::numeric, range_high = nullif(p->>'range_high', '')::numeric,
    pef_mpt = nullif(p->>'pef_mpt', '')::numeric, supplier_score = nullif(p->>'supplier_score', '')::numeric,
    inputs = coalesce(p->'inputs', '{}'::jsonb), tiers = coalesce(p->'tiers', '{}'::jsonb),
    sub_scores = coalesce(p->'sub_scores', '[]'::jsonb), warnings = coalesce(p->'warnings', '[]'::jsonb),
    -- a recalculation that changes the grade, or any edit, needs looking at again
    review_status = case when p_action = 'edit' or v_prev is distinct from v_score then 'unreviewed' else review_status end,
    reviewed_by = case when p_action = 'edit' or v_prev is distinct from v_score then null else reviewed_by end,
    reviewed_at = case when p_action = 'edit' or v_prev is distinct from v_score then null else reviewed_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = v_id;

  -- The spec carries the grade on its own row too (badges across the journey read it from there).
  if p_kind = 'spec' then
    update public.job_specs set impact_grade = v_score where id = p_subject;
    if (p->'pef_result') is not null and (p->>'pef_mpt') is not null then
      insert into public.pef_results (spec_id, source, single_score_mpt, climate_kgco2e, functional_unit, inputs, result, calculated_by)
      values (p_subject, 'spec', (p->>'pef_mpt')::numeric, nullif(p->>'pef_climate', '')::numeric, 'spec as specified (open issue PORT-02)',
              coalesce(p->'pef_inputs', '{}'::jsonb), p->'pef_result', auth.uid());
    end if;
  end if;

  insert into public.impact_grade_events (record_id, action, detail, reason, by)
  values (v_id, p_action, jsonb_build_object('from', v_prev, 'to', v_score, 'confidence', p->'confidence', 'changed', p->'changed'), p_reason, auth.uid());
  return v_id;
end $$;
grant execute on function public.impact_grade_save(text, uuid, uuid, uuid, uuid, text, jsonb, text, text) to authenticated;

-- Review decision. Whoever last changed the record cannot review it (maker-checker, as the Watchtower libraries).
create or replace function public.impact_grade_review(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.impact_grade_records;
begin
  if not public.is_internal() then raise exception 'Only staff can review an Impact Grade' using errcode = '42501'; end if;
  if p_status not in ('reviewed', 'disputed', 'unreviewed') then raise exception 'Unknown review status'; end if;
  select * into r from public.impact_grade_records where id = p_id;
  if r.id is null then raise exception 'Impact Grade record not found'; end if;
  if p_status = 'reviewed' and r.updated_by is not distinct from auth.uid() then
    raise exception 'A different person must review it: you last changed this record';
  end if;
  if p_status = 'disputed' and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say what is wrong'; end if;
  update public.impact_grade_records set review_status = p_status,
    reviewed_by = case when p_status = 'unreviewed' then null else auth.uid() end,
    reviewed_at = case when p_status = 'unreviewed' then null else now() end,
    review_note = nullif(trim(p_note), '') where id = p_id;
  insert into public.impact_grade_events (record_id, action, detail, reason, by)
  values (p_id, 'review', jsonb_build_object('status', p_status), p_note, auth.uid());
end $$;
grant execute on function public.impact_grade_review(uuid, text, text) to authenticated;

-- Evidence tiers and the confidence each earns (System X: confidence rises towards 95% as evidence improves).
-- Governed in the Watchtower with the other Impact Grade parameters.
insert into public.library_records (library_key, code, name, data, status, effective_from, notes) values
('ig_parameters', 'tier_confidence_assumed',  'Confidence at the Assumed tier',  '{"seq":10,"value":20,"unit":"%","note":"Rule of thumb or a default: nothing from this job yet."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'tier_confidence_estimated','Confidence at the Estimated tier','{"seq":11,"value":40,"unit":"%","note":"Worked out from the brief, a concept or a similar job."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'tier_confidence_declared', 'Confidence at the Declared tier', '{"seq":12,"value":65,"unit":"%","note":"Entered on the spec or declared by the supplier."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'tier_confidence_measured', 'Confidence at the Measured tier', '{"seq":13,"value":85,"unit":"%","note":"Weighed or measured, or confirmed on the order."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'tier_confidence_verified', 'Confidence at the Verified tier', '{"seq":14,"value":95,"unit":"%","note":"Checked by SRM, QA or an auditor. The ceiling: nothing is 100%."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'range_max_swing',          'Widest grade range at zero confidence', '{"seq":15,"value":25,"unit":"points","note":"The indicative range is the grade plus or minus this many points times (1 - confidence)."}'::jsonb, 'active', '2026-01-01', null),
('ig_parameters', 'supplier_criteria',        'SRM scorecard criteria behind the Supplier Score', '{"seq":16,"text_value":"csr_audit,ems_audit,fsc,sedex,diverse,renewable","note":"Comma separated scorecard criteria. The Supplier Score is their average (0-5 scaled to 0-100). Weight in the grade is set on the Supplier Score sub-score (0 until agreed)."}'::jsonb, 'active', '2026-01-01', null)
on conflict do nothing;
