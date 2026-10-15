// QA/QC threshold management and OTIF / speed to market: the rule engine (highest level wins, explained), lowering
// needs a second person, verification at upload (complete L1 auto-verifies; expired certificate, unapproved body and
// AQL over the limit are flagged and raise an NCR), vendor isolation and the viewer gate, maker-checker on review,
// the job close gate, OTIF maths with tolerance, the journey view and client-safe KPIs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V = { vA: "00000000-0000-0000-0000-0000000000d1", vB: "00000000-0000-0000-0000-0000000000d2", vAview: "00000000-0000-0000-0000-0000000000d3",
  client: "00000000-0000-0000-0000-0000000000d4" };
Object.assign(ids, V);
const day = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA"); // local date, matching the database current_date
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

async function lib(key, code, name, data) {
  await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01')",
    [key, code, name, JSON.stringify(data)]);
}
await lib("aql_levels", "AQL-2.5", "AQL 2.5", { inspection_level: "II", critical: 0, major: 2.5, minor: 4.0 });
await lib("aql_levels", "AQL-1.5", "AQL 1.5", { inspection_level: "II", critical: 0, major: 1.5, minor: 4.0 });
await lib("qaqc_approved_bodies", "TESTINSP", "Test Inspection Co", { body_type: "inspection_agency", accredited_until: day(400) });
await lib("ncr_categories", "NCR-DOC", "Missing documents", { severity: "low" });

const sup = async (code, email) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email, active, purchasing_blocked) values ($1,$1,'Germany','EMEA',$2,true,false) returning id", [code, email])).rows[0].id;
const sA = await sup("Q-A", "qa@alpha-q.example");
const sB = await sup("Q-B", "qb@beta-q.example");
await asSuper("insert into public.performance_records (supplier_id, period, quality_score) values ($1,'2026-Q2',85), ($2,'2026-Q2',85)", [sA, sB]);
await asSuper("insert into auth.users (id, email) values ($1,'qa@alpha-q.example'), ($2,'qb@beta-q.example'), ($3,'buyer@client-q.example')", [V.vA, V.vB, V.client]);
await as("vA", "select public.vendor_team_invite('view@alpha-q.example','viewer')");
await asSuper("insert into auth.users (id, email) values ($1,'view@alpha-q.example')", [V.vAview]);
const cA = (await asSuper("insert into public.sourcing_clients (code, name) values ('QCA','QA Client A') returning id")).rows[0].id;
const cB = (await asSuper("insert into public.sourcing_clients (code, name) values ('QCB','QA Client B') returning id")).rows[0].id;
await asSuper("update public.profiles set user_type = 'client', supplier_id = null where id = $1", [V.client]);
await asSuper("insert into public.client_users (user_id, client_id, role) values ($1,$2,'approver')", [V.client, cA]);

// A PO with one line, issued through a status change (the trigger makes the QA/QC plan), then accepted by the vendor.
async function makePo({ supplierId = sA, clientId = cA, spec = {}, value = 1000, qty = 100, delivery = day(20) } = {}) {
  const job = await one("agent", "insert into public.jobs (title, client_id, region, market) values ('QA job',$1,'EMEA','Germany') returning id", [clientId]);
  const s = await one("agent", `insert into public.job_specs (job_id, title, spec_type, has_lighting_electronics, testing_checklist, recycled_content_percent, product_category)
    values ($1,'QA item',$2,$3,$4,$5,$6) returning id`, [job.id, spec.type ?? "2d", spec.electronics ?? false, spec.tests ?? [], spec.recycled ?? null, spec.category ?? null]);
  const est = (await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','EUR',$3,'EMEA','Germany','approved') returning id",
    [job.id, supplierId, value])).rows[0];
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,1,$4)", [est.id, s.id, qty, value]);
  const po = (await asSuper(`insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, required_doa_level, status, region, market, created_by)
    values ($1,$2,$3,'EUR',$4,current_date,$5,0,'pending_approval','EMEA','Germany',$6) returning id`, [job.id, est.id, supplierId, value, delivery, ids.agent])).rows[0];
  await asSuper("update public.purchase_orders set status = 'issued', approved_at = now() where id = $1", [po.id]);
  await asSuper("update public.purchase_orders set status = 'accepted', vendor_responded_at = now() where id = $1", [po.id]);
  const plan = (await asSuper("select * from public.qaqc_plans where po_id = $1", [po.id])).rows[0];
  return { job: job.id, spec: s.id, po: po.id, plan };
}
const cp = async (planId, name) => (await asSuper("select * from public.qaqc_checkpoints where plan_id = $1 and checkpoint = $2", [planId, name])).rows[0];
async function upload(user, checkpointId, supplierId, type = "application/pdf", label = "QA") {
  return (await one(user, "select public.file_register('orders','qaqc_checkpoint',$1,$2,'e.pdf',$3,10,'aGVsbG8=',null,$4) id", [checkpointId, supplierId, type, label])).id;
}

test("rule engine: the highest applicable level wins and every rule that fired is explained", async () => {
  const P = await makePo({ spec: { electronics: true, tests: ["drop_test"] } });
  assert.equal(P.plan.computed_level, 3);
  assert.equal(P.plan.required_level, 3);
  const codes = P.plan.rules_fired.map((r) => r.code).sort();
  assert.deepEqual(codes, ["QR-ELEC", "QR-TEST-PHYS"]);
  assert.ok(P.plan.rules_fired.every((r) => r.explanation.length > 10));
  // A lab test on the spec lifts it to L5; staff can ask the engine directly.
  const r = (await one("agent", "select public.qaqc_required_level(null, $1) r", [(await makePo({ spec: { electronics: true, tests: ["lab_test"] } })).spec])).r;
  assert.equal(r.level, 5);
  assert.ok(r.rules.some((x) => x.code === "QR-TEST-LAB"));
  // A new (unrated) supplier adds one level on top.
  const sN = await sup("Q-N", "qn@new-q.example");
  const N = await makePo({ supplierId: sN, spec: { electronics: true } });
  assert.equal(N.plan.computed_level, 4);
  assert.ok(N.plan.rules_fired.some((x) => x.code === "QR-SUP-NEW" && x.effect === "bump"));
  // Checkpoints follow the level (L3: mock-up, production, pre-shipment).
  const cps = (await asSuper("select checkpoint from public.qaqc_checkpoints where plan_id = $1 order by seq", [P.plan.id])).rows.map((x) => x.checkpoint);
  assert.deepEqual(cps, ["mockup", "production", "pre_shipment"]);
  await rejects(as("vA", "select public.qaqc_required_level($1, null)", [P.po]), /Only adm Indicia staff/);
});

test("raising needs a reason; lowering below the computed level needs a quality role who did not ask", async () => {
  const P = await makePo({ spec: { electronics: true } });
  await rejects(as("agent", "select public.qaqc_set_level($1, 4, '')", [P.plan.id]), /Say why/);
  assert.equal((await one("agent", "select public.qaqc_set_level($1, 4, 'Client asked') r", [P.plan.id])).r, "applied");
  assert.equal((await one("agent", "select public.qaqc_set_level($1, 2, 'Repeat job') r", [P.plan.id])).r, "pending");
  assert.equal((await asSuper("select required_level from public.qaqc_plans where id = $1", [P.plan.id])).rows[0].required_level, 4);
  const req = (await asSuper("select id from public.approval_requests where approval_type = 'QAQC_LOWER' and entity_id = $1 and status = 'pending'", [P.plan.id])).rows[0];
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else|quality/);
  await rejects(as("finance", "select public.approval_request_decide($1, true, null)", [req.id]), /quality/);
  await as("head", "select public.approval_request_decide($1, true, 'ok')", [req.id]);
  const pl = (await asSuper("select required_level from public.qaqc_plans where id = $1", [P.plan.id])).rows[0];
  assert.equal(pl.required_level, 2);
  assert.equal((await asSuper("select status from public.qaqc_checkpoints where plan_id = $1 and checkpoint = 'mockup'", [P.plan.id])).rows[0].status, "withdrawn");
});

let L1;
test("upload verification: a complete L1 auto-verifies and the plan passes", async () => {
  L1 = await makePo();
  assert.equal(L1.plan.required_level, 1);
  const c = await cp(L1.plan.id, "pre_shipment");
  const f = await upload("vA", c.id, sA);
  const r = (await one("vA", "select public.qaqc_vendor_submit($1, $2, $3) r", [c.id, JSON.stringify([{ type: "COC", file_id: f, issued_on: day(0) }]), JSON.stringify({ result: "pass" })])).r;
  assert.equal(r.status, "auto_verified", JSON.stringify(r.checks.filter((x) => !x.ok)));
  assert.equal((await asSuper("select status from public.qaqc_plans where id = $1", [L1.plan.id])).rows[0].status, "passed");
  assert.equal((await asSuper("select first_time_pass from public.qaqc_checkpoints where id = $1", [c.id])).rows[0].first_time_pass, true);
});

test("upload verification flags an expired certificate, an unapproved body and AQL over the limit (NCR raised)", async () => {
  // Recycled content -> certificate required; expired.
  const S = await makePo({ spec: { recycled: 30 } });
  const c1 = await cp(S.plan.id, "pre_shipment");
  assert.deepEqual(c1.required_evidence.sort(), ["CERTIFICATE", "COC|DECLARATION"]);
  const f1 = await upload("vA", c1.id, sA), f2 = await upload("vA", c1.id, sA);
  const r1 = (await one("vA", "select public.qaqc_vendor_submit($1,$2,$3) r", [c1.id, JSON.stringify([
    { type: "COC", file_id: f1, issued_on: day(0) },
    { type: "CERTIFICATE", file_id: f2, certificate_number: "FSC-1", expires_on: day(-3), body_code: "TESTINSP" }]), JSON.stringify({ result: "pass" })])).r;
  assert.equal(r1.status, "needs_review");
  assert.equal(r1.checks.find((x) => x.code === "expiry").ok, false);
  const after1 = (await asSuper("select failed, ncr_id from public.qaqc_checkpoints where id = $1", [c1.id])).rows[0];
  assert.equal(after1.failed, true);
  assert.ok(after1.ncr_id, "an NCR is raised in SRM quality");
  assert.equal((await asSuper("select status from public.qaqc_plans where id = $1", [S.plan.id])).rows[0].status, "failed");
  assert.equal((await asSuper("select po_reference from public.ncrs where id = $1", [after1.ncr_id])).rows[0].po_reference !== null, true);

  // Client minimum L4 -> independent inspection: unapproved body and too many defects.
  await asSuper("update public.sourcing_clients set qa_min_level = 4 where id = $1", [cB]);
  const I = await makePo({ clientId: cB });
  assert.equal(I.plan.required_level, 4);
  assert.ok(I.plan.rules_fired.some((x) => x.code === "QR-CLIENT"));
  const c2 = await cp(I.plan.id, "pre_shipment");
  const f3 = await upload("vA", c2.id, sA);
  const r2 = (await one("vA", "select public.qaqc_vendor_submit($1,$2,$3) r", [c2.id, JSON.stringify([
    { type: "INSPECTION_REPORT", file_id: f3, inspection_date: day(0), body_code: "NOT-APPROVED", sample_size: 125, defects_major: 9, result: "pass" }]), JSON.stringify({ result: "pass" })])).r;
  assert.equal(r2.status, "needs_review");
  assert.equal(r2.checks.find((x) => x.code === "body").ok, false);
  const aql = r2.checks.find((x) => x.code === "aql");
  assert.equal(aql.ok, false);
  assert.match(aql.detail, /9 major defects in a sample of 125, 7 allowed/);
  // Within limits from an approved body: L4 still needs a review (no auto-verify), no hard failure.
  const c3 = await cp(I.plan.id, "mockup");
  const f4 = await upload("vA", c3.id, sA);
  const r3 = (await one("vA", "select public.qaqc_vendor_submit($1,$2,$3) r", [c3.id, JSON.stringify([{ type: "SAMPLE_APPROVAL", file_id: f4, issued_on: day(0) }]), JSON.stringify({ result: "pass" })])).r;
  assert.equal(r3.status, "needs_review");
  assert.equal(r3.ok, true);
  assert.equal((await one("agent", "select public.qaqc_aql_accept(125, 2.5) a")).a, 7);
  assert.equal((await one("agent", "select public.qaqc_aql_accept(80, 1.0) a")).a, 2);
});

test("vendors see and submit only for their own POs; viewers are blocked", async () => {
  const P = await makePo();
  const c = await cp(P.plan.id, "pre_shipment");
  const mine = (await one("vA", "select public.qaqc_vendor_plans() p")).p;
  assert.ok(mine.some((x) => x.id === P.plan.id));
  assert.equal((await one("vB", "select public.qaqc_vendor_plans() p")).p.some((x) => x.id === P.plan.id), false);
  assert.equal((await as("vA", "select count(*)::int n from public.qaqc_plans")).rows[0].n, 0);
  const fB = await upload("vB", c.id, sB);
  await rejects(as("vB", "select public.qaqc_vendor_submit($1,$2,$3)", [c.id, JSON.stringify([{ type: "COC", file_id: fB, issued_on: day(0) }]), "{}"]), /not found/);
  await rejects(as("vAview", "select public.qaqc_vendor_submit($1,$2,$3)", [c.id, "[]", "{}"]), /view-only/);
  // A file uploaded against another checkpoint can't be reused.
  const other = await cp(L1.plan.id, "pre_shipment");
  const fOther = await upload("vA", other.id, sA);
  await rejects(as("vA", "select public.qaqc_vendor_submit($1,$2,$3)", [c.id, JSON.stringify([{ type: "COC", file_id: fOther, issued_on: day(0) }]), "{}"]), /verified|against this checkpoint/);
});

let REV;
test("review: a quality role verifies, never the uploader; rejections need a reason", async () => {
  REV = await makePo({ clientId: cB }); // L4
  const c = await cp(REV.plan.id, "mockup");
  const { rows: [f] } = await as("lead", "select public.file_register('orders','qaqc_checkpoint',$1,$2,'m.pdf','application/pdf',10,'aGVsbG8=',null,'M') id", [c.id, sA]);
  await as("lead", "select public.qaqc_submit($1,$2,$3)", [c.id, JSON.stringify([{ type: "SAMPLE_APPROVAL", file_id: f.id, issued_on: day(0) }]), JSON.stringify({ result: "pass" })]);
  await rejects(as("lead", "select public.qaqc_review_checkpoint($1, true, null)", [c.id]), /You uploaded this evidence/);
  await rejects(as("agent", "select public.qaqc_review_checkpoint($1, true, null)", [c.id]), /quality/);
  await rejects(as("vA", "select public.qaqc_review_checkpoint($1, true, null)", [c.id]), /adm Indicia staff/);
  // Shows in the approvals inbox for a quality role who did not upload it.
  assert.ok((await as("head", "select * from public.approvals_inbox('mine')")).rows.some((x) => x.approval_type === "QAQC_VERIFY" && x.item_id === c.id));
  assert.equal((await as("lead", "select * from public.approvals_inbox('mine')")).rows.some((x) => x.item_id === c.id), false);
  await rejects(as("head", "select public.qaqc_review_checkpoint($1, false, '')", [c.id]), /Say what is wrong/);
  await as("head", "select public.qaqc_review_checkpoint($1, true, null)", [c.id]);
  assert.equal((await asSuper("select status from public.qaqc_checkpoints where id = $1", [c.id])).rows[0].status, "verified");
});

test("job close is blocked until QA/QC passed (or an approved waiver)", async () => {
  const chk = async () => (await one("agent", "select public.job_close_check($1) c", [REV.job])).c.checks.find((x) => x.key === "qaqc");
  assert.equal((await chk()).ok, false);
  await asSuper("select set_config('sourcing.system_write','on',false)");
  await asSuper("update public.jobs set status = 'delivered' where id = $1", [REV.job]);
  await asSuper("select set_config('sourcing.system_write','off',false)");
  await rejects(as("agent", "select public.execution_close_job($1,'override')", [REV.job]), /QA\/QC passed at the required level/);
  await as("agent", "select public.qaqc_request_waiver($1, 'Client accepted on concession')", [REV.plan.id]);
  const req = (await asSuper("select id from public.approval_requests where approval_type = 'QAQC_WAIVE' and entity_id = $1", [REV.plan.id])).rows[0];
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else|quality/);
  await as("lead", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await chk()).ok, true);
  // Jobs without QA/QC plans are unaffected.
  const job = await one("agent", "insert into public.jobs (title, client_id, region, market) values ('No QA',$1,'EMEA','Germany') returning id", [cA]);
  assert.equal((await one("agent", "select public.job_close_check($1) c", [job.id])).c.checks.find((x) => x.key === "qaqc").ok, true);
});

test("OTIF: on time against the POD timestamp with tolerance, in full against the ordered quantity", async () => {
  const P = await makePo({ supplierId: sB, clientId: cB, delivery: day(-5) });
  const mk = async (qty, shipped, podDay, tm = "15:00") => {
    const d = (await asSuper(`insert into public.deliveries (po_id, job_id, supplier_id, spec_id, quantity, region, market, planned_delivery_date, status)
      values ($1,$2,$3,$4,$5,'EMEA','DE',$6,'booked') returning id`, [P.po, P.job, sB, P.spec, qty, day(-5)])).rows[0].id;
    await asSuper(`insert into public.shipments (delivery_id, supplier_id, dispatch_date, quantity_shipped, pod_status, pod_received_at, pod_captured_at)
      values ($1,$2,$3,$4,'verified',now(),($5::date + $6::time)::timestamptz)`, [d, sB, day(-10), shipped, day(podDay), tm]);
    await asSuper("update public.deliveries set status = 'delivered', actual_delivery_date = $2 where id = $1", [d, day(podDay)]);
    return d;
  };
  const dOn = await mk(10, 10, -5, "23:00");   // on the promised day, late evening
  const dLate = await mk(10, 10, -4);          // a day late
  const dShort = await mk(10, 9, -6);          // early but short
  const row = async (id) => (await as("agent", "select on_time, in_full, otif, days_late from public.v_otif_deliveries where delivery_id = $1", [id])).rows[0];
  assert.deepEqual(await row(dOn), { on_time: true, in_full: true, otif: true, days_late: 0 });
  assert.deepEqual(await row(dLate), { on_time: false, in_full: true, otif: false, days_late: 1 });
  assert.deepEqual(await row(dShort), { on_time: true, in_full: false, otif: false, days_late: -1 });
  const po = (await as("agent", "select deliveries, otif, otif_percent from public.v_otif_summary where dimension = 'po' and key = $1", [P.po])).rows[0];
  assert.deepEqual([po.deliveries, po.otif, Number(po.otif_percent)], [3, 1, 33.3]);
  // One day of tolerance: the late one becomes on time (one definition: v_supplier_otif and v_deliveries agree).
  await asSuper("update public.library_records set data = '{\"value\":1}' where library_key = 'qaqc_settings' and code = 'OTIF-TOL-DAYS'");
  assert.equal((await row(dLate)).on_time, true);
  assert.equal((await as("agent", "select on_time from public.v_deliveries where id = $1", [dLate])).rows[0].on_time, true);
  const so = (await as("agent", "select on_time, otif from public.v_supplier_otif where supplier_id = $1", [sB])).rows[0];
  assert.deepEqual([so.on_time, so.otif], [3, 2]);
  await asSuper("update public.library_records set data = '{\"value\":0}' where library_key = 'qaqc_settings' and code = 'OTIF-TOL-DAYS'");
  assert.equal((await as("vB", "select count(*)::int n from public.v_otif_deliveries")).rows[0].n, 0);
});

test("POD capture: the stated delivery time is kept as the POD timestamp, the upload time separately", async () => {
  const P = await makePo({ supplierId: sA });
  await as("agent", "select public.logistics_plan_from_po($1)", [P.po]);
  const del = (await asSuper("select id from public.deliveries where po_id = $1", [P.po])).rows[0].id;
  await as("vA", "select public.logistics_vendor_record_shipment($1,null,null,null,$2,100)", [del, day(-2)]);
  const s = (await asSuper("select id from public.shipments where delivery_id = $1", [del])).rows[0].id;
  const f = (await one("vA", "select public.file_register('logistics','shipment',$1,$2,'pod.pdf','application/pdf',10,'aGVsbG8=',null,'POD') id", [s, sA])).id;
  const stated = `${day(-1)}T09:30:00Z`;
  await as("vA", "select public.logistics_vendor_attach_pod_at($1,$2,$3)", [s, f, stated]);
  const r = (await asSuper("select pod_captured_at, pod_received_at, pod_time_stated from public.shipments where id = $1", [s])).rows[0];
  assert.equal(new Date(r.pod_captured_at).toISOString(), new Date(stated).toISOString());
  assert.ok(r.pod_received_at > r.pod_captured_at);
  assert.equal(r.pod_time_stated, true);
  await rejects(as("vAview", "select public.logistics_vendor_attach_pod_at($1,$2,$3)", [s, f, stated]), /view-only/);
});

test("v_job_journey returns the milestones in order with timestamps; v_job_speed measures the stages", async () => {
  const rows = (await as("agent", "select seq, milestone_code, at from public.v_job_journey where job_id = $1 order by seq", [L1.job])).rows;
  const codes = rows.map((r) => r.milestone_code);
  for (const c of ["job_created", "po_issued", "po_accepted", "qaqc_passed"]) assert.ok(codes.includes(c), c);
  assert.ok(rows.every((r) => r.at));
  assert.deepEqual(rows.map((r) => r.seq), [...rows.map((r) => r.seq)].sort((a, b) => a - b));
  assert.ok(codes.indexOf("job_created") < codes.indexOf("po_issued"));
  const sp = (await as("agent", "select job_created, po_issued from public.v_job_speed where job_id = $1", [L1.job])).rows[0];
  assert.ok(sp.job_created && sp.po_issued);
  assert.equal((await as("vA", "select count(*)::int n from public.v_job_journey")).rows[0].n, 0);
});

test("client portal: client-safe KPIs for the client's own jobs only", async () => {
  const k = (await one("client", "select public.client_portal_delivery_kpis(null) k")).k;
  assert.ok(k.otif && k.qaqc && k.speed);
  assert.equal(k.ncrs, undefined);
  assert.ok(k.qaqc.plans >= 1);
  await rejects(as("client", "select public.client_portal_delivery_kpis($1)", [cB]), /do not have access/);
  const internal = (await one("agent", "select public.crm_client_delivery_kpis($1) k", [cB])).k;
  assert.ok(internal.ncrs.raised >= 0);
  await rejects(as("client", "select public.crm_client_delivery_kpis($1)", [cA]), /adm Indicia staff/);
  // Client health carries OTIF and QA/QC.
  const h = (await one("agent", "select otif_percent, qaqc_pass_percent from public.crm_client_health where client_id = $1", [cB]));
  assert.ok("otif_percent" in h && "qaqc_pass_percent" in h);
});
