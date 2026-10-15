// Vendor technical & packaging data sheet: pure types and helpers (no I/O), shared by the vendor portal, Sourcing and
// Order Management. The database owns every rule (required fields, completeness, the pre-shipment gate, tolerances).
import type { Tone } from "@/lib/srt";

export type TechStage = "quote" | "po_acceptance" | "pre_shipment";
export const STAGES: { key: TechStage; label: string }[] = [
  { key: "quote", label: "Quote" }, { key: "po_acceptance", label: "PO acceptance" }, { key: "pre_shipment", label: "Pre-shipment" },
];
export type TechLevel = "primary" | "secondary" | "tertiary";
export const LEVELS: { key: TechLevel; label: string; hint: string }[] = [
  { key: "primary", label: "Unit pack (primary)", hint: "The retail or unit pack around one item" },
  { key: "secondary", label: "Carton (secondary)", hint: "The inner or outer carton the units ship in" },
  { key: "tertiary", label: "Pallet (tertiary)", hint: "The pallet and its wrapping" },
];

export type RequiredField = { code: string; label: string; section: string; rules: { rule: string; stage: string; why: string }[] };
export type Completeness = {
  stage: TechStage; required: number; present: number; percent: number; complete: boolean; declared: boolean; tbc_by: string | null;
  missing: string[]; missing_codes: string[];
};
export type SheetMaterial = { substrate_id: string | null; substrate_code: string | null; substrate_name: string | null; material_name: string | null; share_pct: number | null; weight_g: number | null; recycled_pct: number | null };
export type PackMaterial = { packaging_material_id: string; material_code: string; material_name: string; material_group: string | null; component: string | null; weight_g: number | null; recycled_pct: number | null; reusable: boolean | null };
export type Pack = {
  level: TechLevel; not_used: boolean; description: string | null; length_mm: number | null; width_mm: number | null; height_mm: number | null;
  units_per_pack: number | null; packs_per_carton: number | null; cartons_per_layer: number | null; layers: number | null; cartons_per_pallet: number | null;
  pallet_type: string | null; max_stack: number | null; gross_weight_kg: number | null; labelling: string | null; protective_fill: string | null; materials: PackMaterial[];
};
export type Comparison = { field: string; label: string; declared: number | null; actual: number | null; unit?: string; ok: boolean; detail: string; tolerance?: string };
export type HistoryRow = { event: string; version: number | null; at: string; by_vendor: boolean; actor: string | null; detail: Record<string, unknown> };
export type TechSheet = {
  id: string; sheet_ref: string; status: string; source: string; version: number; spec_id: string; spec_version_id: string | null; supplier_id: string;
  spec_title: string; spec_type: string; version_name: string | null; po_id: string | null; po_number: string | null; supplier_name: string;
  spec_revision: number | null; current_spec_revision: number | null; copied_from_ref: string | null; declared_at: string | null; declared_by_vendor: boolean | null;
  declared_by_name: string | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null; net_weight_g: number | null; finishes: string | null; components_note: string | null;
  has_electrical: boolean | null; has_battery: boolean | null; electrical_detail: string | null; origin_country: string | null; hs_code: string | null;
  packing_method: string | null; notes: string | null; tbc_by: string | null; tbc_note: string | null;
  materials: SheetMaterial[]; packs: Pack[];
  actual: { gross_weight_kg: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null; measured_at: string | null };
  verification: Comparison[]; verified_at: string | null; mismatch_at: string | null;
  completeness: Record<TechStage, Completeness>; required: RequiredField[]; history: HistoryRow[];
  measures: { at: string; gross_weight_kg: number; length_mm: number; width_mm: number; height_mm: number; within_tolerance: boolean | null; submission_no: number }[];
};
export type VendorPoLine = {
  spec_id: string; spec_version_id: string | null; spec_title: string; version_name: string | null; quantity: number; spec_type: string; po_status: string;
  sheet: TechSheet | null; required_po: RequiredField[]; required_pre: RequiredField[]; pre_shipment_due: string | null;
  prefill: { sheet_id: string; sheet_ref: string; match: string } | null;
  copy_sources: { id: string; sheet_ref: string; status: string; spec_title: string; same_spec: boolean }[];
};
export type MaterialOptions = { packaging: { code: string; name: string; group: string | null }[]; substrates: { code: string; name: string; type: string | null }[] };

export const SHEET_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" }, draft: { label: "Draft", tone: "warn" }, declared: { label: "Declared", tone: "info" },
  verified: { label: "Verified", tone: "ok" }, mismatch: { label: "Mismatch", tone: "bad" },
};
export const sheetStatus = (s: string | null | undefined) => SHEET_STATUS[s ?? "not_started"] ?? { label: s ?? "", tone: "neutral" as Tone };
export const SOURCE_LABEL: Record<string, string> = { quote: "From the quote", po: "Opened on the PO", copied: "Copied from an earlier sheet", library: "Pre-filled from a verified sheet" };
export const EVENT_LABEL: Record<string, string> = {
  created: "Opened", saved: "Saved", declared: "Declared", redeclared_after_mismatch: "Declared again after a mismatch", verified: "Verified at pre-shipment",
  mismatch: "Mismatch at pre-shipment", copied: "Copied from an earlier sheet", quote_proposal: "Packaging proposed with the quote", reopened: "Reopened by adm Indicia",
};

export const pctTone = (p: number | null | undefined): Tone => (p == null ? "neutral" : p >= 100 ? "ok" : p >= 60 ? "warn" : "bad");
export const fmtDims = (l: number | null | undefined, w: number | null | undefined, h: number | null | undefined, unit = "mm") =>
  l != null && w != null && h != null ? `${Number(l)} x ${Number(w)} x ${Number(h)} ${unit}` : "–";
export const fmtNum = (n: number | null | undefined, unit = "") => (n == null ? "–" : `${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`);
export const packOf = (s: Pick<TechSheet, "packs"> | null | undefined, level: TechLevel) => s?.packs.find((p) => p.level === level) ?? null;

// ---------------------------------------------------------------------------
// Form parsing (vendor and internal forms post the same field names)
// ---------------------------------------------------------------------------
const NUM_PRODUCT = ["length_mm", "width_mm", "height_mm", "net_weight_g"] as const;
const TEXT_PRODUCT = ["finishes", "components_note", "electrical_detail", "origin_country", "hs_code", "packing_method", "notes", "tbc_note"] as const;
const NUM_PACK = ["length_mm", "width_mm", "height_mm", "units_per_pack", "packs_per_carton", "cartons_per_layer", "layers", "cartons_per_pallet", "max_stack", "gross_weight_kg"] as const;
const TEXT_PACK = ["description", "pallet_type", "labelling", "protective_fill"] as const;
export const MATERIAL_ROWS = 4;
export const PACK_MATERIAL_ROWS = 3;

const txt = (fd: FormData, k: string, max = 1000) => { const v = fd.get(k); return typeof v === "string" ? v.trim().slice(0, max) : ""; };
const numOf = (s: string) => (s === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));
const yesNo = (s: string) => (s === "yes" ? true : s === "no" ? false : null);

/** Turn the data-sheet form into the p_data object the database expects. Returns an error message for bad numbers. */
export function parseSheetForm(fd: FormData): { data?: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};
  for (const k of NUM_PRODUCT) {
    const n = numOf(txt(fd, k, 20));
    if (n != null && (!Number.isFinite(n) || n <= 0)) return { error: "Sizes and weights must be numbers above zero." };
    data[k] = n;
  }
  for (const k of TEXT_PRODUCT) data[k] = txt(fd, k) || null;
  data.has_electrical = yesNo(txt(fd, "has_electrical", 5));
  data.has_battery = yesNo(txt(fd, "has_battery", 5));
  const tbc = txt(fd, "tbc_by", 10);
  if (tbc && !/^\d{4}-\d{2}-\d{2}$/.test(tbc)) return { error: "Give the 'to be confirmed by' date as a date." };
  data.tbc_by = tbc || null;
  const materials: Record<string, unknown>[] = [];
  for (let i = 0; i < MATERIAL_ROWS; i++) {
    const code = txt(fd, `m${i}_substrate_code`, 60), name = txt(fd, `m${i}_material_name`, 200);
    if (!code && !name) continue;
    const row: Record<string, unknown> = { substrate_code: code || null, material_name: name || null };
    for (const k of ["share_pct", "weight_g", "recycled_pct"]) {
      const n = numOf(txt(fd, `m${i}_${k}`, 20));
      if (n != null && (!Number.isFinite(n) || n < 0)) return { error: "Material shares, weights and recycled content must be numbers of zero or more." };
      row[k] = n;
    }
    materials.push(row);
  }
  data.materials = materials;
  const packs: Record<string, unknown>[] = [];
  for (const { key } of LEVELS) {
    const p: Record<string, unknown> = { level: key, not_used: fd.get(`${key}_not_used`) === "on" };
    let any = Boolean(p.not_used);
    for (const k of NUM_PACK) {
      const n = numOf(txt(fd, `${key}_${k}`, 20));
      if (n != null && (!Number.isFinite(n) || n <= 0)) return { error: "Packaging sizes, counts and weights must be numbers above zero." };
      if (n != null) any = true;
      p[k] = n;
    }
    for (const k of TEXT_PACK) { const v = txt(fd, `${key}_${k}`, 500); if (v) any = true; p[k] = v || null; }
    const mats: Record<string, unknown>[] = [];
    for (let i = 0; i < PACK_MATERIAL_ROWS; i++) {
      const code = txt(fd, `${key}_pm${i}_code`, 60);
      if (!code) continue;
      const row: Record<string, unknown> = { material_code: code, component: txt(fd, `${key}_pm${i}_component`, 200) || null, reusable: yesNo(txt(fd, `${key}_pm${i}_reusable`, 5)) };
      for (const k of ["weight_g", "recycled_pct"]) {
        const n = numOf(txt(fd, `${key}_pm${i}_${k}`, 20));
        if (n != null && (!Number.isFinite(n) || n < 0)) return { error: "Packaging weights and recycled content must be numbers of zero or more." };
        row[k] = n;
      }
      mats.push(row);
    }
    if (mats.length) any = true;
    p.materials = mats;
    if (any) packs.push(p);
  }
  data.packs = packs;
  return { data };
}

/** Measured packed-carton values for the QA/QC pre-shipment submission. */
export function parseMeasured(fd: FormData): { measured?: Record<string, number>; error?: string } | null {
  const keys = ["gross_weight_kg", "length_mm", "width_mm", "height_mm"] as const;
  const raw = keys.map((k) => txt(fd, `measured_${k}`, 20));
  if (raw.every((v) => v === "")) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < keys.length; i++) {
    const n = numOf(raw[i]);
    if (n == null || !Number.isFinite(n) || n <= 0) return { error: "Enter what you measured on a packed carton: gross weight (kg) and length, width and height (mm)." };
    out[keys[i]] = n;
  }
  return { measured: out };
}

/** The evidence codes that tell a checkpoint needs packed-carton measurements. */
export const TECH_EVIDENCE = ["PACKED_CARTON_PHOTO", "CARTON_LABEL_PHOTO", "PALLET_PHOTO"];
export const needsMeasurement = (required: { codes: string[] }[]) => required.some((r) => r.codes.some((c) => TECH_EVIDENCE.includes(c)));
