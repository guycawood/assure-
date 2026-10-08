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

export const NAV: Record<ModuleKey, { portal: string; groups: NavGroup[] }> = {
  watchtower: {
    portal: "Oversight",
    groups: [
      about("watchtower", "Watchtower"),
      { label: "Oversight", items: [
        { label: "System health", href: "/watchtower", icon: "monitoring", exact: true },
        { label: "How modules connect", href: "/watchtower/flow", icon: "account_tree" },
        { label: "Change requests", href: "/watchtower/change-requests", icon: "rule" },
        { label: "Core principles", href: "/watchtower/libraries/core_principles", icon: "verified" },
        { label: "Delegation of authority", href: "/watchtower/libraries/doa_levels", icon: "approval_delegation" },
      ] },
      { label: "Governed libraries", items: [
        { label: "All libraries", href: "/watchtower/libraries", icon: "library_books", exact: true },
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
      ] },
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
  rfq: {
    portal: "Quotes & award",
    groups: [
      about("rfq", "RFQ+"),
      { label: "Overview", items: [{ label: "RFQs", href: "/rfq", icon: "request_quote", exact: true }] },
      { label: "Sourcing events", items: [{ label: "New RFQ", href: "/rfq/new", icon: "add_circle" }] },
      watchtower("rfq"),
    ],
  },
  sourcing: {
    portal: "Job management",
    groups: [
      about("sourcing", "Sourcing+"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/sourcing", icon: "space_dashboard", exact: true }] },
      { label: "Jobs & specs", items: [
        { label: "Jobs", href: "/sourcing/jobs", icon: "work" },
        { label: "Specs", href: "/sourcing/specs", icon: "layers" },
        { label: "Triage basket", href: "/sourcing/triage", icon: "alt_route" },
      ] },
      { label: "Administration", items: [{ label: "Clients & access", href: "/sourcing/admin", icon: "settings" }] },
      watchtower("sourcing"),
    ],
  },
  orders: {
    portal: "Estimates & POs",
    groups: [
      about("orders", "Order Management+"),
      { label: "Overview", items: [{ label: "Dashboard", href: "/orders", icon: "space_dashboard", exact: true }] },
      { label: "Orders", items: [
        { label: "Estimates", href: "/orders/estimates", icon: "receipt_long" },
        { label: "Purchase orders", href: "/orders/purchase-orders", icon: "shopping_cart" },
        { label: "PSA exceptions", href: "/orders/psa", icon: "gavel" },
        { label: "Stocktool hand-off", href: "/orders/outbox", icon: "outbox" },
      ] },
      watchtower("orders"),
    ],
  },
  logistics: { portal: "Freight & deliveries", groups: [about("logistics", "Logistics+"), overview("logistics"), watchtower("logistics")] },
  execution: { portal: "In-store operations", groups: [about("execution", "Execution+"), overview("execution"), watchtower("execution")] },
  finance: { portal: "Billing & payments", groups: [about("finance", "Finance+"), overview("finance"), watchtower("finance")] },
  assure: {
    portal: "SRM portal",
    groups: [
      { label: "About", items: [{ label: "About Assure+", href: "/assure/about", icon: "auto_awesome" }] },
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
      watchtower("assure"),
      { label: "Administration", items: [{ label: "User access", href: "/assure/admin/users", icon: "group", adminOnly: true }] },
    ],
  },
};
