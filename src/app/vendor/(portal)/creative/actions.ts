"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireVendorCompany } from "@/lib/vendor-data";

// Vendor side of the creative RFI: confirm or decline, then accept the IP rule and send the ideation proposal.
// The database decides everything (own invitations only, standard access, open RFI, due date).
export type RfiResult = { ok: boolean; message: string };
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function respondCreativeRfi(invite: string, confirm: boolean, reason: string): Promise<RfiResult> {
  await requireVendorCompany();
  if (!uuid(invite)) return { ok: false, message: "Request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_creative_rfi_respond", { p_invite: invite, p_confirm: confirm, p_reason: reason.trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/creative");
  return { ok: true, message: confirm ? "Thanks. Upload your proposal and send it before the due date." : "Thanks. We have logged your reason." };
}

export async function sendCreativeProposal(invite: string, ipConfirmed: boolean, note: string): Promise<RfiResult> {
  await requireVendorCompany();
  if (!uuid(invite)) return { ok: false, message: "Request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_creative_rfi_propose", { p_invite: invite, p_ip_confirmed: ipConfirmed, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/creative");
  return { ok: true, message: "Proposal sent to us." };
}

export async function shipSample(sample: string, carrier: string, tracking: string, note: string): Promise<RfiResult> {
  await requireVendorCompany();
  if (!uuid(sample)) return { ok: false, message: "Sample request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_sample_ship", { p_sample: sample, p_carrier: carrier.trim() || null, p_tracking: tracking, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/creative");
  return { ok: true, message: "Thanks. We can see the tracking number." };
}