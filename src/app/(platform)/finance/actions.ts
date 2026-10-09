"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";
import { parseInstalments } from "@/lib/finance-logic";

async function call(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/finance", "layout");
  return { ok: true, message };
}

/* ---------- Approvals ---------- */
// Quotes use RFQ+'s own decision function, so RFQ+ and Finance+ never disagree.
export async function decideQuote(_: FormResult, fd: FormData) {
  const approve = str(fd, "decision") === "approve";
  const res = await call("rfq_finance_decide", { p_response: id(fd), p_approve: approve, p_notes: str(fd, "notes") }, approve ? "Quote approved" : "Quote declined");
  if (res.ok) revalidatePath("/rfq", "layout");
  return res;
}

export async function decideEstimate(_: FormResult, fd: FormData) {
  const approve = str(fd, "decision") === "approve";
  const res = await call("finance_estimate_decide", { p_estimate: id(fd), p_approve: approve, p_reason: str(fd, "reason") }, approve ? "Estimate approved by Finance" : "Estimate declined");
  if (res.ok) revalidatePath("/orders", "layout");
  return res;
}

/* ---------- Supplier invoices ---------- */
export async function matchInvoice(_: FormResult, fd: FormData) {
  return call("finance_match_invoice", { p_invoice: id(fd) }, "Three-way match updated");
}
export async function requestOverride(_: FormResult, fd: FormData) {
  return call("finance_request_override", { p_invoice: id(fd), p_reason: str(fd, "reason") }, "Override recorded. A different finance user now approves it.");
}
export async function approveInvoice(_: FormResult, fd: FormData) {
  return call("finance_approve_invoice", { p_invoice: id(fd), p_note: str(fd, "note") }, "Invoice approved; the supplier has been told");
}
export async function disputeInvoice(_: FormResult, fd: FormData) {
  return call("finance_dispute_invoice", { p_invoice: id(fd), p_reason: str(fd, "reason") }, "Query sent to the supplier");
}
export async function resolveDispute(_: FormResult, fd: FormData) {
  return call("finance_resolve_dispute", { p_invoice: id(fd), p_note: str(fd, "note") }, "Query resolved; the match was run again");
}
export async function rejectInvoice(_: FormResult, fd: FormData) {
  return call("finance_reject_invoice", { p_invoice: id(fd), p_reason: str(fd, "reason") }, "Invoice rejected; the supplier has been told why");
}
export async function schedulePayment(_: FormResult, fd: FormData) {
  const { items, error } = parseInstalments(str(fd, "instalments"));
  if (error) return { error };
  return call("finance_schedule_payment", { p_invoice: id(fd), p_items: items.length ? items : null }, "Payment scheduled; the supplier has been told");
}

/* ---------- Payments ---------- */
export async function markPaid(_: FormResult, fd: FormData) {
  return call("finance_mark_paid", { p_item: id(fd), p_reference: str(fd, "reference"), p_paid_on: str(fd, "paid_on") }, "Payment recorded");
}

/* ---------- Client billing ---------- */
export async function createBill(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const vat = numOrNull(fd, "vat_percent");
  if (Number.isNaN(vat)) return { error: "Enter the VAT rate as a number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_bill_create", { p_estimate: id(fd, "estimate_id"), p_vat_percent: vat ?? 0, p_notes: str(fd, "notes") });
  if (error) return { error: friendly(error) };
  revalidatePath("/finance", "layout");
  redirect(`/finance/billing/${data}`);
}
export async function sendBill(_: FormResult, fd: FormData) {
  return call("finance_bill_send", { p_bill: id(fd) }, "Bill marked as sent");
}
export async function billPaid(_: FormResult, fd: FormData) {
  return call("finance_bill_mark_paid", { p_bill: id(fd), p_reference: str(fd, "reference") }, "Bill marked paid");
}
export async function cancelBill(_: FormResult, fd: FormData) {
  return call("finance_bill_cancel", { p_bill: id(fd), p_reason: str(fd, "reason") }, "Bill cancelled");
}
