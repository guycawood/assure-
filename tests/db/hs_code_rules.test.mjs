// HS code rules: a code attached to product, sub-product and material; the most specific active rule wins;
// the product type default is the fallback; staff only; the spec's own HS code is never touched by resolving.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];
const sup1 = async (sql, params) => (await asSuper(sql, params)).rows[0];

const banner = await sup1(
  `select p.id as pt from public.tax_categories c join public.tax_subcategories s on s.category_id = c.id and s.code = 'BANNER'
     join public.tax_product_types p on p.subcategory_id = s.id and p.code = 'VINYL' where c.form_type = 'Print' and c.code = 'LGF'`);
const client = await sup1("insert into public.sourcing_clients (code, name) values ('HSC','HS Client') returning id");
const job = await one("agent", "insert into public.jobs (title, client_id, region, market) values ('HS job',$1,'EMEA','Germany') returning id", [client.id]);
const sub = async (code, type) => (await sup1(
  "insert into public.library_records (library_key, code, name, data, status) values ('substrates',$1,$1,$2::jsonb,'active') returning id",
  [code, JSON.stringify({ substrate_type: type, measurement_basis: "grammage" })])).id;
const spec = async (title, substrate) => (await one("agent",
  "insert into public.job_specs (job_id, title, spec_type, tax_product_type_id, substrate_id) values ($1,$2,'2d',$3,$4) returning id", [job.id, title, banner.pt, substrate ?? null])).id;
const resolve = async (id) => (await one("agent", "select public.hs_code_resolve($1) r", [id])).r;

test("material decides the code within the same product and sub-product", async () => {
  const vinyl = await sub("VIN-TEST", "vinyl"), textile = await sub("TEX-TEST", "textile");
  const a = await resolve(await spec("Vinyl banner", vinyl));
  assert.deepEqual([a.hs_code, a.basis, a.rule_code], ["3926.90", "rule", "HS-BANNER-VINYL"]);
  const b = await resolve(await spec("Fabric banner", textile));
  assert.deepEqual([b.hs_code, b.basis, b.rule_code], ["6307.90", "rule", "HS-BANNER-TEXTILE"]);
});

test("with no material that a rule fits, the product type default is the fallback", async () => {
  const none = await resolve(await spec("Banner, material not entered"));
  assert.equal(none.basis, "product_default");
  assert.equal(none.hs_code, "3926.90");
  const metal = await resolve(await spec("Banner on metal", await sub("MET-TEST", "metal")));
  assert.equal(metal.basis, "product_default");
});

test("a rule for a specific substrate beats a rule for the material type, and retired rules are ignored", async () => {
  const vinyl2 = await sub("VIN-PREMIUM", "vinyl");
  await asSuper(
    `insert into public.library_records (library_key, code, name, data, status) values
       ('hs_code_rules','HS-PREMIUM','Premium vinyl',$1::jsonb,'active')`,
    [JSON.stringify({ scope_form_type: "Print", scope_category_code: "LGF", scope_subcategory_code: "BANNER", material_code: "VIN-PREMIUM", hs_code: "3920.43" })]);
  const id = await spec("Premium vinyl banner", vinyl2);
  assert.equal((await resolve(id)).hs_code, "3920.43");
  await asSuper("update public.library_records set status = 'retired' where code = 'HS-PREMIUM'");
  assert.equal((await resolve(id)).hs_code, "3926.90");
});

test("a more specific product wins over a broader one, and only staff can resolve", async () => {
  const paper = await sub("PAP-TEST", "paper");
  await asSuper(
    `insert into public.library_records (library_key, code, name, data, status) values
       ('hs_code_rules','HS-LGF-ANY-PAPER','Any large-format in paper',$1::jsonb,'active'),
       ('hs_code_rules','HS-BANNER-PAPER','Paper banner',$2::jsonb,'active')`,
    [JSON.stringify({ scope_form_type: "Print", scope_category_code: "LGF", material_type: "paper", hs_code: "4911.99" }),
     JSON.stringify({ scope_form_type: "Print", scope_category_code: "LGF", scope_subcategory_code: "BANNER", material_type: "paper", hs_code: "4911.91" })]);
  const id = await spec("Paper banner", paper);
  assert.equal((await resolve(id)).rule_code, "HS-BANNER-PAPER");
  const OUT = "00000000-0000-0000-0000-0000000000f7";
  await asSuper("insert into auth.users (id, email) values ($1, 'out@example.com')", [OUT]);
  await asSuper("update public.profiles set user_type = 'client' where id = $1", [OUT]);
  await rejects(as(OUT, "select public.hs_code_resolve($1)", [id]), /Only staff/);
  // Resolving never writes: the spec keeps what the product type default seeded when it was created.
  assert.equal((await sup1("select hs_code from public.job_specs where id = $1", [id])).hs_code, "3926.90");
});
