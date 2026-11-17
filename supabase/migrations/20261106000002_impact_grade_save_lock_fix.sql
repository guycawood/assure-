-- Impact Grade records: the grade is derived data, so saving it must not trip the spec lock on a live or awarded RFQ.
-- (Redefines impact_grade_save from 20261106000001, as the repo does for other functions.)

create or replace function public.impact_grade_save(p_kind text, p_subject uuid, p_job uuid, p_brief uuid, p_supplier uuid,
  p_stage text, p jsonb, p_action text default 'calculate', p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev numeric; v_prev_flag text := current_setting('sourcing.system_write', true); v_score numeric := nullif(p->>'score', '')::numeric;
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
    -- The grade is derived data, not an edit of the spec: it must also land on a spec that is locked on a live RFQ.
    perform set_config('sourcing.system_write', 'on', true);
    update public.job_specs set impact_grade = v_score where id = p_subject;
    perform set_config('sourcing.system_write', coalesce(v_prev_flag, ''), true);
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

