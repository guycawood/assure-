// Client rule sets: a versioned method + rules + column map per client. CRM staff draft; a different person who governs CRM approves;
// check runs are recorded against the published version and keep the summary only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { vend: "00000000-0000-0000-0000-0000000001e9" };
Object.assign(ids, U);
const client = (await asSuper("insert into public.sourcing_clients (code, name) values ('RS-A','Example client') returning id")).rows[0].id;
const client2 = (await asSuper("insert into public.sourcing_clients (code, name) values ('RS-B','Other client') returning id")).rows[0].id;
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('RS-V','RS Vendor','Germany','EMEA','v@rs.example')");
await asSuper("insert into auth.users (id, email) values ($1,'v@rs.example')", [U.vend]);
const rule = (id, extra = {}) => ({ id, name: `Rule ${id}`, kind: "condition", outcome: "issue", comment: "ISSUE: example", enabled: true, ...extra });
const doc = (...rules) => ({ regions: ["Region A", "Region B"], column_map: { buy_price: "Net Total", spec_number: "Spec No" }, method: { savings_types: [] }, rules });
const save = (who, d, reason = "Initial rules from the client's policy", c = client) => as(who, "select public.crm_ruleset_draft_save($1,$2::jsonb,$3) as id", [c, JSON.stringify(d), reason]);
const list = async (c = client) => (await as("admin", "select public.crm_rulesets($1) as l", [c])).rows[0].l;
let first;

test("only CRM staff draft; a reason is required; the rules are shape-checked", async () => {
  await rejects(save("vend", doc(rule("rule_a"))), /Only staff/);
  await rejects(save("lead", doc(rule("rule_a")), ""), /Say why/);
  await rejects(save("lead", doc(rule("Bad Id"))), /short id/);
  await rejects(save("lead", doc(rule("rule_a"), rule("rule_a"))), /share the id/);
  await rejects(save("lead", doc(rule("rule_a", { outcome: "block" }))), /issue, confirm or hold/);
  await rejects(save("lead", doc(rule("rule_a", { kind: "magic" }))), /unknown kind/);
  await rejects(save("lead", doc(rule("rule_a", { comment: "" }))), /needs a comment/);
  await rejects(save("lead", { rules: "no" }), /Rules must be a list/);
  first = (await save("lead", doc(rule("buy_price_missing"), rule("savings_high", { outcome: "confirm" })))).rows[0].id;
  assert.equal((await save("lead", doc(rule("buy_price_missing")))).rows[0].id, first);                         // the same draft is updated
  const l = await list();
  assert.deepEqual([l.length, l[0].version, l[0].status, l[0].doc.rules.length], [1, 1, "draft", 1]);
});

test("a second person who governs CRM approves; never the proposer", async () => {
  await rejects(as("admin", "select public.crm_ruleset_decide($1,true,null)", [first]), /not waiting/);              // still a draft
  await as("lead", "select public.crm_ruleset_propose($1)", [first]);
  await rejects(save("lead", doc(rule("rule_x"))), /waiting for approval/);
  await rejects(as("lead", "select public.crm_ruleset_decide($1,true,null)", [first]), /Only the CRM owners/);       // not an owner yet
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.lead]);
  await rejects(as("lead", "select public.crm_ruleset_decide($1,true,null)", [first]), /different person/);          // the proposer cannot approve
  await rejects(as("admin", "select public.crm_ruleset_decide($1,false,'')", [first]), /Say why/);
  await as("admin", "select public.crm_ruleset_decide($1,false,'Wording of rule 2 is unclear')", [first]);
  let l = await list();
  assert.deepEqual([l[0].status, l[0].decision_note], ["draft", "Wording of rule 2 is unclear"]);                       // rejection returns it to draft
  await as("lead", "select public.crm_ruleset_propose($1)", [first]);
  await as("lead", "select public.crm_ruleset_withdraw($1)", [first]);
  assert.equal((await list())[0].status, "draft");
  await as("lead", "select public.crm_ruleset_propose($1)", [first]);
  await as("admin", "select public.crm_ruleset_decide($1,true,'Checked against the client policy')", [first]);
  l = await list();
  assert.deepEqual([l[0].status, l[0].decided_at !== null], ["published", true]);
  assert.ok(l[0].published_at);
  assert.equal((await asSuper("select count(*)::int n from public.crm_events where entity_type = 'ruleset' and action in ('ruleset_proposed','ruleset_published','ruleset_rejected')")).rows[0].n >= 4, true);
});

test("a later version replaces the published one; an unchanged draft cannot be proposed; clients are separate", async () => {
  const same = (await save("lead", doc(rule("buy_price_missing")), "No change")).rows[0].id;
  await rejects(as("lead", "select public.crm_ruleset_propose($1)", [same]), /Nothing has changed/);
  await as("lead", "select public.crm_ruleset_discard($1)", [client]);
  const v2 = (await save("lead", doc(rule("buy_price_missing"), rule("fee_high", { outcome: "hold" })), "Add fee ceiling")).rows[0].id;
  await as("lead", "select public.crm_ruleset_propose($1)", [v2]);
  await as("admin", "select public.crm_ruleset_decide($1,true,null)", [v2]);
  const l = await list();
  assert.deepEqual(l.map((x) => [x.version, x.status]), [[2, "published"], [1, "retired"]]);
  assert.deepEqual(await list(client2), []);
  const other = (await save("lead", doc(rule("only_here")), "Other client's own rule", client2)).rows[0].id;
  assert.ok(other);
  assert.equal((await list(client)).length, 2);
});

test("check runs record the summary against the published version only, and keep no rows", async () => {
  const published = (await list())[0].id;
  const run = (c, v, summary = { total: 3, issue: 1 }) => as("lead", "select public.crm_check_run_save($1,$2,'savings.xlsx','abc123',3,$3::jsonb) as id", [c, v, JSON.stringify(summary)]);
  await rejects(run(client, (await list(client2))[0].id), /published rule set of this client/);                       // a draft, and another client's
  const id = (await run(client, published)).rows[0].id;
  assert.ok(id);
  const runs = (await as("admin", "select public.crm_check_runs_list($1) as l", [client])).rows[0].l;
  assert.deepEqual([runs.length, runs[0].version, runs[0].rows_checked, runs[0].summary.issue], [1, 2, 3, 1]);
  assert.deepEqual(Object.keys(runs[0]).filter((k) => /^(rows|data|content)$/.test(k)), []);                          // no uploaded rows are kept, only a count
  await rejects(run(client, published, { big: "x".repeat(60000) }), /too large/);
  await rejects(as("vend", "select public.crm_check_runs_list($1)", [client]), /Only staff/);
});
