import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Data management" };

type Market = { code: string; name: string; region_code: string; currency: string; m49_code: string | null };

// Data Management layer: master data every module references, and data-quality checks that run across modules.
export default async function DataManagement() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data: regions }, { data: markets }, suppliers] = await Promise.all([
    supabase.from("regions").select("code, name, sort").order("sort"),
    supabase.from("markets").select("code, name, region_code, currency, m49_code").order("name"),
    getSuppliers(supabase),
  ]);
  const mk = (markets ?? []) as Market[];
  const byName = new Map(mk.map((m) => [m.name.toLowerCase(), m]));
  const byCode = new Map(mk.map((m) => [m.code, m]));
  const resolve = (v: string | null) => (v ? byCode.get(v.toUpperCase()) ?? byName.get(v.toLowerCase()) : undefined);

  // Data-quality rules (DI-02: region and market kept separate and consistent).
  const noRegion = suppliers.filter((s) => !s.region);
  const noMarket = suppliers.filter((s) => !s.market);
  const unknownMarket = suppliers.filter((s) => s.market && !resolve(s.market));
  const mismatch = suppliers.filter((s) => { const m = resolve(s.market); return m && s.region && m.region_code !== s.region; });
  const issues = noRegion.length + noMarket.length + unknownMarket.length + mismatch.length;
  const score = suppliers.length ? Math.round(((suppliers.length * 4 - issues) / (suppliers.length * 4)) * 100) : 100;

  const rules: { label: string; rows: typeof suppliers; fix: string }[] = [
    { label: "Supplier has no region", rows: noRegion, fix: "Set the region on the supplier record." },
    { label: "Supplier has no market", rows: noMarket, fix: "Set the market on the supplier record." },
    { label: "Market not in the master list", rows: unknownMarket, fix: "Use a market from the list below, or ask for it to be added." },
    { label: "Market belongs to a different region", rows: mismatch, fix: "Region and market must agree (e.g. Germany is EMEA)." },
  ];

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Data management" }]} title="Data management"
        sub="The master data every module links to, and checks that keep records consistent across System Guy. Region and market are always held separately." />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Data quality (suppliers)" value={`${score}%`} tone={score >= 95 ? "ok" : score >= 80 ? "warn" : "bad"} hint="Share of checks passing" icon={<MSymbol name="fact_check" size={20} />} />
        <Stat label="Open issues" value={issues} tone={issues ? "warn" : "ok"} icon={<MSymbol name="report" size={20} />} />
        <Stat label="Regions" value={(regions ?? []).length} icon={<MSymbol name="public" size={20} />} />
        <Stat label="Markets" value={mk.length} icon={<MSymbol name="flag" size={20} />} />
      </section>

      <Panel title="Data-quality checks" sub="Run live against current records. Fix issues at the source record; checks re-run on every visit.">
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.label} className="px-5 py-3 text-sm">
              <div className="flex items-center gap-2">
                <MSymbol name={r.rows.length ? "error" : "check_circle"} size={18} className={r.rows.length ? "text-warn" : "text-ok"} fill />
                <span className="font-semibold">{r.label}</span>
                <Pill tone={r.rows.length ? "warn" : "ok"}>{r.rows.length}</Pill>
                {r.rows.length > 0 && <span className="text-xs text-muted">{r.fix}</span>}
              </div>
              {r.rows.length > 0 && (
                <p className="mt-1 pl-7 text-xs">
                  {r.rows.slice(0, 12).map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link href={`/assure/suppliers/${s.id}`} className="text-accent hover:underline">{s.name}</Link></span>)}
                  {r.rows.length > 12 && <span className="text-muted"> and {r.rows.length - 12} more</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5"><h2 className="font-bold">Regions and markets</h2><p className="text-xs text-muted">Each market (ISO country code) belongs to one region and has a default currency.</p></div>
        <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
          {((regions ?? []) as { code: string; name: string }[]).map((r) => (
            <div key={r.code} className="border-b border-line p-4 md:border-r">
              <p className="font-bold">{r.code} <span className="font-normal text-muted">· {r.name}</span></p>
              <ul className="mt-2 space-y-0.5 text-sm">
                {mk.filter((m) => m.region_code === r.code).map((m) => <li key={m.code} className="flex justify-between gap-2"><span>{m.name}</span><span className="font-mono text-xs text-muted">{m.code} · {m.currency}</span></li>)}
                {!mk.some((m) => m.region_code === r.code) && <li className="text-muted">No markets</li>}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
