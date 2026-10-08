import { createClient } from "@/lib/supabase/server";
import type { GateDefinition, Profile, Supplier, SupplierGate, Ticket } from "@/lib/srt";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function getGateDefs(supabase: Client): Promise<GateDefinition[]> {
  const { data } = await supabase.from("gate_definitions").select("*").eq("active", true).order("sort");
  return (data as GateDefinition[]) ?? [];
}

/** Internal staff, for assignee/owner pickers and name lookups. */
export async function getInternalPeople(supabase: Client): Promise<Profile[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, user_type, is_admin, srt_role, supplier_id")
    .or("user_type.eq.internal,is_admin.eq.true")
    .order("full_name", { nullsFirst: false });
  return (data as Profile[]) ?? [];
}

export async function getSuppliers(supabase: Client): Promise<Supplier[]> {
  const { data } = await supabase.from("suppliers").select("*").order("name").limit(5000);
  return (data as Supplier[]) ?? [];
}

export async function getAllGates(supabase: Client): Promise<SupplierGate[]> {
  const { data } = await supabase.from("supplier_gates").select("*").limit(100000);
  return (data as SupplierGate[]) ?? [];
}

export async function getTickets(supabase: Client): Promise<Ticket[]> {
  const { data } = await supabase.from("srt_tickets").select("*").order("created_at", { ascending: false }).limit(5000);
  return (data as Ticket[]) ?? [];
}

export function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r]));
}
