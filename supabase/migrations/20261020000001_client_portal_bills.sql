-- Client Portal: the client's bills from Finance+ (sent and paid only; never drafts, cost or margin).
create or replace function public.client_portal_bills(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'bill_number', b.bill_number, 'client_name', sc.name, 'billing_entity', be.name,
      'job_number', j.job_number, 'job_title', j.title, 'estimate_number', e.estimate_number, 'client_order_ref', b.client_order_ref,
      'currency', b.currency, 'net_amount', b.net_amount, 'vat_percent', b.vat_percent, 'vat_amount', b.vat_amount, 'gross_amount', b.gross_amount,
      'issue_date', b.issue_date, 'due_date', b.due_date, 'paid_at', b.paid_at, 'payment_reference', b.payment_reference,
      'region', b.region, 'market', b.market,
      'status', case when b.status = 'sent' and b.due_date < current_date then 'overdue' else b.status end)
    order by coalesce(b.issue_date, b.created_at::date) desc), '[]'::jsonb)
    from public.client_bills b
    join public.sourcing_clients sc on sc.id = b.client_id
    join public.jobs j on j.id = b.job_id
    join public.estimates e on e.id = b.estimate_id
    left join public.sourcing_billing_entities be on be.id = b.billing_entity_id
   where b.client_id = any (v) and b.status in ('sent','paid'));
end $$;

revoke all on function public.client_portal_bills(uuid) from public, anon;
grant execute on function public.client_portal_bills(uuid) to authenticated;
