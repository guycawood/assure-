"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireVendorCompany } from "@/lib/vendor-data";
import type { ActionResult } from "@/lib/vendor";

// Vendor side of a rate card programme: price the items and tiers, send them, or decline. The database checks the invitation,
// the deadline, standard access and every price.
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function submitRateCardPrices(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireVendorCompany();
  const prog = String(fd.get("programme") ?? "");
  if (!uuid(prog)) return { ok: false, message: "Programme not found." };
  const prices: { item_id: string; price: string }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith("price:")) prices.push({ item_id: k.slice(6), price: String(v).trim() });
  const final = fd.get("intent") === "primary";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_rate_card_submit", { p_prog: prog, p_prices: prices, p_final: final });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/rate-cards", "layout");
  const r = data as { priced: number };
  return { ok: true, message: final ? `Thanks. We have your prices for ${r.priced} item${r.priced === 1 ? "" : "s"}. You can change them until the deadline.` : `Draft saved: ${r.priced} item${r.priced === 1 ? "" : "s"} priced. Nothing is sent until you press Send prices.` };
}

// Accept the award, or return it with a question. The database checks the award, edit access and the note.
export async function respondToAward(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireVendorCompany();
  const prog = String(fd.get("programme") ?? "");
  if (!uuid(prog)) return { ok: false, message: "Programme not found." };
  const accept = fd.get("intent") === "primary";   // the main button accepts; the secondary button returns it with a question
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_rate_card_accept", { p_prog: prog, p_accept: accept, p_note: String(fd.get("note") ?? "").trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/rate-cards", "layout");
  return { ok: true, message: accept ? "Thanks. Your award is accepted and your prices are agreed." : "Your question has gone to us. We will answer and you can then accept." };
}

export async function declineRateCard(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireVendorCompany();
  const prog = String(fd.get("programme") ?? "");
  if (!uuid(prog)) return { ok: false, message: "Programme not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_rate_card_decline", { p_prog: prog, p_reason: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/vendor/rate-cards", "layout");
  return { ok: true, message: "Thanks. We have logged your reason." };
}
