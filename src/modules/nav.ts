import type { ModuleKey } from "./registry";

// Left-sidebar navigation per module (Base44 shell pattern: small uppercase group labels, icon + label items).
// Icons are Google Material Symbols names. `badge` keys are filled in by the platform layout.

export type NavItem = { label: string; href: string; icon: string; exact?: boolean; badge?: "myTickets"; adminOnly?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: Record<ModuleKey, { portal: string; groups: NavGroup[] }> = {
  watchtower: {
    portal: "Oversight",
    groups: [
      { label: "About", items: [{ label: "About Watchtower", href: "/watchtower/about", icon: "info" }] },
      { label: "Overview", items: [
        { label: "System health", href: "/watchtower", icon: "monitoring", exact: true },
        { label: "How modules connect", href: "/watchtower/flow", icon: "account_tree" },
      ] },
      { label: "Module Watchtowers", items: [{ label: "Assure+ Watchtower", href: "/assure/watchtower", icon: "verified_user" }] },
    ],
  },
  briefing: {
    portal: "Creative intake",
    groups: [
      { label: "About", items: [{ label: "About Briefing+", href: "/briefing/about", icon: "info" }] },
      { label: "Overview", items: [{ label: "Overview", href: "/briefing", icon: "space_dashboard", exact: true }] },
    ],
  },
  "shopper-iq": {
    portal: "Insight & measurement",
    groups: [
      { label: "About", items: [{ label: "About Shopper IQ", href: "/shopper-iq/about", icon: "info" }] },
      { label: "Overview", items: [{ label: "Overview", href: "/shopper-iq", icon: "space_dashboard", exact: true }] },
    ],
  },
  sourcing: {
    portal: "Job management",
    groups: [
      { label: "About", items: [{ label: "About Sourcing+", href: "/sourcing/about", icon: "info" }] },
      { label: "Overview", items: [{ label: "Overview", href: "/sourcing", icon: "space_dashboard", exact: true }] },
    ],
  },
  logistics: {
    portal: "Freight & deliveries",
    groups: [
      { label: "About", items: [{ label: "About Logistics+", href: "/logistics/about", icon: "info" }] },
      { label: "Overview", items: [{ label: "Overview", href: "/logistics", icon: "space_dashboard", exact: true }] },
    ],
  },
  execution: {
    portal: "In-store operations",
    groups: [
      { label: "About", items: [{ label: "About Execution+", href: "/execution/about", icon: "info" }] },
      { label: "Overview", items: [{ label: "Overview", href: "/execution", icon: "space_dashboard", exact: true }] },
    ],
  },
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
        { label: "Scorecard & PSL", href: "/assure/scorecard", icon: "leaderboard" },
        { label: "Add supplier", href: "/assure/suppliers/new", icon: "person_add" },
      ] },
      { label: "Governance", items: [{ label: "Assure+ Watchtower", href: "/assure/watchtower", icon: "cell_tower" }] },
      { label: "Administration", items: [{ label: "User access", href: "/assure/admin/users", icon: "group", adminOnly: true }] },
    ],
  },
};
