export type ModuleKey = "watchtower" | "crm" | "briefing" | "shopper-iq" | "rfq" | "sourcing" | "orders" | "logistics" | "execution" | "finance" | "assure";

export type ModuleDef = {
  key: ModuleKey;
  name: string;
  tagline: string;
  /** Google Material Symbols name (brand iconography). */
  icon: string;
  /** Brand service colour (adm Indicia guidelines, July 2025). */
  colour: string;
  basePath: string;
  status: "live" | "planned";
  phase: string;
  /** What the module covers, in plain words. */
  scope: string[];
  /** Where it sits in the brief-to-install flow. */
  flow: string;
  /** Set when this area is part of another section (no tab of its own; its pages live under that section). */
  partOf?: ModuleKey;
};

// System Guy architecture (Guy's diagram, 9 Oct): master Watchtower over a Watchtower per module; modules in a row;
// Data Management, Supplier Engagement and Sustainability run as horizontal layers under every module (see LAYERS).
const ALL: ModuleDef[] = [
  {
    key: "watchtower",
    name: "Watchtower",
    tagline: "One view of the whole system",
    icon: "cell_tower",
    colour: "#9DC5ED",
    basePath: "/watchtower",
    status: "live",
    phase: "Phase 0",
    scope: [
      "Health of every module in one place, by region and market",
      "Change requests, audit trail and core principles across all modules",
      "Shared libraries: taxonomy, geography, currency, emission factors, DOA matrix",
    ],
    flow: "Sits over every module. Each module has its own Watchtower that rolls up here.",
  },
  {
    key: "crm",
    name: "CRM",
    tagline: "Client relationship management",
    icon: "contacts",
    colour: "#F28C38",
    basePath: "/crm",
    status: "live",
    phase: "Live",
    // The client-side mirror of SRM, in two halves: internal client management (this tab) and the external
    // Client Portal (/client-portal), where clients approve, follow their work, see bills and give feedback.
    scope: [
      "Internal: clients, accounts per market, contacts, pipeline, account plans, contracts, commercial terms and client health",
      "External Client Portal: campaigns and briefs, concept and estimate approvals, orders, bills and reports",
      "External Client Portal: their account team, feedback and surveys, and the client's own users",
    ],
    flow: "Start of the flow and under every section: wins the work, sets the commercial terms Sourcing, Order Management and Finance+ apply, and hears back from the client through the Client Portal.",
  },
  {
    key: "briefing",
    name: "Briefing+",
    tagline: "Campaigns and creative briefs",
    icon: "lightbulb",
    colour: "#B776BC",
    basePath: "/briefing",
    status: "live",
    phase: "Live",
    scope: [
      "Campaigns set up centrally, briefs per market",
      "Sustainability targets captured on the brief",
      "Brief completeness scoring and AI ideation with approved materials",
    ],
    flow: "Start of the flow. Approved briefs become specs in Sourcing.",
  },
  {
    key: "sourcing",
    name: "Sourcing",
    tagline: "Specs, triage, RFQs and award",
    icon: "request_quote",
    colour: "#4896F7",
    basePath: "/sourcing",
    status: "live",
    phase: "Live",
    scope: [
      "Jobs and specs with CO2e and Impact Grade",
      "Triage on every line: Adopt, Adapt, Create or Push before any RFQ",
      "RFQs to the SRM eligible pool, sealed vendor quotes, evaluation, finance approval and award",
    ],
    flow: "After the brief. Calls SRM for vendor eligibility and award checks; hands awarded prices to Order Management.",
  },
  {
    key: "finance",
    name: "Finance+",
    tagline: "Quote approvals, billing and payments",
    icon: "account_balance",
    colour: "#97DBD9",
    basePath: "/finance",
    status: "live",
    phase: "Live",
    scope: [
      "Finance approval of quotes and estimates before award",
      "Supplier invoices matched to POs and deliveries; client billing",
      "Payment schedules, terms and spend reporting by region and market",
    ],
    flow: "A layer under every section, like Sustainability and Supplier Engagement: checks new clients, approves quotes and estimates, holds POs to delegated authority, and closes the loop with invoices, payments and billing once delivery and installation are proven.",
  },  {
    key: "assure",
    name: "SRM",
    tagline: "Supplier relationship management",
    icon: "verified_user",
    colour: "#6A2DD3",
    basePath: "/assure",
    status: "live",
    phase: "Live",
    // Two halves: internal supply chain management (this tab) and the external vendor portal (/vendor),
    // where suppliers subscribe, quote, update production, submit QA/QC and upload invoices and control documents.
    scope: [
      "Internal: SRT desk, supplier register, compliance and purchasing blocks, scorecard and PSL",
      "External vendor portal: onboarding and subscription, RFQs and pricing, production updates",
      "External vendor portal: QA/QC submissions, invoices and control documents for every job",
    ],
    flow: "Manages the supply base: who can be invited to quote, awarded and paid. Vendors engage with System Guy at set points in the journey through the vendor portal.",
  },
  {
    key: "rfq",
    partOf: "sourcing",
    name: "RFQs",
    tagline: "Requests for quotation, sealed quotes and award",
    icon: "request_quote",
    colour: "#4896F7",
    basePath: "/rfq",
    status: "live",
    phase: "Live",
    scope: [
      "RFQs built from triaged spec lines, sent only to eligible vendors",
      "Minimum quotes from the sourcing control matrix, enforced",
      "Sealed quotes, benchmark and savings, finance approval and award checks",
    ],
    flow: "Takes Create and Push lines from triage and returns awarded prices.",
  },
  {
    key: "orders",
    name: "Order Management",
    tagline: "Estimates, POs, deliveries and installs",
    icon: "receipt_long",
    colour: "#78C7AE",
    basePath: "/orders",
    status: "live",
    phase: "Live",
    scope: [
      "Client estimates and supplier POs with delegation-of-authority approval; vendor acceptance; Stocktool hand-off",
      "Logistics: deliveries, shipments, verified proof of delivery and transport CO2e",
      "Execution: outlets, recces, installs with photo and GPS, audits and quality gates to job close",
    ],
    flow: "After award. Turns prices into estimates and POs, then follows every order through delivery and installation.",
  },  {
    key: "logistics",
    partOf: "orders",
    name: "Logistics",
    tagline: "Deliveries, shipments and proof of delivery",
    icon: "local_shipping",
    colour: "#FFB05B",
    basePath: "/logistics",
    status: "live",
    phase: "Live",
    scope: [
      "Deliveries per destination, shipments, legs and carriers",
      "Vendor proof of delivery with 8-point verification",
      "Transport CO2e per delivery (Scope 3 Cat 4)",
    ],
    flow: "After the PO. Moves goods from vendor to every destination.",
  },
  {
    key: "execution",
    partOf: "orders",
    name: "Execution",
    tagline: "Recces, installs and audits in store",
    icon: "storefront",
    colour: "#FFB05B",
    basePath: "/execution",
    status: "live",
    phase: "Live",
    scope: [
      "Outlets, recces and deployments",
      "Vendor installation with photos and GPS check",
      "Maintenance tickets, deployment audits and quality gates to job close",
    ],
    flow: "End of the flow. Proves what was paid for is in store and working.",
  },
  {
    key: "shopper-iq",
    name: "Shopper IQ",
    tagline: "What to make, and what worked",
    icon: "insights",
    colour: "#EE4E62",
    basePath: "/shopper-iq",
    status: "live",
    phase: "Live",
    scope: [
      "Performance taxonomy captured as work happens: campaign, job, spec, order",
      "Visual asset library with automatic metadata",
      "Spend and execution effectiveness by campaign, channel, touchpoint and market",
    ],
    flow: "Works hand in hand with Briefing+: insight shapes what gets briefed, and measured results from every stage feed the next brief.",
  },
];

// Sections in tab order. CRM opens the flow (the client relationship and the won opportunity start every job).
// Shopper IQ sits next to Briefing+ (insight decides what to brief).
// Sourcing includes RFQs; Order Management includes Logistics and Execution (areas with partOf set, no tab of their own).
// SRM goes last: it manages the supply base; vendors engage at set points (see LAYERS supplier touches).
const TAB_ORDER: ModuleKey[] = ["watchtower", "crm", "briefing", "shopper-iq", "sourcing", "rfq", "orders", "logistics", "execution", "assure", "finance"];
/**
 * Sections that run across the whole workflow rather than being a step in it. They keep a tab (their team's
 * workspace) but the architecture draws them as layers: Watchtower over everything, Finance+ under everything
 * (like Sustainability and Supplier Engagement).
 */
export const HORIZONTALS: ModuleKey[] = ["watchtower", "finance"];
ALL.sort((a, b) => TAB_ORDER.indexOf(a.key) - TAB_ORDER.indexOf(b.key));

/** The sections people see: one tab, one sidebar, one About and one Watchtower each. */
export const MODULES: ModuleDef[] = ALL.filter((m) => !m.partOf);
/** Every area including those inside a section (for path matching and area labels). */
export const AREAS: ModuleDef[] = ALL;

/** The section a module key belongs to (rfq → sourcing; logistics and execution → orders). */
export const sectionKey = (key: string): ModuleKey => (ALL.find((m) => m.key === key)?.partOf ?? key) as ModuleKey;
/** The section for any module key, so labels, colours and links always show the section. */
export const moduleByKey = (key: string) => MODULES.find((m) => m.key === sectionKey(key));
/** The area itself (e.g. "Logistics"), for finer labels inside a section. */
export const areaByKey = (key: string) => ALL.find((m) => m.key === key);
/** All module keys that make up a section (itself plus its areas), for querying data stored by area. */
export const membersOf = (key: string): ModuleKey[] => {
  const s = sectionKey(key);
  return ALL.filter((m) => m.key === s || m.partOf === s).map((m) => m.key);
};
/** The section whose pages contain this path. */
export const sectionForPath = (path: string): ModuleDef | undefined => {
  const hit = ALL.find((m) => path === m.basePath || path.startsWith(m.basePath + "/"));
  return hit ? moduleByKey(hit.key) : undefined;
};

/** Horizontal layers that run under every module (not tabs; reached from the Watchtower and the flow map). */
export type LayerDef = { key: string; name: string; colour: string; href: string; summary: string; touches: Partial<Record<ModuleKey, string>> };
export const LAYERS: LayerDef[] = [
  {
    key: "data", name: "Data Management", colour: "#EE4E62", href: "/watchtower/data",
    summary: "One canonical record per thing, real links between modules, region and market kept separate, data-quality rules and BI-ready views.",
    touches: { crm: "Client master, accounts per market and contacts", briefing: "Campaign taxonomy at source", "shopper-iq": "Effectiveness data model", sourcing: "Spec library, price history and benchmarks", orders: "Stocktool hand-off, LOCODEs and outlet master data", assure: "Supplier master" },
  },
  {
    key: "finance", name: "Finance", colour: "#97DBD9", href: "/finance",
    summary: "Finance runs under every section rather than at the end: it checks new clients, approves quotes and estimates, holds POs to delegated authority, matches invoices to evidence, pays suppliers and bills clients, and reports spend and savings. The Finance+ tab is the finance team's workspace.",
    touches: { crm: "Credit check, billing entities, payment terms", briefing: "Budget on the brief", "shopper-iq": "Spend by campaign", sourcing: "Quote approval before award", orders: "Estimate review, PO DOA, invoice match, client bills", assure: "Supplier payment terms, bank details, payments" },
  },
  {
    key: "supplier", name: "Supplier Engagement", colour: "#6A2DD3", href: "/vendor",
    summary: "Vendors engage at set points in the journey, not throughout: onboarding and compliance, quoting, confirming pushed prices, accepting POs and updating production, shipping and proof of delivery, installation, and invoicing. All through the vendor portal.",
    touches: { sourcing: "Quote, decline or confirm pushed prices", orders: "Accept PO, ship with POD, install, upload invoice", assure: "Onboard, keep compliant, reviews, see payments" },
  },
  {
    key: "sustainability", name: "Sustainability", colour: "#78C7AE", href: "/watchtower/sustainability",
    summary: "Shared emission factors, substrates and Impact Grade from the Watchtower, applied the same way in every module.",
    touches: { crm: "Client sustainability commitments in the contract", briefing: "Targets on the brief", "shopper-iq": "Footprint beside effectiveness", sourcing: "CO2e and Impact Grade per spec; weighting in evaluation", orders: "Transport CO2e per delivery; reuse and maintenance", assure: "Audits and certificates in the score" },
  },
  {
    key: "internal_reporting", name: "Internal Reporting", colour: "#9DC5ED", href: "/watchtower/reporting",
    summary: "Management reporting across every module from one data model: pipeline, spend and savings, supplier performance, compliance, delivery and carbon, cut by region and market.",
    touches: { crm: "Pipeline, renewals and client health", briefing: "Brief volume and approval times", "shopper-iq": "Effectiveness by campaign", sourcing: "Route mix and savings", orders: "POs awaiting approval, OTIF, install and audit pass rates", assure: "Compliance, PSL, spend and savings" },
  },
];

/** External reporting: what clients and vendors see through their portals. */
export const EXTERNAL_REPORTING = {
  name: "External Reporting",
  colour: "#010062",
  summary: "Client-facing reports (spend, savings, delivery, sustainability, effectiveness) and vendor-facing reports (scorecard, performance trends, compliance status), each showing only what that audience is allowed to see.",
};
/** External portals: how clients and vendors reach System Guy (outside the internal shell). */
export type PortalDef = { key: string; name: string; href: string; colour: string; icon: string; status: "live" | "planned"; summary: string };
export const PORTALS: PortalDef[] = [
  {
    key: "client", name: "Client Portal", href: "/client-portal", colour: "#4896F7", icon: "storefront", status: "live",
    summary: "CRM's external view. Clients follow their campaigns, approve briefs, concepts and estimates, see delivery and installation progress, bills and reports, see their account team and give feedback to CRM.",
  },
  {
    key: "vendor", name: "Vendor Portal", href: "/vendor", colour: "#6A2DD3", icon: "handshake", status: "live",
    summary: "SRM's external view. Vendors register and subscribe, complete onboarding, quote, accept POs, update production, ship, install, submit QA/QC and upload invoices and control documents.",
  },
];