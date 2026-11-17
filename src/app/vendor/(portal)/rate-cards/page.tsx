import Link from "next/link";
import { requireVendorCompany } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Rate card pricing" };

type Programme = { id: string; code: string; name: string; year: number; market: string | null; currency: string; deadline: string | null; invite_status: string; closed: boolean; items: number; priced: number; approved: boolean; awarded: number; accept_status: "pending" | "accepted" | "queried" | null };
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "No deadline");

// Rate card pricing requests from us: price the items and quantity tiers by the deadline.
export default async function RateCardsPage() {
  await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.rpc("vendor_rate_card_programmes");
  const list = (data ?? []) as Programme[];
  return (
    <>
      <PageHead title="Rate card pricing" sub="Requests to price a year's rate card. Price each item and quantity tier by the deadline. Your prices are sealed until the deadline or until every invited vendor has responded." />
      {list.length === 0 ? (
        <Card><Empty title="No rate card requests">When we invite you to price a rate card, it shows here and you get a notification.</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {list.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <Link href={`/vendor/rate-cards/${p.id}`} className="font-semibold hover:text-accent">{p.name}</Link>
                <p className="text-xs text-muted">{p.code} · {p.year}{p.market ? ` · ${p.market}` : ""} · {p.currency} · {p.priced} of {p.items} items priced · due {when(p.deadline)}</p>
              </div>
              <div className="flex items-center gap-2">
                {p.approved ? (p.awarded > 0 ? (p.accept_status === "accepted" ? <Pill tone="ok">Accepted: {p.awarded} item{p.awarded === 1 ? "" : "s"}</Pill> : p.accept_status === "queried" ? <Pill tone="info">Question with us</Pill> : <Pill tone="warn">Award to accept: {p.awarded} item{p.awarded === 1 ? "" : "s"}</Pill>) : <Pill tone="neutral">Not awarded</Pill>) : p.closed ? <Pill tone="neutral">Closed</Pill> : p.invite_status === "submitted" ? <Pill tone="ok">Sent</Pill> : p.invite_status === "declined" ? <Pill tone="neutral">Declined</Pill> : <Pill tone="warn">Waiting for your prices</Pill>}
                <Link href={`/vendor/rate-cards/${p.id}`} className="text-sm font-semibold text-accent hover:underline">{p.closed || p.invite_status === "declined" ? "View" : "Price it"}</Link>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
