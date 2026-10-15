// CRM stage 2 (HubSpot replacement): stakeholder mapping, Performance Tracker, surveys (public token page and Client Portal),
// post-job surveys, forms, lists and email sends with consent/opt-out, send approval, and the HubSpot import.
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
const lib = async (key, code) => (await one("select id from public.library_records where library_key = $1 and code = $2 and status = 'active'", [key, code])).id;
async function policy(code, data) {
  await asSuper(`insert into public.library_records (library_key, code, name, data, status, effective_from) values ('approval_policies', $1, $1, $2, 'active', current_date - 1)`,
    [code, JSON.stringify(data)]);
}
const retire = (code) => asSuper("update public.library_records set status = 'retired' where code = $1", [code]);

// ---------- people and fixtures ----------
const U = { cA: "00000000-0000-0000-0000-0000000000e1", cB: "00000000-0000-0000-0000-0000000000e2", vendor: "00000000-0000-0000-0000-0000000000e3" };
Object.assign(ids, U);
for (const [id, email] of [[U.cA, "anna@acme.example"], [U.cB, "ben@bolt.example"], [U.vendor, "vic@vendor.example"]]) {
  await asSuper("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')", [id, email]);
}
const supplier = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('HS-V', 'HS Vendor', 'Germany', 'EMEA') returning id")).id;
await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [U.vendor, supplier]);
const A = (await one("insert into public.sourcing_clients (code, name) values ('HA', 'Acme Foods') returning id")).id;
const B = (await one("insert into public.sourcing_clients (code, name) values ('HB', 'Bolt Drinks') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA, A]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [U.cB, B]);
const accA = await val("agent", "select public.crm_account_save(null, $1, 'DE', $2, null) as r", [A, ids.lead]);
const contact = async (client, name, email, extra = {}) => {
  const id = await val("agent", "select public.crm_contact_save(null, $1, null, $2, 'Manager', $3, null, 'DE', 'approver', false) as r", [client, name, email]);
  for (const [k, v] of Object.entries(extra)) await as("agent", "select public.crm_contact_set_field($1, $2, $3)", [id, k, JSON.stringify(v)]);
  return id;
};
const anna = await contact(A, "Anna Acme", "anna@acme.example", { receive_survey: true, owner: ids.lead });
const omar = await contact(A, "Omar Optout", "omar@acme.example", { receive_survey: true, email_opt_out: true });
const nora = await contact(A, "Nora Nobasis", "nora@acme.example", { receive_survey: true, legal_basis: "none" });
const ben = await contact(B, "Ben Bolt", "ben@bolt.example", { receive_survey: true });

test("stakeholder fields: cell edits are audited, mandatory fields can't be cleared, the matrix comes from the governed grid", async () => {
  await as("lead", "select public.crm_contact_set_field($1, 'influence_level', '\"high\"')", [anna]);
  await as("lead", "select public.crm_contact_set_field($1, 'decision_level', '\"low\"')", [anna]);
  await as("lead", "select public.crm_contact_set_field($1, 'department', '\"marketing\"')", [anna]);
  const svc = await lib("crm_services", "POSM");
  await as("lead", "select public.crm_contact_set_field($1, 'services_offered', $2)", [anna, JSON.stringify([svc])]);
  await rejects(as("lead", "select public.crm_contact_set_field($1, 'services_declined', $2)", [anna, JSON.stringify([svc])]), /both offered and declined/);
  await rejects(as("lead", "select public.crm_contact_set_field($1, 'department', 'null')", [anna]), /department is required/);
  await rejects(as("lead", "select public.crm_contact_set_field($1, 'notes', '\"x\"')", [anna]), /can't be edited/);
  const s = (await as("plain", "select quadrant, quadrant_confirmed, needs_review, services_offered_names from public.crm_stakeholders_v where id = $1", [anna])).rows[0];
  assert.deepEqual([s.quadrant, s.quadrant_confirmed, s.needs_review], ["ESTABLISH", false, true]);
  assert.deepEqual(s.services_offered_names, ["POS and display production"]);
  const ev = await one("select detail from public.crm_events where entity_id = $1 and action = 'field_changed' and detail->>'field' = 'department'", [anna]);
  assert.equal(ev.detail.after, "marketing");
  await as("lead", "select public.crm_contacts_mark_reviewed($1)", [[anna]]);
  assert.equal((await one("select needs_review from public.crm_stakeholders_v where id = $1", [anna])).needs_review, false);
  // Bulk reassign and leavers.
  const tmp = await contact(A, "Lee Leaver", "lee@acme.example");
  assert.equal(await val("agent", "select public.crm_contacts_reassign($1, $2) as r", [[tmp, anna], ids.head]), 2);
  await as("agent", "select public.crm_contact_mark_left($1, 'Moved on')", [tmp]);
  const left = await one("select active, receive_survey, left_at is not null as gone from public.crm_contacts where id = $1", [tmp]);
  assert.deepEqual(left, { active: false, receive_survey: false, gone: true });
  await as("agent", "select public.crm_contacts_reassign($1, $2)", [[anna], ids.lead]);
});

test("Performance Tracker: the contact is required; weighted budget and the needs-updating flag", async () => {
  const svc = await lib("crm_services", "INSTALL");
  await rejects(as("agent", "select public.crm_performance_save(null, $1, null, $2, 'Install wave', 'proposal', null, null, null, null, 10000, 'EUR', 60, null)", [A, svc]), /Choose the client contact/);
  await rejects(as("agent", "select public.crm_performance_save(null, $1, $2, $3, 'Install wave', 'proposal', null, null, null, null, 10000, 'EUR', 60, null)", [A, ben, svc]), /same client/);
  const id = await val("agent", "select public.crm_performance_save(null, $1, $2, $3, 'Install wave', 'proposal', null, 'Send costed plan', $4, $5, 10000, 'EUR', 60, null) as r",
    [A, anna, svc, ids.lead, ids.head]);
  const p = (await as("plain", "select weighted_budget, cs_lead_name, sme_name, service_name, needs_updating, contact_name from public.crm_performance_v where id = $1", [id])).rows[0];
  assert.deepEqual([Number(p.weighted_budget), p.service_name, p.needs_updating, p.contact_name], [6000, "Installation and field services", false, "Anna Acme"]);
  await asSuper("update public.library_records set data = '{\"value\":0}' where library_key = 'crm_settings' and code = 'PERF_STALE_DAYS'");
  assert.equal((await one("select needs_updating from public.crm_performance_v where id = $1", [id])).needs_updating, true);
  await asSuper("update public.library_records set data = '{\"value\":14}' where library_key = 'crm_settings' and code = 'PERF_STALE_DAYS'");
});

let wave, tokA;
test("survey wave: opted-out and no-legal-basis contacts are excluded with the reason; the rest get a signed email with a unique link", async () => {
  wave = await val("lead", "select public.crm_survey_wave_create('H2 2026 survey', 'H2 2026') as r");
  assert.equal(await val("lead", "select public.crm_survey_wave_add($1, $2) as r", [wave, A]), 3);
  assert.equal(await val("lead", "select public.crm_survey_wave_send($1) as r", [wave]), "sent");
  const rec = (await asSuper("select contact_id, status, excluded_reason, token from public.crm_survey_recipients where wave_id = $1", [wave])).rows;
  const by = Object.fromEntries(rec.map((r) => [r.contact_id, r]));
  assert.equal(by[omar].excluded_reason, "Opted out of email");
  assert.equal(by[nora].excluded_reason, "No legal basis for processing");
  assert.equal(by[anna].status, "sent");
  tokA = by[anna].token;
  const mail = await one("select to_email, body, link from public.email_outbox where source = 'crm_survey'");
  assert.equal(mail.to_email, "anna@acme.example");
  assert.match(mail.body, /Lena|lead@adm-indicia.com/, "signed by the contact owner");
  assert.equal(mail.link, `/s/${tokA}`);
});

test("survey answers: public token page, comment required at 3 or lower, one use only, never for another account", async () => {
  const page = (await anon("select public.public_survey_get($1) as r", [tokA])).rows[0].r;
  assert.equal(page.state, "open");
  assert.equal(page.sections.length, 11);
  assert.equal(page.sections.flatMap((s) => s.questions).length, 19);
  assert.ok(!JSON.stringify(page).includes("anna@acme.example"));
  assert.equal((await anon("select public.public_survey_get('nottoken') as r")).rows[0].r, null);
  const scores = Object.fromEntries(page.sections.flatMap((s) => s.questions).map((q) => [q.code, 4]));
  const answers = { scores: { ...scores, Q07: 3 }, nps: 8, start: "More innovation", continue: "Great people", stop: "", testimonial: true };
  await rejects(anon("select public.public_survey_submit($1, $2)", [tokA, JSON.stringify(answers)]), /Add a comment for Q07/);
  await rejects(anon("select public.public_survey_submit($1, $2)", [tokA, JSON.stringify({ ...answers, comments: { Q07: "Late twice" }, nps: 11 })]), /0 to 10/);
  // A signed-in user of another account can't use this link; staff can't answer for clients.
  await rejects(as("cB", "select public.public_survey_submit($1, $2)", [tokA, JSON.stringify({ ...answers, comments: { Q07: "x" } })]), /another account/);
  await rejects(as("lead", "select public.public_survey_submit($1, $2)", [tokA, JSON.stringify({ ...answers, comments: { Q07: "x" } })]), /client to answer/);
  // The client's own user answers in the portal; the contact comes from the token, never from the payload.
  const portal = await val("cA", "select public.client_portal_surveys() as r");
  assert.deepEqual(portal.map((p) => p.token), [tokA]);
  await as("cA", "select public.public_survey_submit($1, $2)", [tokA, JSON.stringify({ ...answers, comments: { Q07: "Late twice" }, contact_id: ben })]);
  const resp = await one("select contact_id, nps, overall, comments, section_scores from public.crm_survey_responses where recipient_id = (select id from public.crm_survey_recipients where token = $1)", [tokA]);
  assert.equal(resp.contact_id, anna);
  assert.equal(resp.comments.Q07, "Late twice");
  assert.equal(Number(resp.section_scores.processes), 3.5);
  await rejects(anon("select public.public_survey_submit($1, $2)", [tokA, JSON.stringify({ ...answers, comments: { Q07: "again" } })]), /already been answered/);
  assert.equal((await anon("select public.public_survey_get($1) as r", [tokA])).rows[0].r.state, "answered");
  // Results fold in 0-10 feedback as NPS-only rows; NPS from the survey counts towards health.
  await as("agent", "select public.crm_feedback_capture($1, null, null, 10, 'Great')", [A]);
  const kinds = (await as("plain", "select kind, nps_category from public.crm_survey_results_v where client_id = $1 order by kind", [A])).rows;
  assert.deepEqual(kinds.map((k) => k.kind), ["feedback", "survey"]);
  assert.equal((await one("select feedback_count from public.crm_client_health where client_id = $1", [A])).feedback_count, 2);
});

test("RLS: vendors, clients and anonymous visitors can't read CRM internals", async () => {
  for (const user of ["vendor", "cA"]) {
    for (const tbl of ["crm_survey_responses", "crm_survey_recipients", "crm_stakeholders_v", "crm_performance_v", "crm_lists", "crm_emails", "email_events",
      "crm_form_submissions", "crm_import_logs", "crm_survey_results_v", "crm_job_surveys"]) {
      assert.equal((await as(user, `select count(*)::int n from public.${tbl}`)).rows[0].n, 0, `${tbl} visible to ${user}`);
    }
    await rejects(as(user, "select public.crm_contact_set_field($1, 'department', '\"other\"')", [anna]), /Only adm Indicia staff/);
  }
  await rejects(anon("select count(*) from public.crm_survey_responses"), /permission denied/);
  await rejects(anon("select public.crm_survey_wave_send($1)", [wave]), /permission denied/);
});

test("send approval: above the CRM_SEND size a CRM owner approves (not the requester), then it sends", async () => {
  await policy("AP-T-SEND", { module: "crm", approval_type: "CRM_SEND", approver_role: "module_owner", min_value: 2, maker_checker: true });
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.head]);
  await contact(B, "Bea Bolt", "bea@bolt.example", { receive_survey: true });
  const w = await val("lead", "select public.crm_survey_wave_create('Bolt survey') as r");
  await as("lead", "select public.crm_survey_wave_add($1, $2)", [w, B]);
  assert.equal(await val("lead", "select public.crm_survey_wave_send($1) as r", [w]), "pending");
  assert.equal((await one("select count(*)::int n from public.email_outbox where source = 'crm_survey' and source_id in (select id from public.crm_survey_recipients where wave_id = $1)", [w])).n, 0);
  const req = await one("select id from public.approval_requests where approval_type = 'CRM_SEND' and entity_id = $1", [w]);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else|module owner/);
  assert.ok((await as("head", "select * from public.approvals_inbox('mine')")).rows.some((r) => r.item_id === req.id && r.module === "crm"));
  await as("head", "select public.approval_request_decide($1, true, null)", [req.id]);
  assert.equal((await one("select status, recipient_count from public.crm_survey_waves where id = $1", [w])).recipient_count, 2);
  await retire("AP-T-SEND");
});

test("lists and email sends: consent and opt-outs are honoured, unsubscribe links opt the contact out, demo events show who read it", async () => {
  const list = await val("lead", "select public.crm_list_save(null, 'Acme marketing', null, 'static', 'external') as r");
  await as("lead", "select public.crm_list_add($1, $2)", [list, [anna, omar, nora]]);
  await rejects(as("lead", "select public.crm_list_add($1, null, $2)", [list, [ids.plain]]), /client contacts/);
  const tmpl = await lib("crm_email_templates", "NEWSLETTER");
  const e1 = await val("lead", "select public.crm_email_save(null, 'October news', $1, $2, null, null, 'https://example.com/report') as r", [list, tmpl]);
  // External list with a CRM_SEND_EXTERNAL policy needs approval.
  await policy("AP-T-EXT", { module: "crm", approval_type: "CRM_SEND_EXTERNAL", approver_role: "module_owner", maker_checker: true });
  assert.equal(await val("lead", "select public.crm_email_send($1) as r", [e1]), "pending");
  await as("head", "select public.approval_request_decide((select id from public.approval_requests where approval_type = 'CRM_SEND' and entity_id = $1), true, null)", [e1]);
  await retire("AP-T-EXT");
  const rec = (await asSuper("select contact_id, status, excluded_reason, token from public.crm_email_recipients where email_id = $1", [e1])).rows;
  assert.deepEqual(rec.filter((r) => r.status === "sent").map((r) => r.contact_id), [anna]);
  assert.deepEqual(rec.filter((r) => r.status === "excluded").map((r) => r.excluded_reason).sort(), ["No legal basis for processing", "Opted out of email"]);
  const body = (await one("select body from public.email_outbox where source = 'crm_email'")).body;
  const tok = rec.find((r) => r.contact_id === anna).token;
  assert.ok(body.includes(`/u/${tok}`), "unsubscribe link in the email");
  assert.ok((await val("lead", "select public.crm_email_simulate_events($1) as r", [e1])) >= 1);
  await rejects(as("lead", "select public.crm_email_simulate_events($1)", [e1]), /already been added/);
  const who = (await as("plain", "select contact_id, opens, clicks, first_opened_at from public.crm_email_recipients_v where email_id = $1 and status = 'sent'", [e1])).rows;
  assert.equal(who.length, 1);
  // Unsubscribe (public link) -> opted out -> excluded next time.
  const u = (await anon("select public.public_unsubscribe($1) as r", [tok])).rows[0].r;
  assert.equal(u.ok, true);
  assert.equal((await one("select email_opt_out from public.crm_contacts where id = $1", [anna])).email_opt_out, true);
  const e2 = await val("lead", "select public.crm_email_save(null, 'November news', $1, $2, null, null) as r", [list, tmpl]);
  await rejects(as("lead", "select public.crm_email_send($1)", [e2]), /Nobody on this list can be emailed/);
  // Internal lists (staff) for internal comms.
  const staff = await val("lead", "select public.crm_list_save(null, 'All staff', null, 'dynamic', 'internal', '{\"all_staff\":true}') as r");
  const e3 = await val("lead", "select public.crm_email_save(null, 'Pulse survey', $1, null, 'Pulse', 'Hello {{first_name}}') as r", [staff]);
  assert.equal(await val("lead", "select public.crm_email_send($1) as r", [e3]), "sent");
  assert.ok((await one("select recipient_count from public.crm_emails where id = $1", [e3])).recipient_count >= 7);
  await as("lead", "select public.crm_contact_set_field($1, 'email_opt_out', 'false')", [anna]);
});

test("forms: public submission links an existing contact by email or creates one, with consent; bots are ignored", async () => {
  const fields = [{ key: "full_name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true },
    { key: "session", label: "Session", type: "select", options: ["Morning", "Afternoon"], required: true }];
  await rejects(as("lead", "select public.crm_form_save(null, 'Bad', null, $1, null, null)", [JSON.stringify([{ key: "name", label: "Name", type: "text" }])]), /"email" field/);
  const form = await val("lead", "select public.crm_form_save(null, 'Innovation workshop', null, $1, 'I agree to hear about future events.', $2) as r", [JSON.stringify(fields), A]);
  const token = (await one("select token from public.crm_forms where id = $1", [form])).token;
  assert.equal((await anon("select public.public_form_get($1) as r", [token])).rows[0].r.name, "Innovation workshop");
  await rejects(anon("select public.public_form_submit($1, $2)", [token, JSON.stringify({ full_name: "X", email: "x@acme.example", session: "Night" })]), /Choose an option/);
  await anon("select public.public_form_submit($1, $2)", [token, JSON.stringify({ full_name: "Paula New", email: "Paula@Acme.example", session: "Morning", consent: "on" })]);
  const created = await one("select id, consent, legal_basis from public.crm_contacts where email = 'paula@acme.example'");
  assert.deepEqual([created.consent, created.legal_basis], [true, "consent"]);
  await anon("select public.public_form_submit($1, $2)", [token, JSON.stringify({ full_name: "Anna", email: "anna@acme.example", session: "Afternoon" })]);
  const sub = await one("select contact_id, contact_created from public.crm_form_submissions where email = 'anna@acme.example'");
  assert.deepEqual(sub, { contact_id: anna, contact_created: false });
  assert.equal((await anon("select public.public_form_submit($1, $2, 'bot') as r", [token, "{}"])).rows[0].r, "thanks");
  assert.equal((await one("select count(*)::int n from public.crm_form_submissions where form_id = $1", [form])).n, 2);
});

test("post-job survey: closing a job queues it to the client contact; low scores need a comment", async () => {
  await asSuper("select set_config('sourcing.system_write', 'on', false)");
  const job = (await one("insert into public.jobs (title, client_id, region, market, status) values ('Bolt chiller wrap', $1, 'EMEA', 'Germany', 'delivered') returning id, job_number", [B]));
  await asSuper("update public.jobs set status = 'closed' where id = $1", [job.id]);
  await asSuper("select set_config('sourcing.system_write', 'off', false)");
  const js = await one("select token, project_number, contact_id from public.crm_job_surveys where job_id = $1", [job.id]);
  assert.equal(js.project_number, job.job_number);
  assert.ok((await one("select count(*)::int n from public.email_outbox where source = 'crm_job_survey'")).n === 1);
  const page = (await anon("select public.public_survey_get($1) as r", [js.token])).rows[0].r;
  assert.equal(page.kind, "job");
  await rejects(anon("select public.public_survey_submit($1, '{\"overall\":2}')", [js.token]), /could have done better/);
  await anon("select public.public_survey_submit($1, '{\"overall\":2, \"comment\":\"Late install\"}')", [js.token]);
  await rejects(anon("select public.public_survey_submit($1, '{\"overall\":5}')", [js.token]), /already been answered/);
});

test("HubSpot import: admin only; dry run reports duplicates and writes nothing; apply is all-or-nothing and logged", async () => {
  const rows = [
    { hubspot_id: "HS-1", first_name: "Hal", last_name: "Hub", email: "hal@acme.example", company: "Acme Foods", legal_basis: "legitimate_interest_existing" },
    { hubspot_id: "HS-2", full_name: "Anna Again", email: "ANNA@acme.example", company: "Acme Foods" },
    { hubspot_id: "HS-3", full_name: "Opted Out", email: "oo@bolt.example", company: "Bolt Drinks", email_opt_out: "true" },
  ];
  await rejects(as("lead", "select public.crm_import('contacts', $1, true)", [JSON.stringify(rows)]), /Only admins/);
  const before = (await one("select count(*)::int n from public.crm_contacts")).n;
  const dry = await val("admin", "select public.crm_import('contacts', $1, true, 'contacts.csv') as r", [JSON.stringify(rows)]);
  assert.deepEqual([dry.create, dry.skip, dry.duplicates.length, dry.errors.length, dry.applied], [2, 1, 1, 0, false]);
  assert.equal(dry.duplicates[0].reason, "email");
  assert.equal((await one("select count(*)::int n from public.crm_contacts")).n, before, "dry run wrote nothing");
  assert.equal((await one("select count(*)::int n from public.crm_import_logs")).n, 0);
  // One bad row: nothing at all is written.
  const bad = [...rows, { full_name: "Nowhere", email: "no@nowhere.example", company: "Unknown Ltd" }];
  await rejects(as("admin", "select public.crm_import('contacts', $1, false)", [JSON.stringify(bad)]), /Nothing was imported/);
  assert.equal((await one("select count(*)::int n from public.crm_contacts")).n, before);
  const done = await val("admin", "select public.crm_import('contacts', $1, false, 'contacts.csv') as r", [JSON.stringify(rows)]);
  assert.equal(done.create, 2);
  const hal = await one("select hubspot_id, client_id from public.crm_contacts where email = 'hal@acme.example'");
  assert.deepEqual(hal, { hubspot_id: "HS-1", client_id: A });
  assert.equal((await one("select email_opt_out from public.crm_contacts where email = 'oo@bolt.example'")).email_opt_out, true);
  assert.equal((await one("select count(*)::int n from public.crm_import_logs where kind = 'contacts' and created_count = 2")).n, 1);
  // Companies and deals (HubSpot stage names), duplicates by name.
  const comp = await val("admin", "select public.crm_import('companies', $1, false) as r", [JSON.stringify([{ hubspot_id: "C-9", name: "Zeta Retail", domain: "https://www.zeta.example" }, { name: "acme foods" }])]);
  assert.deepEqual([comp.create, comp.skip], [1, 1]);
  const deals = await val("admin", "select public.crm_import('deals', $1, false) as r", [JSON.stringify([{ hubspot_id: "D-1", title: "Zeta launch", amount: "12000", stage: "closedwon", company: "Zeta Retail" }])]);
  assert.equal(deals.create, 1);
  assert.equal((await one("select stage from public.crm_opportunities where hubspot_id = 'D-1'")).stage, "won");
  const perf = await val("admin", "select public.crm_import('performance', $1, true) as r", [JSON.stringify([{ title: "Shelf strips", contact_email: "hal@acme.example", service: "POSM", budget: "5000", probability: "0.5" }])]);
  assert.equal(perf.errors.length, 0);
});

test("reviews: planned -> held -> closed; closing needs outcomes; the pack is built from CRM data", async () => {
  const rev = await val("lead", "select public.crm_review_save(null, $1, null, 'qbr', 'Q4 review', current_date - 1, $2, $3, $4) as r", [A, ["Performance", "Plans for next year"], [ids.lead], [anna]]);
  await rejects(as("lead", "select public.crm_review_save(null, $1, null, 'qbr', 'Bad', current_date, $2, null, $3)", [A, ["x"], [ben]]), /contacts of the same client/);
  await rejects(as("lead", "select public.crm_review_save(null, $1, null, 'qbr', 'Empty', current_date, $2)", [A, ["  "]]), /agenda item/);
  const pack = await val("lead", "select public.crm_review_generate_pack($1) as r", [rev]);
  assert.ok(pack.health && pack.pipeline && "open_actions" in pack && pack.survey.responses >= 1);
  await rejects(as("lead", "select public.crm_review_set_status($1, 'closed')", [rev]), /Only a held review/);
  await as("lead", "select public.crm_review_set_status($1, 'held')", [rev]);
  await rejects(as("lead", "select public.crm_review_set_status($1, 'closed')", [rev]), /Record the outcomes/);
  await as("lead", "select public.crm_review_set_status($1, 'outcomes', 'Agreed a 48-hour estimate turnaround', 'Good meeting')", [rev]);
  const act = await val("lead", "select public.crm_action_save(null, null, 'Send the 48-hour estimate plan', null, $2, current_date - 2, $1, true) as r", [rev, ids.lead]);
  await as("lead", "select public.crm_review_set_status($1, 'closed')", [rev]);
  assert.equal((await one("select status from public.crm_reviews where id = $1", [rev])).status, "closed");
  const a = (await as("plain", "select source, overdue, review_title from public.crm_actions_v where id = $1", [act])).rows[0];
  assert.deepEqual([a.source, a.overdue, a.review_title], ["review", true, "Q4 review"]);
  const future = await val("lead", "select public.crm_review_save(null, $1, null, 'half_year', 'H1 review', current_date + 20, $2) as r", [A, ["Results"]]);
  await rejects(as("lead", "select public.crm_review_set_status($1, 'held')", [future]), /mark it held on the day/);
});

test("Client Portal: only the client's own client-visible actions and reviews; attendance is confirmed by the client", async () => {
  await as("lead", "select public.crm_action_save(null, $1, 'Internal note for Acme', null, null, null, null, false)", [A]);
  await as("lead", "select public.crm_action_save(null, $1, 'Bolt shelf audit report', null, null, current_date + 5, null, true)", [B]);
  const aActs = await val("cA", "select public.client_portal_actions() as r");
  assert.deepEqual(aActs.map((x) => x.title), ["Send the 48-hour estimate plan"]);
  assert.ok(!JSON.stringify(aActs).includes("Internal note"));
  const bActs = await val("cB", "select public.client_portal_actions() as r");
  assert.deepEqual(bActs.map((x) => x.title), ["Bolt shelf audit report"]);
  await rejects(as("cA", "select public.client_portal_actions($1)", [B]), /do not have access/);
  const revs = await val("cA", "select public.client_portal_reviews() as r");
  assert.deepEqual(revs.map((r) => r.title), ["H1 review"]);
  await as("cA", "select public.client_review_respond($1, 'attending', 'See you there')", [revs[0].id]);
  assert.equal((await val("cA", "select public.client_portal_reviews() as r"))[0].my_response, "attending");
  await rejects(as("cB", "select public.client_review_respond($1, 'attending')", [revs[0].id]), /Not found/);
  // Survey follow-ups became actions automatically (the low-score response and the detractor feedback).
  assert.ok((await one("select count(*)::int n from public.crm_actions where source = 'survey' and client_id = $1", [A])).n >= 1);
});

test("review cadence: overdue when the last review (or first account) plus the tier cadence has passed", async () => {
  const C = (await one("insert into public.sourcing_clients (code, name) values ('HC', 'Cadence Co') returning id")).id;
  const strategic = await lib("crm_account_tiers", "STRATEGIC");   // 90 days
  const acc = await val("agent", "select public.crm_account_save(null, $1, 'FR', null, $2) as r", [C, strategic]);
  let c = await one("select cadence_days, review_overdue from public.crm_review_cadence_v where client_id = $1", [C]);
  assert.deepEqual([c.cadence_days, c.review_overdue], [90, false]);
  await asSuper("update public.crm_accounts set created_at = now() - interval '100 days' where id = $1", [acc]);
  assert.equal((await one("select review_overdue from public.crm_review_cadence_v where client_id = $1", [C])).review_overdue, true);
  assert.equal((await one("select review_overdue, 'Business review overdue' = any (reasons) as flagged from public.crm_client_health where client_id = $1", [C])).flagged, true);
  const r = await val("lead", "select public.crm_review_save(null, $1, null, 'qbr', 'Catch-up', current_date, $2) as r", [C, ["Status"]]);
  await as("lead", "select public.crm_review_set_status($1, 'held')", [r]);
  c = await one("select review_overdue, review_due_on from public.crm_review_cadence_v where client_id = $1", [C]);
  assert.equal(c.review_overdue, false);
  const metrics = (await as("plain", "select metric from public.watchtower_health_crm")).rows.map((x) => x.metric);
  assert.ok(metrics.includes("reviews_overdue") && metrics.includes("actions_overdue"));
});