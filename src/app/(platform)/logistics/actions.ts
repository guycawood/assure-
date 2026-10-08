"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

async function call(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/logistics", "layout");
  revalidatePath("/execution", "layout");
  return { ok: true, message };
}

const DELIVERY_FIELDS = ["uom", "recipient_name", "recipient_contact", "recipient_phone", "recipient_email", "address_line", "city", "postcode", "market",
  "destination_lat", "destination_lon", "origin_name", "origin_market", "origin_lat", "origin_lon", "delivery_method", "incoterm",
  "planned_dispatch_date", "planned_delivery_date", "gross_weight_kg", "distance_km", "special_instructions", "quantity"];
const NUMERIC = new Set(["destination_lat", "destination_lon", "origin_lat", "origin_lon", "gross_weight_kg", "distance_km", "quantity"]);

function deliveryData(fd: FormData): { data: Record<string, string | null>; error?: string } {
  const data: Record<string, string | null> = {};
  for (const k of DELIVERY_FIELDS) {
    const v = str(fd, k);
    if (v != null && NUMERIC.has(k) && !Number.isFinite(Number(v))) return { data, error: `Enter a number for ${k.replace(/_/g, " ")}.` };
    data[k] = v;
  }
  return { data };
}

export async function planFromPo(_: FormResult, fd: FormData) {
  return call("logistics_plan_from_po", { p_po: id(fd) }, "Deliveries planned. Add the destination details on each one.");
}

export async function createDelivery(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const qty = numOrNull(fd, "quantity");
  if (!qty || Number.isNaN(qty) || qty <= 0) return { error: "Enter the quantity for this destination." };
  const { data, error: e } = deliveryData(fd);
  if (e) return { error: e };
  const supabase = await createClient();
  const { data: newId, error } = await supabase.rpc("logistics_create_delivery", {
    p_po: id(fd, "po_id"), p_spec: id(fd, "spec_id"), p_spec_version: id(fd, "spec_version_id"), p_quantity: qty, p_data: data,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/logistics", "layout");
  redirect(`/logistics/deliveries/${newId}`);
}

export async function updateDelivery(_: FormResult, fd: FormData) {
  const { data, error } = deliveryData(fd);
  if (error) return { error };
  return call("logistics_update_delivery", { p_delivery: id(fd), p_data: data }, "Delivery plan saved");
}

export async function setDeliveryStatus(_: FormResult, fd: FormData) {
  return call("logistics_set_status", { p_delivery: id(fd), p_status: str(fd, "status"), p_note: str(fd, "note") }, "Status updated");
}

export async function markDelivered(_: FormResult, fd: FormData) {
  return call("logistics_mark_delivered", { p_delivery: id(fd), p_delivered_on: str(fd, "delivered_on"), p_note: str(fd, "note") }, "Marked delivered; transport CO2e recorded");
}

export async function recomputeEmissions(_: FormResult, fd: FormData) {
  return call("logistics_recompute_emissions", { p_delivery: id(fd), p_reason: str(fd, "reason") }, "New CO2e snapshot recorded");
}

export async function linkOutlet(_: FormResult, fd: FormData) {
  return call("execution_delivery_set_outlet", { p_delivery: id(fd), p_outlet: id(fd, "outlet_id") }, "Destination set from the outlet");
}

export async function recordShipment(_: FormResult, fd: FormData) {
  const qty = numOrNull(fd, "quantity");
  if (!qty || Number.isNaN(qty)) return { error: "Enter the quantity shipped." };
  const w = numOrNull(fd, "gross_weight_kg");
  if (Number.isNaN(w)) return { error: "Enter the gross weight as a number." };
  return call("logistics_record_shipment", {
    p_delivery: id(fd), p_carrier_code: str(fd, "carrier_code"), p_service_level: str(fd, "service_level"), p_tracking: str(fd, "tracking"),
    p_dispatch_date: str(fd, "dispatch_date"), p_quantity: qty, p_gross_weight_kg: w, p_notes: str(fd, "notes"),
  }, "Shipment recorded");
}

export async function attachPod(_: FormResult, fd: FormData) {
  if (!id(fd, "file_id")) return { error: "Upload the POD file first, then choose it." };
  return call("logistics_attach_pod", { p_shipment: id(fd), p_file: id(fd, "file_id"), p_delivered_on: str(fd, "delivered_on") }, "POD attached; someone else must verify it");
}

function checks(fd: FormData) {
  const out: Record<string, boolean> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("check:")) out[k.slice(6)] = v === "on";
  return out;
}

export async function verifyPod(_: FormResult, fd: FormData) {
  return call("logistics_pod_verify", { p_shipment: id(fd), p_checks: checks(fd), p_note: str(fd, "note") }, "POD verified");
}

export async function rejectPod(_: FormResult, fd: FormData) {
  return call("logistics_pod_reject", { p_shipment: id(fd), p_checks: checks(fd), p_reason: str(fd, "reason") }, "POD rejected; the vendor has been told why");
}

export async function saveLeg(_: FormResult, fd: FormData) {
  const data: Record<string, string | null> = {};
  for (const k of ["from_location", "to_location", "mode", "carrier_code", "planned_departure", "actual_departure", "planned_arrival", "actual_arrival", "notes"]) data[k] = str(fd, k);
  if (!data.from_location || !data.to_location) return { error: "Enter where the leg starts and ends." };
  return call("logistics_leg_save", { p_shipment: id(fd, "shipment_id"), p_leg: id(fd, "leg_id"), p_data: data }, "Leg saved");
}
