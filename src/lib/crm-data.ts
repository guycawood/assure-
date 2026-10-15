import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  AudienceRow, CadenceRow, CrmActionRow, ReviewRow, EmailRecipientRow, EmailRow, FormRow, ImportLogRow, ListRow, PerformanceRow, StakeholderRow, SurveyRecipientRow, SurveyResultRow, SurveyWaveRow,
  AccountRow, ClientRow, ContactRow, ContractRow, FeedbackRow, HealthRow, InteractionRow, LibOption, MarketOption, OpportunityRow, Person,
  PlanActionRow, PlanRow,
} from "@/lib/crm";
import type { DeliveryKpis } from "@/lib/qaqc";

// Server-side reads for CRM. Everything reads internal views (security invoker), so RLS limits them to adm Indicia staff.
type Client = Awaited<ReturnType<typeof createClient>>;
type Filter = Record<string, string | null | undefined>;

const NUMERIC = ["value", "probability", "weighted_value", "growth_target", "credit_limit", "spend_ytd", "billed_ytd", "satisfaction", "score",
  "default_markup_percent", "gsc_commission_percent", "year_end_rebate_percent", "markup_percent", "min_margin_percent", "rebate_percent",
  "savings_target_percent", "e_tender_threshold", "sell_price", "gross_amount", "net_amount", "amount", "budget",
  "total_budget", "weighted_budget", "overall", "nps", "spend"];

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

// ---------- stage 2 ----------
export const getStakeholders = (s: Client, f: Filter = {}) => list<StakeholderRow>(s, "crm_stakeholders_v", f, ["full_name"]);
export const getPerformance = (s: Client, f: Filter = {}) => list<PerformanceRow>(s, "crm_performance_v", f, ["updated_at", false]);
export const getSurveyWaves = (s: Client) => list<SurveyWaveRow>(s, "crm_survey_waves_v", {}, ["created_at", false]);
export const getSurveyRecipients = (s: Client, waveId: string) => list<SurveyRecipientRow>(s, "crm_survey_recipients_v", { wave_id: waveId }, ["client_name"]);
export const getSurveyResults = (s: Client, f: Filter = {}) => list<SurveyResultRow>(s, "crm_survey_results_v", f, ["created_at", false]);
export const getJobSurveys = (s: Client) =>
  list<{ id: string; job_id: string; project_number: string; client_name: string; contact_name: string; job_title: string; status: string; overall: number | null;
    comment: string | null; spend: number | null; currency: string | null; sent_at: string; responded_at: string | null }>(s, "crm_job_surveys_v", {}, ["sent_at", false]);
export const getForms = (s: Client) => list<FormRow>(s, "crm_forms_v", {}, ["created_at", false]);
export const getFormSubmissions = (s: Client, formId: string) =>
  list<{ id: string; form_id: string; data: Record<string, string>; email: string; full_name: string | null; contact_id: string | null; contact_created: boolean;
    consent: boolean; created_at: string }>(s, "crm_form_submissions", { form_id: formId }, ["created_at", false]);
export const getLists = (s: Client) => list<ListRow>(s, "crm_lists_v", {}, ["created_at", false]);
export const getEmails = (s: Client) => list<EmailRow>(s, "crm_emails_v", {}, ["created_at", false]);
export const getEmailRecipients = (s: Client, emailId: string) => list<EmailRecipientRow>(s, "crm_email_recipients_v", { email_id: emailId }, ["full_name"]);
export const getImportLogs = (s: Client) => list<ImportLogRow>(s, "crm_import_logs_v", {}, ["created_at", false]);

export async function getAudience(s: Client, listId: string): Promise<AudienceRow[]> {
  const { data, error } = await s.rpc("crm_list_audience", { p_list: listId });
  if (error) console.error("[crm] crm_list_audience:", error.message);
  return (data as AudienceRow[] | null) ?? [];
}

/** The survey template a wave uses (sections and questions). */
export async function getTemplate(s: Client, id: string) {
  const { data } = await s.from("library_records").select("id, name, data").eq("id", id).maybeSingle();
  return (data as { id: string; name: string; data: { sections: { key: string; label: string; questions: { code: string; text: string }[] }[]; tools?: string[] } } | null);
}
// ---------- reviews, cadence and actions ----------
export const getReviews = (s: Client, f: Filter = {}) => list<ReviewRow>(s, "crm_reviews_v", f, ["scheduled_on", false]);
export async function getReview(s: Client, id: string): Promise<ReviewRow | null> {
  const { data } = await s.from("crm_reviews_v").select("*").eq("id", id).maybeSingle();
  return (data as ReviewRow | null) ?? null;
}
export const getCadence = (s: Client) => list<CadenceRow>(s, "crm_review_cadence_v", {}, ["client_name"]);
export const getCrmActions = (s: Client, f: Filter = {}) => list<CrmActionRow>(s, "crm_actions_v", f, ["due_date"]);
export const getReviewResponses = (s: Client, reviewId: string) =>
  list<{ review_id: string; user_id: string; response: string; note: string | null; responded_at: string }>(s, "crm_review_responses", { review_id: reviewId }, ["responded_at", false]);

/** OTIF, QA/QC pass rate by level, NCRs and speed to market for one client (last 12 months). */
export async function getClientDeliveryKpis(s: Client, clientId: string): Promise<DeliveryKpis | null> {
  const { data, error } = await s.rpc("crm_client_delivery_kpis", { p_client: clientId, p_months: 12 });
  return error ? null : (data as DeliveryKpis);
}
