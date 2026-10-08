import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NavLink } from "./nav-link";

export const dynamic = "force-dynamic";

// Assure+ (SRM). The SRT desk is one function inside it, alongside suppliers, scorecard and the module Watchtower.
export default async function AssureLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireInternal();
  const supabase = await createClient();
  const { count: mine } = await supabase
    .from("srt_tickets")
    .select("id", { count: "exact", head: true })
    .eq("assignee", profile.id)
    .neq("status", "resolved");

  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-line px-3 py-4 md:sticky md:top-[96px] md:h-[calc(100vh-96px)] md:overflow-y-auto md:border-b-0 md:border-r">
        <p className="px-2.5 pb-2 text-xs font-semibold" style={{ color: "#6A2DD3" }}>Assure+ · SRM</p>
        <nav className="flex flex-row flex-wrap gap-0.5 md:flex-col" aria-label="Assure+">
          <NavLink href="/assure" exact>Overview</NavLink>
          <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">SRT desk</p>
          <NavLink href="/assure/srt" exact>Onboarding dashboard</NavLink>
          <NavLink href="/assure/srt/tickets" badge={mine ?? 0}>Tickets</NavLink>
          <NavLink href="/assure/srt/register">Gate register</NavLink>
          <NavLink href="/assure/srt/outbox">Outbox</NavLink>
          <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">Suppliers</p>
          <NavLink href="/assure/scorecard">Scorecard &amp; PSL</NavLink>
          <NavLink href="/assure/suppliers/new">Add supplier</NavLink>
          <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">Governance</p>
          <NavLink href="/assure/watchtower">Assure+ Watchtower</NavLink>
          {profile.is_admin && <NavLink href="/assure/admin/users">User access</NavLink>}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-col gap-5 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
