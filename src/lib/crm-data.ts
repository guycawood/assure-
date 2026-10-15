import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  AccountRow, ClientRow, ContactRow, ContractRow, FeedbackRow, HealthRow, InteractionRow, LibOption, MarketOption, OpportunityRow, Person,
  PlanActionRow, PlanRow,
} from "@/lib/crm";

// Server-side reads for CRM. Everything reads internal views (security invoker), so RLS limits them to adm Indicia staff.
type Client = Awaited<ReturnType<typeof createClient>>;
type Filter = Record<string, string | null | undefined>;

const NUMERIC = ["value", "probability", "weighted_value", "growth_target", "credit_limit", "spend_ytd", "billed_ytd", "satisfaction", "score",
  "default_markup_percent", "gsc_commission_percent", "year_end_rebate_percent", "markup_percent", "min_margin_percent", "rebate_percent",
  "savings_target_percent", "e_tender_threshold", "sell_price", "gross_amount", "net_amount", "amount", "budget"];

function normalise<T>(rows: unknown[] | null): T[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => {
    const o: Record<string, unknown> = { ...r };
    for (const k of NUMERIC) if (o[k] != null && typeof o[k] === "string") o[k] = Number(o[k]);
    return o as T;
  });
}

async function list<T>(s: Client, view: string, filter: Filter = {}, order?: [string, boolean?], limit?: number): Promise<T[]> {
  let q = s.from(view).select("*");
  for (const [k, v] of Object.entries(filter)) if (v) q = q.eq(k, v);
  if (order) q = q.order(order[0], { ascending: order[1] ?? true });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) console.error(`[crm] ${view}:`, error.message);
  return normalise<T>(data as unknown[] | null);
}

export const getClients = (s: Client) => list<ClientRow>(s, "sourcing_clients", {}, ["name"]);
export async function getClient(s: Client, id: string): Promise<ClientRow | null> {
  const { data } = await s.from("sourcing_clients").select("*").eq("id", id).maybeSingle();
  return data ? normalise<ClientRow>([data])[0] : null;
}
export const getAccounts = (s: Client, f: Filter = {}) => list<AccountRow>(s, "crm_accounts_v", f, ["client_name"]);
export const getContacts = (s: Client, f: Filter = {}) => list<ContactRow>(s, "crm_contacts_v", f, ["full_name"]);
export const getOpportunities = (s: Client, f: Filter = {}) => list<OpportunityRow>(s, "crm_opportunities_v", f, ["created_at", false]);
export const getInteractions = (s: Client, f: Filter = {}, limit = 200) => list<InteractionRow>(s, "crm_interactions_v", f, ["occurred_at", false], limit);
export const getPlans = (s: Client, f: Filter = {}) => list<PlanRow>(s, "crm_plans_v", f, ["period_start", false]);
export const getPlanActions = (s: Client, f: Filter = {}) => list<PlanActionRow>(s, "crm_plan_actions_v", f, ["due_date"]);
export const getContracts = (s: Client, f: Filter = {}) => list<ContractRow>(s, "crm_contracts_v", f, ["next_renewal"]);
export const getFeedback = (s: Client, f: Filter = {}) => list<FeedbackRow>(s, "crm_feedback_v", f, ["created_at", false]);
export const getHealth = (s: Client, f: Filter = {}) => list<HealthRow>(s, "crm_client_health", f, ["points", false]);
export const getEvents = (s: Client, clientId: string) =>
  list<{ id: number; entity_type: string; action: string; detail: Record<string, unknown>; actor_name: string | null; at: string }>(s, "crm_events_v", { client_id: clientId }, ["at", false], 40);

export async function getLibrary(s: Client, key: string): Promise<LibOption[]> {
  const { data } = await s.from("library_records").select("id, code, name, data").eq("library_key", key).eq("status", "active").order("name");
  const rows = (data ?? []) as LibOption[];
  return rows.sort((a, b) => Number(a.data?.order ?? 99) - Number(b.data?.order ?? 99) || a.name.localeCompare(b.name));
}

export async function getPeople(s: Client): Promise<Person[]> {
  const { data } = await s.from("profiles").select("id, full_name, email, user_type, is_admin").order("full_name");
  return ((data ?? []) as { id: string; full_name: string | null; email: string; user_type: string; is_admin: boolean }[])
    .filter((p) => p.is_admin || p.user_type === "internal")
    .map((p) => ({ id: p.id, name: p.full_name || p.email, email: p.email }));
}

export async function getMarkets(s: Client): Promise<MarketOption[]> {
  const { data } = await s.from("markets").select("code, name, region_code").eq("active", true).order("name");
  return (data ?? []) as MarketOption[];
}

/** Read-only links into the other sections for one client. */
export async function getClientLinks(s: Client, clientId: string) {
  const [campaigns, jobs, bills] = await Promise.all([
    s.from("campaigns").select("id, campaign_code, name, status, start_date, crm_opportunity_id").eq("client_id", clientId).order("start_date", { ascending: false }),
    s.from("jobs").select("id, job_number, title, market, status, currency, budget").eq("client_id", clientId).order("opened_date", { ascending: false }),
    s.from("client_bills").select("id, bill_number, status, currency, gross_amount, due_date, market").eq("client_id", clientId).order("created_at", { ascending: false }),
  ]);
  const jobRows = normalise<{ id: string; job_number: string; title: string; market: string; status: string; currency: string; budget: number | null }>(jobs.data as unknown[] | null);
  const ids = jobRows.map((j) => j.id);
  const est = ids.length
    ? await s.from("estimates").select("id, estimate_number, job_id, status, currency, sell_price, approved_at").in("job_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  return {
    campaigns: (campaigns.data ?? []) as { id: string; campaign_code: string; name: string; status: string; start_date: string | null; crm_opportunity_id: string | null }[],
    jobs: jobRows,
    estimates: normalise<{ id: string; estimate_number: string; job_id: string; status: string; currency: string; sell_price: number; approved_at: string | null }>(est.data as unknown[] | null),
    bills: normalise<{ id: string; bill_number: string; status: string; currency: string; gross_amount: number; due_date: string | null; market: string }>(bills.data as unknown[] | null),
  };
}
