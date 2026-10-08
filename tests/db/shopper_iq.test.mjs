// Shopper IQ: taxonomy from Watchtower libraries, effectiveness records and the asset library.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;

const VENDOR = "00000000-0000-0000-0000-0000000000f2";
await asSuper("insert into auth.users (id, email) values ($1, 'someone@vendor-example.com')", [VENDOR]);
await asSuper(`insert into public.library_records (library_key, code, name, status) values
  ('touchpoint_types', 'TP-DISPLAY', 'Display', 'active'), ('touchpoint_types', 'TP-OLD', 'Old', 'retired'),
  ('p2p_stages', 'P2P-SELL', 'Sell', 'active')`);
const { rows: [{ id: campaign }] } = await as("agent", "select public.campaign_save(null, $1) as id",
  [JSON.stringify({ name: "Summer", client: "Heineken", brands: ["Heineken 0.0"], markets: [{ region: "EMEA", market: "GB" }] })]);

test("effectiveness records reference the taxonomy by FK and keep region and market separate", async () => {
  const { rows: [{ id }] } = await as("agent", "select public.siq_record_effectiveness($1) as id", [JSON.stringify({
    campaign_id: campaign, region: "EMEA", market: "gb", touchpoint: "TP-DISPLAY", p2p_stage: "P2P-SELL", channel: "Off-trade",
    spend: "1200", execution_score: "84", uplift_pct: "6.5", uplift_source: "retailer_data",
  })]);
  const { rows: [e] } = await as("plain", "select market, touchpoint_name, p2p_stage_name, campaign_name, spend from public.siq_effectiveness_v where id = $1", [id]);
  assert.deepEqual(e, { market: "GB", touchpoint_name: "Display", p2p_stage_name: "Sell", campaign_name: "Summer", spend: "1200" });
  const ref = await as("plain", "select count(*)::int n from public.library_refs where ref_table = 'siq_effectiveness' and ref_id = $1", [id]);
  assert.equal(ref.rows[0].n, 2);
});

test("validation: retired or unknown taxonomy values, uplift without a source, missing market", async () => {
  const base = { campaign_id: campaign, region: "EMEA", market: "GB", touchpoint: "TP-DISPLAY", spend: "10" };
  await rejects(as("agent", "select public.siq_record_effectiveness($1)", [JSON.stringify({ ...base, touchpoint: "TP-OLD" })]), /Unknown touchpoint types/);
  await rejects(as("agent", "select public.siq_record_effectiveness($1)", [JSON.stringify({ ...base, uplift_pct: "4" })]), /check constraint/);
  await rejects(as("agent", "select public.siq_record_effectiveness($1)", [JSON.stringify({ ...base, market: "" })]), /Region and market/);
  await rejects(as("agent", "select public.siq_record_effectiveness($1)", [JSON.stringify({ ...base, execution_score: "140" })]), /check constraint/);
});

test("assets pick up campaign metadata automatically", async () => {
  const { rows: [{ id }] } = await as("agent", "select public.siq_add_asset($1) as id", [JSON.stringify({
    title: "Gondola end photo", asset_type: "executional_image", campaign_id: campaign, region: "EMEA", market: "GB",
    touchpoint: "TP-DISPLAY", file_name: "photo.jpg", metadata: { headline: "Zero alcohol" },
  })]);
  const { rows: [a] } = await as("plain", "select brand, metadata_source, touchpoint_name, metadata, asset_code from public.siq_assets_v where id = $1", [id]);
  assert.equal(a.brand, "Heineken 0.0");
  assert.equal(a.metadata_source, "job");
  assert.equal(a.touchpoint_name, "Display");
  assert.equal(a.metadata.headline, "Zero alcohol");
  assert.match(a.asset_code, /^AS-\d{4}-\d{5}$/);
});

test("internal only; no direct writes", async () => {
  assert.equal((await as(VENDOR, "select count(*)::int n from public.siq_effectiveness_v")).rows[0].n, 0);
  assert.equal((await as(VENDOR, "select count(*)::int n from public.siq_assets")).rows[0].n, 0);
  await rejects(as(VENDOR, "select public.siq_add_asset('{\"title\":\"x\"}')"), /staff only/);
  await rejects(as("agent", "insert into public.siq_assets (title, asset_type) values ('x', 'playbook')"), /permission denied/);
  await rejects(as("admin", "delete from public.siq_effectiveness"), /permission denied/);
});
