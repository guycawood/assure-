export type ModuleKey = "watchtower" | "briefing" | "sourcing" | "assure" | "logistics" | "execution" | "shopper-iq";

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

// Order follows the work: brief + insight → source → move → install; horizontals (Watchtower, Assure+) frame it (see TAB_ORDER).
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
    status: "planned",
    phase: "Phase 3",
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
    status: "planned",
    phase: "Phase 1",
    scope: [
      "Jobs and specs with CO2e and Impact Grade",
      "Triage on every line: Adopt, Adapt, Create or Push before any RFQ",
      "RFQs to the Assure+ eligible pool, sealed vendor quotes, evaluation, estimate and PO",
    ],
    flow: "After the brief. Calls Assure+ for vendor eligibility and award checks; hands approved estimates to Stocktool.",
  },
  {
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
    flow: "A horizontal under the whole workflow: decides which vendors can quote, be awarded and be paid at every stage, and is the vendor's own window into their jobs.",
  },
  {
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
    status: "planned",
    phase: "Phase 3",
    scope: [
      "Performance taxonomy captured as work happens: campaign, job, spec, order",
      "Visual asset library with automatic metadata",
      "Spend and execution effectiveness by campaign, channel, touchpoint and market",
    ],
    flow: "Works hand in hand with Briefing+: insight shapes what gets briefed, and measured results from every stage feed the next brief.",
  },
];

// Workflow modules in order, then the horizontals. Shopper IQ sits next to Briefing+ (insight decides what to brief).
// Assure+ goes last: it is a horizontal that serves every stage, not a step in the workflow.
const TAB_ORDER: ModuleKey[] = ["watchtower", "briefing", "shopper-iq", "sourcing", "logistics", "execution", "assure"];
/** Modules that run across the whole workflow rather than being a step in it. */
export const HORIZONTALS: ModuleKey[] = ["watchtower", "assure"];
MODULES.sort((a, b) => TAB_ORDER.indexOf(a.key) - TAB_ORDER.indexOf(b.key));

export const moduleByKey = (key: string) => MODULES.find((m) => m.key === key);
