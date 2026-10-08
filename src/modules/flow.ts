import type { ModuleKey } from "./registry";

// Process flow per module, and the handoffs between modules. Drives the About pages and the platform flow map.
// Each module stands alone; these handoffs are the links between them.

export type ProcessStep = { step: string; detail: string; handoff?: ModuleKey };

export const PROCESS: Record<ModuleKey, ProcessStep[]> = {
  briefing: [
    { step: "Set up campaign", detail: "Central campaign: brand, objective, channels, path-to-purchase.", handoff: "shopper-iq" },
    { step: "Brief per market", detail: "Market brief with timings, quantities and store formats." },
    { step: "Set sustainability targets", detail: "Targets and approved low-impact materials on the brief." },
    { step: "Approve", detail: "A different person approves the brief." },
    { step: "Ideate", detail: "AI concepts from approved materials, refined with the team." },
    { step: "Send to sourcing", detail: "Chosen concept becomes a job and specs in Sourcing+.", handoff: "sourcing" },
  ],
  "shopper-iq": [
    { step: "Insight to the brief", detail: "What worked before, by channel, touchpoint and market.", handoff: "briefing" },
    { step: "Capture taxonomy", detail: "Campaign, job, spec and order attributes recorded as work happens." },
    { step: "Collect images", detail: "In-store images and audit results from Execution+.", handoff: "execution" },
    { step: "Measure", detail: "Spend and execution effectiveness by campaign and market." },
    { step: "Feed the next brief", detail: "Results go back into Briefing+.", handoff: "briefing" },
  ],
  rfq: [
    { step: "Receive lines to source", detail: "Create and Push lines from Sourcing+ triage.", handoff: "sourcing" },
    { step: "Invite eligible vendors", detail: "Only onboarded, unblocked vendors; minimum quotes enforced.", handoff: "assure" },
    { step: "Collect sealed quotes", detail: "Vendors quote per quantity break in the vendor portal." },
    { step: "Evaluate", detail: "Benchmark, corridor, savings; finance approval.", handoff: "finance" },
    { step: "Award", detail: "Assure+ award checks; losing quotes declined." },
    { step: "Hand on the price", detail: "Awarded price to Order Management+.", handoff: "orders" },
  ],
  sourcing: [
    { step: "Create job and specs", detail: "From the approved brief; BOM, CO2e and Impact Grade per spec.", handoff: "briefing" },
    { step: "Triage every line", detail: "Adopt (rate card), Adapt (priced in band), Create (RFQ) or Push (supplier confirms our price)." },
    { step: "Adopt and Adapt", detail: "Priced without a sourcing event.", handoff: "orders" },
    { step: "Create and Push", detail: "Sent to RFQ+ for quotes or confirmation.", handoff: "rfq" },
    { step: "Close the spec", detail: "Spec locked with its price and route for reporting." },
  ],
  orders: [
    { step: "Build the estimate", detail: "Markup or margin, savings; client acceptance." },
    { step: "Finance approval", detail: "Commercials approved before commitment.", handoff: "finance" },
    { step: "Raise the PO", detail: "PO approved by someone with enough delegated authority." },
    { step: "Vendor accepts and produces", detail: "Acceptance and production updates in the vendor portal.", handoff: "assure" },
    { step: "Plan deliveries", detail: "Destinations and quantities to Logistics+; estimate to Stocktool.", handoff: "logistics" },
  ],
  logistics: [
    { step: "Plan deliveries", detail: "Per destination, per spec, from the PO.", handoff: "orders" },
    { step: "Vendor records shipment", detail: "Carrier, tracking and quantities in the vendor portal." },
    { step: "Track milestones", detail: "Legs, carriers and milestones to destination." },
    { step: "Verify proof of delivery", detail: "8-point check before a delivery counts." },
    { step: "Record transport CO2e", detail: "Emissions per delivery from distance, mode and weight." },
    { step: "Hand to installation", detail: "Delivered goods to Execution+; OTIF to the Assure+ scorecard.", handoff: "execution" },
  ],
  execution: [
    { step: "Recce outlets", detail: "Store surveys; specs can be raised from a recce.", handoff: "sourcing" },
    { step: "Schedule deployment", detail: "Install plan per outlet once goods arrive." },
    { step: "Vendor installs", detail: "Photos and a GPS check in the vendor portal." },
    { step: "Audit", detail: "Pass/fail audit; maintenance tickets if needed." },
    { step: "Close the job", detail: "Quality gates passed; images to Shopper IQ; invoice released to Finance+.", handoff: "finance" },
  ],
  finance: [
    { step: "Approve commercials", detail: "Quotes and estimates approved before award and PO.", handoff: "rfq" },
    { step: "Receive invoices", detail: "Vendors upload invoices in the portal against the PO." },
    { step: "Match to evidence", detail: "PO, proof of delivery and installation must agree." },
    { step: "Bill and pay", detail: "Client billing, supplier payment schedules and terms." },
    { step: "Report spend", detail: "Spend, fee and savings by region, market and supplier.", handoff: "watchtower" },
  ],
  assure: [
    { step: "Request a new vendor", detail: "Ticket raised on the SRT desk (\"no ticket, no job\")." },
    { step: "Collect vendor information", detail: "Vendor registers and completes the information request in the vendor portal." },
    { step: "Verify gates", detail: "14 onboarding gates verified by SRT, Finance and Procurement." },
    { step: "Approve", detail: "Procurement head approves; purchasing unblocked." },
    { step: "Make eligible", detail: "Vendor joins the eligible pool used by RFQ+.", handoff: "rfq" },
    { step: "Score and review", detail: "Scorecard, PSL, reviews and re-qualification from delivery and quality data.", handoff: "watchtower" },
  ],
  watchtower: [
    { step: "Collect health", detail: "Each module's Watchtower reports standard health metrics." },
    { step: "Govern rules", detail: "Libraries and methodology changed through versioned, audited changes." },
    { step: "Review change requests", detail: "Suggestions checked against the core principles." },
    { step: "Manage users", detail: "Who can use which module, and who governs it." },
  ],
};

export type Connection = { from: ModuleKey; to: ModuleKey; what: string };

/** Every handoff between modules: the links that make standalone modules one workflow. */
export const CONNECTIONS: Connection[] = [
  { from: "shopper-iq", to: "briefing", what: "Insight on what worked shapes the brief" },
  { from: "briefing", to: "shopper-iq", what: "Campaign taxonomy captured at the start" },
  { from: "briefing", to: "sourcing", what: "Approved concept becomes a job and specs" },
  { from: "sourcing", to: "rfq", what: "Create and Push lines to quote or confirm" },
  { from: "sourcing", to: "orders", what: "Adopt and Adapt lines priced without an RFQ" },
  { from: "assure", to: "rfq", what: "Eligible vendors, scores and quality standing" },
  { from: "rfq", to: "finance", what: "Quotes for finance approval" },
  { from: "rfq", to: "orders", what: "Awarded prices" },
  { from: "orders", to: "finance", what: "Estimates for approval; POs for invoice matching" },
  { from: "orders", to: "logistics", what: "PO and delivery plan" },
  { from: "logistics", to: "execution", what: "Delivered goods ready to install" },
  { from: "logistics", to: "assure", what: "OTIF to the supplier scorecard" },
  { from: "execution", to: "sourcing", what: "Specs raised from recces" },
  { from: "execution", to: "shopper-iq", what: "Executional images and audit results" },
  { from: "execution", to: "finance", what: "Installs proven, invoice can be paid" },
  { from: "execution", to: "assure", what: "Quality results to the supplier scorecard" },
  { from: "finance", to: "watchtower", what: "Spend and savings reporting" },
  { from: "assure", to: "watchtower", what: "Onboarding, compliance and PSL health" },
];
