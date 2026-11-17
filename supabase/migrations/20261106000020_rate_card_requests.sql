-- Requesting a new rate card. When nobody finds the card they need, the gap becomes tracked work for the sourcing team:
-- requested -> taken (an owner) -> pricing (optionally an RFQ) -> drafted (a card is built) -> approved, or declined with a reason.
-- The card is built through the governed library (admins and Sourcing owners only, a different person approves it), and it
-- must also have a reviewed Impact Grade. When both are true the request closes itself and the requester is told.

create sequence public.rate_card_request_no;

create table public.rate_card_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique default ('RCR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rate_card_request_no')::text, 5, '0')),
  title text not null check (length(trim(title)) > 0),
  spec_type text not null default '2d',
  substrate_code text,
  length_mm numeric check (length_mm is null or length_mm > 0),
  width_mm numeric check (width_mm is null or width_mm > 0),
  min_qty int check (min_qty is null or min_qty > 0),
  max_qty int check (max_qty is null or max_qty > 0),
  client_id uuid references public.sourcing_clients(id) on delete set null,
  market text,
  reason text not null check (length(trim(reason)) > 0),
  brief_id uuid references public.briefs(id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'taken', 'pricing', 'drafted', 'approved', 'declined')),
  owner uuid references public.profiles(id) on delete set null,
  rfq_id uuid references public.rfqs(id) on delete set null,
  card_id uuid references public.library_records(id) on delete set null,
  decline_reason text,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  decided_at timestamptz,
  check (min_qty is null or max_qty is null or max_qty >= min_qty)
);
create index rate_card_requests_status_idx on public.rate_card_requests (status, created_at desc);

create table public.rate_card_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.rate_card_requests(id) on delete cascade,
  event text not null,
  note text,
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  at timestamptz not null default now()
);
create index rate_card_request_events_idx on public.rate_card_request_events (request_id, at);

alter table public.briefs add column if not exists rate_card_request_id uuid references public.rate_card_requests(id) on delete set null;

alter table public.rate_card_requests enable row level security;
alter table public.rate_card_request_events enable row level security;
create policy rcr_read on public.rate_card_requests for select to authenticated using (public.is_internal());
create policy rcre_read on public.rate_card_request_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_requests, public.rate_card_request_events from authenticated, anon;

create or replace function public._sourcing_team() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.sourcing_user_access where user_id = auth.uid());
$$;

create or replace function public._rcr_event(p_req uuid, p_event text, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into public.rate_card_request_events (request_id, event, note) values (p_req, p_event, p_note);
$$;

-- Anyone internal can ask. The sourcing leads are told.
create or replace function public.rate_card_request_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; v_len numeric := nullif(p->>'length_mm', '')::numeric; v_wid numeric := nullif(p->>'width_mm', '')::numeric;
        v_min int := nullif(p->>'min_qty', '')::int; v_max int := nullif(p->>'max_qty', '')::int; v_brief uuid := nullif(p->>'brief_id', '')::uuid; u record;
begin
  if not public.is_internal() then raise exception 'Only internal staff can request a rate card' using errcode = '42501'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Say what the card is for'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'Say why you need a new card'; end if;
  if v_len is not null and v_len <= 0 or v_wid is not null and v_wid <= 0 then raise exception 'Sizes must be above zero'; end if;
  if v_min is not null and v_max is not null and v_max < v_min then raise exception 'The largest quantity can''t be below the smallest'; end if;
  insert into public.rate_card_requests (title, spec_type, substrate_code, length_mm, width_mm, min_qty, max_qty, client_id, market, reason, brief_id)
  values (trim(p->>'title'), coalesce(nullif(p->>'spec_type', ''), '2d'), nullif(trim(p->>'substrate_code'), ''), v_len, v_wid, v_min, v_max,
          nullif(p->>'client_id', '')::uuid, nullif(upper(trim(p->>'market')), ''), trim(p->>'reason'), v_brief)
  returning id, request_no into v_id, v_no;
  if v_brief is not null then update public.briefs set rate_card_request_id = v_id where id = v_brief; end if;
  perform public._rcr_event(v_id, 'requested', trim(p->>'reason'));
  for u in select user_id from public.sourcing_user_access where is_lead loop
    perform public.notify(u.user_id, 'sourcing', 'Rate card requested: ' || v_no, left(trim(p->>'title'), 140), '/sourcing/rate-cards/requests');
  end loop;
  return v_id;
end $$;

-- The sourcing team takes a request and becomes its owner.
create or replace function public.rate_card_request_take(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_requests;
begin
  if not public._sourcing_team() then raise exception 'Only the sourcing team can take a rate card request' using errcode = '42501'; end if;
  select * into r from public.rate_card_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'requested' then raise exception 'This request has already been taken'; end if;
  update public.rate_card_requests set status = 'taken', owner = auth.uid(), taken_at = now() where id = p_id;
  perform public._rcr_event(p_id, 'taken', null);
  perform public.notify(r.requested_by, 'sourcing', 'Your rate card request is being worked on', r.request_no || ': ' || left(r.title, 120), '/sourcing/rate-cards/requests');
end $$;

-- Pricing: the owner gets prices, usually by an RFQ to eligible suppliers; the RFQ can be linked here.
create or replace function public.rate_card_request_pricing(p_id uuid, p_rfq uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_requests;
begin
  select * into r from public.rate_card_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.owner is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the owner of this request can move it on' using errcode = '42501'; end if;
  if r.status not in ('taken', 'pricing') then raise exception 'Take the request before pricing it'; end if;
  if p_rfq is not null and not exists (select 1 from public.rfqs where id = p_rfq) then raise exception 'RFQ not found'; end if;
  update public.rate_card_requests set status = 'pricing', rfq_id = coalesce(p_rfq, rfq_id) where id = p_id;
  perform public._rcr_event(p_id, 'pricing', case when p_rfq is not null then 'RFQ linked' end);
end $$;

-- Build the card from the request through the governed library. Needs admin or Sourcing owner rights, as every library change does.
create or replace function public.rate_card_request_build(p_id uuid, p_supplier_code text, p_unit_price numeric, p_currency text, p_from date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.rate_card_requests; s public.suppliers; cl public.sourcing_clients; v_code text; v_card uuid; v_data jsonb;
begin
  select * into r from public.rate_card_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.owner is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the owner of this request can build the card' using errcode = '42501'; end if;
  if r.status not in ('taken', 'pricing') then raise exception 'Take the request before building the card'; end if;
  if p_unit_price is null or p_unit_price <= 0 then raise exception 'Give the agreed unit price'; end if;
  select * into s from public.suppliers where supplier_code = trim(coalesce(p_supplier_code, ''));
  if s.id is null then raise exception 'Choose the supplier the price is agreed with'; end if;
  if not s.active or s.purchasing_blocked then raise exception 'That supplier is not eligible in SRM'; end if;
  if r.client_id is not null then select * into cl from public.sourcing_clients where id = r.client_id; end if;
  v_code := 'RC-' || substr(r.request_no, 5);
  v_data := jsonb_strip_nulls(jsonb_build_object('spec_type', r.spec_type, 'substrate_code', r.substrate_code,
    'finished_length_mm', r.length_mm, 'finished_width_mm', r.width_mm, 'min_qty', coalesce(r.min_qty, 1), 'max_qty', r.max_qty,
    'unit_price', p_unit_price, 'currency', coalesce(nullif(trim(p_currency), ''), 'EUR'), 'supplier_code', s.supplier_code, 'client_code', cl.code));
  v_card := public.library_create('rate_cards', v_code, r.title, v_data, p_from, 'Built from request ' || r.request_no);
  update public.rate_card_requests set status = 'drafted', card_id = v_card where id = p_id;
  perform public._rcr_event(p_id, 'drafted', v_code || ' with ' || s.name);
  return v_card;
end $$;

create or replace function public.rate_card_request_decline(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_requests;
begin
  if not public._sourcing_team() then raise exception 'Only the sourcing team can decline a rate card request' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the request is declined'; end if;
  select * into r from public.rate_card_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status in ('approved', 'declined') then raise exception 'This request is already closed'; end if;
  update public.rate_card_requests set status = 'declined', decline_reason = trim(p_reason), decided_at = now() where id = p_id;
  perform public._rcr_event(p_id, 'declined', trim(p_reason));
  perform public.notify(r.requested_by, 'sourcing', 'Rate card request declined', r.request_no || ': ' || left(trim(p_reason), 120), '/sourcing/rate-cards/requests');
end $$;

-- The queue, with how long each has waited and how many briefs depend on it.
create or replace function public.rate_card_requests_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card requests' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_no', r.request_no, 'title', r.title, 'spec_type', r.spec_type, 'substrate_code', r.substrate_code,
      'length_mm', r.length_mm, 'width_mm', r.width_mm, 'min_qty', r.min_qty, 'max_qty', r.max_qty,
      'client_name', c.name, 'market', r.market, 'reason', r.reason, 'status', r.status,
      'requested_by', r.requested_by, 'requester_name', pr.full_name, 'owner', r.owner, 'owner_name', po.full_name,
      'rfq_id', r.rfq_id, 'card_id', r.card_id, 'card_code', lr.code, 'card_status', lr.status, 'decline_reason', r.decline_reason,
      'brief_id', r.brief_id, 'waiting_briefs', (select count(*) from public.briefs b where b.rate_card_request_id = r.id),
      'age_days', (coalesce(r.decided_at, now())::date - r.created_at::date), 'created_at', r.created_at,
      'mine', r.requested_by = auth.uid() or r.owner = auth.uid()
    ) order by (r.status in ('approved', 'declined')), r.created_at), '[]'::jsonb)
    into v_out
    from public.rate_card_requests r
    left join public.sourcing_clients c on c.id = r.client_id
    left join public.profiles pr on pr.id = r.requested_by
    left join public.profiles po on po.id = r.owner
    left join public.library_records lr on lr.id = r.card_id;
  return v_out;
end $$;

-- The request closes itself when its card is active and its grade is reviewed.
create or replace function public._rcr_check(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_requests;
begin
  if not exists (select 1 from public.library_records where id = p_card and status = 'active') then return; end if;
  if not exists (select 1 from public.rate_card_grades where card_id = p_card and review_status = 'reviewed') then return; end if;
  for r in select * from public.rate_card_requests where card_id = p_card and status = 'drafted' for update loop
    update public.rate_card_requests set status = 'approved', decided_at = now() where id = r.id;
    insert into public.rate_card_request_events (request_id, event, note, actor) values (r.id, 'approved', 'Card approved and graded', null);
    perform public.notify(r.requested_by, 'sourcing', 'Your rate card is ready', r.request_no || ': ' || left(r.title, 120) || '. Start a brief from it.', '/briefing/new/rate-card');
  end loop;
end $$;

create or replace function public.trg_rcr_grade() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.review_status = 'reviewed' then perform public._rcr_check(new.card_id); end if;
  return new;
end $$;
create trigger rcr_after_grade after insert or update of review_status on public.rate_card_grades for each row execute function public.trg_rcr_grade();

create or replace function public.trg_rcr_card() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.library_key = 'rate_cards' and new.status = 'active' then perform public._rcr_check(new.id); end if;
  return new;
end $$;
create trigger rcr_after_card after update of status on public.library_records for each row execute function public.trg_rcr_card();

revoke execute on function public._sourcing_team(), public._rcr_event(uuid, text, text), public._rcr_check(uuid) from public, anon, authenticated;
revoke execute on function public.rate_card_request_create(jsonb), public.rate_card_request_take(uuid), public.rate_card_request_pricing(uuid, uuid),
  public.rate_card_request_build(uuid, text, numeric, text, date), public.rate_card_request_decline(uuid, text), public.rate_card_requests_list() from public, anon;
grant execute on function public.rate_card_request_create(jsonb), public.rate_card_request_take(uuid), public.rate_card_request_pricing(uuid, uuid),
  public.rate_card_request_build(uuid, text, numeric, text, date), public.rate_card_request_decline(uuid, text), public.rate_card_requests_list() to authenticated;
