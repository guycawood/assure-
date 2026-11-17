-- Ready to be invoiced, aligned to the Global Business Transformation process "Delivery by incoterm and goods in" (step d7)
-- and "Logistics and warehousing" (g18): the client is billed after delivery is confirmed.
-- An approved estimate is ready to invoice when its supplier POs have deliveries, every delivery is delivered and every POD is verified.
-- Finance can waive the check for one estimate with a reason (for example a service with nothing to deliver); the waiver is recorded.

alter table public.estimates
  add column bill_gate_waived_reason text,
  add column bill_gate_waived_by uuid references public.profiles(id) on delete set null,
  add column bill_gate_waived_at timestamptz;

-- What is missing for one estimate. Internal staff can read it.
create or replace function public.finance_bill_readiness(p_estimate uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; n_po int; n_del int; n_delivered int; n_pod_open int; v_missing text[] := '{}';
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate;
  if e.id is null then raise exception 'Estimate not found'; end if;
  select count(*) into n_po from public.purchase_orders where estimate_id = p_estimate and status not in ('declined', 'cancelled', 'rejected');
  select count(*), count(*) filter (where d.status = 'delivered'),
         coalesce(sum((select count(*) from public.shipments s where s.delivery_id = d.id and s.pod_status <> 'verified')), 0)
    into n_del, n_delivered, n_pod_open
    from public.deliveries d join public.purchase_orders p on p.id = d.po_id
   where p.estimate_id = p_estimate and d.status <> 'cancelled';
  if n_po = 0 then v_missing := v_missing || 'No supplier PO on this estimate'::text;
  elsif n_del = 0 then v_missing := v_missing || 'No deliveries recorded in Logistics+'::text;
  elsif n_delivered < n_del then v_missing := v_missing || format('%s of %s deliveries not delivered yet', n_del - n_delivered, n_del);
  end if;
  if n_pod_open > 0 then v_missing := v_missing || format('%s POD(s) not verified', n_pod_open); end if;
  return jsonb_build_object('ready', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing), 'waived', e.bill_gate_waived_at is not null,
    'waived_reason', e.bill_gate_waived_reason, 'deliveries', n_del, 'delivered', n_delivered, 'pods_unverified', n_pod_open);
end $$;
grant execute on function public.finance_bill_readiness(uuid) to authenticated;

create or replace function public.finance_bill_waive_gate(p_estimate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  perform public._finance_require();
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status <> 'approved' then raise exception 'Only an approved estimate can be billed'; end if;
  if exists (select 1 from public.client_bills where estimate_id = p_estimate and status <> 'cancelled') then raise exception 'This estimate already has a bill'; end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then raise exception 'Say why the delivery check is waived (at least 10 characters)'; end if;
  update public.estimates set bill_gate_waived_reason = trim(p_reason), bill_gate_waived_by = auth.uid(), bill_gate_waived_at = now() where id = p_estimate;
  perform public._finance_event('estimate', p_estimate, null, 'bill_gate_waived', null, null, jsonb_build_object('reason', trim(p_reason)));
end $$;
grant execute on function public.finance_bill_waive_gate(uuid, text) to authenticated;

-- The bill: refused until the estimate is ready to invoice, or the check is waived.
alter function public.finance_bill_create(uuid, numeric, text) rename to _rti_pre_finance_bill_create;
create function public.finance_bill_create(p_estimate uuid, p_vat_percent numeric default 0, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; r jsonb;
begin
  perform public._finance_require();
  select * into e from public.estimates where id = p_estimate;
  if e.id is not null and e.status = 'approved' and e.bill_gate_waived_at is null
     and not exists (select 1 from public.client_bills where estimate_id = p_estimate and status <> 'cancelled') then
    r := public.finance_bill_readiness(p_estimate);
    if not (r->>'ready')::boolean then
      raise exception 'Not ready to invoice: %. Finance can waive the delivery check with a reason.', array_to_string(array(select jsonb_array_elements_text(r->'missing')), '; ');
    end if;
  end if;
  return public._rti_pre_finance_bill_create(p_estimate, p_vat_percent, p_notes);
end $$;
grant execute on function public.finance_bill_create(uuid, numeric, text) to authenticated;
revoke execute on function public._rti_pre_finance_bill_create(uuid, numeric, text) from public, anon, authenticated;
