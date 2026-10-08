-- Assure+ action plans (tasks), surveys and approval workflows.
-- Tasks: open -> in_progress -> completed -> verified. Staff or the supplier's vendor users move a task to completed;
--        only staff verify, and not the person who completed it.
-- Surveys: staff build versioned templates and launch them; the vendor answers; staff review. Answers are kept
--          against a snapshot of the questions, so editing a template never changes what was asked.
-- Workflows: templates of steps with an approver role; instances advance one step at a time through
--            assure_workflow_act(), which checks the approver's role and stops one person approving two steps in a row.

-- ---------------------------------------------------------------------------
-- Action plan tasks
-- ---------------------------------------------------------------------------
create table public.action_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  title text not null check (length(trim(title)) > 0),
  description text,
  category text not null default 'quality' check (category in ('quality','delivery','compliance','cost','sustainability','other')),
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  due_date date,
  source text not null default 'manual' check (source in ('manual','ncr','issue','review','pre_assessment')),
  source_id uuid,
  -- decision fields: only via assure_task_set_status()
  status text not null default 'open' check (status in ('open','in_progress','completed','verified')),
  progress_notes text,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index action_plan_tasks_supplier_idx on public.action_plan_tasks (supplier_id, status);
create trigger action_plan_tasks_region before insert on public.action_plan_tasks
  for each row execute function public._assure_fill_region_market();

create or replace function public._task_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'open'; new.completed_by := null; new.completed_at := null;
    new.verified_by := null; new.verified_at := null;
  else
    new.status := old.status; new.completed_by := old.completed_by; new.completed_at := old.completed_at;
    new.verified_by := old.verified_by; new.verified_at := old.verified_at; new.created_by := old.created_by;
    new.supplier_id := old.supplier_id;
  end if;
  return new;
end $$;
create trigger action_plan_tasks_before before insert or update on public.action_plan_tasks
  for each row execute function public._task_before();

create or replace function public._task_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._assure_log(new.supplier_id, 'task', new.id, 'created', null, 'open', 'Action added: ' || new.title, null);
  return null;
end $$;
create trigger action_plan_tasks_after after insert on public.action_plan_tasks
  for each row execute function public._task_after();

alter table public.action_plan_tasks enable row level security;
create policy apt_read on public.action_plan_tasks for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy apt_insert on public.action_plan_tasks for insert to authenticated with check (public.is_internal());
create policy apt_update on public.action_plan_tasks for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy apt_delete on public.action_plan_tasks for delete to authenticated using (public.is_admin());

create or replace function public.assure_task_set_status(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare k public.action_plan_tasks; v_internal boolean := public.is_internal();
begin
  select * into k from public.action_plan_tasks where id = p_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not v_internal and (public.my_supplier_id() is null or k.supplier_id <> public.my_supplier_id()) then
    raise exception 'This task is not for your company' using errcode = '42501';
  end if;
  if k.status = p_status then return; end if;
  if p_status = 'in_progress' then
    if k.status = 'verified' then raise exception 'A verified task is closed'; end if;
    if k.status = 'completed' and not v_internal then raise exception 'Ask adm Indicia to reopen a completed task' using errcode = '42501'; end if;
  elsif p_status = 'completed' then
    if k.status not in ('open','in_progress') then raise exception 'Only an open task can be completed'; end if;
  elsif p_status = 'verified' then
    if not v_internal then raise exception 'Only adm Indicia staff can verify a task' using errcode = '42501'; end if;
    if k.status <> 'completed' then raise exception 'Only a completed task can be verified'; end if;
    if k.completed_by = auth.uid() then raise exception 'You completed this task, so someone else must verify it' using errcode = '42501'; end if;
  elsif p_status = 'open' then
    if not v_internal then raise exception 'Only adm Indicia staff can reopen a task' using errcode = '42501'; end if;
  else
    raise exception 'Unknown status %', p_status;
  end if;
  perform set_config('assure.system_write', 'on', true);
  update public.action_plan_tasks set status = p_status,
    progress_notes = coalesce(nullif(trim(p_note), ''), progress_notes),
    completed_by = case when p_status = 'completed' then auth.uid() when p_status in ('open','in_progress') then null else completed_by end,
    completed_at = case when p_status = 'completed' then now() when p_status in ('open','in_progress') then null else completed_at end,
    verified_by = case when p_status = 'verified' then auth.uid() else null end,
    verified_at = case when p_status = 'verified' then now() else null end
  where id = p_id;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(k.supplier_id, 'task', p_id, 'status_changed', k.status, p_status, k.title, nullif(trim(p_note), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------------
create table public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  category text not null default 'general' check (category in ('onboarding','compliance','performance','esg','quality','general')),
  -- [{id, text, type, options[], required}]
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  version int not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public._survey_template_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  for q in select * from jsonb_array_elements(new.questions) loop
    if nullif(trim(coalesce(q->>'text', '')), '') is null or nullif(q->>'id', '') is null then raise exception 'Every question needs an id and text'; end if;
    if q->>'type' not in ('text','textarea','single_choice','multiple_choice','rating','yes_no','date') then
      raise exception 'Unknown question type %', q->>'type';
    end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(new.questions) x) <> jsonb_array_length(new.questions) then
    raise exception 'Question ids must be unique';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.version := 1;
  else
    new.created_by := old.created_by;
    new.version := case when new.questions is distinct from old.questions then old.version + 1 else old.version end;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger survey_templates_before before insert or update on public.survey_templates
  for each row execute function public._survey_template_before();

alter table public.survey_templates enable row level security;
create policy st_read on public.survey_templates for select to authenticated using (public.is_internal());
create policy st_insert on public.survey_templates for insert to authenticated with check (public.is_internal());
create policy st_update on public.survey_templates for update to authenticated using (public.is_internal()) with check (public.is_internal());
revoke delete on public.survey_templates from authenticated, anon;

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.survey_templates(id) on delete restrict,
  template_version int not null,
  template_name text not null,
  questions jsonb not null,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  due_date date,
  -- decision fields: only via the functions below
  status text not null default 'draft' check (status in ('draft','submitted','under_review','completed','rejected')),
  answers jsonb not null default '[]'::jsonb,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  feedback_to_vendor text,
  launched_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index survey_responses_supplier_idx on public.survey_responses (supplier_id);
create trigger survey_responses_region before insert on public.survey_responses
  for each row execute function public._assure_fill_region_market();

alter table public.survey_responses enable row level security;
create policy sr_read on public.survey_responses for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.survey_responses from authenticated, anon;

create view public.vendor_survey_responses as
  select id, template_name, questions, supplier_id, due_date, status, answers, submitted_at, reviewed_at, feedback_to_vendor, created_at
    from public.survey_responses where supplier_id = public.my_supplier_id();
revoke all on public.vendor_survey_responses from anon;
grant select on public.vendor_survey_responses to authenticated;

create or replace function public.assure_survey_launch(p_template uuid, p_supplier uuid, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare tp public.survey_templates; v_id uuid;
begin
  perform public._assure_require_internal();
  select * into tp from public.survey_templates where id = p_template;
  if not found or not tp.is_active then raise exception 'Choose an active survey template'; end if;
  if jsonb_array_length(tp.questions) = 0 then raise exception 'This template has no questions'; end if;
  insert into public.survey_responses (template_id, template_version, template_name, questions, supplier_id, due_date, launched_by)
  values (tp.id, tp.version, tp.name, tp.questions, p_supplier, p_due, auth.uid()) returning id into v_id;
  perform public._assure_log(p_supplier, 'survey', v_id, 'launched', null, 'draft', 'Survey sent: ' || tp.name, null);
  return v_id;
end $$;

-- Vendor answers. p_answers: {question_id: answer-string}. Required questions must have an answer.
create or replace function public.assure_survey_submit(p_id uuid, p_answers jsonb, p_final boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.survey_responses; q jsonb; v_out jsonb := '[]'::jsonb; a text;
begin
  select * into r from public.survey_responses where id = p_id for update;
  if not found or public.my_supplier_id() is null or r.supplier_id <> public.my_supplier_id() or public.is_internal() then
    raise exception 'Only the vendor this survey was sent to can answer it' using errcode = '42501';
  end if;
  if r.status not in ('draft','rejected') then raise exception 'This survey has already been submitted'; end if;
  for q in select * from jsonb_array_elements(r.questions) loop
    a := nullif(trim(coalesce(p_answers->>(q->>'id'), '')), '');
    if p_final and coalesce((q->>'required')::boolean, true) and a is null then
      raise exception 'Answer the required question: %', q->>'text';
    end if;
    if a is not null and q->>'type' = 'rating' and a !~ '^[1-5]$' then raise exception 'Ratings are 1 to 5'; end if;
    v_out := v_out || jsonb_build_object('question_id', q->>'id', 'question_text', q->>'text', 'question_type', q->>'type', 'answer', a);
  end loop;
  update public.survey_responses set answers = v_out,
    status = case when p_final then 'submitted' else status end,
    submitted_by = case when p_final then auth.uid() else submitted_by end,
    submitted_at = case when p_final then now() else submitted_at end
   where id = p_id;
  if p_final then
    perform public._assure_log(r.supplier_id, 'survey', p_id, 'submitted', r.status, 'submitted', 'Survey answered: ' || r.template_name, null);
  end if;
end $$;

create or replace function public.assure_survey_review(p_id uuid, p_decision text, p_notes text, p_feedback text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.survey_responses; v_to text;
begin
  perform public._assure_require_internal();
  select * into r from public.survey_responses where id = p_id for update;
  if not found then raise exception 'Survey response not found'; end if;
  if r.status not in ('submitted','under_review') then raise exception 'Only a submitted survey can be reviewed'; end if;
  v_to := case p_decision when 'start' then 'under_review' when 'approve' then 'completed' when 'reject' then 'rejected' end;
  if v_to is null then raise exception 'Unknown decision %', p_decision; end if;
  if p_decision = 'reject' and nullif(trim(coalesce(p_feedback, '')), '') is null then raise exception 'Tell the vendor what to change'; end if;
  update public.survey_responses set status = v_to, reviewed_by = auth.uid(), reviewed_at = now(),
    review_notes = coalesce(nullif(trim(p_notes), ''), review_notes), feedback_to_vendor = coalesce(nullif(trim(p_feedback), ''), feedback_to_vendor)
   where id = p_id;
  perform public._assure_log(r.supplier_id, 'survey', p_id, 'review_' || p_decision, r.status, v_to, 'Survey ' || v_to || ': ' || r.template_name, nullif(trim(p_notes), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Workflows
-- ---------------------------------------------------------------------------
create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  workflow_type text not null default 'custom' check (workflow_type in ('onboarding','tier_upgrade','annual_review','compliance_renewal','offboarding','custom')),
  category text not null default 'other' check (category in ('supplier_onboarding','compliance_review','performance_review','commercial_review','offboarding','other')),
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  -- [{title, description, approver_role, sla_days, required_documents[]}]
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) >= 1),
  version int not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public._wf_template_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  for s in select * from jsonb_array_elements(new.steps) loop
    if nullif(trim(coalesce(s->>'title', '')), '') is null then raise exception 'Every step needs a title'; end if;
    if coalesce(s->>'approver_role', '') not in ('vendor_manager','procurement_lead','compliance','executive') then
      raise exception 'Unknown approver role %', s->>'approver_role';
    end if;
    if coalesce((s->>'sla_days')::int, 0) < 1 then raise exception 'Each step needs a target of at least one day'; end if;
  end loop;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.version := 1;
  else
    new.created_by := old.created_by;
    new.version := case when new.steps is distinct from old.steps then old.version + 1 else old.version end;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger workflow_templates_before before insert or update on public.workflow_templates
  for each row execute function public._wf_template_before();

alter table public.workflow_templates enable row level security;
create policy wt_read on public.workflow_templates for select to authenticated using (public.is_internal());
create policy wt_insert on public.workflow_templates for insert to authenticated with check (public.is_internal());
create policy wt_update on public.workflow_templates for update to authenticated using (public.is_internal()) with check (public.is_internal());
revoke delete on public.workflow_templates from authenticated, anon;

create table public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.workflow_templates(id) on delete set null,
  template_version int,
  name text not null,
  workflow_type text not null,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status text not null default 'in_progress' check (status in ('in_progress','on_hold','completed','cancelled','rejected')),
  current_step int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  initiated_by uuid references public.profiles(id) on delete set null
);
create index workflow_instances_supplier_idx on public.workflow_instances (supplier_id);
create trigger workflow_instances_region before insert on public.workflow_instances
  for each row execute function public._assure_fill_region_market();

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  idx int not null,
  name text not null,
  description text,
  approver_role text not null,
  sla_days int not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','in_progress','approved','rejected','skipped')),
  acted_by uuid references public.profiles(id) on delete set null,
  acted_at timestamptz,
  notes text,
  unique (instance_id, idx)
);

alter table public.workflow_instances enable row level security;
alter table public.workflow_steps enable row level security;
create policy wi_read on public.workflow_instances for select to authenticated using (public.is_internal());
create policy ws_read on public.workflow_steps for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.workflow_instances, public.workflow_steps from authenticated, anon;

-- Who may act on a step with this approver role.
create or replace function public.assure_can_approve(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or case p_role
    when 'vendor_manager' then coalesce(public.my_srt_role(), '') in ('agent','lead')
    when 'compliance' then coalesce(public.my_srt_role(), '') in ('agent','lead')
    when 'procurement_lead' then coalesce(public.my_srt_role(), '') in ('procurement','head')
    when 'executive' then coalesce(public.my_srt_role(), '') = 'head'
    else false end;
$$;

create or replace function public.assure_workflow_launch(p_template uuid, p_supplier uuid, p_priority text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tp public.workflow_templates; v_id uuid; s jsonb; i int := 0; v_due date := current_date;
begin
  perform public._assure_require_internal();
  select * into tp from public.workflow_templates where id = p_template;
  if not found or not tp.is_active then raise exception 'Choose an active workflow template'; end if;
  insert into public.workflow_instances (template_id, template_version, name, workflow_type, supplier_id, priority, initiated_by)
  values (tp.id, tp.version, tp.name, tp.workflow_type, p_supplier, coalesce(p_priority, tp.priority), auth.uid()) returning id into v_id;
  for s in select * from jsonb_array_elements(tp.steps) loop
    v_due := v_due + (s->>'sla_days')::int;   -- cumulative: each step's target starts when the previous one is due
    insert into public.workflow_steps (instance_id, idx, name, description, approver_role, sla_days, due_date, status)
    values (v_id, i, s->>'title', s->>'description', s->>'approver_role', (s->>'sla_days')::int, v_due, case when i = 0 then 'in_progress' else 'pending' end);
    i := i + 1;
  end loop;
  perform public._assure_log(p_supplier, 'workflow', v_id, 'launched', null, 'in_progress', 'Workflow started: ' || tp.name, null);
  return v_id;
end $$;

create or replace function public.assure_workflow_act(p_instance uuid, p_action text, p_notes text)
returns text language plpgsql security definer set search_path = public as $$
declare w public.workflow_instances; st public.workflow_steps; prev public.workflow_steps; v_last int; v_to text;
begin
  perform public._assure_require_internal();
  select * into w from public.workflow_instances where id = p_instance for update;
  if not found then raise exception 'Workflow not found'; end if;
  if w.status in ('completed','cancelled','rejected') then raise exception 'This workflow is %', w.status; end if;
  select * into st from public.workflow_steps where instance_id = p_instance and idx = w.current_step for update;
  select max(idx) into v_last from public.workflow_steps where instance_id = p_instance;

  if p_action in ('approve','reject') then
    if not public.assure_can_approve(st.approver_role) then
      raise exception 'This step needs a % to approve it', replace(st.approver_role, '_', ' ') using errcode = '42501';
    end if;
    select * into prev from public.workflow_steps where instance_id = p_instance and idx = w.current_step - 1;
    if p_action = 'approve' and prev.acted_by = auth.uid() then
      raise exception 'You approved the previous step, so someone else must approve this one' using errcode = '42501';
    end if;
    if p_action = 'reject' and nullif(trim(coalesce(p_notes, '')), '') is null then raise exception 'Say why the step is rejected'; end if;
    update public.workflow_steps set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      acted_by = auth.uid(), acted_at = now(), notes = nullif(trim(p_notes), '') where id = st.id;
    if p_action = 'reject' then
      update public.workflow_instances set status = 'rejected', completed_at = now() where id = p_instance;
      v_to := 'rejected';
    elsif w.current_step >= v_last then
      update public.workflow_instances set status = 'completed', completed_at = now() where id = p_instance;
      v_to := 'completed';
    else
      update public.workflow_steps set status = 'in_progress' where instance_id = p_instance and idx = w.current_step + 1;
      update public.workflow_instances set current_step = w.current_step + 1, status = 'in_progress' where id = p_instance;
      v_to := 'in_progress';
    end if;
  elsif p_action = 'hold' then
    if w.status <> 'in_progress' then raise exception 'Only a running workflow can be put on hold'; end if;
    update public.workflow_instances set status = 'on_hold' where id = p_instance; v_to := 'on_hold';
  elsif p_action = 'resume' then
    if w.status <> 'on_hold' then raise exception 'Only a held workflow can be resumed'; end if;
    update public.workflow_instances set status = 'in_progress' where id = p_instance; v_to := 'in_progress';
  elsif p_action = 'cancel' then
    if nullif(trim(coalesce(p_notes, '')), '') is null then raise exception 'Say why the workflow is cancelled'; end if;
    update public.workflow_instances set status = 'cancelled', completed_at = now() where id = p_instance; v_to := 'cancelled';
  else
    raise exception 'Unknown action %', p_action;
  end if;
  perform public._assure_log(w.supplier_id, 'workflow', p_instance, p_action, w.status, v_to,
    w.name || case when p_action in ('approve','reject') then ': ' || st.name || ' ' || p_action || 'd' else ' ' || v_to end, nullif(trim(p_notes), ''));
  return v_to;
end $$;

revoke execute on function public._task_before(), public._task_after(), public._survey_template_before(), public._wf_template_before()
  from public, anon, authenticated;
grant execute on function public.assure_task_set_status(uuid, text, text), public.assure_survey_launch(uuid, uuid, date),
  public.assure_survey_submit(uuid, jsonb, boolean), public.assure_survey_review(uuid, text, text, text), public.assure_can_approve(text),
  public.assure_workflow_launch(uuid, uuid, text), public.assure_workflow_act(uuid, text, text) to authenticated;

-- Preset workflow templates (from the prototype's WorkflowTemplates presets).
insert into public.workflow_templates (name, description, workflow_type, category, priority, steps) values
  ('Vendor onboarding', 'Standard onboarding approvals for a new vendor.', 'onboarding', 'supplier_onboarding', 'medium',
   '[{"title":"Document review","approver_role":"vendor_manager","sla_days":3},{"title":"Compliance check","approver_role":"compliance","sla_days":5},{"title":"Commercial terms","approver_role":"procurement_lead","sla_days":5},{"title":"Quality assessment","approver_role":"vendor_manager","sla_days":4},{"title":"Final approval","approver_role":"executive","sla_days":2}]'),
  ('Tier upgrade', 'Move a supplier up a tier on the strength of its performance.', 'tier_upgrade', 'performance_review', 'medium',
   '[{"title":"Performance review","approver_role":"vendor_manager","sla_days":3},{"title":"Commercial review","approver_role":"procurement_lead","sla_days":3},{"title":"Executive approval","approver_role":"executive","sla_days":2}]'),
  ('Annual review', 'Yearly review of performance, compliance and terms before renewal.', 'annual_review', 'performance_review', 'medium',
   '[{"title":"Performance assessment","approver_role":"vendor_manager","sla_days":5},{"title":"Compliance audit","approver_role":"compliance","sla_days":5},{"title":"Commercial review","approver_role":"procurement_lead","sla_days":4},{"title":"Renewal decision","approver_role":"executive","sla_days":3}]'),
  ('Compliance renewal', 'Collect and approve renewed compliance documents.', 'compliance_renewal', 'compliance_review', 'high',
   '[{"title":"Document request","approver_role":"vendor_manager","sla_days":2},{"title":"Compliance review","approver_role":"compliance","sla_days":3},{"title":"Approval","approver_role":"compliance","sla_days":1}]'),
  ('Offboarding', 'Close out a supplier relationship cleanly.', 'offboarding', 'offboarding', 'medium',
   '[{"title":"Notice acknowledgement","approver_role":"vendor_manager","sla_days":2},{"title":"Asset recovery","approver_role":"vendor_manager","sla_days":5},{"title":"Final settlement","approver_role":"procurement_lead","sla_days":5},{"title":"Deactivation","approver_role":"executive","sla_days":2}]');
