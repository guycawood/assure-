import Link from "next/link";
import { Card, Empty, Pill } from "@/components/ui";

// SRM: each vendor's jobs across all clients, with where each is on the way to being paid. Amounts only come through for roles allowed to see money.
export type VendorJobRow = {
  po_id: string; po_number: string; po_status: string; po_date: string; delivery_date: string | null;
  job_id: string; job_number: string; job_title: string; client_name: string; client_code: string;
  supplier_id: string; supplier_name: string; region: string; market: string;
  invoice_ref?: string; invoice_status?: string; stage: Stage; expected_date?: string; paid_at?: string; overdue: boolean;
  po_value?: number; invoice_amount?: number; currency?: string;
};
export type VendorJobsSummary = { total: number; no_invoice: number; invoice_received: number; approved: number; scheduled: number; paid: number; disputed: number; overdue: number; can_see_money: boolean };
export type Stage = "no_invoice" | "invoice_received" | "approved" | "scheduled" | "paid" | "disputed";

export const STAGES: { key: Stage; label: string; tone: "neutral" | "info" | "ok" | "bad" | "warn" }[] = [
  { key: "no_invoice", label: "No invoice yet", tone: "neutral" },
  { key: "invoice_received", label: "Invoice received", tone: "info" },
  { key: "approved", label: "Approved for payment", tone: "info" },
  { key: "scheduled", label: "Payment scheduled", tone: "info" },
  { key: "paid", label: "Paid", tone: "ok" },
  { key: "disputed", label: "Disputed", tone: "bad" },
];
const stageOf = (k: string) => STAGES.find((s) => s.key === k) ?? { key: k, label: k, tone: "neutral" as const };
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No date yet");
const money = (n?: number, cur?: string) => (n == null ? null : `${cur ?? "EUR"} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function VendorJobsSummaryCards({ s, base }: { s: VendorJobsSummary; base: string }) {
  const tile = (label: string, value: number, href: string, tone?: string) => (
    <Link href={href} className="rounded-lg border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-accent/50">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`font-display text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
    </Link>
  );
  const q = (stage: string) => `${base}${base.includes("?") ? "&" : "?"}stage=${stage}`;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tile("Jobs with vendors", s.total, base)}
      {tile("Waiting for an invoice", s.no_invoice, q("no_invoice"))}
      {tile("Invoice in progress", s.invoice_received + s.approved, q("invoice_received"))}
      {tile("Scheduled to pay", s.scheduled, q("scheduled"))}
      {tile("Paid", s.paid, q("paid"), "text-ok")}
      {tile("Late to pay", s.overdue, q("overdue"), s.overdue ? "text-bad" : "")}
    </div>
  );
}

export function VendorJobsTable({ rows, showVendor = true, money: canSeeMoney }: { rows: VendorJobRow[]; showVendor?: boolean; money: boolean }) {
  if (rows.length === 0) return <Card className="p-5"><Empty title="No jobs match">Change the filters, or wait for orders to be placed with vendors.</Empty></Card>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr>{["Job", "Client", ...(showVendor ? ["Vendor"] : []), "Order", "Delivery due", "Payment", "Expected or paid", ...(canSeeMoney ? ["Value"] : [])].map((h) => <th key={h} className="th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = stageOf(r.stage);
            return (
              <tr key={r.po_id} className="align-top">
                <td className="td"><b>{r.job_title}</b><div className="text-xs text-muted">{r.job_number} · {r.market}</div></td>
                <td className="td">{r.client_name}</td>
                {showVendor && <td className="td"><Link className="font-semibold hover:text-accent" href={`/assure/suppliers/${r.supplier_id}?tab=jobs`}>{r.supplier_name}</Link></td>}
                <td className="td">{r.po_number}<div className="text-xs text-muted">{r.po_status}</div></td>
                <td className="td tabular-nums">{day(r.delivery_date)}</td>
                <td className="td"><div className="flex flex-wrap items-center gap-1.5"><Pill tone={st.tone}>{st.label}</Pill>{r.overdue && <Pill tone="bad">Late</Pill>}</div>
                  {r.invoice_ref && <div className="text-xs text-muted">{r.invoice_ref}</div>}</td>
                <td className="td tabular-nums">{r.stage === "paid" ? `Paid ${day(r.paid_at)}` : r.stage === "no_invoice" ? "No invoice yet" : day(r.expected_date)}</td>
                {canSeeMoney && <td className="td tabular-nums">{money(r.po_value, r.currency) ?? "—"}{r.invoice_amount != null && <div className="text-xs text-muted">Invoice {money(r.invoice_amount, r.currency)}</div>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
