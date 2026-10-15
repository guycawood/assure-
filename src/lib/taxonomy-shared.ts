// Product taxonomy: shared types and pure helpers (safe in client and server code). Server data access is in
// src/lib/taxonomy.ts; the picker is src/components/taxonomy/taxonomy-select.tsx.

export const FORM_TYPES = [
  "Print", "Packaging", "POS & Display", "Creative & Design", "Logistics", "Merchandise", "Digital",
  "Custom Goods & Services", "2D/3D", "Stocktool only",
] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const SOURCE_SYSTEMS = ["ADM", "Indicia", "Stocktool", "Airtable", "Sourcing Hub"] as const;
export const MAPPING_STATUSES = ["Unmapped", "Suggested", "Pending review", "Approved", "Rejected", "Archived"] as const;
export type TaxLevel = "category" | "subcategory" | "product_type";

/** Sourcing Hub spec type → form type (same map as the database's _tax_spec_form_type). */
export const SPEC_TYPE_FORM_TYPE: Record<string, FormType> = {
  "2d": "Print", "3d": "POS & Display", promo_merch: "Merchandise", design: "Creative & Design", custom_goods_services: "Custom Goods & Services",
};

export type TaxCategory = { id: string; form_type: FormType; code: string; name: string; description: string | null; active: boolean; display_order: number };
export type TaxSubcategory = { id: string; category_id: string; code: string; name: string; description: string | null; active: boolean; display_order: number };
export type TaxProductType = {
  id: string; category_id: string; subcategory_id: string; code: string; name: string; default_hs_code: string | null;
  description: string | null; active: boolean; display_order: number;
};
export type TaxonomyData = { categories: TaxCategory[]; subcategories: TaxSubcategory[]; productTypes: TaxProductType[] };

/** The picker's value contract (spec §4). Empty string = not chosen. */
export type TaxonomyValue = { form_type: string; category_id: string; subcategory_id: string; product_type_id: string };
export const EMPTY_TAXONOMY_VALUE: TaxonomyValue = { form_type: "", category_id: "", subcategory_id: "", product_type_id: "" };

/** Hidden input names the picker emits for a field called `name`. */
export const taxonomyInputNames = (name: string) => ({
  form_type: `${name}_form_type`,
  category_id: `${name}_category_id`,
  subcategory_id: `${name}_subcategory_id`,
  product_type_id: `${name}_product_type_id`,
  category_name: `${name}_category_name`,
  subcategory_name: `${name}_subcategory_name`,
  product_type_name: `${name}_product_type_name`,
  default_hs_code: `${name}_default_hs_code`,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the picker's hidden inputs in a server action. Ids are validated as uuids (the database validates the path and
 * refreshes names, so the posted names are for display only).
 */
export function readTaxonomyForm(fd: FormData, name: string): { form_type: string | null; category_id: string | null; subcategory_id: string | null; product_type_id: string | null } {
  const n = taxonomyInputNames(name);
  const id = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return UUID.test(v) ? v : null; };
  const ft = String(fd.get(n.form_type) ?? "").trim();
  return {
    form_type: (FORM_TYPES as readonly string[]).includes(ft) ? ft : null,
    category_id: id(n.category_id), subcategory_id: id(n.subcategory_id), product_type_id: id(n.product_type_id),
  };
}

/** Complete a partial value from the tree (a product type implies its subcategory and category, and so on). */
export function completeValue(data: TaxonomyData, v: Partial<TaxonomyValue> | null | undefined): TaxonomyValue {
  const out: TaxonomyValue = { ...EMPTY_TAXONOMY_VALUE, ...(v ?? {}) };
  const pt = out.product_type_id ? data.productTypes.find((p) => p.id === out.product_type_id) : undefined;
  if (pt) { out.subcategory_id = pt.subcategory_id; out.category_id = pt.category_id; }
  const sub = out.subcategory_id ? data.subcategories.find((s) => s.id === out.subcategory_id) : undefined;
  if (sub) out.category_id = sub.category_id;
  const cat = out.category_id ? data.categories.find((c) => c.id === out.category_id) : undefined;
  if (cat) out.form_type = cat.form_type;
  return out;
}

/** "POS & Display › Floor displays › FSDU › Corrugated FSDU" */
export function pathLabel(data: TaxonomyData, v: Partial<TaxonomyValue>): string {
  const c = completeValue(data, v);
  const parts = [
    c.form_type,
    data.categories.find((x) => x.id === c.category_id)?.name,
    data.subcategories.find((x) => x.id === c.subcategory_id)?.name,
    data.productTypes.find((x) => x.id === c.product_type_id)?.name,
  ].filter(Boolean);
  return parts.join(" › ");
}

/** Lower-case, punctuation-free match used by the picker's filter-as-you-type. */
export const searchKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type TaxUsage = { children: number; active_children: number; product_types: number; specs: number; aliases: number; mappings: number };
