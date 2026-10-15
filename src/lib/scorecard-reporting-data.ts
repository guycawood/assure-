import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Options, ScorecardReport } from "@/lib/scorecard-reporting";

// Server-side reads for the balanced scorecard. Internal pages call scorecard_report / scorecard_options (staff only);
// the Client Portal calls client_portal_scorecard (the caller's own accounts, client-safe lines only).
type Client = Awaited<ReturnType<typeof createClient>>;

async function call<T>(s: Client, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await s.rpc(fn, args);
  if (error) {
    console.error(`[scorecard] ${fn}:`, error.message);
    return null;
  }
  return data as T;
}

/** Internal: all clients (client null) or one client. */
export const getScorecard = (s: Client, client: string | null, filters: Record<string, unknown>) =>
  call<ScorecardReport>(s, "scorecard_report", { p_client: client, p_filters: filters });

export const getScorecardOptions = (s: Client, client: string | null) => call<Options>(s, "scorecard_options", { p_client: client });

/** Client Portal: the signed-in client's accounts, or the previewed client for staff. Includes the filter options. */
export const getClientScorecard = (s: Client, preview: string | null, filters: Record<string, unknown>) =>
  call<ScorecardReport>(s, "client_portal_scorecard", { p_client: preview, p_filters: filters });

export async function getScorecardClients(s: Client): Promise<{ id: string; name: string }[]> {
  const { data } = await s.from("sourcing_clients").select("id, name").eq("active", true).order("name");
  return (data ?? []) as { id: string; name: string }[];
}
