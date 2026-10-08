// Client Portal + External Reporting: client identity rule, account isolation, client-safe columns only,
// approver vs viewer decisions (recorded, internal confirms), append-only comments, internal-only read-only preview.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const U = {
  cA1: "00000000-0000-0000-0000-0000000000c1", // Acme approver
  cA2: "00000000-0000-0000-0000-0000000000c2", // Acme viewer
  cB1: "00000000-0000-0000-0000-0000000000c3", // Bolt approver
  nobody: "00000000-0000-0000-0000-0000000000c4", // external, no grant
};
Object.assign(ids, U);
for (const [id, email] of [[U.cA1, "ann@acme.example"], [U.cA2, "vic@acme.example"], [U.cB1, "bob@bolt.example"], [U.nobody, "nobody@else.example"]]) {
  await asSuper("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, JSON.stringify({ full_name: email.split("@")[0] })]);
}

// ---------- fixtures ----------
const one = async (sql, params) => (await asSuper(sql, params)).rows[0];
const A = (await one("insert into public.sourcing_clients (code, name) values ('TA', 'Acme (test)') returning id")).id;
const B = (await one("insert into public.sourcing_clients (code, name) values ('TB', 'Bolt Drinks') returning id")).id;
const S = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('T-SECRET', 'Secret Supplier Ltd', 'Germany', 'EMEA') returning id")).id;

async function job(client, title) {
  return (await one("insert into public.jobs (title, client_id, region, market, manager, currency) values ($1, $2, 'EMEA', 'Germany', $3, 'EUR') returning id", [title, client, ids.lead])).id;
}
async function estimate(jobId, status = "sent") {
  const spec = (await one("insert into public.job_specs (job_id, title, spec_type, region, market) values ($1, 'Header card', '2d', 'EMEA', 'Germany') returning id", [jobId])).id;
  const e = (await one(
    `insert into public.estimates (job_id, supplier_id, source, currency, base_cost, benchmark_value, pricing_mode, pricing_percent, savings_vs_benchmark, status, sent_at, region, market)
     values ($1, $2, 'adopt', 'EUR', 1000, 1100, 'markup', 20, 100, $3, now(), 'EMEA', 'Germany') returning id, sell_price`, [jobId, S, status])).id;
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1, $2, 100, 10, 1000)", [e, spec]);
  return e;
}
const jobA = await job(A, "Acme cooler kit");
const jobB = await job(B, "Bolt fridge wrap");
const estA = await estimate(jobA);
const estB = await estimate(jobB);

const campA = (await one("insert into public.campaigns (name, client, status) values ('Acme summer', '  ACME ', 'live') returning id, client_id"));
const briefA = (await one("insert into public.briefs (title, campaign_id, status, approval_status, approval_comments) values ('Acme gondola', $1, 'submitted', 'pending', 'INTERNAL NOTE') returning id, client_id", [campA.id]));
const briefB = (await one("insert into public.briefs (title, client, status) values ('Bolt chiller', 'tb', 'in_ideation') returning id, client_id"));
const draftA = (await one("insert into public.briefs (title, client, status) values ('Acme draft', 'Acme', 'draft') returning id"));
const tp = (await one("insert into public.library_records (library_key, code, name, status) values ('touchpoint_types', 'TP-T', 'Display', 'active') returning id")).id;
await asSuper("insert into public.siq_effectiveness (campaign_id, region, market, touchpoint_id, spend, execution_score) values ($1, 'EMEA', 'DE', $2, 500, 80)", [campA.id, tp]);

test("client identity: free-text client resolves by code or name (case-insensitive, trailing parenthetical ignored); briefs inherit the campaign", () => {
  assert.equal(campA.client_id, A);
  assert.equal(briefA.client_id, A);
  assert.equal(briefB.client_id, B);
});

test("only admins grant client access; staff and vendor-linked people can't be clients; grants are audited", async () => {
  await rejects(as("lead", "select public.client_access_grant($1, $2, 'approver')", [U.cA1, A]), /Only admins/);
  await rejects(as("admin", "select public.client_access_grant($1, $2, 'approver')", [ids.plain, A]), /staff/);
  await rejects(as("admin", "select public.client_access_grant($1, $2, 'owner')", [U.cA1, A]), /approver or viewer/);
  await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cA1, A]);
  await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [U.cA2, A]);
  await as("admin", "select public.client_access_grant($1, $2, 'approver')", [U.cB1, B]);
  const { rows } = await asSuper("select user_type from public.profiles where id = $1", [U.cA1]);
  assert.equal(rows[0].user_type, "client");
  const audit = await asSuper("select count(*)::int n from public.client_access_audit where action = 'granted'");
  assert.equal(audit.rows[0].n, 3);
  const n = await asSuper("select count(*)::int n from public.notifications where user_id = $1 and module = 'client'", [U.cA1]);
  assert.equal(n.rows[0].n, 1);
});

const rpc = async (user, fn, args = "") => (await as(user, `select public.${fn}(${args}) as r`)).rows[0].r;

test("client A sees only client A; client B only client B; another account id is refused", async () => {
  const ea = await rpc("cA1", "client_portal_estimates");
  assert.deepEqual(ea.map((e) => e.id), [estA]);
  const eb = await rpc("cB1", "client_portal_estimates");
  assert.deepEqual(eb.map((e) => e.id), [estB]);
  const ba = await rpc("cA1", "client_portal_briefs");
  assert.deepEqual(ba.map((b) => b.id), [briefA.id]); // drafts are never shown
  assert.ok(!ba.some((b) => b.id === draftA.id));
  assert.equal((await rpc("cA1", "client_portal_campaigns")).length, 1);
  assert.equal((await rpc("cB1", "client_portal_campaigns")).length, 0);
  assert.equal((await rpc("cA1", "client_portal_effectiveness")).length, 1);
  assert.equal((await rpc("cB1", "client_portal_effectiveness")).length, 0);
  await rejects(as("cA1", "select public.client_portal_estimates($1)", [B]), /do not have access/);
  const other = await as("cA1", "select public.client_portal_estimate($1) as r", [estB]);
  assert.equal(other.rows[0].r, null);
  const otherBrief = await as("cA1", "select public.client_portal_brief($1) as r", [briefB.id]);
  assert.equal(otherBrief.rows[0].r, null);
  // Direct table reads return nothing for clients.
  for (const tbl of ["estimates", "estimate_lines", "jobs", "purchase_orders", "briefs", "campaigns", "suppliers", "siq_effectiveness", "sourcing_clients"]) {
    const { rows } = await as("cA1", `select count(*)::int n from public.${tbl}`);
    assert.equal(rows[0].n, 0, `${tbl} should be empty for a client`);
  }
});

const FORBIDDEN = /supplier|cost|margin|markup|pricing|benchmark|(^|_)nti($|_)|notes|approval_comments|reviewed_by|created_by|selection_reason|doa/i;
function keysDeep(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

test("clients never see supplier, cost, margin or internal-note fields", async () => {
  const outputs = [
    await rpc("cA1", "client_portal_summary"), await rpc("cA1", "client_portal_campaigns"), await rpc("cA1", "client_portal_briefs"),
    (await as("cA1", "select public.client_portal_brief($1) as r", [briefA.id])).rows[0].r,
    await rpc("cA1", "client_portal_estimates"), (await as("cA1", "select public.client_portal_estimate($1) as r", [estA])).rows[0].r,
    await rpc("cA1", "client_portal_orders"), await rpc("cA1", "client_portal_effectiveness"), await rpc("cA1", "client_portal_report"),
    await rpc("cA1", "client_portal_accounts"),
  ];
  const text = JSON.stringify(outputs);
  assert.ok(!text.includes("Secret Supplier"), "supplier name leaked");
  assert.ok(!text.includes("INTERNAL NOTE"), "internal note leaked");
  const bad = keysDeep(outputs).filter((k) => FORBIDDEN.test(k));
  assert.deepEqual([...new Set(bad)], []);
  const est = outputs[5];
  assert.equal(Number(est.sell_price), 1200);
  assert.equal(Number(est.lines[0].unit_sell), 12);
});

test("viewers can't decide; approvers record a decision once; the estimate waits for internal confirmation", async () => {
  await rejects(as("cA2", "select public.client_estimate_decide($1, true, 'ok')", [estA]), /Only approvers/);
  await rejects(as("cA1", "select public.client_estimate_decide($1, true, 'ok')", [estB]), /not found/i);
  await rejects(as("cA1", "select public.client_estimate_decide($1, false, '')", [estA]), /why/);
  await as("cA1", "select public.client_estimate_decide($1, true, 'Looks good', 'PO-77')", [estA]);
  await rejects(as("cA1", "select public.client_estimate_decide($1, true, null)", [estA]), /already/);
  const { rows: [e] } = await asSuper("select status from public.estimates where id = $1", [estA]);
  assert.equal(e.status, "sent"); // estimate_approve needs an internal caller: not bypassed
  const n = await asSuper("select count(*)::int n from public.notifications where user_id = $1 and module = 'orders'", [ids.lead]);
  assert.equal(n.rows[0].n, 1);
  const ev = await asSuper("select count(*)::int n from public.sourcing_events where entity_id = $1 and event = 'client_approved'", [estA]);
  assert.equal(ev.rows[0].n, 1);
  const list = await rpc("cA1", "client_portal_estimates");
  assert.equal(list[0].decision.decision, "approve");
  await rejects(as("cA1", "update public.client_decisions set decision = 'decline'"), /permission denied/);
  // Internal staff confirm through the existing path.
  await as("lead", "select public.estimate_approve($1, 'PO-77')", [estA]);
  const report = await rpc("cA1", "client_portal_report");
  assert.equal(Number(report.by_market[0].spend), 1200);
  const sum = await rpc("cA1", "client_portal_summary");
  assert.equal(Number(sum.spend_ytd[0].amount), 1200);
});

test("brief comments: own briefs only, append-only, visible to internal staff only through the internal function", async () => {
  await as("cA1", "select public.client_brief_comment($1, 'Can we see a render?')", [briefA.id]);
  await rejects(as("cA1", "select public.client_brief_comment($1, 'hello')", [briefB.id]), /not found/i);
  await rejects(as("cA1", "select public.client_brief_comment($1, 'hello')", [draftA.id]), /not found/i);
  await rejects(as("cA1", "select public.client_brief_comment($1, '   ')", [briefA.id]), /Write a comment/);
  await rejects(as("cA1", "update public.client_comments set body = 'changed'"), /permission denied/);
  await rejects(as("cA1", "delete from public.client_comments"), /permission denied/);
  await rejects(as("admin", "update public.client_comments set body = 'changed'"), /permission denied/);
  await rejects(asSuper("update public.client_comments set body = 'changed'"), /append-only/);
  const internal = await as("plain", "select public.client_comments_for_brief($1) as r", [briefA.id]);
  assert.equal(internal.rows[0].r.length, 1);
  await rejects(as("cA1", "select public.client_comments_for_brief($1)", [briefA.id]), /Internal users only/);
  const mine = await as("cA1", "select public.client_portal_brief($1) as r", [briefA.id]);
  assert.equal(mine.rows[0].r.comments[0].body, "Can we see a render?");
  const theirs = await as("cB1", "select count(*)::int n from public.client_comments");
  assert.equal(theirs.rows[0].n, 0);
});

test("preview is internal-only and read-only", async () => {
  const s = await as("plain", "select public.client_portal_summary($1) as r", [A]);
  assert.equal(Number(s.rows[0].r.live_campaigns), 1);
  const acc = await as("plain", "select public.client_portal_accounts($1) as r", [A]);
  assert.equal(acc.rows[0].r[0].role, "preview");
  await rejects(as("plain", "select public.client_portal_summary()"), /Choose a client/);
  await rejects(as("plain", "select public.client_estimate_decide($1, true, null)", [estB]), /read-only/);
  await rejects(as("admin", "select public.client_brief_comment($1, 'hi')", [briefB.id]), /read-only/);
  // An external person without a grant, or a client naming another account, can't preview anything.
  await rejects(as("nobody", "select public.client_portal_summary($1)", [A]), /do not have access/);
  await rejects(as("cB1", "select public.client_portal_estimates($1)", [A]), /do not have access/);
  const empty = await rpc("nobody", "client_portal_estimates");
  assert.deepEqual(empty, []);
});

test("revoking access removes the account immediately; backfill is admin-only", async () => {
  await rejects(as("lead", "select public.client_access_revoke($1, $2)", [U.cA2, A]), /Only admins/);
  await as("admin", "select public.client_access_revoke($1, $2)", [U.cA2, A]);
  assert.deepEqual(await rpc("cA2", "client_portal_estimates"), []);
  await rejects(as("admin", "select public.client_access_revoke($1, $2)", [U.cA2, A]), /no access/);
  await rejects(as("lead", "select public.client_link_backfill()"), /Only admins/);
  const r = await rpc("admin", "client_link_backfill");
  assert.equal(typeof r.briefs_unmatched, "number");
  const ov = await rpc("plain", "client_access_overview");
  assert.equal(ov.grants.length, 2);
  await rejects(as("cA1", "select public.client_access_overview()"), /Internal users only/);
});
