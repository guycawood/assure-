import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Public CRM pages (survey, form, unsubscribe). No sign-in; each page only works with a valid token.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-3">
          <span className="text-[1rem] font-extrabold uppercase tracking-[0.1em] text-brand-navy">adm Indicia</span>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-5 pb-8 text-xs text-muted">adm Indicia uses your answers only to improve the service we give you.</footer>
    </div>
  );
}
