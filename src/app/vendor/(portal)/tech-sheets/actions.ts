"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getVendorContext } from "@/lib/vendor-data";
import { uploadFile } from "@/app/files-actions";
import { friendlyError, type ActionResult } from "@/lib/vendor";
import { parseMeasured, parseSheetForm } from "@/lib/tech-sheet";

// Vendor technical & packaging data sheet. The company comes from the session (my_supplier_id() in Postgres), never from
// the form; tech_sheet_vendor_save / _copy check the PO is the vendor's own and block view-only users.

const UUID = /^[0-9a-f-]{36}$/i;
const s = (fd: FormData, k: string, max = 200) => { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null; };
const fail = (m?: string): ActionResult => ({ ok: false, message: friendlyError(m) });

async function vendorGuard(): Promise<ActionResult | null> {
  const ctx = await getVendorContext();
  if (!ctx?.company || !ctx.permission) return fail("Sign in with your vendor account.");
  if (ctx.permission === "viewer") return fail("Your account is view-only. Ask your portal admin for edit access.");
  return null;
}

function lineIds(fd: FormData) {
  const po = s(fd, "po", 64), spec = s(fd, "spec", 64), version = s(fd, "version", 64);
  if (!po || !UUID.test(po) || !spec || !UUID.test(spec) || (version && !UUID.test(version))) return null;
  return { po, spec, version };
}

export async function saveTechSheet(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await vendorGuard();
  if (g) return g;
  const ids = lineIds(fd);
  if (!ids) return fail("Order line not found.");
  const parsed = parseSheetForm(fd);
  if (parsed.error) return fail(parsed.error);
  const declare = fd.get("intent") !== "draft";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tech_sheet_vendor_save", {
    p_po: ids.po, p_spec: ids.spec, p_spec_version: ids.version, p_data: parsed.data, p_declare: declare,
  });
  if (error) return fail(error.message);
  revalidatePath("/vendor", "layout");
  const pre = (data as { pre_shipment?: { complete: boolean; missing: string[] } } | null)?.pre_shipment;
  if (!declare) return { ok: true, message: "Draft saved." };
  return { ok: true, message: pre?.complete ? "Declared. Everything adm Indicia needs is there; the packed carton is checked at pre-shipment."
    : `Declared. Still needed before the pre-shipment check: ${pre?.missing.join("; ")}.` };
}

export async function copyTechSheet(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await vendorGuard();
  if (g) return g;
  const ids = lineIds(fd);
  const source = s(fd, "source", 64);
  if (!ids || !source || !UUID.test(source)) return fail("Choose one of your earlier data sheets.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tech_sheet_vendor_copy", { p_po: ids.po, p_spec: ids.spec, p_spec_version: ids.version, p_source: source });
  if (error) return fail(error.message);
  revalidatePath("/vendor", "layout");
  return { ok: true, message: `Copied from ${(data as { copied_from?: string } | null)?.copied_from ?? "your earlier sheet"}. Check every value against this order, then declare it.` };
}

/** QA/QC submission with the measured packed carton (used when the pre-shipment checkpoint needs data-sheet evidence). */
export async function submitQaqcMeasured(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await vendorGuard();
  if (g) return g;
  const checkpoint = s(fd, "checkpoint", 64);
  if (!checkpoint || !UUID.test(checkpoint)) return fail("Checkpoint not found.");
  const m = parseMeasured(fd);
  if (!m) return fail("Enter what you measured on a packed carton: gross weight (kg) and length, width and height (mm).");
  if (m.error) return fail(m.error);
  const dt = (k: string) => { const v = s(fd, k, 10); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const int = (k: string) => { const v = s(fd, k, 9); return v && /^\d+$/.test(v) ? Number(v) : null; };
  const groups = Number(s(fd, "groups", 3) ?? 0);
  const evidence: Record<string, unknown>[] = [];
  for (let gi = 0; gi < Math.min(groups, 12); gi++) {
    const type = s(fd, `type_${gi}`, 40);
    const files = fd.getAll(`files_${gi}`).filter((f): f is File => f instanceof File && f.size > 0);
    if (!type || files.length === 0) continue;
    if (files.length > 20) return fail("Up to 20 files per item.");
    for (const file of files) {
      const up = new FormData();
      up.set("file", file); up.set("module", "orders"); up.set("entity_type", "qaqc_checkpoint"); up.set("entity_id", checkpoint); up.set("label", type);
      const r = await uploadFile(up);
      if (!r.ok || !r.id) return fail(r.message);
      evidence.push({
        type, file_id: r.id, issued_on: dt(`issued_on_${gi}`), expires_on: dt(`expires_on_${gi}`), inspection_date: dt(`inspection_date_${gi}`),
        body_code: s(fd, `body_${gi}`, 40), certificate_number: s(fd, `cert_${gi}`, 100), sample_size: int(`sample_${gi}`),
        defects_critical: int(`critical_${gi}`), defects_major: int(`major_${gi}`), defects_minor: int(`minor_${gi}`),
        result: s(fd, `result_${gi}`, 10) === "fail" ? "fail" : s(fd, `result_${gi}`, 10) === "pass" ? "pass" : null,
      });
    }
  }
  if (evidence.length === 0) return fail("Attach the evidence first.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qaqc_vendor_submit", {
    p_checkpoint: checkpoint, p_evidence: evidence,
    p_data: { result: s(fd, "result", 10) === "fail" ? "fail" : "pass", notes: s(fd, "notes", 2000), measured: m.measured },
  });
  if (error) return fail(error.message);
  revalidatePath("/vendor", "layout");
  const r = data as { status?: string; tech_sheet?: { ok: boolean } } | null;
  if (r?.tech_sheet && !r.tech_sheet.ok) return { ok: true, message: "Uploaded. The packed carton does not match your data sheet, so adm Indicia's quality team will review it." };
  return { ok: true, message: r?.status === "auto_verified" ? "Checked and verified, and your data sheet is confirmed. Thank you." : "Uploaded. Some checks need a look by adm Indicia's quality team; see the results below." };
}
