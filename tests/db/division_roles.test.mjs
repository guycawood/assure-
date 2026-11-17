// Division role hierarchy (SRM): five procurement levels with capabilities; an assignment overrides the older profile roles;
// who may assign which level; everything recorded; the SRM money rule follows the levels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = {
  cpo: "00000000-0000-0000-0000-0000000001c1", rpd: "00000000-0000-0000-0000-0000000001c2", pm: "00000000-0000-0000-0000-0000000001c3",
  scm: "00000000-0000-0000-0000-0000000001c4", srt: "00000000-0000-0000-0000-0000000001c5", outsider: "00000000-0000-0000-0000-0000000001c6",
};
Object.assign(ids, U);
for (const [k, id] of Object.entries(U)) {
  await asSuper("insert into auth.users (id, email) values ($1,$2)", [id, k === "outsider" ? "someone@vendor-co.example" : `${k}@adm-indicia.com`]);
}
const money = async (user) => (await as(user, "select (public.srm_vendor_jobs()->'summary'->>'can_see_money')::boolean as m")).rows[0].m;
const can = async (user, cap) => (await as(user, "select public.division_can('assure', $1) as c", [cap])).rows[0].c;
const assign = (who, user, role, note = null) => as(who, "select public.division_role_assign($1,'assure',$2,$3)", [ids[user] ?? user, role, note]);
const roleOf = async (user) => (await asSuper("select role_key from public.division_role_users where user_id = $1 and module = 'assure'", [ids[user]])).rows[0]?.role_key ?? null;

test("the five procurement levels exist, ranked, and the SRT level has no money capability", async () => {
  const r = (await asSuper("select key, rank, capabilities from public.division_roles where module = 'assure' order by rank")).rows;
  assert.deepEqual(r.map((x) => x.key), ["cpo", "regional_procurement_director", "procurement_manager", "supply_chain_manager", "srt", "sustainability"]);
  const caps = Object.fromEntries(r.map((x) => [x.key, x.capabilities]));
  assert.ok(caps.cpo.includes("manage_libraries") && caps.cpo.includes("strategic_tools"));
  assert.ok(!caps.regional_procurement_director.includes("manage_libraries"));
  assert.deepEqual(caps.srt.slice().sort(), ["vendor_payment_status", "vendor_performance"]);
  assert.ok(!caps.supply_chain_manager.includes("strategic_tools") && caps.supply_chain_manager.includes("see_money"));
});

test("without an assignment the older profile roles decide, as before", async () => {
  assert.equal(await money("agent"), false);  // SRT agent: no money
  assert.equal(await money("lead"), true);    // SRT lead
  assert.equal(await money("head"), true);
  assert.equal(await money("admin"), true);
  assert.equal(await can("agent", "vendor_payment_status"), true);
  assert.equal(await can("agent", "strategic_tools"), false);
  assert.equal(await can("head", "strategic_tools"), true);
});

test("an assignment wins over the older role in both directions", async () => {
  await assign("admin", "lead", "srt", "Moved into the relationship team");
  assert.equal(await money("lead"), false);          // was true under the older role
  assert.equal(await can("lead", "vendor_payment_status"), true);
  await assign("admin", "agent", "procurement_manager");
  assert.equal(await money("agent"), true);          // was false under the older role
  assert.equal(await can("agent", "approve_exceptions"), true);
  assert.equal(await can("agent", "strategic_tools"), false);
  // an SRT level cannot see money even if the older role would allow it
  await assign("admin", "head", "srt");
  assert.equal(await money("head"), false);
  await asSuper("delete from public.division_role_users where user_id = any($1)", [[ids.lead, ids.agent, ids.head]]);
  assert.equal(await money("lead"), true);           // back to the older rule
});

test("who can assign which level: admin or a manage-users level, never above their own, never themselves", async () => {
  await rejects(assign("plain", "srt", "srt"), /can't manage users/);
  await rejects(assign("admin", "outsider", "srt"), /member of staff/);
  await rejects(assign("admin", "srt", "head_of_nothing"), /Unknown role/);
  await assign("admin", "cpo", "cpo");
  await assign("cpo", "rpd", "regional_procurement_director");
  await assign("cpo", "pm", "procurement_manager");
  await assign("cpo", "scm", "supply_chain_manager");
  await assign("cpo", "srt", "srt");
  await rejects(assign("cpo", "srt", "srt"), /already has this level/);
  // the regional director manages users below them, not above or alongside the CPO
  await rejects(assign("rpd", "pm", "cpo"), /more senior than your own/);
  await rejects(assign("rpd", "rpd", "srt"), /your own level/);
  await rejects(as("rpd", "select public.division_role_remove($1,'assure','x')", [ids.cpo]), /more senior than you/);
  await assign("rpd", "scm", "procurement_manager", "Promoted");
  assert.equal(await roleOf("scm"), "procurement_manager");
  // a procurement manager and below cannot manage users
  await rejects(assign("pm", "srt", "supply_chain_manager"), /can't manage users/);
  await rejects(assign("srt", "scm", "srt"), /can't manage users/);
});

test("capabilities follow the level, and the money view follows them", async () => {
  assert.equal(await can("cpo", "manage_libraries"), true);
  assert.equal(await can("rpd", "manage_libraries"), false);
  assert.equal(await can("rpd", "strategic_tools"), true);
  assert.equal(await can("pm", "strategic_tools"), false);
  assert.equal(await can("srt", "see_money"), false);
  assert.equal(await can("outsider", "vendor_performance"), false);
  assert.deepEqual([await money("cpo"), await money("pm"), await money("srt")], [true, true, false]);
});

test("every change is recorded, the person is told, and a level can be removed", async () => {
  await as("cpo", "select public.division_role_remove($1,'assure','Left the team')", [ids.srt]);
  assert.equal(await roleOf("srt"), null);
  await rejects(as("cpo", "select public.division_role_remove($1,'assure',null)", [ids.srt]), /no level to remove/);
  const ev = (await asSuper("select action, from_role, to_role from public.division_role_events where user_id = $1 order by id", [ids.scm])).rows;
  assert.deepEqual(ev.map((e) => e.action), ["assigned", "changed"]);
  assert.deepEqual([ev[1].from_role, ev[1].to_role], ["supply_chain_manager", "procurement_manager"]);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title like 'Your role changed:%'", [ids.scm])).rows[0].n, 2);
  assert.equal((await asSuper("select count(*)::int n from public.division_role_events where user_id = $1 and action = 'removed'", [ids.srt])).rows[0].n, 1);
});
