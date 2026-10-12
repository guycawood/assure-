// Platform approvals: approval policies (Watchtower library), one inbox across modules (approvals_% views), overdue from
// the policy SLA, and the Briefing+ concept approval gates (internal, client, campaign concept -> briefs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const U = {
  cA1: "00000000-0000-0000-0000-0000000000d1", // Acme approver
  cA2: "00000000-0000-0000-0000-0000000000d2", // Acme viewer
  cB1: "00000000-0000-0000-0000-0000000000d3", // Bolt approver
};
Object.assign(ids, U);
for (const [id, email] of [[U.cA1, "ann@acme.example"], [U.cA2, "vic@acme.example"], [U.cB1, "bob@bolt.example"]]) {
  await asSuper("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const A = (await one("insert into public.sourcing_clients (code, name) values ('TA', 'Acme (test)') returning id")).id;
const B = (await one("insert into public.sourcing_clients (code, name) values ('TB', 'Bolt Drinks') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA1, A]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [U.cA2, A]);
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cB1, B]);

async function policy(code, data) {
  await asSuper(`insert into public.library_records (library_key, code, name, data, status, effective_from)
    values ('approval_policies', $1, $1, $2, 'active', current_date - 1)`, [code, JSON.stringify(data)]);
}

const BRIEF = { title: "Gondola end", objective: "Drive trial", brief_text: "A gondola end.", region: "EMEA", market: "GB", budget_low: "100", budget_high: "200", currency: "GBP" };
async function approvedBrief(extra = {}) {
  const id = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ ...BRIEF, ...extra })])).rows[0].id;
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  return id;
}
async function conceptOn(briefId, name = "Shelf-ready tray") {
  const s = (await as("agent", "select public.ideation_start('brief', $1, null, '{}', '{}') as s", [briefId])).rows[0].s;
  const r = await as("agent", "select public.ideation_add_turn($1, '', 'One direction', $2, 'm', 'v1', '{}', true) as r",
    [s, JSON.stringify([{ idx: 0, name, data: { creative_direction: "Tray", indicative_unit_price: 4.2, rationale: "Fits" } }])]);
  return r.rows[0].r.concept_ids[0];
}
const inbox = async (user, scope = "mine") => (await as(user, "select * from public.approvals_inbox($1)", [scope])).rows;

test("admin sees every pending approval across modules with approvals_inbox('all'); non-admins are refused", async () => {
  const brief = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).rows[0].id;
  const lib = (await as("admin2", "select public.library_create('approval_policies', 'AP-T-DRAFT', 'Draft policy', '{\"approval_type\":\"DRAFT\"}', null, null) as id")).rows[0].id;
  const all = await inbox("admin", "all");
  assert.ok(all.some((r) => r.module === "briefing" && r.approval_type === "BRIEF" && r.item_id === brief));
  assert.ok(all.some((r) => r.module === "watchtower" && r.approval_type === "LIBRARY" && r.item_id === lib));
  await rejects(as("lead", "select * from public.approvals_inbox('all')"), /Only admins/);
  await rejects(as(U.cA1, "select * from public.approvals_inbox('mine')"), /adm Indicia staff/);
  // Views are only read through the inbox.
  await rejects(as("admin", "select * from public.approvals_briefing"), /permission denied/);
});

test("'mine' lists what I may decide and never my own request under maker-checker", async () => {
  const brief = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).rows[0].id;
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === brief));
  assert.ok((await inbox("lead")).some((r) => r.item_id === brief && r.can_decide));
  const lib = (await as("admin2", "select public.library_create('approval_policies', 'AP-T-MINE', 'Mine', '{\"approval_type\":\"MINE\"}', null, null) as id")).rows[0].id;
  assert.ok(!(await inbox("admin2")).some((r) => r.item_id === lib));
  assert.ok((await inbox("admin")).some((r) => r.item_id === lib));
  // A colleague with no governance role over the library can't decide it.
  assert.ok(!(await inbox("lead")).some((r) => r.item_id === lib));
});

test("overdue comes from the policy SLA; approval_policy_for returns the most specific active policy", async () => {
  await policy("AP-T-BRIEF", { module: "briefing", approval_type: "BRIEF", sla_days: 2, maker_checker: true });
  await policy("AP-T-BRIEF-HIGH", { module: "briefing", approval_type: "BRIEF", approver_role: "procurement_head", min_value: 100000, sla_days: 5 });
  const oldB = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).rows[0].id;
  const newB = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).rows[0].id;
  await asSuper("update public.briefs set submitted_at = now() - interval '3 days' where id = $1", [oldB]);
  const all = await inbox("admin", "all");
  assert.equal(all.find((r) => r.item_id === oldB).status, "overdue");
  assert.equal(all.find((r) => r.item_id === newB).status, "pending");
  assert.equal((await as("lead", "select code from public.approval_policy_for('BRIEF', null, 'GB', 200)")).rows[0].code, "AP-T-BRIEF");
  assert.equal((await as("lead", "select code from public.approval_policy_for('BRIEF', null, 'GB', 250000)")).rows[0].code, "AP-T-BRIEF-HIGH");
  await rejects(as(U.cA1, "select * from public.approval_policy_for('BRIEF', null, null, null)"), /adm Indicia staff/);
  // brief_decide enforces the policy role (and still never the author).
  const big = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ ...BRIEF, budget_high: "250000" })])).rows[0].id;
  await rejects(as("lead", "select public.brief_decide($1, 'approved', null)", [big]), /procurement head/);
  await as("head", "select public.brief_decide($1, 'approved', null)", [big]);
  const h = (await health()).find((r) => r.metric === "approvals_overdue");
  assert.ok(Number(h.value) >= 1);
});

async function health() {
  return (await as("admin", "select * from public.watchtower_health_approvals")).rows;
}

test("a concept can't go to Sourcing+ before approval; the submitter can't approve it; the approver needs the policy role", async () => {
  await policy("AP-T-CONCEPT", { module: "briefing", approval_type: "CONCEPT", approver_role: "briefing_lead", maker_checker: true, sla_days: 3 });
  const brief = await approvedBrief();
  const c = await conceptOn(brief);
  await rejects(as("agent", "select public.brief_handoff_create($1, null)", [c]), /must be approved/);
  await as("agent", "select public.concept_submit($1, 'Go with the tray')", [c]);
  await rejects(as("agent", "select public.concept_decide($1, 'approved', null)", [c]), /someone else must approve/);
  await rejects(as("plain", "select public.concept_decide($1, 'approved', null)", [c]), /needs a briefing lead/);
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === c));
  assert.ok((await inbox("lead")).some((r) => r.item_id === c && r.approval_type === "CONCEPT"));
  await rejects(as("lead", "select public.concept_decide($1, 'changes_requested', ' ')", [c]), /what needs to change/);
  await as("lead", "select public.concept_decide($1, 'approved', 'Good')", [c]);
  await as("agent", "select public.brief_handoff_create($1, null)", [c]);
  assert.equal((await one("select status from public.ideation_concepts where id = $1", [c])).status, "sent_to_sourcing");
  const audit = (await as("plain", "select action, actor from public.concept_approvals where concept_id = $1 order by id", [c])).rows;
  assert.deepEqual(audit.map((a) => a.action), ["submitted", "approved", "sent_to_sourcing"]);
  assert.equal(audit[1].actor, ids.lead);
  await rejects(as("admin", "update public.concept_approvals set comments = 'x'"), /permission denied/);
  const ev = (await as("plain", "select event from public.brief_events where brief_id = $1 order by id", [brief])).rows.map((r) => r.event);
  assert.ok(ev.includes("concept_submitted") && ev.includes("concept_approved") && ev.includes("handoff_created"));
});

test("client approval required: hand-off waits for a client approver; viewers and other clients can't decide; clients see only their own, client-safe", async () => {
  await policy("AP-T-CONCEPT-TA", { module: "briefing", approval_type: "CONCEPT", approver_role: "briefing_lead", client_code: "TA", client_approval_required: true, sla_days: 3 });
  const brief = await approvedBrief({ client: "Acme" });
  const c = await conceptOn(brief, "Acme tray");
  await as("agent", "select public.concept_submit($1, null)", [c]);
  await as("lead", "select public.concept_decide($1, 'approved', null)", [c]);
  assert.equal((await one("select client_status from public.ideation_concepts where id = $1", [c])).client_status, "pending");
  assert.ok((await inbox("admin", "all")).some((r) => r.item_id === c && r.approval_type === "CONCEPT_CLIENT"));
  await rejects(as("agent", "select public.brief_handoff_create($1, null)", [c]), /client must approve/);

  await rejects(as(U.cA2, "select public.client_concept_decide($1, true, null)", [c]), /Only approvers/);
  await rejects(as(U.cB1, "select public.client_concept_decide($1, true, null)", [c]), /Not found/);
  await rejects(as("lead", "select public.client_concept_decide($1, true, null)", [c]), /read-only/);
  assert.deepEqual((await as(U.cB1, "select public.client_portal_concepts($1) as x", [brief])).rows[0].x, []);
  const mine = (await as(U.cA1, "select public.client_portal_concepts($1) as x", [brief])).rows[0].x;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "Acme tray");
  assert.equal(mine[0].role, "approver");
  assert.ok(!("indicative_unit_price" in mine[0]) && !("decision_comments" in mine[0]) && !("submit_note" in mine[0]));
  assert.ok(!JSON.stringify(mine).includes("4.2"));

  await rejects(as(U.cA1, "select public.client_concept_decide($1, false, '')", [c]), /what you would like changed/);
  await as(U.cA1, "select public.client_concept_decide($1, true, 'Lovely')", [c]);
  await as("agent", "select public.brief_handoff_create($1, null)", [c]);
  const audit = (await as("plain", "select stage, action from public.concept_approvals where concept_id = $1 order by id", [c])).rows;
  assert.deepEqual(audit.map((a) => `${a.stage}:${a.action}`), ["internal:submitted", "internal:approved", "client:approved", "internal:sent_to_sourcing"]);
});

test("campaign ideation concept: submit, approve, then draft briefs per market linked back to the concept", async () => {
  const s = (await as("agent", "select public.ideation_start('campaign', null, 'Drive trial in summer', '{\"client\":\"Acme\",\"brand\":\"Fizz\"}', '{}') as s")).rows[0].s;
  const r = await as("agent", "select public.ideation_add_turn($1, 'x', 'Shortlist', $2, 'm', 'v1', '{}', true) as r",
    [s, JSON.stringify([{ kind: "product_type", idx: 0, name: "Chiller wrap", data: { suggested_spec_type: "2d", rationale: "Visible" } }])]);
  const c = r.rows[0].r.concept_ids[0];
  await rejects(as("agent", "select public.campaign_concept_to_briefs($1, array['GB'])", [c]), /approved/);
  await as("agent", "select public.concept_submit($1, null)", [c]);
  await rejects(as("agent", "select public.concept_decide($1, 'approved', null)", [c]), /someone else/);
  await as("lead", "select public.concept_decide($1, 'approved', null)", [c]);
  const out = (await as("agent", "select public.campaign_concept_to_briefs($1, array['gb','IT']) as ids", [c])).rows[0].ids;
  assert.equal(out.length, 2);
  const briefs = (await as("plain", "select market, region, status, source_concept_id, client, created_by from public.briefs where id = any($1) order by market", [out])).rows;
  assert.deepEqual(briefs.map((b) => [b.market, b.region, b.status]), [["GB", "EMEA", "draft"], ["IT", "EMEA", "draft"]]);
  assert.ok(briefs.every((b) => b.source_concept_id === c && b.client === "Acme" && b.created_by === ids.agent));
  await rejects(as("agent", "select public.campaign_concept_to_briefs($1, array['GB'])", [c]), /already a brief/);
  await rejects(as("agent", "select public.campaign_concept_to_briefs($1, array['ZZ'])", [c]), /Unknown market/);
});

test("a new approvals_<module> view is picked up by the inbox automatically", async () => {
  await asSuper(`create view public.approvals_test as select 'test'::text as module, 'TEST'::text as approval_type, 'x1'::text as item_id,
    'T-1'::text as ref, 'Test item'::text as title, null::uuid as requested_by, now() as requested_at, null::numeric as amount, null::text as currency,
    null::text as client, null::text as market, null::text as region, 'pending'::text as status, 'Anyone'::text as approver_rule, '/x'::text as href, true as can_decide`);
  try {
    assert.ok((await inbox("admin", "all")).some((r) => r.module === "test" && r.item_id === "x1"));
    assert.ok((await inbox("lead")).some((r) => r.module === "test"));
    const sum = (await as("admin", "select * from public.approvals_summary() where module = 'test'")).rows;
    assert.equal(sum[0].n, 1);
  } finally {
    await asSuper("drop view public.approvals_test");
  }
  const h = await health();
  assert.deepEqual(h.map((r) => r.metric).sort(), ["approvals_overdue", "approvals_pending", "oldest_pending_days"]);
});
