import type { Metadata } from "next";
import Link from "next/link";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { estimateStatus, fmtDate, fmtMoney, type EstimateRow } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Estimates" };

export default async function ClientEstimates({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const estimates = (await rpc<EstimateRow[]>(ctx.supabase, "client_portal_estimates", scope(ctx))) ?? [];
  const canDecide = ctx.accounts.some((a) => a.role === "approver");
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Estimates" sub={canDecide ? "Prices from adm Indicia for your jobs. Open one to approve or decline it." : "Prices from adm Indicia for your jobs. Your approver can approve or decline them."} />
      <Card className="min-w-0 overflow-x-auto">
        {estimates.length === 0 ? <Empty title="No estimates yet" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Estimate", "Job", "Market", "Sent", "Total", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {estimates.map((e) => {
                const st = estimateStatus(e);
                return (
                  <tr key={e.id}>
                    <td className="td"><Link href={ctx.link(`/client-portal/estimates/${e.id}`)} className="font-semibold hover:text-accent">{e.estimate_number}</Link></td>
                    <td className="td">{e.job_title}<div className="text-xs text-muted">{e.job_number}{e.brand ? ` · ${e.brand}` : ""}</div></td>
                    <td className="td">{e.market}</td>
                    <td className="td whitespace-nowrap">{fmtDate(e.sent_at)}</td>
                    <td className="td whitespace-nowrap font-semibold tabular-nums">{fmtMoney(e.sell_price, e.currency, 2)}</td>
                    <td className="td"><Pill tone={st.tone}>{st.label}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
