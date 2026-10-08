import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers, getTickets } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { MODULES } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";
import { Card, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Watchtower" };

// Master Watchtower: one row of health per module. Only Assure+ reports live numbers so far.
export default async function MasterWatchtower() {
  await requireInternal();
  const supabase = await createClient();
  const [suppliers, tickets, m, inputs] = await Promise.all([getSuppliers(supabase), getTickets(supabase), getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase)]);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tickets.filter((t) => t.status !== "resolved" && t.due_date && t.due_date < today).length;
  const pct = suppliers.length ? Math.round((suppliers.filter((s) => s.rag === "green").length / suppliers.length) * 100) : 0;
  const psl = m ? suppliers.filter((s) => scoreSupplier(m, inputs.get(s.id) ?? [], s.active).preferred).length : 0;

  const byRegion = ["APAC", "EMEA", "Americas", "GSC"].map((r) => {
    const ss = suppliers.filter((s) => s.region === r);
    return { r, n: ss.length, green: ss.filter((s) => s.rag === "green").length, markets: new Set(ss.map((s) => s.market).filter(Boolean)).size };
  });

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <PageHead title="Watchtower" sub="One view of the whole platform. Each module has its own Watchtower for its rules and health; they all roll up here." />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.filter((x) => x.key !== "watchtower").map((x) => {
          const live = x.key === "assure";
          return (
            <Card key={x.key} className="flex flex-col gap-2 p-4" >
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded" style={{ background: x.colour + "33", color: x.colour }}><MSymbol name={x.icon} size={18} /></span>
                <h2 className="font-display text-lg font-semibold">{x.name}</h2>
                <span className="ml-auto">{live ? <Pill tone="ok">Live</Pill> : <Pill>{x.phase}</Pill>}</span>
              </div>
              {live ? (
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-muted">Compliant</dt><dd className={`font-display text-xl font-bold ${pct >= 90 ? "text-ok" : pct >= 60 ? "text-warn" : "text-bad"}`}>{pct}%</dd></div>
                  <div><dt className="text-xs text-muted">Overdue tickets</dt><dd className={`font-display text-xl font-bold ${overdue ? "text-bad" : "text-ok"}`}>{overdue}</dd></div>
                  <div><dt className="text-xs text-muted">On PSL</dt><dd className="font-display text-xl font-bold">{psl}</dd></div>
                </dl>
              ) : (
                <p className="text-sm text-muted">{x.tagline}. Health appears here once the module is live.</p>
              )}
              <div className="mt-auto flex gap-3 text-sm">
                <Link href={x.basePath} className="font-semibold text-accent underline">Open {x.name}</Link>
                {live && <Link href="/assure/watchtower" className="font-semibold text-accent underline">Module Watchtower</Link>}
              </div>
            </Card>
          );
        })}
      </section>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-lg font-semibold">Suppliers by region</h2>
          <p className="text-sm text-muted">Region and market are held separately on every record, so every view can be cut either way.</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Region</th><th className="th text-right">Markets</th><th className="th text-right">Suppliers</th><th className="th text-right">Compliant</th></tr></thead>
          <tbody>
            {byRegion.map((x) => (
              <tr key={x.r}>
                <td className="td font-semibold">{x.r}</td>
                <td className="td text-right tabular-nums">{x.markets}</td>
                <td className="td text-right tabular-nums">{x.n}</td>
                <td className="td text-right tabular-nums">{x.n ? Math.round((x.green / x.n) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted">Next in the master Watchtower: change requests and a unified audit trail across modules, core principles, the DOA matrix, module access and shared libraries.</p>
    </div>
  );
}
