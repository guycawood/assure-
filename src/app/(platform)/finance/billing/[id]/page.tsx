import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBill, getFinanceEvents, isFinance } from "@/lib/finance-data";
import { BILL_STATUS, money, pct } from "@/lib/finance-logic";
import { UUID } from "@/lib/sourcing-actions";
import { Card, PageHead, Panel } from "@/components/ui";
import { Facts, StatusPill, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { FinanceActivity } from "@/components/finance/bits";
import { billPaid, cancelBill, sendBill } from "../../actions";

export const metadata: Metadata = { title: "Client bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [b, events, canAct] = await Promise.all([getBill(supabase, id), getFinanceEvents(supabase, { entity: "bill", entity_id: id }), isFinance(supabase)]);
  if (!b) notFound();
  const margin = b.cost_amount != null && Number(b.net_amount) > 0 ? (100 * (Number(b.net_amount) - Number(b.cost_amount))) / Number(b.net_amount) : null;

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Client billing", href: "/finance/billing" }, { label: b.bill_number }]}
        title={`Bill ${b.bill_number}`} sub={`${b.client_name} · ${b.job_number} · ${b.job_title}`}>
        <StatusPill meta={BILL_STATUS} value={b.status} />
      </PageHead>
      <Card>
        <Facts items={[
          ["Client", `${b.client_name} (${b.client_code})`],
          ["Client order reference", b.client_order_ref ?? "—"],
          ["Estimate", <Link key="e" className="text-accent hover:underline" href={`/orders/estimates/${b.estimate_id}`}>{b.estimate_number}</Link>],
          ["Billing entity", b.billing_entity_name ? `${b.billing_entity_name}${b.billing_entity_vat ? ` · VAT ${b.billing_entity_vat}` : ""}` : "—"],
          ["Net", money(b.net_amount, b.currency)],
          ["VAT", `${money(b.vat_amount, b.currency)} (${pct(b.vat_percent, 0)})`],
          ["Gross", <strong key="g">{money(b.gross_amount, b.currency)}</strong>],
          ["Supplier cost / margin", `${money(b.cost_amount, b.currency)} · ${pct(margin)}`],
          ["Issued / due", b.issue_date ? `${fmtDate(b.issue_date)} · due ${fmtDate(b.due_date)}` : "Not sent yet"],
          ["Region / market", `${b.region} · ${b.market}`],
          ["Paid", b.paid_at ? `${fmtDateTime(b.paid_at)} · ${b.payment_reference}` : "—"],
          ["Notes", b.notes ?? "—"],
        ]} />
        {b.cancelled_reason && <p className="border-t border-line px-5 py-3 text-sm text-bad">Cancelled: {b.cancelled_reason}</p>}
      </Card>

      {canAct && ["draft", "sent"].includes(b.status) && (
        <Panel title="Next step">
          <div className="space-y-5 px-5 py-4">
            {b.status === "draft" && <ActionForm action={sendBill} hidden={{ id: b.id }} submit="Mark as sent to the client" />}
            {b.status === "sent" && (
              <ActionForm action={billPaid} hidden={{ id: b.id }} submit="Mark paid">
                <Field label="Payment reference" htmlFor="ref"><input id="ref" name="reference" className="input" required /></Field>
              </ActionForm>
            )}
            <ActionForm action={cancelBill} hidden={{ id: b.id }} submit="Cancel bill" variant="danger" confirm="Cancel this bill?">
              <Field label="Reason" htmlFor="why"><input id="why" name="reason" className="input" required /></Field>
            </ActionForm>
          </div>
        </Panel>
      )}

      <Panel title="Activity"><FinanceActivity events={events} /></Panel>
    </>
  );
}
