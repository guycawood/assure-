// Impact Grade in the Shopper IQ asset library: an asset links to the spec it shows and carries that spec's grade.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const client = (await one("insert into public.sourcing_clients (code, name) values ('AG', 'Asset Grade Co') returning id")).id;
const job = (await as("agent", "insert into public.jobs (title, client_id, region, market) values ('Gondola job',$1,'EMEA','United Kingdom') returning id", [client])).rows[0].id;
const spec = (await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Gondola end','3d') returning id", [job])).rows[0].id;
const ungraded = (await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Shelf strip','2d') returning id", [job])).rows[0].id;
await asSuper("insert into public.impact_grade_records (subject_kind, subject_id, score, letter, confidence, range_low, range_high, review_status) values ('spec', $1, 72.5, 'B', 65, 66, 79, 'reviewed')", [spec]);
const V = "00000000-0000-0000-0000-0000000000e9";
t.ids.v = V;
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('AG-V','Asset Vendor','United Kingdom','EMEA','v@asset-vendor.example')");
await asSuper("insert into auth.users (id, email) values ($1, 'v@asset-vendor.example')", [V]);
const asset = async (title) => (await as("agent", "select public.siq_add_asset($1) as id", [JSON.stringify({ title, asset_type: "render_3d", region: "EMEA", market: "GB", file_name: "render.png" })])).rows[0].id;
const row = async (id) => (await as("plain", "select spec_id, spec_title, spec_job_number, ig_score, ig_letter, ig_confidence, ig_review_status from public.siq_assets_v where id = $1", [id])).rows[0];

test("an asset with no spec carries no grade", async () => {
  const a = await asset("Unlinked render");
  const r = await row(a);
  assert.deepEqual([r.spec_id, r.ig_score, r.ig_letter], [null, null, null]);
});

test("linking an asset to a spec brings in the spec's grade, and unlinking removes it", async () => {
  const a = await asset("Gondola render");
  await rejects(as("v", "select public.siq_asset_link_spec($1, $2)", [a, spec]), /staff can link/);
  await rejects(as("agent", "select public.siq_asset_link_spec($1, '00000000-0000-0000-0000-00000000dead')", [a]), /Spec not found/);
  await rejects(as("agent", "select public.siq_asset_link_spec('00000000-0000-0000-0000-00000000dead', $1)", [spec]), /Asset not found/);
  await as("agent", "select public.siq_asset_link_spec($1, $2)", [a, spec]);
  const r = await row(a);
  assert.equal(r.spec_title, "Gondola end");
  assert.match(r.spec_job_number, /^JB-/);
  assert.deepEqual([Number(r.ig_score), r.ig_letter, r.ig_confidence, r.ig_review_status], [72.5, "B", 65, "reviewed"]);
  // a spec that has not been graded yet links with no grade
  await as("agent", "select public.siq_asset_link_spec($1, $2)", [a, ungraded]);
  const u = await row(a);
  assert.deepEqual([u.spec_title, u.ig_score], ["Shelf strip", null]);
  await as("agent", "select public.siq_asset_link_spec($1, null)", [a]);
  assert.deepEqual([(await row(a)).spec_id, (await row(a)).ig_letter], [null, null]);
});

test("a spec deleted later leaves the asset in place", async () => {
  const a = await asset("Soon unlinked");
  const s = (await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Temp spec','2d') returning id", [job])).rows[0].id;
  await as("agent", "select public.siq_asset_link_spec($1, $2)", [a, s]);
  await asSuper("delete from public.job_specs where id = $1", [s]);
  assert.equal((await row(a)).spec_id, null);
});
