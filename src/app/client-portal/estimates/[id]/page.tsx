import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { estimateStatus, fmtDate, fmtMoney, isUuid, type EstimateDetail } from "@/lib/client-portal";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { Field, PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { decideEstimate } from "../../actions";

export const metadata: Metadata = { title: "Estimate" };

const TYPE: Record<string, string> = { "2d": "Print (2D)", "3d": "Display (3D)", custom_goods_services: "Goods and services", design: "Design", promo_merch: "Promotional goods" };

export default async function ClientEstimate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const ctx = await portalContext(sp);
  const e = await rpc<EstimateDetail>(ctx.supabase, "client_portal_estimate", { p_estimate: id, ...scope(ctx) });
  if (!e) notFound();
  const st = estimateStatus(e);
  const waitingForMe = e.status === "sent" && !e.decision;

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title={`Estimate ${e.estimate_number}`} sub={e.job_title} crumbs={[{ label: "Estimates", href: ctx.link("/client-portal/estimates") }, { label: e.estimate_number }]}>
        <Pill tone={st.tone}>{st.label}</Pill>
      </PageHead>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Field label="Job">{`${e.job_title} (${e.job_number})`}</Field>
              <Field label="Region and market">{`${e.region} · ${e.market}`}</Field>
              <Field label="Campaign">{e.campaign_name}</Field>
              <Field label="Sent">{fmtDate(e.sent_at)}</Field>
              <Field label="Approved">{fmtDate(e.approved_at)}</Field>
              <Field label="Your order reference">{e.client_order_ref}</Field>
            </dl>
          </Card>
          <Panel title="What's included" sub="Prices are what you pay, per item and in total">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>{["Item", "Type", "Quantity", "Unit price", "Line total"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.spec_no}>
                      <td className="td"><span className="font-semibold">{l.title}</span>{l.description && <div className="text-xs text-muted">{l.description}</div>}</td>
                      <td className="td">{TYPE[l.spec_type] ?? l.spec_type}</td>
                      <td className="td tabular-nums">{Number(l.quantity).toLocaleString("en-GB")}</td>
                      <td className="td tabular-nums">{fmtMoney(l.unit_sell, e.currency, 2)}</td>
                      <td className="td tabular-nums">{fmtMoney(l.line_sell, e.currency, 2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="td font-bold" colSpan={4}>Total</td>
                    <td className="td font-bold tabular-nums">{fmtMoney(e.sell_price, e.currency, 2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Your decision">
            <div className="px-5 py-4 text-sm">
              {ctx.preview ? (
                <p className="text-muted">Decisions are turned off in preview. Record a client&apos;s decision in Order Management+.</p>
              ) : waitingForMe && e.role === "approver" ? (
                <div className="space-y-5">
                  <ClientActionForm action={decideEstimate} hidden={{ estimate_id: e.id, decision: "approve" }} submit="Approve estimate">
                    <div>
                      <label className="label" htmlFor="client_order_ref">Your purchase order number (optional)</label>
                      <input id="client_order_ref" name="client_order_ref" maxLength={80} className="input" />
                    </div>
                    <div>
                      <label className="label" htmlFor="comment-approve">Comment (optional)</label>
                      <textarea id="comment-approve" name="comment" rows={2} maxLength={4000} className="input" />
                    </div>
                  </ClientActionForm>
                  <details className="border-t border-line pt-4">
                    <summary className="cursor-pointer font-semibold text-bad">Decline this estimate</summary>
                    <ClientActionForm action={decideEstimate} hidden={{ estimate_id: e.id, decision: "decline" }} submit="Decline estimate" variant="danger" className="mt-3">
                      <label className="label" htmlFor="comment-decline">Tell us why</label>
                      <textarea id="comment-decline" name="comment" rows={3} maxLength={4000} required className="input" />
                    </ClientActionForm>
                  </details>
                </div>
              ) : waitingForMe ? (
                <p className="text-muted">Waiting for your approver to approve or decline this estimate.</p>
              ) : e.decision ? (
                <p>
                  <b>{e.decision.decided_by_name}</b> {e.decision.decision === "approve" ? "approved" : "declined"} this on {fmtDate(e.decision.decided_at)}.
                  {e.status === "sent" && " adm Indicia is confirming it now."}
                  {e.decision.comment && <span className="mt-2 block whitespace-pre-line text-muted">&ldquo;{e.decision.comment}&rdquo;</span>}
                </p>
              ) : (
                <p className="text-muted">{e.status === "approved" ? "This estimate is approved." : `This estimate was declined${e.declined_reason ? `: ${e.declined_reason}` : "."}`}</p>
              )}
            </div>
          </Panel>
          {e.decisions.length > 1 && (
            <Panel title="History">
              <ul className="divide-y divide-line">
                {e.decisions.map((d, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <b>{d.decided_by_name}</b> {d.decision === "approve" ? "approved" : "declined"} · <span className="text-muted">{fmtDate(d.decided_at)}</span>
                    {d.comment && <p className="text-muted">{d.comment}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
