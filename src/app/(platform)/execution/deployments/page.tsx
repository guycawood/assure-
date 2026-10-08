import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { getDeployments, getOutlets } from "@/lib/execution-data";
import { getDeliveries } from "@/lib/logistics-data";
import { AUDIT_STATUS, STAGE } from "@/lib/execution";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { createDeployment } from "../actions";

export const metadata: Metadata = { title: "Deployments" };

type Sp = { stage?: string; audit?: string; market?: string; region?: string; flag?: string; new?: string };

export default async function DeploymentsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, outlets, pos, lines, specs, dels] = await Promise.all([
    getDeployments(supabase), getOutlets(supabase),
    rows<{ id: string; po_number: string; estimate_id: string; status: string; supplier_name: string; job_number: string }>(supabase, "v_purchase_orders", { limit: 2000 }),
    rows<{ estimate_id: string; spec_id: string; quantity: number }>(supabase, "estimate_lines", { limit: 10000 }),
    rows<{ id: string; title: string; spec_no: number }>(supabase, "job_specs", { limit: 10000 }),
    getDeliveries(supabase),
  ]);
  const specName = new Map(specs.map((s) => [s.id, `#${s.spec_no} ${s.title}`]));
  const poSpecs = pos.filter((p) => ["issued", "accepted"].includes(p.status))
    .flatMap((p) => lines.filter((l) => l.estimate_id === p.estimate_id).map((l) => ({ value: `${p.id}|${l.spec_id}`, label: `${p.po_number} · ${p.supplier_name} · ${specName.get(l.spec_id) ?? "spec"} (${l.quantity})` })));
  const list = all.filter((d) => (!sp.stage || d.stage === sp.stage) && (!sp.audit || d.audit_status === sp.audit) && (!sp.market || d.market === sp.market)
    && (!sp.region || d.region === sp.region) && (!sp.flag || d.gps_flag));
  const regions = [...new Set(all.map((d) => d.region))].sort();
  const markets = [...new Set(all.map((d) => d.market))].sort();
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Deployments" }]} title="Deployments"
        sub="An asset installed at an outlet. Planned, in transit and delivered follow the Logistics+ delivery; installed comes with photos and a GPS position; audited and rejected come from an internal audit." />
      <form method="get" className="flex flex-wrap gap-2">
        <select name="stage" defaultValue={sp.stage ?? ""} className="input w-auto" aria-label="Stage"><option value="">All stages</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="audit" defaultValue={sp.audit ?? ""} className="input w-auto" aria-label="Audit"><option value="">Any audit status</option>{Object.entries(AUDIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region"><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        <select name="market" defaultValue={sp.market ?? ""} className="input w-auto" aria-label="Market"><option value="">All markets</option>{markets.map((m) => <option key={m}>{m}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="flag" value="1" defaultChecked={!!sp.flag} /> GPS flagged only</label>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No deployments match" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Deployment</Th><Th>Outlet</Th><Th>Job / spec</Th><Th>Supplier</Th><Th>Qty</Th><Th>Planned</Th><Th>Installed</Th><Th>GPS</Th><Th>Stage</Th><Th>Audit</Th></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <Td><Link className="font-semibold hover:underline" href={`/execution/deployments/${d.id}`}>{d.deployment_code}</Link><div className="text-xs text-muted">{d.po_number}</div></Td>
                <Td><Link className="hover:underline" href={`/execution/outlets/${d.outlet_id}`}>{d.outlet_name}</Link><div className="text-xs text-muted">{d.market} · {d.region}</div></Td>
                <Td>{d.job_number}<div className="text-xs text-muted">{d.spec_title}{d.spec_version_name ? ` · ${d.spec_version_name}` : ""}</div></Td>
                <Td>{d.supplier_name}</Td><Td className="tabular-nums">{d.installed_quantity ?? d.quantity}{d.installed_quantity != null && d.installed_quantity !== d.quantity ? ` / ${d.quantity}` : ""}</Td>
                <Td>{fmtDate(d.planned_date)}</Td><Td>{fmtDate(d.installation_date)}</Td>
                <Td>{d.gps_flag == null ? "—" : <span className={d.gps_flag ? "font-semibold text-warn" : "text-ok"}>{d.gps_distance_m != null ? `${Math.round(Number(d.gps_distance_m))} m` : "No GPS"}</span>}</Td>
                <Td><StatusPill meta={STAGE} value={d.stage} /></Td>
                <Td><StatusPill meta={AUDIT_STATUS} value={d.audit_status} />{d.audit_score != null && <div className="text-xs">{d.audit_score}%</div>}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Panel title="Plan an install" sub="From an approved PO line. Link the delivery that brings the goods so the stage follows it.">
        <details className="p-5" open={!!sp.new}><summary className="cursor-pointer text-sm font-semibold">New deployment</summary>
          <div className="mt-4"><ActionForm action={createDeployment} submit="Create deployment">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Outlet" htmlFor="outlet_id"><select id="outlet_id" name="outlet_id" defaultValue={sp.new ?? ""} className="input" required><option value="">Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.outlet_code}, {o.market})</option>)}</select></Field>
              <Field label="PO line" htmlFor="po_spec"><select id="po_spec" name="po_spec" className="input" required><option value="">Choose…</option>{poSpecs.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
              <Field label="Delivery (optional)" htmlFor="delivery_id"><select id="delivery_id" name="delivery_id" className="input"><option value="">—</option>{dels.filter((d) => d.status !== "cancelled").map((d) => <option key={d.id} value={d.id}>{d.delivery_number} · {d.po_number} · {d.outlet_name ?? d.city ?? d.market}</option>)}</select></Field>
              <Field label="Quantity" htmlFor="quantity"><input id="quantity" name="quantity" type="number" min={1} className="input" required /></Field>
              <Field label="Planned install date" htmlFor="planned_date"><input id="planned_date" name="planned_date" type="date" className="input" /></Field>
            </div>
          </ActionForm></div>
        </details>
      </Panel>
    </>
  );
}
