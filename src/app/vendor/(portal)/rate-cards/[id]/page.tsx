import { notFound } from "next/navigation";
import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/vendor/action-form";
import { RateCardPricing, type PricingItem } from "@/components/vendor/rate-card-pricing";
import { declineRateCard, respondToAward, submitRateCardPrices } from "../actions";

export const metadata = { title: "Price a rate card" };

type View = {
  programme: { id: string; code: string; name: string; year: number; market: string | null; currency: string; deadline: string | null; decimals: number; closed: boolean };
  invite_status: string; decline_reason: string | null; items: PricingItem[];
};

export default async function PriceRateCard({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireVendorCompany();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_rate_card_items", { p_prog: id });
  if (error || !data) notFound();
  const v = data as View;
  const p = v.programme;
  const declined = v.invite_status === "declined";
  const awardRes = await supabase.rpc("vendor_rate_card_awards", { p_prog: id });
  const award = awardRes.data as { approved: boolean; valid_from?: string; valid_to?: string; currency?: string;
    acceptance: { status: "pending" | "accepted" | "queried"; accepted_by: string | null; accepted_at: string | null; question: string | null; response: string | null } | null; awards: { subcode: string; product_type: string; channel: string; uom: string | null; qty_min: number | null; qty_max: number | null; share: number; price: number; contract_status: string }[] } | null;
  const when = p.deadline ? new Date(p.deadline).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "no deadline";

  return (
    <>
      <PageHead title={p.name} sub={`${p.code} · ${p.year}${p.market ? ` · ${p.market}` : ""} · prices in ${p.currency} · due ${when}`}>
        {p.closed ? <Pill tone="neutral">Closed</Pill> : v.invite_status === "submitted" ? <Pill tone="ok">Sent</Pill> : declined ? <Pill tone="neutral">Declined</Pill> : <Pill tone="warn">Open</Pill>}
      </PageHead>
      {award?.approved && (
        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">Your award</h2>
          {award.awards.length === 0 ? <p className="text-sm text-muted">This rate card has been approved. You were not awarded any item on it.</p> : (
            <>
              <p className="text-sm text-muted">Prices below are the prices you are held to, valid {award.valid_from} to {award.valid_to}. Orders come to you directly at these prices. Where an item is shared, your share is the part of the volume planned for you.</p>
              {award.acceptance?.status === "accepted" && (
                <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok"><b>Accepted</b> by {award.acceptance.accepted_by ?? "your company"}{award.acceptance.accepted_at ? ` on ${new Date(award.acceptance.accepted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}. These prices are agreed.</p>
              )}
              {award.acceptance && award.acceptance.status !== "accepted" && (
                <div className="space-y-3 rounded-lg border border-line p-4">
                  <p className="text-sm font-semibold">{award.acceptance.status === "queried" ? "Your question is with us" : "Please accept your award"}</p>
                  {award.acceptance.question && <p className="text-sm text-muted">You asked: {award.acceptance.question}</p>}
                  {award.acceptance.response && <p className="text-sm">Our answer: {award.acceptance.response}</p>}
                  {award.acceptance.status === "pending" && (
                    canAct(ctx.permission) ? (
                      <ActionForm action={respondToAward} hidden={{ programme: p.id }} submit="Accept the award" secondary={[{ label: "Return with a question", intent: "return" }]} className="flex flex-col gap-3">
                        <label className="block text-sm"><span className="label">Question, if you are returning it</span><textarea name="note" rows={2} maxLength={2000} className="input" placeholder="What do you need us to confirm?" /></label>
                        <p className="text-xs text-muted">Accepting means your company agrees to supply the items above at these prices for the dates shown.</p>
                      </ActionForm>
                    ) : <p className="text-sm text-muted">Someone with edit access in your company needs to accept.</p>
                  )}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>{["Item", "Quantity tier", "Unit", "Your share", `Your price (${award.currency})`].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>
                    {award.awards.map((a) => (
                      <tr key={a.subcode}>
                        <td className="td"><b>{a.product_type}</b><div className="font-mono text-xs text-muted">{a.subcode} · {a.channel}</div></td>
                        <td className="td tabular-nums">{a.qty_min == null ? "any" : Number(a.qty_min).toLocaleString("en-GB")} to {a.qty_max == null ? "no limit" : Number(a.qty_max).toLocaleString("en-GB")}</td>
                        <td className="td">{a.uom ?? ""}</td>
                        <td className="td tabular-nums">{Number(a.share)}%</td>
                        <td className="td tabular-nums font-semibold">{Number(a.price).toLocaleString("en-GB")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
      <Card className="px-5 py-3 text-sm text-muted">
        Give a unit price for each item and quantity tier you can supply. Leave a row empty if you can&apos;t. We check that prices fall as the quantity rises, so a higher price at a larger quantity may be queried. Your prices are sealed until the deadline or until every invited vendor has responded, and you can change them until then.
      </Card>
      {declined ? <Card className="p-5 text-sm">You declined this request{v.decline_reason ? `: ${v.decline_reason}` : "."}</Card> : (
        <RateCardPricing programme={p.id} currency={p.currency} items={v.items} closed={p.closed} canAct={canAct(ctx.permission)} submitted={v.invite_status === "submitted"} action={submitRateCardPrices} />
      )}
      {!declined && !p.closed && canAct(ctx.permission) && v.invite_status !== "submitted" && (
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Can&apos;t price this?</h2>
          <ActionForm action={declineRateCard} hidden={{ programme: p.id }} submit="Decline" variant="secondary" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm"><span className="label">Reason</span><input name="reason" required className="input min-w-[280px]" /></label>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
