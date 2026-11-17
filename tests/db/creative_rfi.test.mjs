// Creative RFI to panel suppliers (GBT "Creative work needed", cr10 to cr12b): only on a supplier-route brief once creative
// work has started; the supplier confirms or rejects, accepts the IP rule and sends its proposal; a rejection can be replaced.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V1 = "00000000-0000-0000-0000-0000000000c1", V2 = "00000000-0000-0000-0000-0000000000c2", V3 = "00000000-0000-0000-0000-0000000000c3";
Object.assign(ids, { v1: V1, v2: V2, v3: V3 });
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const mk = async (code, email) => {
  const id = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'United Kingdom','EMEA',$3) returning id", [code, `Agency ${code}`, email])).id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
const s1 = await mk("CR-A", "a@agency.example"), s2 = await mk("CR-B", "b@agency.example"), s3 = await mk("CR-C", "c@agency.example");
const blocked = await mk("CR-X", "x@agency.example");
await asSuper("update public.supplier_gates set status = 'missing' where supplier_id = $1 and gate_key = 'msa'", [blocked]);
await asSuper("insert into auth.users (id, email) values ($1,'a@agency.example'), ($2,'b@agency.example'), ($3,'c@agency.example')", [V1, V2, V3]);
const client = (await one("insert into public.sourcing_clients (code, name) values ('CRC', 'RFI Co') returning id")).id;
const future = () => new Date(Date.now() + 5 * 864e5).toISOString();

async function brief(route = "supplier", started = true) {
  const id = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ title: "Seasonal idea", objective: "Trial", brief_text: "An idea.", region: "EMEA", market: "GB" })])).rows[0].id;
  await asSuper("update public.briefs set client_id = $2 where id = $1", [id, client]);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true, creative_route: route })]);
  await as("lead", "select public.brief_creative_review($1, 'ok')", [id]);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  if (started) await asSuper("update public.briefs set creative_kickoff_at = now() where id = $1", [id]);
  return id;
}
const create = (b, sup) => as("agent", "select public.creative_rfi_create($1, $2, $3) as id", [b, JSON.stringify({ title: "Seasonal ideation", supplier_brief: "We need three routes for a seasonal shelf display.", due_at: future() }), JSON.stringify(sup)]);
const invOf = async (b, sup) => (await as("agent", "select public.creative_rfis_internal($1) as r", [b])).rows[0].r[0].invites.find((i) => i.supplier_id === sup).id;
const attach = (user, invite) => as(user, "select public.file_register('briefing','creative_rfi_invite',$1,null,'proposal.pdf','application/pdf',10,'aGVsbG8=',null,'Proposal')", [invite]);

test("the RFI is only for a supplier-route brief, once creative work has started, to eligible suppliers", async () => {
  const internal = await brief("internal");
  await rejects(create(internal, [s1]), /route to supplier/);
  const notStarted = await brief("supplier", false);
  await rejects(create(notStarted, [s1]), /kick-off/);
  const b = await brief();
  await rejects(create(b, []), /at least one panel supplier/);
  await rejects(create(b, [blocked]), /not eligible in SRM/);
  await rejects(as("agent", "select public.creative_rfi_create($1, $2, $3)", [b, JSON.stringify({ supplier_brief: "short", due_at: future() }), JSON.stringify([s1])]), /Write the brief/);
  await rejects(as("agent", "select public.creative_rfi_create($1, $2, $3)", [b, JSON.stringify({ supplier_brief: "A proper supplier brief here", due_at: new Date(Date.now() - 864e5).toISOString() }), JSON.stringify([s1])]), /future/);
  const rfi = (await create(b, [s1, s2])).rows[0].id;
  const mail = await one("select count(*)::int n from public.email_outbox where subject like 'Creative request for information%'");
  assert.equal(mail.n, 2);
  const view = (await as("agent", "select public.creative_rfis_internal($1) as r", [b])).rows[0].r;
  assert.equal(view.length, 1);
  assert.equal(view[0].invites.length, 2);
  assert.match(view[0].ip_rule, /pass to us/);
  assert.ok(rfi);
});

test("suppliers see only their own invitation; confirm or reject, a reason is needed, and another supplier can be added", async () => {
  const b = await brief();
  const rfi = (await create(b, [s1, s2])).rows[0].id;
  const mine = (await as(V1, "select public.vendor_creative_rfis() as r")).rows[0].r;
  assert.ok(mine.length >= 1 && mine.every((m) => m.title === "Seasonal ideation"));
  assert.ok(!("supplier_name" in mine[0]) && !("invites" in mine[0]));
  const inv2 = await invOf(b, s2);
  assert.ok(!(await as(V1, "select public.vendor_creative_rfis() as r")).rows[0].r.some((m) => m.id === inv2));
  await rejects(as(V1, "select public.vendor_creative_rfi_respond($1, true, null)", [inv2]), /not found/i);
  await rejects(as("agent", "select public.vendor_creative_rfis()"), /vendor user/);
  await rejects(as(V2, "select public.vendor_creative_rfi_respond($1, false, '')", [inv2]), /why you cannot respond/);
  await as(V2, "select public.vendor_creative_rfi_respond($1, false, 'No capacity this quarter')", [inv2]);
  await rejects(as(V2, "select public.vendor_creative_rfi_respond($1, true, null)", [inv2]), /already answered/);
  const note = await one("select count(*)::int n from public.notifications where user_id = $1 and title like '% declined %'", [ids.agent]);
  assert.equal(note.n, 1);
  await rejects(as("agent", "select public.creative_rfi_add_supplier($1, $2)", [rfi, s2]), /already on this RFI/);
  await rejects(as("agent", "select public.creative_rfi_add_supplier($1, $2)", [rfi, blocked]), /not eligible/);
  await as("agent", "select public.creative_rfi_add_supplier($1, $2)", [rfi, s3]);
  const inv = (await as("agent", "select public.creative_rfis_internal($1) as r", [b])).rows[0].r[0].invites;
  assert.deepEqual(inv.map((i) => i.status).sort(), ["invited", "invited", "rejected"]);
  assert.equal(inv.find((i) => i.status === "rejected").reject_reason, "No capacity this quarter");
});

test("the proposal needs the confirmation, the IP rule and a file or a note; the team then selects one", async () => {
  const b = await brief();
  const rfi = (await create(b, [s1, s2])).rows[0].id;
  const i1 = await invOf(b, s1);
  const i2 = await invOf(b, s2);
  await rejects(as(V1, "select public.vendor_creative_rfi_propose($1, true, 'Three routes attached as a deck')", [i1]), /Confirm that you can respond/);
  await as(V1, "select public.vendor_creative_rfi_respond($1, true, null)", [i1]);
  await as(V2, "select public.vendor_creative_rfi_respond($1, true, null)", [i2]);
  await rejects(as(V1, "select public.vendor_creative_rfi_propose($1, false, 'Three routes attached as a deck')", [i1]), /accept the IP rule/);
  await rejects(as(V1, "select public.vendor_creative_rfi_propose($1, true, 'short')", [i1]), /Upload your proposal/);
  await attach(V1, i1);
  await as(V1, "select public.vendor_creative_rfi_propose($1, true, null)", [i1]);
  await as(V2, "select public.vendor_creative_rfi_propose($1, true, 'Two routes: a shelf talker series and a floor graphic story')", [i2]);
  const view = (await as("agent", "select public.creative_rfis_internal($1) as r", [b])).rows[0].r[0].invites;
  assert.equal(view.find((i) => i.id === i1).files.length, 1);
  assert.ok(view.every((i) => i.ip_confirmed_at));
  await rejects(as(V1, "select public.creative_rfi_select($1, null)", [i1]), /staff only/);
  await as("agent", "select public.creative_rfi_select($1, 'Strongest routes')", [i1]);
  const after = (await as("agent", "select public.creative_rfis_internal($1) as r", [b])).rows[0].r[0];
  assert.equal(after.status, "closed");
  assert.deepEqual(after.invites.map((i) => i.status).sort(), ["not_selected", "selected"]);
  await rejects(as("agent", "select public.creative_rfi_select($1, null)", [i2]), /already been selected/);
  await rejects(as(V2, "select public.vendor_creative_rfi_propose($1, true, 'A late change to my proposal')", [i2]), /closed/);
  assert.ok(rfi);
});
