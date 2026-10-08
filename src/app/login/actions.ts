"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.string().trim().email(), next: z.string().optional() });

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

export async function sendSignInLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), next: formData.get("next") || undefined });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  const next = parsed.data.next?.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    return { status: "error", message: "We couldn't send the sign-in link. Wait a minute and try again." };
  }
  return { status: "sent", email: parsed.data.email };
}
