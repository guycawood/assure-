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

/**
 * The current Sourcing Hub end-to-end process (TOM E2E Process Flow, Wave 2 Overview, Hypercare deck),
 * step by step, with where each step lives in System Guy. `today` = how it works now; `wave2` = the target state.
 */
export type HubStep = { n: number; step: string; today: string; wave2: string; module: ModuleKey; vendor?: boolean; pain?: string };

export const SOURCING_HUB_FLOW: HubStep[] = [
  { n: 1, step: "Create job", today: "Account team creates the job in Sourcing Hub (client, site, billing entity, budget, timings).", wave2: "Same, with the campaign link from Briefing+.", module: "sourcing" },
  { n: 2, step: "Spec", today: "Spec form by type (2D, 3D, promo/merch, custom, design); fixed, open or ideation.", wave2: "Structured promo/merch fields, versioned specs instead of a hard lock.", module: "sourcing", pain: "Promo fields missing (components, branding method, testing, AQL, packing)." },
  { n: 3, step: "RFQ", today: "Lines with quantity breaks, target prices and delivery dates; supplier group chosen.", wave2: "Triage first (Adopt/Adapt/Create/Push); RFQ only for Create and Push.", module: "rfq", pain: "Fewer than 6 quantity breaks and no run-ons." },
  { n: 4, step: "Supplier quotes", today: "Suppliers quote in the Sourcing Hub supplier portal, sealed.", wave2: "Quote with alternatives, carton/weight/HS code and emissions declaration.", module: "rfq", vendor: true },
  { n: 5, step: "Assess and award", today: "Compare quotes against benchmark and tolerance; savings recorded.", wave2: "Award checks in Assure+ (purchasing block, MSA, DOA); finance approval enforced.", module: "rfq" },
  { n: 6, step: "Estimate", today: "Estimate with markup or margin, bypass reason if fewer quotes than required.", wave2: "Cost splits, GSC commission and client rebate; several client POs per estimate.", module: "orders" },
  { n: 7, step: "Client PO", today: "Client PO received and attached.", wave2: "Status flags: pending estimate approval, PO pending, PO received.", module: "orders" },
  { n: 8, step: "Supplier PO", today: "Supplier PO raised and accepted by the supplier.", wave2: "PO approved by DOA level; supplier accepts in the vendor portal.", module: "orders", vendor: true },
  { n: 9, step: "Production and QC", today: "Production updates and QC outside the Hub (email, spreadsheets).", wave2: "Production updates and QA/QC submitted in the vendor portal; quality gates.", module: "execution", vendor: true },
  { n: 10, step: "Proof of delivery and invoice", today: "Supplier uploads POD and invoice.", wave2: "8-point POD check in Logistics+; invoice matched to PO and POD in Finance+.", module: "logistics", vendor: true },
  { n: 11, step: "Hand-off to Stocktool", today: "Shasta pushes article, PO and SO to Stocktool, or the manual OMC route.", wave2: "Sourcing ends at estimate approval; estimate.approved event carries the Stocktool payload.", module: "orders", pain: "Orders stall for missing HS code, weights or client PO." },
  { n: 12, step: "CST compliance", today: "CST checks the order data before it moves on.", wave2: "Data checks run in System Guy before hand-off (data-quality rules).", module: "watchtower" },
  { n: 13, step: "OMC delivery note", today: "OMC raises the delivery note in Stocktool.", wave2: "Delivery confirmed from verified POD.", module: "logistics" },
  { n: 14, step: "Billing", today: "Client billed from Stocktool.", wave2: "Billing released when evidence agrees (PO, POD, installation).", module: "finance" },
  { n: 15, step: "Local finance (NAV)", today: "Invoices and billing posted in local finance (NAV).", wave2: "Unchanged: Stocktool and NAV stay the finance records.", module: "finance" },
];

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
