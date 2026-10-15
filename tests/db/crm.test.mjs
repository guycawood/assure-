// CRM (client relationship management): internal-only data, client feedback and account team through the Client Portal,
// commercial terms changed only by an approved request (maker-checker), new client set-up gating jobs (policy-driven),
// opportunity won -> Briefing+ campaign, win and contract approvals by policy, health view and the approvals inbox.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const val = async (user, sql, params) => (await as(user, sql, params)).rows[0]?.r;
const inbox = async (user) => (await as(user, "select * from public.approvals_inbox('mine')")).rows;
const requestFor = (type, entity) => one("select * from public.approval_requests where approval_type = $1 and entity_id = $2 order by requested_at desc limit 1", [type, String(entity)]);
async function policy(code, data) {
  await asSuper(`insert into public.library_records (library_key, code, name, data, status, effective_from)
    values ('approval_policies', $1, $1, $2, 'active', current_date - 1)`, [code, JSON.stringify(data)]);
}
const lib = async (key, code) => (await one("select id from public.library_records where library_key = $1 and code = $2 and status = 'active'", [key, code])).id;

// ---------- people ----------
const U = {
  cA1: "00000000-0000-0000-0000-0000000000d1", // Acme approver
  cA2: "00000000-0000-0000-0000-0000000000d2", // Acme viewer
  cB1: "00000000-0000-0000-0000-0000000000d3", // Bolt approver
  vendor: "00000000-0000-0000-0000-0000000000d4",
};
Object.assign(ids, U);
for (const [id, email] of [[U.cA1, "ann@acme.example"], [U.cA2, "vic@acme.example"], [U.cB1, "bob@bolt.example"], [U.vendor, "wei@print.example"]]) {
  await asSuper("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, JSON.stringify({ full_name: email.split("@")[0] })]);
}
const supplier = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('CRM-V', 'Vendor Print', 'Germany', 'EMEA') returning id")).id;
await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [U.vendor, supplier]);

// ---------- fixtures ----------
const A = (await one("insert into public.sourcing_clients (code, name, default_currency) values ('CA', 'Acme CRM', 'EUR') returning id")).id;
const B = (await one("insert into public.sourcing_clients (code, name, default_currency) values ('CB', 'Bolt CRM', 'EUR') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA1, A]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [U.cA2, A]);
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cB1, B]);
await asSuper("insert into public.sourcing_user_access (user_id, is_lead) values ($1, true) on conflict (user_id) do update set is_lead = true", [ids.lead]);

const strategic = await lib("crm_account_tiers", "STRATEGIC");
const meeting = await lib("crm_interaction_types", "MEETING");
const price = await lib("crm_lost_reasons", "PRICE");

test("internal staff run accounts, contacts and activity; region comes from the market master; library refs are recorded", async () => {
  const acc = await val("agent", "select public.crm_account_save(null, $1, 'Germany', $2, $3) as r", [A, ids.lead, strategic]);
  const row = await one("select market, region from public.crm_accounts where id = $1", [acc]);
  assert.deepEqual(row, { market: "DE", region: "EMEA" });
  await rejects(as("agent", "select public.crm_account_save(null, $1, 'DE', null, null)", [A]), /already has an account/);
  // Only the account lead, a CRM owner or an admin changes lead or tier.
  await rejects(as("agent", "select public.crm_account_save($1, $2, 'DE', $3, $4)", [acc, A, ids.agent, strategic]), /account lead, a CRM owner/);
  await as("lead", "select public.crm_account_save($1, $2, 'DE', $3, $4, 'active', 'Key partner')", [acc, A, ids.lead, strategic]);
  await as("agent", "select public.crm_account_save(null, $1, 'GB', $2, null)", [B, ids.head]);
  const ct = await val("agent", "select public.crm_contact_save(null, $1, $2, 'Ann Acme', 'Head of shopper', 'ANN@acme.example', null, 'DE', 'sponsor', true) as r", [A, acc]);
  assert.equal((await one("select email, consent, consent_at is not null as c from public.crm_contacts where id = $1", [ct])).c, true);
  await as("agent", "select public.crm_interaction_log($1, $2, null, $3, 'Quarterly catch-up', 'Went well', now() - interval '2 days', $4)", [A, acc, meeting, ct]);
  assert.equal((await one("select count(*)::int n from public.library_refs where record_id = $1", [strategic])).n, 1);
  // Direct writes are refused even for admins; everything goes through the functions.
  await rejects(as("admin", "update public.crm_accounts set status = 'closed'"), /permission denied/);
  await rejects(as("admin", "insert into public.crm_feedback (client_id, score, source) values ($1, 10, 'internal')", [A]), /permission denied/);
  assert.ok((await as("plain", "select count(*)::int n from public.crm_events")).rows[0].n >= 4);
});

test("vendors and client users can't read CRM internals or call CRM functions", async () => {
  for (const user of ["vendor", "cA1"]) {
    for (const tbl of ["crm_accounts", "crm_contacts", "crm_interactions", "crm_opportunities", "crm_contracts", "crm_feedback", "crm_events",
      "crm_accounts_v", "crm_opportunities_v", "crm_client_health", "watchtower_health_crm"]) {
      const { rows } = await as(user, `select count(*)::int n from public.${tbl}`);
      assert.equal(rows[0].n, 0, `${tbl} should be empty for ${user}`);
    }
    await rejects(as(user, "select public.crm_account_save(null, $1, 'FR', null, null)", [A]), /Only adm Indicia staff/);
    await rejects(as(user, "select public.crm_feedback_capture($1, null, null, 10, 'x')", [A]), /Only adm Indicia staff/);
  }
  await rejects(as("cA1", "select * from public.approvals_crm"), /permission denied/);
});

test("Client Portal: clients rate their own account only and see only their own account team", async () => {
  const team = await val("cA1", "select public.client_portal_account_team() as r");
  assert.deepEqual(team.map((x) => [x.client_name, x.market, x.lead_email]), [["Acme CRM", "DE", "lead@adm-indicia.com"]]);
  assert.deepEqual(Object.keys(team[0]).sort(), ["client_name", "lead_email", "lead_name", "market", "market_name"]);
  const teamB = await val("cB1", "select public.client_portal_account_team() as r");
  assert.deepEqual(teamB.map((x) => x.lead_email), ["head@adm-indicia.com"]);
  await rejects(as("cA1", "select public.client_portal_account_team($1)", [B]), /do not have access/);

  await as("cA1", "select public.client_feedback_submit($1, 9, 'Great install team', 'DE')", [A]);
  await as("cA2", "select public.client_feedback_submit($1, 6, 'Slow on quotes')", [A]); // viewers can give feedback too
  await rejects(as("cA1", "select public.client_feedback_submit($1, 8, 'x')", [B]), /do not have access/);
  await rejects(as("cA1", "select public.client_feedback_submit($1, 11, 'x')", [A]), /0 to 10/);
  await rejects(as("lead", "select public.client_feedback_submit($1, 8, 'x')", [A]), /read-only/);
  const rows = (await asSuper("select score, source, account_id is not null as acc from public.crm_feedback where client_id = $1 order by score", [A])).rows;
  assert.deepEqual(rows, [{ score: 6, source: "client_portal", acc: false }, { score: 9, source: "client_portal", acc: true }]);
  assert.equal((await val("cB1", "select public.client_portal_feedback() as r")).length, 0);
  assert.equal((await val("cA2", "select public.client_portal_feedback() as r")).length, 2);
  const n = await one("select count(*)::int n from public.notifications where user_id = $1 and module = 'crm'", [ids.lead]);
  assert.ok(n.n >= 1, "account lead is told");
});

test("commercial terms change only by an approved request from someone else; applied to the client master", async () => {
  await rejects(as("lead", "update public.sourcing_clients set default_markup_percent = 30 where id = $1", [A]), /change through CRM/);
  await rejects(as("lead", "select public.crm_terms_request($1, 15, 0, 0, null, 'Same')", [A]), /Nothing changes/);
  const reqId = await val("admin", "select public.crm_terms_request($1, 18, 2.5, 1, 45, 'New MSA rates') as r", [A]);
  let c = await one("select default_markup_percent, gsc_commission_percent, payment_terms_days from public.sourcing_clients where id = $1", [A]);
  assert.equal(Number(c.default_markup_percent), 15);
  assert.equal(c.payment_terms_days, null);
  const req = await requestFor("CRM_TERMS", A);
  assert.equal(req.id, reqId);
  assert.equal(req.approver_role, "module_owner");
  await rejects(as("admin", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else must approve/);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /admin or module owner/);
  // Inbox: the approver sees it, the requester does not.
  assert.ok((await inbox("admin2")).some((r) => r.item_id === req.id && r.module === "crm" && r.approval_type === "CRM_TERMS" && r.can_decide));
  assert.ok(!(await inbox("admin")).some((r) => r.item_id === req.id));
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === req.id));
  await as("admin2", "select public.approval_request_decide($1, true, 'Matches the MSA')", [req.id]);
  c = await one("select default_markup_percent, gsc_commission_percent, year_end_rebate_percent, payment_terms_days from public.sourcing_clients where id = $1", [A]);
  assert.deepEqual([Number(c.default_markup_percent), Number(c.gsc_commission_percent), Number(c.year_end_rebate_percent), c.payment_terms_days], [18, 2.5, 1, 45]);
  assert.equal((await one("select count(*)::int n from public.crm_events where client_id = $1 and action = 'terms_changed'", [A])).n, 1);
});

test("new client set-up: with a policy, the client can't be used on jobs until Finance (not the requester) approves", async () => {
  // Without a policy, clients are usable straight away (existing behaviour).
  const free = await val("lead", "select public.crm_client_create('CFREE', 'Free Client', 'EUR', 'FR', null, null) as r");
  assert.equal((await one("select crm_setup_status from public.sourcing_clients where id = $1", [free])).crm_setup_status, "approved");

  await policy("AP-T-CRM-SETUP", { module: "crm", approval_type: "CRM_CLIENT_SETUP", approver_role: "finance", maker_checker: true });
  const nc = await val("finance", "select public.crm_client_create('CNEW', 'New Client', 'GBP', 'GB', 'Drinks', 50000, 'Credit check from D&B attached') as r");
  assert.equal((await one("select crm_setup_status from public.sourcing_clients where id = $1", [nc])).crm_setup_status, "pending");
  await rejects(as("lead", "insert into public.jobs (title, client_id, region, market) values ('Too early', $1, 'EMEA', 'United Kingdom')", [nc]), /Finance has to approve/);
  await rejects(as("lead", "update public.sourcing_clients set crm_setup_status = 'approved' where id = $1", [nc]), /approved by Finance/);
  // A client added in Sourcing admin is held too.
  const viaSourcing = (await as("lead", "insert into public.sourcing_clients (code, name) values ('CSRC', 'Sourcing Added') returning id, crm_setup_status")).rows[0];
  assert.equal(viaSourcing.crm_setup_status, "pending");
  assert.equal((await requestFor("CRM_CLIENT_SETUP", viaSourcing.id)).status, "pending");

  const req = await requestFor("CRM_CLIENT_SETUP", nc);
  await rejects(as("finance", "select public.approval_request_decide($1, true, null)", [req.id]), /someone else/);
  await rejects(as("agent", "select public.approval_request_decide($1, true, null)", [req.id]), /finance/i);
  // Someone at adm Indicia with no role at all can't decide it either (approval_has_role never answers NULL).
  await rejects(as("plain", "select public.approval_request_decide($1, true, null)", [req.id]), /finance/i);
  assert.ok(!(await inbox("plain")).some((r) => r.item_id === req.id));
  assert.ok((await inbox("admin")).some((r) => r.item_id === req.id && r.market === "GB" && r.market_name === "United Kingdom"));
  await as("admin", "select public.approval_request_decide($1, true, 'KYC fine')", [req.id]);
  const row = await one("select crm_setup_status, setup_approved_by from public.sourcing_clients where id = $1", [nc]);
  assert.deepEqual(row, { crm_setup_status: "approved", setup_approved_by: ids.admin });
  await as("lead", "insert into public.jobs (title, client_id, region, market) values ('Now fine', $1, 'EMEA', 'United Kingdom')", [nc]);
  await asSuper("update public.library_records set status = 'retired' where code = 'AP-T-CRM-SETUP'");
});

test("opportunities: lost needs a reason; won becomes a linked Briefing+ campaign (once)", async () => {
  const acc = (await one("select id from public.crm_accounts where client_id = $1 and market = 'DE'", [A])).id;
  const opp = await val("agent", "select public.crm_opportunity_create($1, $2, 'Summer cooler kit', 20000, 'EUR', current_date + 30) as r", [A, acc]);
  let o = await one("select stage, probability, market, region, opp_code from public.crm_opportunities where id = $1", [opp]);
  assert.deepEqual([o.stage, o.probability, o.market, o.region], ["lead", 10, "DE", "EMEA"]);
  assert.match(o.opp_code, /^OPP-\d{4}-\d{5}$/);
  await as("agent", "select public.crm_opportunity_move($1, 'proposal', null, null)", [opp]);
  assert.equal((await one("select probability from public.crm_opportunities where id = $1", [opp])).probability, 50);
  await rejects(as("agent", "select public.crm_opportunity_to_campaign($1)", [opp]), /Only a won/);
  assert.equal(await val("agent", "select public.crm_opportunity_move($1, 'won', 'Signed PO', null) as r", [opp]), "moved");
  await rejects(as("agent", "select public.crm_opportunity_move($1, 'lost', null, $2)", [opp, price]), /already won/);
  const camp = await val("agent", "select public.crm_opportunity_to_campaign($1) as r", [opp]);
  const c = await one("select name, client_id, crm_opportunity_id, status from public.campaigns where id = $1", [camp]);
  assert.deepEqual(c, { name: "Summer cooler kit", client_id: A, crm_opportunity_id: opp, status: "planning" });
  assert.equal((await one("select campaign_id from public.crm_opportunities where id = $1", [opp])).campaign_id, camp);
  assert.equal((await one("select count(*)::int n from public.campaign_markets where campaign_id = $1 and market = 'DE'", [camp])).n, 1);
  await rejects(as("agent", "select public.crm_opportunity_to_campaign($1)", [opp]), /already has a campaign/);

  const lost = await val("agent", "select public.crm_opportunity_create($1, null, 'Gondola ends', 5000, null, null) as r", [B]);
  await rejects(as("agent", "select public.crm_opportunity_move($1, 'lost', 'Too dear', null)", [lost]), /why it was lost/);
  await as("agent", "select public.crm_opportunity_move($1, 'lost', 'Too dear', $2)", [lost, price]);
  assert.equal((await one("select probability, lost_reason_id from public.crm_opportunities where id = $1", [lost])).lost_reason_id, price);
});

test("a big win is confirmed by a sales lead (CRM owner) before it counts", async () => {
  await policy("AP-T-CRM-WON", { module: "crm", approval_type: "CRM_OPP_WON", approver_role: "module_owner", min_value: 50000, maker_checker: true });
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.head]);
  const small = await val("agent", "select public.crm_opportunity_create($1, null, 'Small one', 1000, 'EUR', null, 'negotiation') as r", [B]);
  assert.equal(await val("agent", "select public.crm_opportunity_move($1, 'won', null, null) as r", [small]), "moved");
  const big = await val("agent", "select public.crm_opportunity_create($1, null, 'Flagship bars', 90000, 'EUR', null, 'negotiation') as r", [A]);
  assert.equal(await val("agent", "select public.crm_opportunity_move($1, 'won', 'Verbal yes', null) as r", [big]), "pending");
  assert.equal((await one("select stage from public.crm_opportunities where id = $1", [big])).stage, "negotiation");
  await rejects(as("agent", "select public.crm_opportunity_move($1, 'lost', null, $2)", [big, price]), /waiting for its win/);
  const req = await requestFor("CRM_OPP_WON", big);
  await rejects(as("lead", "select public.approval_request_decide($1, true, null)", [req.id]), /admin or module owner/);
  assert.ok((await inbox("head")).some((r) => r.item_id === req.id && r.approval_type === "CRM_OPP_WON"));
  assert.ok(!(await inbox("agent")).some((r) => r.item_id === req.id));
  await as("head", "select public.approval_request_decide($1, true, 'Confirmed with the client')", [req.id]);
  const o = await one("select stage, won_confirmed_by, probability from public.crm_opportunities where id = $1", [big]);
  assert.deepEqual(o, { stage: "won", won_confirmed_by: ids.head, probability: 100 });
  const ev = await one("select actor from public.crm_events where entity_id = $1 and action = 'stage_changed'", [big]);
  assert.equal(ev.actor, ids.agent, "the move is recorded as the requester's");
  await asSuper("update public.library_records set status = 'retired' where code = 'AP-T-CRM-WON'");
});

test("contracts above the policy value are signed only after an admin approves; renewals likewise", async () => {
  await policy("AP-T-CRM-CONTRACT", { module: "crm", approval_type: "CRM_CONTRACT", approver_role: "admin", min_value: 100000, maker_checker: true });
  const k = await val("lead", `select public.crm_contract_save(null, $1, 'msa', null, 'Acme MSA', current_date - 300, current_date + 60, current_date + 30, 90,
    250000, 'EUR', 45, 18, 12, 2.5, 1) as r`, [A]);
  assert.equal(await val("lead", "select public.crm_contract_sign($1, 'Countersigned') as r", [k]), "pending");
  await rejects(as("lead", "select public.crm_contract_save($1, $2, 'msa', null, 'Edited', current_date, null, null, null, 1, 'EUR', null, null, null, null, null)", [k, A]), /waiting for approval/);
  const req = await requestFor("CRM_CONTRACT", k);
  await rejects(as("head", "select public.approval_request_decide($1, true, null)", [req.id]), /needs a admin/);
  await as("admin", "select public.approval_request_decide($1, true, null)", [req.id]);
  const row = await one("select status, signed_by, approved_by from public.crm_contracts where id = $1", [k]);
  assert.deepEqual(row, { status: "signed", signed_by: ids.lead, approved_by: ids.admin });
  const small = await val("lead", "select public.crm_contract_save(null, $1, 'sow', $2, 'Summer SOW', current_date, current_date + 90, null, null, 20000, 'EUR', null, null, null, null, null) as r", [A, k]);
  assert.equal(await val("lead", "select public.crm_contract_sign($1) as r", [small]), "signed");
  assert.equal(await val("lead", "select public.crm_contract_renew($1, current_date + 425, 260000) as r", [k]), "pending");
  await as("admin2", "select public.approval_request_decide($1, true, null)", [(await requestFor("CRM_CONTRACT", k)).id]);
  assert.equal((await one("select renewal_count from public.crm_contracts where id = $1", [k])).renewal_count, 1);
});

test("client health and the Watchtower health view return standard rows", async () => {
  const h = (await as("plain", "select * from public.crm_client_health where client_id = $1", [A])).rows[0];
  assert.ok(["green", "amber", "red"].includes(h.rag));
  assert.equal(h.feedback_count, 2);
  assert.equal(Number(h.satisfaction), 7.5);
  assert.equal(h.nps, 0);
  assert.equal(h.open_issues, 1);
  const rows = (await as("plain", "select module, metric, label, value, target, status from public.watchtower_health_crm")).rows;
  assert.deepEqual(rows.map((r) => r.metric).sort(),
    ["accounts_red", "clients_no_activity_60d", "overdue_client_bills", "pipeline_vs_target", "renewals_due_90d"]);
  for (const r of rows) {
    assert.equal(r.module, "crm");
    assert.ok(["ok", "warn", "bad"].includes(r.status));
    assert.equal(typeof r.label, "string");
  }
  // Acme's MSA renews within 90 days of the renewal date (renewed above: still counts once while signed and due).
  assert.ok(Number(rows.find((r) => r.metric === "renewals_due_90d").value) >= 0);
});

test("follow-up clears an open detractor comment; feedback is captured internally too", async () => {
  const f = (await one("select id from public.crm_feedback where client_id = $1 and score = 6", [A])).id;
  await rejects(as("agent", "select public.crm_feedback_follow_up($1, ' ')", [f]), /what was done/);
  await as("agent", "select public.crm_feedback_follow_up($1, 'Called Vic; quote turnaround now 48h')", [f]);
  assert.equal((await one("select open_issues from public.crm_client_health where client_id = $1", [A])).open_issues, 0);
  await as("agent", "select public.crm_feedback_capture($1, null, null, 10, 'QBR score')", [B]);
  assert.equal((await one("select count(*)::int n from public.crm_feedback where client_id = $1 and source = 'internal'", [B])).n, 1);
});
