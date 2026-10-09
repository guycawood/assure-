import { notFound } from "next/navigation";
import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { daysUntil, human, money, statusTone } from "@/lib/vendor";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionDialog } from "@/components/vendor/action-form";
import { QuoteForm, SpecSummary, type QuoteAlt, type QuoteDetail, type QuoteLine, type QuotePointPrice, type QuotePrice } from "@/components/vendor/quote-form";
import { declineRfq } from "../../actions";
import { saveQuoteDetailed } from "../actions";

export const metadata = { title: "Quote request" };

type View = {
  rfq: { id: string; rfq_number: string; title: string; due_at: string; currency: string; open: boolean; status: string; job_number: string; market: string; region: string; incoterm?: string; incoterm_place?: string | null };
  lines: QuoteLine[];
  invitation: { status: string; declined_at: string | null; decline_reason: string | null; requote_needed?: boolean; requote_reason?: string | null };
  quote: {
    id: string; status: string; lead_time_days: number | null; notes: string | null; total_value: number | null; submitted_at: string | null; prices: QuotePrice[];
    lines?: QuoteDetail[]; alternatives?: QuoteAlt[]; point_prices?: QuotePointPrice[];
  } | null;
};

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  // rfq_vendor_view only answers for an RFQ this vendor was invited to (and records that they opened it).
  const { data, error } = await supabase.rpc("rfq_vendor_view", { p_rfq: id });
  if (error || !data) notFound();
  const v = data as View;
  const q = v.quote;
  const declined = v.invitation.status === "declined";
  const editable = v.rfq.open && !declined && canAct(ctx.permission) && (!q || ["draft", "submitted"].includes(q.status));
  const d = daysUntil(v.rfq.due_at);

  return (
    <>
      <PageHead title={v.rfq.title} crumbs={[{ label: "Quote requests", href: "/vendor/quotes" }, { label: v.rfq.rfq_number }]}
        sub={`${v.rfq.job_number} · ${v.rfq.market} · prices in ${v.rfq.currency} · ${v.rfq.incoterm ?? "DDP"}${v.rfq.incoterm_place ? ` ${v.rfq.incoterm_place}` : ""}`}>
        {editable && (
          <ActionDialog label="Decline to quote" variant="danger" title="Decline this quote request" sub="adm Indicia will see your reason." action={declineRfq} hidden={{ rfq: v.rfq.id }} submit="Decline" >
            <label className="label" htmlFor="reason">Reason</label>
            <textarea id="reason" name="reason" required rows={3} maxLength={1000} className="input" placeholder="e.g. No capacity in this window" />
          </ActionDialog>
        )}
      </PageHead>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4"><p className="eyebrow">Due</p><p className="mt-1 font-bold">{formatDate(v.rfq.due_at)} {new Date(v.rfq.due_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          <p className={`text-xs ${v.rfq.open && d !== null && d <= 2 ? "text-bad" : "text-muted"}`}>{v.rfq.open ? (d !== null && d <= 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} left`) : "Closed: quotes can no longer be changed"}</p></Card>
        <Card className="px-5 py-4"><p className="eyebrow">Your response</p><p className="mt-1"><Pill tone={declined ? "neutral" : statusTone(q?.status ?? "open")}>{declined ? "Declined" : q ? human(q.status) : "Not started"}</Pill></p>
          {q?.submitted_at && <p className="mt-1 text-xs text-muted">Submitted {formatDate(q.submitted_at)}</p>}</Card>
        <Card className="px-5 py-4"><p className="eyebrow">Your total (first break)</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{q?.total_value != null ? money(q.total_value, v.rfq.currency) : "—"}</p></Card>
      </div>

      {declined && <Card className="p-4 text-sm">You declined this request on {formatDate(v.invitation.declined_at)}{v.invitation.decline_reason ? `: ${v.invitation.decline_reason}` : "."}</Card>}
      {v.invitation.requote_needed && (
        <Card className="border-warn/40 bg-warn-soft p-4 text-sm text-warn">
          <b>Spec changed: please re-quote.</b> {v.invitation.requote_reason} Check the changed lines below and submit your quote again before the due date.
        </Card>
      )}

      <Panel title="Your prices" sub={editable ? "Unit prices only: we calculate totals. Price at least the first quantity break of every line. Save a draft any time; submit when ready. You can resubmit until the due date." : "Read-only"}>
        <div className="p-5">
          {editable ? (
            <QuoteForm rfqId={v.rfq.id} currency={v.rfq.currency} lines={v.lines} prices={q?.prices ?? []} details={q?.lines ?? []} alternatives={q?.alternatives ?? []}
              pointPrices={q?.point_prices ?? []} leadTime={q?.lead_time_days ?? null} notes={q?.notes ?? null}
              submitted={q?.status === "submitted"} action={saveQuoteDetailed} />
          ) : (
            <div className="space-y-4">
              {!canAct(ctx.permission) && v.rfq.open && <p className="text-sm text-muted">Your account is view-only, so you can&apos;t change this quote.</p>}
              {v.lines.map((l) => (
                <div key={l.id} className="rounded-xl border border-line">
                  <div className="border-b border-line px-4 py-2.5">
                    <p className="font-semibold">Line {l.line_no}: {l.spec.title}{l.variant_label ? ` (${l.variant_label})` : ""}</p>
                    <SpecSummary spec={l.spec} />
                    {(() => {
                      const d = q?.lines?.find((x) => x.line_id === l.id);
                      const alts = q?.alternatives?.filter((a) => a.line_id === l.id) ?? [];
                      return (
                        <>
                          {d && <p className="mt-1 text-xs text-muted">Your details: {[d.hs_code && `HS ${d.hs_code}`, d.country_of_origin && `origin ${d.country_of_origin}`,
                            d.units_per_carton && `${d.units_per_carton} per carton`, d.gross_weight_kg != null && `${d.gross_weight_kg} kg gross`,
                            d.lead_time_days != null && `${d.lead_time_days} days`, d.sample_cost != null && `samples ${money(d.sample_cost, v.rfq.currency)}`,
                            d.run_on_price != null && `run-on ${money(d.run_on_price, v.rfq.currency)}`].filter(Boolean).join(" · ") || "none"}</p>}
                          {alts.map((a) => <p key={a.alt_no} className="text-xs text-muted">Alternative {a.alt_no}: {a.description}: {money(a.unit_price, v.rfq.currency, 4)} at {a.quantity.toLocaleString("en-GB")}</p>)}
                        </>
                      );
                    })()}
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">Quantity</th><th className="th">Your unit price</th><th className="th">Lead time</th></tr></thead>
                    <tbody>
                      {l.quantity_breaks.map((qty) => {
                        const p = q?.prices.find((x) => x.line_id === l.id && x.quantity === qty);
                        return <tr key={qty}><td className="td tabular-nums">{qty.toLocaleString("en-GB")}</td><td className="td tabular-nums">{p ? money(p.unit_price, v.rfq.currency, 4) : "—"}</td><td className="td">{p?.lead_time_days != null ? `${p.lead_time_days} days` : "—"}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {q?.notes && <p className="text-sm"><b>Your notes:</b> {q.notes}</p>}
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
