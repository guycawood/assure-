// Supplier Engagement layer (vendor portal + public application): isolation between vendors, decision fields the
// vendor can never write, team permissions, sites, contract signing from the portal, and the public application.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { db, as, asSuper, rejects, ids } = t;

const VA = "00000000-0000-0000-0000-0000000000c1"; // vendor A admin (primary contact)
const VB = "00000000-0000-0000-0000-0000000000c2"; // vendor B admin (primary contact)
const PROC = "00000000-0000-0000-0000-0000000000c3";
const VA_STD = "00000000-0000-0000-0000-0000000000c4"; // vendor A colleague, standard
const VA_VIEW = "00000000-0000-0000-0000-0000000000c5"; // vendor A colleague, viewer

const { rows: [a] } = await asSuper(
  "insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('VT-A','Alpha Print','Poland','EMEA','BAU','Print','va@alpha.example') returning id");
const { rows: [b] } = await asSuper(
  "insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('VT-B','Beta Displays','Germany','EMEA','BAU','POSM','vb@beta.example') returning id");
const SA = a.id, SB = b.id;
await asSuper("insert into auth.users (id, email) values ($1,'va@alpha.example'), ($2,'vb@beta.example'), ($3,'proc2@adm-indicia.com')", [VA, VB, PROC]);
await asSuper("update public.profiles set srt_role = 'procurement' where id = $1", [PROC]);
Object.assign(ids, { va: VA, vb: VB, proc: PROC, vastd: VA_STD, vaview: VA_VIEW });

const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];
async function asAnon(sql, params) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}
const site = (name, extra = {}) => JSON.stringify({ name, site_type: "manufacturing", country_alpha2: "PL", ...extra });

test("vendors are linked and see only their own company", async () => {
  const c = await as("va", "select id, name, my_permission from public.vendor_my_company");
  assert.equal(c.rows.length, 1);
  assert.deepEqual([c.rows[0].id, c.rows[0].my_permission], [SA, "admin"]);
  assert.equal((await one("vb", "select id from public.vendor_my_company")).id, SB);
  assert.equal((await as("agent", "select * from public.vendor_my_company")).rows.length, 0);
});

test("team: only portal admins invite; invited emails link on first sign-in with their level", async () => {
  await rejects(as("va", "select public.vendor_team_invite('someone@adm-indicia.com','standard')"), /staff can't be added/);
  await rejects(as("va", "select public.vendor_team_invite('not-an-email','standard')"), /valid email/);
  await rejects(as("va", "select public.vendor_team_invite('x@alpha.example','owner')"), /admin, standard or viewer/);
  await as("va", "select public.vendor_team_invite('std@alpha.example','standard')");
  await as("va", "select public.vendor_team_invite('view@alpha.example','viewer')");
  await rejects(as("va", "select public.vendor_team_invite('std@alpha.example','viewer')"), /already on your team/);
  // Vendor B can't poach someone on A's team.
  await rejects(as("vb", "select public.vendor_team_invite('std@alpha.example','standard')"), /another company/);
  // Internal staff are not vendor admins.
  await rejects(as("admin", "select public.vendor_team_invite('z@alpha.example','standard')"), /Only a vendor user/);

  await asSuper("insert into auth.users (id, email) values ($1,'std@alpha.example'), ($2,'view@alpha.example')", [VA_STD, VA_VIEW]);
  assert.equal((await one("vastd", "select supplier_id from public.profiles where id = auth.uid()")).supplier_id, SA);
  assert.equal((await one("vastd", "select public.vendor_my_permission() p")).p, "standard");
  assert.equal((await one("vaview", "select public.vendor_my_permission() p")).p, "viewer");

  // Standard and viewer users can't manage the team.
  await rejects(as("vastd", "select public.vendor_team_invite('more@alpha.example','viewer')"), /portal admins/);
  await rejects(as("vaview", "select public.vendor_team_invite('more@alpha.example','viewer')"), /portal admins/);

  // The team list is per company, and the raw invitations table is staff-only.
  assert.equal((await as("va", "select * from public.vendor_team_members")).rows.length, 2);
  assert.equal((await as("vb", "select * from public.vendor_team_members")).rows.length, 0);
  assert.equal((await as("va", "select * from public.supplier_team_members")).rows.length, 0);
});

test("team: admin changes access and removes people; removal ends access", async () => {
  const m = await one("va", "select id from public.vendor_team_members where email = 'view@alpha.example'");
  await rejects(as("vb", "select public.vendor_team_set_level($1,'admin')", [m.id]), /not found/);
  await rejects(as("vastd", "select public.vendor_team_set_level($1,'admin')", [m.id]), /portal admins/);
  await as("va", "select public.vendor_team_set_level($1,'standard')", [m.id]);
  assert.equal((await one("vaview", "select public.vendor_my_permission() p")).p, "standard");
  await as("va", "select public.vendor_team_set_level($1,'viewer')", [m.id]);
  await as("va", "select public.vendor_team_remove($1)", [m.id]);
  assert.equal((await one("vaview", "select supplier_id from public.profiles where id = auth.uid()")).supplier_id, null);
  assert.equal((await as("vaview", "select * from public.vendor_my_company")).rows.length, 0);
  // Re-invite as viewer for the next tests.
  await as("va", "select public.vendor_team_invite('view@alpha.example','viewer')");
  assert.equal((await one("vaview", "select public.vendor_my_permission() p")).p, "viewer");
  // Nobody can make themselves admin by writing the table.
  const r = await as("vaview", "update public.supplier_team_members set permission_level = 'admin' returning id");
  assert.equal(r.rows.length, 0);
  assert.equal((await one("vaview", "select public.vendor_my_permission() p")).p, "viewer");
});

test("sites: vendor-owned, one default dispatch site enforced, viewers read-only, other vendors locked out", async () => {
  const s1 = (await one("va", "select public.vendor_site_save(null, $1::jsonb) id", [site("Poznań works", { is_default_dispatch: true, locode: "PLPOZ" })])).id;
  const s2 = (await one("vastd", "select public.vendor_site_save(null, $1::jsonb) id", [site("Gdańsk store", { site_type: "warehouse", is_default_dispatch: true })])).id;
  const defaults = await as("va", "select id from public.supplier_sites where is_default_dispatch");
  assert.deepEqual(defaults.rows.map((r) => r.id), [s2]);
  await as("va", "select public.vendor_site_set_default($1)", [s1]);
  assert.deepEqual((await as("va", "select id from public.supplier_sites where is_default_dispatch")).rows.map((r) => r.id), [s1]);
  await rejects(as("vaview", "select public.vendor_site_save(null, $1::jsonb)", [site("Nope")]), /view-only/);
  await rejects(as("va", "select public.vendor_site_save(null, $1::jsonb)", [site("Bad", { site_type: "castle" })]), /check constraint|violates/);
  await rejects(as("va", "select public.vendor_site_save(null, $1::jsonb)", [site("Bad", { locode: "DEBER" })]), /check constraint|violates/);
  await rejects(as("vb", "select public.vendor_site_set_default($1)", [s1]), /not found/);
  await rejects(as("vb", "select public.vendor_site_archive($1)", [s1]), /not found/);
  assert.equal((await as("vb", "select * from public.supplier_sites")).rows.length, 0);
  await rejects(as("va", "insert into public.supplier_sites (supplier_id, name, site_type, country_alpha2) values ($1,'x','office','DE')", [SB]), /permission denied/);
  // A second default can't exist even when written directly by the system.
  await rejects(asSuper("insert into public.supplier_sites (supplier_id, name, site_type, country_alpha2, is_default_dispatch) values ($1,'x','office','PL',true)", [SA]), /duplicate key/);
});

test("subscription: vendors request, never set; procurement sets with a reason", async () => {
  await rejects(as("va", "insert into public.supplier_subscriptions (supplier_id, tier, status) values ($1,'diamond','active')", [SA]), /permission denied/);
  await rejects(as("va", "select public.assure_set_subscription($1,'diamond','active',null,'me')", [SA]), /Only adm Indicia staff/);
  await rejects(as("agent", "select public.assure_set_subscription($1,'diamond','active',null,'x')", [SA]), /Only procurement/);
  // Vendors can't change their own supplier record (tier, status, scores).
  const u = await as("va", "update public.suppliers set tier = 'strategic', status = 'active', rag = 'green' where id = $1 returning id", [SA]);
  assert.equal(u.rows.length, 0);
  const s = await one("admin", "select tier, status, rag from public.suppliers where id = $1", [SA]);
  assert.notEqual(s.tier, "strategic");

  await rejects(as("vastd", "select public.vendor_request_subscription('gold','pls')"), /portal admins/);
  await as("va", "select public.vendor_request_subscription('gold','We want quarterly reviews')");
  await rejects(as("va", "select public.vendor_request_subscription('platinum',null)"), /already have a plan change request/);
  const n = await one("proc", "select count(*)::int n from public.notifications where user_id = auth.uid() and title like 'Plan change request%'");
  assert.equal(n.n, 1);
  assert.equal((await as("vb", "select * from public.subscription_requests")).rows.length, 0);
  assert.equal((await as("va", "select * from public.subscription_requests")).rows.length, 1);

  await rejects(as("proc", "select public.assure_set_subscription($1,'gold','active',null,'')", [SA]), /reason/);
  await as("proc", "select public.assure_set_subscription($1,'gold','active',current_date + 365,'Signed order form')", [SA]);
  const c = await one("va", "select subscription_tier, subscription_status from public.vendor_my_company");
  assert.deepEqual([c.subscription_tier, c.subscription_status], ["gold", "active"]);
  assert.equal((await one("va", "select status from public.subscription_requests")).status, "actioned");
  assert.equal((await one("vb", "select subscription_status from public.vendor_my_company")).subscription_status, "none");
});

test("contracts: vendor signs in order for its own company only, then adm Indicia completes", async () => {
  // Fixture written as the system (status and parties are normally set by assure_contract_action).
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('assure.system_write','on',false);");
  const cid = (await db.query("insert into public.contracts (contract_ref, supplier_id, title, status, sent_at) values ('CT-T-1', $1, 'Supply deal', 'sent', now()) returning id", [SA])).rows[0].id;
  await db.query("insert into public.contract_parties (contract_id, name, email, role, signing_order, is_internal, status) values ($1,'Std','std@alpha.example','signer',1,false,'sent'), ($1,'VA','va@alpha.example','signer',2,false,'sent'), ($1,'Hana','head@adm-indicia.com','signer',3,true,'sent')", [cid]);
  await db.exec("select set_config('assure.system_write','off',false);");
  const parties = (await as("va", "select id, email from public.vendor_contract_parties where contract_id = $1 order by signing_order", [cid])).rows;
  assert.equal(parties.length, 3);
  const [pStd, pVa, pInt] = parties.map((p) => p.id);
  assert.equal((await as("vb", "select * from public.vendor_contracts")).rows.length, 0);
  await rejects(as("vb", "select public.vendor_contract_sign($1,'sign',null)", [pStd]), /not found/);
  await rejects(as("vaview", "select public.vendor_contract_sign($1,'sign',null)", [pStd]), /view-only/);
  await rejects(as("va", "select public.vendor_contract_sign($1,'sign',null)", [pVa]), /Earlier signers/);
  await rejects(as("vastd", "select public.vendor_contract_sign($1,'sign',null)", [pInt]), /adm Indicia signs/);
  await as("vastd", "select public.vendor_contract_open($1)", [cid]);
  assert.equal((await one("va", "select status from public.vendor_contracts where id = $1", [cid])).status, "viewed");
  await as("vastd", "select public.vendor_contract_sign($1,'sign',null)", [pStd]);
  await rejects(as("vastd", "select public.vendor_contract_sign($1,'sign',null)", [pVa]), /Only va@alpha.example/);
  await as("va", "select public.vendor_contract_comment($1,'Signed, thanks')", [cid]);
  await as("va", "select public.vendor_contract_sign($1,'sign',null)", [pVa]);
  assert.equal((await one("va", "select status from public.vendor_contracts where id = $1", [cid])).status, "viewed");
  await as("admin", "select public.assure_contract_sign($1,'DocuSign ref 123')", [pInt]);
  assert.equal((await one("va", "select status from public.vendor_contracts where id = $1", [cid])).status, "counter_signed");
  const act = await as("va", "select event_type, from_vendor from public.vendor_contract_activity where contract_id = $1", [cid]);
  assert.ok(act.rows.some((r) => r.event_type === "commented" && r.from_vendor));
  assert.equal((await as("vb", "select * from public.vendor_contract_activity")).rows.length, 0);
});

test("action plans: vendor adds its own actions; viewers can't; staff still verify", async () => {
  const id = (await one("vastd", "select public.vendor_task_add('Retrain press crew', null, 'quality', 'high', current_date + 10) id")).id;
  await rejects(as("vaview", "select public.vendor_task_add('x', null, 'quality', 'high', null)"), /view-only/);
  await rejects(as("vastd", "select public.vendor_task_add('x', null, 'quality', 'high', current_date - 1)"), /past/);
  const r = await one("va", "select supplier_id, status from public.action_plan_tasks where id = $1", [id]);
  assert.deepEqual([r.supplier_id, r.status], [SA, "open"]);
  assert.equal((await as("vb", "select * from public.action_plan_tasks where id = $1", [id])).rows.length, 0);
  await as("vastd", "select public.assure_task_set_status($1,'completed','Done')", [id]);
  await rejects(as("va", "select public.assure_task_set_status($1,'verified',null)", [id]), /Only adm Indicia staff/);
});

test("orders: PO detail and the document library are vendor-scoped", async () => {
  await rejects(as("va", "select public.vendor_po_detail(gen_random_uuid())"), /not found/);
  await rejects(as("admin", "select public.vendor_po_detail(gen_random_uuid())"), /not found/);
  await asSuper("insert into public.library_records (library_key, code, name, data, status) values ('order_document_types','T-INV','Invoice','{\"required_for_categories\":[\"print\"]}','active')");
  assert.ok((await as("va", "select * from public.vendor_order_document_types")).rows.length >= 1);
  assert.equal((await asAnon("select count(*)::int n from public.vendor_order_document_types").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n, 0);
});

test("public application: anonymous, validated, honeypot, duplicates and notifications", async () => {
  const good = ["Gamma Packaging", "Gia Gamma", "gia@gamma.example", "Italy", "Packaging", JSON.stringify({ supplier: { total_employees: "50" } }), ""];
  const ref = (await asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7) r", good)).rows[0].r;
  assert.match(ref, /^APP-\d{4}-\d{5}$/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", good), /already have an application/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", ["G", ...good.slice(1)]), /company name/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", ["Delta", "Dee", "bad-email", null, null, "{}", ""]), /valid email/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", ["Delta", "Dee", "d@delta.example", null, "Rockets", "{}", ""]), /category/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", ["Delta", "Dee", "d@delta.example", null, null, JSON.stringify({ x: "y".repeat(41000) }), ""]), /too long/);
  await rejects(asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7)", ["Delta", "Dee", "d@delta.example", null, null, "[1,2]", ""]), /Invalid application/);

  const before = (await asSuper("select count(*)::int n from public.vendor_applications")).rows[0].n;
  const bot = (await asAnon("select public.vendor_apply($1,$2,$3,$4,$5,$6::jsonb,$7) r", ["Spam Co", "Bot", "bot@spam.example", null, null, "{}", "http://spam"])).rows[0].r;
  assert.match(bot, /RECEIVED/);
  assert.equal((await asSuper("select count(*)::int n from public.vendor_applications")).rows[0].n, before);

  // Anonymous visitors and vendors can't read applications or write the table directly.
  await rejects(asAnon("select * from public.vendor_applications"), /permission denied/);
  assert.equal((await as("va", "select * from public.vendor_applications")).rows.length, 0);
  await rejects(as("va", "insert into public.vendor_applications (application_ref, company_name, contact_name, contact_email) values ('X','Xx','Xx','x@x.example')"), /permission denied/);
  await rejects(asAnon("select public.vendor_team_invite('a@b.example','admin')"), /permission denied/);
  assert.equal((await as("proc", "select count(*)::int n from public.vendor_applications")).rows[0].n, before);
  const n = await one("proc", "select count(*)::int n from public.notifications where user_id = auth.uid() and title like 'New vendor application%'");
  assert.equal(n.n, 1);

  // Staff review it.
  const id = (await one("proc", "select id from public.vendor_applications where application_ref = $1", [ref])).id;
  await rejects(as("va", "select public.vendor_application_decide($1,'invited',null)", [id]), /Only adm Indicia staff/);
  await rejects(as("proc", "select public.vendor_application_decide($1,'rejected','')", [id]), /reason/);
  await as("proc", "select public.vendor_application_decide($1,'reviewing',null)", [id]);
});
