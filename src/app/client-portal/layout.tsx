import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { personName } from "@/lib/srt";
import type { Account } from "@/lib/client-portal";
import { rpc } from "@/lib/client-portal-data";
import { ClientNav } from "@/components/client/client-nav";
import { NotificationsBell, type Notice } from "@/components/notifications-bell";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: { default: "Client Portal", template: "%s · Client Portal" } };
export const dynamic = "force-dynamic";

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

// External portal for clients of adm Indicia. Clients see only their own accounts (enforced in the database);
// adm Indicia staff can preview a client's view read-only with ?preview=<client id>.
export default async function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireClient();
  const isInternal = profile.is_admin || profile.user_type === "internal";
  const supabase = await createClient();
  const [{ data: notices }, accounts] = await Promise.all([
    supabase.from("notifications").select("id, module, title, body, href, read_at, created_at").order("created_at", { ascending: false }).limit(15),
    isInternal ? Promise.resolve([] as Account[]) : rpc<Account[]>(supabase, "client_portal_accounts").then((a) => a ?? []),
  ]);
  const demo = isDemoMode();
  const name = personName(profile);
  const roleLabel = isInternal ? "adm Indicia preview" : accounts.some((a) => a.role === "approver") ? "Client approver" : "Client";

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-60 flex-col border-r border-line bg-surface md:flex">
        <Link href="/client-portal" className="flex h-[76px] shrink-0 flex-col justify-center border-b border-line px-5">
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-muted/80">System Guy · adm Indicia</span>
          <span className="text-[1.05rem] font-extrabold uppercase leading-none tracking-[0.12em] text-brand-navy">Client <span style={{ color: "#4896F7" }}>Portal</span></span>
          {accounts.length > 0 && <span className="mt-1 truncate text-[0.66rem] font-semibold text-muted">{accounts.map((a) => a.name).join(", ")}</span>}
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <ClientNav />
        </Suspense>
        <p className="border-t border-line px-5 py-3 text-[0.68rem] text-muted">Questions? Your adm Indicia account team is here to help.</p>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col md:ml-60">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4">
            <Link href="/client-portal" className="font-extrabold text-brand-navy md:hidden">Client Portal</Link>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {demo && <span className="hidden rounded-full bg-warn-soft px-2.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-wider text-warn md:block">Demo data</span>}
              {isInternal && (
                <Link href="/home" className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-fg/80 transition hover:bg-surface-2 sm:flex">
                  <MSymbol name="arrow_back" size={15} /> Back to System Guy
                </Link>
              )}
              <NotificationsBell items={(notices ?? []) as Notice[]} />
              <div className="flex items-center gap-2 border-l border-line pl-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-navy text-[0.68rem] font-bold text-white" aria-hidden>{initials(name)}</span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-xs font-bold">{name}</span>
                  <span className="block text-[0.68rem] text-muted">{roleLabel}</span>
                </span>
                <form action="/auth/signout" method="post">
                  <button title={demo ? "Switch user" : "Sign out"} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                    <MSymbol name="logout" size={18} />
                    <span className="sr-only">{demo ? "Switch user" : "Sign out"}</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 pb-8 pt-5">
          {!isInternal && accounts.length === 0 ? (
            <section className="max-w-xl rounded-xl border border-line bg-surface p-6 text-sm shadow-card">
              <h1 className="mb-1 font-display text-xl font-bold">Your account isn&apos;t linked to a client yet</h1>
              <p className="text-muted">We couldn&apos;t find a client account for {profile.email}. Ask your adm Indicia contact to give you access.</p>
            </section>
          ) : children}
        </main>
      </div>
    </div>
  );
}
