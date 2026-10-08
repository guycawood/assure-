import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { PORTALS } from "@/modules/registry";

export const metadata: Metadata = { title: "Client Portal" };

// External portal for clients (planned). Internal preview only until client accounts exist.
export default async function ClientPortal() {
  await requireInternal();
  const p = PORTALS.find((x) => x.key === "client")!;
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-card">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">System Guy · external</p>
        <h1 className="mt-1 text-2xl font-bold text-brand-navy">{p.name}</h1>
        <p className="mt-2 text-muted">{p.summary}</p>
        <ul className="mt-5 list-disc space-y-1 pl-5 text-sm">
          <li>Campaigns and briefs: submit, comment and approve</li>
          <li>Estimates: review and accept</li>
          <li>Delivery and installation progress with proof</li>
          <li>External reporting: spend, savings, sustainability and effectiveness for your accounts only</li>
        </ul>
        <p className="mt-6 text-sm"><span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn">Planned</span> <Link href="/watchtower/flow" className="ml-2 font-semibold text-accent underline">See where it fits</Link></p>
      </div>
    </main>
  );
}
