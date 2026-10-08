"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClientFormResult } from "@/components/client/forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = "/watchtower/client-access";

export async function grantClientAccess(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  await requireAdmin();
  const user = String(fd.get("user_id") ?? "");
  const client = String(fd.get("client_id") ?? "");
  const role = String(fd.get("role") ?? "");
  if (!UUID.test(user) || !UUID.test(client)) return { error: "Choose a person and a client." };
  if (role !== "approver" && role !== "viewer") return { error: "Choose approver or viewer." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_access_grant", { p_user: user, p_client: client, p_role: role });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true, message: "Access saved." };
}

export async function revokeClientAccess(_prev: ClientFormResult, fd: FormData): Promise<ClientFormResult> {
  await requireAdmin();
  const user = String(fd.get("user_id") ?? "");
  const client = String(fd.get("client_id") ?? "");
  if (!UUID.test(user) || !UUID.test(client)) return { error: "Missing person or client." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_access_revoke", { p_user: user, p_client: client });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true, message: "Access removed." };
}

export async function backfillClientLinks(): Promise<ClientFormResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_link_backfill", {});
  if (error) return { error: error.message };
  const r = (data ?? {}) as { campaigns_linked?: number; briefs_linked?: number; campaigns_unmatched?: number; briefs_unmatched?: number };
  revalidatePath(PATH);
  return { ok: true, message: `Linked ${r.campaigns_linked ?? 0} campaigns and ${r.briefs_linked ?? 0} briefs. Still unmatched: ${r.campaigns_unmatched ?? 0} campaigns, ${r.briefs_unmatched ?? 0} briefs.` };
}
