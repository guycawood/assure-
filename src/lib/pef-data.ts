import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { indexLibraries, type PefIndex, type PefLibraryRows, type PefRecord } from "@/lib/pef";

type Client = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default

/** Every active record of the Impact Grade libraries, paged. */
export async function loadPefLibraries(supabase: Client): Promise<PefLibraryRows> {
  const { data: defs } = await supabase.from("library_definitions").select("key").eq("module", "impact-grade");
  const keys = ((defs ?? []) as { key: string }[]).map((d) => d.key);
  const out: PefLibraryRows = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("library_records").select("library_key, code, name, data")
      .in("library_key", keys).eq("status", "active").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (PefRecord & { library_key: string })[];
    for (const r of rows) (out[r.library_key] ??= []).push({ code: r.code, name: r.name, data: r.data });
    if (rows.length < PAGE) break;
  }
  return out;
}

// The index is rebuilt only when an Impact Grade library changes: every change (create, correction, new version,
// approval, retirement, import) writes an audit row in the same transaction, so the latest audit id is the stamp.
let cached: { stamp: string; libs: PefLibraryRows; index: PefIndex } | null = null;

export async function getPefIndex(supabase: Client): Promise<{ libs: PefLibraryRows; index: PefIndex }> {
  const { data: last } = await supabase.from("library_audit").select("id").eq("module", "impact-grade").order("id", { ascending: false }).limit(1);
  const stamp = String((last as { id: number }[] | null)?.[0]?.id ?? 0);
  if (cached && cached.stamp === stamp) return cached;
  const libs = await loadPefLibraries(supabase);
  cached = { stamp, libs, index: indexLibraries(libs) };
  return cached;
}
