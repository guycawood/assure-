"use server";

import { createClient } from "@/lib/supabase/server";

// Public (no sign-in) actions. Each calls one public_* database function that checks the token and validates every value.
export type PublicResult = { ok?: boolean; error?: string };

const TOKEN = /^[0-9a-f]{64}$/;
const clean = (m: string) => (/permission denied/i.test(m) ? "This link can't be used here." : m);

export async function submitSurvey(token: string, answers: unknown): Promise<PublicResult> {
  if (!TOKEN.test(token)) return { error: "This survey link is not valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("public_survey_submit", { p_token: token, p_answers: answers });
  return error ? { error: clean(error.message) } : { ok: true };
}

export async function submitForm(token: string, data: Record<string, string>, honeypot: string): Promise<PublicResult> {
  if (!TOKEN.test(token)) return { error: "This form link is not valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("public_form_submit", { p_token: token, p_data: data, p_honeypot: honeypot.slice(0, 200) });
  return error ? { error: clean(error.message) } : { ok: true };
}

export async function unsubscribe(token: string): Promise<{ ok: boolean; email?: string | null; internal?: boolean }> {
  if (!TOKEN.test(token)) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_unsubscribe", { p_token: token });
  if (error) return { ok: false };
  return (data as { ok: boolean; email?: string | null; internal?: boolean }) ?? { ok: false };
}
