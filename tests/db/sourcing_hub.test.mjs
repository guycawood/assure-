// Sourcing Hub parity: HS code gate on promo RFQs, spec revisions with re-quote flags, up to 12 quantity breaks,
// incoterms, delivery points, rate-card exceptions, RFQ copy for reorders, sealed vendor quote details and alternatives,
// view-only vendors blocked, estimate cost split / commission / rebate, client POs (sum check), the Stocktool hand-off.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

const V = {
  vA: "00000000-0000-0000-0000-0000000000d1", // vendor A portal admin
  vAview: "00000000-0000-0000-0000-0000000000d2", // vendor A colleague, view-only
  vB: "00000000-0000-0000-0000-0000000000d3", // vendor B portal admin
};
Object.assign(ids, V);
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];
const future = (days = 7) => new Date(Date.now() + days * 864e5).toISOString();

async function lib(key, code, name, data) {
  const { rows } = await asSuper(
    "insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id",
    [key, code, name, JSON.stringify(data)],
  );
  return rows[0].id;
}
async function supplier(code, name, email) {
  const { rows } = await asSuper(
    "insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id",
    [code, name, email],
  );
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [rows[0].id]);
  return rows[0].id;
}

// ---------- fixtures ----------
const subId = await lib("substrates", "SB-H350", "Hub board 350gsm", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
await lib("sourcing_control_matrix", "H-SCM-1", "Under 5k", { min_value_eur: 0, max_value_eur: 4999.99, suppliers_in_country: 2, suppliers_cross_border: 0 });
await lib("sourcing_control_matrix", "H-SCM-2", "5k and over", { min_value_eur: 5000, max_value_eur: null, suppliers_in_country: 2, suppliers_cross_border: 0 });
await lib("incoterms", "DDP", "Delivered Duty Paid", {});
await lib("incoterms", "FCA", "Free Carrier", {});
const bmId = await lib("branding_methods", "BM-SCREEN", "Screen print", {});
const aqlId = await lib("aql_levels", "AQL-2.5", "AQL 2.5 (general level II)", {});

const sA = await supplier("H-A", "Alpha Promo", "a@alpha-h.example");
const sB = await supplier("H-B", "Beta Promo", "b@beta-h.example");
const sC = await supplier("H-C", "Gamma Promo", "c@gamma-h.example");
await lib("rate_cards", "RC-H1", "A2 poster 350gsm", { spec_type: "2d", substrate_code: "SB-H350", finished_length_mm: 600, finished_width_mm: 400, min_qty: 100, max_qty: 5000, unit_price: 2, currency: "EUR", supplier_code: "H-A" });
await asSuper("insert into public.supplier_team_members (supplier_id, email, permission_level, status) values ($1, 'view@alpha-h.example', 'viewer', 'pending')", [sA]);
await asSuper("insert into auth.users (id, email) values ($1,'a@alpha-h.example'), ($2,'view@alpha-h.example'), ($3,'b@beta-h.example')", [V.vA, V.vAview, V.vB]);

const { rows: [client] } = await asSuper(
  "insert into public.sourcing_clients (code, name, min_quotes_required, default_markup_percent, gsc_commission_percent, year_end_rebate_percent) values ('HUB','Hub Client',2,10,2,3) returning id",
);
const { rows: [be] } = await asSuper("insert into public.sourcing_billing_entities (code, name, region, market) values ('BE-HDE','adm Indicia GmbH','EMEA','Germany') returning id");

async function newJob(title = "Promo job") {
  return one("agent", "insert into public.jobs (title, client_id, billing_entity_id, region, market) values ($1,$2,$3,'EMEA','Germany') returning id, job_number", [title, client.id, be.id]);
}
async function promoSpec(jobId, { title = "Branded tote bag", hs = null, qty = 500 } = {}) {
  const s = await one("agent", `insert into public.job_specs (job_id, title, spec_type, spec_form, product_category, product_sub_type, material, branding_method_id,
      aql_level_id, testing_checklist, units_per_outer, reusable, number_of_uses, recycled_content_percent, origin_country, moq, net_weight_kg, gross_weight_kg, hs_code)
    values ($1,$2,'promo_merch','fixed','Bags','Tote','Cotton 180gsm',$3,$4,'{pre_screen,final_inspection}',100,true,50,30,'China',250,0.18,0.2,$5) returning id`,
  [jobId, title, bmId, aqlId, hs]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Natural',$2), ($1,'Black',$3)", [s.id, qty, Math.round(qty / 2)]);
  await as("agent", "select public.spec_triage_run($1)", [s.id]);
  return s.id;
}
const breaks = [500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];

// ---------- tests ----------
test("structured promo fields: library references are checked and guarded; testing checklist is a fixed list", async () => {
  const j = await newJob();
  const s = await promoSpec(j.id);
  const r = await one("agent", "select spec_form, revision, branding_method_name, aql_level_name from public.v_specs where id = $1", [s]);
  assert.deepEqual([r.spec_form, r.revision, r.branding_method_name, r.aql_level_name], ["fixed", 1, "Screen print", "AQL 2.5 (general level II)"]);
  const ref = await one("agent", "select count(*)::int n from public.library_refs where record_id = $1 and ref_id = $2", [bmId, s]);
  assert.equal(ref.n, 1);
  await rejects(as("admin", "select public.library_delete($1, null)", [bmId]), /In use/);
  await rejects(as("agent", "update public.job_specs set branding_method_id = $1 where id = $2", [aqlId, s]), /branding methods library/);
  await rejects(as("agent", "update public.job_specs set testing_checklist = '{x_ray}' where id = $1", [s]), /check constraint|violates/);
  await rejects(as("agent", "update public.job_specs set spec_form = 'loose' where id = $1", [s]), /check constraint|violates/);
  // users can't set the revision
  await as("agent", "update public.job_specs set revision = 9 where id = $1", [s]);
  assert.equal((await one("agent", "select revision from public.job_specs where id = $1", [s])).revision, 1);
});

let rfq, spec, lineId, points;
test("more than 6 quantity breaks are accepted (up to 12); incoterms come from the library", async () => {
  const j = await newJob("Tote bags");
  spec = await promoSpec(j.id);
  const versions = (await as("agent", "select id, name from public.spec_versions where spec_id = $1 order by sort, created_at", [spec])).rows;
  const tooMany = [{ spec_id: spec, quantity_breaks: Array.from({ length: 13 }, (_, i) => (i + 1) * 100) }];
  await rejects(as("agent", "select public.rfq_create($1,'x',$2,1000,$3)", [j.id, future(), JSON.stringify(tooMany)]), /up to 12 quantity breaks/);
  await rejects(as("agent", "select public.rfq_create($1,'x',$2,1000,$3,null,$4)", [j.id, future(), JSON.stringify([{ spec_id: spec, quantity_breaks: [500] }]), JSON.stringify({ incoterm: "XYZ" })]), /not an active record/);
  const lines = [
    { spec_id: spec, spec_version_id: versions[0].id, quantity_breaks: breaks, run_on_quantity: 100, incoterm: "DDP", delivery_date: "2026-12-01",
      delivery_points: [{ label: "Berlin DC", country: "Germany", quantity: 300 }, { label: "Munich DC", country: "Germany", quantity: 200 }] },
    { spec_id: spec, spec_version_id: versions[1].id, quantity_breaks: [250, 500] },
  ];
  rfq = (await one("agent", "select public.rfq_create($1,'Tote bags',$2,1000,$3,null,$4) as id",
    [j.id, future(), JSON.stringify(lines), JSON.stringify({ incoterm: "FCA", incoterm_place: "Ningbo" })])).id;
  const r = await one("agent", "select incoterm_code, incoterm_place, line_count from public.v_rfqs where id = $1", [rfq]);
  assert.deepEqual([r.incoterm_code, r.incoterm_place, r.line_count], ["FCA", "Ningbo", 2]);
  const l = (await as("agent", "select id, quantity_breaks, variant_label, run_on_quantity from public.rfq_lines where rfq_id = $1 order by line_no", [rfq])).rows;
  assert.equal(l[0].quantity_breaks.length, 9);
  assert.deepEqual([l[0].variant_label, l[0].run_on_quantity, l[1].variant_label], ["Natural", 100, "Black"]);
  lineId = l[0].id;
  points = (await as("agent", "select id, label from public.rfq_line_delivery_points where line_id = $1 order by point_no", [lineId])).rows;
  assert.equal(points.length, 2);
});

test("HS code is required to send an RFQ with promo lines; the sent revision is recorded", async () => {
  await as("agent", "select public.rfq_set_suppliers($1,$2)", [rfq, JSON.stringify([sA, sB])]);
  await rejects(as("agent", "select public.rfq_send($1)", [rfq]), /need an HS code/);
  await as("agent", "update public.job_specs set hs_code = '4202.92' where id = $1", [spec]); // not sent yet: a plain edit
  await as("agent", "select public.rfq_send($1)", [rfq]);
  const l = await one("agent", "select spec_revision from public.rfq_lines where id = $1", [lineId]);
  assert.equal(l.spec_revision, 1);
  const rev = await one("agent", "select count(*)::int n from public.spec_revisions where spec_id = $1 and revision = 1", [spec]);
  assert.equal(rev.n, 1);
});

test("editing a spec after send creates a new revision and asks invited suppliers to re-quote", async () => {
  await rejects(as("agent", "update public.job_specs set material = 'Jute' where id = $1", [spec]), /locked/);
  await rejects(as("agent", "select public.spec_revise($1,$2,'')", [spec, JSON.stringify({ material: "Jute" })]), /change note/);
  await rejects(as("vA", "select public.spec_revise($1,$2,'x')", [spec, JSON.stringify({ material: "Jute" })]), /Only internal/);
  const v = await one("agent", "select id from public.spec_versions where spec_id = $1 and name = 'Natural'", [spec]);
  const rev = await one("agent", "select public.spec_revise($1,$2,'Material changed to jute; Natural quantity up') as r",
    [spec, JSON.stringify({ material: "Jute", versions: [{ id: v.id, quantity: 600 }] })]);
  assert.equal(rev.r, 2);
  const s = await one("agent", "select revision, material, on_live_rfq from public.v_specs where id = $1", [spec]);
  assert.deepEqual([s.revision, s.material, s.on_live_rfq], [2, "Jute", true]);
  const revs = (await as("agent", "select revision, change_note, snapshot->>'material' as material from public.spec_revisions where spec_id = $1 order by revision", [spec])).rows;
  assert.deepEqual(revs.map((r) => [r.revision, r.material]), [[1, "Cotton 180gsm"], [2, "Jute"]]);
  // the sent revision on the line is unchanged
  assert.equal((await one("agent", "select spec_revision from public.rfq_lines where id = $1", [lineId])).spec_revision, 1);
  const r = await one("agent", "select spec_changed, requote_pending from public.v_rfqs where id = $1", [rfq]);
  assert.deepEqual([r.spec_changed, r.requote_pending], [true, 2]);
  const n = await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title like 'Spec changed%'", [V.vA]);
  assert.equal(n.rows[0].n, 1);
  const view = (await one("vA", "select public.rfq_vendor_view($1) as v", [rfq])).v;
  assert.equal(view.invitation.requote_needed, true);
  assert.equal(view.lines[0].spec_changes.length, 1);
  assert.equal(view.lines[0].spec.material, "Jute");
  assert.equal(view.rfq.incoterm, "FCA");
});

test("vendor quote details and alternatives are sealed from other vendors; resubmitting clears the re-quote flag", async () => {
  const l2 = (await one("agent", "select id from public.rfq_lines where rfq_id = $1 and line_no = 2", [rfq])).id;
  const quote = {
    prices: [{ line_id: lineId, quantity: 500, unit_price: 3.1 }, { line_id: lineId, quantity: 1000, unit_price: 2.9 }, { line_id: l2, quantity: 250, unit_price: 3.4 }],
    lines: [{ line_id: lineId, carton_length_cm: 60, carton_width_cm: 40, carton_height_cm: 30, units_per_carton: 100, gross_weight_kg: 0.21, net_weight_kg: 0.19,
      hs_code: "4202.92", country_of_origin: "India", lead_time_days: 35, run_on_price: 260, sample_cost: 45, recycled_content_percent: 40, reusable: true, number_of_uses: 100 }],
    alternatives: [{ line_id: lineId, description: "SECRET-ALT recycled cotton tote", quantity: 500, unit_price: 2.75 }],
    point_prices: [{ delivery_point_id: points[0].id, unit_price: 3.15 }, { delivery_point_id: points[1].id, unit_price: 3.2 }],
  };
  await rejects(as("vAview", "select public.rfq_submit_quote($1,$2,30,null,true)", [rfq, JSON.stringify(quote)]), /view-only/);
  const qa = (await one("vA", "select public.rfq_submit_quote($1,$2,30,'A',true) as id", [rfq, JSON.stringify(quote)])).id;
  const qb = (await one("vB", "select public.rfq_submit_quote($1,$2,28,'B',true) as id", [rfq,
    JSON.stringify({ prices: [{ line_id: lineId, quantity: 500, unit_price: 3.3 }, { line_id: l2, quantity: 250, unit_price: 3.5 }] })])).id;
  assert.ok(qa && qb);
  // B sees nothing of A's
  for (const tbl of ["rfq_response_alternatives", "rfq_response_lines", "rfq_response_point_prices", "rfq_line_delivery_points", "spec_revisions"]) {
    assert.equal((await one("vB", `select count(*)::int n from public.${tbl}`)).n, 0, tbl);
  }
  const vb = (await one("vB", "select public.rfq_vendor_view($1) as v", [rfq])).v;
  assert.ok(!JSON.stringify(vb).includes("SECRET-ALT"));
  assert.equal(vb.quote.alternatives.length, 0);
  assert.equal(vb.lines[0].delivery_points.length, 2); // the RFQ's own delivery points are shared with invited suppliers
  const va = (await one("vA", "select public.rfq_vendor_view($1) as v", [rfq])).v;
  assert.equal(va.quote.alternatives[0].description, "SECRET-ALT recycled cotton tote");
  assert.equal(Number(va.quote.lines[0].run_on_price), 260);
  assert.equal(va.quote.point_prices.length, 2);
  assert.equal(va.invitation.requote_needed, false);
  // internal staff see it all
  assert.equal((await one("agent", "select count(*)::int n from public.rfq_response_alternatives where response_id = $1", [qa])).n, 1);
  const inv = await one("agent", "select requote_needed, requoted_at from public.rfq_invitations where rfq_id = $1 and supplier_id = $2", [rfq, sA]);
  assert.equal(inv.requote_needed, false);
  assert.ok(inv.requoted_at);
  // totals are calculated from unit prices: 500 x 3.10 + 250 x 3.40
  assert.equal(Number((await one("agent", "select total_value from public.rfq_responses where id = $1", [qa])).total_value), 2400);
});

test("rate-card exception: an Adopt line can go to RFQ only with a reason", async () => {
  const j = await newJob("Posters");
  const { id: s } = await one("agent", "insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id) values ($1,'A2 poster','2d','mm',$2) returning id", [j.id, subId]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',1000,600,400)", [s]);
  await as("agent", "select public.spec_triage_run($1)", [s]);
  const lines = JSON.stringify([{ spec_id: s, quantity_breaks: [1000] }]);
  await rejects(as("agent", "select public.rfq_create($1,'x',$2,2000,$3)", [j.id, future(), lines]), /routed Adopt/);
  await rejects(as("agent", "select public.rfq_create($1,'x',$2,2000,$3,null,$4)", [j.id, future(), lines, JSON.stringify({ rate_card_exception: true })]), /reason for the rate-card exception/);
  const id = (await one("agent", "select public.rfq_create($1,'x',$2,2000,$3,null,$4) as id", [j.id, future(), lines,
    JSON.stringify({ rate_card_exception: true, rate_card_exception_reason: "Client wants a market test" })])).id;
  const r = await one("agent", "select rate_card_exception, rate_card_exception_reason from public.rfqs where id = $1", [id]);
  assert.deepEqual([r.rate_card_exception, r.rate_card_exception_reason], [true, "Client wants a market test"]);
});

test("copy an RFQ for a reorder: same lines, delivery points and eligible suppliers, linked to the original", async () => {
  await rejects(as("vA", "select public.rfq_copy($1)", [rfq]), /Only internal/);
  const id = (await one("agent", "select public.rfq_copy($1, 'Tote bags reorder') as id", [rfq])).id;
  const r = await one("agent", "select status, title, copied_from_rfq_number, line_count, invited_count, incoterm_code from public.v_rfqs where id = $1", [id]);
  const orig = await one("agent", "select rfq_number from public.rfqs where id = $1", [rfq]);
  assert.deepEqual([r.status, r.title, r.copied_from_rfq_number, r.line_count, r.invited_count, r.incoterm_code], ["draft", "Tote bags reorder", orig.rfq_number, 2, 2, "FCA"]);
  const dp = await one("agent", "select count(*)::int n from public.rfq_line_delivery_points dp join public.rfq_lines l on l.id = dp.line_id where l.rfq_id = $1", [id]);
  assert.equal(dp.n, 2);
});

let est;
test("estimate: cost split, GSC commission and client rebate in the sell price", async () => {
  const j = await newJob("Estimate job");
  const { id: s } = await one("agent", "insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id) values ($1,'Card poster','2d','mm',$2) returning id", [j.id, subId]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',1000,600,400)", [s]);
  await as("agent", "select public.spec_triage_run($1)", [s]); // exact rate-card match: Adopt at 2.00
  await as("agent", "select public.estimate_create_from_triage($1)", [j.id]);
  const e = await one("agent", "select id, base_cost, gsc_commission_percent, rebate_percent, sell_price from public.estimates where job_id = $1", [j.id]);
  est = e.id;
  // rates come from the client's commercial rules; 2000 x 1.10 / (1 - 5%) = 2315.79
  assert.deepEqual([Number(e.base_cost), Number(e.gsc_commission_percent), Number(e.rebate_percent), Number(e.sell_price)], [2000, 2, 3, 2315.79]);
  await rejects(as("agent", "select public.estimate_set_cost_lines($1,$2)", [est, JSON.stringify([{ category: "magic", amount: 10 }])]), /cost category/);
  const total = await one("agent", "select public.estimate_set_cost_lines($1,$2) as t", [est, JSON.stringify([{ category: "logistics", amount: 100 }, { category: "inspection", amount: 50, description: "Final inspection" }])]);
  assert.equal(Number(total.t), 150);
  let x = await one("agent", "select additional_cost, sell_price from public.estimates where id = $1", [est]);
  assert.deepEqual([Number(x.additional_cost), Number(x.sell_price)], [150, 2489.47]); // 2150 x 1.10 / 0.95
  await as("agent", "select public.estimate_set_commercials($1, 0, 0)", [est]);
  x = await one("agent", "select sell_price from public.estimates where id = $1", [est]);
  assert.equal(Number(x.sell_price), 2365);
  await as("agent", "select public.estimate_set_commercials($1, 2, 3)", [est]);
  await rejects(as("vA", "select public.estimate_set_commercials($1, 0, 0)", [est]), /Only internal/);
  // system writes (seeds, imports) keep what they set
  const { rows: [raw] } = await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market) values ($1,$2,'rfq','EUR',1000,10,'EMEA','Germany') returning sell_price", [j.id, sA]);
  assert.equal(Number(raw.sell_price), 1100);
});

test("client POs: many per estimate, never more than the sell price; order flags follow", async () => {
  await rejects(as("agent", "select public.estimate_add_client_po($1,'CPO-1',100)", [est]), /once the estimate is with the client/);
  await as("agent", "select public.estimate_send($1)", [est]);
  assert.equal((await one("agent", "select order_flag from public.v_estimates where id = $1", [est])).order_flag, "pending_estimate_approval");
  await as("agent", "select public.estimate_add_client_po($1,'CPO-1',1500,'2026-10-01')", [est]);
  await as("agent", "select public.estimate_add_client_po($1,'CPO-2',900)", [est]);
  await rejects(as("agent", "select public.estimate_add_client_po($1,'CPO-3',200)", [est]), /more than the estimate sell price/);
  await rejects(as("agent", "select public.estimate_add_client_po($1,'cpo-2',10)", [est]), /already on this estimate/);
  await rejects(as("agent", "insert into public.client_pos (estimate_id, po_number, amount, currency) values ($1,'X',1,'EUR')", [est]), /permission denied/);
  await as("agent", "select public.estimate_approve($1, null)", [est]);
  let e = await one("agent", "select order_flag, client_po_total, client_po_count from public.v_estimates where id = $1", [est]);
  assert.deepEqual([e.order_flag, Number(e.client_po_total), e.client_po_count], ["po_pending", 2400, 2]);
  await as("agent", "select public.estimate_add_client_po($1,'CPO-3',89.47)", [est]);
  e = await one("agent", "select order_flag from public.v_estimates where id = $1", [est]);
  assert.equal(e.order_flag, "po_received");
});

test("Stocktool hand-off payload carries the new fields; missing data is listed and can be refreshed", async () => {
  const o = await one("agent", "select payload from public.integration_outbox where aggregate_id = $1 and event = 'estimate.approved'", [est]);
  const p = o.payload;
  assert.equal(p.client_pos.length, 2);
  assert.equal(p.incoterm, "DDP");
  assert.deepEqual(p.cost_split.map((c) => c.category), ["product", "logistics", "inspection"]);
  assert.equal(Number(p.gsc_commission_percent), 2);
  assert.equal(p.supplier_vat_country, "Germany");
  assert.deepEqual(p.missing_fields, ["HS code", "Net weight", "Gross weight", "Country of origin"]);
  const h = await one("agent", "select missing_fields, outbox_status from public.v_sourcing_handoff where id = $1", [est]);
  assert.deepEqual(h.missing_fields, ["HS code", "Net weight", "Gross weight", "Country of origin"]);
  assert.equal(h.outbox_status, "queued");
  const spec = (await one("agent", "select spec_id from public.estimate_lines where estimate_id = $1", [est])).spec_id;
  await as("agent", "select public.spec_revise($1,$2,'Article data from the supplier')", [spec,
    JSON.stringify({ hs_code: "4911.10", origin_country: "Poland", net_weight_kg: 0.08, gross_weight_kg: 0.09, moq: 500 })]);
  const missing = await one("agent", "select public.estimate_refresh_handoff($1) as m", [est]);
  assert.deepEqual(missing.m, []);
  const o2 = await one("agent", "select payload from public.integration_outbox where aggregate_id = $1", [est]);
  assert.equal(o2.payload.articles[0].hs_code, "4911.10");
  assert.equal(o2.payload.articles[0].origin_country, "Poland");
  assert.equal(o2.payload.articles[0].moq, 500);
  assert.equal(Number(o2.payload.articles[0].net_weight_kg), 0.08);
  assert.equal((await one("vA", "select count(*)::int n from public.v_sourcing_handoff")).n, 0);
});
