// Vendor portal: pure constants and helpers (no I/O), shared by the portal pages, the public application and tests.
import type { Tone } from "@/lib/srt";

export type VendorPermission = "admin" | "standard" | "viewer";
export type ActionResult = { ok?: boolean; message?: string; id?: string };

export type NavLink = { label: string; href: string; icon: string; exact?: boolean };
export const VENDOR_NAV: { label: string; items: NavLink[] }[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/vendor", icon: "space_dashboard", exact: true }] },
  { label: "Work", items: [
    { label: "Quote requests", href: "/vendor/quotes", icon: "request_quote" },
    { label: "Pushed prices", href: "/vendor/pushed-prices", icon: "price_check" },
    { label: "Orders", href: "/vendor/orders", icon: "inventory_2" },
    { label: "Invoices & payments", href: "/vendor/invoices", icon: "receipt_long" },
    { label: "Shipping & POD", href: "/vendor/shipping", icon: "local_shipping" },
    { label: "Installations", href: "/vendor/installations", icon: "construction" },
    { label: "Recces", href: "/vendor/recces", icon: "straighten" },
  ] },
  { label: "Quality & compliance", items: [
    { label: "Certificates & documents", href: "/vendor/compliance", icon: "verified" },
    { label: "Quality & NCRs", href: "/vendor/quality", icon: "fact_check" },
    { label: "Performance & issues", href: "/vendor/performance", icon: "monitoring" },
  ] },
  { label: "Relationship", items: [
    { label: "Contracts", href: "/vendor/contracts", icon: "contract" },
    { label: "Business reviews", href: "/vendor/reviews", icon: "event_note" },
    { label: "Messages", href: "/vendor/messages", icon: "forum" },
  ] },
  { label: "Improve", items: [
    { label: "Action plans", href: "/vendor/action-plans", icon: "checklist" },
    { label: "Surveys", href: "/vendor/surveys", icon: "quiz" },
    { label: "Training", href: "/vendor/training", icon: "school" },
  ] },
  { label: "Account", items: [
    { label: "Company & pre-assessment", href: "/vendor/profile", icon: "storefront" },
    { label: "Team", href: "/vendor/team", icon: "group" },
    { label: "Sites", href: "/vendor/sites", icon: "location_on" },
    { label: "Subscription", href: "/vendor/subscription", icon: "workspace_premium" },
  ] },
];

export const SUBSCRIPTION_TIERS = [
  { key: "silver", name: "Silver", price: "£1,500", colour: "#7C8794", features: ["Performance scorecard access", "Compliance tracker", "Monthly reporting", "Email support"] },
  { key: "gold", name: "Gold", price: "£3,500", colour: "#B7862B", featured: true, features: ["Everything in Silver", "Priority tender access", "Quarterly business review", "Dedicated account manager"] },
  { key: "platinum", name: "Platinum", price: "£6,000", colour: "#6E56CF", features: ["Everything in Gold", "ecoGRADE certification support", "NTI leakage reporting", "Executive sponsor"] },
  { key: "diamond", name: "Diamond", price: "£12,000", colour: "#2A8BC9", features: ["Everything in Platinum", "Strategic co-marketing", "First-look opportunities", "Board-level engagement"] },
] as const;
export const tierName = (k: string | null | undefined) => SUBSCRIPTION_TIERS.find((t) => t.key === k)?.name ?? "No plan";

export const PERMISSION_LABEL: Record<VendorPermission, string> = { admin: "Portal admin", standard: "Standard", viewer: "View only" };
export const PERMISSION_HELP: Record<VendorPermission, string> = {
  admin: "Everything, including the team and the subscription",
  standard: "Quotes, orders, documents and responses",
  viewer: "Can look but not change anything",
};

export const SITE_TYPES = [
  { value: "manufacturing", label: "Manufacturing" },
  { value: "warehouse", label: "Warehouse" },
  { value: "distribution", label: "Distribution centre" },
  { value: "office", label: "Office" },
  { value: "subcontractor", label: "Subcontractor" },
] as const;

export const DOC_TYPES = [
  { value: "quality_certificate", label: "Quality certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "policy", label: "Policy" },
  { value: "nda", label: "NDA" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
] as const;

/** Tone for a certificate's expiry status (the one rule: expired, expiring within 90 days, valid). */
export function expiryTone(s: string | null | undefined): Tone {
  return s === "expired" ? "bad" : s === "expiring_soon" ? "warn" : s === "valid" ? "ok" : "neutral";
}

const TONES: Record<string, Tone> = {
  open: "info", sent: "info", issued: "warn", invited: "info", viewed: "info", draft: "neutral", pending: "warn",
  submitted: "accent", quoted: "accent", accepted: "ok", awarded: "ok", verified: "ok", completed: "ok", signed: "ok", counter_signed: "ok",
  resolved: "ok", closed: "neutral", declined: "bad", rejected: "bad", cancelled: "neutral", expired: "bad", disputed: "bad",
  in_progress: "info", acknowledged: "info", responded: "accent", in_review: "info", under_review: "info", active: "ok", removed: "neutral",
  pass: "ok", conditional_pass: "warn", fail: "bad", critical: "bad", high: "warn", major: "warn", medium: "info", minor: "neutral", low: "neutral",
  planned: "neutral", booked: "info", dispatched: "info", in_transit: "info", delivered: "ok", received: "accent", installed: "accent",
  audited: "ok", needs_review: "warn", passed: "ok", failed: "bad", confirmed: "ok", missing: "warn", not_received: "warn",
  done: "accent", scheduled: "info", assigned: "info", waived: "neutral", none: "neutral",
};
export const statusTone = (s: string | null | undefined): Tone => (s ? TONES[s] ?? "neutral" : "neutral");
export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");

export function money(n: number | null | undefined, currency = "EUR", digits = 2) {
  if (n === null || n === undefined) return "";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

export const daysUntil = (iso: string | null | undefined) =>
  iso ? Math.ceil((new Date(iso.length === 10 ? iso + "T23:59:59" : iso).getTime() - Date.now()) / 86400000) : null;

/** Database messages written for people pass through; anything technical is replaced with a plain fallback. */
export function friendlyError(message: string | undefined, fallback = "That didn't work. Try again, or contact adm Indicia.") {
  if (!message) return fallback;
  if (/violates|permission denied|syntax|column |relation |does not exist|duplicate key|invalid input|null value|PGRST|JWT/i.test(message)) return fallback;
  return message.length > 300 ? fallback : message;
}

export type OrderDocType = { id: string; code: string; name: string; required_for_categories: string[]; uploaded_by: string | null };
export type ChecklistItem = { code: string; name: string; required: boolean; done: boolean };

/** Control documents for a PO: required when the job category is in the document's required_for_categories. */
export function orderChecklist(category: string | null | undefined, types: OrderDocType[], uploadedLabels: string[]): ChecklistItem[] {
  const cat = (category ?? "").toLowerCase();
  const have = new Set(uploadedLabels.map((l) => l.toLowerCase()));
  return types
    .filter((t) => t.uploaded_by !== "internal")
    .map((t) => ({
      code: t.code,
      name: t.name,
      required: !!cat && (t.required_for_categories ?? []).some((c) => String(c).toLowerCase() === cat || (cat === "posm" && String(c).toLowerCase() === "pos")),
      done: have.has(t.name.toLowerCase()),
    }))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Pre-assessment questionnaire (five sections, from the Base44 prototype). Stored flat in vendor_pre_assessments.data.
// ---------------------------------------------------------------------------
export const PA_CATEGORIES = ["Print", "Packaging", "POS", "Digital", "Logistics", "Merchandise", "Creative"] as const;
export const PA_STEPS = ["Supplier details", "Certifications", "Capabilities", "Factory", "Site photos"] as const;

export const CERT_GROUPS: { key: string; title: string; types: string[] }[] = [
  { key: "quality_certs", title: "Quality management & process", types: ["ISO 9001", "IATF 16949", "BRC Packaging (BRCGS)", "G7", "GMI", "GMP", "HACCP", "FSSC 22000", "SQF", "GFSI"] },
  { key: "environmental_certs", title: "Environmental & energy management", types: ["ISO 14001", "ISO 50001", "REACH", "RoHS", "CE", "FSC CoC", "PEFC", "EU FCM 1935/2004", "EU 10/2011 (Plastics)", "EU GMP 2023/2006", "FDA Title 21", "LFGB", "Migration Testing", "NIAS Testing", "MOAH / MOSH", "PFAS Restriction", "Declaration of Conformity"] },
  { key: "health_safety_certs", title: "Health, safety & labour", types: ["ISO 45001", "OHSAS 18001", "SA8000", "Anti-Child Labour Policy", "Anti-Forced Labour Policy"] },
  { key: "esg_certs", title: "ESG & sustainability performance", types: ["Sustainability Framework", "CSRD-aligned Reporting", "EUDR-compliant Supply Chain", "EcoVadis", "ESG", "Sustainability Report", "CDP", "RE100", "SBTi", "Carbon Neutral / Net Zero Declaration"] },
  { key: "ethical_audits", title: "Ethical & social responsibility audits", types: ["SEDEX", "SMETA", "BSCI", "Amfori", "QHSE", "Serious Environmental Issue"] },
  { key: "product_transport_certs", title: "Product & transport testing", types: ["ISTA", "Amazon 6A"] },
];

export const TEST_EQUIPMENT = ["ROHS Tester", "Climate Chamber", "ECT/FCT Tester", "BST", "Compression Machine", "COBB Tester", "Bending Stiffness Test",
  "Punch Tester", "Anti friction Tester", "Whiteness Meter", "Color Density Tester", "Drop Tester", "Vibration Tester"];

export const PHOTO_SLOTS = [
  { key: "front_door", label: "Front door" },
  { key: "show_room", label: "Show room" },
  { key: "incoming_material", label: "Incoming material room" },
  { key: "production_line", label: "Production line" },
  { key: "finished_goods", label: "Finished goods room" },
  { key: "sampling_division", label: "Sampling division" },
];

export type CertRow = { type: string; cert_number: string; audit_date: string };
export type PaData = Record<string, unknown> & {
  supplier_company_name?: string; major_category?: string; head_office_country?: string;
  primary_contact_name?: string; primary_contact_email?: string;
};

const LIMIT = 500;
const clip = (v: unknown, n = LIMIT) => (typeof v === "string" ? v.slice(0, n) : typeof v === "number" ? String(v).slice(0, n) : "");

/** Keep only known questionnaire fields, as short strings / small lists, so the stored JSON is predictable and bounded. */
export function cleanPaData(raw: unknown): PaData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: PaData = {};
  const str = ["supplier_company_name", "major_category", "head_office_address", "head_office_city", "head_office_country", "primary_contact_name",
    "primary_contact_email", "english_speaking", "type_of_ownership", "company_size_m2", "total_employees", "annual_turnover", "calculated_in_year",
    "document_date", "rd_designer_employees", "rd_sample_making_machine", "rd_digital_printer", "rd_other", "quality_employees", "lab_capability",
    "cnas_certificate", "quality_other", "num_factories", "factory_ownership_type", "primary_factory_product", "total_factory_area", "factory_address",
    "factory_city", "factory_country", "factory_contact_name", "factory_contact_email", "factory_english_speaking", "including_dormitory",
    "including_canteen", "total_employees_factory", "employees_management", "employees_engineering", "employees_production",
    "working_time_paper_card", "working_time_ic_card", "working_time_fingerprint", "working_time_manual", "working_time_no_record",
    "wages_cash", "wages_bank_transfer", "wages_other_method", "wages_by_hours", "wages_by_piece", "wages_calc_other"];
  for (const k of str) { const v = clip(r[k]).trim(); if (v) out[k] = v; }
  for (const k of ["clients", "major_products", "design_capabilities", "manufacture_capabilities", "rd_software"]) {
    const v = Array.isArray(r[k]) ? (r[k] as unknown[]).map((x) => clip(x, 200).trim()).filter(Boolean).slice(0, 10) : [];
    if (v.length) out[k] = v;
  }
  for (const g of CERT_GROUPS) {
    const rows = Array.isArray(r[g.key]) ? (r[g.key] as Record<string, unknown>[]) : [];
    const v = rows
      .filter((x) => x && g.types.includes(String(x.type)))
      .map((x) => ({ type: String(x.type), cert_number: clip(x.cert_number, 100).trim(), audit_date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.audit_date)) ? String(x.audit_date) : "" }))
      .filter((x) => x.cert_number || x.audit_date);
    if (v.length) out[g.key] = v;
  }
  const eq = Array.isArray(r.major_test_equipment) ? (r.major_test_equipment as Record<string, unknown>[]) : [];
  const eqv = eq.filter((x) => x && TEST_EQUIPMENT.includes(String(x.name)))
    .map((x) => ({ name: String(x.name), available: ["Yes", "No"].includes(String(x.available)) ? String(x.available) : "", comment: clip(x.comment, 200).trim() }))
    .filter((x) => x.available || x.comment);
  if (eqv.length) out.major_test_equipment = eqv;
  return out;
}

export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
