import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getRules } from "@/lib/conscious-ordering-data";
import { co2, eur, groups, int, pct, totals } from "@/lib/conscious-ordering";
import { Card, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Sustainability" };

type Rec = { library_key: string; code: string | null; data: Record<string, unknown> };

// Sustainability module: two programmes on one set of governed factors.
//   Impact Grade       = how sustainable each spec is (materials, footprint), graded 0 to 10.
//   Conscious ordering = whether what was ordered was actually needed (ordered vs delivered vs installed vs in stock).
export default async function Sustainability() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data }, lines, rules] = await Promise.all([
    supabase.from("library_records").select("library_key, code, data").in("library_key", ["substrates", "material_emission_factors", "impact_grade_dimensions"]).eq("status", "active"),
    getOrderLines(supabase), getRules(supabase),
  ]);
  const rows = (data ?? []) as Rec[];
  const subs = rows.filter((r) => r.library_key === "substrates");
  const dims = rows.filter((r) => r.library_key === "impact_grade_dimensions");
  const mefCodes = new Set(rows.filter((r) => r.library_key === "material_emission_factors").map((m) => m.code));
  const weight = dims.reduce((a, d) => a + Number(d.data.weight_percent ?? 0), 0);
  const unlinked = subs.filter((s) => !mefCodes.has(String(s.data.virgin_factor_code ?? "")) && !mefCodes.has(String(s.data.recycled_factor_code ?? ""))).length;
  const t = totals(lines, rules);
  const flagged = groups(lines, rules).filter((g) => g.verdict === "over_ordering").length;

  const programmes = [
    {
      href: "/sustainability/impact-grade", icon: "grade", name: "Impact Grade",
      body: "How sustainable each item is. One 0 to 10 grade per spec from weighted dimensions, on shared substrates and emission factors.",
      facts: [`${dims.length} dimensions, weights add up to ${weight}%`, `${subs.length} substrates${unlinked ? `, ${unlinked} without an emission factor` : ", all with an emission factor"}`],
    },
    {
      href: "/sustainability/conscious-ordering", icon: "inventory", name: "Conscious ordering",
      body: "Whether what was ordered was needed. Ordered against delivered, installed and in stock; over-ordering brands and markets are advised to order less.",
      facts: [`${pct(t.utilisation)} of ordered units installed, on ${t.reconciledLines} reconciled order lines`, `${flagged} brand and market combination${flagged === 1 ? "" : "s"} over-ordering`],
    },
  ];

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability" }]} title="Sustainability"
        sub="Two programmes on one set of governed factors: Impact Grade measures how sustainable each item is, and conscious ordering checks that no more was ordered than was used." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Impact Grade weights" value={`${weight}%`} tone={weight === 100 ? "ok" : "bad"} hint={weight === 100 ? "Adds up to 100%" : "Must add up to 100%"} icon={<MSymbol name="grade" size={20} />} />
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
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {[["Substrates", "substrates"], ["Material emission factors", "material_emission_factors"], ["Transport emission factors", "transport_emission_factors"],
            ["Impact Grade dimensions", "impact_grade_dimensions"], ["Conscious ordering rules", "conscious_ordering_rules"], ["Spend-based emission factors", "spend_emission_factors"]].map(([label, key]) => (
            <Link key={key} href={`/sustainability/watchtower/libraries/${key}`} className="font-semibold text-accent hover:underline">{label}</Link>
          ))}
        </div>
      </Card>
    </>
  );
}
