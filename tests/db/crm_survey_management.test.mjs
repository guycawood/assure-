// Survey management: reminders to people who have not answered, scheduled sends run by the platform, and automatic closing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const val = async (user, sql, params) => (await as(user, sql, params)).rows[0]?.r;
const U = { cA: "00000000-0000-0000-0000-0000000000f1" };
Object.assign(ids, U);
await asSuper("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'cat@acme.example', '{}')", [U.cA]);
const A = (await one("insert into public.sourcing_clients (code, name) values ('SMA', 'Acme Foods') returning id")).id;
const B = (await one("insert into public.sourcing_clients (code, name) values ('SMB', 'Bolt Drinks') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA, A]);
const contact = async (client, name, email, extra = {}) => {
  const id = await val("agent", "select public.crm_contact_save(null, $1, null, $2, 'Manager', $3, null, 'DE', 'approver', false) as r", [client, name, email]);
  for (const [k, v] of Object.entries(extra)) await as("agent", "select public.crm_contact_set_field($1, $2, $3)", [id, k, JSON.stringify(v)]);
  return id;
};
const anna = await contact(A, "Anna Acme", "anna@sm.example", { receive_survey: true, owner: ids.lead });
const alan = await contact(A, "Alan Acme", "alan@sm.example", { receive_survey: true, owner: ids.lead });
const ava = await contact(A, "Ava Acme", "ava@sm.example", { receive_survey: true, owner: ids.lead });
const ben = await contact(B, "Ben Bolt", "ben@sm.example", { receive_survey: true });
const rec = (wave, contactId) => one("select status, reminders_sent, last_reminded_at, reminder_skipped, sent_at from public.crm_survey_recipients where wave_id = $1 and contact_id = $2", [wave, contactId]);
const remind = (wave) => as("lead", "select public.crm_survey_wave_remind($1) as r", [wave]);
let wave;

test("a reminder is not sent too soon, then goes to people who have not answered, at most twice", async () => {
  wave = await val("lead", "select public.crm_survey_wave_create('Reminder survey', 'H2') as r");
  await as("lead", "select public.crm_survey_wave_add($1, $2)", [wave, A]);
  await rejects(remind(wave), /has been sent and is still open/);                                      // still a draft
  await as("lead", "select public.crm_survey_wave_send($1)", [wave]);
  await rejects(remind(wave), /too soon to remind/);                                                    // invited moments ago
  await asSuper("update public.crm_survey_recipients set status = 'responded', responded_at = now() where wave_id = $1 and contact_id = $2", [wave, ava]);
  await asSuper("update public.crm_survey_recipients set sent_at = now() - interval '4 days' where wave_id = $1", [wave]);
  const r1 = (await remind(wave)).rows[0].r;
  assert.deepEqual([r1.sent, r1.skipped], [2, 0]);                                                      // Anna and Alan; Ava already answered
  assert.deepEqual([(await rec(wave, anna)).reminders_sent, (await rec(wave, ava)).reminders_sent], [1, 0]);
  const mail = (await asSuper("select to_email, subject, body, link from public.email_outbox where source = 'crm_survey_reminder' order by to_email")).rows;
  assert.deepEqual(mail.map((m) => m.to_email), ["alan@sm.example", "anna@sm.example"]);
  assert.match(mail[1].subject, /reminder/i);
  assert.match(mail[1].body, /Anna/);
  assert.match(mail[1].body, /Lena|lead@adm-indicia.com/);                                              // signed by the contact owner
  await rejects(remind(wave), /too soon to remind/);                                                    // reminded just now
  await asSuper("update public.crm_survey_recipients set last_reminded_at = now() - interval '6 days' where wave_id = $1", [wave]);
  assert.equal((await remind(wave)).rows[0].r.sent, 2);
  await asSuper("update public.crm_survey_recipients set last_reminded_at = now() - interval '6 days' where wave_id = $1", [wave]);
  await rejects(remind(wave), /already reminded twice/);                                                // two is the limit
  assert.equal((await rec(wave, anna)).reminders_sent, 2);
});

test("someone who opted out since the invitation is skipped with the reason; a closed wave and non-staff get nothing", async () => {
  const w2 = await val("lead", "select public.crm_survey_wave_create('Opt-out survey') as r");
  await as("lead", "select public.crm_survey_wave_add($1, null, $2)", [w2, [anna, alan]]);
  await as("lead", "select public.crm_survey_wave_send($1)", [w2]);
  await asSuper("update public.crm_survey_recipients set sent_at = now() - interval '4 days' where wave_id = $1", [w2]);
  await as("agent", "select public.crm_contact_set_field($1, 'email_opt_out', 'true')", [alan]);
  const r = (await remind(w2)).rows[0].r;
  assert.deepEqual([r.sent, r.skipped], [1, 1]);
  assert.equal((await rec(w2, alan)).reminder_skipped, "Opted out of email");
  await as("agent", "select public.crm_contact_set_field($1, 'email_opt_out', 'false')", [alan]);
  await asSuper("update public.crm_survey_waves set closes_on = current_date - 1 where id = $1", [w2]);
  await rejects(remind(w2), /passed its closing date/);
  await rejects(as("cA", "select public.crm_survey_wave_remind($1)", [w2]), /Only staff/);
});

test("scheduling: needs recipients, a sensible date, and is cleared when unscheduled", async () => {
  const w = await val("lead", "select public.crm_survey_wave_create('Scheduled survey') as r");
  await rejects(as("lead", "select public.crm_survey_wave_schedule($1, current_date)", [w]), /Add contacts/);
  await as("lead", "select public.crm_survey_wave_add($1, null, $2)", [w, [ben]]);
  await rejects(as("lead", "select public.crm_survey_wave_schedule($1, current_date - 1)", [w]), /today or a later date/);
  await asSuper("update public.crm_survey_waves set closes_on = current_date + 2 where id = $1", [w]);
  await rejects(as("lead", "select public.crm_survey_wave_schedule($1, current_date + 2)", [w]), /before the closing date/);
  await as("lead", "select public.crm_survey_wave_schedule($1, current_date + 1)", [w]);
  assert.equal((await one("select scheduled_for = current_date + 1 as ok from public.crm_survey_waves where id = $1", [w])).ok, true);
  const early = (await asSuper("select public.crm_survey_run_due() as r")).rows[0].r;
  assert.deepEqual([early.sent, early.failed, early.waiting_for_approval], [0, 0, 0]);                       // not due yet (the earlier wave past its closing date is closed)
  assert.equal(early.closed, 1);
  await as("lead", "select public.crm_survey_wave_schedule($1, null)", [w]);
  assert.equal((await one("select scheduled_for from public.crm_survey_waves where id = $1", [w])).scheduled_for, null);
  await as("lead", "select public.crm_survey_wave_schedule($1, current_date)", [w]);
  const run = (await asSuper("select public.crm_survey_run_due() as r")).rows[0].r;
  assert.deepEqual([run.sent, run.failed], [1, 0]);
  const done = await one("select status, scheduled_for, recipient_count from public.crm_survey_waves where id = $1", [w]);
  assert.deepEqual([done.status, done.scheduled_for, done.recipient_count], ["sent", null, 1]);
  assert.equal((await one("select count(*)::int n from public.email_outbox where to_email = 'ben@sm.example' and source = 'crm_survey'")).n, 1);
  assert.equal((await asSuper("select public.crm_survey_run_due() as r")).rows[0].r.sent, 0);               // runs once
  await rejects(as("lead", "select public.crm_survey_wave_schedule($1, current_date + 1)", [w]), /has not been sent/);
});

test("a scheduled send that cannot go out is cleared, logged and the person who scheduled it is told", async () => {
  const bea = await contact(B, "Bea Bolt", "bea@sm.example", { receive_survey: true, email_opt_out: true });
  const w = await val("lead", "select public.crm_survey_wave_create('Doomed survey') as r");
  await as("lead", "select public.crm_survey_wave_add($1, null, $2)", [w, [bea]]);
  await as("lead", "select public.crm_survey_wave_schedule($1, current_date)", [w]);
  const run = (await asSuper("select public.crm_survey_run_due() as r")).rows[0].r;
  assert.deepEqual([run.sent, run.failed], [0, 1]);
  assert.equal((await one("select status, scheduled_for from public.crm_survey_waves where id = $1", [w])).status, "draft");
  assert.equal((await one("select scheduled_for from public.crm_survey_waves where id = $1", [w])).scheduled_for, null);
  assert.equal((await one("select count(*)::int n from public.crm_events where entity_id = $1 and action = 'scheduled_send_failed'", [w])).n, 1);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title like 'Scheduled survey did not send%'", [ids.lead])).n, 1);
});

test("a scheduled send above the approval size waits for a CRM owner instead of sending", async () => {
  await asSuper(`insert into public.library_records (library_key, code, name, data, status, effective_from) values ('approval_policies', 'AP-SM-SEND', 'AP-SM-SEND', $1, 'active', current_date - 1)`,
    [JSON.stringify({ module: "crm", approval_type: "CRM_SEND", approver_role: "module_owner", min_value: 2, maker_checker: true })]);
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.head]);
  const w = await val("lead", "select public.crm_survey_wave_create('Big survey') as r");
  await as("lead", "select public.crm_survey_wave_add($1, null, $2)", [w, [anna, alan]]);
  await as("lead", "select public.crm_survey_wave_schedule($1, current_date)", [w]);
  const run = (await asSuper("select public.crm_survey_run_due() as r")).rows[0].r;
  assert.deepEqual([run.sent, run.waiting_for_approval, run.failed], [0, 1, 0]);
  assert.equal((await one("select status, scheduled_for from public.crm_survey_waves where id = $1", [w])).status, "draft");
  assert.equal((await one("select count(*)::int n from public.approval_requests where approval_type = 'CRM_SEND' and entity_id = $1", [w])).n, 1);
  await asSuper("update public.library_records set status = 'retired' where code = 'AP-SM-SEND'");
});

test("a sent wave is closed the day after its closing date", async () => {
  const w = await val("lead", "select public.crm_survey_wave_create('Closing survey') as r");
  await as("lead", "select public.crm_survey_wave_add($1, null, $2)", [w, [ava]]);
  await as("lead", "select public.crm_survey_wave_send($1)", [w]);
  await asSuper("update public.crm_survey_waves set closes_on = current_date where id = $1", [w]);
  assert.equal((await asSuper("select public.crm_survey_run_due() as r")).rows[0].r.closed, 0);              // closes today: still open
  await asSuper("update public.crm_survey_waves set closes_on = current_date - 1 where id = $1", [w]);
  const run = (await asSuper("select public.crm_survey_run_due() as r")).rows[0].r;
  assert.equal(run.closed >= 1, true);
  assert.equal((await one("select status from public.crm_survey_waves where id = $1", [w])).status, "closed");
});
