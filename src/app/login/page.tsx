import type { Metadata } from "next";
import { DEMO_USERS, isDemoMode } from "@/lib/demo/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const demo = isDemoMode();
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className={`w-full rounded-md border border-line bg-surface p-7 ${demo ? "max-w-lg" : "max-w-sm"}`}>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded bg-accent font-display text-lg font-bold text-accent-fg">A+</div>
          <div>
            <h1 className="font-display text-xl font-bold leading-none">Assure+</h1>
            <p className="mt-1 text-xs text-muted">adm Indicia supplier platform</p>
          </div>
        </div>

        {demo ? (
          <>
            <p className="mb-1 font-semibold">Demo mode</p>
            <p className="mb-4 text-sm text-muted">
              Everything here is dummy data in a temporary database. Changes are saved until the server restarts. Pick who to sign in as:
            </p>
            <div className="grid gap-2">
              {DEMO_USERS.map((u) => (
                // Plain links (not client navigation) so the route handler's cookie is set before the next page loads.
                <a
                  key={u.id}
                  href={`/auth/demo?user=${u.id}`}
                  className="flex flex-col items-start rounded border border-line px-3 py-2 text-left hover:border-accent hover:bg-accent-soft"
                >
                  <span className="text-sm font-semibold">{u.name} · <span className="text-accent">{u.role}</span></span>
                  <span className="text-xs text-muted">{u.description}</span>
                </a>
              ))}
            </div>
          </>
        ) : (
          <>
            {error && (
              <p className="mb-4 rounded bg-bad-soft px-3 py-2 text-sm text-bad">
                That sign-in link has expired or was already used. Request a new one.
              </p>
            )}
            <LoginForm next={next} />
          </>
        )}
      </div>
    </main>
  );
}
