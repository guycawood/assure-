import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/lib/srt";
import type { SupplierProfile } from "@/lib/assure";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Read a whole table or view (RLS applies), newest first when `order` is given. */
export async function rows<T>(supabase: Client, table: string, opts?: { eq?: [string, unknown]; order?: string; asc?: boolean; limit?: number; cols?: string }): Promise<T[]> {
  let q = supabase.from(table).select(opts?.cols ?? "*");
  if (opts?.eq) q = q.eq(opts.eq[0], opts.eq[1]);
  if (opts?.order) q = q.order(opts.order, { ascending: opts.asc ?? false });
  const { data } = await q.limit(opts?.limit ?? 5000);
  return ((data ?? []) as unknown) as T[];
}

export async function getProfiles(supabase: Client): Promise<Map<string, SupplierProfile>> {
  const list = await rows<SupplierProfile>(supabase, "supplier_profiles");
  return new Map(list.map((p) => [p.supplier_id, { ...p, nti_rate: p.nti_rate === null ? null : Number(p.nti_rate) }]));
}

export async function getSupplier(supabase: Client, id: string): Promise<Supplier | null> {
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  return (data as Supplier) ?? null;
}

export type LibOption = { id: string; code: string | null; name: string };
/** Active records of a Watchtower library, for pickers. */
export async function getLibrary(supabase: Client, key: string): Promise<LibOption[]> {
  const list = await rows<LibOption & { status: string; library_key: string }>(supabase, "library_records", { eq: ["library_key", key], cols: "id, code, name, status, library_key" });
  return list.filter((r) => r.status === "active").sort((a, b) => a.name.localeCompare(b.name));
}

/** Library names by id, including retired/superseded versions (for display of historic records). */
export async function getLibraryNames(supabase: Client, key: string): Promise<Map<string, string>> {
  const list = await rows<{ id: string; name: string }>(supabase, "library_records", { eq: ["library_key", key], cols: "id, name" });
  return new Map(list.map((r) => [r.id, r.name]));
}

export const supplierOptions = (suppliers: Supplier[]) => suppliers.map((s) => ({ id: s.id, name: s.name + (s.supplier_code ? ` (${s.supplier_code})` : "") }));
