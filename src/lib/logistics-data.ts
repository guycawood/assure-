import "server-only";
import { rows, one, type Client } from "@/lib/sourcing-data";
import type { Delivery, EmissionSnapshot, Leg, Shipment, SupplierOtif } from "@/lib/logistics";
import type { LibraryRecord } from "@/lib/sourcing";

// Server-side reads for Logistics+, as the signed-in user under RLS (internal only), through views that join names.

export const getDeliveries = (s: Client, eq: Record<string, string> = {}) =>
  rows<Delivery>(s, "v_deliveries", { eq, order: [["planned_delivery_date", true]], limit: 5000 });
export const getDelivery = (s: Client, id: string) => one<Delivery>(s, "v_deliveries", id);
export const getShipments = (s: Client, eq: Record<string, string> = {}) =>
  rows<Shipment>(s, "v_shipments", { eq, order: [["dispatch_date", false]], limit: 5000 });
export const getLegs = (s: Client, shipmentId?: string) =>
  rows<Leg>(s, "shipment_legs", { eq: shipmentId ? { shipment_id: shipmentId } : {}, order: [["sequence", true]], limit: 5000 });
export const getSnapshots = (s: Client, eq: Record<string, string> = {}) =>
  rows<EmissionSnapshot>(s, "v_emission_snapshots", { eq, order: [["computed_at", false]], limit: 5000 });
export const getOtif = (s: Client) => rows<SupplierOtif>(s, "v_supplier_otif", { order: [["supplier_name", true]] });

export interface LogisticsEvent { id: number; delivery_id: string | null; shipment_id: string | null; event: string; detail: Record<string, unknown>; actor: string | null; at: string }
export const getLogisticsEvents = (s: Client, deliveryId: string) =>
  rows<LogisticsEvent>(s, "logistics_events", { eq: { delivery_id: deliveryId }, order: [["at", false]], limit: 200 });

export async function getActiveLibrary(s: Client, key: string): Promise<LibraryRecord[]> {
  return rows<LibraryRecord>(s, "library_records", { eq: { library_key: key, status: "active" }, order: [["code", true]] });
}

/** Latest snapshot per delivery. */
export function latestByDelivery(snaps: EmissionSnapshot[]): Map<string, EmissionSnapshot> {
  const m = new Map<string, EmissionSnapshot>();
  for (const x of snaps) if (!m.has(x.delivery_id)) m.set(x.delivery_id, x);
  return m;
}

export interface PlannablePo { id: string; po_number: string; job_id: string; job_number: string; supplier_name: string; client_name: string; status: string; delivery_date: string | null; market: string; region: string }
/** Approved POs (issued/accepted) and how many live deliveries each has. */
export async function getPlannablePos(s: Client): Promise<(PlannablePo & { deliveries: number })[]> {
  const [pos, dels] = await Promise.all([
    rows<PlannablePo>(s, "v_purchase_orders", { order: [["po_date", false]], limit: 2000 }),
    rows<{ po_id: string; status: string }>(s, "deliveries", { limit: 10000 }),
  ]);
  return pos.filter((p) => ["issued", "accepted"].includes(p.status))
    .map((p) => ({ ...p, deliveries: dels.filter((d) => d.po_id === p.id && d.status !== "cancelled").length }));
}

export async function getMarkets(s: Client): Promise<{ code: string; name: string; region_code: string }[]> {
  return rows(s, "markets", { eq: { active: true }, order: [["name", true]] });
}
