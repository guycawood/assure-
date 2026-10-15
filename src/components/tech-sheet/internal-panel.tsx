import Link from "next/link";
import { Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { SheetView } from "@/components/tech-sheet/sheet-view";
import { FileList } from "@/components/file-list";
import { openTechSheet, reopenTechSheet } from "@/app/(platform)/sourcing/tech-sheets/actions";
import { pctTone, sheetStatus, type TechSheet } from "@/lib/tech-sheet";

/** Spec page "Technical & packaging" tab: one sheet per supplier (and version), declared vs measured, mismatch flags, history. */
export function SpecTechSheets({ specId, sheets, suppliers, verifiedElsewhere }: {
  specId: string; sheets: TechSheet[]; suppliers: { id: string; name: string }[]; verifiedElsewhere: { sheet_ref: string; supplier_name: string; spec_title: string }[];
}) {
  const without = suppliers.filter((s) => !sheets.some((x) => x.supplier_id === s.id));
  return (
    <div className="space-y-4">
      {sheets.length === 0 && <p className="text-sm text-muted">No data sheet yet. One opens when a supplier quotes with packaging, when a PO is issued and a requirement rule applies, or when you open one below.</p>}
      {sheets.map((s) => (
        <section key={s.id} className="space-y-3 rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 font-semibold">{s.supplier_name}{s.version_name ? ` · ${s.version_name}` : ""}</p>
            {s.po_id && <Link className="text-xs font-semibold text-accent hover:underline" href={`/orders/purchase-orders/${s.po_id}#tech-sheet`}>{s.po_number}</Link>}
            <Pill tone={pctTone(s.completeness.pre_shipment?.percent)}>{s.completeness.pre_shipment?.percent ?? 0}% for pre-shipment</Pill>
          </div>
          <SheetView sheet={s} />
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Photos and files from the vendor</p>
            <FileList entityType="tech_sheet" entityId={s.id} empty="None yet." />
          </div>
          {["declared", "verified", "mismatch"].includes(s.status) && (
            <details className="rounded-lg border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Reopen for the vendor</summary>
              <div className="mt-3">
                <ActionForm action={reopenTechSheet} hidden={{ id: s.id, spec: specId, po: s.po_id }} submit="Reopen" variant="secondary">
                  <Field label="Reason (sent to the vendor)" htmlFor={`ro-${s.id}`}><input id={`ro-${s.id}`} name="reason" className="input" required /></Field>
                </ActionForm>
              </div>
            </details>
          )}
        </section>
      ))}
      {verifiedElsewhere.length > 0 && (
        <p className="text-xs text-muted">Verified sheets on matched specs (reference only; each supplier is pre-filled from its own): {verifiedElsewhere.map((v) => `${v.sheet_ref} (${v.supplier_name}, ${v.spec_title})`).join("; ")}.</p>
      )}
      {without.length > 0 && (
        <ActionForm action={openTechSheet} hidden={{ spec: specId }} submit="Open a data sheet" variant="secondary">
          <Field label="Supplier" htmlFor="ts_supplier" hint="Pre-filled from that supplier's verified sheet for this or a matched spec, if there is one.">
            <select id="ts_supplier" name="supplier" className="input" required defaultValue="">
              <option value="" disabled>Choose a supplier on this spec</option>
              {without.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </ActionForm>
      )}
    </div>
  );
}

/** Order Management PO page: compact status of the data sheet per line. */
export function PoTechSheets({ sheets }: { sheets: TechSheet[] }) {
  if (sheets.length === 0) return <p className="p-5 text-sm text-muted">No technical & packaging data sheet on this PO (no requirement rule applies, and the vendor has not started one).</p>;
  return (
    <div className="divide-y divide-line">
      {sheets.map((s) => {
        const st = sheetStatus(s.status);
        return (
          <section key={s.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-semibold">{s.spec_title}{s.version_name ? ` (${s.version_name})` : ""}</p>
              <Link href={`/sourcing/specs/${s.spec_id}?tab=tech`} className="text-xs font-semibold text-accent hover:underline">Full sheet</Link>
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
            <SheetView sheet={s} compact />
          </section>
        );
      })}
    </div>
  );
}
