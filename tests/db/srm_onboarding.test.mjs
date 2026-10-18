// SRM supplier onboarding: the nine-stage standard (migrations 20261039000001-3).
// Stage progression and exit criteria, no RFI before triage, duplicate detection, documented gaps, risk gates, contract set,
// Finance approval, ID reconciliation, activation, fast-track (dual approval, scope, closure gate, Sourcing eligibility),
// segregation of duties, the status taxonomy, review cadence, the single CoC source and vendor row-level security.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const val = async (user, sql, params) => Object.values((await as(user, sql, params)).rows[0] ?? {})[0];

Object.assign(ids, {
  director: "00000000-0000-0000-0000-0000000000d1",
  finEmea: "00000000-0000-0000-0000-0000000000f2",
  finApac: "00000000-0000-0000-0000-0000000000f3",
  vendorA: "00000000-0000-0000-0000-0000000000e1",
  vendorB: "00000000-0000-0000-0000-0000000000e2",
});
for (const [id, email] of [[ids.director, "director@adm-indicia.com"], [ids.finEmea, "fin-emea@adm-indicia.com"], [ids.finApac, "fin-apac@adm-indicia.com"]]) {
  await asSuper("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}
await asSuper("update public.profiles set srt_role = 'director' where id = $1", [ids.director]);
await asSuper("update public.profiles set srt_role = 'finance' where id = any($1)", [[ids.finEmea, ids.finApac]]);
await as("admin", "select public.srm_set_role_scope($1, 'local_finance', 'EMEA', null, null, true)", [ids.finEmea]);
await as("admin", "select public.srm_set_role_scope($1, 'local_finance', null, 'China', null, true)", [ids.finApac]);

const gates = async (sup) => Object.fromEntries((await asSuper("select gate_key, status from public.supplier_gates where supplier_id = $1", [sup])).rows.map((r) => [r.gate_key, r.status]));
const supplierRow = (sup) => one("select * from public.suppliers where id = $1", [sup]);
const verify = (user, sup, gate, expiry = null) => as(user, "select public.update_supplier_gate($1, $2, 'verified', $3)", [sup, gate, expiry]);
const future = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const DD = ["rfi", "registration", "financial", "capability", "quality", "environment", "sustainability", "sanctions"];
const EXPIRES = new Set(["financial", "quality", "environment", "sustainability", "sanctions"]);

function request(overrides = {}) {
  return JSON.stringify({
    business_case: "Second finisher for seasonal graphics", supplier_type: "manufacturer", category: "Print", client: "Northbrew",
    market: "Germany", urgency: "standard", estimated_spend: 50000, proposed_name: "Fresh Print Werk", proposed_email: "info@freshprint.example",
    proposed_registration: "HRB 111222", proposed_vat: "DE 111 222 333", ...overrides,
  });
}
async function submitAndTriage(name, extra = {}, route = "standard") {
  const caseId = await val("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ proposed_name: name, duplicate_confirmed: true, ...extra })]);
  const sup = await val("head", "select public.onboarding_triage($1, 'approve', $2, 'tactical', 'ok')", [caseId, route]);
  return { caseId, sup };
}
async function completeDueDiligence(sup) {
  for (const g of DD) await verify("agent", sup, g, EXPIRES.has(g) ? future(300) : null);
}
async function completeRisk(sup) {
  await as("agent", "select public.onboarding_risk_submit($1, $2::jsonb)", [sup, JSON.stringify({ category_fit: "Fits print panel" })]);
  await as("head", "select public.onboarding_risk_decide($1, 'cm', true, null)", [sup]);
  await as("lead", "select public.onboarding_risk_decide($1, 'quality', true, null)", [sup]);
}
async function completeContracts(sup) {
  for (const g of ["nda", "coc", "msa"]) await verify("agent", sup, g);
}

// Existing supplier for the duplicate check.
const existing = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('EX-1','Alpha Print GmbH','Germany','EMEA','sales@alphaprint.example') returning id")).id;
await asSuper(`insert into public.supplier_profiles (supplier_id, uen_number, vat_number) values ($1, 'HRB 998877', 'DE 555 666 777')
  on conflict (supplier_id) do update set uen_number = excluded.uen_number, vat_number = excluded.vat_number`, [existing]);

test("stage model: nine stages, every gate belongs to one, a new supplier starts at stage 1 and blocked", async () => {
  const st = (await as("plain", "select stage_no, owner_label from public.onboarding_stages order by stage_no")).rows;
  assert.deepEqual(st.map((r) => r.stage_no), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal((await one("select count(*)::int n from public.gate_definitions where active and stage_key is null")).n, 0);
  assert.equal((await one("select count(*)::int n from public.gate_definitions where active")).n, 29);
  const s = (await as("plain", "insert into public.suppliers (name, market) values ('Direct Ltd', 'Germany') returning id")).rows[0].id;
  const row = await supplierRow(s);
  assert.deepEqual([row.onboarding_stage, row.onboarding_released, row.purchasing_blocked, row.onboarding_baseline], [1, false, true, "standard"]);
  // Users can't set the computed fields or pick the legacy baseline.
  await as("lead", "update public.suppliers set onboarding_baseline = 'legacy', onboarding_released = true, onboarding_stage = 9 where id = $1", [s]);
  const after = await supplierRow(s);
  assert.deepEqual([after.onboarding_baseline, after.onboarding_released, after.onboarding_stage], ["standard", false, 1]);
});

test("duplicate check: name, VAT/registration and email domain; requester must confirm or link the existing supplier", async () => {
  const m = await val("plain", "select public.onboarding_duplicate_check('Alpha Print Ltd', null, null, null)");
  assert.equal(m[0].supplier_id, existing);
  assert.ok(m[0].reasons.includes("Same name"));
  const byVat = await val("plain", "select public.onboarding_duplicate_check('Totally Different', 'DE555666777', null, null)");
  assert.ok(byVat[0].reasons.includes("Same VAT / tax number"));
  const byDomain = await val("plain", "select public.onboarding_duplicate_check('Other Name', null, null, 'buyer@alphaprint.example')");
  assert.ok(byDomain[0].reasons.includes("Same email domain"));
  const generic = await val("plain", "select public.onboarding_duplicate_check('Nobody Similar', null, null, 'x@gmail.com')");
  assert.equal(generic.length, 0, "free-mail domains are ignored");
  await rejects(as("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ proposed_name: "Alpha Print" })]), /Possible duplicate: Alpha Print GmbH/);
  const linked = await val("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ proposed_name: "Alpha Print", linked_supplier_id: existing })]);
  assert.equal((await one("select linked_supplier_id from public.onboarding_cases where id = $1", [linked])).linked_supplier_id, existing);
  // Triage closes it as a duplicate.
  await as("head", "select public.onboarding_triage($1, 'duplicate', null, null, 'Same company', null)", [linked]);
  const c = await one("select status, ticket_id from public.onboarding_cases where id = $1", [linked]);
  assert.equal(c.status, "duplicate");
  assert.equal((await one("select resolution from public.srt_tickets where id = $1", [c.ticket_id])).resolution, "duplicate");
});

test("request validation: complete request; urgent needs reason, client need and date", async () => {
  await rejects(as("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ business_case: "" })]), /business need/);
  await rejects(as("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ supplier_type: "" })]), /supplier type/);
  await rejects(as("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ estimated_spend: "" })]), /estimated annual spend/);
  await rejects(as("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ proposed_name: "Urgent Co", urgency: "urgent" })]), /urgency reason/);
  await rejects(as("vendorA", "select public.onboarding_request_submit($1::jsonb)", [request()]), /Only adm Indicia staff/);
});

test("stage 3: no RFI before triage; triage by Procurement only and never the requester", async () => {
  const caseId = await val("plain", "select public.onboarding_request_submit($1::jsonb)", [request({ proposed_name: "Nordwerk Displays", duplicate_confirmed: true })]);
  const ticket = (await one("select ticket_id from public.onboarding_cases where id = $1", [caseId])).ticket_id;
  await rejects(as("agent", "select public.send_vendor_rfi($1, 'a@nordwerk.example', null, 'http://x')", [ticket]), /No information request outside the onboarding route/);
  await rejects(as("agent", "select public.onboarding_triage($1, 'approve', 'standard', 'tactical', null)", [caseId]), /Only Procurement/);
  await asSuper("update public.onboarding_cases set requested_by = $1 where id = $2", [ids.head, caseId]);
  await rejects(as("head", "select public.onboarding_triage($1, 'approve', 'standard', 'tactical', null)", [caseId]), /someone else in Procurement/);
  await asSuper("update public.onboarding_cases set requested_by = $1 where id = $2", [ids.plain, caseId]);
  await rejects(as("head", "select public.onboarding_triage($1, 'approve', 'exception', 'tactical', null)", [caseId]), /exception route needs an urgent request/);
  const sup = await val("head", "select public.onboarding_triage($1, 'approve', 'standard', 'incumbent', 'Need confirmed')", [caseId]);
  const g = await gates(sup);
  assert.deepEqual([g.request, g.intake, g.triage], ["verified", "verified", "verified"]);
  assert.equal(g.psa, "not_required", "global minimum evidence set: PSA only when a client or type set requires it");
  const row = await supplierRow(sup);
  assert.equal(row.onboarding_stage, 4);
  assert.match(row.supplier_code, /^SRM-\d{5}$/);
  // The RFI can now go out.
  const sent = await val("agent", "select public.send_vendor_rfi($1, 'a@nordwerk.example', null, 'http://x')", [ticket]);
  assert.equal(sent.supplier_id, sup);
  // Workflow gates can't be set by hand.
  await rejects(verify("admin", sup, "finance_approval"), /recorded by the onboarding workflow/);
});

test("evidence sets by client and supplier type (governed library)", async () => {
  const { sup } = await submitAndTriage("Brightlane Services Co", { supplier_type: "service_provider", client: "Northbrew" });
  const g = await gates(sup);
  assert.equal(g.environment, "not_required", "services set");
  assert.equal(g.id_stocktool, "not_required");
  const b = await submitAndTriage("Bright Client Print", { client: "Brightlane", proposed_registration: "HRB 4545", proposed_vat: "DE 454 545 454" });
  assert.equal((await gates(b.sup)).psa, "missing", "Brightlane requires a PSA");
});

let main; let mainCase;
test("stage 4: a documented gap needs a second person; then stage 4 is complete", async () => {
  ({ sup: main, caseId: mainCase } = await submitAndTriage("Main Street Print", { proposed_registration: "HRB 777000", proposed_vat: "DE 777 000 111" }));
  for (const g of DD.filter((x) => x !== "financial")) await verify("agent", main, g, EXPIRES.has(g) ? future(300) : null);
  assert.equal((await supplierRow(main)).onboarding_stage, 4);
  await rejects(as("agent", "select public.onboarding_gap_raise($1, 'registration', 'x', $2, 'internal', $3)", [main, ids.agent, future(20)]), /Only due-diligence evidence/);
  await rejects(as("agent", "select public.onboarding_gap_raise($1, 'financial', 'x', $2, 'internal', $3)", [main, ids.agent, future(-1)]), /due date in the future/);
  const gap = await val("agent", "select public.onboarding_gap_raise($1, 'financial', 'First trading year', $2, 'internal', $3)", [main, ids.agent, future(30)]);
  assert.equal((await supplierRow(main)).onboarding_stage, 4, "a proposed gap is not an exit");
  await rejects(as("agent", "select public.onboarding_gap_decide($1, true, null)", [gap]), /Only an SRT lead or Procurement/);
  await asSuper("update public.profiles set srt_role = 'lead' where id = $1", [ids.agent]);
  await rejects(as("agent", "select public.onboarding_gap_decide($1, true, null)", [gap]), /a second person must approve/);
  await asSuper("update public.profiles set srt_role = 'agent' where id = $1", [ids.agent]);
  await as("lead", "select public.onboarding_gap_decide($1, true, 'Credit check clean')", [gap]);
  assert.equal((await supplierRow(main)).onboarding_stage, 5, "approved documented gap is a valid exit");
  // Gap past its due date stops counting.
  await asSuper("update public.onboarding_gaps set due_date = current_date - 1 where id = $1", [gap]);
  assert.equal((await supplierRow(main)).onboarding_stage, 4);
  await asSuper("update public.onboarding_gaps set due_date = current_date + 30 where id = $1", [gap]);
  assert.equal((await supplierRow(main)).onboarding_stage, 5);
});

test("stage 5: risk gate rules decide CM and Quality; submitter and requester never approve", async () => {
  const early = await submitAndTriage("Early Print", { proposed_registration: "HRB 1", proposed_vat: "DE 101 101 101" });
  await rejects(as("agent", "select public.onboarding_risk_submit($1, '{\"category_fit\":\"x\"}'::jsonb)", [early.sup]), /comes after stage 4/);
  await rejects(as("agent", "select public.onboarding_risk_submit($1, '{}'::jsonb)", [main]), /category fit/);
  assert.equal(await val("agent", "select public.onboarding_risk_submit($1, '{\"category_fit\":\"Fits\"}'::jsonb)", [main]), "submitted");
  const r = await one("select needs_cm, needs_quality, rules_applied from public.onboarding_risk_reviews where supplier_id = $1", [main]);
  assert.deepEqual([r.needs_cm, r.needs_quality, r.rules_applied], [true, true, ["RR-PHYSICAL"]]);
  await rejects(as("finance", "select public.onboarding_risk_decide($1, 'cm', true, null)", [main]), /Only a Category Manager/);
  await rejects(as("plain", "select public.onboarding_risk_decide($1, 'quality', true, null)", [main]), /Only Quality/);
  await asSuper("update public.onboarding_risk_reviews set submitted_by = $1 where supplier_id = $2", [ids.head, main]);
  await rejects(as("head", "select public.onboarding_risk_decide($1, 'cm', true, null)", [main]), /You submitted this review/);
  await asSuper("update public.onboarding_risk_reviews set submitted_by = $1 where supplier_id = $2", [ids.agent, main]);
  assert.equal(await val("head", "select public.onboarding_risk_decide($1, 'cm', true, 'Fits the panel')", [main]), "submitted");
  assert.equal((await gates(main)).risk_review, "requested");
  assert.equal(await val("lead", "select public.onboarding_risk_decide($1, 'quality', true, null)", [main]), "approved");
  assert.equal((await gates(main)).risk_review, "verified");
  assert.equal((await supplierRow(main)).onboarding_stage, 6);
});

test("stage 6: the contract set from the contracts register (signed and stored verifies the gate)", async () => {
  await asSuper("select set_config('assure.system_write', 'on', false)");
  const nda = (await one("insert into public.contracts (supplier_id, title, document_type, status) values ($1, 'NDA', 'nda', 'counter_signed') returning id, onboarding_doc", [main]));
  assert.equal(nda.onboarding_doc, "nda", "NDAs are tagged automatically");
  const coc = (await one("insert into public.contracts (supplier_id, title, status, onboarding_doc, document_path) values ($1, 'Code of Conduct', 'counter_signed', 'coc', 'contracts/coc.pdf') returning id", [main])).id;
  await asSuper("select set_config('assure.system_write', 'off', false)");
  let g = await gates(main);
  assert.equal(g.nda, "received", "signed but no stored copy");
  assert.equal(g.coc, "verified");
  await asSuper("select set_config('assure.system_write', 'on', false)");
  await asSuper("update public.contracts set document_path = 'contracts/nda.pdf' where id = $1", [nda.id]);
  await asSuper("select set_config('assure.system_write', 'off', false)");
  g = await gates(main);
  assert.equal(g.nda, "verified");
  assert.equal((await supplierRow(main)).onboarding_stage, 6, "MSA still open");
  const msa = (await one("insert into public.contracts (supplier_id, title, document_path) values ($1, 'MSA', 'contracts/msa.pdf') returning id", [main])).id;
  await as("agent", "select public.onboarding_contract_link($1, 'msa')", [msa]);
  await asSuper("select set_config('assure.system_write', 'on', false)");
  await asSuper("update public.contracts set status = 'counter_signed' where id = $1", [msa]);
  await asSuper("select set_config('assure.system_write', 'off', false)");
  assert.equal((await gates(main)).msa, "verified");
  assert.equal((await supplierRow(main)).onboarding_stage, 7);
  void coc;
});

test("stage 7: Local Finance for the supplier's market approves, after the bank details are verified", async () => {
  const early = await submitAndTriage("Too Early Print", { proposed_registration: "HRB 2", proposed_vat: "DE 202 202 202" });
  await rejects(as("finEmea", "select public.onboarding_finance_decide($1, true, null)", [early.sup]), /comes after stage 6/);
  await rejects(as("finance", "select public.onboarding_finance_decide($1, true, null)", [main]), /Only Local Finance for Germany/);
  await rejects(as("finApac", "select public.onboarding_finance_decide($1, true, null)", [main]), /Only Local Finance for Germany/);
  await rejects(as("finEmea", "select public.onboarding_finance_decide($1, true, null)", [main]), /Verify the bank details first/);
  await verify("finance", main, "bank");
  await rejects(as("finEmea", "select public.onboarding_finance_decide($1, false, '')", [main]), /Say what Finance needs/);
  await as("finEmea", "select public.onboarding_finance_decide($1, true, 'VAT checked')", [main]);
  assert.equal((await gates(main)).finance_approval, "verified");
  assert.equal((await supplierRow(main)).onboarding_stage, 8);
});

test("stage 8: system IDs are recorded and reconciled (name and VAT match); panels allocated; outbox event", async () => {
  await rejects(as("plain", "select public.onboarding_record_system_id($1, 'erp', 'V-1', 'Main Street Print', null)", [main]), /Only SRT or Finance/);
  await as("agent", "select public.onboarding_record_system_id($1, 'stocktool', 'ST-1', 'Main Street Print', 'DE777000111')", [main]);
  await as("agent", "select public.onboarding_record_system_id($1, 'erp', 'V-1', 'Main Street Printing', null)", [main]);
  await rejects(as("agent", "select public.onboarding_reconcile_ids($1)", [main]), /NAV \/ ERP: name "Main Street Printing" does not match Main Street Print; Sourcing Hub: no ID recorded/);
  await as("agent", "select public.onboarding_record_system_id($1, 'erp', 'V-1', 'Main Street Print GmbH', 'DE 777 000 111')", [main]);
  await as("agent", "select public.onboarding_record_system_id($1, 'sourcing_hub', 'SH-1', 'Main Street Print', null)", [main]);
  const other = (await one("insert into public.suppliers (name) values ('Someone Else') returning id")).id;
  await asSuper("insert into public.supplier_system_ids (supplier_id, system, external_id) values ($1, 'erp', 'V-99')", [other]);
  await rejects(as("agent", "select public.onboarding_record_system_id($1, 'erp', 'v-99', 'Main Street Print', null)", [main]), /already used by another supplier/);
  const r = await val("agent", "select public.onboarding_reconcile_ids($1)", [main]);
  assert.deepEqual(r.ids, { stocktool: "ST-1", erp: "V-1", sourcing_hub: "SH-1" });
  const g = await gates(main);
  assert.deepEqual([g.id_stocktool, g.id_erp, g.id_hub, g.setup], ["verified", "verified", "verified", "verified"]);
  assert.ok((await supplierRow(main)).ids_synced_at);
  assert.equal((await one("select count(*)::int n from public.integration_outbox where event = 'srm.onboarding.ids_reconciled' and aggregate_id = $1", [main])).n, 1);
  await rejects(as("agent", "select public.onboarding_allocate_panels($1, array['EMEA print'])", [main]), /Only Procurement or a Category Manager/);
  await as("head", "select public.onboarding_allocate_panels($1, array['EMEA print', ' '])", [main]);
  assert.equal((await gates(main)).panels, "verified");
  assert.equal((await supplierRow(main)).onboarding_stage, 9);
});

test("stage 9: activation pack; the triage approver can't release; release unblocks purchasing", async () => {
  const pack = { owner: ids.plain, welcome_pack_sent: true, training: "assigned", evidence_location: "SRM evidence store", expiry_confirmed: true, review_cadence: "annual" };
  await rejects(as("agent", "select public.onboarding_activate($1, $2::jsonb)", [main, JSON.stringify(pack)]), /Only Procurement can release/);
  await rejects(as("head", "select public.onboarding_activate($1, $2::jsonb)", [main, JSON.stringify(pack)]), /approved this supplier at triage/);
  await rejects(as("director", "select public.onboarding_activate($1, $2::jsonb)", [main, JSON.stringify({ ...pack, welcome_pack_sent: false })]), /welcome pack/);
  await rejects(as("director", "select public.onboarding_activate($1, $2::jsonb)", [main, JSON.stringify({ ...pack, evidence_location: "" })]), /where the evidence is kept/);
  assert.equal((await supplierRow(main)).purchasing_blocked, true);
  await as("director", "select public.onboarding_activate($1, $2::jsonb)", [main, JSON.stringify(pack)]);
  const s = await supplierRow(main);
  assert.deepEqual([s.onboarding_released, s.purchasing_blocked, s.status, s.onboarding_state, s.procurement_owner], [true, false, "active", "approved", ids.plain]);
  assert.ok(s.next_review_due);
  const c = await one("select status, requested_by, triaged_by, activated_by from public.onboarding_cases where id = $1", [mainCase]);
  assert.deepEqual([c.status, c.requested_by, c.triaged_by, c.activated_by], ["released", ids.plain, ids.head, ids.director]);
  assert.equal(await val("plain", "select public.supplier_is_eligible($1)", [main]), true, "visible to Sourcing");
});

test("segregation: the database refuses self-triage, triage approver activating, and approving your own request", async () => {
  await rejects(asSuper("update public.onboarding_cases set triaged_by = requested_by where id = $1", [mainCase]), /onboarding_cases_sod_triage/);
  await rejects(asSuper("update public.onboarding_cases set activated_by = triaged_by where id = $1", [mainCase]), /onboarding_cases_sod_activate/);
  await rejects(asSuper("update public.onboarding_gaps set decided_by = raised_by"), /onboarding_gaps_second_person/);
  const seg = await val("lead", "select public.srm_onboarding_dashboard()");
  assert.deepEqual(seg.segregation, []);
});

let ft; let ftCase; let job; let job2;
test("fast-track: urgency, minimum pack, restricted scope, two named approvals", async () => {
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const client = (await one("insert into public.sourcing_clients (code, name, min_quotes_required) values ('FTC','FT Client',1) returning id")).id;
  job = (await one("insert into public.jobs (title, client_id, region, market, created_by) values ('Launch', $1, 'APAC', 'China', $2) returning id", [client, ids.agent])).id;
  job2 = (await one("insert into public.jobs (title, client_id, region, market, created_by) values ('Other job', $1, 'APAC', 'China', $2) returning id", [client, ids.agent])).id;
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  ({ sup: ft, caseId: ftCase } = await submitAndTriage("Rush Fixtures", {
    market: "China", client: "Carewell", category: "Fixtures", urgency: "urgent", urgency_reason: "Launch date fixed", client_need: "Launch fixtures",
    required_date: future(20), proposed_registration: "91440300MA5F", proposed_vat: null,
  }, "exception"));
  const scope = JSON.stringify({ jobs: [job], value_cap: 20000, systems: ["stocktool"] });
  await rejects(as("plain", "select public.fast_track_request($1, 'Launch', 'Fixtures', $2, $3::jsonb)", [ft, future(20), scope]), /minimum pack is incomplete: Vendor form received; Bank details received; NDA status known/);
  for (const [g, st] of [["rfi", "received"], ["bank", "received"], ["nda", "requested"], ["coc", "requested"]]) {
    await as("agent", "select public.update_supplier_gate($1, $2, $3)", [ft, g, st]);
  }
  await rejects(as("plain", "select public.fast_track_request($1, 'Launch', 'Fixtures', $2, '{}'::jsonb)", [ft, future(20)]), /name the job\(s\) or a value cap/);
  await rejects(as("plain", "select public.fast_track_request($1, 'Launch', 'Fixtures', $2, '{\"value_cap\":900000}'::jsonb)", [ft, future(20)]), /at most 50000/);
  await rejects(as("plain", "select public.fast_track_request($1, '', 'Fixtures', $2, $3::jsonb)", [ft, future(20), scope]), /Declare the urgency/);
  await as("plain", "select public.fast_track_request($1, 'Launch date fixed', 'Launch fixtures', $2, $3::jsonb)", [ft, future(20), scope]);
  const reqs = (await asSuper("select id, approval_type, approver_role, approver_module from public.approval_requests where entity_id = $1 and status = 'pending' order by approval_type", [String(ft)])).rows;
  assert.deepEqual(reqs.map((r) => [r.approval_type, r.approver_role, r.approver_module]), [["FAST_TRACK", "procurement_director", "assure"], ["FAST_TRACK_FINANCE", "local_finance", "CN"]]);
  const [dir, fin] = reqs;
  await rejects(as("plain", "select public.approval_request_decide($1, true, null)", [dir.id]), /someone else/);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [dir.id]), /procurement director/i);
  await rejects(as("finEmea", "select public.approval_request_decide($1, true, null)", [fin.id]), /local finance/i);
  await as("director", "select public.approval_request_decide($1, true, 'Launch is contractual')", [dir.id]);
  let s = await supplierRow(ft);
  assert.equal(s.purchasing_blocked, true, "one approval is not enough");
  await as("finApac", "select public.approval_request_decide($1, true, 'Bank checked')", [fin.id]);
  s = await supplierRow(ft);
  assert.deepEqual([s.purchasing_blocked, s.onboarding_state, s.onboarding_route, s.fast_track_approved_by], [false, "exception", "fast_track", ids.director]);
  const items = (await asSuper("select gate_key, owner_type, status from public.onboarding_remediation_items where supplier_id = $1 order by gate_key", [ft])).rows;
  assert.ok(items.length >= 8 && items.every((i) => i.status === "open"));
  assert.ok(items.find((i) => i.gate_key === "sustainability").owner_type === "vendor");
});

test("fast-track: Sourcing respects the scope; an overdue remediation item blocks orders (closure gate)", async () => {
  const mkRfq = async (jobId, value) => (await one(`insert into public.rfqs (rfq_number, job_id, title, due_at, estimated_value, region, market, created_by)
      values ('RFQ-T-' || substr(md5(random()::text), 1, 6), $1, 'Fixtures', now() + interval '5 days', $2, 'APAC', 'China', $3) returning id`, [jobId, value, ids.agent])).id;
  const rOut = await mkRfq(job2, 5000);
  await rejects(as("agent", "select public.rfq_set_suppliers($1, $2::jsonb)", [rOut, JSON.stringify([ft])]), /only be used for the approved job/);
  const rBig = await mkRfq(job, 30000);
  await rejects(as("agent", "select public.rfq_set_suppliers($1, $2::jsonb)", [rBig, JSON.stringify([ft])]), /capped at 20000/);
  const rIn = await mkRfq(job, 15000);
  assert.equal(await val("agent", "select public.rfq_set_suppliers($1, $2::jsonb)", [rIn, JSON.stringify([ft])]), 1);
  // A remediation item goes overdue: no further orders.
  await asSuper("update public.onboarding_remediation_items set due_date = current_date - 1 where supplier_id = $1 and gate_key = 'sustainability'", [ft]);
  const s = await supplierRow(ft);
  assert.equal(s.purchasing_blocked, true);
  assert.match(s.onboarding_block_reason, /remediation overdue/);
  const rIn2 = await mkRfq(job, 1000);
  await rejects(as("agent", "select public.rfq_set_suppliers($1, $2::jsonb)", [rIn2, JSON.stringify([ft])]), /not eligible in SRM/);
  const dash = await val("lead", "select public.srm_onboarding_dashboard()");
  assert.ok(dash.remediation_overdue.some((r) => r.supplier_id === ft));
  // Closing the evidence closes the item and lifts the block again.
  await verify("agent", ft, "sustainability", future(200));
  assert.equal((await one("select status from public.onboarding_remediation_items where supplier_id = $1 and gate_key = 'sustainability'", [ft])).status, "done");
  assert.equal((await supplierRow(ft)).purchasing_blocked, false);
  // Waiving needs the Procurement Director.
  const item = (await one("select id from public.onboarding_remediation_items where supplier_id = $1 and status = 'open' limit 1", [ft])).id;
  await rejects(as("lead", "select public.onboarding_remediation_update($1, 'waived', 'n/a')", [item]), /Only the Procurement Director/);
  await as("director", "select public.onboarding_remediation_update($1, 'waived', 'Covered by the client audit')", [item]);
});

test("fast-track: one refusal refuses the exception; the old single-approver path is superseded", async () => {
  const { sup } = await submitAndTriage("Second Rush Co", { market: "China", category: "Fixtures", urgency: "urgent", urgency_reason: "x", client_need: "y",
    required_date: future(10), proposed_registration: "91440300ZZ", proposed_vat: null }, "exception");
  for (const [g, st] of [["rfi", "received"], ["bank", "received"], ["nda", "requested"], ["coc", "requested"]]) await as("agent", "select public.update_supplier_gate($1, $2, $3)", [sup, g, st]);
  await as("plain", "select public.fast_track_request($1, 'x', 'y', $2, '{\"value_cap\":1000}'::jsonb)", [sup, future(10)]);
  const fin = await one("select id from public.approval_requests where approval_type = 'FAST_TRACK_FINANCE' and entity_id = $1", [String(sup)]);
  await as("finApac", "select public.approval_request_decide($1, false, 'Bank details do not match the registration')", [fin.id]);
  assert.equal((await one("select status from public.onboarding_fast_tracks where supplier_id = $1", [sup])).status, "rejected");
  assert.equal((await one("select status from public.approval_requests where approval_type = 'FAST_TRACK' and entity_id = $1", [String(sup)])).status, "cancelled");
  assert.equal((await supplierRow(sup)).purchasing_blocked, true);
  await rejects(as("lead", "select public.approve_fast_track($1, 'x', current_date + 5)", [sup]), /exception route/);
});

test("status taxonomy: tickets, gates, cases and fast-tracks map onto one vocabulary", async () => {
  const q = async (k, s, r = null) => val("plain", "select public.srm_status_taxonomy($1, $2, $3)", [k, s, r]);
  assert.equal(await q("ticket", "new"), "submitted");
  assert.equal(await q("ticket", "waiting_vendor"), "in_review");
  assert.equal(await q("ticket", "resolved", "completed"), "approved");
  assert.equal(await q("ticket", "resolved", "duplicate"), "declined");
  assert.equal(await q("gate", "received"), "in_review");
  assert.equal(await q("gate", "not_required"), "approved");
  assert.equal(await q("gate", "rejected"), "declined");
  assert.equal(await q("case", "released"), "approved");
  assert.equal(await q("case", "on_hold"), "on_hold");
  assert.equal(await q("fast_track", "approved"), "exception");
  const d = await val("lead", "select public.srm_onboarding_dashboard()");
  assert.ok(d.totals.approved >= 1 && d.totals.exception >= 1 && d.totals.declined >= 1);
  assert.equal(d.pipeline.length, 9);
  const byRegion = await val("lead", "select public.srm_onboarding_dashboard('APAC')");
  assert.ok(byRegion.totals.suppliers < d.totals.suppliers);
});

test("RLS: vendors see only their own case parts, in plain words; nothing internal", async () => {
  await asSuper("update public.suppliers set primary_contact_email = 'v@rush.example' where id = $1", [ft]);
  await asSuper("insert into auth.users (id, email) values ($1, 'v@rush.example'), ($2, 'v@mainstreet.example')", [ids.vendorA, ids.vendorB]);
  await asSuper("update public.profiles set supplier_id = $1 where id = $2", [main, ids.vendorB]);
  assert.equal((await as("vendorA", "select * from public.onboarding_cases")).rows.length, 0);
  assert.equal((await as("vendorA", "select * from public.onboarding_fast_tracks")).rows.length, 0);
  assert.equal((await as("vendorA", "select * from public.onboarding_risk_reviews")).rows.length, 0);
  const mine = (await as("vendorA", "select supplier_id, owner_type from public.onboarding_remediation_items")).rows;
  assert.ok(mine.length > 0 && mine.every((r) => r.supplier_id === ft && r.owner_type === "vendor"));
  assert.equal((await as("vendorB", "select * from public.onboarding_remediation_items")).rows.length, 0);
  const ev = (await as("vendorA", "select supplier_id, detail from public.onboarding_events")).rows;
  assert.ok(ev.every((e) => e.supplier_id === ft) && !JSON.stringify(ev).includes("value_cap"), "only vendor-visible events, nothing commercial");
  const tr = await val("vendorA", "select public.vendor_onboarding_tracker()");
  assert.equal(tr.name, "Rush Fixtures");
  assert.equal(tr.stages.length, 9);
  assert.ok(tr.remediation.length > 0);
  assert.equal(JSON.stringify(tr).includes("business_case"), false);
  assert.equal(JSON.stringify(tr).includes("Launch date fixed"), false, "urgency reasons and approvals stay internal");
  const trB = await val("vendorB", "select public.vendor_onboarding_tracker()");
  assert.equal(trB.released, true);
  await rejects(as("vendorA", "select public.srm_supplier_record($1)", [ft]), /Only adm Indicia staff/);
  await rejects(as("vendorA", "select public.srm_onboarding_dashboard()"), /Only adm Indicia staff/);
  await rejects(as("plain", "select public.vendor_onboarding_tracker()"), /Only vendor users/);
});

test("single supplier record: stages, IDs, contract set, approvals and exception history in one read", async () => {
  const r = await val("plain", "select public.srm_supplier_record($1)", [ft]);
  assert.equal(r.stages.length, 9);
  assert.equal(r.fast_track.status, "approved");
  assert.ok(r.approvals.some((a) => a.type === "FAST_TRACK" && a.status === "approved"));
  assert.ok(r.events.some((e) => e.kind === "fast_track_approved"));
  const m = await val("plain", "select public.srm_supplier_record($1)", [main]);
  assert.equal(m.system_ids.find((x) => x.system === "erp").external_id, "V-1");
  assert.equal(m.contracts.find((x) => x.doc === "coc").gate_status, "verified");
  assert.equal(m.activation.review_cadence, "annual");
});

test("scorecard reads the Code of Conduct from the onboarding gate (single source)", async () => {
  await asSuper("insert into public.scorecard_inputs (supplier_id, key, value_text) values ($1, 'coc', 'yes') on conflict (supplier_id, key) do update set value_text = 'yes'", [ft]);
  assert.equal((await as("plain", "select value_text from public.scorecard_inputs_effective where supplier_id = $1 and key = 'coc'", [ft])).rows[0].value_text, "no");
  assert.equal((await as("plain", "select value_text from public.scorecard_inputs_effective where supplier_id = $1 and key = 'coc'", [main])).rows[0].value_text, "yes");
});

test("review cadence: periodic tasks once per period; events open a revalidation case; an adverse finding re-screens", async () => {
  await rejects(as("agent", "select public.srm_run_review_cadence()"), /Only an SRT lead/);
  const n1 = await val("lead", "select public.srm_run_review_cadence()");
  assert.ok(n1 >= 6, `expected weekly, monthly and quarterly tasks, got ${n1}`);
  assert.equal(await val("lead", "select public.srm_run_review_cadence()"), 0, "no duplicates within a period");
  const scopes = (await asSuper("select distinct scope from public.srm_review_tasks")).rows.map((r) => r.scope).sort();
  for (const sc of ["access_review", "exceptions", "expiring_controls", "open_cases", "overdue_evidence", "sample_audit"]) assert.ok(scopes.includes(sc), sc);
  // Revalidation by risk tier when the review date passes.
  await asSuper("select set_config('assure.system_write', 'on', false)");
  await asSuper("update public.suppliers set next_review_due = current_date - 1 where id = $1", [main]);
  await asSuper("select set_config('assure.system_write', 'off', false)");
  await val("lead", "select public.srm_run_review_cadence()");
  assert.equal((await one("select count(*)::int n from public.srm_review_tasks where supplier_id = $1 and scope = 'revalidation'", [main])).n, 1);
  // Adverse finding: revalidation case and a fresh sanctions screen; the supplier is blocked until it is done.
  const caseId = await val("plain", "select public.srm_raise_event($1, 'adverse_finding', 'Press report of labour violations')", [main]);
  assert.equal((await one("select kind, trigger_event from public.onboarding_cases where id = $1", [caseId])).kind, "revalidation");
  assert.equal((await gates(main)).sanctions, "requested");
  assert.equal((await supplierRow(main)).purchasing_blocked, true);
  const sweep = await val("lead", "select public.srt_daily_sweep()");
  assert.ok("review_tasks" in sweep && "renewal_tickets" in sweep);
});

test("carry-over: a supplier approved before the standard keeps working; one in flight moves onto the standard", async () => {
  const a = (await one("insert into public.suppliers (supplier_code, name) values ('OLD-1', 'Old Approved') returning id")).id;
  const b = (await one("insert into public.suppliers (supplier_code, name) values ('OLD-2', 'Old In Flight') returning id")).id;
  await asSuper(`update public.supplier_gates g set status = 'verified' from public.gate_definitions d where d.key = g.gate_key and not d.standard_gate and g.supplier_id = $1`, [a]);
  await asSuper("select public._onb_carry_over(array[$1, $2]::uuid[])", [a, b]);
  const ra = await supplierRow(a); const rb = await supplierRow(b);
  assert.deepEqual([ra.onboarding_baseline, ra.purchasing_blocked, ra.onboarding_released], ["legacy", false, true]);
  assert.deepEqual([rb.onboarding_baseline, rb.purchasing_blocked], ["standard", true]);
  assert.equal((await gates(b)).triage, "verified", "in-flight suppliers keep their triage so the RFI can continue");
});
