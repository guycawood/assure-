// Labels shared by the approvals pages (pure, no I/O).

export const MODULE_LABEL: Record<string, string> = {
  watchtower: "Watchtower", briefing: "Briefing+", "shopper-iq": "Shopper IQ", sourcing: "Sourcing+", rfq: "RFQ+",
  orders: "Order Management+", logistics: "Logistics+", execution: "Execution+", finance: "Finance+", assure: "Assure+",
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
};

export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
export const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m;

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", internal: "Anyone at adm Indicia", named_person: "The named person", srt_agent: "SRT agent or lead", srt_lead: "SRT lead",
  finance: "Finance", procurement: "Procurement", procurement_head: "Procurement head", sourcing_lead: "Sourcing lead",
  doa: "Delegated authority (DOA)", module_owner: "Module owner", briefing_lead: "Briefing lead", client_approver: "Client approver", vendor: "Vendor",
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
