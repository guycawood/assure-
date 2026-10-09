// Finance+ types, labels and pure calculations (no I/O, so pages and tests can reuse them).
import type { Tone } from "@/lib/srt";

export type InvoiceStatus = "submitted" | "matching" | "approved" | "scheduled" | "paid" | "disputed" | "rejected";
export type MatchStatus = "not_run" | "matched" | "variance" | "missing_evidence";

export interface MatchDetails {
  checked_at?: string;
  result?: MatchStatus;
  amount?: {
    po_value: number; currency: string; invoice_net: number; other_invoiced: number; invoiced_total: number; variance: number;
    variance_percent: number | null; tolerance_percent: number; tolerance_basis: string; remaining_to_invoice: number; ok: boolean;
  };
  deliveries?: { count: number; delivered: number; pods_unverified: number; ok: boolean;
    items: { id: string; delivery_number: string; status: string; market: string; pods_total: number; pods_verified: number }[] };
  deployments?: { count: number; done: number; ok: boolean; applies: boolean;
    items: { id: string; deployment_code: string; stage: string; audit_status: string }[] };
  missing?: string[];
}

export interface SupplierInvoice {
  id: string; invoice_ref: string; po_id: string; supplier_id: string; job_id: string; invoice_number: string; invoice_date: string;
  payment_terms: string; payment_terms_days: number; due_date: string; currency: string; net_amount: number; vat_amount: number; gross_amount: number;
  file_id: string | null; status: InvoiceStatus; match_status: MatchStatus; match_details: MatchDetails; matched_at: string | null;
  override_reason: string | null; override_requested_by: string | null; override_requested_at: string | null;
  approved_by: string | null; approved_at: string | null; approval_note: string | null; dispute_reason: string | null; rejected_reason: string | null;
  paid_at: string | null; region: string; market: string; submitted_at: string; submitted_by_vendor: boolean;
  po_number: string; po_value: number; po_status: string; supplier_name: string; supplier_code: string; job_number: string; job_title: string;
  client_name: string; file_name: string | null; override_requested_by_name: string | null; approved_by_name: string | null;
  paid_amount: number; scheduled_amount: number; next_due: string | null;
}

export interface PaymentItem {
  id: string; invoice_id: string; seq: number; due_date: string; amount: number; currency: string; paid_at: string | null; paid_on: string | null;
  payment_reference: string | null; invoice_ref: string; invoice_number: string; invoice_status: InvoiceStatus; supplier_id: string; supplier_name: string;
  po_number: string; region: string; market: string; status: "upcoming" | "due" | "overdue" | "paid"; due_week: string; due_month: string; paid_by_name: string | null;
}

export interface ClientBill {
  id: string; bill_number: string; estimate_id: string; job_id: string; client_id: string; billing_entity_id: string | null; client_order_ref: string | null;
  currency: string; net_amount: number; vat_percent: number; vat_amount: number; gross_amount: number; cost_amount: number | null;
  status: "draft" | "sent" | "paid" | "cancelled"; issue_date: string | null; due_date: string | null; sent_at: string | null; paid_at: string | null;
  payment_reference: string | null; cancelled_reason: string | null; notes: string | null; region: string; market: string; created_at: string;
  estimate_number: string; estimate_status: string; job_number: string; job_title: string; client_name: string; client_code: string;
  billing_entity_name: string | null; billing_entity_code: string | null; billing_entity_vat: string | null;
}

export interface FinanceEstimate {
  id: string; estimate_number: string; job_id: string; job_number: string; job_title: string; client_name: string; supplier_name: string;
  status: string; currency: string; base_cost: number; sell_price: number; pricing_mode: string; pricing_percent: number; margin_percent: number | null;
  benchmark_source: string | null; savings_vs_benchmark: number | null; region: string; market: string; approved_at: string | null; client_order_ref: string | null;
  review_status: "approved" | "declined" | null; review_reason: string | null; reviewed_at: string | null; review_stale: boolean;
  review_triggers: string[]; needs_review: boolean; budget: number | null; category: string | null;
}

export interface QuoteQueueRow {
  response_id: string; rfq_id: string; supplier_id: string; currency: string; total_value: number | null; lead_time_days: number | null;
  submitted_at: string | null; source: string; finance_status: "pending" | "approved" | "declined"; finance_notes: string | null; finance_at: string | null;
  rfq_number: string; rfq_title: string; due_at: string; estimated_value: number | null; region: string; market: string;
  job_id: string; job_number: string; client_name: string; supplier_name: string; supplier_code: string; lowest_quote: number | null; quote_count: number;
}

export interface SpendRow {
  estimate_id: string; estimate_number: string; job_id: string; job_number: string; job_title: string; client_id: string; client_name: string;
  region: string; market: string; market_name: string; category: string; supplier_id: string; supplier_name: string; currency: string; estimate_status: string;
  month: string; sell_price: number; base_cost: number; savings_vs_benchmark: number; benchmark_value: number | null; budget: number | null;
  po_id: string | null; po_number: string | null; po_value: number; invoiced: number; invoices_paid: number; invoice_count: number; over_po: boolean;
}

export interface FinanceEvent {
  id: number; entity: string; entity_id: string; invoice_id: string | null; event: string; from_status: string | null; to_status: string | null;
  detail: Record<string, unknown>; actor: string | null; actor_name: string | null; at: string;
}

type Meta = Record<string, { label: string; tone: Tone }>;

export const INVOICE_STATUS: Meta = {
  submitted: { label: "To match", tone: "info" },
  matching: { label: "In review", tone: "accent" },
  approved: { label: "Approved", tone: "ok" },
  scheduled: { label: "Payment scheduled", tone: "ok" },
  paid: { label: "Paid", tone: "neutral" },
  disputed: { label: "Queried", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
};

export const MATCH_STATUS: Meta = {
  not_run: { label: "Not matched yet", tone: "neutral" },
  matched: { label: "Matched", tone: "ok" },
  variance: { label: "Variance", tone: "bad" },
  missing_evidence: { label: "Missing evidence", tone: "warn" },
};

export const PAYMENT_STATUS: Meta = {
  upcoming: { label: "Upcoming", tone: "neutral" },
  due: { label: "Due", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
  paid: { label: "Paid", tone: "ok" },
};

export const BILL_STATUS: Meta = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  paid: { label: "Paid", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const EVENT_LABEL: Record<string, string> = {
  submitted: "Invoice submitted", matched: "Three-way match run", override_requested: "Override requested", approved: "Approved",
  disputed: "Queried with the supplier", dispute_resolved: "Query resolved", rejected: "Rejected", payment_scheduled: "Payment scheduled",
  paid: "Paid", created: "Created", sent: "Sent", cancelled: "Cancelled", finance_approved: "Finance approved", finance_declined: "Finance declined",
};

export const TERMS_LABEL = (t: string) => (t === "immediate" ? "Immediate" : t === "custom" ? "Custom" : t.replace("net_", "Net "));

export function money(v: number | string | null | undefined, currency?: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

/** Compact money for tiles and bars: 12.3k, 1.2m. */
export function moneyShort(v: number, currency?: string | null): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : a >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0);
  return currency ? `${currency} ${s}` : s;
}

export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(digits)}%`);

/** Monday of the ISO week a date falls in (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
export const monthStart = (date: string) => date.slice(0, 7) + "-01";

export type Bucket = { key: string; label: string; amount: number; overdue: number; count: number };

/**
 * Cash-out forecast: unpaid instalments summed by week or month of their due date (one currency at a time).
 * Overdue amounts are rolled into the current period so nothing falls off the front of the chart.
 */
export function cashOutForecast(items: Pick<PaymentItem, "due_date" | "amount" | "paid_at">[], by: "week" | "month", today: string, periods = 8): Bucket[] {
  const keyOf = by === "week" ? weekStart : monthStart;
  const first = keyOf(today);
  const keys: string[] = [];
  const cursor = new Date(first + "T00:00:00Z");
  for (let i = 0; i < periods; i++) {
    keys.push(cursor.toISOString().slice(0, 10));
    if (by === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const map = new Map<string, Bucket>(keys.map((k) => [k, { key: k, label: periodLabel(k, by), amount: 0, overdue: 0, count: 0 }]));
  const later: Bucket = { key: "later", label: "Later", amount: 0, overdue: 0, count: 0 };
  for (const it of items) {
    if (it.paid_at) continue;
    const amt = Number(it.amount);
    let k = keyOf(it.due_date);
    const isOverdue = it.due_date < today;
    if (k < first) k = first;
    const b = map.get(k) ?? later;
    b.amount += amt;
    b.count += 1;
    if (isOverdue) b.overdue += amt;
  }
  return [...map.values(), ...(later.count ? [later] : [])];
}

export function periodLabel(key: string, by: "week" | "month"): string {
  const d = new Date(key + "T00:00:00Z");
  return by === "week"
    ? `w/c ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
    : d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export type SpendDimension = "client" | "region" | "market" | "category" | "supplier" | "month";
export const SPEND_DIMENSIONS: { key: SpendDimension; label: string }[] = [
  { key: "client", label: "Client" }, { key: "region", label: "Region" }, { key: "market", label: "Market" },
  { key: "category", label: "Category" }, { key: "supplier", label: "Supplier" }, { key: "month", label: "Month" },
];

export type SpendGroup = { key: string; label: string; sell: number; cost: number; invoiced: number; savings: number; overPo: number; rows: number };

export function groupSpend(rows: SpendRow[], by: SpendDimension): SpendGroup[] {
  const pick = (r: SpendRow): [string, string] => {
    switch (by) {
      case "client": return [r.client_id, r.client_name];
      case "region": return [r.region, r.region];
      case "market": return [r.market, r.market_name];
      case "category": return [r.category, r.category];
      case "supplier": return [r.supplier_id, r.supplier_name];
      case "month": return [r.month, periodLabel(r.month, "month")];
    }
  };
  const m = new Map<string, SpendGroup>();
  for (const r of rows) {
    const [key, label] = pick(r);
    const g = m.get(key) ?? { key, label, sell: 0, cost: 0, invoiced: 0, savings: 0, overPo: 0, rows: 0 };
    g.sell += Number(r.sell_price);
    g.cost += Number(r.po_value);
    g.invoiced += Number(r.invoiced);
    g.savings += Number(r.savings_vs_benchmark);
    g.overPo += r.over_po ? 1 : 0;
    g.rows += 1;
    m.set(key, g);
  }
  const out = [...m.values()];
  return by === "month" ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.sell - a.sell);
}

/** Currencies present, most-used first (reports show one currency at a time: there is no FX conversion yet). */
export function currencies(rows: { currency: string }[]): string[] {
  const c = new Map<string, number>();
  for (const r of rows) c.set(r.currency, (c.get(r.currency) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** "2026-11-30 1200; 2026-12-31 1200.50" -> [{due_date, amount}] (one per line or separated by ;). */
export function parseInstalments(text: string | null): { items: { due_date: string; amount: number }[]; error?: string } {
  const items: { due_date: string; amount: number }[] = [];
  for (const raw of (text ?? "").split(/[;\n]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2})[\s,]+([\d.,\s]+)$/);
    if (!m) return { items, error: `Couldn't read "${line}". Use one line per payment: date then amount, e.g. 2026-11-30 1200.` };
    const amount = Number(m[2].replace(/[,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return { items, error: `Enter an amount above zero on "${line}".` };
    items.push({ due_date: m[1], amount });
  }
  return { items };
}
