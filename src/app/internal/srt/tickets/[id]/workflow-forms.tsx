"use client";

import { useActionState, useState } from "react";
import { reviewVendorRfi, sendVendorRfi, type ActionResult } from "@/app/internal/actions";
import { btn } from "@/components/ui";

export function SendRfiForm({ ticketId, defaultEmail, resend }: { ticketId: string; defaultEmail: string; resend?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(sendVendorRfi.bind(null, ticketId), {});
  return (
    <form action={action} className="space-y-3 text-sm">
      {!resend && (
        <p className="text-muted">
          Email the vendor a link to register on Assure+ and fill in their company details, certifications and bank details. The ticket waits on the vendor until they submit.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`email-${resend ? "r" : "s"}`}>Vendor contact email</label>
          <input id={`email-${resend ? "r" : "s"}`} name="email" type="email" required defaultValue={defaultEmail} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`name-${resend ? "r" : "s"}`}>Contact name</label>
          <input id={`name-${resend ? "r" : "s"}`} name="contact_name" className="input" />
        </div>
      </div>
      {state.error && <p className="text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="text-ok" role="status">{state.message}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Sending…" : resend ? "Resend request" : "Send information request"}</button>
    </form>
  );
}

export function ReviewForm({ rfiId, ticketId }: { rfiId: string; ticketId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(reviewVendorRfi.bind(null, rfiId, ticketId), {});
  const [decision, setDecision] = useState("approve");
  return (
    <form action={action} className="space-y-3 rounded border border-accent/40 bg-accent-soft/40 p-3">
      <p className="font-semibold">Procurement head review</p>
      <div className="flex flex-wrap gap-4">
        {[["approve", "Approve"], ["return", "Return to vendor"], ["reject", "Reject vendor"]].map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="radio" name="decision" value={v} checked={decision === v} onChange={() => setDecision(v)} /> {l}
          </label>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="review-note">{decision === "approve" ? "Note (optional)" : "What the vendor needs to change"}</label>
        <textarea id="review-note" name="note" rows={2} required={decision !== "approve"} className="input" />
      </div>
      {state.error && <p className="text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="text-ok" role="status">{state.message}</p>}
      <button type="submit" disabled={pending} className={decision === "reject" ? btn.danger : btn.primary}>
        {pending ? "Saving…" : decision === "approve" ? "Approve vendor information" : decision === "return" ? "Return to vendor" : "Reject vendor"}
      </button>
    </form>
  );
}
