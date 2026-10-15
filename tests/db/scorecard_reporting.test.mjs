// Balanced scorecard reporting: KPI status follows each KPI's direction and the target precedence (client + market,
// client, market, default); filters change the results; the client function only returns the caller's own client and
// never supplier names or cost; influence splits add up; innovation engagement shows a labelled placeholder figure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { client: "00000000-0000-0000-0000-0000000000e1", vendor: "00000000-0000-0000-0000-0000000000e2" };
Object.assign(ids, U);

const sup = (await asSuper(`insert into public.suppliers (supplier_code, name, market, region, primary_contact_email, active, purchasing_blocked)
  values ('SC-SUP','Secretive Supplier Ltd','Germany','EMEA','vendor@sc-sup.example',true,false) returning id`)).rows[0].id;
const cA = (await asSuper("insert into public.sourcing_clients (code, name, default_currency) values ('SCA','Scorecard Client A','EUR') returning id")).rows[0].id;
const cB = (await asSuper("insert into public.sourcing_clients (code, name, default_currency) values ('SCB','Scorecard Client B','EUR') returning id")).rows[0].id;
await asSuper("insert into auth.users (id, email) values ($1,'buyer@client-a.example'), ($2,'vendor@sc-sup.example')", [U.client, U.vendor]);
await asSuper("update public.profiles set user_type = 'client', supplier_id = null where id = $1", [U.client]);
await asSuper("insert into public.client_users (user_id, client_id, role) values ($1,$2,'viewer')", [U.client, cA]);
await asSuper("update public.profiles set supplier_id = $1, user_type = 'vendor' where id = $2", [sup, U.vendor]).catch(async () => {
  await asSuper("update public.profiles set supplier_id = $1 where id = $2", [sup, U.vendor]);
});

let n = 0;
// One order line: job + spec + triage + approved estimate (markup 0, so sell = cost) + estimate line.
async function line({ client = cA, market = "Germany", region = "EMEA", route = "adopt", urgent = false, gov = "central", qty = 100, unit = 10, bench = null,
  exempt = false, month = "2026-03-15", brand = null } = {}) {
  n += 1;
  const job = (await asSuper(`insert into public.jobs (title, client_id, region, market, brand, urgent, governance_model, opened_date, target_delivery_date)
    values ($1,$2,$3,$4,$5,$6,$7,$8::date - 10,$8::date + 30) returning id`, [`SC job ${n}`, client, region, market, brand, urgent, gov, month])).rows[0].id;
  const spec = (await asSuper("insert into public.job_specs (job_id, title, spec_type, spend_exempt) values ($1,'SC item','2d',$2) returning id", [job, exempt])).rows[0].id;
  await asSuper("insert into public.spec_triage (spec_id, route, reason, confidence, rule_version, source) values ($1,$2,'test',0.9,'t','rule')", [spec, route]);
  const cost = qty * unit;
  const b = bench ?? unit;
  const est = (await asSuper(`insert into public.estimates (job_id, supplier_id, source, currency, base_cost, benchmark_source, pricing_mode, pricing_percent, status, approved_at, region, market)
    values ($1,$2,'rfq','EUR',$3,$4,'markup',0,'approved',$5::date + time '12:00',$6,$7) returning id`, [job, sup, cost, b === unit ? "rate_card" : "live", month, region, market])).rows[0].id;
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost, benchmark_unit) values ($1,$2,$3,$4,$5,$6)", [est, spec, qty, unit, cost, b]);
  return { job, spec, est };
}

// Client A: two adopt lines in Germany (one urgent), two create lines in France (one exempt).
await line({ route: "adopt", bench: 12.5 });                       // spend 1000, saving 250 -> 20% of 1250
await line({ route: "adopt", bench: 10, urgent: true });          // spend 1000, saving 0 (urgent)
await line({ route: "create", market: "France", bench: 11, gov: "business_unit", month: "2026-05-10" }); // saving 100
await line({ route: "create", market: "France", bench: 15, exempt: true, month: "2026-05-10" });          // exempt: not in savings %
// Client B: one line, so a client-only view differs from "all clients".
await line({ client: cB, route: "adapt", bench: 10.5, market: "Netherlands" });

const report = async (client = null, filters = {}) => (await as("admin", "select public.scorecard_report($1, $2::jsonb) r", [client, JSON.stringify(filters)])).rows[0].r;
const kpi = (r, code) => r.kpis.find((k) => k.code === code);
const lib = (key, code, data, status = "active") =>
  asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$2,$3,$4,'2025-01-01')", [key, code, JSON.stringify(data), status]);

test("savings %, adopt % and urgent % with default targets and direction", async () => {
  const r = await report(cA);
  assert.equal(r.totals.lines, 4);
  // Savings % on addressable lines only: (250 + 0 + 100) / (1250 + 1000 + 1100); the exempt line is left out.
  const sav = kpi(r, "SAVINGS_PCT");
  assert.equal(sav.current, 10.4);
  assert.equal(sav.target, 10);
  assert.equal(sav.target_source, "default");
  assert.equal(sav.status, "on_target"); // higher is better: 10.4 >= 10
  assert.equal(kpi(r, "ADOPT_PCT").current, 50);
  const urg = kpi(r, "URGENT_PCT");
  assert.equal(urg.current, 25); // 1 of 4 jobs
  assert.equal(urg.direction, "lower");
  assert.equal(urg.status, "off_target"); // lower is better: 25 > 10
  // Make the ceiling generous for this client: lower-is-better now on target.
  await lib("scorecard_targets", "T-URG-A", { kpi_code: "URGENT_PCT", client_id: cA, target: 30 });
  const r2 = await report(cA);
  assert.equal(kpi(r2, "URGENT_PCT").target, 30);
  assert.equal(kpi(r2, "URGENT_PCT").target_source, "client");
  assert.equal(kpi(r2, "URGENT_PCT").status, "on_target");
});

test("target precedence: client + market beats client, client beats market, market beats default", async () => {
  await lib("scorecard_targets", "T-SAV-DE", { kpi_code: "SAVINGS_PCT", market: "DE", target: 9 });
  let r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'Germany') r", [cA])).rows[0].r;
  assert.deepEqual(r, { target: 9, source: "market" });
  await lib("scorecard_targets", "T-SAV-A", { kpi_code: "SAVINGS_PCT", client_id: cA, target: 11 });
  r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'DE') r", [cA])).rows[0].r;
  assert.deepEqual(r, { target: 11, source: "client" });
  await lib("scorecard_targets", "T-SAV-A-DE", { kpi_code: "SAVINGS_PCT", client_id: cA, market: "DE", target: 25 });
  r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'DE') r", [cA])).rows[0].r;
  assert.deepEqual(r, { target: 25, source: "client_market" });
  // Another client in Germany gets the market target; nobody else gets client A's.
  r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'DE') r", [cB])).rows[0].r;
  assert.deepEqual(r, { target: 9, source: "market" });
  r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'FR') r", [cB])).rows[0].r;
  assert.deepEqual(r, { target: 10, source: "default" });
  // A target waiting for approval (maker-checker) is not in force.
  await lib("scorecard_targets", "T-SAV-B", { kpi_code: "SAVINGS_PCT", client_id: cB, target: 40 }, "pending_approval");
  r = (await as("admin", "select public.scorecard_target('SAVINGS_PCT', $1, 'FR') r", [cB])).rows[0].r;
  assert.equal(r.source, "default");
  // The scorecard uses the client + market target when one market is filtered.
  const rep = await report(cA, { market: "DE" });
  assert.equal(kpi(rep, "SAVINGS_PCT").target, 25);
  assert.equal(kpi(rep, "SAVINGS_PCT").status, "off_target"); // 250 / 2250 = 11.1 < 25
  // Per-market rows of the country table use per-market targets.
  const de = (await report(cA)).country.rows.find((x) => x.market === "DE");
  assert.equal(de.savings_target, 25);
});

test("filters change the results", async () => {
  const all = await report(null);
  assert.equal(all.totals.lines, 5);
  const onlyA = await report(cA);
  assert.equal(onlyA.totals.lines, 4);
  const create = await report(cA, { routes: ["create"] });
  assert.equal(create.totals.lines, 2);
  assert.equal(kpi(create, "ADOPT_PCT").current, 0);
  const fr = await report(cA, { market: "France" });
  assert.equal(fr.totals.lines, 2);
  const may = await report(cA, { from: "2026-05-01", to: "2026-05-31" });
  assert.equal(may.totals.lines, 2);
  const bu = await report(null, { business_unit: "Nonexistent unit" });
  assert.equal(bu.totals.lines, 0);
  assert.equal(kpi(onlyA, "SAVINGS_PCT").current, 10.4);
  assert.equal(kpi(fr, "SAVINGS_PCT").current, 9.1); // 100 / 1100 (the exempt line is out)
  // Breakdowns: by route and by market are there for each measured KPI.
  assert.ok(onlyA.breakdowns.SAVINGS_PCT.by_market.some((m) => m.market === "FR"));
  assert.deepEqual(onlyA.breakdowns.ADOPT_PCT.by_route.map((x) => x.route).sort(), ["adopt", "create"]);
});

test("client function: own client only, no supplier names, no cost; vendors and other clients get nothing", async () => {
  const rows = (await as("client", "select * from public.rpt_client_lines()")).rows;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => x.client_id === cA));
  const cols = Object.keys(rows[0]);
  for (const bad of ["supplier_id", "supplier_name", "cost", "cost_eur", "margin", "unit_cost", "savings_cost"]) assert.ok(!cols.includes(bad), `${bad} must not be exposed`);
  assert.ok(!JSON.stringify(rows).includes("Secretive Supplier"));
  await rejects(as("client", "select * from public.rpt_client_lines($1)", [cB]), /do not have access/);
  const portal = (await as("client", "select public.client_portal_scorecard(null, '{}'::jsonb) r")).rows[0].r;
  assert.equal(portal.totals.lines, 4);
  assert.ok(!JSON.stringify(portal).includes("Secretive Supplier"));
  // Internal-only reads are closed to clients and vendors.
  assert.equal((await as("client", "select count(*)::int n from public.rpt_spec_lines")).rows[0].n, 0);
  assert.equal((await as("vendor", "select count(*)::int n from public.rpt_spec_lines")).rows[0].n, 0);
  assert.equal((await as("vendor", "select count(*)::int n from public.rpt_client_lines()")).rows[0].n, 0);
  await rejects(as("client", "select public.scorecard_report(null, '{}'::jsonb)"), /adm Indicia staff/);
  await rejects(as("vendor", "select public.scorecard_values(null, '{}'::jsonb)"), /adm Indicia staff/);
  // Staff see the full line, supplier included.
  const internal = (await as("admin", "select supplier_name, cost from public.rpt_spec_lines where client_id = $1", [cA])).rows;
  assert.equal(internal.length, 4);
  assert.equal(internal[0].supplier_name, "Secretive Supplier Ltd");
});

test("influence factors: every split adds up to the total", async () => {
  const infl = (await as("admin", "select public.scorecard_influence(null, '{}'::jsonb) r")).rows[0].r;
  const total = infl.total.lines;
  assert.equal(total, 5);
  for (const f of infl.factors) {
    const sum = f.groups.reduce((a, g) => a + g.metrics.lines, 0);
    assert.equal(sum, total, `${f.key} groups add up to the total`);
    const spend = f.groups.reduce((a, g) => a + g.metrics.spend_eur, 0);
    assert.ok(Math.abs(spend - infl.total.spend_eur) < 0.01);
    for (const g of f.groups) assert.equal(g.by_route.reduce((a, x) => a + x.metrics.lines, 0), g.metrics.lines, `${f.key}/${g.key} routes add up`);
  }
  const urg = infl.factors.find((f) => f.key === "urgent");
  assert.deepEqual(urg.groups.map((g) => g.key), ["planned", "urgent"]);
  assert.equal(urg.groups.find((g) => g.key === "urgent").metrics.savings_pct, 0);
});

test("innovation engagement shows its labelled placeholder figure; callouts are plain language", async () => {
  const r = await report(cA);
  const inn = kpi(r, "INNOVATION_PCT");
  assert.equal(inn.measured, true);
  assert.equal(Number(inn.current), 85);
  assert.match(inn.name, /placeholder/i);
  // A KPI with a source but no data yet says so instead.
  assert.equal(kpi(r, "MARKET_TEMPERATURE_PCT").status, "no_data");
  assert.ok(r.callouts.length >= 2 && r.callouts.length <= 4);
  assert.ok(r.callouts.every((c) => typeof c.text === "string" && c.text.length > 10));
  // The governed KPI library is readable as a typed view by staff.
  const k = (await as("admin", "select code, direction, measured from public.scorecard_kpis where code in ('URGENT_PCT','INNOVATION_PCT') order by code")).rows;
  assert.deepEqual(k, [{ code: "INNOVATION_PCT", direction: "higher", measured: true }, { code: "URGENT_PCT", direction: "lower", measured: true }]);
  const h = (await as("admin", "select * from public.watchtower_health_scorecard")).rows;
  assert.equal(h.length, 1);
  assert.equal(h[0].metric, "scorecard_off_target");
});
