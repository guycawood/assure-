-- CRM stage 2 (2 of 3): customer satisfaction surveys, post-job surveys, forms, and the public (token) pages.
--   * Survey waves: contacts flagged "receive survey" per account, sent as an email signed by the contact owner with a
--     unique link (/s/<token>), tracked sent / opened / responded. The template (governed library crm_survey_templates)
--     is fixed on the wave when it is created.
--   * Answers: 19 questions scored 1-5 by section, NPS 0-10, start / continue / stop, services awareness and interest,
--     valuable tools, testimonial opt-in. A comment is required at 3 or lower; comments are internal only.
--   * Post-job survey: when a job closes, a short survey (project number, spend, overall experience) is queued to the
--     client contact. It never blocks the job close.
--   * Forms: a simple builder (fields + consent text) with a public page /f/<token>. Submissions link to an existing
--     contact by email or create one (when the form belongs to a client), with consent recorded.
--   * Public functions (public_*) are the only thing anonymous visitors can call: they take a token, return client-safe
--     fields and validate everything. A survey token works once, only for its own contact; a signed-in client user can only
--     answer surveys of their own account; staff can't answer for clients.

-- ---------------------------------------------------------------------------
-- Shared bits
-- ---------------------------------------------------------------------------
alter table public.email_outbox
  add column if not exists source text,
  add column if not exists source_id uuid;
create index if not exists email_outbox_source_idx on public.email_outbox (source, source_id);

alter table public.crm_feedback drop constraint if exists crm_feedback_source_check;
alter table public.crm_feedback add constraint crm_feedback_source_check check (source in ('internal','client_portal','survey','job_survey'));

create or replace function public._crm_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- {{name}} placeholders from a jsonb object.
create or replace function public._crm_render(p_text text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare k text; v text := coalesce(p_text, '');
begin
  for k in select jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) loop
    v := replace(v, '{{' || k || '}}', coalesce(p_vars->>k, ''));
  end loop;
  return v;
end $$;

create or replace function public._crm_first_name(p_name text) returns text
language sql immutable as $$ select split_part(trim(coalesce(p_name, '')), ' ', 1); $$;

-- Is this send big enough (or external) to need a CRM owner's approval? (CRM_SEND / CRM_SEND_EXTERNAL policies)
create or replace function public._crm_send_needs_approval(p_count int, p_external boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public._approval_policy('CRM_SEND', null, null, p_count))
      or (p_external and exists (select 1 from public._approval_policy('CRM_SEND_EXTERNAL', null, null, p_count)));
$$;

-- ---------------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------------
create table public.crm_survey_waves (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  template_id uuid not null references public.library_records(id),
  period_label text,
  status text not null default 'draft' check (status in ('draft','sent','closed')),
  closes_on date,
  recipient_count int not null default 0,
  excluded_count int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null
);

create table public.crm_survey_recipients (
  id uuid primary key default gen_random_uuid(),
  wave_id uuid not null references public.crm_survey_waves(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  owner uuid references public.profiles(id) on delete set null,     -- who signs the email
  token text not null unique default public._crm_token(),
  status text not null default 'queued' check (status in ('queued','excluded','sent','opened','responded')),
  excluded_reason text,
  sent_at timestamptz,
  opened_at timestamptz,
  responded_at timestamptz,
  unique (wave_id, contact_id)
);

create table public.crm_job_surveys (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  token text not null unique default public._crm_token(),
  project_number text not null,
  spend numeric(14,2),
  currency text,
  status text not null default 'sent' check (status in ('sent','opened','responded')),
  overall int check (overall between 1 and 5),
  comment text check (comment is null or length(comment) <= 4000),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  responded_at timestamptz
);

create table public.crm_survey_responses (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid unique references public.crm_survey_recipients(id) on delete cascade,
  wave_id uuid references public.crm_survey_waves(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  source text not null default 'survey' check (source in ('survey','import')),
  market text references public.markets(code),
  nps int check (nps between 0 and 10),
  scores jsonb not null default '{}'::jsonb,          -- question code -> 1..5
  comments jsonb not null default '{}'::jsonb,        -- question code -> comment (internal only)
  section_scores jsonb not null default '{}'::jsonb,  -- section key -> average
  overall numeric(4,2),
  start_doing text, continue_doing text, stop_doing text,
  services_aware uuid[] not null default '{}',
  services_interested uuid[] not null default '{}',
  valuable_tools text[] not null default '{}',
  testimonial_opt_in boolean not null default false,
  hubspot_id text,
  created_at timestamptz not null default now()
);
create index crm_survey_responses_client_idx on public.crm_survey_responses (client_id, created_at desc);

create or replace function public.crm_survey_wave_create(p_name text, p_period text default null, p_closes_on date default null, p_template uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t uuid := p_template; v_id uuid;
begin
  perform public._crm_require();
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the survey wave a name'; end if;
  if v_t is null then select id into v_t from public.library_effective('crm_survey_templates', 'CSS-STANDARD', current_date); end if;
  if v_t is null or not exists (select 1 from public.library_records where id = v_t and library_key = 'crm_survey_templates' and status = 'active') then
    raise exception 'Choose an active survey template from the Watchtower library';
  end if;
  insert into public.crm_survey_waves (name, template_id, period_label, closes_on, created_by) values (trim(p_name), v_t, nullif(trim(p_period), ''), p_closes_on, auth.uid())
  returning id into v_id;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (v_t, 'crm_survey_waves', v_id::text, 'Survey wave ' || trim(p_name)) on conflict do nothing;
  perform public._crm_event(null, 'survey_wave', v_id::text, 'created', jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

-- Add the client's contacts flagged "receive survey" (p_client), or the contacts given (p_contacts), to a draft wave.
create or replace function public.crm_survey_wave_add(p_wave uuid, p_client uuid default null, p_contacts uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare w public.crm_survey_waves; n int;
begin
  perform public._crm_require();
  select * into w from public.crm_survey_waves where id = p_wave for update;
  if w.id is null then raise exception 'Survey wave not found'; end if;
  if w.status <> 'draft' then raise exception 'This wave has already been sent'; end if;
  if p_client is null and coalesce(cardinality(p_contacts), 0) = 0 then raise exception 'Choose a client or contacts'; end if;
  insert into public.crm_survey_recipients (wave_id, contact_id, client_id, owner)
  select p_wave, ct.id, ct.client_id, coalesce(ct.owner, (select a.account_lead from public.crm_accounts a where a.id = ct.account_id), auth.uid())
    from public.crm_contacts ct
   where ((p_client is not null and ct.client_id = p_client and ct.receive_survey and ct.left_at is null) or ct.id = any (coalesce(p_contacts, '{}')))
  on conflict (wave_id, contact_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Send: excluded contacts get their reason; the rest get an email signed by their owner. Big sends need approval.
create or replace function public.crm_survey_wave_send(p_wave uuid) returns text
language plpgsql security definer set search_path = public as $$
declare w public.crm_survey_waves; r record; v_ok int := 0; v_ex int := 0; t public.library_records; v_vars jsonb; v_block text;
begin
  perform public._crm_require();
  select * into w from public.crm_survey_waves where id = p_wave for update;
  if w.id is null then raise exception 'Survey wave not found'; end if;
  if w.status <> 'draft' then raise exception 'This wave has already been sent'; end if;
  -- Work out who can be sent to (and why not).
  for r in select sr.id, ct from public.crm_survey_recipients sr join public.crm_contacts ct on ct.id = sr.contact_id where sr.wave_id = p_wave loop
    v_block := coalesce(public.crm_contact_send_block(r.ct), case when not (r.ct).receive_survey then 'Not flagged to receive the survey' end);
    update public.crm_survey_recipients set status = case when v_block is null then 'queued' else 'excluded' end, excluded_reason = v_block where id = r.id;
    if v_block is null then v_ok := v_ok + 1; else v_ex := v_ex + 1; end if;
  end loop;
  if v_ok = 0 then raise exception 'Nobody in this wave can be sent the survey (% excluded)', v_ex; end if;
  -- Survey waves go to contacts already flagged to receive the survey, so only the size rule (CRM_SEND) applies.
  if not public._approval_applying('CRM_SEND', p_wave::text) and public._crm_send_needs_approval(v_ok, false) then
    perform public._approval_request_open('crm', 'CRM_SEND', 'survey_wave', p_wave::text, null, 'Send survey: ' || w.name,
      jsonb_build_object('kind', 'survey_wave'), null, v_ok, null, null, null, null, '/crm/surveys/' || p_wave, 'module_owner', 'crm', 'requester', '{}'::uuid[],
      v_ok || ' recipients, ' || v_ex || ' excluded');
    return 'pending';
  end if;
  select * into t from public.library_effective('crm_email_templates', 'SURVEY-INVITE', current_date);
  for r in select sr.id, sr.token, ct.email, ct.full_name, c.name as client_name, coalesce(nullif(p.full_name, ''), p.email, 'The adm Indicia team') as owner_name
             from public.crm_survey_recipients sr join public.crm_contacts ct on ct.id = sr.contact_id join public.sourcing_clients c on c.id = sr.client_id
             left join public.profiles p on p.id = sr.owner
            where sr.wave_id = p_wave and sr.status = 'queued' loop
    v_vars := jsonb_build_object('first_name', public._crm_first_name(r.full_name), 'owner_name', r.owner_name, 'client_name', r.client_name,
      'link', '/s/' || r.token, 'unsubscribe', '/u/' || r.token);
    insert into public.email_outbox (to_email, subject, body, link, created_by, source, source_id)
    values (r.email, public._crm_render(coalesce(t.data->>'subject', 'How are we doing?'), v_vars), public._crm_render(coalesce(t.data->>'body', '{{link}}'), v_vars),
            '/s/' || r.token, auth.uid(), 'crm_survey', r.id);
    update public.crm_survey_recipients set status = 'sent', sent_at = now() where id = r.id;
  end loop;
  update public.crm_survey_waves set status = 'sent', sent_at = now(), sent_by = auth.uid(), recipient_count = v_ok, excluded_count = v_ex where id = p_wave;
  perform public._crm_event(null, 'survey_wave', p_wave::text, 'sent', jsonb_build_object('recipients', v_ok, 'excluded', v_ex));
  return 'sent';
end $$;

create or replace function public.crm_survey_wave_close(p_wave uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._crm_require();
  update public.crm_survey_waves set status = 'closed' where id = p_wave and status = 'sent';
  if not found then raise exception 'Only a sent wave can be closed'; end if;
  perform public._crm_event(null, 'survey_wave', p_wave::text, 'closed', '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Post-job survey: queued when a job closes (never blocks the close)
-- ---------------------------------------------------------------------------
create or replace function public.trg_crm_job_closed_survey() returns trigger
language plpgsql security definer set search_path = public as $$
declare ct public.crm_contacts; v_spend numeric; v_cur text; v_id uuid; v_token text; v_owner text;
begin
  if new.status <> 'closed' or old.status = 'closed' then return null; end if;
  begin
    if exists (select 1 from public.crm_job_surveys where job_id = new.id) then return null; end if;
    select c.* into ct from public.crm_contacts c left join public.crm_accounts a on a.id = c.account_id
     where c.client_id = new.client_id and c.receive_survey and public.crm_contact_send_block(c) is null
     order by (coalesce(a.market, c.market) = public._market_code(new.market)) desc nulls last, (c.decision_role = 'approver') desc, c.created_at
     limit 1;
    if ct.id is null then return null; end if;
    select sum(e.sell_price), min(e.currency) into v_spend, v_cur from public.estimates e where e.job_id = new.id and e.status = 'approved';
    insert into public.crm_job_surveys (job_id, client_id, contact_id, project_number, spend, currency)
    values (new.id, new.client_id, ct.id, new.job_number, v_spend, coalesce(v_cur, new.currency)) returning id, token into v_id, v_token;
    select coalesce(nullif(p.full_name, ''), p.email, 'The adm Indicia team') into v_owner from public.profiles p where p.id = coalesce(ct.owner, new.manager);
    insert into public.email_outbox (to_email, subject, body, link, created_by, source, source_id)
    values (ct.email, 'How did project ' || new.job_number || ' go?',
      'Dear ' || public._crm_first_name(ct.full_name) || E',\n\nProject ' || new.job_number || ' (' || new.title || E') is complete. Two minutes to tell us how it went would help us improve.\n\n/s/' || v_token
        || E'\n\nThank you,\n' || coalesce(v_owner, 'The adm Indicia team') || E'\nadm Indicia\n\nNo longer want these emails? /u/' || v_token,
      '/s/' || v_token, auth.uid(), 'crm_job_survey', v_id);
    insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
    values (new.client_id, 'job_survey', v_id::text, 'sent', jsonb_build_object('job', new.job_number, 'contact', ct.id), auth.uid());
  exception when others then
    raise warning 'Post-job survey not queued for %: %', new.job_number, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists jobs_crm_closed_survey on public.jobs;
create trigger jobs_crm_closed_survey after update of status on public.jobs for each row execute function public.trg_crm_job_closed_survey();

-- ---------------------------------------------------------------------------
-- Public survey page (/s/<token>): read and answer
-- ---------------------------------------------------------------------------
-- Who may use a token: anyone holding it (public page), or a signed-in client user of that same account. Staff can't.
create or replace function public._crm_token_caller_check(p_client uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if public.is_internal() then raise exception 'This survey is for the client to answer; staff see results in CRM' using errcode = '42501'; end if;
  if public.my_client_role(p_client) is null then raise exception 'This survey link belongs to another account' using errcode = '42501'; end if;
end $$;

create or replace function public.public_survey_get(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.crm_survey_recipients; w public.crm_survey_waves; j public.crm_job_surveys; t public.library_records; v_client text; v_name text; v_owner text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into r from public.crm_survey_recipients where token = p_token;
  if r.id is not null then
    perform public._crm_token_caller_check(r.client_id);
    select * into w from public.crm_survey_waves where id = r.wave_id;
    select * into t from public.library_records where id = w.template_id;
    select c.name into v_client from public.sourcing_clients c where c.id = r.client_id;
    select full_name into v_name from public.crm_contacts where id = r.contact_id;
    select coalesce(nullif(full_name, ''), 'your account team') into v_owner from public.profiles where id = r.owner;
    if r.status = 'sent' then update public.crm_survey_recipients set status = 'opened', opened_at = now() where id = r.id; end if;
    return jsonb_build_object('kind', 'survey', 'title', w.name, 'client_name', v_client, 'first_name', public._crm_first_name(v_name), 'owner_name', v_owner,
      'state', case when r.status = 'responded' then 'answered' when w.status = 'closed' or (w.closes_on is not null and w.closes_on < current_date) then 'closed'
                    when r.status = 'excluded' or r.status = 'queued' then 'closed' else 'open' end,
      'sections', t.data->'sections', 'scale', t.data->>'scale', 'comment_at_or_below', coalesce((t.data->>'comment_at_or_below')::int, 3), 'tools', t.data->'tools',
      'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by (s.data->>'order')::int nulls last, s.name), '[]'::jsonb)
                     from public.library_records s where s.library_key = 'crm_services' and s.status = 'active'));
  end if;
  select * into j from public.crm_job_surveys where token = p_token;
  if j.id is not null then
    perform public._crm_token_caller_check(j.client_id);
    select c.name into v_client from public.sourcing_clients c where c.id = j.client_id;
    select full_name into v_name from public.crm_contacts where id = j.contact_id;
    if j.status = 'sent' then update public.crm_job_surveys set status = 'opened', opened_at = now() where id = j.id; end if;
    return jsonb_build_object('kind', 'job', 'title', 'Project ' || j.project_number, 'client_name', v_client, 'first_name', public._crm_first_name(v_name),
      'project_number', j.project_number, 'spend', j.spend, 'currency', j.currency, 'state', case when j.status = 'responded' then 'answered' else 'open' end);
  end if;
  return null;
end $$;

-- Answers. Survey: {"scores":{"Q01":4,...}, "comments":{"Q07":"..."}, "nps":8, "start":"", "continue":"", "stop":"",
-- "services_aware":[ids], "services_interested":[ids], "tools":["..."], "testimonial":true}. Job: {"overall":4, "comment":"..."}.
create or replace function public.public_survey_submit(p_token text, p_answers jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r public.crm_survey_recipients; w public.crm_survey_waves; j public.crm_job_surveys; t public.library_records; a jsonb := coalesce(p_answers, '{}'::jsonb);
  q jsonb; s jsonb; v_code text; v_score int; v_comment text; v_scores jsonb := '{}'; v_comments jsonb := '{}'; v_sections jsonb := '{}';
  v_sum numeric; v_n int; v_all numeric := 0; v_alln int := 0; v_limit int; v_nps int; v_id uuid; v_market text; v_contact public.crm_contacts;
  v_aware uuid[]; v_interest uuid[];
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'This survey link is not valid'; end if;
  if jsonb_typeof(a) <> 'object' or length(a::text) > 60000 then raise exception 'Those answers could not be read'; end if;
  select * into r from public.crm_survey_recipients where token = p_token for update;
  if r.id is null then
    select * into j from public.crm_job_surveys where token = p_token for update;
    if j.id is null then raise exception 'This survey link is not valid'; end if;
    perform public._crm_token_caller_check(j.client_id);
    if j.status = 'responded' then raise exception 'This survey has already been answered. Thank you.'; end if;
    v_score := nullif(a->>'overall', '')::int;
    if v_score is null or v_score < 1 or v_score > 5 then raise exception 'Rate your overall experience from 1 to 5'; end if;
    v_comment := nullif(trim(a->>'comment'), '');
    if v_score <= 3 and v_comment is null then raise exception 'Tell us what we could have done better'; end if;
    update public.crm_job_surveys set overall = v_score, comment = left(v_comment, 4000), status = 'responded', responded_at = now() where id = j.id;
    insert into public.crm_events (client_id, entity_type, entity_id, action, detail) values (j.client_id, 'job_survey', j.id::text, 'responded', jsonb_build_object('overall', v_score));
    return 'thanks';
  end if;
  perform public._crm_token_caller_check(r.client_id);
  if r.status = 'responded' then raise exception 'This survey has already been answered. Thank you.'; end if;
  select * into w from public.crm_survey_waves where id = r.wave_id;
  if r.status not in ('sent','opened') or w.status = 'closed' or (w.closes_on is not null and w.closes_on < current_date) then raise exception 'This survey is closed'; end if;
  select * into t from public.library_records where id = w.template_id;
  v_limit := coalesce((t.data->>'comment_at_or_below')::int, 3);
  for s in select * from jsonb_array_elements(t.data->'sections') loop
    v_sum := 0; v_n := 0;
    for q in select * from jsonb_array_elements(s->'questions') loop
      v_code := q->>'code';
      v_score := nullif(a->'scores'->>v_code, '')::int;
      if v_score is null or v_score < 1 or v_score > 5 then raise exception 'Score every statement from 1 to 5 (% is missing)', v_code; end if;
      v_comment := nullif(trim(a->'comments'->>v_code), '');
      if v_score <= v_limit and v_comment is null then raise exception 'Add a comment for % (scored % or lower)', v_code, v_limit; end if;
      v_scores := v_scores || jsonb_build_object(v_code, v_score);
      if v_comment is not null then v_comments := v_comments || jsonb_build_object(v_code, left(v_comment, 2000)); end if;
      v_sum := v_sum + v_score; v_n := v_n + 1;
    end loop;
    if v_n > 0 then v_sections := v_sections || jsonb_build_object(s->>'key', round(v_sum / v_n, 2)); v_all := v_all + v_sum; v_alln := v_alln + v_n; end if;
  end loop;
  v_nps := nullif(a->>'nps', '')::int;
  if v_nps is null or v_nps < 0 or v_nps > 10 then raise exception 'Choose how likely you are to recommend us, from 0 to 10'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_aware from jsonb_array_elements_text(coalesce(a->'services_aware', '[]')) x
   where x ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.library_records where id = x::uuid and library_key = 'crm_services');
  select coalesce(array_agg(x::uuid), '{}') into v_interest from jsonb_array_elements_text(coalesce(a->'services_interested', '[]')) x
   where x ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.library_records where id = x::uuid and library_key = 'crm_services');
  select * into v_contact from public.crm_contacts where id = r.contact_id;
  v_market := coalesce((select market from public.crm_accounts where id = v_contact.account_id), v_contact.market);
  insert into public.crm_survey_responses (recipient_id, wave_id, client_id, contact_id, market, nps, scores, comments, section_scores, overall,
    start_doing, continue_doing, stop_doing, services_aware, services_interested, valuable_tools, testimonial_opt_in)
  values (r.id, r.wave_id, r.client_id, r.contact_id, v_market, v_nps, v_scores, v_comments, v_sections, round(v_all / nullif(v_alln, 0), 2),
    left(nullif(trim(a->>'start'), ''), 2000), left(nullif(trim(a->>'continue'), ''), 2000), left(nullif(trim(a->>'stop'), ''), 2000), v_aware, v_interest,
    coalesce((select array_agg(left(x, 100)) from (select jsonb_array_elements_text(coalesce(a->'tools', '[]')) x limit 10) tt), '{}'),
    coalesce((a->>'testimonial')::boolean, false))
  returning id into v_id;
  update public.crm_survey_recipients set status = 'responded', responded_at = now() where id = r.id;
  -- NPS also counts towards client health (crm_feedback, source 'survey').
  insert into public.crm_feedback (client_id, account_id, contact_id, market, score, comment, source, submitted_by)
  values (r.client_id, v_contact.account_id, r.contact_id, v_market, v_nps, null, 'survey', auth.uid());
  insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
  values (r.client_id, 'survey_response', v_id::text, 'responded', jsonb_build_object('nps', v_nps, 'overall', round(v_all / nullif(v_alln, 0), 2)), auth.uid());
  perform public.notify(r.owner, 'crm', 'Survey answered: ' || v_contact.full_name || ' (NPS ' || v_nps || ')',
    case when v_comments <> '{}'::jsonb then 'Some scores came with comments to read.' end, '/crm/surveys/' || r.wave_id);
  return 'thanks';
end $$;

-- Client Portal: open surveys for the signed-in client user (matched by email to the contact in their own accounts).
create or replace function public.client_portal_surveys(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); v_email text;
begin
  if public.is_internal() then return '[]'::jsonb; end if;
  select lower(email) into v_email from public.profiles where id = auth.uid();
  return (select coalesce(jsonb_agg(jsonb_build_object('token', x.token, 'title', x.title, 'client_name', x.client_name, 'kind', x.kind) order by x.title), '[]'::jsonb) from (
    select sr.token, w.name as title, c.name as client_name, 'survey' as kind from public.crm_survey_recipients sr
      join public.crm_survey_waves w on w.id = sr.wave_id join public.crm_contacts ct on ct.id = sr.contact_id join public.sourcing_clients c on c.id = sr.client_id
     where sr.client_id = any (v) and lower(ct.email) = v_email and sr.status in ('sent','opened') and w.status = 'sent'
    union all
    select js.token, 'Project ' || js.project_number, c.name, 'job' from public.crm_job_surveys js
      join public.crm_contacts ct on ct.id = js.contact_id join public.sourcing_clients c on c.id = js.client_id
     where js.client_id = any (v) and lower(ct.email) = v_email and js.status in ('sent','opened')) x);
end $$;

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create table public.crm_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  token text not null unique default public._crm_token(),
  fields jsonb not null default '[]'::jsonb,
  consent_text text,
  client_id uuid references public.sourcing_clients(id) on delete set null,   -- new people become contacts of this client
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.crm_forms(id) on delete cascade,
  data jsonb not null,
  email text not null,
  full_name text,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  contact_created boolean not null default false,
  consent boolean not null default false,
  consent_text text,
  created_at timestamptz not null default now()
);
create index crm_form_submissions_form_idx on public.crm_form_submissions (form_id, created_at desc);

create or replace function public.crm_form_save(p_id uuid, p_name text, p_description text, p_fields jsonb, p_consent_text text, p_client uuid, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare f jsonb; v_id uuid; v_keys text[] := '{}';
begin
  perform public._crm_require();
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the form a name'; end if;
  if jsonb_typeof(coalesce(p_fields, 'null')) <> 'array' or jsonb_array_length(p_fields) = 0 or jsonb_array_length(p_fields) > 30 then raise exception 'Add between 1 and 30 fields'; end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if coalesce(f->>'key', '') !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'Field keys are lower case letters, numbers and _ (got "%")', f->>'key'; end if;
    if f->>'key' = any (v_keys) then raise exception 'Field % appears twice', f->>'key'; end if;
    v_keys := v_keys || (f->>'key');
    if coalesce(trim(f->>'label'), '') = '' then raise exception 'Every field needs a label'; end if;
    if coalesce(f->>'type', '') not in ('text','email','phone','textarea','select','checkbox') then raise exception 'Field type % is not supported', f->>'type'; end if;
    if f->>'type' = 'select' and (jsonb_typeof(f->'options') <> 'array' or jsonb_array_length(f->'options') = 0) then raise exception 'Give the options for %', f->>'label'; end if;
  end loop;
  if not 'email' = any (v_keys) then raise exception 'A form needs an "email" field so submissions can be matched to contacts'; end if;
  if p_client is not null and not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if p_id is null then
    insert into public.crm_forms (name, description, fields, consent_text, client_id, active, created_by)
    values (trim(p_name), nullif(trim(p_description), ''), p_fields, nullif(trim(p_consent_text), ''), p_client, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.crm_forms set name = trim(p_name), description = nullif(trim(p_description), ''), fields = p_fields, consent_text = nullif(trim(p_consent_text), ''),
      client_id = p_client, active = coalesce(p_active, true), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Form not found'; end if;
  end if;
  perform public._crm_event(p_client, 'form', v_id::text, case when p_id is null then 'created' else 'updated' end, jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.public_form_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', f.name, 'description', f.description, 'fields', f.fields, 'consent_text', f.consent_text, 'active', f.active)
    from public.crm_forms f where p_token ~ '^[0-9a-f]{64}$' and f.token = p_token;
$$;

create or replace function public.public_form_submit(p_token text, p_data jsonb, p_honeypot text default null) returns text
language plpgsql volatile security definer set search_path = public as $$
declare f public.crm_forms; fld jsonb; d jsonb := coalesce(p_data, '{}'::jsonb); clean jsonb := '{}'; v text; v_email text; v_name text;
  v_contact uuid; v_created boolean := false; v_consent boolean; v_id uuid;
begin
  if nullif(trim(coalesce(p_honeypot, '')), '') is not null then return 'thanks'; end if;   -- bots: say thanks, store nothing
  select * into f from public.crm_forms where p_token ~ '^[0-9a-f]{64}$' and token = p_token;
  if f.id is null or not f.active then raise exception 'This form is not open'; end if;
  if jsonb_typeof(d) <> 'object' or length(d::text) > 20000 then raise exception 'That submission could not be read'; end if;
  for fld in select * from jsonb_array_elements(f.fields) loop
    v := nullif(trim(d->>(fld->>'key')), '');
    if fld->>'type' = 'checkbox' then v := case when lower(coalesce(v, '')) in ('true','on','yes','1') then 'true' else null end; end if;
    if coalesce((fld->>'required')::boolean, false) and v is null then raise exception '% is required', fld->>'label'; end if;
    if v is not null then
      if fld->>'type' = 'email' and v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
      if fld->>'type' = 'select' and not (fld->'options' ? v) then raise exception 'Choose an option for %', fld->>'label'; end if;
      clean := clean || jsonb_build_object(fld->>'key', left(v, 2000));
    end if;
  end loop;
  v_email := lower(clean->>'email');
  if v_email is null then raise exception 'Email is required'; end if;
  if exists (select 1 from public.crm_form_submissions where form_id = f.id and email = v_email and created_at > now() - interval '2 minutes') then
    raise exception 'We already have this from you. Thank you.';
  end if;
  if (select count(*) from public.crm_form_submissions where form_id = f.id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'Too many submissions right now. Try again in a minute.';
  end if;
  v_consent := f.consent_text is not null and lower(coalesce(d->>'consent', '')) in ('true','on','yes','1');
  v_name := coalesce(clean->>'full_name', nullif(trim(coalesce(clean->>'first_name', '') || ' ' || coalesce(clean->>'last_name', '')), ''), split_part(v_email, '@', 1));
  -- Match an existing contact by email (within the form's client when it has one), else create one for the client.
  select id into v_contact from public.crm_contacts
   where lower(email) = v_email and (f.client_id is null or client_id = f.client_id) order by (left_at is null) desc, created_at limit 1;
  if v_contact is not null then
    if v_consent then update public.crm_contacts set consent = true, consent_at = coalesce(consent_at, now()) where id = v_contact; end if;
  elsif f.client_id is not null then
    insert into public.crm_contacts (client_id, full_name, job_title, email, phone, decision_role, consent, consent_at, legal_basis)
    values (f.client_id, left(v_name, 200), left(clean->>'job_title', 200), v_email, left(clean->>'phone', 50), 'user', v_consent,
            case when v_consent then now() end, case when v_consent then 'consent' else 'legitimate_interest_prospect' end)
    returning id into v_contact;
    v_created := true;
  end if;
  insert into public.crm_form_submissions (form_id, data, email, full_name, contact_id, contact_created, consent, consent_text)
  values (f.id, clean, v_email, left(v_name, 200), v_contact, v_created, v_consent, case when v_consent then f.consent_text end)
  returning id into v_id;
  insert into public.crm_events (client_id, entity_type, entity_id, action, detail)
  values (f.client_id, 'form', f.id::text, 'submitted', jsonb_build_object('submission', v_id, 'contact', v_contact, 'contact_created', v_created, 'consent', v_consent));
  return 'thanks';
end $$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
create view public.crm_stakeholders_v with (security_invoker = true) as
  select ct.id, ct.client_id, c.name as client_name, c.code as client_code, ct.account_id, a.market as account_market,
         ct.full_name, ct.job_title, ct.email, ct.phone, ct.market, m.name as market_name, ct.decision_role, ct.consent, ct.active,
         ct.owner, coalesce(nullif(op.full_name, ''), op.email) as owner_name, ct.owner_role_id, orl.code as owner_role, orl.name as owner_role_name,
         ct.department, ct.relationship_rag, ct.last_contacted_on, ct.contact_frequency, ct.influence_level, ct.decision_level,
         ct.services_offered, ct.services_declined,
         (select coalesce(array_agg(s.name order by s.name), '{}') from public.library_records s where s.id = any (ct.services_offered)) as services_offered_names,
         (select coalesce(array_agg(s.name order by s.name), '{}') from public.library_records s where s.id = any (ct.services_declined)) as services_declined_names,
         ct.induction_required, ct.receive_survey, ct.legal_basis, ct.email_opt_out, ct.left_at, ct.last_reviewed_at, ct.hubspot_id,
         q.quadrant, qr.name as quadrant_name, coalesce((mx.data->>'confirmed')::boolean, false) as quadrant_confirmed,
         (ct.left_at is null and (ct.last_reviewed_at is null or ct.last_reviewed_at < now() - make_interval(days => public.crm_setting('STAKEHOLDER_REVIEW_DAYS', 90)::int))) as needs_review,
         array_remove(array[
           case when ct.owner is null then 'owner' end, case when ct.owner_role_id is null then 'owner role' end,
           case when ct.department is null then 'department' end, case when ct.relationship_rag is null then 'relationship RAG' end,
           case when ct.influence_level is null then 'influence' end, case when ct.decision_level is null then 'decision maker' end,
           case when ct.email is null then 'email' end], null) as missing_fields,
         public.crm_contact_send_block(ct) as send_block,
         (select r.wave_id from public.crm_survey_responses r where r.contact_id = ct.id and r.source = 'survey' order by r.created_at desc limit 1) as latest_survey_wave_id,
         (select r.id from public.crm_survey_responses r where r.contact_id = ct.id order by r.created_at desc limit 1) as latest_response_id,
         (select r.nps from public.crm_survey_responses r where r.contact_id = ct.id order by r.created_at desc limit 1) as latest_nps
    from public.crm_contacts ct
    join public.sourcing_clients c on c.id = ct.client_id
    left join public.crm_accounts a on a.id = ct.account_id
    left join public.markets m on m.code = ct.market
    left join public.profiles op on op.id = ct.owner
    left join public.library_records orl on orl.id = ct.owner_role_id
    cross join lateral (select public.crm_stakeholder_quadrant(ct.influence_level, ct.decision_level) as quadrant) q
    left join lateral (select * from public.library_effective('crm_stakeholder_quadrants', q.quadrant, current_date)) qr on qr.id is not null
    left join lateral (select * from public.library_effective('crm_stakeholder_matrix',
                         upper(left(ct.influence_level, 1)) || '-' || upper(left(ct.decision_level, 1)), current_date)) mx on mx.id is not null;

create view public.crm_survey_recipients_v with (security_invoker = true) as
  select sr.*, ct.full_name as contact_name, ct.email as contact_email, c.name as client_name, coalesce(nullif(p.full_name, ''), p.email) as owner_name,
         (select r.id from public.crm_survey_responses r where r.recipient_id = sr.id) as response_id
    from public.crm_survey_recipients sr join public.crm_contacts ct on ct.id = sr.contact_id
    join public.sourcing_clients c on c.id = sr.client_id left join public.profiles p on p.id = sr.owner;

create view public.crm_survey_waves_v with (security_invoker = true) as
  select w.*, t.name as template_name, coalesce(nullif(p.full_name, ''), p.email) as created_by_name,
         (select count(*) from public.crm_survey_recipients r where r.wave_id = w.id)::int as recipients,
         (select count(*) from public.crm_survey_recipients r where r.wave_id = w.id and r.status in ('sent','opened','responded'))::int as sent,
         (select count(*) from public.crm_survey_recipients r where r.wave_id = w.id and r.status in ('opened','responded'))::int as opened,
         (select count(*) from public.crm_survey_recipients r where r.wave_id = w.id and r.status = 'responded')::int as responded,
         exists (select 1 from public.approval_requests ar where ar.approval_type = 'CRM_SEND' and ar.entity_id = w.id::text and ar.status = 'pending') as approval_pending
    from public.crm_survey_waves w join public.library_records t on t.id = w.template_id left join public.profiles p on p.id = w.created_by;

-- Results: survey responses plus the 0-10 feedback captured in CRM or given in the Client Portal (as NPS-only responses).
create view public.crm_survey_results_v with (security_invoker = true) as
  select 'survey'::text as kind, r.id, r.client_id, c.name as client_name, r.contact_id, ct.full_name as contact_name, r.market, m.name as market_name,
         r.wave_id, w.name as wave_name, r.nps, r.overall, r.section_scores, r.scores, r.comments, r.start_doing, r.continue_doing, r.stop_doing,
         r.services_aware, r.services_interested, r.valuable_tools, r.testimonial_opt_in, r.created_at,
         case when r.nps >= 9 then 'promoter' when r.nps >= 7 then 'passive' else 'detractor' end as nps_category,
         case when r.nps >= 9 then 'positive' when r.nps >= 7 then 'neutral' else 'negative' end as feeling
    from public.crm_survey_responses r join public.sourcing_clients c on c.id = r.client_id
    left join public.crm_contacts ct on ct.id = r.contact_id left join public.markets m on m.code = r.market left join public.crm_survey_waves w on w.id = r.wave_id
  union all
  select 'feedback', f.id, f.client_id, c.name, f.contact_id, ct.full_name, f.market, m.name, null, null, f.score, null, '{}'::jsonb, '{}'::jsonb,
         case when f.comment is not null then jsonb_build_object('comment', f.comment) else '{}'::jsonb end, null, null, null, '{}', '{}', '{}', false, f.created_at,
         case when f.score >= 9 then 'promoter' when f.score >= 7 then 'passive' else 'detractor' end,
         case when f.score >= 9 then 'positive' when f.score >= 7 then 'neutral' else 'negative' end
    from public.crm_feedback f join public.sourcing_clients c on c.id = f.client_id
    left join public.crm_contacts ct on ct.id = f.contact_id left join public.markets m on m.code = f.market
   where f.source in ('internal','client_portal');

create view public.crm_job_surveys_v with (security_invoker = true) as
  select js.*, c.name as client_name, ct.full_name as contact_name, j.title as job_title
    from public.crm_job_surveys js join public.sourcing_clients c on c.id = js.client_id join public.crm_contacts ct on ct.id = js.contact_id
    join public.jobs j on j.id = js.job_id;

create view public.crm_forms_v with (security_invoker = true) as
  select f.*, c.name as client_name, (select count(*) from public.crm_form_submissions s where s.form_id = f.id)::int as submissions,
         (select max(s.created_at) from public.crm_form_submissions s where s.form_id = f.id) as last_submission_at
    from public.crm_forms f left join public.sourcing_clients c on c.id = f.client_id;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.crm_survey_waves enable row level security;
alter table public.crm_survey_recipients enable row level security;
alter table public.crm_survey_responses enable row level security;
alter table public.crm_job_surveys enable row level security;
alter table public.crm_forms enable row level security;
alter table public.crm_form_submissions enable row level security;
create policy crm_survey_waves_read on public.crm_survey_waves for select to authenticated using (public.is_internal());
create policy crm_survey_recipients_read on public.crm_survey_recipients for select to authenticated using (public.is_internal());
create policy crm_survey_responses_read on public.crm_survey_responses for select to authenticated using (public.is_internal());
create policy crm_job_surveys_read on public.crm_job_surveys for select to authenticated using (public.is_internal());
create policy crm_forms_read on public.crm_forms for select to authenticated using (public.is_internal());
create policy crm_form_submissions_read on public.crm_form_submissions for select to authenticated using (public.is_internal());
revoke all on public.crm_survey_waves, public.crm_survey_recipients, public.crm_survey_responses, public.crm_job_surveys, public.crm_forms,
  public.crm_form_submissions, public.crm_stakeholders_v, public.crm_survey_recipients_v, public.crm_survey_waves_v, public.crm_survey_results_v,
  public.crm_job_surveys_v, public.crm_forms_v from anon;
revoke insert, update, delete on public.crm_survey_waves, public.crm_survey_recipients, public.crm_survey_responses, public.crm_job_surveys, public.crm_forms,
  public.crm_form_submissions, public.crm_stakeholders_v, public.crm_survey_recipients_v, public.crm_survey_waves_v, public.crm_survey_results_v,
  public.crm_job_surveys_v, public.crm_forms_v from authenticated;

revoke execute on function public._crm_token(), public._crm_render(text, jsonb), public._crm_first_name(text), public._crm_send_needs_approval(int, boolean),
  public.trg_crm_job_closed_survey(), public._crm_token_caller_check(uuid) from public, anon, authenticated;
revoke execute on function public.crm_survey_wave_create(text, text, date, uuid), public.crm_survey_wave_add(uuid, uuid, uuid[]), public.crm_survey_wave_send(uuid),
  public.crm_survey_wave_close(uuid), public.crm_form_save(uuid, text, text, jsonb, text, uuid, boolean), public.client_portal_surveys(uuid),
  public.public_survey_get(text), public.public_survey_submit(text, jsonb), public.public_form_get(text), public.public_form_submit(text, jsonb, text)
  from public, anon;
grant execute on function public.crm_survey_wave_create(text, text, date, uuid), public.crm_survey_wave_add(uuid, uuid, uuid[]), public.crm_survey_wave_send(uuid),
  public.crm_survey_wave_close(uuid), public.crm_form_save(uuid, text, text, jsonb, text, uuid, boolean), public.client_portal_surveys(uuid) to authenticated;
-- The public pages: anyone with a token (no sign-in).
grant execute on function public.public_survey_get(text), public.public_survey_submit(text, jsonb), public.public_form_get(text),
  public.public_form_submit(text, jsonb, text) to anon, authenticated;
