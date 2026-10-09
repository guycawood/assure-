"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getVendorContext } from "@/lib/vendor-data";
import { friendlyError, type ActionResult } from "@/lib/vendor";

// Vendor quote with the Sourcing Hub details. Everything still goes through rfq_submit_quote (sealed, viewer-gated in the
// database); the company is derived on the server (my_supplier_id()), never from the form. Prices are per unit only:
// totals are always calculated by the database.

const UUID = /^[0-9a-f-]{36}$/i;
const INT_FIELDS = ["lead_time_days", "units_per_carton", "sample_lead_time_days", "number_of_uses"] as const;
const DEC_FIELDS = ["carton_length_cm", "carton_width_cm", "carton_height_cm", "gross_weight_kg", "net_weight_kg", "run_on_price", "sample_cost", "recycled_content_percent"] as const;
const TEXT_FIELDS = ["hs_code", "country_of_origin", "proposed_spec", "notes"] as const;
const LABEL: Record<string, string> = {
  lead_time_days: "lead time", units_per_carton: "units per carton", sample_lead_time_days: "sample lead time", number_of_uses: "number of uses",
  carton_length_cm: "carton length", carton_width_cm: "carton width", carton_height_cm: "carton height", gross_weight_kg: "gross weight",
  net_weight_kg: "net weight", run_on_price: "run-on price", sample_cost: "sample cost", recycled_content_percent: "recycled content",
};

const s = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};
const num = (v: string | null) => (v == null ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
const fail = (message?: string): ActionResult => ({ ok: false, message: friendlyError(message) });

export async function saveQuoteDetailed(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getVendorContext();
  if (!ctx?.company || !ctx.permission) return fail("Sign in with your vendor account.");
  if (ctx.permission === "viewer") return fail("Your account is view-only. Ask your portal admin for edit access.");
  const rfq = s(fd, "rfq", 64);
  if (!rfq || !UUID.test(rfq)) return fail("Quote request not found.");
  const submit = fd.get("intent") !== "draft";

  const prices: { line_id: string; quantity: number; unit_price: number; lead_time_days: number | null }[] = [];
  const lines = new Map<string, Record<string, unknown>>();
  const alts = new Map<string, Record<string, unknown>>();
  const pointPrices: { delivery_point_id: string; unit_price: number }[] = [];

  for (const [k, raw] of fd.entries()) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const val = raw.trim();
    let m = /^price:([0-9a-f-]{36}):(\d+)$/i.exec(k);
    if (m) {
      const n = num(val);
      if (n == null || !Number.isFinite(n) || n < 0) return fail(`Check the unit price for quantity ${m[2]}: it must be a number of zero or more.`);
      const lead = s(fd, `lead:${m[1]}:${m[2]}`, 6);
      if (lead && !/^\d{1,4}$/.test(lead)) return fail("Lead times are whole days.");
      prices.push({ line_id: m[1], quantity: Number(m[2]), unit_price: n, lead_time_days: lead ? Number(lead) : null });
      continue;
    }
    m = /^d:([0-9a-f-]{36}):([a-z_]+)$/i.exec(k);
    if (m) {
      const [, line, field] = m;
      const row = lines.get(line) ?? { line_id: line };
      if ((INT_FIELDS as readonly string[]).includes(field)) {
        const n = num(val);
        if (n == null || !Number.isInteger(n) || n < 0) return fail(`Enter the ${LABEL[field]} as a whole number.`);
        row[field] = n;
      } else if ((DEC_FIELDS as readonly string[]).includes(field)) {
        const n = num(val);
        if (n == null || !Number.isFinite(n) || n < 0) return fail(`Enter the ${LABEL[field]} as a number.`);
        if (field === "recycled_content_percent" && n > 100) return fail("Recycled content can't be more than 100%.");
        row[field] = n;
      } else if ((TEXT_FIELDS as readonly string[]).includes(field)) {
        row[field] = val.slice(0, field === "proposed_spec" ? 4000 : 500);
      } else if (field === "reusable") {
        row.reusable = val === "yes" ? true : val === "no" ? false : null;
      } else continue;
      lines.set(line, row);
      continue;
    }
    m = /^alt:([0-9a-f-]{36}):(\d):(description|quantity|unit_price|lead_time_days)$/i.exec(k);
    if (m) {
      const key = `${m[1]}:${m[2]}`;
      const row = alts.get(key) ?? { line_id: m[1] };
      if (m[3] === "description") row.description = val.slice(0, 500);
      else {
        const n = num(val);
        if (n == null || !Number.isFinite(n) || n < 0) return fail("Check the alternative: quantity, price and lead time must be numbers.");
        if (m[3] !== "unit_price" && !Number.isInteger(n)) return fail("Alternative quantities and lead times are whole numbers.");
        row[m[3]] = n;
      }
      alts.set(key, row);
      continue;
    }
    m = /^dp:([0-9a-f-]{36})$/i.exec(k);
    if (m) {
      const n = num(val);
      if (n == null || !Number.isFinite(n) || n < 0) return fail("Delivery-point prices must be numbers of zero or more.");
      pointPrices.push({ delivery_point_id: m[1], unit_price: n });
    }
  }
  for (const a of alts.values()) {
    if (!a.description && a.unit_price == null) continue;
    if (!a.description) return fail("Describe each alternative you propose.");
    if (a.unit_price == null) return fail("Give a unit price for each alternative.");
  }
  const lead = s(fd, "lead_time_days", 6);
  if (lead && !/^\d{1,4}$/.test(lead)) return fail("Lead time is a whole number of days.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("rfq_submit_quote", {
    p_rfq: rfq,
    p_prices: { prices, lines: [...lines.values()], alternatives: [...alts.values()].filter((a) => a.description || a.unit_price != null), point_prices: pointPrices },
    p_lead_time_days: lead ? Number(lead) : null, p_notes: s(fd, "notes", 2000), p_submit: submit,
  });
  if (error) return fail(error.message);
  revalidatePath("/vendor", "layout");
  return { ok: true, message: submit ? "Quote submitted. You can change it until the due date." : "Draft saved." };
}
