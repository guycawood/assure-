import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** One row of approvals_inbox(): the standard approvals_<module> view shape plus requester name, age and maker-checker. */
export type ApprovalRow = {
  module: string; approval_type: string; item_id: string; ref: string | null; title: string | null;
  requested_by: string | null; requested_by_name: string | null; requested_at: string | null; age_days: number | null;
  amount: number | null; currency: string | null; client: string | null; market: string | null; region: string | null;
  status: "pending" | "overdue"; approver_rule: string | null; href: string; can_decide: boolean; maker_checker: boolean;
};

export type PolicyRow = { id: string; code: string | null; name: string; version: number; data: Record<string, unknown> };

export async function getInbox(supabase: Client, scope: "mine" | "all"): Promise<{ rows: ApprovalRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("approvals_inbox", { p_scope: scope });
  if (error) return { rows: [], error: error.message };
  const rows = ((data as ApprovalRow[] | null) ?? []).map((r) => ({
    ...r,
    amount: r.amount == null ? null : Number(r.amount),
    age_days: r.age_days == null ? null : Number(r.age_days),
  }));
  return { rows, error: null };
}

export async function getPolicies(supabase: Client): Promise<PolicyRow[]> {
  const { data } = await supabase.from("library_records").select("id, code, name, version, data")
    .eq("library_key", "approval_policies").eq("status", "active").order("code");
  return (data as PolicyRow[]) ?? [];
}
