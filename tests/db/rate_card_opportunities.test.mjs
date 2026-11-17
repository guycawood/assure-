// Rate card opportunities: repeat purchases grouped by spec type, material, clean title and currency; the minimum orders, the time window,
// price spread, share already priced from a rate card, open requests, and dismissals with a reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
const sup = async (code) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, `Opp ${code}`, `${code}@op.example`])).rows[0].id;
const sA = await sup("OP-A"), sB = await sup("OP-B");
const clients = [];
for (const c of ["C1", "C2", "C3"]) clients.push((await asSuper("insert into public.sourcing_clients (code, name) values ($1,$2) returning id", [`OP${c}`, `Opp ${c}`])).rows[0].id);

// One priced purchase: a job, a spec with this title, an estimate and a priced line.
async function buy({ title, type = "2d", qty = 100, price = 2, client = clients[0], supplier = sA, currency = "EUR", ageDays = 10, viaCard = false, status = "approved" }) {
  const job = (await asSuper("insert into public.jobs (title, client_id, region, market, currency) values ('Opp job',$1,'EMEA','Germany',$2) returning id", [client, currency])).rows[0].id;
  const spec = (await asSuper("insert into public.job_specs (job_id, title, spec_type) values ($1,$2,$3) returning id", [job, title, type])).rows[0].id;
  const est = (await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, benchmark_source, pricing_percent, region, market, status) values ($1,$2,'adopt',$3,$4,$5,10,'EMEA','Germany',$6) returning id",
    [job, supplier, currency, qty * price, viaCard ? "rate_card" : null, status])).rows[0].id;
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,$4,$5)", [est, spec, qty, price, qty * price]);
  await asSuper("update public.estimates set created_at = now() - make_interval(days => $2) where id = $1", [est, ageDays]);
}
const opps = async (...a) => (await as("agent", "select public.rate_card_opportunities($1,$2,$3,$4) as o", [a[0] ?? 12, a[1] ?? 3, a[2] ?? null, a[3] ?? false])).rows[0].o;
const find = (list, text) => list.find((o) => o.title_key.includes(text));

// Header cards bought five times across three clients and two vendors at different prices; the number and brackets in the title do not split the group.
for (const [i, price] of [2, 2.2, 2.5, 2, 2.4].entries()) await buy({ title: `Header card (A${i + 1}) 350gsm ${i}`, price, qty: 100 * (i + 1), client: clients[i % 3], supplier: i % 2 ? sB : sA });
for (let i = 0; i < 2; i++) await buy({ title: "Floor decal", price: 5 });                                  // only twice
for (let i = 0; i < 4; i++) await buy({ title: "Shelf wobbler", price: 0.3, viaCard: true });              // all priced from a rate card
for (let i = 0; i < 3; i++) await buy({ title: "Window cling", price: 9, ageDays: 400 });                  // too old for 12 months
for (let i = 0; i < 3; i++) await buy({ title: "Header card", type: "3d", price: 3 });                    // same title, different spec type
for (let i = 0; i < 3; i++) await buy({ title: "Header card", currency: "GBP", price: 3 });               // same title, other currency
await buy({ title: "Lanyard", price: 1, status: "declined" }); await buy({ title: "Lanyard", price: 1, status: "declined" }); await buy({ title: "Lanyard", price: 1, status: "declined" }); // declined estimates do not count

test("repeat purchases group by spec type, a clean title and currency, with their spend, spread and reach", async () => {
  const list = await opps();
  const h = list.find((o) => o.title_key === "header card" && o.spec_type === "2d" && o.currency === "EUR");
  assert.ok(h);
  assert.deepEqual([h.orders, h.jobs, h.clients, h.suppliers], [5, 5, 3, 2]);
  assert.equal(Number(h.qty), 1500);
  assert.deepEqual([Number(h.min_cost), Number(h.max_cost), h.spread_pct], [2, 2.5, 25]);
  assert.equal(Number(h.spend), 100 * 2 + 200 * 2.2 + 300 * 2.5 + 400 * 2 + 500 * 2.4);
  assert.equal(Number(h.card_share_pct), 0);
  assert.equal(list.filter((o) => o.title_key === "header card").length, 3);                              // 3D and GBP are their own groups
  assert.equal(list[0].key, list.slice().sort((a, b) => Number(b.spend) - Number(a.spend))[0].key);       // biggest spend first
});

test("too few orders, too old, already on a rate card and declined estimates are left out", async () => {
  const keys = (await opps()).map((o) => o.title_key);
  assert.ok(!keys.includes("floor decal"));
  assert.ok(!keys.includes("shelf wobbler"));
  assert.ok(!keys.includes("window cling"));
  assert.ok(!keys.includes("lanyard"));
  assert.ok((await opps(12, 2)).some((o) => o.title_key === "floor decal"));                               // lower the minimum
  assert.ok((await opps(24, 3)).some((o) => o.title_key === "window cling"));                              // widen the window
  assert.ok(find(await opps(12, 3, "header"), "header"));
  assert.equal((await opps(12, 3, "no such thing")).length, 0);
  await rejects(as("agent", "select public.rate_card_opportunities(0,3,null,false)"), /between 1 and 60/);
  await rejects(as("anon_user", "select public.rate_card_opportunities()"), /./);
});

test("a group partly priced from a rate card shows the share; an open request is flagged", async () => {
  for (let i = 0; i < 3; i++) await buy({ title: "Mixed poster", price: 4, viaCard: i === 0 });             // one of three lines priced from a card
  const m = find(await opps(), "mixed poster");
  assert.equal(Number(m.card_share_pct), 33);
  assert.equal(m.open_request, false);
  await as("agent", "select public.rate_card_request_create($1::jsonb)", [JSON.stringify({ title: "Mixed poster A2", reason: "Repeat" })]);
  assert.equal(find(await opps(), "mixed poster").open_request, true);
});

test("the sourcing team can dismiss an opportunity with a reason, see it again, and restore it", async () => {
  const key = find(await opps(), "header card" ).key;
  await rejects(as("plain", "select public.rate_card_opportunity_dismiss($1,'Header card','Seasonal one-off')", [key]), /sourcing team/);
  await rejects(as("lead", "select public.rate_card_opportunity_dismiss($1,'Header card','')", [key]), /Say why/);
  await as("lead", "select public.rate_card_opportunity_dismiss($1,'Header card','Seasonal one-off')", [key]);
  assert.ok(!(await opps()).some((o) => o.key === key));
  const all = await opps(12, 3, null, true);
  const d = all.find((o) => o.key === key);
  assert.deepEqual([d.dismissed, d.dismissed_reason], [true, "Seasonal one-off"]);
  await as("lead", "select public.rate_card_opportunity_restore($1)", [key]);
  assert.ok((await opps()).some((o) => o.key === key));
});

test("different sizes of the same item are separate groups, each with its own price range", async () => {
  async function sized(len, wid, price) {
    const job = (await asSuper("insert into public.jobs (title, client_id, region, market, currency) values ('Sized job',$1,'EMEA','Germany','EUR') returning id", [clients[0]])).rows[0].id;
    const spec = (await asSuper("insert into public.job_specs (job_id, title, spec_type, size_unit) values ($1,'Sized banner','2d','mm') returning id", [job])).rows[0].id;
    await asSuper("insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',100,$2,$3)", [spec, len, wid]);
    const est = (await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market, status) values ($1,$2,'adopt','EUR',$3,10,'EMEA','Germany','approved') returning id", [job, sA, 100 * price])).rows[0].id;
    await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,100,$3,$4)", [est, spec, price, 100 * price]);
  }
  for (const p of [2, 2.1, 2.2]) await sized(600, 400, p);          // a small banner
  for (const p of [8, 8.4, 8.8]) await sized(1200, 800, p);          // a banner four times the area
  for (const p of [2, 2.05, 2.1]) await sized(610, 405, p);          // a size within the same band as the first
  const groups = (await opps()).filter((o) => o.title_key === "sized banner");
  assert.equal(groups.length, 2);
  const small = groups.find((g) => Number(g.min_cost) < 5), big = groups.find((g) => Number(g.min_cost) >= 5);
  assert.deepEqual([small.orders, big.orders], [6, 3]);
  assert.deepEqual([Number(small.min_cost), Number(small.max_cost), Number(big.min_cost), Number(big.max_cost)], [2, 2.2, 8, 8.8]);
  assert.deepEqual([Number(big.len_mm), Number(big.wid_mm)], [1200, 800]);
});
