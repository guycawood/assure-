import type { ModuleKey } from "./registry";

// Left-sidebar navigation per module (Base44 shell pattern: small uppercase group labels, icon + label items).
// Icons are Google Material Symbols names. `badge` keys are filled in by the platform layout.
// Every module has its own Watchtower group; the master Watchtower governs all of them.

export type NavItem = { label: string; href: string; icon: string; exact?: boolean; badge?: "myTickets"; adminOnly?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

const about = (key: string, name: string): NavGroup => ({ label: "About", items: [{ label: `About ${name}`, href: `/${key}/about`, icon: "info" }] });
const overview = (key: string): NavGroup => ({ label: "Overview", items: [{ label: "Overview", href: `/${key}`, icon: "space_dashboard", exact: true }] });
/** The module's own Watchtower: its libraries, change requests and audit trail. */
const watchtower = (key: string, extra: NavItem[] = []): NavGroup => ({
  label: "Module Watchtower",
  items: [
    { label: "Watchtower", href: `/${key}/watchtower`, icon: "cell_tower", exact: true },
    ...extra,
    { label: "Libraries", href: `/${key}/watchtower/libraries`, icon: "library_books" },
    { label: "Change requests", href: `/${key}/watchtower/change-requests`, icon: "rule" },
    { label: "Audit trail", href: `/${key}/watchtower/audit`, icon: "manage_history" },
  ],
});

const SECTION_NAV: Record<Exclude<ModuleKey, "rfq" | "logistics" | "execution">, { portal: string; groups: NavGroup[] }> = {
  watchtower: {
    portal: "Oversight",
    groups: [
      about("watchtower", "Watchtower"),
      { label: "Oversight", items: [
        { label: "System health", href: "/watchtower", icon: "monitoring", exact: true },
        { label: "Approvals", href: "/watchtower/approvals", icon: "approval" },
        { label: "Balanced scorecard", href: "/watchtower/scorecard", icon: "analytics" },
        { label: "End-to-end journey", href: "/watchtower/journey", icon: "route" },
        { label: "How modules connect", href: "/watchtower/flow", icon: "account_tree" },
        { label: "Change requests", href: "/watchtower/change-requests", icon: "rule" },
        { label: "Core principles", href: "/watchtower/libraries/core_principles", icon: "verified" },
        { label: "Delegation of authority", href: "/watchtower/libraries/doa_levels", icon: "approval_delegation" },
      ] },
      { label: "Governed libraries", items: [
        { label: "All libraries", href: "/watchtower/libraries", icon: "library_books", exact: true },
        { label: "Product taxonomy & AAC", href: "/watchtower/taxonomy", icon: "category" },
        { label: "Substrates", href: "/watchtower/libraries/substrates", icon: "layers" },
        { label: "Emission factors", href: "/watchtower/libraries/material_emission_factors", icon: "eco" },
        { label: "Impact Grade", href: "/watchtower/libraries/impact_grade_dimensions", icon: "grade" },
      ] },
      { label: "Layers & platform", items: [
        { label: "Data management", href: "/watchtower/data", icon: "database" },
        { label: "Sustainability", href: "/watchtower/sustainability", icon: "eco" },
        { label: "Internal reporting", href: "/watchtower/reporting", icon: "monitoring" },
        { label: "Audit trail", href: "/watchtower/audit", icon: "manage_history" },
        { label: "Users & access", href: "/assure/admin/users", icon: "group", adminOnly: true },
        { label: "Client access", href: "/watchtower/client-access", icon: "badge" },
        { label: "Client Portal (preview)", href: "/client-portal", icon: "storefront" },
      ] },
    ],
  },
  crm: {
    portal: "Client relationships",
    groups: [
      about("crm", "CRM"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/crm", icon: "space_dashboard", exact: true }] },
      { label: "Clients", items: [
        { label: "Clients", href: "/crm/clients", icon: "apartment" },
        { label: "Contacts (stakeholder grid)", href: "/crm/contacts", icon: "contacts" },
        { label: "Stakeholder mapping", href: "/crm/stakeholders", icon: "hub" },
        { label: "Activity", href: "/crm/activity", icon: "forum" },
      ] },
      { label: "Growth", items: [
        { label: "Pipeline", href: "/crm/pipeline", icon: "filter_alt" },
        { label: "Performance Tracker", href: "/crm/performance", icon: "trending_up" },
        { label: "Account plans", href: "/crm/plans", icon: "flag" },
      ] },
      { label: "Engagement", items: [
        { label: "Satisfaction surveys", href: "/crm/surveys", icon: "rate_review" },
        { label: "Forms", href: "/crm/forms", icon: "dynamic_form" },
        { label: "Lists", href: "/crm/lists", icon: "group_add" },
        { label: "Emails", href: "/crm/emails", icon: "mail" },
      ] },
      { label: "Commercial", items: [
        { label: "Contracts & renewals", href: "/crm/contracts", icon: "contract" },
      ] },
      // Mirrors SRM's business reviews, calendar and action plans, for clients.
      { label: "Reviews & actions", items: [
        { label: "Business reviews", href: "/crm/reviews", icon: "groups" },
        { label: "Review calendar", href: "/crm/calendar", icon: "calendar_month" },
        { label: "Client actions", href: "/crm/actions", icon: "task_alt" },
      ] },
      { label: "Relationship health", items: [
        { label: "Client health", href: "/crm/health", icon: "monitor_heart" },
        { label: "Feedback", href: "/crm/feedback", icon: "reviews" },
      ] },
      // CRM's external half: what the client sees and does (the Client Portal), as the vendor portal is for SRM.
      { label: "External view", items: [
        { label: "Client Portal (preview)", href: "/client-portal", icon: "storefront" },
        { label: "Client Portal access", href: "/watchtower/client-access", icon: "badge" },
      ] },
      { label: "Data", items: [{ label: "HubSpot import & export", href: "/crm/import", icon: "upload_file", adminOnly: true }] },
      watchtower("crm"),
    ],
  },
  briefing: {
    portal: "Creative intake",
    groups: [
      about("briefing", "Briefing+"),
      { label: "Overview", items: [{ label: "Briefs", href: "/briefing", icon: "space_dashboard", exact: true }] },
      { label: "Briefing", items: [
        { label: "New brief", href: "/briefing/new", icon: "add_circle" },
        { label: "Campaigns", href: "/briefing/campaigns", icon: "campaign" },
      ] },
      { label: "AI ideation", items: [
        { label: "Campaign ideation", href: "/briefing/campaign-ideation", icon: "lightbulb" },
        { label: "Bulk ideation", href: "/briefing/bulk", icon: "stacks" },
      ] },
      watchtower("briefing"),
    ],
  },
  "shopper-iq": {
    portal: "Insight & measurement",
    groups: [
      about("shopper-iq", "Shopper IQ"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/shopper-iq", icon: "space_dashboard", exact: true }] },
      { label: "Performance", items: [
        { label: "Campaign performance", href: "/shopper-iq/campaigns", icon: "leaderboard" },
        { label: "Insights for briefing", href: "/shopper-iq/insights", icon: "tips_and_updates" },
      ] },
      { label: "Assets", items: [{ label: "Asset library", href: "/shopper-iq/assets", icon: "photo_library" }] },
      watchtower("shopper-iq"),
    ],
  },
  // Sourcing: jobs, specs and triage, then RFQs (one section; RFQ pages keep their /rfq URLs).
  sourcing: {
    portal: "Specs to award",
    groups: [
      about("sourcing", "Sourcing"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/sourcing", icon: "space_dashboard", exact: true }] },
      { label: "Jobs & specs", items: [
        { label: "Jobs", href: "/sourcing/jobs", icon: "work" },
        { label: "Specs", href: "/sourcing/specs", icon: "layers" },
        { label: "Triage basket", href: "/sourcing/triage", icon: "alt_route" },
        { label: "Technical & packaging data", href: "/sourcing/tech-sheets", icon: "inventory" },
      ] },
      { label: "RFQs", items: [
        { label: "RFQs", href: "/rfq", icon: "request_quote", exact: true },
        { label: "New RFQ", href: "/rfq/new", icon: "add_circle" },
      ] },
      { label: "Administration", items: [{ label: "Clients & access", href: "/sourcing/admin", icon: "settings" }] },
      watchtower("sourcing"),
    ],
  },
  // Order Management: estimates and POs, then Logistics and Execution (one section; their pages keep their URLs).
  orders: {
    portal: "Order to install",
    groups: [
      about("orders", "Order Management"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/orders", icon: "space_dashboard", exact: true }] },
      { label: "Orders", items: [
        { label: "Estimates", href: "/orders/estimates", icon: "receipt_long" },
        { label: "Purchase orders", href: "/orders/purchase-orders", icon: "shopping_cart" },
        { label: "PSA exceptions", href: "/orders/psa", icon: "gavel" },
        { label: "Stocktool hand-off", href: "/orders/outbox", icon: "outbox" },
        { label: "QA/QC and OTIF", href: "/orders/qaqc", icon: "verified" },
      ] },
      { label: "Logistics", items: [
        { label: "Logistics dashboard", href: "/logistics", icon: "local_shipping", exact: true },
        { label: "Deliveries", href: "/logistics/deliveries", icon: "inventory_2" },
        { label: "Plan from a PO", href: "/logistics/plan", icon: "playlist_add" },
        { label: "Proof of delivery", href: "/logistics/pods", icon: "fact_check" },
        { label: "Tracker", href: "/logistics/tracker", icon: "route" },
        { label: "Carriers", href: "/logistics/carriers", icon: "airport_shuttle" },
        { label: "OTIF & CO2e", href: "/logistics/performance", icon: "eco" },
      ] },
      { label: "Execution", items: [
        { label: "Execution dashboard", href: "/execution", icon: "storefront", exact: true },
        { label: "Outlets", href: "/execution/outlets", icon: "store" },
        { label: "Recces", href: "/execution/recces", icon: "straighten" },
        { label: "Deployments", href: "/execution/deployments", icon: "handyman" },
        { label: "Visits", href: "/execution/visits", icon: "event" },
        { label: "Maintenance", href: "/execution/tickets", icon: "build" },
        { label: "Quality gates", href: "/execution/jobs", icon: "verified" },
        { label: "Retail Grade", href: "/execution/retail-grade", icon: "grade" },
      ] },
      watchtower("orders"),
    ],
  },
  finance: {
    portal: "Billing & payments",
    groups: [
      about("finance", "Finance+"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/finance", icon: "space_dashboard", exact: true }] },
      { label: "Work", items: [
        { label: "Approvals", href: "/finance/approvals", icon: "approval" },
        { label: "Supplier invoices", href: "/finance/invoices", icon: "receipt_long" },
        { label: "Payments", href: "/finance/payments", icon: "payments" },
        { label: "Client billing", href: "/finance/billing", icon: "request_quote" },
      ] },
      { label: "Insight", items: [{ label: "Spend & savings", href: "/finance/reports", icon: "monitoring" }] },
      watchtower("finance"),
    ],
  },
  assure: {
    portal: "SRM portal",
    groups: [
      { label: "About", items: [{ label: "About SRM", href: "/assure/about", icon: "auto_awesome" }] },
      { label: "Overview", items: [{ label: "Dashboard", href: "/assure", icon: "space_dashboard", exact: true }] },
      { label: "SRT desk", items: [
        { label: "Onboarding dashboard", href: "/assure/srt", icon: "speed", exact: true },
        { label: "Tickets", href: "/assure/srt/tickets", icon: "inbox", badge: "myTickets" },
        { label: "Gate register", href: "/assure/srt/register", icon: "checklist" },
        { label: "Outbox", href: "/assure/srt/outbox", icon: "outgoing_mail" },
      ] },
      { label: "Suppliers & performance", items: [
        { label: "Supplier directory", href: "/assure/suppliers", icon: "storefront" },
        { label: "Scorecard & PSL", href: "/assure/scorecard", icon: "leaderboard" },
        { label: "Performance", href: "/assure/performance", icon: "monitoring" },
        { label: "Business reviews", href: "/assure/reviews", icon: "groups" },
      ] },
      { label: "Compliance & quality", items: [
        { label: "Compliance", href: "/assure/compliance", icon: "verified", exact: true },
        { label: "Document review", href: "/assure/compliance/review", icon: "fact_check" },
        { label: "Pre-assessments", href: "/assure/pre-assessments", icon: "assignment" },
        { label: "Applications & plans", href: "/assure/applications", icon: "how_to_reg" },
        { label: "Quality", href: "/assure/quality", icon: "rule" },
        { label: "Audit calendar", href: "/assure/audit-calendar", icon: "event" },
      ] },
      { label: "Commercial", items: [{ label: "Contracts", href: "/assure/contracts", icon: "contract" }] },
      { label: "Operations", items: [
        { label: "Action plans", href: "/assure/tasks", icon: "task_alt" },
        { label: "Workflows", href: "/assure/workflows", icon: "account_tree" },
        { label: "Surveys", href: "/assure/surveys", icon: "quiz" },
        { label: "Messages", href: "/assure/messages", icon: "forum" },
        { label: "Training", href: "/assure/training", icon: "school" },
      ] },
      // SRM's external half: the vendor's own portal (onboarding, quotes, POs, shipping, installs, invoices).
      { label: "External view", items: [
        { label: "Vendor portal", href: "/vendor", icon: "handshake" },
        { label: "Public vendor page", href: "/vendor-portal", icon: "public" },
      ] },
      watchtower("assure"),
      { label: "Administration", items: [{ label: "User access", href: "/assure/admin/users", icon: "group", adminOnly: true }] },
    ],
  },
};

/** Sidebar per module key; areas inside a section use their section's sidebar. */
export const NAV: Record<ModuleKey, { portal: string; groups: NavGroup[] }> = {
  ...SECTION_NAV,
  rfq: SECTION_NAV.sourcing,
  logistics: SECTION_NAV.orders,
  execution: SECTION_NAV.orders,
};
