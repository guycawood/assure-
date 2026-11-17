// SRM vendor jobs and payments: every vendor and job across all clients, each vendor's payment journey with the expected pay date,
// filters, and money hidden from the SRT level (vendor performance and payment status only).
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const day = (o) => new Date(Date.now() + o * 864e5).toLocaleDateString("en-CA");
const V1 = "00000000-0000-0000-0000-0000000001b1";
await asSuper("insert into auth.users (id, email) values ($1,'v@vj.example')", [V1]);
const sup = async (code) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, `Vendor ${code}`, `${code}@vj.example`])).rows[0].id;
const sA = await sup("VJ-A"), sB = await sup("VJ-B");
const clientA = (await asSuper("insert into public.sourcing_clients (code, name) values ('VJA','Client One') returning id")).rows[0].id;
const clientB = (await asSuper("insert into public.sourcing_clients (code, name) values ('VJB','Client Two') returning id")).rows[0].id;
const be = (await asSuper("insert into public.sourcing_billing_entities (code, name, region, market) values ('BE-VJ','Northgate Brand Services GmbH','EMEA','Germany') returning id")).rows[0].id;

async function po(supplier, client, { status = "accepted", market = "DE", region = "EMEA", value = 1000 } = {}) {
  const job = (await as("agent", "insert into public.jobs (title, client_id, billing_entity_id, region, market, budget) values ('Vendor job',$1,$2,$3,'Germany',5000) returning id", [client, be, region])).rows[0].id;
  const spec = (await as("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Header','2d') returning id", [job])).rows[0].id;
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Main',100)", [spec]);
  const est = (await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market, status, client_order_ref) values ($1,$2,'rfq','EUR',$3,15,$4,'DE','approved','X') returning id", [job, supplier, value, region])).rows[0].id;
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,100,$3,$4)", [est, spec, value / 100, value]);
  return (await asSuper("insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, delivery_date, required_doa_level, status, region, market) values ($1,$2,$3,'EUR',$4,$5,0,$6,$7,$8) returning id", [job, est, supplier, value, day(10), status, region, market])).rows[0].id;
}
async function invoice(poId, supplier, jobOf, status, { due = day(10), paid = false } = {}) {
  const job = (await asSuper("select job_id from public.purchase_orders where id = $1", [poId])).rows[0].job_id;
  const i = (await asSuper("insert into public.supplier_invoices (invoice_ref, po_id, supplier_id, job_id, invoice_number, invoice_date, payment_terms, payment_terms_days, due_date, currency, net_amount, region, market, status, paid_at) values ('x',$1,$2,$3,$4,$5,'net_30',30,$6,'EUR',500,'EMEA','DE',$7,$8) returning id",
    [poId, supplier, job, `INV-${Math.random().toString(36).slice(2, 8)}`, day(-5), due, status, paid ? new Date().toISOString() : null])).rows[0].id;
  return i;
}
const jobs = async (user, ...args) => (await as(user, "select public.srm_vendor_jobs($1,$2,$3,$4,$5,$6,$7,$8) as r", [args[0] ?? null, args[1] ?? null, args[2] ?? null, args[3] ?? null, args[4] ?? null, args[5] ?? null, args[6] ?? null, args[7] ?? 500])).rows[0].r;

const p1 = await po(sA, clientA);                       // no invoice yet
const p2 = await po(sA, clientB, { value: 2000 });      // invoice received
await invoice(p2, sA, null, "submitted");
const p3 = await po(sB, clientA, { market: "FR" });     // approved, then scheduled with a payment date
const i3 = await invoice(p3, sB, null, "scheduled", { due: day(-2) });
await asSuper("insert into public.payment_schedule_items (invoice_id, seq, due_date, amount, currency) values ($1,1,$2,500,'EUR')", [i3, day(-2)]);
const p4 = await po(sB, clientB);                       // paid
await invoice(p4, sB, null, "paid", { paid: true });
await po(sB, clientB, { status: "cancelled" });         // not a live order

test("every vendor and job across all clients shows, with the payment stage and the expected date", async () => {
  const r = await jobs("lead");
  assert.equal(r.rows.length, 4);
  const by = Object.fromEntries(r.rows.map((x) => [x.po_id, x]));
  assert.deepEqual([by[p1].stage, by[p2].stage, by[p3].stage, by[p4].stage], ["no_invoice", "invoice_received", "scheduled", "paid"]);
  assert.equal(by[p3].expected_date, day(-2));
  assert.equal(by[p3].overdue, true);   // scheduled for two days ago and not paid
  assert.ok(!by[p4].overdue && by[p4].paid_at);
  assert.deepEqual([by[p1].client_name, by[p2].client_name], ["Client One", "Client Two"]);
  assert.deepEqual([r.summary.total, r.summary.no_invoice, r.summary.invoice_received, r.summary.scheduled, r.summary.paid, r.summary.overdue], [4, 1, 1, 1, 1, 1]);
  assert.equal(r.rows[0].po_id, p3); // overdue first
});

test("filters by vendor, client, market, stage and the overdue view", async () => {
  assert.equal((await jobs("lead", sA)).rows.length, 2);
  assert.equal((await jobs("lead", null, clientB)).rows.length, 2);
  assert.equal((await jobs("lead", null, null, null, "FR")).rows.length, 1);
  assert.equal((await jobs("lead", null, null, null, null, "paid")).rows.length, 1);
  assert.deepEqual((await jobs("lead", null, null, null, null, "overdue")).rows.map((x) => x.po_id), [p3]);
  assert.equal((await jobs("lead", null, null, null, null, null, null, day(1))).rows.length, 4);   // ordered up to tomorrow
  assert.equal((await jobs("lead", null, null, null, null, null, day(1))).rows.length, 0);          // ordered from tomorrow
  assert.equal((await jobs("lead", null, null, null, null, null, null, day(-30))).rows.length, 0);
});

test("the SRT sees payment status but no money; leads and admins see amounts", async () => {
  const srt = await jobs("agent");          // srt_role agent = the Supplier Relationship Team
  assert.equal(srt.rows.length, 4);
  assert.equal(srt.summary.can_see_money, false);
  assert.ok(srt.rows.every((x) => x.po_value === undefined && x.invoice_amount === undefined && x.currency === undefined));
  assert.ok(srt.rows.every((x) => x.stage)); // status stays visible
  const lead = await jobs("lead");
  assert.equal(lead.summary.can_see_money, true);
  assert.ok(lead.rows.some((x) => Number(x.po_value) === 2000));
  assert.equal((await jobs("admin")).summary.can_see_money, true);
});

test("vendors and non-staff cannot read it", async () => {
  await rejects(as(V1, "select public.srm_vendor_jobs()"), /staff|permission|not allowed|internal/i);
  await rejects(as("agent", "select * from public.srm_vendor_job_rows"), /permission denied/);
});
