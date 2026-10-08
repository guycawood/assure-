// Platform services: file storage access rules, notifications isolation, region/market master data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const V1 = "00000000-0000-0000-0000-0000000000c1";
const V2 = "00000000-0000-0000-0000-0000000000c2";
let s1, s2;

test("setup vendors", async () => {
  s1 = (await asSuper("insert into public.suppliers (name, supplier_code) values ('Acme Print','P-1') returning id")).rows[0].id;
  s2 = (await asSuper("insert into public.suppliers (name, supplier_code) values ('Other Co','P-2') returning id")).rows[0].id;
  await asSuper("insert into auth.users (id, email) values ($1,'v1@acme.test'), ($2,'v2@other.test')", [V1, V2]);
  await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [V1, s1]);
  await asSuper("update public.profiles set user_type = 'vendor', supplier_id = $2 where id = $1", [V2, s2]);
});

test("vendors upload only to their own company and only see their own files", async () => {
  const b64 = Buffer.from("hello").toString("base64");
  await rejects(as(V1, "select public.file_register('assure','invoice','X',$1,'a.pdf','application/pdf',5,$2,null,null)", [s2, b64]), /own company/);
  const { rows: [{ id }] } = await as(V1, "select public.file_register('assure','invoice','X',null,'a.pdf','application/pdf',5,$1,null,'Invoice') as id", [b64]);
  const own = await as(V1, "select supplier_id, uploaded_by_vendor from public.files where id = $1", [id]);
  assert.equal(own.rows[0].supplier_id, s1, "attached to the vendor's own supplier even when not given");
  assert.equal(own.rows[0].uploaded_by_vendor, true);
  const other = await as(V2, "select count(*)::int n from public.files where id = $1", [id]);
  assert.equal(other.rows[0].n, 0);
  const none = await as(V2, "select count(*)::int n from public.file_content($1)", [id]);
  assert.equal(none.rows[0].n, 0);
  const mine = await as(V1, "select convert_from(decode(content_b64,'base64'),'UTF8') as s from public.file_content($1)", [id]);
  assert.equal(mine.rows[0].s, "hello");
  const internal = await as("plain", "select count(*)::int n from public.file_content($1)", [id]);
  assert.equal(internal.rows[0].n, 1);
  await rejects(as("plain", "select public.file_delete($1)", [id]), /uploader or an admin/);
  await rejects(as(V1, "insert into public.files (module, entity_type, entity_id, file_name, size_bytes) values ('x','y','z','f',1)"), /permission denied/);
});

test("notifications are private and only written by the system", async () => {
  await asSuper("select public.notify($1,'assure','Hello','Body','/assure')", [t.ids.agent]);
  await rejects(as("plain", "select public.notify($1,'assure','x',null,null)", [t.ids.plain]), /permission denied/);
  const mine = await as("agent", "select count(*)::int n from public.notifications");
  const theirs = await as("plain", "select count(*)::int n from public.notifications");
  assert.deepEqual([mine.rows[0].n, theirs.rows[0].n], [1, 0]);
  await as("agent", "select public.notifications_mark_read(null)");
  const unread = await as("agent", "select count(*)::int n from public.notifications where read_at is null");
  assert.equal(unread.rows[0].n, 0);
});

test("markets belong to one region", async () => {
  const r = await as("plain", "select region_code from public.markets where code = 'GB'");
  assert.equal(r.rows[0].region_code, "EMEA");
  await rejects(as("admin", "insert into public.markets (code, name, region_code, currency) values ('XX','Test','APAC','USD')"), /permission denied/);
});
