import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getRules } from "@/lib/conscious-ordering-data";
import { getHealth } from "@/lib/health";
import { co2, eur, groups, int, pct, totals } from "@/lib/conscious-ordering";
import { Card, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Sustainability" };

type Rec = { library_key: string; code: string | null; data: Record<string, unknown> };

// Sustainability module: two programmes on one set of governed factors.
//   Impact Grade       = how sustainable each spec is: the Anthesis PEF model and a 0-100 (A-E) grade. Pages live at /impact-grade.
//   Conscious ordering = whether what was ordered was actually needed (ordered vs delivered vs installed vs in stock).
export default async function Sustainability() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data }, lines, rules, ig] = await Promise.all([
    supabase.from("library_records").select("library_key, code, data").in("library_key", ["substrates", "material_emission_factors"]).eq("status", "active"),
    getOrderLines(supabase), getRules(supabase), getHealth(supabase, "impact-grade"),
  ]);
  const rows = (data ?? []) as Rec[];
  const subs = rows.filter((r) => r.library_key === "substrates");
  const mefCodes = new Set(rows.filter((r) => r.library_key === "material_emission_factors").map((m) => m.code));
  const unlinked = subs.filter((s) => !mefCodes.has(String(s.data.virgin_factor_code ?? "")) && !mefCodes.has(String(s.data.recycled_factor_code ?? ""))).length;
  const igm = (k: string) => ig.find((h) => h.metric === k);
  const weighting = igm("ef_weighting_total");
  const t = totals(lines, rules);
  const flagged = groups(lines, rules).filter((g) => g.verdict === "over_ordering").length;

  const programmes = [
    {
      href: "/impact-grade", icon: "grade", name: "Impact Grade",
      body: "How sustainable each item is. The Anthesis PEF model across 16 impact categories, turned into a 0-100 grade (A-E) per spec, on shared substrates and emission factors.",
      facts: [`EF 3.1 weighting adds up to ${weighting ? weighting.value : "?"}%`, `${igm("high_issues_open")?.value ?? 0} high-severity review issues open, ${igm("grade_bands_unconfirmed")?.value ?? 0} grade letters unconfirmed`,
        `${subs.length} substrates${unlinked ? `, ${unlinked} without an emission factor` : ", all with an emission factor"}`],
    },
    {
      href: "/sustainability/conscious-ordering", icon: "inventory", name: "Conscious ordering",
      body: "Whether what was ordered was needed. Ordered against delivered, installed and in stock; over-ordering brands and markets are advised to order less.",
      facts: [`${pct(t.utilisation)} of ordered units installed, on ${t.reconciledLines} reconciled order lines`, `${flagged} brand and market combination${flagged === 1 ? "" : "s"} over-ordering`],
    },
  ];

  return (
    <>
      <PageHead title="Sustainability"
        sub="Two programmes on one set of governed factors: Impact Grade measures how sustainable each item is, and conscious ordering checks that no more was ordered than was used." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="EF 3.1 weighting" value={weighting ? `${weighting.value}%` : "—"} tone={weighting?.status} hint="Impact Grade methodology, target 100%" icon={<MSymbol name="grade" size={20} />} />
        <Stat label="Installed of ordered" value={pct(t.utilisation)} tone={t.utilisation == null ? undefined : t.utilisation >= rules.target ? "ok" : "bad"}
          hint={`Target ${rules.target}% · ${pct(t.coverage)} of ordered units have evidence`} icon={<MSymbol name="storefront" size={20} />} />
        <Stat label="Presumed wasted (measured)" value={int(t.wasted)} tone={t.wasted > 0 ? "bad" : "ok"} hint={`${eur(t.wastedEur)} · ${co2(t.wastedKg)}`} icon={<MSymbol name="delete_sweep" size={20} />} />
        <Stat label="Over-ordering" value={flagged} tone={flagged ? "warn" : "ok"} hint={`Brands and markets under target on ${rules.minOrders} or more orders`} icon={<MSymbol name="flag" size={20} />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {programmes.map((p) => (
          <Link key={p.href} href={p.href} className="group block">
            <Card className="h-full p-5 transition group-hover:border-accent/40 group-hover:shadow-raised">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-sustainability/20 text-fg"><MSymbol name={p.icon} size={22} /></span>
                <h2 className="font-display text-lg font-bold">{p.name}</h2>
              </div>
              <p className="mt-3 text-sm text-muted">{p.body}</p>
              <ul className="mt-3 space-y-1 text-sm">{p.facts.map((f) => <li key={f} className="flex gap-2"><span aria-hidden className="text-muted">•</span>{f}</li>)}</ul>
              <p className="mt-4 text-sm font-semibold text-accent group-hover:underline">Open {p.name}</p>
            </Card>
          </Link>
        ))}
      </section>

      <Card className="p-5 text-sm">
        <h2 className="mb-2 font-bold">Governed libraries behind both programmes</h2>
        <p className="mb-3 text-muted">The PEF libraries (mapping tables, ecoinvent factors, grade letters) are in the <Link className="font-semibold text-accent hover:underline" href="/impact-grade/watchtower">Impact Grade Watchtower</Link>. See also the <Link className="font-semibold text-accent hover:underline" href="/sustainability/factors">shared factors overview</Link>.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {[["Substrates", "substrates"], ["Material emission factors", "material_emission_factors"], ["Transport emission factors", "transport_emission_factors"],
            ["Impact Grade wheel themes", "impact_grade_dimensions"], ["Conscious ordering rules", "conscious_ordering_rules"], ["Spend-based emission factors", "spend_emission_factors"]].map(([label, key]) => (
            <Link key={key} href={`${key === "impact_grade_dimensions" ? "/impact-grade/watchtower" : "/sustainability/watchtower"}/libraries/${key}`} className="font-semibold text-accent hover:underline">{label}</Link>
          ))}
        </div>
      </Card>
    </>
  );
}
