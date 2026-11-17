"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ProofResult } from "@/app/vendor/(portal)/orders/proof-actions";

// Client services side of the proof step: check the proof and send it to the client, or send it back to the supplier.
const refresh = (po: string) => { revalidatePath(`/orders/purchase-orders/${po}`); revalidatePath("/client-portal", "layout"); };

export async function reviewProof(po: string, proof: string, ok: boolean, note: string, sentOn: string): Promise<ProofResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("proof_cs_review", { p_proof: proof, p_ok: ok, p_note: note.trim() || null, p_sent_on: sentOn || null });
  if (error) return { ok: false, message: error.message };
  refresh(po);
  return { ok: true, message: ok ? "Checked and sent to the client." : "Sent back to the supplier." };
}

export async function waiveProof(po: string, reason: string): Promise<ProofResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("po_proof_waive", { p_po: po, p_reason: reason });
  if (error) return { ok: false, message: error.message };
  refresh(po);
  return { ok: true, message: "Proof waived: the supplier can launch production." };
}
