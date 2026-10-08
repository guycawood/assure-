import "server-only";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/srt";
import { isUuid, withPreview, type Account } from "@/lib/client-portal";

// Server-side reads for the Client Portal. Every read is a security definer SQL function (client_portal_*) that scopes
// rows to the caller's accounts (my_client_ids()) or, for internal staff, to the one client being previewed.

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export type PortalCtx = {
  profile: Profile;
  supabase: Supabase;
  isInternal: boolean;
  /** The previewed client id (internal staff only). */
  preview: string | null;
  accounts: Account[];
  link: (href: string) => string;
};

/** Call a client_portal_* function; returns null (and logs) on error. */
export async function rpc<T>(supabase: Supabase, fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[client-portal] ${fn}:`, error.message);
    return null;
  }
  return data as T;
}

/**
 * Who is looking and at which accounts. Internal staff must name a client with ?preview=<client id>;
 * without one they are sent to the dashboard's client picker (unless allowPicker).
 */
export async function portalContext(sp: { preview?: string }, opts: { allowPicker?: boolean } = {}): Promise<PortalCtx> {
  const profile = await requireClient();
  const supabase = await createClient();
  const isInternal = profile.is_admin || profile.user_type === "internal";
  const preview = isInternal && isUuid(sp.preview) ? sp.preview : null;
  if (isInternal && !preview) {
    if (!opts.allowPicker) redirect("/client-portal");
    return { profile, supabase, isInternal, preview: null, accounts: [], link: (h) => h };
  }
  const accounts = (await rpc<Account[]>(supabase, "client_portal_accounts", { p_client: preview })) ?? [];
  return { profile, supabase, isInternal, preview, accounts, link: (h) => withPreview(h, preview) };
}

/** Arguments for client_portal_* functions: the previewed client, or all of the client's own accounts. */
export const scope = (ctx: PortalCtx) => ({ p_client: ctx.preview });

export async function previewClients(supabase: Supabase) {
  const { data } = await supabase.from("sourcing_clients").select("id, code, name").eq("active", true).order("name");
  return (data ?? []) as { id: string; code: string; name: string }[];
}
