// Execution+: units-fit, outlet visibility and vendor recces, stage sync from deliveries, vendor installs with photo +
// GPS evidence (distance flag), audits scored against display_scoring (weights must total 100), tickets, quality gates and job close.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const V = { vA: "00000000-0000-0000-0000-0000000000d1", vB: "00000000-0000-0000-0000-0000000000d2" };
Object.assign(ids, V);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

async function lib(key, code, name, data) {
  const { rows } = await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id", [key, code, name, JSON.stringify(data)]);
  return rows[0].id;
}
async function supplier(code, name, email) {
  const { rows } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'United Kingdom','EMEA',$3) returning id", [code, name, email]);
  return rows[0].id;
}

await lib("carriers", "CAR-T", "Test Express", { modes: ["road"] });
await lib("display_scoring", "DS-A", "Placement", { weight_percent: 60 });
await lib("display_scoring", "DS-B", "Condition", { weight_percent: 40 });
const sA = await supplier("E-A", "Alpha Installs", "a@alpha-e.example");
const sB = await supplier("E-B", "Beta Installs", "b@beta-e.example");
await asSuper("insert into auth.users (id, email) values ($1, 'a@alpha-e.example'), ($2, 'b@beta-e.example')", [V.vA, V.vB]);
const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('ECL','Execution Client') returning id");

async function makePo(supplierId, qty = 10) {
  const { rows: [job] } = await as("agent", "insert into public.jobs (title, client_id, region, market) values ('Execution job',$1,'EMEA','United Kingdom') returning id", [client.id]);
  const { rows: [spec] } = await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Gondola end','3d') returning id", [job.id]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Main',$2)", [spec.id, qty]);
  const { rows: [est] } = await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','GBP',1000,'EMEA','United Kingdom','approved') returning id", [job.id, supplierId]);
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,100,1000)", [est.id, spec.id, qty]);
  const { rows: [po] } = await asSuper("insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, status, region, market) values ($1,$2,$3,'GBP',1000,$4,0,'accepted','EMEA','United Kingdom') returning id", [job.id, est.id, supplierId, day(10)]);
  return { job: job.id, spec: spec.id, po: po.id };
}
const outletData = (code, extra = {}) => JSON.stringify({ name: `Store ${code}`, outlet_code: code, market: "GB", latitude: 51.5074, longitude: -0.1278, client_id: client.id, ...extra });
async function photo(user, depId, supplierId, label) {
  await as(user, "select public.file_register('execution','deployment',$1,$2,$3,'image/jpeg',10,'aGVsbG8gd29ybGQ=',null,$4)", [depId, supplierId, `${label}.jpg`, label]);
}

let outlet, A;
test("units fit = floor(aw/uw) x floor(ah/uh) x floor(ad/ud), depth only when both known", async () => {
  assert.equal((await as("agent", "select public.execution_units_fit(120,180,40,30,45,20) n")).rows[0].n, 32);
  assert.equal((await as("agent", "select public.execution_units_fit(120,180,null,30,45,20) n")).rows[0].n, 16);
  assert.equal((await as("agent", "select public.execution_units_fit(120,null,40,30,45,20) n")).rows[0].n, null);
  assert.equal((await as("agent", "select public.execution_units_fit(20,180,40,30,45,20) n")).rows[0].n, 0);
  outlet = (await as("agent", "select public.execution_outlet_save(null,$1) id", [outletData("GB-001", { status: "pending_survey" })])).rows[0].id;
  const o = (await as("agent", "select region, market from public.outlets where id = $1", [outlet])).rows[0];
  assert.deepEqual([o.region, o.market], ["EMEA", "GB"]);
  await rejects(as("vA", "select public.execution_outlet_save(null,$1)", [outletData("GB-X")]), /Only internal staff/);
  const r = (await as("agent", "select public.execution_recce_save(null,$1,$2) id", [outlet, JSON.stringify({ available_width_cm: 120, available_height_cm: 180, available_depth_cm: 40, unit_width_cm: 30, unit_height_cm: 45, unit_depth_cm: 20, surface_type: "gondola_end" })])).rows[0].id;
  assert.equal((await as("agent", "select units_fit from public.recces where id = $1", [r])).rows[0].units_fit, 32);
  await rejects(as("agent", "select public.execution_recce_set_status($1,'production_ready')", [r]), /recommended finished size/);
});

test("vendor recces only for outlets visible to them; recommended size stays internal; confirming activates the outlet", async () => {
  const data = JSON.stringify({ available_width_cm: 100, available_height_cm: 100, unit_width_cm: 50, unit_height_cm: 50, recommended_width_cm: 999 });
  await rejects(as("vA", "select public.execution_vendor_recce_save(null,$1,$2,false)", [outlet, data]), /not found/);
  await as("agent", "select public.execution_outlet_set_supplier($1,$2,true)", [outlet, sA]);
  assert.equal((await as("vA", "select public.execution_vendor_outlets() l")).rows[0].l.length, 1);
  assert.equal((await as("vB", "select public.execution_vendor_outlets() l")).rows[0].l.length, 0);
  const id = (await as("vA", "select public.execution_vendor_recce_save(null,$1,$2,true) id", [outlet, data])).rows[0].id;
  const r = (await as("agent", "select units_fit, status, recommended_width_cm, supplier_id, captured_by_vendor from public.recces where id = $1", [id])).rows[0];
  assert.deepEqual([r.units_fit, r.status, r.recommended_width_cm, r.supplier_id, r.captured_by_vendor], [4, "confirmed", null, sA, true]);
  assert.equal((await as("agent", "select status from public.outlets where id = $1", [outlet])).rows[0].status, "active");
  await rejects(as("vA", "select public.execution_vendor_recce_save($1,$2,$3,false)", [id, outlet, data]), /already confirmed/);
  await rejects(as("vB", "select public.execution_vendor_recce_save($1,$2,$3,false)", [id, outlet, data]), /not found/);
  assert.equal((await as("vB", "select public.execution_vendor_recces() l")).rows[0].l.length, 0);
});

let dep, dep2;
test("deployment stage follows the delivery; vendor A can't see vendor B's deployments", async () => {
  A = await makePo(sA, 10);
  const { rows: [{ id: del }] } = await as("agent", "select public.logistics_create_delivery($1,$2,null,10,$3) id", [A.po, A.spec, JSON.stringify({ market: "GB", planned_delivery_date: day(5) })]);
  await as("agent", "select public.execution_delivery_set_outlet($1,$2)", [del, outlet]);
  dep = (await as("agent", "select public.execution_deployment_create($1,$2,$3,null,6,$4,$5) id", [outlet, A.po, A.spec, day(7), del])).rows[0].id;
  dep2 = (await as("agent", "select public.execution_deployment_create($1,$2,$3,null,4,$4,$5) id", [outlet, A.po, A.spec, day(7), del])).rows[0].id;
  const stage = async (id) => (await as("agent", "select stage from public.deployments where id = $1", [id])).rows[0].stage;
  assert.equal(await stage(dep), "planned");
  await as("vA", "select public.logistics_vendor_record_shipment($1,'CAR-T',null,null,$2,10)", [del, day(-2)]);
  await as("agent", "select public.logistics_set_status($1,'in_transit',null)", [del]);
  assert.equal(await stage(dep), "in_transit");
  await as("agent", "select public.logistics_mark_delivered($1,$2,null)", [del, day(0)]);
  assert.equal(await stage(dep), "delivered");

  const B = await makePo(sB, 5);
  const o2 = (await as("agent", "select public.execution_outlet_save(null,$1) id", [outletData("GB-002")])).rows[0].id;
  const depB = (await as("agent", "select public.execution_deployment_create($1,$2,$3,null,5,null,null) id", [o2, B.po, B.spec])).rows[0].id;
  const listA = (await as("vA", "select public.execution_vendor_deployments() l")).rows[0].l;
  assert.equal(listA.length, 2);
  assert.ok(!listA.some((d) => d.id === depB));
  assert.equal((await as("vB", "select public.execution_vendor_deployments() l")).rows[0].l.length, 1);
  assert.equal((await as("vA", "select count(*)::int n from public.deployments")).rows[0].n, 0);
  await rejects(as("vB", "select public.execution_vendor_record_install($1,current_date,'Bob',6,51.5,-0.12,null)", [dep]), /not found/);
});

test("vendor install needs before/after photos; GPS distance computed server-side and flagged over 200 m; vendor can't set audit status", async () => {
  await rejects(as("vA", "select public.execution_vendor_record_install($1,current_date,'Sam Fitter',6,51.5083,-0.1278,null)", [dep]), /before and an after photo/);
  await photo("vA", dep, sA, "Before");
  await photo("vA", dep, sA, "After");
  await rejects(as("vA", "select public.execution_vendor_record_install($1,current_date,'Sam Fitter',7,51.5083,-0.1278,null)", [dep]), /between 0 and 6/);
  await as("vA", "select public.execution_vendor_record_install($1,current_date,'Sam Fitter',6,51.5083,-0.1278,null)", [dep]); // ~100 m north
  const d = (await as("agent", "select stage, audit_status, gps_flag, gps_distance_m from public.deployments where id = $1", [dep])).rows[0];
  assert.equal(d.stage, "installed");
  assert.equal(d.audit_status, "pending");
  assert.equal(d.gps_flag, false);
  assert.ok(Math.abs(Number(d.gps_distance_m) - 100) < 2);
  await photo("vA", dep2, sA, "Before");
  await photo("vA", dep2, sA, "After");
  await as("vA", "select public.execution_vendor_record_install($1,current_date,'Sam Fitter',4,51.5174,-0.1278,null)", [dep2]); // ~1.1 km
  const d2 = (await as("agent", "select audit_status, gps_flag, gps_distance_m from public.deployments where id = $1", [dep2])).rows[0];
  assert.equal(d2.gps_flag, true);
  assert.equal(d2.audit_status, "needs_review");
  assert.ok(Number(d2.gps_distance_m) > 1000);
  await rejects(as("vA", "update public.deployments set audit_status = 'passed' where id = $1", [dep]), /permission denied/);
  await rejects(as("vA", "select public.execution_audit_deployment($1,$2,null,false)", [dep, JSON.stringify({ "DS-A": 100, "DS-B": 100 })]), /Only internal staff/);
});

test("audit score = Σ weight × score / 100; weights must total 100; failing audit opens a ticket", async () => {
  const s = (await as("agent", "select * from public.execution_display_score($1)", [JSON.stringify({ "DS-A": 100, "DS-B": 50 })])).rows[0];
  assert.equal(Number(s.total), 80);
  assert.equal(Number(s.weights_total), 100);
  await rejects(as("agent", "select public.execution_audit_deployment($1,$2,null,false)", [dep, JSON.stringify({ "DS-A": 120, "DS-B": 50 })]), /from 0 to 100/);
  await as("agent", "select public.execution_audit_deployment($1,$2,null,false)", [dep, JSON.stringify({ "DS-A": 100, "DS-B": 50 })]);
  const d = (await as("agent", "select stage, audit_status, audit_score from public.deployments where id = $1", [dep])).rows[0];
  assert.deepEqual([d.stage, d.audit_status, Number(d.audit_score)], ["audited", "passed", 80]);
  // weights off -> refused
  const extra = await lib("display_scoring", "DS-C", "Extra", { weight_percent: 10 });
  await rejects(as("agent", "select public.execution_audit_deployment($1,$2,'x',false)", [dep2, JSON.stringify({ "DS-A": 10, "DS-B": 10, "DS-C": 10 })]), /must total 100/);
  await asSuper("update public.library_records set status = 'retired' where id = $1", [extra]);
  // fail -> rejected + ticket + vendor notified
  await rejects(as("agent", "select public.execution_audit_deployment($1,$2,null,false)", [dep2, JSON.stringify({ "DS-A": 20, "DS-B": 20 })]), /Add a note/);
  await as("agent", "select public.execution_audit_deployment($1,$2,'Wrong aisle',false)", [dep2, JSON.stringify({ "DS-A": 20, "DS-B": 20 })]);
  const d2 = (await as("agent", "select stage, audit_status from public.deployments where id = $1", [dep2])).rows[0];
  assert.deepEqual([d2.stage, d2.audit_status], ["rejected", "failed"]);
  const tk = (await as("agent", "select id, status, issue_type from public.maintenance_tickets where deployment_id = $1", [dep2])).rows[0];
  assert.deepEqual([tk.status, tk.issue_type], ["open", "incorrect_install"]);
  assert.equal((await as("vA", "select count(*)::int n from public.notifications where title = 'Install audit failed'")).rows[0].n, 1);
  await rejects(as("agent", "select public.execution_ticket_move($1,'closed',null,null)", [tk.id]), /can't move from open to closed/);
  await as("agent", "select public.execution_ticket_move($1,'in_progress',null,null)", [tk.id]);
  await rejects(as("agent", "select public.execution_ticket_move($1,'resolved','Moved it',null)", [tk.id]), /root cause/);
  await as("agent", "select public.execution_ticket_move($1,'resolved','Moved it','installation')", [tk.id]);
  await as("lead", "select public.execution_ticket_move($1,'closed',null,null)", [tk.id]);
});

test("internal installer can't audit their own install", async () => {
  const P = await makePo(sA, 2);
  const id = (await as("agent", "select public.execution_deployment_create($1,$2,$3,null,2,null,null) id", [outlet, P.po, P.spec])).rows[0].id;
  await photo("agent", id, sA, "Before");
  await photo("agent", id, sA, "After");
  await as("agent", "select public.execution_record_install($1,current_date,'Agent',2,51.5074,-0.1278,null)", [id]);
  await rejects(as("agent", "select public.execution_audit_deployment($1,$2,null,false)", [id, JSON.stringify({ "DS-A": 90, "DS-B": 90 })]), /someone else must audit/);
  await as("lead", "select public.execution_audit_deployment($1,$2,null,false)", [id, JSON.stringify({ "DS-A": 90, "DS-B": 90 })]);
});

test("job close is blocked until quality gates pass; deliveries gap needs an override reason", async () => {
  await t.db.exec("reset role; select set_config('sourcing.system_write','on',false);");
  await t.db.query("update public.jobs set status = 'in_production' where id = $1", [A.job]);
  await t.db.exec("select set_config('sourcing.system_write','off',false);");
  const check = async () => (await as("agent", "select public.job_close_check($1) c", [A.job])).rows[0].c;
  let c = await check();
  assert.equal(c.can_close, false);
  const byKey = (cc) => Object.fromEntries(cc.checks.map((x) => [x.key, x]));
  assert.equal(byKey(c).gates.ok, false);
  assert.equal(byKey(c).deployments.ok, false); // dep2 was rejected
  await rejects(as("agent", "select public.execution_close_job($1,'override')", [A.job]), /can't close yet: .*Quality gates/);
  await rejects(as("vA", "select public.job_close_check($1)", [A.job]), /Only internal staff/);

  await rejects(as("agent", "select public.execution_gate_sign_off($1,'mockup',true,null)", [A.job]), /Upload the check sheet/);
  const doc = async (gate) => as("agent", "select public.file_register('execution','job_quality_gate',$1,null,'sheet.pdf','application/pdf',10,'aGVsbG8gd29ybGQ=',null,null)", [`${A.job}:${gate}`]);
  for (const g of ["mockup", "production", "installation", "closure"]) await doc(g);
  await rejects(as("agent", "select public.execution_gate_sign_off($1,'production',true,null)", [A.job]), /Pass the mockup gate first/);
  await rejects(as("vA", "select public.execution_gate_sign_off($1,'mockup',true,null)", [A.job]), /Only internal staff/);
  await rejects(as("agent", "select public.execution_gate_sign_off($1,'mockup',false,null)", [A.job]), /Say why/);
  for (const g of ["mockup", "production", "installation", "closure"]) await as("lead", "select public.execution_gate_sign_off($1,$2,true,null)", [A.job, g]);
  c = await check();
  assert.equal(byKey(c).gates.ok, true);

  // re-install and pass the rejected deployment
  await asSuper("update public.deployments set stage = 'delivered', audit_status = 'pending' where id = $1", [dep2]);
  await as("vA", "select public.execution_vendor_record_install($1,current_date,'Sam Fitter',4,51.5075,-0.1278,null)", [dep2]);
  await as("lead", "select public.execution_audit_deployment($1,$2,null,false)", [dep2, JSON.stringify({ "DS-A": 90, "DS-B": 90 })]);
  c = await check();
  assert.equal(byKey(c).deployments.ok, true);
  assert.equal(byKey(c).deliveries.ok, false); // delivered but POD not verified
  await rejects(as("agent", "select public.execution_close_job($1,null)", [A.job]), /override reason/);
  await as("agent", "select public.execution_close_job($1,'POD held by the client; confirmed by email')", [A.job]);
  const j = (await as("agent", "select status, closed_at from public.jobs where id = $1", [A.job])).rows[0];
  assert.equal(j.status, "closed");
  assert.ok(j.closed_at);
  assert.equal((await as("agent", "select count(*)::int n from public.execution_events where job_id = $1 and event = 'closed'", [A.job])).rows[0].n, 1);
  assert.equal((await as("agent", "select count(*)::int n from public.sourcing_events where job_id = $1 and event = 'status_changed' and detail->>'to' = 'closed'", [A.job])).rows[0].n, 1);
  await rejects(as("agent", "select public.execution_close_job($1,'again')", [A.job]), /can't be closed/);
});

test("health view", async () => {
  const h = (await as("agent", "select metric from public.watchtower_health_execution")).rows.map((r) => r.metric);
  assert.deepEqual(h.sort(), ["audit_pass_rate", "awaiting_install", "gps_flags", "open_tickets"]);
});
