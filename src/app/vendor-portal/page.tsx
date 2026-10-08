import type { Metadata } from "next";
import Link from "next/link";
import { MSymbol } from "@/components/symbol";
import { SUBSCRIPTION_TIERS } from "@/lib/vendor";

export const metadata: Metadata = { title: "Become an adm Indicia vendor", description: "The Assure+ vendor portal: quote, take orders, keep your compliance current and grow your partnership with adm Indicia." };

const FEATURES = [
  { icon: "request_quote", title: "Quotes and orders", desc: "Price quote requests per quantity break, confirm agreed prices and accept purchase orders in one place." },
  { icon: "verified", title: "Compliance tracking", desc: "Keep certificates and documents current. We flag anything expired or expiring within 90 days." },
  { icon: "monitoring", title: "Performance scorecard", desc: "See your cost, on-time-in-full, quality, compliance and sustainability scores every quarter." },
  { icon: "forum", title: "One conversation", desc: "Messages, contracts, business reviews and action plans with adm Indicia's team, all in the portal." },
];
const STEPS = [
  { icon: "assignment", title: "Apply", desc: "Complete our online pre-assessment with your company details, certifications, capabilities and factory." },
  { icon: "fact_check", title: "Review", desc: "Our procurement team reviews your application and contacts you, usually within 5 to 7 working days." },
  { icon: "login", title: "Work with us", desc: "Once onboarded, sign in to quote, take orders, upload documents and track your performance." },
];

// Public marketing page for the vendor portal (no sign-in).
export default function VendorPortalLanding() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <span className="text-[1rem] font-extrabold uppercase tracking-[0.1em] text-brand-navy">adm Indicia · Assure<span className="text-[#2E9E8F]">+</span></span>
          <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-muted sm:inline">Vendor portal</span>
          <nav className="ml-auto flex items-center gap-2">
            <Link href="/login?next=/vendor" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-surface-2">Sign in</Link>
            <Link href="/apply" className="rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90">Apply to become a vendor</Link>
          </nav>
        </div>
      </header>

      <section className="text-white" style={{ background: "linear-gradient(120deg,#010062 0%,#1d2a7a 55%,#2E9E8F 140%)" }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.2fr_1fr] lg:py-24">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/60">For print, packaging, POS and merchandise suppliers</p>
            <h1 className="mb-5 font-display text-4xl font-extrabold leading-tight lg:text-5xl">Grow your business with adm Indicia</h1>
            <p className="mb-8 max-w-xl text-white/75">The Assure+ vendor portal is where adm Indicia&apos;s suppliers quote, take orders, keep compliance current and see how they&apos;re performing. One place, plain and simple.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/apply" className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-navy hover:bg-white/90">Start your application</Link>
              <Link href="/login?next=/vendor" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">I already have an account</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-center">
            {[["5", "sections in one online application"],["90 days", "early warning on expiring certificates"], ["Sealed", "quotes: only adm Indicia sees yours"], ["1", "place for orders, documents and invoices"]].map(([v, l]) => (
              <div key={l} className="rounded-2xl bg-white/10 p-5"><p className="font-display text-2xl font-extrabold">{v}</p><p className="mt-1 text-xs text-white/60">{l}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center font-display text-3xl font-bold">Everything you need</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted">The engagement points that matter, without the email chains.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent"><MSymbol name={f.icon} /></span>
              <p className="font-semibold">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center font-display text-3xl font-bold">How it works</h2>
          <p className="mt-2 text-center text-sm text-muted">Three steps to get started.</p>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="text-center">
                <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-navy text-white"><MSymbol name={s.icon} /></span>
                <p className="text-xs font-bold tracking-widest text-muted">0{i + 1}</p>
                <p className="font-semibold">{s.title}</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center font-display text-3xl font-bold">Plans for onboarded vendors</h2>
        <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted">Every approved vendor can use the portal. Plans add reporting, reviews and priority access; adm Indicia&apos;s account team agrees your plan with you.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SUBSCRIPTION_TIERS.map((t) => (
            <div key={t.key} className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-lg font-extrabold" style={{ color: t.colour }}>{t.name}</p>
              <p className="font-display text-2xl font-bold">{t.price}<span className="text-sm font-normal text-muted"> a year</span></p>
              <ul className="mt-3 space-y-1 text-xs text-muted">{t.features.map((f) => <li key={f}>· {f}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-5 py-14 text-center">
          <h2 className="mb-3 font-display text-3xl font-bold">Ready to get started?</h2>
          <p className="mb-8 text-sm text-white/70">The application takes about 20 minutes. You can come back to the portal any time once you&apos;re onboarded.</p>
          <Link href="/apply" className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-navy hover:bg-white/90">Apply now</Link>
        </div>
      </section>
      <footer className="py-6 text-center text-xs text-muted">© {new Date().getFullYear()} adm Indicia. Assure+ is part of System Guy.</footer>
    </div>
  );
}
