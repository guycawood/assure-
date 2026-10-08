import Link from "next/link";
import { portalContext, previewClients, rpc, scope } from "@/lib/client-portal-data";
import {
  estimateStatus, fmtDate, fmtMoney, JOB_STATUS, moneyList, BRIEF_STATUS,
  type BriefRow, type EstimateRow, type OrderRow, type Summary,
} from "@/lib/client-portal";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { OrderTimeline, PreviewBanner } from "@/components/client/bits";

export default async function ClientPortalHome({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams, { allowPicker: true });

  // adm Indicia staff without a client chosen: pick one to preview.
  if (ctx.isInternal && !ctx.preview) {
    const clients = await previewClients(ctx.supabase);
    return (
      <>
        <PageHead title="Client Portal" sub="This is the clients' own portal. Choose a client to preview exactly what their users see. The preview is read-only." />
        <Card className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Client</th><th className="th">Code</th><th className="th"></th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="td font-semibold">{c.name}</td>
                  <td className="td text-muted">{c.code}</td>
                  <td className="td text-right"><Link href={`/client-portal?preview=${c.id}`} className="font-semibold text-accent hover:underline">Preview as client</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-sm text-muted">Manage who can sign in for each client in <Link href="/watchtower/client-access" className="font-semibold text-accent underline">Client access</Link>.</p>
      </>
    );
  }

  const s = scope(ctx);
  const [summary, estimates, briefs, orders] = await Promise.all([
    rpc<Summary>(ctx.supabase, "client_portal_summary", s),
    rpc<EstimateRow[]>(ctx.supabase, "client_portal_estimates", s),
    rpc<BriefRow[]>(ctx.supabase, "client_portal_briefs", s),
    rpc<OrderRow[]>(ctx.supabase, "client_portal_orders", s),
  ]);
  const names = ctx.accounts.map((a) => a.name).join(", ");
  const waiting = (estimates ?? []).filter((e) => e.status === "sent");
  const active = (orders ?? []).filter((o) => o.status !== "closed").slice(0, 4);
  const recentBriefs = (briefs ?? []).slice(0, 5);
  const first = ctx.profile.full_name?.split(" ")[0];

  return (
    <>
      {ctx.preview && <PreviewBanner name={names} />}
      <PageHead title={ctx.preview ? names : `Welcome${first ? `, ${first}` : ""}`} sub={`Your campaigns, briefs, estimates and orders with adm Indicia${names ? ` for ${names}` : ""}.`} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Live campaigns" value={summary?.live_campaigns ?? 0} icon={<MSymbol name="campaign" />} />
        <Stat label="Open briefs" value={summary?.open_briefs ?? 0} hint="With us or in development" icon={<MSymbol name="description" />} />
        <Stat label="Estimates to decide" value={summary?.estimates_awaiting ?? 0} tone={summary?.estimates_awaiting ? "warn" : undefined} icon={<MSymbol name="request_quote" />} />
        <Stat label="Orders in progress" value={summary?.orders_in_progress ?? 0} icon={<MSymbol name="local_shipping" />} />
        <Stat label="Spend this year" value={moneyList(summary?.spend_ytd ?? [], (n, c) => fmtMoney(n, c))}
          hint={`Savings reported: ${moneyList(summary?.savings_ytd ?? [], (n, c) => fmtMoney(n, c))}`} icon={<MSymbol name="savings" />} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Estimates waiting for you" sub="Review the price and approve or decline" actions={<Link href={ctx.link("/client-portal/estimates")} className="text-xs font-semibold text-accent hover:underline">All estimates</Link>}>
          {waiting.length === 0 ? <Empty title="Nothing to decide right now" /> : (
            <ul className="divide-y divide-line">
              {waiting.map((e) => {
                const st = estimateStatus(e);
                return (
                  <li key={e.id}>
                    <Link href={ctx.link(`/client-portal/estimates/${e.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{e.job_title}</p>
                        <p className="text-xs text-muted">{e.estimate_number} · {e.market} · sent {fmtDate(e.sent_at)}</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{fmtMoney(e.sell_price, e.currency, 2)}</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Recent briefs" actions={<Link href={ctx.link("/client-portal/briefs")} className="text-xs font-semibold text-accent hover:underline">All briefs</Link>}>
          {recentBriefs.length === 0 ? <Empty title="No briefs yet" /> : (
            <ul className="divide-y divide-line">
              {recentBriefs.map((b) => {
                const st = BRIEF_STATUS[b.status] ?? { label: b.status, tone: "neutral" as const };
                return (
                  <li key={b.id}>
                    <Link href={ctx.link(`/client-portal/briefs/${b.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{b.title}</p>
                        <p className="text-xs text-muted">{b.brief_code}{b.market ? ` · ${b.market}` : ""}{b.campaign_name ? ` · ${b.campaign_name}` : ""}</p>
                      </div>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Orders on the way" actions={<Link href={ctx.link("/client-portal/orders")} className="text-xs font-semibold text-accent hover:underline">All orders</Link>}>
        {active.length === 0 ? <Empty title="No orders in progress" /> : (
          <ul className="divide-y divide-line">
            {active.map((o) => {
              const st = JOB_STATUS[o.status] ?? JOB_STATUS.open;
              return (
                <li key={o.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="truncate">{o.title}</span> <Pill tone={st.tone}>{st.label}</Pill></p>
                    <p className="text-xs text-muted">{o.job_number} · {o.market}{o.target_delivery_date ? ` · due ${fmtDate(o.target_delivery_date)}` : ""}</p>
                  </div>
                  <OrderTimeline order={o} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
