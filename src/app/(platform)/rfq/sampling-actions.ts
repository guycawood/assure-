"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// The team's side of the sampling job on an RFQ (GBT RFP process r10 to r24). The database decides everything.
export type SamplingResult = { ok: boolean; message: string };

async function run(rfq: string, fn: string, args: Record<string, unknown>, message: string): Promise<SamplingResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/rfq/${rfq}`);
  return { ok: true, message };
}

export async function requestSampling(rfq: string, supplier: string, description: string, quantity: string) {
  return run(rfq, "sampling_request", { p_rfq: rfq, p_supplier: supplier, p_description: description, p_quantity: Number(quantity) || 1 }, "Sample quote requested. The supplier sees it in the vendor portal.");
}
export async function decideSamplingApproval(rfq: string, job: string, clientRequired: boolean) {
  return run(rfq, "sampling_decide_approval", { p_job: job, p_client_required: clientRequired }, clientRequired ? "Sent to the client for approval." : "Accepted without the client. You can issue the sample PO.");
}
export async function issueSamplePo(rfq: string, job: string) {
  return run(rfq, "sampling_issue_po", { p_job: job }, "Sample PO issued and sent to the supplier.");
}
export async function sendSamplingDrawing(rfq: string, job: string) {
  return run(rfq, "sampling_send_drawing", { p_job: job }, "Drawing sent to the client for sign-off.");
}
export async function receiveSample(rfq: string, job: string, note: string) {
  return run(rfq, "sampling_receive", { p_job: job, p_note: note.trim() || null }, "Arrival recorded.");
}
export async function reviewSample(rfq: string, job: string, ok: boolean, note: string) {
  return run(rfq, "sampling_review", { p_job: job, p_ok: ok, p_note: note.trim() || null }, ok ? "Sample OK. The reception notice is raised." : "Sample rejected and the sample PO invalidated.");
}
export async function sendSampleToClient(rfq: string, job: string) {
  return run(rfq, "sampling_send_to_client", { p_job: job }, "Sample sent to the client for approval.");
}
export async function cancelSampling(rfq: string, job: string, reason: string) {
  return run(rfq, "sampling_cancel", { p_job: job, p_reason: reason }, "Sampling job cancelled.");
}
