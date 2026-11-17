// Conscious ordering (Sustainability): the ordered / delivered / installed / in stock reconciliation, stock counts
// (internal only, latest count per location, never more than ordered, old stock presumed wasted) and the governed rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
ids.vendor = "00000000-0000-0000-0000-0000000000e1";
const day = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA");

const { rows: [sup] } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('CO-A','Alpha Print','United Kingdom','EMEA','v@alpha-co.example') returning id");
await asSuper("insert into auth.users (id, email) values ($1, 'v@alpha-co.example')", [ids.vendor]);
const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('COC','Ordering Client') returning id");
const { rows: [outlet] } = await asSuper("insert into public.outlets (client_id, name, outlet_code, region, market) values ($1,'Test store','CO-1','EMEA','GB') returning id", [client.id]);

/** An accepted PO for one spec: `qty` ordered at 2.00 GBP each, optionally with a verified delivery of `delivered`. */
async function makeLine({ brand = "Brand A", qty = 100, delivered = null, type = "2d", co2 = null } = {}) {
  const { rows: [job] } = await as("agent", "insert into public.jobs (title, client_id, region, market, brand) values ('Ordering job',$1,'EMEA','United Kingdom',$2) returning id", [client.id, brand]);
  const { rows: [spec] } = await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Shelf wobbler',$2) returning id", [job.id, type]);
  if (co2 != null) await asSuper("update public.job_specs set co2e_kg_per_unit = $2 where id = $1", [spec.id, co2]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Main',$2)", [spec.id, qty]);
  const { rows: [est] } = await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','GBP',$3,'EMEA','United Kingdom','approved') returning id", [job.id, sup.id, qty * 2]);
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,2,$4)", [est.id, spec.id, qty, qty * 2]);
  const { rows: [po] } = await asSuper("insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, status, region, market) values ($1,$2,$3,'GBP',$4,$5,0,'accepted','EMEA','United Kingdom') returning id", [job.id, est.id, sup.id, qty * 2, day(-20)]);
  let delivery = null;
  if (delivered != null) {
    await asSuper("select set_config('sourcing.system_write','on',false)");
    delivery = (await asSuper("insert into public.deliveries (po_id, job_id, supplier_id, spec_id, quantity, region, market, planned_delivery_date, actual_delivery_date, status) values ($1,$2,$3,$4,$5,'EMEA','GB',$6,$6,'delivered') returning id", [po.id, job.id, sup.id, spec.id, qty, day(-20)])).rows[0].id;
    await asSuper("insert into public.shipments (delivery_id, supplier_id, dispatch_date, actual_delivery_date, quantity_shipped, pod_status, pod_verified_at) values ($1,$2,$3,$4,$5,'verified',now())", [delivery, sup.id, day(-22), day(-20), delivered]);
    await asSuper("select set_config('sourcing.system_write','off',false)");
  }
  return { job: job.id, spec: spec.id, po: po.id, delivery };
}
async function install(l, qty, installed, stage = "audited") {
  await asSuper("select set_config('sourcing.system_write','on',false)");
  await asSuper("insert into public.deployments (outlet_id, po_id, job_id, supplier_id, spec_id, delivery_id, quantity, stage, installed_quantity, installation_date, region, market) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EMEA','GB')",
    [outlet.id, l.po, l.job, sup.id, l.spec, l.delivery, qty, stage, installed, installed == null ? null : day(-10)]);
  await asSuper("select set_config('sourcing.system_write','off',false)");
}
const line = async (po) => (await as("agent", "select * from public.conscious_ordering_lines() where po_id = $1", [po])).rows[0];
const count = (user, l, qty, on, location, source = "warehouse") =>
  as(user, "select public.ordering_record_stock_count($1,$2,$3,$4,$5,$6) id", [l.po, l.spec, qty, on, location, source]);

test("an order with no installs and no stock count is untracked", async () => {
  const l = await makeLine({ delivered: 100 });
  const r = await line(l.po);
  assert.deepEqual([r.status, r.ordered, r.delivered, r.installed, r.surplus, r.wasted], ["untracked", 100, 100, 0, 0, 0]);
  assert.equal(r.brand, "Brand A");
});

test("open installs keep a line in progress; once they land, surplus = delivered - installed and is unaccounted", async () => {
  const l = await makeLine({ delivered: 100 });
  await install(l, 60, 50);
  await install(l, 40, null, "planned");
  let r = await line(l.po);
  assert.deepEqual([r.status, r.installed, r.open_installs, r.wasted], ["in_progress", 50, 1, 0]);
  await asSuper("update public.deployments set stage = 'audited', installed_quantity = 30, installation_date = $2 where po_id = $1 and stage = 'planned'", [l.po, day(-5)]);
  r = await line(l.po);
  assert.deepEqual([r.status, r.install_planned, r.installed, r.surplus, r.in_stock, r.unaccounted, r.wasted], ["reconciled", 100, 80, 20, 0, 20, 20]);
});

test("nothing delivered yet is in progress, not waste", async () => {
  const l = await makeLine();
  await install(l, 100, null, "planned");
  const r = await line(l.po);
  assert.deepEqual([r.status, r.delivered, r.wasted], ["in_progress", 0, 0]);
});

test("stock counts: internal only, validated, latest count per location wins, capped at what was ordered", async () => {
  const l = await makeLine({ delivered: 100 });
  await install(l, 100, 70);
  await rejects(count("vendor", l, 10, day(-1), "Vendor store"), /Only adm Indicia staff/);
  await rejects(count("agent", l, -1, day(-1), "Central warehouse"), /quantity counted/);
  await rejects(count("agent", l, 10, day(1), "Central warehouse"), /future/);
  await rejects(count("agent", l, 10, day(-1), "  "), /where the stock is held/);
  await rejects(count("agent", l, 10, day(-1), "Central warehouse", "shop"), /warehouse, vendor or market/);
  await rejects(count("agent", l, 101, day(-1), "Central warehouse"), /only 100 were ordered/);
  const other = await makeLine({ delivered: 10 });
  await rejects(as("agent", "select public.ordering_record_stock_count($1,$2,5,$3,'Central warehouse')", [l.po, other.spec, day(-1)]), /isn't on this purchase order/);
  await rejects(as("agent", "insert into public.stock_counts (po_id, spec_id, quantity, location, region, market) values ($1,$2,1,'X','EMEA','GB')", [l.po, l.spec]), /permission denied/);

  await count("agent", l, 20, day(-9), "Central warehouse");
  await count("agent", l, 5, day(-8), "Market office", "market");
  let r = await line(l.po);
  assert.deepEqual([r.surplus, r.in_stock, r.unaccounted, r.wasted], [30, 25, 5, 5]);
  // A later count at the same location replaces the earlier one (case-insensitive); history is kept.
  await count("agent", l, 8, day(-2), "central WAREHOUSE");
  r = await line(l.po);
  assert.deepEqual([r.in_stock, r.unaccounted, r.wasted], [13, 17, 17]);
  assert.equal((await as("agent", "select count(*)::int n from public.stock_counts where po_id = $1", [l.po])).rows[0].n, 3);
  // Region and market come from the PO, never from the caller.
  const c = (await as("agent", "select region, market, recorded_by from public.stock_counts where po_id = $1 limit 1", [l.po])).rows[0];
  assert.deepEqual([c.region, c.market, c.recorded_by], ["EMEA", "United Kingdom", ids.agent]);
  // Total across locations can't exceed the order.
  await rejects(count("agent", l, 96, day(-1), "Vendor store", "vendor"), /only 100 were ordered/);
  assert.equal((await as("vendor", "select count(*)::int n from public.stock_counts")).rows[0].n, 0);
});

test("stock explains only the surplus that exists; stock past the governed age is presumed wasted", async () => {
  const l = await makeLine({ delivered: 100 });
  await install(l, 100, 90);
  await count("agent", l, 40, day(-400), "Central warehouse");
  let r = await line(l.po);
  // 10 surplus; the 40 counted is capped to it, and the count is over 12 months old.
  assert.deepEqual([r.surplus, r.in_stock, r.aged_stock, r.unaccounted, r.wasted], [10, 10, 10, 0, 10]);
  await asSuper("update public.library_records set data = jsonb_set(data, '{value}', '24') where library_key = 'conscious_ordering_rules' and code = 'COR-STOCK-AGE'");
  r = await line(l.po);
  assert.deepEqual([r.aged_stock, r.wasted], [0, 0]);
  await asSuper("update public.library_records set data = jsonb_set(data, '{value}', '12') where library_key = 'conscious_ordering_rules' and code = 'COR-STOCK-AGE'");
});

test("money is reported in EUR and CO2e falls back to the spend-based factor", async () => {
  const spend = await line((await makeLine({ delivered: 100 })).po);
  // 2.00 GBP x 1.17 = 2.34 EUR; print factor 0.45 kgCO2e per EUR.
  assert.deepEqual([Number(spend.unit_cost_eur), spend.co2e_basis, Number(spend.co2e_kg_per_unit)], [2.34, "spend", 1.053]);
  const own = await line((await makeLine({ delivered: 100, co2: 0.2 })).po);
  assert.deepEqual([own.co2e_basis, Number(own.co2e_kg_per_unit)], ["spec", 0.2]);
});

test("only issued orders are reconciled, and only staff can read the reconciliation", async () => {
  const l = await makeLine({ delivered: 100 });
  await asSuper("select set_config('sourcing.system_write','on',false)");
  await asSuper("update public.purchase_orders set status = 'cancelled' where id = $1", [l.po]);
  await asSuper("select set_config('sourcing.system_write','off',false)");
  assert.equal(await line(l.po), undefined);
  await rejects(count("agent", l, 1, day(-1), "Central warehouse"), /issued purchase order/);
  await rejects(as("vendor", "select * from public.conscious_ordering_lines()"), /Only adm Indicia staff/);
});

test("Sustainability is its own module: its libraries and health roll up under it", async () => {
  const libs = (await as("agent", "select key from public.library_definitions where module = 'sustainability' order by key")).rows.map((r) => r.key);
  assert.deepEqual(libs, ["conscious_ordering_rules", "impact_grade_dimensions", "material_emission_factors", "spend_emission_factors", "substrates", "transport_emission_factors"]);
  const h = (await as("agent", "select metric, value, target, status from public.watchtower_health_sustainability order by metric")).rows;
  assert.deepEqual(h.map((r) => r.metric), ["ordering_evidence", "ordering_utilisation", "over_ordering", "substrates_unlinked"]);
  const util = h.find((r) => r.metric === "ordering_utilisation");
  // Reconciled lines above: 80/100, 70/100 and 90/100 installed.
  assert.deepEqual([Number(util.value), Number(util.target), util.status], [80, 85, "warn"]);
  // One brand and market with three reconciled lines under the 85% target.
  assert.equal(Number(h.find((r) => r.metric === "over_ordering").value), 1);
  await rejects(as("vendor", "select * from public.watchtower_health_sustainability"), /Only adm Indicia staff/);
});
