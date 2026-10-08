// Runs the Supabase migrations against an in-process Postgres (PGlite) with
// stubbed Supabase auth, then checks the access rules and compliance logic.
// Run with: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

const ids = {
  admin: "00000000-0000-0000-0000-00000000000a",
  agent: "00000000-0000-0000-0000-0000000000a1",
  lead: "00000000-0000-0000-0000-0000000000a2",
  finance: "00000000-0000-0000-0000-0000000000a3",
  plain: "00000000-0000-0000-0000-0000000000a4",
  vendor: "00000000-0000-0000-0000-0000000000b1",
  otherVendor: "00000000-0000-0000-0000-0000000000b2",
};

let db;

async function asSuper(sql, params) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  return db.query(sql, params);
}
async function as(user, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ids[user]}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => pattern.test(e.message), `expected error matching ${pattern}`);
}

test("setup", async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const users = [
    [ids.admin, "admin@adm-indicia.com"],
    [ids.agent, "agent@adm-indicia.com"],
    [ids.lead, "lead@adm-indicia.com"],
    [ids.finance, "finance@adm-indicia.com"],
    [ids.plain, "staff@adm-indicia.com"],
  ];
  for (const [id, email] of users) await asSuper("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await asSuper("update public.profiles set is_admin = true where id = $1", [ids.admin]);
  for (const [u, role] of [["agent", "agent"], ["lead", "lead"], ["finance", "finance"]]) {
    await as("admin", "select public.admin_set_user_access($1, 'internal', $2, false, null)", [ids[u], role]);
  }
  const { rows } = await asSuper("select email, user_type, srt_role from public.profiles order by email");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.user_type === "internal"));
});

let supplierId;
let otherSupplierId;

test("new supplier gets 14 gates, starts red and blocked", async () => {
  const { rows } = await as("plain",
    "insert into public.suppliers (name, market, client, ytd_spend, primary_contact_email) values ('Shanghai Print Co', 'China', 'Unilever', 184000, 'ops@shanghaiprint.example') returning id, rag, purchasing_blocked, created_by");
  supplierId = rows[0].id;
  assert.equal(rows[0].created_by, ids.plain);
  const s = (await as("plain", "select rag, priority_tier, purchasing_blocked, gates_clear from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "red", priority_tier: 1, purchasing_blocked: true, gates_clear: 0 });
  const g = await as("plain", "select count(*)::int n from public.supplier_gates where supplier_id = $1", [supplierId]);
  assert.equal(g.rows[0].n, 14);
  otherSupplierId = (await as("plain", "insert into public.suppliers (name, primary_contact_email) values ('Other Vendor Ltd', 'x@other.example') returning id")).rows[0].id;
});

test("vendor login links to supplier by verified email, server-side", async () => {
  await asSuper("insert into auth.users (id, email) values ($1, 'OPS@shanghaiprint.example')", [ids.vendor]);
  await asSuper("insert into auth.users (id, email) values ($1, 'x@other.example')", [ids.otherVendor]);
  const p = (await asSuper("select user_type, supplier_id from public.profiles where id = $1", [ids.vendor])).rows[0];
  assert.equal(p.user_type, "vendor");
  assert.equal(p.supplier_id, supplierId);
});

test("vendor isolation: own supplier only, no gates, no tickets, no self-promotion", async () => {
  const s = await as("vendor", "select id from public.suppliers");
  assert.deepEqual(s.rows.map((r) => r.id), [supplierId]);
  assert.equal((await as("vendor", "select * from public.supplier_gates")).rows.length, 0);
  assert.equal((await as("vendor", "select * from public.gate_audit_log")).rows.length, 0);
  assert.equal((await as("vendor", "select * from public.srt_tickets")).rows.length, 0);
  assert.equal((await as("vendor", "select * from public.profiles")).rows.length, 1);
  await rejects(as("vendor", "update public.profiles set user_type = 'internal' where id = $1", [ids.vendor]), /permission denied/);
  await rejects(as("vendor", "update public.profiles set supplier_id = $1 where id = $2", [otherSupplierId, ids.vendor]), /permission denied/);
  await as("vendor", "update public.profiles set full_name = 'Li Wei' where id = $1", [ids.vendor]);
  const upd = await as("vendor", "update public.suppliers set ytd_spend = 0 where id = $1 returning id", [supplierId]);
  assert.equal(upd.rows.length, 0, "vendor must not update supplier records");
  await rejects(as("vendor", "insert into public.srt_tickets (type, title, prospect_name) values ('query', 'hi', 'x')"), /row-level security/);
  await rejects(as("vendor", "select public.update_supplier_gate($1, 'msa', 'verified')", [supplierId]), /Only internal staff/);
  await rejects(as("vendor", "select public.admin_set_user_access($1, 'internal', 'lead', true, null)", [ids.vendor]), /Only admins/);
});

test("nobody writes gates directly or edits computed fields", async () => {
  await rejects(as("lead", "update public.supplier_gates set status = 'verified' where supplier_id = $1", [supplierId]), /permission denied/);
  await as("lead", "update public.suppliers set notes = 'x', rag = 'green', purchasing_blocked = false where id = $1", [supplierId]);
  const s = (await as("lead", "select rag, purchasing_blocked, notes from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "red", purchasing_blocked: true, notes: "x" });
});

test("verifier roles are enforced per gate", async () => {
  await rejects(as("plain", "select public.update_supplier_gate($1, 'msa', 'verified')", [supplierId]), /Only SRT agents or leads/);
  await as("plain", "select public.update_supplier_gate($1, 'msa', 'requested')", [supplierId]);
  await rejects(as("agent", "select public.update_supplier_gate($1, 'bank', 'verified')", [supplierId]), /Only Finance/);
  await rejects(as("agent", "select public.update_supplier_gate($1, 'nda', 'not_required')", [supplierId]), /Only an SRT lead/);
  await rejects(as("agent", "select public.update_supplier_gate($1, 'msa', 'rejected')", [supplierId]), /needs a reason/);
  await rejects(as("agent", "select public.update_supplier_gate($1, 'msa', null, '2030-01-01')", [supplierId]), /does not take an expiry/);
});

test("closing critical gates turns amber and lifts the purchasing block; audit is written", async () => {
  for (const g of ["registration", "financial", "msa", "coc", "capability", "sustainability", "approval"]) {
    await as("agent", "select public.update_supplier_gate($1, $2, 'verified')", [supplierId, g]);
  }
  let s = (await as("agent", "select rag, purchasing_blocked, critical_open from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "red", purchasing_blocked: true, critical_open: 1 }, "bank still missing");
  await as("finance", "select public.update_supplier_gate($1, 'bank', 'verified')", [supplierId]);
  s = (await as("agent", "select rag, purchasing_blocked, priority_tier, critical_open from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "amber", purchasing_blocked: false, priority_tier: 3, critical_open: 0 });
  const a = await as("agent", "select count(*)::int n from public.gate_audit_log where supplier_id = $1", [supplierId]);
  assert.equal(a.rows[0].n, 9); // msa requested + 8 verifications
});

test("an expired certificate reopens the gate and turns red", async () => {
  await as("agent", "select public.update_supplier_gate($1, 'sustainability', null, (current_date - 1))", [supplierId]);
  const s = (await as("agent", "select rag, purchasing_blocked from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "red", purchasing_blocked: true });
  await as("agent", "select public.update_supplier_gate($1, 'sustainability', null, null, true)", [supplierId]);
});

test("all gates clear -> green and compliant", async () => {
  for (const g of ["request", "rfi", "nda", "quality", "environment", "setup"]) {
    await as("agent", "select public.update_supplier_gate($1, $2, 'verified')", [supplierId, g]);
  }
  const s = (await as("agent", "select rag, priority_tier, onboarding_status, gates_clear from public.suppliers where id = $1", [supplierId])).rows[0];
  assert.deepEqual(s, { rag: "green", priority_tier: null, onboarding_status: "compliant", gates_clear: 14 });
});

test("tickets: SLA due date, triage on assignment, activity log, lead-only due changes", async () => {
  const t = (await as("agent",
    "insert into public.srt_tickets (type, title, supplier_id, assignee) values ('bank_change', 'New bank details', $1, $2) returning id, status, due_date, created_by",
    [otherSupplierId, ids.agent])).rows[0];
  assert.equal(t.status, "triage");
  assert.equal(t.created_by, ids.agent);
  const days = (await asSuper("select ($1::date - current_date) d", [t.due_date])).rows[0].d;
  assert.equal(days, 3);
  await as("agent", "update public.srt_tickets set status = 'resolved' where id = $1", [t.id]);
  const r = (await as("agent", "select resolved_at is not null done, resolution from public.srt_tickets where id = $1", [t.id])).rows[0];
  assert.deepEqual(r, { done: true, resolution: "completed" });
  const log = await as("agent", "select kind, body from public.srt_ticket_activity where ticket_id = $1 order by id", [t.id]);
  assert.equal(log.rows[0].body, "Ticket raised");
  assert.match(log.rows[1].body, /status triage → resolved/);
  await rejects(as("agent", "update public.srt_tickets set due_date = current_date + 30 where id = $1", [t.id]), /Only an SRT lead/);
  await as("lead", "update public.srt_tickets set due_date = current_date + 30 where id = $1", [t.id]);
  await rejects(as("agent", "insert into public.srt_ticket_activity (ticket_id, kind, body, actor) values ($1, 'event', 'fake', $2)", [t.id, ids.agent]), /row-level security/);
});

test("raise_gap_tickets creates one per open critical gate and never duplicates", async () => {
  const n1 = (await as("agent", "select public.raise_gap_tickets($1) n", [otherSupplierId])).rows[0].n;
  assert.equal(n1, 8);
  const n2 = (await as("agent", "select public.raise_gap_tickets($1) n", [otherSupplierId])).rows[0].n;
  assert.equal(n2, 0);
});

test("fast-track: lead approval required, not self-approval, lifts block until close-by", async () => {
  await rejects(as("agent", "select public.approve_fast_track($1, 'UL incumbent', current_date + 14)", [otherSupplierId]), /Only an SRT lead/);
  const mine = (await as("lead", "insert into public.suppliers (name) values ('Lead Created Ltd') returning id")).rows[0].id;
  await rejects(as("lead", "select public.approve_fast_track($1, 'x', current_date + 14)", [mine]), /supplier you created/);
  await as("lead", "select public.approve_fast_track($1, 'UL incumbent, approved by Unilever Procurement', current_date + 14)", [otherSupplierId]);
  const s = (await as("lead", "select onboarding_route, fast_track_approved_by, purchasing_blocked from public.suppliers where id = $1", [otherSupplierId])).rows[0];
  assert.deepEqual(s, { onboarding_route: "fast_track", fast_track_approved_by: ids.lead, purchasing_blocked: false });
  await as("lead", "update public.suppliers set fast_track_approved_by = null, fast_track_close_by = current_date - 1 where id = $1", [otherSupplierId]);
  const s2 = (await as("lead", "select fast_track_approved_by, purchasing_blocked from public.suppliers where id = $1", [otherSupplierId])).rows[0];
  assert.deepEqual(s2, { fast_track_approved_by: ids.lead, purchasing_blocked: true }, "approval can't be cleared directly; past close-by re-blocks");
});

test("anonymous users see nothing", async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
  try {
    await rejects(db.query("select * from public.suppliers"), /permission denied/);
  } finally {
    await db.exec("reset role;");
  }
});
