// Maps the global process (Global Business Transformation artifact, snapshot in gbt-snapshot.json) onto System Guy.
// One entry per process step: key "<process id>:<step id>".
//
// Status:
//   built    the step is done in the system as the process describes it
//   partial  part of the step is in the system; the note says what is missing
//   manual   done outside the system on purpose (say where, in the note)
//   retired  the step goes away (the note says what replaces it)
//   not_built  assessed: the system does not do this yet (the note says what it would need)
// A step with no entry has not been assessed yet. That is different from "not built", and the view says so.

export type StepStatus = "built" | "partial" | "manual" | "retired" | "not_built";
export type StepLink = { label: string; href: string };
export type StepMapping = {
  status: StepStatus;
  /** Where a person does this step. */
  at?: StepLink[];
  /** The database function or action that does it, for the audit trail. */
  fn?: string;
  note?: string;
};

const brief: StepLink = { label: "Briefing", href: "/briefing" };
const portalBriefs: StepLink = { label: "Client portal briefs", href: "/client-portal/briefs" };
const jobs: StepLink = { label: "Sourcing jobs", href: "/sourcing/jobs" };
const rfq: StepLink = { label: "RFQs", href: "/rfq" };
const pos: StepLink = { label: "Purchase orders", href: "/orders/purchase-orders" };
const vendorOrders: StepLink = { label: "Vendor portal orders", href: "/vendor/orders" };
const clientProofs: StepLink = { label: "Client portal proofs", href: "/client-portal/proofs" };
const suppliers: StepLink = { label: "Suppliers", href: "/assure/suppliers" };
const srt: StepLink = { label: "SRT requests", href: "/assure/srt/requests" };
const scorecard: StepLink = { label: "SRM scorecard", href: "/assure/scorecard" };
const estimates: StepLink = { label: "Estimates", href: "/orders/estimates" };
const clientEstimates: StepLink = { label: "Client portal estimates", href: "/client-portal/estimates" };
const logistics: StepLink = { label: "Logistics deliveries", href: "/logistics/deliveries" };
const logisticsPods: StepLink = { label: "Proofs of delivery", href: "/logistics/pods" };
const vendorShipping: StepLink = { label: "Vendor portal shipping", href: "/vendor/shipping" };
const vendorQuotes: StepLink = { label: "Vendor portal quote requests", href: "/vendor/quotes" };
const vendorCreative: StepLink = { label: "Vendor portal creative requests", href: "/vendor/creative" };
const igJobs: StepLink = { label: "Impact Grade jobs", href: "/impact-grade/jobs" };

export const STEP_MAP: Record<string, StepMapping> = {
  // Client brief (ideation, brief intake)
  "client-brief:b1": { status: "built", at: [portalBriefs, brief], note: "Client submits the brief in the client portal." },
  "client-brief:b2": { status: "built", at: [brief], fn: "brief_set_process", note: "Brief type: artworking, creative ideation, product brief." },
  "client-brief:b3": { status: "partial", at: [brief, jobs], note: "The brief is received and shown on its timeline. The job is created in Sourcing as a separate step." },
  "client-brief:b4": { status: "built", at: [brief], fn: "brief_set_process", note: "Creative needed: yes or no, internal or supplier route." },
  "client-brief:b5": { status: "built", at: [brief], fn: "brief_creative_review", note: "Creative review is required before the brief can be approved." },
  "client-brief:b7": { status: "built", at: [brief], fn: "brief_decide", note: "Approval is blocked until the creative review is done." },
  "client-brief:b6": { status: "built", at: [brief, portalBriefs], fn: "brief_send_back", note: "Returned to the client with a reason and an optional meeting request; the client resubmits." },
  "client-brief:b8": { status: "partial", at: [brief], note: "Approval records the brief as complete. The hand-over to Sourcing or Creative is not automatic yet." },
  "client-brief:ig1": { status: "partial", at: [brief], note: "Concept grades show at ideation against the client's sustainability targets from CRM. The floor is shown, not enforced." },

  // Sourcing (Indicia)
  "sourcing-indicia:c3": { status: "built", at: [{ label: "Campaign ideation", href: "/briefing/campaign-ideation" }], note: "Concepts, visuals and submit for approval." },
  "sourcing-indicia:c4": { status: "built", at: [jobs, { label: "Specs", href: "/sourcing/specs" }] },
  "sourcing-indicia:c5": { status: "built", at: [rfq], fn: "rfq_send", note: "Suppliers are chosen from the eligible pool in SRM." },
  "sourcing-indicia:c6": { status: "built", at: [vendorOrders], fn: "rfq_submit_quote", note: "Quotes are submitted in the vendor portal." },
  "sourcing-indicia:c7": { status: "built", at: [rfq, { label: "Estimates", href: "/orders/estimates" }], fn: "rfq_award" },
  "sourcing-indicia:ig2": { status: "built", at: [rfq, igJobs], fn: "rfq_send", note: "An RFQ cannot be sent until every spec has a calculated grade. A sourcing lead can waive it with a reason." },
  "sourcing-indicia:ig3": { status: "partial", at: [igJobs], fn: "impact_grade_review", note: "The grade uses the supplier's SRM score and a second person reviews it. Recalculation after award and review before the offer are not enforced." },

  // Sourcing (ADM)
  "sourcing-adm:a2": { status: "built", at: [brief] },
  "sourcing-adm:a5": { status: "built", at: [rfq], fn: "rfq_send" },
  "sourcing-adm:a6": { status: "built", at: [vendorOrders], fn: "rfq_submit_quote" },
  "sourcing-adm:a7": { status: "built", at: [rfq, { label: "Estimates", href: "/orders/estimates" }] },
  "sourcing-adm:a8": { status: "built", at: [{ label: "Estimates", href: "/orders/estimates" }] },
  "sourcing-adm:ig4": { status: "built", at: [rfq, igJobs], fn: "rfq_send", note: "Same gate as the Indicia flow." },
  "sourcing-adm:ig5": { status: "partial", at: [igJobs], fn: "impact_grade_review", note: "Same as the Indicia flow: client floor is shown, not enforced before the offer." },

  // QA/QC: PO, proofs, production
  "qa-qc:q2": { status: "built", at: [pos], note: "Supplier PO created from the client PO and sent for approval." },
  "qa-qc:q3": { status: "built", at: [pos] },
  "qa-qc:q4": { status: "built", at: [vendorOrders], note: "Supplier accepts the PO in the vendor portal." },
  "qa-qc:q5": { status: "built", at: [vendorOrders], fn: "vendor_proof_start", note: "Supplier launches a digital or physical proof round." },
  "qa-qc:q6": { status: "built", at: [vendorOrders], fn: "vendor_proof_start", note: "Digital or physical is chosen when the round starts." },
  "qa-qc:q7": { status: "built", at: [vendorOrders], fn: "vendor_proof_submit" },
  "qa-qc:q8": { status: "built", at: [pos], fn: "proof_cs_review", note: "Client services review the proof, then send it to the client." },
  "qa-qc:q9": { status: "built", at: [vendorOrders], fn: "vendor_proof_submit", note: "Physical proof needs the tracking number." },
  "qa-qc:q10": { status: "partial", at: [pos], fn: "proof_cs_review", note: "Review is recorded with a note. Dimension and material checks are not separate fields." },
  "qa-qc:q11": { status: "built", at: [clientProofs], fn: "client_proof_decide" },
  "qa-qc:q12": { status: "built", at: [pos, clientProofs], fn: "client_proof_decide", note: "Approval is recorded and the supplier and internal team are notified." },
  "qa-qc:q13": { status: "built", at: [vendorOrders], fn: "po_vendor_start_production", note: "Production is locked until a proof is approved or staff waive it with a reason." },
  "qa-qc:ig6": { status: "partial", at: [igJobs], note: "Evidence tiers and overrides can be raised and the grade recalculated. Nothing asks for it at goods-in yet." },

  // Supplier onboarding (Indicia)
  "supplier-onboarding-indicia:i1": { status: "built", at: [srt, suppliers], note: "Onboarding request raised in SRM." },
  "supplier-onboarding-indicia:i2": { status: "built", at: [suppliers], note: "Triage approval is requested automatically." },
  "supplier-onboarding-indicia:i3": { status: "built", at: [suppliers], fn: "onboarding_category_interest", note: "A Category Manager who did not raise the request decides. The information request is held until then." },
  "supplier-onboarding-indicia:i4": { status: "built", at: [suppliers], fn: "onboarding_category_interest", note: "Declined with a reason; the request is closed and the requestor is told." },
  "supplier-onboarding-indicia:i6": { status: "built", at: [suppliers], fn: "send_vendor_rfi" },
  "supplier-onboarding-indicia:i7": { status: "built", at: [{ label: "Vendor portal", href: "/vendor" }], note: "Supplier completes the information request in the vendor portal." },
  "supplier-onboarding-indicia:i8": { status: "built", at: [suppliers], fn: "onboarding_external_check", note: "Sedex and FSC results are recorded and feed the SRM scorecard." },
  "supplier-onboarding-indicia:i14": { status: "built", at: [scorecard], note: "SRM scorecard." },
  "supplier-onboarding-indicia:i23": { status: "built", at: [suppliers], note: "The supplier record and system IDs live in SRM." },
  "supplier-onboarding-indicia:ig7": { status: "built", at: [scorecard, suppliers], fn: "onboarding_external_check", note: "Scorecard criteria feed the supplier score in the Impact Grade." },

  // Creative work needed. Assessed 2026-11-12. The brief and concept approval loop is built; the commercial side
  // (retainer, creative quote, PO) and the supplier RFI for creative ideation are not.
  "creative-work:cr1": { status: "built", at: [brief, portalBriefs], note: "A creative ideation brief is submitted in Briefing+ or the client portal." },
  "creative-work:cr2": { status: "partial", at: [brief], fn: "brief_set_process", note: "The route (internal or supplier) is recorded. A named creative resource is not assigned on the brief." },
  "creative-work:cr3": { status: "built", at: [{ label: "CRM clients (Contract & terms)", href: "/crm/clients" }, brief], fn: "crm_client_set_retainer", note: "Retainer flag on the client in CRM, set with a reason and audited. The brief reads it." },
  "creative-work:cr4": { status: "built", at: [brief], fn: "creative_kickoff", note: "A retainer client starts with a kick-off recorded on the brief. Concepts cannot be submitted before it." },
  "creative-work:cr5": { status: "built", at: [brief], fn: "creative_quote_save", note: "Quote on the brief with a basis (fixed fee, hourly or daily rate), amount and scope; sent to the client with creative_quote_send." },
  "creative-work:cr6": { status: "built", at: [portalBriefs], fn: "client_creative_quote_decide", note: "The client's approver approves or does not accept the quote in the portal." },
  "creative-work:cr7": { status: "built", at: [brief], fn: "creative_quote_confirm_po", note: "Staff confirm the approval and the client PO number on the brief. Concepts cannot be submitted before it." },
  "creative-work:cr9": { status: "built", at: [brief, portalBriefs], fn: "client_creative_quote_decide", note: "The rejection reason is required and logged; the project manager is notified and can revise and resend." },
  "creative-work:cr8": { status: "partial", at: [{ label: "Campaign ideation", href: "/briefing/campaign-ideation" }, brief], note: "Ideation, concepts and visuals are built. Production of final creative files is done outside the system." },
  "creative-work:cr10": { status: "built", at: [brief], fn: "brief_set_process", note: "'Supplier input needed' is the supplier route on the brief." },
  "creative-work:cr11": { status: "built", at: [brief], fn: "creative_rfi_create", note: "Supplier brief, IP rule and due date go to panel suppliers chosen from the eligible pool in SRM. Only after the kick-off or confirmed PO." },
  "creative-work:cr12": { status: "built", at: [{ label: "Vendor portal creative requests", href: "/vendor/creative" }], fn: "vendor_creative_rfi_respond", note: "The supplier confirms or declines in the vendor portal; a reason is required to decline." },
  "creative-work:cr12a": { status: "built", at: [{ label: "Vendor portal creative requests", href: "/vendor/creative" }], fn: "vendor_creative_rfi_propose", note: "The supplier accepts the IP rule and uploads its ideation proposal. The team selects one, then presents it as a concept (cr13)." },
  "creative-work:cr12b": { status: "built", at: [brief], fn: "creative_rfi_add_supplier", note: "The rejection reason is kept and the project manager is notified. Another supplier can be added to the RFI." },
  "creative-work:cr13": { status: "built", at: [brief, { label: "Campaign ideation", href: "/briefing/campaign-ideation" }], fn: "concept_decide", note: "Someone other than the submitter approves the concept internally. Then it goes to the client when the approval policy asks for it." },
  "creative-work:cr15": { status: "built", at: [portalBriefs], fn: "client_concept_decide", note: "The client approves or asks for changes on the concept in the portal; changes loop back to the team." },
  "creative-work:cr16": { status: "built", at: [brief], fn: "brief_set_samples", note: "Samples needed or not is recorded on the brief with who decided and a note." },
  "creative-work:cr18": { status: "built", at: [brief, { label: "Vendor portal creative requests", href: "/vendor/creative" }], fn: "sample_request", note: "Ask an eligible supplier for a sample; they ship it with tracking; the team confirms arrival and approves it or asks for changes, which starts another round." },
  "creative-work:cr17": { status: "partial", at: [brief], fn: "brief_archive", note: "A brief can be archived with a note by its author or an admin. A lost-or-cancelled outcome with a required reason is not recorded." },
  "creative-work:cr19": { status: "built", at: [brief, portalBriefs], fn: "creative_delivery_send", note: "The team uploads the final files and sends the delivery; the client is notified and downloads them in the portal. A corrected file goes out as a new delivery." },
  "creative-work:cr20": { status: "partial", at: [{ label: "Billing", href: "/finance/billing" }], note: "Finance issues client invoices. A creative fee on the brief does not create a billing line yet." },

  // Orders and logistics. Assessed 2026-11-12. Supplier POs, DOA approval, vendor acceptance, shipments and verified PODs are built.
  // Sales orders and articles are created in Stocktool from the estimate hand-off. The webshop, order windows, consolidation,
  // warehouse stock, kitting and the ERP postings are not in System Guy.

  // Ad hoc order, supplier PO and SO (adm legacy)
  "order-adhoc-adm:o1": { status: "built", at: [clientEstimates, estimates], fn: "estimate_add_client_po", note: "The client approves the estimate with its PO number, or staff enter the client PO. Several client POs can sit on one estimate." },
  "order-adhoc-adm:o2": { status: "partial", at: [estimates, pos], fn: "po_create_from_estimate", note: "The supplier PO is created from the approved estimate. The sales order is created in Stocktool from the hand-off." },
  "order-adhoc-adm:o3": { status: "partial", at: [pos], fn: "po_create_from_estimate", note: "PO created. There is no VAT engine check on the PO yet, and the sales order is created in Stocktool." },
  "order-adhoc-adm:o4": { status: "built", at: [pos], fn: "po_approve", note: "Approval by delegated authority level and value, by a different person." },
  "order-adhoc-adm:o5": { status: "built", at: [pos, vendorOrders], note: "The PO is issued to the supplier in the vendor portal. Forwarding through RBH is not modelled." },
  "order-adhoc-adm:o6": { status: "built", at: [vendorOrders], fn: "po_vendor_respond", note: "The supplier accepts or declines with a reason." },
  "order-adhoc-adm:o7": { status: "partial", at: [estimates], note: "The client PO is attached to the estimate and goes in the Stocktool hand-off. Stocktool issues the sales order to the client." },

  // Ad hoc order in Sourcing Hub (Indicia legacy)
  "order-adhoc-indicia:p1": { status: "built", at: [clientEstimates], fn: "estimate_add_client_po" },
  "order-adhoc-indicia:p2": { status: "built", at: [estimates, pos], fn: "po_create_from_estimate" },
  "order-adhoc-indicia:p3": { status: "built", at: [pos], fn: "po_approve", note: "Approval by delegated authority and the configurable approval policies in the Watchtower." },
  "order-adhoc-indicia:p4": { status: "built", at: [pos, vendorOrders] },
  "order-adhoc-indicia:p5": { status: "built", at: [vendorOrders], fn: "po_vendor_respond" },

  // Catalogue order and order window (adm legacy)
  "order-catalogue-adm:q1": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-catalogue-adm:q2": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-catalogue-adm:q3": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-catalogue-adm:q4": { status: "built", at: [estimates, clientEstimates], fn: "estimate_chase_client_po", note: "Estimates the client approved without a PO are listed with the wait. A chase is logged and reaches the client's approvers in the portal and by email, at most every 3 days. The client can enter its PO number in the portal." },
  "order-catalogue-adm:q5": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-catalogue-adm:q6": { status: "partial", at: [pos], fn: "po_approve", note: "A supplier PO is signed by delegated authority. It is not consolidated across orders." },
  "order-catalogue-adm:q7": { status: "built", at: [vendorOrders], fn: "po_vendor_respond" },
  "order-catalogue-adm:q8": { status: "manual", note: "The sales order is issued by Stocktool." },

  // Order window: consolidation and delivery planning (Target)
  "order-window:w1": { status: "manual", at: [estimates], note: "Articles and SKU master data are created in Stocktool. System Guy sends the article data in the estimate hand-off." },
  "order-window:w2": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w3": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w4": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w5": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w6": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w7": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w8": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w9": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w10": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w11": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w12": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w13": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w14": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w15": { status: "partial", at: [clientEstimates], fn: "estimate_add_client_po", note: "The client can upload its PO with an estimate approval. It is not raised from a final breakdown." },
  "order-window:w16": { status: "manual", note: "Stocktool owns the catalogue webshop and order windows (decision 2026-11-12). System Guy sends the estimate hand-off." },
  "order-window:w17": { status: "partial", at: [pos], fn: "po_create_from_estimate", note: "A supplier PO is raised and the supplier notified. It is not raised automatically from a validated client PO." },
  "order-window:w18": { status: "partial", at: [vendorOrders], fn: "po_vendor_respond", note: "The supplier accepts the PO. Validating specs and scheduling resource are not separate steps." },
  "order-window:w19": { status: "built", at: [vendorOrders], fn: "po_vendor_start_production", note: "Production is launched in the vendor portal once a proof is approved or waived." },
  "order-window:w20": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "order-window:w21": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "order-window:w22": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "order-window:w23": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "order-window:w24": { status: "partial", at: [logisticsPods], fn: "logistics_pod_verify", note: "Proof of delivery is uploaded and verified. Code scan and an automatic notice to the buying team are not there." },

  // Delivery by incoterm and goods in
  "delivery-incoterm:d1": { status: "partial", at: [vendorShipping], fn: "logistics_vendor_record_shipment", note: "The supplier records the shipment with tracking. A separate 'ready to ship' signal is not recorded." },
  "delivery-incoterm:d2": { status: "built", at: [logistics], fn: "logistics_create_delivery", note: "The incoterm is on the delivery and in the estimate hand-off." },
  "delivery-incoterm:d3": { status: "built", at: [vendorShipping, { label: "Vendor invoices", href: "/vendor/invoices" }], fn: "logistics_vendor_attach_pod", note: "The supplier uploads the POD and sends its invoice in the vendor portal." },
  "delivery-incoterm:d4": { status: "manual", note: "Stocktool books stock-in and posts to the ERP (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "delivery-incoterm:d5": { status: "partial", at: [logisticsPods], note: "The POD is uploaded at final delivery. There is no stock-out booking." },
  "delivery-incoterm:d6": { status: "built", at: [logisticsPods], fn: "logistics_pod_verify", note: "A different person checks the POD against a checklist from the Watchtower; inspections follow the QA/QC plan." },
  "delivery-incoterm:d7": { status: "built", at: [{ label: "Finance client billing", href: "/finance/billing" }, logistics], fn: "finance_bill_readiness", note: "An approved estimate is ready to invoice once its deliveries are delivered and every POD is verified. Finance can waive the check with a reason." },

  // Logistics and warehousing (Target)
  "logistics-stock:g1": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g1a": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g2": { status: "partial", at: [pos], fn: "po_create_from_estimate", note: "The supplier PO is raised from the client's approved estimate. There is no virtual warehouse." },
  "logistics-stock:g3": { status: "built", at: [logistics], fn: "logistics_create_delivery", note: "The incoterm decides who moves the goods and is on the delivery." },
  "logistics-stock:g4": { status: "partial", at: [vendorShipping], fn: "logistics_vendor_record_shipment", note: "The supplier records the shipment. The destination is not a warehouse." },
  "logistics-stock:g5": { status: "built", at: [logistics], fn: "logistics_leg_save", note: "Shipments and legs with carriers, tracking and dates." },
  "logistics-stock:g6": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g7": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g8": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g9": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g10": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g11": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g12": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g13": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g14": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g15": { status: "built", at: [vendorShipping], fn: "logistics_vendor_record_shipment", note: "The supplier despatches to the client and gives tracking." },
  "logistics-stock:g16": { status: "manual", note: "Stocktool or the warehouse supplier owns warehouse stock, kitting, pick and pack (decision 2026-11-12). Logistics+ keeps deliveries and PODs." },
  "logistics-stock:g17": { status: "built", at: [logisticsPods], fn: "logistics_attach_pod", note: "Delivery is confirmed with a proof of delivery and the delivery date." },
  "logistics-stock:g18": { status: "partial", at: [{ label: "Finance client billing", href: "/finance/billing" }], fn: "finance_bill_create", note: "The client bill waits for confirmed delivery (ready to invoice) and is raised per estimate. There is no batch creation across deliveries." },

  // RFP process (Target). Assessed 2026-11-12. The RFQ and quote side is built. The sampling job with its own quote, client approval,
  // sample PO, invoice and conformity check is not: sampling is only a cost and lead time on the quote, and the creative sample
  // request on a brief (cr16 and cr18), which is not tied to an RFP.
  "rfp-process:r1": { status: "built", at: [brief], fn: "brief_decide", note: "The brief is approved, or sent back to the client with a reason and an optional meeting." },
  "rfp-process:r2": { status: "built", at: [brief], fn: "brief_set_process", note: "Creative input needed is recorded on the brief." },
  "rfp-process:r3": { status: "partial", at: [brief], fn: "brief_creative_review", note: "The creative review is recorded before approval. There is no separate technical file request to the creative team." },
  "rfp-process:r4": { status: "built", at: [brief], fn: "brief_send_back", note: "Clear and feasible: the creative review passes it, or it goes back to the client with the reason." },
  "rfp-process:r5": { status: "partial", at: [brief], note: "The route and the creative review are recorded. A named creative resource and an initial technical file are not tracked." },
  "rfp-process:r6": { status: "built", at: [rfq], fn: "rfq_create", note: "An RFQ to one or several eligible suppliers from SRM, with the control matrix applied at send." },
  "rfp-process:r7": { status: "partial", at: [vendorQuotes], note: "Suppliers get the request in the vendor portal. Clarifying questions are not on the RFQ: messaging is general in SRM." },
  "rfp-process:r8": { status: "partial", at: [vendorQuotes], fn: "rfq_decline", note: "A supplier can decline with a reason. There is no explicit 'confirm, will bid' step before quoting." },
  "rfp-process:r9": { status: "built", at: [vendorQuotes], fn: "rfq_submit_quote", note: "The sealed quote with prices per quantity break, lead time, and sample cost and lead time per line." },
  "rfp-process:r10": { status: "built", at: [rfq], fn: "sampling_request", note: "On the RFQ page, ask a supplier that has quoted for a sample quote. That creates the sampling job." },
  "rfp-process:r11": { status: "built", at: [{ label: "Vendor portal sample jobs", href: "/vendor/sampling" }], fn: "vendor_sampling_quote", note: "The supplier gives the sample cost and lead time for the job. The quote line keeps its own sample cost." },
  "rfp-process:r12": { status: "built", at: [rfq], fn: "sampling_decide_approval", note: "The team decides whether the client approves the sample quote." },
  "rfp-process:r13": { status: "built", at: [{ label: "Client portal samples", href: "/client-portal/samples" }], fn: "client_sampling_quote_decide", note: "The client's approver approves with its PO number, or does not accept and the supplier re-quotes." },
  "rfp-process:r14": { status: "built", at: [rfq, { label: "Vendor portal sample jobs", href: "/vendor/sampling" }], fn: "sampling_issue_po", note: "A numbered sample PO is issued and the supplier is notified." },
  "rfp-process:r15": { status: "built", at: [vendorQuotes], fn: "rfq_decline", note: "The supplier declines with a mandatory reason." },
  "rfp-process:r16": { status: "built", at: [{ label: "Vendor portal sample jobs", href: "/vendor/sampling" }], fn: "vendor_sampling_launch", note: "The supplier confirms the launch against the sample PO. Photos or video are required." },
  "rfp-process:r17": { status: "partial", at: [portalBriefs], fn: "client_concept_decide", note: "The client approves or asks for changes on concepts. It is not tied to an RFP sample." },
  "rfp-process:r18": { status: "built", at: [rfq, { label: "Client portal samples", href: "/client-portal/samples" }], fn: "client_sampling_drawing_decide", note: "The team sends the technical drawing; the client's approver signs it off or asks for changes. The supplier cannot launch before sign-off." },
  "rfp-process:r19": { status: "built", at: [{ label: "Vendor portal sample jobs", href: "/vendor/sampling" }], fn: "vendor_sampling_ship", note: "When the client asks for rework, the supplier sends a new sample as the next round." },
  "rfp-process:r20": { status: "built", at: [{ label: "Vendor portal sample jobs", href: "/vendor/sampling" }], fn: "vendor_sampling_ship", note: "The supplier sends the sample with tracking and its invoice number." },
  "rfp-process:r21": { status: "built", at: [rfq], fn: "sampling_review", note: "The team confirms arrival and checks conformity: sample OK or rejected." },
  "rfp-process:r22": { status: "partial", at: [rfq], fn: "sampling_review", note: "Sample OK raises a numbered reception notice and the sample goes to the client. Invoicing the client for the sample is not automated: Finance bills per estimate." },
  "rfp-process:r23": { status: "built", at: [rfq], fn: "sampling_review", note: "A rejected sample needs a reason, invalidates the sample PO and tells the supplier." },
  "rfp-process:r24": { status: "built", at: [{ label: "Client portal samples", href: "/client-portal/samples" }], fn: "client_sampling_sample_decide", note: "The client's approver approves the sample or asks for rework." },
  "rfp-process:r25": { status: "partial", at: [rfq, brief], note: "An approved concept hands off to Sourcing, which creates an RFQ. Confirming the order or books from the sample is not a step." },
  "rfp-process:r26": { status: "built", at: [rfq], fn: "rfq_cancel", note: "An RFQ is cancelled with a reason. Every invited supplier is notified in the portal and by email, with the reason." },
};

export const STATUS_LABEL: Record<StepStatus | "unassessed", string> = {
  built: "Built",
  partial: "Partly built",
  manual: "Done outside",
  retired: "Retired",
  not_built: "Not built",
  unassessed: "Not assessed yet",
};
