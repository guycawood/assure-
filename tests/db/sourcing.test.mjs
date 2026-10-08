// Sourcing+ / RFQ+ / Order Management+: job numbering, triage, eligible pool, control-matrix minimum quotes,
// high-value alerts, sealed bidding, due dates, finance gate, award (losers declined), estimates, outbox, DOA on POs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const year = new Date().getFullYear();

const V = {
  vA: "00000000-0000-0000-0000-0000000000b1",
  vB: "00000000-0000-0000-0000-0000000000b2",
  vE: "00000000-0000-0000-0000-0000000000b5",
};
Object.assign(ids, V);

async function lib(key, code, name, data) {
  const { rows } = await asSuper(
    "insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id",
    [key, code, name, JSON.stringify(data)],
  );
  return rows[0].id;
}
async function supplier(code, name, market, email) {
  const { rows } = await asSuper(
    "insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,$3,'EMEA',$4) returning id",
    [code, name, market, email],
  );
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [rows[0].id]);
  return rows[0].id;
}

// ---------- fixtures ----------
const subId = await lib("substrates", "SB-T350", "Test board 350gsm", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
await lib("sourcing_control_matrix", "T-SCM-1", "Under 5k", { min_value_eur: 0, max_value_eur: 4999.99, suppliers_in_country: 3, suppliers_cross_border: 0 });
await lib("sourcing_control_matrix", "T-SCM-2", "5k to 25k", { min_value_eur: 5000, max_value_eur: 24999.99, suppliers_in_country: 3, suppliers_cross_border: 2 });
await lib("sourcing_control_matrix", "T-SCM-3", "25k and over", { min_value_eur: 25000, max_value_eur: null, suppliers_in_country: 4, suppliers_cross_border: 3 });
await lib("high_value_thresholds", "HV-DE", "Germany", { market: "Germany", threshold: 40000, currency: "EUR" });
await lib("bypass_reasons", "BYP-T", "Sole supplier", {});
await lib("doa_levels", "T-L0", "Up to 5,000", { approval_level: 0, max_approval_amount: 5000, currency: "EUR" });
await lib("doa_levels", "T-L1", "Up to 25,000", { approval_level: 1, max_approval_amount: 25000, currency: "EUR" });
await lib("doa_levels", "T-L2", "Uncapped", { approval_level: 2, max_approval_amount: null, currency: "EUR" });

const sA = await supplier("T-A", "Alpha Print", "Germany", "a@alpha.example");
const sB = await supplier("T-B", "Beta Display", "Germany", "b@beta.example");
const sC = await supplier("T-C", "Gamma Board", "Germany", "c@gamma.example");
const sD = await supplier("T-D", "Delta Blocked", "Germany", "d@delta.example"); // left blocked below
await asSuper("update public.supplier_gates set status = 'missing' where supplier_id = $1 and gate_key = 'msa'", [sD]);
const sE = await supplier("T-E", "Epsilon France", "France", "e@eps.example");
await lib("rate_cards", "RC-T1", "A2 poster 350gsm", { spec_type: "2d", substrate_code: "SB-T350", finished_length_mm: 600, finished_width_mm: 400, min_qty: 100, max_qty: 5000, unit_price: 2, currency: "EUR", supplier_code: "T-A" });

for (const [k, email] of [["vA", "a@alpha.example"], ["vB", "b@beta.example"], ["vE", "e@eps.example"]]) {
  await asSuper("insert into auth.users (id, email) values ($1, $2)", [V[k], email]);
}
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0), ($2, false, 1), ($3, false, 2)", [ids.lead, ids.head, ids.admin2]);

const { rows: [client] } = await asSuper(
  "insert into public.sourcing_clients (code, name, min_quotes_required, quote_tolerance_percent, default_markup_percent, savings_target_percent, e_tender_threshold) values ('TCL','Test Client',3,10,15,5,8000) returning id",
);
const { rows: [be] } = await asSuper("insert into public.sourcing_billing_entities (code, name, region, market) values ('BE-DE','adm Indicia GmbH','EMEA','Germany') returning id");

async function newJob(title = "Summer POS") {
  const { rows } = await as("agent", "insert into public.jobs (title, client_id, billing_entity_id, region, market, budget) values ($1,$2,$3,'EMEA','Germany',50000) returning id, job_number", [title, client.id, be.id]);
  return rows[0];
}
async function newSpec(jobId, { title = "A2 poster", len = 600, wid = 400, qty = 1000, sub = subId } = {}) {
  const { rows: [s] } = await as("agent", "insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id) values ($1,$2,'2d','mm',$3) returning id", [jobId, title, sub]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',$2,$3,$4)", [s.id, qty, len, wid]);
  return s.id;
}
const future = () => new Date(Date.now() + 7 * 864e5).toISOString();

// ---------- tests ----------
test("job numbers come from a sequence; number, status and author can't be set by users", async () => {
  const a = await newJob("Job one");
  const b = await newJob("Job two");
  assert.match(a.job_number, new RegExp(`^JB-${year}-\\d{5}$`));
  assert.equal(Number(b.job_number.slice(-5)), Number(a.job_number.slice(-5)) + 1);
  await rejects(as("agent", "insert into public.jobs (job_number, title, client_id, region, market) values ('JB-1999-00001','x',$1,'EMEA','Germany')", [client.id]), /permission denied/);
  await rejects(as("agent", "update public.jobs set status = 'closed' where id = $1", [a.id]), /permission denied/);
  await rejects(as("agent", "select public.job_set_status($1, 'closed', null)", [a.id]), /can't move from open to closed/);
  await as("agent", "select public.job_set_status($1, 'cancelled', 'Duplicate')", [a.id]);
  const vendor = await as("vA", "select count(*)::int n from public.jobs");
  assert.equal(vendor.rows[0].n, 0);
});

test("specs copy region/market, reference substrates through library_refs", async () => {
  const j = await newJob();
  const s = await newSpec(j.id);
  const r = await as("agent", "select region, market, spec_no from public.job_specs where id = $1", [s]);
  assert.deepEqual([r.rows[0].region, r.rows[0].market, r.rows[0].spec_no], ["EMEA", "Germany", 1]);
  const ref = await as("agent", "select count(*)::int n from public.library_refs where record_id = $1 and ref_id = $2", [subId, s]);
  assert.equal(ref.rows[0].n, 1);
  await rejects(as("admin", "select public.library_delete($1, null)", [subId]), /In use/);
});

test("triage routes Adopt / Push / Create by rule and blocks RFQs for non-Create lines", async () => {
  const j = await newJob();
  const exact = await newSpec(j.id, { title: "Exact" });
  const near = await newSpec(j.id, { title: "Near", len: 620, wid: 400 }); // ~3.3% bigger
  const other = await newSpec(j.id, { title: "Odd size", len: 1200, wid: 900 });
  const route = async (id) => {
    const { rows: [{ tid }] } = await as("agent", "select public.spec_triage_run($1) as tid", [id]);
    return (await as("agent", "select route, confidence, unit_price from public.spec_triage where id = $1", [tid])).rows[0];
  };
  const a = await route(exact);
  assert.equal(a.route, "adopt");
  assert.equal(Number(a.unit_price), 2);
  const n = await route(near);
  assert.equal(n.route, "push"); // confidence ~0.967 >= 0.90 and supplier eligible
  assert.ok(Number(n.unit_price) > 2);
  assert.equal((await route(other)).route, "create");
  await rejects(as("agent", "select public.rfq_create($1,'x',$2,null,$3)", [j.id, future(), JSON.stringify([{ spec_id: exact, quantity_breaks: [1000] }])]), /routed Adopt/);
  // only a lead routes away from Create; anyone can send to Create
  await rejects(as("agent", "select public.spec_triage_override($1,'adapt','cheaper')", [other]), /no rate-card price|Only a sourcing lead/);
  await as("agent", "select public.spec_triage_override($1,'create','Client wants competition')", [exact]);
  // vendor A accepts the pushed price via the portal function; vendor B can't see it
  const push = await as("vA", "select public.triage_push_list() as l");
  assert.equal(push.rows[0].l.length, 1);
  assert.equal((await as("vB", "select public.triage_push_list() as l")).rows[0].l.length, 0);
  await rejects(as("vB", "select public.triage_push_respond($1, true, null)", [push.rows[0].l[0].id]), /not found/);
  await as("vA", "select public.triage_push_respond($1, true, null)", [push.rows[0].l[0].id]);
});

let rfq, job, spec;
test("supplier selection only from the eligible pool; minimum quotes enforced at send", async () => {
  job = await newJob("RFQ job");
  spec = await newSpec(job.id, { title: "Big banner", len: 2000, wid: 1000, qty: 5000 });
  await as("agent", "select public.spec_triage_run($1)", [spec]);
  const lines = JSON.stringify([{ spec_id: spec, quantity_breaks: [5000, 1000, 10000], target_prices: [2.5, 3, 2.2], show_targets: false }]);
  const { rows: [r] } = await as("agent", "select public.rfq_create($1,'Banners',$2,null,$3) as id", [job.id, future(), lines]);
  rfq = r.id;
  const v = await as("agent", "select estimated_value, rfq_number, high_value_alert from public.rfqs where id = $1", [rfq]);
  assert.equal(Number(v.rows[0].estimated_value), 12500);
  assert.match(v.rows[0].rfq_number, new RegExp(`^RFQ-${year}-\\d{5}$`));
  assert.equal(v.rows[0].high_value_alert, false);

  const pool = await as("agent", "select id from public.v_eligible_suppliers");
  assert.ok(!pool.rows.some((x) => x.id === sD));
  await rejects(as("agent", "select public.rfq_set_suppliers($1,$2)", [rfq, JSON.stringify([sA, sD])]), /not eligible/);
  await as("agent", "select public.rfq_set_suppliers($1,$2)", [rfq, JSON.stringify([sA, sB])]);
  await rejects(as("agent", "select public.rfq_send($1)", [rfq]), /2 invited, at least 3 needed/);
  await rejects(as("agent", "insert into public.rfq_invitations (rfq_id, supplier_id) values ($1,$2)", [rfq, sC]), /permission denied/);
  await as("agent", "select public.rfq_set_suppliers($1,$2)", [rfq, JSON.stringify([sA, sB, sC])]);
  await as("agent", "select public.rfq_send($1)", [rfq]);
  const sent = await as("agent", "select status, min_quotes_required from public.rfqs where id = $1", [rfq]);
  assert.deepEqual([sent.rows[0].status, sent.rows[0].min_quotes_required], ["sent", 3]);
  const js = await as("agent", "select status from public.jobs where id = $1", [job.id]);
  assert.equal(js.rows[0].status, "quoting");
  await rejects(as("agent", "update public.spec_versions set quantity = 1 where spec_id = $1", [spec]), /locked/);
});

test("high-value RFQs are flagged at creation and need a different sourcing lead to approve before sending", async () => {
  const j = await newJob("Big job");
  const s = await newSpec(j.id, { title: "Gondola", len: 3000, wid: 2000, qty: 100 });
  await as("lead", "select public.spec_triage_run($1)", [s]);
  const { rows: [r] } = await as("lead", "select public.rfq_create($1,'Gondolas',$2,45000,$3) as id", [j.id, future(), JSON.stringify([{ spec_id: s, quantity_breaks: [100] }])]);
  const f = await as("lead", "select high_value_alert, high_value_threshold from public.rfqs where id = $1", [r.id]);
  assert.equal(f.rows[0].high_value_alert, true);
  await as("lead", "select public.rfq_set_suppliers($1,$2)", [r.id, JSON.stringify([sA, sB, sC, sE])]);
  await rejects(as("lead", "select public.rfq_send($1)", [r.id]), /High-value RFQ/);
  await rejects(as("lead", "select public.rfq_approve_high_value($1,'ok')", [r.id]), /different person/);
  await rejects(as("agent", "select public.rfq_approve_high_value($1,'ok')", [r.id]), /Only a sourcing lead/);
  await as("admin", "select public.rfq_approve_high_value($1,'Seasonal flagship')", [r.id]);
  await as("lead", "select public.rfq_send($1)", [r.id]); // 4 suppliers meets the 25k+ band
});

let quoteA, quoteB;
test("sealed bidding: vendors only see their own invitation and quote", async () => {
  const lines = (await as("agent", "select id from public.rfq_lines where rfq_id = $1", [rfq])).rows;
  const price = (p1, p2) => JSON.stringify([{ line_id: lines[0].id, quantity: 5000, unit_price: p1 }, { line_id: lines[0].id, quantity: 1000, unit_price: p2 }]);
  await rejects(as("vA", "select public.rfq_submit_quote($1,$2,10,null,true)", [rfq, JSON.stringify([{ line_id: lines[0].id, quantity: 1000, unit_price: 3 }])]), /first quantity break/);
  quoteA = (await as("vA", "select public.rfq_submit_quote($1,$2,10,'A',true) as id", [rfq, price(2.0, 2.6)])).rows[0].id;
  quoteB = (await as("vB", "select public.rfq_submit_quote($1,$2,12,'B',true) as id", [rfq, price(2.4, 2.9)])).rows[0].id;

  const direct = await as("vB", "select count(*)::int n from public.rfq_responses");
  assert.equal(direct.rows[0].n, 0);
  const prices = await as("vB", "select count(*)::int n from public.rfq_response_prices");
  assert.equal(prices.rows[0].n, 0);
  const view = await as("vB", "select public.rfq_vendor_view($1) as v", [rfq]);
  assert.equal(view.rows[0].v.quote.id, quoteB);
  assert.equal(view.rows[0].v.lines[0].target_prices, null); // targets not shared
  assert.ok(!JSON.stringify(view.rows[0].v).includes(quoteA));
  assert.ok(!JSON.stringify(view.rows[0].v).includes("2.6"));
  await rejects(as("vE", "select public.rfq_vendor_view($1)", [rfq]), /Not invited/);
  await rejects(as("vE", "select public.rfq_submit_quote($1,$2,1,null,true)", [rfq, price(1, 1)]), /Not invited/);
  const list = await as("vA", "select public.rfq_vendor_list() as l");
  assert.ok(list.rows[0].l.some((x) => x.rfq_id === rfq && x.quote_status === "submitted"));
  assert.ok(!(await as("vE", "select public.rfq_vendor_list() as l")).rows[0].l.some((x) => x.rfq_id === rfq));
});

test("vendors can't award, and can't quote or decline after the due date", async () => {
  await rejects(as("vA", "select public.rfq_award($1,$2,'me',null)", [rfq, quoteA]), /Only internal/);
  await rejects(as("vA", "update public.rfq_responses set status = 'awarded' where id = $1", [quoteA]), /permission denied/);
  await rejects(as("agent", "select public.rfq_award($1,$2,'Lowest',null)", [rfq, quoteA]), /Bidding is still open/);
  await asSuper("update public.rfqs set due_at = now() - interval '1 minute' where id = $1", [rfq]);
  const lines = (await as("agent", "select id from public.rfq_lines where rfq_id = $1", [rfq])).rows;
  await rejects(as("vA", "select public.rfq_submit_quote($1,$2,10,null,true)", [rfq, JSON.stringify([{ line_id: lines[0].id, quantity: 5000, unit_price: 1 }])]), /due date has passed/);
  await rejects(as("vB", "select public.rfq_decline($1,'too late')", [rfq]), /due date has passed/);
});

test("award: finance gate, Assure+ block at award time, minimum valid quotes or bypass, losers declined", async () => {
  await rejects(as("agent", "select public.rfq_award($1,$2,'Lowest',null)", [rfq, quoteA]), /Finance has not approved/);
  await rejects(as("agent", "select public.rfq_finance_decide($1,true,null)", [quoteA]), /Only Finance/);
  await as("finance", "select public.rfq_finance_decide($1,true,'Within budget')", [quoteA]);
  // 2 valid quotes against a minimum of 3
  await rejects(as("agent", "select public.rfq_award($1,$2,'Lowest',null)", [rfq, quoteA]), /Only 2 valid quote/);
  await rejects(as("agent", "select public.rfq_award($1,$2,'Lowest','NOPE')", [rfq, quoteA]), /bypass reason/);
  // supplier becomes blocked in Assure+ before award
  await asSuper("update public.supplier_gates set status = 'missing' where supplier_id = $1 and gate_key = 'msa'", [sA]);
  await rejects(as("agent", "select public.rfq_award($1,$2,'Lowest','BYP-T')", [rfq, quoteA]), /blocked for purchasing/);
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1 and gate_key = 'msa'", [sA]);

  const { rows: [{ id: est }] } = await as("agent", "select public.rfq_award($1,$2,'Lowest price, good lead time','BYP-T') as id", [rfq, quoteA]);
  const st = await as("agent", "select id, status from public.rfq_responses where rfq_id = $1", [rfq]);
  const byId = Object.fromEntries(st.rows.map((r) => [r.id, r.status]));
  assert.equal(byId[quoteA], "awarded");
  assert.equal(byId[quoteB], "declined");
  const e = await as("agent", "select base_cost, benchmark_value, savings_vs_target, sell_price, status from public.estimates where id = $1", [est]);
  assert.equal(Number(e.rows[0].base_cost), 10000); // 5000 x 2.00
  assert.equal(Number(e.rows[0].benchmark_value), 11000); // avg(2.0, 2.4) = 2.2 within 10%
  assert.equal(Number(e.rows[0].savings_vs_target), 2500); // target 2.5 x 5000 - 10000
  assert.equal(Number(e.rows[0].sell_price), 11500); // 15% markup
  const audit = await as("agent", "select event from public.sourcing_events where entity_id = $1 and event = 'awarded'", [rfq]);
  assert.equal(audit.rows.length, 1);
  globalThis.__est = est;
});

test("estimate (margin), client approval writes estimate.approved to the integration outbox", async () => {
  const est = globalThis.__est;
  await rejects(as("agent", "select public.estimate_set_pricing($1,'margin',100)", [est]), /valid percentage/);
  await as("agent", "select public.estimate_set_pricing($1,'margin',20)", [est]);
  const e = await as("agent", "select sell_price from public.estimates where id = $1", [est]);
  assert.equal(Number(e.rows[0].sell_price), 12500); // 10000 / 0.8
  await rejects(as("agent", "select public.po_create_from_estimate($1)", [est]), /must approve the estimate/);
  await rejects(as("agent", "select public.estimate_approve($1,'PO-CL-1')", [est]), /Send the estimate/);
  await as("agent", "select public.estimate_send($1)", [est]);
  await as("agent", "select public.estimate_approve($1,'PO-CL-1')", [est]);
  const o = await as("agent", "select event, payload from public.integration_outbox where aggregate_id = $1", [est]);
  assert.equal(o.rows[0].event, "estimate.approved");
  assert.equal(o.rows[0].payload.client_order_ref, "PO-CL-1");
  assert.equal(o.rows[0].payload.articles.length, 1);
  await rejects(as("agent", "insert into public.integration_outbox (module, event) values ('x','y')"), /permission denied/);
});

test("supplier PO: DOA level by PO date blocks a low-level approver; vendor accepts", async () => {
  const est = globalThis.__est;
  const { rows: [{ id: po }] } = await as("agent", "select public.po_create_from_estimate($1, null, null) as id", [est]);
  const p = await as("agent", "select required_doa_level, po_number, exceeds_e_tender from public.purchase_orders where id = $1", [po]);
  assert.equal(p.rows[0].required_doa_level, 1); // 10,000 EUR
  assert.match(p.rows[0].po_number, new RegExp(`^PO-${year}-\\d{5}$`));
  assert.equal(p.rows[0].exceeds_e_tender, true);
  await rejects(as("agent", "select public.po_create_from_estimate($1, null, null)", [est]), /already has a live/);
  await rejects(as("agent", "select public.po_approve($1, null)", [po]), /different person/);
  await rejects(as("plain", "select public.po_approve($1, null)", [po]), /no delegated approval authority/);
  await rejects(as("lead", "select public.po_approve($1, null)", [po]), /needs DOA level 1 approval; your level is 0/);
  // vendor can't see it before approval
  assert.equal((await as("vA", "select count(*)::int n from public.purchase_orders")).rows[0].n, 0);
  await as("head", "select public.po_approve($1, 'OK')", [po]);
  const job2 = await as("agent", "select status from public.jobs where id = $1", [job.id]);
  assert.equal(job2.rows[0].status, "ordered");
  await rejects(as("vB", "select public.po_vendor_respond($1, true, null)", [po]), /not found/);
  assert.equal((await as("vA", "select public.po_vendor_list() as l")).rows[0].l.length, 1);
  await as("vA", "select public.po_vendor_respond($1, true, null)", [po]);
  await rejects(as("vA", "select public.po_vendor_respond($1, false, 'changed mind')", [po]), /already responded/);
  const fin = await as("agent", "select p.status, j.status as job_status from public.purchase_orders p join public.jobs j on j.id = p.job_id where p.id = $1", [po]);
  assert.deepEqual([fin.rows[0].status, fin.rows[0].job_status], ["accepted", "in_production"]);
});

test("Adopt and accepted Push lines go straight to an estimate", async () => {
  const j = await newJob("Rate card job");
  const s1 = await newSpec(j.id, { title: "Card poster" });
  await as("agent", "select public.spec_triage_run($1)", [s1]);
  const n = await as("agent", "select public.estimate_create_from_triage($1) as n", [j.id]);
  assert.equal(n.rows[0].n, 1);
  const e = await as("agent", "select source, base_cost, supplier_id from public.estimates where job_id = $1", [j.id]);
  assert.deepEqual([e.rows[0].source, Number(e.rows[0].base_cost), e.rows[0].supplier_id], ["adopt", 2000, sA]);
  await rejects(as("agent", "select public.estimate_create_from_triage($1)", [j.id]), /No Adopt/);
});

test("PSA exception: requester -> line manager -> procurement SME -> DOA approver -> Finance applies", async () => {
  await asSuper("update public.profiles set srt_role = 'procurement' where id = $1", [ids.plain]);
  const { rows: [{ id }] } = await as("agent", "select public.psa_create('Variable fee on banners',$1,$2,null,20000,'EUR','Client asked for rush',null,null) as id", [sA, job.id]);
  await rejects(as("lead", "select public.psa_submit($1,$2)", [id, ids.lead]), /Only the requester/);
  await rejects(as("agent", "select public.psa_submit($1,$2)", [id, ids.agent]), /not yourself/);
  await as("agent", "select public.psa_submit($1,$2)", [id, ids.lead]);
  await rejects(as("head", "select public.psa_line_manager_decide($1,true,null)", [id]), /named line manager/);
  await as("lead", "select public.psa_line_manager_decide($1,true,'Valid')", [id]);
  await rejects(as("agent", "select public.psa_assess($1,'exception_confirmed','x',20000)", [id]), /procurement SME/);
  await as("plain", "select public.psa_assess($1,'exception_confirmed','No alternative supplier',20000)", [id]);
  await rejects(as("lead", "select public.psa_approve($1,true,null)", [id]), /needs DOA level 1/);
  await as("head", "select public.psa_approve($1,true,'OK')", [id]);
  await rejects(as("agent", "select public.psa_apply($1,null)", [id]), /Only Finance/);
  await as("finance", "select public.psa_apply($1,'Review in Q4')", [id]);
  const r = await as("agent", "select stage, reference from public.psa_exceptions where id = $1", [id]);
  assert.equal(r.rows[0].stage, "applied");
  assert.match(r.rows[0].reference, /^PSA-\d{4}-\d{5}$/);
});

test("access invites by email apply on first sign-in; only admins / owners change access", async () => {
  await asSuper("insert into public.sourcing_access_invites (email, is_lead, doa_level) values ('newbie@adm-indicia.com', true, 3)");
  const uid = "00000000-0000-0000-0000-0000000000c1";
  await asSuper("insert into auth.users (id, email) values ($1, 'newbie@adm-indicia.com')", [uid]);
  const a = await as("agent", "select is_lead, doa_level from public.sourcing_user_access where user_id = $1", [uid]);
  assert.deepEqual([a.rows[0].is_lead, a.rows[0].doa_level], [true, 3]);
  await rejects(as("agent", "select public.sourcing_set_access($1, true, true, 8)", [ids.agent]), /Only admins/);
  await rejects(as("agent", "update public.sourcing_user_access set doa_level = 8 where user_id = $1", [ids.head]), /permission denied/);
  await as("admin", "select public.sourcing_set_access($1, false, false, 2)", [ids.agent]);
});

test("health view reports Sourcing+ numbers", async () => {
  const h = await as("agent", "select metric, value from public.watchtower_health_sourcing");
  const m = Object.fromEntries(h.rows.map((r) => [r.metric, Number(r.value)]));
  assert.equal(m.pos_awaiting_doa, 0);
  assert.ok("rfqs_below_min_quotes" in m && "savings_vs_target" in m);
});
