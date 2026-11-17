// Final creative files (GBT "Creative work needed", cr19): prepared and sent by the team after creative work has started;
// the client sees and opens only sent deliveries, and only its own.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const C1 = "00000000-0000-0000-0000-0000000000e1", C2 = "00000000-0000-0000-0000-0000000000e2";
Object.assign(ids, { c1: C1, c2: C2 });
await asSuper("insert into auth.users (id, email) values ($1, 'one@client-one.example'), ($2, 'two@client-two.example')", [C1, C2]);
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const client1 = (await one("insert into public.sourcing_clients (code, name) values ('F1', 'Files One') returning id")).id;
const client2 = (await one("insert into public.sourcing_clients (code, name) values ('F2', 'Files Two') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [C1, client1]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [C2, client2]);

async function brief(started = true) {
  const id = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ title: "Final art", objective: "Trial", brief_text: "Art.", region: "EMEA", market: "GB" })])).rows[0].id;
  await asSuper("update public.briefs set client_id = $2 where id = $1", [id, client1]);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true, creative_route: "internal" })]);
  if (started) await asSuper("update public.briefs set creative_kickoff_at = now() where id = $1", [id]);
  return id;
}
const attach = (d, name = "final.pdf") => as("agent", "select public.file_register('briefing','brief_delivery',$1,null,$2,'application/pdf',10,'aGVsbG8=',null,'Final')", [d, name]);

test("a delivery starts only once creative work has started, one draft at a time", async () => {
  const early = await brief(false);
  await rejects(as("agent", "select public.creative_delivery_start($1)", [early]), /kick-off/);
  const plain = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ title: "Plain", objective: "x", brief_text: "y", region: "EMEA", market: "GB" })])).rows[0].id;
  await rejects(as("agent", "select public.creative_delivery_start($1)", [plain]), /needing creative input/);
  const b = await brief();
  const d = (await as("agent", "select public.creative_delivery_start($1) as id", [b])).rows[0].id;
  await rejects(as("agent", "select public.creative_delivery_start($1)", [b]), /already being prepared/);
  await rejects(as("agent", "select public.creative_delivery_send($1, null)", [d]), /Upload the final files/);
  assert.ok(d);
});

test("the client sees and opens only sent deliveries of its own briefs; a change goes out as a new delivery", async () => {
  const b = await brief();
  const d1 = (await as("agent", "select public.creative_delivery_start($1) as id", [b])).rows[0].id;
  const f1 = (await attach(d1, "v1.pdf")).rows[0].file_register;
  // not sent yet: invisible to the client, file included
  assert.equal((await as(C1, "select public.client_creative_deliveries($1) as r", [b])).rows[0].r.length, 0);
  assert.equal((await as(C1, "select * from public.file_content($1)", [f1])).rows.length, 0);
  await as("agent", "select public.creative_delivery_send($1, 'First round of final files')", [d1]);
  await rejects(as("agent", "select public.creative_delivery_send($1, null)", [d1]), /already been sent/);
  const seen = (await as(C1, "select public.client_creative_deliveries($1) as r", [b])).rows[0].r;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].files[0].file_name, "v1.pdf");
  assert.equal((await as(C1, "select * from public.file_content($1)", [f1])).rows.length, 1);
  // another client sees nothing
  assert.equal((await as(C2, "select public.client_creative_deliveries($1) as r", [b])).rows[0].r.length, 0);
  assert.equal((await as(C2, "select * from public.file_content($1)", [f1])).rows.length, 0);
  const n = await one("select count(*)::int n from public.notifications where user_id = $1 and title like 'Final files ready%'", [C1]);
  assert.equal(n.n, 1);
  // a corrected file is a new delivery; the first stays on record
  const d2 = (await as("agent", "select public.creative_delivery_start($1) as id", [b])).rows[0].id;
  await attach(d2, "v2.pdf");
  await as("agent", "select public.creative_delivery_send($1, 'Corrected logo')", [d2]);
  const all = (await as("agent", "select public.creative_deliveries_internal($1) as r", [b])).rows[0].r;
  assert.deepEqual(all.map((x) => [x.round, x.status]), [[2, "sent"], [1, "sent"]]);
  assert.equal((await as(C1, "select public.client_creative_deliveries($1) as r", [b])).rows[0].r.length, 2);
  const ev = (await asSuper("select event from public.brief_events where brief_id = $1", [b])).rows.map((r) => r.event);
  assert.equal(ev.filter((e) => e === "final_files_sent").length, 2);
});
