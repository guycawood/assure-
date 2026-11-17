import "server-only";
import { rows, type Client } from "@/lib/sourcing-data";
import { rulesFrom, type OrderLine, type Rules } from "@/lib/conscious-ordering";

// Server-side reads for the conscious ordering programme, as the signed-in user (internal only).

export interface StockCount {
  id: string; po_id: string; spec_id: string; quantity: number; counted_on: string; location: string;
  source: "warehouse" | "vendor" | "market"; notes: string | null; recorded_by: string | null; created_at: string;
}

/** Every order line with its ordered / delivered / installed / in stock reconciliation. */
export async function getOrderLines(s: Client): Promise<OrderLine[]> {
  const { data, error } = await s.rpc("conscious_ordering_lines");
  if (error) console.error("[conscious-ordering] lines:", error.message);
  return (data as OrderLine[] | null) ?? [];
}

/** The governed thresholds, falling back to the defaults for any that are missing. */
export async function getRules(s: Client): Promise<Rules> {
  const recs = await rows<{ code: string | null; data: Record<string, unknown> }>(s, "library_records", { eq: { library_key: "conscious_ordering_rules", status: "active" } });
  return rulesFrom(recs);
}

export const getStockCounts = (s: Client, poId: string) =>
  rows<StockCount>(s, "stock_counts", { eq: { po_id: poId }, order: [["counted_on", false], ["created_at", false]], limit: 500 });
