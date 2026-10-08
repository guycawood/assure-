import type { ModuleKey } from "./registry";

// Process flow per module, and the handoffs between modules. Drives the About pages and the platform flow map.

export type ProcessStep = { step: string; detail: string; handoff?: ModuleKey };

export const PROCESS: Record<ModuleKey, ProcessStep[]> = {
  briefing: [
    { step: "Set up campaign", detail: "Central campaign: brand, objective, channels, path-to-purchase.", handoff: "shopper-iq" },
    { step: "Brief per market", detail: "Market brief with timings, quantities and store formats." },
    { step: "Set sustainability targets", detail: "Targets and approved low-impact materials captured on the brief." },
    { step: "Score completeness", detail: "Red/amber/green on the fields that drive price and quality." },
    { step: "Ideate and approve", detail: "Concepts from approved materials; brief approved." },
    { step: "Release to sourcing", detail: "Approved brief becomes specs in Sourcing+.", handoff: "sourcing" },
  ],
  "shopper-iq": [
    { step: "Insight to the brief", detail: "What worked before, by channel, touchpoint and market.", handoff: "briefing" },
    { step: "Capture taxonomy", detail: "Campaign, job, spec and order attributes recorded as the work happens." },
    { step: "Collect assets and images", detail: "Art, renders and in-store images from Execution+.", handoff: "execution" },
    { step: "Measure", detail: "Spend and execution effectiveness by campaign and market." },
    { step: "Feed the next brief", detail: "Results go back into Briefing+.", handoff: "briefing" },
  ],
  sourcing: [
    { step: "Create job and specs", detail: "From the approved brief; BOM, CO2e and Impact Grade per spec." },
    { step: "Triage every line", detail: "Adopt (rate card), Adapt (priced in band), Create (RFQ) or Push (supplier confirms our price)." },
    { step: "Select eligible vendors", detail: "Only onboarded, unblocked vendors that meet the spec's gates.", handoff: "assure" },
    { step: "RFQ and sealed quotes", detail: "Vendors quote in the Assure+ vendor portal; minimum quotes enforced.", handoff: "assure" },
    { step: "Evaluate and award", detail: "Benchmarks, corridor, finance approval, Assure+ award checks.", handoff: "assure" },
    { step: "Estimate and PO", detail: "Client estimate, supplier PO with DOA approval; vendor accepts in the portal; Stocktool hand-off." },
    { step: "Plan deliveries", detail: "Destinations and quantities passed to Logistics+.", handoff: "logistics" },
  ],
  logistics: [
    { step: "Plan deliveries", detail: "Per destination, per spec, from the PO." },
    { step: "Vendor records shipment", detail: "Carrier, tracking, dispatch date and quantities in the vendor portal.", handoff: "assure" },
    { step: "Track milestones", detail: "Legs, carriers and milestones to destination." },
    { step: "Verify proof of delivery", detail: "Vendor uploads POD; 8-point check before it counts." },
    { step: "Record transport CO2e", detail: "Emissions per delivery from distance, mode and weight." },
    { step: "Hand to installation", detail: "Delivered goods released to Execution+; OTIF to the Assure+ scorecard.", handoff: "execution" },
  ],
  execution: [
    { step: "Recce outlets", detail: "Store surveys; specs can be raised straight from a recce.", handoff: "sourcing" },
    { step: "Schedule deployment", detail: "Install plan per outlet once goods are delivered." },
    { step: "Vendor installs", detail: "Photos and GPS check captured in the vendor portal.", handoff: "assure" },
    { step: "Audit", detail: "Pass/fail deployment audit; maintenance tickets if needed." },
    { step: "Close the job", detail: "Quality gates passed; images and results to Shopper IQ.", handoff: "shopper-iq" },
  ],
  assure: [
    { step: "Request a new vendor", detail: "Ticket raised on the SRT desk (\"no ticket, no job\")." },
    { step: "Collect vendor information", detail: "Vendor registers and completes the information request in the vendor portal." },
    { step: "Verify gates", detail: "14 onboarding gates verified by SRT, Finance and Procurement." },
    { step: "Approve", detail: "Procurement head approves; purchasing unblocked." },
    { step: "Make eligible to quote", detail: "Vendor joins the eligible pool used by Sourcing+.", handoff: "sourcing" },
    { step: "Work every job", detail: "Vendor quotes, updates production, ships, installs, submits QA/QC and invoices in the portal." },
    { step: "Score and review", detail: "Scorecard, PSL, reviews and re-qualification from delivery and quality data.", handoff: "watchtower" },
  ],
  watchtower: [
    { step: "Collect health", detail: "Each module reports standard health metrics." },
    { step: "Govern rules", detail: "Module owners change rules through versioned drafts with a change log." },
    { step: "Review change requests", detail: "Suggestions checked against the core principles." },
    { step: "Publish shared libraries", detail: "Taxonomy, geography, currency, emission factors used by every module." },
  ],
};

export type Connection = { from: ModuleKey; to: ModuleKey; what: string };

/** Every handoff between modules. */
export const CONNECTIONS: Connection[] = [
  { from: "shopper-iq", to: "briefing", what: "Insight on what worked shapes the brief" },
  { from: "briefing", to: "shopper-iq", what: "Campaign taxonomy captured at the start" },
  { from: "briefing", to: "sourcing", what: "Approved brief becomes specs" },
  { from: "sourcing", to: "assure", what: "Request eligible vendors; RFQs to the vendor portal; award checks" },
  { from: "assure", to: "sourcing", what: "Eligible pool, scores, quality standing for Push" },
  { from: "sourcing", to: "logistics", what: "PO and delivery plan" },
  { from: "logistics", to: "assure", what: "Vendor shipments and POD via the portal; OTIF to the scorecard" },
  { from: "logistics", to: "execution", what: "Delivered goods ready to install" },
  { from: "execution", to: "sourcing", what: "Specs raised from recces" },
  { from: "execution", to: "assure", what: "Vendor installs via the portal; quality results to the scorecard" },
  { from: "execution", to: "shopper-iq", what: "Executional images and audit results" },
  { from: "assure", to: "watchtower", what: "Onboarding, compliance and PSL health" },
];

/** Where Assure+ touches each workflow stage (shown under the flow map). */
export const ASSURE_TOUCHPOINTS: Partial<Record<ModuleKey, string>> = {
  briefing: "Approved materials and vendor capabilities",
  "shopper-iq": "Supplier performance alongside execution results",
  sourcing: "Eligible vendors, sealed quotes, award checks",
  logistics: "Shipments and POD uploaded by vendors",
  execution: "Installs with photo and GPS evidence",
};
