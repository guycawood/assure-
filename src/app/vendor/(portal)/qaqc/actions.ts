"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getVendorContext } from "@/lib/vendor-data";
import { uploadFile } from "@/app/files-actions";
import { friendlyError, type ActionResult } from "@/lib/vendor";

// Vendor QA/QC submission: files are stored with the files service against the checkpoint, then qaqc_vendor_submit
// records the evidence and runs the verification at upload (own PO only, never a view-only user; checked in Postgres).

const UUID = /^[0-9a-f-]{36}$/i;
const s = (fd: FormData, k: string, max = 200) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};
const dt = (fd: FormData, k: string) => { const v = s(fd, k, 10); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
const int = (fd: FormData, k: string) => { const v = s(fd, k, 9); return v && /^\d+$/.test(v) ? Number(v) : null; };

export async function submitQaqc(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getVendorContext();
  if (!ctx?.company || !ctx.permission) return { ok: false, message: "Sign in with your vendor account." };
  if (ctx.permission === "viewer") return { ok: false, message: "Your account is view-only. Ask your portal admin for edit access." };
  const checkpoint = s(fd, "checkpoint", 64);
  if (!checkpoint || !UUID.test(checkpoint)) return { ok: false, message: "Checkpoint not found." };
  const groups = Number(s(fd, "groups", 3) ?? 0);
  const result = s(fd, "result", 10) === "fail" ? "fail" : "pass";
  const evidence: Record<string, unknown>[] = [];
  for (let g = 0; g < Math.min(groups, 10); g++) {
    const type = s(fd, `type_${g}`, 40);
    const files = fd.getAll(`files_${g}`).filter((f): f is File => f instanceof File && f.size > 0);
    if (!type || files.length === 0) continue;
    if (files.length > 20) return { ok: false, message: "Up to 20 files per item." };
    for (const file of files) {
      const up = new FormData();
      up.set("file", file); up.set("module", "orders"); up.set("entity_type", "qaqc_checkpoint"); up.set("entity_id", checkpoint); up.set("label", type);
      const r = await uploadFile(up);
      if (!r.ok || !r.id) return { ok: false, message: friendlyError(r.message) };
      evidence.push({
        type, file_id: r.id, issued_on: dt(fd, `issued_on_${g}`), expires_on: dt(fd, `expires_on_${g}`), inspection_date: dt(fd, `inspection_date_${g}`),
        body_code: s(fd, `body_${g}`, 40), certificate_number: s(fd, `cert_${g}`, 100), sample_size: int(fd, `sample_${g}`),
        defects_critical: int(fd, `critical_${g}`), defects_major: int(fd, `major_${g}`), defects_minor: int(fd, `minor_${g}`),
        result: s(fd, `result_${g}`, 10) === "fail" ? "fail" : s(fd, `result_${g}`, 10) === "pass" ? "pass" : null,
      });
    }
  }
  if (evidence.length === 0) return { ok: false, message: "Attach the evidence first." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qaqc_vendor_submit", { p_checkpoint: checkpoint, p_evidence: evidence, p_data: { result, notes: s(fd, "notes", 2000) } });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath("/vendor", "layout");
  const st = (data as { status?: string } | null)?.status;
  return { ok: true, message: st === "auto_verified" ? "Checked and verified. Thank you." : "Uploaded. Some checks need a look by adm Indicia's quality team; see the results below." };
}
