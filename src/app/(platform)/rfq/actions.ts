"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numberList, numOrNull, str, UUID, type FormResult } from "@/lib/sourcing-actions";

/** Lines come from the form as spec_<n>, breaks_<n>, targets_<n>, show_<n> for each selected spec. */
function readLines(fd: FormData): { lines?: unknown[]; error?: string } {
  const specIds = fd.getAll("spec").map(String).filter((s) => UUID.test(s));
  if (specIds.length === 0) return { error: "Choose at least one spec line routed to Create." };
  const lines: unknown[] = [];
  for (const sid of specIds) {
    const breaks = numberList(str(fd, `breaks_${sid}`));
    if (breaks.length === 0 || breaks.some((b) => !Number.isInteger(b) || b <= 0)) return { error: "Quantity breaks must be whole numbers above zero, separated by commas." };
    if (breaks.length > 6) return { error: "Up to 6 quantity breaks per line." };
    const targetsRaw = str(fd, `targets_${sid}`);
    const targets = targetsRaw ? numberList(targetsRaw) : [];
    if (targets.some((t) => Number.isNaN(t) || t < 0)) return { error: "Target prices must be numbers." };
    if (targets.length && targets.length !== breaks.length) return { error: "Give one target price per quantity break, or leave targets empty." };
    lines.push({ spec_id: sid, quantity_breaks: breaks, target_prices: targets, show_targets: fd.get(`show_${sid}`) === "on", notes: str(fd, `notes_${sid}`) });
  }
  return { lines };
}

function dueAt(fd: FormData) {
  const d = str(fd, "due_date");
  const t = str(fd, "due_time") ?? "17:00";
  return d ? new Date(`${d}T${t}:00`).toISOString() : null;
}

export async function createRfq(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const { lines, error: lErr } = readLines(fd);
  if (lErr) return { error: lErr };
  const est = numOrNull(fd, "estimated_value");
  if (Number.isNaN(est)) return { error: "The estimated value must be a number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rfq_create", {
    p_job: id(fd, "job_id"), p_title: str(fd, "title"), p_due_at: dueAt(fd), p_estimated_value: est, p_lines: lines, p_notes: str(fd, "notes"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/rfq", "layout");
  redirect(`/rfq/${data}`);
}

export async function setSuppliers(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const ids = fd.getAll("supplier").map(String).filter((s) => UUID.test(s));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rfq_set_suppliers", { p_rfq: id(fd), p_suppliers: ids });
  if (error) return { error: friendly(error) };
  revalidatePath(`/rfq/${id(fd)}`);
  return { ok: true, message: `${data} supplier(s) chosen` };
}

async function simple(fn: string, args: Record<string, unknown>, path: string, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath(path);
  revalidatePath("/rfq");
  return { ok: true, message };
}

export async function approveHighValue(_: FormResult, fd: FormData) {
  return simple("rfq_approve_high_value", { p_rfq: id(fd), p_note: str(fd, "note") }, `/rfq/${id(fd)}`, "High-value RFQ approved");
}
export async function sendRfq(_: FormResult, fd: FormData) {
  return simple("rfq_send", { p_rfq: id(fd) }, `/rfq/${id(fd)}`, "RFQ sent to suppliers");
}
export async function cancelRfq(_: FormResult, fd: FormData) {
  return simple("rfq_cancel", { p_rfq: id(fd), p_reason: str(fd, "reason") }, `/rfq/${id(fd)}`, "RFQ cancelled");
}
export async function financeDecide(_: FormResult, fd: FormData) {
  return simple("rfq_finance_decide", { p_response: id(fd, "response_id"), p_approve: str(fd, "decision") === "approve", p_notes: str(fd, "notes") }, `/rfq/${id(fd)}`, "Finance decision recorded");
}

/** A buyer keys in a quote received by email: price_<lineId>_<qty> fields. */
export async function logQuote(_: FormResult, fd: FormData): Promise<FormResult> {
  const prices: { line_id: string; quantity: number; unit_price: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^price_([0-9a-f-]{36})_(\d+)$/i.exec(k);
    if (!m || typeof v !== "string" || v.trim() === "") continue;
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return { error: "Prices must be numbers." };
    prices.push({ line_id: m[1], quantity: Number(m[2]), unit_price: n });
  }
  const lead = numOrNull(fd, "lead_time_days");
  return simple("rfq_log_quote", { p_rfq: id(fd), p_supplier: id(fd, "supplier_id"), p_prices: prices, p_lead_time_days: lead, p_notes: str(fd, "notes") }, `/rfq/${id(fd)}`, "Quote logged");
}

export async function awardRfq(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rfq_award", { p_rfq: id(fd), p_response: id(fd, "response_id"), p_reason: str(fd, "reason"), p_bypass_code: str(fd, "bypass_code") });
  if (error) return { error: friendly(error) };
  revalidatePath("/rfq", "layout");
  revalidatePath("/orders", "layout");
  redirect(`/orders/estimates/${data}`);
}
