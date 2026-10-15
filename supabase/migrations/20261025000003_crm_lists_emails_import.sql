-- CRM stage 2 (3 of 3): lists, email sends with tracking, unsubscribes, the HubSpot import and the send approval.
--   * Lists: static (picked contacts, or staff for internal comms) and dynamic (filters on contact fields). External lists are
--     client contacts; internal lists are adm Indicia staff.
--   * Email sends: a list + a template, queued into email_outbox. Every external recipient is checked on every send: no
--     email, left, opted out, no legal basis or consent basis without consent -> excluded, with the reason kept.
--     Each external email carries an unsubscribe link (/u/<token>) that opts the contact out.
--   * email_events: delivered / open / click / bounce / unsubscribe per recipient. No email provider is connected yet, so
--     crm_email_simulate_events() fills demo opens and clicks (flagged simulated) to show "who has read this".
--   * Send approval (approval type CRM_SEND, policy-driven): more than the CRM_SEND policy's min_value recipients, or any
--     external list when a CRM_SEND_EXTERNAL policy exists, waits for a CRM owner; approval sends it.
--   * HubSpot import (admin only): companies, contacts, deals and the Client Stakeholder Performance object, already mapped
--     to CRM fields by the app. Dry run reports what would happen (duplicates by HubSpot ID, email, company name / domain)
--     and writes nothing; apply is all-or-nothing and logged in crm_import_logs. hubspot_id is kept on every row.

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------
create table public.crm_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  kind text not null check (kind in ('static','dynamic')),
  audience text not null check (audience in ('external','internal')),
  filters jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.crm_lists(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  check ((contact_id is null) <> (profile_id is null)),
  unique (list_id, contact_id),
  unique (list_id, profile_id)
);

create or replace function public.crm_list_save(p_id uuid, p_name text, p_description text, p_kind text, p_audience text, p_filters jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.crm_lists; v_id uuid; k text;
begin
  perform public._crm_require();
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the list a name'; end if;
  if p_kind not in ('static','dynamic') then raise exception 'Choose static or dynamic'; end if;
  if p_audience not in ('external','internal') then raise exception 'Choose client contacts or staff'; end if;
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then raise exception 'Filters could not be read'; end if;
  for k in select jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) loop
    if k not in ('client_id','department','relationship_rag','influence_level','decision_level','quadrant','market','owner','owner_role','decision_role','receive_survey','all_staff') then
      raise exception 'Unknown filter %', k;
    end if;
  end loop;
  if p_id is not null then
    select * into l from public.crm_lists where id = p_id for update;
    if l.id is null then raise exception 'List not found'; end if;
    if l.audience <> p_audience and exists (select 1 from public.crm_list_members where list_id = p_id) then raise exception 'Empty the list before changing its audience'; end if;
    update public.crm_lists set name = trim(p_name), description = nullif(trim(p_description), ''), kind = p_kind, audience = p_audience,
      filters = coalesce(p_filters, '{}'::jsonb), updated_at = now() where id = p_id;
    v_id := p_id;
  else
    insert into public.crm_lists (name, description, kind, audience, filters, created_by)
    values (trim(p_name), nullif(trim(p_description), ''), p_kind, p_audience, coalesce(p_filters, '{}'::jsonb), auth.uid()) returning id into v_id;
  end if;
  perform public._crm_event(nullif(p_filters->>'client_id', '')::uuid, 'list', v_id::text, case when p_id is null then 'created' else 'updated' end,
    jsonb_build_object('name', trim(p_name), 'kind', p_kind, 'audience', p_audience, 'filters', p_filters));
  return v_id;
end $$;

create or replace function public.crm_list_add(p_list uuid, p_contacts uuid[] default null, p_profiles uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare l public.crm_lists; n int := 0; m int;
begin
  perform public._crm_require();
  select * into l from public.crm_lists where id = p_list;
  if l.id is null then raise exception 'List not found'; end if;
  if l.kind <> 'static' then raise exception 'Dynamic lists are worked out from their filters'; end if;
  if l.audience = 'external' then
    if coalesce(cardinality(p_profiles), 0) > 0 then raise exception 'This list is for client contacts'; end if;
    insert into public.crm_list_members (list_id, contact_id, added_by) select p_list, x, auth.uid() from unnest(coalesce(p_contacts, '{}')) x
      where exists (select 1 from public.crm_contacts where id = x) on conflict do nothing;
  else
    if coalesce(cardinality(p_contacts), 0) > 0 then raise exception 'This list is for adm Indicia staff'; end if;
    insert into public.crm_list_members (list_id, profile_id, added_by) select p_list, x, auth.uid() from unnest(coalesce(p_profiles, '{}')) x
      where exists (select 1 from public.profiles where id = x and (is_admin or user_type = 'internal')) on conflict do nothing;
  end if;
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;

create or replace function public.crm_list_remove(p_list uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._crm_require();
  delete from public.crm_list_members where list_id = p_list and (contact_id = p_member or profile_id = p_member);
end $$;

-- Who a list reaches right now, and why anyone is left out (block). Internal only.
create or replace function public.crm_list_audience(p_list uuid)
returns table (contact_id uuid, profile_id uuid, email text, full_name text, client_name text, owner uuid, block text)
language plpgsql stable security definer set search_path = public as $$
declare l public.crm_lists; f jsonb;
begin
  perform public._crm_require();
  select * into l from public.crm_lists where id = p_list;
  if l.id is null then raise exception 'List not found'; end if;
  f := l.filters;
  if l.audience = 'internal' then
    return query select null::uuid, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'adm Indicia'::text, null::uuid,
                        case when p.email is null then 'No email address' end
      from public.profiles p
     where (p.is_admin or p.user_type = 'internal')
       and ((l.kind = 'static' and exists (select 1 from public.crm_list_members m where m.list_id = l.id and m.profile_id = p.id))
            or (l.kind = 'dynamic' and coalesce((f->>'all_staff')::boolean, false)));
    return;
  end if;
  return query select ct.id, null::uuid, ct.email, ct.full_name, c.name, ct.owner, public.crm_contact_send_block(ct)
    from public.crm_contacts ct join public.sourcing_clients c on c.id = ct.client_id
   where case when l.kind = 'static' then exists (select 1 from public.crm_list_members m where m.list_id = l.id and m.contact_id = ct.id)
         else (f->>'client_id' is null or ct.client_id = (f->>'client_id')::uuid)
          and (f->>'department' is null or ct.department = f->>'department')
          and (f->>'relationship_rag' is null or ct.relationship_rag = f->>'relationship_rag')
          and (f->>'influence_level' is null or ct.influence_level = f->>'influence_level')
          and (f->>'decision_level' is null or ct.decision_level = f->>'decision_level')
          and (f->>'quadrant' is null or public.crm_stakeholder_quadrant(ct.influence_level, ct.decision_level) = f->>'quadrant')
          and (f->>'market' is null or ct.market = f->>'market')
          and (f->>'owner' is null or ct.owner = (f->>'owner')::uuid)
          and (f->>'owner_role' is null or exists (select 1 from public.library_records r where r.id = ct.owner_role_id and r.code = f->>'owner_role'))
          and (f->>'decision_role' is null or ct.decision_role = f->>'decision_role')
          and (f->>'receive_survey' is null or ct.receive_survey = (f->>'receive_survey')::boolean)
          and ct.left_at is null end
   order by c.name, ct.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- Email sends and events
-- ---------------------------------------------------------------------------
create table public.crm_emails (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  list_id uuid not null references public.crm_lists(id),
  template_id uuid references public.library_records(id),
  subject text not null check (length(trim(subject)) > 0),
  body text not null check (length(trim(body)) > 0),
  link text,
  status text not null default 'draft' check (status in ('draft','sent')),
  recipient_count int not null default 0,
  excluded_count int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null
);

create table public.crm_email_recipients (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.crm_emails(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  email text,
  full_name text,
  token text not null unique default public._crm_token(),
  status text not null check (status in ('sent','excluded')),
  excluded_reason text,
  sent_at timestamptz,
  unsubscribed_at timestamptz
);
create index crm_email_recipients_email_idx on public.crm_email_recipients (email_id);

create table public.email_events (
  id bigint generated always as identity primary key,
  email_id uuid references public.crm_emails(id) on delete cascade,
  recipient_id uuid references public.crm_email_recipients(id) on delete cascade,
  event text not null check (event in ('delivered','open','click','bounce','unsubscribe')),
  url text,
  simulated boolean not null default false,
  at timestamptz not null default now()
);
create index email_events_recipient_idx on public.email_events (recipient_id, event);
create trigger email_events_no_update before update on public.email_events for each row execute function public.trg_client_append_only();

create or replace function public.crm_email_save(p_id uuid, p_name text, p_list uuid, p_template uuid, p_subject text, p_body text, p_link text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.library_records; v_id uuid;
begin
  perform public._crm_require();
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the email a name'; end if;
  if not exists (select 1 from public.crm_lists where id = p_list) then raise exception 'Choose a list'; end if;
  if p_template is not null then
    select * into t from public.library_records where id = p_template and library_key = 'crm_email_templates' and status = 'active';
    if t.id is null then raise exception 'Choose an active email template'; end if;
  end if;
  if coalesce(trim(coalesce(p_subject, t.data->>'subject')), '') = '' or coalesce(trim(coalesce(p_body, t.data->>'body')), '') = '' then
    raise exception 'Write a subject and a message, or choose a template';
  end if;
  if p_id is null then
    insert into public.crm_emails (name, list_id, template_id, subject, body, link, created_by)
    values (trim(p_name), p_list, p_template, coalesce(nullif(trim(p_subject), ''), t.data->>'subject'), coalesce(nullif(trim(p_body), ''), t.data->>'body'),
            nullif(trim(p_link), ''), auth.uid())
    returning id into v_id;
  else
    update public.crm_emails set name = trim(p_name), list_id = p_list, template_id = p_template, subject = coalesce(nullif(trim(p_subject), ''), t.data->>'subject', subject),
      body = coalesce(nullif(trim(p_body), ''), t.data->>'body', body), link = nullif(trim(p_link), '')
     where id = p_id and status = 'draft' returning id into v_id;
    if v_id is null then raise exception 'Only a draft email can be changed'; end if;
  end if;
  perform public._crm_event(null, 'email', v_id::text, case when p_id is null then 'created' else 'updated' end, jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.crm_email_send(p_email uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e public.crm_emails; l public.crm_lists; r record; v_ok int; v_ex int; v_id uuid; v_token text; v_vars jsonb; v_sender text;
begin
  perform public._crm_require();
  select * into e from public.crm_emails where id = p_email for update;
  if e.id is null then raise exception 'Email not found'; end if;
  if e.status <> 'draft' then raise exception 'This email has already been sent'; end if;
  select * into l from public.crm_lists where id = e.list_id;
  select count(*) filter (where a.block is null), count(*) filter (where a.block is not null) into v_ok, v_ex from public.crm_list_audience(l.id) a;
  if v_ok = 0 then raise exception 'Nobody on this list can be emailed (% excluded)', v_ex; end if;
  if not public._approval_applying('CRM_SEND', p_email::text) and public._crm_send_needs_approval(v_ok, l.audience = 'external') then
    perform public._approval_request_open('crm', 'CRM_SEND', 'email', p_email::text, null, 'Send email: ' || e.name,
      jsonb_build_object('kind', 'email'), null, v_ok, null, null, null, null, '/crm/emails/' || p_email, 'module_owner', 'crm', 'requester', '{}'::uuid[],
      v_ok || ' recipients on ' || l.name || ' (' || l.audience || '), ' || v_ex || ' excluded');
    return 'pending';
  end if;
  select coalesce(nullif(full_name, ''), email) into v_sender from public.profiles where id = auth.uid();
  for r in select a.*, coalesce(nullif(op.full_name, ''), op.email) as owner_name from public.crm_list_audience(l.id) a left join public.profiles op on op.id = a.owner loop
    insert into public.crm_email_recipients (email_id, contact_id, profile_id, email, full_name, status, excluded_reason, sent_at)
    values (p_email, r.contact_id, r.profile_id, r.email, r.full_name, case when r.block is null then 'sent' else 'excluded' end, r.block,
            case when r.block is null then now() end)
    returning id, token into v_id, v_token;
    if r.block is null then
      v_vars := jsonb_build_object('first_name', public._crm_first_name(r.full_name), 'owner_name', coalesce(r.owner_name, v_sender), 'client_name', r.client_name,
        'link', coalesce(e.link, ''), 'unsubscribe', case when l.audience = 'external' then '/u/' || v_token else '' end);
      insert into public.email_outbox (to_email, subject, body, link, created_by, source, source_id)
      values (r.email, public._crm_render(e.subject, v_vars), public._crm_render(e.body, v_vars), e.link, auth.uid(), 'crm_email', v_id);
    end if;
  end loop;
  update public.crm_emails set status = 'sent', sent_at = now(), sent_by = auth.uid(), recipient_count = v_ok, excluded_count = v_ex where id = p_email;
  perform public._crm_event(null, 'email', p_email::text, 'sent', jsonb_build_object('recipients', v_ok, 'excluded', v_ex, 'list', l.name));
  return 'sent';
end $$;

-- Demo only (no provider connected): delivered for every recipient, opens for about 60% and clicks for about 25%.
create or replace function public.crm_email_simulate_events(p_email uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e public.crm_emails; n int;
begin
  perform public._crm_require();
  select * into e from public.crm_emails where id = p_email;
  if e.id is null or e.status <> 'sent' then raise exception 'Send the email first'; end if;
  if exists (select 1 from public.email_events where email_id = p_email and simulated) then raise exception 'Demo events have already been added to this email'; end if;
  insert into public.email_events (email_id, recipient_id, event, url, simulated, at)
  select p_email, r.id, x.ev, case when x.ev = 'click' then e.link end, true, r.sent_at + make_interval(mins => x.mins + (abs(hashtext(r.id::text)) % 600))
    from public.crm_email_recipients r
    cross join lateral (values ('delivered', 1, true),
                               ('open', 30, abs(hashtext(r.id::text || 'o')) % 100 < 60),
                               ('click', 45, abs(hashtext(r.id::text || 'o')) % 100 < 25)) x(ev, mins, keep)
   where r.email_id = p_email and r.status = 'sent' and x.keep;
  get diagnostics n = row_count;
  perform public._crm_event(null, 'email', p_email::text, 'demo_events_added', jsonb_build_object('events', n));
  return n;
end $$;

-- Public unsubscribe (/u/<token>): works for email sends, survey invitations and post-job surveys. Opts the contact out.
create or replace function public.public_unsubscribe(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_contact uuid; v_rec uuid; v_email uuid; ct public.crm_contacts;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false); end if;
  select id, contact_id, email_id into v_rec, v_contact, v_email from public.crm_email_recipients where token = p_token;
  if v_rec is null then select contact_id into v_contact from public.crm_survey_recipients where token = p_token; end if;
  if v_contact is null then select contact_id into v_contact from public.crm_job_surveys where token = p_token; end if;
  if v_contact is null then
    if v_rec is not null then return jsonb_build_object('ok', true, 'email', null, 'internal', true); end if;
    return jsonb_build_object('ok', false);
  end if;
  select * into ct from public.crm_contacts where id = v_contact for update;
  if not ct.email_opt_out then
    update public.crm_contacts set email_opt_out = true, opted_out_at = now() where id = v_contact;
    insert into public.crm_events (client_id, entity_type, entity_id, action, detail) values (ct.client_id, 'contact', ct.id::text, 'unsubscribed', jsonb_build_object('via', 'link'));
  end if;
  if v_rec is not null then
    update public.crm_email_recipients set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = v_rec;
    insert into public.email_events (email_id, recipient_id, event) values (v_email, v_rec, 'unsubscribe');
  end if;
  return jsonb_build_object('ok', true, 'email', regexp_replace(ct.email, '^(.).*(@.*)$', '\1***\2'));
end $$;

-- ---------------------------------------------------------------------------
-- HubSpot import
-- ---------------------------------------------------------------------------
create table public.crm_import_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('companies','contacts','deals','performance')),
  file_name text,
  mapping jsonb not null default '{}'::jsonb,
  row_count int not null,
  created_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  duplicates jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  on_duplicate text not null default 'skip',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public._crm_hubspot_stage(p text) returns text
language sql immutable as $$
  select case lower(trim(coalesce(p, '')))
    when 'appointmentscheduled' then 'lead' when 'lead' then 'lead' when 'qualifiedtobuy' then 'qualified' when 'qualified' then 'qualified'
    when 'presentationscheduled' then 'proposal' when 'proposal' then 'proposal' when 'decisionmakerboughtin' then 'negotiation'
    when 'contractsent' then 'negotiation' when 'negotiation' then 'negotiation' when 'closedwon' then 'won' when 'won' then 'won'
    when 'closed won' then 'won' when 'closedlost' then 'lost' when 'lost' then 'lost' when 'closed lost' then 'lost' else null end;
$$;

-- Client by HubSpot company ID, name (also without a trailing "(...)") or email/website domain.
create or replace function public._crm_import_client(p_hubspot text, p_name text, p_domain text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.sourcing_clients where nullif(trim(p_hubspot), '') is not null and hubspot_id = trim(p_hubspot)),
    public._client_match(p_name),
    (select id from public.sourcing_clients where nullif(trim(p_domain), '') is not null and lower(domain) = lower(trim(p_domain)) order by created_at limit 1));
$$;

create or replace function public._crm_import_person(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where nullif(trim(p_email), '') is not null and lower(email) = lower(trim(p_email)) and (is_admin or user_type = 'internal') limit 1;
$$;

-- p_rows: array of objects with CRM field names (the app maps HubSpot headers first). Returns a report; dry run writes nothing.
create or replace function public.crm_import(p_kind text, p_rows jsonb, p_dry_run boolean default true, p_file_name text default null,
  p_mapping jsonb default '{}'::jsonb, p_on_duplicate text default 'skip') returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; i int := 0; v_dups jsonb := '[]'; v_errs jsonb := '[]'; v_warn jsonb := '[]'; n_new int := 0; n_upd int := 0; n_skip int := 0;
  v_client uuid; v_match uuid; v_reason text; v_email text; v_name text; v_code text; v_seen text[] := '{}'; v_key text; v_stage text; v_contact uuid;
  v_service uuid; v_log uuid; v_domain text; v_owner uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can import into CRM' using errcode = '42501'; end if;
  if p_kind not in ('companies','contacts','deals','performance') then raise exception 'Choose companies, contacts, deals or performance'; end if;
  if p_on_duplicate not in ('skip','update') then raise exception 'Duplicates are skipped or updated'; end if;
  if jsonb_typeof(coalesce(p_rows, 'null')) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The file has no rows'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_match := null; v_reason := null;
    begin
      if p_kind = 'companies' then
        v_name := nullif(trim(x->>'name'), '');
        if v_name is null then raise exception 'Company name is missing'; end if;
        v_domain := lower(nullif(regexp_replace(trim(coalesce(x->>'domain', '')), '^(https?://)?(www\.)?([^/]+).*$', '\3'), ''));
        v_key := lower(v_name);
        if v_key = any (v_seen) then raise exception 'The same company appears twice in the file'; end if;
        v_seen := v_seen || v_key;
        select id, case when hubspot_id = x->>'hubspot_id' then 'HubSpot ID' when lower(name) = v_key then 'company name' else 'domain' end into v_match, v_reason
          from public.sourcing_clients
         where (nullif(x->>'hubspot_id', '') is not null and hubspot_id = x->>'hubspot_id') or lower(name) = v_key
            or lower(regexp_replace(name, '\s*\([^)]*\)\s*$', '')) = v_key or (v_domain is not null and lower(domain) = v_domain)
         order by (hubspot_id = x->>'hubspot_id') desc nulls last limit 1;
        if v_match is null then
          n_new := n_new + 1;
          if not p_dry_run then
            v_code := upper(left(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g'), 6));
            if v_code = '' then v_code := 'CL'; end if;
            while exists (select 1 from public.sourcing_clients where code = v_code) loop v_code := left(v_code, 6) || (floor(random() * 90) + 10)::int; end loop;
            insert into public.sourcing_clients (code, name, default_currency, hq_market, sector, domain, hubspot_id)
            values (v_code, v_name, coalesce(nullif(upper(trim(x->>'currency')), ''), 'EUR'), public._market_code(nullif(x->>'market', '')),
                    nullif(trim(x->>'sector'), ''), v_domain, nullif(trim(x->>'hubspot_id'), ''));
          end if;
        else
          v_dups := v_dups || jsonb_build_object('row', i, 'reason', v_reason, 'match', (select name from public.sourcing_clients where id = v_match));
          if p_on_duplicate = 'update' then
            n_upd := n_upd + 1;
            if not p_dry_run then
              update public.sourcing_clients set hubspot_id = coalesce(hubspot_id, nullif(trim(x->>'hubspot_id'), '')), domain = coalesce(domain, v_domain),
                sector = coalesce(sector, nullif(trim(x->>'sector'), '')) where id = v_match;
            end if;
          else n_skip := n_skip + 1; end if;
        end if;

      elsif p_kind = 'contacts' then
        v_email := lower(nullif(trim(x->>'email'), ''));
        if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email % is not valid', v_email; end if;
        v_name := coalesce(nullif(trim(x->>'full_name'), ''), nullif(trim(coalesce(x->>'first_name', '') || ' ' || coalesce(x->>'last_name', '')), ''));
        if v_name is null then raise exception 'Contact name is missing'; end if;
        v_client := public._crm_import_client(x->>'company_hubspot_id', x->>'company', split_part(v_email, '@', 2));
        if v_client is null then raise exception 'Company "%" is not in CRM; import companies first', coalesce(x->>'company', '?'); end if;
        if coalesce(x->>'legal_basis', '') <> '' and x->>'legal_basis' not in ('legitimate_interest_existing','legitimate_interest_prospect','consent','contract','none') then
          raise exception 'Legal basis % is not recognised', x->>'legal_basis';
        end if;
        v_key := coalesce(v_email, lower(v_name) || '@' || v_client);
        if v_key = any (v_seen) then raise exception 'The same contact appears twice in the file'; end if;
        v_seen := v_seen || v_key;
        select id, case when hubspot_id = x->>'hubspot_id' then 'HubSpot ID' else 'email' end into v_match, v_reason from public.crm_contacts
         where (nullif(x->>'hubspot_id', '') is not null and hubspot_id = x->>'hubspot_id') or (v_email is not null and lower(email) = v_email)
         order by (hubspot_id = x->>'hubspot_id') desc nulls last limit 1;
        v_owner := public._crm_import_person(x->>'owner_email');
        if nullif(x->>'owner_email', '') is not null and v_owner is null then v_warn := v_warn || jsonb_build_object('row', i, 'message', 'Owner ' || (x->>'owner_email') || ' is not a staff user; left empty'); end if;
        if v_match is null then
          n_new := n_new + 1;
          if not p_dry_run then
            insert into public.crm_contacts (client_id, full_name, job_title, email, phone, market, owner, department, receive_survey, legal_basis, email_opt_out, opted_out_at, hubspot_id)
            values (v_client, v_name, nullif(trim(x->>'job_title'), ''), v_email, nullif(trim(x->>'phone'), ''), public._market_code(nullif(x->>'market', '')), v_owner,
                    case when lower(x->>'department') in ('marketing','procurement') then lower(x->>'department') when nullif(x->>'department', '') is not null then 'other' end,
                    lower(coalesce(x->>'receive_survey', '')) in ('true','yes','1'), coalesce(nullif(x->>'legal_basis', ''), 'legitimate_interest_existing'),
                    lower(coalesce(x->>'email_opt_out', '')) in ('true','yes','1'), case when lower(coalesce(x->>'email_opt_out', '')) in ('true','yes','1') then now() end,
                    nullif(trim(x->>'hubspot_id'), ''));
          end if;
        else
          v_dups := v_dups || jsonb_build_object('row', i, 'reason', v_reason, 'match', (select full_name || coalesce(' <' || email || '>', '') from public.crm_contacts where id = v_match));
          if p_on_duplicate = 'update' then
            n_upd := n_upd + 1;
            if not p_dry_run then
              -- Opt-outs carry across; an import never opts anyone back in.
              update public.crm_contacts set hubspot_id = coalesce(hubspot_id, nullif(trim(x->>'hubspot_id'), '')), job_title = coalesce(nullif(trim(x->>'job_title'), ''), job_title),
                phone = coalesce(nullif(trim(x->>'phone'), ''), phone), owner = coalesce(owner, v_owner),
                email_opt_out = email_opt_out or lower(coalesce(x->>'email_opt_out', '')) in ('true','yes','1'),
                opted_out_at = case when not email_opt_out and lower(coalesce(x->>'email_opt_out', '')) in ('true','yes','1') then now() else opted_out_at end
               where id = v_match;
            end if;
          else n_skip := n_skip + 1; end if;
        end if;

      else  -- deals and performance become opportunities
        v_name := nullif(trim(x->>'title'), '');
        if v_name is null then raise exception 'Deal name is missing'; end if;
        v_client := public._crm_import_client(x->>'company_hubspot_id', x->>'company', null);
        v_contact := null; v_service := null;
        if p_kind = 'performance' then
          select id, client_id into v_contact, v_client from public.crm_contacts where lower(email) = lower(nullif(trim(x->>'contact_email'), '')) order by created_at limit 1;
          if v_contact is null then raise exception 'Contact % is not in CRM; import contacts first', coalesce(x->>'contact_email', '?'); end if;
          if nullif(trim(x->>'service'), '') is not null then
            select id into v_service from public.library_records where library_key = 'crm_services' and status = 'active'
               and (lower(name) = lower(trim(x->>'service')) or lower(code) = lower(trim(x->>'service'))) limit 1;
            if v_service is null then raise exception 'Service "%" is not in the services library', x->>'service'; end if;
          end if;
        end if;
        if v_client is null then raise exception 'Company "%" is not in CRM; import companies first', coalesce(x->>'company', '?'); end if;
        v_stage := coalesce(public._crm_hubspot_stage(x->>'stage'), case when nullif(x->>'stage', '') is null then 'lead' end);
        if v_stage is null then raise exception 'Stage "%" is not recognised', x->>'stage'; end if;
        if nullif(x->>'amount', '') is not null and (x->>'amount') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Amount % is not a number', x->>'amount'; end if;
        if nullif(x->>'probability', '') is not null and (x->>'probability') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'Probability % is not a number', x->>'probability'; end if;
        v_key := coalesce(nullif(x->>'hubspot_id', ''), v_client::text || lower(v_name));
        if v_key = any (v_seen) then raise exception 'The same deal appears twice in the file'; end if;
        v_seen := v_seen || v_key;
        select id, case when hubspot_id = x->>'hubspot_id' then 'HubSpot ID' else 'same client and name' end into v_match, v_reason from public.crm_opportunities
         where (nullif(x->>'hubspot_id', '') is not null and hubspot_id = x->>'hubspot_id') or (client_id = v_client and lower(title) = lower(v_name))
         order by (hubspot_id = x->>'hubspot_id') desc nulls last limit 1;
        if v_match is null then
          n_new := n_new + 1;
          if not p_dry_run then
            insert into public.crm_opportunities (client_id, title, stage, value, currency, probability, expected_close, owner, contact_id, service_id, next_steps,
              cs_lead, sme, won_at, lost_at, hubspot_id, created_by)
            values (v_client, v_name, v_stage, coalesce(nullif(x->>'amount', '')::numeric, 0),
              coalesce(nullif(upper(trim(x->>'currency')), ''), (select default_currency from public.sourcing_clients where id = v_client)),
              least(100, greatest(0, coalesce(round(nullif(x->>'probability', '')::numeric * case when nullif(x->>'probability', '')::numeric <= 1 then 100 else 1 end)::int,
                public.crm_stage_probability(v_stage)))),
              nullif(left(x->>'close_date', 10), '')::date, public._crm_import_person(x->>'owner_email'), v_contact, v_service, nullif(trim(x->>'next_steps'), ''),
              public._crm_import_person(x->>'cs_lead_email'), public._crm_import_person(x->>'sme_email'),
              case when v_stage = 'won' then now() end, case when v_stage = 'lost' then now() end, nullif(trim(x->>'hubspot_id'), ''), auth.uid());
          end if;
        else
          v_dups := v_dups || jsonb_build_object('row', i, 'reason', v_reason, 'match', (select title from public.crm_opportunities where id = v_match));
          if p_on_duplicate = 'update' then
            n_upd := n_upd + 1;
            if not p_dry_run then
              update public.crm_opportunities set hubspot_id = coalesce(hubspot_id, nullif(trim(x->>'hubspot_id'), '')), next_steps = coalesce(nullif(trim(x->>'next_steps'), ''), next_steps),
                contact_id = coalesce(contact_id, v_contact), service_id = coalesce(service_id, v_service) where id = v_match;
            end if;
          else n_skip := n_skip + 1; end if;
        end if;
      end if;
    exception when others then
      v_errs := v_errs || jsonb_build_object('row', i, 'message', sqlerrm);
    end;
  end loop;
  if not p_dry_run then
    -- All or nothing: any row error aborts the whole import (the transaction rolls back every row written above).
    if jsonb_array_length(v_errs) > 0 then
      raise exception 'Nothing was imported: % row(s) have errors (first: row %, %)', jsonb_array_length(v_errs), v_errs->0->>'row', v_errs->0->>'message';
    end if;
    insert into public.crm_import_logs (kind, file_name, mapping, row_count, created_count, updated_count, skipped_count, duplicates, warnings, on_duplicate, created_by)
    values (p_kind, nullif(trim(p_file_name), ''), coalesce(p_mapping, '{}'::jsonb), i, n_new, n_upd, n_skip, v_dups, v_warn, p_on_duplicate, auth.uid())
    returning id into v_log;
    perform public._crm_event(null, 'import', v_log::text, 'applied', jsonb_build_object('kind', p_kind, 'rows', i, 'created', n_new, 'updated', n_upd, 'skipped', n_skip));
  end if;
  return jsonb_build_object('kind', p_kind, 'rows', i, 'create', n_new, 'update', n_upd, 'skip', n_skip, 'duplicates', v_dups, 'errors', v_errs,
    'warnings', v_warn, 'applied', not p_dry_run, 'log_id', v_log);
end $$;

-- ---------------------------------------------------------------------------
-- Approved CRM requests: CRM_SEND added (the stage 1 types are unchanged)
-- ---------------------------------------------------------------------------
create or replace function public._crm_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := current_setting('request.jwt.claim.sub', true); p jsonb := r.payload; c public.sourcing_clients;
begin
  if r.run_as = 'requester' then
    if r.requested_by is null then raise exception 'The person who asked no longer exists, so this can''t be applied'; end if;
    perform set_config('request.jwt.claim.sub', r.requested_by::text, true);
  end if;
  case r.approval_type
    when 'CRM_CLIENT_SETUP' then
      perform set_config('crm.system_write', 'on', true);
      update public.sourcing_clients set crm_setup_status = 'approved', setup_approved_by = r.decided_by, setup_approved_at = now()
       where id = r.entity_id::uuid returning * into c;
      perform set_config('crm.system_write', 'off', true);
      insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
      values (c.id, 'client', c.id::text, 'setup_approved', jsonb_build_object('request', r.request_no, 'note', r.decision_note), r.decided_by);
    when 'CRM_TERMS' then
      perform set_config('crm.system_write', 'on', true);
      update public.sourcing_clients set default_markup_percent = (p->>'markup')::numeric, gsc_commission_percent = (p->>'commission')::numeric,
        year_end_rebate_percent = (p->>'rebate')::numeric, payment_terms_days = nullif(p->>'payment_terms_days', '')::int
       where id = r.entity_id::uuid returning * into c;
      perform set_config('crm.system_write', 'off', true);
      if nullif(p->>'contract_id', '') is not null then
        update public.crm_contracts set markup_percent = (p->>'markup')::numeric, gsc_commission_percent = (p->>'commission')::numeric,
          rebate_percent = (p->>'rebate')::numeric, payment_terms_days = nullif(p->>'payment_terms_days', '')::int, updated_at = now()
         where id = (p->>'contract_id')::uuid and client_id = c.id;
      end if;
      insert into public.crm_events (client_id, entity_type, entity_id, action, detail, actor)
      values (c.id, 'client', c.id::text, 'terms_changed', p || jsonb_build_object('request', r.request_no, 'requested_by', r.requested_by), r.decided_by);
    when 'CRM_CONTRACT' then
      if p->>'action' = 'renew' then
        perform public.crm_contract_renew(r.entity_id::uuid, (p->>'end_date')::date, nullif(p->>'value', '')::numeric, nullif(p->>'renewal_date', '')::date, p->>'note');
      else
        perform public.crm_contract_sign(r.entity_id::uuid, p->>'note');
      end if;
    when 'CRM_OPP_WON' then
      perform public.crm_opportunity_move(r.entity_id::uuid, 'won', p->>'note', null);
    when 'CRM_SEND' then
      if p->>'kind' = 'survey_wave' then perform public.crm_survey_wave_send(r.entity_id::uuid);
      else perform public.crm_email_send(r.entity_id::uuid); end if;
    else raise exception 'Unknown approval type %', r.approval_type;
  end case;
  if r.run_as = 'requester' then perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
create view public.crm_lists_v with (security_invoker = true) as
  select l.*, coalesce(nullif(p.full_name, ''), p.email) as created_by_name, c.name as client_name,
         (select count(*) from public.crm_list_members m where m.list_id = l.id)::int as static_members,
         (select count(*) from public.crm_emails e where e.list_id = l.id)::int as emails
    from public.crm_lists l left join public.profiles p on p.id = l.created_by
    left join public.sourcing_clients c on c.id = nullif(l.filters->>'client_id', '')::uuid;

create view public.crm_emails_v with (security_invoker = true) as
  select e.*, l.name as list_name, l.audience, coalesce(nullif(p.full_name, ''), p.email) as created_by_name,
         (select count(distinct ev.recipient_id) from public.email_events ev where ev.email_id = e.id and ev.event = 'delivered')::int as delivered,
         (select count(distinct ev.recipient_id) from public.email_events ev where ev.email_id = e.id and ev.event = 'open')::int as opened,
         (select count(distinct ev.recipient_id) from public.email_events ev where ev.email_id = e.id and ev.event = 'click')::int as clicked,
         (select count(*) from public.email_events ev where ev.email_id = e.id and ev.event = 'unsubscribe')::int as unsubscribed,
         exists (select 1 from public.email_events ev where ev.email_id = e.id and ev.simulated) as simulated,
         exists (select 1 from public.approval_requests ar where ar.approval_type = 'CRM_SEND' and ar.entity_id = e.id::text and ar.status = 'pending') as approval_pending
    from public.crm_emails e join public.crm_lists l on l.id = e.list_id left join public.profiles p on p.id = e.created_by;

-- "Who has read this": one row per recipient with their first open and clicks.
create view public.crm_email_recipients_v with (security_invoker = true) as
  select r.*, c.name as client_name,
         (select min(ev.at) from public.email_events ev where ev.recipient_id = r.id and ev.event = 'open') as first_opened_at,
         (select count(*) from public.email_events ev where ev.recipient_id = r.id and ev.event = 'open')::int as opens,
         (select count(*) from public.email_events ev where ev.recipient_id = r.id and ev.event = 'click')::int as clicks
    from public.crm_email_recipients r left join public.crm_contacts ct on ct.id = r.contact_id left join public.sourcing_clients c on c.id = ct.client_id;

create view public.crm_import_logs_v with (security_invoker = true) as
  select l.*, coalesce(nullif(p.full_name, ''), p.email) as created_by_name from public.crm_import_logs l left join public.profiles p on p.id = l.created_by;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.crm_lists enable row level security;
alter table public.crm_list_members enable row level security;
alter table public.crm_emails enable row level security;
alter table public.crm_email_recipients enable row level security;
alter table public.email_events enable row level security;
alter table public.crm_import_logs enable row level security;
create policy crm_lists_read on public.crm_lists for select to authenticated using (public.is_internal());
create policy crm_list_members_read on public.crm_list_members for select to authenticated using (public.is_internal());
create policy crm_emails_read on public.crm_emails for select to authenticated using (public.is_internal());
create policy crm_email_recipients_read on public.crm_email_recipients for select to authenticated using (public.is_internal());
create policy email_events_read on public.email_events for select to authenticated using (public.is_internal());
create policy crm_import_logs_read on public.crm_import_logs for select to authenticated using (public.is_internal());
revoke all on public.crm_lists, public.crm_list_members, public.crm_emails, public.crm_email_recipients, public.email_events, public.crm_import_logs,
  public.crm_lists_v, public.crm_emails_v, public.crm_email_recipients_v, public.crm_import_logs_v from anon;
revoke insert, update, delete on public.crm_lists, public.crm_list_members, public.crm_emails, public.crm_email_recipients, public.email_events, public.crm_import_logs,
  public.crm_lists_v, public.crm_emails_v, public.crm_email_recipients_v, public.crm_import_logs_v from authenticated;

revoke execute on function public._crm_hubspot_stage(text), public._crm_import_client(text, text, text), public._crm_import_person(text) from public, anon, authenticated;
revoke execute on function public.crm_list_save(uuid, text, text, text, text, jsonb), public.crm_list_add(uuid, uuid[], uuid[]), public.crm_list_remove(uuid, uuid),
  public.crm_list_audience(uuid), public.crm_email_save(uuid, text, uuid, uuid, text, text, text), public.crm_email_send(uuid), public.crm_email_simulate_events(uuid),
  public.crm_import(text, jsonb, boolean, text, jsonb, text), public.public_unsubscribe(text) from public, anon;
grant execute on function public.crm_list_save(uuid, text, text, text, text, jsonb), public.crm_list_add(uuid, uuid[], uuid[]), public.crm_list_remove(uuid, uuid),
  public.crm_list_audience(uuid), public.crm_email_save(uuid, text, uuid, uuid, text, text, text), public.crm_email_send(uuid), public.crm_email_simulate_events(uuid),
  public.crm_import(text, jsonb, boolean, text, jsonb, text) to authenticated;
grant execute on function public.public_unsubscribe(text) to anon, authenticated;
