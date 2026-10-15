import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAudience, getEmailRecipients, getEmails } from "@/lib/crm-data";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { sendEmail, simulateEmailEvents } from "../../actions";

export const metadata: Metadata = { title: "Email · CRM" };

export default async function CrmEmail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const email = (await getEmails(supabase)).find((e) => e.id === id);
  if (!email) notFound();
  const [recipients, audience] = await Promise.all([getEmailRecipients(supabase, id), email.status === "draft" ? getAudience(supabase, email.list_id) : Promise.resolve([])]);
  const sent = recipients.filter((r) => r.status === "sent");
  const shown = sp.show === "unread" ? sent.filter((r) => !r.opens) : sp.show === "read" ? sent.filter((r) => r.opens) : recipients;

  return (
    <>
      <PageHead title={email.name} sub={`To ${email.list_name} (${email.audience === "external" ? "client contacts" : "staff"}) · ${email.status}`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Emails", href: "/crm/emails" }, { label: email.name }]} />
      <ApprovalRequests entityIds={id} types={["CRM_SEND"]} meId={me.id} title="Send waiting for approval" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sent to" value={email.recipient_count} hint={`${email.excluded_count} excluded`} icon={<MSymbol name="send" />} />
        <Stat label="Opened" value={email.opened} hint={email.recipient_count ? `${Math.round((100 * email.opened) / email.recipient_count)}%` : undefined} icon={<MSymbol name="drafts" />} />
        <Stat label="Clicked" value={email.clicked} icon={<MSymbol name="ads_click" />} />
        <Stat label="Unsubscribed" value={email.unsubscribed} icon={<MSymbol name="unsubscribe" />} />
      </div>

      <Panel title="Message" sub={email.subject}>
        <pre className="whitespace-pre-wrap px-5 py-4 font-sans text-sm">{email.body}</pre>
        {email.link && <p className="border-t border-line px-5 py-2 text-xs text-muted">Link: {email.link}</p>}
      </Panel>

      {email.status === "draft" && !email.approval_pending && (
        <Card className="space-y-3 px-5 py-4">
          <p className="text-sm">{audience.filter((a) => !a.block).length} people will get this; {audience.filter((a) => a.block).length} are excluded:</p>
          {audience.some((a) => a.block) && (
            <ul className="text-xs text-muted">{audience.filter((a) => a.block).map((a) => <li key={(a.contact_id ?? a.profile_id)!}>{a.full_name} ({a.client_name}): {a.block}</li>)}</ul>
          )}
          <ActionForm action={sendEmail} hidden={{ id }} submit="Send" confirm="Send this email now?" inline />
        </Card>
      )}
      {email.status === "sent" && !email.simulated && (
        <Card className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
          <span>Demo: no email provider is connected, so there are no real opens or clicks.</span>
          <ActionForm action={simulateEmailEvents} hidden={{ id }} submit="Simulate opens and clicks" variant="secondary" inline />
        </Card>
      )}

      <Panel title="Who has read this" sub={email.simulated ? "Events are simulated for the demo" : undefined}
        actions={<div className="flex gap-2 text-xs"><Link className="underline" href={`/crm/emails/${id}`}>All</Link><Link className="underline" href={`/crm/emails/${id}?show=read`}>Read</Link><Link className="underline" href={`/crm/emails/${id}?show=unread`}>Not read</Link></div>}>
        {shown.length === 0 ? <Empty title={email.status === "draft" ? "Not sent yet" : "Nobody here"} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Client</Th><Th>Status</Th><Th>First opened</Th><Th>Opens</Th><Th>Clicks</Th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}><Td className="font-semibold">{r.full_name}</Td><Td>{r.email ?? "—"}</Td><Td>{r.client_name ?? "adm Indicia"}</Td>
                <Td>{r.status === "excluded" ? <span className="text-bad">Excluded: {r.excluded_reason}</span> : r.unsubscribed_at ? <Pill tone="bad">Unsubscribed</Pill> : <Pill tone={r.opens ? "ok" : "neutral"}>{r.opens ? "Read" : "Not read"}</Pill>}</Td>
                <Td>{r.first_opened_at ? fmtDateTime(r.first_opened_at) : "—"}</Td><Td>{r.opens}</Td><Td>{r.clicks}</Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
