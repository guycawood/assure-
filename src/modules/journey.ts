import type { ModuleKey } from "./registry";

// The end-to-end journey, campaign to payment, as one walk-through of the demo. Each step names who acts,
// the module it lives in, whether it is an approval gate, and the screen (plus demo person) to open it with.

export type Lane = "client" | "internal" | "vendor" | "system";
export type JourneyStep = {
  step: string; detail: string; lane: Lane; module: ModuleKey; href: string;
  as?: string;            // demo user id to sign in as
  gate?: string;          // approval rule, when this step is an approval
  planned?: boolean;      // not built yet
};
export type JourneyStage = { key: string; title: string; summary: string; steps: JourneyStep[] };

const U = {
  ada: "d0000000-0000-4000-8000-000000000001",
  lena: "d0000000-0000-4000-8000-000000000002",
  arjun: "d0000000-0000-4000-8000-000000000003",
  fiona: "d0000000-0000-4000-8000-000000000004",
  pedro: "d0000000-0000-4000-8000-000000000005",
  hana: "d0000000-0000-4000-8000-000000000007",
  wei: "d0000000-0000-4000-8000-000000000006",
  tom: "d0000000-0000-4000-8000-000000000030",
  claire: "d0000000-0000-4000-8000-0000000000c1",
};

export const LANES: Record<Lane, { label: string; colour: string }> = {
  client: { label: "Client", colour: "#B776BC" },
  internal: { label: "adm Indicia", colour: "#4896F7" },
  vendor: { label: "Vendor", colour: "#FFB05B" },
  system: { label: "System", colour: "#78C7AE" },
};

export const JOURNEY: JourneyStage[] = [
  { key: "onboard", title: "Before any job: the vendor is onboarded", summary: "No ticket, no job. Only onboarded, unblocked vendors can be invited to quote.", steps: [
    { step: "Request a new vendor", detail: "In-market procurement raises a ticket on the SRT desk.", lane: "internal", module: "assure", href: "/assure/srt", as: U.pedro },
    { step: "Vendor completes the information request", detail: "Registers in the vendor portal and supplies company, bank and compliance details.", lane: "vendor", module: "assure", href: "/vendor/information-request", as: U.wei },
    { step: "Gates verified", detail: "14 onboarding gates checked; Finance verifies bank details.", lane: "internal", module: "assure", href: "/assure/srt", as: U.arjun, gate: "Agent verifies; bank details only by Finance" },
    { step: "Procurement head approves", detail: "Final onboarding approval; purchasing unblocked and the vendor joins the eligible pool.", lane: "internal", module: "assure", href: "/assure/srt", as: U.hana, gate: "Procurement head only" },
  ] },
  { key: "brief", title: "1. Plan and brief", summary: "From the client's objective to an approved brief per market.", steps: [
    { step: "Client shares the objective", detail: "Client follows campaigns and briefs, and comments, in the Client Portal.", lane: "client", module: "briefing", href: "/client-portal/briefs", as: U.claire },
    { step: "Set up the campaign", detail: "Brand, objective, channels, path-to-purchase: the Shopper IQ taxonomy starts here.", lane: "internal", module: "briefing", href: "/briefing/campaigns", as: U.ada },
    { step: "Use past performance", detail: "What worked before, by channel, touchpoint and market.", lane: "internal", module: "shopper-iq", href: "/shopper-iq/insights", as: U.ada },
    { step: "Write and submit the brief", detail: "Per market: timings, quantities, budget, sustainability targets.", lane: "internal", module: "briefing", href: "/briefing/new", as: U.ada },
    { step: "Approve the brief", detail: "Approve or request changes with a comment.", lane: "internal", module: "briefing", href: "/briefing", as: U.lena, gate: "Anyone internal except the author" },
  ] },
  { key: "ideate", title: "2. Ideate", summary: "AI concepts on the approved brief, signed off before they reach sourcing.", steps: [
    { step: "AI ideation", detail: "Concepts from approved low-impact materials; open the approved brief to ideate.", lane: "internal", module: "briefing", href: "/briefing", as: U.ada },
    { step: "Approve the concept", detail: "Internal sign-off on the chosen concept.", lane: "internal", module: "briefing", href: "/briefing", as: U.lena, gate: "Approver role from the policy, not the submitter" },
    { step: "Client approves the concept", detail: "Where the client's policy requires it.", lane: "client", module: "briefing", href: "/client-portal/briefs", as: U.claire, gate: "Client approver (not viewer)" },
    { step: "Send to Sourcing", detail: "The concept becomes a job and specs.", lane: "internal", module: "briefing", href: "/briefing", as: U.ada },
  ] },
  { key: "source", title: "3. Source", summary: "Specs, triage and a sealed sourcing event with eligible vendors.", steps: [
    { step: "Job and specs", detail: "Spec form and type; promo/merch fields, HS code, weights, CO2e and Impact Grade.", lane: "internal", module: "sourcing", href: "/sourcing/jobs", as: U.ada },
    { step: "Triage every line", detail: "Adopt (rate card), Adapt (priced in band), Create (RFQ) or Push (vendor confirms our price).", lane: "internal", module: "sourcing", href: "/sourcing/triage", as: U.ada },
    { step: "Send the RFQ", detail: "Eligible pool only, minimum quotes, up to 12 quantity breaks, run-ons, incoterms, delivery points.", lane: "internal", module: "rfq", href: "/rfq/new", as: U.ada, gate: "HS code required on promo lines; minimum quotes or a bypass reason" },
    { step: "Vendor quotes", detail: "Sealed per-unit prices, alternatives, cartons, weights, samples and emissions declaration.", lane: "vendor", module: "rfq", href: "/vendor/quotes", as: U.tom },
    { step: "Evaluate and approve", detail: "Benchmark, tolerance, savings; finance approves before award.", lane: "internal", module: "rfq", href: "/rfq", as: U.fiona, gate: "Finance approval" },
    { step: "Award checks", detail: "SRM checks purchasing block, MSA and the approver's DOA level; losing quotes declined.", lane: "system", module: "assure", href: "/rfq", as: U.ada, gate: "Automatic checks" },
  ] },
  { key: "commit", title: "4. Commit", summary: "Estimate to the client, then the supplier PO, then the Stocktool hand-off.", steps: [
    { step: "Build the estimate", detail: "Markup or margin, cost split, GSC commission and rebate.", lane: "internal", module: "orders", href: "/orders/estimates", as: U.ada },
    { step: "Finance reviews the estimate", detail: "Low margin or high value needs a finance review.", lane: "internal", module: "finance", href: "/finance/approvals", as: U.fiona, gate: "Finance (thresholds in the Finance+ Watchtower)" },
    { step: "Client approves the estimate", detail: "Approves with their PO number; several client POs can be attached.", lane: "client", module: "orders", href: "/client-portal/estimates", as: U.claire, gate: "Client approver" },
    { step: "Approve the supplier PO", detail: "Needs someone with enough delegated authority for the value.", lane: "internal", module: "orders", href: "/orders/purchase-orders", as: U.ada, gate: "DOA level by value and currency" },
    { step: "Vendor accepts the PO", detail: "Accept or decline with a reason in the vendor portal.", lane: "vendor", module: "orders", href: "/vendor/orders", as: U.tom },
    { step: "Hand off to Stocktool", detail: "estimate.approved with article, PO and SO data; orders on hold show missing fields.", lane: "system", module: "orders", href: "/orders", as: U.ada },
  ] },
  { key: "deliver", title: "5. Produce and deliver", summary: "Production, QA/QC and verified proof of delivery.", steps: [
    { step: "Production and QA/QC", detail: "Vendor submits quality results and control documents.", lane: "vendor", module: "assure", href: "/vendor/quality", as: U.tom },
    { step: "Plan deliveries", detail: "Per destination and spec, from the PO.", lane: "internal", module: "logistics", href: "/logistics/plan", as: U.ada },
    { step: "Ship and upload POD", detail: "Carrier, tracking and proof of delivery in the vendor portal.", lane: "vendor", module: "logistics", href: "/vendor/shipping", as: U.tom },
    { step: "Verify proof of delivery", detail: "8-point check before a delivery counts; transport CO2e recorded.", lane: "internal", module: "logistics", href: "/logistics/pods", as: U.ada, gate: "8-point POD check" },
  ] },
  { key: "execute", title: "6. Execute in store", summary: "Install, prove and audit.", steps: [
    { step: "Schedule deployment", detail: "Install plan per outlet once goods arrive; recces can raise new specs.", lane: "internal", module: "execution", href: "/execution/deployments", as: U.ada },
    { step: "Vendor installs", detail: "Photos and a GPS check in the vendor portal.", lane: "vendor", module: "execution", href: "/vendor/installations", as: U.tom },
    { step: "Audit the install", detail: "Pass or fail; maintenance tickets if needed.", lane: "internal", module: "execution", href: "/execution/deployments", as: U.ada, gate: "Audit pass" },
  ] },
  { key: "pay", title: "7. Pay and bill", summary: "Invoice matched to evidence, vendor paid, client billed.", steps: [
    { step: "Vendor sends the invoice", detail: "Against the accepted PO, in the PO currency, with the PDF.", lane: "vendor", module: "finance", href: "/vendor/invoices", as: U.tom },
    { step: "Match the invoice", detail: "PO value, verified POD and installs must agree; an override needs a second person.", lane: "internal", module: "finance", href: "/finance/invoices", as: U.fiona, gate: "Three-way match; override maker-checker" },
    { step: "Pay the vendor", detail: "Payment schedule on the vendor's terms; status visible to the vendor.", lane: "internal", module: "finance", href: "/finance/payments", as: U.fiona },
    { step: "Bill the client", detail: "Bill from the approved estimate; the client sees it in the Client Portal.", lane: "internal", module: "finance", href: "/finance/billing", as: U.fiona },
    { step: "Client sees and pays the bill", detail: "Sent and paid bills, overdue flagged.", lane: "client", module: "finance", href: "/client-portal/bills", as: U.claire },
  ] },
  { key: "learn", title: "8. Learn and govern", summary: "Results feed the next brief and the supplier scorecard.", steps: [
    { step: "Measure effectiveness", detail: "Spend and execution effectiveness by campaign and market.", lane: "internal", module: "shopper-iq", href: "/shopper-iq/campaigns", as: U.ada },
    { step: "Update the supplier scorecard", detail: "Delivery, quality and compliance feed the PSL.", lane: "internal", module: "assure", href: "/assure/scorecard", as: U.ada },
    { step: "Watch health and approvals", detail: "Every module's health, change requests and audit in one place.", lane: "internal", module: "watchtower", href: "/watchtower", as: U.ada },
    { step: "See every approval", detail: "Admins see every pending approval in every module; overdue ones flagged against the policy.", lane: "internal", module: "watchtower", href: "/watchtower/approvals", as: U.ada },
  ] },
];
