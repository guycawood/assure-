// Logistics+: planning from a PO, over-shipping guard, vendor isolation, POD upload + 8-point verification
// (internal only, never the uploader), transport CO2e snapshots using the factor version in force on the delivery date, OTIF.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const V = { vA: "00000000-0000-0000-0000-0000000000c1", vB: "00000000-0000-0000-0000-0000000000c2" };
Object.assign(ids, V);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

async function lib(key, code, name, data, { status = "active", from = "2026-01-01", to = null, version = 1 } = {}) {
  const { rows } = await asSuper(
    "insert into public.library_records (library_key, code, name, data, status, effective_from, effective_to, version) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [key, code, name, JSON.stringify(data), status, from, to, version],
  );
  return rows[0].id;
}
async function supplier(code, name, email) {
  const { rows } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, name, email]);
  return rows[0].id;
}

// ---------- fixtures ----------
await lib("carriers", "CAR-T", "Test Express", { modes: ["road"] });
for (let i = 1; i <= 8; i++) await lib("pod_checklist", `POD-${i}`, `Check ${i}`, { mandatory: i !== 6 });
// Road factor: v1 until 31 days ago, v2 from 30 days ago.
const tefV1 = await lib("transport_emission_factors", "TEF-ROAD", "Road v1", { transport_mode: "road", factor_gco2e_per_tonne_km: 88, distance_correction_factor: 1.05 }, { status: "superseded", from: day(-400), to: day(-31), version: 1 });
const tefV2 = await lib("transport_emission_factors", "TEF-ROAD", "Road v2", { transport_mode: "road", factor_gco2e_per_tonne_km: 100, distance_correction_factor: 1.05 }, { from: day(-30), version: 2 });
await asSuper("update public.library_records set superseded_by = $1 where id = $2", [tefV2, tefV1]);

const sA = await supplier("L-A", "Alpha Freight Print", "a@alpha-l.example");
const sB = await supplier("L-B", "Beta Displays", "b@beta-l.example");
await asSuper("insert into auth.users (id, email) values ($1, 'a@alpha-l.example'), ($2, 'b@beta-l.example')", [V.vA, V.vB]);
const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('LCL','Logistics Client') returning id");

async function makePo(supplierId, qty = 100, versions = [["Main", qty]]) {
  const { rows: [job] } = await as("agent", "insert into public.jobs (title, client_id, region, market) values ('Logistics job',$1,'EMEA','Germany') returning id", [client.id]);
  const { rows: [spec] } = await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Header card','2d') returning id", [job.id]);
  for (const [n, q] of versions) await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,$2,$3)", [spec.id, n, q]);
  const { rows: [est] } = await asSuper(
    "insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','EUR',1000,'EMEA','Germany','approved') returning id",
    [job.id, supplierId]);
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,10,1000)", [est.id, spec.id, qty]);
  const { rows: [po] } = await asSuper(
    "insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, status, region, market) values ($1,$2,$3,'EUR',1000,$4,0,'accepted','EMEA','Germany') returning id",
    [job.id, est.id, supplierId, day(10)]);
  return { job: job.id, spec: spec.id, po: po.id };
}
const allChecks = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`POD-${i + 1}`, true]));
async function vendorPod(user, shipmentId, supplierId) {
  const { rows: [f] } = await as(user, "select public.file_register('logistics','shipment',$1,$2,'pod.pdf','application/pdf',10,'aGVsbG8gd29ybGQ=',null,'POD') as id", [shipmentId, supplierId]);
  return f.id;
}

let A; // supplier A's PO
test("deliveries are planned from an issued PO, one per spec version, by internal staff only", async () => {
  A = await makePo(sA, 100);
  await rejects(as("vA", "select public.logistics_plan_from_po($1)", [A.po]), /Only internal staff/);
  const { rows: [{ n }] } = await as("agent", "select public.logistics_plan_from_po($1) as n", [A.po]);
  assert.equal(n, 1);
  const d = (await as("agent", "select quantity, region, market, status, delivery_number, supplier_id from public.deliveries where po_id = $1", [A.po])).rows[0];
  assert.deepEqual([d.quantity, d.region, d.market, d.status, d.supplier_id], [100, "EMEA", "DE", "planned", sA]);
  assert.match(d.delivery_number, /^DL-\d{4}-\d{5}$/);
  await rejects(as("agent", "select public.logistics_plan_from_po($1)", [A.po]), /already has deliveries/);
  const multi = await makePo(sA, 300, [["Original", 200], ["Sensitive", 100]]);
  await as("agent", "select public.logistics_plan_from_po($1)", [multi.po]);
  const q = await as("agent", "select array_agg(quantity order by quantity) q from public.deliveries where po_id = $1", [multi.po]);
  assert.deepEqual(q.rows[0].q, [100, 200]);
  await rejects(as("agent", "update public.deliveries set status = 'delivered' where po_id = $1", [A.po]), /permission denied/);
});

test("shipped quantity can never exceed the planned quantity", async () => {
  const del = (await as("agent", "select id from public.deliveries where po_id = $1", [A.po])).rows[0].id;
  await as("vA", "select public.logistics_vendor_record_shipment($1,'CAR-T','Next day','TRK1',$2,60,250)", [del, day(-3)]);
  await rejects(as("vA", "select public.logistics_vendor_record_shipment($1,'CAR-T',null,'TRK2',$2,50,null)", [del, day(-2)]), /Only 40 left to ship/);
  await rejects(as("vA", "insert into public.shipments (delivery_id, supplier_id, dispatch_date, quantity_shipped, shipment_number) values ($1,$2,current_date,10,'x')", [del, sA]), /permission denied/);
  await rejects(as("agent", "select public.logistics_record_shipment($1,'CAR-UNKNOWN',null,null,$2,10)", [del, day(-2)]), /active carrier/);
  await as("agent", "select public.logistics_record_shipment($1,'CAR-T',null,'TRK3',$2,40,170)", [del, day(-2)]);
  // trigger guard, even for a privileged write
  const s = (await as("agent", "select id from public.shipments where delivery_id = $1 order by created_at limit 1", [del])).rows[0].id;
  await rejects(asSuper("update public.shipments set quantity_shipped = 61 where id = $1", [s]), /only 0 left|would ship/);
  await rejects(as("agent", "select public.logistics_update_delivery($1, $2)", [del, JSON.stringify({ quantity: 90 })]), /can't go below the 100 already shipped/);
  const v = (await as("agent", "select quantity_shipped, quantity_remaining, status from public.v_deliveries where id = $1", [del])).rows[0];
  assert.deepEqual([v.quantity_shipped, v.quantity_remaining, v.status], [100, 0, "dispatched"]);
});

test("vendor A never sees vendor B's deliveries; vendors read nothing directly", async () => {
  const B = await makePo(sB, 20);
  await as("agent", "select public.logistics_plan_from_po($1)", [B.po]);
  const delB = (await as("agent", "select id from public.deliveries where po_id = $1", [B.po])).rows[0].id;
  const a = (await as("vA", "select public.logistics_vendor_deliveries() l")).rows[0].l;
  assert.ok(a.length >= 1 && a.every((d) => d.po_number && d.id !== delB));
  assert.equal((await as("vB", "select public.logistics_vendor_deliveries() l")).rows[0].l.length, 1);
  await rejects(as("vA", "select public.logistics_vendor_record_shipment($1,'CAR-T',null,null,current_date,1)", [delB]), /not found/);
  assert.equal((await as("vA", "select count(*)::int n from public.deliveries")).rows[0].n, 0);
  assert.equal((await as("vA", "select count(*)::int n from public.shipments")).rows[0].n, 0);
});

test("POD: vendor uploads; only an internal user who did not upload it verifies, against every mandatory check", async () => {
  const del = (await as("agent", "select id from public.deliveries where po_id = $1", [A.po])).rows[0].id;
  const [s1, s2] = (await as("agent", "select id from public.shipments where delivery_id = $1 order by created_at", [del])).rows.map((r) => r.id);
  // vendor B can't attach to A's shipment
  const fB = await vendorPod("vB", s1, sB);
  await rejects(as("vB", "select public.logistics_vendor_attach_pod($1,$2,null)", [s1, fB]), /not found/);
  const f1 = await vendorPod("vA", s1, sA);
  await as("vA", "select public.logistics_vendor_attach_pod($1,$2,$3)", [s1, f1, day(-1)]);
  assert.equal((await as("agent", "select pod_status from public.shipments where id = $1", [s1])).rows[0].pod_status, "received");
  // vendor can't verify their own POD
  await rejects(as("vA", "select public.logistics_pod_verify($1,$2,null)", [s1, JSON.stringify(allChecks)]), /Only internal staff/);
  // a mandatory point missing
  await rejects(as("lead", "select public.logistics_pod_verify($1,$2,null)", [s1, JSON.stringify({ ...allChecks, "POD-7": false })]), /Missing: Check 7/);
  // optional point (POD-6) can be unticked
  await as("lead", "select public.logistics_pod_verify($1,$2,'ok')", [s1, JSON.stringify({ ...allChecks, "POD-6": false })]);
  const v = (await as("agent", "select pod_status, pod_verified_by, jsonb_array_length(pod_checklist) n from public.shipments where id = $1", [s1])).rows[0];
  assert.deepEqual([v.pod_status, v.pod_verified_by, v.n], ["verified", ids.lead, 8]);
  // notification to the vendor
  assert.ok((await as("vA", "select count(*)::int n from public.notifications where title = 'POD verified'")).rows[0].n >= 1);

  // internal uploader can't verify the POD they attached
  const { rows: [f2] } = await as("agent", "select public.file_register('logistics','shipment',$1,$2,'pod2.pdf','application/pdf',10,'aGVsbG8gd29ybGQ=',null,'POD') as id", [s2, sA]);
  await as("agent", "select public.logistics_attach_pod($1,$2,$3)", [s2, f2.id, day(-1)]);
  await rejects(as("agent", "select public.logistics_pod_verify($1,$2,null)", [s2, JSON.stringify(allChecks)]), /someone else must verify/);
  await rejects(as("lead", "select public.logistics_pod_reject($1,$2,'')", [s2, "{}"]), /Say what is wrong/);
  await as("lead", "select public.logistics_pod_reject($1,$2,'Signature missing')", [s2, JSON.stringify({ ...allChecks, "POD-7": false })]);
  assert.equal((await as("vA", "select count(*)::int n from public.notifications where title = 'POD rejected'")).rows[0].n, 1);
  // vendor re-uploads; head verifies; fully shipped + all verified => delivered with a CO2e snapshot
  const f3 = await vendorPod("vA", s2, sA);
  await as("vA", "select public.logistics_vendor_attach_pod($1,$2,$3)", [s2, f3, day(-1)]);
  await as("head", "select public.logistics_pod_verify($1,$2,null)", [s2, JSON.stringify(allChecks)]);
  const d = (await as("agent", "select status, actual_delivery_date::text dt from public.deliveries where id = $1", [del])).rows[0];
  assert.deepEqual([d.status, d.dt], ["delivered", day(-1)]);
  assert.equal((await as("agent", "select count(*)::int n from public.emission_snapshots where delivery_id = $1", [del])).rows[0].n, 1);
});

test("transport CO2e snapshot uses the factor version in force on the delivery date, and is immutable", async () => {
  const mk = async (deliveredOn) => {
    const P = await makePo(sA, 10);
    const { rows: [{ id }] } = await as("agent", "select public.logistics_create_delivery($1,$2,null,10,$3) as id",
      [P.po, P.spec, JSON.stringify({ market: "DE", gross_weight_kg: 500, distance_km: 100, delivery_method: "road", planned_delivery_date: day(-40) })]);
    await as("agent", "select public.logistics_record_shipment($1,'CAR-T',null,null,$2,10)", [id, day(-70)]);
    await as("agent", "select public.logistics_mark_delivered($1,$2,null)", [id, deliveredOn]);
    return (await as("agent", "select * from public.emission_snapshots where delivery_id = $1", [id])).rows[0];
  };
  const old = await mk(day(-60));
  assert.equal(old.factor_code, "TEF-ROAD");
  assert.equal(old.factor_version, 1);
  assert.equal(Number(old.kgco2e), 4.62); // 0.5 t x 100 km x 1.05 x 88 / 1000
  assert.equal(old.complete, true);
  const now = await mk(day(0));
  assert.equal(now.factor_version, 2);
  assert.equal(Number(now.kgco2e), 5.25);
  await rejects(asSuper("update public.emission_snapshots set kgco2e = 0 where id = $1", [old.id]), /immutable/);
  await rejects(as("agent", "select public.logistics_mark_delivered($1,null,null)", [old.delivery_id]), /on its way/);
  // recompute adds a new row, keeps the old
  await as("agent", "select public.logistics_recompute_emissions($1,'Weights corrected')", [old.delivery_id]);
  assert.equal((await as("agent", "select count(*)::int n from public.emission_snapshots where delivery_id = $1", [old.delivery_id])).rows[0].n, 2);
});

test("OTIF per supplier: on time and in full", async () => {
  const r = (await as("agent", "select * from public.v_supplier_otif where supplier_id = $1", [sA])).rows[0];
  // A: first delivery due day(+10), delivered day(-1) in full -> OTIF; two late deliveries (planned day(-40), delivered -60 on time, 0 late)
  assert.equal(r.deliveries, 3);
  assert.equal(r.in_full, 3);
  assert.equal(r.on_time, 2);
  assert.equal(Number(r.otif_percent), 66.7);
  assert.equal((await as("vA", "select count(*)::int n from public.v_supplier_otif")).rows[0].n, 0);
  const h = (await as("agent", "select metric, value from public.watchtower_health_logistics")).rows;
  assert.ok(h.some((x) => x.metric === "pods_to_verify"));
});
