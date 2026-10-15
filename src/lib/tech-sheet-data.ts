import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TechSheet } from "@/lib/tech-sheet";

type Client = Awaited<ReturnType<typeof createClient>>;

/** One row of v_tech_sheets (internal list, filters, compact panels). */
export type TechSheetRow = {
  id: string; sheet_ref: string; spec_id: string; spec_version_id: string | null; supplier_id: string; job_id: string; status: string; source: string;
  version: number; po_id: string | null; tbc_by: string | null; declared_at: string | null; verified_at: string | null; mismatch_at: string | null; updated_at: string;
  spec_title: string; spec_no: number; spec_type: string; version_name: string | null; job_number: string; client_id: string; client_name: string;
  supplier_name: string; supplier_code: string | null; po_number: string | null; po_status: string | null;
  quote_pct: number; po_pct: number; pre_shipment_pct: number; quote_required: number; po_required: number; pre_shipment_required: number;
  missing_quote: string[]; missing_po: string[]; missing_pre_shipment: string[]; pre_shipment_status: string | null; pre_shipment_due: string | null; blocking: boolean;
  market: string | null;
};

export async function getSheetRows(supabase: Client, eq: Record<string, string> = {}): Promise<TechSheetRow[]> {
  let q = supabase.from("v_tech_sheets").select("*").order("updated_at", { ascending: false }).limit(1000);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  const { data } = await q;
  return (data ?? []) as TechSheetRow[];
}

export async function getSheetDetails(supabase: Client, ids: string[]): Promise<TechSheet[]> {
  const out = await Promise.all(ids.map(async (id) => {
    const { data } = await supabase.rpc("tech_sheet_detail", { p_sheet: id });
    return (data ?? null) as TechSheet | null;
  }));
  return out.filter((x): x is TechSheet => !!x);
}
