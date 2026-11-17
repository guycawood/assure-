// CRM client sustainability targets: who can set them, the audit trail, the lookup briefs use, and how ideation
// folds them into a brief (stricter wins, excluded materials never offered).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupDb } from "./helpers.mjs";
import { allowedSubstrates, briefGaps, parseClientTargets, withClientTargets } from "../../src/lib/client-targets.ts";

const t = await setupDb();
const CLIENT = "c5000000-0000-4000-8000-0000000000aa";
await t.asSuper("insert into public.sourcing_clients (id, code, name) values ($1, 'TST', 'Testco (demo)')", [CLIENT]);

test("internal staff set a client's targets with a reason; it is audited; outsiders cannot", async () => {
  const p = JSON.stringify({ statement: "No PVC", min_recycled_pct: "40", require_fsc: true, excluded_materials: ["PVC", " pvc ", "Acrylic"], impact_grade_floor: "60" });
  await t.rejects(t.as("admin", "select public.crm_client_set_sustainability($1, $2::jsonb, '')", [CLIENT, p]), /Say why/);
  await t.as("admin", "select public.crm_client_set_sustainability($1, $2::jsonb, 'MSA clause 12')", [CLIENT, p]);
  const { rows } = await t.asSuper("select * from public.crm_client_sustainability where client_id = $1", [CLIENT]);
  assert.equal(rows[0].min_recycled_pct, 40);
  assert.equal(Number(rows[0].impact_grade_floor), 60);
  assert.deepEqual(rows[0].excluded_materials, ["Acrylic", "PVC"], "one entry per material, whatever the case");
  const { rows: ev } = await t.asSuper("select action, detail from public.crm_events where client_id = $1 and action = 'sustainability_targets_changed'", [CLIENT]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].detail.reason, "MSA clause 12");
  await t.rejects(t.as("admin", "select public.crm_client_set_sustainability($1, '{\"impact_grade_floor\":\"120\"}'::jsonb, 'x')", [CLIENT]), /0 to 100/);
  await t.rejects(t.as("admin", "insert into public.crm_client_sustainability (client_id) values ($1)", [CLIENT]), /permission denied|policy/);
});

test("a brief finds its client's targets by id or by the client name or code typed on it", async () => {
  const byId = (await t.as("plain", "select public.client_sustainability_targets($1, null) v", [CLIENT])).rows[0].v;
  const byName = (await t.as("plain", "select public.client_sustainability_targets(null, 'Testco') v")).rows[0].v;
  const byCode = (await t.as("plain", "select public.client_sustainability_targets(null, 'tst') v")).rows[0].v;
  assert.equal(byId.client_code, "TST");
  assert.equal(byName.min_recycled_pct, 40);
  assert.equal(byCode.require_fsc, true);
  assert.equal((await t.as("plain", "select public.client_sustainability_targets(null, 'Nobody') v")).rows[0].v, null);
});

test("ideation sees the stricter of client and brief, without the client's excluded materials", async () => {
  const ct = parseClientTargets((await t.as("plain", "select public.client_sustainability_targets($1, null) v", [CLIENT])).rows[0].v);
  const brief = { sustainability_targets: "Reuse the frame", min_recycled_pct: 20, require_fsc: false };
  const eff = withClientTargets(brief, ct);
  assert.equal(eff.min_recycled_pct, 40, "client minimum is higher");
  assert.equal(eff.require_fsc, true);
  assert.match(eff.sustainability_targets, /Client commitments \(CRM\)/);
  assert.match(eff.sustainability_targets, /Reuse the frame/, "the brief's own targets are kept");
  assert.equal(withClientTargets({ ...brief, min_recycled_pct: 70 }, ct).min_recycled_pct, 70, "a stricter brief stays stricter");
  assert.equal(briefGaps(brief, ct).length, 2, "weaker recycled content and missing FSC are flagged");
  const subs = [{ name: "PVC foam board 5mm", data: { substrate_type: "pvc_foam" } }, { name: "Acrylic 3mm", data: {} }, { name: "Recycled board", data: { substrate_type: "board" } }];
  assert.deepEqual(allowedSubstrates(subs, ct).map((s) => s.name), ["Recycled board"]);
});
