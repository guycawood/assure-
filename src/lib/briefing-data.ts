// Briefing+ reads (server side). Every query runs as the signed-in user under RLS.
import type { createClient } from "@/lib/supabase/server";
import type { Brief, BriefApproval, BriefEvent, BriefRevision, Campaign, ConceptRow, MessageRow } from "@/lib/briefing";

type Client = Awaited<ReturnType<typeof createClient>>;

export type Substrate = { id: string; code: string | null; name: string; data: Record<string, unknown> };
export type LibraryRecord = { id: string; code: string | null; name: string; data: Record<string, unknown> };
export type Handoff = { id: string; brief_id: string; concept_id: string; payload: Record<string, unknown>; status: "pending" | "accepted"; created_by: string | null; created_at: string; accepted_at: string | null };
export type SessionRow = { id: string; kind: "brief" | "campaign"; brief_id: string | null; bulk_run_id: string | null; objective: string | null; context: Record<string, unknown>; creative_params: Record<string, string>; created_by: string | null; created_at: string };

export async function getBriefs(supabase: Client): Promise<Brief[]> {
  const { data } = await supabase.from("briefs_v").select("*").order("created_at", { ascending: false }).limit(1000);
  return (data as Brief[]) ?? [];
}

export async function getBrief(supabase: Client, id: string): Promise<Brief | null> {
  const { data } = await supabase.from("briefs_v").select("*").eq("id", id).maybeSingle();
  return (data as Brief) ?? null;
}

export async function getBriefHistory(supabase: Client, id: string) {
  const [rev, appr, ev, ho] = await Promise.all([
    supabase.from("brief_revisions").select("*").eq("brief_id", id).order("version"),
    supabase.from("brief_approvals").select("*").eq("brief_id", id).order("decided_at"),
    supabase.from("brief_events").select("*").eq("brief_id", id).order("at"),
    supabase.from("brief_handoffs").select("*").eq("brief_id", id).order("created_at"),
  ]);
  return {
    revisions: (rev.data as BriefRevision[]) ?? [],
    approvals: (appr.data as BriefApproval[]) ?? [],
    events: (ev.data as BriefEvent[]) ?? [],
    handoffs: (ho.data as Handoff[]) ?? [],
  };
}

export async function getCampaigns(supabase: Client): Promise<Campaign[]> {
  const { data } = await supabase.from("campaigns_v").select("*").order("created_at", { ascending: false }).limit(500);
  return (data as Campaign[]) ?? [];
}

export async function getCampaign(supabase: Client, id: string): Promise<Campaign | null> {
  const { data } = await supabase.from("campaigns_v").select("*").eq("id", id).maybeSingle();
  return (data as Campaign) ?? null;
}

export async function getCampaignMarkets(supabase: Client, id: string): Promise<{ region: string; market: string }[]> {
  const { data } = await supabase.from("campaign_markets").select("region, market").eq("campaign_id", id).order("market");
  return (data as { region: string; market: string }[]) ?? [];
}

/** Active records of a Watchtower library (substrates, touchpoint_types, p2p_stages ...). */
export async function getLibrary(supabase: Client, key: string): Promise<LibraryRecord[]> {
  const { data } = await supabase.from("library_records").select("id, code, name, data, status, library_key").eq("library_key", key).eq("status", "active").order("name");
  return ((data as LibraryRecord[]) ?? []);
}

export async function getSubstrates(supabase: Client): Promise<Substrate[]> {
  return getLibrary(supabase, "substrates");
}

export async function getLatestSession(supabase: Client, briefId: string): Promise<SessionRow | null> {
  const { data } = await supabase.from("ideation_sessions").select("*").eq("brief_id", briefId).order("created_at", { ascending: false }).limit(1);
  return ((data as SessionRow[]) ?? [])[0] ?? null;
}

export async function getSession(supabase: Client, id: string): Promise<SessionRow | null> {
  const { data } = await supabase.from("ideation_sessions").select("*").eq("id", id).maybeSingle();
  return (data as SessionRow) ?? null;
}

export async function getSessionTranscript(supabase: Client, sessionId: string) {
  const [m, c] = await Promise.all([
    supabase.from("ideation_messages").select("*").eq("session_id", sessionId).order("id"),
    supabase.from("ideation_concepts").select("*").eq("session_id", sessionId).order("idx"),
  ]);
  const messages = (m.data as MessageRow[]) ?? [];
  const all = (c.data as ConceptRow[]) ?? [];
  const lastMsg = Math.max(0, ...all.map((x) => x.message_id));
  return { messages, concepts: all.filter((x) => x.message_id === lastMsg).sort((a, b) => a.idx - b.idx), allConcepts: all };
}

export async function getHandoffsForBrief(supabase: Client, briefId: string): Promise<Handoff[]> {
  const { data } = await supabase.from("brief_handoffs").select("*").eq("brief_id", briefId);
  return (data as Handoff[]) ?? [];
}

/** Every concept on a brief that has entered the approval flow (any session). */
export async function getBriefConceptsInApproval(supabase: Client, briefId: string): Promise<ConceptRow[]> {
  const { data } = await supabase.from("ideation_concepts").select("*").eq("brief_id", briefId).neq("status", "proposed").order("submitted_at", { ascending: false });
  return (data as ConceptRow[]) ?? [];
}

/** Campaign ideation concepts in the approval flow (plus one picked concept, whatever its state). */
export async function getCampaignConcepts(supabase: Client, pickId?: string): Promise<(ConceptRow & { objective: string | null; context: Record<string, unknown> })[]> {
  const { data } = await supabase.from("ideation_concepts").select("*").eq("kind", "product_type").order("created_at", { ascending: false }).limit(200);
  const rows = ((data as ConceptRow[]) ?? []).filter((c) => !c.brief_id && ((c.status && c.status !== "proposed") || c.id === pickId));
  const sids = [...new Set(rows.map((c) => c.session_id))];
  const { data: sess } = sids.length ? await supabase.from("ideation_sessions").select("id, objective, context").in("id", sids) : { data: [] };
  const byId = new Map(((sess as { id: string; objective: string | null; context: Record<string, unknown> }[]) ?? []).map((s) => [s.id, s]));
  return rows.map((c) => ({ ...c, objective: byId.get(c.session_id)?.objective ?? null, context: byId.get(c.session_id)?.context ?? {} }));
}

/** Which of these concepts the signed-in user may approve now (concept_can_decide). */
export async function conceptDecisionRights(supabase: Client, concepts: Pick<ConceptRow, "id" | "status">[]): Promise<Record<string, boolean>> {
  const waiting = concepts.filter((c) => c.status === "submitted_for_approval");
  const res = await Promise.all(waiting.map((c) => supabase.rpc("concept_can_decide", { p_concept: c.id })));
  return Object.fromEntries(waiting.map((c, i) => [c.id, res[i].data === true]));
}

/** Does a CONCEPT approval policy apply to this brief? (approval_policy_for, most specific active policy.) */
export async function conceptPolicy(supabase: Client, b: { client_id?: string | null; market: string | null; budget_high: number | null }) {
  const { data } = await supabase.rpc("approval_policy_for", { p_type: "CONCEPT", p_client: b.client_id ?? null, p_market: b.market, p_value: b.budget_high });
  const row = ((data as { code: string; approver_role: string | null; client_approval_required: boolean }[] | null) ?? [])[0];
  return row ?? null;
}

export type ConceptAudit = { id: number; concept_id: string; stage: "internal" | "client"; action: string; comments: string | null; actor_name: string | null; at: string };
export async function getConceptAudit(supabase: Client, conceptIds: string[]): Promise<ConceptAudit[]> {
  if (!conceptIds.length) return [];
  const { data } = await supabase.from("concept_approvals_v").select("id, concept_id, stage, action, comments, actor_name, at").in("concept_id", conceptIds).order("at");
  return (data as ConceptAudit[]) ?? [];
}

export async function getLatestBulkRun(supabase: Client) {
  const { data } = await supabase.from("ideation_bulk_runs").select("*").order("created_at", { ascending: false }).limit(1);
  return ((data as { id: string; brief_ids: string[]; created_at: string; created_by: string | null }[]) ?? [])[0] ?? null;
}

export async function getSessionsForBulk(supabase: Client, runId: string): Promise<SessionRow[]> {
  const { data } = await supabase.from("ideation_sessions").select("*").eq("bulk_run_id", runId);
  return (data as SessionRow[]) ?? [];
}
