export type ModuleKey = "watchtower" | "briefing" | "shopper-iq" | "rfq" | "sourcing" | "orders" | "logistics" | "execution" | "finance" | "assure";

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
};

// System Guy architecture (Guy's diagram, 9 Oct): master Watchtower over a Watchtower per module; modules in a row;
// Data Management, Supplier Engagement and Sustainability run as horizontal layers under every module (see LAYERS).
export const MODULES: ModuleDef[] = [
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
    flow: "Start of the flow. Approved briefs become specs in Sourcing+.",
  },
  {
    key: "sourcing",
    name: "Sourcing+",
    tagline: "Specs, triage, RFQs and estimates",
    icon: "request_quote",
    colour: "#4896F7",
    basePath: "/sourcing",
    status: "live",
    phase: "Live",
    scope: [
      "Jobs and specs with CO2e and Impact Grade",
      "Triage on every line: Adopt, Adapt, Create or Push before any RFQ",
      "RFQs to the Assure+ eligible pool, sealed vendor quotes, evaluation, estimate and PO",
    ],
    flow: "After the brief. Calls Assure+ for vendor eligibility and award checks; hands approved estimates to Stocktool.",
  },
  {
    key: "finance",
    name: "Finance+",
    tagline: "Quote approvals, billing and payments",
    icon: "account_balance",
    colour: "#97DBD9",
    basePath: "/finance",
    status: "planned",
    phase: "Phase 2",
    scope: [
      "Finance approval of quotes and estimates before award",
      "Supplier invoices matched to POs and deliveries; client billing",
      "Payment schedules, terms and spend reporting by region and market",
    ],
    flow: "Approves the commercial steps (quotes, estimates) and closes the loop: invoices, billing and payment once delivery and installation are proven.",
  },  {
    key: "assure",
    name: "Assure+",
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
    name: "RFQ+",
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
    flow: "Takes Create and Push lines from Sourcing+ triage, returns awarded prices to Sourcing+ and Order Management+.",
  },
  {
    key: "orders",
    name: "Order Management+",
    tagline: "Estimates, purchase orders and order tracking",
    icon: "receipt_long",
    colour: "#78C7AE",
    basePath: "/orders",
    status: "live",
    phase: "Live",
    scope: [
      "Client estimates with markup, savings and approval",
      "Supplier POs with delegation-of-authority approval; vendor acceptance",
      "Order status through production to delivery; hand-off to Stocktool",
    ],
    flow: "After award. Turns prices into estimates and POs and passes deliveries to Logistics+.",
  },  {
    key: "logistics",
    name: "Logistics+",
    tagline: "Deliveries, shipments and proof of delivery",
    icon: "local_shipping",
    colour: "#FFB05B",
    basePath: "/logistics",
    status: "planned",
    phase: "Phase 2",
    scope: [
      "Deliveries per destination, shipments, legs and carriers",
      "Vendor proof of delivery with 8-point verification",
      "Transport CO2e per delivery (Scope 3 Cat 4)",
    ],
    flow: "After the PO. Moves goods from vendor to every destination.",
  },
  {
    key: "execution",
    name: "Execution+",
    tagline: "Recces, installs and audits in store",
    icon: "storefront",
    colour: "#FFB05B",
    basePath: "/execution",
    status: "planned",
    phase: "Phase 2",
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

// Workflow modules in order, then the horizontals. Shopper IQ sits next to Briefing+ (insight decides what to brief).
// Assure+ goes last: it manages the supply base; vendors engage at set points (see LAYERS supplier touches).
const TAB_ORDER: ModuleKey[] = ["watchtower", "briefing", "shopper-iq", "rfq", "sourcing", "orders", "logistics", "execution", "finance", "assure"];
/** Modules that run across the whole workflow rather than being a step in it. */
export const HORIZONTALS: ModuleKey[] = ["watchtower"];
MODULES.sort((a, b) => TAB_ORDER.indexOf(a.key) - TAB_ORDER.indexOf(b.key));

export const moduleByKey = (key: string) => MODULES.find((m) => m.key === key);

/** Horizontal layers that run under every module (not tabs; reached from the Watchtower and the flow map). */
export type LayerDef = { key: string; name: string; colour: string; href: string; summary: string; touches: Partial<Record<ModuleKey, string>> };
export const LAYERS: LayerDef[] = [
  {
    key: "data", name: "Data Management", colour: "#EE4E62", href: "/watchtower/data",
    summary: "One canonical record per thing, real links between modules, region and market kept separate, data-quality rules and BI-ready views.",
    touches: { briefing: "Campaign taxonomy at source", "shopper-iq": "Effectiveness data model", rfq: "Price history and benchmarks", sourcing: "Spec library", orders: "Stocktool hand-off events", logistics: "LOCODEs and lanes", execution: "Outlet master data", finance: "Spend and savings reporting", assure: "Supplier master" },
  },
  {
    key: "supplier", name: "Supplier Engagement", colour: "#6A2DD3", href: "/vendor",
    summary: "Vendors engage at set points in the journey, not throughout: onboarding and compliance, quoting, confirming pushed prices, accepting POs and updating production, shipping and proof of delivery, installation, and invoicing. All through the vendor portal.",
    touches: { rfq: "Quote or decline", sourcing: "Confirm pushed prices", orders: "Accept PO, update production", logistics: "Record shipment, upload POD", execution: "Install with photo and GPS", finance: "Upload invoice, see payment", assure: "Onboard, keep compliant, reviews" },
  },
  {
    key: "sustainability", name: "Sustainability", colour: "#78C7AE", href: "/watchtower/sustainability",
    summary: "Shared emission factors, substrates and Impact Grade from the Watchtower, applied the same way in every module.",
    touches: { briefing: "Targets on the brief", "shopper-iq": "Footprint beside effectiveness", rfq: "Sustainability weighting in evaluation", sourcing: "CO2e and Impact Grade per spec", orders: "Emissions declarations on POs", logistics: "Transport CO2e per delivery", execution: "Reuse and maintenance", finance: "Carbon cost alongside spend", assure: "Audits and certificates in the score" },
  },
  {
    key: "internal_reporting", name: "Internal Reporting", colour: "#9DC5ED", href: "/watchtower/reporting",
    summary: "Management reporting across every module from one data model: pipeline, spend and savings, supplier performance, compliance, delivery and carbon, cut by region and market.",
    touches: { briefing: "Brief volume and approval times", "shopper-iq": "Effectiveness by campaign", rfq: "Quote coverage and savings", sourcing: "Route mix (Adopt/Adapt/Create/Push)", orders: "POs awaiting approval", logistics: "OTIF and transport CO2e", execution: "Install and audit pass rates", finance: "Spend, fee and savings", assure: "Compliance and PSL" },
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
    key: "client", name: "Client Portal", href: "/client-portal", colour: "#4896F7", icon: "storefront", status: "planned",
    summary: "Clients follow their campaigns, approve briefs and estimates, see delivery and installation progress, and view spend, savings, sustainability and effectiveness.",
  },
  {
    key: "vendor", name: "Vendor Portal", href: "/vendor", colour: "#6A2DD3", icon: "handshake", status: "live",
    summary: "Vendors register and subscribe, complete onboarding, quote, accept POs, update production, ship, install, submit QA/QC and upload invoices and control documents.",
  },
];