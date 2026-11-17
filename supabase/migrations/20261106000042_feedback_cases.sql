-- Feedback case management (CRM). A low score becomes a case with an owner, due dates, a cause, what was done, the client told, and an outcome.
--   * Opened automatically: any feedback score at or below the low-score setting (default 6), from the team, the Client Portal or a survey; and a
--     post-job survey answered 3 out of 5 or lower. One case per piece of feedback.
--   * Severity: high at 3 or lower out of 10 (or 2 or lower out of 5), otherwise medium. High cases are due faster (settings below).
--   * Steps: new, acknowledged, investigating, resolved (cause, root cause and action recorded), closed (the client told and their reaction recorded).
--     A closed case can be reopened. Every step is kept in a timeline.
--   * Kept in step with what exists: resolving a case records the follow-up on the feedback itself (so the "to follow up" counts and client health
--     fall), and closing it marks the follow-up action done.
--   * Late cases: the owner is told once when acknowledgement is overdue and once when the resolution date passes.

insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'crm_settings', x.code, x.name, jsonb_build_object('value', x.v), 'active', date '2026-01-01'
  from (values ('FEEDBACK_LOW_SCORE', 'Feedback at or below this score opens a case (out of 10)', 6),
               ('FEEDBACK_ACK_DAYS', 'Acknowledge a case within (days)', 2), ('FEEDBACK_ACK_DAYS_HIGH', 'Acknowledge a high-severity case within (days)', 1),
               ('FEEDBACK_RESOLVE_DAYS', 'Resolve a case within (days)', 14), ('FEEDBACK_RESOLVE_DAYS_HIGH', 'Resolve a high-severity case within (days)', 7)) x(code, name, v)
 where not exists (select 1 from public.library_records r where r.library_key = 'crm_settings' and r.code = x.code);

create table public.crm_feedback_cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  market text,
  source text not null check (source in ('feedback', 'job_survey')),
  feedback_id uuid unique references public.crm_feedback(id) on delete cascade,
  job_survey_id uuid unique references public.crm_job_surveys(id) on delete cascade,
  score int not null, scale int not null check (scale in (5, 10)),
  comment text,
  severity text not null check (severity in ('high', 'medium')),
  status text not null default 'new' check (status in ('new', 'acknowledged', 'investigating', 'resolved', 'closed')),
  owner uuid references public.profiles(id) on delete set null,
  ack_due date not null, resolve_due date not null,
  acknowledged_at timestamptz,
  cause text check (cause in ('service_quality', 'delivery', 'pricing', 'communication', 'product_quality', 'people', 'systems', 'other')),
  root_cause text check (root_cause is null or length(root_cause) <= 4000),
  action_taken text check (action_taken is null or length(action_taken) <= 4000),
  resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete set null,
  client_informed_at timestamptz, client_informed_by uuid references public.profiles(id) on delete set null, client_informed_how text,
  client_outcome text check (client_outcome in ('satisfied', 'neutral', 'not_satisfied', 'no_response')),
  closed_at timestamptz, closed_by uuid references public.profiles(id) on delete set null,
  escalated_at timestamptz, escalation_note text,
  ack_alerted_at timestamptz, resolve_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((source = 'feedback' and feedback_id is not null and job_survey_id is null) or (source = 'job_survey' and job_survey_id is not null and feedback_id is null))
);
create index crm_cases_client_idx on public.crm_feedback_cases (client_id, status);
create index crm_cases_owner_idx on public.crm_feedback_cases (owner, status);

create table public.crm_feedback_case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.crm_feedback_cases(id) on delete cascade,
  event text not null, note text, actor uuid references public.profiles(id) on delete set null default auth.uid(), at timestamptz not null default now()
);
create index crm_case_events_idx on public.crm_feedback_case_events (case_id, at);

alter table public.crm_feedback_cases enable row level security;
alter table public.crm_feedback_case_events enable row level security;
create policy crm_cases_read on public.crm_feedback_cases for select to authenticated using (public.is_internal());
create policy crm_case_events_read on public.crm_feedback_case_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_feedback_cases, public.crm_feedback_case_events from authenticated, anon;

create view public.crm_feedback_cases_v with (security_invoker = true) as
  select k.*, c.name as client_name, ct.full_name as contact_name, coalesce(nullif(po.full_name, ''), po.email) as owner_name,
         (k.status = 'new' and k.ack_due < current_date) as ack_overdue,
         (k.status in ('new', 'acknowledged', 'investigating') and k.resolve_due < current_date) as resolve_overdue,
         (current_date - k.created_at::date) as age_days,
         (select jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'at', e.at, 'by', coalesce(nullif(p.full_name, ''), p.email)) order by e.at, e.id)
            from public.crm_feedback_case_events e left join public.profiles p on p.id = e.actor where e.case_id = k.id) as timeline
    from public.crm_feedback_cases k join public.sourcing_clients c on c.id = k.client_id
    left join public.crm_contacts ct on ct.id = k.contact_id left join public.profiles po on po.id = k.owner;
revoke all on public.crm_feedback_cases_v from anon;
grant select on public.crm_feedback_cases_v to authenticated;

create or replace function public._case_log(p_case uuid, p_event text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.crm_feedback_case_events (case_id, event, note, actor) values (p_case, p_event, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
$$;
revoke execute on function public._case_log(uuid, text, text) from public, anon, authenticated;

-- Open a case for one piece of low feedback or one poor job survey. Not an error path: the feedback itself always saves.
create or replace function public._case_open(p_client uuid, p_account uuid, p_contact uuid, p_market text, p_source text, p_feedback uuid, p_job uuid, p_score int, p_scale int, p_comment text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sev text; v_owner uuid; v_ack int; v_res int; v_id uuid; v_who text;
begin
  v_sev := case when (p_scale = 10 and p_score <= 3) or (p_scale = 5 and p_score <= 2) then 'high' else 'medium' end;
  select coalesce(ct.owner, a.account_lead), ct.full_name into v_owner, v_who
    from public.sourcing_clients c left join public.crm_contacts ct on ct.id = p_contact left join public.crm_accounts a on a.id = coalesce(p_account, ct.account_id) where c.id = p_client;
  v_ack := public.crm_setting(case when v_sev = 'high' then 'FEEDBACK_ACK_DAYS_HIGH' else 'FEEDBACK_ACK_DAYS' end, case when v_sev = 'high' then 1 else 2 end)::int;
  v_res := public.crm_setting(case when v_sev = 'high' then 'FEEDBACK_RESOLVE_DAYS_HIGH' else 'FEEDBACK_RESOLVE_DAYS' end, case when v_sev = 'high' then 7 else 14 end)::int;
  insert into public.crm_feedback_cases (client_id, account_id, contact_id, market, source, feedback_id, job_survey_id, score, scale, comment, severity, owner, ack_due, resolve_due)
  values (p_client, p_account, p_contact, p_market, p_source, p_feedback, p_job, p_score, p_scale, left(p_comment, 4000), v_sev, v_owner, current_date + v_ack, current_date + v_res) returning id into v_id;
  insert into public.crm_feedback_case_events (case_id, event, note, actor) values (v_id, 'opened', p_score || '/' || p_scale || case when p_comment is not null then ': ' || left(p_comment, 200) else '' end, null);
  if v_owner is not null then
    perform public.notify(v_owner, 'crm', case when v_sev = 'high' then 'Low feedback to act on today' else 'Low feedback to follow up' end,
      p_score || '/' || p_scale || coalesce(' from ' || v_who, ''), '/crm/feedback/cases/' || v_id);
  else
    perform public.notify(m.user_id, 'crm', 'Low feedback with no owner', p_score || '/' || p_scale || coalesce(' from ' || v_who, '') || '. Assign it.', '/crm/feedback/cases/' || v_id)
      from public.module_owners m where m.module = 'crm';
  end if;
  return v_id;
end $$;
revoke execute on function public._case_open(uuid, uuid, uuid, text, text, uuid, uuid, int, int, text) from public, anon, authenticated;

create or replace function public.trg_crm_feedback_case() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.score <= public.crm_setting('FEEDBACK_LOW_SCORE', 6)::int then
    begin
      perform public._case_open(new.client_id, new.account_id, new.contact_id, new.market, 'feedback', new.id, null, new.score, 10, new.comment);
    exception when others then raise warning 'Feedback case not opened: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
create trigger crm_feedback_case after insert on public.crm_feedback for each row execute function public.trg_crm_feedback_case();

create or replace function public.trg_crm_job_survey_case() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_acc uuid;
begin
  if new.status = 'responded' and old.status is distinct from 'responded' and new.overall is not null and new.overall <= 3 then
    begin
      select account_id into v_acc from public.crm_contacts where id = new.contact_id;
      perform public._case_open(new.client_id, v_acc, new.contact_id, null, 'job_survey', null, new.id, new.overall, 5, new.comment);
    exception when others then raise warning 'Job survey case not opened: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
create trigger crm_job_survey_case after update of status on public.crm_job_surveys for each row execute function public.trg_crm_job_survey_case();
revoke execute on function public.trg_crm_feedback_case(), public.trg_crm_job_survey_case() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Working a case (any CRM staff member)
-- ---------------------------------------------------------------------------
create or replace function public._case_get(p_id uuid) returns public.crm_feedback_cases
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases;
begin
  perform public._crm_require();
  select * into k from public.crm_feedback_cases where id = p_id for update;
  if k.id is null then raise exception 'Case not found'; end if;
  return k;
end $$;
revoke execute on function public._case_get(uuid) from public, anon, authenticated;

create or replace function public.crm_case_assign(p_id uuid, p_owner uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status = 'closed' then raise exception 'Reopen the case first'; end if;
  if p_owner is null or not public._crm_internal_person(p_owner) then raise exception 'Choose a colleague to own it'; end if;
  update public.crm_feedback_cases set owner = p_owner where id = p_id;
  perform public._case_log(p_id, 'assigned', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = p_owner) || coalesce('. ' || nullif(trim(p_note), ''), ''));
  if p_owner <> auth.uid() then perform public.notify(p_owner, 'crm', 'A feedback case was assigned to you', k.score || '/' || k.scale || coalesce(': ' || left(k.comment, 100), ''), '/crm/feedback/cases/' || p_id); end if;
end $$;

create or replace function public.crm_case_acknowledge(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status <> 'new' then raise exception 'This case has already been acknowledged'; end if;
  update public.crm_feedback_cases set status = 'acknowledged', acknowledged_at = now(), owner = coalesce(owner, auth.uid()) where id = p_id;
  perform public._case_log(p_id, 'acknowledged', p_note);
end $$;

-- Cause, root cause and what was done. Saving moves a new or acknowledged case to investigating.
create or replace function public.crm_case_save_findings(p_id uuid, p_cause text, p_root_cause text, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status in ('resolved', 'closed') then raise exception 'Reopen the case to change its findings'; end if;
  if p_cause is not null and p_cause not in ('service_quality', 'delivery', 'pricing', 'communication', 'product_quality', 'people', 'systems', 'other') then raise exception 'Choose a cause from the list'; end if;
  update public.crm_feedback_cases set cause = p_cause, root_cause = nullif(trim(p_root_cause), ''), action_taken = nullif(trim(p_action), ''),
    status = 'investigating', acknowledged_at = coalesce(acknowledged_at, now()), owner = coalesce(owner, auth.uid()) where id = p_id;
  perform public._case_log(p_id, 'findings_saved', coalesce(p_cause, '') || coalesce(' · ' || nullif(trim(p_root_cause), ''), ''));
end $$;

create or replace function public.crm_case_resolve(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status not in ('new', 'acknowledged', 'investigating') then raise exception 'This case is already resolved'; end if;
  if k.cause is null then raise exception 'Choose the cause first'; end if;
  if coalesce(k.root_cause, '') = '' then raise exception 'Record the root cause first'; end if;
  if coalesce(k.action_taken, '') = '' then raise exception 'Record what was done about it first'; end if;
  update public.crm_feedback_cases set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), acknowledged_at = coalesce(acknowledged_at, now()) where id = p_id;
  perform public._case_log(p_id, 'resolved', p_note);
  -- Keep the older follow-up record and the health counts in step.
  if k.feedback_id is not null then
    update public.crm_feedback set followed_up_at = coalesce(followed_up_at, now()), followed_up_by = coalesce(followed_up_by, auth.uid()),
      follow_up_note = coalesce(follow_up_note, left(k.action_taken, 1000)) where id = k.feedback_id;
  end if;
end $$;

create or replace function public.crm_case_inform_client(p_id uuid, p_how text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status = 'closed' then raise exception 'This case is closed'; end if;
  if coalesce(trim(p_how), '') = '' then raise exception 'Say how the client was told (call, meeting, email)'; end if;
  update public.crm_feedback_cases set client_informed_at = now(), client_informed_by = auth.uid(), client_informed_how = trim(p_how) where id = p_id;
  perform public._case_log(p_id, 'client_informed', trim(p_how) || coalesce('. ' || nullif(trim(p_note), ''), ''));
end $$;

create or replace function public.crm_case_close(p_id uuid, p_outcome text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status <> 'resolved' then raise exception 'Resolve the case before closing it'; end if;
  if k.client_informed_at is null then raise exception 'Tell the client what was done, and record it, before closing'; end if;
  if p_outcome not in ('satisfied', 'neutral', 'not_satisfied', 'no_response') then raise exception 'Record how the client reacted'; end if;
  if p_outcome = 'not_satisfied' and coalesce(trim(p_note), '') = '' then raise exception 'Say what the client is still unhappy about'; end if;
  update public.crm_feedback_cases set status = 'closed', closed_at = now(), closed_by = auth.uid(), client_outcome = p_outcome where id = p_id;
  perform public._case_log(p_id, 'closed', p_outcome || coalesce('. ' || nullif(trim(p_note), ''), ''));
  if k.feedback_id is not null then update public.crm_actions set status = 'done', done_at = now(), updated_at = now() where feedback_id = k.feedback_id and status in ('open', 'in_progress'); end if;
  perform public._crm_event(k.client_id, 'feedback_case', p_id::text, 'closed', jsonb_build_object('outcome', p_outcome, 'cause', k.cause));
end $$;

create or replace function public.crm_case_reopen(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status not in ('resolved', 'closed') then raise exception 'Only a resolved or closed case can be reopened'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is reopened'; end if;
  update public.crm_feedback_cases set status = 'investigating', resolved_at = null, resolved_by = null, closed_at = null, closed_by = null, client_outcome = null,
    resolve_due = greatest(resolve_due, current_date + 7), resolve_alerted_at = null where id = p_id;
  perform public._case_log(p_id, 'reopened', p_note);
end $$;

create or replace function public.crm_case_escalate(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if k.status = 'closed' then raise exception 'This case is closed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is being escalated'; end if;
  update public.crm_feedback_cases set escalated_at = now(), escalation_note = trim(p_note) where id = p_id;
  perform public._case_log(p_id, 'escalated', p_note);
  perform public.notify(m.user_id, 'crm', 'A feedback case was escalated', left(trim(p_note), 160), '/crm/feedback/cases/' || p_id) from public.module_owners m where m.module = 'crm' and m.user_id <> auth.uid();
end $$;

create or replace function public.crm_case_comment(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.crm_feedback_cases := public._case_get(p_id);
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a note first'; end if;
  perform public._case_log(p_id, 'note', p_note);
end $$;

-- Totals for the queue page: open, late, speed, and what is behind the complaints.
create or replace function public.crm_feedback_case_stats(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  return (select jsonb_build_object(
    'open', count(*) filter (where status <> 'closed'),
    'unacknowledged', count(*) filter (where status = 'new'),
    'overdue', count(*) filter (where (status = 'new' and ack_due < current_date) or (status in ('new', 'acknowledged', 'investigating') and resolve_due < current_date)),
    'high_open', count(*) filter (where status <> 'closed' and severity = 'high'),
    'closed_90d', count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days'),
    'avg_days_to_close', round(avg(extract(epoch from (closed_at - created_at)) / 86400) filter (where status = 'closed' and closed_at > now() - interval '90 days'), 1),
    'within_target_pct', round(100.0 * count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days' and closed_at::date <= resolve_due)
                         / nullif(count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days'), 0)),
    'satisfied_pct', round(100.0 * count(*) filter (where client_outcome = 'satisfied' and closed_at > now() - interval '90 days')
                         / nullif(count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days'), 0)),
    'by_cause', coalesce((select jsonb_object_agg(cause, n) from (select cause, count(*) n from public.crm_feedback_cases c2 where cause is not null and (p_client is null or c2.client_id = p_client) and c2.created_at > now() - interval '12 months' group by cause) x), '{}'::jsonb))
    from public.crm_feedback_cases where p_client is null or client_id = p_client);
end $$;

-- Platform runner: tell owners about cases that are late. Each late step is flagged once.
create or replace function public.crm_feedback_run_due() returns jsonb
language plpgsql security definer set search_path = public as $$
declare k record; v_ack int := 0; v_res int := 0;
begin
  for k in select id, owner, score, scale, status, ack_due, resolve_due, ack_alerted_at, resolve_alerted_at from public.crm_feedback_cases
            where status in ('new', 'acknowledged', 'investigating') and ((status = 'new' and ack_due < current_date and ack_alerted_at is null) or (resolve_due < current_date and resolve_alerted_at is null)) loop
    if k.status = 'new' and k.ack_due < current_date and k.ack_alerted_at is null then
      perform public.notify(u, 'crm', 'Feedback case not yet acknowledged', k.score || '/' || k.scale || ' was due to be acknowledged by ' || to_char(k.ack_due, 'DD Mon'), '/crm/feedback/cases/' || k.id)
        from unnest(case when k.owner is not null then array[k.owner] else coalesce((select array_agg(user_id) from public.module_owners where module = 'crm'), '{}') end) u;
      update public.crm_feedback_cases set ack_alerted_at = now() where id = k.id; v_ack := v_ack + 1;
    end if;
    if k.resolve_due < current_date and k.resolve_alerted_at is null then
      perform public.notify(u, 'crm', 'Feedback case is past its date', k.score || '/' || k.scale || ' was due to be resolved by ' || to_char(k.resolve_due, 'DD Mon'), '/crm/feedback/cases/' || k.id)
        from unnest(case when k.owner is not null then array[k.owner] else coalesce((select array_agg(user_id) from public.module_owners where module = 'crm'), '{}') end) u;
      update public.crm_feedback_cases set resolve_alerted_at = now() where id = k.id; v_res := v_res + 1;
    end if;
  end loop;
  return jsonb_build_object('acknowledgement_alerts', v_ack, 'resolution_alerts', v_res);
end $$;

revoke execute on function public.crm_case_assign(uuid, uuid, text), public.crm_case_acknowledge(uuid, text), public.crm_case_save_findings(uuid, text, text, text),
  public.crm_case_resolve(uuid, text), public.crm_case_inform_client(uuid, text, text), public.crm_case_close(uuid, text, text), public.crm_case_reopen(uuid, text),
  public.crm_case_escalate(uuid, text), public.crm_case_comment(uuid, text), public.crm_feedback_case_stats(uuid) from public, anon;
grant execute on function public.crm_case_assign(uuid, uuid, text), public.crm_case_acknowledge(uuid, text), public.crm_case_save_findings(uuid, text, text, text),
  public.crm_case_resolve(uuid, text), public.crm_case_inform_client(uuid, text, text), public.crm_case_close(uuid, text, text), public.crm_case_reopen(uuid, text),
  public.crm_case_escalate(uuid, text), public.crm_case_comment(uuid, text), public.crm_feedback_case_stats(uuid) to authenticated;
revoke execute on function public.crm_feedback_run_due() from public, anon, authenticated;

-- Cases for what is already on file: followed-up feedback is closed with its note; the rest is new.
insert into public.crm_feedback_cases (client_id, account_id, contact_id, market, source, feedback_id, score, scale, comment, severity, owner, ack_due, resolve_due, status,
                                       acknowledged_at, resolved_at, closed_at, action_taken, created_at)
select f.client_id, f.account_id, f.contact_id, f.market, 'feedback', f.id, f.score, 10, f.comment, case when f.score <= 3 then 'high' else 'medium' end,
       coalesce(ct.owner, a.account_lead), f.created_at::date + case when f.score <= 3 then 1 else 2 end, f.created_at::date + case when f.score <= 3 then 7 else 14 end,
       case when f.followed_up_at is null then 'new' else 'closed' end, f.followed_up_at, f.followed_up_at, f.followed_up_at, f.follow_up_note, f.created_at
  from public.crm_feedback f left join public.crm_contacts ct on ct.id = f.contact_id left join public.crm_accounts a on a.id = coalesce(f.account_id, ct.account_id)
 where f.score <= 6 and not exists (select 1 from public.crm_feedback_cases k where k.feedback_id = f.id);
