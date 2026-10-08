import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { respondReview } from "../actions";

export const metadata = { title: "Business reviews" };

type Review = { id: string; title: string; description: string | null; review_type: string; meeting_date: string; status: string; internal_attendees: string[];
  vendor_attendees: string[]; agenda_items: string[]; next_review_date: string | null; vendor_response: string; vendor_suggested_date: string | null; vendor_notes: string | null };

const RESPONSE: Record<string, string> = { none: "Not answered", accepted: "You accepted", suggested_reschedule: "You suggested a new date", notes: "You sent notes" };

export default async function ReviewsPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const list = await rows<Review>(supabase.from("vendor_business_reviews").select("*").order("meeting_date", { ascending: false }));
  const act = canAct(ctx.permission);
  return (
    <>
      <PageHead title="Business reviews" sub="Quarterly reviews and check-ins adm Indicia has shared with you. Accept the meeting, suggest another date, or send notes for the agenda." />
      {list.length === 0 ? <Card><Empty title="No reviews shared with you yet" /></Card> : list.map((r) => (
        <Card key={r.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold">{r.title}</p>
              <p className="text-sm text-muted">{human(r.review_type === "qbr" ? "quarterly business review" : r.review_type)} · {formatDate(r.meeting_date)}</p>
            </div>
            <Pill tone={statusTone(r.status)}>{human(r.status)}</Pill>
            <Pill tone={r.vendor_response === "none" ? "warn" : "ok"}>{RESPONSE[r.vendor_response] ?? r.vendor_response}</Pill>
          </div>
          {r.description && <p className="text-sm">{r.description}</p>}
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div><p className="eyebrow">Agenda</p><ul className="ml-4 list-disc">{r.agenda_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
            <div><p className="eyebrow">adm Indicia</p><p>{r.internal_attendees.join(", ") || "—"}</p></div>
            <div><p className="eyebrow">Your team</p><p>{r.vendor_attendees.join(", ") || "—"}</p></div>
          </div>
          {(r.vendor_suggested_date || r.vendor_notes) && (
            <p className="rounded-lg bg-surface-2 p-3 text-sm">{r.vendor_suggested_date && <>Suggested date: <b>{formatDate(r.vendor_suggested_date)}</b>. </>}{r.vendor_notes}</p>
          )}
          {act && r.status === "scheduled" && (
            <div className="flex flex-wrap gap-2">
              {r.vendor_response !== "accepted" && <ActionButton action={respondReview} label="Accept meeting" variant="primary" hidden={{ id: r.id, response: "accepted" }} />}
              <ActionDialog label="Suggest another date" title="Suggest another date" sub={r.title} action={respondReview} hidden={{ id: r.id, response: "suggested_reschedule" }} submit="Send">
                <label className="label" htmlFor={`d-${r.id}`}>Date that suits you</label>
                <input id={`d-${r.id}`} name="suggested" type="date" required className="input" />
                <label className="label" htmlFor={`n-${r.id}`}>Note (optional)</label>
                <textarea id={`n-${r.id}`} name="notes" rows={2} maxLength={2000} className="input" />
              </ActionDialog>
              <ActionDialog label="Send notes" title="Notes for the agenda" sub={r.title} action={respondReview} hidden={{ id: r.id, response: "notes" }} submit="Send">
                <textarea name="notes" required rows={4} maxLength={2000} className="input" aria-label="Notes" />
              </ActionDialog>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
