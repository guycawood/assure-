// Watchtower framework: governed libraries, supersede/history, maker-checker, usage guard, change requests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;

test("only governors write libraries; nobody writes the tables directly", async () => {
  await rejects(as("plain", "select public.library_create('substrates','SB-1','Board 350gsm','{}',null,null)"), /Only admins/);
  await rejects(as("admin", "insert into public.library_records (library_key, name, status) values ('substrates','x','active')"), /permission denied/);
  await rejects(as("admin", "delete from public.library_audit"), /permission denied/);
});

test("module owners govern their own module only", async () => {
  await asSuper("insert into public.module_owners values ('assure', $1)", [t.ids.lead]);
  const r = await as("lead", "select public.library_create('certification_types','FSC','FSC Chain of Custody','{\"validity_months\":60}',null,null) as id");
  assert.ok(r.rows[0].id);
  await rejects(as("lead", "select public.library_create('substrates','SB-9','x','{}',null,null)"), /Only admins and watchtower owners/);
});

test("create, correct with a reason, supersede: history stays queryable by date", async () => {
  const { rows: [{ id }] } = await as("admin", `select public.library_create('substrates','SB-100','Folding box board','{"grammage_gsm":350}','2026-01-01',null) as id`);
  await rejects(as("admin", `select public.library_update($1,'Folding box board','{"grammage_gsm":360}',null,'')`, [id]), /reason/);
  await as("admin", `select public.library_update($1,'Folding boxboard','{"grammage_gsm":350}',null,'Spelling')`, [id]);
  await rejects(as("admin", `select public.library_supersede($1,'Folding boxboard','{"grammage_gsm":380}','2025-06-01','New mill spec')`, [id]), /must start after/);
  const { rows: [{ n }] } = await as("admin", `select public.library_supersede($1,'Folding boxboard','{"grammage_gsm":380}','2026-07-01','New mill spec') as n`, [id]);

  const old = await as("plain", "select status, effective_to::text, superseded_by from public.library_records where id = $1", [id]);
  assert.deepEqual([old.rows[0].status, old.rows[0].effective_to, old.rows[0].superseded_by], ["superseded", "2026-06-30", n]);
  const mar = await as("plain", "select (public.library_effective('substrates','SB-100','2026-03-01')).data->>'grammage_gsm' as g");
  const aug = await as("plain", "select (public.library_effective('substrates','SB-100','2026-08-01')).data->>'grammage_gsm' as g");
  assert.equal(mar.rows[0].g, "350");
  assert.equal(aug.rows[0].g, "380");

  const audit = await as("plain", "select action, changes from public.library_audit where record_id = $1 order by id", [id]);
  assert.deepEqual(audit.rows.map((a) => a.action), ["create", "update", "supersede"]);
  assert.equal(audit.rows[2].changes.find((c) => c.field === "grammage_gsm").after, 380);
  await rejects(as("admin", `select public.library_update($1,'x','{}',null,'typo')`, [id]), /Only current records/);
});

test("maker-checker: a different person approves", async () => {
  const { rows: [{ id }] } = await as("admin", `select public.library_create('core_principles','DI-01','Single source of truth','{"category":"data_integrity"}',null,null) as id`);
  const s = await as("plain", "select status from public.library_records where id = $1", [id]);
  assert.equal(s.rows[0].status, "pending_approval");
  await rejects(as("admin", "select public.library_approve($1, true, null)", [id]), /different person/);
  await as("admin2", "select public.library_approve($1, true, 'Agreed')", [id]);
  const a = await as("plain", "select status, approved_by from public.library_records where id = $1", [id]);
  assert.equal(a.rows[0].status, "active");
});

test("usage guard: in-use records can be deactivated, not deleted", async () => {
  const { rows: [{ id }] } = await as("admin", `select public.library_create('substrates','SB-200','Rigid PVC foam','{}',null,null) as id`);
  await asSuper("insert into public.library_refs (record_id, ref_table, ref_id) values ($1, 'specs', 'S-1')", [id]);
  await rejects(as("admin", "select public.library_delete($1, null)", [id]), /In use/);
  await as("admin", "select public.library_retire($1, 'Phasing out PVC')", [id]);
  await as("admin", "select public.library_reactivate($1, null)", [id]);
  const { rows: [{ id: free }] } = await as("admin", `select public.library_create('substrates','SB-201','Test','{}',null,null) as id`);
  await as("admin", "select public.library_delete($1, 'Created by mistake')", [free]);
  const left = await as("plain", "select count(*)::int n from public.library_records where id = $1", [free]);
  assert.equal(left.rows[0].n, 0);
});

test("import is all-or-nothing", async () => {
  await rejects(as("admin", `select public.library_import('carriers', '[{"code":"DHL","name":"DHL"},{"code":"UPS","name":""}]', 'csv')`), /Row 2/);
  const none = await as("plain", "select count(*)::int n from public.library_records where library_key = 'carriers'");
  assert.equal(none.rows[0].n, 0);
  const ok = await as("admin", `select public.library_import('carriers', '[{"code":"DHL","name":"DHL Express"},{"code":"UPS","name":"UPS"}]', 'csv') as n`);
  assert.equal(ok.rows[0].n, 2);
});

test("change requests: principles checked, minimum review time, legal transitions, separate verifier", async () => {
  const { rows: [{ id }] } = await as("plain", "select public.cr_submit('watchtower','/watchtower','Add recycled content to substrates','data_integrity',null,null) as id");
  await rejects(as("plain", "select public.cr_start_review($1)", [id]), /Only admins/);
  await as("admin", "select public.cr_start_review($1)", [id]);
  await rejects(as("admin", "select public.cr_review($1,'approved','data_integrity','high','ok','{}',false,'{}')", [id]), /Check every principle/);
  const { rows: [p] } = await as("plain", "select id from public.library_records where code = 'DI-01'");
  await rejects(as("admin", "select public.cr_review($1,'approved','data_integrity','high','ok',$2,false,'{}')", [id, [p.id]]), /20 seconds/);
  await asSuper("update public.change_requests set review_started_at = now() - interval '30 seconds' where id = $1", [id]);
  await as("admin", "select public.cr_review($1,'approved','data_integrity','high','ok',$2,false,'{}')", [id, [p.id]]);
  await rejects(as("admin", "select public.cr_verify($1,'checked')", [id]), /Only an implemented/);
  await as("admin", "select public.cr_mark_implemented($1,'Field added')", [id]);
  await rejects(as("admin", "select public.cr_verify($1,'checked')", [id]), /different person/);
  await as("admin2", "select public.cr_verify($1,'Seen in the substrate library')", [id]);
  const ev = await as("plain", "select to_status from public.change_request_events where change_request_id = $1 order by id", [id]);
  assert.deepEqual(ev.rows.map((e) => e.to_status), ["logged", "approved", "implemented_pending_verification", "verified_complete"]);
});
