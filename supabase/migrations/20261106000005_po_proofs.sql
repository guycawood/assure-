-- Proofs, from the Global Business Transformation "QA and QC inspection" process (steps e to i):
--   e  the supplier has the final artwork and launches a proof or sample
--   f  digital: upload it on the platform;  f1 physical: send it to client services, upload an image and the tracking number
--   f2 client services check dimensions and material (physical) or the digital proof, then send it to the client
--   g  the client approves the proof;  h the approval is recorded and the a/i team and the supplier are told
--   i  the supplier launches production based on the approved proof
-- A purchase order cannot start production until a proof is approved, unless staff waive the proof with a reason
-- (a repeat or catalogue order, for example). Each change after a rejection is a new round; earlier rounds stay on record.

create table public.po_proofs (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  round int not null,
  kind text not null check (kind in ('digital', 'physical')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'with_client', 'client_approved', 'changes_requested')),
  supplier_note text,
  tracking_number text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  cs_checked_by uuid references public.profiles(id) on delete set null,
  cs_checked_at timestamptz,
  cs_note text,
  sent_to_client_at timestamptz,
  client_decided_by uuid references public.profiles(id) on delete set null,
  client_decided_at timestamptz,
  client_comment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (po_id, round)
);
create index po_proofs_po_idx on public.po_proofs (po_id, round);
alter table public.po_proofs enable row level security;
create policy po_proofs_read on public.po_proofs for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.po_proofs from authenticated, anon;

alter table public.purchase_orders
  add column if not exists proof_waived boolean not null default false,
  add column if not exists proof_waived_reason text,
  add column if not exists proof_waived_by uuid references public.profiles(id) on delete set null,
  add column if not exists production_started_at timestamptz,
  add column if not exists production_started_by uuid references public.profiles(id) on delete set null;

-- e / f / f1: the supplier starts a proof round (digital or physical) on an accepted order.
create or replace function public.vendor_proof_start(p_po uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); p public.purchase_orders; v_round int; v_id uuid;
begin
  if p_kind not in ('digital', 'physical') then raise exception 'Choose a digital or a physical proof'; end if;
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.supplier_id is distinct from v_sup or p.status <> 'accepted' then raise exception 'Purchase order not found' using errcode = '42501'; end if;
  if p.production_started_at is not null then raise exception 'Production has already started on this order'; end if;
  if exists (select 1 from public.po_proofs where po_id = p_po and status = 'client_approved') then raise exception 'A proof is already approved on this order'; end if;
  if exists (select 1 from public.po_proofs where po_id = p_po and status in ('draft', 'submitted', 'with_client')) then raise exception 'A proof is already in progress on this order'; end if;
  select coalesce(max(round), 0) + 1 into v_round from public.po_proofs where po_id = p_po;
  insert into public.po_proofs (po_id, round, kind, created_by) values (p_po, v_round, p_kind, auth.uid()) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.vendor_proof_start(uuid, text) to authenticated;

-- The supplier sends the proof: at least one file uploaded to it; a physical proof also needs its tracking number.
create or replace function public.vendor_proof_submit(p_proof uuid, p_tracking text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); pr public.po_proofs; p public.purchase_orders; j public.jobs; v_files int;
begin
  select * into pr from public.po_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'Proof not found' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = pr.po_id;
  if p.supplier_id is distinct from v_sup then raise exception 'Proof not found' using errcode = '42501'; end if;
  if pr.status <> 'draft' then raise exception 'This proof has already been sent'; end if;
  select count(*) into v_files from public.files where entity_type = 'po_proof' and entity_id = pr.id::text;
  if v_files = 0 then raise exception 'Upload the proof (a file or an image) first'; end if;
  if pr.kind = 'physical' and coalesce(trim(p_tracking), '') = '' then raise exception 'Add the tracking number of the physical proof'; end if;
  update public.po_proofs set status = 'submitted', tracking_number = nullif(trim(p_tracking), ''), supplier_note = nullif(trim(p_note), ''),
    submitted_at = now(), submitted_by = auth.uid() where id = p_proof;
  select * into j from public.jobs where id = p.job_id;
  perform public._sourcing_event(p.job_id, 'po', p.id, 'proof_submitted', jsonb_build_object('proof', pr.id, 'round', pr.round, 'kind', pr.kind));
  if j.manager is not null then
    perform public.notify(j.manager, 'orders', format('Proof %s round %s to check: %s', pr.kind, pr.round, p.po_number), left(coalesce(nullif(trim(p_note), ''), 'The supplier has sent a proof.'), 140), '/orders/purchase-orders/' || p.id);
  end if;
end $$;
grant execute on function public.vendor_proof_submit(uuid, text, text) to authenticated;

-- f2 / client services: check the proof and send it to the client (a digital proof goes automatically; a physical one is dated).
create or replace function public.proof_cs_review(p_proof uuid, p_ok boolean, p_note text default null, p_sent_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.po_proofs; p public.purchase_orders;
begin
  if not public.is_internal() then raise exception 'Only staff can check a proof' using errcode = '42501'; end if;
  select * into pr from public.po_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'Proof not found'; end if;
  if pr.status <> 'submitted' then raise exception 'This proof is not waiting to be checked'; end if;
  select * into p from public.purchase_orders where id = pr.po_id;
  if p_ok then
    if pr.kind = 'physical' and p_sent_on is null then raise exception 'Record the date the physical proof was sent to the client'; end if;
    update public.po_proofs set status = 'with_client', cs_checked_by = auth.uid(), cs_checked_at = now(), cs_note = nullif(trim(p_note), ''),
      sent_to_client_at = coalesce(p_sent_on::timestamptz, now()) where id = p_proof;
    perform public._sourcing_event(p.job_id, 'po', p.id, 'proof_sent_to_client', jsonb_build_object('proof', pr.id, 'round', pr.round, 'kind', pr.kind));
  else
    if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Tell the supplier what to correct'; end if;
    update public.po_proofs set status = 'changes_requested', cs_checked_by = auth.uid(), cs_checked_at = now(), cs_note = trim(p_note) where id = p_proof;
    perform public._sourcing_event(p.job_id, 'po', p.id, 'proof_rejected_by_cs', jsonb_build_object('proof', pr.id, 'round', pr.round, 'note', trim(p_note)));
  end if;
end $$;
grant execute on function public.proof_cs_review(uuid, boolean, text, date) to authenticated;

-- g / h: the client's approver approves the proof or asks for changes; the supplier and the a/i team are told.
create or replace function public.client_proof_decide(p_proof uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.po_proofs; p public.purchase_orders; j public.jobs; s public.suppliers; v_name text;
begin
  select * into pr from public.po_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'Proof not found' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = pr.po_id;
  select * into j from public.jobs where id = p.job_id;
  if public._client_actor(j.client_id) <> 'approver' then raise exception 'Only approvers can approve or reject proofs; ask your approver' using errcode = '42501'; end if;
  if pr.status <> 'with_client' then raise exception 'This proof is not waiting for your decision'; end if;
  if p_approve is null then raise exception 'Choose approve or request changes'; end if;
  if not p_approve and coalesce(length(trim(p_comment)), 0) < 3 then raise exception 'Tell us what needs to change'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Keep the comment under 4,000 characters'; end if;
  update public.po_proofs set status = case when p_approve then 'client_approved' else 'changes_requested' end,
    client_decided_by = auth.uid(), client_decided_at = now(), client_comment = nullif(trim(p_comment), '') where id = p_proof;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public._sourcing_event(p.job_id, 'po', p.id, case when p_approve then 'proof_approved' else 'proof_changes_requested' end,
    jsonb_build_object('proof', pr.id, 'round', pr.round, 'comment', nullif(trim(p_comment), ''), 'by', v_name, 'via', 'client_portal'));
  if j.manager is not null then
    perform public.notify(j.manager, 'orders', format('%s %s the proof on %s', v_name, case when p_approve then 'approved' else 'asked for changes to' end, p.po_number),
      left(coalesce(nullif(trim(p_comment), ''), ''), 140), '/orders/purchase-orders/' || p.id);
  end if;
  select * into s from public.suppliers where id = p.supplier_id;
  if s.primary_contact_email is not null then
    insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
    values (s.primary_contact_email, case when p_approve then 'Proof approved: ' else 'Proof needs changes: ' end || p.po_number,
      case when p_approve then format('The client approved proof round %s on %s. You can launch production in your vendor portal.', pr.round, p.po_number)
           else format('The client asked for changes to proof round %s on %s: %s', pr.round, p.po_number, coalesce(nullif(trim(p_comment), ''), 'see the portal')) end,
      s.id, auth.uid());
  end if;
end $$;
grant execute on function public.client_proof_decide(uuid, boolean, text) to authenticated;

-- i: the supplier launches production. Needs an approved proof, or a waiver from staff.
create or replace function public.po_vendor_start_production(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.supplier_id is distinct from v_sup or p.status <> 'accepted' then raise exception 'Purchase order not found' using errcode = '42501'; end if;
  if p.production_started_at is not null then raise exception 'Production has already been launched on this order'; end if;
  if not p.proof_waived and not exists (select 1 from public.po_proofs where po_id = p_po and status = 'client_approved') then
    raise exception 'Production can start once the client has approved a proof';
  end if;
  update public.purchase_orders set production_started_at = now(), production_started_by = auth.uid() where id = p_po;
  perform public._sourcing_event(p.job_id, 'po', p.id, 'production_launched', jsonb_build_object('proof_waived', p.proof_waived));
end $$;
grant execute on function public.po_vendor_start_production(uuid) to authenticated;

-- Staff can waive the proof step for an order (repeat or catalogue order, no artwork): a reason is required and kept.
create or replace function public.po_proof_waive(p_po uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders;
begin
  if not public.is_internal() then raise exception 'Only staff can waive a proof' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null then raise exception 'Purchase order not found'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Say why no proof is needed'; end if;
  if p.production_started_at is not null then raise exception 'Production has already started'; end if;
  update public.purchase_orders set proof_waived = true, proof_waived_reason = trim(p_reason), proof_waived_by = auth.uid() where id = p_po;
  perform public._sourcing_event(p.job_id, 'po', p.id, 'proof_waived', jsonb_build_object('reason', trim(p_reason)));
end $$;
grant execute on function public.po_proof_waive(uuid, text) to authenticated;

-- Reads. Staff see every round of a PO; the vendor sees its own; the client sees proofs from the point they are sent to it.
create or replace function public._proof_json(pr public.po_proofs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pr.id, 'po_id', pr.po_id, 'round', pr.round, 'kind', pr.kind, 'status', pr.status, 'supplier_note', pr.supplier_note,
    'tracking_number', pr.tracking_number, 'submitted_at', pr.submitted_at, 'cs_note', pr.cs_note, 'cs_checked_at', pr.cs_checked_at,
    'sent_to_client_at', pr.sent_to_client_at, 'client_comment', pr.client_comment, 'client_decided_at', pr.client_decided_at,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.file_name, 'type', f.content_type) order by f.created_at), '[]'::jsonb)
                from public.files f where f.entity_type = 'po_proof' and f.entity_id = pr.id::text));
$$;

create or replace function public.po_proofs_internal(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.purchase_orders;
begin
  if not public.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po;
  return jsonb_build_object('proof_waived', p.proof_waived, 'proof_waived_reason', p.proof_waived_reason, 'production_started_at', p.production_started_at,
    'rounds', (select coalesce(jsonb_agg(public._proof_json(x) order by x.round), '[]'::jsonb) from public.po_proofs x where x.po_id = p_po));
end $$;
grant execute on function public.po_proofs_internal(uuid) to authenticated;

create or replace function public.vendor_po_proofs(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.purchase_orders; v_sup uuid := public.my_supplier_id();
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null or v_sup is null or p.supplier_id <> v_sup or public.is_internal() then raise exception 'Purchase order not found' using errcode = '42501'; end if;
  return jsonb_build_object('proof_waived', p.proof_waived, 'production_started_at', p.production_started_at,
    'rounds', (select coalesce(jsonb_agg(public._proof_json(x) order by x.round), '[]'::jsonb) from public.po_proofs x where x.po_id = p_po));
end $$;
grant execute on function public.vendor_po_proofs(uuid) to authenticated;

create or replace function public.client_portal_proofs(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(public._proof_json(x) || jsonb_build_object('po_number', p.po_number, 'job_id', j.id, 'job_number', j.job_number, 'title', j.title,
            'client_id', j.client_id, 'role', case when public.is_internal() then 'preview' else public.my_client_role(j.client_id) end)
            order by (x.status = 'with_client') desc, coalesce(x.sent_to_client_at, x.created_at) desc), '[]'::jsonb)
    from public.po_proofs x join public.purchase_orders p on p.id = x.po_id join public.jobs j on j.id = p.job_id
   where j.client_id = any (v) and x.sent_to_client_at is not null);
end $$;
grant execute on function public.client_portal_proofs(uuid) to authenticated;

-- Clients may open the files of a proof once it has been sent to them.
create or replace function public.file_content(p_id uuid)
returns table (file_name text, content_type text, content_b64 text, storage_path text)
language sql stable security definer set search_path = public as $$
  select f.file_name, f.content_type, encode(f.content, 'base64'), f.storage_path from public.files f
  where f.id = p_id and (public.is_internal() or (f.supplier_id is not null and f.supplier_id = public.my_supplier_id())
    or exists (select 1 from public.po_proofs pr join public.purchase_orders po on po.id = pr.po_id join public.jobs j on j.id = po.job_id
                where f.entity_type = 'po_proof' and f.entity_id = pr.id::text and pr.sent_to_client_at is not null
                  and j.client_id in (select public.my_client_ids())));
$$;
