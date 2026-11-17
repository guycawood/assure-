"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClientFormResult } from "@/components/client/forms";

// The client's decisions on a sampling job (GBT RFP process r13, r18, r24): the sample quote with its PO, the technical drawing, the sample.
// Only the client's own approvers can decide; the database refuses viewers and other clients.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const PREVIEW_MSG = "This is a preview. Only the client's own approvers can respond here.";
const schema = z.object({ job_id: uuid, decision: z.enum(["approve", "decline"]), comment: z.string().max(4000).optional(), po: z.string().max(80).optional() });

async function decide(fd: FormData, fn: string, build: (d: z.infer<typeof schema>) => Record<string, unknown>, ok: [string, string], needReason: string): Promise<ClientFormResult> {
  const me = await requireClient();
  if (me.is_admin || me.user_type === "internal") return { error: PREVIEW_MSG };
  const parsed = schema.safeParse({
    job_id: fd.get("job_id"), decision: fd.get("decision"),
    comment: String(fd.get("comment") ?? "").trim() || undefined, po: String(fd.get("po") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: "Choose approve or decline." };
  if (parsed.data.decision === "decline" && !parsed.data.comment) return { error: needReason };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, build(parsed.data));
  if (error) return { error: error.message };
  revalidatePath("/client-portal/samples");
  return { ok: true, message: parsed.data.decision === "approve" ? ok[0] : ok[1] };
}

export async function decideSampleQuote(_: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  return decide(fd, "client_sampling_quote_decide",
  (d) => ({ p_job: d.job_id, p_approve: d.decision === "approve", p_reason: d.comment ?? null, p_po: d.po ?? null }),
  ["Thanks. We will issue the sample order.", "Thanks. The supplier will revise the quote."], "Tell us why the quote is not accepted.");
}

export async function decideSampleDrawing(_: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  return decide(fd, "client_sampling_drawing_decide",
  (d) => ({ p_job: d.job_id, p_approve: d.decision === "approve", p_comment: d.comment ?? null }),
  ["Thanks. The drawing is signed off.", "Thanks. We will update the drawing."], "Tell us what to change on the drawing.");
}

export async function decideSample(_: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  return decide(fd, "client_sampling_sample_decide",
  (d) => ({ p_job: d.job_id, p_approve: d.decision === "approve", p_comment: d.comment ?? null }),
  ["Thanks. Your approval is with us.", "Thanks. The supplier will rework the sample."], "Tell us what to rework.");
}
