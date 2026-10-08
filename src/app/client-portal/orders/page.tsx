import type { Metadata } from "next";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { fmtDate, fmtMoney, JOB_STATUS, ORDER_STATUS, type OrderRow } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { OrderTimeline, PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Orders" };

export default async function ClientOrders({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const orders = (await rpc<OrderRow[]>(ctx.supabase, "client_portal_orders", scope(ctx))) ?? [];
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Orders" sub="Every approved job, from order to delivery." />
      {orders.length === 0 ? <Card><Empty title="No orders yet">Orders appear here once you approve an estimate.</Empty></Card> : (
        <section className="flex flex-col gap-4">
          {orders.map((o) => {
            const st = JOB_STATUS[o.status] ?? JOB_STATUS.open;
            return (
              <Card key={o.id} className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">{o.job_number}{o.client_job_ref ? ` · your ref ${o.client_job_ref}` : ""}</p>
                    <h2 className="font-display text-lg font-bold leading-tight">{o.title}</h2>
                    <p className="text-sm text-muted">{[o.brand, o.campaign_name, `${o.region} · ${o.market}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="text-right">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    {o.target_delivery_date && <p className="mt-1 text-xs text-muted">Due {fmtDate(o.target_delivery_date)}</p>}
                  </div>
                </div>
                <OrderTimeline order={o} />
                {(o.estimates.length > 0 || o.orders.length > 0) && (
                  <div className="grid gap-3 border-t border-line pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="eyebrow mb-1">Approved estimates</p>
                      {o.estimates.length === 0 ? <p className="text-muted">—</p> : o.estimates.map((e) => (
                        <p key={e.estimate_number}>{e.estimate_number} · <b className="tabular-nums">{fmtMoney(e.sell_price, e.currency, 2)}</b> · approved {fmtDate(e.approved_at)}{e.client_order_ref ? ` · PO ${e.client_order_ref}` : ""}</p>
                      ))}
                    </div>
                    <div>
                      <p className="eyebrow mb-1">Production</p>
                      {o.orders.length === 0 ? <p className="text-muted">Being arranged</p> : o.orders.map((p) => (
                        <p key={p.po_number}>{ORDER_STATUS[p.status] ?? p.status}{p.delivery_date ? ` · delivery ${fmtDate(p.delivery_date)}` : ""}</p>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      )}
    </>
  );
}
