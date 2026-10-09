-- Finance+: quote and estimate approvals, supplier invoices with a server-side three-way match (PO value, Logistics+
-- deliveries with verified POD, Execution+ installs), maker-checker approval of unmatched invoices, payment schedules
-- with a cash-out forecast, client billing from approved estimates and spend / savings reporting.
-- Rebuilt from the Base44 finance pages (FinanceHome, QuoteApprovals, Invoice, Bill, PaymentScheduleItem, paymentTerms) with:
--   * every write through checked security-definer functions (tables are read-only to users, RLS on every table);
--   * finance access = the same check RFQ+ uses for quote approval (sourcing_is_finance: srt_role 'finance',
--     Sourcing+ finance access, or admin);
--   * vendors only through finance_vendor_* functions scoped to my_supplier_id(), the PO they own, and their team permission;
--   * every invoice transition written to append-only finance_events in the same transaction and the supplier notified;
--   * tolerances, default terms and review thresholds in the Watchtower library finance_rules (FR-*).

-- ---------------------------------------------------------------------------
-- Library owned by Finance+
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('finance_rules', 'finance', 'Finance rules',
   'Numbers Finance+ runs on: invoice match tolerance (FR-TOL), default supplier payment terms (FR-TERMS), the "due soon" window (FR-DUE-WINDOW), client payment terms (FR-CLIENT-TERMS) and when an estimate needs a finance review (FR-MIN-MARGIN, FR-REVIEW-VALUE). Each record keeps its number in data.value.',
   true, 1)
on conflict (key) do nothing;

-- Value of a finance rule in force on a date, or the default when no record is set up.
create or replace function public._finance_rule(p_code text, p_date date, p_default numeric)
returns table (value numeric, record_id uuid, version int, basis text)
language plpgsql stable security definer set search_path = public as $$
declare r public.library_records;
begin
  r := public.library_effective('finance_rules', p_code, coalesce(p_date, current_date));
  if r.id is null or (r.data->>'value') is null then
    return query select p_default, null::uuid, null::int, format('No %s record in force; default %s used', p_code, p_default);
  else
    return query select (r.data->>'value')::numeric, r.id, r.version, format('%s v%s (%s)', r.code, r.version, r.name);
  end if;
end $$;

-- Same value for internal readers (views and pages); vendors get nothing (tolerances are internal).
create or replace function public.finance_rule_value(p_code text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_internal() then (select value from public._finance_rule(p_code, current_date, p_default)) end;
$$;

-- ---------------------------------------------------------------------------
-- Business numbers
-- ---------------------------------------------------------------------------
create sequence public.finance_invoice_seq;
create sequence public.client_bill_seq;

create or replace function public._finance_number(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval(
    case p_prefix when 'FI' then 'public.finance_invoice_seq' when 'CB' then 'public.client_bill_seq' end::regclass
  )::text, 5, '0');
$$;

-- Market code (and its region) from a PO / job market, which may hold a code or a market name.
create or replace function public._finance_market(p_market text) returns table (market text, region text)
language sql stable security definer set search_path = public as $$
  select code, region_code from public.markets where code = upper(trim(p_market)) or lower(name) = lower(trim(p_market)) limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Estimate finance reviews (RFQ quotes use rfq_responses.finance_status via rfq_finance_decide)
-- ---------------------------------------------------------------------------
create table public.estimate_finance_reviews (
  estimate_id uuid primary key references public.estimates(id) on delete cascade,
  status text not null check (status in ('approved','declined')),
  reason text,
  sell_price_at_review numeric(14,2) not null,
  base_cost_at_review numeric(14,2) not null,
  decided_by uuid not null references public.profiles(id),
  decided_at timestamptz not null default now(),
  check (status = 'approved' or coalesce(trim(reason), '') <> '')
);

-- ---------------------------------------------------------------------------
-- Supplier invoices
-- ---------------------------------------------------------------------------
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_ref text not null unique,                       -- our number FI-YYYY-NNNNN
  po_id uuid not null references public.purchase_orders(id),
  supplier_id uuid not null references public.suppliers(id),
  job_id uuid not null references public.jobs(id),
  invoice_number text not null check (length(trim(invoice_number)) between 1 and 60),  -- the supplier's own number
  invoice_date date not null,
  payment_terms text not null,
  payment_terms_days int not null check (payment_terms_days between 0 and 365),
  due_date date not null,
  currency text not null,
  net_amount numeric(14,2) not null check (net_amount > 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  gross_amount numeric(14,2) generated always as (net_amount + vat_amount) stored,
  file_id uuid references public.files(id),
  status text not null default 'submitted' check (status in ('submitted','matching','approved','scheduled','paid','disputed','rejected')),
  match_status text not null default 'not_run' check (match_status in ('not_run','matched','variance','missing_evidence')),
  match_details jsonb not null default '{}'::jsonb,
  matched_at timestamptz,
  matched_by uuid references public.profiles(id),
  tolerance_record_id uuid references public.library_records(id),
  override_reason text,
  override_requested_by uuid references public.profiles(id),
  override_requested_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  approval_note text,
  dispute_reason text,
  rejected_reason text,
  paid_at timestamptz,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  submitted_by uuid references public.profiles(id),
  submitted_by_vendor boolean not null default true,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= invoice_date)
);
-- Invoice number is unique per supplier (a rejected invoice frees its number for a corrected resubmission).
create unique index supplier_invoices_number_uq on public.supplier_invoices (supplier_id, lower(trim(invoice_number))) where status <> 'rejected';
create index supplier_invoices_po_idx on public.supplier_invoices (po_id);
create index supplier_invoices_status_idx on public.supplier_invoices (status, due_date);

create or replace function public.trg_supplier_invoices_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.invoice_ref := public._finance_number('FI');
  else
    new.invoice_ref := old.invoice_ref; new.po_id := old.po_id; new.supplier_id := old.supplier_id; new.job_id := old.job_id;
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at; new.updated_at := now();
  end if;
  return new;
end $$;
create trigger supplier_invoices_before before insert or update on public.supplier_invoices for each row execute function public.trg_supplier_invoices_before();

-- Payment schedule: one or more instalments per invoice. Status (upcoming / due / overdue / paid) is derived from dates in v_payment_schedule.
create table public.payment_schedule_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id),
  seq int not null check (seq > 0),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null,
  paid_at timestamptz,
  paid_on date,
  paid_by uuid references public.profiles(id),
  payment_reference text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (invoice_id, seq),
  check ((paid_at is null) = (payment_reference is null))
);
create index payment_schedule_due_idx on public.payment_schedule_items (due_date) where paid_at is null;

-- ---------------------------------------------------------------------------
-- Client bills (from approved estimates)
-- ---------------------------------------------------------------------------
create table public.client_bills (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique,
  estimate_id uuid not null references public.estimates(id),
  job_id uuid not null references public.jobs(id),
  client_id uuid not null references public.sourcing_clients(id),
  billing_entity_id uuid references public.sourcing_billing_entities(id),
  client_order_ref text,
  currency text not null,
  net_amount numeric(14,2) not null check (net_amount >= 0),
  vat_percent numeric(5,2) not null default 0 check (vat_percent between 0 and 100),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  gross_amount numeric(14,2) generated always as (net_amount + vat_amount) stored,
  cost_amount numeric(14,2),
  status text not null default 'draft' check (status in ('draft','sent','paid','cancelled')),
  issue_date date,
  due_date date,
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  payment_reference text,
  cancelled_reason text,
  notes text,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index client_bills_one_live_per_estimate on public.client_bills (estimate_id) where status <> 'cancelled';

create or replace function public.trg_client_bills_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.bill_number := public._finance_number('CB');
  else new.bill_number := old.bill_number; new.estimate_id := old.estimate_id; new.created_by := old.created_by; new.updated_at := now();
  end if;
  return new;
end $$;
create trigger client_bills_before before insert or update on public.client_bills for each row execute function public.trg_client_bills_before();

-- ---------------------------------------------------------------------------
-- Append-only audit for Finance+
-- ---------------------------------------------------------------------------
create table public.finance_events (
  id bigint generated always as identity primary key,
  entity text not null check (entity in ('invoice','payment','bill','estimate','quote')),
  entity_id uuid not null,
  invoice_id uuid references public.supplier_invoices(id),
  event text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id),
  at timestamptz not null default now()
);
create index finance_events_entity_idx on public.finance_events (entity, entity_id, at desc);

create or replace function public.trg_finance_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'Finance events are append-only';
end $$;
create trigger finance_events_append_only before update or delete on public.finance_events
  for each row execute function public.trg_finance_events_append_only();

create or replace function public._finance_event(p_entity text, p_id uuid, p_invoice uuid, p_event text, p_from text, p_to text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.finance_events (entity, entity_id, invoice_id, event, from_status, to_status, detail, actor)
  values (p_entity, p_id, p_invoice, p_event, p_from, p_to, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- Same rule as RFQ+ quote approval (rfq_finance_decide), and never a vendor.
create or replace function public._finance_require() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() or public.my_supplier_id() is not null or not public.sourcing_is_finance() then
    raise exception 'Only Finance can do this' using errcode = '42501';
  end if;
end $$;

create or replace function public.finance_is_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal() and public.my_supplier_id() is null and public.sourcing_is_finance();
$$;

create or replace function public._finance_notify_supplier(i public.supplier_invoices, p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  select public.notify_supplier(i.supplier_id, 'finance', p_title, p_body, '/vendor');
$$;

-- Payment terms for a supplier: Assure+ supplier profile, else FR-TERMS (default net 30).
create or replace function public._finance_terms(p_supplier uuid, p_date date) returns table (terms text, days int)
language plpgsql stable security definer set search_path = public as $$
declare sp public.supplier_profiles; d numeric;
begin
  select * into sp from public.supplier_profiles where supplier_id = p_supplier;
  if sp.supplier_id is not null then
    return query select sp.payment_terms, case sp.payment_terms when 'immediate' then 0 when 'custom' then coalesce(sp.payment_terms_days, 30)
      else replace(sp.payment_terms, 'net_', '')::int end;
    return;
  end if;
  select value into d from public._finance_rule('FR-TERMS', p_date, 30);
  return query select 'net_' || d::int::text, d::int;
end $$;

-- ---------------------------------------------------------------------------
-- Three-way match (no permission check; callers check). Stores the result on the invoice and returns it.
--   1. amount: everything invoiced on the PO (this invoice + other live invoices) must not exceed the PO value by more
--      than the FR-TOL tolerance in force on the invoice date (part-invoicing below the PO value is fine);
--   2. Logistics+: the PO has deliveries, each delivered, with every POD verified;
--   3. Execution+: where the PO has installs, each is installed (audit not failed) or audited and passed.
-- Result: variance (amount fails) > missing_evidence (2 or 3 fails) > matched.
-- ---------------------------------------------------------------------------
create or replace function public._finance_compute_match(p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices; p public.purchase_orders; tol record; v_other numeric; v_total numeric; v_var numeric; v_pct numeric;
  v_amount_ok boolean; n_del int; n_delivered int; n_pod_open int; v_del_items jsonb; v_del_ok boolean;
  n_dep int; n_dep_ok int; v_dep_items jsonb; v_dep_ok boolean; v_result text; v_details jsonb; v_missing text[] := '{}';
begin
  select * into i from public.supplier_invoices where id = p_invoice for update;
  select * into p from public.purchase_orders where id = i.po_id;
  select * into tol from public._finance_rule('FR-TOL', i.invoice_date, 0);

  select coalesce(sum(net_amount), 0) into v_other from public.supplier_invoices
   where po_id = i.po_id and id <> i.id and status <> 'rejected';
  v_total := v_other + i.net_amount;
  v_var := round(v_total - p.total_value, 2);
  v_pct := case when p.total_value > 0 then round(100 * v_var / p.total_value, 2) end;
  v_amount_ok := v_total <= round(p.total_value * (1 + tol.value / 100), 2);

  select count(*), count(*) filter (where d.status = 'delivered'),
         coalesce(sum((select count(*) from public.shipments s where s.delivery_id = d.id and s.pod_status <> 'verified')), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'delivery_number', d.delivery_number, 'status', d.status, 'market', d.market,
           'pods_total', (select count(*) from public.shipments s where s.delivery_id = d.id),
           'pods_verified', (select count(*) from public.shipments s where s.delivery_id = d.id and s.pod_status = 'verified'))
           order by d.delivery_number), '[]'::jsonb)
    into n_del, n_delivered, n_pod_open, v_del_items
    from public.deliveries d where d.po_id = i.po_id and d.status <> 'cancelled';
  v_del_ok := n_del > 0 and n_delivered = n_del and n_pod_open = 0;
  if n_del = 0 then v_missing := v_missing || 'No deliveries recorded in Logistics+'::text;
  elsif n_delivered < n_del then v_missing := v_missing || format('%s of %s deliveries not delivered yet', n_del - n_delivered, n_del);
  end if;
  if n_pod_open > 0 then v_missing := v_missing || format('%s POD(s) not verified', n_pod_open); end if;

  select count(*),
         count(*) filter (where (dp.stage = 'installed' and dp.audit_status <> 'failed') or (dp.stage = 'audited' and dp.audit_status = 'passed')),
         coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'deployment_code', dp.deployment_code, 'stage', dp.stage, 'audit_status', dp.audit_status)
           order by dp.deployment_code), '[]'::jsonb)
    into n_dep, n_dep_ok, v_dep_items
    from public.deployments dp where dp.po_id = i.po_id;
  v_dep_ok := n_dep = n_dep_ok;
  if not v_dep_ok then v_missing := v_missing || format('%s of %s installs not installed or not passed audit', n_dep - n_dep_ok, n_dep); end if;

  v_result := case when not v_amount_ok then 'variance' when not (v_del_ok and v_dep_ok) then 'missing_evidence' else 'matched' end;
  v_details := jsonb_build_object(
    'checked_at', now(), 'result', v_result,
    'amount', jsonb_build_object('po_value', p.total_value, 'currency', p.currency, 'invoice_net', i.net_amount, 'other_invoiced', v_other,
       'invoiced_total', v_total, 'variance', v_var, 'variance_percent', v_pct, 'tolerance_percent', tol.value, 'tolerance_basis', tol.basis,
       'remaining_to_invoice', greatest(p.total_value - v_total, 0), 'ok', v_amount_ok),
    'deliveries', jsonb_build_object('count', n_del, 'delivered', n_delivered, 'pods_unverified', n_pod_open, 'ok', v_del_ok, 'items', v_del_items),
    'deployments', jsonb_build_object('count', n_dep, 'done', n_dep_ok, 'ok', v_dep_ok, 'applies', n_dep > 0, 'items', v_dep_items),
    'missing', to_jsonb(v_missing));
  update public.supplier_invoices set match_status = v_result, match_details = v_details, matched_at = now(), matched_by = auth.uid(),
    tolerance_record_id = tol.record_id where id = p_invoice;
  if tol.record_id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (tol.record_id, 'supplier_invoices', p_invoice::text, i.invoice_ref) on conflict do nothing;
  end if;
  return v_details;
end $$;

-- ---------------------------------------------------------------------------
-- Vendor functions (vendor portal)
-- ---------------------------------------------------------------------------
-- The vendor first uploads the PDF with file_register('finance', 'purchase_order', <po id>, null, ...), then submits here.
create or replace function public.finance_vendor_submit_invoice(p_po uuid, p_number text, p_date date, p_net numeric, p_vat numeric,
  p_currency text, p_file_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); p public.purchase_orders; f public.files; t record; m record; v_id uuid; v_ref text;
begin
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.supplier_id is distinct from v_sup or p.status not in ('issued','accepted','declined') then
    raise exception 'Purchase order not found' using errcode = '42501';
  end if;
  if p.status <> 'accepted' then raise exception 'Accept the purchase order before invoicing it'; end if;
  if coalesce(trim(p_number), '') = '' then raise exception 'Enter your invoice number'; end if;
  if p_date is null or p_date > current_date then raise exception 'The invoice date can''t be in the future'; end if;
  if p_net is null or p_net <= 0 then raise exception 'Enter the net amount (above zero)'; end if;
  if coalesce(p_vat, 0) < 0 then raise exception 'VAT can''t be negative'; end if;
  if upper(trim(coalesce(p_currency, ''))) <> p.currency then raise exception 'Invoice in the PO currency (%)', p.currency; end if;
  if exists (select 1 from public.supplier_invoices where supplier_id = v_sup and lower(trim(invoice_number)) = lower(trim(p_number)) and status <> 'rejected') then
    raise exception 'You have already sent an invoice numbered %', trim(p_number);
  end if;
  select * into f from public.files where id = p_file_id;
  if f.id is null or f.supplier_id is distinct from v_sup then raise exception 'Upload the invoice PDF first'; end if;
  if f.entity_type = 'supplier_invoice' or exists (select 1 from public.supplier_invoices where file_id = p_file_id) then
    raise exception 'That file is already attached to another invoice';
  end if;
  select * into t from public._finance_terms(v_sup, p_date);
  select * into m from public._finance_market(p.market);
  if m.market is null then raise exception 'Market "%" on the PO is not in the market master data', p.market; end if;
  insert into public.supplier_invoices (po_id, supplier_id, job_id, invoice_number, invoice_date, payment_terms, payment_terms_days, due_date,
    currency, net_amount, vat_amount, file_id, region, market, submitted_by, submitted_by_vendor)
  values (p_po, v_sup, p.job_id, trim(p_number), p_date, t.terms, t.days, p_date + t.days, p.currency, round(p_net, 2), round(coalesce(p_vat, 0), 2),
    p_file_id, m.region, m.market, auth.uid(), true)
  returning id, invoice_ref into v_id, v_ref;
  update public.files set entity_type = 'supplier_invoice', entity_id = v_id::text, label = coalesce(label, 'Invoice') where id = p_file_id;
  perform public._finance_event('invoice', v_id, v_id, 'submitted', null, 'submitted',
    jsonb_build_object('invoice_number', trim(p_number), 'po_number', p.po_number, 'net', p_net, 'vat', coalesce(p_vat, 0), 'by_vendor', true));
  perform public.notify_role('finance', 'finance', 'Supplier invoice to match',
    format('%s sent invoice %s for %s %s on %s.', (select name from public.suppliers where id = v_sup), trim(p_number), p.currency, round(p_net + coalesce(p_vat, 0), 2), p.po_number),
    '/finance/invoices/' || v_id);
  perform public.notify_supplier(v_sup, 'finance', 'Invoice received',
    format('We have your invoice %s for %s (our reference %s). Payment is due by %s once it is matched and approved.', trim(p_number), p.po_number, v_ref, to_char(p_date + t.days, 'DD Mon YYYY')), '/vendor');
  return v_id;
end $$;

-- The vendor's own invoices: status, amounts, due date, payments. Never match details, override notes or approvers.
create or replace function public.finance_vendor_invoices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'invoice_ref', i.invoice_ref, 'invoice_number', i.invoice_number, 'po_id', i.po_id, 'po_number', p.po_number,
    'invoice_date', i.invoice_date, 'due_date', i.due_date, 'payment_terms', i.payment_terms, 'currency', i.currency,
    'net_amount', i.net_amount, 'vat_amount', i.vat_amount, 'gross_amount', i.gross_amount, 'file_id', i.file_id,
    'status', case when i.status = 'matching' then 'in_review' else i.status end,
    'reason', case i.status when 'disputed' then i.dispute_reason when 'rejected' then i.rejected_reason end,
    'submitted_at', i.submitted_at, 'paid_at', i.paid_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('seq', s.seq, 'due_date', s.due_date, 'amount', s.amount, 'paid_on', s.paid_on,
        'payment_reference', s.payment_reference, 'status', case when s.paid_at is not null then 'paid' when s.due_date < current_date then 'overdue' else 'scheduled' end)
        order by s.seq) from public.payment_schedule_items s where s.invoice_id = i.id), '[]'::jsonb)
  ) order by i.submitted_at desc), '[]'::jsonb)
  from public.supplier_invoices i join public.purchase_orders p on p.id = i.po_id
  where public.my_supplier_id() is not null and i.supplier_id = public.my_supplier_id();
$$;

-- POs the vendor can invoice (accepted), with what has been invoiced so far.
create or replace function public.finance_vendor_invoiceable_pos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'po_number', p.po_number, 'job_number', j.job_number, 'title', j.title, 'currency', p.currency,
    'total_value', p.total_value, 'po_date', p.po_date,
    'invoiced', coalesce((select sum(net_amount) from public.supplier_invoices i where i.po_id = p.id and i.status <> 'rejected'), 0),
    'payment_terms', (select terms from public._finance_terms(p.supplier_id, current_date))) order by p.po_date desc), '[]'::jsonb)
  from public.purchase_orders p join public.jobs j on j.id = p.job_id
  where public.my_supplier_id() is not null and p.supplier_id = public.my_supplier_id() and p.status = 'accepted';
$$;

-- ---------------------------------------------------------------------------
-- Internal invoice workflow (Finance only)
-- ---------------------------------------------------------------------------
create or replace function public.finance_match_invoice(p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices; v jsonb;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status not in ('submitted','matching') then raise exception 'Only a submitted invoice or one in matching can be matched (it is %)', i.status; end if;
  v := public._finance_compute_match(p_invoice);
  -- A fresh match clears any earlier override request: the evidence it was based on may have changed.
  update public.supplier_invoices set status = 'matching', override_reason = null, override_requested_by = null, override_requested_at = null where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'matched', i.status, 'matching',
    jsonb_build_object('result', v->>'result', 'variance', v->'amount'->'variance', 'missing', v->'missing'));
  if i.status = 'submitted' then
    perform public._finance_notify_supplier(i, 'Invoice in review', format('Finance is checking your invoice %s against the PO and delivery records.', i.invoice_number));
  end if;
  return v;
end $$;

-- Maker: a finance user records why an unmatched invoice should be paid anyway. A different finance user must approve it.
create or replace function public.finance_request_override(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status <> 'matching' then raise exception 'Run the match first'; end if;
  if i.match_status = 'matched' then raise exception 'This invoice matched, so it needs no override'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this invoice should be approved without a full match'; end if;
  update public.supplier_invoices set override_reason = trim(p_reason), override_requested_by = auth.uid(), override_requested_at = now() where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'override_requested', i.status, i.status,
    jsonb_build_object('reason', trim(p_reason), 'match_status', i.match_status));
end $$;

create or replace function public.finance_approve_invoice(p_invoice uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status <> 'matching' then raise exception 'Only an invoice in matching can be approved (it is %)', i.status; end if;
  if i.match_status = 'not_run' then raise exception 'Run the three-way match first'; end if;
  if i.match_status <> 'matched' then
    if i.override_requested_by is null then
      raise exception 'The match shows %: record an override reason first; a different finance user then approves it', replace(i.match_status, '_', ' ');
    end if;
    if i.override_requested_by = auth.uid() then
      raise exception 'You recorded the override, so a different finance user must approve it' using errcode = '42501';
    end if;
  end if;
  update public.supplier_invoices set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), '') where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'approved', i.status, 'approved',
    jsonb_build_object('match_status', i.match_status, 'override', i.match_status <> 'matched', 'override_reason', i.override_reason,
      'override_by', i.override_requested_by, 'note', nullif(trim(p_note), '')));
  perform public._finance_notify_supplier(i, 'Invoice approved', format('Your invoice %s is approved for payment, due by %s.', i.invoice_number, to_char(i.due_date, 'DD Mon YYYY')));
end $$;

create or replace function public.finance_dispute_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status not in ('submitted','matching') then raise exception 'Only an invoice waiting for approval can be disputed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say what is wrong so the supplier can fix it'; end if;
  update public.supplier_invoices set status = 'disputed', dispute_reason = trim(p_reason) where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'disputed', i.status, 'disputed', jsonb_build_object('reason', trim(p_reason)));
  perform public._finance_notify_supplier(i, 'Invoice queried', format('Finance has a question on invoice %s: %s', i.invoice_number, trim(p_reason)));
end $$;

create or replace function public.finance_resolve_dispute(p_invoice uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices; v jsonb;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null or i.status <> 'disputed' then raise exception 'This invoice is not disputed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say how the query was resolved'; end if;
  v := public._finance_compute_match(p_invoice);
  update public.supplier_invoices set status = 'matching', override_reason = null, override_requested_by = null, override_requested_at = null where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'dispute_resolved', 'disputed', 'matching', jsonb_build_object('note', trim(p_note), 'result', v->>'result'));
  perform public._finance_notify_supplier(i, 'Invoice query resolved', format('The query on invoice %s is resolved and it is back in review.', i.invoice_number));
  return v;
end $$;

create or replace function public.finance_reject_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status not in ('submitted','matching','disputed') then raise exception 'Only an invoice that is not yet approved can be rejected'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the invoice is rejected'; end if;
  update public.supplier_invoices set status = 'rejected', rejected_reason = trim(p_reason) where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'rejected', i.status, 'rejected', jsonb_build_object('reason', trim(p_reason)));
  perform public._finance_notify_supplier(i, 'Invoice rejected', format('Invoice %s was rejected: %s. Send a corrected invoice from the portal.', i.invoice_number, trim(p_reason)));
end $$;

-- p_items: [{"due_date":"2026-11-30","amount":1200.00}, ...] summing to the gross amount; null = one payment of the gross on the due date.
create or replace function public.finance_schedule_payment(p_invoice uuid, p_items jsonb default null) returns int
language plpgsql security definer set search_path = public as $$
declare i public.supplier_invoices; x jsonb; n int := 0; v_sum numeric := 0; v_date date; v_amt numeric;
begin
  perform public._finance_require();
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Invoice not found'; end if;
  if i.status <> 'approved' then raise exception 'Approve the invoice before scheduling payment'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    p_items := jsonb_build_array(jsonb_build_object('due_date', i.due_date, 'amount', i.gross_amount));
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    v_date := (nullif(x->>'due_date', ''))::date;
    v_amt := round((nullif(x->>'amount', ''))::numeric, 2);
    if v_date is null then raise exception 'Payment %: choose a date', n; end if;
    if v_date < i.invoice_date then raise exception 'Payment %: can''t be before the invoice date', n; end if;
    if v_amt is null or v_amt <= 0 then raise exception 'Payment %: enter an amount above zero', n; end if;
    insert into public.payment_schedule_items (invoice_id, seq, due_date, amount, currency, created_by) values (p_invoice, n, v_date, v_amt, i.currency, auth.uid());
    v_sum := v_sum + v_amt;
  end loop;
  if v_sum <> i.gross_amount then raise exception 'The payments add up to % but the invoice is % %', v_sum, i.currency, i.gross_amount; end if;
  update public.supplier_invoices set status = 'scheduled' where id = p_invoice;
  perform public._finance_event('invoice', p_invoice, p_invoice, 'payment_scheduled', 'approved', 'scheduled', jsonb_build_object('payments', n, 'items', p_items));
  perform public._finance_notify_supplier(i, 'Payment scheduled', format('Payment for invoice %s is scheduled: %s.', i.invoice_number,
    (select string_agg(to_char(due_date, 'DD Mon YYYY') || ' ' || currency || ' ' || amount, ', ' order by seq) from public.payment_schedule_items where invoice_id = p_invoice)));
  return n;
end $$;

create or replace function public.finance_mark_paid(p_item uuid, p_reference text, p_paid_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.payment_schedule_items; i public.supplier_invoices; v_open int; v_on date := coalesce(p_paid_on, current_date);
begin
  perform public._finance_require();
  select * into s from public.payment_schedule_items where id = p_item for update;
  if s.id is null then raise exception 'Payment not found'; end if;
  if s.paid_at is not null then raise exception 'This payment is already marked paid'; end if;
  select * into i from public.supplier_invoices where id = s.invoice_id for update;
  if i.status <> 'scheduled' then raise exception 'The invoice is not scheduled for payment'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'Enter the payment reference'; end if;
  if v_on > current_date then raise exception 'The payment date can''t be in the future'; end if;
  update public.payment_schedule_items set paid_at = now(), paid_on = v_on, paid_by = auth.uid(), payment_reference = trim(p_reference) where id = p_item;
  perform public._finance_event('payment', p_item, i.id, 'paid', null, null, jsonb_build_object('seq', s.seq, 'amount', s.amount, 'reference', trim(p_reference), 'paid_on', v_on));
  select count(*) into v_open from public.payment_schedule_items where invoice_id = i.id and paid_at is null;
  if v_open = 0 then
    update public.supplier_invoices set status = 'paid', paid_at = now() where id = i.id;
    perform public._finance_event('invoice', i.id, i.id, 'paid', 'scheduled', 'paid', jsonb_build_object('reference', trim(p_reference)));
  end if;
  perform public._finance_notify_supplier(i, case when v_open = 0 then 'Invoice paid' else 'Payment made' end,
    format('We paid %s %s against invoice %s (reference %s).', s.currency, s.amount, i.invoice_number, trim(p_reference)));
end $$;

-- ---------------------------------------------------------------------------
-- Estimate finance review
-- ---------------------------------------------------------------------------
create or replace function public.finance_estimate_decide(p_estimate uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  perform public._finance_require();
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status not in ('draft','sent') then raise exception 'Only a draft or sent estimate can be reviewed'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'Say why Finance is declining the estimate'; end if;
  insert into public.estimate_finance_reviews (estimate_id, status, reason, sell_price_at_review, base_cost_at_review, decided_by, decided_at)
  values (p_estimate, case when p_approve then 'approved' else 'declined' end, nullif(trim(p_reason), ''), e.sell_price, e.base_cost, auth.uid(), now())
  on conflict (estimate_id) do update set status = excluded.status, reason = excluded.reason, sell_price_at_review = excluded.sell_price_at_review,
    base_cost_at_review = excluded.base_cost_at_review, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform public._finance_event('estimate', p_estimate, null, case when p_approve then 'finance_approved' else 'finance_declined' end, null, null,
    jsonb_build_object('estimate_number', e.estimate_number, 'sell_price', e.sell_price, 'base_cost', e.base_cost, 'reason', nullif(trim(p_reason), '')));
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, case when p_approve then 'finance_approved' else 'finance_declined' end,
    jsonb_build_object('reason', nullif(trim(p_reason), ''), 'module', 'finance'));
end $$;

-- ---------------------------------------------------------------------------
-- Client bills
-- ---------------------------------------------------------------------------
create or replace function public.finance_bill_create(p_estimate uuid, p_vat_percent numeric default 0, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; m record; v_id uuid;
begin
  perform public._finance_require();
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status <> 'approved' then raise exception 'Bill the client once they have approved the estimate'; end if;
  if exists (select 1 from public.client_bills where estimate_id = p_estimate and status <> 'cancelled') then raise exception 'This estimate already has a bill'; end if;
  if p_vat_percent is null or p_vat_percent < 0 or p_vat_percent > 100 then raise exception 'Enter a VAT rate between 0 and 100'; end if;
  select * into j from public.jobs where id = e.job_id;
  select * into m from public._finance_market(e.market);
  if m.market is null then raise exception 'Market "%" is not in the market master data', e.market; end if;
  insert into public.client_bills (estimate_id, job_id, client_id, billing_entity_id, client_order_ref, currency, net_amount, vat_percent, vat_amount,
    cost_amount, notes, region, market, created_by)
  values (p_estimate, e.job_id, j.client_id, j.billing_entity_id, e.client_order_ref, e.currency, e.sell_price, p_vat_percent,
    round(e.sell_price * p_vat_percent / 100, 2), e.base_cost, nullif(trim(p_notes), ''), m.region, m.market, auth.uid())
  returning id into v_id;
  perform public._finance_event('bill', v_id, null, 'created', null, 'draft', jsonb_build_object('estimate_number', e.estimate_number, 'net', e.sell_price, 'vat_percent', p_vat_percent));
  return v_id;
end $$;

create or replace function public.finance_bill_send(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.client_bills; t record;
begin
  perform public._finance_require();
  select * into b from public.client_bills where id = p_bill for update;
  if b.id is null or b.status <> 'draft' then raise exception 'Only a draft bill can be sent'; end if;
  select * into t from public._finance_rule('FR-CLIENT-TERMS', current_date, 30);
  update public.client_bills set status = 'sent', issue_date = current_date, due_date = current_date + t.value::int, sent_at = now(), sent_by = auth.uid() where id = p_bill;
  perform public._finance_event('bill', p_bill, null, 'sent', 'draft', 'sent', jsonb_build_object('terms_days', t.value, 'basis', t.basis));
end $$;

create or replace function public.finance_bill_mark_paid(p_bill uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.client_bills;
begin
  perform public._finance_require();
  select * into b from public.client_bills where id = p_bill for update;
  if b.id is null or b.status <> 'sent' then raise exception 'Only a sent bill can be marked paid'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'Enter the payment reference'; end if;
  update public.client_bills set status = 'paid', paid_at = now(), paid_by = auth.uid(), payment_reference = trim(p_reference) where id = p_bill;
  perform public._finance_event('bill', p_bill, null, 'paid', 'sent', 'paid', jsonb_build_object('reference', trim(p_reference)));
end $$;

create or replace function public.finance_bill_cancel(p_bill uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.client_bills;
begin
  perform public._finance_require();
  select * into b from public.client_bills where id = p_bill for update;
  if b.id is null or b.status not in ('draft','sent') then raise exception 'Only a draft or sent bill can be cancelled'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the bill is cancelled'; end if;
  update public.client_bills set status = 'cancelled', cancelled_reason = trim(p_reason) where id = p_bill;
  perform public._finance_event('bill', p_bill, null, 'cancelled', b.status, 'cancelled', jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------
-- Read views (security invoker: caller's RLS applies, so internal only)
-- ---------------------------------------------------------------------------
create view public.v_supplier_invoices with (security_invoker = true) as
  select i.*, p.po_number, p.total_value as po_value, p.status as po_status, s.name as supplier_name, s.supplier_code,
         j.job_number, j.title as job_title, c.name as client_name, f.file_name,
         ob.full_name as override_requested_by_name, ab.full_name as approved_by_name,
         coalesce(ps.paid, 0)::numeric(14,2) as paid_amount, coalesce(ps.scheduled, 0)::numeric(14,2) as scheduled_amount, ps.next_due
    from public.supplier_invoices i
    join public.purchase_orders p on p.id = i.po_id
    join public.suppliers s on s.id = i.supplier_id
    join public.jobs j on j.id = i.job_id
    join public.sourcing_clients c on c.id = j.client_id
    left join public.files f on f.id = i.file_id
    left join public.profiles ob on ob.id = i.override_requested_by
    left join public.profiles ab on ab.id = i.approved_by
    left join lateral (select sum(amount) filter (where paid_at is not null) paid, sum(amount) scheduled, min(due_date) filter (where paid_at is null) next_due
                         from public.payment_schedule_items where invoice_id = i.id) ps on true;

create view public.v_payment_schedule with (security_invoker = true) as
  select s.*, i.invoice_ref, i.invoice_number, i.status as invoice_status, i.supplier_id, su.name as supplier_name, p.po_number, i.region, i.market,
         case when s.paid_at is not null then 'paid'
              when s.due_date < current_date then 'overdue'
              when s.due_date <= current_date + coalesce(public.finance_rule_value('FR-DUE-WINDOW', 7), 7)::int then 'due'
              else 'upcoming' end as status,
         date_trunc('week', s.due_date)::date as due_week, date_trunc('month', s.due_date)::date as due_month,
         pb.full_name as paid_by_name
    from public.payment_schedule_items s
    join public.supplier_invoices i on i.id = s.invoice_id
    join public.suppliers su on su.id = i.supplier_id
    join public.purchase_orders p on p.id = i.po_id
    left join public.profiles pb on pb.id = s.paid_by;

create view public.v_client_bills with (security_invoker = true) as
  select b.*, e.estimate_number, e.status as estimate_status, j.job_number, j.title as job_title, c.name as client_name, c.code as client_code,
         be.name as billing_entity_name, be.code as billing_entity_code, be.vat_number as billing_entity_vat
    from public.client_bills b
    join public.estimates e on e.id = b.estimate_id
    join public.jobs j on j.id = b.job_id
    join public.sourcing_clients c on c.id = b.client_id
    left join public.sourcing_billing_entities be on be.id = b.billing_entity_id;

-- Estimates and whether Finance needs to look at them: margin under FR-MIN-MARGIN, value at or over FR-REVIEW-VALUE, or a
-- min-quotes bypass. A review is stale once the estimate is repriced.
create view public.v_finance_estimates with (security_invoker = true) as
  with r as (
    select public.finance_rule_value('FR-MIN-MARGIN', 10) min_margin, public.finance_rule_value('FR-REVIEW-VALUE', 10000) review_value
  ), e as (
    select e.*, j.job_number, j.title as job_title, j.category, j.budget, c.name as client_name, s.name as supplier_name,
           case when e.sell_price > 0 then round(100 * (e.sell_price - e.base_cost) / e.sell_price, 2) end as margin_percent,
           fr.status as review_status, fr.reason as review_reason, fr.decided_at as reviewed_at, fr.decided_by as reviewed_by,
           (fr.estimate_id is not null and fr.sell_price_at_review <> e.sell_price) as review_stale
      from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
      join public.suppliers s on s.id = e.supplier_id left join public.estimate_finance_reviews fr on fr.estimate_id = e.id
  )
  select e.*, r.min_margin, r.review_value,
         array_remove(array[
           case when e.margin_percent < r.min_margin then 'Margin under ' || r.min_margin || '%' end,
           case when e.sell_price >= r.review_value then 'Value at or over ' || r.review_value end,
           case when e.benchmark_source = 'bypass' then 'Awarded with a minimum-quotes bypass' end], null) as review_triggers,
         (e.status in ('draft','sent') and (e.margin_percent < r.min_margin or e.sell_price >= r.review_value or e.benchmark_source = 'bypass')
           and (e.review_status is null or e.review_stale)) as needs_review
    from e cross join r;

-- RFQ quotes waiting for Finance (decided with the existing rfq_finance_decide).
create view public.v_finance_quote_queue with (security_invoker = true) as
  select q.id as response_id, q.rfq_id, q.supplier_id, q.currency, q.total_value, q.lead_time_days, q.submitted_at, q.source, q.finance_status,
         q.finance_notes, q.finance_at, r.rfq_number, r.title as rfq_title, r.due_at, r.estimated_value, r.region, r.market, r.status as rfq_status,
         j.id as job_id, j.job_number, c.name as client_name, s.name as supplier_name, s.supplier_code,
         (select min(q2.total_value) from public.rfq_responses q2 where q2.rfq_id = q.rfq_id and q2.status = 'submitted') as lowest_quote,
         (select count(*) from public.rfq_responses q3 where q3.rfq_id = q.rfq_id and q3.status = 'submitted')::int as quote_count
    from public.rfq_responses q join public.rfqs r on r.id = q.rfq_id join public.jobs j on j.id = r.job_id
    join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = q.supplier_id
   where q.status = 'submitted' and r.status = 'sent';

-- Spend and savings: one row per live estimate with sell, savings, PO cost and invoiced actual.
create view public.v_finance_spend with (security_invoker = true) as
  select e.id as estimate_id, e.estimate_number, e.job_id, j.job_number, j.title as job_title, j.client_id, c.name as client_name,
         coalesce(m.region_code, e.region) as region, coalesce(m.code, e.market) as market, coalesce(m.name, e.market) as market_name,
         coalesce(j.category, 'Uncategorised') as category, e.supplier_id, s.name as supplier_name, e.currency, e.status as estimate_status,
         date_trunc('month', coalesce(e.approved_at, e.created_at))::date as month,
         e.sell_price, e.base_cost, coalesce(e.savings_vs_benchmark, 0) as savings_vs_benchmark, e.benchmark_value, j.budget,
         po.id as po_id, po.po_number, coalesce(po.total_value, 0) as po_value,
         coalesce(inv.net, 0) as invoiced, coalesce(inv.paid, 0) as invoices_paid, coalesce(inv.n, 0)::int as invoice_count,
         (po.id is not null and coalesce(inv.net, 0) > po.total_value) as over_po
    from public.estimates e
    join public.jobs j on j.id = e.job_id
    join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = e.supplier_id
    left join public.markets m on m.code = upper(e.market) or lower(m.name) = lower(e.market)
    left join lateral (select * from public.purchase_orders p where p.estimate_id = e.id and p.status not in ('rejected','cancelled','declined') order by p.created_at desc limit 1) po on true
    left join lateral (select sum(i.net_amount) net, sum(i.net_amount) filter (where i.status = 'paid') paid, count(*) n
                         from public.supplier_invoices i where i.po_id = po.id and i.status <> 'rejected') inv on true
   where e.status <> 'declined';

create view public.v_finance_events with (security_invoker = true) as
  select ev.*, p.full_name as actor_name from public.finance_events ev left join public.profiles p on p.id = ev.actor;

create view public.watchtower_health_finance with (security_invoker = true) as
  with tomatch as (select count(*)::numeric n from public.supplier_invoices where status = 'submitted'),
  var as (select count(*)::numeric n from public.supplier_invoices where status = 'matching' and match_status in ('variance','missing_evidence')),
  overdue as (select count(*)::numeric n from public.payment_schedule_items where paid_at is null and due_date < current_date),
  quotes as (select count(*)::numeric n from public.rfq_responses q join public.rfqs r on r.id = q.rfq_id where q.status = 'submitted' and r.status = 'sent' and q.finance_status = 'pending'),
  overpo as (select count(*)::numeric n from public.purchase_orders p
               where (select coalesce(sum(net_amount), 0) from public.supplier_invoices i where i.po_id = p.id and i.status <> 'rejected') > p.total_value)
  select 'finance'::text as module, 'invoices_to_match'::text as metric, 'Supplier invoices waiting to be matched'::text as label, tomatch.n as value, 0::numeric as target,
         case when tomatch.n = 0 then 'ok' when tomatch.n <= 5 then 'warn' else 'bad' end as status from tomatch
  union all select 'finance', 'unmatched_in_review', 'Invoices in review with a variance or missing evidence', var.n, 0, case when var.n = 0 then 'ok' else 'warn' end from var
  union all select 'finance', 'overdue_payments', 'Supplier payments overdue', overdue.n, 0, case when overdue.n = 0 then 'ok' when overdue.n <= 2 then 'warn' else 'bad' end from overdue
  union all select 'finance', 'quotes_awaiting_finance', 'RFQ quotes waiting for Finance', quotes.n, 0, case when quotes.n = 0 then 'ok' else 'warn' end from quotes
  union all select 'finance', 'pos_over_invoiced', 'POs invoiced above their value', overpo.n, 0, case when overpo.n = 0 then 'ok' else 'bad' end from overpo;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.estimate_finance_reviews enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.payment_schedule_items enable row level security;
alter table public.client_bills enable row level security;
alter table public.finance_events enable row level security;
create policy efr_read on public.estimate_finance_reviews for select to authenticated using (public.is_internal());
create policy si_read on public.supplier_invoices for select to authenticated using (public.is_internal());
create policy psi_read on public.payment_schedule_items for select to authenticated using (public.is_internal());
create policy cb_read on public.client_bills for select to authenticated using (public.is_internal());
create policy fev_read on public.finance_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.estimate_finance_reviews, public.supplier_invoices, public.payment_schedule_items, public.client_bills,
  public.finance_events from authenticated, anon;
revoke insert, update, delete on public.v_supplier_invoices, public.v_payment_schedule, public.v_client_bills, public.v_finance_estimates,
  public.v_finance_quote_queue, public.v_finance_spend, public.v_finance_events, public.watchtower_health_finance from authenticated, anon;
revoke usage on sequence public.finance_invoice_seq, public.client_bill_seq from authenticated, anon;

revoke execute on function public._finance_rule(text, date, numeric), public._finance_number(text), public._finance_market(text),
  public._finance_event(text, uuid, uuid, text, text, text, jsonb), public._finance_require(), public._finance_notify_supplier(public.supplier_invoices, text, text),
  public._finance_terms(uuid, date), public._finance_compute_match(uuid)
  from public, anon, authenticated;
grant execute on function public.finance_is_finance(), public.finance_rule_value(text, numeric), public.finance_vendor_submit_invoice(uuid, text, date, numeric, numeric, text, uuid),
  public.finance_vendor_invoices(), public.finance_vendor_invoiceable_pos(), public.finance_match_invoice(uuid), public.finance_request_override(uuid, text),
  public.finance_approve_invoice(uuid, text), public.finance_dispute_invoice(uuid, text), public.finance_resolve_dispute(uuid, text),
  public.finance_reject_invoice(uuid, text), public.finance_schedule_payment(uuid, jsonb), public.finance_mark_paid(uuid, text, date),
  public.finance_estimate_decide(uuid, boolean, text), public.finance_bill_create(uuid, numeric, text), public.finance_bill_send(uuid),
  public.finance_bill_mark_paid(uuid, text), public.finance_bill_cancel(uuid, text)
  to authenticated;
