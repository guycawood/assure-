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

/** Client approver's decision on an estimate. Recorded and sent to adm Indicia, who confirm it in Order Management+. */
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
  return { ok: true, message: parsed.data.decision === "approve" ? "Thanks. Your approval is with adm Indicia." : "Thanks. adm Indicia will follow up." };
}

const commentSchema = z.object({ brief_id: uuid, body: z.string().trim().min(1, "Write a comment first.").max(4000) });

export async function commentOnBrief(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = commentSchema.safeParse({ brief_id: fd.get("brief_id"), body: fd.get("body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a comment first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_brief_comment", { p_brief: parsed.data.brief_id, p_body: parsed.data.body });
  if (error) return { error: error.message };
  revalidatePath(`/client-portal/briefs/${parsed.data.brief_id}`);
  return { ok: true, message: "Comment sent to adm Indicia." };
}
