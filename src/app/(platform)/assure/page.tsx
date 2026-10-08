import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers, getTickets } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { Card, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Assure+" };

// Assure+ home: every SRM function in one place. The SRT desk is one of them.
export default async function AssureHome() {
  await requireInternal();
  const supabase = await createClient();
  const [suppliers, tickets, m, inputs] = await Promise.all([getSuppliers(supabase), getTickets(supabase), getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase)]);
  const today = new Date().toISOString().slice(0, 10);
  const open = tickets.filter((t) => t.status !== "resolved");
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
  const compliant = suppliers.filter((s) => s.rag === "green").length;
  const blocked = suppliers.filter((s) => s.active && s.purchasing_blocked).length;
  const psl = m ? suppliers.filter((s) => scoreSupplier(m, inputs.get(s.id) ?? [], s.active).preferred).length : 0;

  const live = [
    { href: "/assure/srt", title: "SRT desk", body: "Onboarding tickets, gates, vendor information requests and Procurement head approval.", stat: `${open.length} open tickets`, alert: overdue ? `${overdue} overdue` : null },
    { href: "/assure/srt/register", title: "Supplier register", body: "Every supplier against the onboarding gates, with purchasing blocks.", stat: `${compliant} of ${suppliers.length} compliant`, alert: blocked ? `${blocked} active but blocked` : null },
    { href: "/assure/scorecard", title: "Scorecard & PSL", body: "Supplier scores across Financial, Compliance and Performance, and the Preferred Supplier List.", stat: `${psl} preferred suppliers`, alert: null },
    { href: "/assure/watchtower", title: "Assure+ Watchtower", body: "Scoring methodology explained and governed, module health and change log.", stat: m ? `Methodology v${m.version}` : "No methodology", alert: null },
    { href: "/assure/suppliers", title: "Supplier directory", body: "Search and filter every supplier, export to CSV, and open the Supplier 360 view.", stat: `${suppliers.length} suppliers`, alert: null },
    { href: "/assure/compliance", title: "Compliance", body: "Certificates, expiry tracking and the document review queue.", stat: "Certificates and documents", alert: null },
    { href: "/assure/quality", title: "Quality", body: "Inspections, non-conformance reports and verified corrective actions.", stat: "Inspections and NCRs", alert: null },
    { href: "/assure/performance", title: "Performance", body: "Quarterly scores, the compliance and sustainability report, and the issues feed.", stat: "Scores and issues", alert: null },
    { href: "/assure/contracts", title: "Contracts", body: "Draft, send, sign and amend contracts, with renewal alerts 60 days out.", stat: "Contracts and templates", alert: null },
    { href: "/assure/reviews", title: "Business reviews", body: "QBR calendar, outcome approval and what is shared with vendors.", stat: "Reviews calendar", alert: null },
  ];
  const next = [
    ["Panel reviews", "Quarterly vendor panel review and sourcing strategy audit."],
    ["Risk engine", "Risk scores worked out from compliance, performance, audits and commercial exposure."],
  ];

  return (
    <>
      <PageHead title="Assure+" sub="Supplier relationship management: who we buy from, whether they can be used, and how well they perform." />
      <section className="grid gap-3 md:grid-cols-2">
        {live.map((f) => (
          <Link key={f.href} href={f.href} className="group">
            <Card className="h-full p-4 transition-colors group-hover:border-[#6A2DD3]">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">{f.title}</h2>
                {f.alert && <Pill tone="bad">{f.alert}</Pill>}
              </div>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
              <p className="mt-3 text-sm font-semibold">{f.stat}</p>
            </Card>
          </Link>
        ))}
      </section>
      <section>
        <h2 className="mb-2 font-display text-lg font-semibold">Coming to Assure+</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {next.map(([t, b]) => (
            <Card key={t} className="p-3 text-sm">
              <p className="font-semibold">{t}</p>
              <p className="text-muted">{b}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
