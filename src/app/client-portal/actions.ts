"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClientFormResult } from "@/components/client/forms";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const PREVIEW_MSG = "This is a preview. Only the client's own users can respond here.";

const decideSchema = z.object({
  estimate_id: uuid,
  decision: z.enum(["approve", "decline"]),
  comment: z.string().max(4000).optional(),
  client_order_ref: z.string().max(80).optional(),
});

/** Client approver's decision on an estimate. Recorded and sent to the team, who confirm it in Order Management. */
export async function decideEstimate(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = decideSchema.safeParse({
    estimate_id: fd.get("estimate_id"), decision: fd.get("decision"),
    comment: String(fd.get("comment") ?? "") || undefined, client_order_ref: String(fd.get("client_order_ref") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Choose approve or decline." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_estimate_decide", {
    p_estimate: parsed.data.estimate_id, p_approve: parsed.data.decision === "approve",
    p_comment: parsed.data.comment ?? null, p_client_order_ref: parsed.data.client_order_ref ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/client-portal", "layout");
  return { ok: true, message: parsed.data.decision === "approve" ? "Thanks. Your approval is with us." : "Thanks. We will follow up." };
}

const feedbackSchema = z.object({
  client_id: uuid,
  score: z.coerce.number().int().min(0).max(10),
  comment: z.string().max(4000).optional(),
  market: z.string().max(2).optional(),
});

/** Client user (approver or viewer) rates us 0-10 for one of their own accounts. Recorded in CRM. */
export async function sendFeedback(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = feedbackSchema.safeParse({
    client_id: fd.get("client_id"), score: fd.get("score"),
    comment: String(fd.get("comment") ?? "").trim() || undefined, market: String(fd.get("market") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Choose a score from 0 to 10." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_feedback_submit", {
    p_client: parsed.data.client_id, p_score: parsed.data.score, p_comment: parsed.data.comment ?? null, p_market: parsed.data.market ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/client-portal/feedback");
  return { ok: true, message: "Thank you. Your account team will see this straight away." };
}

const commentSchema =z.object({ brief_id: uuid, body: z.string().trim().min(1, "Write a comment first.").max(4000) });

export async function commentOnBrief(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = commentSchema.safeParse({ brief_id: fd.get("brief_id"), body: fd.get("body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a comment first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_brief_comment", { p_brief: parsed.data.brief_id, p_body: parsed.data.body });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/briefs/${parsed.data.brief_id}`);
  return { ok: true, message: "Comment sent to us." };
}

/** The client's approver approves a proof or asks for changes (step g of the QA/QC process). */
export async function decideProof(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const id = uuid.safeParse(fd.get("proof_id"));
  const decision = fd.get("decision");
  if (!id.success || (decision !== "approve" && decision !== "changes")) return { error: "Choose approve or request changes." };
  const comment = String(fd.get("comment") ?? "").trim();
  if (decision === "changes" && comment.length < 3) return { error: "Tell us what needs to change." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_proof_decide", { p_proof: id.data, p_approve: decision === "approve", p_comment: comment || null });
  if (error) return { error: error.message };
  revalidatePath("/client-portal/proofs");
  revalidatePath("/client-portal");
  return { ok: true, message: decision === "approve" ? "Proof approved. The supplier can start production." : "Changes sent to the supplier." };
}

/** The client answers a brief that was sent back and resubmits it (it goes through the completeness check and approval again). */
export async function resubmitBrief(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const id = uuid.safeParse(fd.get("brief_id"));
  if (!id.success) return { error: "Brief not found." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 4000) return { error: "Keep the note under 4,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_brief_resubmit", { p_brief: id.data, p_note: note || null });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/briefs/${id.data}`);
  revalidatePath("/client-portal/briefs");
  return { ok: true, message: "Resubmitted. Our team will check it again." };
}

/** Client user confirms whether they will attend an upcoming business review. */
export async function respondReview(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const review = uuid.safeParse(fd.get("review_id"));
  const response = fd.get("response");
  if (!review.success || (response !== "attending" && response !== "declined")) return { error: "Choose whether you will attend." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_review_respond", { p_review: review.data, p_response: response, p_note: String(fd.get("note") ?? "").trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/client-portal");
  return { ok: true, message: response === "attending" ? "Thanks, see you there." : "Thanks for letting us know." };
}
const poSchema = z.object({ estimate_id: uuid, po_number: z.string().trim().min(2).max(80) });

/** Client approver gives its purchase order number for an estimate it approved. The database refuses viewers and other clients. */
export async function provideClientPo(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = poSchema.safeParse({ estimate_id: fd.get("estimate_id"), po_number: fd.get("po_number") });
  if (!parsed.success) return { error: "Enter your purchase order number." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_estimate_provide_po", { p_estimate: parsed.data.estimate_id, p_po_number: parsed.data.po_number, p_amount: null });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/estimates/${parsed.data.estimate_id}`);
  revalidatePath("/client-portal/estimates");
  return { ok: true, message: "Thanks. We have your purchase order and can place the order." };
}