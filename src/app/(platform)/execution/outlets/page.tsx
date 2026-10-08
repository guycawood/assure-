import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClientsLite, getOutlets } from "@/lib/execution-data";
import { getMarkets } from "@/lib/logistics-data";
import { cap, grade } from "@/lib/execution";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th } from "@/components/sourcing/bits";
import { OutletFields } from "@/components/execution/outlet-fields";
import { saveOutlet } from "../actions";

export const metadata: Metadata = { title: "Outlets" };

export default async function OutletsPage({ searchParams }: { searchParams: Promise<{ region?: string; market?: string; status?: string; q?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, markets, clients] = await Promise.all([getOutlets(supabase), getMarkets(supabase), getClientsLite(supabase)]);
  const q = sp.q?.toLowerCase().trim();
  const list = all.filter((o) => (!sp.region || o.region === sp.region) && (!sp.market || o.market === sp.market) && (!sp.status || o.status === sp.status)
    && (!q || [o.name, o.outlet_code, o.city, o.client_name].some((x) => x?.toLowerCase().includes(q))));
  const regions = [...new Set(all.map((o) => o.region))].sort();
  const mks = [...new Set(all.map((o) => o.market))].sort();
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Outlets" }]} title="Outlets"
        sub="Persistent store locations reused across jobs: delivery destinations, recce sites and install points. Vendors only see outlets they have work at, or that are shared with them." />
      <form method="get" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, code, city…" className="input w-56" aria-label="Search" />
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region"><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        <select name="market" defaultValue={sp.market ?? ""} className="input w-auto" aria-label="Market"><option value="">All markets</option>{mks.map((m) => <option key={m}>{m}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">Any status</option>{["active", "inactive", "pending_survey"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No outlets" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Outlet</Th><Th>Client</Th><Th>Location</Th><Th>Type</Th><Th>Recces</Th><Th>Deployments</Th><Th>Open tickets</Th><Th>Grade</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((o) => { const g = grade(o.avg_audit_score); return (
              <tr key={o.id}>
                <Td><Link className="font-semibold hover:underline" href={`/execution/outlets/${o.id}`}>{o.name}</Link><div className="text-xs text-muted">{o.outlet_code}</div></Td>
                <Td>{o.client_name ?? "—"}</Td><Td>{o.city ?? "—"}<div className="text-xs text-muted">{o.market_name ?? o.market} · {o.region}</div></Td>
                <Td>{cap(o.store_type)}</Td><Td className="tabular-nums">{o.recce_count}</Td><Td className="tabular-nums">{o.deployment_count}</Td>
                <Td className="tabular-nums">{o.open_tickets || "—"}</Td>
                <Td>{o.avg_audit_score != null ? <Pill tone={g.tone}>{g.letter} · {o.avg_audit_score}%</Pill> : "—"}</Td>
                <Td><Pill tone={o.status === "active" ? "ok" : o.status === "pending_survey" ? "warn" : "neutral"}>{cap(o.status)}</Pill></Td>
              </tr>); })}</tbody>
          </table>
        )}
      </Card>
      <Panel title="Add an outlet">
        <details className="p-5"><summary className="cursor-pointer text-sm font-semibold">New outlet</summary>
          <div className="mt-4"><ActionForm action={saveOutlet} submit="Create outlet"><OutletFields markets={markets} clients={clients} /></ActionForm></div>
        </details>
      </Panel>
    </>
  );
}
