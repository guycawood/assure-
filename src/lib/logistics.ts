// Logistics+ pure logic and labels (no I/O). Ported from the Base44 podConfig.js and shipmentMilestones.js.
import type { Tone } from "@/lib/srt";
import { transportKgCo2e } from "@/lib/sourcing-emissions";

export type Meta = Record<string, { label: string; tone: Tone }>;

export const DELIVERY_STATUS: Meta = {
  planned: { label: "Planned", tone: "neutral" },
  booked: { label: "Booked", tone: "info" },
  dispatched: { label: "Dispatched", tone: "accent" },
  in_transit: { label: "In transit", tone: "warn" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const POD_STATUS: Meta = {
  not_received: { label: "No POD yet", tone: "neutral" },
  received: { label: "POD to verify", tone: "info" },
  verified: { label: "POD verified", tone: "ok" },
  rejected: { label: "POD rejected", tone: "bad" },
};

export const DELIVERY_METHODS = ["road", "air", "sea", "rail", "courier", "postal", "collection"] as const;
export const LEG_MODES = ["road", "air", "sea", "rail", "courier", "postal"] as const;
export const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"] as const;
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—");

/** Legal manual moves (delivered goes through "Mark delivered"; mirrors logistics_set_status). */
export const NEXT_STATUS: Record<string, string[]> = {
  planned: ["booked", "cancelled"],
  booked: ["planned", "dispatched", "cancelled"],
  dispatched: ["in_transit", "failed"],
  in_transit: ["failed"],
  failed: ["planned", "cancelled"],
};

export interface Delivery {
  id: string; delivery_number: string; po_id: string; job_id: string; supplier_id: string; spec_id: string; spec_version_id: string | null;
  quantity: number; uom: string; recipient_name: string | null; recipient_contact: string | null; recipient_phone: string | null; recipient_email: string | null;
  address_line: string | null; city: string | null; postcode: string | null; region: string; market: string;
  destination_lat: number | null; destination_lon: number | null; origin_name: string | null; origin_market: string | null; origin_lat: number | null; origin_lon: number | null;
  delivery_method: string; incoterm: string | null; planned_dispatch_date: string | null; planned_delivery_date: string | null; actual_delivery_date: string | null;
  status: string; gross_weight_kg: number | null; distance_km: number | null; special_instructions: string | null; created_at: string;
  outlet_id: string | null; outlet_name: string | null; outlet_code: string | null;
  po_number: string; po_status: string; job_number: string; job_title: string; client_name: string; supplier_name: string; supplier_code: string | null;
  spec_title: string; spec_no: number; spec_version_name: string | null; market_name: string | null; origin_market_name: string | null;
  quantity_shipped: number; quantity_remaining: number; shipment_count: number; pods_to_verify: number; pods_verified: number;
  kgco2e: number | null; planned_kgco2e: number | null; co2e_complete: boolean | null; on_time: boolean | null; in_full: boolean | null;
}

export interface PodCheck { code: string; name: string; version?: number; mandatory: boolean; passed: boolean }

export interface Shipment {
  id: string; shipment_number: string; delivery_id: string; supplier_id: string; carrier_code: string | null; carrier_name: string | null; carrier_tracking_url: string | null;
  service_level: string | null; tracking_reference: string | null; dispatch_date: string; actual_delivery_date: string | null; quantity_shipped: number;
  gross_weight_kg: number | null; pod_file_id: string | null; pod_status: string; pod_uploaded_by: string | null; pod_received_at: string | null;
  pod_checklist: PodCheck[]; pod_verified_by: string | null; pod_verified_at: string | null; pod_rejection_reason: string | null; recorded_by_vendor: boolean;
  notes: string | null; delivery_number: string; po_id: string; job_id: string; delivery_quantity: number; delivery_status: string; planned_delivery_date: string | null;
  region: string; market: string; po_number: string; job_number: string; supplier_name: string; pod_uploaded_by_name: string | null; pod_verified_by_name: string | null;
  created_at: string;
}

export interface Leg {
  id: string; shipment_id: string; sequence: number; from_location: string; to_location: string; mode: string; carrier_code: string | null;
  planned_departure: string | null; actual_departure: string | null; planned_arrival: string | null; actual_arrival: string | null; status: string; notes: string | null;
}

export interface EmissionSnapshot {
  id: string; delivery_id: string; mode: string; delivery_date: string; planned_weight_kg: number | null; actual_weight_kg: number | null; distance_km: number | null;
  factor_code: string | null; factor_version: number | null; factor_g_per_tkm: number | null; distance_correction: number | null;
  planned_kgco2e: number | null; kgco2e: number | null; complete: boolean; missing: string[]; basis: string; reason: string | null; computed_at: string;
  region: string; market: string; delivery_number?: string; supplier_id?: string; supplier_name?: string; job_number?: string; job_id?: string;
}

export interface SupplierOtif {
  supplier_id: string; supplier_name: string; supplier_code: string | null; deliveries: number; on_time: number; in_full: number; otif: number;
  otif_percent: number | null; on_time_percent: number | null; in_full_percent: number | null;
}

/* ---------- Journey milestones (shipmentMilestones.js) ---------- */
export const STAGE_KEYS = ["planned", "booked", "dispatched", "in_transit", "delivered", "pod_received", "pod_verified"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_LABELS: Record<StageKey, string> = {
  planned: "Planned", booked: "Booked", dispatched: "Dispatched", in_transit: "In transit", delivered: "Delivered", pod_received: "POD received", pod_verified: "POD verified",
};

export function shipmentMilestones(s: Pick<Shipment, "dispatch_date" | "actual_delivery_date" | "pod_status">, deliveryStatus?: string | null): Record<StageKey, boolean> {
  const dispatched = !!s.dispatch_date;
  const delivered = !!s.actual_delivery_date || deliveryStatus === "delivered";
  const pod = s.pod_status || "not_received";
  return {
    planned: true,
    booked: ["booked", "dispatched", "in_transit", "delivered"].includes(deliveryStatus ?? "") || dispatched,
    dispatched,
    in_transit: dispatched,
    delivered,
    pod_received: pod === "received" || pod === "verified",
    pod_verified: pod === "verified",
  };
}

/** The first milestone not yet reached: where this shipment currently sits. */
export function currentMilestone(state: Record<StageKey, boolean>): StageKey {
  return STAGE_KEYS.find((k) => !state[k]) ?? "pod_verified";
}

/** Where the goods physically are now, from the recorded legs. */
export function currentLocation(legs: Pick<Leg, "sequence" | "status" | "from_location" | "to_location">[]): string | null {
  if (!legs.length) return null;
  const last = [...legs].sort((a, b) => a.sequence - b.sequence).filter((l) => l.status !== "planned").pop();
  if (!last) return `Waiting to leave ${[...legs].sort((a, b) => a.sequence - b.sequence)[0].from_location}`;
  if (last.status === "arrived") return `At ${last.to_location}`;
  return `${last.from_location} → ${last.to_location}`;
}

/** Preview of the server-side CO2e snapshot (the snapshot itself is computed in the database). */
export function previewKgCo2e(weightKg: number | null | undefined, distanceKm: number | null | undefined, factor: { g: number; correction?: number } | null): number | null {
  if (!weightKg || !distanceKm || !factor) return null;
  return Math.round(transportKgCo2e({ weightKg, distanceKm, factorGPerTkm: factor.g, correction: factor.correction ?? 1 }) * 1000) / 1000;
}

export const kg = (n: number | string | null | undefined, d = 1) => (n == null ? "—" : `${Number(n).toLocaleString("en-GB", { maximumFractionDigits: d })} kg`);
export const pct = (n: number | string | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`);

/** On-time % across delivered deliveries with a planned date. */
export function onTimePercent(ds: Pick<Delivery, "status" | "actual_delivery_date" | "planned_delivery_date">[]): number | null {
  const done = ds.filter((d) => d.status === "delivered" && d.planned_delivery_date && d.actual_delivery_date);
  if (!done.length) return null;
  return Math.round((1000 * done.filter((d) => d.actual_delivery_date! <= d.planned_delivery_date!).length) / done.length) / 10;
}

/** ISO date strings for the current Monday-Sunday week. */
export function thisWeek(today = new Date()): [string, string] {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - dow * 864e5);
  const end = new Date(start.getTime() + 6 * 864e5);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
