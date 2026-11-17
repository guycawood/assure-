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
  conscious_ordering_rules: {
    codeLabel: "Rule code", nameLabel: "Rule",
    note: "Used by the conscious ordering programme in Sustainability. A change applies to every figure from its effective date.",
    fields: [
      { key: "value", label: "Value", type: "number", required: true, column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "description", label: "What it controls", type: "textarea", column: true },
    ],
  },
  spend_emission_factors: {
    codeLabel: "Factor code", nameLabel: "Product type",
    note: "Used only where a spec has no measured footprint. Spend-based figures are the least accurate and are always labelled estimated.",
    fields: [
      { key: "spec_type", label: "Spec type", type: "enum", options: opts("2d", "3d", "promo_merch", "custom_goods_services", "design"), required: true, column: true, filter: true },
      { key: "factor_kgco2e_per_eur", label: "Factor", type: "number", unit: "kgCO2e per EUR", required: true, column: true },
      { key: "verification_status", label: "Verification", type: "enum", options: opts("indicative", "licensed"), column: true, filter: true },
      { key: "source", label: "Source", type: "textarea" },
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
  branding_methods: {
    codeLabel: "Method code", nameLabel: "Branding method",
    fields: [
      { key: "process", label: "Process", type: "enum", options: opts("print", "transfer", "forming", "engraving", "stitching"), required: true, column: true, filter: true },
      { key: "max_colours", label: "Max colours", type: "number", column: true, help: "Blank for full colour; 0 for blind (no ink)" },
      { key: "min_qty", label: "Typical minimum quantity", type: "number", column: true },
      { key: "typical_substrates", label: "Typical substrates", type: "list", column: true, help: "One per line, e.g. textile, paper, plastic" },
    ],
  },
  aql_levels: {
    codeLabel: "AQL code", nameLabel: "AQL level",
    note: "Acceptance quality limits (ISO 2859-1) used to sample goods at inspection.",
    fields: [
      { key: "inspection_level", label: "Inspection level", type: "enum", options: opts("I", "II", "III", "S-1", "S-2", "S-3", "S-4"), required: true, column: true, filter: true },
      { key: "critical", label: "Critical defects AQL", type: "number", column: true },
      { key: "major", label: "Major defects AQL", type: "number", required: true, column: true },
      { key: "minor", label: "Minor defects AQL", type: "number", column: true },
    ],
  },
  incoterms: {
    codeLabel: "Incoterm", nameLabel: "Name",
    note: "DDP is the default for RFQs; other terms are allowed and need a named place.",
    fields: [
      { key: "risk_transfers", label: "Where risk passes to us", type: "textarea", column: true },
      { key: "seller_pays_freight", label: "Supplier pays main freight", type: "boolean", column: true, filter: true },
      { key: "seller_pays_duty", label: "Supplier pays import duty", type: "boolean", column: true },
      { key: "needs_named_place", label: "Needs a named place", type: "boolean" },
      { key: "sea_only", label: "Sea freight only", type: "boolean" },
      { key: "default", label: "Default for new RFQs", type: "boolean" },
    ],
  },
  // CRM
  crm_account_tiers: {
    codeLabel: "Tier code", nameLabel: "Tier",
    fields: [
      { key: "description", label: "What it means", type: "textarea", column: true },
      { key: "review_cadence_days", label: "Review every", type: "number", unit: "days", column: true },
      { key: "order", label: "Order", type: "number", column: true },
    ],
  },
  crm_opportunity_stages: {
    codeLabel: "Stage key", nameLabel: "Stage",
    note: "The stage keys (lead, qualified, proposal, negotiation, won, lost) are fixed; the label and default probability can change.",
    fields: [
      { key: "default_probability", label: "Default probability", type: "number", unit: "%", required: true, column: true },
      { key: "order", label: "Order", type: "number", column: true },
      { key: "open", label: "Open stage", type: "boolean", column: true },
    ],
  },
  crm_lost_reasons: { codeLabel: "Code", fields: [{ key: "description", label: "When it applies", type: "textarea", column: true }] },
  crm_interaction_types: {
    codeLabel: "Code",
    fields: [
      { key: "description", label: "Description", type: "textarea", column: true },
      { key: "counts_as_activity", label: "Counts as client contact", type: "boolean", column: true, filter: true },
    ],
  },
  crm_services: { codeLabel: "Service code", nameLabel: "Service", fields: [{ key: "order", label: "Order", type: "number", column: true }] },
  crm_stakeholder_quadrants: {
    codeLabel: "Quadrant", nameLabel: "Name",
    fields: [
      { key: "strategy", label: "Engagement strategy", type: "textarea", column: true },
      { key: "actions", label: "Suggested actions", type: "textarea", column: true },
      { key: "order", label: "Order", type: "number" },
    ],
  },
  crm_stakeholder_matrix: {
    codeLabel: "Cell (influence-decision)", nameLabel: "Description",
    note: "Which quadrant each influence x decision-maker combination falls in. The default grid is marked to confirm: tick Confirmed once Client Services has agreed it.",
    fields: [
      { key: "influence", label: "Influence", type: "enum", options: opts("high", "medium", "low"), required: true, column: true, filter: true },
      { key: "decision", label: "Decision maker", type: "enum", options: opts("high", "medium", "low"), required: true, column: true, filter: true },
      { key: "quadrant", label: "Quadrant", type: "enum", options: opts("INFORM", "ESTABLISH", "MAINTAIN", "GROW"), required: true, column: true, filter: true },
      { key: "confirmed", label: "Confirmed", type: "boolean", column: true, filter: true },
    ],
  },
  crm_owner_roles: { codeLabel: "Role code", nameLabel: "Role", fields: [{ key: "order", label: "Order", type: "number", column: true }] },
  crm_next_steps: { codeLabel: "Code", nameLabel: "Next step", fields: [{ key: "order", label: "Order", type: "number", column: true }] },
  crm_settings: { codeLabel: "Setting", nameLabel: "Description", fields: [{ key: "value", label: "Value", type: "number", required: true, column: true }] },
  crm_survey_templates: {
    codeLabel: "Template code", nameLabel: "Template",
    note: "Questions are held as sections of statements scored 1-5 (comment required at or below comment_at_or_below), then NPS and the open questions. Edit the JSON in a new version; waves keep the version they were sent with.",
    fields: [
      { key: "scale", label: "Scale", type: "text", column: true },
      { key: "comment_at_or_below", label: "Comment required at or below", type: "number", column: true },
      { key: "tools", label: "Technology tools asked about", type: "list" },
    ],
  },
  crm_email_templates: {
    codeLabel: "Template code", nameLabel: "Template",
    fields: [{ key: "subject", label: "Subject", type: "text", required: true, column: true }, { key: "body", label: "Body", type: "textarea", required: true }],
  },
  approval_policies: {
    codeLabel: "Policy code", nameLabel: "Approval point", groupBy: "module",
    note: "Who approves what across the platform. The most specific active policy applies (client, then market, then the highest value threshold met). SLA days drive overdue flags in the approvals inbox.",
    fields: [
      { key: "module", label: "Module", type: "enum", options: opts("watchtower", "crm", "briefing", "shopper-iq", "sourcing", "rfq", "orders", "logistics", "execution", "finance", "assure"), required: true, column: true, filter: true },
      { key: "approval_type", label: "Approval type", type: "text", required: true, column: true, help: "Code used by the module, e.g. BRIEF, CONCEPT, PO_DOA" },
      { key: "description", label: "What is approved", type: "textarea", column: true },
      { key: "approver_role", label: "Who approves", type: "enum", required: true, column: true, filter: true, options: [
        { value: "admin", label: "Admin" }, { value: "internal", label: "Anyone on the team" }, { value: "named_person", label: "Named person" },
        { value: "srt_agent", label: "SRT agent or lead" }, { value: "srt_lead", label: "SRT lead" }, { value: "finance", label: "Finance" },
        { value: "procurement", label: "Procurement" }, { value: "procurement_head", label: "Procurement head" }, { value: "sourcing_lead", label: "Sourcing lead" },
        { value: "doa", label: "Delegated authority (DOA)" }, { value: "module_owner", label: "Module owner" }, { value: "briefing_lead", label: "Briefing lead" },
        { value: "client_approver", label: "Client approver" }, { value: "vendor", label: "Vendor" },
        { value: "quality", label: "Quality role" }, { value: "logistics_lead", label: "Logistics lead" }, { value: "line_manager", label: "Line manager" },
        { value: "procurement_director", label: "Procurement Director" }, { value: "local_finance", label: "Local Finance (supplier's market)" },
        { value: "category_manager", label: "Category Manager" },
      ] },
      { key: "min_value", label: "Applies from value", type: "number", column: true, help: "Blank for any value" },
      { key: "currency", label: "Currency", type: "enum", options: opts("GBP", "EUR", "USD", "SGD") },
      { key: "client_code", label: "Client (code)", type: "text", column: true, help: "Blank for every client" },
      { key: "market", label: "Market", type: "text", column: true, help: "Two-letter code; blank for every market" },
      { key: "maker_checker", label: "Maker-checker", type: "boolean", column: true, filter: true, help: "The approver can never be the requester" },
      { key: "client_approval_required", label: "Client must approve too", type: "boolean", column: true, filter: true },
      { key: "sla_days", label: "SLA", type: "number", unit: "days", column: true },
      { key: "decided_in", label: "Decided by (function)", type: "text" },
      { key: "where_in_ui", label: "Where it is decided", type: "text" },
    ],
  },
  // SRM onboarding standard: the deck's four decisions as governed settings
  onboarding_settings: {
    codeLabel: "Scope code", nameLabel: "Scope",
    note: "GLOBAL is the baseline for every region; a region record (APAC, EMEA, NAM) overlays it with local legal and tax requirements and any different limits.",
    fields: [
      { key: "region", label: "Region", type: "enum", options: opts("APAC", "EMEA", "Americas"), column: true, filter: true, help: "Blank for the global baseline" },
      { key: "baseline_flow", label: "Flow", type: "enum", options: [{ value: "nine_stage", label: "Nine-stage standard" }], column: true },
      { key: "local_requirements", label: "Local legal and tax requirements", type: "list", column: true, help: "One per line" },
      { key: "system_of_record", label: "System of record", type: "textarea" },
      { key: "required_systems", label: "Systems that must return an ID", type: "list", help: "stocktool, erp, sourcing_hub" },
      { key: "ft_director_role", label: "Fast-track approver (Procurement)", type: "text", help: "Approval role, e.g. procurement_director" },
      { key: "ft_finance_role", label: "Fast-track approver (Finance)", type: "text", help: "Approval role, e.g. local_finance" },
      { key: "ft_value_cap_max", label: "Largest fast-track value cap", type: "number", column: true },
      { key: "ft_max_days", label: "Longest remediation clock", type: "number", unit: "days", column: true },
      { key: "remediation_days", label: "Default remediation days", type: "number", unit: "days" },
      { key: "escalation_days", label: "Escalate after days in a stage", type: "number", unit: "days", column: true },
      { key: "block_orders_when_overdue", label: "Block orders when remediation is overdue", type: "boolean", column: true },
      { key: "cm_always", label: "Category Manager always approves the risk gate", type: "boolean" },
    ],
  },
  onboarding_evidence_sets: {
    codeLabel: "Set code", nameLabel: "Evidence set",
    note: "The most specific matching set applies at triage (client, then market, then supplier type, then region). Gates listed as not required are marked so; everything else is required. Critical gates can't be switched off.",
    fields: [
      { key: "region", label: "Region", type: "enum", options: opts("APAC", "EMEA", "Americas", "GSC"), column: true, filter: true },
      { key: "market", label: "Market", type: "text", column: true },
      { key: "client", label: "Client", type: "enum", options: opts("Brightlane", "Northbrew", "Carewell", "BAU"), column: true, filter: true },
      { key: "supplier_type", label: "Supplier type", type: "enum", options: opts("manufacturer", "distributor", "service_provider", "raw_material", "logistics"), column: true, filter: true },
      { key: "not_required_gates", label: "Not required", type: "list", column: true, help: "Gate keys, one per line (e.g. psa, client_requirements, environment, id_stocktool)" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  onboarding_risk_rules: {
    codeLabel: "Rule code", nameLabel: "Rule",
    note: "Every matching rule applies. A rule needs at least one condition (categories, clients or minimum spend).",
    fields: [
      { key: "categories", label: "Categories", type: "list", column: true },
      { key: "clients", label: "Clients", type: "list", column: true },
      { key: "min_spend", label: "Estimated spend from", type: "number", column: true },
      { key: "needs_cm", label: "Category Manager approves", type: "boolean", column: true },
      { key: "needs_quality", label: "Quality approves", type: "boolean", column: true },
      { key: "audit_required", label: "Audit required", type: "boolean", column: true },
    ],
  },
  onboarding_review_cadence: {
    codeLabel: "Review code", nameLabel: "Review",
    fields: [
      { key: "cadence", label: "Cadence", type: "enum", options: opts("weekly", "monthly", "quarterly", "annual", "event"), required: true, column: true, filter: true },
      { key: "scope", label: "What is reviewed", type: "enum", options: opts("open_cases", "exceptions", "overdue_evidence", "expiring_controls", "sample_audit", "access_review", "revalidation"), required: true, column: true, filter: true },
      { key: "risk_levels", label: "Risk levels (revalidation)", type: "list", column: true },
      { key: "interval_months", label: "Revalidate every", type: "number", unit: "months", column: true },
      { key: "sample_size", label: "Sample size", type: "number" },
      { key: "events", label: "Events", type: "list" },
      { key: "owner_role", label: "Owner role", type: "text", column: true },
    ],
  },
  // QA/QC threshold management (SRM owns the levels, evidence, rules and bodies; Order Management the settings)
  qaqc_levels: {
    codeLabel: "Level code", nameLabel: "Level",
    note: "Required evidence is one line per requirement as checkpoint:EVIDENCE_CODE, with alternatives separated by | (e.g. pre_shipment:COC|DECLARATION). Checkpoints: mockup, production, pre_shipment, installation.",
    fields: [
      { key: "level", label: "Level number", type: "number", required: true, column: true, help: "1 (lowest) to 5 (highest)" },
      { key: "description", label: "What it means", type: "textarea", required: true, column: true },
      { key: "checkpoints", label: "Checkpoints", type: "list", required: true, column: true, help: "One per line: mockup, production, pre_shipment, installation" },
      { key: "required_evidence", label: "Required evidence", type: "list", required: true, help: "One per line: checkpoint:EVIDENCE_CODE (| for alternatives)" },
      { key: "verifier", label: "Who verifies", type: "enum", options: opts("auto", "quality", "third_party"), required: true, column: true, filter: true },
      { key: "aql_code", label: "AQL reference (code)", type: "text", column: true, help: "From the AQL levels library, e.g. AQL-2.5; the spec's own AQL level wins" },
      { key: "signoff_required", label: "Quality sign-off required", type: "boolean", column: true, filter: true },
      { key: "min_photos", label: "Minimum photos", type: "number" },
      { key: "approved_body_required", label: "Approved lab / inspection body required", type: "boolean", column: true },
    ],
  },
  qaqc_evidence_types: {
    codeLabel: "Evidence code", nameLabel: "Evidence",
    note: "Key data the vendor must give (needs): issued_on, expires_on, inspection_date, body, certificate_number, aql, result. Window 'po' means dated within the order (minus the look-back days); 'validity' means not expired.",
    fields: [
      { key: "description", label: "Description", type: "textarea", column: true },
      { key: "needs", label: "Key data needed", type: "list", column: true, help: "One per line" },
      { key: "window", label: "Date window", type: "enum", options: opts("po", "validity", "none"), column: true, filter: true },
      { key: "lookback_days", label: "Look-back before the PO date", type: "number", unit: "days" },
      { key: "body_types", label: "Accepted body types", type: "list", help: "lab, inspection_agency, certification_body" },
      { key: "allowed_types", label: "Allowed file types", type: "list", help: "MIME prefixes, e.g. application/pdf, image/" },
      { key: "min_files", label: "Minimum files", type: "number" },
    ],
  },
  qaqc_level_rules: {
    codeLabel: "Rule code", nameLabel: "Rule", groupBy: "condition",
    note: "Every matching rule fires; the highest minimum level wins, then bumps (e.g. new supplier +1) are added, capped at L5. Values match case-insensitively; categories match as text contained in the spec's product category or the job category.",
    fields: [
      { key: "condition", label: "Condition", type: "enum", required: true, column: true, filter: true,
        options: opts("spec_type", "product_category", "lighting_electronics", "testing_checklist", "order_value", "quantity", "destination_market",
          "client_requirement", "supplier_unrated", "supplier_quality_below", "supplier_tier", "sustainability_claim", "cross_border") },
      { key: "values", label: "Values", type: "list", column: true, help: "One per line (spec types, categories, tests, market codes, tiers)" },
      { key: "threshold", label: "Threshold", type: "number", column: true, help: "Order value, quantity or quality score" },
      { key: "currency", label: "Currency (order value)", type: "enum", options: opts("EUR", "GBP", "USD", "SGD") },
      { key: "effect", label: "Effect", type: "enum", options: opts("min_level", "bump"), required: true, column: true, filter: true },
      { key: "level", label: "Minimum level", type: "number", column: true },
      { key: "bump", label: "Levels added", type: "number" },
      { key: "evidence_add", label: "Extra evidence", type: "list", help: "checkpoint:EVIDENCE_CODE, e.g. pre_shipment:CERTIFICATE" },
      { key: "explanation", label: "Explanation (shown to vendors)", type: "textarea", required: true },
    ],
  },
  qaqc_approved_bodies: {
    codeLabel: "Body code", nameLabel: "Name",
    fields: [
      { key: "body_type", label: "Type", type: "enum", options: opts("lab", "inspection_agency", "certification_body"), required: true, column: true, filter: true },
      { key: "accreditation", label: "Accreditation", type: "text", column: true },
      { key: "accredited_until", label: "Accredited until", type: "date", column: true },
      { key: "scopes", label: "Scopes", type: "list" },
      { key: "markets", label: "Markets", type: "list" },
    ],
  },
  qaqc_settings: { codeLabel: "Setting", nameLabel: "Description", fields: [{ key: "value", label: "Value", type: "number", required: true, column: true }] },
  // Balanced scorecard (20261027000001). calc/numerator/denominator/value_key/count_key name the scorecard measures the
  // calculation uses (see _sc_bundles); a new measure needs a code change, a new target or wording does not.
  scorecard_kpis: {
    codeLabel: "KPI code", nameLabel: "KPI", groupBy: "perspective",
    note: "Changes go live after a second person approves them. Targets per client or market are in Scorecard targets.",
    fields: [
      { key: "perspective", label: "Perspective", type: "enum", options: opts("plan", "design", "buy", "manage"), required: true, column: true, filter: true },
      { key: "sort", label: "Order", type: "number" },
      { key: "definition", label: "Definition", type: "textarea", required: true, column: true },
      { key: "formula", label: "Formula (plain English)", type: "text" },
      { key: "measurement", label: "How it is measured", type: "textarea" },
      { key: "source", label: "Data source", type: "text" },
      { key: "unit", label: "Unit", type: "enum", options: opts("percent", "days", "eur", "score10", "score100"), required: true, column: true },
      { key: "direction", label: "Better when", type: "enum", options: [{ value: "higher", label: "Higher" }, { value: "lower", label: "Lower" }], required: true, column: true, filter: true },
      { key: "default_target", label: "Default target", type: "number", column: true },
      { key: "measured", label: "Measured", type: "boolean", column: true, filter: true, help: "Off when there is no data source yet: the scorecard shows 'not yet measured'" },
      { key: "calc", label: "Calculation", type: "enum", options: opts("ratio", "value", "none"), required: true },
      { key: "numerator", label: "Numerator measure", type: "text" },
      { key: "denominator", label: "Denominator measure", type: "text" },
      { key: "value_key", label: "Value measure", type: "text" },
      { key: "count_key", label: "Count measure", type: "text" },
      { key: "threshold_days", label: "Threshold (days)", type: "number" },
      { key: "threshold_eur", label: "Threshold (EUR)", type: "number" },
    ],
  },
  scorecard_targets: {
    codeLabel: "Target code", nameLabel: "Description",
    note: "Client + market beats client, client beats market, market beats the KPI default. Effective-dated; a second person approves.",
    fields: [
      { key: "kpi_code", label: "KPI code", type: "text", required: true, column: true },
      { key: "client_id", label: "Client (id)", type: "text", column: true, help: "Leave blank for a market-wide target" },
      { key: "client_code", label: "Client code", type: "text", help: "Alternative to the client id" },
      { key: "market", label: "Market (code)", type: "text", column: true, help: "Leave blank for a client-wide target" },
      { key: "target", label: "Target", type: "number", required: true, column: true },
    ],
  },
  reporting_fx_rates: {
    codeLabel: "Currency", nameLabel: "Name",
    fields: [{ key: "eur_per_unit", label: "EUR per unit", type: "number", required: true, column: true }],
  },
  client_brands: {
    codeLabel: "Brand code", nameLabel: "Brand",
    fields: [
      { key: "client_id", label: "Client (id)", type: "text", column: true },
      { key: "client_code", label: "Client code", type: "text" },
      { key: "business_unit", label: "Business unit", type: "text", column: true, filter: false },
      { key: "power_brand", label: "Power brand", type: "boolean", column: true, filter: true },
    ],
  },
  // Vendor technical & packaging data sheet (20261029000001): SRM owns both libraries (maker-checker).
  packaging_materials: {
    codeLabel: "Material code", nameLabel: "Material", groupBy: "material_group",
    fields: [
      { key: "material_group", label: "Material group", type: "enum", options: opts("paper", "plastic", "wood", "metal", "glass", "textile", "composite", "other"), required: true, column: true, filter: true },
      { key: "epr_category", label: "Packaging reporting (EPR) category", type: "text", column: true },
      { key: "default_recycled_pct", label: "Typical recycled content", type: "number", unit: "%", column: true },
      { key: "recyclable", label: "Recyclable", type: "boolean", column: true, filter: true },
      { key: "reusable_by_default", label: "Usually reusable", type: "boolean" },
      { key: "emission_factor_code", label: "Emission factor (code)", type: "text", help: "From the material emission factors library" },
      { key: "recycled_factor_code", label: "Recycled emission factor (code)", type: "text" },
    ],
  },
  tech_sheet_requirements: {
    codeLabel: "Rule code", nameLabel: "Rule", groupBy: "stage",
    note: "Every matching rule adds its fields; a field required at quote is also required at PO acceptance and pre-shipment. Empty conditions match everything. Field codes: product_dims, net_weight, materials, materials_weight, materials_recycled, finishes, components, electrical, origin_country, hs_code, packing_method, primary_pack, primary_materials, primary_material_weights, primary_recycled, units_per_carton, carton_dims, carton_gross_weight, carton_materials, carton_material_weights, carton_recycled, carton_marking, protective_fill, pallet, pallet_config, pallet_gross_weight, max_stack, pallet_materials, pallet_material_weights, pallet_recycled, reusable_packaging.",
    fields: [
      { key: "stage", label: "Required from stage", type: "enum", options: opts("quote", "po_acceptance", "pre_shipment"), required: true, column: true, filter: true },
      { key: "fields", label: "Fields", type: "list", required: true, column: true, help: "One field code per line" },
      { key: "min_level", label: "From QA/QC level", type: "number", column: true, help: "1 to 5; blank for every level" },
      { key: "spec_types", label: "Spec types", type: "list", column: true, help: "2d, 3d, promo_merch, custom_goods_services, design; blank for all" },
      { key: "categories", label: "Categories (text contained)", type: "list" },
      { key: "markets", label: "Destination markets", type: "list", column: true, help: "Market codes, e.g. DE, FR, GB; blank for all" },
      { key: "electronics", label: "Only items with lighting or electronics", type: "boolean", filter: true },
      { key: "explanation", label: "Explanation (shown to vendors)", type: "textarea", required: true },
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

// Impact Grade (PEF) libraries (migration 20261105000001; seeded from the Anthesis workbook by
// scripts/impact-grade/build-seed.mjs). The engine (src/lib/pef.ts) reads these fields by name.
const ACT = (extra: LibraryField[] = []): LibraryField[] => [
  { key: "ecoinvent_activity", label: "ecoinvent activity", type: "text", column: true },
  { key: "ecoinvent_reference_product", label: "Reference product", type: "text" },
  ...extra,
  { key: "reference_amount", label: "Amount per reference unit", type: "number" },
  { key: "reference_unit", label: "Unit", type: "text", column: true },
  { key: "seq", label: "Workbook row (lookup order)", type: "number", help: "When two rows match, the lower one wins, as in the workbook" },
];
const CAT_CODES = ["AE", "GWP", "CTUe", "Adpf", "Epf", "Epm", "Ept", "Ctuh-c", "Ctuh-nc", "IR", "LU", "ADPe", "ODP", "PM", "POCP", "WU"];
Object.assign(LIBRARY_SCHEMAS, {
  pef_impact_categories: {
    codeLabel: "Category code", nameLabel: "Impact category",
    note: "EF 3.1. Single score = Σ (impact ÷ normalisation factor × weighting factor). Weighting factors must add up to 100%.",
    fields: [
      { key: "normalisation_factor", label: "Normalisation factor", type: "number", required: true, column: true },
      { key: "weighting_factor", label: "Weighting factor", type: "number", required: true, column: true, help: "As a fraction, e.g. 0.2106 = 21.06%" },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "indicator", label: "Indicator", type: "text" },
      { key: "ecoinvent_category", label: "ecoinvent category", type: "text" },
      { key: "method", label: "Method", type: "text" },
      { key: "sort", label: "Order", type: "number" },
    ],
  },
  pef_grade_bands: {
    codeLabel: "Letter", nameLabel: "Band",
    note: "Letters for the Impact Grade score (0-100): the highest band whose minimum score it reaches. The Impact Grade comes from the Impact Grade sub-scores (PEF score = half). Provisional until every band is confirmed.",
    fields: [
      { key: "letter", label: "Letter", type: "text", required: true, column: true },
      { key: "min_score", label: "From score", type: "number", required: true, column: true, help: "0 to 100" },
      { key: "label", label: "Label", type: "text", column: true },
      { key: "confirmed", label: "Confirmed", type: "boolean", column: true, filter: true },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  pef_parameters: {
    codeLabel: "Parameter", nameLabel: "What it controls",
    fields: [
      { key: "value", label: "Value", type: "number", column: true },
      { key: "text_value", label: "Text value", type: "text", column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "stage", label: "Stage", type: "text", column: true },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  pef_methodology: {
    codeLabel: "Rule code", nameLabel: "Topic", groupBy: "stage",
    fields: [
      { key: "stage", label: "Stage", type: "enum", options: opts("General", "Material Acquisition & Preprocessing", "Manufacturing", "Usage", "Distribution", "End of Life"), required: true, column: true, filter: true },
      { key: "rule", label: "Rule", type: "textarea", required: true, column: true },
      { key: "assumption", label: "Assumption", type: "textarea" },
      { key: "source_field", label: "Source / field", type: "text" },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  pef_open_issues: {
    codeLabel: "Issue ID", nameLabel: "Issue",
    fields: [
      { key: "severity", label: "Severity", type: "enum", options: opts("high", "medium", "low"), required: true, column: true, filter: true },
      { key: "status", label: "Status", type: "enum", options: opts("open", "decided", "resolved"), required: true, column: true, filter: true },
      { key: "location", label: "Where", type: "text", column: true },
      { key: "evidence", label: "Evidence", type: "textarea" },
      { key: "recommendation", label: "Recommendation", type: "textarea" },
      { key: "current_treatment", label: "How the model treats it today", type: "textarea" },
      { key: "decision", label: "Decision", type: "textarea" },
    ],
  },
  pef_virgin_materials: {
    codeLabel: "Activity", nameLabel: "Substrate (Sourcing Hub name)",
    fields: [
      { key: "substrate_name", label: "Substrate name", type: "text", required: true },
      { key: "substrate_type", label: "Type", type: "text", column: true, filter: false },
      { key: "custom_factor", label: "Custom factor", type: "text", column: true },
      { key: "manufacturing_process", label: "Forming process", type: "text", column: true },
      { key: "raw_material", label: "Raw material (activity)", type: "text" },
      { key: "includes_forming", label: "Includes forming", type: "boolean" },
      { key: "includes_processing", label: "Includes processing", type: "boolean" },
      ...ACT(),
    ],
  },
  pef_recycled_materials: {
    codeLabel: "Activity", nameLabel: "Substrate (Sourcing Hub name)",
    fields: [
      { key: "substrate_name", label: "Substrate name", type: "text", required: true },
      { key: "can_include_recycled", label: "Recycled content allowed", type: "boolean", column: true, filter: true },
      { key: "default_recycled_percent", label: "Default recycled content", type: "number", unit: "%", column: true },
      { key: "custom_factor", label: "Custom factor", type: "text", column: true },
      { key: "raw_material", label: "Raw material (activity)", type: "text" },
      ...ACT(),
    ],
  },
  pef_coatings: {
    codeLabel: "Coating", nameLabel: "Coating label",
    note: "A coating on a spec matches the first label contained in its text. Kg coatings use the coating weight; m2 coatings the coated area.",
    fields: [{ key: "coating_label", label: "Label to match", type: "text", required: true }, { key: "custom_factor", label: "Custom factor", type: "text", column: true },
      { key: "conversion_to_weight", label: "Weight per unit", type: "number" }, ...ACT()],
  },
  pef_custom_factors: {
    codeLabel: "Row", nameLabel: "Custom factor", groupBy: "custom_factor",
    note: "A custom factor is the sum of all its rows: amount per kg × the ecoinvent activity.",
    fields: [
      { key: "custom_factor", label: "Custom factor", type: "text", required: true, column: true },
      { key: "ecoinvent_activity", label: "ecoinvent activity", type: "text", required: true, column: true },
      { key: "ecoinvent_reference_product", label: "Reference product", type: "text", required: true },
      { key: "amount_per_kg", label: "Amount per kg", type: "number", required: true, column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "seq", label: "Workbook row", type: "number" },
    ],
  },
  pef_process_energy: {
    codeLabel: "Activity", nameLabel: "Process",
    fields: [
      { key: "manufacturing_type", label: "Type", type: "text", column: true },
      { key: "electricity_kwh", label: "Electricity", type: "number", unit: "kWh", column: true },
      { key: "natural_gas_mj", label: "Natural gas", type: "number", unit: "MJ", column: true },
      { key: "other_heat_mj", label: "Other heat", type: "number", unit: "MJ", column: true },
      { key: "steam_kg", label: "Steam", type: "number", unit: "kg", column: true },
      { key: "reference_unit", label: "Per", type: "text", column: true },
      { key: "data_source", label: "Source", type: "text" },
    ],
  },
  pef_process_labels: {
    codeLabel: "Key", nameLabel: "Sourcing Hub label",
    fields: [
      { key: "kind", label: "Kind", type: "enum", options: opts("printing", "branding"), required: true, column: true, filter: true },
      { key: "sourcing_hub_label", label: "Sourcing Hub label", type: "text", required: true },
      { key: "activity", label: "Process energy activity", type: "text", required: true, column: true },
    ],
  },
  pef_energy_activities: {
    codeLabel: "Carrier|country", nameLabel: "Country · carrier",
    fields: [
      { key: "carrier", label: "Carrier", type: "enum", options: ["ELECTRICITY_kWh", "RENEWABLE_ELECTRICITY_kWh", "NATURAL_GAS_MJ", "HEAT_OTHER_THAN_NATURAL_GAS_MJ", "STEAM_KG"].map((v) => ({ value: v, label: v })), required: true, column: true, filter: true },
      { key: "country_code", label: "Country", type: "text", required: true, column: true },
      { key: "ecoinvent_geography", label: "ecoinvent geography", type: "text", column: true },
      ...ACT(),
    ],
  },
  pef_process_efficiency: {
    codeLabel: "Process", nameLabel: "Process",
    fields: [{ key: "efficiency", label: "Efficiency", type: "number", column: true, help: "Blank = already in the factor" }, { key: "efficiency_key", label: "Efficiency type", type: "text", column: true }, { key: "notes", label: "Notes", type: "textarea" }],
  },
  pef_transport_activities: {
    codeLabel: "Key", nameLabel: "Country · activity",
    fields: [
      { key: "mode", label: "Mode", type: "enum", options: opts("Road", "Sea", "Plane"), required: true, column: true, filter: true },
      { key: "country", label: "Country", type: "text", required: true, column: true },
      { key: "country_code", label: "Code", type: "text" },
      { key: "road_weight", label: "Truck class", type: "text", column: true },
      { key: "plane_range", label: "Flight range", type: "text", column: true },
      { key: "ecoinvent_geography", label: "ecoinvent geography", type: "text" },
      ...ACT(),
    ],
  },
  pef_countries: {
    codeLabel: "Country code", nameLabel: "Country",
    note: "Sea distances (km between main ports) and the default mode to each destination are held per origin country.",
    fields: [{ key: "region", label: "Region", type: "text", column: true }, { key: "busiest_port", label: "Main port", type: "text", column: true },
      { key: "road_feeder_km", label: "Road to/from port", type: "number", unit: "km", column: true }],
  },
  pef_use_electricity: {
    codeLabel: "Country code", nameLabel: "Country",
    fields: [{ key: "ecoinvent_geography", label: "ecoinvent geography", type: "text", column: true }, { key: "market_group", label: "Regional market group", type: "boolean", column: true, filter: true }, ...ACT()],
  },
  pef_usage_periods: {
    codeLabel: "Activation period", nameLabel: "Activation period",
    fields: [{ key: "hours", label: "Total hours", type: "number", required: true, column: true }, { key: "usage_score", label: "Usage score", type: "number", column: true }, { key: "seq", label: "Order", type: "number" }],
  },
  pef_eol_materials: {
    codeLabel: "Substrate", nameLabel: "Substrate",
    fields: [
      { key: "eol_category", label: "Category", type: "text", column: true },
      { key: "eol_classification", label: "Classification", type: "text", required: true, column: true },
      { key: "technically_recyclable", label: "Technically recyclable", type: "boolean", column: true, filter: true },
      { key: "substrate_name", label: "Substrate name", type: "text", required: true },
      { key: "substrate_type", label: "Type", type: "text" },
    ],
  },
  pef_eol_fate: {
    codeLabel: "Classification|country", nameLabel: "Country · classification",
    note: "Recycling carries no impact or credit (cut-off). A product that cannot be recycled has incineration and landfill re-scaled to 100%.",
    fields: [
      { key: "eol_classification", label: "Classification", type: "text", required: true, column: true },
      { key: "country_code", label: "Country", type: "text", required: true, column: true },
      { key: "recycling_rate", label: "Recycling", type: "number", column: true },
      { key: "incineration_rate", label: "Incineration", type: "number", column: true },
      { key: "landfill_rate", label: "Landfill", type: "number", column: true },
    ],
  },
  pef_eol_treatment: {
    codeLabel: "Activity", nameLabel: "Substrate | destination",
    fields: [
      { key: "substrate_name", label: "Substrate", type: "text", required: true, column: true },
      { key: "destination", label: "Destination", type: "enum", options: opts("Incineration", "Landfill", "Recycling"), required: true, column: true, filter: true },
      ...ACT([{ key: "defra_factor", label: "DEFRA factor (GHG inventory)", type: "text" }]),
    ],
  },
  pef_ecoinvent: {
    codeLabel: "Activity|product|geography", nameLabel: "Activity",
    note: "ecoinvent 3.12 cut-off results per reference unit for all 16 EF 3.1 categories. Only the activities the mapping tables use are loaded in the demo; import the full licensed set per environment as CSV (code = activity|reference product|geography).",
    fields: [
      { key: "activity", label: "Activity", type: "text", required: true },
      { key: "geography", label: "Geography", type: "text", required: true, column: true },
      { key: "reference_product", label: "Reference product", type: "text", required: true, column: true },
      { key: "unit", label: "Unit", type: "text", column: true },
      { key: "reference_amount", label: "Reference amount", type: "number", required: true },
      ...CAT_CODES.map((c): LibraryField => ({ key: c, label: c === "GWP" ? "Climate change (kg CO2e)" : c, type: "number", required: true, column: c === "GWP" })),
      { key: "dataset", label: "Dataset", type: "text" },
      { key: "uuid", label: "ecoinvent UUID", type: "text" },
      { key: "seq", label: "Dataset row (lookup order)", type: "number" },
    ],
  },
  pef_worked_examples: {
    codeLabel: "Example", nameLabel: "Components",
    note: "Inputs and the results Excel gives are held with each example; the Watchtower overview recalculates them.",
    fields: [{ key: "description", label: "Description", type: "text", column: true }, { key: "seq", label: "Order", type: "number" }],
  },
} satisfies Record<string, LibrarySchema>);

// Impact Grade formula (migration 20261105000005; seeded by scripts/impact-grade/build-grade-seed.mjs from Impact Grade.xlsx).
Object.assign(LIBRARY_SCHEMAS, {
  ig_subscores: {
    codeLabel: "Sub-score", nameLabel: "Sub-score", groupBy: "category",
    note: "Impact Grade = Σ weight × sub-score ÷ Σ weight (sub-scores with data). Standard and Promo weights each add up to 100; a blank Promo weight means it does not apply to Promo.",
    fields: [
      { key: "category", label: "Category", type: "text", required: true, column: true },
      { key: "weight_standard", label: "Weight", type: "number", required: true, column: true },
      { key: "weight_promo", label: "Promo weight", type: "number", column: true, help: "Blank = not applicable to Promo" },
      { key: "rule", label: "How it is scored", type: "textarea", required: true, column: true },
      { key: "status", label: "Status", type: "enum", options: opts("live", "work_in_progress"), column: true, filter: true },
      { key: "espr_aligned", label: "ESPR aligned", type: "boolean" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "data_inputs", label: "Data inputs", type: "list" },
      { key: "workbook_notes", label: "Workbook notes", type: "textarea" },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  ig_impact_levels: { codeLabel: "Level", nameLabel: "Impact", fields: [{ key: "level", label: "Level", type: "number", required: true, column: true }, { key: "score", label: "Score", type: "number", required: true, column: true }] },
  ig_option_scores: {
    codeLabel: "Kind|option", nameLabel: "Option", groupBy: "kind",
    fields: [
      { key: "kind", label: "Kind", type: "enum", options: opts("ink", "varnish", "finishing", "finish_type_2d", "accreditation", "activation_period", "electronics"), required: true, column: true, filter: true },
      { key: "level", label: "Impact level", type: "number", required: true, column: true, help: "0 no impact to 5 very high" },
      { key: "applies_to", label: "Applies to", type: "text", column: true },
      { key: "min_days", label: "Shortest life (days)", type: "number", column: true },
      { key: "material_group", label: "Material group", type: "text" },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  ig_substrates: {
    codeLabel: "Substrate", nameLabel: "Substrate", groupBy: "category",
    fields: [
      { key: "category", label: "Category", type: "text", column: true },
      { key: "plastic", label: "Plastic", type: "boolean", column: true, filter: true },
      { key: "harmful", label: "Harmful", type: "boolean", column: true, filter: true },
      { key: "plastic_type", label: "Plastic type", type: "text", column: true },
      { key: "resin_code", label: "Resin code", type: "text" },
      { key: "harmful_note", label: "Harmful note", type: "text" },
    ],
  },
  ig_parameters: {
    codeLabel: "Parameter", nameLabel: "What it controls",
    fields: [{ key: "value", label: "Value", type: "number", column: true }, { key: "text_value", label: "Text value", type: "text", column: true }, { key: "unit", label: "Unit", type: "text", column: true }, { key: "note", label: "Note", type: "textarea", column: true }],
  },
  ig_open_items: {
    codeLabel: "Item", nameLabel: "Item",
    fields: [{ key: "status", label: "Status", type: "enum", options: opts("open", "decided", "resolved"), required: true, column: true, filter: true }, { key: "why", label: "Why it matters", type: "textarea", column: true }, { key: "next_step", label: "Next step", type: "textarea" }, { key: "decision", label: "Decision", type: "textarea" }],
  },
} satisfies Record<string, LibrarySchema>);

// Shopper IQ design effectiveness (migration 20261105000003; seeded by scripts/shopper-iq/build-seed.mjs).
// src/lib/design-effectiveness.ts reads these fields by name.
Object.assign(LIBRARY_SCHEMAS, {
  siq_de_criteria: {
    codeLabel: "Criterion ID", nameLabel: "Criterion", groupBy: "pillar",
    note: "Points = weight × answer value. S11 is scored from the Impact Grade (0-100 ÷ 100), not from an answer. Weights are not yet calibrated (open item DE-02).",
    fields: [
      { key: "block", label: "Block", type: "enum", options: opts("design", "sustainability"), required: true, column: true, filter: true },
      { key: "pillar", label: "Pillar", type: "enum", options: opts("attract", "engage", "sell", "sustainability"), required: true, column: true, filter: true },
      { key: "weight", label: "Weight", type: "number", required: true, column: true, help: "0 to 100" },
      { key: "weight_basis", label: "Weight basis", type: "text", column: true },
      { key: "applies_key_visual", label: "Key Visual", type: "boolean", column: true, filter: true },
      { key: "applies_posm", label: "POSM", type: "boolean", column: true, filter: true },
      { key: "applies_gwp", label: "GWP & Premiums", type: "boolean", column: true, filter: true },
      { key: "input", label: "Scored from", type: "enum", options: [{ value: "answer", label: "Answer" }, { value: "impact_grade", label: "Impact Grade (0-100)" }], required: true },
      { key: "what_assessed", label: "What is assessed", type: "textarea" },
      { key: "high_score", label: "What a high score looks like", type: "textarea" },
      { key: "calibrated", label: "Weight calibrated", type: "boolean", filter: true },
      { key: "source", label: "Source", type: "text" },
      { key: "legacy_reference", label: "Legacy reference", type: "text" },
      { key: "note", label: "Note", type: "textarea" },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  siq_de_parameters: {
    codeLabel: "Parameter", nameLabel: "What it controls",
    fields: [{ key: "value", label: "Value", type: "number", required: true, column: true }, { key: "note", label: "Note", type: "textarea", column: true }, { key: "seq", label: "Order", type: "number" }],
  },
  siq_de_answers: {
    codeLabel: "Answer", nameLabel: "Answer",
    fields: [{ key: "value", label: "Value", type: "number", column: true, help: "Blank when the answer leaves the denominator" },
      { key: "counts", label: "Counts in the denominator", type: "boolean", column: true }, { key: "rule", label: "Rule", type: "textarea", column: true }, { key: "seq", label: "Order", type: "number" }],
  },
  siq_de_bands: {
    codeLabel: "Band code", nameLabel: "Band",
    fields: [{ key: "min_score", label: "From", type: "number", required: true, column: true, help: "0 to 1" }, { key: "confirmed", label: "Confirmed", type: "boolean", column: true, filter: true }, { key: "seq", label: "Order", type: "number" }],
  },
  siq_de_asset_types: { codeLabel: "Code", nameLabel: "Asset type", fields: [{ key: "seq", label: "Order", type: "number", column: true }] },
  siq_de_open_items: {
    codeLabel: "Item", nameLabel: "Item",
    fields: [
      { key: "status", label: "Status", type: "text", required: true, column: true },
      { key: "why", label: "Why it matters", type: "textarea", column: true },
      { key: "proposed_default", label: "Proposed default", type: "textarea" },
      { key: "owner", label: "Owner", type: "text", column: true },
      { key: "decision", label: "Decision", type: "textarea" },
      { key: "seq", label: "Order", type: "number" },
    ],
  },
  siq_de_examples: {
    codeLabel: "Example", nameLabel: "Asset",
    note: "Answers and the results Excel gives are held with each example; the Shopper IQ Watchtower recalculates them.",
    fields: [{ key: "description", label: "Description", type: "text", column: true }, { key: "seq", label: "Order", type: "number" }],
  },
} satisfies Record<string, LibrarySchema>);

// HS code rules: an HS code for a combination of product, sub-product and material. Migration 20261106000045.
LIBRARY_SCHEMAS.hs_code_rules = {
  codeLabel: "Rule code", nameLabel: "Rule",
  note: "Attach an HS code to a combination of product, sub-product and the material used in the spec. The most specific active rule that fits the spec is suggested: product type, then subcategory, category, form type; a rule with a material beats the same rule without one. Leave a scope blank for any. A spec's own HS code is never overwritten, and a product type's default HS code is the fallback.",
  fields: [
    { key: "hs_code", label: "HS code", type: "text", required: true, column: true, help: "4 to 10 digits, e.g. 3919.90" },
    { key: "scope_form_type", label: "Form type", type: "enum", column: true, filter: true,
      options: ["Print", "Packaging", "POS & Display", "Creative & Design", "Logistics", "Merchandise", "Digital", "Custom Goods & Services", "2D/3D", "Stocktool only"].map((v) => ({ value: v, label: v })) },
    { key: "scope_category_code", label: "Product (category code)", type: "text", column: true, help: "Taxonomy category code, e.g. LGF. Set the form type too." },
    { key: "scope_subcategory_code", label: "Sub-product (subcategory code)", type: "text", column: true, help: "e.g. BANNER. Set the category too." },
    { key: "scope_product_type_code", label: "Product type code", type: "text", help: "e.g. VINYL. Set the subcategory too." },
    { key: "material_type", label: "Material type", type: "enum", column: true, filter: true, options: SUBSTRATE_TYPES, help: "Matches when the spec uses a material of this type" },
    { key: "material_code", label: "Specific material (substrate code)", type: "text", help: "Optional: a single substrate from the Substrates library" },
    { key: "priority", label: "Priority", type: "number", help: "Lower wins when two rules are equally specific (default 100)" },
    { key: "note", label: "Note", type: "textarea" },
  ],
};

// AAC classification rules (master Watchtower → Product taxonomy → AAC rules). Scope codes come from the product
// taxonomy; blank criteria fall back to the Sourcing settings. Migration 20261032000002.
LIBRARY_SCHEMAS.aac_classification_rules = {
  codeLabel: "Rule code", nameLabel: "Rule", groupBy: "route",
  note: "For each route the most specific active rule in scope applies: product type, then subcategory, category, form type, then the default (no scope); client and market scope break ties, then the lowest priority number. Blank criteria use the Sourcing settings. A purchasing-blocked supplier always sends the line to an RFQ.",
  fields: [
    { key: "route", label: "Route", type: "enum", options: opts("adopt", "adapt", "push", "create"), required: true, column: true, filter: true },
    { key: "definition", label: "What it means", type: "textarea", required: true },
    { key: "scope_form_type", label: "Scope: form type", type: "enum", column: true, filter: true,
      options: ["Print", "Packaging", "POS & Display", "Creative & Design", "Logistics", "Merchandise", "Digital", "Custom Goods & Services", "2D/3D", "Stocktool only"].map((v) => ({ value: v, label: v })) },
    { key: "scope_category_code", label: "Scope: category code", type: "text", column: true, help: "Taxonomy category code, e.g. COUNTER. Set the form type too." },
    { key: "scope_subcategory_code", label: "Scope: subcategory code", type: "text", column: true, help: "e.g. SHELF. Set the category too." },
    { key: "scope_product_type_code", label: "Scope: product type code", type: "text", column: true, help: "e.g. WOBBLER. Set the subcategory too." },
    { key: "scope_client_code", label: "Scope: client code", type: "text", help: "Sourcing client code; blank for every client" },
    { key: "scope_market", label: "Scope: market", type: "text", help: "Market code or name; blank for every market" },
    { key: "priority", label: "Priority", type: "number", column: true, help: "Lower wins when two rules have the same scope (default 100)" },
    { key: "exact_match_percent", label: "Adopt: exact-match margin", type: "number", unit: "%", help: "Size difference still counted as the card item (default 0.5)" },
    { key: "allow_quantity_outside_range", label: "Adopt: allow quantity outside the card range", type: "boolean" },
    { key: "tolerance_percent", label: "Adapt: tolerance band", type: "number", unit: "%", help: "Blank = Sourcing settings" },
    { key: "max_value", label: "Adapt / Push: value limit", type: "number", help: "Line value above this goes to an RFQ. Blank = Sourcing settings instant-price limit" },
    { key: "min_confidence", label: "Push: minimum price confidence", type: "number", help: "0 to 1. Blank = Sourcing settings push threshold" },
    { key: "min_supplier_score", label: "Minimum supplier quality score", type: "number", help: "Latest SRM composite score the card supplier needs for this route (blank = no floor)" },
    { key: "force_spec_forms", label: "Create: spec forms that always go to an RFQ", type: "list", help: "ideation, open or fixed; one per line" },
    { key: "force_complexity", label: "Create: complexities that always go to an RFQ", type: "list", help: "low, medium or high; one per line" },
    { key: "note", label: "Note", type: "textarea" },
  ],
};
