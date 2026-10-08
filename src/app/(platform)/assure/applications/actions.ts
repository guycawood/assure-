"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string };

async function call(fn: string, args: Record<string, unknown>, ok: string): Promise<Result> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/assure/applications");
  return { ok: true, message: ok };
}

export async function decideApplication(id: string, status: string, note: string) {
  return call("vendor_application_decide", { p_id: id, p_status: status, p_note: note || null }, "Saved.");
}

export async function approvePlan(supplierId: string, tier: string, reason: string) {
  const renewal = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  if (tier === "cancel") return call("assure_set_subscription", { p_supplier: supplierId, p_tier: null, p_status: "cancelled", p_renewal: null, p_reason: reason }, "Plan cancelled.");
  return call("assure_set_subscription", { p_supplier: supplierId, p_tier: tier, p_status: "active", p_renewal: renewal, p_reason: reason }, "Plan updated.");
}

export async function declinePlan(id: string, reason: string) {
  return call("assure_decline_subscription_request", { p_id: id, p_reason: reason }, "Request declined.");
}
