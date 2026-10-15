"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

// Internal actions on technical & packaging data sheets. The vendor declares; adm Indicia opens a sheet for a supplier
// (pre-filled from that supplier's verified sheets) or reopens one. Verification only happens at the QA/QC pre-shipment check.

function refresh(fd: FormData) {
  const spec = id(fd, "spec"), po = id(fd, "po");
  if (spec) revalidatePath(`/sourcing/specs/${spec}`);
  if (po) revalidatePath(`/orders/purchase-orders/${po}`);
  revalidatePath("/sourcing/tech-sheets");
}

export async function openTechSheet(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const spec = id(fd, "spec"), supplier = id(fd, "supplier");
  if (!spec || !supplier) return { error: "Choose a supplier." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("tech_sheet_ensure", { p_spec: spec, p_supplier: supplier, p_spec_version: id(fd, "version") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: "Data sheet opened. The vendor fills it in and declares it in the vendor portal." };
}

export async function reopenTechSheet(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("tech_sheet_reopen", { p_sheet: id(fd), p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: "Reopened; the vendor has been told and can declare it again." };
}
