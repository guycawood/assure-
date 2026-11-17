-- Form governance (Vendor Sys G deck): changes to the vendor onboarding form need a joint sign-off.
-- The onboarding pre-assessment keeps its fixed sections; what can change is the set of extra questions shown to vendors.
-- Each change is a version: procurement edits a draft and proposes it; a procurement director AND the Sustainability team both sign
-- (joint approval 'form_change'); on the second signature the version is published and the previous one retired. A rejection or
-- withdrawal returns it to draft. Vendors only ever see the published version, and their answers record which version they answered.

create table public.srm_form_versions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null check (form_key in ('onboarding')),
  version int not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'published', 'retired')),
  questions jsonb not null default '[]'::jsonb,
  change_note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  joint_approval_id uuid references public.joint_approvals(id),
  unique (form_key, version)
);
create unique index srm_form_one_open on public.srm_form_versions (form_key) where status in ('draft', 'pending');
create unique index srm_form_one_published on public.srm_form_versions (form_key) where status = 'published';
alter table public.srm_form_versions enable row level security;
create policy srm_form_read on public.srm_form_versions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.srm_form_versions from authenticated, anon;

-- Question rules: up to 40; each has a stable id, text, a known type, and options for choice questions.
create or replace function public._form_check_questions(p jsonb) returns jsonb
language plpgsql immutable as $$
declare q jsonb; v_ids text[] := '{}'; v_id text; v_type text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Questions must be a list'; end if;
  if jsonb_array_length(p) > 40 then raise exception 'A form can have at most 40 extra questions'; end if;
  for q in select * from jsonb_array_elements(p) loop
    v_id := q->>'id'; v_type := q->>'type';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{1,23}$' then raise exception 'Every question needs a short id'; end if;
    if v_id = any (v_ids) then raise exception 'Two questions share an id'; end if;
    v_ids := v_ids || v_id;
    if coalesce(trim(q->>'text'), '') = '' or length(q->>'text') > 300 then raise exception 'Every question needs text of up to 300 characters'; end if;
    if v_type not in ('text', 'textarea', 'single_choice', 'multiple_choice', 'rating', 'yes_no', 'date') then raise exception 'Unknown question type %', v_type; end if;
    if v_type in ('single_choice', 'multiple_choice') and (jsonb_typeof(q->'options') <> 'array' or jsonb_array_length(q->'options') < 2) then
      raise exception 'Choice questions need at least two options'; end if;
  end loop;
  return p;
end $$;

create or replace function public._form_require_editor() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  if not public.division_can('assure', 'manage_libraries') then raise exception 'Only the SRM owners can change the onboarding form' using errcode = '42501'; end if;
end $$;
revoke execute on function public._form_require_editor() from public, anon, authenticated;

-- v1 is the form as it is today: no extra questions, published.
insert into public.srm_form_versions (form_key, version, status, questions, change_note, published_at) values ('onboarding', 1, 'published', '[]', 'Starting form', now());

-- Create or update the open draft (starts from the published questions when there is none).
create or replace function public.form_draft_save(p_form text, p_questions jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.srm_form_versions; v_next int; v_q jsonb;
begin
  perform public._form_require_editor();
  v_q := public._form_check_questions(p_questions);
  select * into d from public.srm_form_versions where form_key = p_form and status in ('draft', 'pending') for update;
  if d.status = 'pending' then raise exception 'A change is already waiting for sign-off. Withdraw it first to edit' ; end if;
  if d.id is null then
    select coalesce(max(version), 0) + 1 into v_next from public.srm_form_versions where form_key = p_form;
    insert into public.srm_form_versions (form_key, version, questions, change_note) values (p_form, v_next, v_q, nullif(trim(p_note), '')) returning * into d;
  else
    update public.srm_form_versions set questions = v_q, change_note = nullif(trim(p_note), '') where id = d.id;
  end if;
  return d.id;
end $$;

create or replace function public.form_draft_discard(p_form text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._form_require_editor();
  delete from public.srm_form_versions where form_key = p_form and status = 'draft';
end $$;

-- Send the draft for joint sign-off.
create or replace function public.form_propose(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.srm_form_versions; p public.srm_form_versions; v_add int; v_del int; v_id uuid; v_sum text;
begin
  perform public._form_require_editor();
  select * into d from public.srm_form_versions where id = p_id for update;
  if d.id is null or d.status <> 'draft' then raise exception 'Only a draft can be sent for sign-off'; end if;
  select * into p from public.srm_form_versions where form_key = d.form_key and status = 'published';
  select count(*) into v_add from jsonb_array_elements(d.questions) q where not exists (select 1 from jsonb_array_elements(p.questions) o where o->>'id' = q->>'id');
  select count(*) into v_del from jsonb_array_elements(p.questions) o where not exists (select 1 from jsonb_array_elements(d.questions) q where o->>'id' = q->>'id');
  if v_add = 0 and v_del = 0 and d.questions = p.questions then raise exception 'Nothing has changed from the published form'; end if;
  v_sum := format('Onboarding form version %s: %s added, %s removed, %s questions in total%s', d.version, v_add, v_del, jsonb_array_length(d.questions),
                  case when d.change_note is null then '' else '. ' || d.change_note end);
  v_id := public.joint_approval_request('form_change', d.id, v_sum, null);
  update public.srm_form_versions set status = 'pending', joint_approval_id = v_id where id = d.id;
  return v_id;
end $$;

create or replace function public.form_versions_list(p_form text default 'onboarding') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', v.id, 'version', v.version, 'status', v.status, 'questions', v.questions, 'change_note', v.change_note, 'created_at', v.created_at, 'published_at', v.published_at,
    'created_by', (select full_name from public.profiles where id = v.created_by), 'approval_id', v.joint_approval_id) order by v.version desc)
    from public.srm_form_versions v where v.form_key = p_form), '[]'::jsonb);
end $$;

-- The vendor sees only the published questions.
create or replace function public.vendor_form_questions(p_form text default 'onboarding') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_supplier_id() is null and not public.is_internal() then raise exception 'Only a vendor user can do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_build_object('version', version, 'questions', questions) from public.srm_form_versions where form_key = p_form and status = 'published'), jsonb_build_object('version', 0, 'questions', '[]'::jsonb));
end $$;

revoke execute on function public.form_draft_save(text, jsonb, text), public.form_draft_discard(text), public.form_propose(uuid),
  public.form_versions_list(text), public.vendor_form_questions(text), public._form_check_questions(jsonb) from public, anon;
grant execute on function public.form_draft_save(text, jsonb, text), public.form_draft_discard(text), public.form_propose(uuid),
  public.form_versions_list(text), public.vendor_form_questions(text) to authenticated;
revoke execute on function public._form_check_questions(jsonb) from authenticated;

-- Outcome of the joint approval: publish on approval, back to draft on rejection or withdrawal.
create or replace function public.trg_joint_apply_forms() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.srm_form_versions;
begin
  if new.subject_type = 'form_change' and new.status is distinct from old.status then
    select * into d from public.srm_form_versions where id = new.subject_id;
    if d.id is null then return new; end if;
    if new.status = 'approved' then
      update public.srm_form_versions set status = 'retired' where form_key = d.form_key and status = 'published';
      update public.srm_form_versions set status = 'published', published_at = now() where id = d.id;
    elsif new.status in ('rejected', 'withdrawn') and d.status = 'pending' then
      update public.srm_form_versions set status = 'draft', joint_approval_id = null where id = d.id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.trg_joint_apply_forms() from public, anon, authenticated;
create trigger joint_apply_forms after update of status on public.joint_approvals for each row execute function public.trg_joint_apply_forms();

-- Withdrawing the approval from the SRM page also has to work from the form: the approval's own withdraw already returns the draft above.
