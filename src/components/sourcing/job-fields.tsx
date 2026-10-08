import type { BillingEntity, Job, SourcingClient } from "@/lib/sourcing";
import { REGIONS } from "@/lib/sourcing";
import { Field } from "./action-form";

/** Job fields shared by "New job" and the job overview edit form. Region and market are separate. */
export function JobFields({ job, clients, entities, briefId }: { job?: Partial<Job>; clients: SourcingClient[]; entities: BillingEntity[]; briefId?: string | null }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" required defaultValue={job?.title ?? ""} className="input" placeholder="e.g. Summer cooler POS kit" /></Field>
        <Field label="Client" htmlFor="client_id">
          <select id="client_id" name="client_id" required defaultValue={job?.client_id ?? ""} className="input">
            <option value="">Choose…</option>
            {clients.filter((c) => c.active || c.id === job?.client_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Billing entity" htmlFor="billing_entity_id" hint="The adm Indicia entity that invoices this job">
          <select id="billing_entity_id" name="billing_entity_id" defaultValue={job?.billing_entity_id ?? ""} className="input">
            <option value="">Not set yet</option>
            {entities.filter((b) => b.active || b.id === job?.billing_entity_id).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.market})</option>)}
          </select>
        </Field>
        <Field label="Region" htmlFor="region">
          <select id="region" name="region" required defaultValue={job?.region ?? ""} className="input">
            <option value="">Choose…</option>
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Market (country)" htmlFor="market"><input id="market" name="market" required defaultValue={job?.market ?? ""} className="input" placeholder="e.g. Germany" /></Field>
        <Field label="Category" htmlFor="category"><input id="category" name="category" defaultValue={job?.category ?? ""} className="input" placeholder="Print, POSM, Fixtures…" /></Field>
        <Field label="Brand" htmlFor="brand"><input id="brand" name="brand" defaultValue={job?.brand ?? ""} className="input" /></Field>
        <Field label="Campaign" htmlFor="campaign_name"><input id="campaign_name" name="campaign_name" defaultValue={job?.campaign_name ?? ""} className="input" /></Field>
        <Field label="Client's job reference" htmlFor="client_job_ref"><input id="client_job_ref" name="client_job_ref" defaultValue={job?.client_job_ref ?? ""} className="input" /></Field>
        <Field label="Budget" htmlFor="budget"><input id="budget" name="budget" inputMode="decimal" defaultValue={job?.budget ?? ""} className="input" /></Field>
        <Field label="Currency" htmlFor="currency"><input id="currency" name="currency" maxLength={3} defaultValue={job?.currency ?? "EUR"} className="input uppercase" /></Field>
        <Field label="Quotes needed by" htmlFor="quote_due_date"><input id="quote_due_date" name="quote_due_date" type="date" defaultValue={job?.quote_due_date ?? ""} className="input" /></Field>
        <Field label="Target delivery" htmlFor="target_delivery_date"><input id="target_delivery_date" name="target_delivery_date" type="date" defaultValue={job?.target_delivery_date ?? ""} className="input" /></Field>
        <Field label="Briefing+ brief (optional)" htmlFor="brief_id" hint="Links this job back to the brief it came from">
          <input id="brief_id" name="brief_id" defaultValue={job?.brief_id ?? briefId ?? ""} className="input" placeholder="Brief id" />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2"><textarea id="notes" name="notes" rows={3} defaultValue={job?.notes ?? ""} className="input" /></Field>
      </div>
    </>
  );
}
