import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { fmtScore, scoreSupplier } from "@/lib/scorecard";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Supplier scorecard" };

type SP = Promise<{ region?: string; psl?: string }>;

export default async function ScorecardPage({ searchParams }: { searchParams: SP }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [m, suppliers, inputs] = await Promise.all([getMethodology(supabase, { status: "active" }), getSuppliers(supabase), getInputsBySupplier(supabase)]);
  if (!m) return <Card><Empty title="No active scorecard methodology">An admin needs to activate one in the Assure+ Watchtower.</Empty></Card>;

  const rows = suppliers
    .map((s) => ({ s, r: scoreSupplier(m, inputs.get(s.id) ?? [], s.active) }))
    .filter(({ s, r }) => (!sp.region || s.region === sp.region) && (sp.psl !== "1" || r.preferred))
    .sort((a, b) => (b.r.overall ?? -1) - (a.r.overall ?? -1));
  const preferred = rows.filter((x) => x.r.preferred).length;
  const regions = ["APAC", "EMEA", "Americas", "GSC"];

  return (
    <>
      <PageHead
        title="Supplier scorecard & PSL"
        sub={`Scored 0–5 with methodology v${m.version}. A supplier is preferred when it is active, meets the rules and scores above ${m.preferred_threshold}.`}
      >
        <Link href="/assure/watchtower" className="text-sm font-semibold text-accent underline">How scoring works</Link>
      </PageHead>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Region:</span>
        {[undefined, ...regions].map((r) => (
          <Link key={r ?? "all"} href={{ query: { ...(r ? { region: r } : {}), ...(sp.psl ? { psl: sp.psl } : {}) } }}
            className={`rounded-full border px-2.5 py-0.5 ${sp.region === r ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
            {r ?? "All"}
          </Link>
        ))}
        <span className="ml-3 text-muted">Show:</span>
        <Link href={{ query: { ...(sp.region ? { region: sp.region } : {}), ...(sp.psl === "1" ? {} : { psl: "1" }) } }}
          className={`rounded-full border px-2.5 py-0.5 ${sp.psl === "1" ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
          Preferred only
        </Link>
        <span className="ml-auto text-muted">{preferred} preferred of {rows.length}</span>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Supplier</th>
              <th className="th">Region · market</th>
              <th className="th text-right">Score</th>
              {m.pillars.map((p) => <th key={p.key} className="th text-right">{p.label} <span className="font-normal normal-case">{p.weight}%</span></th>)}
              <th className="th text-right">Data</th>
              <th className="th">PSL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, r }) => (
              <tr key={s.id}>
                <td className="td">
                  <details>
                    <summary className="cursor-pointer font-semibold">{s.name}</summary>
                    <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      {m.criteria.map((c, i) => (
                        <p key={c.key}><span className="text-muted">{c.label}:</span> {r.criteria[i].display} → <b>{fmtScore(r.criteria[i].score)}</b>{r.criteria[i].note ? <span className="text-muted"> ({r.criteria[i].note})</span> : null}</p>
                      ))}
                      <p className="sm:col-span-2"><Link href={`/assure/suppliers/${s.id}`} className="text-accent underline">Supplier record</Link></p>
                    </div>
                  </details>
                </td>
                <td className="td text-muted">{[s.region, s.market].filter(Boolean).join(" · ")}</td>
                <td className="td text-right font-display text-base font-bold tabular-nums">{fmtScore(r.overall)}</td>
                {r.pillars.map((p) => <td key={p.key} className="td text-right tabular-nums">{fmtScore(p.score)}</td>)}
                <td className="td text-right tabular-nums text-muted">{Math.round(r.completeness * 100)}%</td>
                <td className="td">
                  {r.preferred ? <Pill tone="ok">Preferred</Pill> : r.blockedReason ? <Pill tone="bad" title={r.blockedReason}>{r.blockedReason}</Pill> : <Pill>Below threshold</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
