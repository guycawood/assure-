// Feedback cases: low feedback opens a case with an owner and due dates; a case moves through acknowledged, investigating, resolved and
// closed with guarded steps (cause, root cause, action, the client told, their reaction); late cases alert once; staff only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { db, as, asSuper, rejects, ids } = t;
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const val = async (user, sql, params) => (await as(user, sql, params)).rows[0]?.r;
async function anon(sql, params) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}
const U = { cA: "00000000-0000-0000-0000-000000000fc1" };
Object.assign(ids, U);
await asSuper("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'cat@fc.example', '{}')", [U.cA]);
const A = (await one("insert into public.sourcing_clients (code, name) values ('FCA', 'Acme Foods') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA, A]);
const contact = async (name, email, extra = {}) => {
  const id = await val("agent", "select public.crm_contact_save(null, $1, null, $2, 'Manager', $3, null, 'DE', 'approver', false) as r", [A, name, email]);
  for (const [k, v] of Object.entries(extra)) await as("agent", "select public.crm_contact_set_field($1, $2, $3)", [id, k, JSON.stringify(v)]);
  return id;
};
const anna = await contact("Anna Acme", "anna@fc.example", { receive_survey: true, owner: ids.lead });
const capture = (score, comment, who = anna) => val("agent", "select public.crm_feedback_capture($1, null, $2, $3, $4) as r", [A, who, score, comment]);
const caseOf = (feedback) => one("select * from public.crm_feedback_cases where feedback_id = $1", [feedback]);
const days = (d) => Math.round((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
let low, high;

test("scores above the low-score setting open no case; low ones open medium or high cases owned by the contact's owner with due dates", async () => {
  assert.equal(await caseOf(await capture(8, "Good")), undefined);
  low = await capture(5, "Slow answers on quotes");
  high = await capture(2, "Missed the launch");
  const c = await caseOf(low), h = await caseOf(high);
  assert.deepEqual([c.severity, c.status, c.owner, c.scale], ["medium", "new", ids.lead, 10]);
  assert.deepEqual([days(c.ack_due), days(c.resolve_due)], [2, 14]);
  assert.deepEqual([h.severity, days(h.ack_due), days(h.resolve_due)], ["high", 1, 7]);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title like 'Low feedback%'", [ids.lead])).n, 2);
  assert.equal((await one("select event, note from public.crm_feedback_case_events where case_id = $1", [c.id])).event, "opened");
  await asSuper("update public.library_records set data = '{\"value\":4}' where library_key = 'crm_settings' and code = 'FEEDBACK_LOW_SCORE'");
  assert.equal(await caseOf(await capture(5, "Now above the line")), undefined);                                  // the threshold is a governed setting
  await asSuper("update public.library_records set data = '{\"value\":6}' where library_key = 'crm_settings' and code = 'FEEDBACK_LOW_SCORE'");
});

test("a case without an owner tells the CRM owners to assign it", async () => {
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.head]);
  const nobody = await contact("Nina NoOwner", "nina@fc.example");
  const f = await capture(4, "Unhappy", nobody);
  const c = await caseOf(f);
  assert.equal(c.owner, null);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title = 'Low feedback with no owner'", [ids.head])).n, 1);
  await rejects(as("agent", "select public.crm_case_assign($1, $2)", [c.id, U.cA]), /Choose a colleague/);        // a client user is not a colleague
  await as("agent", "select public.crm_case_assign($1, $2, 'You know Nina')", [c.id, ids.lead]);
  assert.equal((await caseOf(f)).owner, ids.lead);
});

test("the steps are guarded: acknowledge, findings, resolve needs cause, root cause and action, closing needs the client told", async () => {
  const c = await caseOf(low);
  await rejects(as("lead", "select public.crm_case_resolve($1)", [c.id]), /Choose the cause first/);
  await as("lead", "select public.crm_case_acknowledge($1, 'On it')", [c.id]);
  await rejects(as("lead", "select public.crm_case_acknowledge($1)", [c.id]), /already been acknowledged/);
  await rejects(as("lead", "select public.crm_case_save_findings($1, 'weather', null, null)", [c.id]), /from the list/);
  await as("lead", "select public.crm_case_save_findings($1, 'communication', 'Quotes were routed to a shared inbox nobody owned', null)", [c.id]);
  assert.equal((await caseOf(low)).status, "investigating");
  await rejects(as("lead", "select public.crm_case_resolve($1)", [c.id]), /what was done/);
  await as("lead", "select public.crm_case_save_findings($1, 'communication', 'Quotes were routed to a shared inbox nobody owned', 'Named a quote owner and set a same-day reply rule')", [c.id]);
  await rejects(as("lead", "select public.crm_case_close($1, 'satisfied')", [c.id]), /Resolve the case/);
  await as("lead", "select public.crm_case_resolve($1, 'Fixed at source')", [c.id]);
  const fb = await one("select followed_up_at, follow_up_note from public.crm_feedback where id = $1", [low]);
  assert.ok(fb.followed_up_at);                                                                                   // the older follow-up record and health counts stay in step
  assert.match(fb.follow_up_note, /same-day reply/);
  await rejects(as("lead", "select public.crm_case_close($1, 'satisfied')", [c.id]), /Tell the client/);
  await rejects(as("lead", "select public.crm_case_inform_client($1, '')", [c.id]), /how the client was told/);
  await as("lead", "select public.crm_case_inform_client($1, 'Call with Anna', 'She was glad to hear it')", [c.id]);
  await rejects(as("lead", "select public.crm_case_close($1, 'delighted')", [c.id]), /how the client reacted/);
  await rejects(as("lead", "select public.crm_case_close($1, 'not_satisfied')", [c.id]), /still unhappy/);
  await as("lead", "select public.crm_case_close($1, 'satisfied', 'Thanked us')", [c.id]);
  const done = await caseOf(low);
  assert.deepEqual([done.status, done.client_outcome, done.closed_by], ["closed", "satisfied", ids.lead]);
  assert.equal((await one("select status from public.crm_actions where feedback_id = $1", [low])).status, "done");   // the generic follow-up action is completed
  const events = (await asSuper("select event from public.crm_feedback_case_events where case_id = $1 order by id", [c.id])).rows.map((r) => r.event);
  assert.deepEqual(events, ["opened", "acknowledged", "findings_saved", "findings_saved", "resolved", "client_informed", "closed"]);
});

test("a closed case can be reopened with a reason and gets more time; a case can be escalated to the CRM owners", async () => {
  const c = await caseOf(low);
  await rejects(as("lead", "select public.crm_case_reopen($1, '')", [c.id]), /why it is reopened/);
  await as("lead", "select public.crm_case_reopen($1, 'Anna says it happened again')", [c.id]);
  const r = await caseOf(low);
  assert.deepEqual([r.status, r.closed_at, r.client_outcome], ["investigating", null, null]);
  assert.equal(days(r.resolve_due) >= 7, true);
  await rejects(as("lead", "select public.crm_case_escalate($1, '')", [c.id]), /why it is being escalated/);
  await as("lead", "select public.crm_case_escalate($1, 'Second occurrence, needs a senior call')", [c.id]);
  assert.ok((await caseOf(low)).escalated_at);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title = 'A feedback case was escalated'", [ids.head])).n, 1);
  await as("lead", "select public.crm_case_comment($1, 'Spoke to the client partner')", [c.id]);
  await rejects(as("lead", "select public.crm_case_comment($1, '')", [c.id]), /Write a note/);
});

test("late cases alert the owner once for each late step", async () => {
  const h = await caseOf(high);
  await asSuper("update public.crm_feedback_cases set ack_due = current_date - 1 where id = $1", [h.id]);
  const first = (await asSuper("select public.crm_feedback_run_due() as r")).rows[0].r;
  assert.equal(first.acknowledgement_alerts, 1);
  assert.equal((await asSuper("select public.crm_feedback_run_due() as r")).rows[0].r.acknowledgement_alerts, 0);    // once
  await asSuper("update public.crm_feedback_cases set resolve_due = current_date - 1 where id = $1", [h.id]);
  assert.equal((await asSuper("select public.crm_feedback_run_due() as r")).rows[0].r.resolution_alerts, 1);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title in ('Feedback case not yet acknowledged', 'Feedback case is past its date')", [ids.lead])).n, 2);
  const v = await one("select ack_overdue, resolve_overdue, age_days from public.crm_feedback_cases_v where id = $1", [h.id]);
  assert.deepEqual([v.ack_overdue, v.resolve_overdue], [true, true]);
});

test("a poor post-job survey opens a case too, and the totals add up", async () => {
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const job = await one("insert into public.jobs (title, client_id, region, market, status) values ('Acme display wrap', $1, 'EMEA', 'Germany', 'delivered') returning id", [A]);
  await asSuper("update public.jobs set status = 'closed' where id = $1", [job.id]);
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  const js = await one("select id, token from public.crm_job_surveys where job_id = $1", [job.id]);
  await anon("select public.public_survey_submit($1, '{\"overall\":2, \"comment\":\"Late install\"}')", [js.token]);
  const c = await one("select source, severity, score, scale, comment from public.crm_feedback_cases where job_survey_id = $1", [js.id]);
  assert.deepEqual([c.source, c.severity, c.score, c.scale, c.comment], ["job_survey", "high", 2, 5, "Late install"]);
  const s = (await as("lead", "select public.crm_feedback_case_stats(null) as r")).rows[0].r;
  assert.equal(s.open >= 3, true);
  assert.equal(s.overdue >= 1, true);
  assert.equal(s.by_cause.communication, 1);
  const jobOk = await one("select count(*)::int n from public.crm_job_surveys where id = $1 and status = 'responded'", [js.id]);
  assert.equal(jobOk.n, 1);                                                                                         // the survey answer itself saved
});

test("existing low feedback was turned into cases, and clients and vendors cannot read or work cases", async () => {
  assert.equal((await one("select count(*)::int n from public.crm_feedback f where f.score <= 6 and f.comment is distinct from 'Now above the line' and not exists (select 1 from public.crm_feedback_cases k where k.feedback_id = f.id)")).n, 0);
  assert.equal((await as("cA", "select count(*)::int n from public.crm_feedback_cases")).rows[0].n, 0);
  assert.equal((await as("cA", "select count(*)::int n from public.crm_feedback_cases_v")).rows[0].n, 0);
  const c = await caseOf(high);
  await rejects(as("cA", "select public.crm_case_acknowledge($1)", [c.id]), /Only staff/);
  await rejects(anon("select public.crm_case_comment($1, 'x')", [c.id]), /permission denied/);
  await rejects(as("lead", "select public.crm_feedback_run_due()"), /permission denied/);
});

