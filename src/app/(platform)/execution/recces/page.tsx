import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOutlets, getRecces } from "@/lib/execution-data";
import { RECCE_STATUS, cap, countFitting } from "@/lib/execution";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { RecceFields } from "@/components/execution/units-fit";
import { saveRecce } from "../actions";

export const metadata: Metadata = { title: "Recces" };

type Sp = { status?: string; new?: string; w?: string; h?: string; d?: string };

export default async function ReccesPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, outlets] = await Promise.all([getRecces(supabase), getOutlets(supabase)]);
  const list = sp.status ? all.filter((r) => r.status === sp.status) : all;
  const candidate = sp.w && sp.h ? { width_cm: Number(sp.w), height_cm: Number(sp.h), depth_cm: sp.d ? Number(sp.d) : null } : null;
  const fit = candidate ? countFitting(all, candidate) : null;
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Recces" }]} title="Recces"
        sub="Site surveys: the space that exists, the surface it mounts on and the unit size. Units that fit are worked out from the measurements, never typed in." />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[["", "All"], ...Object.entries(RECCE_STATUS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <Link key={k} href={k ? `/execution/recces?status=${k}` : "/execution/recces"} className={`rounded-full border px-3 py-1 font-semibold ${(sp.status ?? "") === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{l}</Link>
        ))}
      </nav>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No recces" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Recce</Th><Th>Outlet</Th><Th>Product / location</Th><Th>Surface</Th><Th>Available (W×H×D cm)</Th><Th>Unit</Th><Th>Units fit</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}>
                <Td><Link className="font-semibold hover:underline" href={`/execution/recces/${r.id}`}>{r.recce_code}</Link><div className="text-xs text-muted">{fmtDate(r.survey_date)}{r.captured_by_vendor ? ` · ${r.supplier_name ?? "vendor"}` : ""}</div></Td>
                <Td><Link className="hover:underline" href={`/execution/outlets/${r.outlet_id}`}>{r.outlet_name}</Link><div className="text-xs text-muted">{r.market} · {r.region}</div></Td>
                <Td>{r.product_name ?? "—"}<div className="text-xs text-muted">{r.location_in_store}</div></Td><Td>{cap(r.surface_type)}</Td>
                <Td className="tabular-nums">{[r.available_width_cm, r.available_height_cm, r.available_depth_cm].map((x) => x ?? "–").join(" × ")}</Td>
                <Td className="tabular-nums">{[r.unit_width_cm, r.unit_height_cm, r.unit_depth_cm].map((x) => x ?? "–").join(" × ")}</Td>
                <Td className="font-semibold tabular-nums">{r.units_fit ?? "—"}</Td><Td><StatusPill meta={RECCE_STATUS} value={r.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="How many outlets does a size fit?" sub="Test a candidate unit size against every surveyed space.">
          <form method="get" className="flex flex-wrap items-end gap-2 p-5">
            <Field label="Width cm" htmlFor="w"><input id="w" name="w" type="number" step="0.1" defaultValue={sp.w ?? ""} className="input w-28" /></Field>
            <Field label="Height cm" htmlFor="h"><input id="h" name="h" type="number" step="0.1" defaultValue={sp.h ?? ""} className="input w-28" /></Field>
            <Field label="Depth cm" htmlFor="d"><input id="d" name="d" type="number" step="0.1" defaultValue={sp.d ?? ""} className="input w-28" /></Field>
            <button className="rounded border border-line bg-surface px-3 py-2 text-sm font-semibold hover:border-muted">Test</button>
          </form>
          {fit && <p className="border-t border-line px-5 py-3 text-sm">Fits <b>{fit.outletsFit}</b> of {fit.outletsTotal} surveyed spaces, <b>{fit.totalUnits}</b> units in total.</p>}
        </Panel>
        <Panel title="New recce">
          <details className="p-5" open={!!sp.new}><summary className="cursor-pointer text-sm font-semibold">Survey an outlet</summary>
            <div className="mt-4"><ActionForm action={saveRecce} submit="Create recce">
              <Field label="Outlet" htmlFor="outlet_id"><select id="outlet_id" name="outlet_id" defaultValue={sp.new ?? ""} className="input" required><option value="">Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.outlet_code})</option>)}</select></Field>
              <RecceFields />
            </ActionForm></div>
          </details>
        </Panel>
      </div>
    </>
  );
}
