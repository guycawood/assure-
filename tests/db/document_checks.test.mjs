// Automated document checks: uploads are queued, the platform reads them, and rules compare the text with what was declared.
// The checks assist the reviewer only; they never change the verification status.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { vend: "00000000-0000-0000-0000-0000000001d1", vend2: "00000000-0000-0000-0000-0000000001d2" };
Object.assign(ids, U);
const mk = async (code, name, email) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, name, email])).rows[0].id;
const A = await mk("DC-A", "Alpha Print Ltd", "a@dc.example"), B = await mk("DC-B", "Beta Boards GmbH", "b@dc.example");
await asSuper("insert into auth.users (id, email) values ($1,'a@dc.example'), ($2,'b@dc.example')", [U.vend, U.vend2]);
const type = (await asSuper("insert into public.library_records (library_key, code, name, status) values ('certification_types','T_DC','ISO 9001','active') returning id")).rows[0].id;
const file = async (supplier, bytes) => (await asSuper("insert into public.files (module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content) values ('assure','certificate',gen_random_uuid()::text,$1,'cert.pdf','application/pdf',$2,$3) returning id", [supplier, bytes.length, Buffer.from(bytes)])).rows[0].id;
const cert = async (supplier, f, number, expiry) => (await asSuper("insert into public.supplier_certificates (supplier_id, cert_type_id, cert_number, expiry_date, document_path) values ($1,$2,$3,$4,$5) returning id", [supplier, type, number, expiry, `files/${f}`])).rows[0].id;
const claimAll = async () => (await asSuper("select public.docchecks_claim(50) as c")).rows[0].c;
const finish = (id, text) => asSuper("select public.docchecks_result($1,true,'test',$2,null,false)", [id, text]);
const check = async (subject) => (await asSuper("select status, outcome, findings from public.document_checks where subject_id = $1", [subject])).rows[0];
const rule = (c, r) => c.findings.find((x) => x.rule === r);
const GOOD = "CERTIFICATE OF REGISTRATION. This is to certify that the management system of ALPHA PRINT LIMITED conforms to ISO 9001:2015. Certificate number QMS-2026-0042. Valid until 15 March 2027. Issued by SGS.";

test("date reading handles the common layouts", async () => {
  const d = async (s) => (await asSuper("select to_char(d, 'YYYY-MM-DD') as d from unnest(public._dc_dates($1)) d order by 1", [s])).rows.map((r) => r.d);
  assert.deepEqual(await d("expires 15 March 2027"), ["2027-03-15"]);
  assert.deepEqual(await d("Valid to: March 15th, 2027"), ["2027-03-15"]);
  assert.deepEqual(await d("until 2027-03-15"), ["2027-03-15"]);
  assert.deepEqual(await d("until 15.03.2027"), ["2027-03-15"]);
  assert.deepEqual(await d("until 05/03/2027"), ["2027-03-05", "2027-05-03"]);                       // day-first or month-first: both are kept
  assert.deepEqual(await d("no dates 99/99/2027 here"), []);
});

test("uploading a certificate queues a check; a matching document comes out clear", async () => {
  const f = await file(A, "pdf-bytes-A");
  const id = await cert(A, f, "QMS-2026-0042", "2027-03-15");
  assert.equal((await check(id)).status, "queued");
  const q = (await claimAll()).filter((x) => x.file_id === f);
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].file_name, q[0].content_type], ["cert.pdf", "application/pdf"]);
  assert.equal((await asSuper("select public.docchecks_file($1) as b", [q[0].id])).rows[0].b, Buffer.from("pdf-bytes-A").toString("base64"));
  await finish(q[0].id, GOOD);
  const c = await check(id);
  assert.deepEqual([c.status, c.outcome], ["done", "clear"]);
  assert.deepEqual(["readable", "cert_number", "expiry_date", "cert_type", "company_name", "duplicate"].map((r) => rule(c, r).result), Array(6).fill("pass"));
  assert.equal((await asSuper("select verification_status from public.supplier_certificates where id = $1", [id])).rows[0].verification_status, "pending");   // the check never verifies
});

test("mismatches ask for review and say what was wrong", async () => {
  const f = await file(A, "pdf-bytes-A2");
  const id = await cert(A, f, "QMS-9999", "2028-01-01");
  const q = (await claimAll()).find((x) => x.file_id === f);
  await finish(q.id, GOOD);
  const c = await check(id);
  assert.equal(c.outcome, "review");
  assert.equal(rule(c, "cert_number").result, "warn");
  assert.match(rule(c, "cert_number").detail, /QMS-9999 was not found/);
  assert.equal(rule(c, "expiry_date").result, "warn");
  assert.match(rule(c, "expiry_date").detail, /15 Mar 2027/);                                          // shows what the document does say
  assert.equal(rule(c, "cert_type").result, "pass");
});

test("an unreadable scan is flagged for review; a file the engine cannot process still gets the checks that need no text", async () => {
  const f = await file(A, "pdf-bytes-A3");
  const id = await cert(A, f, "QMS-1", "2027-03-15");
  const q = (await claimAll()).find((x) => x.file_id === f);
  await finish(q.id, "~~ ## 1 2");
  assert.deepEqual([(await check(id)).outcome, rule(await check(id), "readable").result], ["review", "warn"]);
  const f2 = await file(A, "pdf-bytes-A4");
  const id2 = await cert(A, f2, "QMS-2", "2027-03-15");
  const q2 = (await claimAll()).find((x) => x.file_id === f2);
  await asSuper("select public.docchecks_result($1,false,'azure',null,'Engine not configured',true)", [q2.id]);
  const c2 = await check(id2);
  assert.deepEqual([c2.status, rule(c2, "duplicate").result, rule(c2, "readable").result], ["failed", "pass", "warn"]);
  // transient failures retry, then give up after three tries
  const f3 = await file(A, "pdf-bytes-A5");
  const id3 = await cert(A, f3, "QMS-3", "2027-03-15");
  for (let i = 1; i <= 3; i++) {
    const q3 = (await claimAll()).find((x) => x.file_id === f3);
    assert.equal(q3.attempts, i);
    await asSuper("select public.docchecks_result($1,false,'azure',null,'Timeout',false)", [q3.id]);
    assert.equal((await check(id3)).status, i < 3 ? "queued" : "failed");
  }
});

test("the same file uploaded for another company fails the check, and a repeat by the same company warns", async () => {
  const fa = await file(A, "shared-bytes");
  const ida = await cert(A, fa, "QMS-7", "2027-03-15");
  const fb = await file(B, "shared-bytes");
  const idb = await cert(B, fb, "QMS-7", "2027-03-15");
  for (const q of (await claimAll()).filter((x) => [fa, fb].includes(x.file_id))) await finish(q.id, GOOD);
  const cb = await check(idb);
  assert.equal(cb.outcome, "fail");
  assert.match(rule(cb, "duplicate_other").detail, /Alpha Print Ltd/);
  assert.equal(rule(cb, "company_name").result, "warn");                                              // Beta's name is not on Alpha's certificate text
  const fa2 = await file(A, "own-bytes");
  const fa3 = await file(A, "own-bytes");
  await cert(A, fa2, "QMS-8", "2027-03-15");
  const id3 = await cert(A, fa3, "QMS-9", "2027-03-15");
  for (const q of (await claimAll()).filter((x) => [fa2, fa3].includes(x.file_id))) await finish(q.id, GOOD);
  assert.equal(rule(await check(id3), "duplicate_same").result, "warn");
  assert.ok(ida);
});

test("documents are checked too; reviewers read findings and can re-run; vendors never see them; the runner is not user-callable", async () => {
  const f = await file(A, "doc-bytes");
  const doc = (await as("admin", "insert into public.supplier_documents (supplier_id, doc_type, title, file_path) values ($1,'insurance','Liability cover',$2) returning id", [A, `files/${f}`])).rows[0].id;
  const q = (await claimAll()).find((x) => x.file_id === f);
  await finish(q.id, "Public liability insurance schedule for Alpha Print Limited. Policy period 1 January 2026 to 31 December 2026. Cover of five million euro per claim, issued to the policyholder.");
  const c = await check(doc);
  assert.deepEqual([c.outcome, rule(c, "company_name").result], ["clear", "pass"]);
  assert.equal(rule(c, "cert_number"), undefined);                                                    // certificate rules do not apply to documents
  const seen = (await as("admin", "select public.docchecks_for('document', array[$1::uuid]) as r", [doc])).rows[0].r;
  assert.deepEqual([seen.length, seen[0].outcome, seen[0].extracted_text], [1, "clear", undefined]);   // the text itself is not returned
  await as("admin", "select public.docchecks_rerun('document', $1)", [doc]);
  assert.equal((await check(doc)).status, "queued");
  await rejects(as("admin", "select public.docchecks_rerun('document', gen_random_uuid())"), /no uploaded file/);
  assert.equal((await as("vend", "select count(*)::int n from public.document_checks")).rows[0].n, 0);
  await rejects(as("vend", "select public.docchecks_for('document', array[$1::uuid])", [doc]), /./);
  for (const sql of ["select public.docchecks_claim(1)", "select public.docchecks_file(gen_random_uuid())", "select public.docchecks_result(gen_random_uuid(),true,'x','t',null,false)"]) {
    await rejects(as("admin", sql), /permission denied|does not exist/);
  }
});
