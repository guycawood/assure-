// Creative work commercials (GBT "Creative work needed", cr3 to cr9): retainer flag, kick-off, quote, client decision,
// client PO, and concepts held until the kick-off or the PO is on record.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const CL = "00000000-0000-0000-0000-0000000000f2";
const CV = "00000000-0000-0000-0000-0000000000f3";
Object.assign(ids, { cl: CL, cv: CV });
await asSuper("insert into auth.users (id, email) values ($1, 'approver@quote.example'), ($2, 'viewer@quote.example')", [CL, CV]);
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const client = (await one("insert into public.sourcing_clients (code, name) values ('CQ', 'Quote Co') returning id")).id;
const retainerClient = (await one("insert into public.sourcing_clients (code, name) values ('CR', 'Retainer Co') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CL, client]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [CV, client]);

const BRIEF = { title: "Launch idea", objective: "Drive trial", brief_text: "A launch idea.", region: "EMEA", market: "GB" };
async function creativeBrief(clientId) {
  const id = (await as("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).rows[0].id;
  await asSuper("update public.briefs set client_id = $2 where id = $1", [id, clientId]);
  await as("agent", "select public.brief_set_process($1, $2)", [id, JSON.stringify({ creative_needed: true, creative_route: "internal" })]);
  await as("lead", "select public.brief_creative_review($1, 'ok')", [id]);
  await as("lead", "select public.brief_decide($1, 'approved', null)", [id]);
  return id;
}
async function conceptOn(briefId) {
  const s = (await as("agent", "select public.ideation_start('brief', $1, null, '{}', '{}') as s", [briefId])).rows[0].s;
  const r = await as("agent", "select public.ideation_add_turn($1, '', 'One direction', $2, 'm', 'v1', '{}', true) as r",
    [s, JSON.stringify([{ idx: 0, name: "Tray", data: { creative_direction: "Tray", indicative_unit_price: 4.2, rationale: "Fits" } }])]);
  return r.rows[0].r.concept_ids[0];
}

test("a quote: basis and amount are checked, the client decides, the reason is kept, a revised quote goes back out", async () => {
  const id = await creativeBrief(client);
  await rejects(as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "weekly", amount: 100 })]), /quoting basis/);
  await rejects(as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "daily", rate: 800 })]), /rate and the number of days/);
  await as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "daily", rate: 800, units: 5, currency: "eur", scope_note: "Concept routes" })]);
  const q = await one("select amount, currency, status from public.brief_creative_quotes where brief_id = $1", [id]);
  assert.deepEqual([Number(q.amount), q.currency, q.status], [4000, "EUR", "draft"]);
  // the client sees nothing until it is sent
  assert.equal((await as(CL, "select public.client_creative_quote($1) as q", [id])).rows[0].q, null);
  await as("agent", "select public.creative_quote_send($1)", [id]);
  await rejects(as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "fixed", amount: 1 })]), /already sent/);
  const seen = (await as(CL, "select public.client_creative_quote($1) as q", [id])).rows[0].q;
  assert.equal(seen.can_decide, true);
  assert.equal(Number(seen.amount), 4000);

  // viewers cannot decide; a reason is needed to reject
  await rejects(as(CV, "select public.client_creative_quote_decide($1, true, null, 'PO-1')", [id]), /Only approvers/);
  await rejects(as(CL, "select public.client_creative_quote_decide($1, false, '', null)", [id]), /why the quote is not accepted/);
  await as(CL, "select public.client_creative_quote_decide($1, false, 'Too many days for concept routes', null)", [id]);
  const rej = await one("select status, reject_reason from public.brief_creative_quotes where brief_id = $1", [id]);
  assert.deepEqual([rej.status, rej.reject_reason], ["rejected", "Too many days for concept routes"]);
  const note = await one("select count(*)::int n from public.notifications where user_id = $1 and title like '% rejected the creative quote%'", [ids.agent]);
  assert.equal(note.n, 1);

  // revise and send again, the client approves with its PO
  await as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "fixed", amount: 2500 })]);
  const rev = await one("select status, version, reject_reason from public.brief_creative_quotes where brief_id = $1", [id]);
  assert.deepEqual([rev.status, rev.version, rev.reject_reason], ["draft", 2, null]);
  await as("agent", "select public.creative_quote_send($1)", [id]);
  await as(CL, "select public.client_creative_quote_decide($1, true, null, 'PO-4411')", [id]);
  assert.equal((await one("select status, client_po_number from public.brief_creative_quotes where brief_id = $1", [id])).client_po_number, "PO-4411");
  await rejects(as(CL, "select public.client_creative_quote_decide($1, true, null, null)", [id]), /no quote waiting/);
});

test("creative work (concepts) waits for the confirmed client PO", async () => {
  const id = await creativeBrief(client);
  const c = await conceptOn(id);
  await rejects(as("agent", "select public.concept_submit($1, null)", [c]), /kick-off.*client PO/);
  await rejects(as("agent", "select public.creative_quote_confirm_po($1, 'PO-1')", [id]), /no quote/);
  await as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "fixed", amount: 1800 })]);
  await as("agent", "select public.creative_quote_send($1)", [id]);
  await rejects(as("agent", "select public.creative_quote_confirm_po($1, 'PO-1')", [id]), /not approved the quote/);
  await as(CL, "select public.client_creative_quote_decide($1, true, null, null)", [id]);
  await rejects(as("agent", "select public.creative_quote_confirm_po($1, null)", [id]), /client PO number/);
  await as("agent", "select public.creative_quote_confirm_po($1, 'PO-77')", [id]);
  await as("agent", "select public.concept_submit($1, null)", [c]);
  assert.equal((await one("select status from public.ideation_concepts where id = $1", [c])).status, "submitted_for_approval");
});

test("retainer client: only CRM sets the flag with a reason, quoting is refused and the brief is kicked off instead", async () => {
  await rejects(as("agent", "select public.crm_client_set_retainer($1, true, 'Annual', '')", [retainerClient]), /Say why/);
  await as("agent", "select public.crm_client_set_retainer($1, true, 'Annual creative retainer', 'Signed retainer agreement 2026')", [retainerClient]);
  assert.equal((await one("select on_retainer from public.sourcing_clients where id = $1", [retainerClient])).on_retainer, true);
  const ev = await one("select count(*)::int n from public.crm_events where client_id = $1 and action = 'retainer_changed'", [retainerClient]);
  assert.equal(ev.n, 1);

  const id = await creativeBrief(retainerClient);
  const c = await conceptOn(id);
  await rejects(as("agent", "select public.concept_submit($1, null)", [c]), /kick-off/);
  await rejects(as("agent", "select public.creative_quote_save($1, $2)", [id, JSON.stringify({ basis: "fixed", amount: 500 })]), /on a retainer/);
  await as("agent", "select public.creative_kickoff($1, 'Briefed the studio')", [id]);
  await rejects(as("agent", "select public.creative_kickoff($1, null)", [id]), /already been kicked off/);
  await as("agent", "select public.concept_submit($1, null)", [c]);
  const log = (await asSuper("select event from public.brief_events where brief_id = $1", [id])).rows.map((r) => r.event);
  assert.ok(log.includes("creative_kickoff"));
});

test("a client that is not on a retainer cannot be kicked off without a quote", async () => {
  const id = await creativeBrief(client);
  await rejects(as("agent", "select public.creative_kickoff($1, null)", [id]), /not on a retainer/);
});
