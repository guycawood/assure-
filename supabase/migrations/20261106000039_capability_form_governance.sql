-- Form governance for the vendor capability profile. The three entry forms (capability, machine, tooling) keep their fixed fields; what can
-- change is the extra questions asked on each, using the same versions and joint sign-off as the onboarding form: SRM owners draft and
-- propose, a procurement director AND the Sustainability team both sign, then it goes live. Each saved entry keeps the question text and
-- the answer as they were when it was saved, so later changes to the form never rewrite what a vendor declared.

alter table public.srm_form_versions drop constraint srm_form_versions_form_key_check;
alter table public.srm_form_versions add constraint srm_form_versions_form_key_check check (form_key in ('onboarding', 'capability', 'machine', 'tooling'));
insert into public.srm_form_versions (form_key, version, status, questions, change_note, published_at)
select k, 1, 'published', '[]', 'Starting form', now() from unnest(array['capability', 'machine', 'tooling']) k;

alter table public.supplier_capabilities add column custom jsonb not null default '{}'::jsonb, add column custom_form_version int;
alter table public.supplier_machines add column custom jsonb not null default '{}'::jsonb, add column custom_form_version int;
alter table public.supplier_tooling add column custom jsonb not null default '{}'::jsonb, add column custom_form_version int;

-- The sign-off summary names the form.
create or replace function public.form_propose(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.srm_form_versions; p public.srm_form_versions; v_add int; v_del int; v_id uuid; v_sum text; v_label text;
begin
  perform public._form_require_editor();
  select * into d from public.srm_form_versions where id = p_id for update;
  if d.id is null or d.status <> 'draft' then raise exception 'Only a draft can be sent for sign-off'; end if;
  select * into p from public.srm_form_versions where form_key = d.form_key and status = 'published';
  select count(*) into v_add from jsonb_array_elements(d.questions) q where not exists (select 1 from jsonb_array_elements(p.questions) o where o->>'id' = q->>'id');
  select count(*) into v_del from jsonb_array_elements(p.questions) o where not exists (select 1 from jsonb_array_elements(d.questions) q where o->>'id' = q->>'id');
  if v_add = 0 and v_del = 0 and d.questions = p.questions then raise exception 'Nothing has changed from the published form'; end if;
  v_label := case d.form_key when 'onboarding' then 'Onboarding form' when 'capability' then 'Capability form' when 'machine' then 'Machine form' else 'Tooling form' end;
  v_sum := format('%s version %s: %s added, %s removed, %s questions in total%s', v_label, d.version, v_add, v_del, jsonb_array_length(d.questions),
                  case when d.change_note is null then '' else '. ' || d.change_note end);
  v_id := public.joint_approval_request('form_change', d.id, v_sum, null);
  update public.srm_form_versions set status = 'pending', joint_approval_id = v_id where id = d.id;
  return v_id;
end $$;

-- Check the answers against the live questions and keep each answer with its question text. Required questions must be answered.
create or replace function public._fg_clean_answers(p_form text, p_answers jsonb, out v_clean jsonb, out v_version int) returns record
language plpgsql stable security definer set search_path = public as $$
declare v_q jsonb; q jsonb; v_a text; v_type text; v_opts jsonb; v_part text;
begin
  select version, questions into v_version, v_q from public.srm_form_versions where form_key = p_form and status = 'published';
  v_clean := '{}'::jsonb;
  for q in select * from jsonb_array_elements(coalesce(v_q, '[]'::jsonb)) loop
    v_a := left(trim(coalesce(p_answers->>(q->>'id'), '')), 1000); v_type := q->>'type'; v_opts := q->'options';
    if v_a = '' then
      if coalesce((q->>'required')::boolean, true) then raise exception 'Answer: %', q->>'text'; end if;
      continue;
    end if;
    if v_type = 'yes_no' and v_a not in ('Yes', 'No') then raise exception 'Answer Yes or No: %', q->>'text'; end if;
    if v_type = 'rating' and v_a !~ '^[1-5]$' then raise exception 'Choose 1 to 5: %', q->>'text'; end if;
    if v_type = 'single_choice' and not (v_opts ? v_a) then raise exception 'Choose one of the options: %', q->>'text'; end if;
    if v_type = 'multiple_choice' then
      foreach v_part in array string_to_array(v_a, '; ') loop
        if not (v_opts ? v_part) then raise exception 'Choose from the options: %', q->>'text'; end if;
      end loop;
    end if;
    if v_type = 'date' and v_a !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a date: %', q->>'text'; end if;
    v_clean := v_clean || jsonb_build_object(q->>'id', jsonb_build_object('text', q->>'text', 'value', v_a));
  end loop;
end $$;
revoke execute on function public._fg_clean_answers(text, jsonb) from public, anon, authenticated;

alter function public.srm_capability_save(text, uuid, uuid, jsonb) rename to _fg_pre_srm_capability_save;
revoke execute on function public._fg_pre_srm_capability_save(text, uuid, uuid, jsonb) from public, anon, authenticated;

create function public.srm_capability_save(p_kind text, p_id uuid, p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_clean jsonb; v_ver int; v_t text := case p_kind when 'capability' then 'supplier_capabilities' when 'machine' then 'supplier_machines' when 'tooling' then 'supplier_tooling' end;
begin
  if v_t is null then raise exception 'Unknown kind %', p_kind; end if;
  -- Answers are checked first so a missing required answer saves nothing. Edits that send no answers (for example retiring tooling) leave the stored ones alone.
  if p ? 'custom' then select c.v_clean, c.v_version into v_clean, v_ver from public._fg_clean_answers(p_kind, p->'custom') c; end if;
  v_id := public._fg_pre_srm_capability_save(p_kind, p_id, p_supplier, p - 'custom');
  if p ? 'custom' then
    execute format('update public.%I set custom = $1, custom_form_version = $2 where id = $3', v_t) using v_clean, v_ver, v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.srm_capability_save(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.srm_capability_save(text, uuid, uuid, jsonb) to authenticated;
