-- Vendor acceptance of rate card awards. Approval notifies each awarded vendor, who accepts the award or returns it with questions.
-- Acceptance is what binds both sides: an item's price is live only once its vendor has accepted. A vendor's question goes to sourcing,
-- which answers it, and the vendor decides again. A change to price or scope reopens the programme: it goes back through review and a
-- different lead's approval, and every vendor accepts again.

create table public.rate_card_acceptances (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.rate_card_programmes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'queried')),
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_by_name text,
  accepted_at timestamptz,
  question text,
  asked_at timestamptz,
  response text,
  responded_at timestamptz,
  responded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (programme_id, supplier_id)
);
alter table public.rate_card_acceptances enable row level security;
create policy rcacc_read on public.rate_card_acceptances for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_acceptances from authenticated, anon;

-- Approval creates one acceptance per awarded vendor. Leaving the approved state clears them, and the awards go back to pending.
create or replace function public.trg_rcp_acceptances() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.rate_card_acceptances (programme_id, supplier_id)
    select distinct new.id, a.supplier_id from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id
     where i.programme_id = new.id and a.supplier_id is not null
    on conflict (programme_id, supplier_id) do nothing;
    update public.rate_card_awards a set contract_status = 'pending' from public.rate_card_items i where i.id = a.item_id and i.programme_id = new.id;
    perform public.notify_supplier(x.supplier_id, 'vendor', 'Please accept your rate card award: ' || new.name, 'Review the items and prices you were awarded and accept, or return them with questions.', '/vendor/rate-cards/' || new.id)
      from (select distinct supplier_id from public.rate_card_acceptances where programme_id = new.id) x;
  elsif old.status = 'approved' and new.status is distinct from 'approved' then
    delete from public.rate_card_acceptances where programme_id = new.id;
    update public.rate_card_awards a set contract_status = 'pending' from public.rate_card_items i where i.id = a.item_id and i.programme_id = new.id;
  end if;
  return new;
end $$;
create trigger rcp_acceptances after update of status on public.rate_card_programmes for each row execute function public.trg_rcp_acceptances();

-- The vendor accepts the award, or returns it with questions.
create or replace function public.vendor_rate_card_accept(p_prog uuid, p_accept boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); a public.rate_card_acceptances; g public.rate_card_programmes; s public.suppliers; v_name text;
begin
  select * into a from public.rate_card_acceptances where programme_id = p_prog and supplier_id = v_sup for update;
  if a.id is null then raise exception 'You have no award to accept on this rate card' using errcode = '42501'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  select * into s from public.suppliers where id = v_sup;
  if a.status = 'accepted' then raise exception 'You have already accepted this award'; end if;
  if p_accept is null then raise exception 'Choose accept or return with questions'; end if;
  if p_accept then
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
    update public.rate_card_acceptances set status = 'accepted', accepted_by = auth.uid(), accepted_by_name = v_name, accepted_at = now(), question = null where id = a.id;
    update public.rate_card_awards x set contract_status = 'agreed' from public.rate_card_items i where i.id = x.item_id and i.programme_id = p_prog and x.supplier_id = v_sup;
    perform public.notify(g.created_by, 'sourcing', s.name || ' accepted its award on ' || g.name, null, '/sourcing/rate-cards/programmes/' || g.id || '?tab=approval');
    perform public.notify(g.approved_by, 'sourcing', s.name || ' accepted its award on ' || g.name, null, '/sourcing/rate-cards/programmes/' || g.id || '?tab=approval');
    return 'accepted';
  end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say what your question is'; end if;
  update public.rate_card_acceptances set status = 'queried', question = trim(p_note), asked_at = now() where id = a.id;
  perform public.notify(g.created_by, 'sourcing', s.name || ' has questions on its award: ' || g.name, left(trim(p_note), 140), '/sourcing/rate-cards/programmes/' || g.id || '?tab=approval');
  perform public.notify(g.approved_by, 'sourcing', s.name || ' has questions on its award: ' || g.name, left(trim(p_note), 140), '/sourcing/rate-cards/programmes/' || g.id || '?tab=approval');
  return 'queried';
end $$;

-- Sourcing answers a question. The vendor then accepts or asks again.
create or replace function public.rate_card_acceptance_respond(p_prog uuid, p_supplier uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.rate_card_acceptances; g public.rate_card_programmes;
begin
  perform public._rcp_require_builder();
  select * into a from public.rate_card_acceptances where programme_id = p_prog and supplier_id = p_supplier for update;
  if a.id is null then raise exception 'Acceptance not found'; end if;
  if a.status <> 'queried' then raise exception 'This vendor has no open question'; end if;
  if coalesce(length(trim(p_response)), 0) < 3 then raise exception 'Write the answer'; end if;
  select * into g from public.rate_card_programmes where id = p_prog;
  update public.rate_card_acceptances set status = 'pending', response = trim(p_response), responded_at = now(), responded_by = auth.uid() where id = a.id;
  perform public.notify_supplier(p_supplier, 'vendor', 'Answer on your rate card award: ' || g.name, left(trim(p_response), 140), '/vendor/rate-cards/' || g.id);
end $$;

create or replace function public.rate_card_programme_acceptances(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card programmes' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', a.supplier_id, 'supplier_name', s.name, 'status', a.status, 'accepted_by', a.accepted_by_name, 'accepted_at', a.accepted_at,
      'question', a.question, 'asked_at', a.asked_at, 'response', a.response, 'responded_at', a.responded_at,
      'items', (select count(*) from public.rate_card_awards x join public.rate_card_items i on i.id = x.item_id where i.programme_id = p_prog and x.supplier_id = a.supplier_id)
    ) order by s.name), '[]'::jsonb) into v_out
    from public.rate_card_acceptances a join public.suppliers s on s.id = a.supplier_id where a.programme_id = p_prog;
  return v_out;
end $$;

-- A change to price or scope after approval: back to review, so a different lead approves again and every vendor accepts again.
create or replace function public.rate_card_programme_reopen(p_prog uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.rate_card_programmes; x record;
begin
  perform public._rcp_require_builder();
  select * into g from public.rate_card_programmes where id = p_prog for update;
  if g.id is null then raise exception 'Programme not found'; end if;
  if g.status <> 'approved' then raise exception 'Only an approved programme can be reopened'; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Say what is changing and why'; end if;
  for x in select distinct supplier_id from public.rate_card_acceptances where programme_id = p_prog loop
    perform public.notify_supplier(x.supplier_id, 'vendor', 'Rate card terms are being revised: ' || g.name, left(trim(p_note), 140) || ' You will be asked to accept again.', '/vendor/rate-cards/' || g.id);
  end loop;
  update public.rate_card_programmes set status = 'review', submitted_by = auth.uid(), submitted_at = now(), approved_by = null, approved_at = null, approval_note = null, updated_at = now() where id = p_prog;
end $$;

-- The vendor's award view now includes where its acceptance stands.
create or replace function public.vendor_rate_card_awards(p_prog uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); g public.rate_card_programmes; v_out jsonb; a public.rate_card_acceptances;
begin
  select * into g from public.rate_card_programmes where id = p_prog;
  if g.id is null or g.status not in ('approved', 'published') or not exists (select 1 from public.rate_card_invites where programme_id = p_prog and supplier_id = v_sup) then
    return jsonb_build_object('approved', false, 'awards', '[]'::jsonb);
  end if;
  select * into a from public.rate_card_acceptances where programme_id = p_prog and supplier_id = v_sup;
  select coalesce(jsonb_agg(jsonb_build_object('subcode', i.subcode, 'product_type', i.product_type, 'channel', i.channel, 'uom', i.uom, 'qty_min', i.qty_min, 'qty_max', i.qty_max,
      'share', x.share_percent, 'price', x.buy_price, 'contract_status', x.contract_status) order by i.sort), '[]'::jsonb) into v_out
    from public.rate_card_awards x join public.rate_card_items i on i.id = x.item_id where i.programme_id = p_prog and x.supplier_id = v_sup;
  return jsonb_build_object('approved', true, 'valid_from', g.valid_from, 'valid_to', g.valid_to, 'currency', g.currency, 'awards', v_out,
    'acceptance', case when a.id is null then null else jsonb_build_object('status', a.status, 'accepted_by', a.accepted_by_name, 'accepted_at', a.accepted_at,
      'question', a.question, 'response', a.response) end);
end $$;

-- The vendor's programme list says when an award is waiting to be accepted.
create or replace function public.vendor_rate_card_programmes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'code', g.code, 'name', g.name, 'year', g.year, 'market', g.market, 'currency', g.currency, 'deadline', g.bid_deadline,
      'invite_status', i.status, 'closed', (g.status <> 'bidding' or g.bid_deadline <= now()), 'approved', g.status in ('approved', 'published'),
      'items', (select count(*) from public.rate_card_items it where it.programme_id = g.id),
      'priced', (select count(*) from public.rate_card_bids b join public.rate_card_items it on it.id = b.item_id where it.programme_id = g.id and b.supplier_id = v_sup),
      'awarded', case when g.status in ('approved', 'published') then (select count(*) from public.rate_card_awards a join public.rate_card_items it on it.id = a.item_id where it.programme_id = g.id and a.supplier_id = v_sup) else 0 end,
      'accept_status', (select ac.status from public.rate_card_acceptances ac where ac.programme_id = g.id and ac.supplier_id = v_sup)
    ) order by g.bid_deadline desc nulls last), '[]'::jsonb) into v_out
    from public.rate_card_invites i join public.rate_card_programmes g on g.id = i.programme_id
   where i.supplier_id = v_sup and g.status in ('bidding', 'review', 'approved', 'published');
  return v_out;
end $$;

revoke execute on function public.vendor_rate_card_accept(uuid, boolean, text), public.rate_card_acceptance_respond(uuid, uuid, text),
  public.rate_card_programme_acceptances(uuid), public.rate_card_programme_reopen(uuid, text) from public, anon;
grant execute on function public.vendor_rate_card_accept(uuid, boolean, text), public.rate_card_acceptance_respond(uuid, uuid, text),
  public.rate_card_programme_acceptances(uuid), public.rate_card_programme_reopen(uuid, text) to authenticated;
