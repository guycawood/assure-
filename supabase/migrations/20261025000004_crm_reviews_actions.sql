-- CRM stage 2 (4): client business reviews, review cadence, client actions, and the Client Portal pieces. Mirrors SRM's
-- business reviews, action plans and audit calendar (same patterns, CRM's own tables).
--   * Reviews (QBR / half-year / annual / ad hoc) per client or account: scheduled date, attendees (staff and client contacts),
--     agenda, a pack generated from CRM data (spend, pipeline, health, survey results and NPS, delivery OTIF and install audit
--     quality, open actions), outcomes and notes. Status planned -> held -> closed; closing needs outcomes.
--   * Cadence: the account tiers library's review_cadence_days (strategic 90 ...), the shortest tier of the client's active
--     accounts. A client is overdue when its last held review (or its first account, if never reviewed) plus the cadence is past.
--   * Actions: from reviews, survey follow-ups (created automatically for detractors and for scores of 3 or lower with
--     comments) and ad hoc; account plan actions join them in crm_actions_v. Client-visible actions show in the Client Portal.
--   * Health: "reviews overdue" and "actions overdue" in watchtower_health_crm and in client health reasons.

create table public.crm_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  review_type text not null check (review_type in ('qbr','half_year','annual','ad_hoc')),
  title text not null check (length(trim(title)) > 0),
  scheduled_on date not null,
  status text not null default 'planned' check (status in ('planned','held','closed','cancelled')),
  agenda text[] not null default '{}' check (cardinality(agenda) >= 1),
  internal_attendees uuid[] not null default '{}',
  contact_attendees uuid[] not null default '{}',
  client_visible boolean not null default true,
  pack jsonb,
  pack_generated_at timestamptz,
  outcomes text,
  notes text,
  cancelled_reason text,
  held_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_reviews_client_idx on public.crm_reviews (client_id, scheduled_on desc);

-- Client attendance replies (from the Client Portal).
create table public.crm_review_responses (
  review_id uuid not null references public.crm_reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('attending','declined')),
  note text check (note is null or length(note) <= 1000),
  responded_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table public.crm_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  source text not null check (source in ('review','survey','ad_hoc')),
  review_id uuid references public.crm_reviews(id) on delete set null,
  survey_response_id uuid references public.crm_survey_responses(id) on delete set null,
  feedback_id uuid references public.crm_feedback(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  detail text,
  owner uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  client_visible boolean not null default false,
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_actions_client_idx on public.crm_actions (client_id, status);
create index crm_actions_owner_idx on public.crm_actions (owner, status);

-- ---------------------------------------------------------------------------
-- Cadence per client
-- ---------------------------------------------------------------------------
create view public.crm_review_cadence_v with (security_invoker = true) as
  with c as (
    select sc.id as client_id, sc.name as client_name, sc.active,
      (select min(nullif(t.data->>'review_cadence_days', '')::int) from public.crm_accounts a join public.library_records t on t.id = a.tier_id
        where a.client_id = sc.id and a.status in ('active','prospect')) as cadence_days,
      (select string_agg(distinct t.name, ', ') from public.crm_accounts a join public.library_records t on t.id = a.tier_id
        where a.client_id = sc.id and a.status in ('active','prospect')) as tiers,
      (select max(coalesce(r.held_at::date, r.scheduled_on)) from public.crm_reviews r where r.client_id = sc.id and r.status in ('held','closed')) as last_review_on,
      (select min(r.scheduled_on) from public.crm_reviews r where r.client_id = sc.id and r.status = 'planned') as next_planned_on,
      (select min(a.created_at)::date from public.crm_accounts a where a.client_id = sc.id and a.status in ('active','prospect')) as first_account_on,
      (select string_agg(distinct coalesce(nullif(p.full_name, ''), p.email), ', ') from public.crm_accounts a join public.profiles p on p.id = a.account_lead
        where a.client_id = sc.id) as account_leads
    from public.sourcing_clients sc
  )
  select c.*, case when c.cadence_days is null then null else coalesce(c.last_review_on, c.first_account_on) + c.cadence_days end as review_due_on,
         (c.active and c.cadence_days is not null and coalesce(c.last_review_on, c.first_account_on) + c.cadence_days < current_date) as review_overdue
    from c;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create or replace function public.crm_review_save(p_id uuid, p_client uuid, p_account uuid, p_type text, p_title text, p_scheduled_on date, p_agenda text[],
  p_internal uuid[] default '{}', p_contacts uuid[] default '{}', p_client_visible boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.crm_reviews; v_id uuid; v_client uuid := p_client; v_agenda text[];
begin
  perform public._crm_require();
  if p_id is not null then
    select * into r from public.crm_reviews where id = p_id for update;
    if r.id is null then raise exception 'Review not found'; end if;
    if r.status in ('closed','cancelled') then raise exception 'This review is %', r.status; end if;
    v_client := r.client_id;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if coalesce(p_type, '') not in ('qbr','half_year','annual','ad_hoc') then raise exception 'Choose QBR, half-year, annual or ad hoc'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the review a title'; end if;
  if p_scheduled_on is null then raise exception 'Choose the review date'; end if;
  v_agenda := array(select trim(x) from unnest(coalesce(p_agenda, '{}')) x where trim(x) <> '');
  if cardinality(v_agenda) = 0 then raise exception 'Add at least one agenda item'; end if;
  if p_account is not null and not exists (select 1 from public.crm_accounts where id = p_account and client_id = v_client) then raise exception 'The account must belong to the same client'; end if;
  if exists (select 1 from unnest(coalesce(p_internal, '{}')) x where not public._crm_internal_person(x)) then raise exception 'Internal attendees must be people at adm Indicia'; end if;
  if exists (select 1 from unnest(coalesce(p_contacts, '{}')) x where not exists (select 1 from public.crm_contacts c where c.id = x and c.client_id = v_client)) then
    raise exception 'Client attendees must be contacts of the same client';
  end if;
  if p_id is null then
    insert into public.crm_reviews (client_id, account_id, review_type, title, scheduled_on, agenda, internal_attendees, contact_attendees, client_visible, created_by)
    values (v_client, p_account, p_type, trim(p_title), p_scheduled_on, v_agenda, coalesce(p_internal, '{}'), coalesce(p_contacts, '{}'), coalesce(p_client_visible, true), auth.uid())
    returning id into v_id;
  else
    update public.crm_reviews set account_id = p_account, review_type = p_type, title = trim(p_title), scheduled_on = p_scheduled_on, agenda = v_agenda,
      internal_attendees = coalesce(p_internal, '{}'), contact_attendees = coalesce(p_contacts, '{}'), client_visible = coalesce(p_client_visible, true), updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  perform public._crm_event(v_client, 'review', v_id::text, case when p_id is null then 'planned' else 'updated' end,
    jsonb_build_object('title', trim(p_title), 'scheduled_on', p_scheduled_on, 'type', p_type));
  return v_id;
end $$;

-- The review pack: a snapshot of CRM data for the client at the time it is generated.
create or replace function public.crm_review_generate_pack(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.crm_reviews; h record; v_pack jsonb; v_since date := current_date - 365;
begin
  perform public._crm_require();
  select * into r from public.crm_reviews where id = p_id for update;
  if r.id is null then raise exception 'Review not found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'This review is %', r.status; end if;
  select * into h from public.crm_client_health where client_id = r.client_id;
  v_pack := jsonb_build_object(
    'generated_at', now(),
    'health', jsonb_build_object('rag', h.rag, 'reasons', to_jsonb(h.reasons), 'currency', h.currency, 'spend_ytd', h.spend_ytd, 'billed_ytd', h.billed_ytd,
                                 'overdue_bills', h.overdue_bills, 'satisfaction', h.satisfaction, 'nps', h.nps, 'next_renewal', h.next_renewal),
    'pipeline', (select jsonb_build_object('open', count(*), 'by_currency', coalesce(jsonb_object_agg(cur, jsonb_build_object('value', val, 'weighted', wt)) filter (where cur is not null), '{}'))
                   from (select o.currency cur, sum(o.value) val, round(sum(o.value * o.probability / 100.0), 2) wt from public.crm_opportunities o
                          where o.client_id = r.client_id and o.stage not in ('won','lost') group by o.currency) x),
    'won_last_12_months', (select count(*) from public.crm_opportunities o where o.client_id = r.client_id and o.stage = 'won' and o.won_at >= v_since),
    'survey', (select jsonb_build_object('responses', count(*), 'nps', round(100.0 * (count(*) filter (where nps >= 9) - count(*) filter (where nps <= 6)) / nullif(count(*), 0)),
                 'overall', round(avg(overall), 2)) from public.crm_survey_responses s where s.client_id = r.client_id and s.created_at >= v_since),
    'section_scores', (select coalesce(jsonb_object_agg(k, a), '{}') from (select e.key k, round(avg(e.value::numeric), 2) a
                        from public.crm_survey_responses s cross join lateral jsonb_each_text(s.section_scores) e
                       where s.client_id = r.client_id and s.created_at >= v_since group by e.key) z),
    'delivery', (select jsonb_build_object('delivered', count(*), 'on_time', count(*) filter (where d.actual_delivery_date <= d.planned_delivery_date),
                   'otif_percent', round(100.0 * count(*) filter (where d.actual_delivery_date <= d.planned_delivery_date) / nullif(count(*) filter (where d.planned_delivery_date is not null), 0)))
                   from public.deliveries d join public.jobs j on j.id = d.job_id
                  where j.client_id = r.client_id and d.status = 'delivered' and coalesce(d.actual_delivery_date, current_date) >= v_since),
    'quality', (select jsonb_build_object('audited', count(*) filter (where dep.audit_status in ('passed','failed')), 'passed', count(*) filter (where dep.audit_status = 'passed'),
                  'pass_percent', round(100.0 * count(*) filter (where dep.audit_status = 'passed') / nullif(count(*) filter (where dep.audit_status in ('passed','failed')), 0)))
                  from public.deployments dep join public.jobs j on j.id = dep.job_id where j.client_id = r.client_id),
    'jobs', (select jsonb_build_object('closed', count(*) filter (where j.status = 'closed'), 'in_progress', count(*) filter (where j.status in ('ordered','in_production')))
               from public.jobs j where j.client_id = r.client_id and j.created_at >= v_since),
    'open_actions', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'due_date', a.due_date, 'status', a.status, 'source', a.source) order by a.due_date nulls last), '[]')
                       from public.crm_actions a where a.client_id = r.client_id and a.status in ('open','in_progress')));
  update public.crm_reviews set pack = v_pack, pack_generated_at = now(), updated_at = now() where id = p_id;
  perform public._crm_event(r.client_id, 'review', p_id::text, 'pack_generated', '{}'::jsonb);
  return v_pack;
end $$;

create or replace function public.crm_review_set_status(p_id uuid, p_status text, p_outcomes text default null, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.crm_reviews;
begin
  perform public._crm_require();
  select * into r from public.crm_reviews where id = p_id for update;
  if r.id is null then raise exception 'Review not found'; end if;
  if p_status = 'held' then
    if r.status <> 'planned' then raise exception 'Only a planned review can be marked held'; end if;
    if r.scheduled_on > current_date then raise exception 'This review is planned for %; mark it held on the day', r.scheduled_on; end if;
    update public.crm_reviews set status = 'held', held_at = now(), outcomes = coalesce(nullif(trim(p_outcomes), ''), outcomes),
      notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now() where id = p_id;
  elsif p_status = 'outcomes' then
    if r.status <> 'held' then raise exception 'Record outcomes once the review has been held'; end if;
    update public.crm_reviews set outcomes = nullif(trim(p_outcomes), ''), notes = nullif(trim(p_notes), ''), updated_at = now() where id = p_id;
  elsif p_status = 'closed' then
    if r.status <> 'held' then raise exception 'Only a held review can be closed'; end if;
    if coalesce(trim(coalesce(p_outcomes, r.outcomes)), '') = '' then raise exception 'Record the outcomes before closing the review'; end if;
    update public.crm_reviews set status = 'closed', outcomes = coalesce(nullif(trim(p_outcomes), ''), outcomes), closed_at = now(), closed_by = auth.uid(), updated_at = now() where id = p_id;
  elsif p_status = 'cancelled' then
    if r.status <> 'planned' then raise exception 'Only a planned review can be cancelled'; end if;
    if coalesce(trim(p_notes), '') = '' then raise exception 'Say why the review is cancelled'; end if;
    update public.crm_reviews set status = 'cancelled', cancelled_reason = trim(p_notes), updated_at = now() where id = p_id;
  else raise exception 'Unknown status %', p_status;
  end if;
  perform public._crm_event(r.client_id, 'review', p_id::text, p_status, jsonb_build_object('from', r.status));
end $$;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function public.crm_action_save(p_id uuid, p_client uuid, p_title text, p_detail text, p_owner uuid, p_due date,
  p_review uuid default null, p_client_visible boolean default false, p_account uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.crm_actions; v_id uuid; v_client uuid := p_client;
begin
  perform public._crm_require();
  if p_id is not null then
    select * into a from public.crm_actions where id = p_id for update;
    if a.id is null then raise exception 'Action not found'; end if;
    v_client := a.client_id;
  end if;
  if p_review is not null then
    select client_id into v_client from public.crm_reviews where id = p_review and (p_client is null or client_id = p_client);
    if v_client is null then raise exception 'The review must belong to the same client'; end if;
  end if;
  if not exists (select 1 from public.sourcing_clients where id = v_client) then raise exception 'Client not found'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Describe the action'; end if;
  if not public._crm_internal_person(p_owner) then raise exception 'The owner must be someone at adm Indicia'; end if;
  if p_id is null then
    insert into public.crm_actions (client_id, account_id, source, review_id, title, detail, owner, due_date, client_visible, created_by)
    values (v_client, p_account, case when p_review is not null then 'review' else 'ad_hoc' end, p_review, trim(p_title), nullif(trim(p_detail), ''),
            coalesce(p_owner, auth.uid()), p_due, coalesce(p_client_visible, false), auth.uid())
    returning id into v_id;
  else
    update public.crm_actions set title = trim(p_title), detail = nullif(trim(p_detail), ''), owner = coalesce(p_owner, owner), due_date = p_due,
      client_visible = coalesce(p_client_visible, client_visible), updated_at = now() where id = p_id;
    v_id := p_id;
  end if;
  perform public._crm_event(v_client, 'action', v_id::text, case when p_id is null then 'created' else 'updated' end, jsonb_build_object('title', trim(p_title), 'due', p_due));
  return v_id;
end $$;

create or replace function public.crm_action_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.crm_actions;
begin
  perform public._crm_require();
  select * into a from public.crm_actions where id = p_id for update;
  if a.id is null then raise exception 'Action not found'; end if;
  if p_status not in ('open','in_progress','done','cancelled') then raise exception 'Choose open, in progress, done or cancelled'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then raise exception 'Say why the action is cancelled'; end if;
  update public.crm_actions set status = p_status, done_at = case when p_status = 'done' then now() end, updated_at = now() where id = p_id;
  perform public._crm_event(a.client_id, 'action', p_id::text, 'status_' || p_status, jsonb_build_object('from', a.status, 'note', nullif(trim(p_note), '')));
end $$;

-- Survey follow-ups: a detractor (NPS 6 or lower) or any score of 3 or lower with a comment opens an action for the owner.
create or replace function public.trg_crm_survey_followup() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text; v_account uuid;
begin
  if not (new.nps <= 6 or new.comments <> '{}'::jsonb) then return null; end if;
  select coalesce(sr.owner, ct.owner), ct.full_name, ct.account_id into v_owner, v_name, v_account
    from public.crm_contacts ct left join public.crm_survey_recipients sr on sr.id = new.recipient_id where ct.id = new.contact_id;
  insert into public.crm_actions (client_id, account_id, source, survey_response_id, title, detail, owner, due_date)
  values (new.client_id, v_account, 'survey', new.id, 'Follow up survey feedback from ' || coalesce(v_name, 'the client'),
    'NPS ' || coalesce(new.nps::text, '-') || case when new.comments <> '{}'::jsonb then '; comments on ' || (select string_agg(k, ', ') from jsonb_object_keys(new.comments) k) else '' end,
    v_owner, current_date + 14);
  return null;
end $$;
create trigger crm_survey_responses_followup after insert on public.crm_survey_responses for each row execute function public.trg_crm_survey_followup();

create or replace function public.trg_crm_feedback_followup() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text;
begin
  if new.score > 6 or new.source not in ('internal','client_portal') then return null; end if;
  select coalesce(ct.owner, a.account_lead), ct.full_name into v_owner, v_name
    from public.sourcing_clients c left join public.crm_contacts ct on ct.id = new.contact_id left join public.crm_accounts a on a.id = coalesce(new.account_id, ct.account_id)
   where c.id = new.client_id;
  insert into public.crm_actions (client_id, account_id, source, feedback_id, title, detail, owner, due_date)
  values (new.client_id, new.account_id, 'survey', new.id, 'Follow up feedback (' || new.score || '/10)' || coalesce(' from ' || v_name, ''), left(new.comment, 500), v_owner, current_date + 14);
  return null;
end $$;
create trigger crm_feedback_followup after insert on public.crm_feedback for each row execute function public.trg_crm_feedback_followup();

-- ---------------------------------------------------------------------------
-- Client Portal
-- ---------------------------------------------------------------------------
create or replace function public.client_portal_reviews(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'client_name', c.name, 'title', r.title, 'review_type', r.review_type, 'scheduled_on', r.scheduled_on,
      'status', r.status, 'agenda', to_jsonb(r.agenda),
      'my_response', (select x.response from public.crm_review_responses x where x.review_id = r.id and x.user_id = auth.uid()),
      'attending', (select count(*) from public.crm_review_responses x where x.review_id = r.id and x.response = 'attending')) order by r.scheduled_on), '[]'::jsonb)
    from public.crm_reviews r join public.sourcing_clients c on c.id = r.client_id
   where r.client_id = any (v) and r.client_visible and r.status = 'planned' and r.scheduled_on >= current_date - 1);
end $$;

create or replace function public.client_review_respond(p_review uuid, p_response text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.crm_reviews; v_name text;
begin
  select * into r from public.crm_reviews where id = p_review;
  if r.id is null or not r.client_visible then raise exception 'Review not found' using errcode = '42501'; end if;
  perform public._client_actor(r.client_id);
  if r.status <> 'planned' then raise exception 'This review is no longer planned'; end if;
  if p_response not in ('attending','declined') then raise exception 'Say whether you will attend'; end if;
  insert into public.crm_review_responses (review_id, user_id, response, note) values (p_review, auth.uid(), p_response, left(nullif(trim(p_note), ''), 1000))
  on conflict (review_id, user_id) do update set response = excluded.response, note = excluded.note, responded_at = now();
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public.notify(u, 'crm', format('%s %s the review on %s', v_name, case when p_response = 'attending' then 'will attend' else 'can''t attend' end, to_char(r.scheduled_on, 'DD Mon')),
      left(nullif(trim(p_note), ''), 140), '/crm/reviews/' || r.id)
    from (select distinct unnest(r.internal_attendees || r.created_by) u) t where u is not null;
end $$;

-- "Our actions for you": client-visible actions only, client-safe fields.
create or replace function public.client_portal_actions(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'client_name', c.name, 'title', a.title, 'detail', a.detail, 'due_date', a.due_date, 'status', a.status,
      'from_review', r.title, 'owner_name', coalesce(nullif(p.full_name, ''), 'adm Indicia')) order by (a.status in ('done','cancelled')), a.due_date nulls last), '[]'::jsonb)
    from public.crm_actions a join public.sourcing_clients c on c.id = a.client_id left join public.crm_reviews r on r.id = a.review_id
    left join public.profiles p on p.id = a.owner
   where a.client_id = any (v) and a.client_visible and a.status <> 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
create view public.crm_reviews_v with (security_invoker = true) as
  select r.*, c.name as client_name, a.market as account_market, coalesce(nullif(cp.full_name, ''), cp.email) as created_by_name,
         (select array_agg(coalesce(nullif(p.full_name, ''), p.email) order by p.full_name) from public.profiles p where p.id = any (r.internal_attendees)) as internal_attendee_names,
         (select array_agg(ct.full_name order by ct.full_name) from public.crm_contacts ct where ct.id = any (r.contact_attendees)) as contact_attendee_names,
         (select count(*) from public.crm_review_responses x where x.review_id = r.id and x.response = 'attending')::int as client_confirmed,
         (select count(*) from public.crm_actions x where x.review_id = r.id)::int as actions,
         (r.status = 'planned' and r.scheduled_on < current_date) as past_due
    from public.crm_reviews r join public.sourcing_clients c on c.id = r.client_id
    left join public.crm_accounts a on a.id = r.account_id left join public.profiles cp on cp.id = r.created_by;

-- One list: CRM actions plus account plan actions.
create view public.crm_actions_v with (security_invoker = true) as
  select a.id, a.client_id, c.name as client_name, a.source, a.title, a.detail, a.owner, coalesce(nullif(p.full_name, ''), p.email) as owner_name, a.due_date,
         a.status, a.client_visible, a.review_id, r.title as review_title, a.survey_response_id, a.feedback_id, null::uuid as plan_id, null::text as plan_title,
         a.created_at, a.done_at, (a.status in ('open','in_progress') and a.due_date < current_date) as overdue
    from public.crm_actions a join public.sourcing_clients c on c.id = a.client_id
    left join public.profiles p on p.id = a.owner left join public.crm_reviews r on r.id = a.review_id
  union all
  select x.id, pl.client_id, c.name, 'plan', x.action, null, x.owner, coalesce(nullif(p.full_name, ''), p.email), x.due_date,
         case x.status when 'dropped' then 'cancelled' else x.status end, false, null, null, null, null, pl.id, pl.title, x.created_at, x.done_at,
         (x.status = 'open' and x.due_date < current_date)
    from public.crm_plan_actions x join public.crm_account_plans pl on pl.id = x.plan_id join public.sourcing_clients c on c.id = pl.client_id
    left join public.profiles p on p.id = x.owner;

-- ---------------------------------------------------------------------------
-- Health: reviews overdue and actions overdue (columns added at the end of crm_client_health)
-- ---------------------------------------------------------------------------
create or replace view public.crm_client_health with (security_invoker = true) as
  with b as (
    select c.id as client_id, c.code, c.name, c.default_currency as currency, c.active, c.crm_setup_status,
      (select coalesce(sum(e.sell_price), 0) from public.estimates e join public.jobs j on j.id = e.job_id
        where j.client_id = c.id and e.status = 'approved' and e.approved_at >= date_trunc('year', now()) and e.currency = c.default_currency) as spend_ytd,
      (select coalesce(sum(bl.gross_amount), 0) from public.client_bills bl
        where bl.client_id = c.id and bl.status in ('sent','paid') and bl.issue_date >= date_trunc('year', current_date)::date and bl.currency = c.default_currency) as billed_ytd,
      (select count(*) from public.client_bills bl where bl.client_id = c.id and bl.status = 'sent' and bl.due_date < current_date)::int as overdue_bills,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.score <= 6 and f.followed_up_at is null
         and f.created_at >= now() - interval '180 days')::int as open_issues,
      (select round(avg(f.score), 1) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months') as satisfaction,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as feedback_count,
      (select round(100.0 * (count(*) filter (where f.score >= 9) - count(*) filter (where f.score <= 6)) / nullif(count(*), 0))
         from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as nps,
      (select min(coalesce(k.renewal_date, k.end_date)) from public.crm_contracts k
        where k.client_id = c.id and k.status = 'signed' and coalesce(k.renewal_date, k.end_date) >= current_date) as next_renewal,
      (select max(i.occurred_at) from public.crm_interactions i where i.client_id = c.id) as last_activity_at,
      (select count(*) from public.crm_accounts a where a.client_id = c.id)::int as accounts,
      coalesce((select rc.review_overdue from public.crm_review_cadence_v rc where rc.client_id = c.id), false) as review_overdue,
      (select count(*) from public.crm_actions_v av where av.client_id = c.id and av.overdue)::int as actions_overdue
    from public.sourcing_clients c
  ), f as (
    select b.*, case when b.last_activity_at is null then null else (current_date - b.last_activity_at::date) end as days_since_activity,
           case when b.next_renewal is null then null else b.next_renewal - current_date end as days_to_renewal
      from b
  ), s as (
    select f.*,
      (case when f.overdue_bills > 0 then 2 else 0 end
       + case when f.satisfaction is not null and f.satisfaction < 6 then 2 when f.satisfaction is not null and f.satisfaction < 8 then 1 else 0 end
       + case when f.days_since_activity is null or f.days_since_activity > 60 then 2 when f.days_since_activity > 30 then 1 else 0 end
       + case when f.days_to_renewal is not null and f.days_to_renewal <= 30 then 2 when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 1 else 0 end
       + case when f.open_issues > 0 then 1 else 0 end
       + case when f.review_overdue then 1 else 0 end
       + case when f.actions_overdue > 0 then 1 else 0 end) as points,
      array_remove(array[
        case when f.overdue_bills > 0 then f.overdue_bills || ' overdue bill(s)' end,
        case when f.satisfaction is not null and f.satisfaction < 8 then 'Satisfaction ' || f.satisfaction || '/10' end,
        case when f.days_since_activity is null then 'No activity logged' when f.days_since_activity > 30 then 'No activity for ' || f.days_since_activity || ' days' end,
        case when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 'Renewal in ' || f.days_to_renewal || ' days' end,
        case when f.open_issues > 0 then f.open_issues || ' open detractor comment(s)' end,
        case when f.review_overdue then 'Business review overdue' end,
        case when f.actions_overdue > 0 then f.actions_overdue || ' overdue action(s)' end], null) as reasons
      from f
  )
  select s.client_id, s.code, s.name, s.currency, s.active, s.crm_setup_status, s.spend_ytd, s.billed_ytd, s.overdue_bills, s.open_issues, s.satisfaction,
         s.feedback_count, s.nps, s.next_renewal, s.last_activity_at, s.accounts, s.days_since_activity, s.days_to_renewal, s.points, s.reasons,
         case when s.points >= 4 then 'red' when s.points >= 2 then 'amber' else 'green' end as rag, s.review_overdue, s.actions_overdue
    from s;

create or replace view public.watchtower_health_crm with (security_invoker = true) as
  with red as (select count(*)::numeric n from public.crm_client_health where active and rag = 'red'),
  ren as (select count(*)::numeric n from public.crm_contracts where status = 'signed'
            and coalesce(renewal_date, end_date) between current_date and current_date + 90),
  pipe as (select coalesce(sum(value * probability / 100.0), 0)::numeric v from public.crm_opportunities where stage not in ('won','lost')),
  tgt as (select coalesce(sum(growth_target), 0)::numeric t from public.crm_account_plans where status = 'active'),
  bills as (select count(*)::numeric n from public.client_bills where status = 'sent' and due_date < current_date),
  quiet as (select count(*)::numeric n from public.sourcing_clients c
             where c.active and exists (select 1 from public.crm_accounts a where a.client_id = c.id and a.status in ('active','prospect'))
               and not exists (select 1 from public.crm_interactions i where i.client_id = c.id and i.occurred_at >= now() - interval '60 days')),
  rev as (select count(*)::numeric n from public.crm_review_cadence_v where review_overdue),
  act as (select count(*)::numeric n from public.crm_actions_v where overdue)
  select * from (
  select 'crm'::text as module, 'accounts_red'::text as metric, 'Clients at red health'::text as label, red.n as value, 0::numeric as target,
         case when red.n = 0 then 'ok' when red.n <= 1 then 'warn' else 'bad' end as status from red
  union all select 'crm', 'renewals_due_90d', 'Contract renewals due in the next 90 days', ren.n, 0, case when ren.n = 0 then 'ok' else 'warn' end from ren
  union all select 'crm', 'pipeline_vs_target', 'Weighted pipeline against account plan growth targets', round(pipe.v, 0), round(tgt.t, 0),
         case when pipe.v >= tgt.t then 'ok' when pipe.v >= tgt.t * 0.7 then 'warn' else 'bad' end from pipe, tgt
  union all select 'crm', 'overdue_client_bills', 'Client bills overdue', bills.n, 0, case when bills.n = 0 then 'ok' when bills.n <= 2 then 'warn' else 'bad' end from bills
  union all select 'crm', 'clients_no_activity_60d', 'Clients with no activity in 60 days', quiet.n, 0, case when quiet.n = 0 then 'ok' when quiet.n <= 2 then 'warn' else 'bad' end from quiet
  union all select 'crm', 'reviews_overdue', 'Clients overdue a business review (tier cadence)', rev.n, 0, case when rev.n = 0 then 'ok' when rev.n <= 1 then 'warn' else 'bad' end from rev
  union all select 'crm', 'actions_overdue', 'Client actions overdue', act.n, 0, case when act.n = 0 then 'ok' when act.n <= 3 then 'warn' else 'bad' end from act
  ) h where public.is_internal();

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.crm_reviews enable row level security;
alter table public.crm_review_responses enable row level security;
alter table public.crm_actions enable row level security;
create policy crm_reviews_read on public.crm_reviews for select to authenticated using (public.is_internal());
create policy crm_review_responses_read on public.crm_review_responses for select to authenticated using (public.is_internal());
create policy crm_actions_read on public.crm_actions for select to authenticated using (public.is_internal());
revoke all on public.crm_reviews, public.crm_review_responses, public.crm_actions, public.crm_reviews_v, public.crm_actions_v, public.crm_review_cadence_v from anon;
revoke insert, update, delete on public.crm_reviews, public.crm_review_responses, public.crm_actions, public.crm_reviews_v, public.crm_actions_v,
  public.crm_review_cadence_v, public.crm_client_health, public.watchtower_health_crm from authenticated;
revoke all on public.crm_client_health, public.watchtower_health_crm from anon;

revoke execute on function public.trg_crm_survey_followup(), public.trg_crm_feedback_followup() from public, anon, authenticated;
revoke execute on function public.crm_review_save(uuid, uuid, uuid, text, text, date, text[], uuid[], uuid[], boolean), public.crm_review_generate_pack(uuid),
  public.crm_review_set_status(uuid, text, text, text), public.crm_action_save(uuid, uuid, text, text, uuid, date, uuid, boolean, uuid),
  public.crm_action_set_status(uuid, text, text), public.client_portal_reviews(uuid), public.client_review_respond(uuid, text, text), public.client_portal_actions(uuid)
  from public, anon;
grant execute on function public.crm_review_save(uuid, uuid, uuid, text, text, date, text[], uuid[], uuid[], boolean), public.crm_review_generate_pack(uuid),
  public.crm_review_set_status(uuid, text, text, text), public.crm_action_save(uuid, uuid, text, text, uuid, date, uuid, boolean, uuid),
  public.crm_action_set_status(uuid, text, text), public.client_portal_reviews(uuid), public.client_review_respond(uuid, text, text), public.client_portal_actions(uuid)
  to authenticated;
