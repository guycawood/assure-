import { CERTIFICATIONS, formatDate, personName, timeAgo, type Profile, type VendorRfi } from "@/lib/srt";
import { Card, Pill } from "@/components/ui";
import { ReviewForm, SendRfiForm } from "./workflow-forms";
import { ONBOARDING_STEPS, Stepper } from "@/components/stepper";

type Bank = { bank_name: string | null; account_name: string | null; account_number: string | null; sort_code_or_swift: string | null; iban: string | null; bank_country: string | null };
type Email = { to_email: string; subject: string; link: string | null; created_at: string; status: string };

function currentStep(rfi: VendorRfi | null) {
  if (!rfi || rfi.status === "cancelled") return 1;
  if (rfi.status === "sent" || rfi.status === "returned") return 1;
  if (rfi.status === "submitted") return 2;
  return 3;
}

const mask = (v: string | null) => (v ? `•••• ${v.slice(-4)}` : "—");

export function OnboardingWorkflow({
  ticketId, rfi, email, bank, me, people, prospectEmail,
}: {
  ticketId: string;
  rfi: VendorRfi | null;
  email: Email | null;
  bank: Bank | null;
  me: Profile;
  people: Map<string, Profile>;
  prospectEmail: string | null;
}) {
  const step = rfi?.status === "rejected" ? -1 : currentStep(rfi);
  const canSend = me.is_admin || ["agent", "lead", "procurement", "head"].includes(me.srt_role ?? "");
  const canReview = me.is_admin || me.srt_role === "head";
  const d = rfi?.data ?? {};

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Onboarding workflow</h2>
        {rfi && <Pill tone={rfi.status === "approved" ? "ok" : rfi.status === "submitted" ? "info" : rfi.status === "rejected" ? "bad" : "warn"}>{
          { sent: "Waiting on vendor", returned: "Returned to vendor", submitted: "Ready for review", approved: "Vendor info approved", rejected: "Rejected", cancelled: "Cancelled" }[rfi.status]
        }</Pill>}
      </div>

      <Stepper steps={ONBOARDING_STEPS} current={step < 0 ? 2 : step} failedAt={step < 0 ? 2 : undefined} />

      {/* Step 2: collect vendor information */}
      {(!rfi || rfi.status === "cancelled") && (
        canSend ? (
          <SendRfiForm ticketId={ticketId} defaultEmail={prospectEmail ?? ""} />
        ) : (
          <p className="text-sm text-muted">SRT or procurement sends the vendor an information request from here.</p>
        )
      )}

      {rfi && (rfi.status === "sent" || rfi.status === "returned") && (
        <div className="space-y-2 text-sm">
          <p>
            Request emailed to <b>{rfi.contact_email}</b> {timeAgo(rfi.sent_at)} by {personName(rfi.sent_by ? people.get(rfi.sent_by) : null)}. The link expires {formatDate(rfi.expires_at)}.
          </p>
          {rfi.status === "returned" && rfi.review_note && <p className="rounded bg-warn-soft px-3 py-2">Returned: {rfi.review_note}</p>}
          {email && (
            <details className="rounded border border-line p-3">
              <summary className="cursor-pointer font-semibold">Email to vendor ({email.status === "queued" ? "in outbox" : email.status})</summary>
              <p className="mt-2 text-xs text-muted">Subject: {email.subject}</p>
              {email.link && <p className="mt-1 break-all font-mono text-xs"><a className="text-accent underline" href={email.link}>{email.link}</a></p>}
            </details>
          )}
          {canSend && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-accent">Resend to a different email</summary>
              <div className="mt-2"><SendRfiForm ticketId={ticketId} defaultEmail={rfi.contact_email} resend /></div>
            </details>
          )}
        </div>
      )}

      {/* Step 3: Procurement head review */}
      {rfi && (rfi.status === "submitted" || rfi.status === "approved" || rfi.status === "rejected") && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">Submitted {timeAgo(rfi.submitted_at!)}{rfi.reviewed_at ? ` · reviewed ${timeAgo(rfi.reviewed_at)} by ${personName(rfi.reviewed_by ? people.get(rfi.reviewed_by) : null)}` : ""}</p>
          <dl className="grid gap-x-6 gap-y-2 rounded border border-line p-3 sm:grid-cols-2">
            {[
              ["Registered name", d.legal_name], ["Trading name", d.trading_name], ["Registration no.", d.registration_number], ["VAT / tax no.", d.vat_number],
              ["Established", d.year_established], ["Website", d.website], ["Address", [d.address, d.country].filter(Boolean).join(", ")],
              ["Main contact", [d.contact_name, d.contact_email, d.contact_phone].filter(Boolean).join(" · ")], ["Accounts email", d.accounts_email],
              ["Supplies", d.categories], ["Employees", d.employees], ["Sites", d.sites], ["Capabilities", d.capabilities],
              ["Certifications", (d.certifications ?? []).filter((c) => (CERTIFICATIONS as readonly string[]).includes(c)).join(", ") || "None declared"],
            ].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs font-semibold text-muted">{k}</dt><dd className="break-words">{(v as string) || "—"}</dd></div>
            ))}
          </dl>
          <div className="rounded border border-line p-3">
            <p className="text-xs font-semibold text-muted">Bank details</p>
            {bank ? (
              <p>{bank.bank_name} · {bank.account_name} · account {mask(bank.account_number)}{bank.iban ? ` · IBAN ${mask(bank.iban)}` : ""}{bank.sort_code_or_swift ? ` · ${bank.sort_code_or_swift}` : ""} <span className="text-xs text-muted">(Finance verifies the full details on the bank gate)</span></p>
            ) : (
              <p className="text-muted">Only Finance, SRT leads and the Procurement head can see bank details.</p>
            )}
          </div>
          {rfi.status === "submitted" && (canReview ? <ReviewForm rfiId={rfi.id} ticketId={ticketId} /> : <p className="font-semibold">Waiting for the Procurement head to review.</p>)}
          {rfi.status !== "submitted" && rfi.review_note && <p>Review note: {rfi.review_note}</p>}
          {rfi.status === "approved" && (
            <p className="text-muted">Next: work through the remaining onboarding gates on the supplier page. The Procurement head gives the final &quot;Onboarding approval&quot;.</p>
          )}
        </div>
      )}
    </Card>
  );
}
