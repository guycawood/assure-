-- Briefing+: campaigns (set up centrally, many markets) and briefs (one per market), with manager approval.
-- Rebuilt from the Base44 prototype (Brief entity, BriefDetail, BriefApprovalPanel) with its gaps closed:
--   * revision and approval history are append-only child tables, not jsonb arrays on the brief;
--   * every status / approval change goes through a security definer function that checks the caller and the state;
--   * the approver can never be the author (enforced in the database, not just hidden in the UI);
--   * ideation and the hand-off to Sourcing+ are only possible after approval (see 20261012000002).
-- Region and market are separate columns everywhere (FKs to regions/markets when master data lands).

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create sequence public.campaign_no;
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique default ('CMP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.campaign_no')::text, 5, '0')),
  name text not null check (length(trim(name)) > 0),
  client text,
  brands text[] not null default '{}',
  division text,
  brand_tier text,
  objective text,
  campaign_type text check (campaign_type in ('always_on','seasonal','tactical')),
  activation_objective text check (activation_objective in ('trial','trade_up','conversion','loyalty','basket_value')),
  channels text[] not null default '{}',
  store_types text[] not null default '{}',
  p2p_stages text[] not null default '{}',
  start_date date,
  end_date date,
  status text not null default 'planning' check (status in ('planning','live','closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- Multi-region / multi-market via a link table (region and market separate).
create table public.campaign_markets (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  region text not null,
  market text not null,
  primary key (campaign_id, market)
);

-- ---------------------------------------------------------------------------
-- Briefs (per market)
-- ---------------------------------------------------------------------------
create sequence public.brief_no;
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  brief_code text not null unique default ('BR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.brief_no')::text, 5, '0')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  region text,
  market text,
  client text,
  brand text,
  division text,
  title text not null check (length(trim(title)) > 0),
  objective text,
  brief_text text,
  target_outlets text,
  budget_low numeric check (budget_low is null or budget_low >= 0),
  budget_high numeric check (budget_high is null or budget_high >= 0),
  currency text not null default 'GBP',
  target_launch date,
  product_category text,
  sustainability_targets text,
  min_recycled_pct int check (min_recycled_pct is null or min_recycled_pct between 0 and 100),
  require_fsc boolean not null default false,
  status text not null default 'draft' check (status in ('draft','submitted','in_ideation','spec_created','archived')),
  approval_status text check (approval_status in ('pending','approved','changes_requested')),
  revision_count int not null default 0,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  approval_comments text,
  -- Set when Sourcing+ accepts a hand-off. FK to jobs is added by the integrator when Sourcing+ lands.
  resulting_job_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_low is null or budget_high is null or budget_high >= budget_low)
);
create index briefs_status_idx on public.briefs (status);
create index briefs_campaign_idx on public.briefs (campaign_id);

-- Append-only: every edit made after submission, with a field-level diff and the full previous version.
create table public.brief_revisions (
  id bigint generated always as identity primary key,
  brief_id uuid not null references public.briefs(id) on delete cascade,
  version int not null,
  changes jsonb not null default '[]'::jsonb,          -- [{field, before, after}]
  previous_version jsonb not null default '[]'::jsonb, -- [{field, value}] in form order
  revised_by uuid references public.profiles(id) on delete set null,
  revised_at timestamptz not null default now(),
  unique (brief_id, version)
);

-- Append-only: every manager decision.
create table public.brief_approvals (
  id bigint generated always as identity primary key,
  brief_id uuid not null references public.briefs(id) on delete cascade,
  decision text not null check (decision in ('approved','changes_requested')),
  comments text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);

-- Append-only: lifecycle events (drives the progress timeline).
create table public.brief_events (
  id bigint generated always as identity primary key,
  brief_id uuid not null references public.briefs(id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  note text,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index brief_events_brief_idx on public.brief_events (brief_id, at);

-- ---------------------------------------------------------------------------
-- RLS: internal only. No vendor access. All writes through the functions below.
-- ---------------------------------------------------------------------------
alter table public.campaigns enable row level security;
alter table public.campaign_markets enable row level security;
alter table public.briefs enable row level security;
alter table public.brief_revisions enable row level security;
alter table public.brief_approvals enable row level security;
alter table public.brief_events enable row level security;
create policy campaigns_read on public.campaigns for select to authenticated using (public.is_internal());
create policy campaign_markets_read on public.campaign_markets for select to authenticated using (public.is_internal());
create policy briefs_read on public.briefs for select to authenticated using (public.is_internal());
create policy brief_revisions_read on public.brief_revisions for select to authenticated using (public.is_internal());
create policy brief_approvals_read on public.brief_approvals for select to authenticated using (public.is_internal());
create policy brief_events_read on public.brief_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.campaigns, public.campaign_markets, public.briefs,
  public.brief_revisions, public.brief_approvals, public.brief_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._briefing_require_internal() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_internal() then
    raise exception 'Briefing+ is for adm Indicia staff only' using errcode = '42501';
  end if;
end $$;

create or replace function public._brief_event(p_brief uuid, p_event text, p_from text, p_to text, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into public.brief_events (brief_id, event, from_status, to_status, note, actor) values (p_brief, p_event, p_from, p_to, p_note, auth.uid());
$$;

create or replace function public._text_array(p jsonb) returns text[]
language sql immutable as $$
  select coalesce(array(select trim(x) from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x where trim(x) <> ''), '{}');
$$;

-- Display snapshot of the tracked fields, in form order: [{field, value}].
create or replace function public._brief_snapshot(b public.briefs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('field', f, 'value', coalesce(nullif(v, ''), '(empty)')) order by n)
  from (values
    (1, 'Campaign', (select c.name from public.campaigns c where c.id = b.campaign_id)),
    (2, 'Region', b.region), (3, 'Market', b.market), (4, 'Client', b.client), (5, 'Brand', b.brand), (6, 'Division', b.division),
    (7, 'Title', b.title), (8, 'Objective', b.objective), (9, 'Brief', b.brief_text), (10, 'Target outlets', b.target_outlets),
    (11, 'Budget from', b.budget_low::text), (12, 'Budget to', b.budget_high::text), (13, 'Currency', b.currency),
    (14, 'Target launch', b.target_launch::text), (15, 'Product category', b.product_category),
    (16, 'Sustainability targets', b.sustainability_targets), (17, 'Minimum recycled content %', b.min_recycled_pct::text),
    (18, 'FSC required', case when b.require_fsc then 'Yes' else 'No' end)
  ) t(n, f, v);
$$;

-- ---------------------------------------------------------------------------
-- Campaign writes
-- ---------------------------------------------------------------------------
create or replace function public._campaign_set_markets(p_campaign uuid, p_markets jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb;
begin
  delete from public.campaign_markets where campaign_id = p_campaign;
  for x in select * from jsonb_array_elements(coalesce(p_markets, '[]'::jsonb)) loop
    if coalesce(trim(x->>'market'), '') = '' or coalesce(trim(x->>'region'), '') = '' then
      raise exception 'Each campaign market needs a region and a market';
    end if;
    insert into public.campaign_markets (campaign_id, region, market) values (p_campaign, trim(x->>'region'), upper(trim(x->>'market')))
    on conflict (campaign_id, market) do update set region = excluded.region;
  end loop;
end $$;

create or replace function public.campaign_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform public._briefing_require_internal();
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the campaign a name'; end if;
  if v_id is null then
    insert into public.campaigns (name, client, brands, division, brand_tier, objective, campaign_type, activation_objective,
      channels, store_types, p2p_stages, start_date, end_date, status, created_by)
    values (trim(p->>'name'), nullif(trim(p->>'client'), ''), public._text_array(p->'brands'), nullif(trim(p->>'division'), ''),
      nullif(trim(p->>'brand_tier'), ''), nullif(trim(p->>'objective'), ''), nullif(p->>'campaign_type', ''), nullif(p->>'activation_objective', ''),
      public._text_array(p->'channels'), public._text_array(p->'store_types'), public._text_array(p->'p2p_stages'),
      nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date, coalesce(nullif(p->>'status', ''), 'planning'), auth.uid())
    returning id into v_id;
  else
    update public.campaigns set name = trim(p->>'name'), client = nullif(trim(p->>'client'), ''), brands = public._text_array(p->'brands'),
      division = nullif(trim(p->>'division'), ''), brand_tier = nullif(trim(p->>'brand_tier'), ''), objective = nullif(trim(p->>'objective'), ''),
      campaign_type = nullif(p->>'campaign_type', ''), activation_objective = nullif(p->>'activation_objective', ''),
      channels = public._text_array(p->'channels'), store_types = public._text_array(p->'store_types'), p2p_stages = public._text_array(p->'p2p_stages'),
      start_date = nullif(p->>'start_date', '')::date, end_date = nullif(p->>'end_date', '')::date,
      status = coalesce(nullif(p->>'status', ''), status), updated_at = now()
    where id = v_id;
    if not found then raise exception 'Campaign not found'; end if;
  end if;
  if p ? 'markets' then perform public._campaign_set_markets(v_id, p->'markets'); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Brief writes
-- ---------------------------------------------------------------------------
create or replace function public._brief_apply(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Give the brief a title'; end if;
  update public.briefs set
    campaign_id = nullif(p->>'campaign_id', '')::uuid,
    region = nullif(trim(p->>'region'), ''), market = upper(nullif(trim(p->>'market'), '')),
    client = nullif(trim(p->>'client'), ''), brand = nullif(trim(p->>'brand'), ''), division = nullif(trim(p->>'division'), ''),
    title = trim(p->>'title'), objective = nullif(trim(p->>'objective'), ''), brief_text = nullif(trim(p->>'brief_text'), ''),
    target_outlets = nullif(trim(p->>'target_outlets'), ''),
    budget_low = nullif(p->>'budget_low', '')::numeric, budget_high = nullif(p->>'budget_high', '')::numeric,
    currency = coalesce(nullif(trim(p->>'currency'), ''), 'GBP'), target_launch = nullif(p->>'target_launch', '')::date,
    product_category = nullif(trim(p->>'product_category'), ''), sustainability_targets = nullif(trim(p->>'sustainability_targets'), ''),
    min_recycled_pct = nullif(p->>'min_recycled_pct', '')::int, require_fsc = coalesce((p->>'require_fsc')::boolean, false),
    updated_at = now()
  where id = p_id;
end $$;

create or replace function public.brief_create(p jsonb, p_submit boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._briefing_require_internal();
  insert into public.briefs (title, created_by) values (coalesce(nullif(trim(p->>'title'), ''), 'x'), auth.uid()) returning id into v_id;
  perform public._brief_apply(v_id, p);
  perform public._brief_event(v_id, 'created', null, 'draft', nullif(p->>'source', ''));
  if p_submit then perform public.brief_submit(v_id); end if;
  return v_id;
end $$;

-- Edit. Drafts are plain saves; once submitted every change is a numbered revision with a diff and the full prior version.
create or replace function public.brief_update(p_id uuid, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare o public.briefs; n public.briefs; before jsonb; after jsonb; ch jsonb;
begin
  perform public._briefing_require_internal();
  select * into o from public.briefs where id = p_id for update;
  if o.id is null then raise exception 'Brief not found'; end if;
  if o.status not in ('draft','submitted','in_ideation') then raise exception 'A % brief can no longer be edited', replace(o.status, '_', ' '); end if;
  if o.created_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the author (or an admin) can edit this brief' using errcode = '42501'; end if;
  before := public._brief_snapshot(o);
  perform public._brief_apply(p_id, p);
  select * into n from public.briefs where id = p_id;
  after := public._brief_snapshot(n);
  select coalesce(jsonb_agg(jsonb_build_object('field', b->>'field', 'before', b->>'value', 'after', a->>'value') order by i), '[]'::jsonb) into ch
    from jsonb_array_elements(before) with ordinality as x(b, i)
    join jsonb_array_elements(after) with ordinality as y(a, j) on i = j
    where b->>'value' is distinct from a->>'value';
  if o.status <> 'draft' and jsonb_array_length(ch) > 0 then
    update public.briefs set revision_count = revision_count + 1 where id = p_id returning * into n;
    insert into public.brief_revisions (brief_id, version, changes, previous_version, revised_by) values (p_id, n.revision_count, ch, before, auth.uid());
    perform public._brief_event(p_id, 'revised', o.status, o.status, 'v' || n.revision_count);
  end if;
  return n.revision_count;
end $$;

create or replace function public.brief_submit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status <> 'draft' then raise exception 'Only a draft brief can be submitted'; end if;
  if b.created_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the author (or an admin) can submit this brief' using errcode = '42501'; end if;
  if coalesce(trim(b.brief_text), '') = '' and coalesce(trim(b.objective), '') = '' then raise exception 'Add an objective or the brief text before submitting'; end if;
  update public.briefs set status = 'submitted', approval_status = 'pending', submitted_at = now(), updated_at = now() where id = p_id;
  perform public._brief_event(p_id, 'submitted', 'draft', 'submitted', null);
end $$;

-- Manager decision. The approver is never the author. Approve -> in_ideation; request changes -> back to draft.
create or replace function public.brief_decide(p_id uuid, p_decision text, p_comments text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_to text;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status <> 'submitted' or b.approval_status is distinct from 'pending' then raise exception 'This brief is not waiting for approval'; end if;
  if b.created_by = auth.uid() then raise exception 'You cannot approve your own brief: another team member must review it' using errcode = '42501'; end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comments), '') = '' then raise exception 'Say what needs to change'; end if;
  v_to := case when p_decision = 'approved' then 'in_ideation' else 'draft' end;
  update public.briefs set status = v_to, approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
    approval_comments = nullif(trim(p_comments), ''), updated_at = now() where id = p_id;
  insert into public.brief_approvals (brief_id, decision, comments, decided_by) values (p_id, p_decision, nullif(trim(p_comments), ''), auth.uid());
  perform public._brief_event(p_id, p_decision, 'submitted', v_to, nullif(trim(p_comments), ''));
end $$;

create or replace function public.brief_archive(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status in ('archived','spec_created') then raise exception 'This brief is already %', replace(b.status, '_', ' '); end if;
  if b.created_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the author (or an admin) can archive this brief' using errcode = '42501'; end if;
  update public.briefs set status = 'archived', updated_at = now() where id = p_id;
  perform public._brief_event(p_id, 'archived', b.status, 'archived', nullif(trim(p_note), ''));
end $$;

-- Briefs with the campaign name joined (security_invoker so RLS applies to the caller).
create view public.briefs_v with (security_invoker = true) as
  select b.*, c.name as campaign_name, c.campaign_code
  from public.briefs b left join public.campaigns c on c.id = b.campaign_id;

create view public.campaigns_v with (security_invoker = true) as
  select c.*,
    coalesce((select array_agg(m.market order by m.market) from public.campaign_markets m where m.campaign_id = c.id), '{}') as markets,
    coalesce((select array_agg(distinct m.region) from public.campaign_markets m where m.campaign_id = c.id), '{}') as regions,
    (select count(*)::int from public.briefs b where b.campaign_id = c.id) as brief_count
  from public.campaigns c;

revoke execute on function public._briefing_require_internal(), public._brief_event(uuid, text, text, text, text),
  public._brief_snapshot(public.briefs), public._campaign_set_markets(uuid, jsonb), public._brief_apply(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.campaign_save(uuid, jsonb), public.brief_create(jsonb, boolean), public.brief_update(uuid, jsonb),
  public.brief_submit(uuid), public.brief_decide(uuid, text, text), public.brief_archive(uuid, text) to authenticated;
