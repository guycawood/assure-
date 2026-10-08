import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { BillingEntity, Job, LibraryRecord, SourcingClient, SourcingEvent, Spec, SpecComponent, SpecVersion } from "@/lib/sourcing";
import type { MaterialFactor, Substrate } from "@/lib/sourcing-emissions";

// Server-side reads for Sourcing+, RFQ+ and Order Management+. Everything runs as the signed-in user under RLS,
// through views that join names (no denormalised copies). Only eq filters and simple ordering are used, so the
// same calls work on Supabase and on the demo PGlite client.

export type Client = Awaited<ReturnType<typeof createClient>>;

type Filters = Record<string, string | number | boolean | null>;

export async function rows<T>(supabase: Client, table: string, opts: { eq?: Filters; order?: [string, boolean?][]; limit?: number } = {}): Promise<T[]> {
  let q = supabase.from(table).select("*");
  for (const [k, v] of Object.entries(opts.eq ?? {})) q = q.eq(k, v as never);
  for (const [col, asc] of opts.order ?? []) q = q.order(col, { ascending: asc !== false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) console.error(`[sourcing-data] ${table}:`, error.message);
  return (data as T[]) ?? [];
}

export async function one<T>(supabase: Client, table: string, id: string, col = "id"): Promise<T | null> {
  const { data } = await supabase.from(table).select("*").eq(col, id).maybeSingle();
  return (data as T) ?? null;
}

export const getJobs = (s: Client) => rows<Job>(s, "v_jobs", { order: [["created_at", false]], limit: 2000 });
export const getJob = (s: Client, id: string) => one<Job>(s, "v_jobs", id);
export const getClients = (s: Client) => rows<SourcingClient>(s, "sourcing_clients", { order: [["name"]] });
export const getBillingEntities = (s: Client) => rows<BillingEntity>(s, "sourcing_billing_entities", { order: [["name"]] });
export const getSpecs = (s: Client, jobId?: string) => rows<Spec>(s, "v_specs", { eq: jobId ? { job_id: jobId } : {}, order: [["created_at", false]], limit: 5000 });
export const getSpec = (s: Client, id: string) => one<Spec>(s, "v_specs", id);
export const getVersions = (s: Client, specId: string) => rows<SpecVersion>(s, "spec_versions", { eq: { spec_id: specId }, order: [["sort"], ["created_at"]] });
export const getComponents = (s: Client, specId: string) => rows<SpecComponent>(s, "spec_components", { eq: { spec_id: specId }, order: [["sort"], ["created_at"]] });
export const getEvents = (s: Client, eq: Filters, limit = 200) => rows<SourcingEvent>(s, "sourcing_events", { eq, order: [["at", false]], limit });

export async function getLibrary(s: Client, key: string, activeOnly = true): Promise<LibraryRecord[]> {
  return rows<LibraryRecord>(s, "library_records", { eq: activeOnly ? { library_key: key, status: "active" } : { library_key: key }, order: [["code"]] });
}

/** Substrates (by id) and material emission factors (by code), shaped for sourcing-emissions.ts. */
export async function getEmissionLibraries(s: Client): Promise<{ substrates: Record<string, Substrate>; substrateList: Substrate[]; factors: Record<string, MaterialFactor> }> {
  const [subs, mefs] = await Promise.all([rows<LibraryRecord>(s, "library_records", { eq: { library_key: "substrates" }, order: [["name"]] }), getLibrary(s, "material_emission_factors", false)]);
  const substrateList: Substrate[] = subs.map((r) => ({ id: r.id, code: r.code, name: r.name, ...(r.data as Partial<Substrate>), status: r.status } as Substrate & { status: string }));
  const substrates = Object.fromEntries(substrateList.map((x) => [x.id, x]));
  const factors: Record<string, MaterialFactor> = {};
  for (const r of mefs) {
    if (!r.code || (r.status !== "active" && factors[r.code])) continue;
    factors[r.code] = { code: r.code, name: r.name, ...(r.data as Omit<MaterialFactor, "code">), factor_kgco2e_per_kg: Number((r.data as { factor_kgco2e_per_kg?: number }).factor_kgco2e_per_kg) };
  }
  return { substrates, substrateList, factors };
}

/** Internal people for name lookups. */
export async function getPeople(s: Client): Promise<Map<string, string>> {
  const { data } = await s.from("profiles").select("id, full_name, email").or("user_type.eq.internal,is_admin.eq.true");
  return new Map(((data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
}

export interface MyAccess { is_lead: boolean; is_finance: boolean; doa_level: number | null }
export async function getMyAccess(s: Client, userId: string, isAdmin: boolean, srtRole: string | null): Promise<MyAccess> {
  const a = await one<{ is_lead: boolean; is_finance: boolean; doa_level: number | null }>(s, "sourcing_user_access", userId, "user_id");
  return { is_lead: isAdmin || !!a?.is_lead, is_finance: isAdmin || srtRole === "finance" || !!a?.is_finance, doa_level: a?.doa_level ?? null };
}

export interface HealthRow { module: string; metric: string; label: string; value: number; target: number; status: "ok" | "warn" | "bad" }
export async function getHealth(s: Client): Promise<HealthRow[]> {
  const r = await rows<HealthRow>(s, "watchtower_health_sourcing");
  return r.map((x) => ({ ...x, value: Number(x.value), target: Number(x.target) }));
}

export const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
