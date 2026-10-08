import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { BR_STATUS, monthGrid, monthLabel, optLabel, OUTCOME_STATUS, REVIEW_TYPES, type BusinessReview } from "@/lib/assure";
import { formatDate } from "@/lib/srt";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MonthCalendar, MonthNav, OptPill } from "@/components/assure/bits";
import { ReviewForm } from "@/components/assure/forms";

export const metadata: Metadata = { title: "Business reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const supabase = await createClient();
  const [reviews, suppliers] = await Promise.all([rows<BusinessReview>(supabase, "business_reviews", { order: "meeting_date", asc: true }), getSuppliers(supabase)]);
  const sMap = new Map(suppliers.map((s) => [s.id, s]));
  const inMonth = reviews.filter((r) => r.meeting_date.startsWith(month) && r.status !== "cancelled");
  const pending = reviews.filter((r) => r.outcomes_approval_status === "pending");
  const today = new Date().toISOString().slice(0, 10);
  const events = reviews.filter((r) => r.status !== "cancelled").map((r) => ({
    date: r.meeting_date, label: `${sMap.get(r.supplier_id)?.name ?? ""}: ${optLabel(REVIEW_TYPES, r.review_type)}`, href: `/assure/reviews/${r.id}`,
    tone: (r.status === "completed" ? "ok" : r.review_type === "escalation" ? "bad" : "accent") as "ok" | "bad" | "accent", icon: r.shared_with_vendor ? "share" : "groups",
  }));

  return (
    <>
      <PageHead title="Business reviews" sub="Plan QBRs, check-ins, escalations and renewals. Vendors only see reviews you share, and never the outcomes or notes."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Business reviews" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="This month" value={inMonth.length} />
        <Stat label="Coming up (30 days)" value={reviews.filter((r) => r.status === "scheduled" && r.meeting_date >= today && r.meeting_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length} />
        <Stat label="Outcomes to approve" value={pending.length} tone={pending.length ? "warn" : undefined} hint="Procurement head" />
        <Stat label="Reschedule requests" value={reviews.filter((r) => r.vendor_response === "suggested_reschedule" && r.status === "scheduled").length} />
      </section>
      <Card className="p-4">
        <div className="mb-3"><MonthNav month={month} label={monthLabel(month)} base="/assure/reviews" /></div>
        <MonthCalendar weeks={monthGrid(month)} month={month} events={events} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`${monthLabel(month)} (${inMonth.length})`}>
          {inMonth.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No reviews this month.</p> : (
            <ul className="divide-y divide-line">
              {inMonth.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div><Link href={`/assure/reviews/${r.id}`} className="font-semibold hover:text-accent">{r.title}</Link>
                    <div className="text-xs text-muted">{formatDate(r.meeting_date)} · {sMap.get(r.supplier_id)?.name}</div></div>
                  <div className="flex gap-1.5">{r.shared_with_vendor && <Pill tone="info">Shared</Pill>}<OptPill list={BR_STATUS} value={r.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Outcomes waiting for approval (${pending.length})`}>
          {pending.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div><Link href={`/assure/reviews/${r.id}`} className="font-semibold hover:text-accent">{r.title}</Link><div className="text-xs text-muted">{formatDate(r.meeting_date)}</div></div>
                  <OptPill list={OUTCOME_STATUS} value={r.outcomes_approval_status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Plan a review"><div className="p-5"><ReviewForm suppliers={supplierOptions(suppliers)} /></div></Panel>
    </>
  );
}
