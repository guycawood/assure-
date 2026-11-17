// Procurement director overview: pool, jobs, performance, risk, approvals and the vendors needing attention; gated and region-filterable.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { cpo: "00000000-0000-0000-0000-0000000001b1", sus: "00000000-0000-0000-0000-0000000001b2", srt: "00000000-0000-0000-0000-0000000001b3", pm: "00000000-0000-0000-0000-0000000001b4" };
Object.assign(ids, U);
for (const [k, id] of Object.entries(U)) await asSuper("insert into auth.users (id, email) values ($1,$2)", [id, `${k}@adm-indicia.com`]);
const assign = (u, role) => as("admin", "select public.division_role_assign($1,'assure',$2,null)", [ids[u], role]);
await assign("cpo", "cpo"); await assign("sus", "sustainability"); await assign("srt", "srt"); await assign("pm", "procurement_manager");
const mk = async (code, region) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany',$3,$4) returning id", [code, `Vendor ${code}`, region, `${code}@ov.example`])).rows[0].id;
const A = await mk("OV-A", "EMEA"), B = await mk("OV-B", "EMEA"), C = await mk("OV-C", "APAC");
const ov = async (u, region = null) => (await as(u, "select public.srm_director_overview($1) as o", [region])).rows[0].o;

test("the overview counts the pool and can be filtered by region", async () => {
  const all = await ov("cpo"), emea = await ov("cpo", "EMEA");
  assert.ok(all.pool.total >= 3);
  assert.equal(emea.pool.total, all.pool.total - (await asSuper("select count(*)::int n from public.suppliers where region is distinct from 'EMEA'")).rows[0].n);
  assert.ok(all.pool.by_region.APAC >= 1);
  assert.equal(all.region, null);
  assert.equal(emea.region, "EMEA");
});

test("performance, risk and attention reflect the vendors' records", async () => {
  await asSuper("insert into public.performance_records (supplier_id, period, cost_score, otif_score, quality_score) values ($1,'2026-Q3',40,50,45), ($2,'2026-Q3',90,95,92)", [A, B]);
  const f = (await as("sus", "select public.esg_flag_raise($1,'high','Overtime reported',null,null,null) as id", [A])).rows[0].id;
  await as("sus", "select public.esg_flag_propose_decision($1,'accept','Plan agreed')", [f]);
  const o = await ov("cpo", "EMEA");
  assert.equal(o.performance.below_60 >= 1, true);
  assert.equal(o.performance.lowest[0].name, "Vendor OV-A");
  assert.equal(Number(o.performance.lowest[0].score), 45);
  assert.equal(o.risk.open_esg >= 1 && o.risk.high_esg >= 1, true);
  assert.equal(o.approvals.joint_waiting >= 1, true);
  assert.equal(o.attention[0].name, "Vendor OV-A");
  assert.equal(o.attention[0].open_esg, 1);
  assert.ok(!o.attention.some((x) => x.name === "Vendor OV-B"));                              // nothing wrong with B, so it is not listed
  assert.ok(!(await ov("cpo", "APAC")).attention.some((x) => x.name === "Vendor OV-A"));      // outside the region
});

test("only levels with vendor-performance visibility reach it; money follows the money rule", async () => {
  assert.equal(typeof (await ov("agent")).pool.total, "number");                              // the SRT sees vendor performance
  assert.equal(typeof (await ov("pm")).pool.total, "number");
  assert.equal((await ov("srt")).can_see_money, false);
  assert.equal((await ov("cpo")).can_see_money, true);
  assert.equal((await ov("sus")).pool.total >= 3, true);
  await asSuper("insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000001b9','ov-v@ov.example')");
  ids.ovv = "00000000-0000-0000-0000-0000000001b9";
  await rejects(as("ovv", "select public.srm_director_overview(null)"), /./);                 // a vendor user never reaches it
});
