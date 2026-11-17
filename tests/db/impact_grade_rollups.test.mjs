import { test } from "node:test";
import assert from "node:assert/strict";
import { setupDb, ids } from "./helpers.mjs";

const OUTSIDER = "00000000-0000-0000-0000-0000000000f9";
const CLIENT_USER = "00000000-0000-0000-0000-0000000000f8";

test("Impact Grade rollups: staff see everything, outsiders see nothing, a client user sees only their client", async () => {
  const { as, asSuper, rejects } = await setupDb();
  await asSuper("insert into auth.users (id, email) values ($1, 'nobody@example.com'), ($2, 'buyer@client.example')", [OUTSIDER, CLIENT_USER]);

  // Two clients. Job and spec fixtures differ by migration and the access rules below do not need them.
  const c = await asSuper("insert into public.sourcing_clients (code, name) values ('IGA', 'Client A'), ('IGB', 'Client B') returning id, code");
  const [a, b] = ["IGA", "IGB"].map((code) => c.rows.find((r) => r.code === code).id);

  // A user who is neither staff, a vendor nor a client is refused.
  await rejects(as(OUTSIDER, "select * from public.impact_grade_by_client(null)"), /Not allowed/);
  await rejects(as(OUTSIDER, "select * from public.impact_grade_by_supplier(null)"), /Not allowed/);

  // Staff can ask for every client and supplier; with no graded specs the answer is simply empty.
  const staffClients = await as("admin", "select * from public.impact_grade_by_client(null)");
  assert.ok(Array.isArray(staffClients.rows));
  const staffSuppliers = await as("admin", "select * from public.impact_grade_by_supplier(null)");
  assert.ok(Array.isArray(staffSuppliers.rows));

  // A client user linked to client A can call it, and cannot widen the question to client B.
  await asSuper("update public.profiles set user_type = 'client' where id = $1", [CLIENT_USER]);
  await asSuper("insert into public.client_users (user_id, client_id, role) values ($1, $2, 'viewer')", [CLIENT_USER, a]);
  const mine = await as(CLIENT_USER, "select * from public.impact_grade_by_client($1)", [b]);
  assert.equal(mine.rows.length, 0);
});
