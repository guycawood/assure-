import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TaxCategory, TaxonomyData, TaxProductType, TaxSubcategory } from "@/lib/taxonomy-shared";

export * from "@/lib/taxonomy-shared";

type Client = Awaited<ReturnType<typeof createClient>>;

const CAT = "id, form_type, code, name, description, active, display_order";
const SUB = "id, category_id, code, name, description, active, display_order";
const PT = "id, category_id, subcategory_id, code, name, default_hs_code, description, active, display_order";

/** The product taxonomy tree (RLS: any signed-in user). Active nodes only unless includeInactive. */
export async function loadTaxonomy(supabase: Client, opts: { includeInactive?: boolean } = {}): Promise<TaxonomyData> {
  const q = <T,>(table: string, cols: string) => {
    let b = supabase.from(table).select(cols);
    if (!opts.includeInactive) b = b.eq("active", true);
    return b.order("display_order").order("name") as unknown as Promise<{ data: T[] | null; error: { message: string } | null }>;
  };
  const [c, s, p] = await Promise.all([q<TaxCategory>("tax_categories", CAT), q<TaxSubcategory>("tax_subcategories", SUB), q<TaxProductType>("tax_product_types", PT)]);
  const err = c.error ?? s.error ?? p.error;
  if (err) throw new Error(err.message);
  return { categories: c.data ?? [], subcategories: s.data ?? [], productTypes: p.data ?? [] };
}


/** Resolve free text to a taxonomy node (aliases → names → codes; partial = whole-phrase containment). */
export async function resolveTaxonomy(supabase: Client, text: string, formType?: string | null, partial = false) {
  const { data } = await supabase.rpc("tax_resolve", { p_text: text, p_form_type: formType ?? null, p_partial: partial });
  const rows = (data ?? []) as { level: string; category_id: string; subcategory_id: string | null; product_type_id: string | null; form_type: string; term: string; match_kind: string; confidence: number }[];
  return rows[0] ?? null;
}
