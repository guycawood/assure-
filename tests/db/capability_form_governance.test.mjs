// Capability form governance: the capability, machine and tooling entry forms get extra questions through versioned, jointly approved changes,
// and each saved entry keeps the question text and the answer it was saved with.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { cpo: "00000000-0000-0000-0000-0000000001a5", sus: "00000000-0000-0000-0000-0000000001a6", vend: "00000000-0000-0000-0000-0000000001a7" };
Object.assign(ids, U);
const sup = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('CF-A','Cap Form Co','Germany','EMEA','v@capform.example') returning id")).rows[0].id;
for (const [k, id] of Object.entries(U)) await asSuper("insert into auth.users (id, email) values ($1,$2)", [id, k === "vend" ? "v@capform.example" : `${k}@adm-indicia.com`]);
await as("admin", "select public.division_role_assign($1,'assure','cpo',null)", [U.cpo]);
await as("admin", "select public.division_role_assign($1,'assure','sustainability',null)", [U.sus]);
const proc = (await asSuper("select id from public.library_records where library_key = 'srm_processes' and status = 'active' limit 1")).rows[0].id;
const mtype = (await asSuper("select id from public.library_records where library_key = 'srm_machine_types' and status = 'active' limit 1")).rows[0].id;
const ttype = (await asSuper("select id from public.library_records where library_key = 'srm_tooling_types' and status = 'active' limit 1")).rows[0].id;
const Q = [{ id: "recycled_pct", text: "What share of your input is recycled material?", type: "single_choice", options: ["None", "Under 25%", "25% or more"], required: true },
  { id: "energy_src", text: "Is the plant powered by renewable energy?", type: "yes_no", required: false }];
const publish = async (form, questions) => {
  const id = (await as("admin", "select public.form_draft_save($1,$2::jsonb,'Add sustainability questions') as id", [form, JSON.stringify(questions)])).rows[0].id;
  const ap = (await as("admin", "select public.form_propose($1) as id", [id])).rows[0].id;
  await as("cpo", "select public.joint_approval_sign($1,true,null)", [ap]);
  await as("sus", "select public.joint_approval_sign($1,true,null)", [ap]);
};

test("each entry form starts at version 1 with no extra questions", async () => {
  for (const form of ["capability", "machine", "tooling"]) {
    const l = (await as("admin", "select public.form_versions_list($1) as l", [form])).rows[0].l;
    assert.deepEqual([l.length, l[0].version, l[0].status, l[0].questions.length], [1, 1, "published", 0]);
  }
  assert.deepEqual((await as("admin", "select public.form_versions_list('invoice') as l")).rows[0].l, []);                   // there is no such form
  await rejects(as("admin", "select public.form_draft_save('invoice', '[]'::jsonb, null)"), /./);
});

test("with no extra questions, entries save as before", async () => {
  const id = (await as("admin", "select public.srm_capability_save('capability', null, $1, $2::jsonb) as id", [sup, JSON.stringify({ process_id: proc, lead_time_days: "10" })])).rows[0].id;
  const row = (await asSuper("select custom, custom_form_version from public.supplier_capabilities where id = $1", [id])).rows[0];
  assert.deepEqual([row.custom, row.custom_form_version], [{}, null]);
});

test("a capability form change goes live only after both signatures, and the sign-off names the form", async () => {
  const id = (await as("admin", "select public.form_draft_save('capability', $1::jsonb, 'Add sustainability questions') as id", [JSON.stringify(Q)])).rows[0].id;
  const ap = (await as("admin", "select public.form_propose($1) as id", [id])).rows[0].id;
  assert.match((await asSuper("select summary from public.joint_approvals where id = $1", [ap])).rows[0].summary, /^Capability form version 2: 2 added/);
  assert.equal((await as("vend", "select public.vendor_form_questions('capability') as q")).rows[0].q.questions.length, 0);
  await as("cpo", "select public.joint_approval_sign($1,true,null)", [ap]);
  assert.equal((await as("vend", "select public.vendor_form_questions('capability') as q")).rows[0].q.questions.length, 0);
  await as("sus", "select public.joint_approval_sign($1,true,null)", [ap]);
  const live = (await as("vend", "select public.vendor_form_questions('capability') as q")).rows[0].q;
  assert.deepEqual([live.version, live.questions.length], [2, 2]);
  assert.equal((await as("vend", "select public.vendor_form_questions('machine') as q")).rows[0].q.version, 1);              // other forms are unaffected
});

test("entries must answer the required questions, answers are checked, and each entry keeps the question text it was saved with", async () => {
  const save = (who, custom, extra = {}) => as(who, "select public.srm_capability_save('capability', null, $1, $2::jsonb) as id", [sup, JSON.stringify({ process_id: proc, custom, ...extra })]);
  await rejects(save("vend", {}), /Answer: What share of your input is recycled/);
  await rejects(save("vend", { recycled_pct: "Most of it" }), /Choose one of the options/);
  await rejects(save("vend", { recycled_pct: "None", energy_src: "Maybe" }), /Answer Yes or No/);
  assert.equal((await asSuper("select count(*)::int n from public.supplier_capabilities where supplier_id = $1", [sup])).rows[0].n, 1);   // nothing half-saved
  const id = (await save("vend", { recycled_pct: "Under 25%", energy_src: "Yes", made_up: "ignored" })).rows[0].id;
  const row = (await asSuper("select custom, custom_form_version, evidence_status from public.supplier_capabilities where id = $1", [id])).rows[0];
  assert.deepEqual(row.custom, { recycled_pct: { text: "What share of your input is recycled material?", value: "Under 25%" }, energy_src: { text: "Is the plant powered by renewable energy?", value: "Yes" } });
  assert.deepEqual([row.custom_form_version, row.evidence_status], [2, "declared"]);
  // changing the form later does not rewrite what was declared
  await publish("capability", [{ id: "recycled_pct", text: "Recycled input share, by weight", type: "single_choice", options: ["None", "Under 25%", "25% or more"], required: true }]);
  assert.equal((await asSuper("select custom->'recycled_pct'->>'text' as t from public.supplier_capabilities where id = $1", [id])).rows[0].t, "What share of your input is recycled material?");
});

test("an edit that sends no answers, such as retiring tooling, keeps the stored ones; staff can save for a vendor", async () => {
  await publish("tooling", [{ id: "owner_ref", text: "Client reference for this tool", type: "text", required: true }]);
  const tid = (await as("admin", "select public.srm_capability_save('tooling', null, $1, $2::jsonb) as id", [sup, JSON.stringify({ tooling_type_id: ttype, description: "Base mould", owner: "supplier", custom: { owner_ref: "CL-77" } })])).rows[0].id;
  await as("admin", "select public.srm_capability_save('tooling', $1, $2, $3::jsonb)", [tid, sup, JSON.stringify({ tooling_type_id: ttype, description: "Base mould", owner: "supplier", status: "retired" })]);
  const row = (await asSuper("select status, custom from public.supplier_tooling where id = $1", [tid])).rows[0];
  assert.deepEqual([row.status, row.custom.owner_ref.value], ["retired", "CL-77"]);
  await rejects(as("admin", "select public.srm_capability_save('tooling', null, $1, $2::jsonb)", [sup, JSON.stringify({ tooling_type_id: ttype, description: "Another", owner: "supplier", custom: {} })]), /Answer: Client reference/);
  // machines take their own form
  const mid = (await as("vend", "select public.srm_capability_save('machine', null, $1, $2::jsonb) as id", [sup, JSON.stringify({ machine_type_id: mtype, custom: {} })])).rows[0].id;
  assert.ok(mid);
});

test("only the SRM owners draft any of the forms; vendors cannot", async () => {
  await rejects(as("sus", "select public.form_draft_save('machine', $1::jsonb, 'x')", [JSON.stringify(Q)]), /SRM owners/);
  await rejects(as("vend", "select public.form_draft_save('machine', $1::jsonb, 'x')", [JSON.stringify(Q)]), /./);
});
