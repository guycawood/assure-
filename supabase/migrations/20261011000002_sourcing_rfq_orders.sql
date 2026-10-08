-- RFQ+ and Order Management+ data (same schema as Sourcing+; separate modules in the app):
-- RFQs with quantity breaks and targets, supplier selection from the Assure+ eligible pool, minimum quotes from the
-- Watchtower sourcing control matrix, high-value threshold alerts, sealed quotes (vendors only through functions),
-- finance approval, award with Assure+ checks, estimates (markup or margin), supplier POs with DOA approval,
-- vendor PO acceptance and the estimate.approved integration event.

-- ---------------------------------------------------------------------------
-- Business numbers from sequences
-- ---------------------------------------------------------------------------
create sequence public.rfq_number_seq;
create sequence public.estimate_number_seq;
create sequence public.po_number_seq;

create or replace function public._next_number(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval(
    case p_prefix when 'RFQ' then 'public.rfq_number_seq' when 'EST' then 'public.estimate_number_seq' when 'PO' then 'public.po_number_seq' end::regclass
  )::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- RFQs
-- ---------------------------------------------------------------------------
create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  rfq_number text not null unique,
  job_id uuid not null references public.jobs(id),
  title text not null check (length(trim(title)) > 0),
  status text not null default 'draft' check (status in ('draft','sent','awarded','cancelled')),
  bidding_mode text not null default 'closed' check (bidding_mode = 'closed'),
  currency text not null default 'EUR',
  due_at timestamptz not null,
  estimated_value numeric(14,2) check (estimated_value >= 0),
  region text not null check (region in ('APAC','EMEA','Americas','GSC')),
  market text not null,
  control_record_id uuid references public.library_records(id),
  control_band text,
  min_quotes_required int,
  min_quotes_basis text,
  high_value_threshold numeric(14,2),
  high_value_alert boolean not null default false,
  high_value_approved_by uuid references public.profiles(id),
  high_value_approved_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  awarded_response_id uuid,
  awarded_by uuid references public.profiles(id),
  awarded_at timestamptz,
  award_reason text,
  bypass_reason_code text,
  cancelled_reason text
);
create index rfqs_job_idx on public.rfqs (job_id);
create index rfqs_status_idx on public.rfqs (status, due_at);

create table public.rfq_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  spec_id uuid not null references public.job_specs(id),
  line_no int not null,
  quantity_breaks int[] not null check (cardinality(quantity_breaks) between 1 and 6 and 0 < all (quantity_breaks)),
  target_prices numeric(14,4)[] check (target_prices is null or cardinality(target_prices) = cardinality(quantity_breaks)),
  show_targets boolean not null default false,
  notes text,
  unique (rfq_id, spec_id),
  unique (rfq_id, line_no)
);

create table public.rfq_invitations (
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'invited' check (status in ('invited','viewed','quoted','declined')),
  cross_border boolean not null default false,
  invited_by uuid references public.profiles(id),
  invited_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  primary key (rfq_id, supplier_id)
);

create table public.rfq_responses (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null,
  supplier_id uuid not null,
  status text not null default 'draft' check (status in ('draft','submitted','awarded','declined')),
  source text not null check (source in ('vendor_portal','internal_entry')),
  currency text not null,
  lead_time_days int check (lead_time_days >= 0),
  total_value numeric(14,2),
  notes text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id),
  finance_status text not null default 'pending' check (finance_status in ('pending','approved','declined')),
  finance_by uuid references public.profiles(id),
  finance_at timestamptz,
  finance_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, supplier_id),
  foreign key (rfq_id, supplier_id) references public.rfq_invitations(rfq_id, supplier_id) on delete cascade
);
alter table public.rfqs add constraint rfqs_awarded_response_fk foreign key (awarded_response_id) references public.rfq_responses(id);

create table public.rfq_response_prices (
  response_id uuid not null references public.rfq_responses(id) on delete cascade,
  line_id uuid not null references public.rfq_lines(id) on delete cascade,
  quantity int not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  lead_time_days int check (lead_time_days >= 0),
  primary key (response_id, line_id, quantity)
);

create or replace function public.trg_rfqs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.rfq_number := public._next_number('RFQ'); else new.rfq_number := old.rfq_number; new.updated_at := now(); end if;
  return new;
end $$;
create trigger rfqs_before before insert or update on public.rfqs for each row execute function public.trg_rfqs_before();

-- A spec on a live RFQ can't change underneath the suppliers quoting on it.
create or replace function public.trg_spec_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_spec uuid;
begin
  if current_setting('sourcing.system_write', true) = 'on' then return coalesce(new, old); end if;
  v_spec := case when tg_table_name = 'job_specs' then coalesce(new.id, old.id) else coalesce(new.spec_id, old.spec_id) end;
  if exists (select 1 from public.rfq_lines l join public.rfqs r on r.id = l.rfq_id
              where l.spec_id = v_spec and r.status in ('sent','awarded')) then
    raise exception 'This spec is on a live or awarded RFQ, so it is locked. Duplicate it to make changes.';
  end if;
  return coalesce(new, old);
end $$;
create trigger job_specs_locked before update or delete on public.job_specs for each row execute function public.trg_spec_locked();
create trigger spec_versions_locked before insert or update or delete on public.spec_versions for each row execute function public.trg_spec_locked();
create trigger spec_components_locked before insert or update or delete on public.spec_components for each row execute function public.trg_spec_locked();

-- ---------------------------------------------------------------------------
-- Control matrix, high-value thresholds, eligibility
-- ---------------------------------------------------------------------------
-- Supplier eligibility comes from Assure+: active and not purchasing-blocked.
create or replace function public.supplier_is_eligible(p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active and not purchasing_blocked from public.suppliers where id = p_supplier), false);
$$;

-- Band of the Sourcing Control Matrix that applies to a value (most specific client/market match first),
-- and the minimum number of suppliers: in-country minimum unless every invited supplier is cross-border.
-- The client's own minimum is a floor.
create or replace function public._control_rule(p_value numeric, p_client uuid, p_market text, p_cross_border_only boolean, p_date date)
returns table (record_id uuid, band text, min_required int, basis text)
language plpgsql stable security definer set search_path = public as $$
declare r public.library_records; c public.sourcing_clients; v_min int; v_band_min int;
begin
  select * into c from public.sourcing_clients where id = p_client;
  select lr.* into r from public.library_records lr
   where lr.library_key = 'sourcing_control_matrix' and lr.status in ('active','superseded')
     and lr.effective_from <= p_date and (lr.effective_to is null or lr.effective_to >= p_date)
     and p_value >= coalesce((lr.data->>'min_value_eur')::numeric, (lr.data->>'min_value')::numeric, 0)
     and (coalesce(lr.data->>'max_value_eur', lr.data->>'max_value') is null
          or p_value <= coalesce((lr.data->>'max_value_eur')::numeric, (lr.data->>'max_value')::numeric))
     and (lr.data->>'client_code' is null or lr.data->>'client_code' = c.code)
     and (lr.data->>'market' is null or lr.data->>'market' = p_market)
   order by (lr.data->>'client_code' is not null) desc, (lr.data->>'market' is not null) desc, lr.version desc
   limit 1;
  if r.id is null then
    return query select null::uuid, null::text, coalesce(c.min_quotes_required, 3),
      format('No control-matrix band matched; the client minimum of %s applies.', coalesce(c.min_quotes_required, 3));
    return;
  end if;
  -- Watchtower record keys: suppliers_in_country / suppliers_cross_border (0 or missing cross-border = in-country rule applies).
  v_band_min := coalesce((r.data->>'suppliers_in_country')::int, (r.data->>'suppliers_in_country_min')::int);
  if p_cross_border_only and coalesce((r.data->>'suppliers_cross_border')::int, (r.data->>'suppliers_cross_border_min')::int, 0) > 0 then
    v_band_min := coalesce((r.data->>'suppliers_cross_border')::int, (r.data->>'suppliers_cross_border_min')::int);
  end if;
  v_min := greatest(coalesce(v_band_min, 1), coalesce(c.min_quotes_required, 1));
  return query select r.id, r.name, v_min,
    format('Band "%s"%s: at least %s %s supplier(s)%s.', r.name,
      case when r.data->>'strategy_owner' is not null then ' (owner: ' || (r.data->>'strategy_owner') || ')' else '' end,
      coalesce(v_band_min, 1), case when p_cross_border_only then 'cross-border' else 'in-country' end,
      case when coalesce(c.min_quotes_required, 0) > coalesce(v_band_min, 0) then format('; client minimum %s applies', c.min_quotes_required) else '' end);
end $$;

create or replace function public._high_value_threshold(p_market text, p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select (data->>'threshold')::numeric from public.library_records
   where library_key = 'high_value_thresholds' and status in ('active','superseded')
     and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
     and (data->>'market' = p_market or data->>'market' is null)
   order by (data->>'market' is not null) desc, version desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RFQ lifecycle (internal)
-- ---------------------------------------------------------------------------
create or replace function public._rfq_write_lines(p_rfq uuid, p_job uuid, p_lines jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare x jsonb; s public.job_specs; t public.spec_triage; v_breaks int[]; v_targets numeric[]; n int := 0; v_value numeric := 0; v_has_target boolean := false;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one spec line'; end if;
  delete from public.rfq_lines where rfq_id = p_rfq;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into s from public.job_specs where id = (x->>'spec_id')::uuid;
    if s.id is null or s.job_id <> p_job then raise exception 'Line %: the spec must belong to this job', n; end if;
    if s.is_draft then raise exception 'Line %: "%" is still a draft', n, s.title; end if;
    select * into t from public.spec_triage where spec_id = s.id and is_current;
    if t.id is null then raise exception 'Line %: run triage on "%" before it goes to RFQ', n, s.title; end if;
    if t.route <> 'create' then
      raise exception 'Line %: "%" is routed %, so it doesn''t need an RFQ. Override it to Create first if you want quotes.', n, s.title, initcap(t.route);
    end if;
    -- Order is kept: the first break is the primary quantity used for totals, benchmarks and the estimate.
    select array_agg((v)::int order by o) into v_breaks from jsonb_array_elements_text(x->'quantity_breaks') with ordinality a(v, o) where nullif(v, '') is not null;
    if v_breaks is null or cardinality(v_breaks) = 0 then raise exception 'Line %: give at least one quantity', n; end if;
    if (select count(distinct q) from unnest(v_breaks) q) <> cardinality(v_breaks) then raise exception 'Line %: quantity breaks must be different', n; end if;
    if cardinality(v_breaks) > 6 then raise exception 'Line %: up to 6 quantity breaks', n; end if;
    if exists (select 1 from unnest(v_breaks) q where q <= 0) then raise exception 'Line %: quantities must be above zero', n; end if;
    v_targets := null;
    if jsonb_typeof(x->'target_prices') = 'array' and jsonb_array_length(x->'target_prices') > 0 then
      select array_agg(nullif(v, '')::numeric order by o) into v_targets from jsonb_array_elements_text(x->'target_prices') with ordinality a(v, o);
      if cardinality(v_targets) <> cardinality(v_breaks) then raise exception 'Line %: give one target price per quantity break', n; end if;
      if exists (select 1 from unnest(v_targets) p where p < 0) then raise exception 'Line %: target prices can''t be negative', n; end if;
      if v_targets[1] is not null then v_value := v_value + v_targets[1] * v_breaks[1]; v_has_target := true; end if;
    end if;
    insert into public.rfq_lines (rfq_id, spec_id, line_no, quantity_breaks, target_prices, show_targets, notes)
    values (p_rfq, s.id, n, v_breaks, v_targets, coalesce((x->>'show_targets')::boolean, false), nullif(trim(x->>'notes'), ''));
  end loop;
  return case when v_has_target then v_value end;
end $$;

create or replace function public._rfq_flag_high_value(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_thr numeric;
begin
  select * into r from public.rfqs where id = p_rfq;
  v_thr := public._high_value_threshold(r.market, current_date);
  update public.rfqs set high_value_threshold = v_thr,
    high_value_alert = (v_thr is not null and coalesce(r.estimated_value, 0) >= v_thr),
    high_value_approved_by = case when v_thr is not null and coalesce(r.estimated_value, 0) >= v_thr then r.high_value_approved_by end,
    high_value_approved_at = case when v_thr is not null and coalesce(r.estimated_value, 0) >= v_thr then r.high_value_approved_at end
  where id = p_rfq;
end $$;

create or replace function public.rfq_create(p_job uuid, p_title text, p_due_at timestamptz, p_estimated_value numeric, p_lines jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_id uuid; v_target numeric; r public.rfqs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can create RFQs' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status in ('closed','cancelled') then raise exception 'This job is %', j.status; end if;
  if p_due_at is null or p_due_at <= now() then raise exception 'Choose a due date in the future'; end if;
  if p_estimated_value is not null and p_estimated_value < 0 then raise exception 'The estimated value can''t be negative'; end if;
  insert into public.rfqs (job_id, title, currency, due_at, estimated_value, region, market, notes, created_by)
  values (p_job, trim(p_title), j.currency, p_due_at, p_estimated_value, j.region, j.market, p_notes, auth.uid())
  returning id into v_id;
  v_target := public._rfq_write_lines(v_id, p_job, p_lines);
  update public.rfqs set estimated_value = coalesce(p_estimated_value, v_target) where id = v_id;
  perform public._rfq_flag_high_value(v_id);
  select * into r from public.rfqs where id = v_id;
  perform public._sourcing_event(p_job, 'rfq', v_id, 'created', jsonb_build_object('rfq_number', r.rfq_number, 'estimated_value', r.estimated_value, 'high_value_alert', r.high_value_alert));
  if r.high_value_alert then
    perform public._sourcing_event(p_job, 'rfq', v_id, 'high_value_alert', jsonb_build_object('estimated_value', r.estimated_value, 'threshold', r.high_value_threshold, 'market', r.market));
  end if;
  return v_id;
end $$;

create or replace function public.rfq_update_draft(p_rfq uuid, p_title text, p_due_at timestamptz, p_estimated_value numeric, p_lines jsonb, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_target numeric;
begin
  if not public.is_internal() then raise exception 'Only internal staff can edit RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft RFQ can be edited'; end if;
  if p_due_at is null or p_due_at <= now() then raise exception 'Choose a due date in the future'; end if;
  v_target := public._rfq_write_lines(p_rfq, r.job_id, p_lines);
  update public.rfqs set title = trim(p_title), due_at = p_due_at, estimated_value = coalesce(p_estimated_value, v_target), notes = p_notes where id = p_rfq;
  perform public._rfq_flag_high_value(p_rfq);
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'edited', '{}'::jsonb);
end $$;

-- Suppliers come only from the Assure+ eligible pool.
create or replace function public.rfq_set_suppliers(p_rfq uuid, p_suppliers jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_sup public.suppliers; v uuid; n int := 0;
begin
  if not public.is_internal() then raise exception 'Only internal staff can choose RFQ suppliers' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'Suppliers can only be changed while the RFQ is a draft'; end if;
  delete from public.rfq_invitations where rfq_id = p_rfq;
  for v in select distinct (x)::uuid from jsonb_array_elements_text(coalesce(p_suppliers, '[]'::jsonb)) x loop
    select * into v_sup from public.suppliers where id = v;
    if v_sup.id is null then raise exception 'Supplier not found'; end if;
    if not v_sup.active or v_sup.purchasing_blocked then
      raise exception '% is not eligible in Assure+ (inactive or blocked for purchasing)', v_sup.name;
    end if;
    insert into public.rfq_invitations (rfq_id, supplier_id, cross_border, invited_by)
    values (p_rfq, v, v_sup.market is distinct from r.market, auth.uid());
    n := n + 1;
  end loop;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'suppliers_set', jsonb_build_object('count', n));
  return n;
end $$;

create or replace function public.rfq_approve_high_value(p_rfq uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs;
begin
  if not public.sourcing_is_lead() then raise exception 'Only a sourcing lead can approve a high-value RFQ' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null or r.status <> 'draft' or not r.high_value_alert then raise exception 'Nothing to approve'; end if;
  if r.created_by = auth.uid() then raise exception 'A different person must approve a high-value RFQ'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Record why this value is justified'; end if;
  update public.rfqs set high_value_approved_by = auth.uid(), high_value_approved_at = now() where id = p_rfq;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'high_value_approved', jsonb_build_object('note', p_note, 'estimated_value', r.estimated_value, 'threshold', r.high_value_threshold));
end $$;

create or replace function public.rfq_send(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_count int; v_cb_only boolean; ctl record; v_bad text; v_link text;
begin
  if not public.is_internal() then raise exception 'Only internal staff can send RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'This RFQ has already been sent'; end if;
  if r.due_at <= now() then raise exception 'The due date has passed; choose a new one'; end if;
  if r.estimated_value is null then raise exception 'Add an estimated value or target prices so the control matrix can be applied'; end if;
  select string_agg(s.name, ', ') into v_bad from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id
   where i.rfq_id = p_rfq and (not s.active or s.purchasing_blocked);
  if v_bad is not null then raise exception 'No longer eligible in Assure+: %. Remove them first.', v_bad; end if;
  select count(*), coalesce(bool_and(cross_border), false) into v_count, v_cb_only from public.rfq_invitations where rfq_id = p_rfq;
  if v_count = 0 then raise exception 'Choose suppliers from the eligible pool first'; end if;
  perform public._rfq_flag_high_value(p_rfq);
  select * into r from public.rfqs where id = p_rfq;
  if r.high_value_alert and r.high_value_approved_by is null then
    raise exception 'High-value RFQ (% or more in %): a sourcing lead must approve it before it goes out', r.high_value_threshold, r.market;
  end if;
  select * into ctl from public._control_rule(r.estimated_value, (select client_id from public.jobs where id = r.job_id), r.market, v_cb_only, current_date);
  if v_count < ctl.min_required then
    raise exception 'Not enough suppliers: % invited, at least % needed. %', v_count, ctl.min_required, ctl.basis;
  end if;
  update public.rfqs set status = 'sent', sent_at = now(), sent_by = auth.uid(), control_record_id = ctl.record_id,
    control_band = ctl.band, min_quotes_required = ctl.min_required, min_quotes_basis = ctl.basis where id = p_rfq;
  if ctl.record_id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (ctl.record_id, 'rfqs', p_rfq::text, r.rfq_number) on conflict do nothing;
  end if;
  insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
  select s.primary_contact_email, 'Request for quote ' || r.rfq_number || ': ' || r.title,
         format('You have been invited to quote on %s (%s). Quotes are sealed and due by %s. Open your vendor portal to respond.',
                r.rfq_number, r.title, to_char(r.due_at, 'DD Mon YYYY HH24:MI')), s.id, auth.uid()
    from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id
   where i.rfq_id = p_rfq and s.primary_contact_email is not null;
  perform public._job_advance(r.job_id, array['open'], 'quoting');
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'sent', jsonb_build_object('suppliers', v_count, 'min_required', ctl.min_required, 'band', ctl.band));
end $$;

create or replace function public.rfq_cancel(p_rfq uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can cancel RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null or r.status not in ('draft','sent') then raise exception 'Only a draft or open RFQ can be cancelled'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the RFQ is cancelled'; end if;
  update public.rfqs set status = 'cancelled', cancelled_reason = trim(p_reason) where id = p_rfq;
  update public.rfq_responses set status = 'declined' where rfq_id = p_rfq and status in ('draft','submitted');
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'cancelled', jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Quotes (sealed). Vendors act only through these functions.
-- ---------------------------------------------------------------------------
create or replace function public._rfq_save_prices(p_response uuid, p_rfq uuid, p_prices jsonb, p_require_all boolean) returns numeric
language plpgsql security definer set search_path = public as $$
declare x jsonb; l public.rfq_lines; v_total numeric := 0; v_missing text;
begin
  delete from public.rfq_response_prices where response_id = p_response;
  for x in select * from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    if nullif(x->>'unit_price', '') is null then continue; end if;
    select * into l from public.rfq_lines where id = (x->>'line_id')::uuid and rfq_id = p_rfq;
    if l.id is null then raise exception 'A price refers to a line that is not on this RFQ'; end if;
    if not ((x->>'quantity')::int = any (l.quantity_breaks)) then raise exception 'Line %: % is not one of the quantity breaks', l.line_no, x->>'quantity'; end if;
    if (x->>'unit_price')::numeric < 0 then raise exception 'Prices can''t be negative'; end if;
    insert into public.rfq_response_prices (response_id, line_id, quantity, unit_price, lead_time_days)
    values (p_response, l.id, (x->>'quantity')::int, (x->>'unit_price')::numeric, nullif(x->>'lead_time_days', '')::int)
    on conflict (response_id, line_id, quantity) do update set unit_price = excluded.unit_price, lead_time_days = excluded.lead_time_days;
  end loop;
  select string_agg('line ' || l2.line_no, ', ') into v_missing from public.rfq_lines l2
   where l2.rfq_id = p_rfq and not exists (select 1 from public.rfq_response_prices p where p.response_id = p_response and p.line_id = l2.id and p.quantity = l2.quantity_breaks[1]);
  if p_require_all and v_missing is not null then raise exception 'Price at least the first quantity break of every line (missing: %)', v_missing; end if;
  select coalesce(sum(p.unit_price * p.quantity), 0) into v_total from public.rfq_lines l3
    join public.rfq_response_prices p on p.line_id = l3.id and p.quantity = l3.quantity_breaks[1] and p.response_id = p_response
   where l3.rfq_id = p_rfq;
  return round(v_total, 2);
end $$;

create or replace function public._vendor_invitation(p_rfq uuid) returns public.rfq_invitations
language plpgsql stable security definer set search_path = public as $$
declare i public.rfq_invitations; v_sup uuid := public.my_supplier_id();
begin
  if v_sup is null then raise exception 'Not invited to this RFQ' using errcode = '42501'; end if;
  select inv.* into i from public.rfq_invitations inv join public.rfqs r on r.id = inv.rfq_id
   where inv.rfq_id = p_rfq and inv.supplier_id = v_sup and r.status <> 'draft';
  if i.rfq_id is null then raise exception 'Not invited to this RFQ' using errcode = '42501'; end if;
  return i;
end $$;

create or replace function public.rfq_vendor_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rfq_id', r.id, 'rfq_number', r.rfq_number, 'title', r.title, 'due_at', r.due_at, 'currency', r.currency,
    'open', r.status = 'sent' and r.due_at > now(), 'rfq_status', case when r.status = 'sent' and r.due_at <= now() then 'closed' else r.status end,
    'invitation_status', i.status, 'quote_status', q.status, 'line_count', (select count(*) from public.rfq_lines where rfq_id = r.id)
  ) order by r.due_at desc), '[]'::jsonb)
  from public.rfq_invitations i join public.rfqs r on r.id = i.rfq_id
  left join public.rfq_responses q on q.rfq_id = i.rfq_id and q.supplier_id = i.supplier_id
  where i.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and r.status <> 'draft';
$$;

-- What one invited vendor may see: the RFQ, its lines (targets only when shared), and its own invitation and quote.
-- Never other suppliers, counts of bidders, internal notes, minimums or finance decisions.
create or replace function public.rfq_vendor_view(p_rfq uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq); r public.rfqs; j public.jobs; q public.rfq_responses; v jsonb;
begin
  if i.status = 'invited' then
    update public.rfq_invitations set status = 'viewed', viewed_at = now() where rfq_id = p_rfq and supplier_id = i.supplier_id;
    i.status := 'viewed';
  end if;
  select * into r from public.rfqs where id = p_rfq;
  select * into j from public.jobs where id = r.job_id;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = i.supplier_id;
  v := jsonb_build_object(
    'rfq', jsonb_build_object('id', r.id, 'rfq_number', r.rfq_number, 'title', r.title, 'due_at', r.due_at, 'currency', r.currency,
       'open', r.status = 'sent' and r.due_at > now(), 'status', case when r.status = 'sent' and r.due_at <= now() then 'closed' else r.status end,
       'job_number', j.job_number, 'market', r.market, 'region', r.region),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'line_no', l.line_no, 'quantity_breaks', to_jsonb(l.quantity_breaks),
        'target_prices', case when l.show_targets then to_jsonb(l.target_prices) end, 'notes', l.notes,
        'spec', jsonb_build_object('title', s.title, 'spec_type', s.spec_type, 'description', s.description, 'hs_code', s.hs_code,
           'versions', (select coalesce(jsonb_agg(jsonb_build_object('name', sv.name, 'quantity', sv.quantity, 'finished_length', sv.finished_length,
              'finished_width', sv.finished_width) order by sv.sort), '[]'::jsonb) from public.spec_versions sv where sv.spec_id = s.id),
           'size_unit', s.size_unit)) order by l.line_no), '[]'::jsonb)
       from public.rfq_lines l join public.job_specs s on s.id = l.spec_id where l.rfq_id = p_rfq),
    'invitation', jsonb_build_object('status', i.status, 'declined_at', i.declined_at, 'decline_reason', i.decline_reason),
    'quote', case when q.id is null then null else jsonb_build_object('id', q.id, 'status', q.status, 'lead_time_days', q.lead_time_days,
       'notes', q.notes, 'total_value', q.total_value, 'submitted_at', q.submitted_at,
       'prices', (select coalesce(jsonb_agg(jsonb_build_object('line_id', p.line_id, 'quantity', p.quantity, 'unit_price', p.unit_price, 'lead_time_days', p.lead_time_days)), '[]'::jsonb)
                  from public.rfq_response_prices p where p.response_id = q.id)) end);
  return v;
end $$;

create or replace function public.rfq_submit_quote(p_rfq uuid, p_prices jsonb, p_lead_time_days int, p_notes text, p_submit boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq); r public.rfqs; q public.rfq_responses; v_total numeric;
begin
  select * into r from public.rfqs where id = p_rfq for update;
  if r.status <> 'sent' then raise exception 'This RFQ is not open for quotes'; end if;
  if now() >= r.due_at then raise exception 'The due date has passed: quotes can no longer be changed'; end if;
  if i.status = 'declined' then raise exception 'You declined this RFQ'; end if;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = i.supplier_id for update;
  if q.id is not null and q.status in ('awarded','declined') then raise exception 'This quote is closed'; end if;
  if q.id is not null and q.status = 'submitted' and not p_submit then raise exception 'Already submitted: change the prices and resubmit'; end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then raise exception 'Lead time can''t be negative'; end if;
  if q.id is null then
    insert into public.rfq_responses (rfq_id, supplier_id, status, source, currency)
    values (p_rfq, i.supplier_id, 'draft', 'vendor_portal', r.currency) returning * into q;
  end if;
  v_total := public._rfq_save_prices(q.id, p_rfq, p_prices, p_submit);
  update public.rfq_responses set lead_time_days = p_lead_time_days, notes = p_notes, total_value = v_total, updated_at = now(),
    status = case when p_submit then 'submitted' else 'draft' end,
    submitted_at = case when p_submit then now() else submitted_at end,
    submitted_by = case when p_submit then auth.uid() else submitted_by end,
    finance_status = case when p_submit then 'pending' else finance_status end, finance_by = null, finance_at = null, finance_notes = null
  where id = q.id;
  if p_submit then
    update public.rfq_invitations set status = 'quoted', responded_at = now() where rfq_id = p_rfq and supplier_id = i.supplier_id;
    perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'quote_submitted', jsonb_build_object('response_id', q.id, 'source', 'vendor_portal'));
  end if;
  return q.id;
end $$;

create or replace function public.rfq_decline(p_rfq uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq); r public.rfqs;
begin
  select * into r from public.rfqs where id = p_rfq;
  if r.status <> 'sent' then raise exception 'This RFQ is not open'; end if;
  if now() >= r.due_at then raise exception 'The due date has passed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are declining'; end if;
  if i.status = 'declined' then raise exception 'You have already declined this RFQ'; end if;
  update public.rfq_invitations set status = 'declined', declined_at = now(), decline_reason = trim(p_reason) where rfq_id = p_rfq and supplier_id = i.supplier_id;
  update public.rfq_responses set status = 'declined', updated_at = now() where rfq_id = p_rfq and supplier_id = i.supplier_id and status in ('draft','submitted');
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'supplier_declined', jsonb_build_object('supplier_id', i.supplier_id, 'reason', trim(p_reason)));
end $$;

-- A buyer keys in a quote received by email for an invited supplier (audited, marked internal entry).
create or replace function public.rfq_log_quote(p_rfq uuid, p_supplier uuid, p_prices jsonb, p_lead_time_days int, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.rfqs; i public.rfq_invitations; q public.rfq_responses; v_total numeric;
begin
  if not public.is_internal() then raise exception 'Only internal staff can log quotes' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null or r.status <> 'sent' then raise exception 'Quotes can only be logged on an open RFQ'; end if;
  select * into i from public.rfq_invitations where rfq_id = p_rfq and supplier_id = p_supplier;
  if i.rfq_id is null then raise exception 'That supplier was not invited to this RFQ'; end if;
  if i.status = 'declined' then raise exception 'That supplier declined this RFQ'; end if;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = p_supplier for update;
  if q.id is not null and q.status in ('awarded','declined') then raise exception 'This quote is closed'; end if;
  if q.id is null then
    insert into public.rfq_responses (rfq_id, supplier_id, status, source, currency) values (p_rfq, p_supplier, 'draft', 'internal_entry', r.currency) returning * into q;
  end if;
  v_total := public._rfq_save_prices(q.id, p_rfq, p_prices, true);
  update public.rfq_responses set status = 'submitted', source = 'internal_entry', lead_time_days = p_lead_time_days, notes = p_notes,
    total_value = v_total, submitted_at = now(), submitted_by = auth.uid(), finance_status = 'pending', finance_by = null, finance_at = null,
    finance_notes = null, updated_at = now() where id = q.id;
  update public.rfq_invitations set status = 'quoted', responded_at = now() where rfq_id = p_rfq and supplier_id = p_supplier;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'quote_logged', jsonb_build_object('response_id', q.id, 'supplier_id', p_supplier));
  return q.id;
end $$;

create or replace function public.rfq_finance_decide(p_response uuid, p_approve boolean, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.rfq_responses; r public.rfqs;
begin
  if not public.sourcing_is_finance() then raise exception 'Only Finance can approve quotes' using errcode = '42501'; end if;
  select * into q from public.rfq_responses where id = p_response for update;
  if q.id is null or q.status <> 'submitted' then raise exception 'Only a submitted quote can be reviewed'; end if;
  select * into r from public.rfqs where id = q.rfq_id;
  if r.status <> 'sent' then raise exception 'This RFQ is closed'; end if;
  if not p_approve and coalesce(trim(p_notes), '') = '' then raise exception 'Say why Finance is declining the quote'; end if;
  update public.rfq_responses set finance_status = case when p_approve then 'approved' else 'declined' end,
    finance_by = auth.uid(), finance_at = now(), finance_notes = p_notes where id = p_response;
  perform public._sourcing_event(r.job_id, 'rfq', r.id, case when p_approve then 'finance_approved' else 'finance_declined' end,
    jsonb_build_object('response_id', p_response, 'notes', p_notes));
end $$;

-- Live benchmark per line + quantity: average of quotes, re-averaged within ± the client's tolerance (computeLineBenchmark).
create or replace function public.rfq_line_benchmark(p_line uuid, p_qty int, p_tolerance numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_avg numeric; v_in numeric;
begin
  if not public.is_internal() then return null; end if;
  select avg(p.unit_price) into v_avg from public.rfq_response_prices p join public.rfq_responses q on q.id = p.response_id
   where p.line_id = p_line and p.quantity = p_qty and q.status in ('submitted','awarded');
  if v_avg is null then return null; end if;
  if p_tolerance is null or p_tolerance <= 0 then return round(v_avg, 4); end if;
  select avg(p.unit_price) into v_in from public.rfq_response_prices p join public.rfq_responses q on q.id = p.response_id
   where p.line_id = p_line and p.quantity = p_qty and q.status in ('submitted','awarded') and abs(p.unit_price - v_avg) <= v_avg * p_tolerance / 100;
  return round(coalesce(v_in, v_avg), 4);
end $$;

-- ---------------------------------------------------------------------------
-- Estimates (Order Management+)
-- ---------------------------------------------------------------------------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text not null unique,
  job_id uuid not null references public.jobs(id),
  rfq_id uuid references public.rfqs(id),
  response_id uuid references public.rfq_responses(id),
  supplier_id uuid not null references public.suppliers(id),
  source text not null check (source in ('rfq','adopt','adapt','push')),
  currency text not null,
  base_cost numeric(14,2) not null check (base_cost >= 0),
  benchmark_value numeric(14,2),
  benchmark_source text check (benchmark_source in ('live','rate_card','bypass')),
  target_value numeric(14,2),
  pricing_mode text not null default 'markup' check (pricing_mode in ('markup','margin')),
  pricing_percent numeric(6,2) not null default 0 check (pricing_percent >= 0),
  sell_price numeric(14,2) not null,
  savings_vs_benchmark numeric(14,2),
  savings_vs_target numeric(14,2),
  savings_target_percent numeric(6,2),
  bypass_reason_code text,
  selection_reason text,
  status text not null default 'draft' check (status in ('draft','sent','approved','declined')),
  client_order_ref text,
  sent_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  declined_reason text,
  region text not null,
  market text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pricing_mode = 'markup' or pricing_percent < 100)
);
create index estimates_job_idx on public.estimates (job_id);

create table public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  spec_id uuid not null references public.job_specs(id),
  rfq_line_id uuid references public.rfq_lines(id),
  triage_id uuid references public.spec_triage(id),
  quantity int not null check (quantity > 0),
  unit_cost numeric(14,4) not null,
  line_cost numeric(14,2) not null,
  benchmark_unit numeric(14,4),
  target_unit numeric(14,4)
);

create or replace function public.trg_estimates_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.estimate_number := public._next_number('EST'); else new.estimate_number := old.estimate_number; new.updated_at := now(); end if;
  new.sell_price := round(case when new.pricing_mode = 'margin' then new.base_cost / (1 - new.pricing_percent / 100)
                               else new.base_cost * (1 + new.pricing_percent / 100) end, 2);
  return new;
end $$;
create trigger estimates_before before insert or update on public.estimates for each row execute function public.trg_estimates_before();

-- Award: only through this function. Checks bidding has closed, finance approval, Assure+ eligibility at award time,
-- minimum valid quotes (or a governed bypass reason); marks losing quotes declined; drafts the estimate; audits.
create or replace function public.rfq_award(p_rfq uuid, p_response uuid, p_reason text, p_bypass_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.rfqs; q public.rfq_responses; s public.suppliers; j public.jobs; c public.sourcing_clients; v_valid int; v_open int;
  v_bypass public.library_records; v_est uuid; l record; v_bench numeric; v_unit numeric; v_base numeric := 0; v_bench_total numeric := 0;
  v_target_total numeric := 0; v_has_target boolean := false;
begin
  if not public.is_internal() then raise exception 'Only internal staff can award RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'sent' then raise exception 'Only an open RFQ can be awarded'; end if;
  select count(*) into v_open from public.rfq_invitations where rfq_id = p_rfq and status not in ('quoted','declined');
  if now() < r.due_at and v_open > 0 then
    raise exception 'Bidding is still open until %: award after the due date or once every invited supplier has responded', to_char(r.due_at, 'DD Mon YYYY HH24:MI');
  end if;
  select * into q from public.rfq_responses where id = p_response and rfq_id = p_rfq for update;
  if q.id is null then raise exception 'That quote is not on this RFQ'; end if;
  if q.status <> 'submitted' then raise exception 'Only a submitted quote can be awarded'; end if;
  if q.finance_status <> 'approved' then raise exception 'Finance has not approved this quote yet'; end if;
  select * into s from public.suppliers where id = q.supplier_id;
  if not s.active or s.purchasing_blocked then raise exception '% is blocked for purchasing in Assure+, so it can''t be awarded', s.name; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this supplier was chosen'; end if;
  select count(*) into v_valid from public.rfq_responses where rfq_id = p_rfq and status = 'submitted';
  if v_valid < coalesce(r.min_quotes_required, 1) then
    if nullif(trim(p_bypass_code), '') is null then
      raise exception 'Only % valid quote(s); this RFQ needs %. Wait for more quotes or award with a bypass reason.', v_valid, r.min_quotes_required;
    end if;
    select * into v_bypass from public.library_records where library_key = 'bypass_reasons' and code = trim(p_bypass_code) and status = 'active';
    if v_bypass.id is null then raise exception 'Choose an active bypass reason from the Watchtower library'; end if;
  end if;
  select * into j from public.jobs where id = r.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;

  -- Estimate draft from the winning quote, with live benchmark per line (first quantity break), computed before outcomes change.
  insert into public.estimates (job_id, rfq_id, response_id, supplier_id, source, currency, base_cost, pricing_mode, pricing_percent,
    savings_target_percent, bypass_reason_code, selection_reason, region, market, created_by, benchmark_source)
  values (r.job_id, p_rfq, p_response, q.supplier_id, 'rfq', r.currency, 0, 'markup', c.default_markup_percent,
    c.savings_target_percent, v_bypass.code, trim(p_reason), r.region, r.market, auth.uid(), case when v_bypass.id is not null then 'bypass' else 'live' end)
  returning id into v_est;
  for l in select * from public.rfq_lines where rfq_id = p_rfq order by line_no loop
    select unit_price into v_unit from public.rfq_response_prices where response_id = p_response and line_id = l.id and quantity = l.quantity_breaks[1];
    v_bench := public.rfq_line_benchmark(l.id, l.quantity_breaks[1], c.quote_tolerance_percent);
    insert into public.estimate_lines (estimate_id, spec_id, rfq_line_id, quantity, unit_cost, line_cost, benchmark_unit, target_unit)
    values (v_est, l.spec_id, l.id, l.quantity_breaks[1], v_unit, round(v_unit * l.quantity_breaks[1], 2), v_bench, l.target_prices[1]);
    v_base := v_base + v_unit * l.quantity_breaks[1];
    v_bench_total := v_bench_total + coalesce(v_bench, v_unit) * l.quantity_breaks[1];
    if l.target_prices[1] is not null then v_target_total := v_target_total + l.target_prices[1] * l.quantity_breaks[1]; v_has_target := true;
    else v_target_total := v_target_total + v_unit * l.quantity_breaks[1]; end if;
  end loop;
  update public.estimates set base_cost = round(v_base, 2), benchmark_value = round(v_bench_total, 2),
    savings_vs_benchmark = round(v_bench_total - v_base, 2),
    target_value = case when v_has_target then round(v_target_total, 2) end,
    savings_vs_target = case when v_has_target then round(v_target_total - v_base, 2) end
  where id = v_est;

  update public.rfq_responses set status = 'awarded', updated_at = now() where id = p_response;
  update public.rfq_responses set status = 'declined', updated_at = now() where rfq_id = p_rfq and id <> p_response and status in ('draft','submitted');
  update public.rfqs set status = 'awarded', awarded_response_id = p_response, awarded_by = auth.uid(), awarded_at = now(),
    award_reason = trim(p_reason), bypass_reason_code = v_bypass.code where id = p_rfq;
  if v_bypass.id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (v_bypass.id, 'rfqs', p_rfq::text, r.rfq_number) on conflict do nothing;
  end if;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'awarded', jsonb_build_object('response_id', p_response, 'supplier_id', q.supplier_id,
    'valid_quotes', v_valid, 'min_required', r.min_quotes_required, 'bypass', v_bypass.code, 'reason', trim(p_reason), 'estimate_id', v_est));
  perform public._sourcing_event(r.job_id, 'estimate', v_est, 'created', jsonb_build_object('source', 'rfq', 'rfq_id', p_rfq));
  return v_est;
end $$;

-- Adopt / Adapt / accepted Push lines skip the RFQ and go straight to an estimate at the applied price.
create or replace function public.estimate_create_from_triage(p_job uuid) returns int
language plpgsql security definer set search_path = public as $$
declare j public.jobs; c public.sourcing_clients; v_sup uuid; v_est uuid; t record; n int := 0; v_src text;
begin
  if not public.is_internal() then raise exception 'Only internal staff can create estimates' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  select * into c from public.sourcing_clients where id = j.client_id;
  for v_sup in
    select distinct t2.supplier_id from public.spec_triage t2 join public.job_specs s on s.id = t2.spec_id
     where s.job_id = p_job and t2.is_current and t2.supplier_id is not null
       and (t2.route in ('adopt','adapt') or (t2.route = 'push' and t2.push_status = 'accepted'))
       and not exists (select 1 from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
                        where el.spec_id = s.id and e.status <> 'declined')
  loop
    if not public.supplier_is_eligible(v_sup) then
      raise exception '% is no longer eligible in Assure+; re-run triage', (select name from public.suppliers where id = v_sup);
    end if;
    select min(t3.route) into v_src from public.spec_triage t3 join public.job_specs s3 on s3.id = t3.spec_id
     where s3.job_id = p_job and t3.is_current and t3.supplier_id = v_sup;
    insert into public.estimates (job_id, supplier_id, source, currency, base_cost, benchmark_source, pricing_mode, pricing_percent,
      savings_target_percent, selection_reason, region, market, created_by)
    values (p_job, v_sup, v_src, j.currency, 0, 'rate_card', 'markup', c.default_markup_percent, c.savings_target_percent,
      'Rate-card price applied at triage', j.region, j.market, auth.uid())
    returning id into v_est;
    insert into public.estimate_lines (estimate_id, spec_id, triage_id, quantity, unit_cost, line_cost, benchmark_unit)
    select v_est, t4.spec_id, t4.id, t4.quantity, t4.unit_price, round(t4.unit_price * t4.quantity, 2), t4.unit_price
      from public.spec_triage t4 join public.job_specs s4 on s4.id = t4.spec_id
     where s4.job_id = p_job and t4.is_current and t4.supplier_id = v_sup
       and (t4.route in ('adopt','adapt') or (t4.route = 'push' and t4.push_status = 'accepted'))
       and not exists (select 1 from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
                        where el.spec_id = s4.id and e.status <> 'declined' and e.id <> v_est);
    update public.estimates e set base_cost = x.total, benchmark_value = x.total, savings_vs_benchmark = 0
      from (select round(sum(line_cost), 2) total from public.estimate_lines where estimate_id = v_est) x where e.id = v_est;
    perform public._sourcing_event(p_job, 'estimate', v_est, 'created', jsonb_build_object('source', v_src));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No Adopt, Adapt or accepted Push lines are waiting for an estimate'; end if;
  return n;
end $$;

create or replace function public.estimate_set_pricing(p_estimate uuid, p_mode text, p_percent numeric) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can price estimates' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'draft' then raise exception 'Only a draft estimate can be repriced'; end if;
  if p_mode not in ('markup','margin') then raise exception 'Choose markup or margin'; end if;
  if p_percent is null or p_percent < 0 or (p_mode = 'margin' and p_percent >= 100) then raise exception 'Enter a valid percentage (margin must be under 100%%)'; end if;
  update public.estimates set pricing_mode = p_mode, pricing_percent = p_percent where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'priced', jsonb_build_object('mode', p_mode, 'percent', p_percent));
end $$;

create or replace function public.estimate_send(p_estimate uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can send estimates' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'draft' then raise exception 'Only a draft estimate can be sent'; end if;
  update public.estimates set status = 'sent', sent_at = now() where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'sent', '{}'::jsonb);
end $$;

create or replace function public.estimate_decline(p_estimate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can record a client decision' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status not in ('draft','sent') then raise exception 'This estimate can''t be declined now'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Record why the client declined'; end if;
  update public.estimates set status = 'declined', declined_reason = trim(p_reason) where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'declined', jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Integration outbox (Stocktool hand-off). Shared with other modules; created here if not yet present.
-- ---------------------------------------------------------------------------
create table if not exists public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  event text not null,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.integration_outbox enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'integration_outbox' and policyname = 'io_read') then
    create policy io_read on public.integration_outbox for select to authenticated using (public.is_internal());
  end if;
end $$;
revoke insert, update, delete on public.integration_outbox from authenticated, anon;

-- Client acceptance (recorded internally on the client's behalf) = estimate approved: Sourcing+ hands off to Stocktool.
create or replace function public.estimate_approve(p_estimate uuid, p_client_order_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; c public.sourcing_clients; b public.sourcing_billing_entities; s public.suppliers; v_payload jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can record a client approval' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'sent' then raise exception 'Send the estimate to the client before recording approval'; end if;
  select * into j from public.jobs where id = e.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into b from public.sourcing_billing_entities where id = j.billing_entity_id;
  select * into s from public.suppliers where id = e.supplier_id;
  update public.estimates set status = 'approved', client_order_ref = nullif(trim(p_client_order_ref), ''), approved_by = auth.uid(), approved_at = now()
   where id = p_estimate returning * into e;
  v_payload := jsonb_build_object(
    'estimate_number', e.estimate_number, 'job_number', j.job_number, 'job_title', j.title,
    'client_code', c.code, 'client_order_ref', e.client_order_ref, 'billing_entity_code', b.code,
    'supplier_code', s.supplier_code, 'currency', e.currency, 'region', e.region, 'market', e.market,
    'base_cost', e.base_cost, 'sell_price', e.sell_price, 'pricing_mode', e.pricing_mode, 'pricing_percent', e.pricing_percent,
    'approved_at', e.approved_at,
    'articles', (select coalesce(jsonb_agg(jsonb_build_object('spec_no', sp.spec_no, 'description', sp.title, 'spec_type', sp.spec_type,
        'hs_code', sp.hs_code, 'quantity', el.quantity, 'unit_cost', el.unit_cost,
        'unit_sell', round(case when e.pricing_mode = 'margin' then el.unit_cost / (1 - e.pricing_percent / 100) else el.unit_cost * (1 + e.pricing_percent / 100) end, 4),
        'unit_weight_grams', sp.unit_weight_grams) order by sp.spec_no), '[]'::jsonb)
      from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id where el.estimate_id = e.id));
  insert into public.integration_outbox (module, event, aggregate_type, aggregate_id, payload, created_by)
  values ('sourcing', 'estimate.approved', 'estimate', e.id, v_payload, auth.uid());
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'approved', jsonb_build_object('client_order_ref', e.client_order_ref));
end $$;

-- ---------------------------------------------------------------------------
-- Supplier purchase orders with DOA approval
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  job_id uuid not null references public.jobs(id),
  estimate_id uuid not null references public.estimates(id),
  supplier_id uuid not null references public.suppliers(id),
  currency text not null,
  total_value numeric(14,2) not null check (total_value >= 0),
  po_date date not null default current_date,
  delivery_date date,
  status text not null default 'pending_approval' check (status in ('pending_approval','rejected','issued','accepted','declined','cancelled')),
  required_doa_level int not null,
  doa_record_id uuid references public.library_records(id),
  doa_basis text,
  exceeds_e_tender boolean not null default false,
  approved_by uuid references public.profiles(id),
  approver_doa_level int,
  approved_at timestamptz,
  rejected_reason text,
  vendor_responded_at timestamptz,
  vendor_responded_by uuid references public.profiles(id),
  vendor_decline_reason text,
  region text not null,
  market text not null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index purchase_orders_one_live_per_estimate on public.purchase_orders (estimate_id) where status not in ('rejected','cancelled','declined');
create index purchase_orders_status_idx on public.purchase_orders (status);

create or replace function public.trg_po_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.po_number := public._next_number('PO'); else new.po_number := old.po_number; new.updated_at := now(); end if;
  return new;
end $$;
create trigger po_before before insert or update on public.purchase_orders for each row execute function public.trg_po_before();

-- Required DOA level: lowest level whose ceiling covers the value, from the doa_levels library version effective on the PO date,
-- same-currency levels first (thresholdAlertCompute).
create or replace function public.doa_required_level(p_value numeric, p_currency text, p_date date)
returns table (level int, record_id uuid, basis text)
language plpgsql stable security definer set search_path = public as $$
declare v_same boolean; r public.library_records;
begin
  select exists (select 1 from public.library_records where library_key = 'doa_levels' and status in ('active','superseded')
     and effective_from <= p_date and (effective_to is null or effective_to >= p_date) and coalesce(data->>'currency', 'GBP') = p_currency) into v_same;
  select lr.* into r from public.library_records lr
   where lr.library_key = 'doa_levels' and lr.status in ('active','superseded')
     and lr.effective_from <= p_date and (lr.effective_to is null or lr.effective_to >= p_date)
     and (not v_same or coalesce(lr.data->>'currency', 'GBP') = p_currency)
     and (lr.data->>'max_approval_amount' is null or (lr.data->>'max_approval_amount')::numeric >= p_value)
   order by (lr.data->>'approval_level')::int limit 1;
  if r.id is null then
    select lr.* into r from public.library_records lr
     where lr.library_key = 'doa_levels' and lr.status in ('active','superseded')
       and lr.effective_from <= p_date and (lr.effective_to is null or lr.effective_to >= p_date)
       and (not v_same or coalesce(lr.data->>'currency', 'GBP') = p_currency)
     order by (lr.data->>'approval_level')::int desc limit 1;
  end if;
  if r.id is null then raise exception 'No delegation-of-authority levels are in force on %; set them up in the Watchtower', p_date; end if;
  return query select (r.data->>'approval_level')::int, r.id,
    format('%s (%s %s) from the DOA matrix in force on %s%s', r.name, coalesce(r.data->>'currency', 'GBP'),
      coalesce(r.data->>'threshold_label', coalesce(r.data->>'max_approval_amount', 'uncapped')), p_date,
      case when v_same then '' else '; no levels in ' || p_currency || ', so all currencies were used' end);
end $$;

create or replace function public.po_create_from_estimate(p_estimate uuid, p_delivery_date date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.estimates; j public.jobs; c public.sourcing_clients; d record; v_id uuid; s public.suppliers;
begin
  if not public.is_internal() then raise exception 'Only internal staff can raise purchase orders' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status <> 'approved' then raise exception 'The client must approve the estimate before a supplier PO is raised'; end if;
  if exists (select 1 from public.purchase_orders where estimate_id = p_estimate and status not in ('rejected','cancelled','declined')) then
    raise exception 'This estimate already has a live purchase order';
  end if;
  select * into s from public.suppliers where id = e.supplier_id;
  if not s.active or s.purchasing_blocked then raise exception '% is blocked for purchasing in Assure+', s.name; end if;
  select * into j from public.jobs where id = e.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into d from public.doa_required_level(e.base_cost, e.currency, current_date);
  insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, doa_record_id,
    doa_basis, exceeds_e_tender, region, market, notes, created_by)
  values (e.job_id, e.id, e.supplier_id, e.currency, e.base_cost, coalesce(p_delivery_date, j.target_delivery_date), d.level, d.record_id,
    d.basis, c.e_tender_threshold is not null and e.base_cost > c.e_tender_threshold, j.region, j.market, p_notes, auth.uid())
  returning id into v_id;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (d.record_id, 'purchase_orders', v_id::text, 'PO') on conflict do nothing;
  perform public._sourcing_event(e.job_id, 'po', v_id, 'created', jsonb_build_object('estimate_id', p_estimate, 'total', e.base_cost, 'required_doa_level', d.level));
  return v_id;
end $$;

create or replace function public.po_approve(p_po uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; v_level int := public.sourcing_doa_level(); s public.suppliers;
begin
  if not public.is_internal() then raise exception 'Only internal staff can approve purchase orders' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.status <> 'pending_approval' then raise exception 'This PO is not waiting for approval'; end if;
  if p.created_by = auth.uid() then raise exception 'A different person must approve the PO you raised'; end if;
  if v_level is null then raise exception 'You have no delegated approval authority in Sourcing+' using errcode = '42501'; end if;
  if v_level < p.required_doa_level then
    raise exception 'This PO needs DOA level % approval; your level is %', p.required_doa_level, v_level using errcode = '42501';
  end if;
  select * into s from public.suppliers where id = p.supplier_id;
  if not s.active or s.purchasing_blocked then raise exception '% is blocked for purchasing in Assure+', s.name; end if;
  update public.purchase_orders set status = 'issued', approved_by = auth.uid(), approver_doa_level = v_level, approved_at = now() where id = p_po;
  insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
  select s.primary_contact_email, 'Purchase order ' || p.po_number, format('Purchase order %s for %s %s is ready. Open your vendor portal to accept it.', p.po_number, p.currency, p.total_value), s.id, auth.uid()
   where s.primary_contact_email is not null;
  perform public._job_advance(p.job_id, array['open','quoting'], 'ordered');
  perform public._sourcing_event(p.job_id, 'po', p_po, 'approved', jsonb_build_object('approver_level', v_level, 'required', p.required_doa_level, 'note', p_note));
end $$;

create or replace function public.po_reject(p_po uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders;
begin
  if not public.is_internal() then raise exception 'Only internal staff can reject purchase orders' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or p.status <> 'pending_approval' then raise exception 'This PO is not waiting for approval'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the PO is rejected'; end if;
  update public.purchase_orders set status = 'rejected', rejected_reason = trim(p_reason) where id = p_po;
  perform public._sourcing_event(p.job_id, 'po', p_po, 'rejected', jsonb_build_object('reason', p_reason));
end $$;

-- Vendor side (for the vendor portal).
create or replace function public.po_vendor_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'po_number', p.po_number, 'job_number', j.job_number, 'title', j.title,
    'currency', p.currency, 'total_value', p.total_value, 'po_date', p.po_date, 'delivery_date', p.delivery_date, 'status', p.status,
    'responded_at', p.vendor_responded_at) order by p.po_date desc), '[]'::jsonb)
  from public.purchase_orders p join public.jobs j on j.id = p.job_id
  where p.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and p.status in ('issued','accepted','declined');
$$;

create or replace function public.po_vendor_respond(p_po uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null or public.my_supplier_id() is null or p.supplier_id is distinct from public.my_supplier_id() or p.status not in ('issued','accepted','declined') then
    raise exception 'Purchase order not found' using errcode = '42501';
  end if;
  if p.status <> 'issued' then raise exception 'You have already responded to this purchase order'; end if;
  if not p_accept and coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are declining'; end if;
  update public.purchase_orders set status = case when p_accept then 'accepted' else 'declined' end, vendor_responded_at = now(),
    vendor_responded_by = auth.uid(), vendor_decline_reason = case when p_accept then null else trim(p_reason) end where id = p_po;
  if p_accept then perform public._job_advance(p.job_id, array['ordered'], 'in_production'); end if;
  perform public._sourcing_event(p.job_id, 'po', p_po, case when p_accept then 'vendor_accepted' else 'vendor_declined' end, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Read views for the app (security invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_jobs with (security_invoker = true) as
  select j.*, c.name as client_name, c.code as client_code, b.name as billing_entity_name,
         (select count(*) from public.job_specs s where s.job_id = j.id)::int as spec_count,
         (select count(*) from public.rfqs r where r.job_id = j.id and r.status <> 'cancelled')::int as rfq_count,
         (select count(*) from public.purchase_orders p where p.job_id = j.id and p.status not in ('rejected','cancelled'))::int as po_count
    from public.jobs j join public.sourcing_clients c on c.id = j.client_id
    left join public.sourcing_billing_entities b on b.id = j.billing_entity_id;

create view public.v_specs with (security_invoker = true) as
  select s.*, j.job_number, j.title as job_title, c.name as client_name, sub.name as substrate_name,
         (select coalesce(sum(quantity), 0) from public.spec_versions v where v.spec_id = s.id)::int as total_quantity,
         t.id as triage_id, t.route, t.reason as triage_reason, t.confidence, t.unit_price as triage_unit_price, t.push_status,
         t.supplier_id as triage_supplier_id, ts.name as triage_supplier_name, t.decided_at as triage_at, t.source as triage_source,
         rc.name as rate_card_name
    from public.job_specs s join public.jobs j on j.id = s.job_id join public.sourcing_clients c on c.id = j.client_id
    left join public.library_records sub on sub.id = s.substrate_id
    left join public.spec_triage t on t.spec_id = s.id and t.is_current
    left join public.suppliers ts on ts.id = t.supplier_id
    left join public.library_records rc on rc.id = t.rate_card_id;

create view public.v_rfqs with (security_invoker = true) as
  select r.*, j.job_number, j.title as job_title, c.name as client_name,
         (select count(*) from public.rfq_invitations i where i.rfq_id = r.id)::int as invited_count,
         (select count(*) from public.rfq_responses q where q.rfq_id = r.id and q.status in ('submitted','awarded'))::int as quote_count,
         (select count(*) from public.rfq_invitations i where i.rfq_id = r.id and i.status = 'declined')::int as declined_count,
         (select count(*) from public.rfq_lines l where l.rfq_id = r.id)::int as line_count,
         ws.name as awarded_supplier_name
    from public.rfqs r join public.jobs j on j.id = r.job_id join public.sourcing_clients c on c.id = j.client_id
    left join public.rfq_responses wr on wr.id = r.awarded_response_id
    left join public.suppliers ws on ws.id = wr.supplier_id;

create view public.v_rfq_responses with (security_invoker = true) as
  select q.*, s.name as supplier_name, s.supplier_code, s.market as supplier_market, s.purchasing_blocked, s.active as supplier_active
    from public.rfq_responses q join public.suppliers s on s.id = q.supplier_id;

create view public.v_rfq_invitations with (security_invoker = true) as
  select i.*, s.name as supplier_name, s.supplier_code, s.market as supplier_market, s.purchasing_blocked, s.active as supplier_active
    from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id;

create view public.v_estimates with (security_invoker = true) as
  select e.*, j.job_number, j.title as job_title, c.name as client_name, s.name as supplier_name, r.rfq_number
    from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = e.supplier_id left join public.rfqs r on r.id = e.rfq_id;

create view public.v_purchase_orders with (security_invoker = true) as
  select p.*, j.job_number, j.title as job_title, c.name as client_name, s.name as supplier_name, s.supplier_code,
         e.estimate_number, ab.full_name as approved_by_name
    from public.purchase_orders p join public.jobs j on j.id = p.job_id join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = p.supplier_id join public.estimates e on e.id = p.estimate_id
    left join public.profiles ab on ab.id = p.approved_by;

-- The Assure+ eligible pool for RFQ supplier selection.
create view public.v_eligible_suppliers with (security_invoker = true) as
  select id, supplier_code, name, market, region, category, tier, rag
    from public.suppliers where active and not purchasing_blocked;

-- Sourcing+ health for the Watchtower (standard rows: module, metric, label, value, target, status).
create view public.watchtower_health_sourcing with (security_invoker = true) as
  with below as (
    select count(*)::numeric n from public.rfqs r
     where r.status = 'sent' and (select count(*) from public.rfq_responses q where q.rfq_id = r.id and q.status = 'submitted') < coalesce(r.min_quotes_required, 1)
  ), doa as (
    select count(*)::numeric n from public.purchase_orders where status = 'pending_approval'
  ), sav as (
    select coalesce(round(100 * sum(savings_vs_target) / nullif(sum(target_value), 0), 1), 0) pct,
           (select coalesce(round(avg(savings_target_percent), 1), 0) from public.sourcing_clients where active) target
      from public.estimates where status <> 'declined' and target_value is not null
  ), hv as (
    select count(*)::numeric n from public.rfqs where status = 'draft' and high_value_alert and high_value_approved_by is null
  ), mix as (
    select coalesce(round(100.0 * count(*) filter (where route <> 'create') / nullif(count(*), 0), 1), 0) pct from public.spec_triage where is_current
  )
  select 'sourcing'::text as module, 'rfqs_below_min_quotes'::text as metric, 'Open RFQs below minimum quotes'::text as label, below.n as value, 0::numeric as target,
         case when below.n = 0 then 'ok' else 'warn' end as status from below
  union all select 'sourcing', 'pos_awaiting_doa', 'POs awaiting DOA approval', doa.n, 0, case when doa.n = 0 then 'ok' when doa.n <= 3 then 'warn' else 'bad' end from doa
  union all select 'sourcing', 'savings_vs_target', 'Savings vs target prices (%)', sav.pct, sav.target, case when sav.pct >= sav.target then 'ok' when sav.pct >= 0 then 'warn' else 'bad' end from sav
  union all select 'sourcing', 'high_value_awaiting_approval', 'High-value RFQs awaiting approval', hv.n, 0, case when hv.n = 0 then 'ok' else 'warn' end from hv
  union all select 'sourcing', 'triage_no_rfq_share', 'Spec lines priced without an RFQ (%)', mix.pct, 30, case when mix.pct >= 30 then 'ok' else 'warn' end from mix;

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.rfqs enable row level security;
alter table public.rfq_lines enable row level security;
alter table public.rfq_invitations enable row level security;
alter table public.rfq_responses enable row level security;
alter table public.rfq_response_prices enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
alter table public.purchase_orders enable row level security;

-- Internal staff read everything; vendors read nothing directly (only via rfq_vendor_* / po_vendor_* functions),
-- except their own issued purchase orders.
create policy rfqs_read on public.rfqs for select to authenticated using (public.is_internal());
create policy rfql_read on public.rfq_lines for select to authenticated using (public.is_internal());
create policy rfqi_read on public.rfq_invitations for select to authenticated using (public.is_internal());
create policy rfqr_read on public.rfq_responses for select to authenticated using (public.is_internal());
create policy rfqp_read on public.rfq_response_prices for select to authenticated using (public.is_internal());
create policy est_read on public.estimates for select to authenticated using (public.is_internal());
create policy estl_read on public.estimate_lines for select to authenticated using (public.is_internal());
create policy po_read on public.purchase_orders for select to authenticated
  using (public.is_internal() or (supplier_id = public.my_supplier_id() and status in ('issued','accepted','declined')));

revoke insert, update, delete on public.rfqs, public.rfq_lines, public.rfq_invitations, public.rfq_responses, public.rfq_response_prices,
  public.estimates, public.estimate_lines, public.purchase_orders from authenticated, anon;
revoke insert, update, delete on public.v_jobs, public.v_specs, public.v_rfqs, public.v_rfq_responses, public.v_rfq_invitations,
  public.v_estimates, public.v_purchase_orders, public.v_eligible_suppliers, public.watchtower_health_sourcing from authenticated, anon;

revoke execute on function public._next_number(text), public._rfq_write_lines(uuid, uuid, jsonb), public._rfq_flag_high_value(uuid),
  public._rfq_save_prices(uuid, uuid, jsonb, boolean), public._vendor_invitation(uuid),
  public._control_rule(numeric, uuid, text, boolean, date), public._high_value_threshold(text, date)
  from public, anon, authenticated;
