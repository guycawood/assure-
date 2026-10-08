-- Client Portal + External Reporting (external; clients of adm Indicia).
-- Clients see ONLY their own accounts, and only client-safe columns: never supplier names or costs, margins/markups,
-- benchmarks, NTI, internal notes or other clients' data. Every client read goes through a security definer function
-- below that scopes rows with _client_scope() and builds the output column by column (no row-level grants on internal tables).
--
-- Who is a client user: profiles.user_type = 'client' AND at least one client_users row (granted by an admin through
-- client_access_grant). Internal staff can preview a client's view (read-only) by passing p_client; clients can only pass
-- one of their own accounts.
--
-- CLIENT IDENTITY RULE for Briefing+ / Shopper IQ: campaigns.client and briefs.client are free text. They are resolved to
-- sourcing_clients by _client_match(text): case-insensitive, trimmed, exact match on the client CODE, the client NAME, or
-- the name without a trailing parenthetical (so "Heineken" matches "Heineken (demo)"). Code matches win over name matches.
-- The result is stored in the new nullable campaigns.client_id / briefs.client_id columns (kept in step by triggers when the
-- text changes; a brief with no matching text inherits its campaign's client). client_link_backfill() (admin) re-links rows
-- that were saved before a client existed. Shopper IQ rows belong to a client through their campaign.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.client_users (
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id) on delete cascade,
  role text not null check (role in ('approver','viewer')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create index client_users_client_idx on public.client_users (client_id);

-- Append-only audit of access changes (and link backfills).
create table public.client_access_audit (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.sourcing_clients(id) on delete set null,
  action text not null check (action in ('granted','role_changed','revoked','backfill')),
  role text,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);

-- Append-only: a client's decision on an estimate. Internal staff confirm approvals through estimate_approve().
create table public.client_decisions (
  id bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id),
  decision text not null check (decision in ('approve','decline')),
  comment text,
  client_order_ref text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);
create index client_decisions_estimate_idx on public.client_decisions (estimate_id, decided_at desc);

-- Append-only: client comments on a brief (shown to internal users on the brief page).
create table public.client_comments (
  id bigint generated always as identity primary key,
  brief_id uuid not null references public.briefs(id) on delete cascade,
  client_id uuid not null references public.sourcing_clients(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  author uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_comments_brief_idx on public.client_comments (brief_id, created_at);

-- Updates are never allowed on the append-only tables (deletes only by cascade from the parent record).
create or replace function public.trg_client_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger client_decisions_no_update before update on public.client_decisions for each row execute function public.trg_client_append_only();
create trigger client_comments_no_update before update on public.client_comments for each row execute function public.trg_client_append_only();
create trigger client_access_audit_no_update before update on public.client_access_audit for each row execute function public.trg_client_append_only();

-- ---------------------------------------------------------------------------
-- Client links on campaigns and briefs (nullable FK; resolved from the free-text client)
-- ---------------------------------------------------------------------------
alter table public.campaigns add column client_id uuid references public.sourcing_clients(id) on delete set null;
alter table public.briefs add column client_id uuid references public.sourcing_clients(id) on delete set null;
create index campaigns_client_idx on public.campaigns (client_id);
create index briefs_client_idx on public.briefs (client_id);

create or replace function public._client_match(p_text text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.sourcing_clients c
   where nullif(trim(p_text), '') is not null
     and lower(trim(p_text)) in (lower(c.code), lower(trim(c.name)), lower(trim(regexp_replace(c.name, '\s*\([^)]*\)\s*$', ''))))
   order by (lower(c.code) = lower(trim(p_text))) desc, c.active desc, c.created_at
   limit 1;
$$;

create or replace function public.trg_campaign_client_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.client_id is null then new.client_id := public._client_match(new.client); end if;
  elsif new.client is distinct from old.client and new.client_id is not distinct from old.client_id then
    new.client_id := public._client_match(new.client);
  end if;
  return new;
end $$;
create trigger campaigns_client_link before insert or update on public.campaigns
  for each row execute function public.trg_campaign_client_link();

create or replace function public.trg_brief_client_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.client_id is null)
     or (tg_op = 'UPDATE' and (new.client is distinct from old.client or new.campaign_id is distinct from old.campaign_id)
         and new.client_id is not distinct from old.client_id) then
    new.client_id := coalesce(public._client_match(new.client),
                              (select c.client_id from public.campaigns c where c.id = new.campaign_id));
  end if;
  return new;
end $$;
create trigger briefs_client_link before insert or update on public.briefs
  for each row execute function public.trg_brief_client_link();

-- A client created (or renamed) after the campaign/brief was saved picks up the unlinked rows that match it.
create or replace function public.trg_sourcing_client_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.campaigns set client_id = new.id where client_id is null and public._client_match(client) = new.id;
  update public.briefs b set client_id = new.id
   where b.client_id is null
     and coalesce(public._client_match(b.client), (select c.client_id from public.campaigns c where c.id = b.campaign_id)) = new.id;
  return null;
end $$;
create trigger sourcing_clients_link after insert or update of name, code on public.sourcing_clients
  for each row execute function public.trg_sourcing_client_link();

-- Link rows that already exist.
update public.campaigns set client_id = public._client_match(client) where client_id is null and client is not null;
update public.briefs b set client_id = coalesce(public._client_match(b.client), (select c.client_id from public.campaigns c where c.id = b.campaign_id))
 where b.client_id is null;

create or replace function public.client_link_backfill() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_c int; n_b int; r jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can re-link client records' using errcode = '42501'; end if;
  update public.campaigns set client_id = public._client_match(client)
   where client_id is null and public._client_match(client) is not null;
  get diagnostics n_c = row_count;
  update public.briefs b set client_id = coalesce(public._client_match(b.client), (select c.client_id from public.campaigns c where c.id = b.campaign_id))
   where b.client_id is null
     and coalesce(public._client_match(b.client), (select c.client_id from public.campaigns c where c.id = b.campaign_id)) is not null;
  get diagnostics n_b = row_count;
  r := jsonb_build_object('campaigns_linked', n_c, 'briefs_linked', n_b,
    'campaigns_unmatched', (select count(*) from public.campaigns where client_id is null),
    'briefs_unmatched', (select count(*) from public.briefs where client_id is null));
  insert into public.client_access_audit (action, detail, actor) values ('backfill', r, auth.uid());
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create or replace function public.my_client_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cu.client_id from public.client_users cu join public.profiles p on p.id = cu.user_id
   where cu.user_id = auth.uid() and p.user_type = 'client' and not p.is_admin;
$$;

create or replace function public.my_client_role(p_client uuid) returns text
language sql stable security definer set search_path = public as $$
  select cu.role from public.client_users cu join public.profiles p on p.id = cu.user_id
   where cu.user_id = auth.uid() and cu.client_id = p_client and p.user_type = 'client' and not p.is_admin;
$$;

-- The client accounts a read may cover. Internal: exactly the previewed client (required). Client: their own accounts,
-- or one of them when p_client is given (any other id is refused).
create or replace function public._client_scope(p_client uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if auth.uid() is null then raise exception 'Sign in to see the Client Portal' using errcode = '42501'; end if;
  if public.is_internal() then
    if p_client is null then raise exception 'Choose a client to preview' using errcode = '22023'; end if;
    if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
    return array[p_client];
  end if;
  select coalesce(array_agg(x), '{}') into v from public.my_client_ids() x;
  if p_client is not null then
    if p_client = any (v) then return array[p_client]; end if;
    raise exception 'You do not have access to that account' using errcode = '42501';
  end if;
  return v;
end $$;

-- Callers allowed to act (not preview): a client user with a grant on that client.
create or replace function public._client_actor(p_client uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if public.is_internal() then raise exception 'Preview is read-only: internal staff record client decisions in Order Management+' using errcode = '42501'; end if;
  v_role := public.my_client_role(p_client);
  if v_role is null then raise exception 'Not found' using errcode = '42501'; end if;
  return v_role;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: grant / revoke client access (audited)
-- ---------------------------------------------------------------------------
create or replace function public.client_access_grant(p_user uuid, p_client uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles; c public.sourcing_clients; v_old text;
begin
  if not public.is_admin() then raise exception 'Only admins can change client access' using errcode = '42501'; end if;
  if p_role not in ('approver','viewer') then raise exception 'Choose approver or viewer'; end if;
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'Person not found'; end if;
  if p.is_admin or p.user_type = 'internal' then raise exception 'adm Indicia staff can preview the Client Portal; they can''t be given client access'; end if;
  if p.supplier_id is not null then raise exception 'This person is linked to a vendor company; unlink them in User access first'; end if;
  select * into c from public.sourcing_clients where id = p_client;
  if c.id is null then raise exception 'Client not found'; end if;
  if not c.active then raise exception '% is not an active client', c.name; end if;
  if p.user_type <> 'client' then update public.profiles set user_type = 'client' where id = p_user; end if;
  select role into v_old from public.client_users where user_id = p_user and client_id = p_client;
  insert into public.client_users (user_id, client_id, role, granted_by, granted_at) values (p_user, p_client, p_role, auth.uid(), now())
  on conflict (user_id, client_id) do update set role = excluded.role, granted_by = auth.uid(), granted_at = now();
  insert into public.client_access_audit (user_id, client_id, action, role, detail, actor)
  values (p_user, p_client, case when v_old is null then 'granted' else 'role_changed' end, p_role,
          jsonb_build_object('previous_role', v_old, 'previous_user_type', p.user_type), auth.uid());
  if v_old is null then
    perform public.notify(p_user, 'client', 'You can now see ' || c.name || ' in the Client Portal',
      case when p_role = 'approver' then 'You can review and approve estimates.' else 'You can follow briefs, estimates and orders.' end, '/client-portal');
  end if;
end $$;

create or replace function public.client_access_revoke(p_user uuid, p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'Only admins can change client access' using errcode = '42501'; end if;
  delete from public.client_users where user_id = p_user and client_id = p_client returning role into v_old;
  if v_old is null then raise exception 'That person has no access to this client'; end if;
  insert into public.client_access_audit (user_id, client_id, action, role, actor) values (p_user, p_client, 'revoked', v_old, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Client-facing reads (jsonb; client-safe columns only)
-- ---------------------------------------------------------------------------
create or replace function public.client_portal_accounts(p_client uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'currency', c.default_currency,
    'role', case when public.is_internal() then 'preview' else public.my_client_role(c.id) end) order by c.name), '[]'::jsonb)
  from public.sourcing_clients c where c.id = any (public._client_scope(p_client));
$$;

create or replace function public._client_brief_ids(v uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select b.id from public.briefs b left join public.campaigns cp on cp.id = b.campaign_id
   where coalesce(b.client_id, cp.client_id) = any (v) and b.status <> 'draft';
$$;

create or replace function public.client_portal_summary(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return jsonb_build_object(
    'live_campaigns', (select count(*) from public.campaigns where client_id = any (v) and status = 'live'),
    'open_briefs', (select count(*) from public.briefs where id in (select public._client_brief_ids(v)) and status in ('submitted','in_ideation')),
    'estimates_awaiting', (select count(*) from public.estimates e join public.jobs j on j.id = e.job_id where j.client_id = any (v) and e.status = 'sent'),
    'orders_in_progress', (select count(*) from public.jobs where client_id = any (v) and status in ('ordered','in_production')),
    'spend_ytd', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) order by amount desc), '[]'::jsonb) from (
        select e.currency, sum(e.sell_price) amount from public.estimates e join public.jobs j on j.id = e.job_id
         where j.client_id = any (v) and e.status = 'approved' and e.approved_at >= date_trunc('year', now()) group by e.currency) s),
    'savings_ytd', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) order by amount desc), '[]'::jsonb) from (
        select e.currency, sum(coalesce(e.savings_vs_benchmark, 0)) amount from public.estimates e join public.jobs j on j.id = e.job_id
         where j.client_id = any (v) and e.status = 'approved' and e.approved_at >= date_trunc('year', now()) group by e.currency) s)
  );
end $$;

create or replace function public.client_portal_campaigns(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'campaign_code', c.campaign_code, 'name', c.name, 'client_name', sc.name, 'brands', c.brands,
      'objective', c.objective, 'campaign_type', c.campaign_type, 'activation_objective', c.activation_objective,
      'start_date', c.start_date, 'end_date', c.end_date, 'status', c.status,
      'markets', coalesce((select jsonb_agg(m.market order by m.market) from public.campaign_markets m where m.campaign_id = c.id), '[]'::jsonb),
      'brief_count', (select count(*) from public.briefs b where b.campaign_id = c.id and b.status <> 'draft'))
    order by c.start_date desc nulls last, c.name), '[]'::jsonb)
    from public.campaigns c join public.sourcing_clients sc on sc.id = c.client_id
   where c.client_id = any (v));
end $$;

create or replace function public._client_brief_row(b public.briefs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'brief_code', b.brief_code, 'title', b.title,
    'campaign_name', (select name from public.campaigns where id = b.campaign_id),
    'campaign_code', (select campaign_code from public.campaigns where id = b.campaign_id),
    'client_name', (select sc.name from public.sourcing_clients sc where sc.id = coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id))),
    'region', b.region, 'market', b.market, 'brand', b.brand, 'status', b.status, 'approval_status', b.approval_status,
    'target_launch', b.target_launch, 'submitted_at', b.submitted_at, 'budget_low', b.budget_low, 'budget_high', b.budget_high,
    'currency', b.currency, 'comment_count', (select count(*) from public.client_comments cc where cc.brief_id = b.id));
$$;

create or replace function public.client_portal_briefs(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(public._client_brief_row(b) order by b.submitted_at desc nulls last, b.created_at desc), '[]'::jsonb)
    from public.briefs b where b.id in (select public._client_brief_ids(v)));
end $$;

-- Comments on a brief, with author names (client staff by name; anyone else as "adm Indicia").
create or replace function public._client_comment_rows(p_brief uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', cc.id, 'body', cc.body, 'created_at', cc.created_at,
      'author_name', coalesce(nullif(p.full_name, ''), p.email, 'Client'), 'client_name', sc.name) order by cc.created_at), '[]'::jsonb)
    from public.client_comments cc join public.sourcing_clients sc on sc.id = cc.client_id
    left join public.profiles p on p.id = cc.author
   where cc.brief_id = p_brief;
$$;

create or replace function public.client_portal_brief(p_brief uuid, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); b public.briefs;
begin
  if p_brief not in (select public._client_brief_ids(v)) then return null; end if;
  select * into b from public.briefs where id = p_brief;
  return public._client_brief_row(b) || jsonb_build_object(
    'objective', b.objective, 'brief_text', b.brief_text, 'target_outlets', b.target_outlets, 'product_category', b.product_category,
    'sustainability_targets', b.sustainability_targets, 'min_recycled_pct', b.min_recycled_pct, 'require_fsc', b.require_fsc,
    'client_id', coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id)),
    -- Lifecycle only (no internal notes or names).
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'to_status', e.to_status, 'at', e.at) order by e.at), '[]'::jsonb)
                   from public.brief_events e where e.brief_id = b.id and e.event in ('submitted','approved','changes_requested','archived','handoff_created','spec_created')),
    'comments', public._client_comment_rows(b.id));
end $$;

-- Latest client decision on an estimate since it was (last) sent.
create or replace function public._client_last_decision(p_estimate uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('decision', d.decision, 'comment', d.comment, 'client_order_ref', d.client_order_ref, 'decided_at', d.decided_at,
           'decided_by_name', coalesce(nullif(p.full_name, ''), p.email))
    from public.client_decisions d left join public.profiles p on p.id = d.decided_by
   where d.estimate_id = p_estimate
   order by d.decided_at desc limit 1;
$$;

create or replace function public._client_estimate_row(e public.estimates) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'estimate_number', e.estimate_number, 'job_id', j.id, 'job_number', j.job_number, 'job_title', j.title,
    'brand', j.brand, 'campaign_name', j.campaign_name, 'client_id', j.client_id, 'client_name', sc.name,
    'currency', e.currency, 'sell_price', e.sell_price, 'status', e.status, 'sent_at', e.sent_at, 'approved_at', e.approved_at,
    'client_order_ref', e.client_order_ref, 'declined_reason', e.declined_reason, 'region', e.region, 'market', e.market,
    'role', case when public.is_internal() then 'preview' else public.my_client_role(j.client_id) end,
    'decision', public._client_last_decision(e.id))
  from public.jobs j join public.sourcing_clients sc on sc.id = j.client_id where j.id = e.job_id;
$$;

create or replace function public.client_portal_estimates(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(public._client_estimate_row(e) order by (e.status = 'sent') desc, coalesce(e.sent_at, e.created_at) desc), '[]'::jsonb)
    from public.estimates e join public.jobs j on j.id = e.job_id
   where j.client_id = any (v) and e.status in ('sent','approved','declined'));
end $$;

create or replace function public.client_portal_estimate(p_estimate uuid, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); e public.estimates;
begin
  select e2.* into e from public.estimates e2 join public.jobs j on j.id = e2.job_id
   where e2.id = p_estimate and j.client_id = any (v) and e2.status in ('sent','approved','declined');
  if e.id is null then return null; end if;
  return public._client_estimate_row(e) || jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('spec_no', s.spec_no, 'title', s.title, 'spec_type', s.spec_type, 'description', s.description,
                'quantity', x.quantity, 'unit_sell', x.unit_sell, 'line_sell', round(x.unit_sell * x.quantity, 2)) order by s.spec_no), '[]'::jsonb)
              from (select el.spec_id, el.quantity,
                      round(case when e.pricing_mode = 'margin' then el.unit_cost / (1 - e.pricing_percent / 100) else el.unit_cost * (1 + e.pricing_percent / 100) end, 4) unit_sell
                      from public.estimate_lines el where el.estimate_id = e.id) x
              join public.job_specs s on s.id = x.spec_id),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('decision', d.decision, 'comment', d.comment, 'client_order_ref', d.client_order_ref,
                    'decided_at', d.decided_at, 'decided_by_name', coalesce(nullif(p.full_name, ''), p.email)) order by d.decided_at desc), '[]'::jsonb)
                  from public.client_decisions d left join public.profiles p on p.id = d.decided_by where d.estimate_id = e.id));
end $$;

-- Orders: jobs that have an approved estimate or have reached production. Supplier POs show status and dates only
-- (no supplier, no value). Milestone dates drive the progress timeline.
create or replace function public.client_portal_orders(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'job_number', j.job_number, 'title', j.title, 'brand', j.brand, 'campaign_name', j.campaign_name, 'client_name', sc.name,
      'client_job_ref', j.client_job_ref, 'region', j.region, 'market', j.market, 'status', j.status,
      'opened_date', j.opened_date, 'target_delivery_date', j.target_delivery_date, 'closed_at', j.closed_at,
      'estimates', (select coalesce(jsonb_agg(jsonb_build_object('estimate_number', e.estimate_number, 'currency', e.currency, 'sell_price', e.sell_price,
                      'approved_at', e.approved_at, 'client_order_ref', e.client_order_ref) order by e.approved_at), '[]'::jsonb)
                    from public.estimates e where e.job_id = j.id and e.status = 'approved'),
      'orders', (select coalesce(jsonb_agg(jsonb_build_object('po_number', p.po_number, 'status', p.status, 'po_date', p.po_date,
                   'delivery_date', p.delivery_date, 'placed_at', p.approved_at, 'accepted_at', p.vendor_responded_at) order by p.po_date), '[]'::jsonb)
                 from public.purchase_orders p where p.job_id = j.id and p.status in ('pending_approval','issued','accepted')),
      'milestones', jsonb_build_object(
        'estimate_approved', (select min(e.approved_at) from public.estimates e where e.job_id = j.id and e.status = 'approved'),
        'order_placed', (select min(p.approved_at) from public.purchase_orders p where p.job_id = j.id and p.status in ('issued','accepted')),
        'in_production', coalesce((select min(p.vendor_responded_at) from public.purchase_orders p where p.job_id = j.id and p.status = 'accepted'),
                                  (select min(se.at) from public.sourcing_events se where se.job_id = j.id and se.event = 'status_changed' and se.detail->>'to' = 'in_production')),
        'delivered', (select max(se.at) from public.sourcing_events se where se.job_id = j.id and se.event = 'status_changed' and se.detail->>'to' = 'delivered'),
        'closed', case when j.status = 'closed' then j.closed_at end))
    order by (j.status in ('ordered','in_production')) desc, j.target_delivery_date nulls last), '[]'::jsonb)
    from public.jobs j join public.sourcing_clients sc on sc.id = j.client_id
   where j.client_id = any (v) and j.status <> 'cancelled'
     and (j.status in ('ordered','in_production','delivered','closed')
          or exists (select 1 from public.estimates e where e.job_id = j.id and e.status = 'approved')));
end $$;

create or replace function public.client_portal_effectiveness(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'campaign_id', c.id, 'campaign_name', c.name, 'campaign_code', c.campaign_code,
      'region', e.region, 'market', e.market, 'touchpoint', tp.name, 'p2p_stage', st.name, 'channel', e.channel,
      'period_start', e.period_start, 'period_end', e.period_end, 'spend', e.spend, 'currency', e.currency, 'units', e.units,
      'execution_score', e.execution_score, 'uplift_pct', e.uplift_pct, 'uplift_source', e.uplift_source)
      order by c.name, e.market, tp.name), '[]'::jsonb)
    from public.siq_effectiveness e join public.campaigns c on c.id = e.campaign_id
    join public.library_records tp on tp.id = e.touchpoint_id left join public.library_records st on st.id = e.p2p_stage_id
   where c.client_id = any (v));
end $$;

-- External reporting: spend and savings (sell price, approved estimates) by month and market, sustainability (spec CO2e on
-- approved estimates) and effectiveness by touchpoint (Shopper IQ).
create or replace function public.client_portal_report(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); v_sus jsonb;
begin
  with x2 as (
    select s.id, s.market, max(s.co2e_total_kg) co2e, sum(el.quantity) qty
      from public.estimate_lines el join public.estimates e on e.id = el.estimate_id join public.jobs j on j.id = e.job_id
      join public.job_specs s on s.id = el.spec_id
     where j.client_id = any (v) and e.status = 'approved'
     group by s.id, s.market
  )
  select jsonb_build_object('specs', count(*), 'specs_with_co2e', count(*) filter (where co2e is not null),
      'co2e_kg', coalesce(round(sum(co2e), 1), 0), 'units', coalesce(sum(qty), 0),
      'by_market', coalesce((select jsonb_agg(jsonb_build_object('market', mk, 'co2e_kg', kg, 'specs', n) order by kg desc)
                               from (select market mk, round(sum(co2e), 1) kg, count(*) n from x2 where co2e is not null group by market) y), '[]'::jsonb))
    into v_sus from x2;
  return jsonb_build_object(
    'sustainability', v_sus,
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'currency', currency, 'spend', spend, 'savings', savings, 'estimates', n) order by m, currency), '[]'::jsonb)
      from (select to_char(date_trunc('month', e.approved_at), 'YYYY-MM') m, e.currency, sum(e.sell_price) spend, sum(coalesce(e.savings_vs_benchmark, 0)) savings, count(*) n
              from public.estimates e join public.jobs j on j.id = e.job_id
             where j.client_id = any (v) and e.status = 'approved' and e.approved_at >= date_trunc('month', now()) - interval '11 months'
             group by 1, 2) s),
    'by_market', (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'market', market, 'currency', currency, 'spend', spend, 'savings', savings, 'estimates', n) order by spend desc), '[]'::jsonb)
      from (select e.region, e.market, e.currency, sum(e.sell_price) spend, sum(coalesce(e.savings_vs_benchmark, 0)) savings, count(*) n
              from public.estimates e join public.jobs j on j.id = e.job_id
             where j.client_id = any (v) and e.status = 'approved' group by 1, 2, 3) s),
    'effectiveness', (select coalesce(jsonb_agg(jsonb_build_object('touchpoint', tp, 'rows', n, 'avg_execution', ex, 'avg_uplift', up, 'measured', measured) order by ex desc nulls last), '[]'::jsonb)
      from (select tp.name tp, count(*) n, round(avg(e.execution_score), 1) ex, round(avg(e.uplift_pct) filter (where e.uplift_source <> 'not_measured'), 1) up,
                   count(*) filter (where e.uplift_source <> 'not_measured') measured
              from public.siq_effectiveness e join public.campaigns c on c.id = e.campaign_id join public.library_records tp on tp.id = e.touchpoint_id
             where c.client_id = any (v) group by tp.name) s)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Client actions
-- ---------------------------------------------------------------------------
-- Records the client's decision (append-only), audits it on the job and tells the job manager. It does NOT approve the
-- estimate: estimate_approve() requires an internal caller (it hands off to Stocktool), so internal staff confirm the
-- client's approval there. Only approvers may decide; viewers are refused.
create or replace function public.client_estimate_decide(p_estimate uuid, p_approve boolean, p_comment text default null, p_client_order_ref text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; v_role text; v_id bigint; v_name text;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found' using errcode = '42501'; end if;
  select * into j from public.jobs where id = e.job_id;
  v_role := public._client_actor(j.client_id);
  if e.status not in ('sent','approved','declined') then raise exception 'Estimate not found' using errcode = '42501'; end if;
  if v_role <> 'approver' then raise exception 'Only approvers can approve or decline estimates; ask your approver' using errcode = '42501'; end if;
  if e.status <> 'sent' then raise exception 'This estimate is already %', e.status; end if;
  if exists (select 1 from public.client_decisions where estimate_id = e.id and decided_at >= coalesce(e.sent_at, e.created_at)) then
    raise exception 'Your decision on this estimate is already with adm Indicia';
  end if;
  if p_approve is null then raise exception 'Choose approve or decline'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Tell us why you are declining'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  insert into public.client_decisions (estimate_id, client_id, decision, comment, client_order_ref, decided_by)
  values (e.id, j.client_id, case when p_approve then 'approve' else 'decline' end, nullif(trim(p_comment), ''), nullif(trim(p_client_order_ref), ''), auth.uid())
  returning id into v_id;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public._sourcing_event(e.job_id, 'estimate', e.id, case when p_approve then 'client_approved' else 'client_declined' end,
    jsonb_build_object('decision_id', v_id, 'comment', nullif(trim(p_comment), ''), 'client_order_ref', nullif(trim(p_client_order_ref), ''), 'by', v_name, 'via', 'client_portal'));
  perform public.notify(u, 'orders',
      format('%s %s estimate %s', v_name, case when p_approve then 'approved' else 'declined' end, e.estimate_number),
      case when p_approve then 'Confirm the approval in Order Management+ to hand it off.' else coalesce(nullif(trim(p_comment), ''), 'Declined in the Client Portal.') end,
      '/orders/estimates/' || e.id)
    from (select distinct u from unnest(array[j.manager, e.created_by]) u where u is not null) m;
  return v_id;
end $$;

create or replace function public.client_brief_comment(p_brief uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_client uuid; v_id bigint; v_name text;
begin
  select * into b from public.briefs where id = p_brief;
  if b.id is null or b.status = 'draft' then raise exception 'Brief not found' using errcode = '42501'; end if;
  v_client := coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id));
  if v_client is null then raise exception 'Brief not found' using errcode = '42501'; end if;
  perform public._client_actor(v_client);
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a comment first'; end if;
  if length(p_body) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  insert into public.client_comments (brief_id, client_id, body, author) values (b.id, v_client, trim(p_body), auth.uid()) returning id into v_id;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public.notify(b.created_by, 'briefing', format('%s commented on %s', v_name, b.brief_code), left(trim(p_body), 140), '/briefing/' || b.id);
  return v_id;
end $$;

-- For the internal brief page: client comments on a brief (internal only).
create or replace function public.client_comments_for_brief(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal users only' using errcode = '42501'; end if;
  return public._client_comment_rows(p_brief);
end $$;

-- For the Watchtower client-access page (internal read; admins change it).
create or replace function public.client_access_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal users only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name, 'user_type', p.user_type,
                 'client_id', c.id, 'client_name', c.name, 'client_code', c.code, 'role', cu.role, 'granted_at', cu.granted_at,
                 'granted_by_name', coalesce(nullif(g.full_name, ''), g.email)) order by c.name, p.email), '[]'::jsonb)
               from public.client_users cu join public.profiles p on p.id = cu.user_id join public.sourcing_clients c on c.id = cu.client_id
               left join public.profiles g on g.id = cu.granted_by),
    -- People who could be given client access: external, not linked to a vendor.
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name, 'user_type', p.user_type) order by p.email), '[]'::jsonb)
                   from public.profiles p where not p.is_admin and p.user_type in ('client','vendor') and p.supplier_id is null),
    'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) order by name), '[]'::jsonb) from public.sourcing_clients where active),
    'audit', (select coalesce(jsonb_agg(x order by (x->>'at') desc), '[]'::jsonb) from (
               select jsonb_build_object('action', a.action, 'role', a.role, 'at', a.at, 'detail', a.detail,
                 'user_email', u.email, 'client_name', c.name, 'actor_name', coalesce(nullif(ac.full_name, ''), ac.email)) x
                 from public.client_access_audit a left join public.profiles u on u.id = a.user_id left join public.sourcing_clients c on c.id = a.client_id
                 left join public.profiles ac on ac.id = a.actor order by a.at desc limit 50) t)
  );
end $$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.client_users enable row level security;
alter table public.client_access_audit enable row level security;
alter table public.client_decisions enable row level security;
alter table public.client_comments enable row level security;

create policy cu_read on public.client_users for select to authenticated using (user_id = auth.uid() or public.is_internal());
create policy caa_read on public.client_access_audit for select to authenticated using (public.is_admin());
create policy cd_read on public.client_decisions for select to authenticated
  using (public.is_internal() or client_id in (select public.my_client_ids()));
create policy cc_read on public.client_comments for select to authenticated
  using (public.is_internal() or client_id in (select public.my_client_ids()));

revoke insert, update, delete on public.client_users, public.client_access_audit, public.client_decisions, public.client_comments from authenticated, anon;

revoke execute on function public._client_match(text), public._client_scope(uuid), public._client_actor(uuid), public._client_brief_ids(uuid[]),
  public._client_brief_row(public.briefs), public._client_comment_rows(uuid), public._client_last_decision(uuid),
  public._client_estimate_row(public.estimates), public.trg_client_append_only(), public.trg_campaign_client_link(), public.trg_brief_client_link(),
  public.trg_sourcing_client_link()
  from public, anon, authenticated;
grant execute on function public.my_client_ids(), public.my_client_role(uuid), public.client_access_grant(uuid, uuid, text),
  public.client_access_revoke(uuid, uuid), public.client_link_backfill(), public.client_portal_accounts(uuid), public.client_portal_summary(uuid),
  public.client_portal_campaigns(uuid), public.client_portal_briefs(uuid), public.client_portal_brief(uuid, uuid),
  public.client_portal_estimates(uuid), public.client_portal_estimate(uuid, uuid), public.client_portal_orders(uuid),
  public.client_portal_effectiveness(uuid), public.client_portal_report(uuid), public.client_estimate_decide(uuid, boolean, text, text),
  public.client_brief_comment(uuid, text), public.client_comments_for_brief(uuid), public.client_access_overview() to authenticated;
