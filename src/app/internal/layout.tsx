import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { personName, SRT_ROLES } from "@/lib/srt";
import { NavLink } from "./nav-link";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireInternal();
  const supabase = await createClient();
  const { count: mine } = await supabase
    .from("srt_tickets")
    .select("id", { count: "exact", head: true })
    .eq("assignee", profile.id)
    .neq("status", "resolved");

  const role = profile.is_admin ? "Admin" : SRT_ROLES.find((r) => r.value === profile.srt_role)?.label ?? "Internal";

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-5 border-b border-line bg-surface px-3.5 py-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-1.5">
          <div className="grid h-8 w-8 place-items-center rounded bg-accent font-display font-bold text-accent-fg">A+</div>
          <div className="font-display text-lg font-bold leading-none">
            Assure+
            <span className="mt-0.5 block font-sans text-[0.7rem] font-medium text-muted">Internal portal</span>
          </div>
        </div>
        <nav className="flex flex-row flex-wrap gap-0.5 md:flex-col" aria-label="Internal portal">
          <p className="eyebrow hidden px-2.5 pb-1 pt-2 md:block">SRT Desk</p>
          <NavLink href="/internal/srt" exact>Dashboard</NavLink>
          <NavLink href="/internal/srt/tickets" badge={mine ?? 0}>Tickets</NavLink>
          <NavLink href="/internal/srt/register">Gate register</NavLink>
          <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">Suppliers</p>
          <NavLink href="/internal/suppliers/new">Add supplier</NavLink>
          {profile.is_admin && (
            <>
              <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">Admin</p>
              <NavLink href="/internal/admin/users">User access</NavLink>
            </>
          )}
        </nav>
        <div className="mt-auto hidden min-w-0 border-t border-line px-1.5 pt-3 text-sm md:block">
          <p className="truncate font-semibold">{personName(profile)}</p>
          <p className="text-xs text-muted">{role}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="text-xs font-semibold text-accent underline underline-offset-2">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="mx-auto flex w-full min-w-0 max-w-[1500px] flex-col gap-5 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
