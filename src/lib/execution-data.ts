import "server-only";
import { rows, one, type Client } from "@/lib/sourcing-data";
import type { Audit, CloseCheck, Criterion, Deployment, Gate, Outlet, Recce, Ticket, Visit } from "@/lib/execution";

// Server-side reads for Execution+, as the signed-in user under RLS (internal only).

type Eq = Record<string, string>;
export const getOutlets = (s: Client, eq: Eq = {}) => rows<Outlet>(s, "v_outlets", { eq, order: [["name", true]], limit: 5000 });
export const getOutlet = (s: Client, id: string) => one<Outlet>(s, "v_outlets", id);
export const getRecces = (s: Client, eq: Eq = {}) => rows<Recce>(s, "v_recces", { eq, order: [["created_at", false]], limit: 5000 });
export const getRecce = (s: Client, id: string) => one<Recce>(s, "v_recces", id);
export const getDeployments = (s: Client, eq: Eq = {}) => rows<Deployment>(s, "v_deployments", { eq, order: [["created_at", false]], limit: 5000 });
export const getDeployment = (s: Client, id: string) => one<Deployment>(s, "v_deployments", id);
export const getAudits = (s: Client, eq: Eq = {}) => rows<Audit>(s, "v_deployment_audits", { eq, order: [["audited_at", false]], limit: 5000 });
export const getTickets = (s: Client, eq: Eq = {}) => rows<Ticket>(s, "v_maintenance_tickets", { eq, order: [["reported_at", false]], limit: 5000 });
export const getTicket = (s: Client, id: string) => one<Ticket>(s, "v_maintenance_tickets", id);
export const getVisits = (s: Client, eq: Eq = {}) => rows<Visit>(s, "v_visits", { eq, order: [["scheduled_date", true]], limit: 5000 });
export const getGates = (s: Client, jobId: string) => rows<Gate>(s, "v_job_quality_gates", { eq: { job_id: jobId }, order: [["seq", true]] });

export async function getCloseCheck(s: Client, jobId: string): Promise<CloseCheck | null> {
  const { data, error } = await s.rpc("job_close_check", { p_job: jobId });
  if (error) { console.error("[execution-data] job_close_check:", error.message); return null; }
  return data as CloseCheck;
}

/** Active display-scoring criteria (weights from the Watchtower library). */
export async function getCriteria(s: Client): Promise<Criterion[]> {
  const r = await rows<{ code: string; name: string; data: { weight_percent?: number; guidance?: string } }>(s, "library_records", { eq: { library_key: "display_scoring", status: "active" }, order: [["code", true]] });
  return r.map((x) => ({ code: x.code, name: x.name, weight: Number(x.data.weight_percent ?? 0), guidance: x.data.guidance }));
}

export async function getRule(s: Client, code: string, fallback: number): Promise<number> {
  const r = await rows<{ data: { value?: number } }>(s, "library_records", { eq: { library_key: "execution_rules", code, status: "active" }, limit: 1 });
  return r[0]?.data.value != null ? Number(r[0].data.value) : fallback;
}

export interface ExecEvent { id: number; job_id: string | null; entity: string; entity_id: string | null; event: string; detail: Record<string, unknown>; actor: string | null; at: string }
export const getExecEvents = (s: Client, eq: Eq) => rows<ExecEvent>(s, "execution_events", { eq, order: [["at", false]], limit: 200 });

export const getSuppliersLite = (s: Client) => rows<{ id: string; name: string; supplier_code: string | null }>(s, "suppliers", { eq: { active: true }, order: [["name", true]], limit: 5000 });
export const getClientsLite = (s: Client) => rows<{ id: string; name: string; code: string }>(s, "sourcing_clients", { order: [["name", true]] });
