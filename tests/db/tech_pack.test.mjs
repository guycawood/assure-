// Vendor technical & packaging data sheet: required fields by level / category / market / stage, completeness in plain
// words, vendor isolation and the viewer gate, the quote-stage proposal with a "to be confirmed by" date, the pre-shipment
// gate, declared vs measured (verified / mismatch + quality review), the Stocktool hand-off, logistics weight defaults and
// pre-fill from a verified sheet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V = { vA: "00000000-0000-0000-0000-0000000000e1", vB: "00000000-0000-0000-0000-0000000000e2", vAview: "00000000-0000-0000-0000-0000000000e3" };
Object.assign(ids, V);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

async function lib(key, code, name, data) {
  await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01')",
    [key, code, name, JSON.stringify(data)]);
}
await lib("packaging_materials", "PM-CORR", "Corrugated board", { material_group: "paper" });
await lib("packaging_materials", "PM-LDPE", "LDPE film", { material_group: "plastic" });
await lib("packaging_materials", "PM-WOOD", "Wood pallet", { material_group: "wood" });
await lib("substrates", "SB-T350", "Test board 350gsm", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
await lib("tech_sheet_requirements", "TSR-Q", "Quote packing", { stage: "quote", fields: ["units_per_carton", "carton_dims", "packing_method"], explanation: "Proposed packing for freight." });
await lib("tech_sheet_requirements", "TSR-PO", "PO basics", { stage: "po_acceptance", fields: ["product_dims", "net_weight", "origin_country", "hs_code", "carton_gross_weight"], explanation: "Basics." });
await lib("tech_sheet_requirements", "TSR-L3", "Unit pack at L3+", { stage: "po_acceptance", min_level: 3, fields: ["primary_pack", "protective_fill"], explanation: "L3 and above." });
await lib("tech_sheet_requirements", "TSR-3D", "3D components", { stage: "po_acceptance", spec_types: ["3d"], fields: ["components"], explanation: "3D items list their parts." });
await lib("tech_sheet_requirements", "TSR-EU", "EU / UK packaging", { stage: "po_acceptance", markets: ["DE", "FR", "NL", "GB"], fields: ["carton_materials", "carton_material_weights", "carton_recycled"], explanation: "Packaging rules." });
await lib("tech_sheet_requirements", "TSR-PRE", "Marking before shipping", { stage: "pre_shipment", fields: ["carton_marking"], explanation: "Marking." });

const sup = async (code, email) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email, active, purchasing_blocked) values ($1,$1,'Germany','EMEA',$2,true,false) returning id", [code, email])).rows[0].id;
const sA = await sup("T-A", "ta@alpha-t.example");
const sB = await sup("T-B", "tb@beta-t.example");
await asSuper("insert into public.performance_records (supplier_id, period, quality_score) values ($1,'2026-Q2',85), ($2,'2026-Q2',85)", [sA, sB]);
await asSuper("insert into auth.users (id, email) values ($1,'ta@alpha-t.example'), ($2,'tb@beta-t.example')", [V.vA, V.vB]);
await as("vA", "select public.vendor_team_invite('view@alpha-t.example','viewer')");
await asSuper("insert into auth.users (id, email) values ($1,'view@alpha-t.example')", [V.vAview]);
const client = (await asSuper("insert into public.sourcing_clients (code, name) values ('TPC','Tech Pack Client') returning id")).rows[0].id;

async function makeSpec({ market = "Germany", region = "EMEA", type = "2d", title = "Counter card", electronics = false } = {}) {
  const job = await one("agent", "insert into public.jobs (title, client_id, region, market) values ('Tech job',$1,$2,$3) returning id", [client, region, market]);
  const s = await one("agent", "insert into public.job_specs (job_id, title, spec_type, has_lighting_electronics) values ($1,$2,$3,$4) returning id", [job.id, title, type, electronics]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Standard',500)", [s.id]);
  return { job: job.id, spec: s.id };
}
async function makePo({ supplierId = sA, market = "Germany", region = "EMEA", type = "2d", title = "Counter card", qty = 500, spec = null } = {}) {
  const S = spec ?? await makeSpec({ market, region, type, title });
  const est = (await asSuper("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, region, market, status) values ($1,$2,'rfq','EUR',1000,$3,$4,'approved') returning id",
    [S.job, supplierId, region, market])).rows[0];
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,$3,2,1000)", [est.id, S.spec, qty]);
  const po = (await asSuper(`insert into public.purchase_orders (job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, required_doa_level, status, region, market, created_by)
    values ($1,$2,$3,'EUR',1000,current_date,$4,0,'pending_approval',$5,$6,$7) returning id`, [S.job, est.id, supplierId, day(20), region, market, ids.agent])).rows[0];
  await asSuper("update public.purchase_orders set status = 'issued', approved_at = now() where id = $1", [po.id]);
  await asSuper("update public.purchase_orders set status = 'accepted', vendor_responded_at = now() where id = $1", [po.id]);
  const plan = (await asSuper("select * from public.qaqc_plans where po_id = $1", [po.id])).rows[0];
  return { ...S, po: po.id, estimate: est.id, plan };
}
const codes = (req) => req.map((r) => r.code);
const pre = async (planId) => (await asSuper("select * from public.qaqc_checkpoints where plan_id = $1 and checkpoint = 'pre_shipment'", [planId])).rows[0];
async function upload(user, checkpointId, supplierId, type) {
  return (await one(user, "select public.file_register('orders','qaqc_checkpoint',$1,$2,'e.jpg',$3,10,'aGVsbG8=',null,'X') id", [checkpointId, supplierId, type])).id;
}
const FULL = (gross = 10) => ({
  length_mm: 300, width_mm: 200, height_mm: 5, net_weight_g: 120, origin_country: "Poland", hs_code: "4911.10", packing_method: "Shrink-wrapped in 25s",
  materials: [{ substrate_code: "SB-T350", share_pct: 100, weight_g: 120, recycled_pct: 30 }],
  packs: [
    { level: "primary", not_used: true },
    { level: "secondary", units_per_pack: 50, length_mm: 400, width_mm: 300, height_mm: 250, gross_weight_kg: gross, labelling: "PO number and SKU on two sides", protective_fill: "None",
      materials: [{ material_code: "PM-CORR", component: "Outer carton", weight_g: 600, recycled_pct: 80, reusable: false }] },
    { level: "tertiary", not_used: true },
  ],
});

test("required fields depend on stage, QA/QC level, spec type and destination market", async () => {
  const de = await makeSpec();
  const q = (await one("agent", "select public.tech_sheet_required_fields($1,$2,'quote') r", [de.spec, sA])).r;
  assert.deepEqual(codes(q), ["packing_method", "units_per_carton", "carton_dims"]);
  const po = codes((await one("agent", "select public.tech_sheet_required_fields($1,$2,'po_acceptance') r", [de.spec, sA])).r);
  for (const c of ["product_dims", "net_weight", "origin_country", "hs_code", "carton_gross_weight", "carton_materials", "carton_recycled", "units_per_carton"]) assert.ok(po.includes(c), c);
  assert.ok(!po.includes("components") && !po.includes("primary_pack") && !po.includes("carton_marking"));
  const ps = codes((await one("agent", "select public.tech_sheet_required_fields($1,$2,'pre_shipment') r", [de.spec, sA])).r);
  assert.ok(ps.includes("carton_marking"));
  // Not an EU / UK market: no packaging-by-material fields.
  const sg = await makeSpec({ market: "Singapore", region: "APAC" });
  assert.ok(!codes((await one("agent", "select public.tech_sheet_required_fields($1,$2,'po_acceptance') r", [sg.spec, sA])).r).includes("carton_materials"));
  // 3D spec adds components; electronics lift the QA/QC level to L3, which adds the unit pack.
  const d3 = await makeSpec({ type: "3d" });
  assert.ok(codes((await one("agent", "select public.tech_sheet_required_fields($1,$2,'po_acceptance') r", [d3.spec, sA])).r).includes("components"));
  const el = await makeSpec({ electronics: true });
  const elReq = (await one("agent", "select public.tech_sheet_required_fields($1,$2,'po_acceptance') r", [el.spec, sA])).r;
  assert.ok(codes(elReq).includes("primary_pack"));
  assert.match(elReq.find((x) => x.code === "primary_pack").rules[0].why, /L3/);
  await rejects(as("vB", "select public.tech_sheet_required_fields($1,$2,'quote')", [de.spec, sB]), /not found/);
  await rejects(as("agent", "select public.tech_sheet_required_fields($1,$2,'shipping')", [de.spec, sA]), /Unknown stage/);
});

test("completeness gives a percentage and the missing fields in plain words", async () => {
  const S = await makeSpec();
  const sheet = (await one("agent", "select public.tech_sheet_ensure($1,$2) id", [S.spec, sA])).id;
  const r = (await one("agent", "select public.tech_sheet_save($1,$2,false) r", [sheet, JSON.stringify({ length_mm: 300, width_mm: 200, height_mm: 5, hs_code: "4911.10" })])).r;
  const c = r.po_acceptance;
  assert.equal(c.complete, false);
  assert.ok(c.percent > 0 && c.percent < 100);
  assert.ok(c.missing.includes("Country of origin"));
  assert.ok(c.missing.includes("Gross weight of a full carton (kg)"));
  assert.ok(c.missing.includes("Carton weight by material (g)"));
  assert.ok(!c.missing.some((m) => /HS code|Finished product size/.test(m)));
  await rejects(as("agent", "select public.tech_sheet_save($1,$2,false)", [sheet, JSON.stringify({ materials: [{ substrate_code: "SB-T350", share_pct: 60 }, { material_name: "Ink", share_pct: 10 }] })]), /add up to 100% \(they add up to 70/);
  await rejects(as("agent", "select public.tech_sheet_save($1,$2,false)", [sheet, JSON.stringify({ tbc_by: day(-1) })]), /can't be in the past/);
  await as("agent", "select public.tech_sheet_save($1,$2,false)", [sheet, JSON.stringify(FULL())]);
  const full = (await one("agent", "select public.tech_sheet_completeness($1,'pre_shipment') c", [sheet])).c;
  assert.deepEqual([full.complete, full.percent, full.missing.length], [true, 100, 0]);
});

let A;
test("vendors write sheets only for their own POs; viewers are blocked; other vendors see nothing", async () => {
  A = await makePo();
  // PO issue opened a draft sheet (a rule applies) and the pre-shipment checkpoint now needs carton photos.
  const draft = (await asSuper("select * from public.spec_tech_sheets where po_id = $1", [A.po])).rows[0];
  assert.equal(draft.status, "draft");
  assert.equal(draft.source, "po");
  const c = await pre(A.plan.id);
  assert.ok(c.required_evidence.includes("PACKED_CARTON_PHOTO") && c.required_evidence.includes("CARTON_LABEL_PHOTO"));
  assert.ok(!c.required_evidence.includes("PALLET_PHOTO"));
  const r = (await one("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,false) r", [A.po, A.spec, JSON.stringify({ origin_country: "Poland" })])).r;
  assert.equal(r.sheet_id, draft.id);
  await rejects(as("vB", "select public.tech_sheet_vendor_save($1,$2,null,$3,false)", [A.po, A.spec, "{}"]), /not found/);
  await rejects(as("vAview", "select public.tech_sheet_vendor_save($1,$2,null,$3,false)", [A.po, A.spec, "{}"]), /view-only/);
  const other = await makeSpec();
  await rejects(as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,false)", [A.po, other.spec, "{}"]), /not on this purchase order/);
  assert.equal((await one("vB", "select count(*)::int n from public.spec_tech_sheets")).n, 0);
  assert.equal((await one("vA", "select count(*)::int n from public.spec_tech_sheets where id = $1", [draft.id])).n, 1);
  await rejects(as("vB", "select public.tech_sheet_completeness($1,'quote')", [draft.id]), /not found/);
  const panel = (await one("vA", "select public.tech_sheet_vendor_po($1) p", [A.po])).p;
  assert.equal(panel[0].sheet.sheet_ref, draft.sheet_ref);
  assert.ok(panel[0].required_pre.some((x) => x.code === "carton_marking"));
  await rejects(as("vB", "select public.tech_sheet_vendor_po($1)", [A.po]), /not found/);
  const list = (await one("vA", "select public.tech_sheet_vendor_list() l", [])).l;
  assert.ok(list.some((x) => x.sheet_id === draft.id && x.blocking === true));
});

async function submitPre(user, P, supplierId, measured) {
  const c = await pre(P.plan.id);
  const ev = [];
  for (const type of c.required_evidence) {
    const code = type.split("|")[0];
    ev.push({ type: code, file_id: await upload(user, c.id, supplierId, code === "COC" ? "application/pdf" : "image/jpeg"), issued_on: day(0) });
  }
  return (await one(user, "select public.qaqc_vendor_submit($1,$2,$3) r", [c.id, JSON.stringify(ev), JSON.stringify({ result: "pass", ...(measured ? { measured } : {}) })])).r;
}

test("the pre-shipment check is blocked until the sheet is complete, declared and the carton is measured; within tolerance verifies", async () => {
  await rejects(submitPre("vA", A, sA, null), /Complete the technical & packaging data sheet .* Still missing: .*Country|Still missing/);
  await as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,false)", [A.po, A.spec, JSON.stringify(FULL(10))]);
  await rejects(submitPre("vA", A, sA, null), /Declare the technical & packaging data sheet/);
  await as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,true)", [A.po, A.spec, "{}"]);
  await rejects(submitPre("vA", A, sA, null), /Enter what you measured/);
  // Measured in another orientation and 3% heavier: within ±5% and ±10 mm.
  const r = await submitPre("vA", A, sA, { gross_weight_kg: 10.3, length_mm: 298, width_mm: 405, height_mm: 252 });
  assert.equal(r.status, "auto_verified");
  assert.equal(r.tech_sheet.ok, true);
  const s = (await asSuper("select status, actual_gross_weight_kg, version from public.spec_tech_sheets where po_id = $1", [A.po])).rows[0];
  assert.equal(s.status, "verified");
  assert.equal(Number(s.actual_gross_weight_kg), 10.3);
  assert.equal(s.version, 1);
  assert.equal((await asSuper("select count(*)::int n from public.spec_tech_library l join public.spec_tech_sheets t on t.id = l.sheet_id where t.po_id = $1", [A.po])).rows[0].n, 1);
  assert.ok((await asSuper("select checks from public.qaqc_checkpoints where id = $1", [(await pre(A.plan.id)).id])).rows[0].checks.some((x) => x.code === "tech_sheet" && x.ok));
  await rejects(as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,false)", [A.po, A.spec, JSON.stringify({ notes: "x" })]), /verified against the goods/);
  // History: created, saved, declared (with a snapshot), verified.
  const ev = (await asSuper("select event, snapshot is not null as snap from public.spec_tech_sheet_events e join public.spec_tech_sheets t on t.id = e.sheet_id where t.po_id = $1 order by e.id", [A.po])).rows;
  assert.deepEqual(ev.map((e) => e.event).filter((e) => e !== "saved"), ["created", "declared", "verified"]);
  assert.ok(ev.find((e) => e.event === "declared").snap);
  await rejects(asSuper("update public.spec_tech_sheet_events set event = 'x'"), /append-only/);
});

test("a weight outside tolerance marks the sheet mismatch and sends the checkpoint to a quality review", async () => {
  const M = await makePo({ title: "Shelf barker" });
  await as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,true)", [M.po, M.spec, JSON.stringify(FULL(10))]);
  const r = await submitPre("vA", M, sA, { gross_weight_kg: 11.4, length_mm: 400, width_mm: 300, height_mm: 250 });
  assert.equal(r.status, "needs_review");
  const chk = r.checks.find((x) => x.code === "tech_sheet");
  assert.equal(chk.ok, false);
  assert.match(chk.detail, /Declared 10(\.000)? kg, measured 11\.4(00)? kg/);
  const cpId = (await pre(M.plan.id)).id;
  const c = (await asSuper("select verifier, status from public.qaqc_checkpoints where id = $1", [cpId])).rows[0];
  assert.deepEqual([c.verifier, c.status], ["auto", "needs_review"]);
  assert.equal((await asSuper("select status from public.spec_tech_sheets where po_id = $1", [M.po])).rows[0].status, "mismatch");
  assert.ok((await as("head", "select * from public.approvals_inbox('mine')")).rows.some((x) => x.approval_type === "QAQC_VERIFY" && x.item_id === cpId));
  const acc = (await one("agent", "select verified, mismatch, measurements, measurements_within, accuracy_pct from public.v_supplier_declaration_accuracy where supplier_id = $1", [sA]));
  assert.deepEqual([acc.verified, acc.mismatch, acc.measurements, acc.measurements_within, Number(acc.accuracy_pct)], [1, 1, 2, 1, 50]);
  const h = (await as("agent", "select metric, value from public.watchtower_health_tech_sheets")).rows;
  assert.equal(Number(h.find((x) => x.metric === "tech_mismatch_rate").value), 50);
  // The vendor can correct and declare again.
  await as("vA", "select public.tech_sheet_vendor_save($1,$2,null,$3,true)", [M.po, M.spec, JSON.stringify({ packs: FULL(11.4).packs })]);
  assert.equal((await asSuper("select status from public.spec_tech_sheets where po_id = $1", [M.po])).rows[0].status, "declared");
});

test("the Stocktool hand-off reads the verified sheet; deliveries default their weight from it", async () => {
  const p = (await asSuper("select public._estimate_handoff_payload($1) p", [A.estimate])).rows[0].p;
  const art = p.articles[0];
  assert.equal(art.data_basis, "verified");
  assert.ok(art.tech_sheet_ref.startsWith("TS-"));
  assert.equal(Number(art.gross_weight_kg), 0.2);       // 10 kg carton / 50 units
  assert.equal(Number(art.net_weight_kg), 0.12);
  assert.equal(art.hs_code, "4911.10");
  assert.equal(art.origin_country, "Poland");
  assert.deepEqual(art.carton_cm.map(Number), [40, 30, 25]);
  const miss = (await one("agent", "select missing_fields from public.v_sourcing_handoff where id = $1", [A.estimate])).missing_fields;
  assert.deepEqual(miss, ["Client PO"]);
  const d = (await asSuper("insert into public.deliveries (po_id, job_id, supplier_id, spec_id, quantity, region, market) values ($1,$2,$3,$4,120,'EMEA','DE') returning gross_weight_kg, weight_source",
    [A.po, A.job, sA, A.spec])).rows[0];
  assert.equal(Number(d.gross_weight_kg), 30);           // 3 cartons x 10 kg
  assert.match(d.weight_source, /^tech_sheet_verified:TS-/);
});

test("quote stage: a packaging proposal or a 'to be confirmed by' date becomes a draft sheet", async () => {
  const S = await makeSpec({ title: "Promo sleeve" });
  await asSuper("select set_config('sourcing.system_write','on',false)");
  const rfq = (await asSuper("insert into public.rfqs (job_id, title, status, due_at, region, market) values ($1,'Sleeves','sent',now() + interval '5 days','EMEA','Germany') returning id", [S.job])).rows[0].id;
  const line = (await asSuper("insert into public.rfq_lines (rfq_id, spec_id, line_no, quantity_breaks) values ($1,$2,1,'{500}') returning id", [rfq, S.spec])).rows[0].id;
  await asSuper("insert into public.rfq_invitations (rfq_id, supplier_id) values ($1,$2), ($1,$3)", [rfq, sA, sB]);
  await asSuper("select set_config('sourcing.system_write','off',false)");
  const quote = (pk) => JSON.stringify({ prices: [{ line_id: line, quantity: 500, unit_price: 1.2 }], lines: [{ line_id: line, units_per_carton: 100, carton_length_cm: 40, carton_width_cm: 30, carton_height_cm: 20 }], packaging: pk });
  await rejects(as("vA", "select public.rfq_submit_quote($1,$2,10,null,false)", [rfq, quote([{ line_id: line, tbc_by: day(-2) }])]), /can't be in the past/);
  await as("vA", "select public.rfq_submit_quote($1,$2,10,null,false)", [rfq, quote([{ line_id: line, packing_method: "Bundles of 100", tbc_by: day(10), tbc_note: "Carton weight after the sample" }])]);
  const s = (await asSuper("select * from public.spec_tech_sheets where spec_id = $1 and supplier_id = $2", [S.spec, sA])).rows[0];
  assert.deepEqual([s.status, s.source, s.tbc_by?.toISOString().slice(0, 10)], ["draft", "quote", day(10)]);
  const c = (await one("agent", "select public.tech_sheet_completeness($1,'quote') c", [s.id])).c;
  assert.equal(c.complete, true); // units per carton, carton size (from the quote line, cm -> mm) and packing method
  const v = (await one("vA", "select public.tech_sheet_vendor_quote($1) v", [rfq])).v;
  assert.equal(Number(v[0].carton_length_mm), 400);
  assert.equal(v[0].packing_method, "Bundles of 100");
  // The other supplier's quote stays sealed: B sees no sheet of A's.
  assert.equal((await one("vB", "select public.tech_sheet_vendor_quote($1) v", [rfq])).v[0].sheet_id, null);
  // Existing quote flows are unchanged: a plain array of prices still works.
  await as("vB", "select public.rfq_submit_quote($1,$2,10,null,true)", [rfq, JSON.stringify([{ line_id: line, quantity: 500, unit_price: 1.3 }])]);
});

test("a new spec version (or the same item on a new job) is pre-filled from the supplier's verified sheet", async () => {
  const src = (await asSuper("select id, sheet_ref from public.spec_tech_sheets where po_id = $1", [A.po])).rows[0];
  const ver = (await one("agent", "insert into public.spec_versions (spec_id, name, quantity) values ($1,'Large',200) returning id", [A.spec])).id;
  const sheet = (await one("agent", "select public.tech_sheet_ensure($1,$2,$3) id", [A.spec, sA, ver])).id;
  const s = (await asSuper("select source, copied_from_id, status, hs_code from public.spec_tech_sheets where id = $1", [sheet])).rows[0];
  assert.deepEqual([s.source, s.copied_from_id, s.status, s.hs_code], ["library", src.id, "draft", "4911.10"]);
  assert.equal(Number((await asSuper("select gross_weight_kg from public.spec_tech_sheet_packs where sheet_id = $1 and level = 'secondary'", [sheet])).rows[0].gross_weight_kg), 10);
  const ev = (await asSuper("select detail from public.spec_tech_sheet_events where sheet_id = $1 and event = 'created'", [sheet])).rows[0].detail;
  assert.equal(ev.prefilled_from, src.sheet_ref);
  assert.equal(ev.match, "the same spec");
  // Same item on a new job.
  const N = await makeSpec({ title: "Counter card" });
  const n2 = (await one("agent", "select public.tech_sheet_ensure($1,$2) id", [N.spec, sA])).id;
  assert.equal((await asSuper("select source from public.spec_tech_sheets where id = $1", [n2])).rows[0].source, "library");
  // Never from another supplier's sheet.
  const n3 = (await one("agent", "select public.tech_sheet_ensure($1,$2) id", [N.spec, sB])).id;
  assert.notEqual((await asSuper("select source from public.spec_tech_sheets where id = $1", [n3])).rows[0].source, "library");
  // The vendor copies one of its own earlier sheets, never another supplier's.
  const B = await makePo({ supplierId: sB, title: "Wobbler" });
  await rejects(as("vB", "select public.tech_sheet_vendor_copy($1,$2,null,$3)", [B.po, B.spec, src.id]), /your own earlier data sheets/);
  const C = await makePo({ title: "Hanger" });
  const cp = (await one("vA", "select public.tech_sheet_vendor_copy($1,$2,null,$3) r", [C.po, C.spec, src.id])).r;
  assert.equal(cp.copied_from, src.sheet_ref);
  assert.equal((await asSuper("select source from public.spec_tech_sheets where po_id = $1", [C.po])).rows[0].source, "copied");
});

test("packaging by material and declared materials views", async () => {
  const rows = (await as("agent", "select * from public.v_packaging_by_material where client_id = $1", [client])).rows;
  const corr = rows.find((r) => r.material_code === "PM-CORR" && r.level === "secondary");
  assert.ok(corr);
  assert.equal(corr.market, "DE");
  assert.ok(Number(corr.packaging_kg) > 0);
  assert.equal(Number(corr.recycled_pct), 80);
  const mats = (await as("agent", "select kind, material_code from public.v_spec_declared_materials where spec_id = $1", [A.spec])).rows;
  assert.ok(mats.some((m) => m.kind === "product" && m.material_code === "SB-T350"));
  assert.ok(mats.some((m) => m.kind === "packaging" && m.material_code === "PM-CORR"));
  assert.equal((await as("vB", "select count(*)::int n from public.v_packaging_by_material")).rows[0].n, 0);
});
