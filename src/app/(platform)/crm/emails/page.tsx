import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEmails, getLibrary, getLists } from "@/lib/crm-data";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Disclosure, Input, Select, TextArea } from "@/components/crm/bits";
import { saveEmail } from "../actions";

export const metadata: Metadata = { title: "Emails · CRM" };

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

export default async function CrmEmails() {
  await requireInternal();
  const supabase = await createClient();
  const [emails, lists, templates] = await Promise.all([getEmails(supabase), getLists(supabase), getLibrary(supabase, "crm_email_templates")]);
  return (
    <>
      <PageHead title="Emails" sub="Marketing emails to signed-off client lists and internal comms to staff, with opens and clicks so you can check who has read it. Opt-outs and consent are checked on every send."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Emails" }]}>
        <Link href="/crm/lists" className="text-sm font-semibold text-accent underline">Lists</Link>
      </PageHead>
      <Card className="border-warn/40 px-5 py-3 text-sm">No email provider is connected yet: sends are queued in the outbox, and opens and clicks can be simulated on each email for the demo (marked as simulated).</Card>
      <Card className="overflow-x-auto">
        {emails.length === 0 ? <Empty title="No emails yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Email</Th><Th>List</Th><Th>Status</Th><Th>Sent to</Th><Th>Opened</Th><Th>Clicked</Th><Th>Unsubscribed</Th><Th>Sent</Th></tr></thead>
            <tbody>{emails.map((e) => (
              <tr key={e.id}><Td><Link className="font-semibold hover:underline" href={`/crm/emails/${e.id}`}>{e.name}</Link><div className="text-xs text-muted">{e.subject}</div></Td>
                <Td>{e.list_name}<div className="text-xs text-muted">{e.audience === "external" ? "Client contacts" : "Staff"}</div></Td>
                <Td><Pill tone={e.status === "sent" ? "ok" : "neutral"}>{e.status}</Pill>{e.approval_pending && <div className="mt-1"><Pill tone="warn">Approval pending</Pill></div>}</Td>
                <Td>{e.recipient_count}{e.excluded_count ? <div className="text-xs text-muted">{e.excluded_count} excluded</div> : null}</Td>
                <Td>{e.opened} <span className="text-xs text-muted">({pct(e.opened, e.recipient_count)})</span></Td>
                <Td>{e.clicked} <span className="text-xs text-muted">({pct(e.clicked, e.recipient_count)})</span></Td>
                <Td>{e.unsubscribed}</Td><Td>{fmtDate(e.sent_at)}{e.simulated && <div className="text-xs text-muted">simulated events</div>}</Td></tr>))}</tbody>
          </table>
        )}
      </Card>
      <Disclosure summary="Write an email">
        <ActionForm action={saveEmail} submit="Save draft" className="grid gap-3 sm:grid-cols-2">
          <Input name="name" label="Name (internal)" required />
          <Select name="list_id" label="List" options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.audience === "external" ? "clients" : "staff"})` }))} empty="Choose…" required />
          <Select name="template_id" label="Template" options={templates.map((t) => ({ value: t.id, label: t.name }))} empty="None (write below)" />
          <Input name="link" label="Link to include ({{link}})" placeholder="https://…" />
          <Input name="subject" label="Subject (leave empty to use the template)" className="sm:col-span-2" />
          <TextArea name="body" label="Message (leave empty to use the template)" rows={6} className="sm:col-span-2"
            placeholder={"Dear {{first_name}},\n\n…\n\n{{owner_name}}\n\nNo longer want these emails? {{unsubscribe}}"} />
          <p className="-mt-2 text-xs text-muted sm:col-span-2">Placeholders: {"{{first_name}}, {{owner_name}}, {{client_name}}, {{link}}, {{unsubscribe}}"} (client emails always carry an unsubscribe link).</p>
        </ActionForm>
      </Disclosure>
    </>
  );
}
