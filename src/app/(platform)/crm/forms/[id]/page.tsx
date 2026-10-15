import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getFormSubmissions, getForms } from "@/lib/crm-data";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { Input, Select, TextArea, clientOptions } from "@/components/crm/bits";
import { saveForm } from "../../actions";

export const metadata: Metadata = { title: "Form · CRM" };

const toLines = (fields: { label: string; type: string; required?: boolean; options?: string[] }[]) =>
  fields.map((f) => [f.label, f.type, f.required ? "required" : "", f.type === "select" ? (f.options ?? []).join(", ") : ""].join(" | ").replace(/( \| )+$/, "")).join("\n");

export default async function CrmForm({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const form = (await getForms(supabase)).find((f) => f.id === id);
  if (!form) notFound();
  const [subs, clients] = await Promise.all([getFormSubmissions(supabase, id), getClients(supabase)]);
  const keys = form.fields.map((f) => f.key);

  return (
    <>
      <PageHead title={form.name} sub={form.description ?? "Public form"} crumbs={[{ label: "CRM", href: "/crm" }, { label: "Forms", href: "/crm/forms" }, { label: form.name }]}>
        <a href={`/f/${form.token}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent underline">Open the public form</a>
        <Link prefetch={false} href={`/crm/export/form?id=${form.id}`} className="text-sm font-semibold text-accent underline">Export submissions (CSV)</Link>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Submissions" value={subs.length} icon={<MSymbol name="inbox" />} />
        <Stat label="Matched to contacts" value={subs.filter((s) => s.contact_id).length} hint={`${subs.filter((s) => s.contact_created).length} new contacts created`} icon={<MSymbol name="contacts" />} />
        <Stat label="Gave consent" value={subs.filter((s) => s.consent).length} icon={<MSymbol name="verified" />} />
      </div>
      <Card className="px-5 py-3 text-sm">Public link for emails, web pages or a QR code: <code className="break-all rounded bg-surface-2 px-1">/f/{form.token}</code>
        {!form.active && <Pill tone="warn">Closed: visitors see that the form is not open</Pill>}</Card>
      <Panel title="Submissions">
        {subs.length === 0 ? <Empty title="No submissions yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>When</Th>{form.fields.map((f) => <Th key={f.key}>{f.label}</Th>)}<Th>Consent</Th><Th>Contact</Th></tr></thead>
            <tbody>{subs.map((s) => (
              <tr key={s.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(s.created_at)}</Td>{keys.map((k) => <Td key={k}>{s.data[k] ?? ""}</Td>)}
                <Td>{s.consent ? <Pill tone="ok">Yes</Pill> : "No"}</Td>
                <Td>{s.contact_id ? <Link className="text-accent hover:underline" href={`/crm/contacts`}>{s.contact_created ? "Created" : "Matched"}</Link> : "—"}</Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title="Edit form">
        <ActionForm action={saveForm} hidden={{ id: form.id, active_field: "1" }} submit="Save" className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <Input name="name" label="Name" value={form.name} required />
          <Select name="client_id" label="New people become contacts of" options={clientOptions(clients)} value={form.client_id} empty="Nobody (store submissions only)" />
          <TextArea name="description" label="Introduction" value={form.description} rows={2} className="sm:col-span-2" />
          <TextArea name="fields" label="Fields (Label | type | required | options)" value={toLines(form.fields)} rows={7} className="sm:col-span-2" required />
          <TextArea name="consent_text" label="Consent text" value={form.consent_text} rows={2} className="sm:col-span-2" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={form.active} /> Open for submissions</label>
        </ActionForm>
      </Panel>
    </>
  );
}
