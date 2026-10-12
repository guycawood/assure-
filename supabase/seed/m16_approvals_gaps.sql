-- DUMMY DATA: approval policies that switch on the approval steps added for the gaps in docs/APPROVALS.md
-- (migrations 20261022000001-3). The steps are policy-driven: without these records the platform behaves as before.
-- Values are demo settings, not adm Indicia policy. Records are inserted active; later changes go through the library's
-- maker-checker. Existing m15 records are tightened in place (demo data only).

-- ---------------------------------------------------------------------------
-- New policies
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'approval_policies', x.code, x.name, x.data::jsonb, 'active', '2026-01-01'::date, 'Demo policy (approval gaps)'
from (values
  -- Watchtower
  ('AP-ACCESS-USER', 'User access change', '{"module":"watchtower","approval_type":"ACCESS_USER","approver_role":"admin","maker_checker":true,"sla_days":2,"description":"Changes to user type, SRT role or admin rights are requested by one admin and applied when a second admin approves.","decided_in":"admin_set_user_access, approval_request_decide","where_in_ui":"/assure/admin/users"}'),
  ('AP-ACCESS-SOURCING', 'Sourcing access and DOA change', '{"module":"sourcing","approval_type":"ACCESS_SOURCING","approver_role":"procurement_head","maker_checker":true,"sla_days":2,"description":"Sourcing lead, finance flag and DOA level changes are requested by a Sourcing governor and confirmed by the Procurement head (or another admin).","decided_in":"sourcing_set_access, approval_request_decide","where_in_ui":"/sourcing/admin"}'),
  -- RFQ+ / Sourcing+
  ('AP-RFQ-AWARD-HIGH', 'RFQ award: high value (DOA)', '{"module":"rfq","approval_type":"RFQ_AWARD","approver_role":"doa","min_value":50000,"maker_checker":true,"sla_days":2,"description":"Awards of 50,000 or more need a DOA level that covers the awarded value; never the RFQ creator.","decided_in":"rfq_award","where_in_ui":"/rfq/<rfq>"}'),
  ('AP-RFQ-BYPASS', 'Bypass award (minimum quotes not met)', '{"module":"rfq","approval_type":"RFQ_BYPASS","approver_role":"sourcing_lead","maker_checker":true,"sla_days":2,"description":"Awarding with fewer than the minimum quotes under a bypass reason marked needs approval: a sourcing lead (not the requester or the RFQ creator) approves and the award is made.","decided_in":"rfq_award, approval_request_decide","where_in_ui":"/rfq/<rfq>"}'),
  ('AP-RATE-CARD-EXCEPTION', 'Rate-card exception on an RFQ', '{"module":"rfq","approval_type":"RATE_CARD_EXCEPTION","approver_role":"sourcing_lead","maker_checker":true,"sla_days":2,"description":"An RFQ raised despite a live rate card needs a sourcing lead to approve the exception before it is sent.","decided_in":"rfq_send, approval_request_decide","where_in_ui":"/rfq/<rfq>"}'),
  ('AP-TRIAGE-OVERRIDE', 'Triage override that skips the RFQ', '{"module":"sourcing","approval_type":"TRIAGE_OVERRIDE","approver_role":"sourcing_lead","maker_checker":true,"sla_days":2,"description":"Moving a spec to Adopt, Adapt or Push (no RFQ) is requested with a reason and applied by a different sourcing lead.","decided_in":"spec_triage_override, approval_request_decide","where_in_ui":"/sourcing/specs/<spec>"}'),
  ('AP-SOURCING-SETTINGS', 'Sourcing settings change', '{"module":"sourcing","approval_type":"SOURCING_SETTINGS","approver_role":"sourcing_lead","maker_checker":true,"sla_days":3,"description":"Triage tolerance, push threshold, instant price limit and respond-by days change only when a second person approves.","decided_in":"sourcing_update_settings, approval_request_decide","where_in_ui":"/sourcing/admin"}'),
  -- Order Management+
  ('AP-ESTIMATE-CONFIRM', 'Confirm the client''s estimate approval', '{"module":"orders","approval_type":"ESTIMATE_CONFIRM","approver_role":"sourcing_lead","maker_checker":true,"sla_days":3,"description":"The job manager or a sourcing lead confirms a client approval recorded in the Client Portal (or a client PO); never the estimate creator.","decided_in":"estimate_approve","where_in_ui":"/orders/estimates/<estimate>"}'),
  ('AP-PO-ETENDER', 'PO over the e-tender threshold', '{"module":"orders","approval_type":"PO_ETENDER","approver_role":"procurement_head","maker_checker":true,"sla_days":3,"description":"POs above the client''s e-tender threshold need the Procurement head before DOA approval.","decided_in":"po_etender_decide","where_in_ui":"/orders/purchase-orders/<po>"}'),
  -- Finance+
  ('AP-INVOICE-DOA', 'Supplier invoice: high value (DOA)', '{"module":"finance","approval_type":"INVOICE_APPROVE","approver_role":"doa","min_value":25000,"maker_checker":false,"sla_days":5,"description":"Matched invoices of 25,000 or more need a finance user whose DOA level covers the value.","decided_in":"finance_approve_invoice","where_in_ui":"/finance/invoices/<invoice>"}'),
  ('AP-PAYMENT-RELEASE', 'Payment release', '{"module":"finance","approval_type":"PAYMENT_RELEASE","approver_role":"finance","maker_checker":true,"sla_days":5,"description":"Payment is scheduled (released) by a different finance user than the one who approved the invoice.","decided_in":"finance_schedule_payment","where_in_ui":"/finance/payments"}'),
  ('AP-BILL-CANCEL', 'Cancel a sent client bill', '{"module":"finance","approval_type":"BILL_CANCEL","approver_role":"finance","maker_checker":true,"sla_days":2,"description":"Cancelling a bill already sent to the client (a credit) needs a second finance user.","decided_in":"finance_bill_cancel, approval_request_decide","where_in_ui":"/finance/billing"}'),
  -- Logistics+
  ('AP-DELIVERY-CONFIRM', 'Mark delivered without a verified POD', '{"module":"logistics","approval_type":"DELIVERY_CONFIRM","approver_role":"logistics_lead","maker_checker":false,"description":"A delivery is marked delivered once its POD is verified; otherwise only a logistics lead can, with an override reason.","decided_in":"logistics_mark_delivered","where_in_ui":"/logistics/deliveries/<delivery>"}'),
  -- Execution+
  ('AP-RECCE-READY', 'Production-ready recce', '{"module":"execution","approval_type":"RECCE_READY","approver_role":"internal","maker_checker":true,"sla_days":2,"description":"Marking a recce production ready (it drives production sizes) is confirmed by a second person.","decided_in":"execution_recce_set_status, approval_request_decide","where_in_ui":"/execution/recces/<recce>"}'),
  -- Assure+
  ('AP-SUPPLIER-REACTIVATE', 'Reactivate a suspended or offboarded supplier', '{"module":"assure","approval_type":"SUPPLIER_REACTIVATE","approver_role":"srt_lead","maker_checker":true,"sla_days":3,"description":"Moving a suspended or offboarded supplier back to active needs a second SRT lead, Procurement head or admin.","decided_in":"assure_set_supplier_status, approval_request_decide","where_in_ui":"/assure/suppliers/<supplier>"}'),
  ('AP-CONTRACT', 'Contract approval before sending', '{"module":"assure","approval_type":"CONTRACT_APPROVE","approver_role":"procurement_head","maker_checker":true,"sla_days":3,"description":"Contracts are approved internally by the Procurement head before they go to the vendor.","decided_in":"assure_contract_action, approval_request_decide","where_in_ui":"/assure/contracts/<contract>"}'),
  ('AP-CONTRACT-HIGH', 'Contract approval: high value (legal)', '{"module":"assure","approval_type":"CONTRACT_APPROVE","approver_role":"admin","min_value":250000,"maker_checker":true,"sla_days":5,"description":"Contracts worth 250,000 or more are approved by an admin (legal sign-off) before sending.","decided_in":"assure_contract_action, approval_request_decide","where_in_ui":"/assure/contracts/<contract>"}'),
  ('AP-INSPECTION-CHANGE', 'Inspection result change away from fail', '{"module":"assure","approval_type":"INSPECTION_CHANGE","approver_role":"quality","maker_checker":true,"sla_days":3,"description":"Changing a failed inspection to pass or conditional pass needs a second person with a quality role.","decided_in":"assure_set_inspection_result, approval_request_decide","where_in_ui":"/assure/quality"}'),
  ('AP-ISSUE-RESOLVE', 'Performance issue resolution', '{"module":"assure","approval_type":"ISSUE_RESOLVE","approver_role":"internal","maker_checker":true,"sla_days":5,"description":"A performance issue the vendor has responded to is resolved by someone other than the supplier''s SRT owner.","decided_in":"assure_issue_resolve","where_in_ui":"/assure/performance"}'),
  ('AP-PAYMENT-TERMS', 'Non-standard payment terms', '{"module":"assure","approval_type":"PAYMENT_TERMS","approver_role":"finance","maker_checker":true,"standard_payment_days":60,"sla_days":3,"description":"Proposed payment terms shorter than 60 days (or without a day count) go to Finance before they are sent to the vendor.","decided_in":"assure_pa_transition, approval_request_decide","where_in_ui":"/assure/pre-assessments/<id>"}'),
  -- Shopper IQ
  ('AP-SIQ-EFFECTIVENESS', 'Shopper IQ result verification', '{"module":"shopper-iq","approval_type":"SIQ_EFFECTIVENESS","approver_role":"briefing_lead","maker_checker":true,"sla_days":5,"description":"Effectiveness and uplift figures recorded in the app are verified by a second person before clients see them in the Client Portal.","decided_in":"siq_verify_effectiveness","where_in_ui":"/shopper-iq/campaigns"}'),
  ('AP-SIQ-ASSET', 'Asset rights and brand sign-off', '{"module":"shopper-iq","approval_type":"SIQ_ASSET","approver_role":"briefing_lead","maker_checker":true,"sla_days":5,"description":"Assets need a rights/brand sign-off before Briefing+ can reuse them.","decided_in":"siq_asset_signoff","where_in_ui":"/shopper-iq/assets"}')
) x(code, name, data)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- m15 policies tightened (demo data, edited in place)
-- ---------------------------------------------------------------------------
update public.library_records set data = data || x.patch::jsonb
  from (values
    ('AP-SCORECARD', '{"approver_role":"module_owner","maker_checker":true,"sla_days":5,"description":"A draft scorecard methodology is submitted by an admin and made live when a second person (another admin or an Assure+ owner) approves it. Weights must add up.","decided_in":"scorecard_activate, approval_request_decide"}'),
    ('AP-CLIENT-ACCESS', '{"maker_checker":true,"sla_days":2,"description":"Client approver rights are confirmed by a second admin; viewer access and revocations stay direct (audited).","decided_in":"client_access_grant, approval_request_decide"}'),
    ('AP-RFQ-AWARD', '{"approver_role":"sourcing_lead","maker_checker":true,"sla_days":3,"description":"Award after bidding closes by a sourcing lead (DOA level above 50,000), never the RFQ creator: finance-approved quote, supplier eligible in Assure+, minimum quotes or a governed bypass reason."}'),
    ('AP-ESTIMATE-FINANCE', '{"maker_checker":true,"description":"Estimates with margin under FR-MIN-MARGIN, value at or over FR-REVIEW-VALUE, or a minimum-quotes bypass: Finance (never the estimate creator) reviews them, and they can''t be sent to the client until approved.","decided_in":"finance_estimate_decide, estimate_send"}'),
    ('AP-PSA-LM', '{"approver_role":"line_manager","description":"The requester names their line manager, who must hold a line-manager role (SRT lead, Procurement head or sourcing lead)."}'),
    ('AP-QUALITY-GATE', '{"approver_role":"quality","maker_checker":true,"description":"Mock-up, production, installation and closure gates in order, each with its check sheet; signed off by a quality role, never who uploaded the check sheet."}'),
    ('AP-JOB-CLOSE', '{"approver_role":"sourcing_lead","maker_checker":true,"sla_days":2,"description":"Closing a job with open soft checks is requested with an override reason and closed when a sourcing lead approves.","decided_in":"execution_close_job, approval_request_decide"}'),
    ('AP-SRT-GATE', '{"maker_checker":true,"description":"SRT agents or leads verify or reject received evidence on a gate; on critical gates never who requested or supplied the evidence."}'),
    ('AP-SRT-BANK', '{"maker_checker":true,"description":"Finance verifies the bank details gate; never who requested or supplied the evidence."}'),
    ('AP-SRT-APPROVAL', '{"maker_checker":true,"description":"Final onboarding approval gate (Procurement head); never who requested it."}'),
    ('AP-FAST-TRACK', '{"sla_days":2,"description":"Anyone at adm Indicia asks for a fast-track route with a justification and close-by date; an SRT lead approves it (not the requester, not the supplier''s creator).","decided_in":"approve_fast_track, approval_request_decide"}'),
    ('AP-NCR-CLOSE', '{"approver_role":"quality","maker_checker":true,"sla_days":5,"description":"Close an NCR once every corrective action is verified; a quality role, never who raised it."}'),
    ('AP-SURVEY', '{"maker_checker":true,"description":"Approve or reject a vendor survey response; never who launched the survey."}'),
    ('AP-LIBRARY', '{"description":"New or superseding versions of libraries marked requires approval (core principles, DOA, Impact Grade, POD checklist, display scoring, finance rules, approval policies, and now substrates, emission factors and bypass reasons)."}')
  ) x(code, patch)
 where library_key = 'approval_policies' and library_records.code = x.code and status = 'active';

-- Libraries that feed reported CO2e or unlock RFQ bypasses now go live only after a second person approves.
update public.library_definitions set requires_approval = true
 where key in ('substrates','material_emission_factors','transport_emission_factors','bypass_reasons');
