"use client";

import { useActionState } from "react";
import { submitRfi, type VendorActionResult } from "./actions";
import { CERTIFICATIONS, type RfiData } from "@/lib/srt";
import { btn } from "@/components/ui";

function Field({ name, label, defaultValue, required, type = "text", hint, wide }: { name: string; label: string; defaultValue?: string; required?: boolean; type?: string; hint?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className="label" htmlFor={name}>{label}{required && <span className="text-bad"> *</span>}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} className="input" />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function RfiForm({ rfiId, initial, email }: { rfiId: string; initial: RfiData; email: string }) {
  const [state, action, pending] = useActionState<VendorActionResult, FormData>(submitRfi.bind(null, rfiId), {});
  const d = initial ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <Section title="Company">
        <Field name="legal_name" label="Registered company name" defaultValue={d.legal_name} required />
        <Field name="trading_name" label="Trading name (if different)" defaultValue={d.trading_name} />
        <Field name="registration_number" label="Company registration number" defaultValue={d.registration_number} required />
        <Field name="vat_number" label="VAT / tax number" defaultValue={d.vat_number} />
        <Field name="year_established" label="Year established" defaultValue={d.year_established} />
        <Field name="website" label="Website" defaultValue={d.website} />
        <Field name="address" label="Registered address" defaultValue={d.address} wide />
        <Field name="country" label="Country" defaultValue={d.country} />
      </Section>
      <Section title="Contacts">
        <Field name="contact_name" label="Main contact name" defaultValue={d.contact_name} required />
        <Field name="contact_email" label="Main contact email" type="email" defaultValue={d.contact_email ?? email} required />
        <Field name="contact_phone" label="Main contact phone" defaultValue={d.contact_phone} />
        <Field name="accounts_email" label="Accounts / invoicing email" type="email" defaultValue={d.accounts_email} />
      </Section>
      <Section title="What you supply">
        <Field name="categories" label="Products and services" defaultValue={d.categories} hint="e.g. printed POS, displays, packaging" wide />
        <Field name="employees" label="Number of employees" defaultValue={d.employees} />
        <Field name="sites" label="Factories / sites (city, country)" defaultValue={d.sites} />
        <div className="sm:col-span-2">
          <label className="label" htmlFor="capabilities">Key capabilities and equipment</label>
          <textarea id="capabilities" name="capabilities" rows={3} defaultValue={d.capabilities} className="input" />
        </div>
      </Section>
      <section className="space-y-3 rounded-md border border-line bg-surface p-5">
        <h2 className="font-display text-lg font-semibold">Certifications you hold</h2>
        <p className="text-xs text-muted">Tick all that apply. adm Indicia will ask for copies of the certificates.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {CERTIFICATIONS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="certifications" value={c} defaultChecked={d.certifications?.includes(c)} /> {c}
            </label>
          ))}
        </div>
      </section>
      <Section title="Bank details">
        <p className="text-xs text-muted sm:col-span-2">
          Used only for payments. Our Finance team verifies them before any payment is made. For your security, you won&apos;t see these again after submitting.
        </p>
        <Field name="bank_name" label="Bank name" required />
        <Field name="account_name" label="Account name" required />
        <Field name="account_number" label="Account number" hint="Or enter an IBAN below" />
        <Field name="sort_code_or_swift" label="Sort code / SWIFT / BIC" />
        <Field name="iban" label="IBAN" />
        <Field name="bank_country" label="Bank country" />
      </Section>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="declaration" className="mt-1" required />
        <span>I confirm the information above is accurate and I&apos;m authorised to provide it on behalf of my company.</span>
      </label>
      {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <div><button type="submit" disabled={pending} className={btn.primary}>{pending ? "Submitting…" : "Submit to adm Indicia"}</button></div>
    </form>
  );
}
