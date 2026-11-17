-- SRM: every vendor and every job coming through, with each vendor's payment journey (invoice received, approved, scheduled, paid,
-- with the expected pay date). SRM owners and the SRT see all clients. Money (order value, invoice amount) is hidden from the SRT
-- level, which sees vendor performance and payment status only. Vendors never reach this function: it is internal staff only.

create or replace function public._srm_can_see_money() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or coalesce(public.my_srt_role() in ('lead', 'finance', 'procurement', 'head', 'director'), false)
      or coalesce((select is_lead or is_finance from public.sourcing_user_access where user_id = auth.uid()), false);
$$;
revoke execute on function public._srm_can_see_money() from public, anon;
grant execute on function public._srm_can_see_money() to authenticated;

-- One row per live purchase order, with its latest invoice and where that invoice is on the way to being paid.
-- Not readable directly: srm_vendor_jobs reads it and decides what the caller may see.
create or replace view public.srm_vendor_job_rows as
  select p.id as po_id, p.po_number, p.status as po_status, p.po_date, p.delivery_date, p.total_value, p.currency,
         j.id as job_id, j.job_number, j.title as job_title, c.id as client_id, c.name as client_name, c.code as client_code,
         s.id as supplier_id, s.name as supplier_name, s.supplier_code, p.region, p.market,
         i.id as invoice_id, i.invoice_ref, i.invoice_number, i.status as invoice_status, i.gross_amount, i.paid_at,
         case when i.id is null then 'no_invoice'
              when i.status in ('submitted', 'matching') then 'invoice_received'
              else i.status end as stage,
         coalesce((select min(ps.due_date) from public.payment_schedule_items ps where ps.invoice_id = i.id and ps.paid_at is null), i.due_date) as expected_date
    from public.purchase_orders p
    join public.jobs j on j.id = p.job_id
    join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = p.supplier_id
    left join lateral (select x.* from public.supplier_invoices x where x.po_id = p.id and x.status <> 'rejected' order by x.submitted_at desc limit 1) i on true
   where p.status in ('issued', 'accepted');
revoke all on public.srm_vendor_job_rows from public, anon, authenticated;

create or replace function public.srm_vendor_jobs(p_vendor uuid default null, p_client uuid default null, p_region text default null,
  p_market text default null, p_stage text default null, p_from date default null, p_to date default null, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_money boolean; v_rows jsonb; v_sum jsonb;
begin
  perform public._assure_require_internal();
  v_money := public._srm_can_see_money();

  with r as (
    select *, (stage <> 'paid' and stage <> 'no_invoice' and expected_date is not null and expected_date < current_date) as overdue
      from public.srm_vendor_job_rows
     where (p_vendor is null or supplier_id = p_vendor)
       and (p_client is null or client_id = p_client)
       and (p_region is null or region = p_region)
       and (p_market is null or market = upper(p_market))
       and (p_stage is null or stage = p_stage or (p_stage = 'overdue' and stage <> 'paid' and stage <> 'no_invoice' and expected_date < current_date))
       and (p_from is null or po_date >= p_from)
       and (p_to is null or po_date <= p_to)
  ), shown as (
    select * from r order by overdue desc, expected_date nulls last, po_date desc limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  select
    coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'po_id', po_id, 'po_number', po_number, 'po_status', po_status, 'po_date', po_date, 'delivery_date', delivery_date,
      'job_id', job_id, 'job_number', job_number, 'job_title', job_title, 'client_name', client_name, 'client_code', client_code,
      'supplier_id', supplier_id, 'supplier_name', supplier_name, 'region', region, 'market', market,
      'invoice_ref', invoice_ref, 'invoice_status', invoice_status, 'stage', stage, 'expected_date', expected_date,
      'paid_at', paid_at, 'overdue', overdue,
      'po_value', case when v_money then total_value end, 'invoice_amount', case when v_money then gross_amount end,
      'currency', case when v_money then currency end))
      order by overdue desc, expected_date nulls last, po_date desc) from shown), '[]'::jsonb),
    jsonb_build_object(
      'total', (select count(*) from r),
      'no_invoice', (select count(*) from r where stage = 'no_invoice'),
      'invoice_received', (select count(*) from r where stage = 'invoice_received'),
      'approved', (select count(*) from r where stage = 'approved'),
      'scheduled', (select count(*) from r where stage = 'scheduled'),
      'paid', (select count(*) from r where stage = 'paid'),
      'disputed', (select count(*) from r where stage = 'disputed'),
      'overdue', (select count(*) from r where overdue),
      'can_see_money', v_money)
  into v_rows, v_sum;
  return jsonb_build_object('rows', v_rows, 'summary', v_sum);
end $$;
revoke execute on function public.srm_vendor_jobs(uuid, uuid, text, text, text, date, date, int) from public, anon;
grant execute on function public.srm_vendor_jobs(uuid, uuid, text, text, text, date, date, int) to authenticated;
