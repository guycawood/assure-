"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

// The sourcing team's side of a rate card request. The database decides who may do what at each stage.
async function run(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  return { ok: true, message };
}

export async function takeRequest(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_request_take", { p_id: id(fd) }, "You own this request now. The requester has been told.");
}
export async function startPricing(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_request_pricing", { p_id: id(fd), p_rfq: str(fd, "rfq") || null }, "Moved to pricing.");
}
export async function buildCardFromRequest(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_request_build", { p_id: id(fd), p_supplier_code: str(fd, "supplier"), p_unit_price: numOrNull(fd, "price"), p_currency: str(fd, "currency") || "EUR", p_from: str(fd, "from") || null },
    "Card drafted. A different governor approves it, then it needs a reviewed Impact Grade.");
}
export async function declineRequest(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_request_decline", { p_id: id(fd), p_reason: str(fd, "reason") }, "Request declined. The requester has been told.");
}
export async function changeCardPrice(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_change_price", { p_card: id(fd, "card"), p_price: numOrNull(fd, "price"), p_from: str(fd, "from") || null, p_note: str(fd, "note") },
    "New price version created. A different governor approves it; the grade carries over.");
}
export async function retireCard(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("library_retire", { p_id: id(fd, "card"), p_note: str(fd, "note") }, "Card retired. It can no longer be chosen.");
}
export async function approveCardRecord(_: FormResult, fd: FormData): Promise<FormResult> {
  const approve = str(fd, "decision") === "approve";
  return run("library_approve", { p_id: id(fd, "card"), p_approve: approve, p_note: str(fd, "note") || null }, approve ? "Card approved. It can be chosen once its grade is reviewed." : "Card rejected.");
}
