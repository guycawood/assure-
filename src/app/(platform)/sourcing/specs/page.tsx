import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpecs } from "@/lib/sourcing-data";
import { ROUTES, SPEC_TYPES, specType } from "@/lib/sourcing";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { RoutePill, Td, Th } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Specs" };

export default async function SpecsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const supabase = await createClient();
  let list = await getSpecs(supabase);
  const all = list.length;
  if (sp.type) list = list.filter((s) => s.spec_type === sp.type);
  if (sp.route === "none") list = list.filter((s) => !s.route);
  else if (sp.route) list = list.filter((s) => s.route === sp.route);
  if (q) list = list.filter((s) => `${s.title} ${s.job_number} ${s.client_name} ${s.substrate_name ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Specs" }]} title="All specs" sub="Every spec across every job, with its material, weight, CO2e and route." />
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search title, job, client, material" className="input w-64" aria-label="Search specs" />
        <select name="type" defaultValue={sp.type ?? ""} className="input w-auto" aria-label="Type"><option value="">All types</option>{SPEC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        <select name="route" defaultValue={sp.route ?? ""} className="input w-auto" aria-label="Route"><option value="">All routes</option><option value="none">Not triaged</option>{ROUTES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {all === 0 ? <Empty title="No specs yet"><p>Specs are added on a job.</p></Empty> : list.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No specs match these filters.</p> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Spec</Th><Th>Job</Th><Th>Client</Th><Th>Type</Th><Th>Material</Th><Th>Quantity</Th><Th>HS code</Th><Th>CO2e (kg)</Th><Th>Route</Th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${s.id}`}>{s.title}</Link>{s.is_draft && <Pill tone="warn">Draft</Pill>}</Td>
                  <Td><Link className="hover:underline" href={`/sourcing/jobs/${s.job_id}`}>{s.job_number}</Link></Td>
                  <Td>{s.client_name}</Td><Td>{specType(s.spec_type)}</Td><Td>{s.substrate_name ?? "BOM / none"}</Td>
                  <Td className="tabular-nums">{s.total_quantity.toLocaleString("en-GB")}</Td><Td>{s.hs_code ?? <span className="text-warn">Missing</span>}</Td>
                  <Td className="tabular-nums">{s.co2e_total_kg != null ? Number(s.co2e_total_kg).toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—"}</Td>
                  <Td><RoutePill route={s.route} confidence={s.confidence} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
