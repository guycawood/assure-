import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { getProfiles, rows } from "@/lib/assure-data";
import type { Supplier } from "@/lib/srt";
import type { Certificate, PerformanceRecord, SupplierProfile } from "@/lib/assure";

type Client = Awaited<ReturnType<typeof createClient>>;

export type DirectoryFilters = {
  q?: string; region?: string; market?: string; category?: string; client?: string; status?: string; tier?: string; risk?: string; compliance?: string;
};
export const FILTER_KEYS = ["q", "region", "market", "category", "client", "status", "tier", "risk", "compliance"] as const;

export type DirectoryRow = {
  s: Supplier;
  p: SupplierProfile | undefined;
  certIssues: number;   // expired, expiring within 90 days, or rejected certificates
  issues: number;       // certificate issues + open critical onboarding gates
  score: number | null; // latest composite performance score (0-100)
  period: string | null;
};

export async function loadDirectory(supabase: Client) {
  const [suppliers, profiles, certs, perf] = await Promise.all([
    getSuppliers(supabase),
    getProfiles(supabase),
    rows<Certificate>(supabase, "supplier_certificates_v", { cols: "supplier_id, status" }),
    rows<PerformanceRecord>(supabase, "performance_records", { cols: "supplier_id, period, composite_score" }),
  ]);
  const certIssues = new Map<string, number>();
  for (const c of certs) if (["expired", "expiring_soon", "rejected"].includes(c.status)) certIssues.set(c.supplier_id, (certIssues.get(c.supplier_id) ?? 0) + 1);
  const latest = new Map<string, PerformanceRecord>();
  for (const r of perf) { const cur = latest.get(r.supplier_id); if (!cur || r.period > cur.period) latest.set(r.supplier_id, r); }
  const all: DirectoryRow[] = suppliers.map((s) => {
    const ci = certIssues.get(s.id) ?? 0;
    const l = latest.get(s.id);
    return { s, p: profiles.get(s.id), certIssues: ci, issues: ci + s.critical_open, score: l?.composite_score == null ? null : Number(l.composite_score), period: l?.period ?? null };
  });
  return all;
}

export function filterDirectory(all: DirectoryRow[], f: DirectoryFilters) {
  const q = f.q?.toLowerCase().trim();
  return all.filter(({ s, p, issues }) =>
    (!q || [s.name, s.supplier_code, p?.vendor_code, p?.uen_number, p?.legal_entity].some((v) => v?.toLowerCase().includes(q))) &&
    (!f.region || s.region === f.region) && (!f.market || s.market === f.market) && (!f.category || s.category === f.category) &&
    (!f.client || s.client === f.client) && (!f.status || s.status === f.status) && (!f.tier || s.tier === f.tier) &&
    (!f.risk || p?.risk_level === f.risk) && (!f.compliance || (f.compliance === "issues" ? issues > 0 : issues === 0)));
}

export const distinct = (vals: (string | null | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort();
