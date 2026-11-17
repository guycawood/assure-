// Vendor-side roles: company admin, profile manager, finance contact, performance lead, compliance / ESG.
// No role chosen keeps full access at the person's level; once roles are chosen the person acts only in those areas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { prim: "00000000-0000-0000-0000-0000000001f1", adm: "00000000-0000-0000-0000-0000000001f2", fin: "00000000-0000-0000-0000-0000000001f3",
  prof: "00000000-0000-0000-0000-0000000001f4", plain: "00000000-0000-0000-0000-0000000001f5" };
const sup = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('VR-A','Role Co','Germany','EMEA','prim@role.example') returning id")).rows[0].id;
await asSuper("insert into auth.users (id, email) values ($1,'prim@role.example')", [U.prim]);
Object.assign(ids, U);
const invite = async (key, level) => {
  const email = `${key}@role.example`;
  const id = (await as("prim", "select public.vendor_team_invite($1,$2) as id", [email, level])).rows[0].id;
  await asSuper("insert into auth.users (id, email) values ($1,$2)", [U[key], email]);
  return id;
};
const can = async (u, area) => (await as(u, "select public.vendor_can($1) c", [area])).rows[0].c;
const m = {};
m.adm = await invite("adm", "admin"); m.fin = await invite("fin", "standard"); m.prof = await invite("prof", "standard"); m.plain = await invite("plain", "standard");
const site = JSON.stringify({ name: "Plant 1", site_type: "manufacturing", country_alpha2: "DE" });

test("with no role chosen a person keeps full access at their level", async () => {
  for (const a of ["profile", "finance", "performance", "compliance"]) assert.equal(await can("plain", a), true, a);
  assert.equal(await can("plain", "team"), true);                                            // legacy; the level check still stops a non-admin
  await rejects(as("plain", "select public.vendor_team_invite('x@role.example','viewer')"), /portal admins/);
  assert.deepEqual((await as("plain", "select public.vendor_my_roles() r")).rows[0].r, []);
});

test("only team managers set roles, not on themselves, and only from the five", async () => {
  await rejects(as("plain", "select public.vendor_team_set_roles($1,'{finance_contact}')", [m.fin]), /portal admins/);
  await rejects(as("prim", "select public.vendor_team_set_roles($1,'{owner}')", [m.fin]), /five roles/);
  await as("prim", "select public.vendor_team_set_roles($1,'{finance_contact}')", [m.fin]);
  await as("prim", "select public.vendor_team_set_roles($1,'{company_admin}')", [m.adm]);
  await as("prim", "select public.vendor_team_set_roles($1,'{profile_manager,compliance_esg}')", [m.prof]);
  await rejects(as("adm", "select public.vendor_team_set_roles($1,'{finance_contact}')", [m.adm]), /own roles/);
  const list = (await as("prim", "select email, functional_roles from public.vendor_team_members where email like 'fin@%'")).rows[0];
  assert.deepEqual(list.functional_roles, ["finance_contact"]);
});

test("the company admin role manages the team but gets no financial access", async () => {
  assert.deepEqual([await can("adm", "team"), await can("adm", "profile"), await can("adm", "finance"), await can("adm", "performance")], [true, true, false, false]);
  await rejects(as("adm", "select public.finance_vendor_submit_invoice('00000000-0000-0000-0000-000000000001','INV-1',current_date,100,0,'EUR',null)"), /finance contact/);
  await as("adm", "select public.vendor_team_invite('new@role.example','viewer')");          // can run the team
  assert.equal((await as("adm", "select public.vendor_my_roles() r")).rows[0].r[0], "company_admin");
});

test("the finance contact reaches invoices but not the team or profile; the profile manager the reverse", async () => {
  assert.deepEqual([await can("fin", "finance"), await can("fin", "profile"), await can("fin", "compliance")], [true, false, false]);
  await rejects(as("fin", "select public.vendor_site_save(null, $1::jsonb)", [site]), /profile manager/);
  await rejects(as("fin", "select public.vendor_team_invite('y@role.example','viewer')"), /portal admins/);
  const err = await as("fin", "select public.finance_vendor_submit_invoice('00000000-0000-0000-0000-000000000001','INV-2',current_date,100,0,'EUR',null)").then(() => "", (e) => e.message);
  assert.doesNotMatch(err, /finance contact/);                                                // past the role check; fails later on the missing order
  assert.deepEqual([await can("prof", "profile"), await can("prof", "compliance"), await can("prof", "finance")], [true, true, false]);
  await as("prof", "select public.vendor_site_save(null, $1::jsonb)", [site]);
  await rejects(as("prof", "select public.finance_vendor_submit_invoice('00000000-0000-0000-0000-000000000001','INV-3',current_date,100,0,'EUR',null)"), /finance contact/);
});

test("performance and compliance roles are enforced on their actions; staff are unaffected", async () => {
  const ct = (await asSuper("insert into public.library_records (library_key, code, name, status) values ('certification_types','T_VR','Role cert','active') returning id")).rows[0].id;
  const cert = (who) => as(who, "select public.assure_vendor_add_certificate($1,'C-9','SGS',null,current_date + 200,'files/x') as id", [ct]);
  const doc = (who) => as(who, "insert into public.supplier_documents (supplier_id, doc_type, title, file_path) values ($1,'policy','Policy','files/x')", [sup]);
  // prof has profile_manager + compliance_esg; fin has finance_contact; adm has company_admin
  await cert("prof"); await doc("prof");
  await rejects(cert("fin"), /compliance \/ ESG role/);
  await rejects(doc("adm"), /compliance \/ ESG role/);
  await rejects(as("prof", "select public.assure_review_vendor_respond('00000000-0000-0000-0000-000000000001','accept',null,null)"), /performance lead role/);
  await rejects(as("fin", "select public.assure_ncr_vendor_respond('00000000-0000-0000-0000-000000000001','acknowledge',null,null)"), /performance lead role/);
  const past = async (who, fn) => (await as(who, fn).then(() => "", (e) => e.message));
  assert.doesNotMatch(await past("plain", "select public.assure_ncr_vendor_respond('00000000-0000-0000-0000-000000000001','acknowledge',null,null)"), /performance lead role/);   // performance_lead
  assert.doesNotMatch(await past("plain", "select public.assure_issue_vendor_respond('00000000-0000-0000-0000-000000000001','acknowledge',null,null,null)"), /performance lead role/);
  assert.doesNotMatch(await past("agent", "select public.assure_ca_set_status('00000000-0000-0000-0000-000000000001','done',null)"), /role/);                    // staff skip the role check
  await rejects(as("agent", "select public.assure_ncr_vendor_respond('00000000-0000-0000-0000-000000000001','acknowledge',null,null)"), /Only a vendor user/);
});

test("the primary contact always keeps team management, and staff are never vendor users", async () => {
  await as("prim", "select public.vendor_team_set_roles($1,'{performance_lead}')", [m.plain]);
  assert.equal(await can("plain", "performance"), true);
  assert.equal(await can("plain", "finance"), false);
  assert.equal(await can("prim", "team"), true);
  assert.equal((await as("admin", "select public.vendor_can('team') c")).rows[0].c, false);
});
