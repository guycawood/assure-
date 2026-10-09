// Finance+: vendor invoice submission (own accepted PO only, viewers blocked), finance-only decisions, the server-side
// three-way match (PO value within FR-TOL, delivered + POD verified, installs done), maker-checker override approval,
// payment schedule and mark paid, client bills, estimate finance review, and the append-only finance event log.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const V = {
  vA: "00000000-0000-0000-0000-0000000000f1", // vendor A portal admin (primary contact)
  vAview: "00000000-0000-0000-0000-0000000000f2", // vendor A colleague, view-only
  vB: "00000000-0000-0000-0000-0000000000f3", // vendor B portal admin
};
Object.assign(ids, V);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

async function lib(key, code, name, data) {
  await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01')",
    [key, code, name, JSON.stringify(data)]);
}
async function supplier(code, name, email) {
  const { rows } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, name, email]);
  return rows[0].id;
}

// ---------- fixtures ----------
await lib("finance_rules", "FR-TOL", "Invoice match tolerance", { value: 2, unit: "percent" });
await lib("finance_rules", "FR-MIN-MARGIN", "Minimum margin before review", { value: 10, unit: "percent" });
await lib("finance_rules", "FR-REVIEW-VALUE", "Estimate value needing review", { value: 10000, unit: "EUR" });
for (let i = 1; i <= 8; i++) await lib("pod_checklist", `POD-${i}`, `Check ${i}`, { mandatory: true });

const sA = await supplier("F-A", "Alpha Print", "a@alpha-f.example");
const sB = await supplier("F-B", "Beta Displays", "b@beta-f.example");
await asSuper("update public.supplier_profiles set payment_terms = 'net_45' where supplier_id = $1", [sA]);
await asSuper("insert into public.supplier_team_members (supplier_id, email, permission_level, status) values ($1, 'view@alpha-f.example', 'viewer', 'pending')", [sA]);
await asSuper("insert into auth.users (id, email) values ($1,'a@alpha-f.example'), ($2,'view@alpha-f.example'), ($3,'b@beta-f.example')", [V.vA, V.vAview, V.vB]);
// A second finance user for maker-checker (Sourcing+ finance access, same check as rfq_finance_decide).
await asSuper("insert into public.sourcing_user_access (user_id, is_finance) values ($1, true)", [ids.head]);

const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('FCL','Finance Client') returning id");
const { rows: [be] } = await asSuper("insert into public.sourcing_billing_entities (code, name, region, market) values ('BE-FDE','adm Indicia GmbH','EMEA','Germany') returning id");

async function makePo(supplierId, { value = 1000, status = "accepted", sell = 15 } = {}) {
  const { rows: [job] } = await as("agent", "insert into public.jobs (title, client_id, billing_entity_id, region, market, budget) values ('Finance job',$1,$2,'EMEA','Germany',5000) returning id", [client.id, be.id]);
  const { rows: [spec] } = await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Header card','2d') returning id", [job.id]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Main',100)", [spec.id]);
  const { rows: [est] } = await asSuper(
    "insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market, status, client_order_ref) values ($1,$2,'rfq','EUR',$3,$4,'EMEA','Germany','approved','CL-1') returning id",
    [job.id, supplierId, value, sell]);
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,100,$3,$4)", [est.id, spec.id, value / 100, value]);
  const { rows: [po] } = await asSuper(
    "insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, status, region, market) values ($1,$2,$3,'EUR',$4,$5,0,$6,'EMEA','Germany') returning id",
    [job.id, est.id, supplierId, value, day(10), status]);
  return { job: job.id, spec: spec.id, est: est.id, po: po.id };
}
async function invoiceFile(user, poId) {
  const { rows: [f] } = await as(user, "select public.file_register('finance','purchase_order',$1,null,'invoice.pdf','application/pdf',10,'aGVsbG8gd29ybGQ=',null,'Invoice') as id", [poId]);
  return f.id;
}
async function submit(user, poId, number, net, vat = 0, date = day(-1)) {
  const file = await invoiceFile(user, poId);
  const { rows: [r] } = await as(user, "select public.finance_vendor_submit_invoice($1,$2,$3,$4,$5,'EUR',$6) as id", [poId, number, date, net, vat, file]);
  return r.id;
}
// Deliver a PO fully with a verified POD (internal flow from Logistics+).
async function deliverWithPod(poId) {
  await as("agent", "select public.logistics_plan_from_po($1)", [poId]);
  const del = (await one("agent", "select id from public.deliveries where po_id = $1", [poId])).id;
  const { rows: [{ id: ship }] } = await as("agent", "select public.logistics_record_shipment($1,null,null,'TRK',$2,100) as id", [del, day(-3)]);
  const { rows: [f] } = await as("agent", "select public.file_register('logistics','shipment',$1,null,'pod.pdf','application/pdf',10,'aGVsbG8=',null,'POD') as id", [ship]);
  await as("agent", "select public.logistics_attach_pod($1,$2,$3)", [ship, f.id, day(-1)]);
  return { del, ship };
}
const allChecks = JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`POD-${i + 1}`, true])));

// ---------- tests ----------
let A; // supplier A, accepted PO, value 1000
test("a vendor can only invoice its own accepted PO; view-only users are blocked", async () => {
  A = await makePo(sA, { value: 1000 });
  const issued = await makePo(sA, { value: 500, status: "issued" });
  const other = await makePo(sB, { value: 800 });
  await rejects(submit("vA", issued.po, "INV-0", 500), /Accept the purchase order/);
  await rejects(submit("vA", other.po, "INV-X", 800), /Purchase order not found/);
  await rejects(as("vAview", "select public.finance_vendor_submit_invoice($1,'INV-V',$2,100,0,'EUR',null)", [A.po, day(-1)]), /view-only/);
  await rejects(as("agent", "select public.finance_vendor_submit_invoice($1,'INV-S',$2,100,0,'EUR',null)", [A.po, day(-1)]), /Only a vendor user/);
  const fileA = await invoiceFile("vA", A.po);
  await rejects(as("vA", "select public.finance_vendor_submit_invoice($1,'INV-1',$2,100,0,'USD',$3)", [A.po, day(-1), fileA]), /PO currency \(EUR\)/);
  await rejects(as("vA", "select public.finance_vendor_submit_invoice($1,'INV-1',$2,100,0,'EUR',$3)", [A.po, day(2), fileA]), /future/);
  // vendor B can't attach A's file, and nobody writes invoices directly
  const fileB = await invoiceFile("vB", other.po);
  await rejects(as("vA", "select public.finance_vendor_submit_invoice($1,'INV-1',$2,100,0,'EUR',$3)", [A.po, day(-1), fileB]), /Upload the invoice PDF/);
  await rejects(as("vA", "insert into public.supplier_invoices (invoice_ref, po_id, supplier_id, job_id, invoice_number, invoice_date, payment_terms, payment_terms_days, due_date, currency, net_amount, region, market) values ('x',$1,$2,$3,'Z',current_date,'net_30',30,current_date,'EUR',1,'EMEA','DE')", [A.po, sA, A.job]), /permission denied/);

  const id = await submit("vA", A.po, "INV-1", 1000, 190, day(-10));
  const inv = await one("agent", "select invoice_ref, status, gross_amount, payment_terms, due_date::text due, region, market, file_id from public.supplier_invoices where id = $1", [id]);
  assert.match(inv.invoice_ref, /^FI-\d{4}-\d{5}$/);
  assert.deepEqual([inv.status, Number(inv.gross_amount), inv.payment_terms, inv.due, inv.region, inv.market], ["submitted", 1190, "net_45", day(35), "EMEA", "DE"]);
  const f = await one("agent", "select entity_type, entity_id from public.files where id = $1", [inv.file_id]);
  assert.deepEqual([f.entity_type, f.entity_id], ["supplier_invoice", id]);
  await rejects(submit("vA", A.po, "inv-1", 10), /already sent an invoice numbered/);
  // vendor B keeps the default Assure+ terms (net 30)
  const bId = await submit("vB", other.po, "B-1", 800);
  assert.equal((await one("agent", "select payment_terms_days d from public.supplier_invoices where id = $1", [bId])).d, 30);
  // each vendor sees only their own invoices, never match details; vendors read nothing directly
  const listA = (await one("vA", "select public.finance_vendor_invoices() l")).l;
  assert.equal(listA.length, 1);
  assert.equal(listA[0].invoice_number, "INV-1");
  assert.equal(listA[0].match_details, undefined);
  assert.equal((await one("vB", "select public.finance_vendor_invoices() l")).l.length, 1);
  assert.equal((await one("vA", "select count(*)::int n from public.supplier_invoices")).n, 0);
  assert.equal((await one("vAview", "select public.finance_vendor_invoices() l")).l.length, 1); // viewers can read
  const pos = (await one("vA", "select public.finance_vendor_invoiceable_pos() l")).l;
  assert.deepEqual(pos.map((p) => p.id), [A.po]);
  // supplier notified, finance notified
  assert.ok((await one("vA", "select count(*)::int n from public.notifications where user_id = auth.uid() and module = 'finance'")).n >= 1);
  assert.ok((await one("finance", "select count(*)::int n from public.notifications where user_id = auth.uid() and title = 'Supplier invoice to match'")).n >= 1);
});

test("vendors and non-finance staff can't match, approve or mark paid", async () => {
  const inv = (await one("agent", "select id from public.supplier_invoices where po_id = $1", [A.po])).id;
  for (const fn of ["finance_match_invoice($1)", "finance_approve_invoice($1, null)", "finance_reject_invoice($1, 'x')"]) {
    await rejects(as("vA", `select public.${fn}`, [inv]), /Only Finance/);
    await rejects(as("agent", `select public.${fn}`, [inv]), /Only Finance/);
  }
  await rejects(as("vA", "update public.supplier_invoices set status = 'approved' where id = $1", [inv]), /permission denied/);
  await rejects(as("vA", "select public.finance_mark_paid(gen_random_uuid(), 'REF')"), /Only Finance/);
});

let missingId;
test("match detects missing POD, then matches once delivered and the POD is verified", async () => {
  missingId = (await one("agent", "select id from public.supplier_invoices where po_id = $1", [A.po])).id;
  await rejects(as("finance", "select public.finance_approve_invoice($1, null)", [missingId]), /Only an invoice in matching/);
  let m = (await one("finance", "select public.finance_match_invoice($1) m", [missingId])).m;
  assert.equal(m.result, "missing_evidence");
  assert.equal(m.amount.ok, true);
  assert.match(m.missing.join(" "), /No deliveries/);
  const { ship } = await deliverWithPod(A.po);
  m = (await one("finance", "select public.finance_match_invoice($1) m", [missingId])).m;
  assert.equal(m.result, "missing_evidence");
  assert.equal(m.deliveries.pods_unverified, 1);
  assert.match(m.missing.join(" "), /POD\(s\) not verified/);
  await as("lead", "select public.logistics_pod_verify($1,$2,null)", [ship, allChecks]);
  m = (await one("finance", "select public.finance_match_invoice($1) m", [missingId])).m;
  assert.equal(m.result, "matched");
  assert.equal(Number(m.amount.tolerance_percent), 2);
  const row = await one("finance", "select status, match_status, tolerance_record_id is not null has_tol from public.supplier_invoices where id = $1", [missingId]);
  assert.deepEqual([row.status, row.match_status, row.has_tol], ["matching", "matched", true]);
});

test("installs on the PO must be installed or audited and passed", async () => {
  const P = await makePo(sA, { value: 400 });
  await deliverWithPod(P.po);
  const ship = (await one("agent", "select s.id from public.shipments s join public.deliveries d on d.id = s.delivery_id where d.po_id = $1", [P.po])).id;
  await as("lead", "select public.logistics_pod_verify($1,$2,null)", [ship, allChecks]);
  const { rows: [o] } = await asSuper("insert into public.outlets (name, outlet_code, region, market) values ('Store 1','FS-1','EMEA','DE') returning id");
  const { rows: [dep] } = await asSuper("insert into public.deployments (outlet_id, po_id, job_id, supplier_id, spec_id, quantity, stage, region, market) values ($1,$2,$3,$4,$5,10,'delivered','EMEA','DE') returning id",
    [o.id, P.po, P.job, sA, P.spec]);
  const inv = await submit("vA", P.po, "INV-DEP", 400);
  let m = (await one("finance", "select public.finance_match_invoice($1) m", [inv])).m;
  assert.equal(m.result, "missing_evidence");
  assert.equal(m.deployments.applies, true);
  await asSuper("update public.deployments set stage = 'audited', audit_status = 'passed' where id = $1", [dep.id]);
  m = (await one("finance", "select public.finance_match_invoice($1) m", [inv])).m;
  assert.equal(m.result, "matched");
});

let varId;
test("match detects a variance above the FR-TOL tolerance; over-invoiced POs are flagged", async () => {
  const P = await makePo(sA, { value: 1000 });
  const ok = await submit("vA", P.po, "INV-TOL", 1015); // 1.5% over: inside 2%
  assert.equal((await one("finance", "select public.finance_match_invoice($1) m", [ok])).m.amount.ok, true);
  await as("finance", "select public.finance_reject_invoice($1, 'Duplicate of INV-VAR')", [ok]);
  varId = await submit("vA", P.po, "INV-VAR", 1050); // 5% over
  const m = (await one("finance", "select public.finance_match_invoice($1) m", [varId])).m;
  assert.equal(m.result, "variance");
  assert.equal(Number(m.amount.variance), 50);
  assert.equal(Number(m.amount.variance_percent), 5);
  const spend = await one("agent", "select over_po, invoiced::numeric inv from public.v_finance_spend where po_id = $1", [P.po]);
  assert.deepEqual([spend.over_po, Number(spend.inv)], [true, 1050]); // the rejected invoice doesn't count
  // a rejected number can be reused
  await submit("vA", P.po, "INV-TOL", 1);
});

test("approving an unmatched invoice needs an override reason recorded by a different finance user", async () => {
  await rejects(as("finance", "select public.finance_approve_invoice($1, null)", [varId]), /record an override reason first/);
  await rejects(as("finance", "select public.finance_request_override($1, '  ')", [varId]), /Say why/);
  await as("finance", "select public.finance_request_override($1, 'Agreed extra delivery charge with the buyer')", [varId]);
  await rejects(as("finance", "select public.finance_approve_invoice($1, null)", [varId]), /different finance user/);
  await rejects(as("agent", "select public.finance_approve_invoice($1, null)", [varId]), /Only Finance/);
  // re-running the match clears the override request
  await as("finance", "select public.finance_match_invoice($1)", [varId]);
  await rejects(as("head", "select public.finance_approve_invoice($1, null)", [varId]), /record an override reason first/);
  await as("finance", "select public.finance_request_override($1, 'Agreed extra delivery charge with the buyer')", [varId]);
  await as("head", "select public.finance_approve_invoice($1, 'Checked with the buyer')", [varId]);
  const r = await one("finance", "select status, approved_by from public.supplier_invoices where id = $1", [varId]);
  assert.deepEqual([r.status, r.approved_by], ["approved", ids.head]);
  const ev = await one("finance", "select detail from public.finance_events where invoice_id = $1 and event = 'approved'", [varId]);
  assert.equal(ev.detail.override, true);
  // a matched invoice needs no override
  await as("finance", "select public.finance_approve_invoice($1, null)", [missingId]);
});

test("payment schedule, overdue status, mark paid (finance only, with a reference)", async () => {
  await rejects(as("finance", "select public.finance_schedule_payment($1, $2)", [missingId, JSON.stringify([{ due_date: day(5), amount: 100 }])]), /add up to/);
  const gross = Number((await one("finance", "select gross_amount g from public.supplier_invoices where id = $1", [missingId])).g);
  await as("finance", "select public.finance_schedule_payment($1, $2)", [missingId, JSON.stringify([{ due_date: day(-2), amount: 590 }, { due_date: day(60), amount: gross - 590 }])]);
  const items = (await as("finance", "select id, status from public.v_payment_schedule where invoice_id = $1 order by seq", [missingId])).rows;
  assert.deepEqual(items.map((i) => i.status), ["overdue", "upcoming"]);
  await rejects(as("vA", "select public.finance_mark_paid($1, 'BACS-1')", [items[0].id]), /Only Finance/);
  await rejects(as("finance", "select public.finance_mark_paid($1, '')", [items[0].id]), /payment reference/);
  await as("finance", "select public.finance_mark_paid($1, 'BACS-1')", [items[0].id]);
  await rejects(as("finance", "select public.finance_mark_paid($1, 'BACS-1')", [items[0].id]), /already marked paid/);
  assert.equal((await one("finance", "select status from public.supplier_invoices where id = $1", [missingId])).status, "scheduled");
  await as("finance", "select public.finance_mark_paid($1, 'BACS-2')", [items[1].id]);
  assert.equal((await one("finance", "select status from public.supplier_invoices where id = $1", [missingId])).status, "paid");
  const vendorView = (await one("vA", "select public.finance_vendor_invoices() l")).l.find((x) => x.id === missingId);
  assert.deepEqual(vendorView.payments.map((p) => p.payment_reference), ["BACS-1", "BACS-2"]);
});

test("finance events are append-only and every invoice transition is logged", async () => {
  const evs = (await as("finance", "select event from public.finance_events where invoice_id = $1 order by id", [missingId])).rows.map((r) => r.event);
  for (const e of ["submitted", "matched", "approved", "payment_scheduled", "paid"]) assert.ok(evs.includes(e), `missing ${e}`);
  await rejects(as("finance", "update public.finance_events set event = 'x' where invoice_id = $1", [missingId]), /permission denied/);
  await rejects(as("admin", "delete from public.finance_events where invoice_id = $1", [missingId]), /permission denied/);
  await rejects(asSuper("update public.finance_events set event = 'x' where invoice_id = $1", [missingId]), /append-only/);
  await rejects(asSuper("delete from public.finance_events where invoice_id = $1", [missingId]), /append-only/);
});

test("disputes go back to the supplier and return to matching when resolved", async () => {
  const P = await makePo(sB, { value: 300 });
  const inv = await submit("vB", P.po, "B-DISP", 300);
  await rejects(as("finance", "select public.finance_dispute_invoice($1, '')", [inv]), /Say what is wrong/);
  await as("finance", "select public.finance_dispute_invoice($1, 'Wrong PO quoted on the PDF')", [inv]);
  const v = (await one("vB", "select public.finance_vendor_invoices() l")).l.find((x) => x.id === inv);
  assert.deepEqual([v.status, v.reason], ["disputed", "Wrong PO quoted on the PDF"]);
  const m = (await one("finance", "select public.finance_resolve_dispute($1, 'Supplier confirmed') m", [inv])).m;
  assert.equal(m.result, "missing_evidence");
  assert.equal((await one("finance", "select status from public.supplier_invoices where id = $1", [inv])).status, "matching");
});

test("estimate finance review: queue rules, decline needs a reason, stale after repricing", async () => {
  const P = await makePo(sA, { value: 20000, sell: 5 }); // 20k (over FR-REVIEW-VALUE), ~4.8% margin
  await asSuper("update public.estimates set status = 'draft' where id = $1", [P.est]);
  let e = await one("finance", "select needs_review, review_triggers, margin_percent from public.v_finance_estimates where id = $1", [P.est]);
  assert.equal(e.needs_review, true);
  assert.equal(e.review_triggers.length, 2);
  await rejects(as("agent", "select public.finance_estimate_decide($1, true, null)", [P.est]), /Only Finance/);
  await rejects(as("finance", "select public.finance_estimate_decide($1, false, '')", [P.est]), /Say why/);
  await as("finance", "select public.finance_estimate_decide($1, true, null)", [P.est]);
  e = await one("finance", "select needs_review, review_status from public.v_finance_estimates where id = $1", [P.est]);
  assert.deepEqual([e.needs_review, e.review_status], [false, "approved"]);
  await as("agent", "select public.estimate_set_pricing($1, 'markup', 8)", [P.est]);
  e = await one("finance", "select needs_review, review_stale from public.v_finance_estimates where id = $1", [P.est]);
  assert.deepEqual([e.needs_review, e.review_stale], [true, true]);
});

test("client bills from approved estimates: numbered, one live bill per estimate, draft -> sent -> paid", async () => {
  const P = await makePo(sA, { value: 2000, sell: 15 });
  await rejects(as("agent", "select public.finance_bill_create($1, 19, null)", [P.est]), /Only Finance/);
  const { rows: [{ id }] } = await as("finance", "select public.finance_bill_create($1, 19, null) as id", [P.est]);
  await rejects(as("finance", "select public.finance_bill_create($1, 0, null)", [P.est]), /already has a bill/);
  const b = await one("finance", "select bill_number, status, net_amount, vat_amount, gross_amount, market, billing_entity_code from public.v_client_bills where id = $1", [id]);
  assert.match(b.bill_number, /^CB-\d{4}-\d{5}$/);
  assert.deepEqual([b.status, Number(b.net_amount), Number(b.vat_amount), Number(b.gross_amount), b.market, b.billing_entity_code], ["draft", 2300, 437, 2737, "DE", "BE-FDE"]);
  await rejects(as("finance", "select public.finance_bill_mark_paid($1, 'X')", [id]), /Only a sent bill/);
  await as("finance", "select public.finance_bill_send($1)", [id]);
  await as("finance", "select public.finance_bill_mark_paid($1, 'CLIENT-REF')", [id]);
  assert.equal((await one("finance", "select status from public.client_bills where id = $1", [id])).status, "paid");
  const draft = await makePo(sA, { value: 100 });
  await asSuper("update public.estimates set status = 'sent' where id = $1", [draft.est]);
  await rejects(as("finance", "select public.finance_bill_create($1, 0, null)", [draft.est]), /approved the estimate/);
});

test("Client Portal bills: the client sees its own sent and paid bills only, never drafts or cost", async () => {
  const cu = "00000000-0000-0000-0000-0000000000c9";
  await asSuper("insert into auth.users (id, email) values ($1, 'ap@fcl.example')", [cu]);
  ids.fclient = cu;
  await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [cu, client.id]);
  const sent = await makePo(sA, { value: 1000 });
  const draft = await makePo(sA, { value: 500 });
  const { rows: [{ id: sentBill }] } = await as("finance", "select public.finance_bill_create($1, 0, null) as id", [sent.est]);
  await as("finance", "select public.finance_bill_create($1, 0, null)", [draft.est]);
  await as("finance", "select public.finance_bill_send($1)", [sentBill]);
  const bills = (await one("fclient", "select public.client_portal_bills() b")).b;
  assert.ok(bills.some((b) => b.id === sentBill));
  assert.ok(bills.every((b) => ["sent", "paid", "overdue"].includes(b.status)));
  assert.ok(bills.every((b) => !("cost_amount" in b)));
  assert.equal((await one("vA", "select public.client_portal_bills() b")).b.length, 0);
});

test("Finance+ health view and vendor isolation of internal views", async () => {
  const h = (await as("finance", "select metric, value from public.watchtower_health_finance")).rows;
  assert.ok(h.find((r) => r.metric === "pos_over_invoiced" && Number(r.value) >= 1));
  assert.equal((await as("vA", "select * from public.v_supplier_invoices")).rows.length, 0);
  assert.equal((await as("vA", "select * from public.v_finance_spend")).rows.length, 0);
  assert.equal((await one("vA", "select public.finance_rule_value('FR-TOL', 0) v")).v, null);
});
