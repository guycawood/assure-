-- GBT RFP process r26: when an RFQ is cancelled, the suppliers who were invited are told, with the reason.
-- A draft RFQ never reached suppliers, so nothing is sent for it. The original function is kept and wrapped.

alter function public.rfq_cancel(uuid, text) rename to _rc_pre_rfq_cancel;
revoke execute on function public._rc_pre_rfq_cancel(uuid, text) from public, anon, authenticated;

create or replace function public.rfq_cancel(p_rfq uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_was text; s record;
begin
  select status into v_was from public.rfqs where id = p_rfq;
  perform public._rc_pre_rfq_cancel(p_rfq, p_reason);
  if v_was is distinct from 'sent' then return; end if;
  select * into r from public.rfqs where id = p_rfq;
  for s in
    select su.id, su.primary_contact_email
      from public.rfq_invitations i join public.suppliers su on su.id = i.supplier_id
     where i.rfq_id = p_rfq
  loop
    perform public.notify_supplier(s.id, 'vendor', 'RFQ ' || r.rfq_number || ' cancelled', left(trim(p_reason), 140), '/vendor/quotes');
    if s.primary_contact_email is not null then
      insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
      values (s.primary_contact_email, 'Request for quote ' || r.rfq_number || ' cancelled',
              format('The request for quote %s (%s) has been cancelled, so there is nothing more to quote. Reason: %s', r.rfq_number, r.title, trim(p_reason)),
              s.id, auth.uid());
    end if;
  end loop;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'suppliers_notified', jsonb_build_object('reason', trim(p_reason)));
end $$;
revoke execute on function public.rfq_cancel(uuid, text) from public, anon;
grant execute on function public.rfq_cancel(uuid, text) to authenticated;
