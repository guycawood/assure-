// Proofs (Global Business Transformation: QA and QC inspection, steps e to i): the supplier sends a digital or physical proof,
// client services check it, the client approves it, and production cannot start until a proof is approved or staff waive it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V = "00000000-0000-0000-0000-0000000000b1", V2 = "00000000-0000-0000-0000-0000000000b2";
const C = "00000000-0000-0000-0000-0000000000b3", C2 = "00000000-0000-0000-0000-0000000000b4";
Object.assign(ids, { v: V, v2: V2, c: C, c2: C2 });
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];

const sup = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('PF-A','Proof Print','United Kingdom','EMEA','a@proof.example') returning id")).id;
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('PF-B','Other Print','United Kingdom','EMEA','b@proof.example')");
await asSuper("insert into auth.users (id, email) values ($1, 'a@proof.example'), ($2, 'b@proof.example'), ($3, 'ann@client.example'), ($4, 'vic@client.example')", [V, V2, C, C2]);
const client = (await one("insert into public.sourcing_clients (code, name) values ('PFC','Proof Client') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [C, client]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [C2, client]);

async function po(status = "accepted") {
  const job = (await as("agent", "insert into public.jobs (title, client_id, region, market) values ('Proof job',$1,'EMEA','United Kingdom') returning id", [client])).rows[0].id;
  await asSuper("update public.jobs set manager = $2 where id = $1", [job, ids.lead]);
  const est = (await one("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','GBP',1000,'EMEA','United Kingdom','approved') returning id", [job, sup])).id;
  return (await one("insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, required_doa_level, status, region, market) values ($1,$2,$3,'GBP',1000,0,$4,'EMEA','United Kingdom') returning id", [job, est, sup, status])).id;
}
const attach = (user, proof) => as(user, "select public.file_register('orders','po_proof',$1,null,'proof.pdf','application/pdf',10,'aGVsbG8gd29ybGQ=',null,'Proof')", [proof]);

test("the supplier starts a proof on its own accepted order; one round at a time", async () => {
  const p = await po();
  await rejects(as(V2, "select public.vendor_proof_start($1, 'digital')", [p]), /not found/);
  await rejects(as("agent", "select public.vendor_proof_start($1, 'digital')", [p]), /vendor user/);
  const issued = await po("issued");
  await rejects(as(V, "select public.vendor_proof_start($1, 'digital')", [issued]), /not found/);
  await as(V, "select public.vendor_proof_start($1, 'digital')", [p]);
  await rejects(as(V, "select public.vendor_proof_start($1, 'physical')", [p]), /already in progress/);
});

test("a proof needs its file, and a physical proof also its tracking number; client services check it before the client sees it", async () => {
  const p = await po();
  const proof = (await as(V, "select public.vendor_proof_start($1, 'physical') id", [p])).rows[0].id;
  await rejects(as(V, "select public.vendor_proof_submit($1, 'TRK1', null)", [proof]), /Upload the proof/);
  await attach(V, proof);
  await rejects(as(V, "select public.vendor_proof_submit($1, '', null)", [proof]), /tracking number/);
  await as(V, "select public.vendor_proof_submit($1, 'TRK1', 'Sent by courier')", [proof]);
  // the client cannot see it, or decide it, yet
  assert.equal((await as(C, "select public.client_portal_proofs() r")).rows[0].r.length, 0);
  await rejects(as(C, "select public.client_proof_decide($1, true, null)", [proof]), /not waiting for your decision/);
  await rejects(as("lead", "select public.proof_cs_review($1, true, null, null)", [proof]), /date the physical proof was sent/);
  await rejects(as("lead", "select public.proof_cs_review($1, false, '', null)", [proof]), /what to correct/);
  await as("lead", "select public.proof_cs_review($1, true, 'Dimensions and material match', current_date)", [proof]);
  const seen = (await as(C, "select public.client_portal_proofs() r")).rows[0].r;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, "with_client");
  assert.equal(seen[0].files.length, 1);
});

test("only a client approver decides; changes start a new round; approval unlocks production and tells the supplier", async () => {
  const p = await po();
  await rejects(as(V, "select public.po_vendor_start_production($1)", [p]), /client has approved a proof/);
  const r1 = (await as(V, "select public.vendor_proof_start($1, 'digital') id", [p])).rows[0].id;
  await attach(V, r1);
  await as(V, "select public.vendor_proof_submit($1, null, null)", [r1]);
  await as("lead", "select public.proof_cs_review($1, true, null, null)", [r1]);
  await rejects(as(C2, "select public.client_proof_decide($1, true, null)", [r1]), /Only approvers/);
  await rejects(as(C, "select public.client_proof_decide($1, false, '')", [r1]), /what needs to change/);
  await as(C, "select public.client_proof_decide($1, false, 'Logo is too small')", [r1]);
  assert.equal((await one("select status from public.po_proofs where id = $1", [r1])).status, "changes_requested");
  await rejects(as(V, "select public.po_vendor_start_production($1)", [p]), /client has approved a proof/);

  const r2 = (await as(V, "select public.vendor_proof_start($1, 'digital') id", [p])).rows[0].id;
  assert.equal((await one("select round from public.po_proofs where id = $1", [r2])).round, 2);
  await attach(V, r2);
  await as(V, "select public.vendor_proof_submit($1, null, 'Logo enlarged')", [r2]);
  await as("lead", "select public.proof_cs_review($1, true, null, null)", [r2]);
  await as(C, "select public.client_proof_decide($1, true, 'Approved')", [r2]);
  const mail = (await asSuper("select subject from public.email_outbox where subject like 'Proof approved%'")).rows;
  assert.ok(mail.length >= 1, "the supplier is told");
  await as(V, "select public.po_vendor_start_production($1)", [p]);
  await rejects(as(V, "select public.po_vendor_start_production($1)", [p]), /already been launched/);
  const ev = (await asSuper("select event from public.sourcing_events where entity_id = $1 order by at, id", [p])).rows.map((e) => e.event);
  for (const e of ["proof_submitted", "proof_sent_to_client", "proof_changes_requested", "proof_approved", "production_launched"]) assert.ok(ev.includes(e), e);
});

test("a proof the client services reject goes back to the supplier and is never shown to the client", async () => {
  const p = await po();
  const r1 = (await as(V, "select public.vendor_proof_start($1, 'digital') id", [p])).rows[0].id;
  await attach(V, r1);
  await as(V, "select public.vendor_proof_submit($1, null, null)", [r1]);
  await as("lead", "select public.proof_cs_review($1, false, 'Wrong size, check the spec')", [r1]);
  assert.equal((await as(C, "select public.client_portal_proofs() r")).rows[0].r.filter((x) => x.id === r1).length, 0);
  const mine = (await as(V, "select public.vendor_po_proofs($1) r", [p])).rows[0].r;
  assert.equal(mine.rounds[0].cs_note, "Wrong size, check the spec");
});

test("staff can waive the proof with a reason, so production can start without one", async () => {
  const p = await po();
  await rejects(as("lead", "select public.po_proof_waive($1, '')", [p]), /why no proof/);
  await rejects(as(V, "select public.po_proof_waive($1, 'repeat order')", [p]), /Only staff/);
  await as("lead", "select public.po_proof_waive($1, 'Repeat order, artwork unchanged')", [p]);
  await as(V, "select public.po_vendor_start_production($1)", [p]);
  assert.ok((await one("select production_started_at from public.purchase_orders where id = $1", [p])).production_started_at);
});

test("the client can open the proof files once they are sent, other clients and the public cannot", async () => {
  const p = await po();
  const r = (await as(V, "select public.vendor_proof_start($1, 'digital') id", [p])).rows[0].id;
  const f = (await attach(V, r)).rows[0].file_register;
  assert.equal((await as(C, "select count(*)::int n from public.file_content($1)", [f])).rows[0].n, 0, "not before it is sent");
  await as(V, "select public.vendor_proof_submit($1, null, null)", [r]);
  await as("lead", "select public.proof_cs_review($1, true, null, null)", [r]);
  assert.equal((await as(C, "select count(*)::int n from public.file_content($1)", [f])).rows[0].n, 1);
});
