import "server-only";
import { rows, one, type Client } from "@/lib/sourcing-data";
import type { ClientBill, FinanceEstimate, FinanceEvent, PaymentItem, QuoteQueueRow, SpendRow, SupplierInvoice } from "@/lib/finance-logic";

// Server-side reads for Finance+, as the signed-in user under RLS (internal only), through views that join names.

export const getInvoices = (s: Client, eq: Record<string, string> = {}) =>
  rows<SupplierInvoice>(s, "v_supplier_invoices", { eq, order: [["submitted_at", false]], limit: 5000 });
export const getInvoice = (s: Client, id: string) => one<SupplierInvoice>(s, "v_supplier_invoices", id);

export const getPayments = (s: Client, eq: Record<string, string> = {}) =>
  rows<PaymentItem>(s, "v_payment_schedule", { eq, order: [["due_date", true], ["seq", true]], limit: 5000 });

export const getBills = (s: Client) => rows<ClientBill>(s, "v_client_bills", { order: [["created_at", false]], limit: 5000 });
export const getBill = (s: Client, id: string) => one<ClientBill>(s, "v_client_bills", id);

export const getFinanceEstimates = (s: Client, eq: Record<string, string | boolean> = {}) =>
  rows<FinanceEstimate>(s, "v_finance_estimates", { eq, order: [["created_at", false]], limit: 5000 });

export const getQuoteQueue = (s: Client) => rows<QuoteQueueRow>(s, "v_finance_quote_queue", { order: [["due_at", true]], limit: 2000 });

export const getSpend = (s: Client) => rows<SpendRow>(s, "v_finance_spend", { limit: 10000 });

export const getFinanceEvents = (s: Client, eq: Record<string, string>) =>
  rows<FinanceEvent>(s, "v_finance_events", { eq, order: [["at", false]], limit: 300 });

/** Is the signed-in person Finance (same rule as RFQ+ quote approval)? */
export async function isFinance(s: Client): Promise<boolean> {
  const { data } = await s.rpc("finance_is_finance");
  return data === true;
}

/** Number value of a finance rule for display (null if not set up). */
export async function ruleValue(s: Client, code: string, fallback: number): Promise<number> {
  const { data } = await s.rpc("finance_rule_value", { p_code: code, p_default: fallback });
  return data == null ? fallback : Number(data);
}
