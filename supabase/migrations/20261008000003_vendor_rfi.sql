-- Vendor information request (RFI) workflow, run from an onboarding ticket:
--   1. SRT sends the request -> vendor gets an email with a single-use registration link
--   2. Vendor registers / signs in and submits company details, certifications, bank details
--   3. Procurement head approves, returns to the vendor with a note, or rejects

-- New role: Procurement head (reviews vendor submissions; gives final onboarding approval).
alter table public.profiles drop constraint profiles_srt_role_check;
alter table public.profiles add constraint profiles_srt_role_check
  check (srt_role in ('agent','lead','finance','procurement','head'));

alter table public.gate_definitions drop constraint gate_definitions_verifier_role_check;
alter table public.gate_definitions add constraint gate_definitions_verifier_role_check
  check (verifier_role in ('srt','finance','quality','category','head'));
update public.gate_definitions set verifier_role = 'head' where key = 'approval';

-- update_supplier_gate: add the Procurement head as verifier for 'head' gates.
create or replace function public.update_supplier_gate(
  p_supplier uuid, p_gate text, p_status text default null, p_expiry date default null,
  p_clear_expiry boolean default false, p_note text default null, p_rejection_reason text default null,
  p_ticket uuid default null
) returns public.supplier_gates
language plpgsql security definer set search_path = public as $$
declare
  d public.gate_definitions%rowtype;
  cur public.supplier_gates%rowtype;
  v_role text := public.my_srt_role();
  v_admin boolean := public.is_admin();
  v_status text; v_expiry date; v_out public.supplier_gates%rowtype;
begin
  if not public.is_internal() then raise exception 'Only internal staff can change onboarding gates' using errcode = '42501'; end if;
  select * into d from public.gate_definitions where key = p_gate;
  if not found then raise exception 'Unknown gate %', p_gate; end if;
  select * into cur from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate for update;
  if not found then raise exception 'Supplier or gate not found'; end if;

  v_status := coalesce(p_status, cur.status);
  v_expiry := case when p_clear_expiry then null when p_expiry is not null then p_expiry else cur.expiry_date end;

  if v_status is distinct from cur.status then
    if v_status in ('verified','rejected') and not v_admin then
      if d.verifier_role = 'finance' and coalesce(v_role,'') <> 'finance' then
        raise exception 'Only Finance can verify or reject "%"', d.label using errcode = '42501';
      elsif d.verifier_role = 'head' and coalesce(v_role,'') <> 'head' then
        raise exception 'Only the Procurement head can verify or reject "%"', d.label using errcode = '42501';
      elsif d.verifier_role not in ('finance','head') and coalesce(v_role,'') not in ('agent','lead') then
        raise exception 'Only SRT agents or leads can verify or reject "%"', d.label using errcode = '42501';
      end if;
    end if;
    if v_status = 'not_required' and not v_admin and coalesce(v_role,'') <> 'lead' then
      raise exception 'Only an SRT lead can mark a gate as not required' using errcode = '42501';
    end if;
    if v_status = 'rejected' and nullif(trim(coalesce(p_rejection_reason,'')), '') is null then
      raise exception 'A rejection needs a reason the vendor can act on';
    end if;
  end if;
  if v_expiry is not null and not d.has_expiry then raise exception '"%" does not take an expiry date', d.label; end if;

  update public.supplier_gates set
    status = v_status,
    expiry_date = v_expiry,
    note = coalesce(p_note, note),
    rejection_reason = case when v_status = 'rejected' then p_rejection_reason else null end,
    verified_by = case when v_status = 'verified' and cur.status <> 'verified' then auth.uid()
                       when v_status <> 'verified' then null else verified_by end,
    verified_at = case when v_status = 'verified' and cur.status <> 'verified' then now()
                       when v_status <> 'verified' then null else verified_at end,
    updated_by = auth.uid(),
    updated_at = now()
  where supplier_id = p_supplier and gate_key = p_gate
  returning * into v_out;

  if v_status is distinct from cur.status or v_expiry is distinct from cur.expiry_date then
    insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, expiry_from, expiry_to, note, ticket_id, actor)
    values (p_supplier, p_gate, cur.status, v_status, cur.expiry_date, v_expiry,
            coalesce(p_rejection_reason, p_note), p_ticket, auth.uid());
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.vendor_rfis (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  ticket_id uuid references public.srt_tickets(id) on delete set null,
  contact_email text not null,
  contact_name text,
  token_hash text not null unique,
  status text not null default 'sent'
    check (status in ('sent','submitted','returned','approved','rejected','cancelled')),
  data jsonb not null default '{}'::jsonb,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);
create index vendor_rfis_supplier_idx on public.vendor_rfis (supplier_id, sent_at desc);
create index vendor_rfis_ticket_idx on public.vendor_rfis (ticket_id);
-- At most one open request per supplier.
create unique index vendor_rfis_one_open on public.vendor_rfis (supplier_id) where status in ('sent','submitted','returned');

-- Bank details live apart from everything else: only Finance, SRT leads, the Procurement head
-- and admins can read them, and vendors can't read them back after submitting.
create table public.vendor_bank_details (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  rfi_id uuid references public.vendor_rfis(id) on delete set null,
  bank_name text,
  account_name text,
  account_number text,
  sort_code_or_swift text,
  iban text,
  bank_country text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now()
);
create index vendor_bank_details_supplier_idx on public.vendor_bank_details (supplier_id, submitted_at desc);

-- Outgoing email. Rows are queued here; a mail sender (Microsoft 365 / SMTP / Resend) delivers them.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  link text,
  ticket_id uuid references public.srt_tickets(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_created_idx on public.email_outbox (created_at desc);

alter table public.vendor_rfis enable row level security;
alter table public.vendor_bank_details enable row level security;
alter table public.email_outbox enable row level security;

create policy rfis_read on public.vendor_rfis for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy bank_read on public.vendor_bank_details for select to authenticated
  using (public.is_admin() or public.my_srt_role() in ('finance','lead','head'));
create policy outbox_read on public.email_outbox for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.vendor_rfis, public.vendor_bank_details, public.email_outbox from authenticated, anon;
-- Vendors never need the token hash.
revoke select on public.vendor_rfis from authenticated;
grant select (id, supplier_id, ticket_id, contact_email, contact_name, status, data, sent_at, expires_at,
              submitted_at, reviewed_at, review_note, sent_by, submitted_by, reviewed_by)
  on public.vendor_rfis to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._token_hash(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

create or replace function public._ticket_event(p_ticket uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.srt_ticket_activity (ticket_id, kind, body, actor)
  select p_ticket, 'event', p_body, auth.uid() where p_ticket is not null;
$$;
revoke all on function public._ticket_event(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Send the information request (SRT agent / lead / procurement / head / admin)
-- Returns the one-time token; only its hash is stored.
-- ---------------------------------------------------------------------------
create or replace function public.send_vendor_rfi(p_ticket uuid, p_email text, p_contact_name text, p_link_base text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.srt_tickets%rowtype;
  v_supplier uuid;
  v_name text;
  v_email text := lower(trim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_rfi uuid;
  v_link text;
  v_existing uuid;
begin
  if not public.is_internal() or (not public.is_admin() and coalesce(public.my_srt_role(), '') not in ('agent','lead','procurement','head')) then
    raise exception 'Only SRT, procurement or admin can send a vendor information request' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid vendor email address'; end if;
  select * into t from public.srt_tickets where id = p_ticket for update;
  if not found then raise exception 'Ticket not found'; end if;

  v_supplier := t.supplier_id;
  if v_supplier is null then
    insert into public.suppliers (name, client, market, primary_contact_email)
    values (t.prospect_name,
            case when t.client in ('Unilever','Heineken','Coloplast','BAU','Other') then t.client end,
            t.market, v_email)
    returning id into v_supplier;
    update public.srt_tickets set supplier_id = v_supplier where id = t.id;
  end if;
  select name into v_name from public.suppliers where id = v_supplier;

  -- Replace any request that is still waiting on the vendor.
  update public.vendor_rfis set status = 'cancelled' where supplier_id = v_supplier and status in ('sent','returned');
  if exists (select 1 from public.vendor_rfis where supplier_id = v_supplier and status = 'submitted') then
    raise exception 'The vendor has already submitted information. Review it before sending a new request.';
  end if;

  insert into public.vendor_rfis (supplier_id, ticket_id, contact_email, contact_name, token_hash, sent_by)
  values (v_supplier, t.id, v_email, nullif(trim(p_contact_name), ''), public._token_hash(v_token), auth.uid())
  returning id into v_rfi;

  -- Let the vendor's login link to this supplier: invite to the team, or link an existing unlinked vendor account.
  insert into public.supplier_team_members (supplier_id, email, permission_level, status, invited_by)
  values (v_supplier, v_email, 'admin', 'pending', auth.uid())
  on conflict (supplier_id, email) do nothing;
  select id into v_existing from public.profiles where lower(email) = v_email and user_type = 'vendor';
  if v_existing is not null then
    update public.profiles set supplier_id = v_supplier where id = v_existing and supplier_id is null;
    update public.supplier_team_members set status = 'active', linked_user_id = v_existing
      where supplier_id = v_supplier and lower(email) = v_email;
  end if;

  update public.suppliers set primary_contact_email = coalesce(primary_contact_email, v_email) where id = v_supplier;
  perform public.update_supplier_gate(v_supplier, 'rfi', 'requested', null, false, 'Information request sent to ' || v_email, null, t.id);
  update public.srt_tickets set status = 'waiting_vendor' where id = t.id;
  perform public._ticket_event(t.id, 'Information request emailed to ' || v_email);

  v_link := rtrim(p_link_base, '/') || '/vendor/register?invite=' || v_token;
  insert into public.email_outbox (to_email, subject, body, link, ticket_id, supplier_id, created_by)
  values (
    v_email,
    'adm Indicia: please register and complete your vendor information',
    format(E'Hello%s,\n\nadm Indicia would like to onboard %s as a vendor. Please register on Assure+ and complete your company information, certifications and bank details using the link below. The link works once and expires in 14 days.\n\n%s\n\nIf you weren''t expecting this, you can ignore this email.\n\nadm Indicia Supplier Team',
           coalesce(' ' || nullif(trim(p_contact_name), ''), ''), v_name, v_link),
    v_link, t.id, v_supplier, auth.uid());

  return jsonb_build_object('rfi_id', v_rfi, 'supplier_id', v_supplier, 'link', v_link);
end $$;

-- ---------------------------------------------------------------------------
-- Public lookup for the registration page (no sign-in yet). Reveals only what the
-- invitee needs to see.
-- ---------------------------------------------------------------------------
create or replace function public.lookup_vendor_invite(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select v.id, v.status, v.expires_at, v.contact_email, s.name as supplier_name
    into r
    from public.vendor_rfis v join public.suppliers s on s.id = v.supplier_id
   where v.token_hash = public._token_hash(p_token);
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if r.status not in ('sent','returned') then return jsonb_build_object('valid', false, 'reason', 'used', 'supplier_name', r.supplier_name); end if;
  if r.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired', 'supplier_name', r.supplier_name); end if;
  return jsonb_build_object('valid', true, 'supplier_name', r.supplier_name, 'email', r.contact_email);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Vendor submits their information
-- ---------------------------------------------------------------------------
create or replace function public.submit_vendor_rfi(p_rfi uuid, p_data jsonb, p_bank jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.vendor_rfis%rowtype;
  v_sup uuid := public.my_supplier_id();
begin
  select * into r from public.vendor_rfis where id = p_rfi for update;
  if not found or v_sup is null or r.supplier_id <> v_sup then
    raise exception 'This information request is not for your company' using errcode = '42501';
  end if;
  if r.status not in ('sent','returned') then raise exception 'This information request has already been submitted'; end if;
  if r.expires_at < now() then raise exception 'This information request has expired. Ask your adm Indicia contact for a new link.'; end if;
  if nullif(trim(p_data->>'legal_name'), '') is null or nullif(trim(p_data->>'registration_number'), '') is null then
    raise exception 'Enter your registered company name and registration number';
  end if;
  if coalesce((p_data->>'declaration')::boolean, false) is not true then
    raise exception 'Confirm the declaration before submitting';
  end if;

  update public.vendor_rfis set status = 'submitted', data = p_data - 'bank', submitted_by = auth.uid(), submitted_at = now()
   where id = r.id;

  if p_bank is not null and nullif(trim(coalesce(p_bank->>'account_number', p_bank->>'iban', '')), '') is not null then
    insert into public.vendor_bank_details (supplier_id, rfi_id, bank_name, account_name, account_number, sort_code_or_swift, iban, bank_country, submitted_by)
    values (r.supplier_id, r.id, p_bank->>'bank_name', p_bank->>'account_name', p_bank->>'account_number',
            p_bank->>'sort_code_or_swift', p_bank->>'iban', p_bank->>'bank_country', auth.uid());
  end if;

  -- Evidence arrives as "received"; vendors can never verify a gate.
  update public.supplier_gates set status = 'received', note = 'Submitted by vendor', updated_by = auth.uid(), updated_at = now()
   where supplier_id = r.supplier_id and gate_key = 'rfi' and status in ('missing','requested','rejected');
  update public.supplier_gates set status = 'received', note = 'Bank details submitted by vendor', updated_by = auth.uid(), updated_at = now()
   where supplier_id = r.supplier_id and gate_key = 'bank' and status in ('missing','requested','rejected')
     and exists (select 1 from public.vendor_bank_details b where b.rfi_id = r.id);
  insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note, ticket_id, actor)
  values (r.supplier_id, 'rfi', null, 'received', 'Vendor submitted information', r.ticket_id, auth.uid());

  update public.srt_tickets set status = 'in_progress' where id = r.ticket_id and status <> 'resolved';
  perform public._ticket_event(r.ticket_id, 'Vendor submitted their information. Waiting for Procurement head review.');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Procurement head reviews: approve / return / reject
-- ---------------------------------------------------------------------------
create or replace function public.review_vendor_rfi(p_rfi uuid, p_decision text, p_note text, p_link_base text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.vendor_rfis%rowtype;
  v_name text;
  v_token text;
  v_link text;
begin
  if not (public.is_admin() or public.my_srt_role() = 'head') then
    raise exception 'Only the Procurement head can review vendor information' using errcode = '42501';
  end if;
  if p_decision not in ('approve','return','reject') then raise exception 'Unknown decision %', p_decision; end if;
  select * into r from public.vendor_rfis where id = p_rfi for update;
  if not found then raise exception 'Information request not found'; end if;
  if r.status <> 'submitted' then raise exception 'Only submitted information can be reviewed'; end if;
  if p_decision in ('return','reject') and nullif(trim(coalesce(p_note,'')), '') is null then
    raise exception 'Add a note explaining what the vendor needs to change';
  end if;
  select name into v_name from public.suppliers where id = r.supplier_id;

  if p_decision = 'approve' then
    update public.vendor_rfis set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
     where id = r.id;
    perform set_config('assure.system_write', 'on', true);
    update public.supplier_gates set status = 'verified', verified_by = auth.uid(), verified_at = now(),
           note = 'Vendor information approved by Procurement head', updated_by = auth.uid(), updated_at = now()
     where supplier_id = r.supplier_id and gate_key in ('request','rfi') and status <> 'verified';
    perform set_config('assure.system_write', 'off', true);
    insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note, ticket_id, actor)
    values (r.supplier_id, 'rfi', 'received', 'verified', 'Approved by Procurement head', r.ticket_id, auth.uid());
    update public.srt_tickets set status = 'in_progress' where id = r.ticket_id and status <> 'resolved';
    perform public._ticket_event(r.ticket_id, 'Procurement head approved the vendor information' || coalesce(': ' || nullif(trim(p_note), ''), ''));

  elsif p_decision = 'return' then
    -- New single-use link so the vendor can correct and resubmit.
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.vendor_rfis set status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note,
           token_hash = public._token_hash(v_token), expires_at = now() + interval '14 days'
     where id = r.id;
    update public.supplier_gates set status = 'requested', note = 'Returned to vendor: ' || p_note, updated_by = auth.uid(), updated_at = now()
     where supplier_id = r.supplier_id and gate_key = 'rfi';
    insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note, ticket_id, actor)
    values (r.supplier_id, 'rfi', 'received', 'requested', 'Returned to vendor: ' || p_note, r.ticket_id, auth.uid());
    update public.srt_tickets set status = 'waiting_vendor' where id = r.ticket_id and status <> 'resolved';
    perform public._ticket_event(r.ticket_id, 'Procurement head returned the information to the vendor: ' || p_note);
    v_link := rtrim(coalesce(p_link_base, ''), '/') || '/vendor/register?invite=' || v_token;
    insert into public.email_outbox (to_email, subject, body, link, ticket_id, supplier_id, created_by)
    values (r.contact_email, 'adm Indicia: please update your vendor information',
            format(E'Hello,\n\nWe reviewed the information submitted for %s and need a few changes:\n\n%s\n\nPlease update and resubmit using this link (expires in 14 days):\n\n%s\n\nadm Indicia Supplier Team', v_name, p_note, v_link),
            v_link, r.ticket_id, r.supplier_id, auth.uid());

  else
    update public.vendor_rfis set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = r.id;
    update public.srt_tickets set status = 'resolved', resolution = 'rejected' where id = r.ticket_id and status <> 'resolved';
    perform public._ticket_event(r.ticket_id, 'Procurement head rejected the vendor: ' || p_note);
  end if;
end $$;

grant execute on function public.send_vendor_rfi(uuid, text, text, text) to authenticated;
grant execute on function public.lookup_vendor_invite(text) to anon, authenticated;
grant execute on function public.submit_vendor_rfi(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.review_vendor_rfi(uuid, text, text, text) to authenticated;
