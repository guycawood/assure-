// Client tables: fee schedules (lookups with optional dates) and exception lists, uploaded as versions and approved by a different CRM owner.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { vend: "00000000-0000-0000-0000-0000000001ee" };
Object.assign(ids, U);
const client = (await asSuper("insert into public.sourcing_clients (code, name) values ('CT-A','Table client') returning id")).rows[0].id;
const client2 = (await asSuper("insert into public.sourcing_clients (code, name) values ('CT-B','Other client') returning id")).rows[0].id;
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('CT-V','CT Vendor','Germany','EMEA','v@ct.example')");
await asSuper("insert into auth.users (id, email) values ($1,'v@ct.example')", [U.vend]);
await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.head]);
const upload = (who, key, kind, rows, note = "From the client's July schedule", c = client, title = "Fee by country") =>
  as(who, "select public.crm_table_upload($1,$2,$3,$4,$5::jsonb,$6,'fees.xlsx') as id", [c, key, title, kind, JSON.stringify(rows), note]);
const list = async (c = client) => (await as("admin", "select public.crm_client_tables($1) as l", [c])).rows[0].l;
const FEES1 = [{ key: "Country 1", value: 6, to: "2026-06-30" }, { key: "Country 1", value: 5.5, from: "2026-07-01" }, { key: "Country 2", value: 6.5 }];
let v1;

test("only CRM staff upload; rows are shape-checked; a note, a title and a valid name are required", async () => {
  await rejects(upload("vend", "fee_by_country", "lookup", FEES1), /Only staff/);
  await rejects(upload("lead", "Fee Table", "lookup", FEES1), /letters, digits and underscores/);
  await rejects(upload("lead", "fee_by_country", "table", FEES1), /list or a lookup/);
  await rejects(upload("lead", "fee_by_country", "lookup", FEES1, ""), /where it comes from/);
  await rejects(upload("lead", "fee_by_country", "lookup", FEES1, "x", client, ""), /Give the new table a title/);
  await rejects(upload("lead", "fee_by_country", "lookup", []), /no rows/);
  await rejects(upload("lead", "fee_by_country", "lookup", [{ key: "A", value: "6" }]), /numeric value/);
  await rejects(upload("lead", "fee_by_country", "lookup", [{ key: "", value: 6 }]), /needs a key/);
  await rejects(upload("lead", "fee_by_country", "lookup", [{ key: "A", value: 6, from: "July" }]), /YYYY-MM-DD/);
  await rejects(upload("lead", "exc", "list", [1, 2]), /List values are text/);
  v1 = (await upload("lead", "fee_by_country", "lookup", FEES1)).rows[0].id;
  const l = await list();
  assert.deepEqual([l.length, l[0].kind, l[0].live, l[0].pending.row_count, l[0].pending.added], [1, "lookup", null, 3, 3]);
  await rejects(upload("lead", "fee_by_country", "list", ["x"]), /is a lookup and the upload is a list/);
  await rejects(upload("lead", "fee_by_country", "lookup", FEES1), /still waiting for approval/);              // one pending upload at a time
});

test("a different CRM owner approves it; the uploader cannot; a rejection needs a reason", async () => {
  await rejects(as("lead", "select public.crm_table_decide($1,true,null)", [v1]), /Only the CRM owners/);
  await asSuper("insert into public.module_owners (module, user_id) values ('crm', $1)", [ids.lead]);
  await rejects(as("lead", "select public.crm_table_decide($1,true,null)", [v1]), /different person/);
  await rejects(as("head", "select public.crm_table_decide($1,false,'')", [v1]), /why it is sent back/);
  await as("head", "select public.crm_table_decide($1,false,'The 2026 dates are wrong')", [v1]);
  assert.equal((await list())[0].pending, null);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title = 'Your table was sent back'", [ids.lead])).rows[0].n, 1);
  const v2 = (await upload("lead", "fee_by_country", "lookup", FEES1, "Corrected dates")).rows[0].id;
  await as("head", "select public.crm_table_decide($1,true,'Checked against the schedule')", [v2]);
  const l = (await list())[0];
  assert.deepEqual([l.live.version, l.live.row_count, l.pending, l.versions], [2, 3, null, 2]);                  // version 1 was rejected and kept as history
  assert.equal(l.live.sample.length, 3);
});

test("the next version shows what changed; the old version is kept; check runs read only the live one", async () => {
  const next = [{ key: "Country 1", value: 6, to: "2026-06-30" }, { key: "Country 1", value: 5.2, from: "2026-07-01" }, { key: "Country 3", value: 7 }];
  const v3 = (await upload("agent", "fee_by_country", "lookup", next, "Country 1 cut from July, Country 3 added, Country 2 dropped")).rows[0].id;
  const p = (await list())[0].pending;
  assert.deepEqual([p.added, p.removed, p.changed], [1, 1, 1]);
  const diff = (await as("head", "select public.crm_table_diff($1) as d", [v3])).rows[0].d;
  assert.deepEqual([diff.added[0].key, diff.removed[0].key, diff.changed[0].key, diff.changed[0].was, diff.changed[0].now], ["Country 3", "Country 2", "Country 1", 5.5, 5.2]);
  const before = (await as("lead", "select public.crm_client_tables_published($1) as r", [client])).rows[0].r;
  assert.deepEqual([before.fee_by_country.version, before.fee_by_country.rows.length], [2, 3]);                  // the pending upload is not read yet
  await as("lead", "select public.crm_table_withdraw($1)", [v3]);                                              // the uploader withdraws and re-uploads
  assert.equal((await list())[0].pending, null);
  const v4 = (await upload("lead", "fee_by_country", "lookup", next)).rows[0].id;
  await rejects(as("agent", "select public.crm_table_withdraw($1)", [v4]), /Only the person who uploaded/);
  await as("head", "select public.crm_table_decide($1,true,null)", [v4]);
  const after = (await as("lead", "select public.crm_client_tables_published($1) as r", [client])).rows[0].r;
  assert.equal(after.fee_by_country.version, 3);                                                                // a withdrawn upload is deleted, so numbers do not skip
  assert.equal(after.fee_by_country.rows.find((r) => r.from === "2026-07-01").value, 5.2);
  assert.equal((await asSuper("select count(*)::int n from public.crm_client_table_versions where status = 'retired'")).rows[0].n, 1);
});

test("exception lists work the same way, and tables are per client", async () => {
  const v = (await upload("lead", "markup_exceptions", "list", ["JOB-1", "JOB-2"], "The agreed exception list", client, "Mark-up exceptions")).rows[0].id;
  await as("head", "select public.crm_table_decide($1,true,null)", [v]);
  const pub = (await as("lead", "select public.crm_client_tables_published($1) as r", [client])).rows[0].r;
  assert.deepEqual([pub.markup_exceptions.kind, pub.markup_exceptions.rows], ["list", ["JOB-1", "JOB-2"]]);
  assert.deepEqual(Object.keys(pub).sort(), ["fee_by_country", "markup_exceptions"]);
  assert.deepEqual(await list(client2), []);
  assert.deepEqual((await as("lead", "select public.crm_client_tables_published($1) as r", [client2])).rows[0].r, {});
  await as("lead", "select public.crm_table_upload($1,'markup_exceptions','Other title','list','[\"A\"]'::jsonb,'Same key for another client')", [client2]);   // keys are per client
  await rejects(as("vend", "select public.crm_client_tables($1)", [client]), /Only staff/);
  assert.equal((await as("vend", "select count(*)::int n from public.crm_client_table_versions")).rows[0].n, 0);
});
