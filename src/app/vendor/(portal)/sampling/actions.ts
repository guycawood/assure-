"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireVendorCompany } from "@/lib/vendor-data";

// Vendor side of the sampling job (GBT RFP process r11, r16, r20): quote the sample, confirm the launch, send it.
// The database decides everything (own jobs only, standard access, the right status, photos and tracking).
export type SamplingActionResult = { ok: boolean; message: string };
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

async function call(job: string, fn: string, args: Record<string, unknown>, message: string): Promise<SamplingActionResult> {
  await requireVendorCompany();
  if (!uuid(job)) return { ok: false, message: "Sampling job not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/sampling");
  return { ok: true, message };
}

export async function quoteSample(job: string, amount: string, leadDays: string, note: string) {
  return call(job, "vendor_sampling_quote", { p_job: job, p_amount: amount === "" ? null : Number(amount), p_lead_days: leadDays === "" ? null : Number(leadDays), p_note: note.trim() || null }, "Sample quote sent to us.");
}
export async function launchSample(job: string, note: string) {
  return call(job, "vendor_sampling_launch", { p_job: job, p_note: note.trim() || null }, "Launch confirmed.");
}
export async function shipSampleJob(job: string, carrier: string, tracking: string, invoice: string, note: string) {
  return call(job, "vendor_sampling_ship", { p_job: job, p_carrier: carrier.trim() || null, p_tracking: tracking, p_invoice_ref: invoice.trim() || null, p_note: note.trim() || null }, "Thanks. We can see the tracking number.");
}
