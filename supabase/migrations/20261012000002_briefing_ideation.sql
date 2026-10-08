-- Briefing+ AI ideation (Claude API) and the hand-off to Sourcing+.
-- The conversation lives server-side: every user direction, assistant reply and concept is persisted with the model,
-- prompt version and a snapshot of the context the model saw. Concepts are indicative creative suggestions, never measured.
-- Brief ideation and hand-off are only allowed once a manager has approved the brief (closes the prototype gap where
-- "Create specification" was available on unapproved briefs).

create table public.ideation_bulk_runs (
  id uuid primary key default gen_random_uuid(),
  brief_ids uuid[] not null default '{}',
  creative_params jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ideation_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('brief','campaign')),
  brief_id uuid references public.briefs(id) on delete cascade,
  bulk_run_id uuid references public.ideation_bulk_runs(id) on delete set null,
  objective text,                                   -- campaign ideation: the objective typed in
  context jsonb not null default '{}'::jsonb,       -- client / brand / division / market
  creative_params jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'brief') = (brief_id is not null))
);
create index ideation_sessions_brief_idx on public.ideation_sessions (brief_id, created_at desc);

create table public.ideation_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.ideation_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  model text,
  prompt_version text,
  demo boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ideation_messages_session_idx on public.ideation_messages (session_id, id);

create table public.ideation_concepts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ideation_sessions(id) on delete cascade,
  message_id bigint not null references public.ideation_messages(id) on delete cascade,
  brief_id uuid references public.briefs(id) on delete cascade,
  kind text not null check (kind in ('spec_concept','product_type')),
  idx int not null,
  is_top boolean not null default false,
  name text not null,
  data jsonb not null,                                -- the concept as returned (normalised)
  substrate_record_id uuid references public.library_records(id),   -- validated against the substrate library
  touchpoint_record_id uuid references public.library_records(id),  -- campaign ideation: product type from the touchpoint taxonomy
  model text not null,
  prompt_version text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  demo boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ideation_concepts_session_idx on public.ideation_concepts (session_id, message_id);

-- Hand-off to Sourcing+. Sourcing+ reads pending rows and accepts them when it opens the job / spec.
create table public.brief_handoffs (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  concept_id uuid not null references public.ideation_concepts(id),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  job_id uuid   -- FK to Sourcing+ jobs added by the integrator
);
create unique index brief_handoffs_one_per_concept on public.brief_handoffs (concept_id);

alter table public.ideation_bulk_runs enable row level security;
alter table public.ideation_sessions enable row level security;
alter table public.ideation_messages enable row level security;
alter table public.ideation_concepts enable row level security;
alter table public.brief_handoffs enable row level security;
create policy ibr_read on public.ideation_bulk_runs for select to authenticated using (public.is_internal());
create policy is_read on public.ideation_sessions for select to authenticated using (public.is_internal());
create policy im_read on public.ideation_messages for select to authenticated using (public.is_internal());
create policy ic_read on public.ideation_concepts for select to authenticated using (public.is_internal());
create policy bh_read on public.brief_handoffs for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.ideation_bulk_runs, public.ideation_sessions, public.ideation_messages,
  public.ideation_concepts, public.brief_handoffs from authenticated, anon;

create or replace function public._brief_require_approved(p_brief uuid) returns public.briefs
language plpgsql stable security definer set search_path = public as $$
declare b public.briefs;
begin
  select * into b from public.briefs where id = p_brief;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.approval_status is distinct from 'approved' or b.status <> 'in_ideation' then
    raise exception 'Ideation and hand-off open once the brief is approved (this brief is %)', replace(b.status, '_', ' ');
  end if;
  return b;
end $$;

create or replace function public.ideation_bulk_start(p_brief_ids jsonb, p_params jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ids uuid[];
begin
  perform public._briefing_require_internal();
  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_brief_ids, '[]'::jsonb)) x;
  if cardinality(v_ids) = 0 then raise exception 'Choose at least one approved brief'; end if;
  if cardinality(v_ids) > 25 then raise exception 'Run at most 25 briefs at a time'; end if;
  insert into public.ideation_bulk_runs (brief_ids, creative_params, created_by) values (v_ids, coalesce(p_params, '{}'::jsonb), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Start a conversation. Brief sessions require an approved brief.
create or replace function public.ideation_start(p_kind text, p_brief uuid, p_objective text, p_context jsonb, p_params jsonb, p_bulk uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._briefing_require_internal();
  if p_kind = 'brief' then
    perform public._brief_require_approved(p_brief);
  elsif p_kind = 'campaign' then
    if coalesce(trim(p_objective), '') = '' then raise exception 'Describe the campaign objective first'; end if;
  else
    raise exception 'Unknown ideation kind';
  end if;
  insert into public.ideation_sessions (kind, brief_id, bulk_run_id, objective, context, creative_params, created_by)
  values (p_kind, case when p_kind = 'brief' then p_brief end, p_bulk, nullif(trim(p_objective), ''), coalesce(p_context, '{}'::jsonb), coalesce(p_params, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Append one turn: the user's direction (optional), the assistant reply and its concepts, in one transaction.
-- p_concepts: [{kind, idx, is_top, name, data, substrate_record_id?, touchpoint_record_id?}]
-- Substrate / touchpoint ids that are not active records in the right library are dropped (never trusted from the model).
create or replace function public.ideation_add_turn(p_session uuid, p_user_message text, p_reply text, p_concepts jsonb,
  p_model text, p_prompt_version text, p_context jsonb, p_demo boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ideation_sessions; v_msg bigint; x jsonb; v_sub uuid; v_tp uuid; v_cid uuid; out jsonb := '[]'::jsonb;
begin
  perform public._briefing_require_internal();
  select * into s from public.ideation_sessions where id = p_session;
  if s.id is null then raise exception 'Ideation session not found'; end if;
  if s.kind = 'brief' then perform public._brief_require_approved(s.brief_id); end if;
  if coalesce(trim(p_model), '') = '' or coalesce(trim(p_prompt_version), '') = '' then raise exception 'Model and prompt version are required'; end if;
  if coalesce(trim(p_user_message), '') <> '' then
    insert into public.ideation_messages (session_id, role, content, created_by) values (p_session, 'user', trim(p_user_message), auth.uid());
  end if;
  insert into public.ideation_messages (session_id, role, content, model, prompt_version, demo, created_by)
  values (p_session, 'assistant', coalesce(nullif(trim(p_reply), ''), '(no reply)'), p_model, p_prompt_version, coalesce(p_demo, false), auth.uid())
  returning id into v_msg;
  for x in select * from jsonb_array_elements(coalesce(p_concepts, '[]'::jsonb)) loop
    select id into v_sub from public.library_records
      where id = case when (x->>'substrate_record_id') ~* '^[0-9a-f-]{36}$' then (x->>'substrate_record_id')::uuid end
        and library_key = 'substrates' and status = 'active';
    select id into v_tp from public.library_records
      where id = case when (x->>'touchpoint_record_id') ~* '^[0-9a-f-]{36}$' then (x->>'touchpoint_record_id')::uuid end
        and library_key = 'touchpoint_types' and status = 'active';
    insert into public.ideation_concepts (session_id, message_id, brief_id, kind, idx, is_top, name, data, substrate_record_id,
      touchpoint_record_id, model, prompt_version, context_snapshot, demo, created_by)
    values (p_session, v_msg, s.brief_id, coalesce(x->>'kind', case when s.kind = 'brief' then 'spec_concept' else 'product_type' end),
      coalesce((x->>'idx')::int, 0), coalesce((x->>'is_top')::boolean, false), coalesce(nullif(trim(x->>'name'), ''), 'Untitled concept'),
      coalesce(x->'data', '{}'::jsonb), v_sub, v_tp, p_model, p_prompt_version, coalesce(p_context, '{}'::jsonb), coalesce(p_demo, false), auth.uid())
    returning id into v_cid;
    -- Usage guard: library records used by a concept cannot be deleted, only deactivated.
    if v_sub is not null then insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (v_sub, 'ideation_concepts', v_cid::text, x->>'name') on conflict do nothing; end if;
    if v_tp is not null then insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (v_tp, 'ideation_concepts', v_cid::text, x->>'name') on conflict do nothing; end if;
    out := out || to_jsonb(v_cid);
  end loop;
  return jsonb_build_object('message_id', v_msg, 'concept_ids', out);
end $$;

-- "Send to Sourcing": the payload is built here from the stored concept and brief, never from the client.
create or replace function public.brief_handoff_create(p_concept uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; b public.briefs; v_id uuid; v_sub public.library_records;
begin
  perform public._briefing_require_internal();
  select * into c from public.ideation_concepts where id = p_concept;
  if c.id is null then raise exception 'Concept not found'; end if;
  if c.brief_id is null then raise exception 'Only concepts from a brief can be sent to Sourcing+'; end if;
  b := public._brief_require_approved(c.brief_id);
  if exists (select 1 from public.brief_handoffs where concept_id = p_concept) then raise exception 'This concept has already been sent to Sourcing+'; end if;
  select * into v_sub from public.library_records where id = c.substrate_record_id;
  insert into public.brief_handoffs (brief_id, concept_id, payload, created_by)
  values (b.id, c.id, jsonb_build_object(
      'brief', jsonb_build_object('id', b.id, 'code', b.brief_code, 'title', b.title, 'campaign_id', b.campaign_id, 'region', b.region, 'market', b.market,
        'client', b.client, 'brand', b.brand, 'division', b.division, 'objective', b.objective, 'target_outlets', b.target_outlets,
        'budget_low', b.budget_low, 'budget_high', b.budget_high, 'currency', b.currency, 'target_launch', b.target_launch,
        'sustainability_targets', b.sustainability_targets, 'min_recycled_pct', b.min_recycled_pct, 'require_fsc', b.require_fsc),
      'concept', c.data || jsonb_build_object('name', c.name),
      'substrate', case when v_sub.id is null then null else jsonb_build_object('record_id', v_sub.id, 'code', v_sub.code, 'name', v_sub.name, 'version', v_sub.version) end,
      'ai', jsonb_build_object('model', c.model, 'prompt_version', c.prompt_version, 'demo', c.demo, 'basis', 'indicative creative suggestion, not measured'),
      'note', nullif(trim(p_note), '')),
    auth.uid())
  returning id into v_id;
  perform public._brief_event(b.id, 'handoff_created', b.status, b.status, c.name);
  return v_id;
end $$;

-- Called by Sourcing+ when it takes the hand-off on (opens the job / spec). Moves the brief to spec_created.
create or replace function public.brief_handoff_accept(p_handoff uuid, p_job uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare h public.brief_handoffs; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into h from public.brief_handoffs where id = p_handoff for update;
  if h.id is null then raise exception 'Hand-off not found'; end if;
  if h.status <> 'pending' then raise exception 'This hand-off has already been accepted'; end if;
  select * into b from public.briefs where id = h.brief_id for update;
  update public.brief_handoffs set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), job_id = p_job where id = p_handoff;
  if b.status = 'in_ideation' then
    update public.briefs set status = 'spec_created', resulting_job_id = coalesce(p_job, resulting_job_id), updated_at = now() where id = b.id;
    perform public._brief_event(b.id, 'spec_created', b.status, 'spec_created', null);
  end if;
end $$;

revoke execute on function public._brief_require_approved(uuid) from public, anon, authenticated;
grant execute on function public.ideation_bulk_start(jsonb, jsonb), public.ideation_start(text, uuid, text, jsonb, jsonb, uuid),
  public.ideation_add_turn(uuid, text, text, jsonb, text, text, jsonb, boolean),
  public.brief_handoff_create(uuid, text), public.brief_handoff_accept(uuid, uuid) to authenticated;
