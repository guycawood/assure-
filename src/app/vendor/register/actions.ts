"use server";

import { createClient } from "@/lib/supabase/server";

export type RegisterState = { status: "idle" | "sent" | "error"; message?: string };

/** Sends the sign-in link to the invited email only; the address comes from the invite, not the form. */
export async function sendVendorSignInLink(_prev: RegisterState, fd: FormData): Promise<RegisterState> {
  const invite = String(fd.get("invite") ?? "");
  const supabase = await createClient();
  const { data } = await supabase.rpc("lookup_vendor_invite", { p_token: invite });
  const info = data as { valid: boolean; email?: string } | null;
  if (!info?.valid || !info.email) return { status: "error", message: "This link is no longer valid. Ask your adm Indicia contact for a new one." };
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signInWithOtp({
    email: info.email,
    options: { emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent("/vendor")}` },
  });
  if (error) return { status: "error", message: "We couldn't send the sign-in link. Wait a minute and try again." };
  return { status: "sent" };
}
