import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * After calling a gated function: if it opened an approval request (instead of acting straight away), say so.
 * Returns null when nothing is waiting, so the caller keeps its normal success message.
 */
export async function sentForApproval(supabase: Client, type: string, entityId: string): Promise<string | null> {
  const { data } = await supabase.from("approval_requests_v").select("request_no, approver_label")
    .eq("approval_type", type).eq("entity_id", entityId).eq("status", "pending").limit(1).maybeSingle();
  if (!data) return null;
  const r = data as { request_no: number; approver_label: string };
  return `Sent for approval (request #${r.request_no}). ${r.approver_label} must approve it before it takes effect.`;
}
