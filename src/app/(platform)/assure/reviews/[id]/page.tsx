import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getSupplier } from "@/lib/assure-data";
import { BR_STATUS, optLabel, OUTCOME_STATUS, REVIEW_TYPES, SENTIMENT, VENDOR_RESPONSE, type BusinessReview } from "@/lib/assure";
import { formatDate, personName } from "@/lib/srt";
import { PageHead, Panel, Pill } from "@/components/ui";
import { Date_, Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Field } from "@/components/assure/action-form";
import { ReviewForm } from "@/components/assure/forms";
import { approveOutcomes } from "../../srm-actions";

export const metadata: Metadata = { title: "Business review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("business_reviews").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as BusinessReview;
  const [supplier, people] = await Promise.all([getSupplier(supabase, r.supplier_id), getInternalPeople(supabase)]);
  const pMap = byId(people);
  const canApprove = (me.is_admin || me.srt_role === "head") && r.outcomes_approval_status === "pending" && r.created_by !== me.id;

  return (
    <>
      <PageHead title={r.title} sub={`${optLabel(REVIEW_TYPES, r.review_type)} · ${formatDate(r.meeting_date)}`}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Business reviews", href: "/assure/reviews" }, { label: r.title }]}>
        {r.shared_with_vendor ? <Pill tone="info">Shared with vendor</Pill> : <Pill>Internal only</Pill>}
        <OptPill list={BR_STATUS} value={r.status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Meeting" className="xl:col-span-2">
          <div className="space-y-4 p-5">
            <Facts cols={3} items={[
              ["Supplier", <SupplierLink key="s" id={r.supplier_id} name={supplier?.name} tab="reviews" />], ["Date", <Date_ key="d" d={r.meeting_date} />],
              ["Next review", <Date_ key="n" d={r.next_review_date} />], ["adm Indicia", r.internal_attendees.join(", ")], ["Vendor", r.vendor_attendees.join(", ")],
              ["Created by", r.created_by ? personName(pMap.get(r.created_by)) : null],
            ]} />
            {r.description && <p className="text-sm">{r.description}</p>}
            <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Agenda</p><ol className="list-decimal pl-5 text-sm">{r.agenda_items.map((a, i) => <li key={i}>{a}</li>)}</ol></div>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="Outcomes" sub="Internal only. Approved by the Procurement head.">
            <div className="space-y-3 p-5 text-sm">
              <OptPill list={OUTCOME_STATUS} value={r.outcomes_approval_status} />
              {r.key_outcomes ? <p className="whitespace-pre-wrap">{r.key_outcomes}</p> : <p className="text-muted">No outcomes recorded yet.</p>}
              {r.outcomes_approved_by && <p className="text-xs text-muted">{r.outcomes_approval_status === "approved" ? "Approved" : "Reviewed"} by {personName(pMap.get(r.outcomes_approved_by))}{r.outcomes_approved_at ? ` on ${formatDate(r.outcomes_approved_at)}` : ""}{r.outcomes_review_note ? `: ${r.outcomes_review_note}` : ""}</p>}
              {r.overall_sentiment && <p>Sentiment: <OptPill list={SENTIMENT} value={r.overall_sentiment} /></p>}
              {r.discussion_notes && <p className="text-muted">{r.discussion_notes}</p>}
              {canApprove && (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={approveOutcomes} submit="Approve outcomes" hidden={{ id: r.id, decision: "approve" }} inline />
                  <ActionForm action={approveOutcomes} submit="Reject" hidden={{ id: r.id, decision: "reject" }} inline variant="danger">
                    <Field label="Why"><input name="note" required className="input py-1.5" /></Field>
                  </ActionForm>
                </div>
              )}
              {r.outcomes_approval_status === "pending" && r.created_by === me.id && <p className="text-xs text-muted">You created this review, so someone else approves its outcomes.</p>}
            </div>
          </Panel>
          <Panel title="Vendor response">
            <div className="space-y-1 p-5 text-sm">
              <OptPill list={VENDOR_RESPONSE} value={r.vendor_response} />
              {r.vendor_suggested_date && <p>Suggested date: {formatDate(r.vendor_suggested_date)}</p>}
              {r.vendor_notes && <p className="text-muted">{r.vendor_notes}</p>}
              {!r.shared_with_vendor && <p className="text-xs text-muted">Not shared, so the vendor can&apos;t see or respond to it.</p>}
            </div>
          </Panel>
        </div>
      </div>
      <Panel title="Edit review"><div className="p-5"><ReviewForm review={r} /></div></Panel>
    </>
  );
}
