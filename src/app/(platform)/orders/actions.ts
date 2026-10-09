"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";
import { COST_CATEGORIES } from "@/lib/sourcing-hub";
import { uploadFile } from "@/app/files-actions";

async function call(fn: string, args: Record<string, unknown>, paths: string[], message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  for (const p of paths) revalidatePath(p);
  revalidatePath("/orders", "layout");
  return { ok: true, message };
}

/* ---------- Estimates ---------- */
export async function setPricing(_: FormResult, fd: FormData) {
  const pctValue = numOrNull(fd, "percent");
  if (pctValue == null || Number.isNaN(pctValue)) return { error: "Enter a percentage." };
  return call("estimate_set_pricing", { p_estimate: id(fd), p_mode: str(fd, "mode"), p_percent: pctValue }, [`/orders/estimates/${id(fd)}`], "Pricing saved");
}
export async function sendEstimate(_: FormResult, fd: FormData) {
  return call("estimate_send", { p_estimate: id(fd) }, [`/orders/estimates/${id(fd)}`], "Marked as sent to the client");
}
export async function approveEstimate(_: FormResult, fd: FormData) {
  return call("estimate_approve", { p_estimate: id(fd), p_client_order_ref: str(fd, "client_order_ref") }, [`/orders/estimates/${id(fd)}`], "Client approval recorded; Stocktool hand-off queued");
}
export async function declineEstimate(_: FormResult, fd: FormData) {
  return call("estimate_decline", { p_estimate: id(fd), p_reason: str(fd, "reason") }, [`/orders/estimates/${id(fd)}`], "Estimate declined");
}

/* ---------- Estimate commercials, client POs and the Stocktool hand-off (Sourcing Hub) ---------- */
export async function setCommercials(_: FormResult, fd: FormData) {
  const c = numOrNull(fd, "gsc_commission_percent") ?? 0;
  const r = numOrNull(fd, "rebate_percent") ?? 0;
  if (Number.isNaN(c) || Number.isNaN(r)) return { error: "Enter the commission and rebate as percentages." };
  return call("estimate_set_commercials", { p_estimate: id(fd), p_commission: c, p_rebate: r }, [`/orders/estimates/${id(fd)}`], "Commission and rebate saved");
}

/** One row per cost category: cost_<category> (amount) and costdesc_<category>. Product cost comes from the supplier lines. */
export async function setCostLines(_: FormResult, fd: FormData) {
  const lines: { category: string; amount: number; description: string | null }[] = [];
  for (const c of COST_CATEGORIES) {
    const amount = numOrNull(fd, `cost_${c.value}`);
    if (amount == null) continue;
    if (Number.isNaN(amount) || amount < 0) return { error: `Enter the ${c.label.toLowerCase()} cost as a number.` };
    lines.push({ category: c.value, amount, description: str(fd, `costdesc_${c.value}`) });
  }
  return call("estimate_set_cost_lines", { p_estimate: id(fd), p_lines: lines }, [`/orders/estimates/${id(fd)}`], "Cost split saved");
}

export async function setLogistics(_: FormResult, fd: FormData) {
  return call("estimate_set_logistics", {
    p_estimate: id(fd),
    p_data: { incoterm: str(fd, "incoterm"), port_of_loading: str(fd, "port_of_loading"), forwarder: str(fd, "forwarder"), consignee: str(fd, "consignee"), hub: str(fd, "hub") },
  }, [`/orders/estimates/${id(fd)}`], "Hand-off details saved");
}

export async function addClientPo(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const estimateId = id(fd);
  const po = str(fd, "po_number");
  const amount = numOrNull(fd, "amount");
  if (!estimateId) return { error: "Estimate not found." };
  if (!po) return { error: "Enter the client's PO number." };
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "Enter the PO amount." };
  let fileId: string | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const up = new FormData();
    up.set("file", file);
    up.set("module", "orders");
    up.set("entity_type", "client_po");
    up.set("entity_id", estimateId);
    up.set("label", `Client PO ${po}`);
    const res = await uploadFile(up);
    if (!res.ok) return { error: res.message };
    fileId = res.id ?? null;
  }
  return call("estimate_add_client_po", { p_estimate: estimateId, p_po_number: po, p_amount: amount, p_po_date: str(fd, "po_date"), p_file: fileId },
    [`/orders/estimates/${estimateId}`], "Client PO added");
}

export async function removeClientPo(_: FormResult, fd: FormData) {
  return call("estimate_remove_client_po", { p_id: id(fd, "po_id"), p_reason: str(fd, "reason") }, [`/orders/estimates/${id(fd)}`], "Client PO removed");
}

export async function refreshHandoff(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("estimate_refresh_handoff", { p_estimate: id(fd) });
  if (error) return { error: friendly(error) };
  revalidatePath("/orders", "layout");
  const missing = (data as string[] | null) ?? [];
  return { ok: true, message: missing.length ? `Hand-off refreshed. Still missing: ${missing.join(", ")}` : "Hand-off refreshed: nothing missing" };
}

/* ---------- Purchase orders ---------- */
export async function createPo(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("po_create_from_estimate", { p_estimate: id(fd), p_delivery_date: str(fd, "delivery_date"), p_notes: str(fd, "notes") });
  if (error) return { error: friendly(error) };
  revalidatePath("/orders", "layout");
  redirect(`/orders/purchase-orders/${data}`);
}
export async function approvePo(_: FormResult, fd: FormData) {
  return call("po_approve", { p_po: id(fd), p_note: str(fd, "note") }, [`/orders/purchase-orders/${id(fd)}`], "PO approved and issued to the vendor");
}
export async function rejectPo(_: FormResult, fd: FormData) {
  return call("po_reject", { p_po: id(fd), p_reason: str(fd, "reason") }, [`/orders/purchase-orders/${id(fd)}`], "PO rejected");
}

/* ---------- PSA exceptions ---------- */
export async function createPsa(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const fee = numOrNull(fd, "fee");
  if (fee == null || Number.isNaN(fee)) return { error: "Enter the fee." };
  if (!str(fd, "title") || !str(fd, "business_reason")) return { error: "Give a title and the business reason." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("psa_create", {
    p_title: str(fd, "title"), p_supplier: id(fd, "supplier_id"), p_job: id(fd, "job_id"), p_po: id(fd, "po_id"), p_fee: fee,
    p_currency: str(fd, "currency"), p_business_reason: str(fd, "business_reason"), p_region: str(fd, "region"), p_market: str(fd, "market"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/orders/psa");
  redirect(`/orders/psa/${data}`);
}
export async function submitPsa(_: FormResult, fd: FormData) {
  return call("psa_submit", { p_id: id(fd), p_line_manager: id(fd, "line_manager") }, [`/orders/psa/${id(fd)}`], "Sent to your line manager");
}
export async function lineManagerPsa(_: FormResult, fd: FormData) {
  return call("psa_line_manager_decide", { p_id: id(fd), p_approve: str(fd, "decision") === "approve", p_notes: str(fd, "notes") }, [`/orders/psa/${id(fd)}`], "Decision recorded");
}
export async function assessPsa(_: FormResult, fd: FormData) {
  return call("psa_assess", { p_id: id(fd), p_outcome: str(fd, "outcome"), p_notes: str(fd, "notes"), p_value_impact: numOrNull(fd, "value_impact") }, [`/orders/psa/${id(fd)}`], "Assessment recorded");
}
export async function approvePsa(_: FormResult, fd: FormData) {
  return call("psa_approve", { p_id: id(fd), p_approve: str(fd, "decision") === "approve", p_notes: str(fd, "notes") }, [`/orders/psa/${id(fd)}`], "Decision recorded");
}
export async function applyPsa(_: FormResult, fd: FormData) {
  return call("psa_apply", { p_id: id(fd), p_follow_up: str(fd, "follow_up") }, [`/orders/psa/${id(fd)}`], "Fee exception applied");
}
