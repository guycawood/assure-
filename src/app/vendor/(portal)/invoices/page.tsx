import Link from "next/link";
import { requireVendorCompany, rpcList } from "@/lib/vendor-data";
import { formatDate } from "@/lib/srt";
import { human, money } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata = { title: "Invoices & payments" };

type Invoice = {
  id: string; invoice_ref: string; invoice_number: string; po_id: string; po_number: string; invoice_date: string; due_date: string;
  payment_terms: string; currency: string; gross_amount: number; status: string; reason: string | null; file_id: string | null;
  payments: { seq: number; due_date: string; amount: number; paid_on: string | null; payment_reference: string | null; status: string }[];
};
type InvoiceablePo = { id: string; po_number: string; job_number: string; title: string; currency: string; total_value: number; invoiced: number; payment_terms: string };

const tone = (s: string) => (s === "paid" || s === "approved" ? "ok" : s === "disputed" || s === "rejected" ? "bad" : "warn");

// Vendor view of Finance+: every invoice sent, where it is in matching and payment, and orders still to invoice.
export default async function VendorInvoices() {
  await requireVendorCompany();
  const [invoices, pos] = await Promise.all([rpcList<Invoice>("finance_vendor_invoices"), rpcList<InvoiceablePo>("finance_vendor_invoiceable_pos")]);
  const toInvoice = pos.filter((p) => Number(p.invoiced) < Number(p.total_value));
  const open = invoices.filter((i) => !["paid", "rejected"].includes(i.status));
  const overdue = invoices.flatMap((i) => i.payments).filter((p) => p.status === "overdue").length;
  const disputed = invoices.filter((i) => i.status === "disputed").length;

  return (
    <>
      <PageHead title="Invoices & payments" sub="Invoices you have sent against adm Indicia purchase orders, how matching is going, and when you will be paid." />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Orders to invoice" value={toInvoice.length} icon={<MSymbol name="receipt_long" size={20} />} />
        <Stat label="Invoices in progress" value={open.length} icon={<MSymbol name="pending_actions" size={20} />} />
        <Stat label="Need your attention" value={disputed} tone={disputed ? "bad" : "ok"} hint="Disputed invoices" icon={<MSymbol name="report" size={20} />} />
        <Stat label="Payments overdue" value={overdue} tone={overdue ? "warn" : "ok"} icon={<MSymbol name="schedule" size={20} />} />
      </section>

      <Panel title="Orders still to invoice" sub="Accepted purchase orders with value not yet invoiced. Open one to send the invoice.">
        {toInvoice.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing to invoice right now.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">PO</th><th className="th">Job</th><th className="th text-right">PO value</th><th className="th text-right">Invoiced</th><th className="th">Terms</th></tr></thead>
            <tbody>{toInvoice.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <td className="td"><Link href={`/vendor/orders/${p.id}`} className="font-semibold text-accent hover:underline">{p.po_number}</Link></td>
                <td className="td">{p.title}<span className="block text-xs text-muted">{p.job_number}</span></td>
                <td className="td text-right tabular-nums">{money(p.total_value, p.currency)}</td>
                <td className="td text-right tabular-nums">{money(p.invoiced, p.currency)}</td>
                <td className="td">{p.payment_terms}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5"><h2 className="font-bold">Invoices sent</h2></div>
        {invoices.length === 0 ? <Empty title="No invoices yet">Send an invoice from an accepted purchase order.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Invoice</th><th className="th">PO</th><th className="th text-right">Gross</th><th className="th">Due</th><th className="th">Payments</th><th className="th">Status</th></tr></thead>
            <tbody>{invoices.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="td font-semibold">{i.file_id ? <a href={`/api/files/${i.file_id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{i.invoice_number}</a> : i.invoice_number}
                  <span className="block text-xs font-normal text-muted">Our ref {i.invoice_ref} · {formatDate(i.invoice_date)}</span></td>
                <td className="td"><Link href={`/vendor/orders/${i.po_id}`} className="hover:underline">{i.po_number}</Link></td>
                <td className="td text-right tabular-nums">{money(i.gross_amount, i.currency)}</td>
                <td className="td">{formatDate(i.due_date)}<span className="block text-xs text-muted">{i.payment_terms}</span></td>
                <td className="td text-xs">{i.payments.length === 0 ? <span className="text-muted">Scheduled once approved</span> : i.payments.map((p) => (
                  <span key={p.seq} className="block">{money(p.amount, i.currency)} · {p.status === "paid" ? `paid ${formatDate(p.paid_on)}${p.payment_reference ? ` (${p.payment_reference})` : ""}` : `${p.status} ${formatDate(p.due_date)}`}</span>))}</td>
                <td className="td"><Pill tone={tone(i.status)}>{human(i.status)}</Pill>{i.reason && <span className="mt-1 block text-xs text-muted">{i.reason}</span>}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
