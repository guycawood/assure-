"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

/** Record a warehouse, vendor or market stock count against one order line. */
export async function recordStockCount(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const po = id(fd, "po_id"), spec = id(fd, "spec_id"), qty = numOrNull(fd, "quantity");
  if (!po || !spec) return { error: "Choose the order line the stock belongs to." };
  if (qty == null || !Number.isInteger(qty) || qty < 0) return { error: "Enter the quantity counted as a whole number (0 if there is none left)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ordering_record_stock_count", {
    p_po: po, p_spec: spec, p_quantity: qty, p_counted_on: str(fd, "counted_on"), p_location: str(fd, "location"),
    p_source: str(fd, "source") ?? "warehouse", p_notes: str(fd, "notes"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/sustainability", "layout");
  return { ok: true, message: "Stock count recorded." };
}
