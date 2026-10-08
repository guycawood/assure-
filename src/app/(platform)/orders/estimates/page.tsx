import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { money, pct } from "@/lib/sourcing";
import { ESTIMATE_STATUS, savingsPercent, type Estimate } from "@/lib/orders";
import { Card, Empty, PageHead } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Estimates" };

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  let list = await rows<Estimate>(supabase, "v_estimates", { order: [["created_at", false]], limit: 2000 });
  const total = list.length;
  if (sp.status) list = list.filter((e) => e.status === sp.status);
  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "Estimates" }]} title="Estimates" sub="What the client is charged: the supplier cost plus markup or margin, with the savings achieved." />
      <form method="get" className="flex gap-2">
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{Object.entries(ESTIMATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {total === 0 ? <Empty title="No estimates yet"><p>Awarding an RFQ, or pricing lines at triage, drafts an estimate.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Estimate</Th><Th>Job</Th><Th>Supplier</Th><Th>Source</Th><Th>Cost</Th><Th>Sell</Th><Th>Saving vs benchmark</Th><Th>Saving vs target</Th><Th>Status</Th><Th>Created</Th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id}>
                <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link></Td>
                <Td><Link className="hover:underline" href={`/sourcing/jobs/${e.job_id}`}>{e.job_number}</Link><div className="text-xs text-muted">{e.client_name}</div></Td>
                <Td>{e.supplier_name}</Td><Td className="capitalize">{e.source}{e.rfq_number ? ` · ${e.rfq_number}` : ""}</Td>
                <Td className="tabular-nums">{money(e.base_cost, e.currency)}</Td><Td className="tabular-nums">{money(e.sell_price, e.currency)}</Td>
                <Td className="tabular-nums">{money(e.savings_vs_benchmark, e.currency)} <span className="text-xs text-muted">{pct(savingsPercent(e.savings_vs_benchmark, e.benchmark_value))}</span></Td>
                <Td className="tabular-nums">{money(e.savings_vs_target, e.currency)} <span className="text-xs text-muted">{pct(savingsPercent(e.savings_vs_target, e.target_value))}</span></Td>
                <Td><StatusPill meta={ESTIMATE_STATUS} value={e.status} /></Td><Td>{fmtDate(e.created_at)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
