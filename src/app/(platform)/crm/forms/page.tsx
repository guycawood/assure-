import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getForms } from "@/lib/crm-data";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Disclosure, Input, Select, TextArea, clientOptions } from "@/components/crm/bits";
import { saveForm } from "../actions";

export const metadata: Metadata = { title: "Forms · CRM" };

const FIELD_HELP = "One field per line: Label | type | required | options. Types: text, email, phone, textarea, select, checkbox. A form needs an email field.";
const FIELD_EXAMPLE = "Full name | text | required\nWork email | email | required\nCompany | text | required\nJob title | text\nSession | select | required | Morning, Afternoon\nDietary needs | textarea";

// Forms and landing pages (event registration, event feedback): a public link per form, submissions matched to contacts.
export default async function CrmForms() {
  await requireInternal();
  const supabase = await createClient();
  const [forms, clients] = await Promise.all([getForms(supabase), getClients(supabase)]);
  return (
    <>
      <PageHead title="Forms" sub="Registration and feedback forms with a public link (for emails, websites or a QR code on a stand). Submissions are matched to contacts by email, with consent recorded."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Forms" }]} />
      <Card className="overflow-x-auto">
        {forms.length === 0 ? <Empty title="No forms yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Form</Th><Th>Client</Th><Th>Submissions</Th><Th>Last</Th><Th>Status</Th><Th>Public link</Th></tr></thead>
            <tbody>{forms.map((f) => (
              <tr key={f.id}><Td><Link className="font-semibold hover:underline" href={`/crm/forms/${f.id}`}>{f.name}</Link></Td>
                <Td>{f.client_name ?? <span className="text-muted">Any (not tied to a client)</span>}</Td><Td>{f.submissions}</Td><Td>{fmtDate(f.last_submission_at)}</Td>
                <Td><Pill tone={f.active ? "ok" : "neutral"}>{f.active ? "Open" : "Closed"}</Pill></Td>
                <Td><a className="text-accent hover:underline" href={`/f/${f.token}`} target="_blank" rel="noreferrer">Open form</a></Td></tr>))}</tbody>
          </table>
        )}
      </Card>
      <Disclosure summary="Create a form">
        <ActionForm action={saveForm} submit="Create form" className="grid gap-3 sm:grid-cols-2">
          <Input name="name" label="Name" required />
          <Select name="client_id" label="New people become contacts of" options={clientOptions(clients)} empty="Nobody (store submissions only)" />
          <TextArea name="description" label="Introduction shown on the form" className="sm:col-span-2" rows={2} />
          <TextArea name="fields" label="Fields" value={FIELD_EXAMPLE} rows={7} className="sm:col-span-2" required />
          <p className="-mt-2 text-xs text-muted sm:col-span-2">{FIELD_HELP}</p>
          <TextArea name="consent_text" label="Consent text (shown as a tick box; leave empty for none)" rows={2} className="sm:col-span-2"
            value="I agree that adm Indicia may email me about future events and services." />
        </ActionForm>
      </Disclosure>
    </>
  );
}
