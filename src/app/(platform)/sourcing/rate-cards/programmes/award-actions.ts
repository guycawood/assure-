"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

// Awarding and approving a rate card programme. The database checks who may, the status, the shares and every gate.
async function run(fn: string, args: Record<string, unknown>, message: string | ((data: unknown) => string)): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message: typeof message === "function" ? message(data) : message };
}

export async function awardLowest(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_programme_award_lowest", { p_prog: id(fd) }, (n) => Number(n) ? `${n} item(s) awarded to their chosen or lowest bid.` : "Every priced item already has an award.");
}

// Shares come from fields named share:<bid id>. A blank or zero share means that vendor is not awarded.
export async function setAwards(_: FormResult, fd: FormData): Promise<FormResult> {
  const awards: { bid_id: string; share: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("share:")) continue;
    const s = String(v).trim();
    if (s && Number(s) !== 0) awards.push({ bid_id: k.slice(6), share: s });
  }
  return run("rate_card_item_set_awards", { p_item: id(fd, "item"), p_awards: awards }, awards.length ? "Award saved." : "Award cleared.");
}

export async function setValidity(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_programme_set_validity", { p_prog: id(fd), p_from: str(fd, "valid_from") || null, p_to: str(fd, "valid_to") || null }, "Validity saved.");
}

export async function approveProgramme(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_programme_approve", { p_prog: id(fd), p_note: str(fd, "note") || null }, (r) => {
    const x = r as { awarded: number; vendors: number };
    return `Approved and locked: ${x.awarded} award(s) to ${x.vendors} vendor(s). Each vendor has been told.`;
  });
}

export async function answerVendor(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_acceptance_respond", { p_prog: id(fd), p_supplier: id(fd, "supplier"), p_response: str(fd, "response") ?? "" }, "Answer sent. The vendor can now accept.");
}

export async function reopenProgramme(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_programme_reopen", { p_prog: id(fd), p_note: str(fd, "note") ?? "" }, "Reopened and back in review. A different sourcing lead approves it again, and every vendor accepts again.");
}

export async function sendBack(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("rate_card_programme_send_back", { p_prog: id(fd), p_note: str(fd, "note") ?? "" }, "Sent back. The person who submitted it has been told.");
}
