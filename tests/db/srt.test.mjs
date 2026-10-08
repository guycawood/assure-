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
  head: "00000000-0000-0000-0000-0000000000a5",
  newVendor: "00000000-0000-0000-0000-0000000000b3",
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
  for (const g of ["registration", "financial", "msa", "coc", "capability", "sustainability"]) {
    await as("agent", "select public.update_supplier_gate($1, $2, 'verified')", [supplierId, g]);
  }
  await rejects(as("agent", "select public.update_supplier_gate($1, 'approval', 'verified')", [supplierId]), /Only the Procurement head/);
  await as("admin", "select public.update_supplier_gate($1, 'approval', 'verified')", [supplierId]);
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

test("import: lead only, creates suppliers with gates, audits, skips duplicates", async () => {
  const rows = JSON.stringify([
    { name: "Guangzhou Display Ltd", supplier_code: "CN0201", market: "China", region: "APAC", client: "Unilever", ytd_spend: 250000,
      gates: { msa: "verified", bank: "verified", sustainability: "requested", bogus: "verified", coc: "nonsense" } },
    { name: "Hanoi Packaging", market: "Vietnam", region: "Mars", client: "Heineken", ytd_spend: "12000" },
    { name: "Shanghai Print Co", market: "China" }, // already exists
    { name: "  " }, // blank name
  ]);
  await rejects(as("agent", "select public.import_suppliers($1::jsonb, 'fast_track')", [rows]), /Only an SRT lead or admin/);
  const res = (await as("lead", "select public.import_suppliers($1::jsonb, 'fast_track') r", [rows])).rows[0].r;
  assert.deepEqual(res, { created: 2, skipped: 2, gates_set: 3, skipped_names: ["Shanghai Print Co"] });
  const s = (await as("lead", "select id, region, client, onboarding_route, fast_track_approved_by, rag, purchasing_blocked, gates_clear from public.suppliers where supplier_code = 'CN0201'")).rows[0];
  assert.equal(s.region, "APAC");
  assert.equal(s.onboarding_route, "fast_track");
  assert.equal(s.fast_track_approved_by, null, "import never approves fast-track");
  assert.equal(s.gates_clear, 2);
  assert.equal(s.purchasing_blocked, true);
  const audit = (await as("lead", "select count(*)::int n from public.gate_audit_log where supplier_id = $1 and note = 'Imported from tracker'", [s.id])).rows[0].n;
  assert.equal(audit, 3);
  const h = (await as("lead", "select region, ytd_spend::int spend from public.suppliers where name = 'Hanoi Packaging'")).rows[0];
  assert.deepEqual(h, { region: null, spend: 12000 }, "invalid enum values are dropped, not stored");
  const again = (await as("lead", "select public.import_suppliers($1::jsonb) r", [rows])).rows[0].r;
  assert.equal(again.created, 0);
});

test("daily sweep: renewal tickets for certs expiring within the warning window, deduped", async () => {
  const sid = (await as("lead", "select id from public.suppliers where supplier_code = 'CN0201'")).rows[0].id;
  await as("lead", "update public.suppliers set srt_owner = $1 where id = $2", [ids.agent, sid]);
  await as("agent", "select public.update_supplier_gate($1, 'quality', 'verified', current_date + 10)", [sid]);
  await as("agent", "select public.update_supplier_gate($1, 'environment', 'verified', current_date + 200)", [sid]);
  await rejects(as("agent", "select public.srt_daily_sweep()"), /Only an SRT lead or admin/);
  const r1 = (await as("lead", "select public.srt_daily_sweep() r")).rows[0].r;
  assert.equal(r1.renewal_tickets, 1);
  const t = (await as("lead", "select type, gate_key, assignee, source, due_date - current_date as days from public.srt_tickets where supplier_id = $1 and type = 'certificate_renewal'", [sid])).rows;
  assert.deepEqual(t, [{ type: "certificate_renewal", gate_key: "quality", assignee: ids.agent, source: "cert_expiry", days: 10 }]);
  const r2 = (await asSuper("select public.srt_daily_sweep() r")).rows[0].r; // as pg_cron would run it
  assert.equal(r2.renewal_tickets, 0, "no duplicate while the first renewal ticket is open");
});

test("demo seed loads, gives a realistic mix, and is re-runnable", async () => {
  const seed = readFileSync(join(MIGRATIONS, "..", "seed", "demo_data.sql"), "utf8");
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  await db.exec(seed);
  await db.exec(seed); // second run replaces, doesn't duplicate
  const s = (await asSuper(`select count(*)::int n,
      count(*) filter (where rag = 'green')::int green,
      count(*) filter (where rag = 'amber')::int amber,
      count(*) filter (where rag = 'red')::int red,
      count(*) filter (where purchasing_blocked)::int blocked,
      count(distinct priority_tier)::int tiers
    from public.suppliers where supplier_code like 'DEMO-%'`)).rows[0];
  assert.equal(s.n, 30);
  assert.ok(s.green > 0 && s.amber > 0 && s.red > 0, `expected a RAG mix, got ${JSON.stringify(s)}`);
  assert.ok(s.tiers >= 3, `expected several tiers, got ${s.tiers}`);
  const t = (await asSuper("select count(*)::int n from public.srt_tickets where source_ref = 'demo'")).rows[0].n;
  assert.equal(t, 14);
  const bad = (await asSuper(`select count(*)::int n from public.supplier_gates g join public.gate_definitions d on d.key = g.gate_key
    where g.expiry_date is not null and not d.has_expiry`)).rows[0].n;
  assert.equal(bad, 0);
});

test("vendor RFI: send, register, submit, review by Procurement head", async () => {
  await asSuper("insert into auth.users (id, email) values ($1, 'head@adm-indicia.com')", [ids.head]);
  await as("admin", "select public.admin_set_user_access($1, 'internal', 'head', false, null)", [ids.head]);

  // A new-vendor request ticket with no supplier yet.
  const ticket = (await as("agent",
    "insert into public.srt_tickets (type, title, prospect_name, client, market) values ('new_onboarding', 'New vendor: Coastal Foam', 'Coastal Foam Inserts', 'Unilever', 'Vietnam') returning id")).rows[0].id;

  await rejects(as("vendor", "select public.send_vendor_rfi($1, 'a@b.co', null, 'http://x')", [ticket]), /Only SRT, procurement or admin/);
  await rejects(as("agent", "select public.send_vendor_rfi($1, 'not-an-email', null, 'http://x')", [ticket]), /valid vendor email/);
  const sent = (await as("agent", "select public.send_vendor_rfi($1, 'Sales@CoastalFoam.example', 'Linh', 'http://localhost:3000/') r", [ticket])).rows[0].r;
  const token = new URL(sent.link).searchParams.get("invite");
  assert.ok(token && token.length >= 60);
  assert.match(sent.link, /^http:\/\/localhost:3000\/vendor\/register\?invite=/);

  const t = (await as("agent", "select status, supplier_id from public.srt_tickets where id = $1", [ticket])).rows[0];
  assert.equal(t.status, "waiting_vendor");
  assert.equal(t.supplier_id, sent.supplier_id, "supplier created from the prospect");
  const gate = (await as("agent", "select status from public.supplier_gates where supplier_id = $1 and gate_key = 'rfi'", [sent.supplier_id])).rows[0];
  assert.equal(gate.status, "requested");
  const mail = (await as("agent", "select to_email, link, status from public.email_outbox where ticket_id = $1", [ticket])).rows;
  assert.deepEqual(mail, [{ to_email: "sales@coastalfoam.example", link: sent.link, status: "queued" }]);
  const stored = (await asSuper("select token_hash from public.vendor_rfis where id = $1", [sent.rfi_id])).rows[0].token_hash;
  assert.notEqual(stored, token, "only a hash of the token is stored");
  await rejects(as("agent", "select token_hash from public.vendor_rfis"), /permission denied/);

  // Public lookup works without signing in, and reveals nothing for a wrong token.
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
  const look = (await db.query("select public.lookup_vendor_invite($1) r", [token])).rows[0].r;
  const bad = (await db.query("select public.lookup_vendor_invite('nope') r")).rows[0].r;
  await db.exec("reset role;");
  assert.deepEqual(look, { valid: true, supplier_name: "Coastal Foam Inserts", email: "sales@coastalfoam.example" });
  assert.deepEqual(bad, { valid: false, reason: "not_found" });

  // Vendor registers with the invited email -> linked to the supplier.
  await asSuper("insert into auth.users (id, email) values ($1, 'sales@coastalfoam.example')", [ids.newVendor]);
  const p = (await asSuper("select user_type, supplier_id from public.profiles where id = $1", [ids.newVendor])).rows[0];
  assert.deepEqual(p, { user_type: "vendor", supplier_id: sent.supplier_id });
  const mine = (await as("newVendor", "select id, status from public.vendor_rfis")).rows;
  assert.deepEqual(mine, [{ id: sent.rfi_id, status: "sent" }]);

  // Submission rules.
  await rejects(as("vendor", "select public.submit_vendor_rfi($1, '{}'::jsonb, null)", [sent.rfi_id]), /not for your company/);
  await rejects(as("newVendor", "select public.submit_vendor_rfi($1, $2::jsonb, null)", [sent.rfi_id, JSON.stringify({ legal_name: "Coastal Foam Inserts Co Ltd", registration_number: "0312345678" })]), /declaration/);
  const data = { legal_name: "Coastal Foam Inserts Co Ltd", registration_number: "0312345678", vat_number: "VN0312345678", declaration: true };
  const bank = { bank_name: "Example Bank", account_name: "Coastal Foam", account_number: "12345678", sort_code_or_swift: "EXAMVNVX" };
  await as("newVendor", "select public.submit_vendor_rfi($1, $2::jsonb, $3::jsonb)", [sent.rfi_id, JSON.stringify(data), JSON.stringify(bank)]);
  await rejects(as("newVendor", "select public.submit_vendor_rfi($1, $2::jsonb, null)", [sent.rfi_id, JSON.stringify(data)]), /already been submitted/);

  const gates = (await as("agent", "select gate_key, status from public.supplier_gates where supplier_id = $1 and gate_key in ('rfi','bank') order by gate_key", [sent.supplier_id])).rows;
  assert.deepEqual(gates, [{ gate_key: "bank", status: "received" }, { gate_key: "rfi", status: "received" }], "vendor input is never verified");
  assert.equal((await as("agent", "select status from public.srt_tickets where id = $1", [ticket])).rows[0].status, "in_progress");

  // Bank details: Finance / lead / head / admin only; vendor and agent can't read them.
  assert.equal((await as("newVendor", "select * from public.vendor_bank_details")).rows.length, 0);
  assert.equal((await as("agent", "select * from public.vendor_bank_details")).rows.length, 0);
  assert.equal((await as("finance", "select account_number from public.vendor_bank_details")).rows[0].account_number, "12345678");

  // Review: head only; return needs a note and issues a fresh link.
  await rejects(as("agent", "select public.review_vendor_rfi($1, 'approve', null)", [sent.rfi_id]), /Only the Procurement head/);
  await rejects(as("head", "select public.review_vendor_rfi($1, 'return', '')", [sent.rfi_id]), /Add a note/);
  await as("head", "select public.review_vendor_rfi($1, 'return', 'Please add your VAT certificate', 'http://localhost:3000')", [sent.rfi_id]);
  const returned = (await as("newVendor", "select status, review_note from public.vendor_rfis where id = $1", [sent.rfi_id])).rows[0];
  assert.deepEqual(returned, { status: "returned", review_note: "Please add your VAT certificate" });
  assert.equal((await as("agent", "select count(*)::int n from public.email_outbox where ticket_id = $1", [ticket])).rows[0].n, 2);
  assert.equal((await as("agent", "select status from public.srt_tickets where id = $1", [ticket])).rows[0].status, "waiting_vendor");

  await as("newVendor", "select public.submit_vendor_rfi($1, $2::jsonb, null)", [sent.rfi_id, JSON.stringify({ ...data, vat_certificate_note: "attached" })]);
  await as("head", "select public.review_vendor_rfi($1, 'approve', 'Looks complete')", [sent.rfi_id]);
  const after = (await as("agent", "select gate_key, status from public.supplier_gates where supplier_id = $1 and gate_key in ('request','rfi') order by gate_key", [sent.supplier_id])).rows;
  assert.deepEqual(after, [{ gate_key: "request", status: "verified" }, { gate_key: "rfi", status: "verified" }]);

  // Final onboarding approval gate now belongs to the Procurement head.
  await rejects(as("lead", "select public.update_supplier_gate($1, 'approval', 'verified')", [sent.supplier_id]), /Only the Procurement head/);
  await as("head", "select public.update_supplier_gate($1, 'approval', 'verified')", [sent.supplier_id]);

  const log = (await as("agent", "select body from public.srt_ticket_activity where ticket_id = $1 and kind = 'event' order by id", [ticket])).rows.map((r) => r.body);
  assert.ok(log.some((b) => /Information request emailed/.test(b)));
  assert.ok(log.some((b) => /Vendor submitted/.test(b)));
  assert.ok(log.some((b) => /approved the vendor information/.test(b)));
});

test("anonymous users see nothing", async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
  try {
    await rejects(db.query("select * from public.suppliers"), /permission denied/);
  } finally {
    await db.exec("reset role;");
  }
});
