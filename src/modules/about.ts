import type { ModuleKey } from "./registry";

// "About this module" content. One structure for every module so the pages read the same way.
// Assure+ carries over the prototype's AssurePlusOverview (pillars, lifecycle, promise and value).

export type AboutFunction = { title: string; body: string; status: "live" | "planned" };
export type ModuleAbout = {
  headline: string;
  summary: string;
  who: string[];
  functions: AboutFunction[];
  inputs: string[];
  outputs: string[];
  sustainability: string;
  data: string;
  governance: string;
  pillars?: { title: string; body: string }[];
  lifecycle?: string[];
  promise?: string[];
  value?: string[];
};

export const ABOUT: Record<ModuleKey, ModuleAbout> = {
  watchtower: {
    headline: "One view of the whole system, and the rules it runs on.",
    summary:
      "Watchtower is the control layer over the platform. Every module has its own Watchtower for its rules, libraries, thresholds and health; they all roll up into this master view, so leadership sees one picture and every rule change is owned, versioned and audited.",
    who: ["Procurement & Supply Chain leadership", "Module owners", "Platform admins", "Data & BI"],
    functions: [
      { title: "System health", body: "Health of every module in one place, cut by region and market.", status: "live" },
      { title: "Module Watchtowers", body: "Each module's rules and methodology, explained and editable by its owners. Assure+ is live with the supplier scoring methodology.", status: "live" },
      { title: "Change requests", body: "Anyone can suggest a change; owners review it against the core principles before it is implemented.", status: "planned" },
      { title: "Unified audit trail", body: "Every governed change across all modules in one trail.", status: "planned" },
      { title: "Shared libraries", body: "Taxonomy, geography and LOCODEs, currency, emission factors, substrates, DOA matrix.", status: "planned" },
    ],
    inputs: ["Health metrics from every module", "Change requests from users"],
    outputs: ["Approved rules and libraries used by every module", "Leadership reporting"],
    sustainability: "Owns the shared emission factors, substrate library and Impact Grade methodology, so every module calculates the same way.",
    data: "Holds the canonical master data (regions, markets, clients, taxonomy) every other module references.",
    governance: "Rules are versioned and effective-dated; nothing is edited in place, it is superseded, with a named owner and an audit entry.",
  },
  briefing: {
    headline: "Better briefs, the cheapest lever on cost to serve.",
    summary:
      "Briefing+ is where work starts. Campaigns are set up centrally and briefed per market, with completeness scored against the fields that actually drive price, and sustainability targets captured before anything is designed.",
    who: ["Account and client service teams", "Creative and design", "Market leads"],
    functions: [
      { title: "Campaign set-up", body: "Central campaigns with brand, objectives, channels and path-to-purchase, feeding Shopper IQ.", status: "live" },
      { title: "Briefs per market", body: "Market briefs with timings, quantities, store formats and an approval queue.", status: "live" },
      { title: "Brief completeness score", body: "Live red/amber/green completeness on the fields that drive price, quality and compliance.", status: "planned" },
      { title: "AI ideation", body: "Concepts generated from approved, lower-impact materials.", status: "live" },
    ],
    inputs: ["Client objectives", "Shopper IQ insight on what worked"],
    outputs: ["Approved briefs that become specs in Sourcing+"],
    sustainability: "Sustainability targets are set on the brief and only approved low-impact materials are offered in ideation.",
    data: "Every brief carries the Shopper IQ taxonomy and separate region and market fields from the start.",
    governance: "Brief field library and completeness rules governed in the Briefing+ Watchtower.",
  },
  "shopper-iq": {
    headline: "What to make, and what worked.",
    summary:
      "Shopper IQ captures a performance taxonomy as work happens, from campaign to spec to order to asset, so spend and execution effectiveness can be compared by campaign, channel, touchpoint and market, and fed straight into the next brief.",
    who: ["Clients and account leads", "Strategy and insight", "Category management"],
    functions: [
      { title: "Performance taxonomy", body: "Campaign, job, spec and order attributes captured once, as the work is done.", status: "live" },
      { title: "Visual asset library", body: "Art, renders and in-store images with metadata applied automatically.", status: "live" },
      { title: "Spend and effectiveness", body: "Spend and execution scores by campaign, path-to-purchase stage, channel, touchpoint and market.", status: "live" },
      { title: "Comparisons", body: "Brand versus competitor execution, market versus market.", status: "planned" },
    ],
    inputs: ["Campaigns and briefs", "Specs, orders and costs", "Executional images and audits"],
    outputs: ["Insight that shapes the next brief", "Client effectiveness reporting"],
    sustainability: "Shows the footprint of each campaign alongside its effectiveness, so lower-impact executions can be chosen on evidence.",
    data: "Global and client-specific value sets, governed in the Shopper IQ Watchtower; region and market kept separate.",
    governance: "Taxonomy values are versioned so history stays comparable when lists change.",
  },
  sourcing: {
    headline: "Price what we've bought before. Source properly what we haven't.",
    summary:
      "Sourcing+ turns briefs into job bags and specs, then decides the route for every line before a supplier is contacted: Adopt (rate card), Adapt (priced in the band), Create (RFQ) or Push (supplier confirms our price). Create and Push lines go to RFQ+; priced lines go straight to Order Management+.",
    who: ["Buyers and production teams", "Sourcing and category leads", "Finance approvers"],
    functions: [
      { title: "Jobs and specs", body: "Job bags and specs with BOM, CO2e and Impact Grade.", status: "live" },
      { title: "Triage", body: "Every line routed Adopt (rate card), Adapt (priced in the band), Create (RFQ) or Push (supplier confirms our price).", status: "live" },
      { title: "Rate cards and bands", body: "Agreed prices and tolerance bands that let repeat work skip the RFQ.", status: "live" },
      { title: "Spec library", body: "Every spec kept with its price and route, so the next match is faster.", status: "live" },
    ],
    inputs: ["Approved briefs", "Eligible vendors and scores from Assure+", "Rate cards and price history"],
    outputs: ["Create and Push lines to RFQ+", "Priced lines to Order Management+"],
    sustainability: "CO2e and Impact Grade on every spec; vendor emissions declarations and sustainability weighting in quote evaluation.",
    data: "Spec library and price history are the basis for triage; every job, spec, RFQ and PO carries region and market.",
    governance: "Sourcing control matrix, client commercial rules, DOA and threshold alerts in the Sourcing+ Watchtower.",
  },
  rfq: {
    headline: "Competitive tension where it adds value, and nowhere else.",
    summary:
      "RFQ+ runs the sourcing events that triage sends to it: Create lines that need a real RFQ, and Push lines where we state the price and the supplier confirms. Only eligible vendors are invited, minimum quotes are enforced, quotes are sealed, and award goes through finance approval and Assure+ checks.",
    who: ["Buyers and production teams", "Sourcing and category leads", "Finance approvers", "Vendors (through Supplier Engagement)"],
    functions: [
      { title: "RFQs from triage", body: "Built from the spec lines Sourcing+ triage routes to Create or Push.", status: "live" },
      { title: "Eligible vendors only", body: "Onboarded, unblocked vendors that meet the spec's gates; minimum quotes per the sourcing control matrix.", status: "live" },
      { title: "Sealed quotes", body: "Vendors quote per quantity break in the vendor portal; nobody sees a competitor's price.", status: "live" },
      { title: "Evaluate and award", body: "Benchmark within tolerance, should-cost corridor, savings, finance approval, award checks; losing quotes declined.", status: "live" },
      { title: "Threshold alerts", body: "High-value RFQs flagged per country for extra scrutiny.", status: "live" },
    ],
    inputs: ["Create and Push lines from Sourcing+", "Eligible vendors and scores from Assure+"],
    outputs: ["Awarded prices to Sourcing+ and Order Management+", "Quote history for price curves and the scorecard"],
    sustainability: "Vendors declare emissions data with their quote, and sustainability carries a weight in evaluation.",
    data: "Every quote line is kept, so price curves, dispersion and benchmarks come from real history.",
    governance: "Sourcing control matrix, threshold alert rules and bypass reasons are governed in the RFQ+ Watchtower.",
  },
  orders: {
    headline: "From award to a signed-off order, with the right approvals.",
    summary:
      "Order Management+ turns awarded prices into client estimates and supplier purchase orders, applies delegation-of-authority approval, gets the vendor's acceptance, and tracks each order through production to delivery, handing approved estimates to Stocktool.",
    who: ["Account and production teams", "DOA approvers", "Finance", "Vendors (through Supplier Engagement)"],
    functions: [
      { title: "Estimates", body: "Markup or margin, savings and gainshare, client acceptance.", status: "live" },
      { title: "Supplier POs", body: "PO numbers from a sequence; approval blocked if the approver's DOA level is too low.", status: "live" },
      { title: "Vendor acceptance and production", body: "Vendors accept POs and update production status in the portal.", status: "live" },
      { title: "Control documents", body: "GRN, delivery notes, invoices and certificates checked against the category's requirements.", status: "live" },
      { title: "Stocktool hand-off", body: "Approved estimates become an integration event with the Article/PO/SO payload.", status: "live" },
    ],
    inputs: ["Awarded prices from RFQ+", "Approved specs from Sourcing+"],
    outputs: ["Deliveries for Logistics+", "Invoices and payment schedules for Finance+"],
    sustainability: "Emissions declarations and material data travel with the PO so footprints can be reported.",
    data: "One order record links job, spec, quote, PO, deliveries and invoices.",
    governance: "DOA levels, document requirements and approval rules governed in the Order Management+ Watchtower.",
  },
  finance: {
    headline: "Approve the commercials, close the loop on payment.",
    summary:
      "Finance+ approves quotes and estimates before award, matches supplier invoices to POs and proven deliveries, runs client billing and payment schedules, and reports spend and savings by region and market.",
    who: ["Finance and FSSC", "Account leads", "Procurement leadership"],
    functions: [
      { title: "Quote approvals", body: "Finance approval on quotes and estimates before award.", status: "live" },
      { title: "Invoice matching", body: "Supplier invoices matched to PO, delivery and installation evidence.", status: "live" },
      { title: "Billing and payments", body: "Client billing, payment schedules and terms.", status: "live" },
      { title: "Spend and savings", body: "Reconciled spend, fee and savings in one view.", status: "live" },
    ],
    inputs: ["Estimates and POs from Order Management+", "Proof of delivery and installs", "Vendor invoices via Supplier Engagement"],
    outputs: ["Approved commercials", "Payments and spend reporting"],
    sustainability: "Shows carbon alongside spend so cost and footprint are reported together.",
    data: "Spend by client, region, market, category and supplier from one source.",
    governance: "Payment terms, approval thresholds and billing entities governed in the Finance+ Watchtower.",
  },  logistics: {
    headline: "Every delivery tracked, proven and counted.",
    summary:
      "Logistics+ moves goods from vendor to every destination: deliveries per destination, shipments and legs, proof of delivery verified against an 8-point check, and transport emissions recorded for every delivery.",
    who: ["Logistics coordinators", "Account teams", "Vendors (through the Assure+ vendor portal)"],
    functions: [
      { title: "Deliveries and shipments", body: "Per destination, per spec, with legs, carriers and milestones.", status: "live" },
      { title: "Proof of delivery", body: "Vendor uploads POD; 8-point verification before a delivery counts.", status: "live" },
      { title: "Carrier performance", body: "On-time performance by carrier and lane.", status: "live" },
      { title: "Transport CO2e", body: "Emissions snapshot per delivery (Scope 3 category 4).", status: "live" },
    ],
    inputs: ["Supplier POs from Sourcing+"],
    outputs: ["Confirmed deliveries for Execution+", "OTIF for the Assure+ scorecard"],
    sustainability: "Transport CO2e is calculated per delivery from distance, mode and weight, with the factors held in Watchtower.",
    data: "Origin and destination markets kept separately; UN/LOCODE for locations.",
    governance: "Transport emission factors, POD checklist and carrier library in the Logistics+ Watchtower.",
  },
  execution: {
    headline: "Proof that what was paid for is in store and working.",
    summary:
      "Execution+ covers the last mile: outlets, recces, deployments and vendor installation with photo and GPS evidence, then maintenance and audits through to job close.",
    who: ["Field and execution teams", "Account teams", "Installers (through the Assure+ vendor portal)"],
    functions: [
      { title: "Outlets and recces", body: "Store survey data; specs can be created straight from a recce.", status: "live" },
      { title: "Deployments and installs", body: "Vendor installation with photos and a GPS check.", status: "live" },
      { title: "Maintenance and audits", body: "Maintenance tickets and pass/fail deployment audits.", status: "live" },
      { title: "Quality gates to close", body: "Mock-up, production, installation and post-production gates before a job closes.", status: "live" },
    ],
    inputs: ["Deliveries from Logistics+", "Specs from Sourcing+"],
    outputs: ["Executional images for Shopper IQ", "Quality results for the Assure+ scorecard"],
    sustainability: "Tracks reuse and maintenance of permanent displays, extending their life instead of replacing them.",
    data: "Outlets by market with location codes; every install tied to the spec that was paid for.",
    governance: "Display scoring methodology and install evidence rules in the Execution+ Watchtower.",
  },
  assure: {
    headline: "One vendor community. One global partnership.",
    summary:
      "Assure+ manages the supply base: onboarding through the SRT desk, compliance, scoring and the Preferred Supplier List. It decides which vendors can be invited, awarded and paid. Vendors themselves engage at set points in the journey (onboarding, quoting, PO acceptance and production, shipping, installation, invoicing) through the vendor portal.",
    who: ["SRT desk and procurement", "Category management", "Finance and the Procurement head", "Vendors (vendor portal)"],
    functions: [
      { title: "SRT desk", body: "Onboarding tickets, 14 gates, vendor information requests and Procurement head approval.", status: "live" },
      { title: "Supplier register", body: "Every supplier against the gates, with automatic purchasing blocks.", status: "live" },
      { title: "Scorecard & PSL", body: "Financial, Compliance and Performance scores and the Preferred Supplier List.", status: "live" },
      { title: "Assure+ Watchtower", body: "Scoring methodology explained and governed by admins.", status: "live" },
      { title: "Performance, quality & reviews", body: "Performance records and issues, inspections and NCRs, corrective actions, business reviews.", status: "live" },
      { title: "Compliance, contracts & operations", body: "Certificates and document review, pre-assessments, contracts, action plans, surveys, workflows, messages, training.", status: "live" },
      { title: "Vendor portal", body: "Subscription, quote requests and pricing, production updates, QA/QC, invoices and documents.", status: "planned" },
    ],
    inputs: ["New vendor requests", "Vendor documents and certifications", "Delivery, quality and price data from every module"],
    outputs: ["Who can quote, be awarded and be paid", "Supplier scores and the PSL", "Vendor-side actions on every job"],
    sustainability: "CSR, EMS, FSC, SEDEX and renewable energy are scored; certificates are tracked with expiry; Scope 3 by supplier.",
    data: "One supplier record with real links to every job, quote and PO; region and market held separately.",
    governance: "Gates, SLAs and the scoring methodology are versioned in the Assure+ Watchtower with a full change log.",
    pillars: [
      { title: "Performance", body: "Delivery, quality and responsiveness measured on every job." },
      { title: "Sustainability", body: "Audits, certifications and footprint built into the score." },
      { title: "Commercial", body: "Fair, competitive and transparent terms." },
      { title: "Collaboration", body: "One place to work together on every job." },
      { title: "Transparency", body: "Vendors see how they are scored and why." },
    ],
    lifecycle: ["Discover", "Engage", "Improve", "Grow"],
    promise: ["Transparent partnership", "Fair and ethical", "Data-led decisions", "Sustainable growth"],
    value: ["Greater visibility", "Stronger performance", "Actionable insights", "More opportunities"],
  },
};
