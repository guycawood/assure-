// Field definitions for the generic Watchtower library screens (list, filters, edit forms, CSV).
// The catalogue itself (key, module, label, maker-checker) lives in the database: library_definitions.

export type FieldType = "text" | "textarea" | "number" | "enum" | "boolean" | "date" | "list";
export type LibraryField = {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  unit?: string;
  required?: boolean;
  /** Show as a column in the list. */
  column?: boolean;
  /** Offer as a filter in the toolbar (enum and boolean fields). */
  filter?: boolean;
  help?: string;
};
export type LibrarySchema = { fields: LibraryField[]; groupBy?: string; codeLabel?: string; nameLabel?: string; note?: string };

const opts = (...v: string[]) => v.map((x) => ({ value: x, label: x.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

export const SUBSTRATE_TYPES = opts("paper", "board", "corrugated", "vinyl", "fluted_polypropylene", "pvc_foam", "acrylic", "textile", "metal", "wood", "other");
const CR_CATEGORIES = opts("data_integrity", "access_control", "provenance", "governance_ownership", "user_experience");
const MODES = opts("road", "air", "sea", "rail", "courier", "postal", "collection");

export const LIBRARY_SCHEMAS: Record<string, LibrarySchema> = {
  core_principles: {
    codeLabel: "Principle code", nameLabel: "Title", groupBy: "category",
    fields: [
      { key: "category", label: "Category", type: "enum", options: CR_CATEGORIES, required: true, column: true, filter: true },
      { key: "description", label: "Principle", type: "textarea", required: true, column: true },
      { key: "rationale", label: "Why it matters", type: "textarea" },
    ],
  },
  doa_levels: {
    codeLabel: "Level code", nameLabel: "Threshold label",
    fields: [
      { key: "approval_level", label: "Approval level", type: "number", required: true, column: true, help: "0 to 8" },
      { key: "max_approval_amount", label: "Ceiling", type: "number", column: true, help: "Leave blank for uncapped" },
      { key: "currency", label: "Currency", type: "enum", options: opts("GBP", "USD", "EUR", "SGD", "VND"), required: true, column: true, filter: true },
      { key: "role_titles", label: "Roles holding this level", type: "list", column: true, help: "One per line, e.g. EMEA · Sourcing lead" },
    ],
  },
  substrates: {
    codeLabel: "Substrate code", groupBy: "substrate_type",
    fields: [
      { key: "substrate_type", label: "Type", type: "enum", options: SUBSTRATE_TYPES, required: true, column: true, filter: true },
      { key: "measurement_basis", label: "Measurement basis", type: "enum", options: opts("grammage", "thickness_density"), required: true, column: true, filter: true },
      { key: "grammage_gsm", label: "Grammage", type: "number", unit: "gsm", column: true },
      { key: "thickness_mm", label: "Thickness", type: "number", unit: "mm" },
      { key: "density_kg_per_m3", label: "Density", type: "number", unit: "kg/m³" },
      { key: "recycled_content_percent", label: "Recycled content", type: "number", unit: "%", column: true },
      { key: "fsc_certified", label: "FSC certified", type: "boolean", column: true, filter: true },
      { key: "verification_status", label: "Verification", type: "enum", options: opts("indicative", "supplier_confirmed", "measured"), column: true, filter: true },
      { key: "virgin_factor_code", label: "Virgin material factor (code)", type: "text" },
      { key: "recycled_factor_code", label: "Recycled material factor (code)", type: "text" },
    ],
  },
  material_emission_factors: {
    codeLabel: "Factor code", nameLabel: "Material description", groupBy: "material_category",
    note: "Raw material production only. Excludes conversion and manufacturing energy, production waste and end-of-life. Not a product carbon footprint.",
    fields: [
      { key: "material_category", label: "Material category", type: "enum", options: SUBSTRATE_TYPES, required: true, column: true, filter: true },
      { key: "factor_kgco2e_per_kg", label: "Factor", type: "number", unit: "kgCO2e/kg", required: true, column: true },
      { key: "boundary", label: "Boundary", type: "enum", options: opts("cradle_to_gate", "cradle_to_grave", "gate_to_gate"), required: true, column: true, filter: true },
      { key: "content_basis", label: "Content basis", type: "enum", options: opts("virgin", "recycled", "mixed"), column: true, filter: true },
      { key: "factor_set", label: "Factor set", type: "text", required: true },
      { key: "source", label: "Source", type: "text" },
      { key: "published_year", label: "Published", type: "number" },
      { key: "geography", label: "Geography", type: "text", column: true },
    ],
  },
  transport_emission_factors: {
    codeLabel: "Factor code", nameLabel: "Factor name",
    fields: [
      { key: "transport_mode", label: "Mode", type: "enum", options: MODES, required: true, column: true, filter: true },
      { key: "vehicle_class", label: "Vehicle class", type: "text", column: true },
      { key: "factor_gco2e_per_tonne_km", label: "Factor", type: "number", unit: "gCO2e/t·km", required: true, column: true },
      { key: "distance_correction_factor", label: "Distance correction", type: "number", column: true },
      { key: "scope", label: "Scope", type: "enum", options: opts("well_to_wheel", "tank_to_wheel"), column: true, filter: true },
      { key: "factor_set", label: "Factor set", type: "text", required: true },
      { key: "published_year", label: "Published", type: "number" },
    ],
  },
  impact_grade_dimensions: {
    codeLabel: "Dimension key", nameLabel: "Dimension",
    note: "Active dimension weights must add up to 100%.",
    fields: [
      { key: "weight_percent", label: "Weight", type: "number", unit: "%", required: true, column: true },
      { key: "source_description", label: "Data source", type: "textarea", column: true },
    ],
  },
  certification_types: {
    codeLabel: "Code",
    fields: [
      { key: "category", label: "Category", type: "enum", options: opts("quality", "environmental", "health_safety", "ethical", "esg", "product"), required: true, column: true, filter: true },
      { key: "validity_months", label: "Typical validity", type: "number", unit: "months", column: true },
      { key: "critical", label: "Critical for onboarding", type: "boolean", column: true, filter: true },
      { key: "evidence", label: "What evidences it", type: "textarea" },
    ],
  },
  order_document_types: {
    codeLabel: "Code",
    fields: [
      { key: "required_for_categories", label: "Required for categories", type: "list", column: true, help: "print, packaging, POS, digital, logistics, merchandise, creative" },
      { key: "uploaded_by", label: "Usually uploaded by", type: "enum", options: opts("vendor", "internal", "either"), column: true, filter: true },
    ],
  },
  ncr_categories: {
    codeLabel: "Code",
    fields: [
      { key: "severity", label: "Default severity", type: "enum", options: opts("critical", "high", "medium", "low"), required: true, column: true, filter: true },
      { key: "description", label: "Description", type: "textarea", column: true },
    ],
  },
  sourcing_control_matrix: {
    codeLabel: "Band code", nameLabel: "Value band",
    fields: [
      { key: "min_value_eur", label: "From", type: "number", unit: "€", required: true, column: true },
      { key: "max_value_eur", label: "To", type: "number", unit: "€", column: true, help: "Blank for no upper limit" },
      { key: "suppliers_in_country", label: "Suppliers to invite (in country)", type: "number", column: true },
      { key: "suppliers_cross_border", label: "Suppliers to invite (cross border)", type: "number", column: true },
      { key: "strategy_owner", label: "Strategy owner", type: "text", column: true },
      { key: "external_price_validation", label: "External price validation", type: "text", help: "e.g. 1 in 10" },
      { key: "e_sourcing", label: "E-sourcing required", type: "boolean", column: true },
    ],
  },
  rate_cards: {
    codeLabel: "Card code", nameLabel: "Item",
    fields: [
      { key: "spec_type", label: "Spec type", type: "enum", options: opts("2d", "3d", "custom_goods_services", "design", "promo_merch"), required: true, column: true, filter: true },
      { key: "substrate_code", label: "Substrate (code)", type: "text", column: true },
      { key: "finished_length_mm", label: "Length", type: "number", unit: "mm" },
      { key: "finished_width_mm", label: "Width", type: "number", unit: "mm" },
      { key: "min_qty", label: "Min quantity", type: "number", column: true },
      { key: "max_qty", label: "Max quantity", type: "number", column: true },
      { key: "unit_price", label: "Unit price", type: "number", required: true, column: true },
      { key: "currency", label: "Currency", type: "enum", options: opts("EUR", "GBP", "USD", "SGD"), required: true, column: true, filter: true },
      { key: "supplier_code", label: "Supplier (code)", type: "text", column: true },
      { key: "client_code", label: "Client (code)", type: "text", filter: false },
    ],
  },
  high_value_thresholds: {
    codeLabel: "Code", nameLabel: "Applies to",
    fields: [
      { key: "market", label: "Market", type: "text", column: true, help: "Blank = all other markets" },
      { key: "threshold", label: "Threshold", type: "number", required: true, column: true },
      { key: "currency", label: "Currency", type: "enum", options: opts("EUR", "GBP", "USD", "SGD"), required: true, column: true },
    ],
  },
  bypass_reasons: { codeLabel: "Code", fields: [{ key: "description", label: "When it applies", type: "textarea", column: true }, { key: "needs_approval", label: "Needs approval", type: "boolean", column: true }] },
  carriers: {
    codeLabel: "Carrier code",
    fields: [
      { key: "modes", label: "Modes", type: "list", column: true },
      { key: "regions", label: "Regions", type: "list", column: true },
      { key: "tracking_url", label: "Tracking URL", type: "text" },
    ],
  },
  pod_checklist: { codeLabel: "Point", nameLabel: "Check", fields: [{ key: "guidance", label: "What to look for", type: "textarea", column: true }, { key: "mandatory", label: "Mandatory", type: "boolean", column: true }] },
  display_scoring: {
    codeLabel: "Criterion code", nameLabel: "Criterion",
    fields: [
      { key: "weight_percent", label: "Weight", type: "number", unit: "%", required: true, column: true },
      { key: "guidance", label: "Scoring guidance", type: "textarea", column: true },
    ],
  },
  finance_rules: {
    codeLabel: "Rule code", nameLabel: "Rule",
    fields: [
      { key: "value", label: "Value", type: "number", required: true, column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "note", label: "What it controls", type: "textarea", column: true },
    ],
  },
  execution_rules: {
    codeLabel: "Rule code", nameLabel: "Rule",
    fields: [
      { key: "value", label: "Value", type: "number", required: true, column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "description", label: "What it controls", type: "textarea", column: true },
    ],
  },
  touchpoint_types: { codeLabel: "Code", fields: [{ key: "permanence", label: "Typical permanence", type: "enum", options: opts("temporary", "permanent"), column: true, filter: true }, { key: "description", label: "Description", type: "textarea", column: true }] },
  p2p_stages: { codeLabel: "Code", fields: [{ key: "framework", label: "Framework", type: "enum", options: opts("connect_engage_sell", "connect_guide_convert"), column: true, filter: true }, { key: "order", label: "Order", type: "number", column: true }] },
  brief_fields: {
    codeLabel: "Field key", nameLabel: "Field label",
    fields: [
      { key: "drives", label: "Drives", type: "enum", options: opts("price", "quality", "compliance", "timing", "creative"), column: true, filter: true },
      { key: "required", label: "Required for a complete brief", type: "boolean", column: true, filter: true },
      { key: "help", label: "Help text", type: "textarea" },
    ],
  },
};

export const schemaFor = (key: string): LibrarySchema => LIBRARY_SCHEMAS[key] ?? { fields: [] };

/** Coerce form strings into typed data per the schema; returns errors for required/typed fields. */
export function coerceData(schema: LibrarySchema, raw: Record<string, unknown>): { data: Record<string, unknown>; errors: string[] } {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of schema.fields) {
    const v = raw[f.key];
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (empty) {
      if (f.type === "boolean") data[f.key] = false;
      else if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isNaN(n)) errors.push(`${f.label} must be a number`);
      else data[f.key] = n;
    } else if (f.type === "boolean") data[f.key] = v === true || v === "true" || v === "on" || v === "yes" || v === "1";
    else if (f.type === "list") data[f.key] = Array.isArray(v) ? v : String(v).split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
    else if (f.type === "enum") {
      if (f.options && !f.options.some((o) => o.value === v)) errors.push(`${f.label}: "${String(v)}" is not an allowed value`);
      else data[f.key] = v;
    } else data[f.key] = String(v).trim();
  }
  return { data, errors };
}

export function displayValue(f: LibraryField, v: unknown): string {
  if (v === undefined || v === null || v === "") return "–";
  if (f.type === "boolean") return v ? "Yes" : "No";
  if (f.type === "list") return Array.isArray(v) ? v.join(", ") : String(v);
  if (f.type === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === "number" && f.unit) return `${v} ${f.unit}`;
  return String(v);
}
