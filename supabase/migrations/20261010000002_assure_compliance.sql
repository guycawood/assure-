-- Assure+ compliance: certificates per supplier and the document review queue.
-- Certificate types come from the Watchtower library 'certification_types'.
-- Expiry rule (one rule everywhere): expired when the expiry date has passed; expiring_soon within 90 days; otherwise valid.
-- Verification is a decision: only staff verify or reject, never the person who uploaded, and vendors never.

create or replace function public.assure_expiry_status(p_expiry date, p_on date default current_date)
returns text language sql immutable as $$
  select case when p_expiry is null then 'no_expiry'
              when p_expiry < p_on then 'expired'
              when p_expiry <= p_on + 90 then 'expiring_soon'
              else 'valid' end;
$$;

-- ---------------------------------------------------------------------------
-- Certificates
-- ---------------------------------------------------------------------------
create table public.supplier_certificates (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  cert_type_id uuid not null references public.library_records(id),
  region text,
  market text,
  cert_number text,
  issuer text,
  issue_date date,
  expiry_date date,
  audit_score numeric(5,2) check (audit_score is null or audit_score between 0 and 100),
  document_path text,
  not_applicable boolean not null default false,
  -- decision fields: only via assure_review_certificate()
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  -- internal only
  internal_notes text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_role text not null default 'internal' check (uploaded_by_role in ('internal','vendor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create index supplier_certificates_supplier_idx on public.supplier_certificates (supplier_id);
create index supplier_certificates_expiry_idx on public.supplier_certificates (expiry_date);

create trigger supplier_certificates_region before insert on public.supplier_certificates
  for each row execute function public._assure_fill_region_market();

create or replace function public._cert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.library_records where id = new.cert_type_id and library_key = 'certification_types') then
    raise exception 'Choose a certificate type from the certification types library';
  end if;
  if current_setting('assure.system_write', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending'; new.verified_by := null; new.verified_at := null; new.rejection_reason := null;
    new.uploaded_by := auth.uid(); new.uploaded_by_role := 'internal';
  else
    new.verification_status := old.verification_status; new.verified_by := old.verified_by;
    new.verified_at := old.verified_at; new.rejection_reason := old.rejection_reason;
    new.uploaded_by := old.uploaded_by; new.uploaded_by_role := old.uploaded_by_role;
    new.supplier_id := old.supplier_id;
    -- Changing the evidence or dates of a verified certificate sends it back for checking.
    if old.verification_status = 'verified' and (new.expiry_date is distinct from old.expiry_date
        or new.issue_date is distinct from old.issue_date or new.document_path is distinct from old.document_path
        or new.cert_type_id is distinct from old.cert_type_id) then
      new.verification_status := 'pending'; new.verified_by := null; new.verified_at := null;
    end if;
    if new.expiry_date is distinct from old.expiry_date then
      perform public._assure_log(new.supplier_id, 'certificate', new.id, 'expiry_changed', old.expiry_date::text, new.expiry_date::text, 'Certificate expiry date changed', null);
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger supplier_certificates_guard before insert or update on public.supplier_certificates
  for each row execute function public._cert_guard();

create or replace function public._cert_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
  values (new.cert_type_id, 'supplier_certificates', new.id::text, null) on conflict do nothing;
  if tg_op = 'INSERT' then
    perform public._assure_log(new.supplier_id, 'certificate', new.id, 'added', null, new.verification_status,
      'Certificate added: ' || coalesce((select name from public.library_records where id = new.cert_type_id), 'certificate'),
      case when new.uploaded_by_role = 'vendor' then 'Uploaded by the vendor' end);
  end if;
  return null;
end $$;
create trigger supplier_certificates_after after insert or update of cert_type_id on public.supplier_certificates
  for each row execute function public._cert_after();

alter table public.supplier_certificates enable row level security;
create policy cert_read on public.supplier_certificates for select to authenticated using (public.is_internal());
create policy cert_insert on public.supplier_certificates for insert to authenticated with check (public.is_internal());
create policy cert_update on public.supplier_certificates for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy cert_delete on public.supplier_certificates for delete to authenticated using (public.is_admin());

-- Staff view with the computed status and type name.
create view public.supplier_certificates_v with (security_invoker = true) as
  select c.*, lr.code as cert_type_code, lr.name as cert_type_name,
         case when c.not_applicable then 'not_applicable'
              when c.verification_status = 'rejected' then 'rejected'
              when c.verification_status = 'pending' then 'pending'
              else public.assure_expiry_status(c.expiry_date) end as status,
         public.assure_expiry_status(c.expiry_date) as expiry_status,
         (c.expiry_date - current_date) as days_left
    from public.supplier_certificates c
    join public.library_records lr on lr.id = c.cert_type_id;

-- Vendor view: their own certificates, no internal notes or reviewer identity.
create view public.vendor_certificates as
  select c.id, c.supplier_id, lr.name as cert_type_name, c.cert_number, c.issuer, c.issue_date, c.expiry_date,
         c.document_path, c.verification_status, c.rejection_reason, c.uploaded_by_role, c.created_at,
         public.assure_expiry_status(c.expiry_date) as expiry_status
    from public.supplier_certificates c
    join public.library_records lr on lr.id = c.cert_type_id
   where c.supplier_id = public.my_supplier_id();
revoke all on public.vendor_certificates from anon;
grant select on public.vendor_certificates to authenticated;

-- Certificate types a vendor may choose from (the library itself is staff-only).
create view public.vendor_certificate_types as
  select id, code, name, data from public.library_records
   where library_key = 'certification_types' and status = 'active' and public.my_supplier_id() is not null;
revoke all on public.vendor_certificate_types from anon;
grant select on public.vendor_certificate_types to authenticated;

-- Vendor upload: always arrives pending.
create or replace function public.assure_vendor_add_certificate(p_cert_type uuid, p_cert_number text, p_issuer text,
  p_issue date, p_expiry date, p_document_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); v_id uuid;
begin
  if v_sup is null or public.is_internal() then raise exception 'Only a vendor user can upload a certificate here' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_document_path, '')), '') is null then raise exception 'Attach the certificate document'; end if;
  perform set_config('assure.system_write', 'on', true);
  insert into public.supplier_certificates (supplier_id, cert_type_id, cert_number, issuer, issue_date, expiry_date, document_path,
                                            verification_status, uploaded_by, uploaded_by_role)
  values (v_sup, p_cert_type, nullif(trim(p_cert_number), ''), nullif(trim(p_issuer), ''), p_issue, p_expiry, p_document_path,
          'pending', auth.uid(), 'vendor')
  returning id into v_id;
  perform set_config('assure.system_write', 'off', true);
  return v_id;
end $$;

-- Verify / reject. Staff only; never the uploader.
create or replace function public.assure_review_certificate(p_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.supplier_certificates;
begin
  perform public._assure_require_internal();
  if p_decision not in ('verify','reject') then raise exception 'Choose verify or reject'; end if;
  select * into c from public.supplier_certificates where id = p_id for update;
  if not found then raise exception 'Certificate not found'; end if;
  if c.uploaded_by = auth.uid() then raise exception 'You uploaded this certificate, so someone else must check it' using errcode = '42501'; end if;
  if p_decision = 'reject' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A rejection needs a reason the vendor can act on'; end if;
  if p_decision = 'verify' and c.expiry_date is not null and c.expiry_date < current_date then
    raise exception 'This certificate has expired; ask for the renewed one instead of verifying it';
  end if;
  perform set_config('assure.system_write', 'on', true);
  update public.supplier_certificates set
    verification_status = case when p_decision = 'verify' then 'verified' else 'rejected' end,
    verified_by = auth.uid(), verified_at = now(),
    rejection_reason = case when p_decision = 'reject' then trim(p_reason) end
  where id = p_id;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(c.supplier_id, 'certificate', p_id, p_decision, c.verification_status,
    case when p_decision = 'verify' then 'verified' else 'rejected' end, 'Certificate ' || p_decision || 'ed', nullif(trim(p_reason), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Supplier documents (vendor uploads and staff uploads) and the review queue
-- ---------------------------------------------------------------------------
create table public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  doc_type text not null check (doc_type in ('grn','bill_of_lading','invoice','delivery_note','customs_declaration','quality_certificate',
                                             'packing_list','proof_of_delivery','insurance','nda','policy','contract','other')),
  title text not null check (length(trim(title)) > 0),
  file_path text not null,
  po_reference text,
  -- decision fields: only via assure_review_document()
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_role text not null default 'internal' check (uploaded_by_role in ('internal','vendor')),
  created_at timestamptz not null default now()
);
create index supplier_documents_supplier_idx on public.supplier_documents (supplier_id, created_at desc);
create index supplier_documents_pending_idx on public.supplier_documents (status) where status = 'pending';
create trigger supplier_documents_region before insert on public.supplier_documents
  for each row execute function public._assure_fill_region_market();

create or replace function public._doc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) = 'on' then return new; end if;
  new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.uploaded_by := auth.uid();
  new.uploaded_by_role := case when public.is_internal() then 'internal' else 'vendor' end;
  if new.uploaded_by_role = 'vendor' and new.supplier_id is distinct from public.my_supplier_id() then
    raise exception 'You can only upload documents for your own company' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger supplier_documents_guard before insert on public.supplier_documents
  for each row execute function public._doc_guard();

alter table public.supplier_documents enable row level security;
create policy doc_read on public.supplier_documents for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy doc_insert on public.supplier_documents for insert to authenticated
  with check (public.is_internal() or supplier_id = public.my_supplier_id());
revoke update on public.supplier_documents from authenticated, anon;
create policy doc_delete on public.supplier_documents for delete to authenticated using (public.is_admin());

create or replace function public.assure_review_document(p_id uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.supplier_documents;
begin
  perform public._assure_require_internal();
  if p_decision not in ('verify','reject') then raise exception 'Choose verify or reject'; end if;
  select * into d from public.supplier_documents where id = p_id for update;
  if not found then raise exception 'Document not found'; end if;
  if d.status <> 'pending' then raise exception 'This document has already been reviewed'; end if;
  if d.uploaded_by = auth.uid() then raise exception 'You uploaded this document, so someone else must check it' using errcode = '42501'; end if;
  if p_decision = 'reject' and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'A rejection needs a reason the vendor can act on'; end if;
  perform set_config('assure.system_write', 'on', true);
  update public.supplier_documents set status = case when p_decision = 'verify' then 'verified' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(d.supplier_id, 'document', p_id, p_decision, 'pending',
    case when p_decision = 'verify' then 'verified' else 'rejected' end, d.title, nullif(trim(p_note), ''));
end $$;

revoke execute on function public._cert_guard(), public._cert_after(), public._doc_guard() from public, anon, authenticated;
grant execute on function public.assure_expiry_status(date, date), public.assure_vendor_add_certificate(uuid, text, text, date, date, text),
  public.assure_review_certificate(uuid, text, text), public.assure_review_document(uuid, text, text) to authenticated;
