// Labels shared by the approvals pages (pure, no I/O).

export const MODULE_LABEL: Record<string, string> = {
  watchtower: "Watchtower", briefing: "Briefing+", "shopper-iq": "Shopper IQ", sourcing: "Sourcing", rfq: "Sourcing",
  orders: "Order Management", logistics: "Logistics", execution: "Execution", finance: "Finance+", assure: "SRM", crm: "CRM",
};

export const TYPE_LABEL: Record<string, string> = {
  BRIEF: "Brief", CONCEPT: "Concept", CONCEPT_CLIENT: "Concept (client)", LIBRARY: "Library change", RATE_CARD: "Rate card",
  CR_REVIEW: "Change request review", CR_VERIFY: "Change request check", RFQ_HIGH_VALUE: "High-value RFQ", QUOTE_FINANCE: "Quote (Finance)",
  PUSH_PRICE: "Pushed price (vendor)", ESTIMATE_CLIENT: "Estimate (client)", PO_DOA: "Purchase order (DOA)",
  PSA_LINE_MANAGER: "PSA: line manager", PSA_ASSESS: "PSA: procurement", PSA_APPROVE: "PSA: approver", PSA_APPLY: "PSA: apply",
  ESTIMATE_FINANCE: "Estimate (Finance)", INVOICE_APPROVE: "Supplier invoice", INVOICE_OVERRIDE: "Invoice override",
  POD_VERIFY: "Proof of delivery", DEPLOYMENT_AUDIT: "Deployment audit", QUALITY_GATE: "Quality gate",
  SRT_GATE: "Onboarding gate", SRT_BANK: "Bank details", SRT_ONBOARDING_APPROVAL: "Onboarding approval", VENDOR_RFI: "Vendor information",
  CERTIFICATE: "Certificate", DOCUMENT: "Control document", PRE_ASSESSMENT_VM: "Pre-assessment (vendor manager)",
  PRE_ASSESSMENT_PROCUREMENT: "Pre-assessment (procurement)", REVIEW_OUTCOMES: "Review outcomes", SURVEY_REVIEW: "Survey response",
  WORKFLOW_STEP: "Workflow step", CA_VERIFY: "Corrective action", VENDOR_APPLICATION: "Vendor application", SUBSCRIPTION: "Vendor plan change",
  SCORECARD: "Scorecard methodology", ACCESS_USER: "User access change", ACCESS_SOURCING: "Sourcing access / DOA change", CLIENT_ACCESS: "Client approver rights",
  RFQ_AWARD: "RFQ award", RFQ_BYPASS: "Bypass award", RATE_CARD_EXCEPTION: "Rate-card exception", TRIAGE_OVERRIDE: "Triage override",
  SOURCING_SETTINGS: "Sourcing settings", ESTIMATE_CONFIRM: "Client approval confirmation", PO_ETENDER: "PO e-tender approval",
  PAYMENT_RELEASE: "Payment release", BILL_CANCEL: "Cancel sent bill", DELIVERY_CONFIRM: "Delivery without POD", JOB_CLOSE: "Job close with overrides",
  RECCE_READY: "Production-ready recce", FAST_TRACK: "Fast-track onboarding", SUPPLIER_REACTIVATE: "Supplier reactivation",
  CONTRACT_APPROVE: "Contract approval", INSPECTION_CHANGE: "Inspection result change", NCR_CLOSE: "NCR close", ISSUE_RESOLVE: "Issue resolution",
  PAYMENT_TERMS: "Non-standard payment terms", SIQ_EFFECTIVENESS: "Result verification", SIQ_ASSET: "Asset rights sign-off",
  CRM_CLIENT_SETUP: "New client set-up", CRM_TERMS: "Client commercial terms", CRM_CONTRACT: "Client contract", CRM_OPP_WON: "Opportunity won", CRM_SEND: "CRM email or survey send",
};

export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
export const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m;

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", internal: "Anyone at adm Indicia", named_person: "The named person", srt_agent: "SRT agent or lead", srt_lead: "SRT lead",
  finance: "Finance", procurement: "Procurement", procurement_head: "Procurement head", sourcing_lead: "Sourcing lead",
  doa: "Delegated authority (DOA)", module_owner: "Module owner", briefing_lead: "Briefing lead", client_approver: "Client approver", vendor: "Vendor",
  quality: "Quality role", logistics_lead: "Logistics lead", line_manager: "Line manager",
};

export function money(v: number | null | undefined, currency: string | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency ?? ""} ${Math.round(v).toLocaleString("en-GB")}`.trim();
  }
}

export const ageText = (days: number | null | undefined) =>
  days == null ? "" : days < 1 ? "today" : days < 2 ? "1 day" : `${Math.floor(days)} days`;
