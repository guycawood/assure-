import type { Metadata } from "next";
import Link from "next/link";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { BRIEF_STATUS, fmtDate, fmtMoney, type BriefRow } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Briefs" };

export default async function ClientBriefs({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const briefs = (await rpc<BriefRow[]>(ctx.supabase, "client_portal_briefs", scope(ctx))) ?? [];
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Briefs" sub="Every brief for your markets, where it is, and a place to comment." />
      <Card className="min-w-0 overflow-x-auto">
        {briefs.length === 0 ? <Empty title="No briefs yet" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Brief", "Campaign", "Market", "Budget", "Launch", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {briefs.map((b) => {
                const st = BRIEF_STATUS[b.status] ?? { label: b.status, tone: "neutral" as const };
                return (
                  <tr key={b.id}>
                    <td className="td">
                      <Link href={ctx.link(`/client-portal/briefs/${b.id}`)} className="font-semibold hover:text-accent">{b.title}</Link>
                      <div className="text-xs text-muted">{b.brief_code}{b.brand ? ` · ${b.brand}` : ""}</div>
                    </td>
                    <td className="td">{b.campaign_name ?? "—"}</td>
                    <td className="td">{[b.region, b.market].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="td whitespace-nowrap tabular-nums">
                      {b.budget_low == null && b.budget_high == null ? "—" : `${fmtMoney(b.budget_low, b.currency)} – ${fmtMoney(b.budget_high, b.currency)}`}
                    </td>
                    <td className="td whitespace-nowrap">{fmtDate(b.target_launch) || "—"}</td>
                    <td className="td"><Pill tone={st.tone}>{st.label}</Pill></td>
                    <td className="td text-xs text-muted">{b.comment_count > 0 ? `${b.comment_count} comment${b.comment_count === 1 ? "" : "s"}` : ""}</td>
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
