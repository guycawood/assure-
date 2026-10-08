import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/srt";

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, user_type, is_admin, srt_role, supplier_id")
    .eq("id", user.id)
    .single();
  return (data as Profile) ?? null;
});

export async function requireInternal(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!(profile.is_admin || profile.user_type === "internal")) redirect("/vendor");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireInternal();
  if (!profile.is_admin) redirect("/assure");
  return profile;
}
