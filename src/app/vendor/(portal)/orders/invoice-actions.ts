"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireVendorCompany } from "@/lib/vendor-data";
import { deleteFile, uploadFile } from "@/app/files-actions";
import type { ActionResult } from "@/lib/vendor";

/**
 * Vendor sends an invoice against an accepted PO: the PDF is uploaded first, then Finance+ records the invoice
 * (finance_vendor_submit_invoice checks PO, currency, duplicates and dates). If Finance+ refuses it, the upload is removed.
 */
export async function submitInvoice(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireVendorCompany();
  const po = String(fd.get("po_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(po)) return { ok: false, message: "Purchase order not found." };
  const net = Number(fd.get("net"));
  const vat = Number(fd.get("vat") || 0);
  if (!Number.isFinite(net) || net <= 0) return { ok: false, message: "Enter the net amount (above zero)." };
  if (!Number.isFinite(vat) || vat < 0) return { ok: false, message: "VAT can't be negative." };

  const up = new FormData();
  up.set("file", fd.get("file") as Blob);
  up.set("module", "finance");
  up.set("entity_type", "purchase_order");
  up.set("entity_id", po);
  up.set("supplier_id", ctx.company.id);
  up.set("label", "Invoice");
  const file = await uploadFile(up);
  if (!file.ok || !file.id) return { ok: false, message: file.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_vendor_submit_invoice", {
    p_po: po, p_number: String(fd.get("number") ?? ""), p_date: String(fd.get("date") ?? "") || null,
    p_net: net, p_vat: vat, p_currency: String(fd.get("currency") ?? ""), p_file_id: file.id,
  });
  if (error) {
    await deleteFile(file.id);
    return { ok: false, message: error.message };
  }
  revalidatePath("/vendor", "layout");
  return { ok: true, message: "Invoice sent. adm Indicia will match it to the order and delivery.", id: data as string };
}
