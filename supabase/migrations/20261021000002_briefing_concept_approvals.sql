-- Platform approvals (2 of 3): Briefing+ approval gaps closed.
--   * Concepts get a status: proposed -> submitted_for_approval -> approved | changes_requested -> sent_to_sourcing.
--     concept_submit / concept_decide; the approver holds the role in approval_policy_for('CONCEPT', client, market, budget)
--     (default: briefing lead) and is never the submitter. Every step is written to append-only concept_approvals and
--     to brief_events.
--   * When the policy says client_approval_required, a client approver (client_users.role = 'approver') approves or asks
--     for changes in the Client Portal (client-safe fields only, no costs or internal notes).
--   * brief_handoff_create needs an approved concept (and the client's approval when required) whenever a CONCEPT policy
--     applies or the concept has entered the approval flow.
--   * Campaign ideation concepts (product_type) can be submitted and, once approved, turned into draft briefs per market.
--   * brief_decide also checks the BRIEF policy role when a policy with a role exists (the not-the-author rule stays).
-- Safe on a populated database: new columns are defaulted; concepts that already have a hand-off become sent_to_sourcing.

alter table public.ideation_concepts
  add column if not exists status text not null default 'proposed'
    check (status in ('proposed','submitted_for_approval','approved','changes_requested','sent_to_sourcing')),
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists submit_note text,
  add column if not exists decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_comments text,
  add column if not exists policy_record_id uuid references public.library_records(id),
  add column if not exists client_approval_required boolean not null default false,
  add column if not exists client_status text not null default 'not_required'
    check (client_status in ('not_required','pending','approved','changes_requested')),
  add column if not exists client_decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists client_decided_at timestamptz,
  add column if not exists client_comments text;
create index if not exists ideation_concepts_status_idx on public.ideation_concepts (status);

update public.ideation_concepts set status = 'sent_to_sourcing'
 where status = 'proposed' and id in (select concept_id from public.brief_handoffs);

-- Briefs created from an approved campaign concept point back to it.
alter table public.briefs add column if not exists source_concept_id uuid references public.ideation_concepts(id) on delete set null;

-- Append-only: every concept submission and decision (internal and client).
create table if not exists public.concept_approvals (
  id bigint generated always as identity primary key,
  concept_id uuid not null references public.ideation_concepts(id) on delete cascade,
  brief_id uuid references public.briefs(id) on delete cascade,
  stage text not null check (stage in ('internal','client')),
  action text not null check (action in ('submitted','approved','changes_requested','sent_to_sourcing','briefs_created')),
  comments text,
  policy_record_id uuid references public.library_records(id),
  client_id uuid references public.sourcing_clients(id),
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists concept_approvals_concept_idx on public.concept_approvals (concept_id, at);
alter table public.concept_approvals enable row level security;
drop policy if exists ca_read on public.concept_approvals;
create policy ca_read on public.concept_approvals for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.concept_approvals from authenticated, anon;
drop trigger if exists concept_approvals_no_update on public.concept_approvals;
create trigger concept_approvals_no_update before update on public.concept_approvals for each row execute function public.trg_client_append_only();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Client, market and value a concept is judged on: the brief's, or (campaign ideation) the session context.
create or replace function public._concept_scope(p_concept uuid)
returns table (client_id uuid, market text, region text, value numeric, currency text, brief_id uuid)
language sql stable security definer set search_path = public as $$
  select coalesce(b.client_id, cp.client_id, public._client_match(s.context->>'client')),
         coalesce(b.market, nullif(upper(trim(s.context->>'market')), '')),
         coalesce(b.region, (select m.region_code from public.markets m where m.code = upper(trim(s.context->>'market')))),
         b.budget_high, b.currency, b.id
    from public.ideation_concepts c
    join public.ideation_sessions s on s.id = c.session_id
    left join public.briefs b on b.id = c.brief_id
    left join public.campaigns cp on cp.id = b.campaign_id
   where c.id = p_concept;
$$;

create or replace function public._concept_audit(c public.ideation_concepts, p_stage text, p_action text, p_comments text, p_client uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.concept_approvals (concept_id, brief_id, stage, action, comments, policy_record_id, client_id, actor)
  values (c.id, c.brief_id, p_stage, p_action, nullif(trim(p_comments), ''), c.policy_record_id, p_client, auth.uid());
$$;

create or replace function public._concept_href(c public.ideation_concepts) returns text
language sql stable as $$
  select case when c.brief_id is not null then '/briefing/' || c.brief_id || '#concepts' else '/briefing/campaign-ideation?concept=' || c.id end;
$$;

-- Can the caller decide this concept now? (Used by the approvals inbox and the UI.)
create or replace function public.concept_can_decide(p_concept uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c public.ideation_concepts; sc record; pol record;
begin
  if not public.is_internal() then return false; end if;
  select * into c from public.ideation_concepts where id = p_concept;
  if c.id is null or c.status <> 'submitted_for_approval' or c.submitted_by is not distinct from auth.uid() then return false; end if;
  select * into sc from public._concept_scope(p_concept);
  select * into pol from public._approval_policy('CONCEPT', sc.client_id, sc.market, sc.value);
  return public.approval_has_role(coalesce(pol.approver_role, 'briefing_lead'), 'briefing');
end $$;

create or replace function public.brief_can_decide(p_brief uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b public.briefs; pol record;
begin
  if not public.is_internal() then return false; end if;
  select * into b from public.briefs where id = p_brief;
  if b.id is null or b.status <> 'submitted' or b.approval_status is distinct from 'pending' or b.created_by is not distinct from auth.uid() then return false; end if;
  select * into pol from public._approval_policy('BRIEF', b.client_id, b.market, b.budget_high);
  return pol.approver_role is null or public.approval_has_role(pol.approver_role, 'briefing');
end $$;

-- ---------------------------------------------------------------------------
-- Brief approval: the BRIEF policy role is enforced when a policy names one.
-- ---------------------------------------------------------------------------
create or replace function public.brief_decide(p_id uuid, p_decision text, p_comments text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_to text; pol record;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status <> 'submitted' or b.approval_status is distinct from 'pending' then raise exception 'This brief is not waiting for approval'; end if;
  if b.created_by = auth.uid() then raise exception 'You cannot approve your own brief: another team member must review it' using errcode = '42501'; end if;
  select * into pol from public._approval_policy('BRIEF', b.client_id, b.market, b.budget_high);
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'briefing') then
    raise exception 'This brief needs a % to decide it (approval policy %)', lower(public.approval_role_label(pol.approver_role)), pol.code using errcode = '42501';
  end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comments), '') = '' then raise exception 'Say what needs to change'; end if;
  v_to := case when p_decision = 'approved' then 'in_ideation' else 'draft' end;
  update public.briefs set status = v_to, approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
    approval_comments = nullif(trim(p_comments), ''), updated_at = now() where id = p_id;
  insert into public.brief_approvals (brief_id, decision, comments, decided_by) values (p_id, p_decision, nullif(trim(p_comments), ''), auth.uid());
  perform public._brief_event(p_id, p_decision, 'submitted', v_to, nullif(trim(p_comments), ''));
  perform public.notify(b.created_by, 'briefing', case when p_decision = 'approved' then 'Brief approved: ' else 'Changes requested: ' end || b.brief_code,
    nullif(trim(p_comments), ''), '/briefing/' || b.id);
end $$;

-- ---------------------------------------------------------------------------
-- Concept approval
-- ---------------------------------------------------------------------------
create or replace function public.concept_submit(p_concept uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; s public.ideation_sessions; sc record; pol record; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into c from public.ideation_concepts where id = p_concept for update;
  if c.id is null then raise exception 'Concept not found'; end if;
  if c.status not in ('proposed','changes_requested') then raise exception 'This concept is already %', replace(c.status, '_', ' '); end if;
  select * into s from public.ideation_sessions where id = c.session_id;
  if c.brief_id is not null then
    b := public._brief_require_approved(c.brief_id);
  elsif c.kind <> 'product_type' or s.kind <> 'campaign' then
    raise exception 'Only brief concepts and campaign ideation concepts can be submitted';
  end if;
  select * into sc from public._concept_scope(p_concept);
  select * into pol from public._approval_policy('CONCEPT', sc.client_id, sc.market, sc.value);
  update public.ideation_concepts set status = 'submitted_for_approval', submitted_by = auth.uid(), submitted_at = now(),
    submit_note = nullif(trim(p_note), ''), decided_by = null, decided_at = null, decision_comments = null,
    policy_record_id = pol.record_id,
    -- Client approval applies to concepts on a brief (the Client Portal shows them on the brief).
    client_approval_required = c.brief_id is not null and coalesce(pol.client_approval_required, false),
    client_status = 'not_required', client_decided_by = null, client_decided_at = null, client_comments = null
   where id = p_concept returning * into c;
  perform public._concept_audit(c, 'internal', 'submitted', p_note, null);
  if c.brief_id is not null then
    perform public._brief_event(c.brief_id, 'concept_submitted', b.status, b.status, c.name);
  end if;
  perform public._approval_notify(coalesce(pol.approver_role, 'briefing_lead'), 'briefing', 'briefing', 'Concept to approve: ' || c.name,
    coalesce(nullif(trim(p_note), ''), 'Submitted for approval before it goes further.'), public._concept_href(c), auth.uid());
end $$;

create or replace function public.concept_decide(p_concept uuid, p_decision text, p_comments text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; sc record; pol record; v_status text; v_client text; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into c from public.ideation_concepts where id = p_concept for update;
  if c.id is null then raise exception 'Concept not found'; end if;
  if c.status <> 'submitted_for_approval' then raise exception 'This concept is not waiting for approval'; end if;
  if c.submitted_by = auth.uid() then raise exception 'You submitted this concept, so someone else must approve it' using errcode = '42501'; end if;
  select * into sc from public._concept_scope(p_concept);
  select * into pol from public._approval_policy('CONCEPT', sc.client_id, sc.market, sc.value);
  if not public.approval_has_role(coalesce(pol.approver_role, 'briefing_lead'), 'briefing') then
    raise exception 'This concept needs a % to approve it%', lower(public.approval_role_label(coalesce(pol.approver_role, 'briefing_lead'))),
      coalesce(' (approval policy ' || pol.code || ')', '') using errcode = '42501';
  end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comments), '') = '' then raise exception 'Say what needs to change'; end if;
  v_status := p_decision;
  v_client := case when p_decision = 'approved' and c.client_approval_required then 'pending' else 'not_required' end;
  update public.ideation_concepts set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_comments = nullif(trim(p_comments), ''),
    client_status = v_client where id = p_concept returning * into c;
  perform public._concept_audit(c, 'internal', p_decision, p_comments, null);
  if c.brief_id is not null then
    select * into b from public.briefs where id = c.brief_id;
    perform public._brief_event(c.brief_id, 'concept_' || p_decision, b.status, b.status, c.name || coalesce(': ' || nullif(trim(p_comments), ''), ''));
  end if;
  perform public.notify(c.submitted_by, 'briefing',
    case when p_decision = 'approved' then 'Concept approved: ' else 'Changes requested on concept: ' end || c.name,
    case when v_client = 'pending' then 'Now waiting for the client to approve it in the Client Portal.' else nullif(trim(p_comments), '') end,
    public._concept_href(c));
  if v_client = 'pending' then
    perform public.notify(cu.user_id, 'client', 'Concept for your approval: ' || c.name,
      'adm Indicia would like your approval on a concept for ' || coalesce(b.title, 'your brief') || '.', '/client-portal/briefs/' || c.brief_id)
      from public.client_users cu where cu.client_id = sc.client_id and cu.role = 'approver';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Hand-off to Sourcing+ now needs an approved concept (and the client's approval when required).
-- ---------------------------------------------------------------------------
create or replace function public.brief_handoff_create(p_concept uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; b public.briefs; v_id uuid; v_sub public.library_records; pol record;
begin
  perform public._briefing_require_internal();
  select * into c from public.ideation_concepts where id = p_concept for update;
  if c.id is null then raise exception 'Concept not found'; end if;
  if c.brief_id is null then raise exception 'Only concepts from a brief can be sent to Sourcing+'; end if;
  b := public._brief_require_approved(c.brief_id);
  if exists (select 1 from public.brief_handoffs where concept_id = p_concept) then raise exception 'This concept has already been sent to Sourcing+'; end if;
  select * into pol from public._approval_policy('CONCEPT', b.client_id, b.market, b.budget_high);
  if pol.record_id is not null or c.status <> 'proposed' then
    if c.status <> 'approved' then
      raise exception 'This concept must be approved before it goes to Sourcing+ (it is %)', replace(c.status, '_', ' ');
    end if;
    if (c.client_approval_required or (c.policy_record_id is null and coalesce(pol.client_approval_required, false))) and c.client_status <> 'approved' then
      raise exception 'The client must approve this concept in the Client Portal before it goes to Sourcing+';
    end if;
  end if;
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
      'approval', jsonb_build_object('status', c.status, 'decided_by', c.decided_by, 'decided_at', c.decided_at, 'client_status', c.client_status,
        'client_decided_at', c.client_decided_at, 'policy', pol.code),
      'note', nullif(trim(p_note), '')),
    auth.uid())
  returning id into v_id;
  update public.ideation_concepts set status = 'sent_to_sourcing' where id = c.id returning * into c;
  perform public._concept_audit(c, 'internal', 'sent_to_sourcing', p_note, null);
  perform public._brief_event(b.id, 'handoff_created', b.status, b.status, c.name);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Client Portal: concepts waiting for the client's approval (client-safe fields only)
-- ---------------------------------------------------------------------------
create or replace function public.client_portal_concepts(p_brief uuid, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); v_client uuid;
begin
  if p_brief not in (select public._client_brief_ids(v)) then return '[]'::jsonb; end if;
  select coalesce(b.client_id, cp.client_id) into v_client from public.briefs b left join public.campaigns cp on cp.id = b.campaign_id where b.id = p_brief;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name,
      'creative_direction', c.data->>'creative_direction', 'spec_type', c.data->>'suggested_spec_type',
      'substrate', c.data->>'suggested_substrate_name',
      'length', c.data->>'suggested_length', 'width', c.data->>'suggested_width', 'depth', c.data->>'suggested_depth', 'unit', c.data->>'suggested_unit',
      'eco_score', c.data->'eco'->>'score', 'eco_tag', c.data->'eco'->>'tag', 'rationale', c.data->>'rationale',
      'approved_at', c.decided_at, 'client_status', c.client_status, 'client_comments', c.client_comments, 'client_decided_at', c.client_decided_at,
      'sent_to_sourcing', c.status = 'sent_to_sourcing',
      'role', case when public.is_internal() then 'preview' else public.my_client_role(v_client) end)
      order by c.decided_at desc nulls last, c.idx), '[]'::jsonb)
    from public.ideation_concepts c
   where c.brief_id = p_brief and c.client_approval_required and c.client_status <> 'not_required');
end $$;

create or replace function public.client_concept_decide(p_concept uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; b public.briefs; v_client uuid; v_role text; v_name text;
begin
  select * into c from public.ideation_concepts where id = p_concept for update;
  if c.id is null or c.brief_id is null then raise exception 'Not found' using errcode = '42501'; end if;
  select * into b from public.briefs where id = c.brief_id;
  v_client := coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id));
  if v_client is null then raise exception 'Not found' using errcode = '42501'; end if;
  v_role := public._client_actor(v_client);
  if not c.client_approval_required or c.client_status = 'not_required' then raise exception 'Not found' using errcode = '42501'; end if;
  if v_role <> 'approver' then raise exception 'Only approvers can approve concepts; ask your approver' using errcode = '42501'; end if;
  if c.status <> 'approved' or c.client_status <> 'pending' then raise exception 'This concept is not waiting for your approval'; end if;
  if p_approve is null then raise exception 'Choose approve or request changes'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Tell us what you would like changed'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  update public.ideation_concepts set client_status = case when p_approve then 'approved' else 'changes_requested' end,
    status = case when p_approve then status else 'changes_requested' end,
    client_decided_by = auth.uid(), client_decided_at = now(), client_comments = nullif(trim(p_comment), '')
   where id = p_concept returning * into c;
  perform public._concept_audit(c, 'client', case when p_approve then 'approved' else 'changes_requested' end, p_comment, v_client);
  perform public._brief_event(b.id, case when p_approve then 'concept_client_approved' else 'concept_client_changes_requested' end, b.status, b.status, c.name);
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public.notify(u, 'briefing',
      format('%s %s concept %s', v_name, case when p_approve then 'approved' else 'asked for changes on' end, c.name),
      case when p_approve then 'It can now be sent to Sourcing+.' else nullif(trim(p_comment), '') end, '/briefing/' || b.id || '#concepts')
    from (select distinct u from unnest(array[c.submitted_by, c.decided_by, b.created_by]) u where u is not null) x;
end $$;

-- ---------------------------------------------------------------------------
-- Campaign ideation: an approved product-type concept becomes draft briefs, one per market.
-- ---------------------------------------------------------------------------
create or replace function public.campaign_concept_to_briefs(p_concept uuid, p_markets text[]) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; s public.ideation_sessions; m public.markets; v_code text; v_id uuid; out uuid[] := '{}'; v_text text;
begin
  perform public._briefing_require_internal();
  select * into c from public.ideation_concepts where id = p_concept for update;
  if c.id is null then raise exception 'Concept not found'; end if;
  select * into s from public.ideation_sessions where id = c.session_id;
  if c.brief_id is not null or s.kind <> 'campaign' then raise exception 'Only campaign ideation concepts can be turned into briefs'; end if;
  if c.status <> 'approved' then raise exception 'Get this concept approved before creating briefs from it (it is %)', replace(c.status, '_', ' '); end if;
  if coalesce(cardinality(p_markets), 0) = 0 then raise exception 'Choose at least one market'; end if;
  if cardinality(p_markets) > 40 then raise exception 'Choose at most 40 markets at a time'; end if;
  v_text := concat_ws(E'\n',
    'Campaign objective: ' || coalesce(s.objective, ''),
    'Approved product type: ' || c.name || coalesce(' (' || nullif(c.data->>'suggested_spec_type', '') || ')', ''),
    nullif(c.data->>'rationale', ''),
    'Created from an approved Campaign ideation concept. The product type is a creative suggestion, not a data-verified prediction.');
  foreach v_code in array (select array_agg(distinct upper(trim(x))) from unnest(p_markets) x where trim(x) <> '') loop
    select * into m from public.markets where code = v_code;
    if m.code is null then raise exception 'Unknown market %', v_code; end if;
    if exists (select 1 from public.briefs where source_concept_id = c.id and market = m.code and status <> 'archived') then
      raise exception 'There is already a brief for % from this concept', m.name;
    end if;
    v_id := public.brief_create(jsonb_build_object(
      'title', c.name || ': ' || m.name, 'objective', s.objective, 'brief_text', v_text,
      'client', s.context->>'client', 'brand', s.context->>'brand', 'division', s.context->>'division',
      'region', m.region_code, 'market', m.code, 'currency', m.currency, 'product_category', c.name,
      'source', 'campaign-concept:' || c.id), false);
    update public.briefs set source_concept_id = c.id where id = v_id;
    out := out || v_id;
  end loop;
  perform public._concept_audit(c, 'internal', 'briefs_created', array_to_string(p_markets, ', '), null);
  return out;
end $$;

-- Concept status in the views the app reads (security invoker: caller's RLS applies).
create or replace view public.concept_approvals_v with (security_invoker = true) as
  select a.*, coalesce(nullif(p.full_name, ''), p.email) as actor_name from public.concept_approvals a left join public.profiles p on p.id = a.actor;
revoke insert, update, delete on public.concept_approvals_v from authenticated, anon;

revoke execute on function public._concept_scope(uuid), public._concept_audit(public.ideation_concepts, text, text, text, uuid),
  public._concept_href(public.ideation_concepts) from public, anon, authenticated;
revoke execute on function public.concept_submit(uuid, text), public.concept_decide(uuid, text, text), public.concept_can_decide(uuid),
  public.brief_can_decide(uuid), public.campaign_concept_to_briefs(uuid, text[]), public.client_portal_concepts(uuid, uuid),
  public.client_concept_decide(uuid, boolean, text) from public, anon;
grant execute on function public.concept_submit(uuid, text), public.concept_decide(uuid, text, text), public.concept_can_decide(uuid),
  public.brief_can_decide(uuid), public.campaign_concept_to_briefs(uuid, text[]), public.client_portal_concepts(uuid, uuid),
  public.client_concept_decide(uuid, boolean, text) to authenticated;
