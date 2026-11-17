"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

/** Ask the sourcing team for a rate card that does not exist yet. */
export async function createRateCardRequest(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_card_request_create", { p: {
    title: str(fd, "title"), spec_type: str(fd, "spec_type"), substrate_code: str(fd, "substrate"), length_mm: str(fd, "length"), width_mm: str(fd, "width"),
    min_qty: str(fd, "min_qty"), max_qty: str(fd, "max_qty"), client_id: str(fd, "client"), market: str(fd, "market"), reason: str(fd, "reason"), brief_id: str(fd, "brief"),
  } });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  redirect("/sourcing/rate-cards/requests?requested=1");
}

// New brief, "Existing rate card": the database checks the card, the size band, the client and who may route the line.
export async function createBriefFromRateCard(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("brief_from_rate_card", {
    p_card: id(fd, "card"), p_client: id(fd, "client"), p_market: str(fd, "market"), p_title: str(fd, "title"),
    p_quantity: numOrNull(fd, "quantity"), p_length: numOrNull(fd, "length"), p_width: numOrNull(fd, "width"),
    p_target: str(fd, "target") || null, p_note: str(fd, "note") || null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/briefing", "layout");
  revalidatePath("/sourcing", "layout");
  const r = data as { spec_id: string; outcome: string };
  redirect(`/sourcing/specs/${r.spec_id}?from=rate-card&outcome=${r.outcome}`);
}
