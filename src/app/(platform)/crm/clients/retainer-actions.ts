"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

/** Whether the client is on a creative retainer. A retainer client starts creative work with a kick-off and no quote. Audited in CRM. */
export async function setClientRetainer(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_client_set_retainer", {
    p_client: id(fd), p_on: fd.get("on_retainer") === "yes", p_note: str(fd, "note"), p_reason: str(fd, "reason"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${id(fd)}`);
  return { ok: true, message: "Saved. New creative briefs for this client follow it." };
}
