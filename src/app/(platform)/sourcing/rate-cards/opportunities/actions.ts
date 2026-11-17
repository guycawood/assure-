"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, str, type FormResult } from "@/lib/sourcing-actions";

// Rate card opportunities: dismiss one with a reason, or bring it back. The database checks who may.
async function run(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message };
}

export async function dismissOpportunity(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_opportunity_dismiss", { p_key: str(fd, "key") ?? "", p_label: str(fd, "label") ?? "", p_reason: str(fd, "reason") ?? "" }, "Dismissed. It stays out of the list unless you show dismissed ones.");
}

export async function restoreOpportunity(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_opportunity_restore", { p_key: str(fd, "key") ?? "" }, "Back in the list.");
}
