"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireVendorCompany } from "@/lib/vendor-data";

// Vendor side of the proof step: start a round, send it, then launch production once the client has approved a proof.
// The database decides everything (own orders only, one round at a time, files and tracking number required).
export type ProofResult = { ok: boolean; message: string; id?: string };
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const refresh = (po: string) => { revalidatePath(`/vendor/orders/${po}`); revalidatePath("/vendor/orders"); };

export async function startProof(po: string, kind: "digital" | "physical"): Promise<ProofResult> {
  await requireVendorCompany();
  if (!uuid(po)) return { ok: false, message: "Purchase order not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_proof_start", { p_po: po, p_kind: kind });
  if (error) return { ok: false, message: error.message };
  refresh(po);
  return { ok: true, message: "Started. Upload the proof, then send it.", id: data as string };
}

export async function submitProof(po: string, proof: string, tracking: string, note: string): Promise<ProofResult> {
  await requireVendorCompany();
  if (!uuid(po) || !uuid(proof)) return { ok: false, message: "Proof not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_proof_submit", { p_proof: proof, p_tracking: tracking.trim() || null, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  refresh(po);
  return { ok: true, message: "Sent to our client services to check." };
}

export async function launchProduction(po: string): Promise<ProofResult> {
  await requireVendorCompany();
  if (!uuid(po)) return { ok: false, message: "Purchase order not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("po_vendor_start_production", { p_po: po });
  if (error) return { ok: false, message: error.message };
  refresh(po);
  return { ok: true, message: "Production launched." };
}
