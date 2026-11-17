-- Automated document checks (Vendor Sys G deck): when a vendor or colleague uploads a certificate or a compliance document, the file is
-- read (OCR for scans and images, text extraction otherwise, done by the platform runner) and checked against what was declared.
-- The checks only assist the reviewer. They never verify or reject anything: a person still decides, and nobody checks their own upload.
-- Rules (all run here so they are testable): the document is readable; the certificate number, expiry date, certificate type and company
-- name appear in it; the same file has not been uploaded for another company (a fraud signal) or twice for this one.

create table public.document_checks (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('certificate', 'document')),
  subject_id uuid not null,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  engine text, attempts int not null default 0, error text,
  extracted_text text, text_length int,
  file_hash text,
  outcome text check (outcome in ('clear', 'review', 'fail')),
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), checked_at timestamptz, updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);
create index dc_queue_idx on public.document_checks (status, created_at);
alter table public.document_checks enable row level security;
create policy dc_read on public.document_checks for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.document_checks from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Text helpers
-- ---------------------------------------------------------------------------
create or replace function public._dc_norm(p text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(p, '')), '[\W_]+', '', 'g');
$$;

-- Company names without the legal suffix, so "Alpha Print Ltd" matches a certificate that says "Alpha Print Limited".
create or replace function public._dc_company_norm(p text) returns text language sql immutable as $$
  select public._dc_norm(regexp_replace(lower(coalesce(p, '')), '\m(ltd|limited|gmbh|sa|inc|llc|co|corp|corporation|pty|plc|bv|ag|srl|sdn|bhd|pte|company)\M\.?', ' ', 'g'));
$$;

create or replace function public._dc_safe_date(y int, m int, d int) returns date language plpgsql immutable as $$
begin
  if y < 1990 or y > 2100 then return null; end if;
  return make_date(y, m, d);
exception when others then return null;
end $$;

-- Every date that can be read out of the text: 2026-03-15, 15/03/2026 (and 03/15/2026 when ambiguous), 15 March 2026, March 15, 2026.
create or replace function public._dc_dates(p text) returns date[] language plpgsql immutable as $$
declare m text[]; out date[] := '{}'; v date; mon int;
  months text[] := array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
begin
  for m in select regexp_matches(coalesce(p, ''), '(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', 'g') loop
    v := public._dc_safe_date(m[1]::int, m[2]::int, m[3]::int); if v is not null then out := out || v; end if;
  end loop;
  for m in select regexp_matches(coalesce(p, ''), '(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})', 'g') loop
    v := public._dc_safe_date(m[3]::int, m[2]::int, m[1]::int); if v is not null then out := out || v; end if;
    v := public._dc_safe_date(m[3]::int, m[1]::int, m[2]::int); if v is not null then out := out || v; end if;
  end loop;
  for m in select regexp_matches(lower(coalesce(p, '')), '(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})', 'g') loop
    mon := array_position(months, m[2]); v := public._dc_safe_date(m[3]::int, mon, m[1]::int); if v is not null then out := out || v; end if;
  end loop;
  for m in select regexp_matches(lower(coalesce(p, '')), '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})', 'g') loop
    mon := array_position(months, m[1]); v := public._dc_safe_date(m[3]::int, mon, m[2]::int); if v is not null then out := out || v; end if;
  end loop;
  return (select coalesce(array_agg(distinct d order by d), '{}') from unnest(out) d);
end $$;

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------
create or replace function public._dc_evaluate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.document_checks; v_text text; v_norm text; v_f jsonb := '[]'::jsonb; v_out text;
  cert record; sup record; v_dates date[]; v_names text[]; v_ok boolean; v_other text;
begin
  select * into c from public.document_checks where id = p_id for update;
  if c.id is null then return; end if;
  v_text := coalesce(c.extracted_text, ''); v_norm := public._dc_norm(v_text); v_dates := public._dc_dates(v_text);
  select s.name, sp.legal_entity, sp.trading_name into sup from public.suppliers s left join public.supplier_profiles sp on sp.supplier_id = s.id where s.id = c.supplier_id;

  -- 1. Readable
  if length(regexp_replace(v_text, '[^[:alpha:]]', '', 'g')) < 40 then
    v_f := v_f || jsonb_build_object('rule', 'readable', 'result', 'warn', 'detail', 'Little or no text could be read from this file. Check it by eye, or ask for a clearer copy.');
  else
    v_f := v_f || jsonb_build_object('rule', 'readable', 'result', 'pass', 'detail', 'Text was read from the file.');
  end if;

  if c.subject_type = 'certificate' then
    select sc.cert_number, sc.expiry_date, lr.name as type_name into cert from public.supplier_certificates sc join public.library_records lr on lr.id = sc.cert_type_id where sc.id = c.subject_id;
    -- 2. Certificate number
    if coalesce(trim(cert.cert_number), '') <> '' then
      v_ok := position(public._dc_norm(cert.cert_number) in v_norm) > 0;
      v_f := v_f || jsonb_build_object('rule', 'cert_number', 'result', case when v_ok then 'pass' else 'warn' end,
        'detail', case when v_ok then format('Certificate number %s found.', cert.cert_number) else format('Certificate number %s was not found in the document.', cert.cert_number) end);
    end if;
    -- 3. Expiry date
    if cert.expiry_date is not null then
      v_ok := cert.expiry_date = any (v_dates);
      v_f := v_f || jsonb_build_object('rule', 'expiry_date', 'result', case when v_ok then 'pass' else 'warn' end,
        'detail', case when v_ok then format('Expiry date %s found.', cert.expiry_date)
                       when cardinality(v_dates) = 0 then format('Declared expiry %s, but no dates could be read.', cert.expiry_date)
                       else format('Declared expiry %s was not found. Dates in the document: %s.', cert.expiry_date, (select string_agg(to_char(d, 'DD Mon YYYY'), ', ') from (select d from unnest(v_dates) d limit 6) q)) end);
    end if;
    -- 4. Certificate type
    v_ok := position(public._dc_norm(cert.type_name) in v_norm) > 0;
    v_f := v_f || jsonb_build_object('rule', 'cert_type', 'result', case when v_ok then 'pass' else 'warn' end,
      'detail', case when v_ok then format('"%s" found.', cert.type_name) else format('"%s" was not found in the document.', cert.type_name) end);
  end if;

  -- 5. Company name
  v_names := array_remove(array[public._dc_company_norm(sup.name), public._dc_company_norm(sup.legal_entity), public._dc_company_norm(sup.trading_name)], null);
  v_names := array(select n from unnest(v_names) n where length(n) >= 3);
  if cardinality(v_names) > 0 then
    v_ok := exists (select 1 from unnest(v_names) n where position(n in v_norm) > 0);
    v_f := v_f || jsonb_build_object('rule', 'company_name', 'result', case when v_ok then 'pass' else 'warn' end,
      'detail', case when v_ok then 'The company name appears in the document.' else format('The company name (%s) was not found in the document.', sup.name) end);
  end if;

  -- 6. The same file elsewhere (works on the file itself, with or without readable text)
  if c.file_hash is not null then
    select s.name into v_other from public.files f join public.suppliers s on s.id = f.supplier_id
     where f.id <> c.file_id and f.supplier_id <> c.supplier_id and f.content is not null and encode(sha256(f.content), 'hex') = c.file_hash limit 1;
    if v_other is not null then
      v_f := v_f || jsonb_build_object('rule', 'duplicate_other', 'result', 'fail', 'detail', format('This exact file has also been uploaded for %s.', v_other));
    elsif exists (select 1 from public.files f where f.id <> c.file_id and f.supplier_id = c.supplier_id and f.content is not null and encode(sha256(f.content), 'hex') = c.file_hash) then
      v_f := v_f || jsonb_build_object('rule', 'duplicate_same', 'result', 'warn', 'detail', 'This exact file was already uploaded by this vendor.');
    else
      v_f := v_f || jsonb_build_object('rule', 'duplicate', 'result', 'pass', 'detail', 'This file has not been uploaded for any other company.');
    end if;
  end if;

  v_out := case when exists (select 1 from jsonb_array_elements(v_f) x where x->>'result' = 'fail') then 'fail'
                when exists (select 1 from jsonb_array_elements(v_f) x where x->>'result' = 'warn') then 'review' else 'clear' end;
  update public.document_checks set findings = v_f, outcome = v_out, checked_at = now(), updated_at = now() where id = p_id;
end $$;
revoke execute on function public._dc_evaluate(uuid), public._dc_norm(text), public._dc_company_norm(text), public._dc_safe_date(int, int, int), public._dc_dates(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queueing on upload
-- ---------------------------------------------------------------------------
create or replace function public._dc_enqueue(p_type text, p_subject uuid, p_supplier uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_file uuid; v_hash text;
begin
  if p_path is null or p_path !~ '^files/[0-9a-f-]{36}$' then return; end if;
  v_file := substring(p_path from 7)::uuid;
  if not exists (select 1 from public.files where id = v_file) then return; end if;
  select encode(sha256(content), 'hex') into v_hash from public.files where id = v_file and content is not null;
  insert into public.document_checks (subject_type, subject_id, supplier_id, file_id, file_hash)
  values (p_type, p_subject, p_supplier, v_file, v_hash)
  on conflict (subject_type, subject_id) do update set file_id = excluded.file_id, file_hash = excluded.file_hash, status = 'queued', attempts = 0, error = null,
    extracted_text = null, text_length = null, outcome = null, findings = '[]'::jsonb, checked_at = null, updated_at = now();
end $$;
revoke execute on function public._dc_enqueue(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public._dc_trg_cert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.not_applicable then perform public._dc_enqueue('certificate', new.id, new.supplier_id, new.document_path); end if;
  return null;
end $$;
create or replace function public._dc_trg_doc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._dc_enqueue('document', new.id, new.supplier_id, new.file_path);
  return null;
end $$;
revoke execute on function public._dc_trg_cert(), public._dc_trg_doc() from public, anon, authenticated;
create trigger dc_cert after insert or update of document_path, cert_number, expiry_date, cert_type_id on public.supplier_certificates for each row execute function public._dc_trg_cert();
create trigger dc_doc after insert or update of file_path on public.supplier_documents for each row execute function public._dc_trg_doc();

-- ---------------------------------------------------------------------------
-- Runner (service only) and reviewers
-- ---------------------------------------------------------------------------
create or replace function public.docchecks_claim(p_limit int default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.document_checks where (status = 'queued') or (status = 'running' and updated_at < now() - interval '10 minutes')
     order by created_at limit greatest(1, least(coalesce(p_limit, 10), 50)) for update skip locked) q;
  update public.document_checks set status = 'running', attempts = attempts + 1, updated_at = now() where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_id', d.file_id, 'file_name', f.file_name, 'content_type', f.content_type, 'storage_path', f.storage_path, 'attempts', d.attempts) order by d.created_at)
    from public.document_checks d left join public.files f on f.id = d.file_id where d.id = any (v_ids)), '[]'::jsonb);
end $$;

create or replace function public.docchecks_file(p_id uuid) returns text
language sql security definer set search_path = public as $$
  select encode(f.content, 'base64') from public.document_checks d join public.files f on f.id = d.file_id where d.id = p_id;
$$;

-- ok: the engine returned text (possibly little). Not ok: retry up to three times, then record the failure and check what can be checked without text.
create or replace function public.docchecks_result(p_id uuid, p_ok boolean, p_engine text default null, p_text text default null, p_error text default null, p_permanent boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c public.document_checks;
begin
  select * into c from public.document_checks where id = p_id for update;
  if c.id is null then return; end if;
  if p_ok then
    update public.document_checks set status = 'done', engine = p_engine, extracted_text = left(coalesce(p_text, ''), 200000), text_length = length(coalesce(p_text, '')), error = null, updated_at = now() where id = p_id;
  elsif p_permanent or c.attempts >= 3 then
    update public.document_checks set status = 'failed', engine = p_engine, error = left(coalesce(p_error, 'The file could not be read'), 500), extracted_text = '', text_length = 0, updated_at = now() where id = p_id;
  else
    update public.document_checks set status = 'queued', error = left(coalesce(p_error, 'Will retry'), 500), updated_at = now() where id = p_id;
    return;
  end if;
  perform public._dc_evaluate(p_id);
end $$;
revoke execute on function public.docchecks_claim(int), public.docchecks_file(uuid), public.docchecks_result(uuid, boolean, text, text, text, boolean) from public, anon, authenticated;

-- What reviewers see next to each item in the queue (never the extracted text).
create or replace function public.docchecks_for(p_type text, p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  return coalesce((select jsonb_agg(jsonb_build_object('subject_id', subject_id, 'status', status, 'outcome', outcome, 'findings', findings, 'engine', engine, 'error', error, 'checked_at', checked_at))
    from public.document_checks where subject_type = p_type and subject_id = any (p_ids)), '[]'::jsonb);
end $$;

create or replace function public.docchecks_rerun(p_type text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  update public.document_checks set status = 'queued', attempts = 0, error = null, outcome = null, findings = '[]'::jsonb, checked_at = null, updated_at = now() where subject_type = p_type and subject_id = p_id;
  if not found then raise exception 'There is no uploaded file to check'; end if;
end $$;
revoke execute on function public.docchecks_for(text, uuid[]), public.docchecks_rerun(text, uuid) from public, anon;
grant execute on function public.docchecks_for(text, uuid[]), public.docchecks_rerun(text, uuid) to authenticated;

-- Check what is already waiting for review.
select public._dc_enqueue('certificate', id, supplier_id, document_path) from public.supplier_certificates where verification_status = 'pending' and not not_applicable;
select public._dc_enqueue('document', id, supplier_id, file_path) from public.supplier_documents where status = 'pending';
