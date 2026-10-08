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

export async function getLatestBulkRun(supabase: Client) {
  const { data } = await supabase.from("ideation_bulk_runs").select("*").order("created_at", { ascending: false }).limit(1);
  return ((data as { id: string; brief_ids: string[]; created_at: string; created_by: string | null }[]) ?? [])[0] ?? null;
}

export async function getSessionsForBulk(supabase: Client, runId: string): Promise<SessionRow[]> {
  const { data } = await supabase.from("ideation_sessions").select("*").eq("bulk_run_id", runId);
  return (data as SessionRow[]) ?? [];
}
