import type { Metadata } from "next";
import Link from "next/link";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Apply to become a vendor", description: "Apply to become an adm Indicia vendor: a short online pre-assessment." };

// Public pre-assessment application for new vendors (no sign-in).
export default function ApplyPage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <Link href="/vendor-portal" className="text-[1rem] font-extrabold uppercase tracking-[0.1em] text-brand-navy">adm Indicia · Assure<span className="text-[#2E9E8F]">+</span></Link>
          <Link href="/login?next=/vendor" className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-surface-2">Already a vendor? Sign in</Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-8">
        <div>
          <h1 className="font-display text-[1.8rem] font-bold leading-tight">Apply to become an adm Indicia vendor</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-muted">Tell us about your company in five short sections. Fields marked * are required; everything else helps us assess you faster. Nothing is saved until you submit, so keep this page open while you work.</p>
        </div>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <ApplyForm />
        </section>
        <p className="text-xs text-muted">We use what you send only to assess your application. Questions? Contact your adm Indicia representative.</p>
      </main>
    </div>
  );
}
