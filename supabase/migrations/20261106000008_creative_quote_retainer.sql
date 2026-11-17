-- Creative work commercials, aligned to the Global Business Transformation process "Creative work needed":
--   cr3  is the client on a retainer?            -> a flag on the client in CRM
--   cr4  retainer: kick off and start with no quote -> creative_kickoff
--   cr5  otherwise choose the quoting basis and produce the creative quote -> creative_quote_save / creative_quote_send
--   cr6  client approves or rejects the quote     -> client_creative_quote_decide
--   cr9  rejection reason is logged and the project manager is told
--   cr7  confirm the quote approval and the client PO on the system -> creative_quote_confirm_po
-- Creative work (cr8) then starts: concepts on the brief cannot be submitted until the kick-off or the PO is on record.

alter table public.sourcing_clients
  add column on_retainer boolean not null default false,
  add column retainer_note text;

alter table public.briefs
  add column creative_kickoff_at timestamptz,
  add column creative_kickoff_by uuid references public.profiles(id) on delete set null,
  add column creative_kickoff_note text;

create table public.brief_creative_quotes (
  brief_id uuid primary key references public.briefs(id) on delete cascade,
  basis text not null check (basis in ('fixed', 'hourly', 'daily')),
  rate numeric(12,2) check (rate is null or rate > 0),
  units numeric(10,2) check (units is null or units > 0),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'EUR' check (length(currency) = 3),
  scope_note text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected')),
  version int not null default 1,
  sent_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  reject_reason text,
  client_po_number text,
  po_confirmed_by uuid references public.profiles(id) on delete set null,
  po_confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (basis = 'fixed' or (rate is not null and units is not null))
);
alter table public.brief_creative_quotes enable row level security;
create policy bcq_read on public.brief_creative_quotes for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.brief_creative_quotes from authenticated, anon;

create or replace function public._brief_client(b public.briefs) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id));
$$;
revoke execute on function public._brief_client(public.briefs) from public, anon, authenticated;

-- cr3: the retainer flag. CRM staff, with a reason, logged in the CRM audit trail.
create or replace function public.crm_client_set_retainer(p_client uuid, p_on boolean, p_note text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients;
begin
  perform public._crm_require();
  select * into c from public.sourcing_clients where id = p_client for update;
  if c.id is null then raise exception 'Client not found'; end if;
  if p_on is null then raise exception 'Say whether the client is on a retainer'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why (for example the retainer agreement or contract)'; end if;
  update public.sourcing_clients set on_retainer = p_on, retainer_note = nullif(trim(p_note), '') where id = p_client;
  perform public._crm_event(p_client, 'client', p_client::text, 'retainer_changed',
    jsonb_build_object('from', c.on_retainer, 'to', p_on, 'note', nullif(trim(p_note), ''), 'reason', trim(p_reason)));
end $$;
grant execute on function public.crm_client_set_retainer(uuid, boolean, text, text) to authenticated;

-- cr4: a retainer client starts with no quote. Someone internal records the kick-off.
create or replace function public.creative_kickoff(p_brief uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_client uuid;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true then raise exception 'This brief is not marked as needing creative input'; end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot be kicked off', replace(b.status, '_', ' '); end if;
  v_client := public._brief_client(b);
  if v_client is null or not coalesce((select on_retainer from public.sourcing_clients where id = v_client), false) then
    raise exception 'The client is not on a retainer, so a creative quote is needed first';
  end if;
  if b.creative_kickoff_at is not null then raise exception 'This brief has already been kicked off'; end if;
  update public.briefs set creative_kickoff_at = now(), creative_kickoff_by = auth.uid(), creative_kickoff_note = nullif(trim(p_note), ''), updated_at = now() where id = p_brief;
  perform public._brief_event(p_brief, 'creative_kickoff', b.status, b.status, 'Retainer: started without a quote' || coalesce(': ' || nullif(trim(p_note), ''), ''));
end $$;
grant execute on function public.creative_kickoff(uuid, text) to authenticated;

-- cr5: write the quote. The basis is fixed fee, hourly or daily rate; rate times units gives the amount for the last two.
create or replace function public.creative_quote_save(p_brief uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; q public.brief_creative_quotes; v_client uuid; v_basis text; v_rate numeric; v_units numeric; v_amount numeric; v_cur text;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true then raise exception 'This brief is not marked as needing creative input'; end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot be quoted', replace(b.status, '_', ' '); end if;
  v_client := public._brief_client(b);
  if v_client is not null and coalesce((select on_retainer from public.sourcing_clients where id = v_client), false) then
    raise exception 'The client is on a retainer: kick the brief off instead of quoting';
  end if;
  select * into q from public.brief_creative_quotes where brief_id = p_brief for update;
  if q.brief_id is not null and q.status in ('sent', 'approved') then raise exception 'The quote is already % and can no longer be changed', q.status; end if;
  v_basis := p->>'basis';
  if v_basis not in ('fixed', 'hourly', 'daily') then raise exception 'Choose the quoting basis: fixed fee, hourly or daily rate'; end if;
  v_cur := upper(coalesce(nullif(trim(p->>'currency'), ''), 'EUR'));
  if length(v_cur) <> 3 then raise exception 'Use a three-letter currency code'; end if;
  if v_basis = 'fixed' then
    v_amount := nullif(p->>'amount', '')::numeric; v_rate := null; v_units := null;
  else
    v_rate := nullif(p->>'rate', '')::numeric; v_units := nullif(p->>'units', '')::numeric;
    if v_rate is null or v_rate <= 0 or v_units is null or v_units <= 0 then raise exception 'Give the rate and the number of % for this quote', case v_basis when 'hourly' then 'hours' else 'days' end; end if;
    v_amount := round(v_rate * v_units, 2);
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Give the amount of the quote'; end if;
  insert into public.brief_creative_quotes (brief_id, basis, rate, units, amount, currency, scope_note, status, version, created_by, updated_at)
  values (p_brief, v_basis, v_rate, v_units, v_amount, v_cur, nullif(trim(p->>'scope_note'), ''), 'draft', 1, auth.uid(), now())
  on conflict (brief_id) do update set basis = excluded.basis, rate = excluded.rate, units = excluded.units, amount = excluded.amount, currency = excluded.currency,
    scope_note = excluded.scope_note, status = 'draft', version = public.brief_creative_quotes.version + 1,
    reject_reason = null, decided_by = null, decided_at = null, updated_at = now();
  perform public._brief_event(p_brief, 'creative_quote_saved', b.status, b.status, v_cur || ' ' || v_amount || ' (' || v_basis || ')');
end $$;
grant execute on function public.creative_quote_save(uuid, jsonb) to authenticated;

create or replace function public.creative_quote_send(p_brief uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; q public.brief_creative_quotes; v_client uuid;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  select * into q from public.brief_creative_quotes where brief_id = p_brief for update;
  if b.id is null or q.brief_id is null then raise exception 'Write the quote first'; end if;
  if q.status <> 'draft' then raise exception 'The quote is already %', q.status; end if;
  v_client := public._brief_client(b);
  if v_client is null then raise exception 'This brief has no client to send the quote to'; end if;
  update public.brief_creative_quotes set status = 'sent', sent_at = now(), updated_at = now() where brief_id = p_brief;
  perform public._brief_event(p_brief, 'creative_quote_sent', b.status, b.status, q.currency || ' ' || q.amount);
  perform public.notify(cu.user_id, 'client', 'Creative quote for your approval: ' || b.title,
    'We have sent a creative quote of ' || q.currency || ' ' || to_char(q.amount, 'FM999,999,990.00') || '.', '/client-portal/briefs/' || b.id)
    from public.client_users cu where cu.client_id = v_client and cu.role = 'approver';
end $$;
grant execute on function public.creative_quote_send(uuid) to authenticated;

-- What the client sees of the quote.
create or replace function public.client_creative_quote(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.briefs; q public.brief_creative_quotes; v_client uuid;
begin
  select * into b from public.briefs where id = p_brief;
  if b.id is null then return null; end if;
  v_client := public._brief_client(b);
  if v_client is null or public.my_client_role(v_client) is null then return null; end if;
  select * into q from public.brief_creative_quotes where brief_id = p_brief and status <> 'draft';
  if q.brief_id is null then return null; end if;
  return jsonb_build_object('basis', q.basis, 'rate', q.rate, 'units', q.units, 'amount', q.amount, 'currency', q.currency, 'scope_note', q.scope_note,
    'status', q.status, 'sent_at', q.sent_at, 'decided_at', q.decided_at, 'reject_reason', q.reject_reason, 'client_po_number', q.client_po_number,
    'can_decide', q.status = 'sent' and public.my_client_role(v_client) = 'approver');
end $$;
grant execute on function public.client_creative_quote(uuid) to authenticated;

-- cr6 / cr9: the client approves (with its PO number if it has one) or rejects with a reason. The project manager is told either way.
create or replace function public.client_creative_quote_decide(p_brief uuid, p_approve boolean, p_reason text default null, p_po text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; q public.brief_creative_quotes; v_client uuid; v_name text;
begin
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  v_client := public._brief_client(b);
  if v_client is null then raise exception 'Not found' using errcode = '42501'; end if;
  if public._client_actor(v_client) <> 'approver' then raise exception 'Only approvers can decide a quote; ask your approver' using errcode = '42501'; end if;
  select * into q from public.brief_creative_quotes where brief_id = p_brief for update;
  if q.brief_id is null or q.status <> 'sent' then raise exception 'There is no quote waiting for your decision'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Tell us why the quote is not accepted'; end if;
  if length(coalesce(p_reason, '')) > 4000 or length(coalesce(p_po, '')) > 80 then raise exception 'That is too long'; end if;
  update public.brief_creative_quotes set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    reject_reason = case when p_approve then null else trim(p_reason) end, client_po_number = case when p_approve then nullif(trim(p_po), '') else null end, updated_at = now()
   where brief_id = p_brief;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public._brief_event(p_brief, case when p_approve then 'creative_quote_approved' else 'creative_quote_rejected' end, b.status, b.status,
    case when p_approve then 'Approved by the client' || coalesce(' (PO ' || nullif(trim(p_po), '') || ')', '') else trim(p_reason) end);
  perform public.notify(b.created_by, 'briefing',
    format('%s %s the creative quote for %s', v_name, case when p_approve then 'approved' else 'rejected' end, b.brief_code),
    case when p_approve then 'Confirm the PO on the brief, then creative work can start.' else left(trim(p_reason), 140) end, '/briefing/' || b.id);
end $$;
grant execute on function public.client_creative_quote_decide(uuid, boolean, text, text) to authenticated;

-- cr7: confirm the approval and the client PO on the system. Creative work can start after this.
create or replace function public.creative_quote_confirm_po(p_brief uuid, p_po text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; q public.brief_creative_quotes; v_po text;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  select * into q from public.brief_creative_quotes where brief_id = p_brief for update;
  if b.id is null or q.brief_id is null then raise exception 'There is no quote on this brief'; end if;
  if q.status <> 'approved' then raise exception 'The client has not approved the quote yet'; end if;
  if q.po_confirmed_at is not null then raise exception 'The PO is already confirmed'; end if;
  v_po := coalesce(nullif(trim(p_po), ''), q.client_po_number);
  if v_po is null then raise exception 'Enter the client PO number'; end if;
  update public.brief_creative_quotes set client_po_number = v_po, po_confirmed_by = auth.uid(), po_confirmed_at = now(), updated_at = now() where brief_id = p_brief;
  perform public._brief_event(p_brief, 'creative_po_confirmed', b.status, b.status, 'Client PO ' || v_po);
end $$;
grant execute on function public.creative_quote_confirm_po(uuid, text) to authenticated;

-- cr8 follows cr4 or cr7: concepts on a brief that needs creative input are submitted only once the kick-off or the confirmed PO is on record.
alter function public.concept_submit(uuid, text) rename to _cq_pre_concept_submit;
create function public.concept_submit(p_concept uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ideation_concepts; b public.briefs;
begin
  select * into c from public.ideation_concepts where id = p_concept;
  if c.id is not null and c.brief_id is not null then
    select * into b from public.briefs where id = c.brief_id;
    if b.creative_needed is true and b.creative_kickoff_at is null
       and not exists (select 1 from public.brief_creative_quotes q where q.brief_id = b.id and q.po_confirmed_at is not null) then
      raise exception 'Creative work starts after the kick-off (retainer client) or the approved quote and client PO. Record that on the brief first.';
    end if;
  end if;
  perform public._cq_pre_concept_submit(p_concept, p_note);
end $$;
grant execute on function public.concept_submit(uuid, text) to authenticated;
revoke execute on function public._cq_pre_concept_submit(uuid, text) from public, anon, authenticated;
