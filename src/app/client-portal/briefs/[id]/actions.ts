"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClientFormResult } from "@/components/client/forms";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const schema = z.object({ concept_id: uuid, brief_id: uuid, decision: z.enum(["approve", "changes"]), comment: z.string().max(4000).optional() });

const quoteSchema = z.object({ brief_id: uuid, decision: z.enum(["approve", "reject"]), reason: z.string().max(4000).optional(), po: z.string().max(80).optional() });

/** Client approver's decision on the creative quote, with its PO number if it has one. The database refuses viewers and other clients. */
export async function decideCreativeQuote(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: "This is a preview. Only the client's own approvers can respond here." };
  const parsed = quoteSchema.safeParse({
    brief_id: fd.get("brief_id"), decision: fd.get("decision"),
    reason: String(fd.get("reason") ?? "").trim() || undefined, po: String(fd.get("po") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: "Choose approve or reject." };
  if (parsed.data.decision === "reject" && !parsed.data.reason) return { error: "Tell us why the quote is not accepted." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_creative_quote_decide", {
    p_brief: parsed.data.brief_id, p_approve: parsed.data.decision === "approve", p_reason: parsed.data.reason ?? null, p_po: parsed.data.po ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/briefs/${parsed.data.brief_id}`);
  return { ok: true, message: parsed.data.decision === "approve" ? "Thanks. Your approval is with us, and creative work will start." : "Thanks. We will revise the quote." };
}

/** Client approver's decision on a concept. Viewers and other clients are refused in the database (client_concept_decide). */
export async function decideConcept(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: "This is a preview. Only the client's own approvers can respond here." };
  const parsed = schema.safeParse({
    concept_id: fd.get("concept_id"), brief_id: fd.get("brief_id"), decision: fd.get("decision"),
    comment: String(fd.get("comment") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: "Choose approve or request changes." };
  if (parsed.data.decision === "changes" && !parsed.data.comment) return { error: "Tell us what you would like changed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_concept_decide", {
    p_concept: parsed.data.concept_id, p_approve: parsed.data.decision === "approve", p_comment: parsed.data.comment ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/briefs/${parsed.data.brief_id}`);
  return { ok: true, message: parsed.data.decision === "approve" ? "Thanks. Your approval is with us." : "Thanks. We will rework the concept." };
}
