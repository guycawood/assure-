// Form governance: changes to the vendor onboarding form are drafted by the SRM owners, then published only after a joint sign-off
// (a procurement director and the Sustainability team). Vendors see only the published version.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { cpo: "00000000-0000-0000-0000-0000000001a1", sus: "00000000-0000-0000-0000-0000000001a2", pm: "00000000-0000-0000-0000-0000000001a3", vend: "00000000-0000-0000-0000-0000000001a4" };
Object.assign(ids, U);
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('FG-A','Form Co','Germany','EMEA','v@formco.example')");
for (const [k, id] of Object.entries(U)) await asSuper("insert into auth.users (id, email) values ($1,$2)", [id, k === "vend" ? "v@formco.example" : `${k}@adm-indicia.com`]);
const assign = (u, role) => as("admin", "select public.division_role_assign($1,'assure',$2,null)", [ids[u], role]);
await assign("cpo", "cpo"); await assign("sus", "sustainability"); await assign("pm", "procurement_manager");
const Q = [{ id: "forced_labour", text: "Do you have a forced labour policy?", type: "yes_no", required: true },
  { id: "audit_body", text: "Which body audits your factory?", type: "single_choice", options: ["SEDEX", "BSCI", "Other"], required: false }];
const list = async () => (await as("admin", "select public.form_versions_list('onboarding') as l")).rows[0].l;
const save = (q, note = null) => as("admin", "select public.form_draft_save('onboarding', $1::jsonb, $2) as id", [JSON.stringify(q), note]);

test("version 1 is the published form today, with no extra questions", async () => {
  const l = await list();
  assert.deepEqual([l.length, l[0].version, l[0].status, l[0].questions.length], [1, 1, "published", 0]);
  const v = (await as("vend", "select public.vendor_form_questions('onboarding') as q")).rows[0].q;
  assert.deepEqual([v.version, v.questions.length], [1, 0]);
});

test("only the SRM owners draft, and bad questions are refused", async () => {
  await rejects(as("sus", "select public.form_draft_save('onboarding', $1::jsonb, 'x')", [JSON.stringify(Q)]), /SRM owners/);
  await rejects(as("pm", "select public.form_draft_save('onboarding', $1::jsonb, 'x')", [JSON.stringify(Q)]), /SRM owners/);
  await rejects(as("vend", "select public.form_draft_save('onboarding', $1::jsonb, 'x')", [JSON.stringify(Q)]), /./);
  await rejects(save([{ id: "Bad Id", text: "x", type: "text" }]), /short id/);
  await rejects(save([{ id: "a1", text: "x", type: "single_choice", options: ["one"] }]), /two options/);
  await rejects(save([{ id: "a1", text: "x", type: "blob" }]), /Unknown question type/);
  await rejects(save([{ id: "a1", text: "x", type: "text" }, { id: "a1", text: "y", type: "text" }]), /share an id/);
});

test("a change goes through joint sign-off; vendors see it only once published", async () => {
  const id = (await save(Q, "Add ESG questions")).rows[0].id;
  assert.equal((await save(Q, "Add ESG questions")).rows[0].id, id);                         // the same draft is updated
  assert.equal((await as("vend", "select public.vendor_form_questions('onboarding') as q")).rows[0].q.questions.length, 0);
  await rejects(as("admin", "select public.form_propose($1)", ["00000000-0000-0000-0000-000000000001"]), /Only a draft/);
  const ap = (await as("admin", "select public.form_propose($1) as id", [id])).rows[0].id;
  await rejects(save([]), /waiting for sign-off/);
  assert.equal((await list())[0].status, "pending");
  assert.equal((await as("vend", "select public.vendor_form_questions('onboarding') as q")).rows[0].q.version, 1);
  await as("cpo", "select public.joint_approval_sign($1,true,null)", [ap]);
  assert.equal((await list())[0].status, "pending");                                          // one side is not enough
  await as("sus", "select public.joint_approval_sign($1,true,'ESG questions look right')", [ap]);
  const l = await list();
  assert.deepEqual(l.map((x) => [x.version, x.status]), [[2, "published"], [1, "retired"]]);
  const v = (await as("vend", "select public.vendor_form_questions('onboarding') as q")).rows[0].q;
  assert.deepEqual([v.version, v.questions.length], [2, 2]);
});

test("a rejection returns the change to draft; an unchanged form is refused", async () => {
  const same = (await save(Q)).rows[0].id;
  await rejects(as("admin", "select public.form_propose($1)", [same]), /Nothing has changed/);
  await as("admin", "select public.form_draft_discard('onboarding')");
  const q3 = [...Q, { id: "carbon", text: "Do you report carbon emissions?", type: "yes_no", required: false }];
  const id = (await save(q3, "Add carbon")).rows[0].id;
  const ap = (await as("admin", "select public.form_propose($1) as id", [id])).rows[0].id;
  await as("sus", "select public.joint_approval_sign($1,false,'Wording needs work')", [ap]);
  const l = await list();
  assert.deepEqual([l[0].version, l[0].status, l[0].approval_id], [3, "draft", null]);
  assert.equal(l[1].status, "published");                                                    // version 2 stays live
  const ap2 = (await as("admin", "select public.form_propose($1) as id", [id])).rows[0].id;   // can be proposed again
  await as("admin", "select public.joint_approval_withdraw($1,'Not now')", [ap2]);
  assert.equal((await list())[0].status, "draft");
});
