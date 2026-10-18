"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { btn } from "@/components/ui";
import { submitOnboardingRequest, type OnbResult } from "@/app/(platform)/assure/onboarding-actions";
import { SUPPLIER_CATEGORIES, SUPPLIER_TYPES } from "@/lib/onboarding";
import { CLIENTS } from "@/lib/srt";

const F = ({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: string; wide?: boolean }) => (
  <label className={wide ? "block md:col-span-2" : "block"}>
    <span className="label">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
  </label>
);

/** The structured onboarding request. Possible duplicates come back before saving; the requester confirms or links one. */
export function RequestForm({ markets, taxCategories }: { markets: string[]; taxCategories: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<OnbResult, FormData>(submitOnboardingRequest, {});
  const [urgent, setUrgent] = useState(false);
  const matches = state.matches ?? [];
  const v = state.values ?? {};
  return (
    <form key={JSON.stringify(v)} action={action} className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2">
        <h3 className="font-display font-semibold md:col-span-2">1. Business need</h3>
        <F label="Why is this supplier needed?" wide><textarea name="business_case" rows={3} required defaultValue={v.business_case} className="input" placeholder="The need, the client and what the current supply base can't cover" /></F>
        <F label="Client"><select name="client" className="input" defaultValue={v.client ?? ""}><option value="">No specific client</option>{CLIENTS.map((c) => <option key={c} value={c}>{c}</option>)}</select></F>
        <F label="Market"><select name="market" required className="input" defaultValue={v.market ?? ""}><option value="" disabled>Choose a market</option>{markets.map((m) => <option key={m} value={m}>{m}</option>)}</select></F>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <h3 className="font-display font-semibold md:col-span-2">2. Request details</h3>
        <F label="Supplier type"><select name="supplier_type" required className="input" defaultValue={v.supplier_type ?? ""}><option value="" disabled>Choose</option>{SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></F>
        <F label="Category"><select name="category" required className="input" defaultValue={v.category ?? ""}><option value="" disabled>Choose</option>{SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></F>
        {taxCategories.length > 0 && (
          <F label="Product category (optional)" hint="From the product taxonomy in the Watchtower"><select name="tax_category_id" className="input" defaultValue={v.tax_category_id ?? ""}><option value="">Not set</option>{taxCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        )}
        <F label="Estimated annual spend"><div className="flex gap-2"><input name="estimated_spend" type="number" min={0} step="100" required defaultValue={v.estimated_spend} className="input" /><select name="currency" className="input w-24" defaultValue={v.currency ?? "EUR"}>{["EUR", "GBP", "USD", "SGD"].map((c) => <option key={c}>{c}</option>)}</select></div></F>
        <F label="Urgency"><select name="urgency" className="input" value={urgent ? "urgent" : "standard"} onChange={(e) => setUrgent(e.target.value === "urgent")}><option value="standard">Standard route</option><option value="urgent">Urgent (may need the exception route)</option></select></F>
        {urgent && (
          <>
            <F label="Why is it urgent?" wide><input name="urgency_reason" required defaultValue={v.urgency_reason} className="input" /></F>
            <F label="Client need"><input name="client_need" required defaultValue={v.client_need} className="input" placeholder="The job or launch this is for" /></F>
            <F label="Needed by"><input name="required_date" type="date" required defaultValue={v.required_date} className="input" /></F>
          </>
        )}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <h3 className="font-display font-semibold md:col-span-2">Proposed supplier</h3>
        <F label="Company name"><input name="proposed_name" required defaultValue={v.proposed_name} className="input" /></F>
        <F label="Contact name"><input name="proposed_contact" defaultValue={v.proposed_contact} className="input" /></F>
        <F label="Contact email" hint="The information request goes here after triage"><input name="proposed_email" type="email" defaultValue={v.proposed_email} className="input" /></F>
        <F label="Website"><input name="proposed_website" defaultValue={v.proposed_website} className="input" placeholder="https://" /></F>
        <F label="Company registration number"><input name="proposed_registration" defaultValue={v.proposed_registration} className="input" /></F>
        <F label="VAT / tax number"><input name="proposed_vat" defaultValue={v.proposed_vat} className="input" /></F>
      </section>

      {matches.length > 0 && (
        <section className="space-y-2 rounded-lg border border-warn bg-warn-soft p-4 text-sm">
          <p className="font-semibold">Possible existing suppliers or requests</p>
          <ul className="space-y-1">
            {matches.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {m.kind === "supplier" ? (
                  <label className="flex items-center gap-2"><input type="radio" name="linked_supplier_id" value={m.supplier_id} />
                    <Link href={`/assure/suppliers/${m.supplier_id}`} target="_blank" className="font-semibold underline">{m.name}</Link></label>
                ) : <Link href={`/assure/srt/requests/${m.case_id}`} target="_blank" className="font-semibold underline">Request #{m.case_no}: {m.name}</Link>}
                <span className="text-muted">{[m.supplier_code, m.market].filter(Boolean).join(" · ")} · {m.reasons.join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Choose the existing supplier this request is for, or confirm it is a different company.</p>
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="duplicate_confirmed" /> This is not a duplicate: it is a different company</label>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Checking…" : matches.length ? "Submit request" : "Check and submit"}</button>
        {state.error && <span className="text-sm text-bad" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
