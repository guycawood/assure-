import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInvoices } from "@/lib/finance-data";
import { INVOICE_STATUS, MATCH_STATUS, money } from "@/lib/finance-logic";
import { Card, Empty, PageHead } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { FilterLinks } from "@/components/finance/bits";

export const metadata: Metadata = { title: "Supplier invoices" };

const FILTERS: [string, string, (s: string) => boolean][] = [
  ["open", "Waiting for Finance", (s) => ["submitted", "matching", "disputed"].includes(s)],
  ["submitted", "To match", (s) => s === "submitted"],
  ["matching", "In review", (s) => s === "matching"],
  ["disputed", "Queried", (s) => s === "disputed"],
  ["approved", "Approved", (s) => s === "approved"],
  ["scheduled", "Scheduled", (s) => s === "scheduled"],
  ["paid", "Paid", (s) => s === "paid"],
  ["rejected", "Rejected", (s) => s === "rejected"],
  ["all", "All", () => true],
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const current = FILTERS.find((f) => f[0] === sp.status) ?? FILTERS[0];
  const supabase = await createClient();
  const all = await getInvoices(supabase);
  const list = all.filter((i) => current[2](i.status));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Supplier invoices" }]} title="Supplier invoices"
        sub="Vendors upload invoices against accepted POs in the vendor portal. Each is matched against the PO value, the deliveries and PODs in Logistics+, and the installs in Execution+." />
      <FilterLinks base="/finance/invoices" param="status" current={current[0]} options={FILTERS.map(([k, l, f]) => ({ key: k, label: l, count: all.filter((i) => f(i.status)).length }))} />
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No invoices here" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>PO</Th><Th>Net</Th><Th>Gross</Th><Th>Due</Th><Th>Match</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.id}>
                <Td><Link className="font-semibold hover:underline" href={`/finance/invoices/${i.id}`}>{i.invoice_number}</Link><div className="text-xs text-muted">{i.invoice_ref} · {fmtDate(i.invoice_date)}</div></Td>
                <Td>{i.supplier_name}<div className="text-xs text-muted">{i.market} · {i.region}</div></Td>
                <Td>{i.po_number}<div className="text-xs text-muted">{i.job_number} · {i.client_name}</div></Td>
                <Td className="tabular-nums">{money(i.net_amount, i.currency)}<div className="text-xs text-muted">PO {money(i.po_value)}</div></Td>
                <Td className="tabular-nums">{money(i.gross_amount, i.currency)}</Td>
                <Td className={!["paid", "rejected"].includes(i.status) && i.due_date < today ? "text-bad" : ""}>{fmtDate(i.due_date)}</Td>
                <Td><StatusPill meta={MATCH_STATUS} value={i.match_status} /></Td>
                <Td><StatusPill meta={INVOICE_STATUS} value={i.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
