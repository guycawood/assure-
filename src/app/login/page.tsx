import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm rounded-md border border-line bg-surface p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded bg-accent font-display text-lg font-bold text-accent-fg">A+</div>
          <div>
            <h1 className="font-display text-xl font-bold leading-none">Assure+</h1>
            <p className="mt-1 text-xs text-muted">adm Indicia supplier platform</p>
          </div>
        </div>
        {error && (
          <p className="mb-4 rounded bg-bad-soft px-3 py-2 text-sm text-bad">
            That sign-in link has expired or was already used. Request a new one.
          </p>
        )}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
