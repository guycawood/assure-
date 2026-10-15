import { Pill } from "@/components/ui";
import { FileUpload } from "@/components/file-upload";
import { FileList } from "@/components/file-list";
import { SheetView } from "@/components/tech-sheet/sheet-view";
import { CopySheetForm, VendorSheetForm } from "@/components/tech-sheet/vendor-sheet-form";
import { sheetStatus, type MaterialOptions, type VendorPoLine } from "@/lib/tech-sheet";

const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

/** Vendor PO page: one technical & packaging data sheet per order line, with what adm Indicia needs and when. */
export function VendorTechSheetPanel({ poId, lines, options, canAct, supplierId }: {
  poId: string; lines: VendorPoLine[]; options: MaterialOptions; canAct: boolean; supplierId: string;
}) {
  return (
    <div className="divide-y divide-line">
      {lines.map((l) => {
        const s = l.sheet;
        const st = sheetStatus(s?.status);
        const editable = canAct && s?.status !== "verified";
        return (
          <section key={`${l.spec_id}:${l.spec_version_id ?? ""}`} className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-semibold">{l.spec_title}{l.version_name ? ` (${l.version_name})` : ""} <span className="text-xs font-normal text-muted">· {l.quantity.toLocaleString("en-GB")} units</span></p>
              {l.pre_shipment_due && <span className="text-xs text-muted">Needed before the pre-shipment check, due {d(l.pre_shipment_due)}</span>}
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
            {l.required_pre.length > 0 ? (
              <div className="rounded-lg bg-surface-2 p-3 text-sm">
                <p className="font-semibold">What adm Indicia needs</p>
                <p className="mt-1 text-xs text-muted">At PO acceptance: {l.required_po.map((r) => r.label.toLowerCase()).join("; ") || "nothing"}.
                  {l.required_pre.length > l.required_po.length ? ` Before the pre-shipment check also: ${l.required_pre.filter((r) => !l.required_po.some((p) => p.code === r.code)).map((r) => r.label.toLowerCase()).join("; ")}.` : ""}
                  {" "}The pre-shipment QA/QC check can&apos;t be submitted until the sheet is complete and declared.</p>
                {Array.from(new Set(l.required_pre.flatMap((r) => r.rules.map((x) => x.why)))).map((w) => <p key={w} className="mt-1 text-xs">· {w}</p>)}
              </div>
            ) : <p className="text-xs text-muted">No fields are mandatory on this line, but a complete sheet speeds up shipping and customs.</p>}
            {l.prefill && !s && <p className="text-xs text-accent">Your verified sheet {l.prefill.sheet_ref} ({l.prefill.match}) will pre-fill this sheet when you open it.</p>}
            {s && <SheetView sheet={s} compact vendor />}
            {editable && l.po_status === "accepted" ? (
              <>
                <CopySheetForm poId={poId} specId={l.spec_id} versionId={l.spec_version_id} sources={l.copy_sources} />
                <details className="rounded-lg border border-line p-3" open={!s || s.status === "draft" || s.status === "mismatch"}>
                  <summary className="cursor-pointer text-sm font-semibold text-accent">{s && s.status !== "draft" ? "Update and declare again" : "Fill in the data sheet"}</summary>
                  <div className="mt-3"><VendorSheetForm poId={poId} specId={l.spec_id} versionId={l.spec_version_id} sheet={s} required={l.required_pre} options={options} /></div>
                </details>
              </>
            ) : l.po_status !== "accepted" ? <p className="text-xs text-muted">Accept the purchase order to fill in the data sheet.</p>
              : !canAct ? <p className="text-xs text-muted">Your account is view-only.</p> : null}
            {s && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Photos and files (packed product, carton, label, pallet)</p>
                {canAct && l.po_status === "accepted" && <FileUpload module="orders" entityType="tech_sheet" entityId={s.id} supplierId={supplierId} label="Data sheet photo or file" accept="image/*,application/pdf" compact />}
                <FileList entityType="tech_sheet" entityId={s.id} empty="No photos or files yet." />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
