import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers } from "@/lib/data";
import { getLibrary, getLibraryNames, rows, supplierOptions } from "@/lib/assure-data";
import { ACK_STATUS, INSPECTION_RESULT, INSPECTION_TYPES, NCR_SEVERITY, optLabel, passRate, type Inspection, type Ncr } from "@/lib/assure";
import { personName } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Chips, Date_, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Select } from "@/components/assure/action-form";
import { InspectionForm, NcrForm } from "@/components/assure/forms";
import { setInspectionResult } from "../srm-actions";

export const metadata: Metadata = { title: "Quality" };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ result?: string; ncr?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [insp, ncrs, suppliers, cats, catNames, people] = await Promise.all([
    rows<Inspection>(supabase, "quality_inspections", { order: "inspection_date" }),
    rows<Ncr>(supabase, "ncrs", { order: "created_at" }),
    getSuppliers(supabase),
    getLibrary(supabase, "ncr_categories"),
    getLibraryNames(supabase, "ncr_categories"),
    getInternalPeople(supabase),
  ]);
  const sMap = new Map(suppliers.map((s) => [s.id, s]));
  const pMap = byId(people);
  const rate = passRate(insp.map((i) => i.result));
  const openNcrs = ncrs.filter((n) => n.status === "open");
  const ncrList = ncrs.filter((n) => (sp.ncr ?? "open") === "all" || n.status === (sp.ncr ?? "open"));
  const inspList = insp.filter((i) => !sp.result || i.result === sp.result);
  const today = new Date().toISOString().slice(0, 10);
  const opts = supplierOptions(suppliers);

  return (
    <>
      <PageHead title="Quality" sub="Inspections, non-conformance reports and corrective actions across all suppliers." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Quality" }]} />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Inspections" value={insp.length} />
        <Stat label="Pass rate" value={rate === null ? "—" : `${rate}%`} hint="Of inspections with a result" tone={rate === null ? undefined : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad"} />
        <Stat label="Failed" value={insp.filter((i) => i.result === "fail").length} tone="bad" />
        <Stat label="Open NCRs" value={openNcrs.length} tone={openNcrs.length ? "warn" : "ok"} />
        <Stat label="NCRs past due" value={openNcrs.filter((n) => n.due_date && n.due_date < today).length} tone="bad" />
      </section>

      <Panel title="Non-conformance reports" actions={<Chips param="ncr" options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "cancelled", label: "Cancelled" }]} active={sp.ncr === "all" ? "" : sp.ncr ?? "open"} keep={{ result: sp.result }} />}>
        {ncrList.length === 0 ? <Empty title="No NCRs here" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["NCR", "Supplier", "Category", "Severity", "Vendor", "Due", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {ncrList.map((n) => (
                  <tr key={n.id}>
                    <td className="td"><Link href={`/assure/quality/ncr/${n.id}`} className="font-semibold hover:text-accent">{n.title}</Link><div className="text-xs text-muted">{n.ncr_ref}</div></td>
                    <td className="td"><SupplierLink id={n.supplier_id} name={sMap.get(n.supplier_id)?.name} tab="quality" /></td>
                    <td className="td">{catNames.get(n.category_id)}</td>
                    <td className="td"><OptPill list={NCR_SEVERITY} value={n.severity} /></td>
                    <td className="td"><OptPill list={ACK_STATUS} value={n.acknowledgement_status} /></td>
                    <td className="td"><Date_ d={n.due_date} />{n.status === "open" && n.due_date && n.due_date < today && <div><Pill tone="bad">Overdue</Pill></div>}</td>
                    <td className="td"><Pill tone={n.status === "open" ? "warn" : "neutral"}>{n.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Chips label="Inspection result:" param="result" options={INSPECTION_RESULT.map((r) => ({ value: r.value, label: r.label, count: insp.filter((i) => i.result === r.value).length }))} active={sp.result} keep={{ ncr: sp.ncr }} />
      <Card className="overflow-x-auto">
        {inspList.length === 0 ? <Empty title="No inspections" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Inspection", "Supplier", "Type", "Date", "Sample", "Defects", "Inspector", "Result"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {inspList.map((q) => (
                <tr key={q.id} className="align-top">
                  <td className="td font-semibold">{q.product_name ?? "Inspection"}<div className="text-xs font-normal text-muted">{q.inspection_ref}{q.po_reference ? ` · ${q.po_reference}` : ""}</div>
                    {q.defects_found?.length ? <div className="text-xs font-normal text-bad">{q.defects_found.join(", ")}</div> : null}
                    {q.corrective_action_required && <Pill tone="warn">Corrective action required</Pill>}</td>
                  <td className="td"><SupplierLink id={q.supplier_id} name={sMap.get(q.supplier_id)?.name} tab="quality" /></td>
                  <td className="td">{optLabel(INSPECTION_TYPES, q.inspection_type)}</td>
                  <td className="td"><Date_ d={q.inspection_date} /></td>
                  <td className="td tabular-nums">{q.sample_size ?? "—"}</td>
                  <td className="td tabular-nums">{q.defect_count}</td>
                  <td className="td text-xs">{q.inspector ? personName(pMap.get(q.inspector)) : "—"}</td>
                  <td className="td">
                    <OptPill list={INSPECTION_RESULT} value={q.result} />
                    <details className="mt-1"><summary className="cursor-pointer text-xs text-accent">Change</summary>
                      <ActionForm action={setInspectionResult} submit="Save" hidden={{ id: q.id }} className="mt-1 w-56">
                        <Select name="result" options={INSPECTION_RESULT} defaultValue={q.result} />
                        <input name="note" className="input" placeholder="Why it changed" aria-label="Reason" />
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Log an inspection"><div className="p-5"><InspectionForm suppliers={opts} /></div></Panel>
        <Panel title="Raise an NCR"><div className="p-5"><NcrForm suppliers={opts} categories={cats} /></div></Panel>
      </div>
    </>
  );
}
