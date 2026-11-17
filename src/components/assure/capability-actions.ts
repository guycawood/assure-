"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Capability profile writes (SRM and the vendor portal). The SQL functions decide who may do what: vendors only their
// own supplier, SRM verifies (never the person who last changed an entry), tooling is retired rather than deleted.

export type CapResult = { ok?: boolean; message?: string; error?: string };
type Kind = "capability" | "machine" | "tooling";

const LIST = new Set(["materials"]);
const BOOL = new Set(["in_house", "insured"]);

function payload(fd: FormData) {
  const p: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (["kind", "id", "supplier_id", "$ACTION_ID"].includes(k) || k.startsWith("$") || k.startsWith("custom_")) continue;
    p[k] = LIST.has(k) ? String(v).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : String(v);
  }
  for (const k of BOOL) p[k] = fd.get(k) === "on" || fd.get(k) === "true";
  // Answers to the extra questions on the form (see Vendor forms): named custom_<question id>; several ticks are joined with "; ".
  if (fd.has("custom_present")) {
    const custom: Record<string, string> = {};
    for (const k of new Set(fd.keys())) if (k.startsWith("custom_") && k !== "custom_present") custom[k.slice(7)] = fd.getAll(k).map(String).filter(Boolean).join("; ");
    p.custom = custom;
  }
  return p;
}

function refresh(supplierId?: string) {
  revalidatePath("/vendor/capabilities");
  if (supplierId) revalidatePath(`/assure/suppliers/${supplierId}`);
}

export async function saveCapabilityItem(_: CapResult, fd: FormData): Promise<CapResult> {
  const kind = String(fd.get("kind")) as Kind;
  const id = String(fd.get("id") ?? "") || null;
  const supplierId = String(fd.get("supplier_id") ?? "") || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("srm_capability_save", { p_kind: kind, p_id: id, p_supplier: supplierId, p: payload(fd) });
  if (error) return { error: error.message };
  refresh(supplierId ?? undefined);
  return { ok: true, message: id ? "Saved. It shows as declared until SRM verifies it." : "Added. It shows as declared until SRM verifies it." };
}

export async function verifyCapabilityItem(_: CapResult, fd: FormData): Promise<CapResult> {
  const ok = String(fd.get("decision")) !== "reject";
  const supabase = await createClient();
  const { error } = await supabase.rpc("srm_capability_verify", { p_kind: String(fd.get("kind")), p_id: String(fd.get("id")), p_ok: ok, p_note: String(fd.get("note") ?? "") });
  if (error) return { error: error.message };
  refresh(String(fd.get("supplier_id") ?? "") || undefined);
  return { ok: true, message: ok ? "Verified." : "Rejected." };
}

export async function removeCapabilityItem(_: CapResult, fd: FormData): Promise<CapResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("srm_capability_remove", { p_kind: String(fd.get("kind")), p_id: String(fd.get("id")) });
  if (error) return { error: error.message };
  refresh(String(fd.get("supplier_id") ?? "") || undefined);
  return { ok: true, message: "Removed." };
}
