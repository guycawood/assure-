-- Supplier onboarding aligned to the Global Business Transformation process (Supplier onboarding, Indicia):
--   i3  category management confirms the supplier is of interest, before the information request goes out
--   i8  external databases (Sedex and FSC) are searched alongside the information request, and the result is recorded
-- The nine-stage standard already covers the rest. The supplier record and system IDs (step i23) live in SRM; there is no separate supplier hub.

-- ---------------------------------------------------------------------------
-- i3: a triage-stage gate that only category management can clear
-- ---------------------------------------------------------------------------
insert into public.gate_definitions (key, label, stage, critical, has_expiry, verifier_role, sort, stage_key, standard_gate, vendor_facing, vendor_label, allows_gap) values
  ('category_interest', 'Category management confirms the supplier is of interest', 'Triage', false, false, 'category', 320, 'triage', true, false, null, false)
on conflict (key) do nothing;

-- Suppliers that already exist: legacy ones are not asked; standard ones that already passed triage keep their stage;
-- the rest wait for the decision.
alter table public.supplier_gates disable trigger gate_changed;
insert into public.supplier_gates (supplier_id, gate_key, status, note)
select s.id, 'category_interest',
       case when s.onboarding_baseline = 'legacy' then 'not_required'
            when exists (select 1 from public.supplier_gates t where t.supplier_id = s.id and t.gate_key = 'triage' and t.status in ('verified', 'not_required')) then 'verified'
            else 'missing' end,
       case when s.onboarding_baseline = 'legacy' then 'Approved before the category interest step existed'
            when exists (select 1 from public.supplier_gates t where t.supplier_id = s.id and t.gate_key = 'triage' and t.status in ('verified', 'not_required')) then 'Passed triage before the category interest step existed' end
  from public.suppliers s
on conflict do nothing;
alter table public.supplier_gates enable trigger gate_changed;

create or replace function public.onboarding_category_interest(p_supplier uuid, p_interested boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases; v_who text;
begin
  perform public._assure_require_internal();
  if not public.approval_has_role('category_manager', 'assure') then
    raise exception 'Only a Category Manager can say whether the supplier is of interest' using errcode = '42501';
  end if;
  c := public._onb_case(p_supplier);
  if c.id is null or c.status <> 'in_onboarding' then raise exception 'There is no onboarding request waiting for this decision'; end if;
  if not public._onb_gate_clear(p_supplier, 'triage') then raise exception 'Procurement triage comes first'; end if;
  if public._onb_gate_clear(p_supplier, 'category_interest') then raise exception 'This has already been decided'; end if;
  if c.requested_by = auth.uid() then raise exception 'You raised this request, so another Category Manager must decide it' using errcode = '42501'; end if;
  if p_interested is null then raise exception 'Say whether the supplier is of interest'; end if;
  if not p_interested and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say why the supplier is not of interest'; end if;
  select coalesce(nullif(full_name, ''), email) into v_who from public.profiles where id = auth.uid();

  if p_interested then
    perform public._onb_set_gate(p_supplier, 'category_interest', 'verified', 'Of interest to category management (' || v_who || ')' || coalesce(': ' || nullif(trim(p_note), ''), ''));
    perform public._onb_event(p_supplier, c.id, 'category_interest', 'Category management confirmed the supplier is of interest', jsonb_build_object('note', nullif(trim(p_note), '')), false, true);
    perform public._ticket_event(c.ticket_id, 'Category management confirmed the supplier is of interest; the information request can be sent');
  else
    perform public._onb_set_gate(p_supplier, 'category_interest', 'rejected', 'Not of interest', trim(p_note));
    update public.onboarding_cases set status = 'declined', decline_reason = trim(p_note), updated_at = now() where id = c.id;
    update public.srt_tickets set status = 'resolved', resolution = 'rejected' where id = c.ticket_id and status <> 'resolved';
    perform public._ticket_event(c.ticket_id, 'Category management declined the supplier: ' || trim(p_note));
    perform public._onb_event(p_supplier, c.id, 'category_declined', 'Category management declined the supplier', jsonb_build_object('reason', trim(p_note)), false, true);
  end if;
  perform public.notify(c.requested_by, 'assure', case when p_interested then 'Supplier of interest: ' else 'Supplier not of interest: ' end || c.proposed_name,
    nullif(trim(p_note), ''), '/assure/suppliers/' || p_supplier || '?tab=record');
  perform public.recompute_supplier_compliance(p_supplier);
end $$;
grant execute on function public.onboarding_category_interest(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- i8: external database searches (Sedex, FSC), recorded on the supplier and fed to the scorecard
-- ---------------------------------------------------------------------------
create table public.supplier_external_checks (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  source text not null check (source in ('sedex', 'fsc')),
  result text not null check (result in ('active', 'expired', 'none', 'not_applicable')),
  reference text,
  note text,
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (supplier_id, source),
  check (source <> 'sedex' or result <> 'not_applicable'),
  check (source <> 'fsc' or result <> 'none')
);
alter table public.supplier_external_checks enable row level security;
create policy sec_read on public.supplier_external_checks for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.supplier_external_checks from authenticated, anon;

create or replace function public.onboarding_external_check(p_supplier uuid, p_source text, p_result text, p_reference text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases;
begin
  perform public._assure_require_internal();
  if not exists (select 1 from public.suppliers where id = p_supplier) then raise exception 'Supplier not found'; end if;
  if p_source not in ('sedex', 'fsc') then raise exception 'Choose Sedex or FSC'; end if;
  if p_source = 'sedex' and p_result not in ('active', 'expired', 'none') then raise exception 'For Sedex choose active, expired or no membership'; end if;
  if p_source = 'fsc' and p_result not in ('active', 'expired', 'not_applicable') then raise exception 'For FSC choose active, expired or not applicable'; end if;
  if p_result = 'active' and coalesce(length(trim(p_reference)), 0) < 2 then raise exception 'Record the membership or certificate number that was found'; end if;
  insert into public.supplier_external_checks (supplier_id, source, result, reference, note, checked_by, checked_at)
  values (p_supplier, p_source, p_result, nullif(trim(p_reference), ''), nullif(trim(p_note), ''), auth.uid(), now())
  on conflict (supplier_id, source) do update set result = excluded.result, reference = excluded.reference, note = excluded.note,
    checked_by = excluded.checked_by, checked_at = excluded.checked_at;
  -- The SRM scorecard reads these as its Sedex and FSC inputs, so the Supplier Score in the Impact Grade follows.
  insert into public.scorecard_inputs (supplier_id, key, value_text, as_of, source)
  values (p_supplier, p_source, p_result, current_date, 'SRM external database check')
  on conflict (supplier_id, key) do update set value_text = excluded.value_text, value_num = null, as_of = excluded.as_of, source = excluded.source;
  c := public._onb_case(p_supplier);
  perform public._onb_event(p_supplier, c.id, 'external_check', upper(p_source) || ' database checked: ' || p_result,
    jsonb_build_object('source', p_source, 'result', p_result, 'reference', nullif(trim(p_reference), '')));
end $$;
grant execute on function public.onboarding_external_check(uuid, text, text, text, text) to authenticated;

-- The information request goes out only after category management has confirmed the supplier is of interest (i3 before i6).
alter function public.send_vendor_rfi(uuid, text, text, text) rename to _onb_pre_interest_send_vendor_rfi;
create function public.send_vendor_rfi(p_ticket uuid, p_email text, p_contact_name text, p_link_base text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.srt_tickets;
begin
  select * into t from public.srt_tickets where id = p_ticket;
  if t.id is not null and t.supplier_id is not null and not public._onb_gate_clear(t.supplier_id, 'category_interest') then
    raise exception 'Category management has to confirm the supplier is of interest before the information request is sent';
  end if;
  return public._onb_pre_interest_send_vendor_rfi(p_ticket, p_email, p_contact_name, p_link_base);
end $$;
grant execute on function public.send_vendor_rfi(uuid, text, text, text) to authenticated;
revoke execute on function public._onb_pre_interest_send_vendor_rfi(uuid, text, text, text) from public, anon, authenticated;