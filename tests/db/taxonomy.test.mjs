// Product taxonomy master and AAC classification rules: code uniqueness within a parent, the enforced full path,
// admin-only audited writes, deactivation usage data, alias resolution, spec classification and HS default seeding,
// the admin-only mappings queue (approve creates an alias), and AAC rule scope precedence / thresholds in triage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];
const sup1 = async (sql, params) => (await asSuper(sql, params)).rows[0];

const node = async (ft, cc, sc, pc) => sup1(
  `select c.id as cat, s.id as sub, p.id as pt from public.tax_categories c
     left join public.tax_subcategories s on s.category_id = c.id and s.code = $3
     left join public.tax_product_types p on p.subcategory_id = s.id and p.code = $4
    where c.form_type = $1 and c.code = $2`, [ft, cc, sc ?? null, pc ?? null]);

const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('TXC','Taxonomy Client') returning id");
async function newJob() {
  return one("agent", "insert into public.jobs (title, client_id, region, market) values ('Tax job',$1,'EMEA','Germany') returning id", [client.id]);
}

// ---------- taxonomy ----------
test("the reference tree is loaded: every form type has categories, product types carry default HS codes", async () => {
  const r = await sup1(`select (select count(distinct form_type) from public.tax_categories)::int ft, (select count(*) from public.tax_categories)::int c,
    (select count(*) from public.tax_subcategories)::int s, (select count(*) from public.tax_product_types)::int p,
    (select count(*) from public.tax_product_types where default_hs_code is not null)::int hs`);
  assert.equal(r.ft, 10);
  assert.ok(r.c >= 30 && r.s >= 70 && r.p >= 250 && r.hs > 100, JSON.stringify(r));
  // every signed-in user reads the tree
  const n = await one("plain", "select count(*)::int n from public.tax_product_types where active");
  assert.equal(n.n, r.p);
});

test("codes are unique within their parent, not across parents", async () => {
  const floor = await node("POS & Display", "FLOOR");
  await rejects(as("admin", "select public.tax_subcategory_save(null,$1,'fsdu','Another FSDU group')", [floor.cat]), /Code FSDU is already used/);
  // the same code under a different category is fine
  const counter = await node("POS & Display", "COUNTER");
  const id = (await one("admin", "select public.tax_subcategory_save(null,$1,'fsdu','Counter FSDU') id", [counter.cat])).id;
  assert.ok(id);
  await rejects(as("admin", "select public.tax_category_save(null,'Print','LIT','Literature again')"), /Code LIT is already used/);
  await rejects(as("admin", "select public.tax_category_save(null,'Wallpaper','WP','Wallpaper')"), /Choose a form type/);
  await as("admin", "select public.tax_delete('subcategory',$1)", [id]);
});

test("the full path is enforced: product type ⊂ subcategory ⊂ category, on the master and on specs", async () => {
  const fsdu = await node("POS & Display", "FLOOR", "FSDU", "CORRFSDU");
  const shelf = await node("POS & Display", "COUNTER", "SHELF", "WOBBLER");
  // master: a product type's category must be its subcategory's category
  await rejects(asSuper("insert into public.tax_product_types (category_id, subcategory_id, code, name) values ($1,$2,'X','Broken')", [shelf.cat, fsdu.sub]), /foreign key/);
  // specs: the trigger completes the path from the leaf and refuses a mismatch
  const j = await newJob();
  const s = await one("agent", "insert into public.job_specs (job_id, title, spec_type, tax_product_type_id) values ($1,'Floor unit','3d',$2) returning *", [j.id, fsdu.pt]);
  assert.deepEqual([s.tax_category_id, s.tax_subcategory_id, s.tax_form_type, s.tax_product_type_name, s.tax_match],
    [fsdu.cat, fsdu.sub, "POS & Display", "Corrugated FSDU", "Chosen by a person"]);
  await rejects(as("agent", "update public.job_specs set tax_subcategory_id = $2, tax_product_type_id = $3 where id = $1", [s.id, fsdu.sub, shelf.pt]),
    /not under the chosen subcategory/);
  await rejects(as("agent", "update public.job_specs set tax_category_id = $2, tax_subcategory_id = $3, tax_product_type_id = null where id = $1", [s.id, shelf.cat, fsdu.sub]),
    /not under the chosen category/);
  // direct writes bypassing the trigger still hit the composite foreign keys
  await asSuper("alter table public.job_specs disable trigger job_specs_taxonomy");
  try {
    await rejects(asSuper("update public.job_specs set tax_category_id = $2 where id = $1", [s.id, shelf.cat]), /foreign key/);
  } finally {
    await asSuper("alter table public.job_specs enable trigger job_specs_taxonomy");
  }
});

test("non-admins can't write; admin writes are audited in plain words", async () => {
  const lit = await node("Print", "LIT");
  await rejects(as("agent", "select public.tax_category_save(null,'Print','ZZ','Agent category')"), /Only admins/);
  await rejects(as("agent", "insert into public.tax_categories (form_type, code, name) values ('Print','ZZ','Direct')"), /permission denied/);
  await rejects(as("agent", "select public.tax_toggle('category',$1,false)", [lit.cat]), /Only admins/);
  await rejects(as("plain", "insert into public.tax_audit (record_type, action, description) values ('x','create','y')"), /permission denied/);

  const cat = (await one("admin", "select public.tax_category_save(null,'Print','ZTEST','Test print',null) id")).id;
  const sub = (await one("admin", "select public.tax_subcategory_save(null,$1,'ZSUB','Test sub') id", [cat])).id;
  const pt = (await one("admin", "select public.tax_product_type_save(null,$1,'zpt','Test item','4911.10') id", [sub])).id;
  await as("admin", "select public.tax_product_type_save($1,$2,'ZPT','Test item renamed','4911.99')", [pt, sub]);
  await rejects(as("admin", "select public.tax_product_type_save($1,$2,'ZPT','Bad hs','49')", [pt, sub]), /HS code is 4 to 10 digits/);
  const sub2 = (await one("admin", "select public.tax_subcategory_save(null,$1,'ZSUB2','Second sub') id", [cat])).id;
  await as("admin", "select public.tax_reorder('subcategory',$1)", [[sub2, sub]]);
  await rejects(as("admin", "select public.tax_reorder('subcategory',$1)", [[sub2, lit.cat]]), /share one parent/);

  const log = (await as("admin", "select action, description, changed_by_name from public.tax_audit where record_id = any($1) or (action = 'reorder' and record_name = 'Test print') order by id",
    [[cat, sub, pt]])).rows;
  assert.deepEqual(log.map((l) => l.action), ["create", "create", "create", "update", "reorder"]);
  assert.match(log[2].description, /Added product type "Test item" \(ZPT\) under Print › Test print › Test sub, default HS code 4911\.10/);
  assert.match(log[3].description, /name "Test item" to "Test item renamed"; default HS code 4911\.10 to 4911\.99/);
  assert.ok(log.every((l) => l.changed_by_name === "admin@adm-indicia.com"));
  await rejects(asSuper("update public.tax_audit set description = 'x' where record_id = $1", [cat]), /append-only/);
});

test("deactivation warns with children and consuming records; delete is refused while in use", async () => {
  const shelf = await node("POS & Display", "COUNTER", "SHELF", "TALKER");
  const j = await newJob();
  await as("agent", "insert into public.job_specs (job_id, title, spec_type, tax_product_type_id) values ($1,'Talker A','2d',$2), ($1,'Talker B','2d',$2)", [j.id, shelf.pt]);
  const u = (await one("lead", "select public.tax_usage('subcategory',$1) u", [shelf.sub])).u;
  assert.equal(u.children, 6);
  assert.ok(u.specs >= 2);
  await rejects(as("00000000-0000-0000-0000-0000000000ff", "select public.tax_usage('subcategory',$1)", [shelf.sub]), /Only adm Indicia staff/);
  await rejects(as("admin", "select public.tax_delete('product_type',$1)", [shelf.pt]), /specs use "Shelf talker": deactivate it instead/);
  await rejects(as("admin", "select public.tax_delete('subcategory',$1)", [shelf.sub]), /still has 6 product types/);
  await as("admin", "select public.tax_toggle('product_type',$1,false)", [shelf.pt]);
  const a = await one("admin", "select description from public.tax_audit where record_id = $1 and action = 'toggle' order by id desc limit 1", [shelf.pt]);
  assert.match(a.description, /Deactivated product type "Shelf talker" \(TALKER\)\. It leaves the picker; 2 specs/);
  // inactive nodes stop resolving but the specs keep their classification
  assert.equal((await one("agent", "select count(*)::int n from public.tax_resolve('Shelf talker')")).n, 0);
  assert.equal((await one("agent", "select count(*)::int n from public.job_specs where tax_product_type_id = $1", [shelf.pt])).n, 2);
  await as("admin", "select public.tax_toggle('product_type',$1,true)", [shelf.pt]);
});

test("tax_resolve: alias, name and code, case-insensitive; partial phrases only on request", async () => {
  const r = async (txt, partial = false) => one("agent", "select level, term, match_kind from public.tax_resolve($1, null, $2)", [txt, partial]);
  assert.deepEqual(await r("WOBBLER"), { level: "product_type", term: "Wobbler", match_kind: "alias" });
  assert.deepEqual(await r("shelf  Wobblers"), { level: "product_type", term: "Shelf wobbler", match_kind: "name" });
  assert.deepEqual(await r("fsdu"), { level: "subcategory", term: "FSDU", match_kind: "code" });
  assert.equal(await r("Opening day poster A1"), undefined);
  assert.deepEqual(await r("Opening day poster A1", true), { level: "subcategory", term: "Posters", match_kind: "contains" });
  // an admin alias makes a local-language term resolve
  const tote = await node("Merchandise", "BAGS", "BAG", "TOTE");
  await as("admin", "select public.tax_alias_save(null,'Stofftasche',null,null,$1,'Indicia','DE glossary')", [tote.pt]);
  assert.deepEqual(await r("stofftasche"), { level: "product_type", term: "Stofftasche", match_kind: "alias" });
  await rejects(as("admin", "select public.tax_alias_save(null,'STOFFTASCHE',$1,null,null)", [tote.cat]), /already points to Merchandise › Bags › Bags › Tote bag/);
  await rejects(as("agent", "select public.tax_alias_save(null,'Beutel',null,null,$1)", [tote.pt]), /Only admins/);
  await rejects(asSuper("insert into public.tax_aliases (alias, category_id, product_type_id) values ('Two targets',$1,$2)", [tote.cat, tote.pt]), /check constraint/);
});

test("specs classify from free text at save; HS default seeding never overrides the spec's own HS code", async () => {
  const j = await newJob();
  const auto = await one("agent", "insert into public.job_specs (job_id, title, spec_type, product_category, product_sub_type) values ($1,'Lumora shelf thing','2d','POS print','Wobbler') returning *", [j.id]);
  assert.equal(auto.tax_product_type_name, "Shelf wobbler");
  assert.match(auto.tax_match, /^Automatic: product sub-type "Wobbler" matched alias "Wobbler"/);
  assert.equal(auto.hs_code, null); // a guess never seeds customs data
  const none = await one("agent", "insert into public.job_specs (job_id, title, spec_type) values ($1,'Mystery item','2d') returning *", [j.id]);
  assert.equal(none.tax_category_id, null);
  assert.equal(none.tax_form_type, "Print");

  const mug = await node("Merchandise", "DRINK", "DRINKWARE", "MUG");
  const picked = await one("agent", "insert into public.job_specs (job_id, title, spec_type, tax_product_type_id) values ($1,'Team mug','promo_merch',$2) returning hs_code", [j.id, mug.pt]);
  assert.equal(picked.hs_code, "6912.00");
  const own = await one("agent", "insert into public.job_specs (job_id, title, spec_type, hs_code, tax_product_type_id) values ($1,'Stoneware mug','promo_merch','6913.90',$2) returning id, hs_code", [j.id, mug.pt]);
  assert.equal(own.hs_code, "6913.90");
  const tote = await node("Merchandise", "BAGS", "BAG", "TOTE");
  const later = await one("agent", "update public.job_specs set tax_product_type_id = $2, tax_subcategory_id = null, tax_category_id = null where id = $1 returning hs_code", [own.id, tote.pt]);
  assert.equal(later.hs_code, "6913.90");
  // an admin classifies a leftover spec (audited); the backfill summary counts it
  await rejects(as("agent", "select public.tax_classify_spec($1,null,null,$2)", [none.id, mug.pt]), /Only admins/);
  await as("admin", "select public.tax_classify_spec($1,null,null,$2)", [none.id, mug.pt]);
  const c = await one("agent", "select tax_match, hs_code, tax_category_name from public.job_specs where id = $1", [none.id]);
  assert.deepEqual([c.tax_match, c.hs_code, c.tax_category_name], ["Classified by an admin", "6912.00", "Drinkware & barware"]);
  const sum = (await one("agent", "select public.tax_classification_summary() s")).s;
  assert.ok(sum.classified >= 4 && sum.by_admin >= 1);
  // renames reach the stored display names
  await as("admin", "select public.tax_product_type_save($1,$2,'MUG','Stoneware or ceramic mug','6912.00')", [mug.pt, mug.sub]);
  assert.equal((await one("agent", "select tax_product_type_name n from public.job_specs where id = $1", [none.id])).n, "Stoneware or ceramic mug");
});

test("mappings: admins only; propose finds unmapped values; approve creates an alias and classifies specs", async () => {
  const j = await newJob();
  const s = await one("agent", "insert into public.job_specs (job_id, title, spec_type, product_category, product_sub_type) values ($1,'Branded item','3d','Retail kit','Plynth wrap') returning id, tax_category_id", [j.id]);
  assert.equal(s.tax_category_id, null);
  await rejects(as("agent", "select public.tax_mapping_propose()"), /Only admins/);
  assert.equal((await one("lead", "select count(*)::int n from public.tax_mappings")).n, 0);
  const p = (await one("admin", "select public.tax_mapping_propose() r")).r;
  assert.ok(p.queued >= 1);
  const m = await one("admin", "select * from public.tax_mappings where source_system = 'Sourcing Hub' and source_product_type = 'Plynth wrap'");
  assert.equal(m.source_form_type, "POS & Display");
  assert.ok(Number(m.confidence) > 0 && Number(m.confidence) < 1);
  assert.equal((await one("lead", "select count(*)::int n from public.tax_mappings")).n, 0); // RLS: invisible to non-admins
  await rejects(as("lead", "select public.tax_mapping_review($1,'approve')", [m.id]), /Only admins/);
  await rejects(as("admin", "select public.tax_mapping_review($1,'reject')", [m.id]), /Say why/);

  const plinth = await node("POS & Display", "PERM", "FIXTURE", "PLINTH");
  const r = (await one("admin", "select public.tax_mapping_review($1,'approve',null,null,$2,'Plynth wraps are plinths') r", [m.id, plinth.pt])).r;
  assert.ok(r.alias_id);
  const a = await one("admin", "select alias, product_type_id, source_system from public.tax_aliases where id = $1", [r.alias_id]);
  assert.deepEqual([a.alias, a.product_type_id, a.source_system], ["Plynth wrap", plinth.pt, "Sourcing Hub"]);
  const after = await one("admin", "select status, reviewed_by, reviewed_at from public.tax_mappings where id = $1", [m.id]);
  assert.equal(after.status, "Approved");
  assert.equal(after.reviewed_by, t.ids.admin);
  assert.ok(after.reviewed_at);
  const spec = await one("agent", "select tax_product_type_id, tax_match from public.job_specs where id = $1", [s.id]);
  assert.equal(spec.tax_product_type_id, plinth.pt);
  assert.match(spec.tax_match, /Plynth wrap/);
  // imports from another system queue rows, re-imports don't duplicate
  const imp = (await one("admin", "select public.tax_mapping_import('Stocktool',$1) r", [JSON.stringify([{ category: "POS", product_type: "Shelf wobblers" }, { product_type: "Gizmo widget" }])])).r;
  assert.deepEqual([imp.rows, imp.queued], [2, 2]);
  const imp2 = (await one("admin", "select public.tax_mapping_import('Stocktool',$1) r", [JSON.stringify([{ product_type: "Gizmo widget" }])])).r;
  assert.equal(imp2.queued, 0);
  const sw = await one("admin", "select status, confidence from public.tax_mappings where source_system = 'Stocktool' and source_product_type = 'Shelf wobblers'");
  assert.deepEqual([sw.status, Number(sw.confidence)], ["Suggested", 1]);
});

// ---------- AAC classification rules ----------
async function lib(key, code, name, data, extra = {}) {
  return (await sup1(`insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,$5,'2026-01-01') returning id`,
    [key, code, name, JSON.stringify(data), extra.status ?? "active"])).id;
}
const subId = await lib("substrates", "SB-AAC", "AAC board", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
const { rows: [supp] } = await asSuper("insert into public.suppliers (supplier_code, name, market, region) values ('T-AAC','AAC Print','Germany','EMEA') returning id");
await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [supp.id]);
await lib("rate_cards", "RC-AAC", "AAC wobbler card", { spec_type: "2d", substrate_code: "SB-AAC", finished_length_mm: 100, finished_width_mm: 100, min_qty: 100, max_qty: 50000, unit_price: 1, currency: "EUR", supplier_code: "T-AAC" });

async function wobblerSpec({ len = 100, wid = 100, qty = 1000, form = "fixed" } = {}) {
  const j = await newJob();
  const s = await one("agent", "insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id, product_sub_type, spec_form) values ($1,'Wobbler','2d','mm',$2,'Wobbler',$3) returning id", [j.id, subId, form]);
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',$2,$3,$4)", [s.id, qty, len, wid]);
  return s.id;
}
const triage = async (spec) => {
  const { tid } = await one("agent", "select public.spec_triage_run($1) tid", [spec]);
  return one("agent", "select route, reason, aac_rule_code, rule_version from public.spec_triage where id = $1", [tid]);
};

test("AAC: seeded defaults reproduce the old outcomes and record the applied rule", async () => {
  assert.equal((await one("admin", "select requires_approval r from public.library_definitions where key = 'aac_classification_rules'")).r, true);
  const exact = await triage(await wobblerSpec());
  assert.deepEqual([exact.route, exact.aac_rule_code, exact.rule_version], ["adopt", "AAC-ADOPT-DEFAULT", "triage-rules-v1"]);
  const near = await triage(await wobblerSpec({ len: 103 })); // 3% off, confidence 0.97 ≥ 0.90
  assert.deepEqual([near.route, near.aac_rule_code], ["push", "AAC-PUSH-DEFAULT"]);
  assert.match(near.reason, /Inside the ±10\.00% band/);
  const far = await triage(await wobblerSpec({ len: 125 })); // 25% off, outside the 10% band
  assert.deepEqual([far.route, far.aac_rule_code], ["create", "AAC-CREATE-DEFAULT"]);
  // the ideation rule is seeded switched off: an ideation spec still adopts
  assert.equal((await triage(await wobblerSpec({ form: "ideation" }))).route, "adopt");
  const used = await one("admin", "select count(*)::int n from public.library_refs r join public.library_records l on l.id = r.record_id where l.code = 'AAC-ADOPT-DEFAULT'");
  assert.ok(used.n >= 2);
});

test("AAC: scope precedence is product type > subcategory > category > form type > default", async () => {
  const spec = await wobblerSpec({ len: 125 });
  const ids = {};
  for (const [code, scope, tol] of [
    ["T-AAC-FT", { scope_form_type: "POS & Display" }, 12],
    ["T-AAC-CAT", { scope_form_type: "POS & Display", scope_category_code: "COUNTER" }, 14],
    ["T-AAC-SUB", { scope_category_code: "COUNTER", scope_subcategory_code: "SHELF" }, 16],
    ["T-AAC-PT", { scope_subcategory_code: "SHELF", scope_product_type_code: "WOBBLER" }, 30],
    ["T-AAC-OTHER", { scope_form_type: "Merchandise" }, 50],
  ]) ids[code] = await lib("aac_classification_rules", code, code, { route: "adapt", tolerance_percent: tol, ...scope });
  const applied = async () => (await one("agent", "select public.aac_effective_rules($1) r", [spec])).r;
  let r = await applied();
  assert.equal(r.adapt.code, "T-AAC-PT");
  assert.equal(Number(r.effective.tolerance_percent), 30);
  for (const [retire, next] of [["T-AAC-PT", "T-AAC-SUB"], ["T-AAC-SUB", "T-AAC-CAT"], ["T-AAC-CAT", "T-AAC-FT"], ["T-AAC-FT", "AAC-ADAPT-DEFAULT"]]) {
    await asSuper("update public.library_records set status = 'retired' where id = $1", [ids[retire]]);
    r = await applied();
    assert.equal(r.adapt.code, next, `after retiring ${retire}`);
  }
  assert.equal(Number(r.effective.tolerance_percent), 10); // default rule blank → Sourcing settings
  // client scope beats an unscoped rule at the same taxonomy level; priority breaks ties
  await lib("aac_classification_rules", "T-AAC-CLIENT", "Client", { route: "adapt", scope_client_code: "TXC", tolerance_percent: 11, priority: 500 });
  await lib("aac_classification_rules", "T-AAC-PRIO", "Priority", { route: "adapt", tolerance_percent: 13, priority: 1 });
  assert.equal((await applied()).adapt.code, "T-AAC-CLIENT");
  await asSuper("update public.library_records set status = 'retired' where code in ('T-AAC-CLIENT','T-AAC-OTHER')");
  assert.equal((await applied()).adapt.code, "T-AAC-PRIO");
  await asSuper("update public.library_records set status = 'retired' where code = 'T-AAC-PRIO'");
});

test("AAC: a threshold change in the library (maker-checker) changes the route on re-triage", async () => {
  const spec = await wobblerSpec({ len: 125 });
  assert.equal((await triage(spec)).route, "create");
  const old = await one("admin", "select id from public.library_records where code = 'AAC-ADAPT-DEFAULT' and status = 'active'");
  const today = new Date().toISOString().slice(0, 10);
  const data = { route: "adapt", priority: 100, tolerance_percent: 30, max_value: 25000, definition: "Wider band" };
  await rejects(as("agent", "select public.library_supersede($1,'Adapt: wider band',$2,$3,'Wider band')", [old.id, JSON.stringify(data), today]), /Only admins and watchtower owners/);
  const nv = (await one("admin", "select public.library_supersede($1,'Adapt: wider band',$2,$3,'Wider band for the pilot') id", [old.id, JSON.stringify(data), today])).id;
  assert.equal((await triage(spec)).route, "create"); // pending approval: not live yet
  await rejects(as("admin", "select public.library_approve($1,true,'ok')", [nv]), /different person/);
  await as("admin2", "select public.library_approve($1,true,'ok')", [nv]);
  const t2 = await triage(spec); // 25% off is now inside the band; confidence 0.75 is under the push bar
  assert.deepEqual([t2.route, t2.aac_rule_code], ["adapt", "AAC-ADAPT-DEFAULT"]);
  assert.match(t2.reason, /±30% band/);
  // raise the push bar through a scoped push rule: a line that pushed by default becomes Adapt
  const near = await wobblerSpec({ len: 103 });
  assert.equal((await triage(near)).route, "push");
  await lib("aac_classification_rules", "T-AAC-PUSHPT", "Push bar for wobblers", { route: "push", scope_product_type_code: "WOBBLER", scope_subcategory_code: "SHELF", min_confidence: 0.99 });
  const t3 = await triage(near);
  assert.deepEqual([t3.route, t3.aac_rule_code], ["adapt", "AAC-ADAPT-DEFAULT"]);
  // a forcing Create rule (reactivated ideation rule) sends ideation specs to an RFQ
  const idea = await one("admin", "select id from public.library_records where code = 'AAC-CREATE-IDEATION'");
  await as("admin", "select public.library_reactivate($1,'Pilot: ideation goes to RFQ')", [idea.id]);
  const t4 = await triage(await wobblerSpec({ form: "ideation" }));
  assert.deepEqual([t4.route, t4.aac_rule_code], ["create", "AAC-CREATE-IDEATION"]);
  assert.match(t4.reason, /Ideation specs go to an RFQ/);
});
