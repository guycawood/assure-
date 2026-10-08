// Assure+ internal SRM: supplier 360, compliance, pre-assessment, quality, performance, contracts, reviews,
// tasks, surveys, workflows, messages and training. Access rules, transitions and calculations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const VENDOR = "00000000-0000-0000-0000-0000000000f1";
const OTHER_VENDOR = "00000000-0000-0000-0000-0000000000f2";
const PROC = "00000000-0000-0000-0000-0000000000a6";

// Fixtures: two suppliers, a vendor user for each (linked by contact email), a procurement user, library records.
const { rows: [s1] } = await asSuper(
  "insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('T-001','Test Print Ltd','China','APAC','Unilever','Print','v1@example.com') returning id");
const { rows: [s2] } = await asSuper(
  "insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('T-002','Other Co','Germany','EMEA','BAU','POSM','v2@example.com') returning id");
const S1 = s1.id, S2 = s2.id;
await asSuper("insert into auth.users (id, email) values ($1,'v1@example.com'), ($2,'v2@example.com'), ($3,'proc@adm-indicia.com')", [VENDOR, OTHER_VENDOR, PROC]);
await asSuper("update public.profiles set srt_role = 'procurement' where id = $1", [PROC]);
ids.vendor = VENDOR; ids.other = OTHER_VENDOR; ids.proc = PROC;

async function lib(key, code, name) {
  const r = await asSuper("insert into public.library_records (library_key, code, name, status) values ($1,$2,$3,'active') returning id", [key, code, name]);
  return r.rows[0].id;
}
const ISO = await lib("certification_types", "T_ISO9001", "ISO 9001");
const FSC = await lib("certification_types", "T_FSC", "FSC");
const NCRCAT = await lib("ncr_categories", "T-NCR-PRINT", "Print defect");
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

test("vendor users are linked to their supplier", async () => {
  const p = await one("vendor", "select user_type, supplier_id from public.profiles where id = auth.uid()");
  assert.deepEqual([p.user_type, p.supplier_id], ["vendor", S1]);
});

/* ---------------- 1. Supplier 360 ---------------- */

test("supplier profiles: staff only; risk only through the audited function", async () => {
  const r = await as("vendor", "select * from public.supplier_profiles");
  assert.equal(r.rows.length, 0);
  await as("plain", "update public.supplier_profiles set nti_rate = 4.5, payment_terms = 'net_60', risk_level = 'critical' where supplier_id = $1", [S1]);
  const p = await one("plain", "select nti_rate, payment_terms, risk_level from public.supplier_profiles where supplier_id = $1", [S1]);
  assert.deepEqual([Number(p.nti_rate), p.payment_terms, p.risk_level], [4.5, "net_60", "low"]);
  await rejects(as("plain", "select public.assure_set_risk_level($1,'high','x')", [S1]), /Only vendor managers/);
  await rejects(as("agent", "select public.assure_set_risk_level($1,'high','')", [S1]), /Say why/);
  await as("agent", "select public.assure_set_risk_level($1,'high','Single-source for UL China')", [S1]);
  assert.equal((await one("plain", "select risk_level from public.supplier_profiles where supplier_id = $1", [S1])).risk_level, "high");
  const log = await as("plain", "select action from public.assure_activity where supplier_id = $1 and entity = 'supplier' order by id", [S1]);
  assert.deepEqual(log.rows.map((x) => x.action), ["payment_terms_changed", "nti_changed", "risk_changed"]);
  assert.equal((await as("vendor", "select * from public.assure_activity")).rows.length, 0);
});

test("supplier status: lead/head/admin with a reason, audited per supplier", async () => {
  await rejects(as("agent", "select public.assure_set_supplier_status($1,'suspended','x')", [[S2]]), /Only an SRT lead/);
  await rejects(as("lead", "select public.assure_set_supplier_status($1,'suspended','')", [[S2]]), /reason/);
  const n = await one("lead", "select public.assure_set_supplier_status($1,'under_review','Quality escalation') as n", [[S2]]);
  assert.equal(n.n, 1);
  await as("lead", "select public.assure_set_supplier_status($1,'onboarding','Back to onboarding')", [[S2]]);
});

test("activity notes: staff can log, cannot forge events or actors", async () => {
  await as("plain", "insert into public.assure_activity (supplier_id, entity, action, kind, title, actor) values ($1,'note','logged','call','Called about delays', auth.uid())", [S1]);
  await rejects(as("plain", "insert into public.assure_activity (supplier_id, entity, action, kind, title, actor) values ($1,'note','x','event','Fake', auth.uid())", [S1]), /row-level security/);
  await rejects(as("plain", "insert into public.assure_activity (supplier_id, entity, action, kind, title, actor) values ($1,'note','x','call','Fake', $2)", [S1, ids.admin]), /row-level security/);
  await rejects(as("vendor", "insert into public.assure_activity (supplier_id, entity, action, kind, title, actor) values ($1,'note','x','call','Hi', auth.uid())", [S1]), /row-level security/);
  await rejects(as("admin", "delete from public.assure_activity"), /permission denied/);
});

/* ---------------- 2. Compliance ---------------- */

test("expiry rule: expired / expiring_soon within 90 days / valid", async () => {
  const r = await one("plain", `select public.assure_expiry_status(current_date - 1) a, public.assure_expiry_status(current_date) b,
    public.assure_expiry_status(current_date + 90) c, public.assure_expiry_status(current_date + 91) d, public.assure_expiry_status(null) e`);
  assert.deepEqual([r.a, r.b, r.c, r.d, r.e], ["expired", "expiring_soon", "expiring_soon", "valid", "no_expiry"]);
});

test("certificates: staff add as pending; the uploader can't verify; vendors can't verify or see internal notes", async () => {
  const c = await one("agent", `insert into public.supplier_certificates (supplier_id, cert_type_id, expiry_date, verification_status, internal_notes)
    values ($1,$2,current_date + 30,'verified','Chased twice') returning id, verification_status, uploaded_by, region, market`, [S1, ISO]);
  assert.deepEqual([c.verification_status, c.uploaded_by, c.region, c.market], ["pending", ids.agent, "APAC", "China"]);
  await rejects(as("agent", "select public.assure_review_certificate($1,'verify',null)", [c.id]), /someone else/);
  await rejects(as("vendor", "select public.assure_review_certificate($1,'verify',null)", [c.id]), /Only adm Indicia staff/);
  await rejects(as("lead", "select public.assure_review_certificate($1,'reject','')", [c.id]), /reason/);
  await as("lead", "select public.assure_review_certificate($1,'verify',null)", [c.id]);
  const v = await one("plain", "select status, expiry_status, cert_type_name from public.supplier_certificates_v where id = $1", [c.id]);
  assert.deepEqual([v.status, v.expiry_status, v.cert_type_name], ["expiring_soon", "expiring_soon", "ISO 9001"]);
  // direct writes to decision fields are ignored
  await as("agent", "update public.supplier_certificates set verification_status = 'rejected' where id = $1", [c.id]);
  assert.equal((await one("plain", "select verification_status from public.supplier_certificates where id = $1", [c.id])).verification_status, "verified");
  // changing the expiry date of a verified certificate sends it back for checking
  await as("agent", "update public.supplier_certificates set expiry_date = current_date + 400 where id = $1", [c.id]);
  assert.equal((await one("plain", "select status from public.supplier_certificates_v where id = $1", [c.id])).status, "pending");
  // vendors: no base table; own rows via the view without internal notes
  assert.equal((await as("vendor", "select * from public.supplier_certificates")).rows.length, 0);
  const vv = await as("vendor", "select * from public.vendor_certificates");
  assert.equal(vv.rows.length, 1);
  assert.equal("internal_notes" in vv.rows[0], false);
  assert.equal((await as("other", "select * from public.vendor_certificates")).rows.length, 0);
  await as("vendor", "update public.supplier_certificates set expiry_date = current_date + 999"); // RLS: no rows
  assert.notEqual((await one("plain", "select (expiry_date - current_date) d from public.supplier_certificates where id = $1", [c.id])).d, 999);
});

test("vendor certificate upload arrives pending and only staff verify it", async () => {
  await rejects(as("vendor", "select public.assure_vendor_add_certificate($1,'C-1',null,null,current_date + 200,'')", [FSC]), /Attach/);
  const { id } = await one("vendor", "select public.assure_vendor_add_certificate($1,'C-1','SGS',null,current_date + 200,'vendor/s1/fsc.pdf') as id", [FSC]);
  const c = await one("plain", "select verification_status, uploaded_by_role, supplier_id from public.supplier_certificates where id = $1", [id]);
  assert.deepEqual([c.verification_status, c.uploaded_by_role, c.supplier_id], ["pending", "vendor", S1]);
  await rejects(as("plain", "select public.assure_vendor_add_certificate($1,'C-1',null,null,null,'x')", [FSC]), /Only a vendor user/);
  await as("agent", "select public.assure_review_certificate($1,'verify',null)", [id]);
  await rejects(as("agent", `insert into public.supplier_certificates (supplier_id, cert_type_id) values ($1,$2)`, [S1, NCRCAT]), /certification types library/);
});

test("document review queue: vendors upload for their own company only and never verify", async () => {
  await rejects(as("vendor", "insert into public.supplier_documents (supplier_id, doc_type, title, file_path) values ($1,'invoice','INV','x')", [S2]), /row-level security|own company/);
  const d = await one("vendor", "insert into public.supplier_documents (supplier_id, doc_type, title, file_path, status) values ($1,'invoice','INV 1','x','verified') returning id, status, uploaded_by_role", [S1]);
  assert.deepEqual([d.status, d.uploaded_by_role], ["pending", "vendor"]);
  await rejects(as("vendor", "update public.supplier_documents set status = 'verified' where id = $1", [d.id]), /permission denied/);
  await rejects(as("vendor", "select public.assure_review_document($1,'verify',null)", [d.id]), /Only adm Indicia staff/);
  await rejects(as("agent", "select public.assure_review_document($1,'reject',null)", [d.id]), /reason/);
  await as("agent", "select public.assure_review_document($1,'verify',null)", [d.id]);
  await rejects(as("lead", "select public.assure_review_document($1,'reject','x')", [d.id]), /already been reviewed/);
  const own = await one("plain", "insert into public.supplier_documents (supplier_id, doc_type, title, file_path) values ($1,'nda','NDA','x') returning id", [S1]);
  await rejects(as("plain", "select public.assure_review_document($1,'verify',null)", [own.id]), /someone else/);
  assert.equal((await as("other", "select * from public.supplier_documents")).rows.length, 0);
});

/* ---------------- 3. Pre-assessment ---------------- */

test("pre-assessment: vendor submits; legal transitions only; reviewer fields stay internal", async () => {
  const { id } = await one("vendor", `select public.assure_pa_save(null,'Test Print Ltd','Wei','v1@example.com','Print','China','{"total_employees":120}') as id`);
  await rejects(as("agent", "select public.assure_pa_transition($1,'start_review',null,null)", [id]), /review is not open/);
  await as("vendor", "select public.assure_pa_submit($1)", [id]);
  await rejects(as("vendor", "update public.vendor_pre_assessments set status = 'onboarded' where id = $1", [id]), /permission denied/);
  await rejects(as("vendor", "select public.assure_pa_transition($1,'vm_approve',null,null)", [id]), /Only adm Indicia staff/);
  await rejects(as("proc", "select public.assure_pa_transition($1,'vm_approve',null,null)", [id]), /vendor manager/);
  await rejects(as("agent", "select public.assure_pa_transition($1,'confirm_onboarding',null,null)", [id]), /Only procurement/);
  await as("agent", "select public.assure_pa_transition($1,'start_review','Looks complete',null)", [id]);
  await rejects(as("agent", "select public.assure_pa_transition($1,'request_info',null,'')", [id]), /what information/);
  await as("agent", "select public.assure_pa_transition($1,'vm_approve','Capability fine',null)", [id]);
  await rejects(as("proc", "select public.assure_pa_transition($1,'send_terms',null,null,'{}')", [id]), /during procurement review/);
  await as("proc", "select public.assure_pa_transition($1,'start_procurement',null,null)", [id]);
  await rejects(as("proc", "select public.assure_pa_transition($1,'send_terms',null,null,'{}')", [id]), /payment terms and tier/);
  await as("proc", `select public.assure_pa_transition($1,'send_terms','Standard','Proposed terms attached','{"nti":5,"payment_terms":"net_60","tier":"preferred"}')`, [id]);
  await as("proc", "select public.assure_pa_transition($1,'confirm_onboarding','Agreed',null)", [id]);
  const r = await one("plain", "select status, workflow_stage from public.vendor_pre_assessments where id = $1", [id]);
  assert.deepEqual([r.status, r.workflow_stage], ["onboarded", "complete"]);
  const rv = await one("plain", "select nti_agreed, payment_terms_agreed, tier_agreed, vm_reviewed_by from public.vendor_pre_assessment_reviews where assessment_id = $1", [id]);
  assert.deepEqual([Number(rv.nti_agreed), rv.payment_terms_agreed, rv.tier_agreed, rv.vm_reviewed_by], [5, "net_60", "preferred", ids.agent]);
  assert.equal((await one("plain", "select tier from public.suppliers where id = $1", [S1])).tier, "preferred");
  // vendors see their questionnaire and status, never the review table
  assert.equal((await as("vendor", "select * from public.vendor_pre_assessments")).rows.length, 1);
  assert.equal((await as("vendor", "select * from public.vendor_pre_assessment_reviews")).rows.length, 0);
  assert.equal((await as("other", "select * from public.vendor_pre_assessments")).rows.length, 0);
  const audit = await as("plain", "select to_status from public.assure_activity where entity = 'pre_assessment' and entity_id = $1 order by id", [id]);
  assert.deepEqual(audit.rows.map((x) => x.to_status), ["submitted", "under_review", "vm_approved", "procurement_review", "negotiation", "onboarded"]);
});

test("pre-assessment: the vendor-manager approver can't also confirm onboarding", async () => {
  const { id } = await one("vendor", "select public.assure_pa_save(null,'Test Print Ltd',null,'v1@example.com',null,null,'{}') as id");
  await as("vendor", "select public.assure_pa_submit($1)", [id]);
  await as("admin", "select public.assure_pa_transition($1,'vm_approve',null,null)", [id]);
  await as("admin", "select public.assure_pa_transition($1,'start_procurement',null,null)", [id]);
  await as("admin", `select public.assure_pa_transition($1,'send_terms',null,null,'{"payment_terms":"net_30","tier":"approved"}')`, [id]);
  await rejects(as("admin", "select public.assure_pa_transition($1,'confirm_onboarding',null,null)", [id]), /someone else must confirm/);
  await rejects(as("proc", "select public.assure_pa_transition($1,'reject',null,'')", [id]), /reason/);
  await as("proc", "select public.assure_pa_transition($1,'reject',null,'Terms not accepted')", [id]);
});

/* ---------------- 4. Quality ---------------- */

test("inspections: inspector is the signed-in user; results change only through the function", async () => {
  const q = await one("plain", "insert into public.quality_inspections (supplier_id, product_name, defect_count, result, inspector, internal_notes) values ($1,'Shelf wobbler',3,'pending',$2,'internal') returning id, inspector, inspection_ref", [S1, ids.admin]);
  assert.equal(q.inspector, ids.plain);
  assert.match(q.inspection_ref, /^QI-\d{4}-\d{5}$/);
  await rejects(as("plain", "update public.quality_inspections set result = 'pass' where id = $1", [q.id]), /permission denied/);
  await as("plain", "select public.assure_set_inspection_result($1,'fail',null)", [q.id]);
  await rejects(as("plain", "select public.assure_set_inspection_result($1,'pass','')", [q.id]), /Say why/);
  const r = await one("plain", "select result, corrective_action_required from public.quality_inspections where id = $1", [q.id]);
  assert.deepEqual([r.result, r.corrective_action_required], ["fail", true]);
  const vv = await as("vendor", "select * from public.vendor_quality_inspections");
  assert.equal(vv.rows.length, 1);
  assert.equal("internal_notes" in vv.rows[0], false);
  await rejects(as("vendor", "insert into public.quality_inspections (supplier_id) values ($1)", [S1]), /row-level security/);
});

test("NCRs: vendor acknowledges and responds; corrective actions verified by someone else; close needs all verified", async () => {
  const n = await one("agent", "insert into public.ncrs (supplier_id, category_id, severity, title, status, internal_notes) values ($1,$2,'critical','Colour out of spec','closed','watch them') returning id, status, due_date, ncr_ref", [S1, NCRCAT]);
  assert.equal(n.status, "open");
  assert.match(n.ncr_ref, /^NCR-/);
  await rejects(as("agent", "insert into public.ncrs (supplier_id, category_id, title) values ($1,$2,'x')", [S1, ISO]), /non-conformance categories/);
  await rejects(as("other", "select public.assure_ncr_vendor_respond($1,'acknowledge',null,null)", [n.id]), /not for your company/);
  await as("vendor", "select public.assure_ncr_vendor_respond($1,'acknowledge',null,null)", [n.id]);
  await rejects(as("vendor", "select public.assure_ncr_vendor_respond($1,'respond','',null)", [n.id]), /response/);
  await as("vendor", "select public.assure_ncr_vendor_respond($1,'respond','Ink batch issue','Supplier changed ink')", [n.id]);
  const vn = await one("vendor", "select * from public.vendor_ncrs where id = $1", [n.id]);
  assert.equal(vn.acknowledgement_status, "responded");
  assert.equal("internal_notes" in vn, false);
  const { id: ca } = await one("agent", "select public.assure_ca_add($1,'Recalibrate press',null,null) as id", [n.id]);
  await rejects(as("agent", "select public.assure_ncr_close($1,'closed','Done')", [n.id]), /Verify every corrective action/);
  await rejects(as("vendor", "select public.assure_ca_set_status($1,'verified',null)", [ca]), /Only adm Indicia staff/);
  await as("vendor", "select public.assure_ca_set_status($1,'done','Calibrated 3 Oct')", [ca]);
  await as("agent", "select public.assure_ca_set_status($1,'verified',null)", [ca]);
  await rejects(as("vendor", "select public.assure_ncr_close($1,'closed','x')", [n.id]), /Only adm Indicia staff/);
  await as("agent", "select public.assure_ncr_close($1,'closed','Verified on re-inspection')", [n.id]);
  assert.equal((await one("plain", "select status from public.ncrs where id = $1", [n.id])).status, "closed");
  // the person who completes an action can't verify it
  const n2 = await one("agent", "insert into public.ncrs (supplier_id, category_id, title) values ($1,$2,'Late') returning id", [S1, NCRCAT]);
  const { id: ca2 } = await one("agent", "select public.assure_ca_add($1,'Internal follow-up','internal',null) as id", [n2.id]);
  await rejects(as("vendor", "select public.assure_ca_set_status($1,'done',null)", [ca2]), /adm Indicia completes/);
  await as("agent", "select public.assure_ca_set_status($1,'done',null)", [ca2]);
  await rejects(as("agent", "select public.assure_ca_set_status($1,'verified',null)", [ca2]), /someone else/);
});

/* ---------------- 5. Performance ---------------- */

test("performance: scores via the audited function; composite computed; vendors see no notes", async () => {
  await rejects(as("plain", `select public.assure_record_performance($1,'2026-Q3','{"otif":60}')`, [S1]), /Only vendor managers/);
  await rejects(as("agent", `select public.assure_record_performance($1,'Q3','{}')`, [S1]), /Period/);
  await rejects(as("agent", "insert into public.performance_records (supplier_id, period) values ($1,'2026-Q1')", [S1]), /permission denied/);
  await as("agent", `select public.assure_record_performance($1,'2026-Q2','{"cost":80,"otif":90,"quality":85,"compliance":90,"sustainability":75,"ncr_count":0}')`, [S1]);
  await as("agent", `select public.assure_record_performance($1,'2026-Q3','{"cost":70,"otif":60,"quality":80,"compliance":null,"sustainability":70,"ncr_count":3,"defect_rate":5.5,"notes":"internal"}')`, [S1]);
  const r = await one("plain", "select composite_score from public.performance_records where supplier_id = $1 and period = '2026-Q3'", [S1]);
  assert.equal(Number(r.composite_score), 70);
  const vv = await as("vendor", "select * from public.vendor_performance_records order by period");
  assert.equal(vv.rows.length, 2);
  assert.equal("internal_notes" in vv.rows[0], false);
  assert.equal((await as("vendor", "select * from public.performance_records")).rows.length, 0);
});

test("issues feed: generated on the server from thresholds, idempotent, vendor responds, staff resolve", async () => {
  await rejects(as("vendor", "select public.assure_generate_issues($1)", [S1]), /Only adm Indicia staff/);
  await rejects(as("vendor", "insert into public.performance_issues (supplier_id, issue_type, source_key, title) values ($1,'ncr','x','x')", [S1]), /permission denied/);
  const n = await one("plain", "select public.assure_generate_issues($1) as n", [S1]);
  const issues = await as("plain", "select issue_type, severity from public.performance_issues where supplier_id = $1 order by issue_type", [S1]);
  const types = Object.fromEntries(issues.rows.map((x) => [x.issue_type, x.severity]));
  assert.equal(types.ncr, "high");          // 3 NCRs
  assert.equal(types.defect_rate, "high");  // 5.5%
  assert.equal(types.otif_miss, "high");    // 60
  assert.equal(n.n, issues.rows.length);
  assert.equal((await one("plain", "select public.assure_generate_issues($1) as n", [S1])).n, 0);
  const i = await one("vendor", "select id from public.vendor_performance_issues where issue_type = 'otif_miss'");
  await as("vendor", "select public.assure_issue_vendor_respond($1,'respond','Port congestion','Book earlier vessel',current_date + 30)", [i.id]);
  await rejects(as("vendor", "select public.assure_issue_resolve($1,'done')", [i.id]), /Only adm Indicia staff/);
  await as("lead", "select public.assure_issue_resolve($1,'Q4 OTIF back to 92')", [i.id]);
  assert.equal((await one("vendor", "select acknowledgement_status from public.vendor_performance_issues where id = $1", [i.id])).acknowledgement_status, "resolved");
});

/* ---------------- 6. Contracts ---------------- */

test("contracts: status only through functions; signing order enforced; finalisation is atomic", async () => {
  const c = await one("plain", "insert into public.contracts (supplier_id, title, status, internal_notes, end_date) values ($1,'MSA 2026','counter_signed','note', current_date + 45) returning id, status, contract_ref", [S1]);
  assert.equal(c.status, "draft");
  assert.match(c.contract_ref, /^CT-/);
  await rejects(as("plain", "select public.assure_contract_action($1,'send',null)", [c.id]), /at least one signer/);
  await as("plain", "insert into public.contract_parties (contract_id, name, email, role, signing_order, status) values ($1,'Wei Chen','v1@example.com','signer',1,'signed'), ($1,'Ada Admin','admin@adm-indicia.com','signer',2,'pending')", [c.id]);
  assert.equal((await as("vendor", "select * from public.vendor_contracts")).rows.length, 0); // drafts are hidden
  await as("plain", "select public.assure_contract_action($1,'send',null)", [c.id]);
  await rejects(as("plain", "update public.contracts set title = 'Changed' where id = $1", [c.id]), /amend it/);
  await rejects(as("plain", "insert into public.contract_parties (contract_id, name, email) values ($1,'X','x@example.com')", [c.id]), /while the contract is a draft/);
  const parties = await as("plain", "select id, signing_order, status from public.contract_parties where contract_id = $1 order by signing_order", [c.id]);
  assert.deepEqual(parties.rows.map((p) => p.status), ["sent", "sent"]);
  await rejects(as("plain", "select public.assure_contract_sign($1,'DocuSign 123')", [parties.rows[1].id]), /Earlier signers/);
  await rejects(as("plain", "select public.assure_contract_sign($1,'')", [parties.rows[0].id]), /evidence/);
  await rejects(as("vendor", "select public.assure_contract_sign($1,'x')", [parties.rows[0].id]), /Only adm Indicia staff/);
  assert.equal((await one("plain", "select public.assure_contract_sign($1,'DocuSign env 1') as s", [parties.rows[0].id])).s, "signed");
  assert.equal((await one("plain", "select status from public.contracts where id = $1", [c.id])).status, "sent");
  assert.equal((await one("plain", "select public.assure_contract_sign($1,'DocuSign env 1') as s", [parties.rows[1].id])).s, "counter_signed");
  const f = await one("plain", "select status, finalized_at from public.contracts where id = $1", [c.id]);
  assert.equal(f.status, "counter_signed");
  assert.ok(f.finalized_at);
  await rejects(as("plain", "select public.assure_contract_action($1,'cancel','x')", [c.id]), /can't be cancelled/);
  const vc = await as("vendor", "select * from public.vendor_contracts");
  assert.equal(vc.rows.length, 1);
  assert.equal("internal_notes" in vc.rows[0], false);
  assert.equal((await as("other", "select * from public.vendor_contracts")).rows.length, 0);
  // amend: new draft version, original marked amended, parties copied
  const { id: amended } = await one("plain", "select public.assure_contract_action($1,'amend','Price change') as id", [c.id]);
  const a = await one("plain", "select version, status, parent_contract_id, document_type from public.contracts where id = $1", [amended]);
  assert.deepEqual([a.version, a.status, a.parent_contract_id, a.document_type], [2, "draft", c.id, "amendment"]);
  assert.equal((await one("plain", "select status from public.contracts where id = $1", [c.id])).status, "amended");
  assert.equal((await one("plain", "select count(*)::int n from public.contract_parties where contract_id = $1 and status = 'pending'", [amended])).n, 2);
  await rejects(as("plain", "insert into public.contract_activity (contract_id, event_type, description, actor) values ($1,'signed','fake',auth.uid())", [c.id]), /row-level security/);
});

test("contract negotiation action comes from the matrix", async () => {
  const c = await one("plain", "insert into public.contracts (supplier_id, title) values ($1,'NDA') returning id", [S1]);
  const r = await one("plain", "insert into public.contract_negotiations (contract_id, clause, complexity, risk) values ($1,'Liability cap','high','low') returning action", [c.id]);
  assert.equal(r.action, "use_query_matrix_conditions");
});

/* ---------------- 7. Business reviews ---------------- */

test("business reviews: vendors only see shared ones, never outcomes; approval by the Procurement head only", async () => {
  const r = await one("lead", `insert into public.business_reviews (supplier_id, title, meeting_date, agenda_items, key_outcomes, discussion_notes, overall_sentiment, outcomes_approval_status)
    values ($1,'Q3 QBR',current_date + 7,'{OTIF,Quality}','Agree OTIF plan','frank chat','needs_attention','approved') returning id, outcomes_approval_status`, [S1]);
  assert.equal(r.outcomes_approval_status, "pending");
  assert.equal((await as("vendor", "select * from public.vendor_business_reviews")).rows.length, 0);
  assert.equal((await as("vendor", "select * from public.business_reviews")).rows.length, 0);
  await rejects(as("vendor", "select public.assure_review_vendor_respond($1,'accepted',null,null)", [r.id]), /not shared/);
  await as("lead", "update public.business_reviews set shared_with_vendor = true, outcomes_approval_status = 'approved' where id = $1", [r.id]);
  assert.equal((await one("plain", "select outcomes_approval_status from public.business_reviews where id = $1", [r.id])).outcomes_approval_status, "pending");
  const v = await as("vendor", "select * from public.vendor_business_reviews");
  assert.equal(v.rows.length, 1);
  for (const k of ["key_outcomes", "discussion_notes", "overall_sentiment", "outcomes_approval_status"]) assert.equal(k in v.rows[0], false, k);
  assert.equal((await as("other", "select * from public.vendor_business_reviews")).rows.length, 0);
  await as("vendor", "select public.assure_review_vendor_respond($1,'suggested_reschedule',current_date + 10,'Travel clash')", [r.id]);
  await rejects(as("agent", "select public.assure_review_approve_outcomes($1,true,null)", [r.id]), /Procurement head/);
  await rejects(as("plain", "select public.assure_review_approve_outcomes($1,true,null)", [r.id]), /Procurement head/);
  await as("head", "select public.assure_review_approve_outcomes($1,true,null)", [r.id]);
  assert.equal((await one("plain", "select outcomes_approval_status from public.business_reviews where id = $1", [r.id])).outcomes_approval_status, "approved");
  // editing the outcomes sends them back for approval
  await as("lead", "update public.business_reviews set key_outcomes = 'Agree OTIF plan + audit' where id = $1", [r.id]);
  assert.equal((await one("plain", "select outcomes_approval_status from public.business_reviews where id = $1", [r.id])).outcomes_approval_status, "pending");
  // the creator can't approve their own review's outcomes
  const own = await one("head", "insert into public.business_reviews (supplier_id, title, meeting_date, agenda_items, key_outcomes) values ($1,'Check-in',current_date,'{x}','y') returning id", [S1]);
  await rejects(as("head", "select public.assure_review_approve_outcomes($1,true,null)", [own.id]), /someone else/);
});

test("UI helpers run as the caller: RLS and guards still apply", async () => {
  const p = { supplier_id: S2, title: "Kick-off", meeting_date: "2026-11-02", agenda_items: ["Intro", " "], internal_attendees: ["a@adm-indicia.com"], key_outcomes: "x" };
  const { id } = await one("lead", "select public.assure_review_save(null, $1) as id", [JSON.stringify(p)]);
  const r = await one("plain", "select agenda_items, outcomes_approval_status from public.business_reviews where id = $1", [id]);
  assert.deepEqual([r.agenda_items, r.outcomes_approval_status], [["Intro"], "pending"]);
  await rejects(as("lead", "select public.assure_review_save(null, $1)", [JSON.stringify({ ...p, agenda_items: [] })]), /agenda item/);
  await rejects(as("vendor", "select public.assure_review_save(null, $1)", [JSON.stringify({ ...p, supplier_id: S1 })]), /row-level security/);
  const q = await one("plain", "select public.assure_log_inspection($1) as id", [JSON.stringify({ supplier_id: S2, defects_found: ["Scuff"], result: "fail" })]);
  assert.deepEqual((await one("plain", "select defects_found, inspector from public.quality_inspections where id = $1", [q.id])), { defects_found: ["Scuff"], inspector: ids.plain });
  await rejects(as("plain", "select public.assure_set_supplier_status_json($1,'suspended','x')", [JSON.stringify([S2])]), /Only an SRT lead/);
  assert.equal((await one("lead", "select public.assure_set_supplier_status_json($1,'active','Approved') as n", [JSON.stringify([S2])])).n, 1);
});

/* ---------------- 8. Tasks, surveys, workflows, messages, training ---------------- */

test("action plan tasks: open -> in_progress -> completed -> verified; verify is staff-only and by someone else", async () => {
  const k = await one("agent", "insert into public.action_plan_tasks (supplier_id, title, status) values ($1,'Fix packaging','verified') returning id, status", [S1]);
  assert.equal(k.status, "open");
  await as("vendor", "update public.action_plan_tasks set status = 'verified' where id = $1", [k.id]); // RLS: no rows
  assert.equal((await one("plain", "select status from public.action_plan_tasks where id = $1", [k.id])).status, "open");
  await rejects(as("other", "select public.assure_task_set_status($1,'in_progress',null)", [k.id]), /not for your company/);
  await as("vendor", "select public.assure_task_set_status($1,'in_progress','Started')", [k.id]);
  await as("vendor", "select public.assure_task_set_status($1,'completed','Done')", [k.id]);
  await rejects(as("vendor", "select public.assure_task_set_status($1,'verified',null)", [k.id]), /Only adm Indicia staff/);
  await as("agent", "select public.assure_task_set_status($1,'verified',null)", [k.id]);
  const k2 = await one("agent", "insert into public.action_plan_tasks (supplier_id, title) values ($1,'Internal') returning id", [S1]);
  await as("agent", "select public.assure_task_set_status($1,'completed',null)", [k2.id]);
  await rejects(as("agent", "select public.assure_task_set_status($1,'verified',null)", [k2.id]), /someone else/);
  assert.ok((await as("vendor", "select * from public.action_plan_tasks")).rows.length >= 2);
  assert.equal((await as("other", "select * from public.action_plan_tasks")).rows.length, 0);
});

test("surveys: questions snapshot at launch; only the vendor answers; staff review", async () => {
  const tp = await one("plain", `insert into public.survey_templates (name, questions) values ('ESG check',
    '[{"id":"q1","text":"Do you have an ESG policy?","type":"yes_no","required":true},{"id":"q2","text":"Rate your recycling","type":"rating","required":false}]') returning id, version`);
  assert.equal(tp.version, 1);
  await rejects(as("plain", `insert into public.survey_templates (name, questions) values ('Bad','[{"id":"a","text":"x","type":"essay"}]')`), /Unknown question type/);
  const { id } = await one("plain", "select public.assure_survey_launch($1,$2,current_date + 14) as id", [tp.id, S1]);
  await as("plain", `update public.survey_templates set questions = '[{"id":"q9","text":"Changed","type":"text"}]' where id = $1`, [tp.id]);
  assert.equal((await one("plain", "select version from public.survey_templates where id = $1", [tp.id])).version, 2);
  await rejects(as("plain", `select public.assure_survey_submit($1,'{"q1":"Yes"}',true)`, [id]), /Only the vendor/);
  await rejects(as("vendor", `select public.assure_survey_submit($1,'{}',true)`, [id]), /required question/);
  await rejects(as("vendor", `select public.assure_survey_submit($1,'{"q1":"Yes","q2":"9"}',true)`, [id]), /1 to 5/);
  await as("vendor", `select public.assure_survey_submit($1,'{"q1":"Yes","q2":"4"}',true)`, [id]);
  const v = await one("vendor", "select * from public.vendor_survey_responses where id = $1", [id]);
  assert.equal(v.questions[0].id, "q1");
  assert.equal("review_notes" in v, false);
  await rejects(as("vendor", "select public.assure_survey_review($1,'approve',null,null)", [id]), /Only adm Indicia staff/);
  await as("plain", "select public.assure_survey_review($1,'approve','Policy seen',null)", [id]);
  assert.equal((await one("plain", "select status from public.survey_responses where id = $1", [id])).status, "completed");
});

test("workflows: seeded presets; approver role checked; no approving two steps in a row", async () => {
  const tp = await one("plain", "select id from public.workflow_templates where name = 'Tier upgrade'");
  const { id } = await one("plain", "select public.assure_workflow_launch($1,$2,null) as id", [tp.id, S1]);
  const steps = await as("plain", "select idx, approver_role, status, due_date::text from public.workflow_steps where instance_id = $1 order by idx", [id]);
  assert.deepEqual(steps.rows.map((s) => s.status), ["in_progress", "pending", "pending"]);
  await rejects(as("proc", "select public.assure_workflow_act($1,'approve',null)", [id]), /vendor manager/);
  await as("agent", "select public.assure_workflow_act($1,'approve','Good scores')", [id]);
  await rejects(as("admin", "select public.assure_workflow_act($1,'reject','')", [id]), /Say why/);
  await as("proc", "select public.assure_workflow_act($1,'approve',null)", [id]);
  await rejects(as("proc", "select public.assure_workflow_act($1,'approve',null)", [id]), /needs a executive|executive/);
  await rejects(as("vendor", "select public.assure_workflow_act($1,'approve',null)", [id]), /Only adm Indicia staff/);
  assert.equal((await one("head", "select public.assure_workflow_act($1,'approve',null) as s", [id])).s, "completed");
  const { id: w2 } = await one("plain", "select public.assure_workflow_launch($1,$2,null) as id", [tp.id, S1]);
  await as("admin", "select public.assure_workflow_act($1,'approve',null)", [w2]);
  await rejects(as("admin", "select public.assure_workflow_act($1,'approve',null)", [w2]), /previous step/);
  await rejects(as("plain", "update public.workflow_instances set status = 'completed'"), /permission denied/);
  assert.equal((await as("vendor", "select * from public.workflow_instances")).rows.length, 0);
});

test("messages: sender comes from the session; vendors only in their own supplier's threads", async () => {
  const c = await one("plain", "insert into public.conversations (supplier_id, subject) values ($1,'Artwork query') returning id", [S1]);
  const m = await one("vendor", "insert into public.messages (conversation_id, body, sender, sender_side) values ($1,'Hello',$2,'internal') returning sender, sender_side", [c.id, ids.admin]);
  assert.deepEqual([m.sender, m.sender_side], [VENDOR, "supplier"]);
  await rejects(as("other", "insert into public.messages (conversation_id, body) values ($1,'Hi')", [c.id]), /row-level security/);
  assert.equal((await as("other", "select * from public.messages")).rows.length, 0);
  assert.equal((await as("vendor", "select * from public.messages")).rows.length, 1);
  await rejects(as("vendor", "insert into public.conversations (supplier_id, subject) values ($1,'x')", [S2]), /row-level security/);
  await as("plain", "select public.assure_mark_conversation_read($1)", [c.id]);
  assert.equal((await as("plain", "select * from public.message_reads")).rows.length, 1);
});

test("training: https links only; start before completing; waive is admin-only", async () => {
  await rejects(as("admin", "insert into public.training_modules (title, url) values ('Bad','javascript:alert(1)')"), /check constraint/);
  await rejects(as("plain", "insert into public.training_modules (title) values ('x')"), /row-level security/);
  const tm = await one("admin", "insert into public.training_modules (title, url, audience) values ('Using Assure+','https://example.com/v','internal') returning id", []);
  await rejects(as("plain", "select public.assure_training_assign($1,$2,null)", [tm.id, [ids.plain]]), /Only admins and SRT leads/);
  assert.equal((await one("lead", "select public.assure_training_assign($1,$2,current_date + 7) as n", [tm.id, [ids.plain, ids.agent]])).n, 2);
  assert.equal((await one("lead", "select public.assure_training_assign($1,$2,null) as n", [tm.id, [ids.plain]])).n, 0);
  const a = await one("plain", "select id from public.training_assignments where user_id = auth.uid()");
  await rejects(as("plain", "select public.assure_training_progress($1,'completed')", [a.id]), /Start the training/);
  await rejects(as("agent", "select public.assure_training_progress($1,'in_progress')", [a.id]), /your own/);
  await as("plain", "select public.assure_training_progress($1,'in_progress')", [a.id]);
  await as("plain", "select public.assure_training_progress($1,'completed')", [a.id]);
  await rejects(as("lead", "select public.assure_training_progress($1,'waived','x')", [a.id]), /Only admins/);
  assert.equal((await as("vendor", "select * from public.training_modules")).rows.length, 0); // internal-only module
});
