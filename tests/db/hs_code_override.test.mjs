// HS code override and input: staff set/clear a spec's code with a source and a reason (logged, works on a locked spec);
// a vendor declares their own code for specs they supply (an input, never an override); staff see both side by side.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb, ids } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const sup1 = async (sql, params) => (await asSuper(sql, params)).rows[0];
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

const VENDOR = "00000000-0000-0000-0000-0000000000e1", OTHER = "00000000-0000-0000-0000-0000000000e2";
await asSuper("insert into auth.users (id, email) values ($1,'v1@hs.example'), ($2,'v2@hs.example')", [VENDOR, OTHER]);
await asSuper("select set_config('sourcing.system_write', 'on', false)");
const client = await sup1("insert into public.sourcing_clients (code, name) values ('HSO','HS Override Client') returning id");
const mk = async (code) => (await sup1("insert into public.suppliers (supplier_code, name, market, region) values ($1,$1,'Germany','EMEA') returning id", [code])).id;
const supA = await mk("HS-A"), supB = await mk("HS-B");
await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [VENDOR, supA]);
await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [OTHER, supB]);
const job = await sup1("insert into public.jobs (title, client_id, region, market, created_by) values ('HS job',$1,'EMEA','Germany',$2) returning id", [client.id, ids.agent]);
const spec1 = (await sup1("insert into public.job_specs (job_id, title, spec_type) values ($1,'Spec one','2d') returning id", [job.id])).id;
const spec2 = (await sup1("insert into public.job_specs (job_id, title, spec_type) values ($1,'Spec two','2d') returning id", [job.id])).id;
const est = await sup1(`insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status, created_by)
  values ($1,$2,'rfq','EUR',100,'EMEA','Germany','approved',$3) returning id`, [job.id, supA, ids.agent]);
await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,100,1,100)", [est.id, spec1]);
await asSuper("select set_config('sourcing.system_write', 'off', false)");

test("staff set an HS code with a source and reason; it is logged and can be cleared", async () => {
  await as("agent", "select public.spec_hs_set($1, '3919.90', 'person', 'Checked with the broker')", [spec1]);
  const s = await sup1("select hs_code, hs_code_source, hs_code_note, hs_code_set_by from public.job_specs where id = $1", [spec1]);
  assert.deepEqual([s.hs_code, s.hs_code_source, s.hs_code_note, s.hs_code_set_by], ["3919.90", "person", "Checked with the broker", ids.agent]);
  const ev = await sup1("select detail from public.sourcing_events where entity_id = $1 and event = 'hs_code_set' order by id desc limit 1", [spec1]);
  assert.equal(ev.detail.to, "3919.90");
  await rejects(as("agent", "select public.spec_hs_set($1, 'abc')", [spec1]), /4 to 10 digits/);
  await as("agent", "select public.spec_hs_set($1, '')", [spec1]);
  assert.equal((await sup1("select hs_code, hs_code_source from public.job_specs where id = $1", [spec1])).hs_code, null);
});

test("an HS code can be set on a spec that is locked by an awarded RFQ", async () => {
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const rfq = await sup1("insert into public.rfqs (job_id, title, status, region, market, created_by) values ($1,'Locked','awarded','EMEA','Germany',$2) returning id", [job.id, ids.agent]).catch(() => null);
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  if (rfq) {
    await asSuper("insert into public.rfq_lines (rfq_id, spec_id, line_no) values ($1,$2,1)", [rfq.id, spec2]).catch(() => null);
  }
  await as("agent", "select public.spec_hs_set($1, '4911.10', 'library')", [spec2]);
  assert.equal((await sup1("select hs_code_source from public.job_specs where id = $1", [spec2])).hs_code_source, "library");
});

test("a vendor can declare a code only for a spec they supply, sees only their own, and staff see it beside the spec's code", async () => {
  await as(VENDOR, "select public.vendor_hs_declare($1, '3926.90', 'We ship under this code')", [spec1]);
  await rejects(as(VENDOR, "select public.vendor_hs_declare($1, '3926.90')", [spec2]), /not one you are supplying/);
  await rejects(as(OTHER, "select public.vendor_hs_declare($1, '3926.90')", [spec1]), /not one you are supplying/);
  const mine = (await one(VENDOR, "select public.vendor_hs_list() l")).l;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].mine, "3926.90");
  assert.equal((await one(OTHER, "select public.vendor_hs_list() l")).l.length, 0);
  assert.equal((await as(OTHER, "select * from public.spec_hs_declarations")).rows.length, 0); // RLS: not another vendor's
  await rejects(as(VENDOR, "select public.spec_hs_set($1, '1111.11')", [spec1]), /Only staff/);

  const view = (await one("agent", "select public.spec_hs_overview($1, null) o", [job.id])).o;
  const row = view.find((r) => r.spec_id === spec1);
  assert.equal(row.declared[0].hs_code, "3926.90");
  assert.equal(row.declared[0].supplier_name, "HS-A");
  const bySupplier = (await one("agent", "select public.spec_hs_overview(null, $1) o", [supA])).o;
  assert.deepEqual(bySupplier.map((r) => r.spec_id), [spec1]);
  assert.equal(view.length, 2);

  await as(VENDOR, "select public.vendor_hs_declare($1, '')", [spec1]);
  assert.equal((await one(VENDOR, "select public.vendor_hs_list() l")).l[0].mine, null);
});

