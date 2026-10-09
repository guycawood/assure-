"use client";

import { ActionForm } from "@/components/vendor/action-form";
import { submitInvoice } from "@/app/vendor/(portal)/orders/invoice-actions";

/** Send an invoice against an accepted PO: PDF plus the invoice details Finance+ matches on. */
export function InvoiceForm({ poId, poNumber, currency, remaining }: { poId: string; poNumber: string; currency: string; remaining: number }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={submitInvoice} submit="Send invoice" resetOnOk hidden={{ po_id: poId, currency }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Your invoice number</span><input name="number" required maxLength={60} className="input" /></label>
        <label><span className="label">Invoice date</span><input name="date" type="date" required max={today} defaultValue={today} className="input" /></label>
        <label><span className="label">Net amount ({currency})</span><input name="net" type="number" step="0.01" min="0.01" required defaultValue={remaining > 0 ? remaining.toFixed(2) : undefined} className="input" /></label>
        <label><span className="label">VAT ({currency})</span><input name="vat" type="number" step="0.01" min="0" defaultValue="0" className="input" /></label>
      </div>
      <label><span className="label">Invoice PDF</span><input name="file" type="file" required accept=".pdf,image/*" className="input" /></label>
      <p className="text-xs text-muted">Quote {poNumber} on the invoice and invoice in {currency}. It is matched to the order and proof of delivery before payment.</p>
    </ActionForm>
  );
}
