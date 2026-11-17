-- Creative RFI to panel suppliers, aligned to the Global Business Transformation process "Creative work needed":
--   cr10 supplier input needed?                     -> the supplier route on the brief
--   cr11 prepare the supplier brief, create an RFI for panel suppliers -> creative_rfi_create
--   cr12 the supplier confirms or rejects the RFI   -> vendor_creative_rfi_respond
--   cr12a confirm the IP rule, send the ideation proposal -> vendor_creative_rfi_propose (files attach to the invite)
--   cr12b log the rejection reason, add another supplier  -> the reason is kept; creative_rfi_add_supplier
-- The team then picks one proposal (creative_rfi_select) and presents it through the normal concept approval (cr13).

create table public.creative_rfis (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  supplier_brief text not null check (length(trim(supplier_brief)) >= 10),
  ip_rule text not null check (length(trim(ip_rule)) >= 5),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index creative_rfis_brief_idx on public.creative_rfis (brief_id);

create table public.creative_rfi_invites (
  id uuid primary key default gen_random_uuid(),
  rfi_id uuid not null references public.creative_rfis(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'confirmed', 'rejected', 'proposed', 'selected', 'not_selected')),
  reject_reason text,
  responded_at timestamptz,
  ip_confirmed_at timestamptz,
  ip_confirmed_by uuid references public.profiles(id) on delete set null,
  proposal_note text,
  proposed_at timestamptz,
  selected_note text,
  created_at timestamptz not null default now(),
  unique (rfi_id, supplier_id)
);
create index creative_rfi_invites_supplier_idx on public.creative_rfi_invites (supplier_id);

alter table public.creative_rfis enable row level security;
alter table public.creative_rfi_invites enable row level security;
create policy cr_rfis_read on public.creative_rfis for select to authenticated using (public.is_internal());
create policy cr_invites_read on public.creative_rfi_invites for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.creative_rfis, public.creative_rfi_invites from authenticated, anon;

create or replace function public._creative_started(b public.briefs) returns boolean
language sql stable security definer set search_path = public as $$
  select b.creative_kickoff_at is not null or exists (select 1 from public.brief_creative_quotes q where q.brief_id = b.id and q.po_confirmed_at is not null);
$$;
revoke execute on function public._creative_started(public.briefs) from public, anon, authenticated;

create or replace function public._creative_rfi_invite(p_rfi public.creative_rfis, p_supplier uuid, b public.briefs) returns void
language plpgsql security definer set search_path = public as $$
declare s public.suppliers;
begin
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null or not s.active or s.purchasing_blocked then raise exception 'That supplier is not eligible in SRM'; end if;
  insert into public.creative_rfi_invites (rfi_id, supplier_id) values (p_rfi.id, p_supplier);
  if s.primary_contact_email is not null then
    insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
    values (s.primary_contact_email, 'Creative request for information: ' || p_rfi.title,
      format('You have been invited to respond to a creative request for information (%s). Open your vendor portal to confirm that you can respond and to send your ideation proposal by %s.',
             p_rfi.title, to_char(p_rfi.due_at, 'DD Mon YYYY HH24:MI')), s.id, auth.uid());
  end if;
end $$;
revoke execute on function public._creative_rfi_invite(public.creative_rfis, uuid, public.briefs) from public, anon, authenticated;

-- cr11: the supplier brief and the invited panel suppliers.
create or replace function public.creative_rfi_create(p_brief uuid, p jsonb, p_suppliers jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.briefs; r public.creative_rfis; v_id uuid; v_due timestamptz;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true or b.creative_route is distinct from 'supplier' then
    raise exception 'This brief does not use a supplier for the creative: set the route to supplier first';
  end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot take a creative RFI', replace(b.status, '_', ' '); end if;
  if not public._creative_started(b) then raise exception 'Creative work starts after the kick-off or the confirmed client PO. Record that on the brief first.'; end if;
  if jsonb_typeof(p_suppliers) is distinct from 'array' or jsonb_array_length(p_suppliers) = 0 then raise exception 'Choose at least one panel supplier'; end if;
  v_due := nullif(p->>'due_at', '')::timestamptz;
  if v_due is null or v_due <= now() then raise exception 'Choose a due date in the future'; end if;
  if coalesce(length(trim(p->>'supplier_brief')), 0) < 10 then raise exception 'Write the brief the suppliers will see'; end if;
  insert into public.creative_rfis (brief_id, title, supplier_brief, ip_rule, due_at, created_by)
  values (p_brief, coalesce(nullif(trim(p->>'title'), ''), b.title), trim(p->>'supplier_brief'),
          coalesce(nullif(trim(p->>'ip_rule'), ''), 'All rights in the proposed work pass to us and its client on payment.'), v_due, auth.uid())
  returning * into r;
  v_id := r.id;
  perform public._creative_rfi_invite(r, (x)::uuid, b) from jsonb_array_elements_text(p_suppliers) x;
  perform public._brief_event(p_brief, 'creative_rfi_sent', b.status, b.status, r.title || ' to ' || jsonb_array_length(p_suppliers) || ' supplier(s)');
  return v_id;
end $$;
grant execute on function public.creative_rfi_create(uuid, jsonb, jsonb) to authenticated;

-- cr12b: add another supplier when one rejects.
create or replace function public.creative_rfi_add_supplier(p_rfi uuid, p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.creative_rfis; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into r from public.creative_rfis where id = p_rfi for update;
  if r.id is null then raise exception 'RFI not found'; end if;
  if r.status <> 'open' then raise exception 'This RFI is closed'; end if;
  if exists (select 1 from public.creative_rfi_invites where rfi_id = p_rfi and supplier_id = p_supplier) then raise exception 'That supplier is already on this RFI'; end if;
  select * into b from public.briefs where id = r.brief_id;
  perform public._creative_rfi_invite(r, p_supplier, b);
  perform public._brief_event(r.brief_id, 'creative_rfi_supplier_added', b.status, b.status, (select name from public.suppliers where id = p_supplier));
end $$;
grant execute on function public.creative_rfi_add_supplier(uuid, uuid) to authenticated;

-- Pick the proposal to take forward. It then goes through the normal concept approval.
create or replace function public.creative_rfi_select(p_invite uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.creative_rfi_invites; r public.creative_rfis; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into i from public.creative_rfi_invites where id = p_invite for update;
  if i.id is null then raise exception 'Not found'; end if;
  select * into r from public.creative_rfis where id = i.rfi_id for update;
  if r.status <> 'open' then raise exception 'A proposal has already been selected on this RFI'; end if;
  if i.status <> 'proposed' then raise exception 'Only a proposal that has been sent can be selected'; end if;
  update public.creative_rfi_invites set status = 'selected', selected_note = nullif(trim(p_note), '') where id = p_invite;
  update public.creative_rfi_invites set status = 'not_selected' where rfi_id = r.id and id <> p_invite and status in ('proposed', 'confirmed', 'invited');
  update public.creative_rfis set status = 'closed' where id = r.id;
  select * into b from public.briefs where id = r.brief_id;
  perform public._brief_event(r.brief_id, 'creative_rfi_selected', b.status, b.status, (select name from public.suppliers where id = i.supplier_id));
end $$;
grant execute on function public.creative_rfi_select(uuid, text) to authenticated;

-- Internal view: each RFI with its suppliers, their answers and the proposal files.
create or replace function public.creative_rfis_internal(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'supplier_brief', r.supplier_brief, 'ip_rule', r.ip_rule,
      'due_at', r.due_at, 'status', r.status, 'created_at', r.created_at,
      'invites', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'supplier_id', i.supplier_id, 'supplier_name', s.name, 'status', i.status,
          'reject_reason', i.reject_reason, 'responded_at', i.responded_at, 'ip_confirmed_at', i.ip_confirmed_at, 'proposal_note', i.proposal_note,
          'proposed_at', i.proposed_at, 'selected_note', i.selected_note,
          'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'content_type', f.content_type) order by f.created_at), '[]'::jsonb)
                      from public.files f where f.entity_type = 'creative_rfi_invite' and f.entity_id = i.id::text)) order by s.name), '[]'::jsonb)
                    from public.creative_rfi_invites i join public.suppliers s on s.id = i.supplier_id where i.rfi_id = r.id)
    ) order by r.created_at desc), '[]'::jsonb) from public.creative_rfis r where r.brief_id = p_brief);
end $$;
grant execute on function public.creative_rfis_internal(uuid) to authenticated;

-- Vendor view: only the supplier's own invitations. Never the other suppliers or the client.
create or replace function public.vendor_creative_rfis() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'reject_reason', i.reject_reason, 'ip_confirmed_at', i.ip_confirmed_at,
      'proposal_note', i.proposal_note, 'proposed_at', i.proposed_at, 'title', r.title, 'supplier_brief', r.supplier_brief, 'ip_rule', r.ip_rule,
      'due_at', r.due_at, 'rfi_status', r.status,
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                  from public.files f where f.entity_type = 'creative_rfi_invite' and f.entity_id = i.id::text and f.supplier_id = v_sup))
      order by (i.status in ('invited', 'confirmed')) desc, r.due_at), '[]'::jsonb)
    from public.creative_rfi_invites i join public.creative_rfis r on r.id = i.rfi_id where i.supplier_id = v_sup);
end $$;
grant execute on function public.vendor_creative_rfis() to authenticated;

-- cr12: confirm that you can respond, or reject with the reason.
create or replace function public.vendor_creative_rfi_respond(p_invite uuid, p_confirm boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); i public.creative_rfi_invites; r public.creative_rfis; b public.briefs; s public.suppliers;
begin
  select * into i from public.creative_rfi_invites where id = p_invite and supplier_id = v_sup for update;
  if i.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  select * into r from public.creative_rfis where id = i.rfi_id;
  if r.status <> 'open' then raise exception 'This request is closed'; end if;
  if i.status <> 'invited' then raise exception 'You have already answered this request'; end if;
  if p_confirm is null then raise exception 'Choose whether you can respond'; end if;
  if not p_confirm and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Tell us why you cannot respond'; end if;
  update public.creative_rfi_invites set status = case when p_confirm then 'confirmed' else 'rejected' end, responded_at = now(),
    reject_reason = case when p_confirm then null else trim(p_reason) end where id = p_invite;
  select * into b from public.briefs where id = r.brief_id;
  select * into s from public.suppliers where id = v_sup;
  perform public._brief_event(r.brief_id, case when p_confirm then 'creative_rfi_confirmed' else 'creative_rfi_rejected' end, b.status, b.status,
    s.name || case when p_confirm then '' else ': ' || trim(p_reason) end);
  perform public.notify(r.created_by, 'briefing', s.name || case when p_confirm then ' can respond to ' else ' declined ' end || r.title,
    case when p_confirm then null else left(trim(p_reason), 140) || ' Add another supplier if needed.' end, '/briefing/' || r.brief_id);
end $$;
grant execute on function public.vendor_creative_rfi_respond(uuid, boolean, text) to authenticated;

-- cr12a: confirm the IP rule and send the ideation proposal (files uploaded against the invitation, and/or a note).
create or replace function public.vendor_creative_rfi_propose(p_invite uuid, p_ip_confirmed boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); i public.creative_rfi_invites; r public.creative_rfis; b public.briefs; s public.suppliers; v_files int;
begin
  select * into i from public.creative_rfi_invites where id = p_invite and supplier_id = v_sup for update;
  if i.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  select * into r from public.creative_rfis where id = i.rfi_id;
  if r.status <> 'open' then raise exception 'This request is closed'; end if;
  if i.status not in ('confirmed', 'proposed') then raise exception 'Confirm that you can respond before sending a proposal'; end if;
  if r.due_at <= now() then raise exception 'The due date has passed'; end if;
  if p_ip_confirmed is not true then raise exception 'Confirm that you accept the IP rule before sending the proposal'; end if;
  select count(*) into v_files from public.files where entity_type = 'creative_rfi_invite' and entity_id = i.id::text;
  if v_files = 0 and coalesce(length(trim(p_note)), 0) < 20 then raise exception 'Upload your proposal, or describe it in the note'; end if;
  update public.creative_rfi_invites set status = 'proposed', ip_confirmed_at = now(), ip_confirmed_by = auth.uid(),
    proposal_note = nullif(trim(p_note), ''), proposed_at = now() where id = p_invite;
  select * into b from public.briefs where id = r.brief_id;
  select * into s from public.suppliers where id = v_sup;
  perform public._brief_event(r.brief_id, 'creative_proposal_received', b.status, b.status, s.name);
  perform public.notify(r.created_by, 'briefing', 'Ideation proposal from ' || s.name, r.title, '/briefing/' || r.brief_id);
end $$;
grant execute on function public.vendor_creative_rfi_propose(uuid, boolean, text) to authenticated;
