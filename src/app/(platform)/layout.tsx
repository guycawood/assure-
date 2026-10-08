import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { personName, SRT_ROLES } from "@/lib/srt";
import { isDemoMode } from "@/lib/demo/config";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

// Internal platform (System Guy). Vendors never reach this: requireInternal sends them to /vendor.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireInternal();
  const supabase = await createClient();
  const { count: myTickets } = await supabase
    .from("srt_tickets")
    .select("id", { count: "exact", head: true })
    .eq("assignee", profile.id)
    .neq("status", "resolved");
  const role = profile.is_admin ? "Admin" : SRT_ROLES.find((r) => r.value === profile.srt_role)?.label ?? "Internal";

  return (
    <Shell user={{ name: personName(profile), role }} isAdmin={profile.is_admin} demo={isDemoMode()} badges={{ myTickets: myTickets ?? 0 }}>
      {children}
    </Shell>
  );
}
