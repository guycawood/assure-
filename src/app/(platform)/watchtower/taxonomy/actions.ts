"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readTaxonomyForm, SOURCE_SYSTEMS, type TaxLevel } from "@/lib/taxonomy-shared";
import type { TaxUsage } from "@/lib/taxonomy-shared";

export type TaxResult = { ok?: boolean; error?: string; message?: string };

const PATH = "/watchtower/taxonomy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS: TaxLevel[] = ["category", "subcategory", "product_type"];
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const idOrNull = (v: string) => (UUID.test(v) ? v : null);

async function rpc(fn: string, args: Record<string, unknown>, ok: string): Promise<TaxResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  revalidatePath("/api/taxonomy");
  return { ok: true, message: ok };
}

/** Create or update a category / subcategory / product type (dialog editor). */
export async function saveNode(_prev: TaxResult, fd: FormData): Promise<TaxResult> {
  await requireAdmin();
  const level = s(fd, "level") as TaxLevel;
  const id = idOrNull(s(fd, "id"));
  const active = fd.get("active") === "on" || fd.get("active") === "true";
  const common = { p_id: id, p_code: s(fd, "code"), p_name: s(fd, "name"), p_description: s(fd, "description") || null, p_active: active };
  if (level === "category") return rpc("tax_category_save", { ...common, p_form_type: s(fd, "form_type") }, id ? "Category saved." : "Category added.");
  if (level === "subcategory") {
    const parent = idOrNull(s(fd, "parent_id"));
    if (!parent) return { error: "Choose the category it belongs to." };
    return rpc("tax_subcategory_save", { ...common, p_category: parent }, id ? "Subcategory saved." : "Subcategory added.");
  }
  if (level === "product_type") {
    const parent = idOrNull(s(fd, "parent_id"));
    if (!parent) return { error: "Choose the subcategory it belongs to." };
    return rpc("tax_product_type_save", { ...common, p_subcategory: parent, p_default_hs_code: s(fd, "default_hs_code") || null },
      id ? "Product type saved." : "Product type added.");
  }
  return { error: "Unknown level." };
}

export async function toggleNode(level: TaxLevel, id: string, active: boolean): Promise<TaxResult> {
  await requireAdmin();
  if (!LEVELS.includes(level) || !UUID.test(id)) return { error: "Unknown item." };
  return rpc("tax_toggle", { p_level: level, p_id: id, p_active: active }, active ? "Reactivated." : "Deactivated.");
}

export async function deleteNode(level: TaxLevel, id: string): Promise<TaxResult> {
  await requireAdmin();
  if (!LEVELS.includes(level) || !UUID.test(id)) return { error: "Unknown item." };
  return rpc("tax_delete", { p_level: level, p_id: id }, "Deleted.");
}

export async function reorderNodes(level: TaxLevel, ids: string[]): Promise<TaxResult> {
  await requireAdmin();
  if (!LEVELS.includes(level) || !ids.every((x) => UUID.test(x))) return { error: "Unknown items." };
  return rpc("tax_reorder", { p_level: level, p_ids: ids }, "Order saved.");
}

/** Usage counts for the deactivation warning (internal staff). */
export async function nodeUsage(level: TaxLevel, id: string): Promise<TaxUsage | null> {
  await requireInternal();
  if (!LEVELS.includes(level) || !UUID.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("tax_usage", { p_level: level, p_id: id });
  return (data as TaxUsage) ?? null;
}

export async function saveAlias(_prev: TaxResult, fd: FormData): Promise<TaxResult> {
  await requireAdmin();
  const t = readTaxonomyForm(fd, "target");
  const src = s(fd, "source_system");
  if (src && !(SOURCE_SYSTEMS as readonly string[]).includes(src)) return { error: "Choose a source system from the list." };
  return rpc("tax_alias_save", {
    p_id: idOrNull(s(fd, "id")), p_alias: s(fd, "alias"), p_category: t.category_id, p_subcategory: t.subcategory_id, p_product_type: t.product_type_id,
    p_source_system: src || null, p_source_reference: s(fd, "source_reference") || null, p_active: fd.get("active") === "on",
  }, "Alias saved.");
}

export async function deleteAlias(id: string): Promise<TaxResult> {
  await requireAdmin();
  if (!UUID.test(id)) return { error: "Unknown alias." };
  return rpc("tax_alias_delete", { p_id: id }, "Alias deleted.");
}

export async function proposeMappings(): Promise<TaxResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tax_mapping_propose", {});
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true, message: `${(data as { queued?: number })?.queued ?? 0} new values queued for review.` };
}

/** Paste one value per line: "category | subcategory | product type" (form type optional as a 4th column first). */
export async function importMappings(_prev: TaxResult, fd: FormData): Promise<TaxResult> {
  await requireAdmin();
  const src = s(fd, "source_system");
  const rows = s(fd, "rows").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split("|").map((x) => x.trim());
    return p.length >= 4 ? { form_type: p[0], category: p[1], subcategory: p[2], product_type: p[3] }
      : { category: p.length > 1 ? p[0] : "", subcategory: p.length > 2 ? p[1] : "", product_type: p[p.length - 1] };
  });
  if (!rows.length) return { error: "Paste at least one value." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tax_mapping_import", { p_source: src, p_rows: rows });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true, message: `${(data as { queued?: number })?.queued ?? 0} of ${rows.length} values queued.` };
}

export async function reviewMapping(_prev: TaxResult, fd: FormData): Promise<TaxResult> {
  await requireAdmin();
  const id = idOrNull(s(fd, "id"));
  const decision = s(fd, "decision");
  if (!id || !["approve", "reject", "archive", "pending"].includes(decision)) return { error: "Unknown mapping or decision." };
  const t = readTaxonomyForm(fd, "target");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tax_mapping_review", {
    p_id: id, p_decision: decision, p_category: t.category_id, p_subcategory: t.subcategory_id, p_product_type: t.product_type_id, p_notes: s(fd, "notes") || null,
  });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  const classified = (data as { classified?: number })?.classified;
  return { ok: true, message: decision === "approve" ? `Approved${classified ? `; ${classified} specs classified` : ""}.` : "Saved." };
}

export async function classifySpec(_prev: TaxResult, fd: FormData): Promise<TaxResult> {
  await requireAdmin();
  const id = idOrNull(s(fd, "spec_id"));
  const t = readTaxonomyForm(fd, "spec");
  if (!id) return { error: "Unknown spec." };
  if (!t.category_id) return { error: "Choose at least a category." };
  return rpc("tax_classify_spec", { p_spec: id, p_category: t.category_id, p_subcategory: t.subcategory_id, p_product_type: t.product_type_id }, "Spec classified.");
}

export async function rerunClassification(): Promise<TaxResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tax_backfill_run", {});
  if (error) return { error: error.message };
  revalidatePath(PATH);
  const r = (data ?? {}) as { classified?: number; unclassified?: number };
  return { ok: true, message: `${r.classified ?? 0} specs classified; ${r.unclassified ?? 0} still need a person.` };
}
