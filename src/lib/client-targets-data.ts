import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { parseClientTargets, type ClientTargets } from "@/lib/client-targets";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Every client's targets with its code and name, for forms that pick a client by name (Briefing+). */
export async function listClientTargets(supabase: Client): Promise<ClientTargets[]> {
  const [{ data: rows }, { data: clients }] = await Promise.all([
    supabase.from("crm_client_sustainability").select("*").limit(5000),
    supabase.from("sourcing_clients").select("id, code, name").limit(5000),
  ]);
  const byId = new Map(((clients ?? []) as { id: string; code: string; name: string }[]).map((c) => [c.id, c]));
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => {
    const c = byId.get(String(r.client_id));
    return parseClientTargets({ ...r, client_code: c?.code, client_name: c?.name });
  }).filter((t): t is ClientTargets => !!t);
}

/** The client's sustainability targets from CRM, by client id or by the client name/code typed on a brief. */
export async function getClientTargets(supabase: Client, clientId?: string | null, clientText?: string | null): Promise<ClientTargets | null> {
  if (!clientId && !clientText?.trim()) return null;
  const { data, error } = await supabase.rpc("client_sustainability_targets", { p_client: clientId || null, p_client_text: clientText?.trim() || null });
  if (error) return null;
  return parseClientTargets(data);
}
