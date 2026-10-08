"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

const done = () => {
  revalidatePath("/assure", "layout");
};

export async function createDraft() {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("scorecard_create_draft");
  if (error) throw new Error(error.message);
  done();
  redirect("/assure/watchtower/methodology");
}

export type DraftPayload = {
  id: string;
  settings: { preferred_threshold: number; require_coc: boolean; missing_data: "redistribute" | "zero" };
  pillars: { key: string; weight: number }[];
  criteria: { key: string; weight: number; bands: unknown }[];
};

export async function saveDraft(p: DraftPayload): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("scorecard_save_draft", {
    p_id: p.id, p_settings: p.settings, p_pillars: p.pillars, p_criteria: p.criteria,
  });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Draft saved. The preview below shows the effect." };
}

export async function activateDraft(id: string, note: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("scorecard_activate", { p_id: id, p_note: note });
  if (error) return { ok: false, message: error.message };
  done();
  redirect("/assure/watchtower");
}

export async function discardDraft(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("scorecard_discard_draft", { p_id: id });
  if (error) throw new Error(error.message);
  done();
  redirect("/assure/watchtower");
}
