// Sustainability team and joint sign-offs: the new SRM level and its capabilities, joint approvals with a procurement director and the Sustainability
// team (different people, either can reject), ESG concerns decided by joint approval, and onboarding release that can require the joint approval.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = {
  cpo: "00000000-0000-0000-0000-0000000001e1", rpd: "00000000-0000-0000-0000-0000000001e2", pm: "00000000-0000-0000-0000-0000000001e3",
  sus: "00000000-0000-0000-0000-0000000001e4", sus2: "00000000-0000-0000-0000-0000000001e5", srt: "00000000-0000-0000-0000-0000000001e6",
};
Object.assign(ids, U);
for (const [k, id] of Object.entries(U)) await asSuper("insert into auth.users (id, email) values ($1,$2)", [id, `${k}@adm-indicia.com`]);
const assign = (user, role) => as("admin", "select public.division_role_assign($1,'assure',$2,null)", [ids[user], role]);
await assign("cpo", "cpo"); await assign("rpd", "regional_procurement_director"); await assign("pm", "procurement_manager");
await assign("sus", "sustainability"); await assign("sus2", "sustainability"); await assign("srt", "srt");
const sup = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('JS-A','Joint A','Germany','EMEA','a@js.example') returning id")).rows[0].id;
const can = async (u, cap) => (await as(u, "select public.division_can('assure',$1) as c", [cap])).rows[0].c;
const request = (who = "pm", subject = sup, summary = "Onboard Joint A") => as(who, "select public.joint_approval_request('onboarding',$1,$2,null) as id", [subject, summary]);
const approval = async (id) => (await asSuper("select status, proc_by, sust_by, rejected_side, reject_reason from public.joint_approvals where id = $1", [id])).rows[0];

test("the Sustainability level has procurement visibility, view-only strategic tools and libraries, and no approvals or user administration", async () => {
  const r = (await asSuper("select rank, capabilities from public.division_roles where module = 'assure' and key = 'sustainability'")).rows[0];
  assert.equal(r.rank, 6);
  for (const [cap, want] of [["vendor_performance", true], ["vendor_payment_status", true], ["see_money", true], ["strategic_tools_view", true], ["libraries_view", true], ["esg_review", true], ["joint_approve", true],
      ["approve_exceptions", false], ["approve_regional", false], ["strategic_tools", false], ["manage_users", false], ["manage_libraries", false]]) {
    assert.equal(await can("sus", cap), want, `sustainability ${cap}`);
  }
  assert.deepEqual([await can("cpo", "joint_approve"), await can("rpd", "joint_approve"), await can("pm", "joint_approve"), await can("srt", "joint_approve")], [true, true, false, false]);
  assert.deepEqual([await can("pm", "esg_review"), await can("srt", "esg_review")], [false, false]);
  await rejects(as("rpd", "select public.division_role_assign($1,'assure','cpo',null)", [ids.sus]), /more senior/);
  await as("rpd", "select public.division_role_assign($1,'assure','srt',null)", [ids.sus2]);           // a regional director can move someone to a lower level
  await assign("sus2", "sustainability");
});

test("a joint approval needs one procurement director and one Sustainability signature, from different people", async () => {
  const id = (await request()).rows[0].id;
  await rejects(request(), /already waiting/);
  await rejects(as("pm", "select public.joint_approval_sign($1,true,null)", [id]), /Only a procurement director or the Sustainability team/);
  await rejects(as("srt", "select public.joint_approval_sign($1,true,null)", [id]), /Only a procurement director or the Sustainability team/);
  assert.equal((await as("rpd", "select public.joint_approval_sign($1,true,'Reviewed') as r", [id])).rows[0].r, "signed");
  await rejects(as("cpo", "select public.joint_approval_sign($1,true,null)", [id]), /Procurement has already signed/);       // the procurement side is taken
  assert.equal((await approval(id)).status, "pending");
  assert.equal((await as("sus", "select public.joint_approval_sign($1,true,'ESG evidence checked') as r", [id])).rows[0].r, "approved");
  await rejects(as("sus2", "select public.joint_approval_sign($1,true,null)", [id]), /already approved/);
  const a = await approval(id);
  assert.deepEqual([a.status, a.proc_by, a.sust_by], ["approved", ids.rpd, ids.sus]);
  assert.equal((await as("lead", "select public.joint_approval_is_approved('onboarding',$1) as b", [sup])).rows[0].b, true);
  assert.deepEqual((await asSuper("select event, side from public.joint_approval_events where approval_id = $1 order by id", [id])).rows.map((e) => e.event), ["requested", "signed", "signed", "approved"]);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title = 'Joint approval granted'", [ids.pm])).rows[0].n, 1);
});

test("either side can reject with a reason, and a request can be withdrawn by whoever asked", async () => {
  const s2 = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('JS-B','Joint B','Germany','EMEA','b@js.example') returning id")).rows[0].id;
  const id = (await request("pm", s2, "Onboard Joint B")).rows[0].id;
  await rejects(as("sus", "select public.joint_approval_sign($1,false,'')", [id]), /why you are rejecting/);
  assert.equal((await as("sus", "select public.joint_approval_sign($1,false,'Evidence of the factory audit is missing') as r", [id])).rows[0].r, "rejected");
  const a = await approval(id);
  assert.deepEqual([a.status, a.rejected_side, a.reject_reason], ["rejected", "sustainability", "Evidence of the factory audit is missing"]);
  assert.equal((await as("lead", "select public.joint_approval_is_approved('onboarding',$1) as b", [s2])).rows[0].b, false);
  const again = (await request("pm", s2, "Onboard Joint B again")).rows[0].id;                   // a new request is allowed after a rejection
  await rejects(as("cpo", "select public.joint_approval_withdraw($1,null)", [again]), /Only the person who asked/);
  await as("pm", "select public.joint_approval_withdraw($1,'Not ready')", [again]);
  assert.equal((await approval(again)).status, "withdrawn");
  const list = (await as("sus", "select public.joint_approvals_list('pending',null) as l")).rows[0].l;
  assert.ok(list.every((x) => x.status === "pending"));
});

test("the list says which side the caller can sign", async () => {
  const s3 = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('JS-C','Joint C','Germany','EMEA','c@js.example') returning id")).rows[0].id;
  const id = (await request("pm", s3, "Onboard Joint C")).rows[0].id;
  const mine = async (u) => (await as(u, "select public.joint_approvals_list('pending',$1) as l", [s3])).rows[0].l.find((x) => x.id === id);
  assert.deepEqual([(await mine("sus")).my_side, (await mine("sus")).can_sign], ["sustainability", true]);
  assert.deepEqual([(await mine("cpo")).my_side, (await mine("cpo")).can_sign], ["procurement", true]);
  assert.deepEqual([(await mine("pm")).my_side, (await mine("pm")).can_sign], [null, false]);
  await as("sus", "select public.joint_approval_sign($1,true,null)", [id]);
  assert.equal((await mine("sus")).can_sign, false);                                              // already signed
  assert.equal((await mine("cpo")).can_sign, true);
});

test("an ESG concern is raised against a vendor, decided by joint approval, and applied when both sides sign", async () => {
  await rejects(as("srt", "select public.esg_flag_raise($1,'high','Forced overtime reported',null,null,null)", [sup]), /Sustainability team or procurement leadership/);
  await rejects(as("sus", "select public.esg_flag_raise($1,'extreme','x',null,null,null)", [sup]), /low, medium or high/);
  await rejects(as("sus", "select public.esg_flag_raise($1,'high','',null,null,null)", [sup]), /what the concern is/);
  const flag = (await as("sus", "select public.esg_flag_raise($1,'high','Forced overtime reported in the audit',null,null,null) as id", [sup])).rows[0].id;
  await rejects(as("pm", "select public.esg_flag_propose_decision($1,'clear','Fixed')", [flag]), /Sustainability team or procurement leadership/);
  await rejects(as("sus", "select public.esg_flag_propose_decision($1,'ignore','x it')", [flag]), /clear, accept or escalate/);
  const ap = (await as("sus", "select public.esg_flag_propose_decision($1,'accept','Corrective plan agreed, review in 90 days') as id", [flag])).rows[0].id;
  assert.equal((await asSuper("select status from public.vendor_esg_flags where id = $1", [flag])).rows[0].status, "decision_pending");
  await rejects(as("sus", "select public.esg_flag_propose_decision($1,'clear','again')", [flag]), /decision pending/);
  await as("rpd", "select public.joint_approval_sign($1,true,null)", [ap]);
  await as("sus", "select public.joint_approval_sign($1,true,null)", [ap]);
  const f = (await asSuper("select status, decided_at from public.vendor_esg_flags where id = $1", [flag])).rows[0];
  assert.equal(f.status, "accepted");
  assert.ok(f.decided_at);
  // a rejected decision reopens the concern
  const flag2 = (await as("sus", "select public.esg_flag_raise($1,'low','Minor certificate gap',null,null,null) as id", [sup])).rows[0].id;
  const ap2 = (await as("sus", "select public.esg_flag_propose_decision($1,'clear','Gap closed') as id", [flag2])).rows[0].id;
  await as("cpo", "select public.joint_approval_sign($1,false,'Evidence not enough')", [ap2]);
  assert.deepEqual(Object.values((await asSuper("select status, proposed_decision from public.vendor_esg_flags where id = $1", [flag2])).rows[0]), ["open", null]);
  const list = (await as("lead", "select public.esg_flags_list($1,null) as l", [sup])).rows[0].l;
  assert.deepEqual(list.map((x) => x.status).sort(), ["accepted", "open"]);
});

test("onboarding release can require the joint approval; the setting is governed and off by default", async () => {
  const s4 = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('JS-D','Joint D','Germany','EMEA','d@js.example') returning id")).rows[0].id;
  // off by default: release goes to the ordinary checks, which fail for other reasons
  await rejects(as("admin", "select public.onboarding_activate($1,'{}'::jsonb)", [s4]), /^(?!.*joint approval)/);
  await rejects(as("pm", "select public.division_setting_set('assure','joint_onboarding_required','true'::jsonb,'Team is in place')"), /owners can change/);
  await rejects(as("admin", "select public.division_setting_set('assure','joint_onboarding_required','true'::jsonb,'')"), /Say why/);
  await as("admin", "select public.division_setting_set('assure','joint_onboarding_required','true'::jsonb,'Sustainability team is in place')");
  assert.equal((await as("pm", "select public.division_setting('assure','joint_onboarding_required','false'::jsonb) as v")).rows[0].v, true);
  await rejects(as("admin", "select public.onboarding_activate($1,'{}'::jsonb)", [s4]), /joint approval from a procurement director and the Sustainability team/);
  const id = (await request("pm", s4, "Onboard Joint D")).rows[0].id;
  await as("cpo", "select public.joint_approval_sign($1,true,null)", [id]);
  await as("sus", "select public.joint_approval_sign($1,true,null)", [id]);
  await rejects(as("admin", "select public.onboarding_activate($1,'{}'::jsonb)", [s4]), /^(?!.*joint approval from a procurement director)/);   // past the joint gate, now the ordinary checks apply
  await as("admin", "select public.division_setting_set('assure','joint_onboarding_required','false'::jsonb,'Switched off again')");
});
