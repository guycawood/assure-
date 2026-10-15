-- QA/QC, OTIF and speed-to-market reporting, and the job close gate.
--   E. job_close_check gains "QA/QC passed at the required level" (not overridable): every QA/QC plan on the job must be
--      passed, or waived through an approved QAQC_WAIVE request. Jobs without plans are unaffected.
--   H. Reporting:
--      _delivery_kpis(): OTIF, QA/QC pass rate by level, NCRs from QA/QC and speed to market for a set of clients.
--      CRM: crm_client_delivery_kpis(), crm_client_set_qa_min_level(), client health uses OTIF and QA/QC (new columns at
--           the end of crm_client_health), the business review pack carries the numbers (crm_review_generate_pack wraps
--           its core).
--      Client Portal: client_portal_delivery_kpis() (client-safe: no supplier names, no NCR details).
--      Health: watchtower_health_qaqc (module orders), targets from the qaqc_settings library.

-- ---------------------------------------------------------------------------
-- Job close gate
-- ---------------------------------------------------------------------------
create or replace function public.job_close_check(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j public.jobs; v jsonb := '[]'::jsonb; n_po int; n_pending int; n_bad_sup int; n_gates int; v_gate_detail text;
  n_del int; n_del_open int; n_pod_open int; n_dep int; n_dep_open int; n_plans int; n_plans_open int; v_plan_detail text;
begin
  perform public._execution_require_internal();
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  select count(*) filter (where status in ('issued','accepted')), count(*) filter (where status = 'pending_approval') into n_po, n_pending
    from public.purchase_orders where job_id = p_job;
  v := v || jsonb_build_object('key', 'po', 'label', 'Supplier PO approved', 'ok', n_po > 0 and n_pending = 0, 'overridable', false,
    'detail', case when n_po = 0 then 'No approved purchase order on this job' when n_pending > 0 then n_pending || ' PO(s) still waiting for approval' else n_po || ' approved PO(s)' end);
  select count(*) into n_bad_sup from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
   where p.job_id = p_job and p.status in ('issued','accepted') and not s.active;
  v := v || jsonb_build_object('key', 'vendor', 'label', 'Vendor onboarded (SRM)', 'ok', n_bad_sup = 0, 'overridable', false,
    'detail', case when n_bad_sup = 0 then 'Suppliers on the PO(s) are active in SRM' else n_bad_sup || ' supplier(s) are inactive in SRM' end);
  select count(*) filter (where status = 'passed'),
         string_agg(case when status <> 'passed' then gate_key end, ', ' order by public.execution_gate_order(gate_key))
    into n_gates, v_gate_detail from public.job_quality_gates where job_id = p_job;
  v := v || jsonb_build_object('key', 'gates', 'label', 'Quality gates passed', 'ok', coalesce(n_gates, 0) = 4, 'overridable', false,
    'detail', case when coalesce(n_gates, 0) = 4 then 'Mock-up, production, installation and closure signed off' else coalesce(n_gates, 0) || ' of 4 passed' || coalesce('; not passed: ' || v_gate_detail, '') end);
  select count(*), count(*) filter (where status not in ('passed','waived')),
         string_agg(case when status not in ('passed','waived') then plan_ref || ' L' || required_level || ' ' || replace(status, '_', ' ') end, '; ' order by plan_ref)
    into n_plans, n_plans_open, v_plan_detail from public.qaqc_plans where job_id = p_job;
  v := v || jsonb_build_object('key', 'qaqc', 'label', 'QA/QC passed at the required level', 'ok', n_plans_open = 0, 'overridable', false,
    'detail', case when n_plans = 0 then 'No QA/QC plan on this job' when n_plans_open = 0 then n_plans || ' QA/QC plan(s) passed or waived'
                   else n_plans_open || ' of ' || n_plans || ' QA/QC plan(s) not passed: ' || v_plan_detail end);
  select count(*), count(*) filter (where status <> 'delivered') into n_del, n_del_open from public.deliveries where job_id = p_job and status <> 'cancelled';
  select count(*) into n_pod_open from public.shipments s join public.deliveries d on d.id = s.delivery_id
   where d.job_id = p_job and d.status <> 'cancelled' and s.pod_status <> 'verified';
  v := v || jsonb_build_object('key', 'deliveries', 'label', 'Deliveries confirmed and POD verified', 'ok', n_del > 0 and n_del_open = 0 and n_pod_open = 0, 'overridable', true,
    'detail', case when n_del = 0 then 'No deliveries recorded' else format('%s of %s delivered; %s POD(s) not verified', n_del - n_del_open, n_del, n_pod_open) end);
  select count(*), count(*) filter (where not (stage = 'audited' and audit_status = 'passed')) into n_dep, n_dep_open from public.deployments where job_id = p_job;
  v := v || jsonb_build_object('key', 'deployments', 'label', 'Installs done and audited', 'ok', n_dep_open = 0, 'overridable', false,
    'detail', case when n_dep = 0 then 'No installations on this job' else format('%s of %s installed and passed audit', n_dep - n_dep_open, n_dep) end);
  return jsonb_build_object('job_id', p_job, 'status', j.status,
    'can_close', j.status not in ('closed','cancelled') and not exists (select 1 from jsonb_array_elements(v) x where not (x->>'ok')::boolean),
    'checks', v);
end $$;

-- ---------------------------------------------------------------------------
-- Delivery KPIs (shared by CRM, the review pack and the Client Portal)
-- ---------------------------------------------------------------------------
create or replace function public._delivery_kpis(p_clients uuid[], p_since date, p_internal boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_otif jsonb; v_q jsonb; v_lvl jsonb; v_speed jsonb; v_ncr jsonb; v_month jsonb;
begin
  select jsonb_build_object('measured', count(*), 'on_time', count(*) filter (where on_time), 'in_full', count(*) filter (where in_full),
           'otif', count(*) filter (where otif),
           'otif_percent', round(100.0 * count(*) filter (where otif) / nullif(count(*), 0), 1),
           'on_time_percent', round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0), 1),
           'in_full_percent', round(100.0 * count(*) filter (where in_full) / nullif(count(*), 0), 1),
           'target', public.qaqc_setting('OTIF-TARGET', 95), 'tolerance_days', public.otif_tolerance_days())
    into v_otif from public.v_otif_deliveries where client_id = any (p_clients) and measured and coalesce(pod_at::date, promised_date) >= p_since;
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'measured', n, 'otif_percent', pct) order by month), '[]'::jsonb) into v_month
    from (select month, count(*) n, round(100.0 * count(*) filter (where otif) / nullif(count(*), 0), 1) pct
            from public.v_otif_deliveries where client_id = any (p_clients) and measured and month >= date_trunc('month', p_since::timestamptz) group by month) x;
  select jsonb_build_object('plans', count(*), 'passed', count(*) filter (where status = 'passed'), 'failed', count(*) filter (where status = 'failed'),
           'waived', count(*) filter (where status = 'waived'), 'open', count(*) filter (where status in ('not_started','in_progress')),
           'pass_percent', round(100.0 * count(*) filter (where status = 'passed') / nullif(count(*) filter (where status in ('passed','failed')), 0), 1),
           'first_time_pass_percent', (select round(100.0 * count(*) filter (where c.first_time_pass) / nullif(count(*) filter (where c.status in ('verified','auto_verified','rejected') or c.failed), 0), 1)
                                         from public.qaqc_checkpoints c join public.qaqc_plans p2 on p2.id = c.plan_id
                                        where p2.client_id = any (p_clients) and p2.created_at >= p_since and c.status <> 'withdrawn'),
           'target', public.qaqc_setting('QAQC-PASS-TARGET', 90))
    into v_q from public.qaqc_plans where client_id = any (p_clients) and created_at >= p_since;
  select coalesce(jsonb_agg(jsonb_build_object('level', lvl, 'plans', n, 'passed', ok, 'failed', bad, 'pass_percent', round(100.0 * ok / nullif(ok + bad, 0), 1)) order by lvl), '[]'::jsonb)
    into v_lvl from (select required_level lvl, count(*) n, count(*) filter (where status = 'passed') ok, count(*) filter (where status = 'failed') bad
                       from public.qaqc_plans where client_id = any (p_clients) and created_at >= p_since group by required_level) x;
  select jsonb_build_object('jobs', count(*) filter (where brief_to_delivery_days is not null),
           'median_brief_to_delivery_days', round((percentile_cont(0.5) within group (order by brief_to_delivery_days))::numeric, 1),
           'target_days', public.qaqc_setting('STM-TARGET-DAYS', 60),
           'stages', jsonb_build_object(
             'brief_to_approval', round((percentile_cont(0.5) within group (order by brief_to_approval_days))::numeric, 1),
             'approval_to_po', round((percentile_cont(0.5) within group (order by approval_to_po_days))::numeric, 1),
             'po_to_pod', round((percentile_cont(0.5) within group (order by po_to_pod_days))::numeric, 1),
             'pod_to_installed', round((percentile_cont(0.5) within group (order by pod_to_installed_days))::numeric, 1)))
    into v_speed from public.v_job_speed where client_id = any (p_clients) and coalesce(delivered_at, started_at) >= p_since;
  if p_internal then
    select jsonb_build_object('raised', count(*), 'open', count(*) filter (where n.status = 'open'), 'critical', count(*) filter (where n.severity = 'critical'),
             'from_qaqc', count(*) filter (where exists (select 1 from public.qaqc_checkpoints c where c.ncr_id = n.id)))
      into v_ncr from public.ncrs n
     where n.created_at >= p_since and n.po_reference in (select p.po_number from public.purchase_orders p join public.jobs j on j.id = p.job_id where j.client_id = any (p_clients));
  end if;
  return jsonb_build_object('since', p_since, 'otif', v_otif, 'otif_by_month', v_month, 'qaqc', v_q || jsonb_build_object('by_level', v_lvl),
    'speed', v_speed) || case when p_internal then jsonb_build_object('ncrs', v_ncr) else '{}'::jsonb end;
end $$;

create or replace function public.crm_client_delivery_kpis(p_client uuid, p_months int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  return public._delivery_kpis(array[p_client], (current_date - make_interval(months => greatest(1, least(coalesce(p_months, 12), 60))))::date, true)
    || jsonb_build_object('qa_min_level', (select qa_min_level from public.sourcing_clients where id = p_client));
end $$;

-- The client's contractual minimum QA/QC level (feeds the QR-CLIENT rule). Audited in CRM.
create or replace function public.crm_client_set_qa_min_level(p_client uuid, p_level int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients;
begin
  perform public._crm_require();
  select * into c from public.sourcing_clients where id = p_client for update;
  if c.id is null then raise exception 'Client not found'; end if;
  if p_level is not null and p_level not between 1 and 5 then raise exception 'Choose a level from L1 to L5, or none'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why (e.g. the contract clause)'; end if;
  if p_level is not distinct from c.qa_min_level then return; end if;
  update public.sourcing_clients set qa_min_level = p_level where id = p_client;
  perform public._crm_event(p_client, 'client', p_client::text, 'qa_min_level_changed', jsonb_build_object('from', c.qa_min_level, 'to', p_level, 'reason', trim(p_reason)));
end $$;

create or replace function public.client_portal_delivery_kpis(p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  return public._delivery_kpis(v, (current_date - interval '12 months')::date, false);
end $$;

-- ---------------------------------------------------------------------------
-- CRM client health: OTIF and QA/QC (new columns at the end)
-- ---------------------------------------------------------------------------
create or replace view public.crm_client_health with (security_invoker = true) as
  with b as (
    select c.id as client_id, c.code, c.name, c.default_currency as currency, c.active, c.crm_setup_status,
      (select coalesce(sum(e.sell_price), 0) from public.estimates e join public.jobs j on j.id = e.job_id
        where j.client_id = c.id and e.status = 'approved' and e.approved_at >= date_trunc('year', now()) and e.currency = c.default_currency) as spend_ytd,
      (select coalesce(sum(bl.gross_amount), 0) from public.client_bills bl
        where bl.client_id = c.id and bl.status in ('sent','paid') and bl.issue_date >= date_trunc('year', current_date)::date and bl.currency = c.default_currency) as billed_ytd,
      (select count(*) from public.client_bills bl where bl.client_id = c.id and bl.status = 'sent' and bl.due_date < current_date)::int as overdue_bills,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.score <= 6 and f.followed_up_at is null
         and f.created_at >= now() - interval '180 days')::int as open_issues,
      (select round(avg(f.score), 1) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months') as satisfaction,
      (select count(*) from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as feedback_count,
      (select round(100.0 * (count(*) filter (where f.score >= 9) - count(*) filter (where f.score <= 6)) / nullif(count(*), 0))
         from public.crm_feedback f where f.client_id = c.id and f.created_at >= now() - interval '12 months')::int as nps,
      (select min(coalesce(k.renewal_date, k.end_date)) from public.crm_contracts k
        where k.client_id = c.id and k.status = 'signed' and coalesce(k.renewal_date, k.end_date) >= current_date) as next_renewal,
      (select max(i.occurred_at) from public.crm_interactions i where i.client_id = c.id) as last_activity_at,
      (select count(*) from public.crm_accounts a where a.client_id = c.id)::int as accounts,
      coalesce((select rc.review_overdue from public.crm_review_cadence_v rc where rc.client_id = c.id), false) as review_overdue,
      (select count(*) from public.crm_actions_v av where av.client_id = c.id and av.overdue)::int as actions_overdue,
      (select round(100.0 * count(*) filter (where o.otif) / nullif(count(*), 0), 1) from public.v_otif_deliveries o
        where o.client_id = c.id and o.measured and coalesce(o.pod_at::date, o.promised_date) >= current_date - 365) as otif_percent,
      (select round(100.0 * count(*) filter (where q.status = 'passed') / nullif(count(*) filter (where q.status in ('passed','failed')), 0), 1)
         from public.qaqc_plans q where q.client_id = c.id and q.created_at >= now() - interval '12 months') as qaqc_pass_percent
    from public.sourcing_clients c
  ), f as (
    select b.*, case when b.last_activity_at is null then null else (current_date - b.last_activity_at::date) end as days_since_activity,
           case when b.next_renewal is null then null else b.next_renewal - current_date end as days_to_renewal,
           public.qaqc_setting('OTIF-TARGET', 95) as otif_target, public.qaqc_setting('QAQC-PASS-TARGET', 90) as qaqc_target
      from b
  ), s as (
    select f.*,
      (case when f.overdue_bills > 0 then 2 else 0 end
       + case when f.satisfaction is not null and f.satisfaction < 6 then 2 when f.satisfaction is not null and f.satisfaction < 8 then 1 else 0 end
       + case when f.days_since_activity is null or f.days_since_activity > 60 then 2 when f.days_since_activity > 30 then 1 else 0 end
       + case when f.days_to_renewal is not null and f.days_to_renewal <= 30 then 2 when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 1 else 0 end
       + case when f.open_issues > 0 then 1 else 0 end
       + case when f.review_overdue then 1 else 0 end
       + case when f.actions_overdue > 0 then 1 else 0 end
       + case when f.otif_percent is not null and f.otif_percent < f.otif_target - 15 then 2 when f.otif_percent is not null and f.otif_percent < f.otif_target then 1 else 0 end
       + case when f.qaqc_pass_percent is not null and f.qaqc_pass_percent < f.qaqc_target then 1 else 0 end) as points,
      array_remove(array[
        case when f.overdue_bills > 0 then f.overdue_bills || ' overdue bill(s)' end,
        case when f.satisfaction is not null and f.satisfaction < 8 then 'Satisfaction ' || f.satisfaction || '/10' end,
        case when f.days_since_activity is null then 'No activity logged' when f.days_since_activity > 30 then 'No activity for ' || f.days_since_activity || ' days' end,
        case when f.days_to_renewal is not null and f.days_to_renewal <= 90 then 'Renewal in ' || f.days_to_renewal || ' days' end,
        case when f.open_issues > 0 then f.open_issues || ' open detractor comment(s)' end,
        case when f.review_overdue then 'Business review overdue' end,
        case when f.actions_overdue > 0 then f.actions_overdue || ' overdue action(s)' end,
        case when f.otif_percent is not null and f.otif_percent < f.otif_target then 'OTIF ' || f.otif_percent || '% (target ' || f.otif_target || '%)' end,
        case when f.qaqc_pass_percent is not null and f.qaqc_pass_percent < f.qaqc_target then 'QA/QC pass rate ' || f.qaqc_pass_percent || '% (target ' || f.qaqc_target || '%)' end], null) as reasons
      from f
  )
  select s.client_id, s.code, s.name, s.currency, s.active, s.crm_setup_status, s.spend_ytd, s.billed_ytd, s.overdue_bills, s.open_issues, s.satisfaction,
         s.feedback_count, s.nps, s.next_renewal, s.last_activity_at, s.accounts, s.days_since_activity, s.days_to_renewal, s.points, s.reasons,
         case when s.points >= 4 then 'red' when s.points >= 2 then 'amber' else 'green' end as rag, s.review_overdue, s.actions_overdue,
         s.otif_percent, s.qaqc_pass_percent
    from s;

-- ---------------------------------------------------------------------------
-- CRM review pack: same core, plus the delivery KPIs (OTIF replaces the old on-time-only delivery block)
-- ---------------------------------------------------------------------------
alter function public.crm_review_generate_pack(uuid) rename to _core_crm_review_generate_pack;
create function public.crm_review_generate_pack(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pack jsonb; r public.crm_reviews; k jsonb;
begin
  v_pack := public._core_crm_review_generate_pack(p_id);
  select * into r from public.crm_reviews where id = p_id;
  k := public._delivery_kpis(array[r.client_id], current_date - 365, true);
  v_pack := v_pack || jsonb_build_object(
    'delivery', jsonb_build_object('delivered', k->'otif'->'measured', 'on_time', k->'otif'->'on_time', 'in_full', k->'otif'->'in_full',
                                   'otif_percent', k->'otif'->'otif_percent', 'on_time_percent', k->'otif'->'on_time_percent',
                                   'in_full_percent', k->'otif'->'in_full_percent', 'target', k->'otif'->'target'),
    'otif_by_month', k->'otif_by_month', 'qaqc', k->'qaqc', 'ncrs', k->'ncrs', 'speed_to_market', k->'speed');
  update public.crm_reviews set pack = v_pack where id = p_id;
  return v_pack;
end $$;

-- ---------------------------------------------------------------------------
-- Health (standard shape), shown with Order Management in the Watchtower
-- ---------------------------------------------------------------------------
create view public.watchtower_health_qaqc with (security_invoker = true) as
  with od as (select count(*)::numeric n from public.qaqc_checkpoints c join public.qaqc_plans p on p.id = c.plan_id
               where c.status in ('required','rejected') and c.due_date < current_date and p.status not in ('passed','waived')),
  rq as (select coalesce(round((extract(epoch from (now() - min(c.submitted_at))) / 86400)::numeric, 1), 0) age, count(*) n
           from public.qaqc_checkpoints c where c.status = 'needs_review'),
  ftp as (select coalesce(round(100.0 * count(*) filter (where first_time_pass) / nullif(count(*) filter (where status in ('verified','auto_verified','rejected') or failed), 0), 1), 0) pct
            from public.qaqc_checkpoints where status <> 'withdrawn'),
  ot as (select coalesce(round(100.0 * count(*) filter (where otif) / nullif(count(*), 0), 1), 0) pct from public.v_otif_deliveries
          where measured and coalesce(pod_at::date, promised_date) >= current_date - 365),
  sp as (select coalesce(round((percentile_cont(0.5) within group (order by brief_to_delivery_days))::numeric, 1), 0) d from public.v_job_speed
          where brief_to_delivery_days is not null and delivered_at >= now() - interval '12 months'),
  t as (select public.qaqc_setting('QAQC-REVIEW-SLA-DAYS', 2) sla, public.qaqc_setting('QAQC-PASS-TARGET', 90) ftp,
               public.qaqc_setting('OTIF-TARGET', 95) otif, public.qaqc_setting('STM-TARGET-DAYS', 60) stm)
  select * from (
  select 'orders'::text as module, 'qaqc_overdue_checkpoints'::text as metric, 'QA/QC checkpoints overdue'::text as label, od.n as value, 0::numeric as target,
         case when od.n = 0 then 'ok' when od.n <= 3 then 'warn' else 'bad' end as status from od
  union all select 'orders', 'qaqc_review_age_days', 'Oldest QA/QC submission waiting for review (days)', rq.age, t.sla,
         case when rq.n = 0 or rq.age <= t.sla then 'ok' when rq.age <= t.sla * 2 then 'warn' else 'bad' end from rq, t
  union all select 'orders', 'qaqc_first_time_pass', 'QA/QC first-time pass rate (%)', ftp.pct, t.ftp,
         case when ftp.pct >= t.ftp then 'ok' when ftp.pct >= t.ftp - 15 then 'warn' else 'bad' end from ftp, t
  union all select 'orders', 'otif_percent', 'OTIF, last 12 months (%)', ot.pct, t.otif,
         case when ot.pct >= t.otif then 'ok' when ot.pct >= t.otif - 15 then 'warn' else 'bad' end from ot, t
  union all select 'orders', 'speed_to_market_days', 'Median days from brief to delivery', sp.d, t.stm,
         case when sp.d <= t.stm then 'ok' when sp.d <= t.stm * 1.25 then 'warn' else 'bad' end from sp, t
  ) h where public.is_internal();

revoke insert, update, delete on public.crm_client_health, public.watchtower_health_qaqc from authenticated, anon;
revoke all on public.crm_client_health, public.watchtower_health_qaqc from anon;
revoke execute on function public._delivery_kpis(uuid[], date, boolean), public._core_crm_review_generate_pack(uuid) from public, anon, authenticated;
revoke execute on function public.crm_client_delivery_kpis(uuid, int), public.crm_client_set_qa_min_level(uuid, int, text),
  public.client_portal_delivery_kpis(uuid), public.crm_review_generate_pack(uuid) from public, anon;
grant execute on function public.crm_client_delivery_kpis(uuid, int), public.crm_client_set_qa_min_level(uuid, int, text),
  public.client_portal_delivery_kpis(uuid), public.crm_review_generate_pack(uuid) to authenticated;
