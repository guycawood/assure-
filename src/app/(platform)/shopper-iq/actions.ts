"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function recordEffectiveness(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const p = Object.fromEntries(["campaign_id", "region", "market", "touchpoint", "p2p_stage", "channel", "period_start", "period_end", "spend", "currency",
    "units", "execution_score", "uplift_pct", "uplift_source", "notes"].map((k) => [k, str(fd, k)]));
  const { error } = await supabase.rpc("siq_record_effectiveness", { p });
  if (error) return { ok: false, message: error.message.includes("check constraint") ? "Uplift needs a source, and execution scores run from 0 to 100." : error.message };
  revalidatePath("/shopper-iq", "layout");
  return { ok: true, message: "Recorded. A colleague verifies it before clients see it." };
}

type DecisionResult = { ok?: boolean; error?: string; message?: string };

/** A second person verifies (or rejects) a result before clients see it. */
export async function verifyEffectiveness(_prev: DecisionResult, fd: FormData): Promise<DecisionResult> {
  await requireInternal();
  const supabase = await createClient();
  const approve = str(fd, "decision") === "approve";
  const { error } = await supabase.rpc("siq_verify_effectiveness", { p_id: str(fd, "id"), p_approve: approve, p_note: str(fd, "note") || null });
  if (error) return { error: error.message };
  revalidatePath("/shopper-iq", "layout");
  return { ok: true, message: approve ? "Verified: clients can now see it." : "Rejected." };
}

/** Rights/brand sign-off before an asset can be reused in briefs. */
export async function signOffAsset(_prev: DecisionResult, fd: FormData): Promise<DecisionResult> {
  await requireInternal();
  const supabase = await createClient();
  const approve = str(fd, "decision") === "approve";
  const { error } = await supabase.rpc("siq_asset_signoff", { p_id: str(fd, "id"), p_approve: approve, p_note: str(fd, "note") || null });
  if (error) return { error: error.message };
  revalidatePath("/shopper-iq", "layout");
  return { ok: true, message: approve ? "Signed off: available to Briefing+." : "Rejected." };
}

export async function addAsset(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const p = {
    ...Object.fromEntries(["title", "asset_type", "campaign_id", "region", "market", "brand", "touchpoint", "p2p_stage", "file_name", "file_url"].map((k) => [k, str(fd, k)])),
    metadata: Object.fromEntries(["headline", "theme", "format"].map((k) => [k, str(fd, k)]).filter(([, v]) => v)),
  };
  const { error } = await supabase.rpc("siq_add_asset", { p });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/shopper-iq", "layout");
  return { ok: true, message: "Asset added. It can be reused in briefs once a colleague signs off rights and brand use." };
}
