"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

/** The client's standing sustainability targets (CRM). Briefs pre-fill from them and ideation always applies them. */
export async function setClientSustainability(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const pct = str(fd, "min_recycled_pct");
  const floor = str(fd, "impact_grade_floor");
  if (pct && (!Number.isInteger(Number(pct)) || Number(pct) < 0 || Number(pct) > 100)) return { error: "Minimum recycled content is a whole number from 0 to 100." };
  if (floor && (!Number.isFinite(Number(floor)) || Number(floor) < 0 || Number(floor) > 100)) return { error: "The Impact Grade floor is 0 to 100." };
  const payload = {
    statement: str(fd, "statement"),
    min_recycled_pct: pct,
    require_fsc: fd.get("require_fsc") === "on",
    excluded_materials: (str(fd, "excluded_materials") ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
    recyclable_required: fd.get("recyclable_required") === "on",
    reuse_expected: fd.get("reuse_expected") === "on",
    impact_grade_floor: floor,
    reporting_obligations: str(fd, "reporting_obligations"),
    source_contract_id: str(fd, "source_contract_id"),
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_client_set_sustainability", { p_client: id(fd), p: payload, p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${id(fd)}`);
  revalidatePath("/briefing", "layout");
  return { ok: true, message: "Saved. New briefs for this client start from these targets, and ideation always applies them." };
}
