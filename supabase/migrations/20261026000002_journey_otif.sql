-- Speed to market and OTIF: every step from brief to delivery is timestamped, and on time in full has one definition.
--   F. New timestamp columns where one was missing (nullable, backfilled from event history), stamped by triggers so the
--      existing status-change functions set them without being edited:
--        purchase_orders.issued_at, jobs.production_started_at / delivered_at, deliveries.delivered_at,
--        shipments.pod_captured_at (the proof-of-delivery time: the delivery time the vendor states, else the upload time;
--        pod_received_at stays the upload time) and shipments.pod_time_stated.
--      v_job_journey: one row per job per milestone reached (code, label, seq, at, actor, source) - BI ready.
--      v_job_speed: brief -> delivery days and the stage durations per job.
--   G. OTIF: on time = POD timestamp on or before the promised date + tolerance (qaqc_settings OTIF-TOL-DAYS);
--      in full = delivered quantity >= ordered quantity; OTIF = both. v_otif_deliveries (per delivery) and v_otif_summary
--      (per PO, job, supplier, client, region, market, category, month). v_supplier_otif, v_deliveries and the Logistics
--      health now use the same definition.

-- ---------------------------------------------------------------------------
-- Timestamp columns
-- ---------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists issued_at timestamptz;
alter table public.jobs add column if not exists production_started_at timestamptz, add column if not exists delivered_at timestamptz;
alter table public.deliveries add column if not exists delivered_at timestamptz;
alter table public.shipments add column if not exists pod_captured_at timestamptz, add column if not exists pod_time_stated boolean not null default false;

create or replace function public.trg_po_issued_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('issued','accepted','declined') and new.issued_at is null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.issued_at := coalesce(new.approved_at, case when new.status = 'issued' then now() end);
  end if;
  return new;
end $$;
create trigger purchase_orders_issued_at before insert or update of status on public.purchase_orders for each row execute function public.trg_po_issued_at();

create or replace function public.trg_jobs_stamps() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_production' then new.production_started_at := coalesce(new.production_started_at, now()); end if;
    if new.status = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  end if;
  return new;
end $$;
create trigger jobs_stamps before update of status on public.jobs for each row execute function public.trg_jobs_stamps();

create or replace function public.trg_deliveries_delivered_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is null then
    new.delivered_at := coalesce(
      (select max(s.pod_captured_at) from public.shipments s where s.delivery_id = new.id and s.pod_status <> 'rejected'),
      case when new.actual_delivery_date is not null and new.actual_delivery_date < current_date then (new.actual_delivery_date + time '12:00')::timestamptz end,
      now());
  end if;
  return new;
end $$;
create trigger deliveries_delivered_at before update of status on public.deliveries for each row execute function public.trg_deliveries_delivered_at();

-- POD capture: the stated delivery time (logistics.pod_at, set by the *_attach_pod_at functions) or the date the vendor
-- gives (noon) or, for today / no date, the moment of upload. Replaces the private helper only; wrappers are unchanged.
create or replace function public._logistics_attach_pod(s public.shipments, p_file uuid, p_delivered_on date) returns void
language plpgsql security definer set search_path = public as $$
declare f public.files; v_at timestamptz := nullif(current_setting('logistics.pod_at', true), '')::timestamptz; v_stated boolean;
begin
  select * into f from public.files where id = p_file;
  if f.id is null or f.entity_type <> 'shipment' or f.entity_id <> s.id::text then raise exception 'Upload the POD against this shipment first'; end if;
  if s.pod_status = 'verified' then raise exception 'The POD on this shipment is already verified'; end if;
  if p_delivered_on is not null and (p_delivered_on > current_date or p_delivered_on < s.dispatch_date) then
    raise exception 'The delivery date must be between the dispatch date and today';
  end if;
  if v_at is not null and (v_at > now() + interval '5 minutes' or v_at::date < s.dispatch_date) then
    raise exception 'The delivery time must be between the dispatch date and now';
  end if;
  v_stated := v_at is not null or (p_delivered_on is not null and p_delivered_on < current_date);
  v_at := coalesce(v_at, case when p_delivered_on is not null and p_delivered_on < current_date then (p_delivered_on + time '12:00')::timestamptz end, now());
  update public.shipments set pod_file_id = p_file, pod_status = 'received', pod_uploaded_by = auth.uid(), pod_received_at = now(),
    pod_verified_by = null, pod_verified_at = null, pod_rejection_reason = null, pod_checklist = '[]'::jsonb,
    actual_delivery_date = coalesce(p_delivered_on, v_at::date, actual_delivery_date, current_date),
    pod_captured_at = v_at, pod_time_stated = v_stated
  where id = s.id;
  perform public._logistics_event(s.delivery_id, s.id, 'pod_received', jsonb_build_object('file_id', p_file, 'by_vendor', not public.is_internal(),
    'pod_captured_at', v_at, 'stated', v_stated));
end $$;

-- Attach a POD with the delivery date and time stated on it (vendor: through the viewer-gated wrapper).
create or replace function public.logistics_vendor_attach_pod_at(p_shipment uuid, p_file_id uuid, p_delivered_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('logistics.pod_at', coalesce(p_delivered_at::text, ''), true);
  perform public.logistics_vendor_attach_pod(p_shipment, p_file_id, p_delivered_at::date);
  perform set_config('logistics.pod_at', '', true);
end $$;
create or replace function public.logistics_attach_pod_at(p_shipment uuid, p_file_id uuid, p_delivered_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('logistics.pod_at', coalesce(p_delivered_at::text, ''), true);
  perform public.logistics_attach_pod(p_shipment, p_file_id, p_delivered_at::date);
  perform set_config('logistics.pod_at', '', true);
end $$;

-- Backfill from history.
update public.purchase_orders set issued_at = approved_at where issued_at is null and approved_at is not null and status in ('issued','accepted','declined');
update public.shipments set pod_captured_at = coalesce(case when actual_delivery_date is not null and actual_delivery_date < coalesce(pod_received_at::date, current_date)
    then (actual_delivery_date + time '12:00')::timestamptz end, pod_received_at),
  pod_time_stated = actual_delivery_date is not null and actual_delivery_date < coalesce(pod_received_at::date, current_date)
 where pod_captured_at is null and pod_status in ('received','verified');
update public.deliveries d set delivered_at = coalesce(
    (select max(s.pod_captured_at) from public.shipments s where s.delivery_id = d.id and s.pod_status <> 'rejected'),
    (select max(e.at) from public.logistics_events e where e.delivery_id = d.id and e.event = 'delivered'),
    (d.actual_delivery_date + time '12:00')::timestamptz)
 where d.status = 'delivered' and d.delivered_at is null;
update public.jobs j set production_started_at = x.at from (
    select job_id, min(at) at from public.sourcing_events where entity = 'job' and event = 'status_changed' and detail->>'to' = 'in_production' group by job_id) x
 where x.job_id = j.id and j.production_started_at is null;
update public.jobs j set delivered_at = x.at from (
    select job_id, min(at) at from public.sourcing_events where entity = 'job' and event = 'status_changed' and detail->>'to' = 'delivered' group by job_id) x
 where x.job_id = j.id and j.delivered_at is null;

-- ---------------------------------------------------------------------------
-- G. OTIF: one definition
-- ---------------------------------------------------------------------------
create or replace function public.otif_tolerance_days(p_date date default current_date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(public.qaqc_setting('OTIF-TOL-DAYS', 0, p_date), 0)::int;
$$;
create or replace function public.otif_on_time(p_pod_at timestamptz, p_promised date, p_tolerance int) returns boolean
language sql immutable as $$
  select case when p_pod_at is null or p_promised is null then false else p_pod_at::date <= p_promised + coalesce(p_tolerance, 0) end;
$$;
create or replace function public.otif_in_full(p_delivered numeric, p_ordered numeric) returns boolean
language sql immutable as $$
  select coalesce(p_delivered, 0) >= coalesce(p_ordered, 0) and coalesce(p_ordered, 0) > 0;
$$;
-- The POD timestamp of a delivery: latest POD captured on it (rejected PODs ignored), else when it was marked delivered.
-- Security invoker: the caller's RLS on deliveries and shipments applies.
create or replace function public.delivery_pod_at(p_delivery uuid) returns timestamptz
language sql stable set search_path = public as $$
  select coalesce((select max(s.pod_captured_at) from public.shipments s where s.delivery_id = d.id and s.pod_status <> 'rejected'),
                  d.delivered_at, (d.actual_delivery_date + time '12:00')::timestamptz)
    from public.deliveries d where d.id = p_delivery;
$$;

create view public.v_otif_deliveries with (security_invoker = true) as
  with t as (select public.otif_tolerance_days() as tol)
  select d.id as delivery_id, d.delivery_number, d.po_id, p.po_number, d.job_id, j.job_number, d.supplier_id, su.name as supplier_name,
         j.client_id, c.name as client_name, d.region, d.market, mk.name as market_name,
         coalesce(nullif(j.category, ''), nullif(sp.product_category, ''), sp.spec_type) as category, d.spec_id, d.status,
         coalesce(d.planned_delivery_date, p.delivery_date) as promised_date, t.tol as tolerance_days, x.pod_at,
         d.quantity as ordered_qty, coalesce(sh.shipped, 0)::int as delivered_qty,
         (d.status in ('delivered','failed') and coalesce(d.planned_delivery_date, p.delivery_date) is not null) as measured,
         (d.status = 'delivered' and public.otif_on_time(x.pod_at, coalesce(d.planned_delivery_date, p.delivery_date), t.tol)) as on_time,
         (d.status = 'delivered' and public.otif_in_full(sh.shipped, d.quantity)) as in_full,
         (d.status = 'delivered' and public.otif_on_time(x.pod_at, coalesce(d.planned_delivery_date, p.delivery_date), t.tol)
            and public.otif_in_full(sh.shipped, d.quantity)) as otif,
         case when x.pod_at is not null then x.pod_at::date - coalesce(d.planned_delivery_date, p.delivery_date) end as days_late,
         date_trunc('month', coalesce(x.pod_at, coalesce(d.planned_delivery_date, p.delivery_date)::timestamptz))::date as month
    from public.deliveries d cross join t
    join public.purchase_orders p on p.id = d.po_id join public.jobs j on j.id = d.job_id
    join public.sourcing_clients c on c.id = j.client_id join public.suppliers su on su.id = d.supplier_id
    join public.job_specs sp on sp.id = d.spec_id left join public.markets mk on mk.code = d.market
    left join lateral (select sum(quantity_shipped) shipped from public.shipments where delivery_id = d.id) sh on true
    left join lateral (select public.delivery_pod_at(d.id) as pod_at) x on true
   where d.status <> 'cancelled';

create view public.v_otif_summary with (security_invoker = true) as
  with m as (select * from public.v_otif_deliveries where measured),
  g as (
    select 'total'::text as dimension, 'all'::text as key, 'All deliveries'::text as label, m.* from m
    union all select 'supplier', supplier_id::text, supplier_name, m.* from m
    union all select 'client', client_id::text, client_name, m.* from m
    union all select 'region', region, region, m.* from m
    union all select 'market', market, coalesce(market_name, market), m.* from m
    union all select 'category', coalesce(category, 'none'), coalesce(category, 'No category'), m.* from m
    union all select 'month', to_char(month, 'YYYY-MM'), to_char(month, 'Mon YYYY'), m.* from m
    union all select 'po', po_id::text, po_number, m.* from m
    union all select 'job', job_id::text, job_number, m.* from m)
  select dimension, key, min(label) as label, count(*)::int as deliveries,
         count(*) filter (where on_time)::int as on_time, count(*) filter (where in_full)::int as in_full, count(*) filter (where otif)::int as otif,
         round(100.0 * count(*) filter (where otif) / nullif(count(*), 0), 1) as otif_percent,
         round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0), 1) as on_time_percent,
         round(100.0 * count(*) filter (where in_full) / nullif(count(*), 0), 1) as in_full_percent,
         round(avg(days_late) filter (where days_late > 0), 1) as avg_days_late
    from g group by dimension, key;

-- Same columns as before, one definition.
create or replace view public.v_supplier_otif with (security_invoker = true) as
  select o.supplier_id, o.supplier_name, su.supplier_code,
         count(*)::int as deliveries,
         count(*) filter (where o.on_time)::int as on_time,
         count(*) filter (where o.in_full)::int as in_full,
         count(*) filter (where o.otif)::int as otif,
         round(100.0 * count(*) filter (where o.otif) / nullif(count(*), 0), 1) as otif_percent,
         round(100.0 * count(*) filter (where o.on_time) / nullif(count(*), 0), 1) as on_time_percent,
         round(100.0 * count(*) filter (where o.in_full) / nullif(count(*), 0), 1) as in_full_percent
    from public.v_otif_deliveries o join public.suppliers su on su.id = o.supplier_id
   where o.measured
   group by o.supplier_id, o.supplier_name, su.supplier_code;

drop view if exists public.v_deliveries;
create view public.v_deliveries with (security_invoker = true) as
  select d.*, p.po_number, p.status as po_status, j.job_number, j.title as job_title, c.name as client_name, su.name as supplier_name, su.supplier_code,
         sp.title as spec_title, sp.spec_no, v.name as spec_version_name, mk.name as market_name, om.name as origin_market_name,
         coalesce(sh.shipped, 0)::int as quantity_shipped, (d.quantity - coalesce(sh.shipped, 0))::int as quantity_remaining,
         coalesce(sh.shipments, 0)::int as shipment_count, coalesce(sh.pods_to_verify, 0)::int as pods_to_verify,
         coalesce(sh.pods_verified, 0)::int as pods_verified,
         es.kgco2e, es.planned_kgco2e, es.complete as co2e_complete,
         (d.status = 'delivered' and public.otif_on_time(public.delivery_pod_at(d.id), coalesce(d.planned_delivery_date, p.delivery_date), public.otif_tolerance_days())) as on_time,
         (d.status = 'delivered' and public.otif_in_full(sh.shipped, d.quantity)) as in_full,
         o.name as outlet_name, o.outlet_code,
         public.delivery_pod_at(d.id) as pod_at, public.otif_tolerance_days() as otif_tolerance_days
    from public.deliveries d
    join public.purchase_orders p on p.id = d.po_id
    join public.jobs j on j.id = d.job_id
    join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers su on su.id = d.supplier_id
    join public.job_specs sp on sp.id = d.spec_id
    left join public.spec_versions v on v.id = d.spec_version_id
    left join public.markets mk on mk.code = d.market
    left join public.markets om on om.code = d.origin_market
    left join public.outlets o on o.id = d.outlet_id
    left join lateral (select sum(quantity_shipped) shipped, count(*) shipments, count(*) filter (where pod_status = 'received') pods_to_verify,
                              count(*) filter (where pod_status = 'verified') pods_verified
                         from public.shipments where delivery_id = d.id) sh on true
    left join lateral (select kgco2e, planned_kgco2e, complete from public.emission_snapshots where delivery_id = d.id order by computed_at desc limit 1) es on true;

drop view if exists public.v_shipments;
create view public.v_shipments with (security_invoker = true) as
  select s.*, d.delivery_number, d.po_id, d.job_id, d.quantity as delivery_quantity, d.status as delivery_status, d.planned_delivery_date,
         d.region, d.market, p.po_number, j.job_number, su.name as supplier_name, cr.name as carrier_name, cr.data->>'tracking_url' as carrier_tracking_url,
         ub.full_name as pod_uploaded_by_name, vb.full_name as pod_verified_by_name
    from public.shipments s join public.deliveries d on d.id = s.delivery_id
    join public.purchase_orders p on p.id = d.po_id join public.jobs j on j.id = d.job_id
    join public.suppliers su on su.id = s.supplier_id
    left join public.library_records cr on cr.id = s.carrier_record_id
    left join public.profiles ub on ub.id = s.pod_uploaded_by
    left join public.profiles vb on vb.id = s.pod_verified_by;

create or replace view public.watchtower_health_logistics with (security_invoker = true) as
  with pods as (select count(*)::numeric n from public.shipments where pod_status = 'received'),
  ot as (select coalesce(round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where status = 'delivered'), 0), 1), 0) pct
           from public.v_otif_deliveries where measured),
  overdue as (select count(*)::numeric n from public.deliveries where status in ('planned','booked','dispatched','in_transit') and planned_delivery_date < current_date),
  inc as (select count(*)::numeric n from public.deliveries d where d.status = 'delivered'
            and not coalesce((select complete from public.emission_snapshots e where e.delivery_id = d.id order by computed_at desc limit 1), false))
  select 'logistics'::text as module, 'pods_to_verify'::text as metric, 'PODs waiting for verification'::text as label, pods.n as value, 0::numeric as target,
         case when pods.n = 0 then 'ok' when pods.n <= 5 then 'warn' else 'bad' end as status from pods
  union all select 'logistics', 'on_time_percent', 'Delivered on time (%)', ot.pct, 95, case when ot.pct >= 95 then 'ok' when ot.pct >= 80 then 'warn' else 'bad' end from ot
  union all select 'logistics', 'overdue_deliveries', 'Deliveries past their planned date', overdue.n, 0, case when overdue.n = 0 then 'ok' when overdue.n <= 3 then 'warn' else 'bad' end from overdue
  union all select 'logistics', 'co2e_incomplete', 'Delivered without complete transport CO2e', inc.n, 0, case when inc.n = 0 then 'ok' else 'warn' end from inc;

-- ---------------------------------------------------------------------------
-- F. Journey: one row per job per milestone reached
-- ---------------------------------------------------------------------------
create or replace function public.journey_milestones() returns table (seq int, code text, label text, completion boolean)
language sql immutable as $$
  values (1,'brief_submitted','Brief submitted',false), (2,'brief_approved','Brief approved',false), (3,'concept_approved','Concept approved (internal)',false),
         (4,'concept_client_approved','Concept approved (client)',false), (5,'job_created','Job created',false), (6,'spec_locked','Specs approved',true),
         (7,'triage_done','Triage done',true), (8,'rfq_sent','RFQ sent',false), (9,'quotes_in','Quotes in (bidding closed)',false), (10,'awarded','Awarded',false),
         (11,'estimate_sent','Estimate sent',false), (12,'estimate_approved','Estimate approved (client)',false), (13,'client_po','Client PO received',false),
         (14,'po_approved','PO approved',false), (15,'po_issued','PO issued',false), (16,'po_accepted','PO accepted by vendor',false),
         (17,'production_started','Production started',false), (18,'qaqc_passed','QA/QC passed',true), (19,'shipped','Shipped',false), (20,'pod','POD',true),
         (21,'pod_verified','POD verified',true), (22,'delivered','Delivered',true), (23,'installed','Installed',true), (24,'audited','Audited',true),
         (25,'invoiced','Invoiced',false), (26,'paid','Paid',true), (27,'job_closed','Job closed',false);
$$;

create view public.v_job_journey with (security_invoker = true) as
  with jb as (
    select j.*, coalesce(j.brief_id, (select b.id from public.briefs b where b.resulting_job_id = j.id order by b.created_at limit 1)) as bid from public.jobs j
  ), ev as (
    select jb.id job_id, 'brief_submitted' code, b.submitted_at at, b.created_by actor, 'briefs' src, b.brief_code ref from jb join public.briefs b on b.id = jb.bid where b.submitted_at is not null
    union all select jb.id, 'brief_approved', b.reviewed_at, b.reviewed_by, 'briefs', b.brief_code from jb join public.briefs b on b.id = jb.bid where b.approval_status = 'approved' and b.reviewed_at is not null
    union all select jb.id, 'concept_approved', c.decided_at, c.decided_by, 'ideation_concepts', c.name from jb join public.ideation_concepts c on c.brief_id = jb.bid where c.status = 'approved' and c.decided_at is not null
    union all select jb.id, 'concept_client_approved', c.client_decided_at, c.client_decided_by, 'ideation_concepts', c.name from jb join public.ideation_concepts c on c.brief_id = jb.bid where c.client_status = 'approved' and c.client_decided_at is not null
    union all select jb.id, 'job_created', jb.created_at, jb.created_by, 'jobs', jb.job_number from jb
    union all select s.job_id, 'spec_locked', s.created_at, s.created_by, 'job_specs', 'Spec ' || s.spec_no from public.job_specs s where not s.is_draft
    union all select s.job_id, 'triage_done', t.decided_at, t.decided_by, 'spec_triage', t.route from public.spec_triage t join public.job_specs s on s.id = t.spec_id where t.is_current
    union all select r.job_id, 'rfq_sent', r.sent_at, r.sent_by, 'rfqs', r.rfq_number from public.rfqs r where r.sent_at is not null
    union all select r.job_id, 'quotes_in',
           case when not exists (select 1 from public.rfq_invitations i where i.rfq_id = r.id and i.status not in ('quoted','declined'))
                then greatest(r.sent_at, least((select max(coalesce(i.responded_at, i.declined_at)) from public.rfq_invitations i where i.rfq_id = r.id), r.awarded_at)) else least(r.due_at, r.awarded_at) end,
           null::uuid, 'rfqs', r.rfq_number
      from public.rfqs r where r.sent_at is not null and r.status in ('sent','awarded')
       and (r.due_at <= now() or not exists (select 1 from public.rfq_invitations i where i.rfq_id = r.id and i.status not in ('quoted','declined')))
    union all select r.job_id, 'awarded', r.awarded_at, r.awarded_by, 'rfqs', r.rfq_number from public.rfqs r where r.awarded_at is not null
    union all select e.job_id, 'estimate_sent', e.sent_at, e.created_by, 'estimates', e.estimate_number from public.estimates e where e.sent_at is not null and e.status <> 'draft'
    union all select e.job_id, 'estimate_approved', coalesce((select min(cd.decided_at) from public.client_decisions cd where cd.estimate_id = e.id and cd.decision = 'approve'), e.approved_at),
           coalesce((select cd.decided_by from public.client_decisions cd where cd.estimate_id = e.id and cd.decision = 'approve' order by cd.decided_at limit 1), e.approved_by),
           'estimates', e.estimate_number from public.estimates e where e.status = 'approved'
    union all select e.job_id, 'client_po', cp.created_at, cp.created_by, 'client_pos', cp.po_number from public.client_pos cp join public.estimates e on e.id = cp.estimate_id
    union all select p.job_id, 'po_approved', p.approved_at, p.approved_by, 'purchase_orders', p.po_number from public.purchase_orders p where p.approved_at is not null and p.status in ('issued','accepted','declined')
    union all select p.job_id, 'po_issued', p.issued_at, p.approved_by, 'purchase_orders', p.po_number from public.purchase_orders p where p.issued_at is not null
    union all select p.job_id, 'po_accepted', p.vendor_responded_at, p.vendor_responded_by, 'purchase_orders', p.po_number from public.purchase_orders p where p.status = 'accepted' and p.vendor_responded_at is not null
    union all select jb.id, 'production_started', jb.production_started_at, null, 'jobs', jb.job_number from jb where jb.production_started_at is not null
    union all select pl.job_id, 'production_started', c.submitted_at, c.submitted_by, 'qaqc_checkpoints', pl.plan_ref from public.qaqc_checkpoints c join public.qaqc_plans pl on pl.id = c.plan_id
       where c.checkpoint = 'production' and c.submitted_at is not null
    union all select pl.job_id, 'qaqc_passed', coalesce(pl.passed_at, pl.waived_at), null, 'qaqc_plans', pl.plan_ref from public.qaqc_plans pl
       where pl.status in ('passed','waived') and not exists (select 1 from public.qaqc_plans x where x.job_id = pl.job_id and x.status not in ('passed','waived'))
    union all select d.job_id, 'shipped', (s.dispatch_date + time '12:00')::timestamptz, s.recorded_by, 'shipments', s.shipment_number from public.shipments s join public.deliveries d on d.id = s.delivery_id where d.status <> 'cancelled'
    union all select d.job_id, 'pod', s.pod_captured_at, s.pod_uploaded_by, 'shipments', s.shipment_number from public.shipments s join public.deliveries d on d.id = s.delivery_id
       where s.pod_captured_at is not null and s.pod_status <> 'rejected' and d.status <> 'cancelled'
    union all select d.job_id, 'pod_verified', s.pod_verified_at, s.pod_verified_by, 'shipments', s.shipment_number from public.shipments s join public.deliveries d on d.id = s.delivery_id
       where s.pod_status = 'verified' and s.pod_verified_at is not null
    union all select d.job_id, 'delivered', d.delivered_at, d.delivered_by, 'deliveries', d.delivery_number from public.deliveries d
       where d.status = 'delivered' and d.delivered_at is not null
         and not exists (select 1 from public.deliveries x where x.job_id = d.job_id and x.status not in ('delivered','cancelled'))
    union all select jb.id, 'delivered', jb.delivered_at, null, 'jobs', jb.job_number from jb
       where jb.delivered_at is not null and not exists (select 1 from public.deliveries x where x.job_id = jb.id and x.status <> 'cancelled')
    union all select dp.job_id, 'installed', (dp.installation_date + time '12:00')::timestamptz, dp.installed_by, 'deployments', dp.deployment_code from public.deployments dp where dp.installation_date is not null
    union all select dp.job_id, 'audited', dp.audited_at, dp.audited_by, 'deployments', dp.deployment_code from public.deployments dp where dp.audit_status = 'passed' and dp.audited_at is not null
    union all select b.job_id, 'invoiced', b.sent_at, b.sent_by, 'client_bills', b.bill_number from public.client_bills b where b.sent_at is not null and b.status in ('sent','paid')
    union all select b.job_id, 'paid', b.paid_at, b.paid_by, 'client_bills', b.bill_number from public.client_bills b where b.status = 'paid' and b.paid_at is not null
    union all select jb.id, 'job_closed', jb.closed_at, null, 'jobs', jb.job_number from jb where jb.status = 'closed' and jb.closed_at is not null
  ), pick as (
    select distinct on (ev.job_id, ev.code) ev.*, m.seq, m.label, m.completion
      from ev join public.journey_milestones() m on m.code = ev.code
     where ev.at is not null
     order by ev.job_id, ev.code, case when m.completion then ev.at end desc nulls last, ev.at
  )
  select pick.job_id, j.job_number, j.client_id, j.region, public._market_code(j.market) as market, pick.seq, pick.code as milestone_code,
         pick.label as milestone_label, pick.at, pick.actor, coalesce(nullif(pr.full_name, ''), pr.email) as actor_name, pick.src as source, pick.ref
    from pick join public.jobs j on j.id = pick.job_id left join public.profiles pr on pr.id = pick.actor;

create view public.v_job_speed with (security_invoker = true) as
  with m as (
    select job_id,
      max(at) filter (where milestone_code = 'brief_submitted') brief_submitted, max(at) filter (where milestone_code = 'brief_approved') brief_approved,
      max(at) filter (where milestone_code = 'job_created') job_created, max(at) filter (where milestone_code = 'po_issued') po_issued,
      max(at) filter (where milestone_code = 'qaqc_passed') qaqc_passed, max(at) filter (where milestone_code = 'pod') pod,
      max(at) filter (where milestone_code = 'delivered') delivered, max(at) filter (where milestone_code = 'installed') installed,
      count(*)::int milestones
    from public.v_job_journey group by job_id)
  select j.id as job_id, j.job_number, j.title, j.client_id, c.name as client_name, j.region, public._market_code(j.market) as market, j.category, j.status,
         m.milestones, coalesce(m.brief_submitted, m.job_created) as started_at, m.brief_submitted, m.brief_approved, m.job_created, m.po_issued,
         m.qaqc_passed, m.pod, coalesce(m.delivered, case when j.status in ('delivered','closed') then m.pod end) as delivered_at, m.installed,
         round((extract(epoch from (coalesce(m.delivered, case when j.status in ('delivered','closed') then m.pod end) - coalesce(m.brief_submitted, m.job_created))) / 86400)::numeric, 1) as brief_to_delivery_days,
         round((extract(epoch from (m.brief_approved - m.brief_submitted)) / 86400)::numeric, 1) as brief_to_approval_days,
         round((extract(epoch from (m.po_issued - coalesce(m.brief_approved, m.job_created))) / 86400)::numeric, 1) as approval_to_po_days,
         round((extract(epoch from (m.pod - m.po_issued)) / 86400)::numeric, 1) as po_to_pod_days,
         round((extract(epoch from (m.installed - m.pod)) / 86400)::numeric, 1) as pod_to_installed_days,
         round((extract(epoch from (m.qaqc_passed - m.po_issued)) / 86400)::numeric, 1) as po_to_qaqc_days,
         date_trunc('month', coalesce(m.delivered, case when j.status in ('delivered','closed') then m.pod end))::date as delivered_month
    from public.jobs j join public.sourcing_clients c on c.id = j.client_id left join m on m.job_id = j.id;

revoke insert, update, delete on public.v_otif_deliveries, public.v_otif_summary, public.v_supplier_otif, public.v_deliveries, public.v_shipments,
  public.watchtower_health_logistics, public.v_job_journey, public.v_job_speed from authenticated, anon;
revoke all on public.v_otif_deliveries, public.v_otif_summary, public.v_job_journey, public.v_job_speed from anon;
revoke execute on function public.trg_po_issued_at(), public.trg_jobs_stamps(), public.trg_deliveries_delivered_at() from public, anon, authenticated;
revoke execute on function public.logistics_vendor_attach_pod_at(uuid, uuid, timestamptz), public.logistics_attach_pod_at(uuid, uuid, timestamptz),
  public.delivery_pod_at(uuid), public.otif_tolerance_days(date) from public, anon;
grant execute on function public.logistics_vendor_attach_pod_at(uuid, uuid, timestamptz), public.logistics_attach_pod_at(uuid, uuid, timestamptz),
  public.delivery_pod_at(uuid), public.otif_tolerance_days(date), public.otif_on_time(timestamptz, date, int), public.otif_in_full(numeric, numeric),
  public.journey_milestones() to authenticated;
