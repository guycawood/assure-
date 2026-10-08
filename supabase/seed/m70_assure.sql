-- DUMMY DATA for the Assure+ internal SRM functions (supplier 360, compliance, pre-assessment, quality, performance,
-- contracts, business reviews, tasks, surveys, workflows, messages, training).
-- Every value here is made up. Suppliers come from demo_data.sql (DEMO-001..DEMO-030); library records
-- (certification_types, ncr_categories) come from m10_watchtower.sql and are referenced by code.
-- Runs in one transaction; the system-write flag is transaction-local so it never leaks into the demo session.

begin;
select set_config('assure.system_write', 'on', true);

-- Helper view of demo suppliers with their number.
create temporary view demo_s as
  select s.id, s.name, s.category, s.region, s.market, substring(s.supplier_code from 6)::int as n
    from public.suppliers s where s.supplier_code like 'DEMO-%';

-- ---------------------------------------------------------------------------
-- Supplier profiles (commercial + classification)
-- ---------------------------------------------------------------------------
update public.supplier_profiles p set
  entity_type = (array['manufacturer','manufacturer','distributor','service_provider','logistics'])[1 + d.n % 5],
  legal_entity = d.name || case when d.region = 'EMEA' then ' Ltd' when d.region = 'Americas' then ' Inc' else ' Co., Ltd' end,
  vendor_code = 'V' || lpad((10000 + d.n * 37)::text, 6, '0'),
  primary_contact_name = (array['Wei Chen','Lina Tran','Somchai P.','Priya Nair','Tom Hughes','Anna Weber','Marta Silva','Jake Miller','Carlos Ruiz','Sophie Martin'])[1 + d.n % 10],
  contact_phone = '+00 555 0' || lpad(d.n::text, 3, '0'),
  website = 'https://example.com/' || lower(regexp_replace(d.name, '[^A-Za-z]+', '-', 'g')),
  factory_count = 1 + d.n % 4,
  payment_terms = (array['net_30','net_45','net_60','net_60','net_90','net_30','custom','net_15'])[1 + d.n % 8],
  payment_terms_days = case when d.n % 8 = 6 then 75 end,
  nti_rate = (array[0, 2, 3.5, 5, 6, 8, 10, 12])[1 + (d.n * 5) % 8],
  annual_spend_forecast = (50000 + d.n * 9000),
  risk_level = case when d.n in (9, 13, 21) then 'high' when d.n in (12) then 'critical' when d.n % 4 = 0 then 'medium' else 'low' end,
  risk_reason = case when d.n in (9, 12, 13, 21) then 'Dummy: open compliance gaps' end
from demo_s d where p.supplier_id = d.id;

update public.suppliers s set tier = (array['strategic','preferred','approved','approved','conditional','transactional','tail'])[1 + d.n % 7]
  from demo_s d where s.id = d.id and s.tier is null;

-- ---------------------------------------------------------------------------
-- Certificates: ISO 9001 for everyone, FSC for print/packaging, Sedex for half. Expiries spread so some are
-- expired, some expiring within 90 days and most valid. A few vendor uploads are waiting to be checked.
-- ---------------------------------------------------------------------------
insert into public.supplier_certificates (supplier_id, cert_type_id, cert_number, issuer, issue_date, expiry_date, audit_score,
                                          verification_status, uploaded_by_role, document_path, internal_notes)
select d.id, lr.id, x.code || '-' || lpad(d.n::text, 4, '0'), (array['SGS','Bureau Veritas','Intertek','TÜV SÜD'])[1 + d.n % 4],
       current_date - 700 + x.shift, current_date + x.expiry, 70 + (d.n * 7) % 30,
       x.vstatus, x.role, 'demo/certificates/' || x.code || '-' || d.n || '.pdf', 'Dummy certificate'
from demo_s d
cross join lateral (values
  ('ISO_9001', (array[-12, 25, 60, 200, 400, 520, 700, 88])[1 + d.n % 8], (d.n * 3) % 50, case when d.n % 9 = 4 then 'pending' else 'verified' end, case when d.n % 9 = 4 then 'vendor' else 'internal' end),
  ('FSC', (array[45, 300, -30, 610, 150])[1 + d.n % 5], 10, case when d.n % 7 = 3 then 'pending' else 'verified' end, case when d.n % 7 = 3 then 'vendor' else 'internal' end),
  ('SEDEX', (array[180, 15, 365, -3, 240])[1 + d.n % 5], 20, case when d.n % 10 = 7 then 'rejected' else 'verified' end, 'internal')
) as x(code, expiry, shift, vstatus, role)
join public.library_records lr on lr.library_key = 'certification_types' and lr.code = x.code and lr.status = 'active'
where (x.code = 'ISO_9001') or (x.code = 'FSC' and d.category in ('Print','Packaging')) or (x.code = 'SEDEX' and d.n % 2 = 1);

update public.supplier_certificates set rejection_reason = 'Certificate is for a different site; upload the one for the main factory.'
 where verification_status = 'rejected' and internal_notes = 'Dummy certificate';
update public.supplier_certificates set verified_at = now() - interval '30 days'
 where verification_status = 'verified' and internal_notes = 'Dummy certificate';

-- ---------------------------------------------------------------------------
-- Documents waiting for review (vendor uploads) plus some already checked.
-- ---------------------------------------------------------------------------
insert into public.supplier_documents (supplier_id, doc_type, title, file_path, po_reference, status, uploaded_by_role, review_note, reviewed_at, created_at)
select d.id, x.doc_type, x.title || ' ' || d.name, 'demo/documents/' || d.n || '-' || x.doc_type || '.pdf', 'PO-2026-' || lpad((d.n * 11)::text, 5, '0'),
       x.status, 'vendor', x.note, case when x.status <> 'pending' then now() - interval '3 days' end, now() - (x.age || ' days')::interval
from demo_s d
cross join lateral (values
  ('invoice', 'Invoice', case when d.n % 3 = 0 then 'verified' else 'pending' end, null::text, d.n % 5),
  ('delivery_note', 'Delivery note', case when d.n % 4 = 1 then 'rejected' else 'pending' end, case when d.n % 4 = 1 then 'Signature missing on page 2.' end, 2 + d.n % 3),
  ('insurance', 'Public liability insurance', 'verified', null, 40)
) as x(doc_type, title, status, note, age)
where d.n <= 12;

-- ---------------------------------------------------------------------------
-- Pre-assessments in every stage
-- ---------------------------------------------------------------------------
insert into public.vendor_pre_assessments (supplier_id, company_name, contact_name, contact_email, major_category, head_office_country,
                                           data, status, workflow_stage, feedback_to_vendor, submitted_at, created_at)
select d.id, d.name, 'Dummy contact', 'vendor' || d.n || '@example.com', d.category, d.market,
       jsonb_build_object('type_of_ownership', (array['Private','Family owned','Listed'])[1 + d.n % 3], 'total_employees', 40 + d.n * 13,
                          'annual_turnover', (2 + d.n % 9) || 'M USD', 'english_speaking', (array['yes','partial','no'])[1 + d.n % 3],
                          'num_factories', 1 + d.n % 3, 'factory_country', d.market, 'company_size_m2', 1500 + d.n * 120,
                          'clients', jsonb_build_array('Dummy Brand A', 'Dummy Brand B'), 'major_products', jsonb_build_array(d.category, 'Displays'),
                          'quality_certs', jsonb_build_array(jsonb_build_object('type', 'ISO 9001', 'cert_number', 'Q-' || d.n, 'audit_date', '2026-03-01'))),
       x.status, x.stage, x.feedback, now() - (x.age || ' days')::interval, now() - ((x.age + 3) || ' days')::interval
from demo_s d
join (values
  (25, 'submitted', 'vendor_manager', null::text, 2),
  (26, 'under_review', 'vendor_manager', 'Please add your factory audit report.', 5),
  (27, 'vm_approved', 'procurement_lead', null, 8),
  (28, 'procurement_review', 'procurement_lead', null, 10),
  (29, 'negotiation', 'procurement_lead', null, 14),
  (30, 'onboarded', 'complete', null, 30),
  (21, 'vm_rejected', 'vendor_manager', 'We could not confirm the site capability for display manufacturing.', 20)
) as x(n, status, stage, feedback, age) on x.n = d.n;

insert into public.vendor_pre_assessment_reviews (assessment_id, vm_notes, vm_reviewed_at, procurement_notes, nti_proposed, payment_terms_proposed,
                                                  annual_spend_forecast, proposed_tier, nti_agreed, payment_terms_agreed, tier_agreed)
select a.id,
       case when a.status <> 'submitted' then 'Dummy: questionnaire complete, capability looks fine.' end,
       case when a.status <> 'submitted' then now() - interval '4 days' end,
       case when a.status in ('negotiation','onboarded') then 'Dummy: benchmarked against two incumbents.' end,
       case when a.status in ('negotiation','onboarded') then 5 end,
       case when a.status in ('negotiation','onboarded') then 'net_60' end,
       case when a.status in ('negotiation','onboarded') then 120000 end,
       case when a.status in ('negotiation','onboarded') then 'preferred' end,
       case when a.status = 'onboarded' then 5 end, case when a.status = 'onboarded' then 'net_60' end, case when a.status = 'onboarded' then 'preferred' end
from public.vendor_pre_assessments a join demo_s d on d.id = a.supplier_id;

-- ---------------------------------------------------------------------------
-- Quality: inspections, NCRs and corrective actions
-- ---------------------------------------------------------------------------
insert into public.quality_inspections (supplier_id, po_reference, product_name, inspection_type, inspection_date, sample_size, defect_count,
                                        defects_found, aql_level, result, corrective_action_required, corrective_action_notes, internal_notes)
select d.id, 'PO-2026-' || lpad((d.n * 11 + k)::text, 5, '0'),
       (array['Shelf wobbler','Floor display unit','Gondola end header','Counter display','Shipper box','Window vinyl'])[1 + (d.n + k) % 6],
       (array['final','pre_shipment','in_process','incoming_material'])[1 + (d.n + k) % 4],
       current_date - (d.n * 3 + k * 17) % 120, 80 + (d.n * 10) % 120,
       case when (d.n + k) % 5 = 0 then 9 when (d.n + k) % 3 = 0 then 3 else 0 end,
       case when (d.n + k) % 5 = 0 then array['Colour shift','Scuffed edges'] when (d.n + k) % 3 = 0 then array['Minor print defect'] else '{}' end,
       'II / 2.5',
       case when (d.n + k) % 5 = 0 then 'fail' when (d.n + k) % 3 = 0 then 'conditional_pass' when (d.n + k) % 11 = 0 then 'pending' else 'pass' end,
       (d.n + k) % 5 = 0, case when (d.n + k) % 5 = 0 then 'Re-run with approved colour standard.' end, 'Dummy inspection'
from demo_s d cross join generate_series(1, 2) k
where d.n <= 20;

insert into public.ncrs (supplier_id, inspection_id, category_id, severity, title, description, po_reference, internal_notes)
select q.supplier_id, q.id, lr.id, case when q.defect_count >= 9 then 'major' else 'minor' end,
       'Failed inspection: ' || q.product_name, 'Raised from inspection ' || q.inspection_ref || '. ' || array_to_string(q.defects_found, ', '),
       q.po_reference, 'Dummy NCR'
from public.quality_inspections q
join public.library_records lr on lr.library_key = 'ncr_categories' and lr.code = 'NCR-PRINT' and lr.status = 'active'
where q.result = 'fail' and q.internal_notes = 'Dummy inspection';

insert into public.ncrs (supplier_id, category_id, severity, title, description, internal_notes)
select d.id, lr.id, x.sev, x.title, 'Dummy non-conformance.', 'Dummy NCR'
from demo_s d
join (values (7, 'NCR-LATE', 'major', 'Delivery 6 days late to Bangkok DC'), (13, 'NCR-DOC', 'minor', 'Packing list missing on two pallets'),
             (15, 'NCR-DAMAGE', 'critical', 'Crushed outer cartons on arrival'), (1, 'NCR-DIM', 'major', 'Header card 4 mm too wide')) as x(n, code, sev, title) on x.n = d.n
join public.library_records lr on lr.library_key = 'ncr_categories' and lr.code = x.code and lr.status = 'active';

-- Vendor responses and one closed NCR.
update public.ncrs set acknowledgement_status = 'responded', acknowledged_at = now() - interval '2 days', responded_at = now() - interval '1 day',
       supplier_response = 'We have retrained the press team and changed the ink supplier.', root_cause = 'Ink batch out of tolerance'
 where internal_notes = 'Dummy NCR' and severity = 'major';
update public.ncrs set acknowledgement_status = 'acknowledged', acknowledged_at = now() - interval '1 day'
 where internal_notes = 'Dummy NCR' and severity = 'minor' and title like 'Packing%';

insert into public.ncr_corrective_actions (ncr_id, supplier_id, description, owner_side, due_date, status, done_at, done_note)
select n.id, n.supplier_id, x.descr, x.owner, n.due_date, x.status, case when x.status <> 'open' then now() - interval '1 day' end,
       case when x.status <> 'open' then 'Dummy: completed' end
from public.ncrs n
cross join lateral (values ('Root cause analysis and 8D report', 'supplier', case when n.acknowledgement_status = 'responded' then 'done' else 'open' end),
                           ('Re-inspect next shipment', 'internal', 'open')) as x(descr, owner, status)
where n.internal_notes = 'Dummy NCR';

-- ---------------------------------------------------------------------------
-- Performance: four quarters per supplier
-- ---------------------------------------------------------------------------
insert into public.performance_records (supplier_id, period, cost_score, otif_score, quality_score, compliance_score, sustainability_score,
                                        ncr_count, defect_rate, internal_notes)
select d.id, p.period,
       least(100, 55 + (d.n * 7 + p.i * 3) % 40),
       least(100, case when d.n in (9, 21) then 52 + p.i * 3 when d.n in (5, 18) then 64 + p.i else 72 + (d.n * 5 + p.i * 4) % 27 end),
       least(100, 60 + (d.n * 11 + p.i * 5) % 38),
       least(100, case when d.n in (12, 13) then 58 + p.i * 2 else 70 + (d.n * 3 + p.i * 2) % 29 end),
       least(100, 50 + (d.n * 13 + p.i * 6) % 45),
       case when p.i = 4 then (d.n * 3) % 6 else (d.n + p.i) % 3 end,
       round(((d.n * 7 + p.i) % 90) / 10.0, 1),
       'Dummy scores'
from demo_s d
cross join (values (1, '2025-Q4'), (2, '2026-Q1'), (3, '2026-Q2'), (4, '2026-Q3')) as p(i, period);

-- Issues feed, using the same thresholds as assure_generate_issues() (that function needs a signed-in staff member).
insert into public.performance_issues (supplier_id, issue_type, source_key, title, period, severity, acknowledgement_status, supplier_response)
select r.supplier_id, 'otif_miss', 'otif:' || r.period, 'On time in full score of ' || r.otif_score || ' is below the minimum of 70 in ' || r.period,
       r.period, case when r.otif_score < 50 then 'critical' else 'high' end,
       case when r.otif_score >= 60 then 'responded' else 'pending' end,
       case when r.otif_score >= 60 then 'Dummy: vessel delays out of the port; booking earlier sailings.' end
  from public.performance_records r where r.period = '2026-Q3' and r.otif_score < 70 and r.internal_notes = 'Dummy scores'
union all
select r.supplier_id, 'defect_rate', 'defect:' || r.period, 'Defect rate of ' || r.defect_rate || '% is above the 2% target in ' || r.period,
       r.period, case when r.defect_rate >= 8 then 'critical' when r.defect_rate >= 5 then 'high' else 'medium' end, 'pending', null
  from public.performance_records r where r.period = '2026-Q3' and r.defect_rate > 2 and r.internal_notes = 'Dummy scores'
union all
select r.supplier_id, 'ncr', 'ncr:' || r.period, r.ncr_count || ' non-conformance reports raised in ' || r.period,
       r.period, case when r.ncr_count >= 5 then 'critical' when r.ncr_count >= 3 then 'high' else 'medium' end, 'acknowledged', null
  from public.performance_records r where r.period = '2026-Q3' and r.ncr_count > 0 and r.internal_notes = 'Dummy scores'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Contracts and templates
-- ---------------------------------------------------------------------------
insert into public.contract_templates (name, category, folder, description, content) values
  ('Master supply agreement', 'service_agreements', 'Core agreements', 'Standard MSA for production suppliers.', 'Dummy MSA wording: scope, pricing, quality, liability, termination.'),
  ('Mutual NDA', 'nda', 'Core agreements', 'Two-way confidentiality agreement.', 'Dummy NDA wording.'),
  ('Statement of work', 'sow', 'Projects', 'Per-campaign statement of work.', 'Dummy SOW wording: deliverables, timeline, acceptance.'),
  ('Price amendment', 'amendments', 'Amendments', 'Changes unit prices under an existing MSA.', 'Dummy amendment wording.'),
  ('Supplier code of conduct acknowledgement', 'terms_conditions', 'Compliance', 'Vendor confirms the adm Indicia Code of Conduct.', 'Dummy code of conduct text.');

insert into public.contracts (contract_ref, supplier_id, template_id, title, document_type, status, value, currency, start_date, end_date, due_date,
                              sent_at, finalized_at, content_summary, internal_notes, created_at)
select 'CT-2026-' || lpad(nextval('public.contract_no')::text, 5, '0'), d.id,
       (select id from public.contract_templates where name = x.tpl), x.title || ': ' || d.name, x.dtype, x.status,
       x.value, 'EUR', current_date - x.age, current_date + x.ends, current_date + 14,
       case when x.status <> 'draft' then now() - (x.age || ' days')::interval end,
       case when x.status = 'counter_signed' then now() - ((x.age - 5) || ' days')::interval end,
       'Dummy contract.', 'Dummy contract', now() - (x.age || ' days')::interval
from demo_s d
join (values
  (1, 'Master supply agreement', 'Master supply agreement', 'contract', 'counter_signed', 400000, 330, 35),
  (2, 'Master supply agreement', 'Master supply agreement', 'contract', 'counter_signed', 250000, 300, 52),
  (3, 'Mutual NDA', 'Mutual NDA', 'nda', 'counter_signed', null, 700, 20),
  (8, 'Master supply agreement', 'Master supply agreement', 'contract', 'counter_signed', 180000, 200, 400),
  (13, 'Master supply agreement', 'Master supply agreement', 'contract', 'counter_signed', 230000, 360, -4),
  (15, 'Statement of work', 'Christmas 2026 SOW', 'sow', 'sent', 60000, 6, 90),
  (19, 'Master supply agreement', 'Master supply agreement', 'contract', 'in_review', 110000, 12, 365),
  (23, 'Master supply agreement', 'Master supply agreement', 'contract', 'draft', 200000, 1, 365),
  (29, 'Master supply agreement', 'Logistics services agreement', 'contract', 'counter_signed', 320000, 280, 88),
  (12, 'Supplier code of conduct acknowledgement', 'Code of conduct acknowledgement', 'other', 'declined', null, 20, 365)
) as x(n, tpl, title, dtype, status, value, age, ends) on x.n = d.n;

insert into public.contract_parties (contract_id, name, email, role, signing_order, is_internal, status, signed_at, signature_evidence)
select c.id, p.name, p.email, 'signer', p.ord, p.internal,
       case when c.status = 'counter_signed' then 'signed' when c.status = 'draft' then 'pending' when c.status = 'declined' and p.ord = 1 then 'declined'
            when c.status in ('sent','in_review') and p.ord = 1 then 'signed' else 'sent' end,
       case when c.status = 'counter_signed' or (c.status in ('sent','in_review') and p.ord = 1) then c.sent_at + interval '2 days' end,
       case when c.status = 'counter_signed' or (c.status in ('sent','in_review') and p.ord = 1) then 'Dummy e-signature reference' end
from public.contracts c join demo_s d on d.id = c.supplier_id
cross join lateral (values ('Dummy vendor signatory', 'vendor' || d.n || '@example.com', 1, false),
                           ('Ada Admin', 'ada.admin@adm-indicia.com', 2, true)) as p(name, email, ord, internal)
where c.internal_notes = 'Dummy contract';

insert into public.contract_activity (contract_id, event_type, description, created_at)
select id, 'sent', 'Contract sent to recipients', sent_at from public.contracts where internal_notes = 'Dummy contract' and sent_at is not null;
insert into public.contract_activity (contract_id, event_type, description, created_at)
select id, 'signed', 'All signers complete: contract finalised', finalized_at from public.contracts where internal_notes = 'Dummy contract' and finalized_at is not null;

insert into public.contract_negotiations (contract_id, clause, complexity, risk, rationale)
select id, 'Liability cap at 1x annual spend', 'high', 'low', 'Dummy: vendor asked for a cap; acceptable with conditions.'
  from public.contracts where internal_notes = 'Dummy contract' and status = 'in_review';

-- ---------------------------------------------------------------------------
-- Business reviews across last month, this month and next
-- ---------------------------------------------------------------------------
insert into public.business_reviews (supplier_id, title, description, review_type, meeting_date, status, internal_attendees, vendor_attendees,
                                     agenda_items, shared_with_vendor, key_outcomes, discussion_notes, overall_sentiment, outcomes_approval_status,
                                     next_review_date, vendor_response)
select d.id, x.title || ': ' || d.name, 'Dummy review.', x.rtype, current_date + x.offs, x.status,
       array['lena.lead@adm-indicia.com','pedro.procurement@adm-indicia.com'], array['Dummy vendor lead'],
       array['Performance against KPIs','Open NCRs and actions','Next quarter pipeline'], x.shared,
       x.outcomes, case when x.status = 'completed' then 'Dummy: constructive session.' end,
       case when x.status = 'completed' then x.sentiment end,
       case when x.outcomes is null then 'not_set' else x.approval end,
       case when x.status = 'completed' then current_date + x.offs + 90 end,
       case when x.shared and x.status = 'scheduled' and d.n % 2 = 0 then 'accepted' else 'none' end
from demo_s d
join (values
  (1, 'Q3 QBR', 'qbr', -20, 'completed', true, 'Agree OTIF recovery plan; quarterly audit.', 'positive', 'approved'),
  (2, 'Q3 QBR', 'qbr', -12, 'completed', false, 'Move to net 60 from January.', 'neutral', 'pending'),
  (8, 'Check-in', 'check_in', -5, 'completed', false, null, 'positive', 'not_set'),
  (9, 'Escalation: OTIF', 'escalation', -2, 'completed', false, 'Formal improvement notice issued.', 'needs_attention', 'pending'),
  (13, 'Renewal review', 'renewal', 3, 'scheduled', true, null, null, 'not_set'),
  (15, 'Q4 planning', 'qbr', 8, 'scheduled', true, null, null, 'not_set'),
  (23, 'Q4 QBR', 'qbr', 15, 'scheduled', false, null, null, 'not_set'),
  (29, 'Q4 QBR', 'qbr', 22, 'scheduled', true, null, null, 'not_set'),
  (4, 'Check-in', 'check_in', 35, 'scheduled', false, null, null, 'not_set'),
  (19, 'Q3 QBR', 'qbr', -40, 'cancelled', false, null, null, 'not_set')
) as x(n, title, rtype, offs, status, shared, outcomes, sentiment, approval) on x.n = d.n;

-- ---------------------------------------------------------------------------
-- Action plan tasks
-- ---------------------------------------------------------------------------
insert into public.action_plan_tasks (supplier_id, title, description, category, priority, due_date, status, progress_notes, completed_at, verified_at, source)
select d.id, x.title, 'Dummy action.', x.cat, x.prio, current_date + x.due, x.status, x.notes,
       case when x.status in ('completed','verified') then now() - interval '2 days' end,
       case when x.status = 'verified' then now() - interval '1 day' end, x.src
from demo_s d
join (values
  (1, 'Send 8D report for header card sizing', 'quality', 'high', 5, 'in_progress', 'Draft shared with QA', 'ncr'),
  (1, 'Upload renewed ISO 9001 certificate', 'compliance', 'medium', 30, 'open', null, 'manual'),
  (9, 'OTIF recovery plan', 'delivery', 'critical', -3, 'open', null, 'issue'),
  (9, 'Weekly shipment status report', 'delivery', 'high', 7, 'in_progress', 'First two reports sent', 'issue'),
  (12, 'Sign Code of Conduct', 'compliance', 'critical', -1, 'open', null, 'manual'),
  (13, 'Renew SMETA audit', 'compliance', 'high', 20, 'in_progress', 'Audit booked', 'manual'),
  (15, 'Improve carton strength', 'quality', 'high', 10, 'completed', 'Switched to double wall', 'ncr'),
  (18, 'Reduce defect rate below 2%', 'quality', 'medium', 45, 'open', null, 'issue'),
  (21, 'Confirm whether supplier is still needed', 'other', 'low', 5, 'open', null, 'manual'),
  (2, 'Switch to renewable electricity tariff', 'sustainability', 'medium', 90, 'open', null, 'review'),
  (5, 'Cost-down proposal for POSM range', 'cost', 'medium', 25, 'completed', 'Proposal sent', 'review'),
  (8, 'Quarterly capacity forecast', 'delivery', 'low', 14, 'verified', 'Received and checked', 'review')
) as x(n, title, cat, prio, due, status, notes, src) on x.n = d.n;

-- ---------------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------------
insert into public.survey_templates (name, description, category, questions) values
  ('ESG self-assessment', 'Short questionnaire on environmental and social practices.', 'esg',
   '[{"id":"esg1","text":"Do you have a written environmental policy?","type":"yes_no","required":true},
     {"id":"esg2","text":"What share of your electricity is renewable?","type":"single_choice","options":["None","Under 50%","50% or more","100%"],"required":true},
     {"id":"esg3","text":"How would you rate your waste recycling?","type":"rating","required":false},
     {"id":"esg4","text":"Anything else we should know?","type":"textarea","required":false}]'),
  ('Quality system check', 'Confirms how quality is controlled on adm Indicia work.', 'quality',
   '[{"id":"q1","text":"Do you inspect every batch before shipping?","type":"yes_no","required":true},
     {"id":"q2","text":"Which AQL level do you use?","type":"text","required":true},
     {"id":"q3","text":"Date of your last internal audit","type":"date","required":false}]');

insert into public.survey_responses (template_id, template_version, template_name, questions, supplier_id, due_date, status, answers, submitted_at, review_notes)
select t.id, t.version, t.name, t.questions, d.id, current_date + 14, x.status,
       case when x.status = 'draft' then '[]'::jsonb else
         (select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'question_text', q->>'text', 'question_type', q->>'type',
            'answer', case q->>'type' when 'yes_no' then 'Yes' when 'rating' then '4' when 'single_choice' then 'Under 50%' when 'date' then '2026-06-30' else 'Dummy answer' end))
          from jsonb_array_elements(t.questions) q) end,
       case when x.status <> 'draft' then now() - interval '3 days' end,
       case when x.status = 'completed' then 'Dummy: answers consistent with certificates.' end
from demo_s d
join (values (1, 'ESG self-assessment', 'submitted'), (2, 'ESG self-assessment', 'completed'), (3, 'Quality system check', 'draft'),
             (13, 'Quality system check', 'under_review'), (15, 'ESG self-assessment', 'draft')) as x(n, tpl, status) on x.n = d.n
join public.survey_templates t on t.name = x.tpl;

-- ---------------------------------------------------------------------------
-- Workflows (one running, one on hold, one completed)
-- ---------------------------------------------------------------------------
insert into public.workflow_instances (template_id, template_version, name, workflow_type, supplier_id, priority, status, current_step, started_at, completed_at)
select t.id, t.version, t.name, t.workflow_type, d.id, x.prio, x.status, x.step, now() - (x.age || ' days')::interval,
       case when x.status = 'completed' then now() - interval '1 day' end
from demo_s d
join (values (25, 'Vendor onboarding', 'high', 'in_progress', 1, 6), (13, 'Compliance renewal', 'high', 'on_hold', 1, 10), (8, 'Tier upgrade', 'medium', 'completed', 2, 20))
  as x(n, tpl, prio, status, step, age) on x.n = d.n
join public.workflow_templates t on t.name = x.tpl;

insert into public.workflow_steps (instance_id, idx, name, description, approver_role, sla_days, due_date, status, acted_at, notes)
select w.id, s.ord - 1, s.step->>'title', s.step->>'description', s.step->>'approver_role', (s.step->>'sla_days')::int,
       (w.started_at::date + (select sum((x->>'sla_days')::int)::int from jsonb_array_elements(t.steps) with ordinality e(x, o) where e.o <= s.ord))::date,
       case when w.status = 'completed' or s.ord - 1 < w.current_step then 'approved' when s.ord - 1 = w.current_step then 'in_progress' else 'pending' end,
       case when w.status = 'completed' or s.ord - 1 < w.current_step then w.started_at + ((s.ord * 2) || ' days')::interval end,
       case when w.status = 'completed' or s.ord - 1 < w.current_step then 'Dummy approval' end
from public.workflow_instances w
join public.workflow_templates t on t.id = w.template_id
cross join lateral jsonb_array_elements(t.steps) with ordinality s(step, ord);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
insert into public.conversations (supplier_id, subject)
select d.id, x.subject from demo_s d
join (values (1, 'Artwork files for Q4 wobblers'), (1, 'ISO 9001 renewal'), (9, 'Shipment delays from Manila'), (15, 'Carton damage claim')) as x(n, subject) on x.n = d.n;

insert into public.messages (conversation_id, body, sender_side, created_at)
select c.id, m.body, m.side, now() - (m.ago || ' hours')::interval
from public.conversations c join demo_s d on d.id = c.supplier_id
cross join lateral (values ('Hello, could you confirm the latest status on this?', 'internal', 30),
                           ('Thanks, we are on it and will send an update tomorrow.', 'supplier', 26),
                           ('Update attached. Let us know if anything is missing.', 'supplier', 4)) as m(body, side, ago);
update public.conversations c set last_message_at = (select max(created_at) from public.messages m where m.conversation_id = c.id);

-- ---------------------------------------------------------------------------
-- Training modules
-- ---------------------------------------------------------------------------
insert into public.training_modules (title, resource_type, description, url, content, category, audience, duration_minutes, display_order) values
  ('Getting started with Assure+', 'document', 'What Assure+ does and where to find things.', null,
   'Assure+ is where adm Indicia manages suppliers: onboarding, compliance, quality, performance and contracts.', 'Getting started', 'all', 10, 1),
  ('Reviewing vendor documents', 'document', 'How to check and verify certificates and documents.', null,
   'Open the document review queue, check the document matches the supplier and dates, then verify or reject with a reason.', 'Compliance', 'internal', 8, 2),
  ('Raising and closing an NCR', 'document', 'From failed inspection to verified corrective action.', null,
   'Log the inspection, raise the NCR with a category, agree corrective actions and verify each one before closing.', 'Quality', 'internal', 12, 3),
  ('Responding to a non-conformance', 'document', 'For vendors: how to acknowledge and respond to an NCR.', null,
   'Acknowledge within two working days, then send your root cause and corrective actions.', 'Quality', 'vendor', 6, 4),
  ('Why do I need to verify my own work twice?', 'faq', null, null,
   'You don''t. Assure+ asks a different person to verify, so every decision has a second pair of eyes.', 'FAQ', 'all', null, 5),
  ('Supplier relationship basics (video)', 'video', 'A short introduction to working with suppliers.', 'https://example.com/training/srm-basics', null, 'Getting started', 'internal', 15, 6);

drop view demo_s;
select set_config('assure.system_write', 'off', true);
commit;
