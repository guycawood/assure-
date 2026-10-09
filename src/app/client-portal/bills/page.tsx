import type { Metadata } from "next";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { fmtDate, fmtMoney } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Bills" };

type Bill = {
  id: string; bill_number: string; client_name: string; billing_entity: string | null; job_number: string; job_title: string; estimate_number: string;
  client_order_ref: string | null; currency: string; net_amount: number; vat_percent: number; vat_amount: number; gross_amount: number;
  issue_date: string | null; due_date: string | null; paid_at: string | null; payment_reference: string | null; region: string; market: string;
  status: "sent" | "paid" | "overdue";
};

const LABEL = { sent: ["To pay", "warn"], overdue: ["Overdue", "bad"], paid: ["Paid", "ok"] } as const;

// Bills adm Indicia has sent from Finance+, per job, with what is still to pay.
export default async function ClientBills({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const bills = (await rpc<Bill[]>(ctx.supabase, "client_portal_bills", scope(ctx))) ?? [];
  const open = bills.filter((b) => b.status !== "paid");
  const byCur = (rows: Bill[]) => Object.entries(rows.reduce<Record<string, number>>((m, b) => ({ ...m, [b.currency]: (m[b.currency] ?? 0) + Number(b.gross_amount) }), {}))
    .map(([c, v]) => fmtMoney(v, c, 0)).join(" · ") || "—";
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Bills" sub="Bills for your approved jobs, with due dates and payment status." />
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="To pay" value={byCur(open)} icon={<MSymbol name="account_balance_wallet" size={20} />} />
        <Stat label="Overdue" value={bills.filter((b) => b.status === "overdue").length} tone={bills.some((b) => b.status === "overdue") ? "bad" : "ok"} icon={<MSymbol name="schedule" size={20} />} />
        <Stat label="Paid" value={byCur(bills.filter((b) => b.status === "paid"))} tone="ok" icon={<MSymbol name="check_circle" size={20} />} />
      </section>
      <Card className="overflow-x-auto">
        {bills.length === 0 ? <Empty title="No bills yet">Bills appear here once adm Indicia sends them.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Bill</th><th className="th">Job</th><th className="th">Your PO</th><th className="th text-right">Net</th><th className="th text-right">VAT</th><th className="th text-right">Total</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
            <tbody>{bills.map((b) => {
              const [label, tone] = LABEL[b.status];
              return (
                <tr key={b.id} className="align-top">
                  <td className="td font-semibold">{b.bill_number}<span className="block text-xs font-normal text-muted">{fmtDate(b.issue_date)}{b.billing_entity ? ` · ${b.billing_entity}` : ""}</span></td>
                  <td className="td">{b.job_title}<span className="block text-xs text-muted">{b.job_number} · {b.estimate_number} · {b.region} · {b.market}</span></td>
                  <td className="td">{b.client_order_ref ?? "—"}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(b.net_amount, b.currency, 2)}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(b.vat_amount, b.currency, 2)}<span className="block text-xs text-muted">{b.vat_percent}%</span></td>
                  <td className="td text-right font-semibold tabular-nums">{fmtMoney(b.gross_amount, b.currency, 2)}</td>
                  <td className="td">{fmtDate(b.due_date)}</td>
                  <td className="td"><Pill tone={tone}>{label}</Pill>{b.paid_at && <span className="block text-xs text-muted">{fmtDate(b.paid_at)}{b.payment_reference ? ` · ${b.payment_reference}` : ""}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
