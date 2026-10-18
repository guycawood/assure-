// Approval gaps closed (migrations 20261022000001-3): request -> approve steps driven by approval_policies, maker-checker,
// policy roles, the inbox per module and market normalisation. Policies are inserted per test (like the demo seed m16).
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const inbox = async (user, scope = "mine") => (await as(user, "select * from public.approvals_inbox($1)", [scope])).rows;
const requestFor = async (type, entity) => one("select * from public.approval_requests where approval_type = $1 and entity_id = $2 order by requested_at desc limit 1", [type, String(entity)]);

async function policy(code, data) {
  await asSuper(`insert into public.library_records (library_key, code, name, data, status, effective_from)
    values ('approval_policies', $1, $1, $2, 'active', current_date - 1)`, [code, JSON.stringify(data)]);
}
async function lib(key, code, name, data) {
  return (await one("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id",
    [key, code, name, JSON.stringify(data)])).id;
}

// Shared Sourcing fixtures (written directly; the gated functions are what the tests exercise).
await asSuper("select set_config('sourcing.system_write', 'on', false)");
const client = await one("insert into public.sourcing_clients (code, name, min_quotes_required, e_tender_threshold) values ('TG','Gap Client',1,1000) returning id");
const supplier = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('G-A','Gap Print','Germany','EMEA') returning id")).id;
await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [supplier]);
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 1), ($2, false, 2), ($3, false, null)", [ids.lead, ids.head, ids.agent]);
await lib("doa_levels", "G-L0", "Up to 5,000", { approval_level: 0, max_approval_amount: 5000, currency: "EUR" });
await lib("doa_levels", "G-L2", "Uncapped", { approval_level: 2, max_approval_amount: null, currency: "EUR" });
const job = await one("insert into public.jobs (title, client_id, region, market, created_by) values ('Gap job', $1, 'EMEA', 'Germany', $2) returning id, job_number", [client.id, ids.agent]);
const estimate = await one(`insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status, created_by)
  values ($1, $2, 'rfq', 'EUR', 9000, 'EMEA', 'Germany', 'approved', $3) returning id`, [job.id, supplier, ids.agent]);
await asSuper("select set_config('sourcing.system_write', 'off', false)");

test("Watchtower: scorecard activation is requested, a second admin or SRM owner approves, and it shows in their inbox", async () => {
  await policy("AP-G-SCORECARD", { module: "assure", approval_type: "SCORECARD", approver_role: "module_owner", maker_checker: true });
  const draft = (await as("admin", "select public.scorecard_create_draft() as id")).rows[0].id;
  await as("admin", "select public.scorecard_activate($1, 'New weights')", [draft]);
  assert.equal((await one("select status from public.scorecard_methodologies where id = $1", [draft])).status, "draft");
  const req = await requestFor("SCORECARD", draft);
  assert.equal(req.status, "pending");
  await rejects(as("admin", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else must approve/);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [req.id]), /admin or module owner/);
  assert.ok(!(await inbox("admin")).some((r) => r.item_id === req.id));
  assert.ok(!(await inbox("lead")).some((r) => r.item_id === req.id));
  assert.ok((await inbox("admin2")).some((r) => r.item_id === req.id && r.module === "watchtower" && r.approval_type === "SCORECARD"));
  await as("admin2", "select public.approval_request_decide($1, true, 'Checked')", [req.id]);
  assert.equal((await one("select status from public.scorecard_methodologies where id = $1", [draft])).status, "active");
  const ev = (await as("plain", "select action, actor from public.approval_request_events where request_id = $1 order by id", [req.id])).rows;
  assert.deepEqual(ev.map((e) => e.action), ["requested", "approved"]);
  assert.equal(ev[1].actor, ids.admin2);
  await rejects(as("admin", "update public.approval_requests set status = 'approved'"), /permission denied/);
});

test("Watchtower: user access changes wait for a second admin; the requester can't approve their own", async () => {
  await policy("AP-G-ACCESS", { module: "watchtower", approval_type: "ACCESS_USER", approver_role: "admin", maker_checker: true });
  await as("admin", "select public.admin_set_user_access($1, 'internal', 'agent', false, null)", [ids.plain]);
  assert.equal((await one("select srt_role from public.profiles where id = $1", [ids.plain])).srt_role, null);
  const req = await requestFor("ACCESS_USER", ids.plain);
  await rejects(as("admin", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("head", "select public.approval_request_decide($1, true, null)", [req.id]), /needs a admin/);
  await as("admin2", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select srt_role from public.profiles where id = $1", [ids.plain])).srt_role, "agent");
  await asSuper("update public.profiles set srt_role = null where id = $1", [ids.plain]);
});

test("Sourcing: settings changes always need a second governor; a rejected request changes nothing", async () => {
  await as("admin", "select public.sourcing_update_settings(7, 0.9, 500, 5, 'Tighter tolerance')");
  const req = await requestFor("SOURCING_SETTINGS", "settings");
  assert.equal(req.status, "pending");
  await rejects(as("admin", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [req.id]), /admin or module owner/);
  assert.ok((await inbox("admin2")).some((r) => r.item_id === req.id && r.module === "sourcing"));
  await rejects(as("admin2", "select public.approval_request_decide($1, false, ' ')", [req.id]), /why it is rejected/);
  await as("admin2", "select public.approval_request_decide($1, false, 'Too tight')", [req.id]);
  assert.notEqual(Number((await one("select triage_tolerance_percent from public.sourcing_settings")).triage_tolerance_percent), 7);
});

test("Sourcing: a triage override that skips the RFQ is applied by a different sourcing lead", async () => {
  await policy("AP-G-TRIAGE", { module: "sourcing", approval_type: "TRIAGE_OVERRIDE", approver_role: "sourcing_lead", maker_checker: true });
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const spec = (await one("insert into public.job_specs (job_id, title, spec_type, size_unit) values ($1, 'Header card', '2d', 'mm') returning id", [job.id])).id;
  const rc = await lib("rate_cards", "RC-G1", "Header card", { unit_price: 2, currency: "EUR", supplier_code: "G-A" });
  await asSuper(`insert into public.spec_triage (spec_id, route, reason, confidence, rate_card_id, unit_price, currency, quantity, is_current, decided_by, rule_version, source)
    values ($1, 'create', 'No match', 0, $2, 2, 'EUR', 100, true, $3, 'test', 'rule')`, [spec, rc, ids.agent]);
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  assert.equal((await as("lead", "select public.spec_triage_override($1, 'adopt', 'Rate card fits') as id", [spec])).rows[0].id, null);
  const req = await requestFor("TRIAGE_OVERRIDE", spec);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /sourcing lead/);
  assert.ok((await inbox("admin")).some((r) => r.item_id === req.id));
  await as("admin", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select route from public.spec_triage where spec_id = $1 and is_current", [spec])).route, "adopt");
});

test("Order Management: PO rejection uses the DOA rule; e-tender POs need the Procurement head first; markets are normalised", async () => {
  await policy("AP-G-ETENDER", { module: "orders", approval_type: "PO_ETENDER", approver_role: "procurement_head", maker_checker: true });
  const po = await one(`insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, required_doa_level, exceeds_e_tender, region, market, created_by)
    values ($1, $2, $3, 'EUR', 9000, 2, true, 'EMEA', 'Germany', $4) returning id`, [job.id, estimate.id, supplier, ids.agent]);
  await rejects(as("agent", "select public.po_reject($1, 'No')", [po.id]), /A different person/);
  await rejects(as("lead", "select public.po_reject($1, 'No')", [po.id]), /needs DOA level 2/);
  await rejects(as("head", "select public.po_approve($1, null)", [po.id]), /e-tender threshold/);
  const all = await inbox("admin", "all");
  const row = all.find((r) => r.item_id === po.id);
  assert.equal(row.approval_type, "PO_ETENDER");
  assert.equal(row.market, "DE");
  assert.equal(row.market_name, "Germany");
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === po.id));
  assert.ok((await inbox("head")).some((r) => r.item_id === po.id && r.approval_type === "PO_ETENDER"));
  await rejects(as("agent", "select public.po_etender_decide($1, true, null)", [po.id]), /different person/);
  await rejects(as("lead", "select public.po_etender_decide($1, true, null)", [po.id]), /procurement head/);
  await as("head", "select public.po_etender_decide($1, true, 'Tender waived: framework')", [po.id]);
  assert.ok((await inbox("head")).some((r) => r.item_id === po.id && r.approval_type === "PO_DOA"));
  await as("head", "select public.po_reject($1, 'Wrong supplier')", [po.id]);
  assert.equal((await one("select status from public.purchase_orders where id = $1", [po.id])).status, "rejected");
  const d = await one("select decision, actor from public.approval_decisions where entity_id = $1", [po.id]);
  assert.deepEqual([d.decision, d.actor], ["approved", ids.head]);
});

test("Finance: cancelling a sent bill needs a second finance user; reviewers never review their own estimate", async () => {
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const bill = await one(`insert into public.client_bills (estimate_id, job_id, client_id, currency, net_amount, status, region, market, created_by)
    values ($1, $2, $3, 'EUR', 1000, 'sent', 'EMEA', 'DE', $4) returning id`, [estimate.id, job.id, client.id, ids.finance]);
  const draft = await one(`insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status, created_by)
    values ($1, $2, 'rfq', 'EUR', 100, 'EMEA', 'Germany', 'draft', $3) returning id`, [job.id, supplier, ids.finance]);
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  await as("finance", "select public.finance_bill_cancel($1, 'Raised twice')", [bill.id]);
  assert.equal((await one("select status from public.client_bills where id = $1", [bill.id])).status, "sent");
  const req = await requestFor("BILL_CANCEL", bill.id);
  await rejects(as("finance", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /finance/);
  assert.ok(!(await inbox("finance")).some((r) => r.item_id === req.id));
  assert.ok((await inbox("admin")).some((r) => r.item_id === req.id && r.module === "finance"));
  await as("admin", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select status from public.client_bills where id = $1", [bill.id])).status, "cancelled");
  await rejects(as("finance", "select public.finance_estimate_decide($1, true, null)", [draft.id]), /You created this estimate/);
  await as("admin", "select public.finance_estimate_decide($1, true, null)", [draft.id]);
});

test("Logistics: delivered needs a verified POD, or a logistics lead with an override reason", async () => {
  await policy("AP-G-DELIVERY", { module: "logistics", approval_type: "DELIVERY_CONFIRM", approver_role: "logistics_lead", maker_checker: false });
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const spec = (await one("insert into public.job_specs (job_id, title, spec_type, size_unit) values ($1, 'Wobbler', '2d', 'mm') returning id", [job.id])).id;
  const po = (await one(`insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, required_doa_level, region, market, status)
    values ($1, $2, $3, 'EUR', 100, 0, 'EMEA', 'Germany', 'accepted') returning id`, [job.id, estimate.id, supplier])).id;
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  const del = (await one(`insert into public.deliveries (po_id, job_id, supplier_id, spec_id, quantity, region, market, status)
    values ($1, $2, $3, $4, 10, 'EMEA', 'DE', 'in_transit') returning id`, [po, job.id, supplier, spec])).id;
  await asSuper("insert into public.shipments (delivery_id, supplier_id, quantity_shipped, dispatch_date) values ($1, $2, 10, current_date)", [del, supplier]);
  await rejects(as("agent", "select public.logistics_mark_delivered($1, null, 'Driver said so')", [del]), /no verified proof of delivery/);
  await rejects(as("lead", "select public.logistics_mark_delivered($1, null, null)", [del]), /override reason/);
  await as("lead", "select public.logistics_mark_delivered($1, null, 'Store confirmed by phone')", [del]);
  assert.equal((await one("select status from public.deliveries where id = $1", [del])).status, "delivered");
  assert.equal((await one("select decision from public.approval_decisions where entity_id = $1", [del])).decision, "override");
});

test("Execution: a production-ready recce needs a second person", async () => {
  await policy("AP-G-RECCE", { module: "execution", approval_type: "RECCE_READY", approver_role: "internal", maker_checker: true });
  const outlet = (await one("insert into public.outlets (name, outlet_code, region, market) values ('Gap store', 'G-OUT-1', 'EMEA', 'DE') returning id")).id;
  const recce = (await one(`insert into public.recces (outlet_id, job_id, region, market, available_width_cm, available_height_cm, unit_width_cm, unit_height_cm, recommended_width_cm, recommended_height_cm, status)
    values ($1, $2, 'EMEA', 'DE', 120, 80, 60, 40, 60, 40, 'confirmed') returning id`, [outlet, job.id])).id;
  await as("agent", "select public.execution_recce_set_status($1, 'production_ready')", [recce]);
  assert.equal((await one("select status from public.recces where id = $1", [recce])).status, "confirmed");
  const req = await requestFor("RECCE_READY", recce);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === req.id));
  assert.ok((await inbox("plain")).some((r) => r.item_id === req.id && r.module === "execution"));
  await as("plain", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select status from public.recces where id = $1", [recce])).status, "production_ready");
});

// Changed by the nine-stage onboarding standard (20261039000002): fast-track is an exception route with two named approvals
// (FAST_TRACK and FAST_TRACK_FINANCE), each policy-driven. The policies here name an SRT lead and Finance.
test("SRM: fast-track is requested and approved by both policy roles; critical gates are never verified by who requested the evidence", async () => {
  await policy("AP-G-FAST", { module: "assure", approval_type: "FAST_TRACK", approver_role: "srt_lead", maker_checker: true });
  await policy("AP-G-FAST-FIN", { module: "assure", approval_type: "FAST_TRACK_FINANCE", approver_role: "finance", maker_checker: true });
  await policy("AP-G-GATE", { module: "assure", approval_type: "SRT_GATE", approver_role: "srt_agent", maker_checker: true });
  const s = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('G-FT','Fast Ltd','Germany','EMEA') returning id")).id;
  await asSuper("update public.supplier_profiles set uen_number = 'HRB 1' where supplier_id = $1", [s]);
  await asSuper(`update public.supplier_gates set status = case gate_key when 'triage' then 'verified' when 'rfi' then 'received' when 'bank' then 'received' else 'requested' end
    where supplier_id = $1 and gate_key in ('triage','rfi','bank','nda','coc')`, [s]);
  const close = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  await as("agent", "select public.fast_track_request($1, 'Launch next week', 'Launch display', $2, '{\"value_cap\":5000}'::jsonb)", [s, close]);
  const req = await requestFor("FAST_TRACK", s);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("finance", "select public.approval_request_decide($1, true, null)", [req.id]), /srt lead/);
  assert.ok((await inbox("lead")).some((r) => r.item_id === req.id && r.approval_type === "FAST_TRACK"));
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === req.id));
  await as("lead", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select fast_track_approved_by from public.suppliers where id = $1", [s])).fast_track_approved_by, null, "one approval is not enough");
  await as("finance", "select public.approval_request_decide($1, true, null)", [(await requestFor("FAST_TRACK_FINANCE", s)).id]);
  const sup = await one("select onboarding_route, fast_track_approved_by from public.suppliers where id = $1", [s]);
  assert.deepEqual([sup.onboarding_route, sup.fast_track_approved_by], ["fast_track", ids.lead]);

  await as("agent", "select public.update_supplier_gate($1, 'registration', 'received')", [s]);
  await rejects(as("agent", "select public.update_supplier_gate($1, 'registration', 'verified')", [s]), /someone else must verify/);
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === `${s}:registration`));
  assert.ok((await inbox("lead")).some((r) => r.item_id === `${s}:registration`));
  await as("lead", "select public.update_supplier_gate($1, 'registration', 'verified')", [s]);
});

test("Shopper IQ: results recorded in the app are verified by someone else before clients see them; assets need a rights sign-off", async () => {
  const tp = await lib("touchpoint_types", "TP-G", "Shelf", {});
  const camp = (await one("insert into public.campaigns (name, client_id, client) values ('Gap campaign', $1, 'Gap Client') returning id", [client.id])).id;
  const id = (await as("agent", "select public.siq_record_effectiveness($1) as id", [JSON.stringify({ campaign_id: camp, region: "EMEA", market: "DE", touchpoint: "TP-G", spend: "100", execution_score: "80" })])).rows[0].id;
  assert.equal((await one("select verification_status from public.siq_effectiveness where id = $1", [id])).verification_status, "pending");
  assert.deepEqual((await as("admin", "select public.client_portal_effectiveness($1) as x", [client.id])).rows[0].x, []);
  await rejects(as("agent", "select public.siq_verify_effectiveness($1, true, null)", [id]), /someone else must verify/);
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === id));
  assert.ok((await inbox("lead")).some((r) => r.item_id === id && r.module === "shopper-iq" && r.approval_type === "SIQ_EFFECTIVENESS"));
  await as("lead", "select public.siq_verify_effectiveness($1, true, null)", [id]);
  assert.equal((await as("admin", "select public.client_portal_effectiveness($1) as x", [client.id])).rows[0].x.length, 1);
  assert.ok(tp);

  const asset = (await as("agent", "select public.siq_add_asset($1) as id", [JSON.stringify({ title: "Gondola photo", campaign_id: camp })])).rows[0].id;
  assert.equal((await as("plain", "select count(*)::int n from public.siq_assets_available where id = $1", [asset])).rows[0].n, 0);
  await rejects(as("agent", "select public.siq_asset_signoff($1, true, null)", [asset]), /someone else/);
  await as("plain", "select public.siq_asset_signoff($1, true, 'Rights cleared')", [asset]);
  assert.equal((await as("plain", "select count(*)::int n from public.siq_assets_available where id = $1", [asset])).rows[0].n, 1);
});

test("RFQ: a quote Finance logged is approved by another finance user; awards need the policy role and never the RFQ creator", async () => {
  await policy("AP-G-AWARD", { module: "rfq", approval_type: "RFQ_AWARD", approver_role: "sourcing_lead", maker_checker: true });
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const rfq = (await one(`insert into public.rfqs (job_id, title, due_at, region, market, status, currency, created_by, min_quotes_required)
    values ($1, 'Gap RFQ', now() - interval '1 day', 'EMEA', 'Germany', 'sent', 'EUR', $2, 1) returning id`, [job.id, ids.agent])).id;
  await asSuper("insert into public.rfq_invitations (rfq_id, supplier_id, status) values ($1, $2, 'quoted')", [rfq, supplier]);
  const q = (await one(`insert into public.rfq_responses (rfq_id, supplier_id, status, source, currency, total_value, submitted_by, submitted_at)
    values ($1, $2, 'submitted', 'internal_entry', 'EUR', 800, $3, now()) returning id`, [rfq, supplier, ids.finance])).id;
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  await rejects(as("finance", "select public.rfq_finance_decide($1, true, null)", [q]), /You logged this quote/);
  assert.ok(!(await inbox("finance")).some((r) => r.item_id === q));
  assert.ok((await inbox("admin")).some((r) => r.item_id === q && r.approval_type === "QUOTE_FINANCE"));
  await as("admin", "select public.rfq_finance_decide($1, true, null)", [q]);
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === rfq));
  assert.ok((await inbox("lead")).some((r) => r.item_id === rfq && r.module === "rfq" && r.approval_type === "RFQ_AWARD"));
  await rejects(as("agent", "select public.rfq_award($1, $2, 'Best price', null)", [rfq, q]), /You created this RFQ/);
  await rejects(as("plain", "select public.rfq_award($1, $2, 'Best price', null)", [rfq, q]), /sourcing lead/);
});