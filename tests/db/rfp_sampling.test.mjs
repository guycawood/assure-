// The sampling job in an RFP (GBT "RFP process", r10 to r24): sample quote, client approval and PO, sample PO, drawing sign-off,
// launch with photos, shipment, conformity check (a rejection invalidates the PO), the client's decision and rework.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V1 = "00000000-0000-0000-0000-0000000001a1", V2 = "00000000-0000-0000-0000-0000000001a2";
const CA = "00000000-0000-0000-0000-0000000001a3", CV = "00000000-0000-0000-0000-0000000001a4", CO = "00000000-0000-0000-0000-0000000001a5";
Object.assign(ids, { v1: V1, v2: V2, ca: CA, cv: CV, co: CO });
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const mk = async (code, email) => (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'United Kingdom','EMEA',$3) returning id", [code, `Sampler ${code}`, email])).id;
const s1 = await mk("SJ-A", "a@sampler.example"), s2 = await mk("SJ-B", "b@sampler.example");
await asSuper("insert into auth.users (id, email) values ($1,'a@sampler.example'), ($2,'b@sampler.example'), ($3,'ap@sj-client.example'), ($4,'vw@sj-client.example'), ($5,'ot@sj-other.example')", [V1, V2, CA, CV, CO]);
const client = (await one("insert into public.sourcing_clients (code, name) values ('SJC', 'Sampling Client') returning id")).id;
const other = (await one("insert into public.sourcing_clients (code, name) values ('SJO', 'Other Client') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CA, client]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [CV, client]);
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CO, other]);

async function rfq(status = "sent", inviteStatus = "quoted") {
  const job = (await as("agent", "insert into public.jobs (title, client_id, region, market) values ('Sample job',$1,'EMEA','United Kingdom') returning id", [client])).rows[0].id;
  const r = (await one("insert into public.rfqs (job_id, title, status, due_at, region, market) values ($1,'Totem',$2,now() + interval '5 days','EMEA','United Kingdom') returning id", [job, status])).id;
  await asSuper("insert into public.rfq_invitations (rfq_id, supplier_id, status) values ($1,$2,$3)", [r, s1, inviteStatus]);
  return r;
}
const request = (r, sup = s1) => as("agent", "select public.sampling_request($1,$2,'One prototype in final board',2) as id", [r, sup]);
const attach = (user, type, id, name) => as(user, "select public.file_register('sourcing',$1,$2,null,$3,'application/pdf',10,'aGVsbG8=',null,'File')", [type, id, name]);
const state = async (id) => one("select status, round, po_valid, sample_po_number, reception_notice from public.sampling_jobs where id = $1", [id]);

test("a sampling job needs an RFQ that is out and a supplier that has quoted", async () => {
  await rejects(request(await rfq("draft")), /out with suppliers/);
  await rejects(request(await rfq("sent", "invited")), /Review the supplier's quote first/);
  const r = await rfq();
  await rejects(request(r, s2), /not invited/);
  await rejects(as("agent", "select public.sampling_request($1,$2,'x',1)", [r, s1]), /Describe the sample/);
  await rejects(as(V1, "select public.sampling_request($1,$2,'A prototype piece',1)", [r, s1]), /staff/);
  const id = (await request(r)).rows[0].id;
  await rejects(request(r), /already an open sampling job/);
  assert.equal((await state(id)).status, "requested");
});

test("quote, client approval and PO: only the right supplier quotes; viewers and other clients cannot decide", async () => {
  const r = await rfq();
  const id = (await request(r)).rows[0].id;
  await rejects(as(V2, "select public.vendor_sampling_quote($1, 50, 7, null)", [id]), /not found/i);
  await rejects(as(V1, "select public.vendor_sampling_quote($1, null, 7, null)", [id]), /sample cost/);
  await as(V1, "select public.vendor_sampling_quote($1, 120.5, 9, 'Hand-finished')", [id]);
  await rejects(as(V1, "select public.vendor_sampling_quote($1, 99, 9, null)", [id]), /already been given/);
  // the client sees nothing before the decision
  assert.equal((await as(CA, "select public.client_sampling_jobs() as r")).rows[0].r.length, 0);
  await rejects(as("agent", "select public.sampling_decide_approval($1, null)", [id]), /Say whether/);
  await as("agent", "select public.sampling_decide_approval($1, true)", [id]);
  const seen = (await as(CA, "select public.client_sampling_jobs() as r")).rows[0].r;
  assert.equal(seen.length, 1);
  assert.equal(Number(seen[0].quote_amount), 120.5);
  assert.equal((await as(CO, "select public.client_sampling_jobs() as r")).rows[0].r.length, 0);
  await rejects(as(CV, "select public.client_sampling_quote_decide($1, true, null, 'PO-1')", [id]), /Only approvers/);
  await rejects(as(CO, "select public.client_sampling_quote_decide($1, true, null, 'PO-1')", [id]), /not found/i);
  await rejects(as(CA, "select public.client_sampling_quote_decide($1, false, '', null)", [id]), /why the quote is not accepted/);
  await rejects(as(CA, "select public.client_sampling_quote_decide($1, true, null, '')", [id]), /purchase order number/);
  // not accepted: back to the supplier, who re-quotes
  await as(CA, "select public.client_sampling_quote_decide($1, false, 'Too expensive for a prototype', null)", [id]);
  assert.equal((await state(id)).status, "requested");
  await as(V1, "select public.vendor_sampling_quote($1, 80, 9, 'Simpler finish')", [id]);
  await as("agent", "select public.sampling_decide_approval($1, true)", [id]);
  await rejects(as("agent", "select public.sampling_issue_po($1)", [id]), /approved before/);
  await as(CA, "select public.client_sampling_quote_decide($1, true, null, 'CPO-55')", [id]);
  assert.equal((await state(id)).status, "approved");
  const po = (await as("agent", "select public.sampling_issue_po($1) as p", [id])).rows[0].p;
  assert.match(po, /^SPO-\d{4}-\d{5}$/);
  assert.deepEqual([(await state(id)).status, (await state(id)).sample_po_number], ["po_issued", po]);
});

test("no client approval needed goes straight to approved; a sample is cancelled with a reason", async () => {
  const r = await rfq();
  const id = (await request(r)).rows[0].id;
  await as(V1, "select public.vendor_sampling_quote($1, 0, 3, null)", [id]);
  await as("agent", "select public.sampling_decide_approval($1, false)", [id]);
  assert.equal((await state(id)).status, "approved");
  await rejects(as("agent", "select public.sampling_cancel($1, '')", [id]), /why the sampling job is cancelled/);
  await as("agent", "select public.sampling_cancel($1, 'Client dropped the idea')", [id]);
  assert.deepEqual([(await state(id)).status, (await state(id)).po_valid], ["cancelled", false]);
});

test("the full chain: drawing sign-off, launch with photos, ship, conformity, the client's decision, rework", async () => {
  const r = await rfq();
  const id = (await request(r)).rows[0].id;
  await as(V1, "select public.vendor_sampling_quote($1, 60, 5, null)", [id]);
  await as("agent", "select public.sampling_decide_approval($1, true)", [id]);
  await as(CA, "select public.client_sampling_quote_decide($1, true, null, 'CPO-9')", [id]);
  await as("agent", "select public.sampling_issue_po($1)", [id]);

  // the drawing must be signed off before launch
  await rejects(as("agent", "select public.sampling_send_drawing($1)", [id]), /Upload the technical drawing/);
  const d = (await attach("agent", "sampling_drawing", id, "drawing.pdf")).rows[0].file_register;
  await as("agent", "select public.sampling_send_drawing($1)", [id]);
  assert.equal((await as(CA, "select * from public.file_content($1)", [d])).rows.length, 1);
  assert.equal((await as(CO, "select * from public.file_content($1)", [d])).rows.length, 0);
  assert.equal((await as(V1, "select * from public.file_content($1)", [d])).rows.length, 1);
  await attach(V1, "sampling_job", id, "launch.jpg");
  await rejects(as(V1, "select public.vendor_sampling_launch($1, null)", [id]), /signed off the technical drawing/);
  await rejects(as(CV, "select public.client_sampling_drawing_decide($1, true, null)", [id]), /Only approvers/);
  await rejects(as(CA, "select public.client_sampling_drawing_decide($1, false, '')", [id]), /what to change/);
  await as(CA, "select public.client_sampling_drawing_decide($1, true, 'Looks right')", [id]);

  // launch needs photos from the supplier; shipping needs tracking and its invoice number
  await as(V1, "select public.vendor_sampling_launch($1, 'Cutting started')", [id]);
  assert.equal((await state(id)).status, "launched");
  await rejects(as(V1, "select public.vendor_sampling_ship($1, 'DHL', '', 'INV-1')", [id]), /tracking number/);
  await rejects(as(V1, "select public.vendor_sampling_ship($1, 'DHL', 'TRK100', '')", [id]), /invoice number/);
  await as(V1, "select public.vendor_sampling_ship($1, 'DHL', 'TRK100', 'INV-1', null)", [id]);
  await rejects(as("agent", "select public.sampling_review($1, true, null)", [id]), /arrived first/);
  await as("agent", "select public.sampling_receive($1, null)", [id]);
  await rejects(as("agent", "select public.sampling_review($1, false, '')", [id]), /why the sample is rejected/);
  await as("agent", "select public.sampling_review($1, true, 'Matches the drawing')", [id]);
  const ok = await state(id);
  assert.equal(ok.status, "accepted");
  assert.match(ok.reception_notice, /^SRN-\d{4}-\d{5}$/);
  const photo = (await one("select id from public.files where entity_type = 'sampling_job' and entity_id = $1", [id])).id;
  assert.equal((await as(CA, "select * from public.file_content($1)", [photo])).rows.length, 0); // not with the client yet
  await as("agent", "select public.sampling_send_to_client($1)", [id]);
  assert.equal((await as(CA, "select * from public.file_content($1)", [photo])).rows.length, 1);
  assert.equal((await as(CO, "select * from public.file_content($1)", [photo])).rows.length, 0);

  // the client asks for rework; the supplier sends a new one in round 2
  await rejects(as(CV, "select public.client_sampling_sample_decide($1, true, null)", [id]), /Only approvers/);
  await rejects(as(CA, "select public.client_sampling_sample_decide($1, false, '')", [id]), /what to rework/);
  await as(CA, "select public.client_sampling_sample_decide($1, false, 'Print is too dark')", [id]);
  assert.equal((await state(id)).status, "rework");
  const sv = (await as(V1, "select public.vendor_sampling_jobs() as r")).rows[0].r.find((x) => x.id === id);
  assert.equal(sv.client_sample_comment, "Print is too dark");
  assert.ok(!("client_name" in sv));
  await as(V1, "select public.vendor_sampling_ship($1, 'DHL', 'TRK200', 'INV-2', 'Reprinted')", [id]);
  assert.deepEqual([(await state(id)).status, (await state(id)).round], ["shipped", 2]);
  await as("agent", "select public.sampling_receive($1, null)", [id]);
  await as("agent", "select public.sampling_review($1, true, null)", [id]);
  await as("agent", "select public.sampling_send_to_client($1)", [id]);
  await as(CA, "select public.client_sampling_sample_decide($1, true, 'Approved')", [id]);
  assert.equal((await state(id)).status, "client_approved");
  const ev = (await as("agent", "select public.sampling_jobs_internal($1) as r", [r])).rows[0].r[0].events.map((e) => e.event);
  for (const e of ["requested", "quoted", "po_issued", "drawing_signed_off", "launched", "shipped", "received", "sample_ok", "client_asked_rework", "client_approved_sample"]) assert.ok(ev.includes(e), e);
});

test("an internal rejection invalidates the sample PO and tells the supplier", async () => {
  const r = await rfq();
  const id = (await request(r)).rows[0].id;
  await as(V1, "select public.vendor_sampling_quote($1, 0, 3, null)", [id]);
  await as("agent", "select public.sampling_decide_approval($1, false)", [id]);
  const po = (await as("agent", "select public.sampling_issue_po($1) as p", [id])).rows[0].p;
  await attach(V1, "sampling_job", id, "photo.jpg");
  await as(V1, "select public.vendor_sampling_launch($1, null)", [id]);
  await as(V1, "select public.vendor_sampling_ship($1, 'UPS', 'TRKX1', '', null)", [id]);
  await as("agent", "select public.sampling_receive($1, null)", [id]);
  await as("agent", "select public.sampling_review($1, false, 'Wrong board thickness')", [id]);
  const s = await state(id);
  assert.deepEqual([s.status, s.po_valid], ["rejected", false]);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title = $2", [V1, `Sample rejected: PO ${po} invalidated`])).n, 1);
  await rejects(as(V1, "select public.vendor_sampling_ship($1, 'UPS', 'TRKX2', '', null)", [id]), /not ready to send/);
  // a new sampling job can be requested afterwards
  await request(r);
});

test("cancelling an open RFQ tells every invited supplier; a draft RFQ tells nobody (r26)", async () => {
  const r = await rfq();
  const mail = (id) => one("select count(*)::int n from public.email_outbox where supplier_id = $1 and subject like $2", [s1, `%${id}%`]);
  const num = (await one("select rfq_number n from public.rfqs where id = $1", [r])).n;
  await rejects(as("agent", "select public.rfq_cancel($1, '')", [r]), /why the RFQ is cancelled/);
  assert.equal((await mail(num)).n, 0);
  await as("agent", "select public.rfq_cancel($1, 'Client dropped the project')", [r]);
  const sent = await one("select body from public.email_outbox where supplier_id = $1 and subject like $2", [s1, `%${num} cancelled%`]);
  assert.match(sent.body, /Client dropped the project/);
  const d = await rfq("draft");
  const dnum = (await one("select rfq_number n from public.rfqs where id = $1", [d])).n;
  await as("agent", "select public.rfq_cancel($1, 'Not needed')", [d]);
  assert.equal((await mail(dnum)).n, 0);
});
