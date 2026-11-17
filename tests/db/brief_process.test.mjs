// Brief intake aligned to the Global Business Transformation process: brief types, the creative decision and review,
// sending an incomplete brief back to the client and the client resubmitting, with approval gated on the creative review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const CL = "00000000-0000-0000-0000-0000000000f1";
Object.assign(ids, { cl: CL });
await asSuper("insert into auth.users (id, email) values ($1, 'cat@acme.example')", [CL]);
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const client = (await one("insert into public.sourcing_clients (code, name) values ('BP', 'Brief Process Co') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CL, client]);

const BRIEF = { title: "Chiller door wrap", objective: "Drive trial", brief_text: "A door wrap.", region: "EMEA", market: "GB" };
async function brief(submit = true) {
  const id = (await as("agent", "select public.brief_create($1, $2) as id", [JSON.stringify(BRIEF), submit])).rows[0].id;
  await asSuper("update public.briefs set client_id = $2 where id = $1", [id, client]);
  return id;
}

test("brief types are validated and only the author or an admin sets them", async () => {
  const id = await brief(false);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ brief_types: ["artworking", "product_brief"] })]);
  assert.deepEqual((await one("select brief_types from public.briefs where id = $1", [id])).brief_types, ["artworking", "product_brief"]);
  await rejects(as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ brief_types: ["poster"] })]), /Unknown brief type/);
  await rejects(as("lead", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ brief_types: ["artworking"] })]), /author/);
});

test("creative input needed asks for who does it, and approval waits for the creative review", async () => {
  const id = await brief(true);
  await rejects(as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true })]), /supplier or the internal creative team/);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true, creative_route: "internal" })]);
  await rejects(as("lead", "select public.brief_decide($1, 'approved', null)", [id]), /creative review/);
  await as("lead", "select public.brief_creative_review($1, 'Checked with the studio')", [id]);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  assert.equal((await one("select status from public.briefs where id = $1", [id])).status, "in_ideation");
  const ev = (await asSuper("select event from public.brief_events where brief_id = $1 order by at, id", [id])).rows.map((r) => r.event);
  assert.ok(ev.includes("creative_decision") && ev.includes("creative_reviewed"));
});

test("no creative input needed: the brief is approved as before", async () => {
  const id = await brief(true);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: false })]);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  assert.equal((await one("select status from public.briefs where id = $1", [id])).status, "in_ideation");
  await rejects(as("lead", "select public.brief_creative_review($1, null)", [id]), /not marked as needing creative/);
});

test("an incomplete brief goes back to the client with the reason; the client resubmits it", async () => {
  const id = await brief(true);
  await rejects(as("lead", "select public.brief_send_back($1, '', false)", [id]), /what is missing/);
  await as("lead", "select public.brief_send_back($1, 'Add the delivery dates and the sustainability targets', true)", [id]);
  const b = await one("select status, approval_status, returned_reason, meeting_requested from public.briefs where id = $1", [id]);
  assert.equal(b.status, "with_client");
  assert.equal(b.approval_status, null);
  assert.equal(b.meeting_requested, true);
  await rejects(as("lead", "select public.brief_decide($1, 'approved', null)", [id]), /not waiting for approval/);

  // the client sees why, and only an approver or member of that client can answer
  const portal = (await as(CL, "select public.client_portal_brief($1) as b", [id])).rows[0].b;
  assert.match(portal.returned_reason, /delivery dates/);
  assert.equal(portal.meeting_requested, true);
  await rejects(as("lead", "select public.client_brief_resubmit($1, 'x')", [id]), /Not allowed|not|permission|client/i);
  await as(CL, "select public.client_brief_resubmit($1, 'Dates added in the brief text')", [id]);
  const after = await one("select status, approval_status from public.briefs where id = $1", [id]);
  assert.equal(after.status, "submitted");
  assert.equal(after.approval_status, "pending");
  await rejects(as(CL, "select public.client_brief_resubmit($1, 'again')", [id]), /not waiting for you/);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
});
