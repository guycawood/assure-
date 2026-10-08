import type { Metadata } from "next";
import { DEMO_USERS, isDemoMode } from "@/lib/demo/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const MODULES = ["Briefing+", "Shopper IQ", "Sourcing+", "Logistics+", "Execution+", "Assure+"];
const initials = (s: string) => s.split(" ").map((w) => w[0]).join("").slice(0, 2);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const demo = isDemoMode();
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-navy p-12 text-white lg:flex lg:flex-col">
        <svg className="pointer-events-none absolute -right-40 -top-40 opacity-90" width="620" height="620" viewBox="0 0 620 620" aria-hidden>
          <circle cx="310" cy="310" r="230" fill="none" stroke="#97DBD9" strokeWidth="60" strokeDasharray="1200 245" strokeLinecap="round" transform="rotate(-50 310 310)" opacity="0.18" />
          <circle cx="310" cy="310" r="130" fill="none" stroke="#6A2DD3" strokeWidth="34" strokeDasharray="640 180" strokeLinecap="round" transform="rotate(120 310 310)" opacity="0.35" />
        </svg>
        <div className="relative flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden>
            <circle cx="13" cy="13" r="9.5" fill="none" stroke="#97DBD9" strokeWidth="3.5" strokeDasharray="48 12" strokeLinecap="round" transform="rotate(-50 13 13)" />
          </svg>
          <span className="leading-tight"><span className="block text-xl font-bold">System Guy</span><span className="block text-xs font-semibold text-white/60">by adm Indicia</span></span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-[2.4rem] font-bold leading-[1.1] tracking-[-0.02em]">One platform from brief to shelf.</h1>
          <p className="mt-4 text-white/70">Brief, source, deliver and install, with every supplier assured along the way.</p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {MODULES.map((m) => <li key={m} className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/80">{m}</li>)}
          </ul>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="flex items-center justify-center bg-surface px-5 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <span className="text-xl font-bold text-brand-navy">System Guy</span> <span className="text-xs font-semibold text-muted">by adm Indicia</span>
          </div>
          <h2 className="text-[1.6rem] font-bold tracking-[-0.01em]">Sign in to System Guy</h2>
          {demo ? (
            <>
              <p className="mt-1 text-sm text-muted">
                Demo mode: dummy data in a temporary database. Choose who to sign in as to see the platform through their role.
              </p>
              <div className="mt-6 grid gap-2">
                {DEMO_USERS.map((u) => (
                  // Plain links (not client navigation) so the route handler's cookie is set before the next page loads.
                  <a
                    key={u.id}
                    href={`/auth/demo?user=${u.id}`}
                    className="group flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 transition hover:border-accent/40 hover:bg-accent-soft/60 hover:shadow-card"
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${u.role === "Vendor" ? "bg-brand-tech/25 text-warn" : "bg-brand-navy text-white"}`}>
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{u.name} <span className="font-semibold text-muted">· {u.role}</span></span>
                      <span className="block truncate text-xs text-muted">{u.description}</span>
                    </span>
                    <span aria-hidden className="ml-auto text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-6 mt-1 text-sm text-muted">We&apos;ll email you a secure sign-in link.</p>
              {error && (
                <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
                  That sign-in link has expired or was already used. Request a new one.
                </p>
              )}
              <LoginForm next={next} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
