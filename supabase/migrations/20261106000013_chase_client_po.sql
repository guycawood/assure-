-- Chasing a missing client PO, aligned to the Global Business Transformation process "Catalogue order and order window" (step q4):
-- the account team chases the client for the PO. Estimates the client has approved but that have no client PO are listed with how long
-- they have waited; a chase is logged and reaches the client's approvers in the portal and by email; the client can give the PO number
-- in the portal. A chase is not repeated within three days.

create table public.estimate_po_chases (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  chased_by uuid references public.profiles(id) on delete set null,
  chased_at timestamptz not null default now(),
  note text
);
create index estimate_po_chases_idx on public.estimate_po_chases (estimate_id, chased_at desc);
alter table public.estimate_po_chases enable row level security;
create policy epc_read on public.estimate_po_chases for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.estimate_po_chases from authenticated, anon;

-- Days between chases.
create or replace function public._po_chase_gap_days() returns int language sql immutable as $$ select 3 $$;

-- Is the client's approval on record, and is the PO still missing?
create or replace function public._estimate_po_wait(p_estimate uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when e.status not in ('sent', 'approved') then null
    when exists (select 1 from public.client_pos where estimate_id = e.id) or coalesce(trim(e.client_order_ref), '') <> '' then null
    when e.status = 'approved' then coalesce(e.approved_at, e.updated_at)
    else (select max(d.decided_at) from public.client_decisions d where d.estimate_id = e.id and d.decision = 'approve' and d.decided_at >= coalesce(e.sent_at, e.created_at))
  end
  from public.estimates e where e.id = p_estimate;
$$;
revoke execute on function public._estimate_po_wait(uuid) from public, anon, authenticated;

-- The list: client-approved estimates still without a client PO.
create or replace function public.estimate_po_waiting() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(q.x order by q.days_waiting desc), '[]'::jsonb) from (
    select jsonb_build_object('estimate_id', e.id, 'estimate_number', e.estimate_number, 'job_number', j.job_number, 'job_title', j.title,
        'client_name', c.name, 'sell_price', e.sell_price, 'currency', e.currency, 'status', e.status, 'since', w.since,
        'days_waiting', greatest(0, (current_date - w.since::date)),
        'chases', (select count(*) from public.estimate_po_chases k where k.estimate_id = e.id),
        'last_chased_at', (select max(k.chased_at) from public.estimate_po_chases k where k.estimate_id = e.id),
        'chase_due', coalesce((select max(k.chased_at) from public.estimate_po_chases k where k.estimate_id = e.id), w.since) <= now() - make_interval(days => public._po_chase_gap_days())) as x,
      greatest(0, (current_date - w.since::date)) as days_waiting
    from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
    cross join lateral (select public._estimate_po_wait(e.id) as since) w
   where w.since is not null) q);
end $$;
grant execute on function public.estimate_po_waiting() to authenticated;

-- q4: chase the client. Logged, and it reaches the client's approvers in the portal and by email.
create or replace function public.estimate_chase_client_po(p_estimate uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; v_since timestamptz; v_last timestamptz;
begin
  if not public.is_internal() then raise exception 'Only internal staff can chase a client' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  v_since := public._estimate_po_wait(p_estimate);
  if v_since is null then raise exception 'This estimate is not waiting for a client PO'; end if;
  select max(chased_at) into v_last from public.estimate_po_chases where estimate_id = p_estimate;
  if v_last is not null and v_last > now() - make_interval(days => public._po_chase_gap_days()) then
    raise exception 'The client was already chased on %. Wait % days between chases.', to_char(v_last, 'DD Mon'), public._po_chase_gap_days();
  end if;
  select * into j from public.jobs where id = e.job_id;
  insert into public.estimate_po_chases (estimate_id, chased_by, note) values (p_estimate, auth.uid(), nullif(trim(p_note), ''));
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'client_po_chased', jsonb_build_object('note', nullif(trim(p_note), '')));
  perform public.notify(cu.user_id, 'client', 'Your PO is needed for ' || e.estimate_number,
    coalesce(nullif(trim(p_note), ''), 'You approved this estimate. Please send your purchase order so that we can order.'), '/client-portal/estimates/' || e.id)
    from public.client_users cu where cu.client_id = j.client_id and cu.role = 'approver';
  insert into public.email_outbox (to_email, subject, body, created_by)
  select p.email, 'Your purchase order is needed: ' || e.estimate_number,
         format('You approved estimate %s (%s). We cannot place the order until we have your purchase order number. Open the Client Portal to enter it.%s',
                e.estimate_number, j.title, coalesce(' Note: ' || nullif(trim(p_note), ''), '')), auth.uid()
    from public.client_users cu join public.profiles p on p.id = cu.user_id where cu.client_id = j.client_id and cu.role = 'approver' and p.email is not null;
end $$;
grant execute on function public.estimate_chase_client_po(uuid, text) to authenticated;

-- What the client sees on an estimate it approved.
create or replace function public.client_estimate_po_status(p_estimate uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; j public.jobs; v_role text;
begin
  select * into e from public.estimates where id = p_estimate;
  if e.id is null then return null; end if;
  select * into j from public.jobs where id = e.job_id;
  v_role := public.my_client_role(j.client_id);
  if v_role is null then return null; end if;
  return jsonb_build_object('needed', public._estimate_po_wait(p_estimate) is not null, 'sell_price', e.sell_price, 'currency', e.currency,
    'provided', (select coalesce(jsonb_agg(jsonb_build_object('po_number', po_number, 'amount', amount, 'po_date', po_date) order by created_at), '[]'::jsonb) from public.client_pos where estimate_id = p_estimate),
    'last_chased_at', (select max(chased_at) from public.estimate_po_chases where estimate_id = p_estimate),
    'can_provide', v_role = 'approver');
end $$;
grant execute on function public.client_estimate_po_status(uuid) to authenticated;

-- The client gives its PO number in the portal. Only an approver, and only for an estimate it has approved.
create or replace function public.client_estimate_provide_po(p_estimate uuid, p_po_number text, p_amount numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; v_sum numeric; v_amount numeric; v_name text;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  select * into j from public.jobs where id = e.job_id;
  if public._client_actor(j.client_id) <> 'approver' then raise exception 'Only approvers can give a purchase order; ask your approver' using errcode = '42501'; end if;
  if public._estimate_po_wait(p_estimate) is null and not exists (select 1 from public.client_decisions d where d.estimate_id = e.id and d.decision = 'approve') and e.status <> 'approved' then
    raise exception 'This estimate is not waiting for your purchase order';
  end if;
  if coalesce(length(trim(p_po_number)), 0) < 2 or length(p_po_number) > 80 then raise exception 'Enter your purchase order number'; end if;
  if exists (select 1 from public.client_pos where estimate_id = p_estimate and lower(po_number) = lower(trim(p_po_number))) then raise exception 'That PO number is already on this estimate'; end if;
  select coalesce(sum(amount), 0) into v_sum from public.client_pos where estimate_id = p_estimate;
  v_amount := coalesce(p_amount, round(e.sell_price - v_sum, 2));
  if v_amount is null or v_amount <= 0 then raise exception 'The estimate is already covered by purchase orders'; end if;
  if v_sum + v_amount > e.sell_price + 0.01 then raise exception 'Your purchase orders would total more than the estimate (% %)', e.currency, e.sell_price; end if;
  insert into public.client_pos (estimate_id, po_number, amount, currency, po_date, created_by) values (p_estimate, trim(p_po_number), v_amount, e.currency, current_date, auth.uid());
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'client_po_added',
    jsonb_build_object('po_number', trim(p_po_number), 'amount', v_amount, 'by', v_name, 'via', 'client_portal'));
  perform public.notify(u, 'orders', format('%s sent PO %s for %s', v_name, trim(p_po_number), e.estimate_number), 'The supplier PO can now be raised.', '/orders/estimates/' || e.id)
    from (select distinct u from unnest(array[j.manager, e.created_by]) u where u is not null) m;
end $$;
grant execute on function public.client_estimate_provide_po(uuid, text, numeric) to authenticated;
