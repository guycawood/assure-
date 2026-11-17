"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";
import { gradeRateCard } from "@/lib/rate-card-grade";

// Rate card grades: the engine works the grade out, the database stores it and enforces a second-person review.

export async function calculateCardGrade(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const card = id(fd);
  const supabase = await createClient();
  const graded = await gradeRateCard(supabase, card as string);
  if (!graded) return { error: "Rate card not found." };
  const { error } = await supabase.rpc("rate_card_grade_save", { p_card: card, p: graded.payload });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards");
  const p = graded.payload;
  return { ok: true, message: p.score == null ? "Not enough data for a grade yet. See the warnings on the card." : `Grade ${p.letter} (${Math.round(p.score)}), ${p.confidence}% confidence. A second person must review it.` };
}

export async function reviewCardGrade(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_card_grade_review", { p_card: id(fd), p_status: str(fd, "status"), p_note: str(fd, "note") || null });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards");
  return { ok: true, message: str(fd, "status") === "reviewed" ? "Grade reviewed. The card can now be chosen." : "Marked as disputed." };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function calculateAllCardGrades(_: FormResult, __?: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data } = await supabase.rpc("sourcing_rate_cards");
  const missing = ((data ?? []) as { id: string; grade: unknown }[]).filter((c) => !c.grade);
  let done = 0;
  const problems: string[] = [];
  for (const c of missing) {
    const graded = await gradeRateCard(supabase, c.id);
    if (!graded) continue;
    const { error } = await supabase.rpc("rate_card_grade_save", { p_card: c.id, p: graded.payload });
    if (error) problems.push(friendly(error) ?? "Could not save a grade."); else done++;
  }
  revalidatePath("/sourcing/rate-cards");
  if (problems.length) return { error: problems.join(" · ") };
  return { ok: true, message: `${done} card(s) graded. Each needs a second person's review.` };
}
