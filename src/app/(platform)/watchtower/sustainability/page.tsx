import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Sustainability" };

type Rec = { code: string | null; name: string; data: Record<string, unknown>; status: string };

// Sustainability layer: the shared factors and methodology every module calculates with, and their health.
export default async function Sustainability() {
  await requireInternal();
  const supabase = await createClient();
  const { data } = await supabase.from("library_records").select("library_key, code, name, data, status")
    .in("library_key", ["substrates", "material_emission_factors", "transport_emission_factors", "impact_grade_dimensions"]).eq("status", "active");
  const rows = (data ?? []) as (Rec & { library_key: string })[];
  const subs = rows.filter((r) => r.library_key === "substrates");
  const mef = rows.filter((r) => r.library_key === "material_emission_factors");
  const tef = rows.filter((r) => r.library_key === "transport_emission_factors");
  const dims = rows.filter((r) => r.library_key === "impact_grade_dimensions");
  const weight = dims.reduce((a, d) => a + Number(d.data.weight_percent ?? 0), 0);
  const mefCodes = new Set(mef.map((m) => m.code));
  const unlinked = subs.filter((s) => !mefCodes.has(String(s.data.virgin_factor_code ?? "")) && !mefCodes.has(String(s.data.recycled_factor_code ?? "")));
  const indicative = subs.filter((s) => (s.data.verification_status ?? "indicative") === "indicative");
  const fsc = subs.filter((s) => s.data.fsc_certified === true).length;

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Sustainability" }]} title="Sustainability"
        sub="One set of emission factors, substrates and Impact Grade methodology, governed here and applied the same way in every module." />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Impact Grade weights" value={`${weight}%`} tone={weight === 100 ? "ok" : "bad"} hint={weight === 100 ? "Adds up to 100%" : "Must add up to 100%"} icon={<MSymbol name="grade" size={20} />} />
        <Stat label="Substrates" value={subs.length} hint={`${fsc} FSC certified`} icon={<MSymbol name="layers" size={20} />} />
        <Stat label="Without an emission factor" value={unlinked.length} tone={unlinked.length ? "warn" : "ok"} hint="Can't be footprinted yet" icon={<MSymbol name="link_off" size={20} />} />
        <Stat label="Indicative only" value={indicative.length} tone={indicative.length ? "warn" : "ok"} hint="Not yet supplier-confirmed or measured" icon={<MSymbol name="help" size={20} />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Impact Grade methodology" actions={<Link href="/watchtower/libraries/impact_grade_dimensions" className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
          <ul className="space-y-2 px-5 py-4">
            {dims.sort((a, b) => Number(b.data.weight_percent) - Number(a.data.weight_percent)).map((d) => (
              <li key={d.code} className="text-sm">
                <div className="flex justify-between"><span className="font-semibold">{d.name}</span><span className="tabular-nums">{String(d.data.weight_percent)}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand-sustainability" style={{ width: `${Number(d.data.weight_percent)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Substrates and their factors" actions={<Link href="/watchtower/libraries/substrates" className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Substrate</th><th className="th">Recycled</th><th className="th">FSC</th><th className="th">Factor</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const f = mef.find((m) => m.code === s.data.virgin_factor_code || m.code === s.data.recycled_factor_code);
                return (
                  <tr key={s.code}>
                    <td className="td font-semibold">{s.name}</td>
                    <td className="td tabular-nums">{String(s.data.recycled_content_percent ?? 0)}%</td>
                    <td className="td">{s.data.fsc_certified ? <Pill tone="ok">FSC</Pill> : "–"}</td>
                    <td className="td text-xs">{f ? `${String(f.data.factor_kgco2e_per_kg)} kgCO2e/kg` : <Pill tone="warn">Not linked</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </section>

      <Card className="p-5 text-sm">
        <h2 className="mb-2 font-bold">Transport factors in use</h2>
        <div className="flex flex-wrap gap-2">{tef.map((t) => <Pill key={t.code} tone="info">{t.name}: {String(t.data.factor_gco2e_per_tonne_km)} g/t·km</Pill>)}</div>
        <p className="mt-3 text-xs text-muted">Material factors cover raw material production only. They exclude conversion, production waste and end-of-life, so totals are not a product carbon footprint. Demo values are indicative; verify against licensed sources before reporting.</p>
      </Card>
    </>
  );
}
