-- The sampling job in an RFP, aligned to the Global Business Transformation process "RFP process" (steps r10 to r24):
--   r10 review the quote, request a sampling quote, create the sampling job   -> sampling_request
--   r11 the supplier issues the sample quote                                  -> vendor_sampling_quote
--   r12 does the client need to approve the sample quote?                     -> sampling_decide_approval
--   r13 the client approves it and sends its PO (or the supplier re-quotes)   -> client_sampling_quote_decide
--   r14 the sample PO goes to the supplier                                    -> sampling_issue_po
--   r18 the client signs off the technical drawing                            -> sampling_send_drawing, client_sampling_drawing_decide
--   r16 the supplier confirms launch with photos or video                     -> vendor_sampling_launch
--   r20 the supplier sends the sample with its invoice reference and tracking -> vendor_sampling_ship
--   r21 the team confirms the sample arrived and checks conformity            -> sampling_receive, sampling_review
--   r22 sample OK: a reception notice is raised and the sample goes to the client
--   r23 sample rejected: the sample PO is invalidated
--   r24/r19 the client approves the sample, or it goes back for rework       -> client_sampling_sample_decide

create sequence public.sampling_job_no;
create sequence public.sampling_po_no;
create sequence public.sampling_notice_no;

create table public.sampling_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique default ('SJ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sampling_job_no')::text, 5, '0')),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  client_id uuid references public.sourcing_clients(id) on delete set null,
  description text not null check (length(trim(description)) >= 5),
  quantity int not null default 1 check (quantity between 1 and 100),
  status text not null default 'requested' check (status in ('requested', 'quoted', 'awaiting_client', 'approved', 'po_issued', 'launched', 'shipped', 'received',
    'accepted', 'rejected', 'with_client', 'client_approved', 'rework', 'cancelled')),
  round int not null default 1,
  quote_amount numeric(14,2) check (quote_amount is null or quote_amount >= 0),
  quote_currency text,
  quote_lead_days int check (quote_lead_days is null or quote_lead_days >= 0),
  quote_note text,
  quoted_at timestamptz,
  client_approval_required boolean,
  client_decided_by uuid references public.profiles(id) on delete set null,
  client_decided_at timestamptz,
  client_reject_reason text,
  client_po_number text,
  sample_po_number text unique,
  po_issued_at timestamptz,
  po_valid boolean not null default true,
  drawing_sent_at timestamptz,
  drawing_decided_by uuid references public.profiles(id) on delete set null,
  drawing_decided_at timestamptz,
  drawing_approved boolean,
  drawing_comment text,
  launched_at timestamptz,
  launch_note text,
  carrier text,
  tracking_number text,
  invoice_ref text,
  ship_note text,
  shipped_at timestamptz,
  received_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reception_notice text unique,
  sent_to_client_at timestamptz,
  client_sample_comment text,
  client_sample_decided_at timestamptz,
  client_sample_decided_by uuid references public.profiles(id) on delete set null,
  cancelled_reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index sampling_jobs_rfq_idx on public.sampling_jobs (rfq_id);
create index sampling_jobs_supplier_idx on public.sampling_jobs (supplier_id);
create index sampling_jobs_client_idx on public.sampling_jobs (client_id);
alter table public.sampling_jobs enable row level security;
create policy sj_read on public.sampling_jobs for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.sampling_jobs from authenticated, anon;

create table public.sampling_events (
  id bigint generated always as identity primary key,
  sampling_job_id uuid not null references public.sampling_jobs(id) on delete cascade,
  event text not null,
  detail text,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
alter table public.sampling_events enable row level security;
create policy se_read on public.sampling_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.sampling_events from authenticated, anon;

create or replace function public._sj_event(p_job uuid, p_event text, p_detail text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.sampling_events (sampling_job_id, event, detail, actor) values (p_job, p_event, p_detail, auth.uid());
$$;
revoke execute on function public._sj_event(uuid, text, text) from public, anon, authenticated;

create or replace function public._sj_internal() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only staff can do this' using errcode = '42501'; end if;
end $$;
revoke execute on function public._sj_internal() from public, anon, authenticated;

-- Tell the client's users with a given role, and the job manager.
create or replace function public._sj_notify_client(p_job public.sampling_jobs, p_title text, p_body text, p_role text default null) returns void
language sql security definer set search_path = public as $$
  select public.notify(cu.user_id, 'client', p_title, p_body, '/client-portal/samples')
    from public.client_users cu where cu.client_id = p_job.client_id and (p_role is null or cu.role = p_role);
$$;
revoke execute on function public._sj_notify_client(public.sampling_jobs, text, text, text) from public, anon, authenticated;

-- r10: ask a supplier that has quoted on this RFQ for a sampling quote.
create or replace function public.sampling_request(p_rfq uuid, p_supplier uuid, p_description text, p_quantity int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; i public.rfq_invitations; j public.jobs; s public.suppliers; v_id uuid;
begin
  perform public._sj_internal();
  select * into r from public.rfqs where id = p_rfq;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status = 'draft' or r.status = 'cancelled' then raise exception 'The RFQ has to be out with suppliers first'; end if;
  select * into i from public.rfq_invitations where rfq_id = p_rfq and supplier_id = p_supplier;
  if i.rfq_id is null then raise exception 'That supplier is not invited to this RFQ'; end if;
  if i.status <> 'quoted' then raise exception 'Review the supplier''s quote first: ask for a sample once it has quoted'; end if;
  if coalesce(length(trim(p_description)), 0) < 5 then raise exception 'Describe the sample you need'; end if;
  if p_quantity is null or p_quantity not between 1 and 100 then raise exception 'Ask for between 1 and 100 pieces'; end if;
  if exists (select 1 from public.sampling_jobs where rfq_id = p_rfq and supplier_id = p_supplier and status not in ('rejected', 'cancelled', 'client_approved')) then
    raise exception 'There is already an open sampling job for this supplier on this RFQ';
  end if;
  select * into j from public.jobs where id = r.job_id;
  select * into s from public.suppliers where id = p_supplier;
  insert into public.sampling_jobs (rfq_id, supplier_id, job_id, client_id, description, quantity, quote_currency, requested_by)
  values (p_rfq, p_supplier, r.job_id, j.client_id, trim(p_description), p_quantity, r.currency, auth.uid()) returning id into v_id;
  perform public._sj_event(v_id, 'requested', s.name || ': ' || trim(p_description));
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'sampling_requested', jsonb_build_object('supplier', s.name, 'sampling_job', v_id));
  perform public.notify_supplier(p_supplier, 'vendor', 'Sample quote requested', left(trim(p_description), 140), '/vendor/sampling');
  return v_id;
end $$;
grant execute on function public.sampling_request(uuid, uuid, text, int) to authenticated;

-- r11: the supplier issues its sample quote (also after the client did not accept the first one).
create or replace function public.vendor_sampling_quote(p_job uuid, p_amount numeric, p_lead_days int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); x public.sampling_jobs;
begin
  select * into x from public.sampling_jobs where id = p_job and supplier_id = v_sup for update;
  if x.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if x.status <> 'requested' then raise exception 'This sample quote has already been given'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the sample cost (0 if free)'; end if;
  if p_lead_days is null or p_lead_days < 0 then raise exception 'Enter the lead time in days'; end if;
  update public.sampling_jobs set status = 'quoted', quote_amount = round(p_amount, 2), quote_lead_days = p_lead_days, quote_note = nullif(trim(p_note), ''), quoted_at = now(),
    client_reject_reason = null where id = p_job;
  perform public._sj_event(p_job, 'quoted', coalesce(x.quote_currency, '') || ' ' || round(p_amount, 2) || ', ' || p_lead_days || ' days');
  perform public.notify(x.requested_by, 'sourcing', 'Sample quote received', x.job_number, '/rfq/' || x.rfq_id);
end $$;
grant execute on function public.vendor_sampling_quote(uuid, numeric, int, text) to authenticated;

-- r12: does the client need to approve the sample quote?
create or replace function public.sampling_decide_approval(p_job uuid, p_client_required boolean) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status <> 'quoted' then raise exception 'There is no sample quote to decide on'; end if;
  if p_client_required is null then raise exception 'Say whether the client approves the sample quote'; end if;
  if p_client_required and x.client_id is null then raise exception 'This job has no client to approve the quote'; end if;
  update public.sampling_jobs set client_approval_required = p_client_required, status = case when p_client_required then 'awaiting_client' else 'approved' end where id = p_job;
  perform public._sj_event(p_job, case when p_client_required then 'sent_to_client_for_quote' else 'quote_accepted_internally' end);
  if p_client_required then
    perform public._sj_notify_client(x, 'Sample quote for your approval', x.job_number || ': ' || x.quote_currency || ' ' || to_char(x.quote_amount, 'FM999,999,990.00'), 'approver');
  end if;
end $$;
grant execute on function public.sampling_decide_approval(uuid, boolean) to authenticated;

-- What the client sees: sampling jobs from the quote approval on, for its own client only.
create or replace function public.client_sampling_jobs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select coalesce(array_agg(x), '{}') into v from public.my_client_ids() x;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'job_number', s.job_number, 'description', s.description, 'quantity', s.quantity, 'status', s.status,
      'quote_amount', s.quote_amount, 'quote_currency', s.quote_currency, 'quote_lead_days', s.quote_lead_days, 'quote_note', s.quote_note,
      'client_approval_required', s.client_approval_required, 'client_po_number', s.client_po_number, 'client_reject_reason', s.client_reject_reason,
      'drawing_sent_at', s.drawing_sent_at, 'drawing_approved', s.drawing_approved, 'drawing_comment', s.drawing_comment,
      'sent_to_client_at', s.sent_to_client_at, 'client_sample_comment', s.client_sample_comment, 'job_title', j.title, 'round', s.round,
      'role', public.my_client_role(s.client_id),
      'drawing_files', case when s.drawing_sent_at is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                          from public.files f where f.entity_type = 'sampling_drawing' and f.entity_id = s.id::text) else '[]'::jsonb end,
      'sample_files', case when s.sent_to_client_at is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                          from public.files f where f.entity_type = 'sampling_job' and f.entity_id = s.id::text) else '[]'::jsonb end)
      order by (s.status in ('awaiting_client', 'with_client')) desc, s.created_at desc), '[]'::jsonb)
    from public.sampling_jobs s join public.jobs j on j.id = s.job_id
   where s.client_id = any (v) and s.status not in ('requested', 'quoted', 'cancelled'));
end $$;
grant execute on function public.client_sampling_jobs() to authenticated;

create or replace function public._sj_client_job(p_job uuid) returns public.sampling_jobs
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null or x.client_id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if public._client_actor(x.client_id) <> 'approver' then raise exception 'Only approvers can decide this; ask your approver' using errcode = '42501'; end if;
  return x;
end $$;
revoke execute on function public._sj_client_job(uuid) from public, anon, authenticated;

-- r13: the client approves the sample quote and gives its PO number, or does not accept it (the supplier then re-quotes).
create or replace function public.client_sampling_quote_decide(p_job uuid, p_approve boolean, p_reason text default null, p_po text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs := public._sj_client_job(p_job);
begin
  if x.status <> 'awaiting_client' then raise exception 'This sample quote is not waiting for your decision'; end if;
  if p_approve is null then raise exception 'Choose approve or do not accept'; end if;
  if not p_approve and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Tell us why the quote is not accepted'; end if;
  if p_approve and x.quote_amount > 0 and coalesce(length(trim(p_po)), 0) < 2 then raise exception 'Enter your purchase order number for the sample'; end if;
  if length(coalesce(p_reason, '')) > 4000 or length(coalesce(p_po, '')) > 80 then raise exception 'That is too long'; end if;
  update public.sampling_jobs set client_decided_by = auth.uid(), client_decided_at = now(),
    status = case when p_approve then 'approved' else 'requested' end,
    client_po_number = case when p_approve then nullif(trim(p_po), '') else null end,
    client_reject_reason = case when p_approve then null else trim(p_reason) end where id = p_job;
  perform public._sj_event(p_job, case when p_approve then 'client_approved_quote' else 'client_rejected_quote' end, case when p_approve then coalesce('PO ' || nullif(trim(p_po), ''), '') else trim(p_reason) end);
  perform public.notify(x.requested_by, 'sourcing', case when p_approve then 'Client approved the sample quote' else 'Client did not accept the sample quote' end, x.job_number, '/rfq/' || x.rfq_id);
  if not p_approve then perform public.notify_supplier(x.supplier_id, 'vendor', 'Sample quote not accepted', left(trim(p_reason), 140), '/vendor/sampling'); end if;
end $$;
grant execute on function public.client_sampling_quote_decide(uuid, boolean, text, text) to authenticated;

-- r14: issue the sample PO. It goes to the supplier automatically.
create or replace function public.sampling_issue_po(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs; v_po text;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status <> 'approved' then raise exception 'The sample quote has to be approved before the sample PO is issued'; end if;
  v_po := 'SPO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sampling_po_no')::text, 5, '0');
  update public.sampling_jobs set status = 'po_issued', sample_po_number = v_po, po_issued_at = now(), po_valid = true where id = p_job;
  perform public._sj_event(p_job, 'po_issued', v_po);
  perform public.notify_supplier(x.supplier_id, 'vendor', 'Sample PO ' || v_po, x.description, '/vendor/sampling');
  return v_po;
end $$;
grant execute on function public.sampling_issue_po(uuid) to authenticated;

-- r18: send the technical drawing to the client for sign-off. Files are uploaded against the sampling job first (entity sampling_drawing).
create or replace function public.sampling_send_drawing(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status not in ('approved', 'po_issued', 'launched') then raise exception 'The drawing goes out once the sample quote is approved'; end if;
  if x.drawing_approved is true then raise exception 'The drawing is already signed off'; end if;
  if not exists (select 1 from public.files where entity_type = 'sampling_drawing' and entity_id = x.id::text) then raise exception 'Upload the technical drawing first'; end if;
  if x.client_id is null then raise exception 'This job has no client'; end if;
  update public.sampling_jobs set drawing_sent_at = now(), drawing_approved = null, drawing_decided_at = null, drawing_comment = null where id = p_job;
  perform public._sj_event(p_job, 'drawing_sent');
  perform public._sj_notify_client(x, 'Technical drawing to sign off', x.job_number || ': ' || x.description, 'approver');
end $$;
grant execute on function public.sampling_send_drawing(uuid) to authenticated;

create or replace function public.client_sampling_drawing_decide(p_job uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs := public._sj_client_job(p_job);
begin
  if x.drawing_sent_at is null or x.drawing_approved is not null then raise exception 'There is no drawing waiting for your sign-off'; end if;
  if p_approve is null then raise exception 'Choose sign off or ask for changes'; end if;
  if not p_approve and coalesce(length(trim(p_comment)), 0) < 3 then raise exception 'Tell us what to change on the drawing'; end if;
  update public.sampling_jobs set drawing_approved = p_approve, drawing_decided_by = auth.uid(), drawing_decided_at = now(), drawing_comment = nullif(trim(p_comment), '') where id = p_job;
  perform public._sj_event(p_job, case when p_approve then 'drawing_signed_off' else 'drawing_changes_requested' end, nullif(trim(p_comment), ''));
  perform public.notify(x.requested_by, 'sourcing', case when p_approve then 'Drawing signed off' else 'Changes asked on the drawing' end, x.job_number, '/rfq/' || x.rfq_id);
end $$;
grant execute on function public.client_sampling_drawing_decide(uuid, boolean, text) to authenticated;

-- The supplier's own sampling jobs. Never the client's details or other suppliers.
create or replace function public.vendor_sampling_jobs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'job_number', s.job_number, 'description', s.description, 'quantity', s.quantity, 'status', s.status,
      'round', s.round, 'quote_amount', s.quote_amount, 'quote_currency', s.quote_currency, 'quote_lead_days', s.quote_lead_days, 'client_reject_reason', s.client_reject_reason,
      'sample_po_number', s.sample_po_number, 'po_valid', s.po_valid, 'drawing_sent_at', s.drawing_sent_at, 'drawing_approved', s.drawing_approved,
      'carrier', s.carrier, 'tracking_number', s.tracking_number, 'invoice_ref', s.invoice_ref, 'review_note', s.review_note, 'client_sample_comment', s.client_sample_comment,
      'drawing_files', case when s.drawing_sent_at is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                          from public.files f where f.entity_type = 'sampling_drawing' and f.entity_id = s.id::text) else '[]'::jsonb end,
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                  from public.files f where f.entity_type = 'sampling_job' and f.entity_id = s.id::text and f.supplier_id = v_sup))
      order by (s.status in ('requested', 'po_issued', 'launched', 'rework')) desc, s.created_at desc), '[]'::jsonb)
    from public.sampling_jobs s where s.supplier_id = v_sup and s.status <> 'cancelled');
end $$;
grant execute on function public.vendor_sampling_jobs() to authenticated;

-- r16: confirm the sample launch, with photos or video uploaded against the job (entity sampling_job).
create or replace function public.vendor_sampling_launch(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); x public.sampling_jobs;
begin
  select * into x from public.sampling_jobs where id = p_job and supplier_id = v_sup for update;
  if x.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if x.status <> 'po_issued' or not x.po_valid then raise exception 'There is no sample PO to launch against'; end if;
  if x.drawing_sent_at is not null and x.drawing_approved is not true then raise exception 'The client has not signed off the technical drawing yet'; end if;
  if not exists (select 1 from public.files where entity_type = 'sampling_job' and entity_id = x.id::text and supplier_id = v_sup) then raise exception 'Upload photos or a video of the sample launch first'; end if;
  update public.sampling_jobs set status = 'launched', launched_at = now(), launch_note = nullif(trim(p_note), '') where id = p_job;
  perform public._sj_event(p_job, 'launched', nullif(trim(p_note), ''));
  perform public.notify(x.requested_by, 'sourcing', 'Sample launched', x.job_number, '/rfq/' || x.rfq_id);
end $$;
grant execute on function public.vendor_sampling_launch(uuid, text) to authenticated;

-- r20 / r19: send the sample with its invoice reference and tracking; also after rework (a new round).
create or replace function public.vendor_sampling_ship(p_job uuid, p_carrier text, p_tracking text, p_invoice_ref text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); x public.sampling_jobs;
begin
  select * into x from public.sampling_jobs where id = p_job and supplier_id = v_sup for update;
  if x.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if x.status not in ('launched', 'rework') or not x.po_valid then raise exception 'This sample is not ready to send'; end if;
  if coalesce(length(trim(p_tracking)), 0) < 3 then raise exception 'Add the tracking number'; end if;
  if coalesce(length(trim(p_invoice_ref)), 0) < 1 and x.quote_amount > 0 then raise exception 'Add your invoice number for the sample'; end if;
  update public.sampling_jobs set status = 'shipped', carrier = nullif(trim(p_carrier), ''), tracking_number = trim(p_tracking), invoice_ref = nullif(trim(p_invoice_ref), ''),
    ship_note = nullif(trim(p_note), ''), shipped_at = now(), round = case when x.status = 'rework' then x.round + 1 else x.round end,
    received_at = null, received_by = null, reviewed_at = null, reviewed_by = null, review_note = null, reception_notice = null,
    sent_to_client_at = null, client_sample_comment = null, client_sample_decided_at = null where id = p_job;
  perform public._sj_event(p_job, 'shipped', 'Tracking ' || trim(p_tracking));
  perform public.notify(x.requested_by, 'sourcing', 'Sample on its way', x.job_number || ', tracking ' || trim(p_tracking), '/rfq/' || x.rfq_id);
end $$;
grant execute on function public.vendor_sampling_ship(uuid, text, text, text, text) to authenticated;

create or replace function public.sampling_receive(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status <> 'shipped' then raise exception 'The supplier has not sent this sample yet'; end if;
  update public.sampling_jobs set status = 'received', received_at = now(), received_by = auth.uid() where id = p_job;
  perform public._sj_event(p_job, 'received', nullif(trim(p_note), ''));
end $$;
grant execute on function public.sampling_receive(uuid, text) to authenticated;

-- r21 to r23: is the sample OK? OK raises the reception notice; not OK invalidates the sample PO (a reason is needed).
create or replace function public.sampling_review(p_job uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs; v_notice text;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status <> 'received' then raise exception 'Confirm that the sample has arrived first'; end if;
  if p_ok is null then raise exception 'Say whether the sample is OK'; end if;
  if not p_ok and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say why the sample is rejected'; end if;
  if p_ok then
    v_notice := 'SRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sampling_notice_no')::text, 5, '0');
    update public.sampling_jobs set status = 'accepted', review_note = nullif(trim(p_note), ''), reviewed_at = now(), reviewed_by = auth.uid(), reception_notice = v_notice where id = p_job;
    perform public._sj_event(p_job, 'sample_ok', 'Reception notice ' || v_notice);
  else
    update public.sampling_jobs set status = 'rejected', po_valid = false, review_note = trim(p_note), reviewed_at = now(), reviewed_by = auth.uid() where id = p_job;
    perform public._sj_event(p_job, 'sample_rejected', trim(p_note) || ' (sample PO ' || coalesce(x.sample_po_number, '') || ' invalidated)');
    perform public.notify_supplier(x.supplier_id, 'vendor', 'Sample rejected: PO ' || coalesce(x.sample_po_number, '') || ' invalidated', left(trim(p_note), 140), '/vendor/sampling');
  end if;
end $$;
grant execute on function public.sampling_review(uuid, boolean, text) to authenticated;

-- r22: an accepted sample goes on to the client.
create or replace function public.sampling_send_to_client(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status <> 'accepted' then raise exception 'Only a sample that passed the internal check can go to the client'; end if;
  if x.client_id is null then raise exception 'This job has no client'; end if;
  update public.sampling_jobs set status = 'with_client', sent_to_client_at = now() where id = p_job;
  perform public._sj_event(p_job, 'sent_to_client');
  perform public._sj_notify_client(x, 'Sample for your approval', x.job_number || ': ' || x.description, 'approver');
end $$;
grant execute on function public.sampling_send_to_client(uuid) to authenticated;

-- r24 / r19: the client approves the sample, or asks for rework (the supplier then sends a new one).
create or replace function public.client_sampling_sample_decide(p_job uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs := public._sj_client_job(p_job);
begin
  if x.status <> 'with_client' then raise exception 'This sample is not waiting for your decision'; end if;
  if p_approve is null then raise exception 'Choose approve or ask for rework'; end if;
  if not p_approve and coalesce(length(trim(p_comment)), 0) < 3 then raise exception 'Tell us what to rework'; end if;
  update public.sampling_jobs set status = case when p_approve then 'client_approved' else 'rework' end, client_sample_comment = nullif(trim(p_comment), ''),
    client_sample_decided_at = now(), client_sample_decided_by = auth.uid() where id = p_job;
  perform public._sj_event(p_job, case when p_approve then 'client_approved_sample' else 'client_asked_rework' end, nullif(trim(p_comment), ''));
  perform public.notify(x.requested_by, 'sourcing', case when p_approve then 'Client approved the sample' else 'Client asked for rework on the sample' end, x.job_number, '/rfq/' || x.rfq_id);
  if not p_approve then perform public.notify_supplier(x.supplier_id, 'vendor', 'Rework needed on the sample', left(trim(p_comment), 140), '/vendor/sampling'); end if;
end $$;
grant execute on function public.client_sampling_sample_decide(uuid, boolean, text) to authenticated;

create or replace function public.sampling_cancel(p_job uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.sampling_jobs;
begin
  perform public._sj_internal();
  select * into x from public.sampling_jobs where id = p_job for update;
  if x.id is null then raise exception 'Sampling job not found'; end if;
  if x.status in ('shipped', 'received', 'accepted', 'with_client', 'client_approved', 'rejected', 'cancelled') then raise exception 'A % sampling job can no longer be cancelled', replace(x.status, '_', ' '); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Say why the sampling job is cancelled'; end if;
  update public.sampling_jobs set status = 'cancelled', cancelled_reason = trim(p_reason), po_valid = false where id = p_job;
  perform public._sj_event(p_job, 'cancelled', trim(p_reason));
  perform public.notify_supplier(x.supplier_id, 'vendor', 'Sampling job cancelled', left(trim(p_reason), 140), '/vendor/sampling');
end $$;
grant execute on function public.sampling_cancel(uuid, text) to authenticated;

-- The RFQ page: every sampling job on it with its history and files.
create or replace function public.sampling_jobs_internal(p_rfq uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._sj_internal();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'job_number', s.job_number, 'supplier_id', s.supplier_id, 'supplier_name', su.name, 'description', s.description,
      'quantity', s.quantity, 'status', s.status, 'round', s.round, 'quote_amount', s.quote_amount, 'quote_currency', s.quote_currency, 'quote_lead_days', s.quote_lead_days,
      'quote_note', s.quote_note, 'client_approval_required', s.client_approval_required, 'client_po_number', s.client_po_number, 'client_reject_reason', s.client_reject_reason,
      'sample_po_number', s.sample_po_number, 'po_valid', s.po_valid, 'drawing_sent_at', s.drawing_sent_at, 'drawing_approved', s.drawing_approved, 'drawing_comment', s.drawing_comment,
      'carrier', s.carrier, 'tracking_number', s.tracking_number, 'invoice_ref', s.invoice_ref, 'review_note', s.review_note, 'reception_notice', s.reception_notice,
      'client_sample_comment', s.client_sample_comment, 'cancelled_reason', s.cancelled_reason,
      'drawing_files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb) from public.files f where f.entity_type = 'sampling_drawing' and f.entity_id = s.id::text),
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb) from public.files f where f.entity_type = 'sampling_job' and f.entity_id = s.id::text),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'detail', e.detail, 'at', e.at) order by e.id), '[]'::jsonb) from public.sampling_events e where e.sampling_job_id = s.id))
      order by s.created_at desc), '[]'::jsonb)
    from public.sampling_jobs s join public.suppliers su on su.id = s.supplier_id where s.rfq_id = p_rfq);
end $$;
grant execute on function public.sampling_jobs_internal(uuid) to authenticated;

-- Files: the client opens the drawing once it is sent and the sample photos once the sample has been sent to it; the supplier the drawing for its own job.
create or replace function public.file_content(p_id uuid)
returns table (file_name text, content_type text, content_b64 text, storage_path text)
language sql stable security definer set search_path = public as $$
  select f.file_name, f.content_type, encode(f.content, 'base64'), f.storage_path from public.files f
  where f.id = p_id and (public.is_internal() or (f.supplier_id is not null and f.supplier_id = public.my_supplier_id())
    or exists (select 1 from public.po_proofs pr join public.purchase_orders po on po.id = pr.po_id join public.jobs j on j.id = po.job_id
                where f.entity_type = 'po_proof' and f.entity_id = pr.id::text and pr.sent_to_client_at is not null
                  and j.client_id in (select public.my_client_ids()))
    or exists (select 1 from public.brief_deliveries d join public.briefs b on b.id = d.brief_id
                where f.entity_type = 'brief_delivery' and f.entity_id = d.id::text and d.status = 'sent'
                  and public._brief_client(b) in (select public.my_client_ids()))
    or exists (select 1 from public.sampling_jobs s
                where s.id::text = f.entity_id
                  and ((f.entity_type = 'sampling_drawing' and s.drawing_sent_at is not null and (s.client_id in (select public.my_client_ids()) or s.supplier_id = public.my_supplier_id()))
                    or (f.entity_type = 'sampling_job' and s.sent_to_client_at is not null and s.client_id in (select public.my_client_ids())))));
$$;
