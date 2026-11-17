"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

// Reorder from an approved rate card. The database checks the award is live, the quantity is in the tier, the job fits and who the vendor is.
export async function reorderFromCard(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const job = str(fd, "job");
  const { data, error } = await supabase.rpc("rate_card_reorder", {
    p_item: id(fd, "item"), p_quantity: numOrNull(fd, "quantity"), p_job: job || null, p_supplier: str(fd, "supplier") || null, p_reason: str(fd, "reason") || null,
    p_client: str(fd, "client") || null, p_market: str(fd, "market") || null, p_title: str(fd, "title") || null, p_delivery: null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  revalidatePath("/orders", "layout");
  const r = data as { job_id: string };
  redirect(`/sourcing/jobs/${r.job_id}?from=reorder`);
}
