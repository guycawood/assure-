import Link from "next/link";
import { requireVendorCompany, rpcList, type VendorRfqRow } from "@/lib/vendor-data";
import { formatDate } from "@/lib/srt";
import { daysUntil, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Quote requests" };

function stateOf(r: VendorRfqRow): { label: string; tone: ReturnType<typeof statusTone> } {
  if (r.invitation_status === "declined") return { label: "You declined", tone: "neutral" };
  if (r.rfq_status === "awarded") return r.quote_status === "awarded" ? { label: "Awarded to you", tone: "ok" } : { label: "Closed", tone: "neutral" };
  if (r.rfq_status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (!r.open) return { label: r.quote_status === "submitted" ? "Closed · quote in" : "Closed", tone: "neutral" };
  if (r.quote_status === "submitted") return { label: "Quote submitted", tone: "accent" };
  if (r.quote_status === "draft") return { label: "Draft saved", tone: "warn" };
  return { label: "To quote", tone: "info" };
}

export default async function QuotesPage() {
  await requireVendorCompany();
  const rows = await rpcList<VendorRfqRow>("rfq_vendor_list");
  const open = rows.filter((r) => r.open && r.invitation_status !== "declined");
  const past = rows.filter((r) => !open.includes(r));

  const table = (list: VendorRfqRow[]) => (
    <table className="w-full text-sm">
      <thead><tr><th className="th">Request</th><th className="th">Lines</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
      <tbody>
        {list.map((r) => {
          const st = stateOf(r);
          const d = daysUntil(r.due_at);
          return (
            <tr key={r.rfq_id} className="hover:bg-surface-2">
              <td className="td"><Link href={`/vendor/quotes/${r.rfq_id}`} className="font-semibold hover:underline">{r.title}</Link><span className="block text-xs text-muted">{r.rfq_number} · {r.currency}</span></td>
              <td className="td tabular-nums">{r.line_count}</td>
              <td className="td">{formatDate(r.due_at)}{r.open && d !== null && <span className={`block text-xs ${d <= 2 ? "text-bad" : "text-muted"}`}>{d <= 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} left`}</span>}</td>
              <td className="td"><Pill tone={st.tone}>{st.label}</Pill></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHead title="Quote requests" sub="Price each quantity break before the due date. Quotes are sealed: adm Indicia sees yours, and nobody else does. You can change a quote until the due date." />
      <Card className="overflow-x-auto">
        <p className="border-b border-line px-5 py-3 font-display text-[0.95rem] font-bold">Open ({open.length})</p>
        {open.length ? table(open) : <Empty title="No open quote requests">When adm Indicia invites you to quote, it appears here and we&apos;ll notify you.</Empty>}
      </Card>
      {past.length > 0 && (
        <Card className="overflow-x-auto">
          <p className="border-b border-line px-5 py-3 font-display text-[0.95rem] font-bold">Closed and past ({past.length})</p>
          {table(past)}
        </Card>
      )}
    </>
  );
}
