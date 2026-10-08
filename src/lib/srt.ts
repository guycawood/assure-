// Shared SRT domain types, labels and display helpers.

export type Rag = "green" | "amber" | "red";
export type GateStatus = "missing" | "requested" | "received" | "verified" | "rejected" | "not_required";
export type TicketStatus = "new" | "triage" | "in_progress" | "waiting_vendor" | "waiting_finance" | "resolved";
export type TicketType =
  | "new_onboarding" | "document_verification" | "missing_document" | "remediation"
  | "certificate_renewal" | "bank_change" | "query" | "deactivation";
export type Priority = "urgent" | "high" | "normal" | "low";
export type SrtRole = "agent" | "lead" | "finance" | "procurement";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  user_type: "internal" | "vendor" | "client";
  is_admin: boolean;
  srt_role: SrtRole | null;
  supplier_id: string | null;
}

export interface Supplier {
  id: string;
  supplier_code: string | null;
  name: string;
  market: string | null;
  region: string | null;
  client: string | null;
  category: string | null;
  status: string;
  tier: string | null;
  primary_contact_email: string | null;
  onboarding_route: "standard" | "fast_track";
  fast_track_justification: string | null;
  fast_track_approved_by: string | null;
  fast_track_approved_at: string | null;
  fast_track_close_by: string | null;
  ytd_spend: number;
  strategic: boolean;
  active: boolean;
  srt_owner: string | null;
  procurement_owner: string | null;
  notes: string | null;
  rag: Rag;
  priority_tier: number | null;
  gates_clear: number;
  critical_open: number;
  onboarding_status: string;
  purchasing_blocked: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GateDefinition {
  key: string;
  label: string;
  stage: string;
  critical: boolean;
  has_expiry: boolean;
  verifier_role: "srt" | "finance" | "quality" | "category";
  sort: number;
}

export interface SupplierGate {
  supplier_id: string;
  gate_key: string;
  status: GateStatus;
  expiry_date: string | null;
  note: string | null;
  rejection_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface Ticket {
  id: string;
  ticket_no: number;
  type: TicketType;
  title: string;
  description: string | null;
  supplier_id: string | null;
  prospect_name: string | null;
  client: string | null;
  market: string | null;
  gate_key: string | null;
  priority: Priority;
  status: TicketStatus;
  assignee: string | null;
  owner: string | null;
  due_date: string | null;
  source: string;
  resolution: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketActivity {
  id: number;
  ticket_id: string;
  kind: "comment" | "event";
  body: string;
  actor: string | null;
  created_at: string;
}

export interface GateAudit {
  id: number;
  supplier_id: string;
  gate_key: string;
  from_status: string | null;
  to_status: string | null;
  expiry_from: string | null;
  expiry_to: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
}

export const GATE_STATUS: { value: GateStatus; label: string }[] = [
  { value: "missing", label: "Missing" },
  { value: "requested", label: "Requested" },
  { value: "received", label: "Received – to check" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "not_required", label: "Not required" },
];

export const TICKET_TYPES: { value: TicketType; label: string }[] = [
  { value: "new_onboarding", label: "New vendor onboarding" },
  { value: "document_verification", label: "Document verification" },
  { value: "missing_document", label: "Missing document" },
  { value: "remediation", label: "Compliance remediation" },
  { value: "certificate_renewal", label: "Certificate renewal" },
  { value: "bank_change", label: "Bank detail change" },
  { value: "query", label: "Query / escalation" },
  { value: "deactivation", label: "Deactivation" },
];

export const TICKET_STATUS: { value: TicketStatus; label: string; tone: Tone }[] = [
  { value: "new", label: "New", tone: "info" },
  { value: "triage", label: "Triage", tone: "info" },
  { value: "in_progress", label: "In progress", tone: "accent" },
  { value: "waiting_vendor", label: "Waiting on vendor", tone: "warn" },
  { value: "waiting_finance", label: "Waiting on Finance", tone: "warn" },
  { value: "resolved", label: "Resolved", tone: "ok" },
];

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export const CLIENTS = ["Unilever", "Heineken", "Coloplast", "BAU", "Other"] as const;
export const REGIONS = ["APAC", "EMEA", "Americas", "GSC"] as const;

export const SRT_ROLES: { value: SrtRole; label: string; description: string }[] = [
  { value: "agent", label: "SRT agent", description: "Works tickets and verifies most gates" },
  { value: "lead", label: "SRT lead", description: "Also approves fast-track, marks gates not required, changes due dates" },
  { value: "finance", label: "Finance", description: "Verifies bank details" },
  { value: "procurement", label: "In-market procurement", description: "Raises requests and chases vendors" },
];

export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral";

export const TIER_LABEL: Record<number, string> = {
  1: "Tier 1 · Immediate",
  2: "Tier 2 · Priority",
  3: "Tier 3 · Standard",
  4: "Tier 4 · Dormant",
};
export const TIER_TONE: Record<number, Tone> = { 1: "bad", 2: "warn", 3: "info", 4: "neutral" };
export const RAG_LABEL: Record<Rag, string> = { green: "Green", amber: "Amber", red: "Red" };

export const label = <T extends string>(list: { value: T; label: string }[], v: T | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? v ?? "";

export const ticketRef = (n: number) => `SRT-${String(n).padStart(5, "0")}`;

export const today = () => new Date().toISOString().slice(0, 10);

export function effectiveGateState(g: Pick<SupplierGate, "status" | "expiry_date">): GateStatus | "expired" {
  if ((g.status === "verified" || g.status === "received") && g.expiry_date && g.expiry_date < today()) return "expired";
  return g.status;
}

export const isOverdue = (t: Pick<Ticket, "status" | "due_date">) =>
  t.status !== "resolved" && !!t.due_date && t.due_date < today();

export const personName = (p: Pick<Profile, "full_name" | "email"> | undefined | null) =>
  p ? p.full_name || p.email : "Unassigned";

export function formatDate(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatEur(n: number | null | undefined) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n ?? 0);
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}
