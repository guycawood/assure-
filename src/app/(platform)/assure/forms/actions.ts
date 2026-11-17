"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseQuestions, type Question } from "@/lib/assure";
import type { FormResult } from "@/components/assure/action-form";

// Onboarding form governance. The database decides who may edit and enforces the joint sign-off.
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 14) || "q";

type Version = { status: string; questions: Question[] };
const FORMS = ["onboarding", "capability", "machine", "tooling"];
const formOf = (fd: FormData) => { const f = s(fd, "form"); return FORMS.includes(f) ? f : "onboarding"; };

export async function saveFormDraft(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const parsed = parseQuestions(s(fd, "questions"));
  if (parsed.error) return { error: parsed.error };
  const supabase = await createClient();
  const { data: versions } = await supabase.rpc("form_versions_list", { p_form: formOf(fd) });
  // Keep the id of a question whose text is unchanged, so answers given earlier still belong to it. New questions get a fresh id.
  const known = new Map<string, string>();
  for (const v of (versions as Version[] | null) ?? []) for (const q of v.questions) known.set(q.text.trim().toLowerCase(), q.id);
  const used = new Set<string>();
  const questions = parsed.questions.map((q) => {
    let id = known.get(q.text.trim().toLowerCase()) ?? "";
    if (!id || used.has(id)) { do { id = `${slug(q.text)}_${Math.random().toString(36).slice(2, 6)}`; } while (used.has(id)); }
    used.add(id);
    return { id, text: q.text, type: q.type, ...(q.options ? { options: q.options } : {}), required: q.required !== false };
  });
  const { error } = await supabase.rpc("form_draft_save", { p_form: formOf(fd), p_questions: questions, p_note: s(fd, "note") || null });
  if (error) return { error: error.message };
  revalidatePath("/assure/forms");
  return { ok: true, message: "Draft saved. It is not live until it has been signed off." };
}

export async function proposeForm(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("form_propose", { p_id: s(fd, "id") });
  if (error) return { error: error.message };
  revalidatePath("/assure", "layout");
  return { ok: true, message: "Sent. A procurement director and the Sustainability team have been asked to sign." };
}

export async function discardFormDraft(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("form_draft_discard", { p_form: formOf(fd) });
  if (error) return { error: error.message };
  revalidatePath("/assure/forms");
  return { ok: true, message: "Draft discarded." };
}
