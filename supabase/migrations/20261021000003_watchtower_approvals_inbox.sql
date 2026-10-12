-- Platform approvals (3 of 3): one approvals inbox across every module, decoupled by convention.
--
-- CONTRACT (how a module plugs in): create a view named approvals_<module> with exactly these columns, pending items only:
--   module text, approval_type text, item_id text, ref text, title text, requested_by uuid, requested_at timestamptz,
--   amount numeric, currency text, client text, market text, region text, status text ('pending' | 'overdue'),
--   approver_rule text, href text, can_decide boolean
-- can_decide uses the module's own permission helpers for auth.uid() (the same rule its decision function enforces).
-- approvals_inbox() finds every view called approvals_% at run time, so a new module only adds its view.
-- The views are read through approvals_inbox() / approvals_summary() only (select is revoked from users).

-- ---------------------------------------------------------------------------
-- Briefing+: briefs and concepts
-- ---------------------------------------------------------------------------
create or replace view public.approvals_briefing with (security_invoker = true) as
  select 'briefing'::text as module, 'BRIEF'::text as approval_type, b.id::text as item_id, b.brief_code as ref, b.title,
         b.created_by as requested_by, coalesce(b.submitted_at, b.created_at) as requested_at, b.budget_high::numeric as amount, b.currency,
         coalesce(sc.name, b.client) as client, b.market, b.region,
         public.approval_status('BRIEF', coalesce(b.submitted_at, b.created_at), b.market, b.budget_high) as status,
         public.approval_rule('BRIEF', b.client_id, b.market, b.budget_high, 'A colleague who is not the author') as approver_rule,
         '/briefing/' || b.id as href, public.brief_can_decide(b.id) as can_decide
    from public.briefs b left join public.sourcing_clients sc on sc.id = b.client_id
   where b.status = 'submitted' and b.approval_status = 'pending'
  union all
  select 'briefing', 'CONCEPT', c.id::text, coalesce(b.brief_code, 'Campaign ideation'), c.name || coalesce(' · ' || b.title, ''),
         c.submitted_by, c.submitted_at, x.value, x.currency, coalesce(sc.name, s.context->>'client'), x.market, x.region,
         public.approval_status('CONCEPT', c.submitted_at, x.market, x.value),
         public.approval_rule('CONCEPT', x.client_id, x.market, x.value, 'Briefing lead · not the submitter'),
         case when c.brief_id is not null then '/briefing/' || c.brief_id || '#concepts' else '/briefing/campaign-ideation?concept=' || c.id end,
         public.concept_can_decide(c.id)
    from public.ideation_concepts c
    join public.ideation_sessions s on s.id = c.session_id
    cross join lateral public._concept_scope(c.id) x
    left join public.briefs b on b.id = c.brief_id
    left join public.sourcing_clients sc on sc.id = x.client_id
   where c.status = 'submitted_for_approval'
  union all
  select 'briefing', 'CONCEPT_CLIENT', c.id::text, b.brief_code, c.name || ' · ' || b.title,
         c.decided_by, c.decided_at, b.budget_high::numeric, b.currency, sc.name, b.market, b.region,
         public.approval_status('CONCEPT_CLIENT', c.decided_at, b.market, b.budget_high),
         'Client approver in the Client Portal', '/briefing/' || b.id || '#concepts', false
    from public.ideation_concepts c join public.briefs b on b.id = c.brief_id
    left join public.sourcing_clients sc on sc.id = b.client_id
   where c.status = 'approved' and c.client_status = 'pending';

-- ---------------------------------------------------------------------------
-- Watchtower: change requests and library changes waiting for a second person
-- ---------------------------------------------------------------------------
create or replace view public.approvals_watchtower with (security_invoker = true) as
  select cr.module, 'CR_REVIEW'::text as approval_type, cr.id::text as item_id, 'CR-' || cr.request_no as ref, left(cr.request_text, 140) as title,
         cr.requested_by, cr.requested_at, null::numeric as amount, null::text as currency, null::text as client, null::text as market, null::text as region,
         public.approval_status('CR_REVIEW', cr.requested_at, null, null) as status,
         'Admin or ' || cr.module || ' owner' as approver_rule, '/watchtower/change-requests' as href, public.can_govern(cr.module) as can_decide
    from public.change_requests cr where cr.status in ('logged','under_review','needs_clarification')
  union all
  select cr.module, 'CR_VERIFY', cr.id::text, 'CR-' || cr.request_no, left(cr.request_text, 140),
         cr.implemented_by, cr.implemented_at, null, null, null, null, null,
         public.approval_status('CR_VERIFY', cr.implemented_at, null, null),
         'Admin or ' || cr.module || ' owner · not who implemented it', '/watchtower/change-requests',
         public.can_govern(cr.module) and cr.implemented_by is distinct from auth.uid()
    from public.change_requests cr where cr.status = 'implemented_pending_verification'
  union all
  select d.module, case when d.key = 'rate_cards' then 'RATE_CARD' else 'LIBRARY' end, lr.id::text,
         coalesce(lr.code || ' ', '') || 'v' || lr.version, d.label || ': ' || lr.name,
         lr.created_by, lr.created_at, case when d.key = 'rate_cards' then nullif(lr.data->>'unit_price', '')::numeric end,
         case when d.key = 'rate_cards' then lr.data->>'currency' end, lr.data->>'client_code', nullif(lr.data->>'market', ''), null,
         public.approval_status(case when d.key = 'rate_cards' then 'RATE_CARD' else 'LIBRARY' end, lr.created_at, null, null),
         'Admin or ' || d.module || ' owner · not the author', '/watchtower/libraries/' || d.key,
         public.can_govern(d.module) and lr.created_by is distinct from auth.uid()
    from public.library_records lr join public.library_definitions d on d.key = lr.library_key
   where lr.status = 'pending_approval';

-- ---------------------------------------------------------------------------
-- RFQ+: high-value RFQs and quotes waiting for Finance
-- ---------------------------------------------------------------------------
create or replace view public.approvals_rfq with (security_invoker = true) as
  select 'rfq'::text as module, 'RFQ_HIGH_VALUE'::text as approval_type, r.id::text as item_id, r.rfq_number as ref, r.title,
         r.created_by as requested_by, r.created_at as requested_at, r.estimated_value::numeric as amount, r.currency, c.name as client, r.market, r.region,
         public.approval_status('RFQ_HIGH_VALUE', r.created_at, r.market, r.estimated_value) as status,
         'Sourcing lead · not who created the RFQ' as approver_rule, '/rfq/' || r.id as href,
         public.sourcing_is_lead() and r.created_by is distinct from auth.uid() as can_decide
    from public.rfqs r join public.jobs j on j.id = r.job_id join public.sourcing_clients c on c.id = j.client_id
   where r.status = 'draft' and r.high_value_alert and r.high_value_approved_by is null
  union all
  select 'rfq', 'QUOTE_FINANCE', q.id::text, r.rfq_number, 'Quote from ' || s.name || ' · ' || r.title,
         q.submitted_by, coalesce(q.submitted_at, q.created_at), q.total_value::numeric, q.currency, c.name, r.market, r.region,
         public.approval_status('QUOTE_FINANCE', coalesce(q.submitted_at, q.created_at), r.market, q.total_value),
         'Finance', '/finance/approvals', public.is_internal() and public.sourcing_is_finance()
    from public.rfq_responses q join public.rfqs r on r.id = q.rfq_id join public.jobs j on j.id = r.job_id
    join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = q.supplier_id
   where q.status = 'submitted' and q.finance_status = 'pending' and r.status = 'sent';

-- ---------------------------------------------------------------------------
-- Sourcing+: pushed prices waiting for the vendor (shown to admins; the vendor decides in the portal)
-- ---------------------------------------------------------------------------
create or replace view public.approvals_sourcing with (security_invoker = true) as
  select 'sourcing'::text as module, 'PUSH_PRICE'::text as approval_type, t.id::text as item_id, j.job_number || '/' || sp.spec_no as ref,
         'Pushed price to ' || s.name || ' · ' || sp.title as title, t.decided_by as requested_by, t.decided_at as requested_at,
         round(coalesce(t.unit_price, 0) * coalesce(t.quantity, 0), 2)::numeric as amount, t.currency, c.name as client, j.market, j.region,
         case when t.push_respond_by < current_date then 'overdue' else public.approval_status('PUSH_PRICE', t.decided_at, j.market, null) end as status,
         'The vendor accepts or declines in the vendor portal' as approver_rule, '/sourcing/specs/' || sp.id as href, false as can_decide
    from public.spec_triage t join public.job_specs sp on sp.id = t.spec_id join public.jobs j on j.id = sp.job_id
    join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = t.supplier_id
   where t.is_current and t.route = 'push' and t.push_status = 'pending';

-- ---------------------------------------------------------------------------
-- Order Management+: client estimate decisions, PO DOA approval, PSA exception chain
-- ---------------------------------------------------------------------------
create or replace view public.approvals_orders with (security_invoker = true) as
  select 'orders'::text as module, 'ESTIMATE_CLIENT'::text as approval_type, e.id::text as item_id, e.estimate_number as ref,
         'Client decision · ' || j.title as title, e.created_by as requested_by, coalesce(e.sent_at, e.created_at) as requested_at,
         e.sell_price::numeric as amount, e.currency, c.name as client, e.market, e.region,
         public.approval_status('ESTIMATE_CLIENT', coalesce(e.sent_at, e.created_at), e.market, e.sell_price) as status,
         'Client approver in the Client Portal; the job manager confirms it in Order Management+' as approver_rule,
         '/orders/estimates/' || e.id as href,
         public.is_internal() and (j.manager = auth.uid() or e.created_by = auth.uid() or public.sourcing_is_lead()) as can_decide
    from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
   where e.status = 'sent'
  union all
  select 'orders', 'PO_DOA', p.id::text, p.po_number, 'PO to ' || s.name || ' · ' || j.title,
         p.created_by, p.created_at, p.total_value::numeric, p.currency, c.name, p.market, p.region,
         public.approval_status('PO_DOA', p.created_at, p.market, p.total_value),
         'DOA level ' || p.required_doa_level || ' or above · not who raised it', '/orders/purchase-orders/' || p.id,
         public.is_internal() and p.created_by is distinct from auth.uid() and coalesce(public.sourcing_doa_level(), -1) >= p.required_doa_level
    from public.purchase_orders p join public.jobs j on j.id = p.job_id join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = p.supplier_id
   where p.status = 'pending_approval'
  union all
  select 'orders',
         case x.stage when 'line_manager' then 'PSA_LINE_MANAGER' when 'procurement' then 'PSA_ASSESS' when 'approver' then 'PSA_APPROVE' else 'PSA_APPLY' end,
         x.id::text, x.reference, x.title, x.requester,
         coalesce(case x.stage when 'line_manager' then x.submitted_at when 'procurement' then x.lm_decided_at when 'approver' then x.assessed_at else x.approved_at end, x.updated_at),
         x.fee::numeric, x.currency, c.name, x.market, x.region,
         public.approval_status(case x.stage when 'line_manager' then 'PSA_LINE_MANAGER' when 'procurement' then 'PSA_ASSESS' when 'approver' then 'PSA_APPROVE' else 'PSA_APPLY' end,
           coalesce(case x.stage when 'line_manager' then x.submitted_at when 'procurement' then x.lm_decided_at when 'approver' then x.assessed_at else x.approved_at end, x.updated_at), x.market, x.fee),
         case x.stage when 'line_manager' then 'The named line manager'
                      when 'procurement' then 'Regional procurement SME or sourcing lead · not the requester'
                      when 'approver' then 'DOA level ' || coalesce(x.required_doa_level, 0) || ' or above · not the requester'
                      else 'Finance (FSSC / CST)' end,
         '/orders/psa/' || x.id,
         case x.stage when 'line_manager' then x.line_manager = auth.uid()
                      when 'procurement' then public.is_internal() and (public.my_srt_role() = 'procurement' or public.sourcing_is_lead()) and x.requester is distinct from auth.uid()
                      when 'approver' then public.is_internal() and x.requester is distinct from auth.uid() and coalesce(public.sourcing_doa_level(), -1) >= coalesce(x.required_doa_level, 0)
                      else public.is_internal() and public.sourcing_is_finance() end
    from public.psa_exceptions x left join public.jobs j on j.id = x.job_id left join public.sourcing_clients c on c.id = j.client_id
   where x.stage in ('line_manager','procurement','approver','to_apply');

-- ---------------------------------------------------------------------------
-- Finance+: estimate reviews and supplier invoices (override is maker-checker)
-- ---------------------------------------------------------------------------
create or replace view public.approvals_finance with (security_invoker = true) as
  select 'finance'::text as module, 'ESTIMATE_FINANCE'::text as approval_type, fe.id::text as item_id, fe.estimate_number as ref,
         'Finance review · ' || fe.job_title || ' (' || array_to_string(fe.review_triggers, '; ') || ')' as title,
         fe.created_by as requested_by, fe.created_at as requested_at, fe.sell_price::numeric as amount, fe.currency, fe.client_name as client, fe.market, fe.region,
         public.approval_status('ESTIMATE_FINANCE', fe.created_at, fe.market, fe.sell_price) as status,
         'Finance' as approver_rule, '/finance/approvals' as href, public.finance_is_finance() as can_decide
    from public.v_finance_estimates fe where fe.needs_review
  union all
  select 'finance', case when i.status = 'matching' and i.match_status in ('variance','missing_evidence') and i.override_requested_by is not null then 'INVOICE_OVERRIDE' else 'INVOICE_APPROVE' end,
         i.id::text, i.invoice_ref, 'Invoice ' || i.invoice_number || ' from ' || s.name,
         case when i.override_requested_by is not null and i.match_status <> 'matched' then i.override_requested_by else i.submitted_by end,
         case when i.override_requested_by is not null and i.match_status <> 'matched' then i.override_requested_at else i.submitted_at end,
         i.gross_amount::numeric, i.currency, c.name, i.market, i.region,
         public.approval_status(case when i.override_requested_by is not null and i.match_status <> 'matched' then 'INVOICE_OVERRIDE' else 'INVOICE_APPROVE' end,
           case when i.override_requested_by is not null and i.match_status <> 'matched' then i.override_requested_at else i.submitted_at end, i.market, i.gross_amount),
         case when i.override_requested_by is not null and i.match_status <> 'matched' then 'Finance · not who recorded the override' else 'Finance (three-way match first)' end,
         '/finance/invoices/' || i.id,
         public.finance_is_finance() and (i.override_requested_by is null or i.match_status = 'matched' or i.override_requested_by <> auth.uid())
    from public.supplier_invoices i join public.suppliers s on s.id = i.supplier_id join public.jobs j on j.id = i.job_id
    join public.sourcing_clients c on c.id = j.client_id
   where i.status in ('submitted','matching');

-- ---------------------------------------------------------------------------
-- Logistics+: proof of delivery verification (never by the uploader)
-- ---------------------------------------------------------------------------
create or replace view public.approvals_logistics with (security_invoker = true) as
  select 'logistics'::text as module, 'POD_VERIFY'::text as approval_type, sh.id::text as item_id, sh.shipment_number as ref,
         'POD for ' || d.delivery_number || ' · ' || s.name as title, sh.pod_uploaded_by as requested_by, coalesce(sh.pod_received_at, sh.created_at) as requested_at,
         null::numeric as amount, null::text as currency, c.name as client, d.market, d.region,
         public.approval_status('POD_VERIFY', coalesce(sh.pod_received_at, sh.created_at), d.market, null) as status,
         'Anyone at adm Indicia except the uploader; every mandatory POD point checked' as approver_rule, '/logistics/pods' as href,
         public.is_internal() and sh.pod_uploaded_by is distinct from auth.uid() as can_decide
    from public.shipments sh join public.deliveries d on d.id = sh.delivery_id join public.suppliers s on s.id = sh.supplier_id
    left join public.purchase_orders p on p.id = d.po_id left join public.jobs j on j.id = p.job_id left join public.sourcing_clients c on c.id = j.client_id
   where sh.pod_status = 'received';

-- ---------------------------------------------------------------------------
-- Execution+: deployment audits (never by the installer) and the next quality gate with its check sheet uploaded
-- ---------------------------------------------------------------------------
create or replace view public.approvals_execution with (security_invoker = true) as
  select 'execution'::text as module, 'DEPLOYMENT_AUDIT'::text as approval_type, dep.id::text as item_id, dep.deployment_code as ref,
         'Audit install · ' || j.title as title, dep.installed_by as requested_by, coalesce(dep.installation_date::timestamptz, dep.created_at) as requested_at,
         null::numeric as amount, null::text as currency, c.name as client, dep.market, dep.region,
         public.approval_status('DEPLOYMENT_AUDIT', coalesce(dep.installation_date::timestamptz, dep.created_at), dep.market, null) as status,
         'Anyone at adm Indicia except who recorded the install' as approver_rule, '/execution/deployments/' || dep.id as href,
         public.is_internal() and dep.installed_by is distinct from auth.uid() as can_decide
    from public.deployments dep join public.jobs j on j.id = dep.job_id join public.sourcing_clients c on c.id = j.client_id
   where dep.stage = 'installed' and dep.audit_status in ('pending','needs_review')
  union all
  select 'execution', 'QUALITY_GATE', g.id::text, j.job_number, initcap(g.gate_key) || ' gate · ' || j.title,
         f.uploaded_by, f.created_at, null, null, c.name, j.market, j.region,
         public.approval_status('QUALITY_GATE', f.created_at, j.market, null),
         'Anyone at adm Indicia (check sheet uploaded)', '/execution/jobs/' || j.id, public.is_internal()
    from public.job_quality_gates g join public.jobs j on j.id = g.job_id join public.sourcing_clients c on c.id = j.client_id
    join lateral (select x.uploaded_by, x.created_at from public.files x where x.entity_type = 'job_quality_gate' and x.entity_id = j.id::text || ':' || g.gate_key
                   order by x.created_at desc limit 1) f on true
   where g.status = 'pending' and j.status in ('ordered','in_production','delivered')
     and not exists (select 1 from public.job_quality_gates g2 where g2.job_id = g.job_id and g2.status <> 'passed'
                      and public.execution_gate_order(g2.gate_key) < public.execution_gate_order(g.gate_key));

-- ---------------------------------------------------------------------------
-- Assure+ (internal SRM and SRT desk) and the vendor portal's internal decisions
-- ---------------------------------------------------------------------------
create or replace view public.approvals_assure with (security_invoker = true) as
  select 'assure'::text as module,
         (case d.verifier_role when 'head' then 'SRT_ONBOARDING_APPROVAL' when 'finance' then 'SRT_BANK' else 'SRT_GATE' end)::text as approval_type,
         (g.supplier_id::text || ':' || g.gate_key) as item_id, s.supplier_code as ref, d.label || ' · ' || s.name as title,
         g.updated_by as requested_by, g.updated_at as requested_at, null::numeric as amount, null::text as currency, s.client, s.market, s.region,
         public.approval_status(case d.verifier_role when 'head' then 'SRT_ONBOARDING_APPROVAL' when 'finance' then 'SRT_BANK' else 'SRT_GATE' end, g.updated_at, s.market, null) as status,
         case d.verifier_role when 'head' then 'Procurement head' when 'finance' then 'Finance' else 'SRT agent or lead' end as approver_rule,
         '/assure/suppliers/' || s.id as href,
         public.is_internal() and (public.is_admin() or case d.verifier_role when 'finance' then public.my_srt_role() = 'finance'
                                                                            when 'head' then public.my_srt_role() = 'head'
                                                                            else coalesce(public.my_srt_role(), '') in ('agent','lead') end) as can_decide
    from public.supplier_gates g join public.gate_definitions d on d.key = g.gate_key join public.suppliers s on s.id = g.supplier_id
   where g.status = 'received' and d.active
  union all
  select 'assure', 'VENDOR_RFI', r.id::text, s.supplier_code, 'Vendor information · ' || s.name, r.submitted_by, r.submitted_at, null, null, s.client, s.market, s.region,
         public.approval_status('VENDOR_RFI', r.submitted_at, s.market, null), 'Procurement head',
         case when r.ticket_id is not null then '/assure/srt/tickets/' || r.ticket_id else '/assure/suppliers/' || s.id end,
         public.is_admin() or public.my_srt_role() = 'head'
    from public.vendor_rfis r join public.suppliers s on s.id = r.supplier_id where r.status = 'submitted'
  union all
  select 'assure', 'CERTIFICATE', ce.id::text, s.supplier_code, t.name || ' · ' || s.name, ce.uploaded_by, ce.created_at, null, null, s.client, ce.market, ce.region,
         public.approval_status('CERTIFICATE', ce.created_at, ce.market, null), 'Anyone at adm Indicia except the uploader', '/assure/compliance/review',
         public.is_internal() and ce.uploaded_by is distinct from auth.uid()
    from public.supplier_certificates ce join public.suppliers s on s.id = ce.supplier_id join public.library_records t on t.id = ce.cert_type_id
   where ce.verification_status = 'pending' and not ce.not_applicable
  union all
  select 'assure', 'DOCUMENT', dc.id::text, s.supplier_code, dc.title || ' · ' || s.name, dc.uploaded_by, dc.created_at, null, null, s.client, dc.market, dc.region,
         public.approval_status('DOCUMENT', dc.created_at, dc.market, null), 'Anyone at adm Indicia except the uploader', '/assure/compliance/review',
         public.is_internal() and dc.uploaded_by is distinct from auth.uid()
    from public.supplier_documents dc join public.suppliers s on s.id = dc.supplier_id where dc.status = 'pending'
  union all
  select 'assure', case when p.status in ('submitted','under_review') then 'PRE_ASSESSMENT_VM' else 'PRE_ASSESSMENT_PROCUREMENT' end,
         p.id::text, s.supplier_code, 'Pre-assessment · ' || p.company_name, p.submitted_by, coalesce(p.submitted_at, p.updated_at), null, null, s.client, p.market, p.region,
         public.approval_status(case when p.status in ('submitted','under_review') then 'PRE_ASSESSMENT_VM' else 'PRE_ASSESSMENT_PROCUREMENT' end, coalesce(p.submitted_at, p.updated_at), p.market, null),
         case when p.status in ('submitted','under_review') then 'Vendor manager (SRT agent or lead)' else 'Procurement · not the vendor-manager reviewer to confirm' end,
         '/assure/pre-assessments/' || p.id,
         case when p.status in ('submitted','under_review') then public.assure_is_vendor_manager() else public.assure_is_procurement() end
    from public.vendor_pre_assessments p join public.suppliers s on s.id = p.supplier_id
   where p.status in ('submitted','under_review','vm_approved','procurement_review','negotiation')
  union all
  select 'assure', 'REVIEW_OUTCOMES', r.id::text, s.supplier_code, r.title || ' · ' || s.name, r.created_by, r.updated_at, null, null, s.client, r.market, r.region,
         public.approval_status('REVIEW_OUTCOMES', r.updated_at, r.market, null), 'Procurement head · not who created the review', '/assure/reviews/' || r.id,
         (public.is_admin() or public.my_srt_role() = 'head') and r.created_by is distinct from auth.uid()
    from public.business_reviews r join public.suppliers s on s.id = r.supplier_id where r.outcomes_approval_status = 'pending'
  union all
  select 'assure', 'SURVEY_REVIEW', sr.id::text, s.supplier_code, sr.template_name || ' · ' || s.name, sr.submitted_by, coalesce(sr.submitted_at, sr.created_at), null, null,
         s.client, sr.market, sr.region, public.approval_status('SURVEY_REVIEW', coalesce(sr.submitted_at, sr.created_at), sr.market, null),
         'Anyone at adm Indicia', '/assure/surveys', public.is_internal()
    from public.survey_responses sr join public.suppliers s on s.id = sr.supplier_id where sr.status in ('submitted','under_review')
  union all
  select 'assure', 'WORKFLOW_STEP', w.id::text, s.supplier_code, w.name || ' · ' || st.name, coalesce(prev.acted_by, w.initiated_by), coalesce(prev.acted_at, w.started_at),
         null, null, s.client, w.market, w.region,
         case when st.due_date < current_date then 'overdue' else public.approval_status('WORKFLOW_STEP', coalesce(prev.acted_at, w.started_at), w.market, null) end,
         'Step approver: ' || replace(st.approver_role, '_', ' ') || ' · not who approved the previous step', '/assure/workflows/' || w.id,
         public.is_internal() and public.assure_can_approve(st.approver_role) and prev.acted_by is distinct from auth.uid()
    from public.workflow_instances w join public.workflow_steps st on st.instance_id = w.id and st.idx = w.current_step
    join public.suppliers s on s.id = w.supplier_id
    left join public.workflow_steps prev on prev.instance_id = w.id and prev.idx = w.current_step - 1
   where w.status = 'in_progress' and st.status in ('pending','in_progress')
  union all
  select 'assure', 'CA_VERIFY', a.id::text, coalesce(n.ncr_ref, s.supplier_code), 'Verify corrective action · ' || left(a.description, 80), a.done_by, a.done_at, null, null,
         s.client, s.market, s.region, public.approval_status('CA_VERIFY', a.done_at, s.market, null),
         'Anyone at adm Indicia except who completed it', '/assure/quality/ncr/' || n.id, public.is_internal() and a.done_by is distinct from auth.uid()
    from public.ncr_corrective_actions a join public.ncrs n on n.id = a.ncr_id join public.suppliers s on s.id = a.supplier_id where a.status = 'done'
  union all
  select 'assure', 'VENDOR_APPLICATION', va.id::text, va.application_ref, 'Vendor application · ' || va.company_name, null::uuid, va.created_at, null, null, null, null, null,
         public.approval_status('VENDOR_APPLICATION', va.created_at, null, null), 'Procurement or vendor manager', '/assure/applications',
         public.is_internal() and (public.assure_is_procurement() or public.assure_is_vendor_manager())
    from public.vendor_applications va where va.status in ('new','reviewing')
  union all
  select 'assure', 'SUBSCRIPTION', sq.id::text, s.supplier_code, 'Plan change to ' || sq.requested_tier || ' · ' || s.name, sq.requested_by, sq.created_at, null, null,
         s.client, s.market, s.region, public.approval_status('SUBSCRIPTION', sq.created_at, s.market, null), 'Procurement or Procurement head',
         '/assure/suppliers/' || s.id, public.is_internal() and public.assure_is_procurement()
    from public.subscription_requests sq join public.suppliers s on s.id = sq.supplier_id where sq.status = 'open';

-- ---------------------------------------------------------------------------
-- The inbox
-- ---------------------------------------------------------------------------
-- Every approvals_% view, unioned at run time (so a module plugs in by adding its view).
create or replace function public._approvals_all()
returns table (module text, approval_type text, item_id text, ref text, title text, requested_by uuid, requested_at timestamptz,
  amount numeric, currency text, client text, market text, region text, status text, approver_rule text, href text, can_decide boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_sql text;
begin
  select string_agg(format(
      'select module::text, approval_type::text, item_id::text, ref::text, title::text, requested_by::uuid, requested_at::timestamptz, '
      'amount::numeric, currency::text, client::text, market::text, region::text, status::text, approver_rule::text, href::text, '
      'coalesce(can_decide, false)::boolean from public.%I', c.relname), ' union all ' order by c.relname)
    into v_sql
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m') and c.relname like 'approvals\_%';
  if v_sql is null then return; end if;
  return query execute v_sql;
end $$;

-- p_scope 'mine': what the caller may decide now (never their own request where maker-checker applies).
-- p_scope 'all': every pending approval on the platform; admins only.
create or replace function public.approvals_inbox(p_scope text default 'mine')
returns table (module text, approval_type text, item_id text, ref text, title text, requested_by uuid, requested_by_name text,
  requested_at timestamptz, age_days numeric, amount numeric, currency text, client text, market text, region text, status text,
  approver_rule text, href text, can_decide boolean, maker_checker boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'The approvals inbox is for adm Indicia staff' using errcode = '42501'; end if;
  if coalesce(p_scope, 'mine') not in ('mine','all') then raise exception 'Choose mine or all'; end if;
  if p_scope = 'all' and not public.is_admin() then raise exception 'Only admins can see every approval on the platform' using errcode = '42501'; end if;
  return query
    select a.module, a.approval_type, a.item_id, a.ref, a.title, a.requested_by, coalesce(nullif(p.full_name, ''), p.email),
           a.requested_at, round((extract(epoch from (now() - a.requested_at)) / 86400.0)::numeric, 1), a.amount, a.currency, a.client,
           a.market, a.region, a.status, a.approver_rule, a.href,
           a.can_decide and not (m.mc and a.requested_by is not distinct from auth.uid()), m.mc
      from public._approvals_all() a
      left join public.profiles p on p.id = a.requested_by
      cross join lateral (select coalesce((select ap.maker_checker from public._approval_policy(a.approval_type, null, a.market, a.amount) ap), true) as mc) m
     where coalesce(p_scope, 'mine') = 'all'
        or (a.can_decide and not (m.mc and a.requested_by is not distinct from auth.uid()))
     order by (a.status = 'overdue') desc, a.requested_at nulls last;
end $$;

-- Counts by module, type and status (health). Internal callers only; others get nothing.
create or replace function public.approvals_summary()
returns table (module text, approval_type text, status text, n int, oldest_requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_internal() then return; end if;
  return query select a.module, a.approval_type, a.status, count(*)::int, min(a.requested_at)
    from public._approvals_all() a group by a.module, a.approval_type, a.status order by a.module, a.approval_type, a.status;
end $$;

create or replace view public.watchtower_health_approvals with (security_invoker = true) as
  with s as (
    select coalesce(sum(n), 0)::numeric as pending, coalesce(sum(n) filter (where status = 'overdue'), 0)::numeric as overdue,
           coalesce(round((extract(epoch from (now() - min(oldest_requested_at))) / 86400.0)::numeric, 1), 0) as oldest
      from public.approvals_summary()
  )
  select 'watchtower'::text as module, 'approvals_pending'::text as metric, 'Approvals waiting across every module'::text as label,
         s.pending as value, 0::numeric as target, case when s.pending = 0 then 'ok' else 'warn' end as status from s
  union all select 'watchtower', 'approvals_overdue', 'Approvals past their SLA', s.overdue, 0,
         case when s.overdue = 0 then 'ok' when s.overdue <= 3 then 'warn' else 'bad' end from s
  union all select 'watchtower', 'oldest_pending_days', 'Oldest pending approval (days)', s.oldest, 7,
         case when s.oldest <= 7 then 'ok' when s.oldest <= 14 then 'warn' else 'bad' end from s;

revoke all on public.approvals_briefing, public.approvals_watchtower, public.approvals_rfq, public.approvals_sourcing, public.approvals_orders,
  public.approvals_finance, public.approvals_logistics, public.approvals_execution, public.approvals_assure from anon, authenticated;
revoke insert, update, delete on public.watchtower_health_approvals from anon, authenticated;
revoke execute on function public._approvals_all() from public, anon, authenticated;
revoke execute on function public.approvals_inbox(text), public.approvals_summary() from public, anon;
grant execute on function public.approvals_inbox(text), public.approvals_summary() to authenticated;
