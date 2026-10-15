import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getImportLogs } from "@/lib/crm-data";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { ImportWizard } from "@/components/crm/import-wizard";

export const metadata: Metadata = { title: "Import from HubSpot · CRM" };

// Moving off HubSpot (admins only): companies, contacts, deals and the Client Stakeholder Performance object.
export default async function CrmImport() {
  await requireAdmin();
  const supabase = await createClient();
  const logs = await getImportLogs(supabase);
  return (
    <>
      <PageHead title="Import from HubSpot" sub="Bring HubSpot exports into CRM. Import companies first, then contacts, then deals and the Client Stakeholder Performance records. Every imported row keeps its HubSpot record ID."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Import" }]}>
        <Link prefetch={false} href="/crm/export/contacts" className="text-sm font-semibold text-accent underline">Export contacts (CSV)</Link>
        <Link prefetch={false} href="/crm/export/opportunities" className="text-sm font-semibold text-accent underline">Export opportunities (CSV)</Link>
      </PageHead>
      <Card className="px-5 py-4"><ImportWizard /></Card>
      <Card className="px-5 py-3 text-xs text-muted">
        Duplicates are found by HubSpot record ID, email (contacts), company name or website domain (companies) and client plus name (deals). Opt-outs and the legal basis come across;
        an import never opts anyone back in. New companies go through the new-client set-up check like any other client.
      </Card>
      <Panel title="Import log">
        {logs.length === 0 ? <Empty title="Nothing imported yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>When</Th><Th>What</Th><Th>File</Th><Th>Rows</Th><Th>New</Th><Th>Updated</Th><Th>Skipped</Th><Th>By</Th></tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l.id}><Td>{fmtDateTime(l.created_at)}</Td><Td className="capitalize">{l.kind}</Td><Td>{l.file_name ?? "—"}</Td><Td>{l.row_count}</Td>
                <Td>{l.created_count}</Td><Td>{l.updated_count}</Td><Td>{l.skipped_count}{l.duplicates.length ? <div className="text-xs text-muted">{l.duplicates.length} duplicates</div> : null}</Td>
                <Td>{l.created_by_name ?? "—"}</Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
