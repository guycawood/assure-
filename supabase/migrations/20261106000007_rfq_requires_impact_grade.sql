-- Impact Grade is a required step before an offer goes out (Global Business Transformation, Sourcing steps ig2 to ig5).
-- Every spec on the RFQ needs a calculated grade that is not under dispute. A sourcing lead can waive it with a reason,
-- which is recorded on the RFQ. The Watchtower parameter rfq_requires_grade switches the rule off (value 0).

alter table public.rfqs
  add column impact_grade_waived_reason text,
  add column impact_grade_waived_by uuid references public.profiles(id) on delete set null,
  add column impact_grade_waived_at timestamptz;

insert into public.library_records (library_key, code, name, data, status, effective_from, notes) values
('ig_parameters', 'rfq_requires_grade', 'Impact Grade required before an RFQ is sent', '{"seq":17,"value":1,"unit":"1 = required, 0 = not required","note":"When on, every spec on an RFQ needs a calculated Impact Grade that is not disputed before the RFQ goes out. A sourcing lead can waive it for one RFQ with a reason."}'::jsonb, 'active', '2026-01-01', null)
on conflict do nothing;

-- What is missing on an RFQ: one row per spec, with the reason it blocks (or null when it is fine).
create or replace function public.rfq_impact_grade_status(p_rfq uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_on boolean; r public.rfqs; v_rows jsonb;
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq;
  if r.id is null then raise exception 'RFQ not found'; end if;
  select coalesce((select (data->>'value')::numeric from public.library_records
                    where library_key = 'ig_parameters' and code = 'rfq_requires_grade' and status = 'active' limit 1), 1) <> 0 into v_on;
  select coalesce(jsonb_agg(jsonb_build_object(
           'spec_id', s.id, 'title', s.title, 'score', g.score, 'letter', g.letter, 'review_status', g.review_status,
           'blocked_by', case when g.id is null or g.score is null then 'not_graded'
                              when g.review_status = 'disputed' then 'disputed' end) order by s.title), '[]'::jsonb)
    into v_rows
    from (select distinct spec_id from public.rfq_lines where rfq_id = p_rfq and spec_id is not null) l
    join public.job_specs s on s.id = l.spec_id
    left join public.impact_grade_records g on g.subject_kind = 'spec' and g.subject_id = s.id;
  return jsonb_build_object('required', v_on, 'waived', r.impact_grade_waived_at is not null,
    'waived_reason', r.impact_grade_waived_reason, 'specs', v_rows,
    'blocked', v_on and r.impact_grade_waived_at is null and exists (select 1 from jsonb_array_elements(v_rows) e where e->>'blocked_by' is not null));
end $$;
grant execute on function public.rfq_impact_grade_status(uuid) to authenticated;

create or replace function public.rfq_waive_impact_grade(p_rfq uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can do this' using errcode = '42501'; end if;
  if not public.approval_has_role('sourcing_lead', 'sourcing') then
    raise exception 'Only a sourcing lead can waive the Impact Grade for an RFQ' using errcode = '42501';
  end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'The RFQ has already been sent'; end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then raise exception 'Say why the Impact Grade is being waived (at least 10 characters)'; end if;
  update public.rfqs set impact_grade_waived_reason = trim(p_reason), impact_grade_waived_by = auth.uid(), impact_grade_waived_at = now() where id = p_rfq;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'impact_grade_waived', jsonb_build_object('reason', trim(p_reason)));
end $$;
grant execute on function public.rfq_waive_impact_grade(uuid, text) to authenticated;

-- The send itself: refused until the grade is in place.
alter function public.rfq_send(uuid) rename to _ig_pre_rfq_send;
create function public.rfq_send(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; st jsonb; v_list text;
begin
  select * into r from public.rfqs where id = p_rfq;
  if r.id is not null and r.status = 'draft' and public.is_internal() then
    st := public.rfq_impact_grade_status(p_rfq);
    if (st->>'blocked')::boolean then
      select string_agg(format('"%s" (%s)', e->>'title', case e->>'blocked_by' when 'disputed' then 'grade is disputed' else 'no Impact Grade yet' end), ', ')
        into v_list from jsonb_array_elements(st->'specs') e where e->>'blocked_by' is not null;
      raise exception 'Calculate the Impact Grade for every spec before the RFQ goes out: %. A sourcing lead can waive it with a reason.', v_list;
    end if;
  end if;
  perform public._ig_pre_rfq_send(p_rfq);
end $$;
grant execute on function public.rfq_send(uuid) to authenticated;
revoke execute on function public._ig_pre_rfq_send(uuid) from public, anon, authenticated;
