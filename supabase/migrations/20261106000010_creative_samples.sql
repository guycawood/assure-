-- Product samples on a creative brief, aligned to the Global Business Transformation process "Creative work needed":
--   cr16 samples needed?                 -> brief_set_samples (the decision is recorded)
--   cr18 product sampling process        -> sample_request (to a supplier), vendor_sample_ship (with tracking),
--                                           sample_receive, sample_review (approve, or ask for changes and the supplier sends another)

alter table public.briefs
  add column samples_needed boolean,
  add column samples_decided_by uuid references public.profiles(id) on delete set null,
  add column samples_decided_at timestamptz,
  add column samples_note text;

create table public.brief_samples (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  description text not null check (length(trim(description)) >= 5),
  quantity int not null default 1 check (quantity between 1 and 100),
  needed_by date,
  round int not null default 1,
  status text not null default 'requested' check (status in ('requested', 'shipped', 'received', 'approved', 'changes_requested')),
  carrier text,
  tracking_number text,
  supplier_note text,
  shipped_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  received_at timestamptz,
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index brief_samples_brief_idx on public.brief_samples (brief_id);
create index brief_samples_supplier_idx on public.brief_samples (supplier_id);
alter table public.brief_samples enable row level security;
create policy bs_read on public.brief_samples for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.brief_samples from authenticated, anon;

-- cr16: is a sample needed? Recorded on the brief with who decided.
create or replace function public.brief_set_samples(p_brief uuid, p_needed boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true then raise exception 'Samples belong to creative work: mark the brief as needing creative input first'; end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot be changed', replace(b.status, '_', ' '); end if;
  if p_needed is null then raise exception 'Say whether samples are needed'; end if;
  if p_needed is false and exists (select 1 from public.brief_samples where brief_id = p_brief and status in ('requested', 'shipped', 'received')) then
    raise exception 'There are sample requests still open on this brief';
  end if;
  update public.briefs set samples_needed = p_needed, samples_decided_by = auth.uid(), samples_decided_at = now(), samples_note = nullif(trim(p_note), ''), updated_at = now() where id = p_brief;
  perform public._brief_event(p_brief, 'samples_decision', b.status, b.status, case when p_needed then 'Samples needed' else 'No samples needed' end || coalesce(': ' || nullif(trim(p_note), ''), ''));
end $$;
grant execute on function public.brief_set_samples(uuid, boolean, text) to authenticated;

-- cr18: ask a supplier for a sample.
create or replace function public.sample_request(p_brief uuid, p_supplier uuid, p_description text, p_quantity int default 1, p_needed_by date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.briefs; s public.suppliers; v_id uuid;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.samples_needed is not true then raise exception 'Record that samples are needed on this brief first'; end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot take a sample request', replace(b.status, '_', ' '); end if;
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null or not s.active or s.purchasing_blocked then raise exception 'That supplier is not eligible in SRM'; end if;
  if coalesce(length(trim(p_description)), 0) < 5 then raise exception 'Describe the sample you need'; end if;
  if p_quantity is null or p_quantity not between 1 and 100 then raise exception 'Ask for between 1 and 100 pieces'; end if;
  if p_needed_by is not null and p_needed_by < current_date then raise exception 'The needed-by date is in the past'; end if;
  insert into public.brief_samples (brief_id, supplier_id, description, quantity, needed_by, requested_by)
  values (p_brief, p_supplier, trim(p_description), p_quantity, p_needed_by, auth.uid()) returning id into v_id;
  perform public._brief_event(p_brief, 'sample_requested', b.status, b.status, s.name || ': ' || trim(p_description));
  perform public.notify_supplier(p_supplier, 'vendor', 'Sample requested', left(trim(p_description), 140), '/vendor/creative');
  if s.primary_contact_email is not null then
    insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
    values (s.primary_contact_email, 'Sample requested', format('We have asked for %s sample(s): %s. Open your vendor portal to send it and add the tracking number.', p_quantity, trim(p_description)), s.id, auth.uid());
  end if;
  return v_id;
end $$;
grant execute on function public.sample_request(uuid, uuid, text, int, date) to authenticated;

-- The supplier's own sample requests.
create or replace function public.vendor_samples() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'quantity', x.quantity, 'needed_by', x.needed_by, 'round', x.round,
      'status', x.status, 'carrier', x.carrier, 'tracking_number', x.tracking_number, 'supplier_note', x.supplier_note, 'shipped_at', x.shipped_at,
      'review_note', x.review_note) order by (x.status in ('requested', 'changes_requested')) desc, x.created_at desc), '[]'::jsonb)
    from public.brief_samples x where x.supplier_id = v_sup);
end $$;
grant execute on function public.vendor_samples() to authenticated;

-- The supplier says the sample is on its way, with the tracking number.
create or replace function public.vendor_sample_ship(p_sample uuid, p_carrier text, p_tracking text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); x public.brief_samples; b public.briefs; s public.suppliers;
begin
  select * into x from public.brief_samples where id = p_sample and supplier_id = v_sup for update;
  if x.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if x.status not in ('requested', 'changes_requested') then raise exception 'This sample is already %', replace(x.status, '_', ' '); end if;
  if coalesce(length(trim(p_tracking)), 0) < 3 then raise exception 'Add the tracking number'; end if;
  update public.brief_samples set status = 'shipped', carrier = nullif(trim(p_carrier), ''), tracking_number = trim(p_tracking), supplier_note = nullif(trim(p_note), ''),
    shipped_at = now(), round = case when x.status = 'changes_requested' then x.round + 1 else x.round end where id = p_sample;
  select * into b from public.briefs where id = x.brief_id;
  select * into s from public.suppliers where id = v_sup;
  perform public._brief_event(x.brief_id, 'sample_shipped', b.status, b.status, s.name || ', tracking ' || trim(p_tracking));
  perform public.notify(x.requested_by, 'briefing', 'Sample on its way from ' || s.name, 'Tracking ' || trim(p_tracking), '/briefing/' || x.brief_id);
end $$;
grant execute on function public.vendor_sample_ship(uuid, text, text, text) to authenticated;

create or replace function public.sample_receive(p_sample uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.brief_samples; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into x from public.brief_samples where id = p_sample for update;
  if x.id is null then raise exception 'Sample not found'; end if;
  if x.status <> 'shipped' then raise exception 'The supplier has not shipped this sample yet'; end if;
  update public.brief_samples set status = 'received', received_by = auth.uid(), received_at = now(), review_note = nullif(trim(p_note), '') where id = p_sample;
  select * into b from public.briefs where id = x.brief_id;
  perform public._brief_event(x.brief_id, 'sample_received', b.status, b.status, nullif(trim(p_note), ''));
end $$;
grant execute on function public.sample_receive(uuid, text) to authenticated;

-- Review the sample: approve, or ask for changes (a reason is needed) and the supplier sends another.
create or replace function public.sample_review(p_sample uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.brief_samples; b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into x from public.brief_samples where id = p_sample for update;
  if x.id is null then raise exception 'Sample not found'; end if;
  if x.status <> 'received' then raise exception 'Confirm that the sample has arrived first'; end if;
  if p_approve is null then raise exception 'Choose approve or ask for changes'; end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say what needs to change'; end if;
  update public.brief_samples set status = case when p_approve then 'approved' else 'changes_requested' end, review_note = nullif(trim(p_note), ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_sample;
  select * into b from public.briefs where id = x.brief_id;
  perform public._brief_event(x.brief_id, case when p_approve then 'sample_approved' else 'sample_changes_requested' end, b.status, b.status, nullif(trim(p_note), ''));
  if not p_approve then
    perform public.notify_supplier(x.supplier_id, 'vendor', 'Changes needed on the sample', left(trim(p_note), 140), '/vendor/creative');
  end if;
end $$;
grant execute on function public.sample_review(uuid, boolean, text) to authenticated;

create or replace function public.samples_internal(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'supplier_id', x.supplier_id, 'supplier_name', s.name, 'description', x.description, 'quantity', x.quantity,
      'needed_by', x.needed_by, 'round', x.round, 'status', x.status, 'carrier', x.carrier, 'tracking_number', x.tracking_number, 'supplier_note', x.supplier_note,
      'shipped_at', x.shipped_at, 'received_at', x.received_at, 'review_note', x.review_note, 'reviewed_at', x.reviewed_at) order by x.created_at desc), '[]'::jsonb)
    from public.brief_samples x join public.suppliers s on s.id = x.supplier_id where x.brief_id = p_brief);
end $$;
grant execute on function public.samples_internal(uuid) to authenticated;
