import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type LibraryDef = { key: string; module: string; label: string; description: string | null; requires_approval: boolean; sort: number };
export type LibraryRecord = {
  id: string; library_key: string; code: string | null; name: string; data: Record<string, unknown>; version: number;
  status: "pending_approval" | "active" | "superseded" | "retired" | "rejected";
  effective_from: string; effective_to: string | null; supersedes: string | null; superseded_by: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string; approved_by: string | null; approved_at: string | null;
};
export type LibraryAudit = { id: number; module: string; library_key: string | null; record_id: string | null; record_name: string | null; action: string; changes: { field: string; before: unknown; after: unknown }[]; note: string | null; actor: string | null; at: string };
export type Alias = { id: string; record_id: string; alias: string; source_system: string | null; active: boolean };

export async function getLibraryDefs(supabase: Client, module?: string): Promise<LibraryDef[]> {
  const q = supabase.from("library_definitions").select("*").order("sort");
  const { data } = await (module ? q.eq("module", module) : q);
  return (data ?? []) as LibraryDef[];
}

export async function getLibraryDef(supabase: Client, key: string): Promise<LibraryDef | null> {
  const { data } = await supabase.from("library_definitions").select("*").eq("key", key).maybeSingle();
  return (data as LibraryDef) ?? null;
}

export async function getRecords(supabase: Client, key: string): Promise<LibraryRecord[]> {
  const { data } = await supabase.from("library_records").select("*").eq("library_key", key).order("name").limit(5000);
  return (data ?? []) as LibraryRecord[];
}

export async function getUsageCounts(supabase: Client, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data } = await supabase.from("library_refs").select("record_id").limit(100000);
  for (const r of (data ?? []) as { record_id: string }[]) if (ids.includes(r.record_id)) out.set(r.record_id, (out.get(r.record_id) ?? 0) + 1);
  return out;
}

export async function getAliases(supabase: Client, key: string): Promise<Alias[]> {
  const { data } = await supabase.from("library_aliases").select("*").limit(20000);
  const recs = new Set((await getRecords(supabase, key)).map((r) => r.id));
  return ((data ?? []) as Alias[]).filter((a) => recs.has(a.record_id));
}

export async function getAudit(supabase: Client, opts: { module?: string; recordIds?: string[]; limit?: number }): Promise<LibraryAudit[]> {
  let q = supabase.from("library_audit").select("*");
  if (opts.module) q = q.eq("module", opts.module);
  const { data } = await q.order("at", { ascending: false }).limit(opts.limit ?? 200);
  const rows = (data ?? []) as LibraryAudit[];
  return opts.recordIds ? rows.filter((r) => r.record_id && opts.recordIds!.includes(r.record_id)) : rows;
}

export async function canGovern(supabase: Client, module: string): Promise<boolean> {
  const { data } = await supabase.rpc("can_govern", { p_module: module });
  return data === true;
}

/** Counts per status for the library index. */
export async function getLibraryCounts(supabase: Client): Promise<Map<string, { active: number; pending: number }>> {
  const { data } = await supabase.from("library_records").select("library_key, status").limit(100000);
  const out = new Map<string, { active: number; pending: number }>();
  for (const r of (data ?? []) as { library_key: string; status: string }[]) {
    const c = out.get(r.library_key) ?? { active: 0, pending: 0 };
    if (r.status === "active") c.active++;
    if (r.status === "pending_approval") c.pending++;
    out.set(r.library_key, c);
  }
  return out;
}
