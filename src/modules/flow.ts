import type { ModuleKey } from "./registry";

// Process flow per module, and the handoffs between modules. Drives the About pages and the platform flow map.
// Each module stands alone; these handoffs are the links between them.

export type ProcessStep = { step: string; detail: string; handoff?: ModuleKey };

export const PROCESS: Record<ModuleKey, ProcessStep[]> = {
  crm: [
    { step: "Win the opportunity", detail: "Lead to won through the pipeline; large wins confirmed by a sales lead." },
    { step: "Set up the client", detail: "Client, accounts per market and contacts; Finance checks a new client before it is used on jobs.", handoff: "finance" },
    { step: "Agree commercial terms", detail: "Contract, markup or margin, commission, rebate and payment terms, approved by a second person.", handoff: "sourcing" },
    { step: "Start the campaign", detail: "The won opportunity becomes a campaign in Briefing+.", handoff: "briefing" },
    { step: "Keep the relationship healthy", detail: "Activity, account plans, renewals, client health and feedback from the Client Portal.", handoff: "watchtower" },
  ],
  briefing: [
    { step: "Set up campaign", detail: "Central campaign: brand, objective, channels, path-to-purchase.", handoff: "shopper-iq" },
    { step: "Brief per market", detail: "Market brief with timings, quantities and store formats." },
    { step: "Set sustainability targets", detail: "Targets and approved low-impact materials on the brief." },
    { step: "Approve", detail: "A different person approves the brief." },
    { step: "Ideate", detail: "AI concepts from approved materials, refined with the team." },
    { step: "Send to sourcing", detail: "Chosen concept becomes a job and specs in Sourcing.", handoff: "sourcing" },
  ],
  "shopper-iq": [
    { step: "Insight to the brief", detail: "What worked before, by channel, touchpoint and market.", handoff: "briefing" },
    { step: "Capture taxonomy", detail: "Campaign, job, spec and order attributes recorded as work happens." },
    { step: "Collect images", detail: "In-store images and audit results from Order Management (Execution).", handoff: "orders" },
    { step: "Measure", detail: "Spend and execution effectiveness by campaign and market." },
    { step: "Feed the next brief", detail: "Results go back into Briefing+.", handoff: "briefing" },
  ],
  sourcing: [
    { step: "Create job and specs", detail: "From the approved brief and concept; promo fields, HS code, CO2e and Impact Grade per spec.", handoff: "briefing" },
    { step: "Triage every line", detail: "Adopt (rate card), Adapt (priced in band), Create (RFQ) or Push (supplier confirms our price)." },
    { step: "Adopt and Adapt", detail: "Priced without a sourcing event, straight to the estimate.", handoff: "orders" },
    { step: "Send the RFQ", detail: "Create and Push lines to eligible, unblocked vendors only; minimum quotes enforced.", handoff: "assure" },
    { step: "Collect sealed quotes", detail: "Vendors quote per unit in the vendor portal, with alternatives and logistics data." },
    { step: "Evaluate", detail: "Benchmark, tolerance and savings; finance approves before award.", handoff: "finance" },
    { step: "Award", detail: "SRM award checks; losing quotes declined; awarded price to the estimate.", handoff: "orders" },
  ],
  orders: [
    { step: "Build the estimate", detail: "Markup or margin, cost splits; client accepts with their PO.", handoff: "finance" },
    { step: "Raise the PO", detail: "PO approved by someone with enough delegated authority; estimate handed to Stocktool." },
    { step: "Vendor accepts and produces", detail: "Acceptance, production updates and QA/QC in the vendor portal.", handoff: "assure" },
    { step: "Logistics: deliver", detail: "Deliveries per destination; vendor ships and uploads POD; 8-point check; transport CO2e." },
    { step: "Execution: install", detail: "Deployments per outlet; vendor installs with photo and GPS; audit pass or fail." },
    { step: "Close the job", detail: "Quality gates passed; OTIF and quality to SRM; images to Shopper IQ; invoice released to Finance+.", handoff: "finance" },
  ],
  // Areas inside a section: their steps are part of the section's flow above.
  rfq: [],
  logistics: [],
  execution: [],
  finance: [
    { step: "Approve commercials", detail: "Quotes and estimates approved before award and PO.", handoff: "sourcing" },
    { step: "Receive invoices", detail: "Vendors upload invoices in the portal against the PO." },
    { step: "Match to evidence", detail: "PO, proof of delivery and installation must agree." },
    { step: "Bill and pay", detail: "Client billing, supplier payment schedules and terms." },
    { step: "Report spend", detail: "Spend, fee and savings by region, market and supplier.", handoff: "watchtower" },
  ],
  assure: [
    { step: "Request and triage", detail: "Business need and a complete request; duplicate check; Procurement approves the need and the route." },
    { step: "Due diligence and risk gates", detail: "Vendor evidence verified (or a documented gap approved by a second person); Category Manager and Quality approve the risk gate." },
    { step: "Contracts, Finance and systems", detail: "Signed agreement set stored; Local Finance approves; StockTool, NAV / ERP and Sourcing Hub IDs reconciled." },
    { step: "Activate", detail: "Activation pack complete; supplier released and purchasing unblocked. Fast-track is an exception with two named approvals." },
    { step: "Make eligible", detail: "Vendor joins the eligible pool used by Sourcing.", handoff: "sourcing" },
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
  { n: 5, step: "Assess and award", today: "Compare quotes against benchmark and tolerance; savings recorded.", wave2: "Award checks in SRM (purchasing block, MSA, DOA); finance approval enforced.", module: "rfq" },
  { n: 6, step: "Estimate", today: "Estimate with markup or margin, bypass reason if fewer quotes than required.", wave2: "Cost splits, GSC commission and client rebate; several client POs per estimate.", module: "orders" },
  { n: 7, step: "Client PO", today: "Client PO received and attached.", wave2: "Status flags: pending estimate approval, PO pending, PO received.", module: "orders" },
  { n: 8, step: "Supplier PO", today: "Supplier PO raised and accepted by the supplier.", wave2: "PO approved by DOA level; supplier accepts in the vendor portal.", module: "orders", vendor: true },
  { n: 9, step: "Production and QC", today: "Production updates and QC outside the Hub (email, spreadsheets).", wave2: "Production updates and QA/QC submitted in the vendor portal; quality gates.", module: "execution", vendor: true },
  { n: 10, step: "Proof of delivery and invoice", today: "Supplier uploads POD and invoice.", wave2: "8-point POD check in Logistics; invoice matched to PO and POD in Finance+.", module: "logistics", vendor: true },
  { n: 11, step: "Hand-off to Stocktool", today: "Shasta pushes article, PO and SO to Stocktool, or the manual OMC route.", wave2: "Sourcing ends at estimate approval; estimate.approved event carries the Stocktool payload.", module: "orders", pain: "Orders stall for missing HS code, weights or client PO." },
  { n: 12, step: "CST compliance", today: "CST checks the order data before it moves on.", wave2: "Data checks run in System Guy before hand-off (data-quality rules).", module: "watchtower" },
  { n: 13, step: "OMC delivery note", today: "OMC raises the delivery note in Stocktool.", wave2: "Delivery confirmed from verified POD.", module: "logistics" },
  { n: 14, step: "Billing", today: "Client billed from Stocktool.", wave2: "Billing released when evidence agrees (PO, POD, installation).", module: "finance" },
  { n: 15, step: "Local finance (NAV)", today: "Invoices and billing posted in local finance (NAV).", wave2: "Unchanged: Stocktool and NAV stay the finance records.", module: "finance" },
];

export type Connection = { from: ModuleKey; to: ModuleKey; what: string };

/** Every handoff between modules: the links that make standalone modules one workflow. */
export const CONNECTIONS: Connection[] = [
  { from: "crm", to: "briefing", what: "Won opportunity becomes a campaign; client and account context on every brief" },
  { from: "crm", to: "sourcing", what: "Client commercial rules: minimum quotes, tolerance, markup or margin" },
  { from: "crm", to: "orders", what: "Commission, rebate and client PO terms on every estimate" },
  { from: "crm", to: "finance", what: "Billing entities and payment terms; new clients checked by Finance" },
  { from: "finance", to: "crm", what: "Spend and overdue bills for client health" },
  { from: "orders", to: "crm", what: "Delivery and installation issues for client health" },
  { from: "crm", to: "watchtower", what: "Pipeline, renewals and client health" },
  { from: "shopper-iq", to: "briefing", what: "Insight on what worked shapes the brief" },
  { from: "briefing", to: "shopper-iq", what: "Campaign taxonomy captured at the start" },
  { from: "briefing", to: "sourcing", what: "Approved concept becomes a job and specs" },
  { from: "assure", to: "sourcing", what: "Eligible vendors, scores and quality standing for RFQs and award checks" },
  { from: "sourcing", to: "finance", what: "Quotes for finance approval before award" },
  { from: "sourcing", to: "orders", what: "Awarded prices, and Adopt and Adapt lines priced without an RFQ" },
  { from: "orders", to: "finance", what: "Estimates for review; POs, verified deliveries and installs for invoice matching" },
  { from: "orders", to: "assure", what: "OTIF and quality results to the supplier scorecard" },
  { from: "orders", to: "sourcing", what: "Specs raised from recces" },
  { from: "orders", to: "shopper-iq", what: "Executional images and audit results" },
  { from: "finance", to: "watchtower", what: "Spend and savings reporting" },
  { from: "assure", to: "watchtower", what: "Onboarding, compliance and PSL health" },
];
