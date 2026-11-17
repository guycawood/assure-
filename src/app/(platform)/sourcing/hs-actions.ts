"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

/** Staff set, override or clear a spec's HS code. The source says where it came from; the note is kept in the job's activity. */
export async function setSpecHs(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const specId = id(fd, "spec_id");
  if (!specId) return { error: "Spec not found." };
  const source = ["person", "library", "supplier"].includes(str(fd, "source") ?? "") ? str(fd, "source")! : "person";
  const code = str(fd, "hs_code");
  const supabase = await createClient();
  const { error } = await supabase.rpc("spec_hs_set", { p_spec: specId, p_code: code ?? "", p_source: source, p_note: str(fd, "note") });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  revalidatePath("/assure/suppliers", "layout");
  return { ok: true, message: code ? `HS code set to ${code}.` : "HS code cleared." };
}
