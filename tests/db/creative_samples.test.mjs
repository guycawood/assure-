// Samples on a creative brief (GBT "Creative work needed", cr16 and cr18): the decision is recorded, a supplier is asked for a sample,
// ships it with tracking, the team confirms arrival and approves it or asks for changes and a new round.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V1 = "00000000-0000-0000-0000-0000000000d1", V2 = "00000000-0000-0000-0000-0000000000d2";
Object.assign(ids, { v1: V1, v2: V2 });
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const mk = async (code, email) => {
  const id = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'United Kingdom','EMEA',$3) returning id", [code, `Maker ${code}`, email])).id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
const s1 = await mk("SM-A", "a@maker.example"), s2 = await mk("SM-B", "b@maker.example");
const blocked = await mk("SM-X", "x@maker.example");
await asSuper("update public.supplier_gates set status = 'missing' where supplier_id = $1 and gate_key = 'msa'", [blocked]);
await asSuper("insert into auth.users (id, email) values ($1,'a@maker.example'), ($2,'b@maker.example')", [V1, V2]);

async function brief(creative = true) {
  const id = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify({ title: "Display idea", objective: "Trial", brief_text: "An idea.", region: "EMEA", market: "GB" })])).rows[0].id;
  if (creative) await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true, creative_route: "internal" })]);
  return id;
}
const request = (b, s = s1) => as("agent", "select public.sample_request($1, $2, 'One shelf-talker prototype in the final board', 2, null) as id", [b, s]);

test("the samples decision is recorded, and needs the brief to be a creative one", async () => {
  const plain = await brief(false);
  await rejects(as("agent", "select public.brief_set_samples($1, true, null)", [plain]), /creative input first/);
  const b = await brief();
  await rejects(as("agent", "select public.brief_set_samples($1, null, null)", [b]), /whether samples are needed/);
  await rejects(request(b), /samples are needed on this brief first/);
  await as("agent", "select public.brief_set_samples($1, true, 'Check the board finish')", [b]);
  const row = await one("select samples_needed, samples_decided_by, samples_note from public.briefs where id = $1", [b]);
  assert.deepEqual([row.samples_needed, row.samples_decided_by, row.samples_note], [true, ids.agent, "Check the board finish"]);
  const ev = (await asSuper("select event from public.brief_events where brief_id = $1", [b])).rows.map((r) => r.event);
  assert.ok(ev.includes("samples_decision"));
});

test("a sample request goes to an eligible supplier, which sees only its own", async () => {
  const b = await brief();
  await as("agent", "select public.brief_set_samples($1, true, null)", [b]);
  await rejects(request(b, blocked), /not eligible in SRM/);
  await rejects(as("agent", "select public.sample_request($1, $2, 'x', 1, null)", [b, s1]), /Describe the sample/);
  await rejects(as("agent", "select public.sample_request($1, $2, 'A prototype piece', 500, null)", [b, s1]), /between 1 and 100/);
  const id = (await request(b)).rows[0].id;
  const mine = (await as(V1, "select public.vendor_samples() as r")).rows[0].r;
  assert.ok(mine.some((m) => m.id === id));
  assert.ok(!(await as(V2, "select public.vendor_samples() as r")).rows[0].r.some((m) => m.id === id));
  await rejects(as(V2, "select public.vendor_sample_ship($1, 'DHL', 'TRK1', null)", [id]), /not found/i);
  await rejects(as("agent", "select public.vendor_samples()"), /vendor user/);
  await rejects(as("agent", "select public.brief_set_samples($1, false, null)", [b]), /still open/);
});

test("ship with tracking, confirm arrival, then approve; changes send it back for a second round", async () => {
  const b = await brief();
  await as("agent", "select public.brief_set_samples($1, true, null)", [b]);
  const id = (await request(b)).rows[0].id;
  await rejects(as("agent", "select public.sample_receive($1, null)", [id]), /not shipped/);
  await rejects(as(V1, "select public.vendor_sample_ship($1, 'DHL', '', null)", [id]), /tracking number/);
  await as(V1, "select public.vendor_sample_ship($1, 'DHL', 'JD0123', 'Two pieces, fold flat')", [id]);
  await rejects(as(V1, "select public.vendor_sample_ship($1, 'DHL', 'JD0124', null)", [id]), /already shipped/);
  await rejects(as("agent", "select public.sample_review($1, true, null)", [id]), /arrived first/);
  await as("agent", "select public.sample_receive($1, 'Arrived intact')", [id]);
  await rejects(as("agent", "select public.sample_review($1, false, '')", [id]), /what needs to change/);
  await as("agent", "select public.sample_review($1, false, 'Board is too thin, use 3mm')", [id]);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title = 'Changes needed on the sample'", [V1])).n, 1);
  const seen = (await as(V1, "select public.vendor_samples() as r")).rows[0].r.find((m) => m.id === id);
  assert.deepEqual([seen.status, seen.review_note], ["changes_requested", "Board is too thin, use 3mm"]);
  await as(V1, "select public.vendor_sample_ship($1, 'DHL', 'JD0200', 'Now 3mm')", [id]);
  const r2 = await one("select round, status from public.brief_samples where id = $1", [id]);
  assert.deepEqual([r2.round, r2.status], [2, "shipped"]);
  await as("agent", "select public.sample_receive($1, null)", [id]);
  await as("agent", "select public.sample_review($1, true, 'Good')", [id]);
  const view = (await as("agent", "select public.samples_internal($1) as r", [b])).rows[0].r;
  assert.deepEqual([view[0].status, view[0].round, view[0].supplier_name], ["approved", 2, "Maker SM-A"]);
  const ev = (await asSuper("select event from public.brief_events where brief_id = $1", [b])).rows.map((r) => r.event);
  for (const e of ["sample_requested", "sample_shipped", "sample_received", "sample_changes_requested", "sample_approved"]) assert.ok(ev.includes(e), e);
});
