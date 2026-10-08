// Briefing+: campaigns, briefs, approval (never by the author), append-only histories, ideation and hand-off gates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;

const VENDOR = "00000000-0000-0000-0000-0000000000f1";
await asSuper("insert into auth.users (id, email) values ($1, 'someone@vendor-example.com')", [VENDOR]);
const { rows: [sub] } = await asSuper(`insert into public.library_records (library_key, code, name, data, status)
  values ('substrates', 'T-FBB', 'Folding box board', '{"recycled_content_percent":90}', 'active') returning id`);
const { rows: [retired] } = await asSuper(`insert into public.library_records (library_key, code, name, data, status)
  values ('substrates', 'T-PVC', 'PVC', '{}', 'retired') returning id`);

const BRIEF = { title: "Gondola end", objective: "Drive trial", brief_text: "A gondola end for 4-packs.", region: "EMEA", market: "gb", budget_low: "100", budget_high: "200", currency: "GBP" };

async function newBrief(user = "agent", submit = false, extra = {}) {
  const r = await as(user, "select public.brief_create($1, $2) as id", [JSON.stringify({ ...BRIEF, ...extra }), submit]);
  return r.rows[0].id;
}

test("internal staff create briefs; region and market are separate; nobody writes the tables directly", async () => {
  const id = await newBrief();
  const { rows: [b] } = await as("plain", "select status, region, market, brief_code, created_by from public.briefs where id = $1", [id]);
  assert.equal(b.status, "draft");
  assert.equal(b.region, "EMEA");
  assert.equal(b.market, "GB");
  assert.match(b.brief_code, /^BR-\d{4}-\d{5}$/);
  assert.equal(b.created_by, t.ids.agent);
  await rejects(as("agent", "insert into public.briefs (title) values ('x')"), /permission denied/);
  await rejects(as("agent", "update public.briefs set status = 'in_ideation' where id = $1", [id]), /permission denied/);
});

test("vendors cannot read or create briefs, campaigns or ideation", async () => {
  await newBrief();
  const r = await as(VENDOR, "select count(*)::int n from public.briefs");
  assert.equal(r.rows[0].n, 0);
  const c = await as(VENDOR, "select count(*)::int n from public.briefs_v");
  assert.equal(c.rows[0].n, 0);
  await rejects(as(VENDOR, "select public.brief_create($1, false)", [JSON.stringify(BRIEF)]), /staff only/);
  await rejects(as(VENDOR, "select public.campaign_save(null, '{\"name\":\"x\"}')"), /staff only/);
});

test("the author cannot approve their own brief; a colleague can", async () => {
  const id = await newBrief("agent", true);
  await rejects(as("agent", "select public.brief_decide($1, 'approved', null)", [id]), /cannot approve your own brief/);
  await as("lead", "select public.brief_decide($1, 'approved', 'Looks good')", [id]);
  const { rows: [b] } = await as("plain", "select status, approval_status, reviewed_by from public.briefs where id = $1", [id]);
  assert.deepEqual([b.status, b.approval_status, b.reviewed_by], ["in_ideation", "approved", t.ids.lead]);
  await rejects(as("head", "select public.brief_decide($1, 'approved', null)", [id]), /not waiting for approval/);
});

test("request changes needs a reason, returns to draft, and the history keeps every decision", async () => {
  const id = await newBrief("agent", true);
  await rejects(as("lead", "select public.brief_decide($1, 'changes_requested', '')", [id]), /what needs to change/);
  await as("lead", "select public.brief_decide($1, 'changes_requested', 'Add store counts')", [id]);
  assert.equal((await as("plain", "select status from public.briefs where id = $1", [id])).rows[0].status, "draft");
  await rejects(as("lead", "select public.brief_submit($1)", [id]), /Only the author/);
  await as("agent", "select public.brief_submit($1)", [id]);
  await as("head", "select public.brief_decide($1, 'approved', null)", [id]);
  const h = await as("plain", "select decision, decided_by from public.brief_approvals where brief_id = $1 order by id", [id]);
  assert.deepEqual(h.rows.map((r) => r.decision), ["changes_requested", "approved"]);
  const ev = await as("plain", "select event from public.brief_events where brief_id = $1 order by id", [id]);
  assert.deepEqual(ev.rows.map((r) => r.event), ["created", "submitted", "changes_requested", "submitted", "approved"]);
});

test("edits after submission append a revision with a diff and the previous version; drafts are not versioned", async () => {
  const id = await newBrief("agent");
  await as("agent", "select public.brief_update($1, $2)", [id, JSON.stringify({ ...BRIEF, title: "Draft rename" })]);
  assert.equal((await as("plain", "select count(*)::int n from public.brief_revisions where brief_id = $1", [id])).rows[0].n, 0);
  await as("agent", "select public.brief_submit($1)", [id]);
  const v = await as("agent", "select public.brief_update($1, $2) as v", [id, JSON.stringify({ ...BRIEF, title: "Draft rename", budget_high: "250" })]);
  assert.equal(v.rows[0].v, 1);
  await as("agent", "select public.brief_update($1, $2)", [id, JSON.stringify({ ...BRIEF, title: "Final name", budget_high: "250" })]);
  const r = await as("plain", "select version, changes, previous_version, revised_by from public.brief_revisions where brief_id = $1 order by version", [id]);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0].changes, [{ field: "Budget to", before: "200", after: "250" }]);
  assert.equal(r.rows[0].previous_version.find((f) => f.field === "Budget to").value, "200");
  assert.equal(r.rows[1].changes[0].field, "Title");
  assert.equal((await as("plain", "select revision_count from public.briefs where id = $1", [id])).rows[0].revision_count, 2);
  // Unchanged save adds nothing; only the author (or an admin) may edit.
  await as("agent", "select public.brief_update($1, $2)", [id, JSON.stringify({ ...BRIEF, title: "Final name", budget_high: "250" })]);
  assert.equal((await as("plain", "select count(*)::int n from public.brief_revisions where brief_id = $1", [id])).rows[0].n, 2);
  await rejects(as("lead", "select public.brief_update($1, $2)", [id, JSON.stringify(BRIEF)]), /Only the author/);
});

test("histories are append-only", async () => {
  await rejects(as("admin", "update public.brief_revisions set changes = '[]'"), /permission denied/);
  await rejects(as("admin", "delete from public.brief_revisions"), /permission denied/);
  await rejects(as("admin", "update public.brief_approvals set decision = 'approved'"), /permission denied/);
  await rejects(as("admin", "delete from public.brief_approvals"), /permission denied/);
  await rejects(as("admin", "insert into public.brief_approvals (brief_id, decision) select id, 'approved' from public.briefs limit 1"), /permission denied/);
  await rejects(as("admin", "delete from public.brief_events"), /permission denied/);
  await rejects(as("admin", "delete from public.ideation_messages"), /permission denied/);
  await rejects(as("admin", "update public.ideation_concepts set name = 'x'"), /permission denied/);
});

test("ideation and hand-off are blocked until the brief is approved", async () => {
  const id = await newBrief("agent", true);
  await rejects(as("agent", "select public.ideation_start('brief', $1, null, '{}', '{}')", [id]), /once the brief is approved/);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  const { rows: [{ s }] } = await as("agent", "select public.ideation_start('brief', $1, null, '{}', '{}') as s", [id]);
  const concepts = [
    { idx: 0, is_top: true, name: "Shelf-ready tray", data: { fit_score: 82 }, substrate_record_id: sub.id },
    { idx: 1, name: "Made-up material", data: {}, substrate_record_id: "11111111-1111-1111-1111-111111111111" },
    { idx: 2, name: "Retired material", data: {}, substrate_record_id: retired.id },
  ];
  const turn = await as("agent", "select public.ideation_add_turn($1, '', 'Three directions', $2, 'claude-sonnet-5-5', 'brief-ideation/v1', '{\"substrates\":1}', false) as r", [s, JSON.stringify(concepts)]);
  const ids = turn.rows[0].r.concept_ids;
  assert.equal(ids.length, 3);
  const c = await as("plain", "select name, substrate_record_id, model, prompt_version, context_snapshot from public.ideation_concepts where session_id = $1 order by idx", [s]);
  assert.deepEqual(c.rows.map((x) => x.substrate_record_id), [sub.id, null, null]);
  assert.equal(c.rows[0].prompt_version, "brief-ideation/v1");
  assert.deepEqual(c.rows[0].context_snapshot, { substrates: 1 });
  // Concept's substrate is now protected by the library usage guard.
  await rejects(as("admin", "select public.library_delete($1, null)", [sub.id]), /In use/);

  // Hand-off: payload is built server-side; one per concept; accepting moves the brief to spec_created.
  const { rows: [{ h }] } = await as("agent", "select public.brief_handoff_create($1, 'Go with the tray') as h", [ids[0]]);
  await rejects(as("agent", "select public.brief_handoff_create($1, null)", [ids[0]]), /already been sent/);
  const { rows: [ho] } = await as("plain", "select status, payload from public.brief_handoffs where id = $1", [h]);
  assert.equal(ho.status, "pending");
  assert.equal(ho.payload.brief.id, id);
  assert.equal(ho.payload.substrate.code, "T-FBB");
  assert.equal(ho.payload.concept.name, "Shelf-ready tray");
  await as("lead", "select public.brief_handoff_accept($1, null)", [h]);
  assert.equal((await as("plain", "select status from public.briefs where id = $1", [id])).rows[0].status, "spec_created");
  await rejects(as("agent", "select public.ideation_add_turn($1, 'more', 'x', '[]', 'm', 'v', '{}', false)", [s]), /once the brief is approved/);
  await rejects(as("lead", "select public.brief_handoff_accept($1, null)", [h]), /already been accepted/);
});

test("hand-off from a brief that is not approved is refused", async () => {
  const id = await newBrief("agent", true);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  const { rows: [{ s }] } = await as("agent", "select public.ideation_start('brief', $1, null, '{}', '{}') as s", [id]);
  const turn = await as("agent", "select public.ideation_add_turn($1, null, 'x', '[{\"idx\":0,\"name\":\"A\",\"data\":{}}]', 'm', 'v', '{}', true) as r", [s]);
  await as("agent", "select public.brief_archive($1, 'Cancelled')", [id]);
  await rejects(as("agent", "select public.brief_handoff_create($1, null)", [turn.rows[0].r.concept_ids[0]]), /once the brief is approved/);
});

test("campaign ideation needs an objective; campaigns keep region and market per market row", async () => {
  await rejects(as("agent", "select public.ideation_start('campaign', null, '  ', '{}', '{}')"), /objective/);
  const { rows: [{ id }] } = await as("agent", `select public.campaign_save(null, $1) as id`, [JSON.stringify({
    name: "Summer", client: "Heineken", brands: ["Heineken", " "], campaign_type: "seasonal", activation_objective: "trial",
    markets: [{ region: "EMEA", market: "gb" }, { region: "EMEA", market: "IT" }],
  })]);
  const m = await as("plain", "select region, market from public.campaign_markets where campaign_id = $1 order by market", [id]);
  assert.deepEqual(m.rows, [{ region: "EMEA", market: "GB" }, { region: "EMEA", market: "IT" }]);
  const v = await as("plain", "select brands, markets, campaign_code from public.campaigns_v where id = $1", [id]);
  assert.deepEqual(v.rows[0].brands, ["Heineken"]);
  assert.deepEqual(v.rows[0].markets, ["GB", "IT"]);
  await rejects(as("agent", "select public.campaign_save(null, $1)", [JSON.stringify({ name: "x", markets: [{ market: "GB" }] })]), /region and a market/);
});
