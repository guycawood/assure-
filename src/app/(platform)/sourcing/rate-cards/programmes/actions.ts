"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";
import { BID_ALIASES, csvObjects, ITEM_ALIASES } from "@/lib/csv";

// Rate card programmes. The database checks who may build, the status and every imported row.
const PARAMS = ["name", "year", "market", "currency", "fee_percent", "cap_percent", "winner_band_percent", "min_coverage_percent", "saving_high_percent", "price_decimals", "notes"] as const;
const params = (fd: FormData) => Object.fromEntries(PARAMS.map((k) => [k, str(fd, k)]));
const CHUNK = 400;

export async function createProgramme(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_card_programme_create", { p: params(fd) });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  redirect(`/sourcing/rate-cards/programmes/${data as string}?tab=import`);
}

export async function updateProgramme(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_card_programme_update", { p_id: id(fd), p: params(fd) });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message: "Settings saved. The analysis uses them straight away." };
}

export async function setProgrammeStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_card_programme_set_status", { p_id: id(fd), p_status: str(fd, "status") });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message: "Status updated." };
}

async function textOf(fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) return await file.text();
  return str(fd, "pasted") ?? "";
}

type Problem = { row: number; subcode?: string; problem: string };
function summary(kind: string, parts: { added: number; updated: number; skipped: number; problems: Problem[]; not_in_srm?: string[] }): string {
  const bits = [`${parts.added} ${kind} added`, `${parts.updated} updated`];
  if (parts.skipped) bits.push(`${parts.skipped} skipped: ${parts.problems.slice(0, 4).map((p) => `row ${p.row}${p.subcode ? ` (${p.subcode})` : ""} ${p.problem}`).join("; ")}${parts.problems.length > 4 ? "; and more" : ""}`);
  if (parts.not_in_srm?.length) bits.push(`not in SRM yet: ${parts.not_in_srm.slice(0, 6).join(", ")}${parts.not_in_srm.length > 6 ? " and more" : ""}`);
  return bits.join(". ") + ".";
}

async function importRows(fd: FormData, fn: string, aliases: Record<string, string>, kind: string): Promise<FormResult> {
  await requireInternal();
  const text = await textOf(fd);
  const rows = csvObjects(text, aliases);
  if (!rows.length) return { error: "Nothing to import. Upload a CSV with a header row, or paste its text." };
  const supabase = await createClient();
  const prog = id(fd, "programme");
  const total = { added: 0, updated: 0, skipped: 0, problems: [] as Problem[], not_in_srm: [] as string[] };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase.rpc(fn, { p_prog: prog, p_rows: slice });
    if (error) return { error: friendly(error) };
    const r = data as typeof total;
    total.added += r.added; total.updated += r.updated; total.skipped += r.skipped;
    total.problems.push(...r.problems.map((p) => ({ ...p, row: p.row + i })));
    for (const s of r.not_in_srm ?? []) if (!total.not_in_srm.includes(s)) total.not_in_srm.push(s);
  }
  revalidatePath("/sourcing/rate-cards", "layout");
  const message = summary(kind, total);
  return total.added + total.updated === 0 ? { error: message } : { ok: true, message };
}

export async function importItems(_: FormResult, fd: FormData): Promise<FormResult> { return importRows(fd, "rate_card_items_import", ITEM_ALIASES, "items"); }
export async function importBids(_: FormResult, fd: FormData): Promise<FormResult> { return importRows(fd, "rate_card_bids_import", BID_ALIASES, "bids"); }

export async function setDeadline(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const raw = str(fd, "deadline");
  const when = raw ? new Date(raw) : null;
  if (raw && (!when || Number.isNaN(when.getTime()))) return { error: "Choose a valid date and time." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_card_programme_set_deadline", { p_prog: id(fd), p_deadline: when ? when.toISOString() : null });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message: "Deadline saved." };
}

export async function inviteVendors(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const suppliers = fd.getAll("supplier").map(String).filter(Boolean);
  if (!suppliers.length) return { error: "Choose at least one vendor." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_card_programme_invite", { p_prog: id(fd), p_suppliers: suppliers });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  const n = Number(data);
  return { ok: true, message: n ? `${n} vendor${n === 1 ? "" : "s"} invited and notified.` : "Those vendors were already invited." };
}

export async function selectBid(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const bid = str(fd, "bid");
  const { error } = await supabase.rpc("rate_card_item_select_bid", { p_item: id(fd, "item"), p_bid: bid || null, p_reason: str(fd, "reason") || null });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/rate-cards", "layout");
  return { ok: true, message: bid ? "Bid chosen." : "Back to the lowest bid." };
}
