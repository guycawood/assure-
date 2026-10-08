import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers, getTickets } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { REGIONS } from "@/lib/srt";
import { Card, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Internal reporting" };

async function count(supabase: Awaited<ReturnType<typeof createClient>>, table: string): Promise<number | null> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  return error ? null : count ?? 0;
}

// Internal Reporting layer: management numbers across modules from one data model, cut by region.
export default async function InternalReporting() {
  await requireInternal();
  const supabase = await createClient();
  const [suppliers, tickets, m, inputs, briefs, campaigns, crs] = await Promise.all([
    getSuppliers(supabase), getTickets(supabase), getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase),
    count(supabase, "briefs"), count(supabase, "campaigns"), count(supabase, "change_requests"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const scored = m ? suppliers.map((s) => ({ s, r: scoreSupplier(m, inputs.get(s.id) ?? [], s.active) })) : [];
  const byRegion = REGIONS.map((reg) => {
    const ss = suppliers.filter((s) => s.region === reg);
    const sc = scored.filter((x) => x.s.region === reg);
    const avg = sc.length ? sc.reduce((a, x) => a + (x.r.overall ?? 0), 0) / sc.length : 0;
    return {
      reg, n: ss.length, compliant: ss.filter((s) => s.rag === "green").length, blocked: ss.filter((s) => s.active && s.purchasing_blocked).length,
      psl: sc.filter((x) => x.r.preferred).length, avg, spend: ss.reduce((a, s) => a + Number(s.ytd_spend), 0),
      overdue: tickets.filter((t) => t.status !== "resolved" && t.due_date && t.due_date < today && ss.some((s) => s.id === t.supplier_id)).length,
    };
  });
  const eur = (n: number) => `€${(n / 1000).toFixed(0)}k`;

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Internal reporting" }]} title="Internal reporting"
        sub="Management numbers across System Guy from one data model. Every figure links back to the module that owns it. More modules report here as they go live." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Suppliers" value={suppliers.length} hint={`${suppliers.filter((s) => s.rag === "green").length} fully compliant`} icon={<MSymbol name="verified_user" size={20} />} />
        <Stat label="Preferred suppliers" value={scored.filter((x) => x.r.preferred).length} hint="On the PSL" icon={<MSymbol name="leaderboard" size={20} />} />
        <Stat label="Briefs" value={briefs ?? "–"} hint={`${campaigns ?? 0} campaigns`} icon={<MSymbol name="lightbulb" size={20} />} />
        <Stat label="Change requests" value={crs ?? "–"} hint="Across all modules" icon={<MSymbol name="rule" size={20} />} />
      </section>
      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5"><h2 className="font-bold">Supply base by region</h2><p className="text-xs text-muted">From Assure+. Spend is year to date.</p></div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Region</th><th className="th text-right">Suppliers</th><th className="th text-right">Compliant</th><th className="th text-right">Blocked</th><th className="th text-right">On PSL</th><th className="th text-right">Avg score</th><th className="th text-right">Spend YTD</th><th className="th text-right">Overdue tickets</th></tr></thead>
          <tbody>
            {byRegion.map((r) => (
              <tr key={r.reg}>
                <td className="td font-semibold">{r.reg}</td>
                <td className="td text-right tabular-nums">{r.n}</td>
                <td className="td text-right tabular-nums">{r.n ? Math.round((r.compliant / r.n) * 100) : 0}%</td>
                <td className="td text-right tabular-nums">{r.blocked}</td>
                <td className="td text-right tabular-nums">{r.psl}</td>
                <td className="td text-right tabular-nums">{r.avg.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{eur(r.spend)}</td>
                <td className={`td text-right tabular-nums ${r.overdue ? "text-bad" : ""}`}>{r.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">Detail lives in each module: <Link href="/assure/scorecard" className="text-accent hover:underline">Scorecard</Link> · <Link href="/assure/srt" className="text-accent hover:underline">SRT desk</Link> · <Link href="/briefing" className="text-accent hover:underline">Briefs</Link> · <Link href="/watchtower/change-requests" className="text-accent hover:underline">Change requests</Link>.</p>
    </>
  );
}
