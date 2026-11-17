// SRM vendor capability profile: capabilities, machines and tooling. Vendors keep their own; SRM verifies (never
// the person who last changed an entry); vendors never see or change another vendor's; tooling is never deleted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const VA = "00000000-0000-0000-0000-0000000000d1";
const VB = "00000000-0000-0000-0000-0000000000d2";
const { rows: [a] } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('CP-A','Alpha Plastics','Poland','EMEA','BAU','POSM','ca@alpha.example') returning id");
const { rows: [b] } = await asSuper("insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('CP-B','Beta Print','Germany','EMEA','BAU','Print','cb@beta.example') returning id");
await asSuper("insert into auth.users (id, email) values ($1,'ca@alpha.example'), ($2,'cb@beta.example')", [VA, VB]);
Object.assign(ids, { va: VA, vb: VB });
const lib = async (key, code) => (await asSuper("select id from public.library_records where library_key = $1 and code = $2", [key, code])).rows[0].id;
const INJ = await lib("srm_processes", "PLS-INJECT");
const MC = await lib("srm_machine_types", "MC-INJECT");
const MOULD = await lib("srm_tooling_types", "TL-INJ-MOULD");
const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('CPC', 'Capco (demo)') returning id");

test("a vendor declares its own capability and machine; SRM verifies; any change makes it declared again", async () => {
  const cap = (await as("va", "select public.srm_capability_save('capability', null, $1, $2::jsonb) id", [a.id, JSON.stringify({ process_id: INJ, max_width_mm: 600, monthly_capacity: 200000, lead_time_days: 21, materials: ["PP", "ABS"] })])).rows[0].id;
  const m = (await as("va", "select public.srm_capability_save('machine', null, $1, $2::jsonb) id", [a.id, JSON.stringify({ machine_type_id: MC, make: "Engel", model: "victory 200", year_built: 2019, quantity: 3 })])).rows[0].id;
  let row = (await asSuper("select evidence_status, materials, monthly_capacity from public.supplier_capabilities where id = $1", [cap])).rows[0];
  assert.equal(row.evidence_status, "declared");
  assert.deepEqual(row.materials, ["PP", "ABS"]);
  await t.rejects(as("va", "select public.srm_capability_verify('capability', $1, true, null)", [cap]), /Only SRM/);
  await as("agent", "select public.srm_capability_verify('capability', $1, true, 'Seen on site visit')", [cap]);
  assert.equal((await asSuper("select evidence_status from public.supplier_capabilities where id = $1", [cap])).rows[0].evidence_status, "verified");
  await as("va", "select public.srm_capability_save('capability', $1, null, $2::jsonb)", [cap, JSON.stringify({ process_id: INJ, monthly_capacity: 250000 })]);
  assert.equal((await asSuper("select evidence_status from public.supplier_capabilities where id = $1", [cap])).rows[0].evidence_status, "declared");
  assert.equal((await asSuper("select quantity from public.supplier_machines where id = $1", [m])).rows[0].quantity, 3);
});

test("SRM cannot verify what it entered itself", async () => {
  const id = (await as("agent", "select public.srm_capability_save('machine', null, $1, $2::jsonb) id", [a.id, JSON.stringify({ machine_type_id: MC, make: "Arburg" })])).rows[0].id;
  await t.rejects(as("agent", "select public.srm_capability_verify('machine', $1, true, null)", [id]), /different person/);
  await as("lead", "select public.srm_capability_verify('machine', $1, true, null)", [id]);
});

test("vendors see and change only their own entries", async () => {
  assert.equal((await as("vb", "select count(*)::int n from public.supplier_capabilities")).rows[0].n, 0);
  await t.rejects(as("vb", "select public.srm_capability_save('capability', null, $1, $2::jsonb)", [a.id, JSON.stringify({ process_id: INJ })]), /Not allowed/);
  const cap = (await asSuper("select id from public.supplier_capabilities where supplier_id = $1 limit 1", [a.id])).rows[0].id;
  await t.rejects(as("vb", "select public.srm_capability_remove('capability', $1)", [cap]), /Not allowed/);
  await t.rejects(as("va", "insert into public.supplier_machines (supplier_id, machine_type_id) values ($1, $2)", [a.id, MC]), /permission denied|policy/);
});

test("tooling records who owns it, links to a spec, and is retired rather than deleted", async () => {
  await t.rejects(as("va", "select public.srm_capability_save('tooling', null, $1, $2::jsonb)", [a.id, JSON.stringify({ tooling_type_id: MOULD, description: "Shelf wobbler mould", owner: "client" })]), /which client/);
  const tl = (await as("va", "select public.srm_capability_save('tooling', null, $1, $2::jsonb) id", [a.id, JSON.stringify({ tooling_type_id: MOULD, description: "Shelf wobbler mould", owner: "client", owner_client_id: client.id, cavities: 4, lifetime: 500000, used: 120000 })])).rows[0].id;
  const row = (await asSuper("select tool_code, owner, owner_client_id, cavities from public.supplier_tooling where id = $1", [tl])).rows[0];
  assert.match(row.tool_code, /^TL-\d{4}-\d{5}$/);
  assert.equal(row.owner_client_id, client.id);
  await t.rejects(as("va", "select public.srm_capability_remove('tooling', $1)", [tl]), /retired or returned/);
  await as("va", "select public.srm_capability_save('tooling', $1, null, $2::jsonb)", [tl, JSON.stringify({ tooling_type_id: MOULD, owner: "client", owner_client_id: client.id, status: "returned" })]);
  assert.equal((await asSuper("select status from public.supplier_tooling where id = $1", [tl])).rows[0].status, "returned");
  const ev = (await asSuper("select action from public.supplier_capability_events where item_id = $1 order by at", [tl])).rows.map((r) => r.action);
  assert.deepEqual(ev, ["added", "changed"]);
});
