import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFinanceEvents, getInvoice, getPayments, isFinance } from "@/lib/finance-data";
import { INVOICE_STATUS, PAYMENT_STATUS, TERMS_LABEL, money } from "@/lib/finance-logic";
import { UUID } from "@/lib/sourcing-actions";
import { Card, PageHead, Panel } from "@/components/ui";
import { Facts, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { FileList } from "@/components/file-list";
import { FinanceActivity, MatchPanel } from "@/components/finance/bits";
import { approveInvoice, disputeInvoice, markPaid, matchInvoice, rejectInvoice, requestOverride, resolveDispute, schedulePayment } from "../../actions";

export const metadata: Metadata = { title: "Supplier invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [inv, payments, events, canAct] = await Promise.all([getInvoice(supabase, id), getPayments(supabase, { invoice_id: id }), getFinanceEvents(supabase, { invoice_id: id }), isFinance(supabase)]);
  if (!inv) notFound();
  const open = ["submitted", "matching", "disputed"].includes(inv.status);
  const unmatched = inv.status === "matching" && inv.match_status !== "matched" && inv.match_status !== "not_run";
  const iRequested = inv.override_requested_by === me.id;

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Supplier invoices", href: "/finance/invoices" }, { label: inv.invoice_number }]}
        title={`Invoice ${inv.invoice_number}`} sub={`${inv.supplier_name} · ${inv.invoice_ref} · ${inv.po_number}`}>
        <StatusPill meta={INVOICE_STATUS} value={inv.status} />
      </PageHead>

      <Card>
        <Facts items={[
          ["Supplier", inv.supplier_name],
          ["Purchase order", <Link key="po" className="text-accent hover:underline" href={`/orders/purchase-orders/${inv.po_id}`}>{inv.po_number} ({money(inv.po_value, inv.currency)})</Link>],
          ["Job", <Link key="job" className="text-accent hover:underline" href={`/sourcing/jobs/${inv.job_id}`}>{inv.job_number} · {inv.job_title}</Link>],
          ["Client", inv.client_name],
          ["Invoice date", fmtDate(inv.invoice_date)],
          ["Terms and due date", `${TERMS_LABEL(inv.payment_terms)} · due ${fmtDate(inv.due_date)}`],
          ["Net", money(inv.net_amount, inv.currency)],
          ["VAT", money(inv.vat_amount, inv.currency)],
          ["Gross", <strong key="g">{money(inv.gross_amount, inv.currency)}</strong>],
          ["Region / market", `${inv.region} · ${inv.market}`],
          ["Submitted", `${fmtDateTime(inv.submitted_at)}${inv.submitted_by_vendor ? " by the vendor" : ""}`],
          ["Approved", inv.approved_at ? `${fmtDateTime(inv.approved_at)}${inv.approved_by_name ? ` by ${inv.approved_by_name}` : ""}` : "—"],
        ]} />
        {(inv.dispute_reason && inv.status === "disputed") && <p className="border-t border-line px-5 py-3 text-sm text-warn">Queried: {inv.dispute_reason}</p>}
        {inv.rejected_reason && inv.status === "rejected" && <p className="border-t border-line px-5 py-3 text-sm text-bad">Rejected: {inv.rejected_reason}</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Three-way match" sub="Worked out by the server from the PO, Logistics+ and Execution+ records"
          actions={canAct && ["submitted", "matching"].includes(inv.status) ? <ActionForm action={matchInvoice} hidden={{ id: inv.id }} submit={inv.match_status === "not_run" ? "Run the match" : "Run again"} variant="secondary" inline /> : undefined}>
          <MatchPanel status={inv.match_status} details={inv.match_details} poId={inv.po_id} poNumber={inv.po_number} jobId={inv.job_id} />
          {inv.override_reason && (
            <div className="border-t border-line px-5 py-3 text-sm">
              <span className="font-semibold">Override:</span> {inv.override_reason}
              <div className="text-xs text-muted">{inv.override_requested_by_name ? `Recorded by ${inv.override_requested_by_name}` : "Recorded"}{inv.override_requested_at ? ` on ${fmtDateTime(inv.override_requested_at)}` : ""}</div>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Invoice document">
            <div className="px-5 py-4"><FileList entityType="supplier_invoice" entityId={inv.id} empty="No PDF attached." /></div>
          </Panel>

          {canAct && open && (
            <Panel title="Decide" sub="Approve only a matched invoice, or one with an override recorded by a different finance user">
              <div className="space-y-5 px-5 py-4">
                {inv.status === "matching" && (inv.match_status === "matched" || (inv.override_requested_by && !iRequested)) && (
                  <ActionForm action={approveInvoice} hidden={{ id: inv.id }} submit={inv.match_status === "matched" ? "Approve for payment" : "Approve with override"}>
                    <Field label="Note (optional)" htmlFor="note"><input id="note" name="note" className="input" /></Field>
                  </ActionForm>
                )}
                {unmatched && !inv.override_requested_by && (
                  <ActionForm action={requestOverride} hidden={{ id: inv.id }} submit="Record override" variant="secondary">
                    <Field label="Why pay without a full match?" htmlFor="ov" hint="A different finance user must then approve it."><textarea id="ov" name="reason" className="input" rows={2} required /></Field>
                  </ActionForm>
                )}
                {unmatched && iRequested && <p className="text-sm text-muted">You recorded the override, so someone else in Finance approves it.</p>}
                {inv.status === "disputed" ? (
                  <ActionForm action={resolveDispute} hidden={{ id: inv.id }} submit="Mark query resolved" variant="secondary">
                    <Field label="How was it resolved?" htmlFor="res"><input id="res" name="note" className="input" required /></Field>
                  </ActionForm>
                ) : (
                  <ActionForm action={disputeInvoice} hidden={{ id: inv.id }} submit="Query with the supplier" variant="secondary">
                    <Field label="What needs fixing?" htmlFor="dis"><input id="dis" name="reason" className="input" required /></Field>
                  </ActionForm>
                )}
                <ActionForm action={rejectInvoice} hidden={{ id: inv.id }} submit="Reject invoice" variant="danger" confirm="Reject this invoice? The supplier will need to send a new one.">
                  <Field label="Reason for rejecting" htmlFor="rej"><input id="rej" name="reason" className="input" required /></Field>
                </ActionForm>
              </div>
            </Panel>
          )}

          {canAct && inv.status === "approved" && (
            <Panel title="Schedule payment" sub={`Default: one payment of ${money(inv.gross_amount, inv.currency)} on ${fmtDate(inv.due_date)}`}>
              <div className="px-5 py-4">
                <ActionForm action={schedulePayment} hidden={{ id: inv.id }} submit="Schedule payment">
                  <Field label="Instalments (optional)" htmlFor="inst" hint="One per line: date then amount, e.g. 2026-11-30 1200. They must add up to the gross amount.">
                    <textarea id="inst" name="instalments" className="input" rows={3} placeholder={`${inv.due_date} ${inv.gross_amount}`} />
                  </Field>
                </ActionForm>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {payments.length > 0 && (
        <Panel title="Payment schedule" sub={`${money(inv.paid_amount, inv.currency)} paid of ${money(inv.gross_amount, inv.currency)}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>#</Th><Th>Due</Th><Th>Amount</Th><Th>Status</Th><Th>Paid</Th><Th /></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id} className="align-top">
                  <Td>{p.seq}</Td><Td>{fmtDate(p.due_date)}</Td><Td className="tabular-nums">{money(p.amount, p.currency)}</Td>
                  <Td><StatusPill meta={PAYMENT_STATUS} value={p.status} /></Td>
                  <Td>{p.paid_on ? <>{fmtDate(p.paid_on)}<div className="text-xs text-muted">{p.payment_reference}{p.paid_by_name ? ` · ${p.paid_by_name}` : ""}</div></> : "—"}</Td>
                  <Td>{canAct && !p.paid_at && inv.status === "scheduled" && (
                    <ActionForm action={markPaid} hidden={{ id: p.id }} submit="Mark paid" variant="secondary" inline>
                      <input name="reference" className="input w-40" placeholder="Payment reference" aria-label="Payment reference" required />
                      <input name="paid_on" type="date" className="input w-40" aria-label="Paid on" />
                    </ActionForm>
                  )}</Td>
                </tr>))}</tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Activity" sub="Append-only: every step is kept">
        <FinanceActivity events={events} />
      </Panel>
    </>
  );
}
