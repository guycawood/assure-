"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { MSymbol } from "@/components/symbol";
import { SearchSelect } from "@/components/taxonomy/search-select";
import {
  completeValue, EMPTY_TAXONOMY_VALUE, FORM_TYPES, taxonomyInputNames,
  type FormType, type TaxonomyData, type TaxonomyValue,
} from "@/lib/taxonomy-shared";

// One fetch per page load for every picker on the page (the route handler is cached privately for 5 minutes).
let cache: Promise<TaxonomyData> | null = null;
function fetchTaxonomy(): Promise<TaxonomyData> {
  if (!cache) {
    cache = fetch("/api/taxonomy", { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 401 ? "Sign in to load the product taxonomy" : "Could not load the product taxonomy");
      return (await r.json()) as TaxonomyData;
    });
    cache.catch(() => { cache = null; });
  }
  return cache;
}

export type TaxonomySelectProps = {
  /** Base name for the hidden inputs: `${name}_form_type`, `${name}_category_id`, … (default "taxonomy"). */
  name?: string;
  /** A category (and a subcategory when requireSubcategory) must be chosen before the form submits. */
  required?: boolean;
  /** Subcategory counts as required when `required` (default true). */
  requireSubcategory?: boolean;
  /** Show the optional product type step (default true). */
  showProductType?: boolean;
  /** Starting value (uncontrolled). Partial values are completed from the tree (a product type implies the rest). */
  defaultValue?: Partial<TaxonomyValue> | null;
  /** Controlled value. */
  value?: TaxonomyValue;
  onChange?: (v: TaxonomyValue, meta: { defaultHsCode: string | null; label: string }) => void;
  /** Limit the form types offered (e.g. the one matching a spec type). */
  formTypes?: readonly FormType[];
  /** Tree to use instead of fetching /api/taxonomy (e.g. from loadTaxonomy() in a server component). */
  data?: TaxonomyData;
  disabled?: boolean;
  /** Field label prefix; defaults to plain step names. */
  idPrefix?: string;
};

/**
 * The shared product-classification picker: Form type → Category → Subcategory → Product type (optional), searchable
 * at each level; changing a level clears the levels below; the chosen path shows as a breadcrumb. Inactive nodes are
 * never offered. Emits hidden inputs for server-action forms.
 */
export function TaxonomySelect({
  name = "taxonomy", required = false, requireSubcategory = true, showProductType = true, defaultValue, value, onChange,
  formTypes, data: given, disabled, idPrefix,
}: TaxonomySelectProps) {
  const [data, setData] = useState<TaxonomyData | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const [inner, setInner] = useState<TaxonomyValue>({ ...EMPTY_TAXONOMY_VALUE, ...(defaultValue ?? {}) });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (given) { setData(given); return; }
    let live = true;
    fetchTaxonomy().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [given]);

  // Once the tree is here, complete a partial default (e.g. only a product type id).
  useEffect(() => {
    if (data && !value) setInner((v) => completeValue(data, v));
  }, [data, value]);

  const v = value ?? inner;
  const active = useMemo(() => ({
    categories: (data?.categories ?? []).filter((c) => c.active),
    subcategories: (data?.subcategories ?? []).filter((s) => s.active),
    productTypes: (data?.productTypes ?? []).filter((p) => p.active),
  }), [data]);

  const cat = data?.categories.find((c) => c.id === v.category_id);
  const sub = data?.subcategories.find((s) => s.id === v.subcategory_id);
  const pt = data?.productTypes.find((p) => p.id === v.product_type_id);
  const crumbs = [v.form_type || null, cat?.name, sub?.name, pt?.name].filter(Boolean) as string[];

  const set = (patch: Partial<TaxonomyValue>) => {
    const next = { ...v, ...patch };
    setTouched(true);
    if (!value) setInner(next);
    if (onChange && data) {
      const p = data.productTypes.find((x) => x.id === next.product_type_id);
      const c = data.categories.find((x) => x.id === next.category_id);
      const s = data.subcategories.find((x) => x.id === next.subcategory_id);
      onChange(next, { defaultHsCode: p?.default_hs_code ?? null, label: [next.form_type, c?.name, s?.name, p?.name].filter(Boolean).join(" › ") });
    }
  };

  const allowedForms = (formTypes?.length ? formTypes : FORM_TYPES).filter((f) => active.categories.some((c) => c.form_type === f) || f === v.form_type);
  const formOptions = allowedForms.map((f) => ({ value: f, label: f }));
  const catOptions = active.categories.filter((c) => c.form_type === v.form_type).map((c) => ({ value: c.id, label: c.name, hint: c.code }));
  const subOptions = active.subcategories.filter((s) => s.category_id === v.category_id).map((s) => ({ value: s.id, label: s.name, hint: s.code }));
  const ptOptions = active.productTypes.filter((p) => p.subcategory_id === v.subcategory_id).map((p) => ({ value: p.id, label: p.name, hint: p.default_hs_code ? `HS ${p.default_hs_code}` : p.code }));

  const n = taxonomyInputNames(name);
  const missing = required && (!v.category_id || (requireSubcategory && !v.subcategory_id));
  const pre = idPrefix ?? name;

  if (error) return <p className="text-sm text-bad" role="alert">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${pre}-form`}>Form type{required && " *"}</label>
          <SearchSelect id={`${pre}-form`} value={v.form_type} options={formOptions} disabled={disabled || !data} placeholder={data ? "Choose a form type" : "Loading…"}
            onChange={(form_type) => set({ form_type, category_id: "", subcategory_id: "", product_type_id: "" })} />
        </div>
        <div>
          <label className="label" htmlFor={`${pre}-cat`}>Category{required && " *"}</label>
          <SearchSelect id={`${pre}-cat`} value={v.category_id} options={catOptions} disabled={disabled || !v.form_type}
            placeholder={v.form_type ? "Choose a category" : "Choose a form type first"} invalid={touched && missing && !v.category_id}
            onChange={(category_id) => set({ category_id, subcategory_id: "", product_type_id: "" })} />
        </div>
        <div>
          <label className="label" htmlFor={`${pre}-sub`}>Subcategory{required && requireSubcategory && " *"}</label>
          <SearchSelect id={`${pre}-sub`} value={v.subcategory_id} options={subOptions} disabled={disabled || !v.category_id}
            placeholder={v.category_id ? "Choose a subcategory" : "Choose a category first"} emptyText="No subcategories yet"
            invalid={touched && missing && !!v.category_id && !v.subcategory_id}
            onChange={(subcategory_id) => set({ subcategory_id, product_type_id: "" })} />
        </div>
        {showProductType && (
          <div>
            <label className="label" htmlFor={`${pre}-pt`}>Product type <span className="font-normal text-muted">(optional)</span></label>
            <SearchSelect id={`${pre}-pt`} value={v.product_type_id} options={ptOptions} disabled={disabled || !v.subcategory_id}
              placeholder={v.subcategory_id ? "Choose a product type" : "Choose a subcategory first"} emptyText="No product types yet"
              onChange={(product_type_id) => set({ product_type_id })} />
          </div>
        )}
      </div>

      {crumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted" aria-label="Chosen classification">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <MSymbol name="chevron_right" size={16} />}
              <span className={i === crumbs.length - 1 ? "font-semibold text-fg" : undefined}>{c}</span>
            </Fragment>
          ))}
          {pt?.default_hs_code && <span className="ml-auto text-xs">Default HS code {pt.default_hs_code}</span>}
        </div>
      )}

      <input type="hidden" name={n.form_type} value={v.form_type} />
      <input type="hidden" name={n.category_id} value={v.category_id} />
      <input type="hidden" name={n.subcategory_id} value={v.subcategory_id} />
      <input type="hidden" name={n.product_type_id} value={showProductType ? v.product_type_id : ""} />
      <input type="hidden" name={n.category_name} value={cat?.name ?? ""} />
      <input type="hidden" name={n.subcategory_name} value={sub?.name ?? ""} />
      <input type="hidden" name={n.product_type_name} value={showProductType ? pt?.name ?? "" : ""} />
      <input type="hidden" name={n.default_hs_code} value={showProductType ? pt?.default_hs_code ?? "" : ""} />
      {/* Native validation: blocks submit until the required levels are chosen. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-px w-px opacity-0"
          required
          value={missing ? "" : "ok"}
          onChange={() => undefined}
          onInvalid={(e) => { e.preventDefault(); setTouched(true); }}
        />
      )}
      {touched && missing && <p className="text-xs text-bad" role="alert">Choose a category{requireSubcategory ? " and a subcategory" : ""}.</p>}
    </div>
  );
}
